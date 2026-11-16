const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');

/**
 * 本地语音服务（GPT-SoVITS v2）。
 *
 * - 只在 127.0.0.1:9880 上监听，不对外开端口；
 * - 首次朗读时才启动 Python 进程，模型加载完成约 1–2 分钟；
 * - 空闲 30 分钟自动卸载，把显存还回去；
 * - 如果 9880 上已经有服务（例如用户自己开的），直接接管为只读使用，退出时不动它。
 */
const HOST = '127.0.0.1';
const PORT = 9880;
const READY_TIMEOUT_MS = 240_000;
const SYNTH_TIMEOUT_MS = 600_000;
const IDLE_UNLOAD_MS = 30 * 60_000;

function request(method, urlPath, body, timeout) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: urlPath,
        method,
        timeout,
        headers: payload
          ? { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length }
          : undefined,
      },
      (res) => {
        const parts = [];
        res.on('data', (chunk) => parts.push(Buffer.from(chunk)));
        res.on('end', () => {
          const buffer = Buffer.concat(parts);
          resolve({
            status: res.statusCode || 0,
            type: String(res.headers['content-type'] || ''),
            buffer,
          });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('请求本地语音服务超时')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function readableError(error) {
  const text = String((error && error.message) || error || '').replace(/\s+/g, ' ').trim();
  if (/ECONNREFUSED|ECONNRESET|socket hang up/i.test(text)) {
    return '本地语音服务没有响应，可能还在加载或已经退出';
  }
  return text.slice(0, 240);
}

function createLocalTtsManager({ logDir }) {
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'local-tts.log');

  let child = null;
  let owned = false;
  let starting = null;
  let root = '';
  let lastError = '';
  let idleTimer = null;
  let logTail = [];

  function writeLog(line) {
    const text = String(line || '').replace(/\r/g, '');
    for (const part of text.split('\n')) {
      const body = part.trimEnd();
      if (!body) continue;
      logTail.push(body);
      if (logTail.length > 60) logTail.shift();
    }
    try {
      fs.appendFileSync(logFile, `${text}\n`, 'utf8');
    } catch {
      // 日志写不进去不影响朗读
    }
  }

  function resetLog() {
    logTail = [];
    try {
      fs.writeFileSync(logFile, `[${new Date().toISOString()}] local tts\n`, 'utf8');
    } catch {
      // 同上
    }
  }

  function pythonOf(base) {
    return process.platform === 'win32'
      ? path.join(base, '.venv', 'Scripts', 'python.exe')
      : path.join(base, '.venv', 'bin', 'python');
  }

  function apiScriptOf(base) {
    return path.join(base, 'api_v2.py');
  }

  function configOf(base) {
    return path.join(base, 'GPT_SoVITS', 'configs', 'tts_infer.yaml');
  }

  function validateRoot(base) {
    const value = String(base || '').trim();
    if (!value) throw new Error('还没有设置本地语音目录，请先在设置里选择 GPT-SoVITS 根目录');
    if (!fs.existsSync(value)) throw new Error(`本地语音目录不存在：${value}`);
    if (!fs.existsSync(apiScriptOf(value))) {
      throw new Error(`目录里没有 api_v2.py：${value}`);
    }
    const python = pythonOf(value);
    if (!fs.existsSync(python)) {
      throw new Error(`没有找到本地 Python 环境：${python}`);
    }
    if (!fs.existsSync(configOf(value))) {
      throw new Error(`没有找到模型配置：${configOf(value)}`);
    }
    return { root: value, python };
  }

  function tailText() {
    return logTail.slice(-6).join(' / ').slice(0, 300);
  }

  async function probe() {
    try {
      const result = await request('GET', '/docs', null, 1500);
      return result.status >= 200 && result.status < 400;
    } catch {
      return false;
    }
  }

  function status() {
    if (starting) {
      return { state: 'starting', detail: '本地语音引擎启动中', port: PORT, root, owned };
    }
    if (child && child.exitCode === null) {
      return {
        state: lastError ? 'error' : 'ready',
        detail: lastError || '本地语音引擎已就绪',
        port: PORT,
        root,
        owned,
      };
    }
    return {
      state: lastError ? 'error' : 'stopped',
      detail: lastError || '本地语音引擎未启动',
      port: PORT,
      root,
      owned,
    };
  }

  function clearIdle() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function touch() {
    clearIdle();
    if (!owned) return;
    idleTimer = setTimeout(() => {
      void stop('空闲卸载');
    }, IDLE_UNLOAD_MS);
    idleTimer.unref?.();
  }

  async function shutdownChild() {
    const current = child;
    child = null;
    owned = false;
    if (!current || current.exitCode !== null) return;
    try {
      await request('GET', '/control?command=exit', null, 1500);
    } catch {
      // 服务不响应时直接杀进程
    }
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          if (process.platform === 'win32') {
            spawnSync('taskkill', ['/pid', String(current.pid), '/T', '/F'], {
              windowsHide: true,
            });
          } else {
            current.kill('SIGKILL');
          }
        } catch {
          // 已经退出
        }
        resolve();
      }, 3000);
      current.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async function stop(reason) {
    clearIdle();
    const wasOwned = owned;
    starting = null;
    await shutdownChild();
    if (wasOwned) {
      lastError = '';
      writeLog(`[${new Date().toISOString()}] stopped: ${reason || ''}`);
    }
    return status();
  }

  async function ensure(base) {
    const info = validateRoot(base);
    if (starting) return starting;
    if (child && child.exitCode === null && root === info.root) {
      if (await probe()) {
        lastError = '';
        touch();
        return status();
      }
      await shutdownChild();
    } else if (child && child.exitCode !== null) {
      child = null;
      owned = false;
    }

    if (root !== info.root) {
      if (owned || child) await shutdownChild();
      root = info.root;
    }

    // 端口上已有别人启动的服务：直接复用，不改它的生命周期。
    if (await probe()) {
      owned = false;
      lastError = '';
      return status();
    }

    resetLog();
    lastError = '';
    writeLog(`[${new Date().toISOString()}] starting ${info.python}`);
    const proc = spawn(
      info.python,
      ['api_v2.py', '-a', HOST, '-p', String(PORT), '-c', path.join('GPT_SoVITS', 'configs', 'tts_infer.yaml')],
      {
        cwd: info.root,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUNBUFFERED: '1',
        },
      },
    );
    child = proc;
    owned = true;
    proc.stdout.on('data', (chunk) => writeLog(chunk.toString('utf8')));
    proc.stderr.on('data', (chunk) => writeLog(chunk.toString('utf8')));
    proc.once('exit', (code) => {
      if (child === proc) {
        child = null;
        owned = false;
        if (!lastError && code !== 0 && code !== null) {
          lastError = `本地语音引擎退出（代码 ${code}）${tailText() ? `：${tailText()}` : ''}`;
        }
        writeLog(`[${new Date().toISOString()}] exit ${code}`);
      }
    });

    starting = (async () => {
      const deadline = Date.now() + READY_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (child !== proc || proc.exitCode !== null) {
          throw new Error(
            `本地语音引擎启动失败${tailText() ? `：${tailText()}` : '，查看设置里的引擎日志'}`,
          );
        }
        if (await probe()) {
          writeLog(`[${new Date().toISOString()}] ready`);
          touch();
          // 先清掉 starting，让返回的状态就是「已就绪」。
          starting = null;
          return status();
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      await shutdownChild();
      throw new Error('本地语音引擎启动超时，请确认模型文件完整、显存足够');
    })()
      .catch((error) => {
        lastError = readableError(error);
        throw error;
      })
      .finally(() => {
        starting = null;
      });

    return starting;
  }

  async function synthesize(requestBody) {
    const info = validateRoot(requestBody.root);
    const referenceAudio = validateReference(requestBody.referenceAudio);
    const referenceText = String(requestBody.referenceText || '').trim();
    if (!referenceText) {
      throw new Error('参考音频文本为空：请把录音里说的话逐字填进「参考音频文本」');
    }
    await ensure(info.root);
    touch();
    const payload = {
      text: requestBody.text,
      text_lang: 'zh',
      ref_audio_path: referenceAudio,
      prompt_lang: 'zh',
      prompt_text: referenceText,
      text_split_method: 'cut5',
      batch_size: 1,
      media_type: 'wav',
      streaming_mode: false,
      speed_factor: requestBody.speed,
      seed: 42,
      parallel_infer: false,
      repetition_penalty: 1.35,
    };
    const result = await request('POST', '/tts', payload, SYNTH_TIMEOUT_MS);
    if (result.status !== 200 || !result.buffer.length) {
      let detail = '';
      if (result.type.includes('application/json')) {
        try {
          detail = JSON.parse(result.buffer.toString('utf8')).detail || '';
        } catch {
          detail = result.buffer.toString('utf8');
        }
      }
      throw new Error(
        `本地语音合成失败${detail ? `：${String(detail).slice(0, 200)}` : `（HTTP ${result.status}）`}`,
      );
    }
    return { audio: result.buffer, mime: 'audio/wav' };
  }

  function validateReference(referenceAudio) {
    const file = String(referenceAudio || '').trim();
    if (!file) throw new Error('还没有选择参考音频，请在设置里选一段 5–15 秒的人声');
    if (!fs.existsSync(file)) throw new Error(`参考音频不存在：${file}`);
    return file;
  }

  /** 退出时同步收掉 Python 进程，不给后台留孤儿。 */
  function quit() {
    clearIdle();
    const current = child;
    child = null;
    if (!owned || !current || current.exitCode !== null) return;
    owned = false;
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(current.pid), '/T', '/F'], {
          windowsHide: true,
          timeout: 4000,
        });
      } else {
        current.kill('SIGKILL');
      }
    } catch {
      // 已经退出
    }
  }

  return { status, ensure, stop, synthesize, validateReference, touch, quit };
}

module.exports = { createLocalTtsManager, LOCAL_TTS_PORT: PORT };
