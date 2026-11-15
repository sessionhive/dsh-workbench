const { execFile, spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

// 目录由主进程按程序位置推导或从设置读取，这里不再写死任何绝对路径。
const DEFAULT_ENGINE_DIR = process.env.DSH_ENGINE_DIR || '';
const DEFAULT_DATA_HOME = process.env.DSH_HOME || '';
const DEFAULT_PORT = String(process.env.DSH_PORT || '3083');

const READY_PATTERN = /dsh web:\s*(https?:\/\/\S+)/;
// 工作台拉起的引擎会带上这两个标记，用于在 POSIX 上识别父进程退出后的残留进程。
const MANAGED_ENV = 'DSH_WORKBENCH_MANAGED';
const MANAGED_PARENT_ENV = 'DSH_WORKBENCH_PARENT';

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

  /**
   * TCP 连接探测：只判断端口有没有被监听，不等 HTTP 响应。
   * 引擎刚绑定但还没开始响应时也能识别为占用，避免重复拉起撞端口。
   */
  function probePort() {
    return new Promise((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port: Number(port) });
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        socket.removeAllListeners();
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(1200);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
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

  /** 信号 0 只做存在性检查，不向目标进程发送任何内容。 */
  function isProcessAlive(pid) {
    const id = Number(pid);
    if (!Number.isFinite(id) || id <= 0) return false;
    try {
      process.kill(id, 0);
      return true;
    } catch (error) {
      return Boolean(error && error.code === 'EPERM');
    }
  }

  /** 读 Linux 进程命令行与父进程；读不到时返回空值，不提升权限。 */
  function readProcCommandLine(pid) {
    try {
      return fs
        .readFileSync(`/proc/${pid}/cmdline`, 'utf8')
        .split('\0')
        .filter(Boolean)
        .join(' ');
    } catch {
      return '';
    }
  }

  function readProcParentPid(pid) {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const close = stat.lastIndexOf(')');
      if (close < 0) return 0;
      const fields = stat.slice(close + 2).trim().split(/\s+/);
      return Number(fields[1]) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * 读取进程环境里的工作台标记。POSIX 下父进程退出后子进程会被 init/subreaper 收养，
   * 单看 PPID 已无法判断是不是工作台留下的残留引擎，所以启动时打一个环境变量标记。
   */
  function readProcEnvironment(pid) {
    try {
      return fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
    } catch {
      return [];
    }
  }

  /**
   * Linux 上从 /proc/net/tcp{,6} 找监听该端口的 socket inode，
   * 再反查持有 inode 的进程。全程只读，不调用 ss/lsof，也不结束任何进程。
   */
  function findPortOwnerLinux() {
    const inodes = new Set();
    for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
      let text = '';
      try {
        text = fs.readFileSync(table, 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split('\n').slice(1)) {
        const fields = line.trim().split(/\s+/);
        if (fields.length < 10) continue;
        const [, local, , state, , , , , , inode] = fields;
        if (state !== '0A' || !inode || inode === '0') continue;
        const portHex = local.split(':').pop();
        if (parseInt(portHex, 16) === Number(port)) inodes.add(inode);
      }
    }
    if (!inodes.size) return null;

    const wanted = new Set([...inodes].map((inode) => `socket:[${inode}]`));
    let entries = [];
    try {
      entries = fs.readdirSync('/proc');
    } catch {
      return null;
    }
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      const fdDir = `/proc/${entry}/fd`;
      let fds = [];
      try {
        fds = fs.readdirSync(fdDir);
      } catch {
        continue;
      }
      for (const fd of fds) {
        try {
          if (!wanted.has(fs.readlinkSync(path.join(fdDir, fd)))) continue;
          const pid = Number(entry);
          return {
            pid,
            parentPid: readProcParentPid(pid),
            commandLine: readProcCommandLine(pid),
            environment: readProcEnvironment(pid),
          };
        } catch {
          // 其他用户的进程 fd 不可读时跳过。
        }
      }
    }
    return null;
  }

  /**
   * 找出占用端口的进程。Windows 命令行走 base64 回传，避免中文路径被控制台编码破坏；
   * Linux 直接读取 /proc，不依赖 ss/lsof 是否安装。
   */
  function findPortOwner() {
    if (process.platform === 'linux') return Promise.resolve(findPortOwnerLinux());
    if (process.platform !== 'win32') return Promise.resolve(null);
    const script = [
      "$ErrorActionPreference='SilentlyContinue'",
      `$c=Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen | Select-Object -First 1`,
      'if(-not $c){exit 0}',
      '$p=Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"',
      'if(-not $p){exit 0}',
      '$pp=if($p.ParentProcessId){$p.ParentProcessId}else{0}',
      '$b=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$p.CommandLine))',
      'Write-Output ("{0}|{1}|{2}" -f $p.ProcessId,$pp,$b)',
    ].join(';');
    return new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { windowsHide: true, timeout: 6000 },
        (error, stdout) => {
          const line = String(stdout || '')
            .split(/\r?\n/)
            .map((item) => item.trim())
            .find((item) => /^\d+\|\d+\|/.test(item));
          if (!line) return resolve(null);
          const [pidText, parentText, encoded] = line.split('|');
          let commandLine = '';
          try {
            commandLine = Buffer.from(encoded, 'base64').toString('utf8');
          } catch {
            /* 读取失败按无法识别处理 */
          }
          resolve({ pid: Number(pidText), parentPid: Number(parentText), commandLine });
        },
      );
    });
  }

  /** 只认这一份 CLI 在同一个端口上拉起、且带工作台标记的 `dsh web`，不碰其他服务。 */
  function isManagedEngineProcess(owner) {
    const commandLine = String(owner.commandLine || '').toLowerCase().replace(/\\/g, '/');
    const cli = cliPath().toLowerCase().replace(/\\/g, '/');
    const matched =
      commandLine.includes(cli) &&
      /(^|\s)web(\s|$)/.test(commandLine) &&
      commandLine.includes(`--port ${port}`);
    if (!matched) return false;
    if (process.platform === 'linux') {
      // 环境标记能穿过父进程退出后的收养关系，避免把用户在终端里另开的 DSH 当成残留。
      return (owner.environment || []).includes(`${MANAGED_ENV}=1`);
    }
    return true;
  }

  /** POSIX 下子进程以独立进程组启动，负 PID 可以一次收掉整棵进程树。 */
  function signalProcessTree(pid, signal) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      /* 不是进程组组长时退回单进程 */
    }
    try {
      process.kill(pid, signal);
    } catch {
      /* 进程可能已经退出 */
    }
  }

  function terminateTree(pid) {
    return new Promise((resolve) => {
      if (!pid) return resolve();
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.on('exit', resolve);
        killer.on('error', resolve);
        setTimeout(resolve, 4000);
        return;
      }

      signalProcessTree(pid, 'SIGTERM');
      const deadline = Date.now() + 2000;
      const tick = () => {
        if (!isProcessAlive(pid)) return resolve();
        if (Date.now() > deadline) {
          signalProcessTree(pid, 'SIGKILL');
          return setTimeout(resolve, 200);
        }
        setTimeout(tick, 120);
      };
      setTimeout(tick, 120);
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

    let recoveredLog = '';
    if (await probePort()) {
      const owner = await findPortOwner();
      const parentAlive = owner ? isProcessAlive(owner.parentPid) : false;
      const recordedParent = owner
        ? Number(
            (owner.environment || [])
              .find((item) => item.startsWith(`${MANAGED_PARENT_ENV}=`))
              ?.slice(MANAGED_PARENT_ENV.length + 1),
          ) || 0
        : 0;
      // POSIX 下父进程退出后引擎会被 init/subreaper 收养，PPID 不再指向工作台，
      // 所以优先用启动时写进环境的父进程号判断归属。
      const orphaned =
        process.platform === 'linux'
          ? recordedParent === process.pid || (recordedParent > 0 && !isProcessAlive(recordedParent))
          : owner?.parentPid === process.pid || !parentAlive;
      // 只清理「同一份 CLI、同一端口、父进程已退出或就是本进程」的残留引擎。
      const stale = Boolean(owner) && isManagedEngineProcess(owner) && orphaned;
      if (stale) {
        recoveredLog = `检测到上次未退出的 DSH 引擎（PID ${owner.pid}）占用端口 ${port}，正在清理。`;
        appendLog(recoveredLog);
        await terminateTree(owner.pid);
        await waitPortFree();
      }
      if (await probePort()) {
        setState({
          status: 'error',
          url: '',
          error: stale
            ? `端口 ${port} 仍被残留的 DSH 引擎占用，自动清理没有成功。请手动结束后台引擎，或换一个端口。`
            : `端口 ${port} 已被占用。请先关闭外部启动的 DSH 引擎，或设置环境变量 DSH_PORT 换一个端口。`,
        });
        return snapshot();
      }
    }

    const nodeExe = resolveNodeExe();
    const command = nodeExe || process.execPath;
    const env = {
      ...process.env,
      DSH_HOME: dataHome,
      [MANAGED_ENV]: '1',
      [MANAGED_PARENT_ENV]: String(process.pid),
    };
    if (!nodeExe) env.ELECTRON_RUN_AS_NODE = '1';
    delete env.DSH_CUSTOMER_HOME;
    delete env.ELECTRON_NO_ASAR;

    setState({
      status: 'starting',
      url: '',
      error: '',
      log: recoveredLog,
      startedAt: Date.now(),
    });

    try {
      child = spawn(command, [cli, 'web', '--no-open', '--port', port], {
        cwd: engineDir,
        env,
        windowsHide: true,
        // POSIX 下单独成组，退出时能一次收掉引擎派生的子进程。
        detached: process.platform !== 'win32',
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
      terminateTree(proc.pid).finally(finish);
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
    // 退出时不等待：先发 SIGTERM/SIGKILL，应用随后退出。
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } else {
        signalProcessTree(proc.pid, 'SIGTERM');
        setTimeout(() => signalProcessTree(proc.pid, 'SIGKILL'), 800).unref?.();
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
