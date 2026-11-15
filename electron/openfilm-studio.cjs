/**
 * OpenFilm Studio 托管：工作台是这台机器上 Studio 的宿主。
 *
 * - 已有 Studio（run.json 指向且健康）时直接附着，不打断用户或 OpenFilm 桌面端正在做的事；
 * - 没有时用 utility process 启动 openfilm 的 startStudio，advertise 给 CLI / agent 使用；
 * - 退出工作台时只关闭自己启动的那个。
 *
 * 编辑器地址里带 launch key，只交给渲染层，不写日志、不进存档。
 */
const { dialog, shell, utilityProcess } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_PORT = 4747;
const START_TIMEOUT_MS = 45_000;
const OPEN_TIMEOUT_MS = 60_000;

function studioHome() {
  return process.env.OPENFILM_HOME || path.join(os.homedir(), '.openfilm');
}

function readRunFile() {
  try {
    return JSON.parse(fs.readFileSync(path.join(studioHome(), 'run.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function health(origin, timeout = 1500) {
  if (!origin) return null;
  try {
    const response = await fetch(`${origin}/api/health`, {
      signal: AbortSignal.timeout(timeout),
    });
    const said = await response.json();
    return said?.product === 'openfilm-studio' ? said : null;
  } catch {
    return null;
  }
}

/** 这台机器上已经在跑的 Studio，只认 run.json 里认证过的那个。 */
async function findRunning() {
  const run = readRunFile();
  if (!run?.origin || !run?.key) return null;
  const said = await health(run.origin);
  if (!said) return null;
  return {
    origin: run.origin,
    filmOrigin: said.filmOrigin || run.filmOrigin || '',
    key: run.key,
    attached: true,
    child: null,
  };
}

function createOpenfilmManager({ onUpdate = () => {} } = {}) {
  let studio = null;
  let status = 'idle';
  let error = '';
  let project = null;
  let starting = null;
  let quitting = false;

  function snapshot() {
    return {
      status,
      error,
      attached: Boolean(studio?.attached),
      origin: studio?.origin || '',
      editorUrl: studio ? `${studio.origin}/?key=${encodeURIComponent(studio.key)}` : '',
      project,
    };
  }

  function publish(next, message = '') {
    status = next;
    if (next === 'error') error = message;
    if (next === 'ready') error = '';
    try {
      onUpdate(snapshot());
    } catch {
      /* 渲染层可能已销毁 */
    }
  }

  function forkStudio() {
    return new Promise((resolve, reject) => {
      const entry = path.join(__dirname, 'openfilm-studio-process.mjs');
      let settled = false;
      let child;
      try {
        child = utilityProcess.fork(entry, [], {
          serviceName: 'OpenFilm Studio',
          stdio: 'pipe',
          env: { ...process.env, OPENFILM_STUDIO_PORT: String(DEFAULT_PORT) },
        });
      } catch (failure) {
        reject(failure);
        return;
      }
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill();
        } catch {
          /* 已退出 */
        }
        reject(new Error('OpenFilm Studio 启动超时'));
      }, START_TIMEOUT_MS);

      child.stdout?.on('data', (chunk) => {
        const line = String(chunk).trim();
        if (line) console.log('[openfilm]', line);
      });
      child.stderr?.on('data', (chunk) => {
        const line = String(chunk).trim();
        if (line) console.warn('[openfilm]', line);
      });
      child.on('message', (message) => {
        if (message?.type === 'ready' && !settled) {
          settled = true;
          clearTimeout(timer);
          resolve({
            origin: message.origin,
            filmOrigin: message.filmOrigin || '',
            key: message.key,
            attached: false,
            child,
          });
        } else if (message?.type === 'failed' && !settled) {
          settled = true;
          clearTimeout(timer);
          reject(Object.assign(new Error(message.message || 'Studio 启动失败'), { code: message.code }));
        } else if (message?.type === 'open' && /^https?:\/\//i.test(message.url || '')) {
          void shell.openExternal(message.url);
        }
      });
      child.once('exit', (code) => {
        if (studio?.child === child) {
          studio = null;
          project = null;
          if (!quitting) {
            publish('error', `OpenFilm Studio 已退出（code ${code}）`);
          }
        }
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`OpenFilm Studio 启动后立即退出（code ${code}）`));
        }
      });
    });
  }

  async function ensure() {
    if (studio) {
      if (await health(studio.origin, 800)) {
        publish('ready');
        return snapshot();
      }
      studio = null;
    }
    if (starting) return starting;
    publish('starting');
    starting = (async () => {
      try {
        const running = await findRunning();
        if (running) {
          studio = running;
          publish('ready');
          return snapshot();
        }
        studio = await forkStudio();
        publish('ready');
        return snapshot();
      } catch (failure) {
        studio = null;
        publish('error', failure?.message || String(failure));
        return snapshot();
      } finally {
        starting = null;
      }
    })();
    return starting;
  }

  async function openProject(folder) {
    const before = snapshot();
    if (before.status !== 'ready') {
      const next = await ensure();
      if (next.status !== 'ready') return next;
    }
    if (!studio) return snapshot();
    const body = {
      ...(folder ? { path: path.resolve(String(folder)) } : {}),
      /* 内嵌页面已经是一页：Studio 不再另开浏览器 */
      pages: 1,
      fallback: 0,
      now: false,
    };
    try {
      const response = await fetch(`${studio.origin}/api/open`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-studio-key': studio.key,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(OPEN_TIMEOUT_MS),
      });
      const said = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(said?.error || `Studio 返回 ${response.status}`);
      }
      project = said?.project || null;
      publish('ready');
      return { ...snapshot(), url: said?.url || snapshot().editorUrl };
    } catch (failure) {
      publish('error', failure?.message || String(failure));
      return snapshot();
    }
  }

  async function chooseProject() {
    const picked = await dialog.showOpenDialog({
      title: '选择影片目录（目录里应有 film.html）',
      properties: ['openDirectory'],
      buttonLabel: '打开',
    });
    if (picked.canceled || !picked.filePaths?.length) return { canceled: true };
    return { canceled: false, path: picked.filePaths[0] };
  }

  async function openExternal(url) {
    if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false, error: '只允许 http(s) 地址' };
    if (studio) {
      const allowed = new URL(studio.origin).origin;
      let origin = '';
      try {
        origin = new URL(url).origin;
      } catch {
        return { ok: false, error: '地址无效' };
      }
      const film = studio.filmOrigin ? new URL(studio.filmOrigin).origin : '';
      if (origin !== allowed && origin !== film) return { ok: false, error: '不是 Studio 的地址' };
    }
    await shell.openExternal(url);
    return { ok: true };
  }

  function quit() {
    quitting = true;
    const child = studio?.child;
    studio = null;
    if (!child) return;
    try {
      child.postMessage({ type: 'quit' });
    } catch {
      /* 已退出 */
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* 已退出 */
      }
    }, 8000);
    if (typeof timer.unref === 'function') timer.unref();
  }

  return {
    snapshot,
    ensure,
    openProject,
    chooseProject,
    openExternal,
    quit,
  };
}

module.exports = { createOpenfilmManager };
