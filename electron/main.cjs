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
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const { createEngineManager } = require('./engine-manager.cjs');

/**
 * 壳工程不写死绝对路径：开发态以工作台目录的上一级为根，安装态以可执行文件所在目录为根。
 * 需要自定义时优先读环境变量，其次读设置里持久化的路径。
 */
function programRoot() {
  return app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, '..', '..');
}

function defaultPaths() {
  const root = programRoot();
  const engineDir = process.env.DSH_ENGINE_DIR || path.join(root, 'engine');
  const dataPath = process.env.DSH_HOME || path.join(root, 'engine-data', '.dsh');
  return {
    root,
    engineDir,
    dataPath,
    workspacePath: path.join(root, 'workspace'),
    filesRoot: root,
    skillsPath: path.join(dataPath, 'skills'),
    toolsPath: path.join(root, 'tools'),
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

/**
 * 只按 PATH 与环境变量探测 shell，不写死安装路径；设置里保存的是 shell id，
 * 换机器后按同一份探测结果重新解析。
 */
function detectTerminalShells() {
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
  return (
    byId.get('git-bash')?.available
      ? byId.get('git-bash')
      : byId.get('powershell')?.available
        ? byId.get('powershell')
        : byId.get('cmd')
  );
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
    args = ['--noprofile', '--norc'];
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

// webview 只跑官方引擎页面：去掉宿主 preload，禁止 Node 集成，外部链接交给系统浏览器。
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (_attachEvent, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
  });
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        void shell.openExternal(url);
      }
      return { action: 'deny' };
    });
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
      index: readText(path.join(root, 'skills', '_索引.md'), 4000),
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

  const skillIndex = statOf(path.join(paths.dataPath, 'skills', '_索引.md'));
  add(
    '核心插件',
    '技能索引',
    skillIndex.file ? 'ok' : 'warn',
    skillIndex.file ? '已找到 skills/_索引.md' : '未找到技能索引',
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
    if (!image.isEmpty()) image = image.resize({ width: 16, height: 16 });
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

  mainWindow.webContents.on('console-message', (_event, details) => {
    const level = typeof details === 'object' && details ? details.level : '';
    const message = typeof details === 'object' && details ? details.message : String(details);
    const source = typeof details === 'object' && details ? details.sourceId : '';
    const line = typeof details === 'object' && details ? details.lineNumber : '';
    console.log(`[renderer:${level}] ${message} (${source}:${line})`);
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
    mainWindow.show();
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          if (captureScript) {
            await mainWindow.webContents.executeJavaScript(captureScript);
            await new Promise((resolve) => setTimeout(resolve, 900));
          }
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

ipcMain.handle('fs:list', (_event, payload) => {
  const root = payload && payload.root ? path.resolve(String(payload.root)) : '';
  const target = root ? resolveInside(root, payload.relative || '.') : null;
  if (!root || !target) return { ok: false, error: '路径越界或为空', entries: [] };
  if (isProtectedPath(root) || isProtectedPath(target)) {
    return { ok: false, error: '受保护的引擎目录不可浏览', entries: [] };
  }
  try {
    const entries = fs
      .readdirSync(target, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.'))
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

ipcMain.handle('fs:write', (_event, payload) => {
  const root = payload && payload.root ? path.resolve(String(payload.root)) : '';
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

ipcMain.handle('engine:doc-read', (_event, payload) =>
  readEngineDoc(payload && payload.root, payload && payload.relative),
);

ipcMain.handle('engine:doc-write', (_event, payload) =>
  writeEngineDoc(payload && payload.root, payload && payload.relative, payload && payload.text),
);

ipcMain.handle('engine:skills', (_event, root) => scanSkills(root));
ipcMain.handle('engine:skill-doc', (_event, payload) =>
  readSkillDoc(payload && payload.root, payload && payload.id),
);

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
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
