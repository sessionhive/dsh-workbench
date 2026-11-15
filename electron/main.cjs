const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  dialog,
  shell,
  clipboard,
  session,
  protocol,
  net,
} = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { pathToFileURL } = require('url');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const { createEngineManager } = require('./engine-manager.cjs');
const { createOpenfilmManager } = require('./openfilm-studio.cjs');

// 背景素材协议：只读转出用户显式选择的本机图片/视频，不把整块磁盘包成 file://。
const MEDIA_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'workbench-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

/**
 * 壳工程不写死绝对路径：开发态以工作台目录的上一级为根，安装态以可执行文件所在目录为根。
 * AppImage 的 execPath 在临时挂载点里，改用 APPIMAGE 指向的真实文件位置。
 * 需要自定义时优先读环境变量，其次读设置里持久化的路径。
 */
function programRoot() {
  if (!app.isPackaged) return path.resolve(__dirname, '..', '..');
  if (process.platform === 'linux' && process.env.APPIMAGE) {
    return path.dirname(process.env.APPIMAGE);
  }
  return path.dirname(process.execPath);
}

function firstExistingDir(candidates) {
  for (const dir of candidates) {
    try {
      if (dir && fs.statSync(dir).isDirectory()) return dir;
    } catch {
      /* 继续找下一个候选位置 */
    }
  }
  return '';
}

function defaultPaths() {
  const root = programRoot();
  const home = os.homedir();
  const linux = process.platform === 'linux';
  const sourceLayout = !app.isPackaged;
  const engineDir =
    process.env.DSH_ENGINE_DIR ||
    firstExistingDir([
      path.join(root, 'engine'),
      path.join(home, 'DSH', 'engine'),
      path.join(home, 'dsh', 'engine'),
      path.join(home, '.local', 'share', 'dsh', 'engine'),
    ]) ||
    path.join(root, 'engine');
  const dataPath =
    process.env.DSH_HOME ||
    firstExistingDir([
      path.join(root, 'engine-data', '.dsh'),
      path.join(home, '.dsh'),
      path.join(home, '.config', 'dsh'),
      path.join(home, '.local', 'share', 'dsh'),
    ]) ||
    (linux && app.isPackaged ? path.join(home, '.dsh') : path.join(root, 'engine-data', '.dsh'));
  const workspacePath = sourceLayout
    ? path.join(root, 'workspace')
    : linux
      ? home
      : path.join(root, 'workspace');
  return {
    root,
    engineDir,
    dataPath,
    workspacePath,
    // Linux 安装态不要把整个 / 暴露给文件工作台，默认收在家目录。
    filesRoot: linux && app.isPackaged ? home : root,
    skillsPath: path.join(dataPath, 'skills'),
    toolsPath:
      linux && app.isPackaged
        ? path.join(app.getPath('userData'), 'tools')
        : path.join(root, 'tools'),
  };
}

/** 设置里的空值视为未配置，用默认路径补齐；非空值以用户设置为准。 */
function resolveEnginePaths(engineSettings) {
  const base = defaultPaths();
  const source = engineSettings && typeof engineSettings === 'object' ? engineSettings : {};
  const pick = (key) => {
    const value = typeof source[key] === 'string' ? source[key].trim() : '';
    return value || base[key];
  };
  return {
    engineDir: process.env.DSH_ENGINE_DIR || pick('engineDir'),
    dataPath: process.env.DSH_HOME || pick('dataPath'),
    workspacePath: pick('workspacePath'),
    filesRoot: pick('filesRoot'),
    skillsPath: pick('skillsPath'),
    toolsPath: pick('toolsPath'),
  };
}

// ---------------- Terminal shells ----------------

const terminalSessions = new Map();

function findExecutables(name) {
  if (process.platform === 'win32') {
    try {
      const result = spawnSync('where', [name], { encoding: 'utf8', windowsHide: true });
      if (result.status !== 0 || !result.stdout) return [];
      return result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && fs.existsSync(line));
    } catch {
      return [];
    }
  }

  const dirs = String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean);
  const candidates = path.isAbsolute(name) ? [name] : dirs.map((dir) => path.join(dir, name));
  const found = [];
  for (const candidate of candidates) {
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      found.push(candidate);
    } catch {
      /* 不可执行或不存在 */
    }
  }
  return [...new Set(found)];
}

function firstShell(name, loginShell) {
  const hits = findExecutables(name);
  if (hits.length) return hits[0];
  if (loginShell && path.basename(loginShell) === name) return loginShell;
  for (const dir of ['/bin', '/usr/bin', '/usr/local/bin']) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

/**
 * 只按 PATH 与环境变量探测 shell，不写死安装路径；设置里保存的是 shell id，
 * 换机器后按同一份探测结果重新解析。Windows 识别 Git Bash / PowerShell / CMD，
 * Linux 识别当前登录 shell 与常见的 bash / zsh / sh。
 */
function detectTerminalShells() {
  if (process.platform !== 'win32') {
    const loginShell = process.env.SHELL || '';
    const bash = firstShell('bash', loginShell);
    const zsh = firstShell('zsh', loginShell);
    const sh = firstShell('sh', loginShell);
    const shells = [{ id: 'auto', label: '自动', path: '', kind: 'auto', available: true }];
    if (bash) shells.push({ id: 'bash', label: 'Bash', path: bash, kind: 'posix', available: true });
    if (zsh) shells.push({ id: 'zsh', label: 'Zsh', path: zsh, kind: 'posix', available: true });
    if (sh) shells.push({ id: 'sh', label: 'Sh', path: sh, kind: 'posix', available: true });
    return shells;
  }

  const git = findExecutables('git.exe')[0];
  let bash = '';
  if (git) {
    const candidate = path.join(path.dirname(path.dirname(git)), 'bin', 'bash.exe');
    if (fs.existsSync(candidate)) bash = candidate;
  }
  if (!bash) {
    bash = findExecutables('bash.exe').find((item) => /[\\/]git[\\/]/i.test(item)) || '';
  }
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const powershell = path.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const cmd = process.env.ComSpec || path.join(systemRoot, 'System32', 'cmd.exe');
  return [
    { id: 'auto', label: '自动', path: '', kind: 'auto', available: true },
    { id: 'git-bash', label: 'Git Bash', path: bash, kind: 'posix', available: Boolean(bash) },
    {
      id: 'powershell',
      label: 'PowerShell',
      path: powershell,
      kind: 'powershell',
      available: fs.existsSync(powershell),
    },
    { id: 'cmd', label: 'CMD', path: cmd, kind: 'cmd', available: fs.existsSync(cmd) },
  ];
}

function resolveTerminalShell(preferred) {
  const shells = detectTerminalShells();
  const byId = new Map(shells.map((shell) => [shell.id, shell]));
  if (preferred && preferred !== 'auto') {
    const picked = byId.get(preferred);
    if (picked && picked.available) return picked;
  }
  const order =
    process.platform === 'win32' ? ['git-bash', 'powershell', 'cmd'] : ['bash', 'zsh', 'sh'];
  for (const id of order) {
    const shell = byId.get(id);
    if (shell?.available) return shell;
  }
  return null;
}

function terminalMarker(kind) {
  if (kind === 'posix') return `printf '\\n__DSH_CWD__%s\\n' "$PWD"`;
  if (kind === 'powershell') return 'Write-Output "__DSH_CWD__$($PWD.Path)"';
  return 'echo __DSH_CWD__%CD%';
}

function terminalSend(session, channel, payload) {
  try {
    if (session.sender && !session.sender.isDestroyed()) {
      session.sender.send(channel, payload);
    }
  } catch {
    // 窗口已销毁时静默丢弃输出。
  }
}

/** 逐段转发输出，同时把内部 cwd 标记从可见内容里剥掉。 */
function terminalFlush(session, chunk) {
  session.pending += chunk;
  const markerExp = /__DSH_CWD__(.*?)\r?\n/;
  let match = markerExp.exec(session.pending);
  while (match) {
    const before = session.pending.slice(0, match.index);
    if (before) terminalSend(session, 'terminal:data', { id: session.id, data: before });
    session.pending = session.pending.slice(match.index + match[0].length);
    const cwd = match[1].trim();
    if (cwd) {
      session.cwd = cwd;
      terminalSend(session, 'terminal:cwd', { id: session.id, cwd });
    }
    match = markerExp.exec(session.pending);
  }

  // 末尾可能是被拆开的一半标记，先留到下一段，避免重复显示。
  const marker = '__DSH_CWD__';
  let keep = 0;
  for (let size = Math.min(marker.length, session.pending.length); size > 0; size -= 1) {
    if (marker.startsWith(session.pending.slice(-size))) {
      keep = size;
      break;
    }
  }
  const flushable = keep > 0 ? session.pending.slice(0, -keep) : session.pending;
  if (flushable) terminalSend(session, 'terminal:data', { id: session.id, data: flushable });
  session.pending = keep > 0 ? session.pending.slice(-keep) : '';
}

function terminalStart(event, payload) {
  const shell = resolveTerminalShell(payload && payload.shell);
  if (!shell) return { ok: false, error: '没有找到可用的终端 shell' };
  const id = typeof payload?.id === 'string' && payload.id ? payload.id : `term-${Date.now()}`;
  // 同一个盒子重启或设置切换时，先结束旧进程，避免留下孤儿 shell。
  const previous = terminalSessions.get(id);
  if (previous) {
    previous.replaced = true;
    terminalSessions.delete(id);
    try {
      previous.child.kill();
    } catch {
      // 进程可能已经退出。
    }
  }
  const requestedCwd = typeof (payload && payload.cwd) === 'string' ? payload.cwd : '';
  let cwd = process.cwd();
  try {
    if (requestedCwd && fs.statSync(requestedCwd).isDirectory()) cwd = requestedCwd;
  } catch {
    // 设置的目录不存在时退回程序工作目录。
  }

  const env = { ...process.env };
  let args = [];
  if (shell.kind === 'posix') {
    if (shell.id === 'zsh') args = ['-f'];
    else if (shell.id === 'sh') args = [];
    else args = ['--noprofile', '--norc'];
    env.TERM = 'xterm-256color';
  } else if (shell.kind === 'powershell') {
    args = ['-NoLogo', '-NoProfile', '-NoExit', '-Command', '-'];
  } else {
    args = ['/Q'];
    env.PROMPT = '';
  }

  let child;
  try {
    child = spawn(shell.path, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    return { ok: false, error: error.message || '终端启动失败' };
  }

  const session = {
    id,
    child,
    kind: shell.kind,
    shellId: shell.id,
    shellLabel: shell.label,
    shellPath: shell.path,
    cwd,
    sender: event.sender,
    pending: '',
  };
  terminalSessions.set(id, session);

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => terminalFlush(session, chunk));
  child.stderr.on('data', (chunk) => terminalFlush(session, chunk));
  child.on('error', (error) => {
    terminalSend(session, 'terminal:data', {
      id,
      data: `\n[终端错误] ${error.message || '进程异常'}\n`,
    });
  });
  child.on('exit', (code, signal) => {
    const current = terminalSessions.get(id);
    if (current === session) terminalSessions.delete(id);
    // 主动替换或卸载导致的退出不再通知界面，避免出现假的“进程已退出”。
    if (session.replaced || current !== session) return;
    terminalSend(session, 'terminal:exit', { id, code, signal });
  });
  child.stdin.on('error', () => {});

  if (shell.kind === 'cmd') {
    // 统一 UTF-8，避免中文输出乱码。
    child.stdin.write('chcp 65001>nul\r\n');
  }

  return {
    ok: true,
    id,
    shellId: shell.id,
    shellLabel: shell.label,
    shellPath: shell.path,
    cwd,
  };
}

function terminalExec(event, payload) {
  const session = terminalSessions.get(payload && payload.id);
  if (!session || session.sender.id !== event.sender.id) {
    return { ok: false, error: '终端会话已结束' };
  }
  const command = typeof payload.command === 'string' ? payload.command.trim() : '';
  if (!command) return { ok: false };
  if (command.length > 8000) return { ok: false, error: '命令过长' };
  try {
    session.child.stdin.write(`${command}\n${terminalMarker(session.kind)}\n`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || '写入终端失败' };
  }
}

function terminalKill(_event, payload) {
  const session = terminalSessions.get(payload && payload.id);
  if (!session) return { ok: true };
  session.replaced = true;
  terminalSessions.delete(session.id);
  try {
    session.child.kill();
  } catch {
    // 进程可能已经退出。
  }
  return { ok: true };
}

function killAllTerminals() {
  for (const session of terminalSessions.values()) {
    try {
      session.child.kill();
    } catch {
      // 忽略已退出的进程。
    }
  }
  terminalSessions.clear();
}

// 独立的 userData 目录，避免和其他 Electron 应用共用存档。

const argv = process.argv.slice(1);
const getArg = (name) => {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
/** 截图模式需要和正在运行的客户端并存，因此不参与单实例锁。 */
const captureMode = Boolean(getArg('capture'));

let mainWindow = null;
let screenshotTarget = null;
let tray = null;
let isQuitting = false;
// 关闭按钮行为：true = 收进托盘，false = 直接退出。渲染层启动后会同步存档里的设置。
let closeToTray = true;

// DSH 引擎由工作台托管：启动时拉起 dsh web，退出时收掉；状态实时推给渲染层。
// 引擎目录在存档读取后确定，所以管理器在 app ready 时创建。
let engineManager = null;
let openfilmManager = null;

function createManagedEngine(paths) {
  const resolved = paths || defaultPaths();
  return createEngineManager({
    engineDir: resolved.engineDir,
    dataHome: resolved.dataPath,
    onUpdate: (snapshot) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('engine:status', snapshot);
      }
    },
  });
}

const idleEngineStatus = () => ({
  status: 'idle',
  url: '',
  error: '引擎尚未初始化',
  log: '',
  port: '3083',
  engineDir: '',
  dataHome: '',
  startedAt: 0,
});

const idleOpenfilmStatus = () => ({
  status: 'idle',
  error: '',
  attached: false,
  origin: '',
  editorUrl: '',
  project: null,
});

// webview 只跑官方引擎页面：去掉宿主 preload，禁止 Node 集成。
// 网页盒子里的 target=_blank / window.open 留在工作台开新标签，引擎页的外部链接交给系统浏览器。
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (_attachEvent, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
  });
  if (contents.getType() === 'webview') {
    const isWebBox = contents.session === session.fromPartition('persist:workbench-web');
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        const host = contents.hostWebContents;
        if (isWebBox && host && !host.isDestroyed()) {
          host.send('webview:new-tab', { id: contents.id, url });
        } else {
          void shell.openExternal(url);
        }
      }
      return { action: 'deny' };
    });
    // 只接管工作台网页盒子的缩放；引擎页保留自己的 Ctrl + 滚轮行为。
    if (isWebBox) {
      contents.on('zoom-changed', (event, direction) => {
        event.preventDefault();
        const host = contents.hostWebContents;
        if (!host || host.isDestroyed()) return;
        host.send('webview:zoom', {
          id: contents.id,
          direction: direction === 'out' ? 'out' : 'in',
        });
      });
    }
    // 战术大屏全屏时焦点在页面里，Esc 到不了工作台：转给宿主决定是否退出全屏。
    if (contents.session === session.fromPartition('persist:workbench-display')) {
      // 三维主题按作者写法从 jsdelivr 取 three.js；国内直连经常整段断开，
      // 只给大屏这个会话把同版本文件换到 npm 镜像，页面本身不改。
      contents.session.webRequest.onBeforeRequest(
        { urls: ['https://cdn.jsdelivr.net/npm/three@0.147.0/*'] },
        (details, callback) => {
          callback({
            redirectURL: details.url.replace(
              'https://cdn.jsdelivr.net/npm/three@0.147.0/',
              'https://registry.npmmirror.com/three/0.147.0/files/',
            ),
          });
        },
      );
      contents.on('before-input-event', (_inputEvent, input) => {
        if (input.type !== 'keyDown' || input.key !== 'Escape') return;
        const host = contents.hostWebContents;
        if (!host || host.isDestroyed()) return;
        host.send('webview:escape', { id: contents.id });
      });
    }
  }
});

let lastCpuSample = os.cpus().map((cpu) => cpu.times);

function resolveInside(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, target || '.');
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolvedTarget;
}

// 引擎数据目录里的凭据文件永远不进入工作区读写通道。
function isProtectedPath(target) {
  const normalized = path.resolve(String(target || '')).toLowerCase();
  const segments = normalized.split(/[\\/]+/).filter(Boolean);
  return segments.includes('.dsh') || /(^|[\\/])\.credentials(\.ya?ml)?$/.test(normalized);
}

function readText(file, limit = 4000) {
  let fd = null;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return '';
    fd = fs.openSync(file, 'r');
    const size = Math.min(stat.size, limit);
    const buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, 0);
    return buffer.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const COST_LEDGER_SEGMENTS = ['storages', 'cost-meter', 'ledger.json'];
let costCache = { file: '', mtimeMs: 0, size: 0, snapshot: null };

function toNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// 计费账本是唯一允许读取的引擎数据文件：只读余额、当日消耗和峰谷配置，绝不碰凭据。
function readCostSnapshot(rootInput) {
  const root = path.resolve(String(rootInput || defaultPaths().dataPath));
  const ledgerFile = path.join(root, ...COST_LEDGER_SEGMENTS);
  const base = {
    ok: false,
    readAt: Date.now(),
    symbol: '¥',
    decimals: 2,
    currency: 'CNY',
    exchangeRate: 0,
    balance: null,
    today: null,
    peak: null,
  };

  let stat = null;
  try {
    stat = fs.statSync(ledgerFile);
  } catch {
    return { ...base, error: '未找到计费账本' };
  }
  if (!stat.isFile() || stat.size > 32 * 1024 * 1024) {
    return { ...base, error: '计费账本不可读' };
  }
  if (
    costCache.snapshot &&
    costCache.file === ledgerFile &&
    costCache.mtimeMs === stat.mtimeMs &&
    costCache.size === stat.size
  ) {
    return { ...costCache.snapshot, readAt: Date.now() };
  }

  const ledger = readJson(ledgerFile);
  if (!ledger || typeof ledger !== 'object') {
    return { ...base, error: '计费账本解析失败' };
  }

  const config = ledger.config && typeof ledger.config === 'object' ? ledger.config : {};
  const currency = typeof config.currency === 'string' ? config.currency : 'CNY';
  const symbol = typeof config.symbol === 'string' ? config.symbol : currency === 'CNY' ? '¥' : '$';
  const decimals = Math.max(0, Math.min(4, Math.round(toNumber(config.decimals, 2))));

  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const day = ledger.days && typeof ledger.days === 'object' ? ledger.days[todayKey] : null;
  const today = {
    date: todayKey,
    cost: day ? toNumber(day.cost) : 0,
    costCny: day ? toNumber(day.costCny) : 0,
    calls: day ? Math.round(toNumber(day.calls)) : 0,
  };

  const ref = ledger.balanceRef && typeof ledger.balanceRef === 'object' ? ledger.balanceRef : null;
  const exchangeRate = toNumber(config.exchangeRate, 0);
  // balanceRef 是官方余额的对账基准点：total 是打基准时的官方余额，
  // ledgerCost 是打基准当天的账本费用（USD）。当前余额 = 基准 - (今日费用 - 基准时今日费用)。
  const factor = currency.toUpperCase() === 'CNY' && exchangeRate > 0 ? exchangeRate : 1;
  const refCost =
    ref && typeof ref.ledgerCost === 'number' && Number.isFinite(ref.ledgerCost)
      ? ref.ledgerCost * factor
      : null;
  const todayCost = currency.toUpperCase() === 'CNY' ? today.costCny : today.cost;
  let balanceTotal = ref && typeof ref.total === 'number' ? ref.total : null;
  if (balanceTotal !== null && refCost !== null && ref.date === todayKey) {
    balanceTotal = Math.max(0, balanceTotal - (todayCost - refCost));
  }
  const balance = ref
    ? {
        total: balanceTotal === null ? null : Math.round(balanceTotal * 10000) / 10000,
        granted: typeof ref.granted === 'number' ? ref.granted : null,
        topped: typeof ref.topped === 'number' ? ref.topped : null,
        currency: typeof ref.currency === 'string' ? ref.currency : currency,
        date: typeof ref.date === 'string' ? ref.date : '',
        updatedAt: toNumber(ref.at, 0),
      }
    : null;

  const peak =
    config.peakEnabled === true
      ? {
          enabled: true,
          effectiveAt: typeof config.peakEffectiveAt === 'string' ? config.peakEffectiveAt : '',
          windows: Array.isArray(config.peakWindows)
            ? config.peakWindows
                .filter((item) => item && Number.isFinite(item.start) && Number.isFinite(item.end))
                .map((item) => ({ start: Number(item.start), end: Number(item.end) }))
            : [],
          holidays: Array.isArray(config.peakHolidays)
            ? config.peakHolidays.filter((item) => typeof item === 'string')
            : [],
        }
      : null;

  const snapshot = {
    ok: true,
    readAt: Date.now(),
    symbol,
    decimals,
    currency,
    exchangeRate,
    balance,
    today,
    peak,
  };

  costCache = { file: ledgerFile, mtimeMs: stat.mtimeMs, size: stat.size, snapshot };
  return snapshot;
}

function walkFiles(root, maxDepth = 2, limit = 60) {
  const out = [];
  const walk = (dir, depth) => {
    if (out.length >= limit || depth > maxDepth) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root, 0);
  return out;
}

function tailJsonl(file, limit = 80) {
  let fd = null;
  try {
    const stat = fs.statSync(file);
    const readSize = Math.min(stat.size, 512 * 1024);
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, stat.size - readSize);
    const lines = buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
    return lines
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/** 注册表里的 id 只当目录名用，禁止借它跳出白名单目录。 */
function safeSegment(value, fallback) {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9._-]+$/.test(text) ? text : fallback;
}

function scanEngine(rootInput) {
  const root = path.resolve(String(rootInput || defaultPaths().dataPath));
  const registry = readJson(path.join(root, '_meta', 'registry.json'));
  if (!registry || !Array.isArray(registry.scenes)) {
    return {
      ok: false,
      root,
      scannedAt: new Date().toISOString(),
      scenes: [],
      skills: { index: '', dirs: [] },
      events: [],
      dispatches: [],
      errors: ['未找到 _meta/registry.json，或格式不正确'],
    };
  }

  const scenes = registry.scenes.map((scene) => {
    const sceneId = safeSegment(scene.id, 'scene');
    const rawAgent = String(scene.memoryRoot || `agents/${sceneId}`)
      .split(/[\\/]/)
      .filter(Boolean)
      .pop();
    const agentId = safeSegment(rawAgent, sceneId);
    const agentDir = path.join(root, 'agents', agentId);
    const card = readJson(path.join(agentDir, 'card.json'), {});
    // 总结只读 agents/<id>/summary.md，注册表里的其它路径一律不跟。
    const summaryRelative = String(scene.summary || `agents/${agentId}/summary.md`).replace(
      /\\/g,
      '/',
    );
    const summaryTarget = /^agents\/[A-Za-z0-9._-]+\/summary\.md$/.test(summaryRelative)
      ? resolveInside(root, summaryRelative)
      : null;
    const summaryText = summaryTarget ? readText(summaryTarget, 3000) : '';
    const memoryFiles = walkFiles(path.join(agentDir, 'memory'), 3, 40);
    const skillDir = safeSegment(scene.skill, sceneId);
    const skillFiles = walkFiles(path.join(root, 'skills', skillDir), 2, 24);
    const sessions = Array.isArray(scene.sessions)
      ? scene.sessions
          .map((entry) => ({
            panelId: String(entry && entry.panelId ? entry.panelId : ''),
            sessionId: String(entry && entry.sessionId ? entry.sessionId : ''),
            title: String(entry && entry.title ? entry.title : '').trim(),
          }))
          .filter((entry) => entry.sessionId)
      : [];
    const primary = sessions[0] || null;

    return {
      id: String(scene.id || sceneId),
      name: String(scene.name || sceneId),
      group: card.group || '',
      status: card.status || 'seeded',
      mission: card.mission || '',
      responsibilities: Array.isArray(card.responsibilities) ? card.responsibilities.slice(0, 4) : [],
      summaryText: summaryText.replace(/\s+/g, ' ').slice(0, 280),
      panels: Array.isArray(scene.panels) ? scene.panels : [],
      sessions,
      primarySessionId: primary ? primary.sessionId : '',
      primarySessionTitle: primary ? primary.title : '',
      primaryPanelId: primary ? primary.panelId : '',
      skill: scene.skill || '',
      memoryRoot: scene.memoryRoot || '',
      memoryFiles,
      memoryCount: memoryFiles.length,
      skillFiles,
      skillCount: skillFiles.length,
    };
  });

  let skillDirs = [];
  try {
    skillDirs = fs
      .readdirSync(path.join(root, 'skills'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
      .map((entry) => entry.name);
  } catch {
    skillDirs = [];
  }

  return {
    ok: true,
    root,
    scannedAt: new Date().toISOString(),
    scenes,
    skills: {
      index: readText(path.join(root, 'skills', '_index.md'), 4000),
      dirs: skillDirs,
    },
    events: tailJsonl(path.join(root, 'events', 'events.jsonl'), 80),
    dispatches: tailJsonl(path.join(root, 'events', 'dispatch.jsonl'), 60),
    errors: [],
  };
}

// 会话详情只允许读写这几类引擎文档：角色卡、技能、只读总结与场景记忆。
// 任何其他引擎文件（尤其是凭据）都不经过这条通道。
const ENGINE_DOC_READ = [
  /^agents\/[A-Za-z0-9._-]+\/card\.json$/,
  /^agents\/[A-Za-z0-9._-]+\/summary\.md$/,
  /^agents\/[A-Za-z0-9._-]+\/memory\/[^/].*\.(?:md|markdown|txt)$/i,
  /^skills\/[A-Za-z0-9._-]+\/SKILL\.md$/,
];
const ENGINE_DOC_WRITE = [
  /^agents\/[A-Za-z0-9._-]+\/card\.json$/,
  /^skills\/[A-Za-z0-9._-]+\/SKILL\.md$/,
];

// 神经元「打开目录 / 打开文件」的白名单前缀：只允许落到 agents/<id> 或 skills/<id>
// 区域内，其余引擎数据（事件、账本、凭据等）一律不进系统资源管理器。
const ENGINE_OPEN_PREFIX = [/^agents\/[A-Za-z0-9._-]+\//, /^skills\/[A-Za-z0-9._-]+\//];

function normalizeDocRelative(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

function engineDocTarget(rootInput, relativeInput) {
  const root = path.resolve(String(rootInput || defaultPaths().dataPath));
  const relative = normalizeDocRelative(relativeInput);
  if (!relative || relative.startsWith('/') || relative.split('/').includes('..')) return null;
  if (!ENGINE_DOC_READ.some((pattern) => pattern.test(relative))) return null;
  const target = resolveInside(root, relative);
  return target ? { root, relative, target } : null;
}

/** 打开目录/文件用的白名单校验：只放行 agents/<id>、skills/<id> 内部路径。 */
function engineOpenTarget(rootInput, relativeInput) {
  const root = path.resolve(String(rootInput || defaultPaths().dataPath));
  const relative = normalizeDocRelative(relativeInput);
  if (!relative || relative.startsWith('/') || relative.split('/').includes('..')) return null;
  if (!ENGINE_OPEN_PREFIX.some((pattern) => pattern.test(`${relative}/`))) return null;
  const target = resolveInside(root, relative);
  return target ? { root, relative, target } : null;
}

function readEngineDoc(rootInput, relativeInput) {
  const found = engineDocTarget(rootInput, relativeInput);
  if (!found) return { ok: false, error: '该引擎文件不在只读白名单内' };
  try {
    const stat = fs.statSync(found.target);
    if (!stat.isFile()) return { ok: false, error: '不是文件' };
    if (stat.size > 512 * 1024) return { ok: false, error: '文件超过 512KB，暂不预览' };
    return {
      ok: true,
      relative: found.relative,
      size: stat.size,
      modified: stat.mtimeMs,
      text: fs.readFileSync(found.target, 'utf8'),
    };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

// 派单详情只读 collab/<日期>/<单号>-<角色>[.状态].md，文件名来自目录列表，不接受外部拼接。
const ORDER_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ORDER_ID = /^[A-Za-z0-9._-]+$/;

/** 按日期目录 + 单号找这一单的派单文件，只返回 collab 下已存在的 .md。 */
function readEngineOrder(rootInput, dayInput, orderInput, agentInput) {
  const root = path.resolve(String(rootInput || defaultPaths().dataPath));
  const day = String(dayInput || '').trim();
  const order = String(orderInput || '').trim();
  const agent = safeSegment(agentInput, '');
  if (!ORDER_DAY.test(day)) return { ok: false, error: '日期格式不正确' };
  if (!ORDER_ID.test(order)) return { ok: false, error: '单号格式不正确' };
  const dir = resolveInside(root, `collab/${day}`);
  if (!dir) return { ok: false, error: '派单目录超出引擎目录' };
  let names = [];
  try {
    names = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.md') && name.startsWith(`${order}-`))
      .filter((name) => ORDER_ID.test(name.slice(0, -3)));
  } catch {
    return { ok: false, error: '这一天的派单目录不存在' };
  }
  const preferred = agent
    ? names.find((name) => name === `${order}-${agent}.md` || name.startsWith(`${order}-${agent}.`))
    : '';
  const name = preferred || names[0] || '';
  if (!name) return { ok: false, error: '没有找到这一单的文件' };
  const relative = `collab/${day}/${name}`;
  const target = resolveInside(root, relative);
  if (!target) return { ok: false, error: '派单文件超出引擎目录' };
  try {
    const stat = fs.statSync(target);
    if (!stat.isFile()) return { ok: false, error: '不是文件' };
    if (stat.size > 512 * 1024) return { ok: false, error: '文件超过 512KB，暂不预览' };
    return {
      ok: true,
      relative,
      size: stat.size,
      modified: stat.mtimeMs,
      text: fs.readFileSync(target, 'utf8'),
    };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

/**
 * 派单模块首选数据源：插件按 day 隔离的派单接口。
 * 只访问本机引擎端口上的这一个只读路径，不扩大引擎读取范围。
 */
const DISPATCH_FEED_PATH = '/plugins/workbench-core/dispatch-feed';
const DISPATCH_FEED_LIMIT = 4 * 1024 * 1024;
const NOTIFY_FEED_PATH = '/plugins/workbench-core/notify-feed';
const NOTIFY_FEED_LIMIT = 2 * 1024 * 1024;

function fetchDispatchFeed(dayInput) {
  const day = String(dayInput || '').trim();
  if (!ORDER_DAY.test(day)) {
    return Promise.resolve({ ok: false, day, readAt: Date.now(), orders: [], error: '日期格式不正确' });
  }
  const port = Number(engineManager ? engineManager.port : 3083) || 3083;
  const url = `http://127.0.0.1:${port}${DISPATCH_FEED_PATH}?day=${encodeURIComponent(day)}`;
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const req = http.get(url, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        done({
          ok: false,
          day,
          readAt: Date.now(),
          orders: [],
          error: `派单接口返回 ${res.statusCode ?? '未知状态'}`,
        });
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > DISPATCH_FEED_LIMIT) req.destroy();
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const thresholds = parsed?.thresholds;
          done({
            ok: true,
            day: typeof parsed?.day === 'string' ? parsed.day : day,
            readAt: Date.now(),
            orders: Array.isArray(parsed?.orders) ? parsed.orders : [],
            thresholds:
              thresholds && typeof thresholds === 'object' && !Array.isArray(thresholds)
                ? thresholds
                : null,
          });
        } catch {
          done({ ok: false, day, readAt: Date.now(), orders: [], error: '派单数据解析失败' });
        }
      });
      res.on('error', (error) => {
        done({
          ok: false,
          day,
          readAt: Date.now(),
          orders: [],
          error: String(error.message || error),
        });
      });
    });
    req.on('error', (error) =>
      done({
        ok: false,
        day,
        readAt: Date.now(),
        orders: [],
        error: String(error.message || error),
      }),
    );
    req.on('timeout', () => {
      req.destroy();
      done({ ok: false, day, readAt: Date.now(), orders: [], error: '派单接口超时' });
    });
  });
}

/** 只读通知接口：GET /plugins/workbench-core/notify-feed?day=YYYY-MM-DD（限本机引擎端口）。 */
function fetchNotifyFeed(dayInput) {
  const day = String(dayInput || '').trim();
  if (!ORDER_DAY.test(day)) {
    return Promise.resolve({ ok: false, day, readAt: Date.now(), items: [], unread: 0, error: '日期格式不正确' });
  }
  const port = Number(engineManager ? engineManager.port : 3083) || 3083;
  const url = `http://127.0.0.1:${port}${NOTIFY_FEED_PATH}?day=${encodeURIComponent(day)}`;
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const req = http.get(url, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        done({ ok: false, day, readAt: Date.now(), items: [], unread: 0, error: `通知接口返回 ${res.statusCode ?? '未知状态'}` });
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > NOTIFY_FEED_LIMIT) req.destroy();
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          done({
            ok: true,
            day: typeof parsed?.day === 'string' ? parsed.day : day,
            readAt: Date.now(),
            items: Array.isArray(parsed?.items) ? parsed.items : [],
            unread: Number(parsed?.unread) || 0,
          });
        } catch {
          done({ ok: false, day, readAt: Date.now(), items: [], unread: 0, error: '通知数据解析失败' });
        }
      });
      res.on('error', (error) => done({ ok: false, day, readAt: Date.now(), items: [], unread: 0, error: String(error.message || error) }));
    });
    req.on('error', (error) => done({ ok: false, day, readAt: Date.now(), items: [], unread: 0, error: String(error.message || error) }));
    req.on('timeout', () => {
      req.destroy();
      done({ ok: false, day, readAt: Date.now(), items: [], unread: 0, error: '通知接口超时' });
    });
  });
}

/** 技能预览只读技能目录下 <id>/SKILL.md，自定义技能目录同样适用。 */
function readSkillDoc(rootInput, idInput) {
  const root = path.resolve(String(rootInput || defaultPaths().skillsPath));
  const id = safeSegment(idInput, '');
  if (!id) return { ok: false, error: '技能标识不合法' };
  const target = resolveInside(root, `${id}/SKILL.md`);
  if (!target) return { ok: false, error: '技能文件超出技能目录' };
  try {
    const stat = fs.statSync(target);
    if (!stat.isFile()) return { ok: false, error: '不是文件' };
    if (stat.size > 512 * 1024) return { ok: false, error: '文件超过 512KB，暂不预览' };
    return {
      ok: true,
      relative: `${id}/SKILL.md`,
      size: stat.size,
      modified: stat.mtimeMs,
      text: fs.readFileSync(target, 'utf8'),
    };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

function writeEngineDoc(rootInput, relativeInput, text) {
  const found = engineDocTarget(rootInput, relativeInput);
  if (!found) return { ok: false, error: '该引擎文件不在写入白名单内' };
  if (!ENGINE_DOC_WRITE.some((pattern) => pattern.test(found.relative))) {
    return { ok: false, error: '该引擎文件为只读' };
  }
  if (typeof text !== 'string') return { ok: false, error: '内容格式不正确' };
  const limit = found.relative.endsWith('card.json') ? 128 * 1024 : 32 * 1024;
  if (Buffer.byteLength(text, 'utf8') > limit) {
    return { ok: false, error: '内容超过大小限制' };
  }
  let payload = text;
  if (found.relative.endsWith('card.json')) {
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: '角色卡必须是 JSON 对象' };
      }
      payload = `${JSON.stringify(parsed, null, 2)}\n`;
    } catch {
      return { ok: false, error: '角色卡不是合法 JSON' };
    }
  }
  try {
    const stat = fs.statSync(found.target);
    if (!stat.isFile()) return { ok: false, error: '只能保存已存在的文本文件' };
    fs.writeFileSync(found.target, payload, 'utf8');
    return { ok: true, relative: found.relative, size: Buffer.byteLength(payload, 'utf8') };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

function parseSkillHeader(text) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const meta = {};
  if (frontmatter) {
    for (const line of frontmatter[1].split(/\r?\n/)) {
      const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
      if (match) meta[match[1].toLowerCase()] = match[2].replace(/^["']|["']$/g, '').trim();
    }
  }
  return {
    name: meta.name || '',
    description: meta.description || '',
  };
}

function scanSkills(rootInput) {
  const root = path.resolve(String(rootInput || defaultPaths().skillsPath));
  try {
    const entries = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
      .map((entry) => {
        const file = path.join(root, entry.name, 'SKILL.md');
        let text = '';
        let size = 0;
        let modified = 0;
        try {
          const stat = fs.statSync(file);
          size = stat.size;
          modified = stat.mtimeMs;
          text = readText(file, 32 * 1024);
        } catch {
          return null;
        }
        const header = parseSkillHeader(text);
        return {
          id: entry.name,
          name: header.name || entry.name,
          description: header.description || '',
          size,
          modified,
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.id.localeCompare(right.id, 'en'));
    return { ok: true, root, entries, error: '' };
  } catch (error) {
    return { ok: false, root, entries: [], error: String(error.message || error) };
  }
}

const TOOL_SCRIPT_EXTS = new Set(['.mjs', '.js', '.cjs', '.ts', '.mts', '.py', '.ps1', '.sh', '.bat', '.cmd']);

/** README 的「### 文件名 —— 说明」当作工具简介；同一文件只取第一条。 */
function parseToolDocs(text) {
  const docs = new Map();
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (!heading) continue;
    const title = heading[1].replace(/`/g, '').trim();
    const parts = title.split(/\s+[—–-]{1,2}\s+/);
    const file = parts[0].trim();
    if (!file || docs.has(file.toLowerCase())) continue;
    docs.set(file.toLowerCase(), {
      name: file,
      summary: parts.slice(1).join(' ').trim(),
      order: docs.size,
    });
  }
  return docs;
}

/** 没有 README 说明时，取脚本头部第一行有效注释。 */
function toolHeadSummary(text) {
  for (const line of text.split(/\r?\n/).slice(0, 40)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#!')) continue;
    const comment = trimmed.match(/^(?:\/\/|#|\/\*|\*)\s*(.*)$/);
    if (!comment) continue;
    const body = comment[1]
      .replace(/\*\/\s*$/, '')
      .replace(/^[-=*]+\s*/, '')
      .trim();
    if (body) return body;
  }
  return '';
}

/**
 * 工具目录只读扫描：列出脚本文件，摘要优先取 README 对应段落，
 * 其次取脚本头部注释；不执行脚本，也不读取目录外文件。
 */
function scanTools(rootInput) {
  const root = path.resolve(String(rootInput || defaultPaths().toolsPath));
  if (isProtectedPath(root)) {
    return { ok: false, root, missing: false, entries: [], error: '受保护的引擎目录不可扫描' };
  }
  if (!statOf(root).dir) {
    return { ok: true, root, missing: true, entries: [], error: '' };
  }
  const docs = parseToolDocs(readText(path.join(root, 'README.md'), 64 * 1024));
  let files = [];
  try {
    files = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile());
  } catch (error) {
    return { ok: false, root, missing: false, entries: [], error: String(error.message || error) };
  }

  const entries = files
    .filter((entry) => TOOL_SCRIPT_EXTS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => {
      const file = path.join(root, entry.name);
      let size = 0;
      let modified = 0;
      let summary = '';
      try {
        const stat = fs.statSync(file);
        size = stat.size;
        modified = stat.mtimeMs;
        const doc = docs.get(entry.name.toLowerCase());
        summary = doc?.summary || toolHeadSummary(readText(file, 8 * 1024));
      } catch {
        return null;
      }
      const doc = docs.get(entry.name.toLowerCase());
      return {
        id: entry.name,
        name: doc?.name || entry.name,
        summary,
        ext: path.extname(entry.name).slice(1).toLowerCase(),
        size,
        modified,
        order: doc?.order ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .filter(Boolean)
    .sort((left, right) =>
      left.order !== right.order ? left.order - right.order : left.id.localeCompare(right.id, 'en'),
    )
    .map(({ order: _order, ...entry }) => entry);

  return { ok: true, root, missing: false, entries, error: '' };
}

function statOf(target) {
  try {
    const stat = fs.statSync(target);
    return { exists: true, dir: stat.isDirectory(), file: stat.isFile(), size: stat.size };
  } catch {
    return { exists: false, dir: false, file: false, size: 0 };
  }
}

function countEntries(target) {
  try {
    return fs.readdirSync(target, { withFileTypes: true }).length;
  } catch {
    return -1;
  }
}

/**
 * 体检只看白名单内的文件是否存在、目录里有多少条目，以及已有的只读扫描结果，
 * 不读取凭据，也不打开插件源码。
 */
function runHealthCheck(engineSettings) {
  const paths = resolveEnginePaths(engineSettings);
  const checks = [];
  const add = (group, label, status, detail, hint) =>
    checks.push({ id: `${group}:${label}`, group, label, status, detail, hint: hint || '' });

  const proc = engineManager ? engineManager.status() : idleEngineStatus();

  add(
    '环境',
    '桌面运行时',
    'ok',
    `Electron ${process.versions.electron} · Node ${process.versions.node} · ${process.platform}`,
  );

  add(
    '路径',
    '引擎安装目录',
    paths.engineDir && statOf(path.join(paths.engineDir, 'apps', 'cli', 'lib', 'bin.js')).file
      ? 'ok'
      : 'fail',
    paths.engineDir
      ? paths.engineDir
      : '未配置',
    '在「引擎」页签选择包含 apps/cli 的 DSH 引擎目录。',
  );

  add(
    '路径',
    '引擎数据目录',
    statOf(path.join(paths.dataPath, '_meta', 'registry.json')).file ? 'ok' : 'fail',
    paths.dataPath || '未配置',
    '在「引擎」页签选择 .dsh 数据目录，工作台只读扫描它。',
  );

  add(
    '路径',
    '文件浏览根目录',
    paths.filesRoot && statOf(paths.filesRoot).dir ? 'ok' : 'fail',
    paths.filesRoot || '未配置',
    '文件工作台以该目录为边界，可以继续返回上级。',
  );

  const toolsCount = countEntries(paths.toolsPath);
  add(
    '工具',
    '工具目录',
    toolsCount > 0 ? 'ok' : toolsCount === 0 ? 'warn' : 'fail',
    toolsCount >= 0 ? `${paths.toolsPath} · ${toolsCount} 个条目` : '目录不存在',
    toolsCount === 0 ? '目录为空不影响运行，但文件工作台会从根目录打开。' : '检查设置里的工具目录。',
  );

  const skills = scanSkills(paths.skillsPath);
  add(
    '工具',
    '技能目录',
    skills.ok && skills.entries.length > 0 ? 'ok' : skills.ok ? 'warn' : 'fail',
    skills.ok ? `${paths.skillsPath} · ${skills.entries.length} 个 SKILL.md` : skills.error,
    skills.entries.length === 0 ? '放入带 SKILL.md 的技能目录后重新体检。' : '检查技能目录权限。',
  );

  add(
    '引擎',
    'DSH 引擎进程',
    proc.status === 'ready' ? 'ok' : proc.status === 'starting' ? 'warn' : 'fail',
    proc.status === 'ready'
      ? `已就绪 · 端口 ${proc.port}`
      : proc.status === 'starting'
        ? '正在拉起，稍后再体检'
        : proc.error || '引擎未运行',
    '在「引擎」页签检查目录后，点击重新启动引擎。',
  );

  const engine = scanEngine(paths.dataPath);
  add(
    '引擎',
    '场景索引',
    engine.ok && engine.scenes.length > 0 ? 'ok' : engine.ok ? 'warn' : 'fail',
    engine.ok ? `${engine.scenes.length} 个场景` : engine.errors[0] || '无法读取 registry',
    '确认数据目录里存在 _meta/registry.json。',
  );

  const boundScenes = engine.scenes.filter((scene) => scene.primarySessionId).length;
  add(
    '核心插件',
    '会话绑定',
    boundScenes > 0 ? 'ok' : 'warn',
    `${boundScenes} / ${engine.scenes.length} 个场景关联了 Harness 会话`,
    '在 DSH 里把场景绑定到会话后，工作台才能自动跳转。',
  );

  const pluginManifest = statOf(path.join(paths.dataPath, '_meta', 'plugin-manifest.json'));
  add(
    '核心插件',
    '插件清单',
    pluginManifest.file ? 'ok' : 'warn',
    pluginManifest.file ? '已找到 _meta/plugin-manifest.json' : '未找到插件清单',
    '确认 DSH 核心协作插件已安装并初始化。',
  );

  const collabCount = countEntries(path.join(paths.dataPath, 'collab'));
  add(
    '核心插件',
    '协作通道',
    collabCount > 0 ? 'ok' : collabCount === 0 ? 'warn' : 'warn',
    collabCount >= 0 ? `${collabCount} 个协作条目` : '还没有 collab 目录',
    '协作通道在首次派发任务后生成；若长期为空，检查 dsh-collab 插件。',
  );

  const eventsStat = statOf(path.join(paths.dataPath, 'events', 'events.jsonl'));
  const dispatchStat = statOf(path.join(paths.dataPath, 'events', 'dispatch.jsonl'));
  add(
    '核心插件',
    '事件与派发日志',
    eventsStat.file && dispatchStat.file ? 'ok' : 'warn',
    `events ${eventsStat.file ? '✓' : '×'} · dispatch ${dispatchStat.file ? '✓' : '×'}`,
    '缺少日志时，引擎侧的任务与活动不会出现在工作台。',
  );

  const skillIndex = statOf(path.join(paths.dataPath, 'skills', '_index.md'));
  add(
    '核心插件',
    '技能索引',
    skillIndex.file ? 'ok' : 'warn',
    skillIndex.file ? '已找到 skills/_index.md' : '未找到技能索引',
    '运行一次 DSH 技能扫描后索引会重新生成。',
  );

  const ledger = statOf(
    path.join(paths.dataPath, 'storages', 'cost-meter', 'ledger.json'),
  );
  add(
    '引擎',
    '计费账本',
    ledger.file ? 'ok' : 'warn',
    ledger.file ? '已找到 cost-meter 账本' : '未找到 cost-meter 账本',
    '没有账本只影响费用栏显示，不影响引擎运行。',
  );

  return {
    ok: !checks.some((check) => check.status === 'fail'),
    checkedAt: Date.now(),
    checks,
    paths,
    versions: {
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
      platform: process.platform,
      arch: process.arch,
    },
  };
}

let stateDir = null;

function canWriteDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-probe-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function pickStateDir() {
  const override = getArg('state-dir') || process.env.DSH_STATE_DIR;
  const candidates = [];
  if (override) candidates.push({ dir: path.resolve(override), isolated: true });
  candidates.push({ dir: path.join(app.getPath('appData'), 'DSH-Workbench'), isolated: true });
  // 某些受限环境（沙箱、只读配置目录）无法写入 AppData，退回项目内的 .data。
  candidates.push({ dir: path.join(__dirname, '..', '.data'), isolated: false });
  for (const candidate of candidates) {
    if (canWriteDir(candidate.dir)) return candidate;
    console.warn('[workbench] state dir unavailable', candidate.dir);
  }
  return { dir: app.getPath('userData'), isolated: false };
}

function stateFilePath() {
  return path.join(stateDir || app.getPath('userData'), 'workbench-state.json');
}

function writeState(payload) {
  const target = stateFilePath();
  const tmp = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, target);
  return { ok: true, path: target };
}

function readCpuPercent() {
  const now = os.cpus().map((cpu) => cpu.times);
  let idle = 0;
  let total = 0;

  now.forEach((times, index) => {
    const prev = lastCpuSample[index];
    if (!prev) return;
    idle += times.idle - prev.idle;
    total += Object.keys(times).reduce(
      (sum, key) => sum + (times[key] - prev[key]),
      0,
    );
  });

  lastCpuSample = now;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100)));
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 DSH 中枢', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: '关闭窗口时最小化到托盘',
        type: 'checkbox',
        checked: closeToTray,
        click: (item) => applyCloseToTray(item.checked, true),
      },
      { type: 'separator' },
      {
        label: '退出 DSH 中枢',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
}

/** 托盘勾选项与设置面板共用同一个开关；broadcast 用于把托盘侧改动推回渲染层。 */
function applyCloseToTray(value, broadcast) {
  const next = Boolean(value);
  if (next !== closeToTray) {
    console.log(`[tray] closeToTray -> ${next} (${broadcast ? 'tray' : 'renderer'})`);
  }
  closeToTray = next;
  if (tray) buildTrayMenu();
  if (broadcast && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:close-to-tray', closeToTray);
  }
  return closeToTray;
}

function createTray() {
  if (screenshotTarget) return;
  try {
    const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
    let image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) {
      image = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.ico'));
    }
    if (!image.isEmpty()) {
      const traySize = process.platform === 'linux' ? 22 : 16;
      image = image.resize({ width: traySize, height: traySize });
    }
    tray = new Tray(image);
    tray.setToolTip('DSH 中枢 · 集成工作台');
    tray.on('click', () => showMainWindow());
    buildTrayMenu();
    console.log('[tray] ready');
  } catch (error) {
    tray = null;
    console.warn('[tray] unavailable', error.message || error);
  }
}

function createWindow() {
  const devUrl = getArg('dev-url');
  screenshotTarget = getArg('capture');
  const captureScriptFile = getArg('capture-js-file');
  const captureScript = captureScriptFile
    ? fs.readFileSync(path.resolve(process.cwd(), captureScriptFile), 'utf8')
    : getArg('capture-js');
  const captureWait = Number(getArg('capture-wait')) || 1800;

  mainWindow = new BrowserWindow({
    width: Number(getArg('width')) || 1480,
    height: Number(getArg('height')) || 920,
    minWidth: 1120,
    minHeight: 700,
    show: !screenshotTarget,
    frame: false,
    backgroundColor: '#050810',
    title: 'DSH 中枢 · 集成工作台',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);

  // 壳页面不允许被导航到外部地址：preload 暴露了桌面能力，远程页面绝不能拿到它。
  const shellOrigin = devUrl ? new URL(devUrl).origin : '';
  const isShellUrl = (target) => {
    if (!devUrl) return String(target).startsWith('file://');
    try {
      return new URL(String(target)).origin === shellOrigin;
    } catch {
      return false;
    }
  };
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (isShellUrl(target)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('console-message', (event, level, message) => {
    // Electron 新版事件把字段挂在 event 上，旧签名仍把 level/message 当参数。
    const detail = typeof event?.message === 'string' ? event : null;
    const text = detail ? detail.message : message;
    const label = detail ? detail.level : level;
    const where = detail ? `${detail.sourceId ?? ''}:${detail.lineNumber ?? ''}` : '';
    console.log(`[renderer:${label}] ${text} ${where}`.trim());
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] process gone', details);
  });

  const sendMaximized = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized', mainWindow.isMaximized());
    }
  };
  mainWindow.on('maximize', sendMaximized);
  mainWindow.on('unmaximize', sendMaximized);

  // 关闭按钮按设置收进托盘；托盘不可用时直接退出，避免窗口藏起来无法找回。
  mainWindow.on('close', (event) => {
    if (isQuitting || !closeToTray) return;
    if (!tray) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  if (screenshotTarget) {
    // 截图窗口需要真正在前台绘制，否则被遮挡时会拿到冻结的旧帧。
    mainWindow.webContents.setBackgroundThrottling(false);
    mainWindow.show();
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.focus();
    mainWindow.moveTop();
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.moveTop();
          if (captureScript) {
            await mainWindow.webContents.executeJavaScript(captureScript);
            await new Promise((resolve) => setTimeout(resolve, 900));
          }
          mainWindow.webContents.invalidate();
          await new Promise((resolve) => setTimeout(resolve, 300));
          const image = await mainWindow.webContents.capturePage();
          const target = path.resolve(process.cwd(), screenshotTarget);
          fs.writeFileSync(target, image.toPNG());
          console.log(`[capture] saved ${target}`);
        } catch (error) {
          console.error('[capture] failed', error);
        } finally {
          app.quit();
        }
      }, captureWait);
    });
  }
}

// ── 战术大屏（外部项目）资源托管 ─────────────────────────────────────────
// 来源 cyberdaddyleo/agent-display，PolyForm Noncommercial 许可。
// 文件只落在用户数据目录，不并入仓库；LICENSE 与大屏页面一起保存。
const { patchAgentDisplay, PATCH_TAG } = require('./agent-display-patch.cjs');
const AGENT_DISPLAY_REPO = 'cyberdaddyleo/agent-display';
const AGENT_DISPLAY_MAX_BYTES = 8 * 1024 * 1024;
const AGENT_DISPLAY_SOURCES = [
  {
    url: `https://api.github.com/repos/${AGENT_DISPLAY_REPO}/contents/index.html`,
    headers: { Accept: 'application/vnd.github.raw', 'User-Agent': 'dsh-workbench' },
  },
  {
    url: `https://raw.githubusercontent.com/${AGENT_DISPLAY_REPO}/main/index.html`,
    headers: { 'User-Agent': 'dsh-workbench' },
  },
];
const AGENT_DISPLAY_LICENSE_SOURCE = {
  url: `https://api.github.com/repos/${AGENT_DISPLAY_REPO}/contents/LICENSE`,
  headers: { Accept: 'application/vnd.github.raw', 'User-Agent': 'dsh-workbench' },
};

function agentDisplayDir() {
  return path.join(app.getPath('userData'), 'assets', 'agent-display');
}

function agentDisplayFile() {
  return path.join(agentDisplayDir(), 'index.html');
}

function agentDisplayStatus(error) {
  const file = agentDisplayFile();
  try {
    const stat = fs.statSync(file);
    return {
      ok: true,
      path: file,
      url: pathToFileURL(file).href,
      size: stat.size,
      updatedAt: stat.mtimeMs,
    };
  } catch {
    return { ok: false, path: file, error: error || '本地还没有安装战术大屏' };
  }
}

function downloadText(url, headers, limit, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout: 30000 }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location && redirects < 3) {
        res.resume();
        resolve(
          downloadText(new URL(res.headers.location, url).href, headers, limit, redirects + 1),
        );
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > limit) {
          req.destroy(new Error('资源超过大小上限'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('下载超时')));
    req.on('error', reject);
  });
}

/** 校验并落到用户数据目录；只接受真正的大屏页面。 */
function storeAgentDisplay(body) {
  if (!body || body.length < 100000 || !/<html[\s>]/i.test(body) || !/agent-series-theme/.test(body)) {
    throw new Error('文件看起来不是 Agent 战术大屏的 index.html');
  }
  fs.mkdirSync(agentDisplayDir(), { recursive: true });
  // 上游原样留一份，运行时加载的是打了数据桥补丁的衍生页；更新时重新生成。
  fs.writeFileSync(path.join(agentDisplayDir(), 'index.upstream.html'), body);
  const tmp = `${agentDisplayFile()}.tmp`;
  fs.writeFileSync(tmp, patchAgentDisplay(body));
  fs.renameSync(tmp, agentDisplayFile());
}

/** 旧安装（补丁版本落后或缺失）就地补一次；始终以未改动的上游文件为底重新生成。 */
function ensureAgentDisplayPatch() {
  const file = agentDisplayFile();
  if (!fs.existsSync(file)) return;
  const html = fs.readFileSync(file, 'utf8');
  if (html.includes(PATCH_TAG)) return;
  const upstream = path.join(agentDisplayDir(), 'index.upstream.html');
  const base = fs.existsSync(upstream) ? fs.readFileSync(upstream, 'utf8') : html;
  if (!fs.existsSync(upstream)) fs.writeFileSync(upstream, base);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, patchAgentDisplay(base));
  fs.renameSync(tmp, file);
}

async function downloadAgentDisplay() {
  let lastError = '';
  for (const source of AGENT_DISPLAY_SOURCES) {
    try {
      const body = await downloadText(source.url, source.headers, AGENT_DISPLAY_MAX_BYTES);
      storeAgentDisplay(body);
      try {
        const license = await downloadText(
          AGENT_DISPLAY_LICENSE_SOURCE.url,
          AGENT_DISPLAY_LICENSE_SOURCE.headers,
          64 * 1024,
        );
        fs.writeFileSync(path.join(agentDisplayDir(), 'LICENSE'), license);
      } catch {
        /* 许可文件下载失败不阻塞大屏使用 */
      }
      return agentDisplayStatus();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    ...agentDisplayStatus(`大屏资源下载失败：${lastError || '网络不可达'}`),
    error: `大屏资源下载失败：${lastError || '网络不可达'}`,
  };
}

ipcMain.handle('agent-display:status', () => agentDisplayStatus());
ipcMain.handle('agent-display:ensure', async () => {
  const current = agentDisplayStatus();
  if (!current.ok) return downloadAgentDisplay();
  ensureAgentDisplayPatch();
  return agentDisplayStatus();
});
ipcMain.handle('agent-display:reinstall', () => downloadAgentDisplay());
ipcMain.handle('agent-display:import', async () => {
  const picked = await dialog.showOpenDialog({
    title: '选择 agent-display 的 index.html',
    filters: [{ name: 'HTML 页面', extensions: ['html', 'htm'] }],
    properties: ['openFile'],
  });
  if (picked.canceled || !picked.filePaths[0]) {
    return { ok: false, canceled: true, error: '已取消导入' };
  }
  try {
    storeAgentDisplay(fs.readFileSync(picked.filePaths[0], 'utf8'));
    return agentDisplayStatus();
  } catch (error) {
    return { ok: false, error: `导入失败：${error instanceof Error ? error.message : String(error)}` };
  }
});
ipcMain.handle('agent-display:open-external', async () => {
  const current = agentDisplayStatus();
  if (!current.ok) return { ok: false, error: current.error };
  await shell.openExternal(current.url);
  return { ok: true };
});

ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('app:set-close-to-tray', (_event, value) => applyCloseToTray(value, false));

ipcMain.handle('window:toggle-maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});

ipcMain.handle('window:is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

ipcMain.handle('system:stats', () => {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    cpu: readCpuPercent(),
    mem: Math.round(((total - free) / total) * 100),
  };
});

ipcMain.handle('state:load', () => {
  const file = stateFilePath();
  if (!fs.existsSync(file)) return { ok: true, state: null, path: file };
  try {
    return { ok: true, state: JSON.parse(fs.readFileSync(file, 'utf8')), path: file };
  } catch (error) {
    return { ok: false, state: null, path: file, error: String(error.message || error) };
  }
});

ipcMain.handle('state:save', (_event, payload) => {
  try {
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'empty payload' };
    return writeState(payload);
  } catch (error) {
    console.error('[state] save failed', error);
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle('paths:defaults', () => defaultPaths());

ipcMain.handle('engine:status', () =>
  engineManager ? engineManager.status() : idleEngineStatus(),
);

ipcMain.handle('engine:start', () => (engineManager ? engineManager.start() : idleEngineStatus()));

ipcMain.handle('engine:restart', () =>
  engineManager ? engineManager.restart() : idleEngineStatus(),
);

ipcMain.handle('openfilm:status', () =>
  openfilmManager ? openfilmManager.snapshot() : idleOpenfilmStatus(),
);

ipcMain.handle('openfilm:ensure', () =>
  openfilmManager ? openfilmManager.ensure() : idleOpenfilmStatus(),
);

ipcMain.handle('openfilm:open-project', (_event, folder) =>
  openfilmManager ? openfilmManager.openProject(folder) : idleOpenfilmStatus(),
);

ipcMain.handle('openfilm:choose-project', () =>
  openfilmManager ? openfilmManager.chooseProject() : { canceled: true },
);

ipcMain.handle('openfilm:open-external', (_event, url) =>
  openfilmManager ? openfilmManager.openExternal(url) : { ok: false, error: 'Studio 尚未初始化' },
);

ipcMain.handle('health:check', (_event, engineSettings) => {
  try {
    return runHealthCheck(engineSettings);
  } catch (error) {
    return {
      ok: false,
      checkedAt: Date.now(),
      checks: [
        {
          id: 'health:crash',
          group: '环境',
          label: '体检执行',
          status: 'fail',
          detail: String(error.message || error),
          hint: '重新打开设置页再试一次。',
        },
      ],
      versions: {},
    };
  }
});

// 神经元联动的轻量事件通道：只读 events/ 下已扫描的两种日志，不扩大读取范围。
ipcMain.handle('engine:events', (_event, rootInput) => {
  try {
    const root = path.resolve(String(rootInput || defaultPaths().dataPath));
    return {
      ok: true,
      root,
      readAt: Date.now(),
      events: tailJsonl(path.join(root, 'events', 'events.jsonl'), 60),
      dispatches: tailJsonl(path.join(root, 'events', 'dispatch.jsonl'), 40),
    };
  } catch (error) {
    return {
      ok: false,
      root: String(rootInput || ''),
      readAt: Date.now(),
      events: [],
      dispatches: [],
      error: String(error.message || error),
    };
  }
});

// 派单记录：按天向插件取单，批量请求减少 IPC 往返；只读，失败不影响本地视图。
ipcMain.handle('dispatch:feed', async (_event, daysInput) => {
  const days = (Array.isArray(daysInput) ? daysInput : [daysInput])
    .map((day) => String(day || '').trim())
    .filter((day, index, list) => ORDER_DAY.test(day) && list.indexOf(day) === index)
    .slice(0, 14);
  if (days.length === 0) {
    return { ok: false, readAt: Date.now(), days: [], orders: [], error: '日期格式不正确' };
  }
  const results = await Promise.all(days.map((day) => fetchDispatchFeed(day)));
  return {
    ok: results.some((result) => result.ok),
    readAt: Date.now(),
    days: results.map((result) => ({
      day: result.day,
      ok: result.ok,
      count: result.orders.length,
      error: result.error,
    })),
    orders: results.flatMap((result) => result.orders),
    thresholds: results.find((result) => result.thresholds)?.thresholds ?? null,
    error: results.find((result) => result.error)?.error,
  };
});

ipcMain.handle('notify:feed', async (_event, daysInput) => {
  const days = (Array.isArray(daysInput) ? daysInput : [daysInput])
    .map((day) => String(day || '').trim())
    .filter((day, index, list) => ORDER_DAY.test(day) && list.indexOf(day) === index)
    .slice(0, 14);
  if (days.length === 0) {
    return { ok: false, readAt: Date.now(), days: [], items: [], unread: 0, error: '日期格式不正确' };
  }
  const results = await Promise.all(days.map((day) => fetchNotifyFeed(day)));
  return {
    ok: results.some((result) => result.ok),
    readAt: Date.now(),
    days: results.map((result) => ({ day: result.day, ok: result.ok, count: result.items.length, error: result.error })),
    items: results.flatMap((result) => result.items),
    unread: results.reduce((sum, result) => sum + (Number(result.unread) || 0), 0),
    error: results.find((result) => result.error)?.error,
  };
});

ipcMain.handle('engine:scan', (_event, root) => {
  try {
    return scanEngine(root);
  } catch (error) {
    return {
      ok: false,
      root: String(root || ''),
      scannedAt: new Date().toISOString(),
      scenes: [],
      skills: { index: '', dirs: [] },
      events: [],
      dispatches: [],
      errors: [String(error.message || error)],
    };
  }
});

ipcMain.handle('cost:snapshot', (_event, root) => {
  try {
    return readCostSnapshot(root);
  } catch (error) {
    return {
      ok: false,
      readAt: Date.now(),
      symbol: '¥',
      decimals: 2,
      currency: 'CNY',
      exchangeRate: 0,
      balance: null,
      today: null,
      peak: null,
      error: String(error.message || error),
    };
  }
});

ipcMain.handle('engine:pick-root', async (_event, defaultPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择引擎数据目录（.dsh）',
    defaultPath: defaultPath || defaultPaths().dataPath,
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('workspace:pick-root', async (_event, defaultPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择工作区目录',
    defaultPath: defaultPath || defaultPaths().workspacePath,
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('path:pick-directory', async (_event, payload) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: (payload && payload.title) || '选择目录',
    defaultPath: (payload && payload.defaultPath) || undefined,
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

/** 背景素材只看扩展名，不读内容；选择结果交给 workbench-media 协议按需读取。 */
ipcMain.handle('path:pick-file', async (_event, payload) => {
  const video = payload && payload.kind === 'video';
  const extensions = video
    ? ['mp4', 'm4v', 'webm', 'mov', 'ogv']
    : ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'];
  const result = await dialog.showOpenDialog(mainWindow, {
    title: (payload && payload.title) || (video ? '选择背景视频' : '选择背景图片'),
    defaultPath: (payload && payload.defaultPath) || undefined,
    properties: ['openFile'],
    filters: [{ name: video ? '视频' : '图片', extensions }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const target = path.resolve(result.filePaths[0]);
  const mime = MEDIA_MIME[path.extname(target).toLowerCase()];
  if (!mime) return null;
  return { path: target, kind: mime.startsWith('video/') ? 'video' : 'image' };
});

ipcMain.handle('fs:list', (_event, payload) => {
  const root = payload && payload.root ? path.resolve(String(payload.root)) : '';
  const target = root ? resolveInside(root, payload.relative || '.') : null;
  if (!root || !target) return { ok: false, error: '路径越界或为空', entries: [] };
  if (isProtectedPath(root) || isProtectedPath(target)) {
    return { ok: false, error: '受保护的引擎目录不可浏览', entries: [] };
  }
  try {
    // 点目录也列出来（例如 .dsh），但受保护目录只显示名字，不许进入或预览。
    const entries = fs
      .readdirSync(target, { withFileTypes: true })
      .map((entry) => {
        const full = path.join(target, entry.name);
        let size = 0;
        let modified = 0;
        try {
          const stat = fs.statSync(full);
          size = stat.size;
          modified = stat.mtimeMs;
        } catch {
          /* ignore */
        }
        return {
          name: entry.name,
          type: entry.isDirectory() ? 'dir' : 'file',
          size,
          modified,
          ext: entry.isFile() ? path.extname(entry.name).slice(1).toLowerCase() : '',
          protected: isProtectedPath(full),
          hidden: entry.name.startsWith('.'),
        };
      })
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'zh') : a.type === 'dir' ? -1 : 1))
      .slice(0, 400);
    return { ok: true, root, relative: payload.relative || '.', entries };
  } catch (error) {
    return { ok: false, root, error: String(error.message || error), entries: [] };
  }
});

/** 把设置里的绝对目录换算成浏览根目录内的相对路径，供文件工作台默认入口使用。 */
ipcMain.handle('fs:resolve', (_event, payload) => {
  const root = payload && payload.root ? path.resolve(String(payload.root)) : '';
  if (!root) return { ok: false, error: '尚未配置文件浏览根目录' };
  if (isProtectedPath(root)) return { ok: false, error: '受保护的引擎目录不可浏览' };
  const target = payload.target ? path.resolve(String(payload.target)) : root;
  const inside = resolveInside(root, target);
  if (!inside) return { ok: false, error: '目标目录不在浏览根目录内' };
  if (isProtectedPath(inside)) return { ok: false, error: '受保护的引擎目录不可浏览' };
  const stat = statOf(inside);
  if (!stat.exists) return { ok: false, error: '目标目录不存在' };
  if (!stat.dir) return { ok: false, error: '目标不是目录' };
  const relative = path.relative(root, inside).split(path.sep).join('/');
  return { ok: true, root, relative: relative || '.' };
});

ipcMain.handle('fs:preview', (_event, payload) => {
  const root = payload && payload.root ? path.resolve(String(payload.root)) : '';
  const target = root ? resolveInside(root, payload.relative || '') : null;
  if (!root || !target) return { ok: false, error: '路径越界或为空' };
  if (isProtectedPath(root) || isProtectedPath(target)) {
    return { ok: false, error: '受保护的引擎文件不可预览' };
  }
  try {
    const stat = fs.statSync(target);
    if (!stat.isFile()) return { ok: false, error: '不是文件' };
    if (stat.size > 1024 * 1024) return { ok: false, error: '文件超过 1MB，暂不预览', size: stat.size };
    const buffer = Buffer.alloc(Math.min(stat.size, 200 * 1024));
    let fd = null;
    try {
      fd = fs.openSync(target, 'r');
      fs.readSync(fd, buffer, 0, buffer.length, 0);
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
      }
    }
    const binary = buffer.includes(0);
    return {
      ok: true,
      size: stat.size,
      truncated: stat.size > buffer.length,
      binary,
      text: binary ? '' : buffer.toString('utf8'),
    };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

/** 风格库默认放在状态目录下，避免把第三方素材并进仓库。 */
function defaultStyleRoot() {
  return path.join(stateDir || app.getPath('appData'), 'animation-styles');
}

function styleLibraryBase(input) {
  const candidate = path.resolve(String(input || '').trim() || defaultStyleRoot());
  const nested = path.join(candidate, '风格提示词');
  if (statOf(nested).dir) return { root: candidate, base: '风格提示词' };
  if (path.basename(candidate) === '风格提示词' && statOf(candidate).dir) {
    return { root: path.dirname(candidate), base: '风格提示词' };
  }
  return { root: candidate, base: '' };
}

/** 只读扫描风格库：分类子目录下的 .md 与同名静帧，不读正文。 */
function scanStyleLibrary(input) {
  const resolved = styleLibraryBase(input);
  const baseAbs = resolved.base ? path.join(resolved.root, resolved.base) : resolved.root;
  if (isProtectedPath(baseAbs)) return { ok: false, error: '受保护的引擎目录不可扫描' };
  if (!statOf(baseAbs).dir) {
    return { ok: true, root: resolved.root, base: resolved.base, missing: true, total: 0, categories: [], items: [] };
  }
  let dirs = [];
  try {
    dirs = fs.readdirSync(baseAbs, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    return { ok: false, error: String(error.message || error), root: resolved.root, base: resolved.base, total: 0, categories: [], items: [] };
  }
  dirs.sort((a, b) => a.localeCompare(b, 'zh'));
  const items = [];
  const categories = [];
  const stillExts = ['.jpg', '.jpeg', '.png', '.webp'];
  for (const dir of dirs) {
    const dirAbs = path.join(baseAbs, dir);
    let entries = [];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      continue;
    }
    const fileNames = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    const docs = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, 'zh', { numeric: true }));
    if (!docs.length) continue;
    categories.push({ name: dir, count: docs.length });
    for (const doc of docs) {
      const stem = doc.slice(0, -3);
      const underscore = stem.indexOf('_');
      const id = underscore >= 0 ? stem.slice(0, underscore) : stem;
      const title = underscore >= 0 ? stem.slice(underscore + 1) : stem;
      const series = (id.match(/^[A-Za-z]+/) || [id])[0].toUpperCase();
      const still = stillExts.map((ext) => `${stem}${ext}`).find((name) => fileNames.has(name)) || '';
      const prefix = resolved.base ? `${resolved.base}/` : '';
      items.push({
        key: `${dir}/${stem}`,
        category: dir,
        id,
        title: title || id,
        series,
        relative: `${prefix}${dir}/${doc}`,
        stillRelative: still ? `${prefix}${dir}/${still}` : '',
      });
    }
  }
  return {
    ok: true,
    root: resolved.root,
    base: resolved.base,
    missing: false,
    total: items.length,
    categories,
    items,
  };
}

ipcMain.handle('styles:scan', (_event, payload) => scanStyleLibrary(payload && payload.root));

const IMAGE_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** 风格库静帧只读转 data URL；限制类型与大小，避免把二进制塞进存档。 */
ipcMain.handle('fs:image', (_event, payload) => {
  const root = payload && payload.root ? path.resolve(String(payload.root)) : '';
  const target = root ? resolveInside(root, payload.relative || '') : null;
  if (!root || !target) return { ok: false, error: '路径越界或为空' };
  if (isProtectedPath(root) || isProtectedPath(target)) {
    return { ok: false, error: '受保护的引擎文件不可读取' };
  }
  const ext = path.extname(target).toLowerCase();
  const mime = IMAGE_MIME[ext];
  if (!mime) return { ok: false, error: '只支持 jpg / png / webp / gif 图片' };
  try {
    const stat = fs.statSync(target);
    if (!stat.isFile()) return { ok: false, error: '不是文件' };
    if (stat.size > 8 * 1024 * 1024) return { ok: false, error: '图片超过 8MB，暂不预览', size: stat.size };
    const data = fs.readFileSync(target).toString('base64');
    return { ok: true, size: stat.size, mime, dataUrl: `data:${mime};base64,${data}` };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle('fs:write', (_event, payload) => {  const root = payload && payload.root ? path.resolve(String(payload.root)) : '';
  const target = root ? resolveInside(root, payload.relative || '') : null;
  if (!root || !target) return { ok: false, error: '路径越界或为空' };
  if (payload.relative === '.' || payload.relative === '') {
    return { ok: false, error: '不能覆盖目录' };
  }
  if (isProtectedPath(root) || isProtectedPath(target)) {
    return { ok: false, error: '受保护的引擎文件不可写入' };
  }
  if (typeof payload.text !== 'string') return { ok: false, error: '内容格式不正确' };
  try {
    const stat = fs.statSync(target);
    if (!stat.isFile()) return { ok: false, error: '只能保存已存在的文本文件' };
    const size = Buffer.byteLength(payload.text, 'utf8');
    if (size > 1024 * 1024) return { ok: false, error: '文件超过 1MB，暂不支持在线编辑' };
    fs.writeFileSync(target, payload.text, 'utf8');
    return { ok: true, size, path: target };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

/** 新建条目只接受单个名字：不能带分隔符、盘符、结尾点或 Windows 保留名。 */
function newEntryName(value) {
  const text = String(value || '').trim();
  if (!text || text === '.' || text === '..' || text.length > 120) return '';
  if (/[\\/:*?"<>|]/.test(text)) return '';
  if (/[. ]$/.test(text)) return '';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(text)) return '';
  return text;
}

/** 统一校验新建条目的父目录与目标路径，返回相对路径供界面刷新。 */
function resolveNewEntry(payload) {
  const root = payload && payload.root ? path.resolve(String(payload.root)) : '';
  const base = root ? resolveInside(root, (payload && payload.relative) || '.') : null;
  const name = newEntryName(payload && payload.name);
  if (!root || !base) return { error: '路径越界或为空' };
  if (!name) return { error: '名称不合法：不能包含 \\ / : * ? " < > |，也不能以点或空格结尾' };
  if (isProtectedPath(root) || isProtectedPath(base)) return { error: '受保护的引擎目录不可写入' };
  const target = resolveInside(base, name);
  if (!target) return { error: '路径越界或为空' };
  if (isProtectedPath(target)) return { error: '受保护的引擎目录不可写入' };
  try {
    if (!fs.statSync(base).isDirectory()) return { error: '当前路径不是目录' };
  } catch {
    return { error: '父目录不存在或不可访问' };
  }
  if (fs.existsSync(target)) return { error: '同名条目已存在' };
  return {
    root,
    target,
    relative: path.relative(root, target).split(path.sep).join('/'),
  };
}

ipcMain.handle('fs:mkdir', (_event, payload) => {
  const resolved = resolveNewEntry(payload);
  if (resolved.error) return { ok: false, error: resolved.error };
  try {
    fs.mkdirSync(resolved.target);
    return { ok: true, relative: resolved.relative };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle('fs:create', (_event, payload) => {
  const resolved = resolveNewEntry(payload);
  if (resolved.error) return { ok: false, error: resolved.error };
  try {
    // wx：目标已存在就失败，避免误覆盖。
    fs.writeFileSync(resolved.target, '', { encoding: 'utf8', flag: 'wx' });
    return { ok: true, relative: resolved.relative, size: 0 };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle('fs:remove', (_event, payload) => {
  const root = payload && payload.root ? path.resolve(String(payload.root)) : '';
  const relative = payload && typeof payload.relative === 'string' ? payload.relative : '';
  if (!root || !relative || relative === '.' || relative === './') {
    return { ok: false, error: '不能删除浏览根目录' };
  }
  const target = resolveInside(root, relative);
  if (!target) return { ok: false, error: '路径越界或为空' };
  if (isProtectedPath(root) || isProtectedPath(target)) {
    return { ok: false, error: '受保护的引擎条目不可删除' };
  }
  if (path.resolve(target) === path.resolve(root)) {
    return { ok: false, error: '不能删除浏览根目录' };
  }
  try {
    const stat = fs.lstatSync(target);
    if (stat.isDirectory()) {
      fs.rmSync(target, { recursive: true, force: false });
    } else {
      fs.unlinkSync(target);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle('engine:doc-read', (_event, payload) =>
  readEngineDoc(payload && payload.root, payload && payload.relative),
);

ipcMain.handle('engine:order-doc', (_event, payload) =>
  readEngineOrder(
    payload && payload.root,
    payload && payload.day,
    payload && payload.orderId,
    payload && payload.agent,
  ),
);

ipcMain.handle('engine:open-path', async (_event, payload) => {
  const found = engineOpenTarget(payload && payload.root, payload && payload.relative);
  if (!found) return { ok: false, error: '该路径不在可打开的引擎白名单内' };
  const error = await shell.openPath(found.target);
  return error ? { ok: false, error } : { ok: true };
});

ipcMain.handle('engine:doc-write', (_event, payload) =>
  writeEngineDoc(payload && payload.root, payload && payload.relative, payload && payload.text),
);

ipcMain.handle('engine:skills', (_event, root) => scanSkills(root));
ipcMain.handle('engine:skill-doc', (_event, payload) =>
  readSkillDoc(payload && payload.root, payload && payload.id),
);
ipcMain.handle('tools:scan', (_event, root) => scanTools(root));

ipcMain.handle('terminal:shells', () => detectTerminalShells());
ipcMain.handle('terminal:start', (event, payload) => terminalStart(event, payload));
ipcMain.handle('terminal:exec', (event, payload) => terminalExec(event, payload));
ipcMain.handle('terminal:kill', (event, payload) => terminalKill(event, payload));

ipcMain.handle('clipboard:write', (_event, text) => {
  try {
    clipboard.writeText(String(text ?? ''));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('shell:open-external', async (_event, url) => {
  try {
    const parsed = new URL(String(url || ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: '仅支持 http/https 地址' };
    }
    await shell.openExternal(parsed.toString());
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle('shell:open-path', async (_event, target) => {
  if (!target) return { ok: false };
  const resolved = path.resolve(String(target));
  if (isProtectedPath(resolved)) return { ok: false, error: '受保护的引擎目录不可打开' };
  const error = await shell.openPath(resolved);
  return error ? { ok: false, error } : { ok: true };
});

// 单实例：两个客户端会争用同一端口并同时写存档，第二个实例直接唤醒已有窗口。
// 截图模式例外，它需要和正在运行的客户端并存。
if (!captureMode && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (!captureMode) app.on('second-instance', () => showMainWindow());

  app.whenReady().then(() => {
    app.setAppUserModelId('com.dsh.nexus-workbench');
    // 背景素材：协议只转出白名单扩展名的文件，受保护路径直接 404。
    protocol.handle('workbench-media', async (request) => {
      try {
        // URLSearchParams 已经解过一次码，这里不再 decode，避免路径里的 % 被二次解析。
        const target = path.resolve(new URL(request.url).searchParams.get('p') || '');
        const mime = MEDIA_MIME[path.extname(target).toLowerCase()];
        if (!mime || isProtectedPath(target)) return new Response('', { status: 404 });
        if (!fs.statSync(target).isFile()) return new Response('', { status: 404 });
        const response = await net.fetch(pathToFileURL(target).toString());
        const headers = new Headers(response.headers);
        headers.set('Content-Type', mime);
        headers.set('Cache-Control', 'no-cache');
        return new Response(response.body, { status: response.status, headers });
      } catch {
        return new Response('', { status: 400 });
      }
    });
    // 存档目录优先独立到 DSH-Workbench，失败时退回项目 .data，保证状态一定能落盘。
    const picked = pickStateDir();
    stateDir = picked.dir;
    if (picked.isolated) {
      try {
        app.setPath('userData', picked.dir);
      } catch (error) {
        console.warn('[workbench] failed to set userData path', error.message || error);
      }
    }
    const stored = readJson(stateFilePath());
    if (stored?.settings?.workbench?.closeToTray === false) closeToTray = false;
    engineManager = createManagedEngine(resolveEnginePaths(stored?.settings?.engine));
    openfilmManager = createOpenfilmManager({
      onUpdate: (snapshot) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('openfilm:status', snapshot);
        }
      },
    });
    createWindow();
    createTray();
    void engineManager.start();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    killAllTerminals();
    engineManager?.quit();
    openfilmManager?.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
