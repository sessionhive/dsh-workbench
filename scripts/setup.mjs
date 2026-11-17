#!/usr/bin/env node
/**
 * DSH 中枢一键部署。
 *
 * 目标：在一台只有 Node.js 20+ 的机器上，从 Git 克隆出的 app/ 目录开始，
 * 补齐 sibling 目录、安装并构建工作台、下载 DSH 引擎、初始化数据目录、
 * 强制安装 @sessionhive/dsh-collab 并登记到 profile，最后启动工作台。
 *
 * 安全边界：
 * - 不读取、不复制、不打印 .credentials.yaml；
 * - 不结束不是本脚本启动的进程（只对临时初始化的 dsh 子进程树执行 taskkill）；
 * - 修改 cordis.patch.yml 前先备份；
 * - 引擎启动日志只保存在 data/ 下，异常时回显会遮蔽 token；
 * - 不自动提交、不 push、不全局安装。
 *
 * 用法见 `node scripts/setup.mjs --help`。
 */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPT_DIR, '..');
const IS_WIN = process.platform === 'win32';

const DEFAULT_DSH_VERSION = '0.2.2-rc.3';
const DEFAULT_PLUGIN_VERSION = '0.2.0';
const PLUGIN_NAME = '@sessionhive/dsh-collab';
const PLUGIN_ID = 'workbench-core';

const BOOLEAN_FLAGS = new Set([
  'help',
  'skip-build',
  'skip-launch',
  'skip-port-check',
  'public',
  'local',
  'dry-run',
  'no-init',
]);

const USAGE = `
DSH 中枢一键部署

用法:
  node scripts/setup.mjs [选项]
  setup.cmd [选项]                Windows 下可双击，或在命令行运行

选项:
  --root <dir>              仓库的上一级目录，默认是 app/ 的父目录
  --engine-dir <dir>        引擎目录，默认 <root>/engines
  --dsh-home <dir>          引擎数据目录，默认 <root>/data/.dsh
  --port <n>                工作台引擎端口，默认 3083
  --dsh-version <ver>       @deepseek-ai/dsh 版本，默认 ${DEFAULT_DSH_VERSION}
  --plugin-version <ver>    dsh-collab 版本，默认 ${DEFAULT_PLUGIN_VERSION}
  --skip-build              跳过工作台依赖安装与构建（dist/ 必须已存在）
  --skip-launch             安装完成后不启动工作台
  --skip-port-check         跳过端口占用检查（仅建议在 dry-run 时使用）
  --public                  强制公开构建（不装配本机扩展）
  --local                   强制本机扩展构建（需要 src/modules/local-modules）
  --no-init                 数据目录未初始化时直接报错，不临时启动 dsh web
  --dry-run                 只检查并打印将执行的操作，不写文件、不安装、不启动
  -h, --help                显示帮助

示例:
  # 在仓库根目录双击 setup.cmd，或：
  node scripts/setup.mjs

  # 自定义目录与版本
  node scripts/setup.mjs --root D:\\DSH --port 3084 --plugin-version 0.2.0

  # 先看会做什么
  node scripts/setup.mjs --dry-run

部署完成后仍需在 DSH 里登录模型账号；脚本不会读取任何凭据。
`.trim();

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    if (eq > 0) {
      out[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      out[key] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);
const c = {
  bold: (text) => paint('1', text),
  cyan: (text) => paint('36', text),
  green: (text) => paint('32', text),
  yellow: (text) => paint('33', text),
  red: (text) => paint('31', text),
  dim: (text) => paint('2', text),
};

function out(message = '') {
  process.stdout.write(`${message}\n`);
}

function step(message) {
  out('');
  out(c.cyan(`== ${message}`));
}

function info(message) {
  out(`   ${message}`);
}

function warn(message) {
  out(c.yellow(`   ! ${message}`));
}

function fail(message) {
  throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function exists(target) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

function readJson(file) {
  try {
    // Windows 上手工保存的 JSON 可能带 UTF-8 BOM，JSON.parse 不接受。
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  } catch (error) {
    fail(`无法解析 ${file}：${error.message}`);
  }
}

function ensureDir(dir, dryRun) {
  if (dryRun) {
    info(`[dry-run] 创建目录 ${dir}`);
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
}

function commandLine(command, args) {
  return [command, ...args]
    .map((part) => (/\s/.test(part) ? `"${part}"` : part))
    .join(' ');
}

function quoteWindowsArg(value) {
  const text = String(value);
  if (!/[\s"]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Windows 上 npm/pnpm/corepack 是 .cmd，不能直接 spawn；统一经 cmd.exe 调用。
 * 参数由我们自己拼装并加引号，不开启 shell 字符串插值，避免注入和 Node 的 DEP0190。
 */
function spawnCommand(command, args, options) {
  let file = command;
  let argv = args;
  if (IS_WIN && /\.(cmd|bat)$/i.test(command)) {
    const line = [command, ...args].map(quoteWindowsArg).join(' ');
    file = process.env.ComSpec || 'cmd.exe';
    argv = ['/d', '/s', '/c', line];
  }
  return spawnSync(file, argv, options);
}

function run(command, args, options = {}) {
  const { cwd, env, capture = false, dryRun = false, allowFailure = false } = options;
  const shown = commandLine(command, args);
  if (dryRun) {
    info(`[dry-run] ${shown}${cwd ? `  (cwd: ${cwd})` : ''}`);
    return { status: 0, stdout: '', stderr: '' };
  }
  info(c.dim(shown));
  const result = spawnCommand(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) {
    fail(`${shown} 启动失败：${result.error.message}`);
  }
  if (result.status !== 0 && !allowFailure) {
    const tail = capture && result.stderr ? `\n${result.stderr.trim()}` : '';
    fail(`${shown} 退出码 ${result.status}${tail}`);
  }
  return result;
}

function commandExists(name) {
  const probe = IS_WIN ? 'where' : 'which';
  const result = spawnSync(probe, [name], { stdio: 'ignore', windowsHide: true });
  return result.status === 0;
}

function isPortListening(port) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(600);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortListening(port)) return true;
    await delay(1000);
  }
  return isPortListening(port);
}

function redactSecrets(text) {
  return String(text)
    .replace(/(token=)[^\s&]+/gi, '$1***')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1***')
    .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[^"'\s]+/gi, '$1***');
}

function tailLog(file, lines = 24) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const tail = text.split(/\r?\n/).filter(Boolean).slice(-lines).join(os.EOL);
    return redactSecrets(tail);
  } catch {
    return '';
  }
}

function stopProcessTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (IS_WIN) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        process.kill(child.pid, 'SIGTERM');
      } catch {
        /* 已经退出 */
      }
    }
    spawnSync('sleep', ['1'], { stdio: 'ignore' });
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* 已经退出 */
    }
  }
}

function indentOf(line) {
  return (line.match(/^\s*/) || [''])[0].length;
}

function findBlockEnd(lines, start) {
  const base = indentOf(lines[start]);
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = indentOf(line);
    if (indent < base) return i;
    if (indent === base && /^\s*-/.test(line)) return i;
  }
  return lines.length;
}

/**
 * 在 cordis.patch.yml 文本里确保存在 workbench-core 条目，并让 dataRoot 指向当前数据目录。
 * 纯函数：不读写磁盘，便于测试。
 */
export function mergePluginPatch(raw, dataRoot) {
  const source = typeof raw === 'string' ? raw : '';
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source ? source.split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  // 新建 profile 的模板是「注释 + 顶层空数组 []」。[] 与后续条目不能共存，
  // 先移除顶层空数组；顺带修复之前追加失败留下的 [] + 条目混排。
  let structuralChange = false;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (indentOf(lines[i]) === 0 && lines[i].trim() === '[]') {
      lines.splice(i, 1);
      structuralChange = true;
    }
  }
  if (structuralChange) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  }

  const yamlPath = String(dataRoot).replace(/\\/g, '/').replace(/'/g, "''");
  const idRe = new RegExp(`^\\s*-\\s*id:\\s*${PLUGIN_ID}\\s*(?:#.*)?$`);
  const entryNameRe = new RegExp(
    `^\\s*-\\s*name:\\s*['"]?${PLUGIN_NAME.replace('/', '\\/')}['"]?\\s*(?:#.*)?$`,
  );
  const propNameRe = new RegExp(
    `^\\s*name:\\s*['"]?${PLUGIN_NAME.replace('/', '\\/')}['"]?\\s*(?:#.*)?$`,
  );

  const idIndexes = [];
  const nameIndexes = [];
  lines.forEach((line, index) => {
    if (idRe.test(line)) idIndexes.push(index);
    else if (entryNameRe.test(line) || propNameRe.test(line)) nameIndexes.push(index);
  });

  if (idIndexes.length > 1) {
    fail(`cordis.patch.yml 里有多个 ${PLUGIN_ID} 条目，请先手动合并`);
  }

  let entryIndex = idIndexes.length ? idIndexes[0] : -1;
  if (entryIndex < 0) {
    if (nameIndexes.length > 1) {
      fail(`cordis.patch.yml 里有多个 ${PLUGIN_NAME} 条目，请先手动合并`);
    }
    if (nameIndexes.length === 1) entryIndex = nameIndexes[0];
  } else if (nameIndexes.some((index) => index > entryIndex + 1 && index < findBlockEnd(lines, entryIndex))) {
    fail(`cordis.patch.yml 里 ${PLUGIN_ID} 块内重复出现插件名，请先手动合并`);
  }

  if (entryIndex < 0) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (lines.length) lines.push('');
    lines.push(
      '- insert:',
      `    - id: ${PLUGIN_ID}`,
      `      name: '${PLUGIN_NAME}'`,
      '      config:',
      `        dataRoot: '${yamlPath}'`,
    );
    return { changed: true, text: `${lines.join(eol)}${eol}` };
  }

  const blockEnd = findBlockEnd(lines, entryIndex);
  const entryIndent = indentOf(lines[entryIndex]);
  const propIndent = entryIndent + 2;

  let nameIndex = -1;
  let idLineIndex = -1;
  let configIndex = -1;
  let dataRootIndex = -1;

  for (let i = entryIndex; i < blockEnd; i += 1) {
    const line = lines[i];
    if (idRe.test(line)) idLineIndex = i;
    if (propNameRe.test(line) || entryNameRe.test(line)) nameIndex = i;
    if (/^\s*config:\s*$/.test(line)) configIndex = i;
    if (/^\s*config:\s*\{/.test(line)) {
      fail('cordis.patch.yml 的 workbench-core 使用了内联 config，请先改成块格式再运行');
    }
    if (/^\s*dataRoot:/.test(line)) dataRootIndex = i;
  }

  if (nameIndex < 0) {
    const insertAt = idLineIndex >= 0 ? idLineIndex + 1 : entryIndex + 1;
    lines.splice(insertAt, 0, `${' '.repeat(propIndent)}name: '${PLUGIN_NAME}'`);
    return mergePluginPatch(lines.join(eol) + eol, dataRoot);
  }

  const configIndent = configIndex >= 0 ? indentOf(lines[configIndex]) : propIndent;
  if (dataRootIndex >= 0) {
    const current = lines[dataRootIndex].replace(/^\s*dataRoot:\s*/, '').trim();
    const expected = `'${yamlPath}'`;
    if (current === expected || current === yamlPath) {
      return {
        changed: structuralChange,
        text: structuralChange ? `${lines.join(eol)}${eol}` : source,
      };
    }
    lines[dataRootIndex] = `${' '.repeat(indentOf(lines[dataRootIndex]))}dataRoot: '${yamlPath}'`;
    return { changed: true, text: `${lines.join(eol)}${eol}` };
  }

  if (configIndex >= 0) {
    lines.splice(configIndex + 1, 0, `${' '.repeat(configIndent + 2)}dataRoot: '${yamlPath}'`);
  } else {
    const insertAt = nameIndex + 1;
    lines.splice(
      insertAt,
      0,
      `${' '.repeat(propIndent)}config:`,
      `${' '.repeat(propIndent + 2)}dataRoot: '${yamlPath}'`,
    );
  }
  return { changed: true, text: `${lines.join(eol)}${eol}` };
}

function backupPath(file) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..*$/, '')
    .replace('T', '-');
  return `${file}.bak-${stamp}`;
}

/**
 * 修复「顶层 [] + 后续条目」的非法 patch：通常来自旧脚本直接追加模板。
 * 只在已经存在顶层条目时移除 []，避免把全新模板改成空文件。
 */
function repairPatchRoot(patchPath, dryRun) {
  const raw = fs.readFileSync(patchPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const hasEntries = lines.some((line) => indentOf(line) === 0 && /^-\s/.test(line));
  const emptyIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => indentOf(line) === 0 && line.trim() === '[]')
    .map(({ index }) => index);
  if (!hasEntries || emptyIndexes.length === 0) return false;

  if (dryRun) {
    info(`[dry-run] 将移除 ${patchPath} 里与新条目冲突的顶层 []`);
    return true;
  }
  for (let i = emptyIndexes.length - 1; i >= 0; i -= 1) lines.splice(emptyIndexes[i], 1);
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const backup = backupPath(patchPath);
  fs.copyFileSync(patchPath, backup);
  fs.writeFileSync(patchPath, `${lines.join(eol).replace(/\s+$/, '')}${eol}`, 'utf8');
  info(`已修复 cordis.patch.yml 的顶层 []（备份：${path.basename(backup)}）`);
  return true;
}

function patchCordis(profileDir, dshHome, dryRun) {
  const patchPath = path.join(profileDir, 'cordis.patch.yml');
  if (!exists(patchPath)) {
    fail(`找不到 ${patchPath}，请确认 DSH profile 已初始化`);
  }
  const raw = fs.readFileSync(patchPath, 'utf8');
  const result = mergePluginPatch(raw, dshHome);
  if (!result.changed) {
    info('cordis.patch.yml 已登记且 dataRoot 正确');
    return;
  }
  if (dryRun) {
    info(`[dry-run] 将更新 ${patchPath}：`);
    out(result.text.trimEnd());
    return;
  }
  const backup = backupPath(patchPath);
  fs.copyFileSync(patchPath, backup);
  fs.writeFileSync(patchPath, result.text, 'utf8');
  info(`已更新 cordis.patch.yml（备份：${path.basename(backup)}）`);
}

async function bootTemporaryEngine({
  cli,
  dshHome,
  engineDir,
  workspaceDir,
  stateDir,
  logName,
  timeoutMs = 180_000,
  dryRun,
}) {
  const tempPort = await findFreePort();
  const logFile = path.join(stateDir, logName);
  if (dryRun) {
    info(`[dry-run] DSH_HOME=${dshHome} ${cli} web --no-open --port ${tempPort}`);
    return { port: tempPort, logFile };
  }

  fs.mkdirSync(stateDir, { recursive: true });
  const logFd = fs.openSync(logFile, 'w');
  let child;
  try {
    child = spawn(process.execPath, [cli, 'web', '--no-open', '--port', String(tempPort)], {
      cwd: workspaceDir,
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        DSH_PORT: String(tempPort),
        DSH_ENGINE_DIR: engineDir,
      },
      detached: !IS_WIN,
      windowsHide: true,
      stdio: ['ignore', logFd, logFd],
    });
  } finally {
    // 子进程已经拿到句柄，父进程关闭自己的副本。
    fs.closeSync(logFd);
  }

  let spawnError = '';
  child.once('error', (error) => {
    spawnError = error.message;
  });
  let ready = false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (spawnError) break;
    if (await isPortListening(tempPort)) {
      ready = true;
      break;
    }
    if (child.exitCode !== null) break;
    await delay(1000);
  }
  if (!ready) {
    stopProcessTree(child);
    const tail = tailLog(logFile);
    const seconds = Math.round(timeoutMs / 1000);
    const reason = spawnError
      ? `临时引擎启动失败：${spawnError}`
      : child.exitCode !== null
        ? `临时引擎提前退出（退出码 ${child.exitCode}）`
        : `DSH 在 ${seconds} 秒内没有监听临时端口 ${tempPort}`;
    fail(`${reason}。日志：${logFile}${tail ? `\n${tail}` : ''}`);
  }
  stopProcessTree(child);
  await delay(1000);
  return { port: tempPort, logFile };
}

function resolveOptions(argv) {
  const args = parseArgs(argv);
  if (args.help || args.h) {
    out(USAGE);
    process.exit(0);
  }
  if (args._.length) {
    fail(`无法识别的参数：${args._.join(' ')}。用 --help 查看用法`);
  }

  const root = path.resolve(args.root ? String(args.root) : path.resolve(APP_DIR, '..'));
  const engineDir = path.resolve(args['engine-dir'] ? String(args['engine-dir']) : path.join(root, 'engines'));
  const dshHome = path.resolve(args['dsh-home'] ? String(args['dsh-home']) : path.join(root, 'data', '.dsh'));
  const port = Number(args.port || 3083);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    fail(`端口不合法：${args.port}`);
  }
  if (args.public && args.local) {
    fail('--public 与 --local 不能同时使用');
  }
  const dshVersion = String(args['dsh-version'] || DEFAULT_DSH_VERSION);
  const pluginVersion = String(args['plugin-version'] || DEFAULT_PLUGIN_VERSION);
  const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._+~-]*$/;
  for (const [label, value] of [
    ['--dsh-version', dshVersion],
    ['--plugin-version', pluginVersion],
  ]) {
    if (!versionPattern.test(value)) {
      fail(`${label} 只能是 npm 版本号或 dist-tag（如 0.2.2-rc.3、latest）：${value}`);
    }
  }

  return {
    root,
    appDir: APP_DIR,
    engineDir,
    dshHome,
    workspaceDir: path.join(root, 'workspace'),
    toolsDir: path.join(root, '_dev', 'tools'),
    stateDir: path.join(root, 'data'),
    port,
    dshVersion,
    pluginVersion,
    skipBuild: Boolean(args['skip-build']),
    skipLaunch: Boolean(args['skip-launch']),
    skipPortCheck: Boolean(args['skip-port-check']),
    forcePublic: Boolean(args.public),
    forceLocal: Boolean(args.local),
    noInit: Boolean(args['no-init']),
    dryRun: Boolean(args['dry-run']),
  };
}

async function main() {
  const options = resolveOptions(process.argv.slice(2));
  const {
    root,
    appDir,
    engineDir,
    dshHome,
    workspaceDir,
    toolsDir,
    stateDir,
    port,
    dshVersion,
    pluginVersion,
    skipBuild,
    skipLaunch,
    skipPortCheck,
    forcePublic,
    forceLocal,
    noInit,
    dryRun,
  } = options;

  out(c.bold('DSH 中枢一键部署'));
  out(c.dim(`工作台：${appDir}`));
  out(c.dim(`根目录：${root}`));
  if (dryRun) out(c.yellow('dry-run：不会写入文件、不会安装、不会启动进程'));

  // ---------- 0. 基本环境 ----------
  step('检查运行环境');
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 20) fail(`Node.js 版本过低：${process.version}，需要 >= 20`);
  info(`Node.js ${process.version}`);
  const npmCommand = IS_WIN ? 'npm.cmd' : 'npm';
  const npmVersion = run(npmCommand, ['--version'], { capture: true, dryRun });
  if (!dryRun) info(`npm ${String(npmVersion.stdout || '').trim()}`);
  if (!exists(path.join(appDir, 'package.json'))) {
    fail(`工作台目录不完整：${appDir} 缺少 package.json`);
  }

  if (!skipPortCheck && !dryRun && (await isPortListening(port))) {
    fail(
      `端口 ${port} 已被占用。请先完全退出正在运行的工作台/DSH，或改用 --port 指定其他端口；脚本不会结束未知进程`,
    );
  }
  if (!dryRun && port !== 3083 && (await isPortListening(3083))) {
    warn('检测到 3083 上已有引擎在运行；更新引擎目录可能影响那个实例，建议先退出再部署');
  }

  // ---------- 1. 目录结构 ----------
  step('准备目录结构');
  [root, engineDir, dshHome, workspaceDir, toolsDir, stateDir].forEach((dir) => ensureDir(dir, dryRun));
  info(`引擎：${engineDir}`);
  info(`数据：${dshHome}`);
  info(`工作区：${workspaceDir}`);

  // ---------- 2. 工作台依赖与构建 ----------
  step('安装工作台依赖');
  if (skipBuild) {
    info('已跳过安装与构建');
    if (!exists(path.join(appDir, 'dist', 'index.html'))) {
      fail('--skip-build 已指定，但 dist/index.html 不存在，无法启动');
    }
  } else {
    const hasNodeModules = exists(path.join(appDir, 'node_modules'));
    const hasLock = exists(path.join(appDir, 'package-lock.json'));
    if (!hasNodeModules && hasLock) {
      run(npmCommand, ['ci'], { cwd: appDir, dryRun });
    } else {
      run(npmCommand, ['install', '--no-audit', '--no-fund'], { cwd: appDir, dryRun });
    }

    step('构建工作台');
    const localModules = path.join(appDir, 'src', 'modules', 'local-modules');
    const useLocal = forceLocal || (!forcePublic && exists(localModules));
    const buildScript = useLocal ? 'build:local' : 'build';
    info(useLocal ? '检测到本机扩展，使用 build:local' : '使用公开构建 build');
    run(npmCommand, ['run', buildScript], { cwd: appDir, dryRun });
    if (!dryRun && !exists(path.join(appDir, 'dist', 'index.html'))) {
      fail('构建结束但 dist/index.html 不存在，请查看上面的构建日志');
    }
  }

  // ---------- 3. 下载 DSH 引擎 ----------
  step(`安装 DSH 引擎 ${dshVersion}`);
  const enginePkgPath = path.join(engineDir, 'package.json');
  let enginePkg = {
    name: 'dsh-engine',
    private: true,
    type: 'module',
  };
  if (exists(enginePkgPath)) {
    enginePkg = readJson(enginePkgPath);
    if (!enginePkg || typeof enginePkg !== 'object' || Array.isArray(enginePkg)) {
      fail(`${enginePkgPath} 不是 JSON 对象，请先手动处理`);
    }
  }
  enginePkg.dependencies = { ...(enginePkg.dependencies || {}), '@deepseek-ai/dsh': dshVersion };
  // npm 11 默认不执行依赖安装脚本。DSH 的终端与原生依赖需要这些脚本；
  // 使用按包名放行，而不是全局放开。工作台自身在 package.json 里配置了同样的白名单。
  enginePkg.allowScripts = {
    ...(enginePkg.allowScripts || {}),
    '@deepseek-ai/dsh-subprocess-local': true,
    '@google/genai': true,
    koffi: true,
    'node-pty': true,
    protobufjs: true,
  };
  if (!dryRun) {
    fs.writeFileSync(enginePkgPath, `${JSON.stringify(enginePkg, null, 2)}\n`, 'utf8');
  } else {
    info(`[dry-run] 写入 ${enginePkgPath} 并固定 @deepseek-ai/dsh@${dshVersion}`);
  }
  const engineInstall = run(npmCommand, ['install', '--no-audit', '--no-fund'], {
    cwd: engineDir,
    dryRun,
    allowFailure: true,
  });
  if (!dryRun && engineInstall.status !== 0) {
    fail(
      `DSH 下载失败（npm 退出码 ${engineInstall.status}）。请检查网络或 npm 源；` +
        `也可以改用 --dsh-version latest 重试`,
    );
  }

  const installedDshDir = path.join(engineDir, 'node_modules', '@deepseek-ai', 'dsh');
  const installedDshPkgPath = path.join(installedDshDir, 'package.json');
  const installedCli = path.join(installedDshDir, 'lib', 'bin.js');
  if (!dryRun) {
    if (!exists(installedCli)) {
      fail(`引擎安装不完整：找不到 ${installedCli}`);
    }
    const installedVersion = readJson(installedDshPkgPath).version;
    info(`引擎版本：${installedVersion}`);
    if (installedVersion !== dshVersion) {
      warn(`期望 ${dshVersion}，实际安装 ${installedVersion}；npm 可能使用了缓存或版本不存在`);
    }
  }

  // 工作台约定从 <engine>/apps/cli/lib/bin.js 启动。优先用 junction/symlink，
  // 失败时回退为复制，避免不同 Windows 权限策略导致部署中断。
  step('暴露引擎 CLI');
  const appsDir = path.join(engineDir, 'apps');
  const cliLink = path.join(appsDir, 'cli');
  if (dryRun) {
    info(`[dry-run] 将 ${cliLink} 指向 ${installedDshDir}`);
  } else {
    fs.mkdirSync(appsDir, { recursive: true });
    if (exists(cliLink)) {
      const stat = fs.lstatSync(cliLink);
      if (stat.isSymbolicLink()) fs.unlinkSync(cliLink);
      else fs.rmSync(cliLink, { recursive: true, force: true });
    }
    try {
      fs.symlinkSync(installedDshDir, cliLink, IS_WIN ? 'junction' : 'dir');
      info(`已链接：${cliLink}`);
    } catch (error) {
      info(`链接失败（${error.code || error.message}），改为复制`);
      fs.cpSync(installedDshDir, cliLink, { recursive: true, force: true });
    }
    const linkedCli = path.join(cliLink, 'lib', 'bin.js');
    if (!exists(linkedCli)) {
      fail(`准备 CLI 后仍找不到 ${linkedCli}`);
    }
  }

  // ---------- 4. 初始化 DSH 数据目录 ----------
  step('检查 DSH 数据目录');
  const profileDir = path.join(dshHome, 'profiles', 'web');
  const patchPath = path.join(profileDir, 'cordis.patch.yml');
  const registryPath = path.join(dshHome, '_meta', 'registry.json');

  // 先修复旧脚本可能留下的 «[] + 条目»；否则 dsh web 会在初始化阶段直接退出。
  if (exists(patchPath)) {
    try {
      repairPatchRoot(patchPath, dryRun);
    } catch (error) {
      fail(`无法检查 ${patchPath}：${error.message}`);
    }
  }

  {
    if (!exists(patchPath) || !exists(registryPath)) {
      if (noInit) {
        fail(`${dshHome} 尚未初始化，且指定了 --no-init。请先运行 dsh web 或去掉 --no-init`);
      }
      info('首次运行，需要临时启动 dsh web 生成 profile（可能需要几十秒）');
      const boot = await bootTemporaryEngine({
        cli: installedCli,
        dshHome,
        engineDir,
        workspaceDir,
        stateDir,
        logName: 'setup-dsh-init.log',
        timeoutMs: 180_000,
        dryRun,
      });
      if (!dryRun) {
        // profile 与 registry 通常在服务监听前后写入，给文件系统一点时间。
        for (let i = 0; i < 10 && (!exists(patchPath) || !exists(registryPath)); i += 1) {
          await delay(500);
        }
        if (!exists(patchPath)) {
          const tail = tailLog(boot.logFile);
          fail(`初始化后仍找不到 ${patchPath}。日志：${boot.logFile}${tail ? `\n${tail}` : ''}`);
        }
        if (!exists(registryPath)) {
          warn(`初始化后仍找不到 ${registryPath}；安装插件后会再尝试一次`);
        }
        info('数据目录初始化完成');
      }
    } else {
      info('数据目录已初始化，跳过临时启动');
    }

    // ---------- 5. 强制安装插件 ----------
    step(`安装 ${PLUGIN_NAME}@${pluginVersion}`);
    if (!dryRun && !exists(profileDir)) {
      fail(`找不到 profile 目录：${profileDir}。请先让 DSH 完成初始化`);
    }
    const profilePkgPath = path.join(profileDir, 'package.json');
    let profilePkg = {};
    if (!dryRun && exists(profilePkgPath)) {
      profilePkg = readJson(profilePkgPath);
    }
    const usesPnpm =
      exists(path.join(profileDir, 'pnpm-lock.yaml')) ||
      exists(path.join(profileDir, 'pnpm-workspace.yaml')) ||
      exists(path.join(profileDir, 'node_modules', '.modules.yaml')) ||
      String(profilePkg.packageManager || '').startsWith('pnpm');

    let installCommand = npmCommand;
    let installPrefix = [];
    if (usesPnpm) {
      if (commandExists(IS_WIN ? 'pnpm.cmd' : 'pnpm')) {
        installCommand = IS_WIN ? 'pnpm.cmd' : 'pnpm';
      } else if (commandExists('corepack')) {
        installCommand = IS_WIN ? 'corepack.cmd' : 'corepack';
        installPrefix = ['pnpm'];
      } else if (commandExists(IS_WIN ? 'npx.cmd' : 'npx')) {
        installCommand = IS_WIN ? 'npx.cmd' : 'npx';
        installPrefix = ['--yes', 'pnpm@9'];
        warn('未找到 pnpm/corepack，改用 npx pnpm@9（需要网络）');
      } else {
        fail('profile 使用 pnpm，但本机没有 pnpm、corepack 或 npx，请先安装 pnpm');
      }
      installPrefix.push('add', `${PLUGIN_NAME}@${pluginVersion}`, '--save-exact');
    } else {
      installPrefix = ['install', `${PLUGIN_NAME}@${pluginVersion}`, '--save-exact', '--no-audit', '--no-fund'];
    }
    info(usesPnpm ? 'profile 使用 pnpm' : 'profile 使用 npm');
    const pluginInstall = run(installCommand, installPrefix, {
      cwd: profileDir,
      dryRun,
      env: { CI: 'true' },
      allowFailure: true,
    });
    if (!dryRun && pluginInstall.status !== 0) {
      fail(
        `dsh-collab 安装失败（${installCommand} 退出码 ${pluginInstall.status}）。` +
          `请检查 profile 的包管理器与网络，不要同时混用 npm 和 pnpm`,
      );
    }

    if (!dryRun) {
      const pluginPkgPath = path.join(profileDir, 'node_modules', '@sessionhive', 'dsh-collab', 'package.json');
      if (!exists(pluginPkgPath)) {
        fail(`插件安装后仍找不到 ${pluginPkgPath}，请检查 profile 的包管理器`);
      }
      const installedPluginVersion = readJson(pluginPkgPath).version;
      info(`插件版本：${installedPluginVersion}`);
      if (installedPluginVersion !== pluginVersion) {
        warn(`期望 ${pluginVersion}，实际安装 ${installedPluginVersion}`);
      }
    }

    // ---------- 6. 登记插件 ----------
    step('登记插件配置');
    if (dryRun) {
      info(`[dry-run] 将确保 ${patchPath} 包含 ${PLUGIN_ID} 与 dataRoot`);
      if (exists(patchPath)) {
        const preview = mergePluginPatch(fs.readFileSync(patchPath, 'utf8'), dshHome);
        out(preview.text.trimEnd());
      }
    } else {
      patchCordis(profileDir, dshHome, false);
      if (!exists(registryPath)) {
        info('插件已安装，再启动一次引擎生成注册表，并验证插件能加载');
        const boot = await bootTemporaryEngine({
          cli: installedCli,
          dshHome,
          engineDir,
          workspaceDir,
          stateDir,
          logName: 'setup-dsh-registry.log',
          timeoutMs: 120_000,
          dryRun: false,
        });
        if (exists(registryPath)) {
          info('注册表已生成');
        } else {
          warn(`启动后仍找不到 ${registryPath}；工作台首次启动时会再尝试。日志：${boot.logFile}`);
        }
      }
    }

    // ---------- 7. 启动 ----------
    if (skipLaunch) {
      step('已跳过启动（--skip-launch）');
      printSummary({ appDir, engineDir, dshHome, profileDir, workspaceDir, port, dshVersion, pluginVersion, launched: false });
      return;
    }

    step('启动工作台');
    if (dryRun) {
      info(`[dry-run] 以 DSH_ENGINE_DIR=${engineDir} DSH_HOME=${dshHome} DSH_PORT=${port} 启动 Electron`);
      printSummary({ appDir, engineDir, dshHome, profileDir, workspaceDir, port, dshVersion, pluginVersion, launched: false });
      return;
    }
    if (await isPortListening(port)) {
      fail(`端口 ${port} 已被占用，启动前检查未通过`);
    }

    let electronPath;
    try {
      const requireFromApp = createRequire(path.join(appDir, 'package.json'));
      electronPath = requireFromApp('electron');
    } catch (error) {
      fail(`找不到 Electron，请先执行 npm install：${error.message}`);
    }
    if (typeof electronPath !== 'string') {
      fail('Electron 模块没有返回可执行文件路径，请检查依赖安装');
    }

    const launchLog = path.join(stateDir, 'setup-launch.log');
    const launchFd = fs.openSync(launchLog, 'w');
    const launchEnv = {
      ...process.env,
      DSH_ENGINE_DIR: engineDir,
      DSH_HOME: dshHome,
      DSH_PORT: String(port),
      DSH_NODE: process.execPath,
    };
    delete launchEnv.ELECTRON_RUN_AS_NODE;

    const appChild = spawn(electronPath, ['electron/main.cjs'], {
      cwd: appDir,
      env: launchEnv,
      detached: true,
      windowsHide: false,
      stdio: ['ignore', launchFd, launchFd],
    });
    appChild.unref();
    fs.closeSync(launchFd);

    const ready = await waitForPort(port, 120_000);
    if (!ready) {
      const tail = tailLog(launchLog);
      fail(`工作台在 120 秒内没有监听 ${port}。日志：${launchLog}${tail ? `\n${tail}` : ''}`);
    }
    info(`工作台已启动，引擎端口 ${port}`);
    printSummary({ appDir, engineDir, dshHome, profileDir, workspaceDir, port, dshVersion, pluginVersion, launched: true });
  }
}

function printSummary(context) {
  step('部署完成');
  info(`工作台：${context.appDir}`);
  info(`引擎：${context.engineDir}`);
  info(`数据：${context.dshHome}`);
  info(`Profile：${context.profileDir}`);
  info(`工作区：${context.workspaceDir}`);
  info(`端口：${context.port}`);
  info(`插件：${PLUGIN_NAME}@${context.pluginVersion}`);
  if (!context.launched) {
    out('');
    out(IS_WIN ? '下一步（PowerShell）：' : '下一步：');
    if (IS_WIN) {
      out(`  $env:DSH_ENGINE_DIR = "${context.engineDir}"`);
      out(`  $env:DSH_HOME = "${context.dshHome}"`);
      out(`  $env:DSH_PORT = "${context.port}"`);
    } else {
      out(`  export DSH_ENGINE_DIR="${context.engineDir}"`);
      out(`  export DSH_HOME="${context.dshHome}"`);
      out(`  export DSH_PORT="${context.port}"`);
    }
    out(`  cd "${context.appDir}"`);
    out('  npm start');
  }
  out('');
  out(c.green('还需要在 DSH 里登录模型账号，并在「设置 → 会话协作」里添加会话。'));
  out(c.dim('脚本不读取任何凭据；引擎日志位于 data/setup-dsh-*.log 与 data/setup-launch.log。'));
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    out('');
    out(c.red(`部署失败：${error.message}`));
    out(c.dim('已完成的步骤不会回滚；修正问题后可重复运行本脚本。'));
    process.exitCode = 1;
  });
}

export { parseArgs, resolveOptions, run };
