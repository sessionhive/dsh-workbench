const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

// 目录由主进程按程序位置推导或从设置读取，这里不再写死任何绝对路径。
const DEFAULT_ENGINE_DIR = process.env.DSH_ENGINE_DIR || '';
const DEFAULT_DATA_HOME = process.env.DSH_HOME || '';
const DEFAULT_PORT = String(process.env.DSH_PORT || '3083');

const READY_PATTERN = /dsh web:\s*(https?:\/\/\S+)/;

/**
 * DSH 引擎进程管理器。
 * 只做三件事：拉起 `dsh web`、抓它打印的带 token 地址、退出时收掉进程。
 * 不读取引擎内部数据，也不介入模型与工具执行。
 */
function createEngineManager(options = {}) {
  const onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : () => {};
  const engineDir = options.engineDir || DEFAULT_ENGINE_DIR;
  const dataHome = options.dataHome || DEFAULT_DATA_HOME;
  const port = String(options.port || DEFAULT_PORT);

  let child = null;
  let stopping = false;
  let quitting = false;
  let startupTimer = null;

  let state = {
    status: 'idle',
    url: '',
    error: '',
    log: '',
    startedAt: 0,
  };

  const snapshot = () => ({
    ...state,
    port,
    engineDir,
    dataHome,
  });

  const emit = () => {
    try {
      onUpdate(snapshot());
    } catch {
      /* 状态推送失败不影响引擎本身 */
    }
  };

  const setState = (patch) => {
    state = { ...state, ...patch };
    emit();
  };

  /** 日志里不允许出现 token，完整地址只通过 url 字段给渲染层。 */
  const mask = (line) =>
    String(line).replace(/token=[A-Za-z0-9_\-.]*/g, 'token=***');

  const appendLog = (chunk) => {
    const text = mask(chunk).replace(/\r/g, '').trimEnd();
    if (!text) return;
    const next = state.log ? `${state.log}\n${text}` : text;
    state = { ...state, log: next.split('\n').slice(-80).join('\n') };
    emit();
  };

  const cliPath = () => path.join(engineDir, 'apps', 'cli', 'lib', 'bin.js');

  function probePort() {
    return new Promise((resolve) => {
      const req = http.get(
        { host: '127.0.0.1', port: Number(port), path: '/', timeout: 1200 },
        (res) => {
          res.resume();
          resolve(true);
        },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  function waitPortFree(timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
      const tick = async () => {
        if (!(await probePort())) return resolve(true);
        if (Date.now() > deadline) return resolve(false);
        setTimeout(tick, 240);
      };
      void tick();
    });
  }

  /** 优先用系统 Node（原生模块 ABI 与引擎安装时一致），找不到才退回 Electron 的 Node 模式。 */
  function resolveNodeExe() {
    const explicit = process.env.DSH_NODE;
    if (explicit) {
      try {
        if (fs.statSync(explicit).isFile()) return explicit;
      } catch {
        /* next */
      }
    }
    // 只按 PATH 探测，不绑定任何机器的安装位置；找不到时回退到 Electron 自带 Node。
    const dirs = String(process.env.Path || process.env.PATH || '')
      .split(path.delimiter)
      .filter(Boolean);
    for (const dir of dirs) {
      const candidate = path.join(dir, process.platform === 'win32' ? 'node.exe' : 'node');
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        /* next */
      }
    }
    return '';
  }

  function handleLine(line) {
    const text = line.trim();
    if (!text) return;
    appendLog(text);
    const hit = text.match(READY_PATTERN);
    if (hit && hit[1]) {
      if (startupTimer) {
        clearTimeout(startupTimer);
        startupTimer = null;
      }
      setState({ status: 'ready', url: hit[1], error: '', startedAt: Date.now() });
    }
  }

  async function start(force = false) {
    if (child && !force) return snapshot();
    if (force) await stop();
    if (state.status === 'starting' && !force) return snapshot();

    if (!engineDir || !dataHome) {
      setState({
        status: 'error',
        url: '',
        error: '尚未配置引擎安装目录或数据目录。请在设置「引擎」页签里选择后重启客户端。',
      });
      return snapshot();
    }

    const cli = cliPath();
    if (!fs.existsSync(cli)) {
      setState({
        status: 'error',
        url: '',
        error: `找不到引擎 CLI：${cli}。请在设置「引擎」页签检查安装目录。`,
      });
      return snapshot();
    }

    if (await probePort()) {
      setState({
        status: 'error',
        url: '',
        error: `端口 ${port} 已被占用。请先关闭外部启动的 DSH 引擎，或设置环境变量 DSH_PORT 换一个端口。`,
      });
      return snapshot();
    }

    const nodeExe = resolveNodeExe();
    const command = nodeExe || process.execPath;
    const env = { ...process.env, DSH_HOME: dataHome };
    if (!nodeExe) env.ELECTRON_RUN_AS_NODE = '1';
    delete env.DSH_CUSTOMER_HOME;
    delete env.ELECTRON_NO_ASAR;

    setState({
      status: 'starting',
      url: '',
      error: '',
      log: '',
      startedAt: Date.now(),
    });

    try {
      child = spawn(command, [cli, 'web', '--no-open', '--port', port], {
        cwd: engineDir,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      setState({
        status: 'error',
        error: `引擎启动失败：${error instanceof Error ? error.message : String(error)}`,
      });
      return snapshot();
    }

    const proc = child;
    for (const stream of [proc.stdout, proc.stderr]) {
      if (!stream) continue;
      stream.setEncoding('utf8');
      let buffer = '';
      stream.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) handleLine(line);
      });
      stream.on('end', () => {
        if (buffer.trim()) handleLine(buffer);
        buffer = '';
      });
    }

    proc.on('error', (error) => {
      if (child === proc) child = null;
      if (quitting || stopping) return;
      setState({
        status: 'error',
        error: `引擎进程无法启动：${error instanceof Error ? error.message : String(error)}`,
      });
    });

    proc.on('exit', (code) => {
      if (child === proc) child = null;
      if (quitting || stopping) return;
      if (state.status === 'ready') {
        setState({
          status: 'error',
          error: `引擎进程已退出（code ${code ?? 'unknown'}），可点击重试重新启动。`,
        });
      } else {
        setState({
          status: 'error',
          error: `引擎启动失败（code ${code ?? 'unknown'}）。请查看下方日志。`,
        });
      }
    });

    if (startupTimer) clearTimeout(startupTimer);
    startupTimer = setTimeout(() => {
      startupTimer = null;
      if (state.status === 'starting') {
        setState({
          status: 'error',
          error: `引擎启动超时（45 秒）。请查看下方日志，或检查端口 ${port} 与引擎目录。`,
        });
      }
    }, 45000);

    return snapshot();
  }

  function stop() {
    const proc = child;
    if (!proc) return Promise.resolve();
    stopping = true;
    if (startupTimer) {
      clearTimeout(startupTimer);
      startupTimer = null;
    }
    child = null;

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        stopping = false;
        resolve();
      };
      proc.once('exit', finish);
      try {
        if (process.platform === 'win32') {
          const killer = spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          });
          killer.on('exit', finish);
          killer.on('error', finish);
        } else {
          proc.kill('SIGTERM');
        }
      } catch {
        finish();
      }
      setTimeout(finish, 5000);
    });
  }

  async function restart() {
    await stop();
    await waitPortFree();
    setState({ status: 'idle', url: '', error: '', log: '' });
    return start();
  }

  function quit() {
    quitting = true;
    if (startupTimer) {
      clearTimeout(startupTimer);
      startupTimer = null;
    }
    const proc = child;
    child = null;
    if (!proc) return;
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } else {
        proc.kill('SIGTERM');
      }
    } catch {
      /* 退出清理失败不阻塞应用退出 */
    }
  }

  return {
    start,
    stop,
    restart,
    quit,
    status: snapshot,
    port,
    engineDir,
    dataHome,
  };
}

module.exports = { createEngineManager };
