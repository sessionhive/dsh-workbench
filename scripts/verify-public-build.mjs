/**
 * 公开构建校验：确保 `npm run build` 的 dist 里没有外部扩展的代码或清单。
 *
 * 检查项：
 * 1. dist 中不出现 local-modules / local.host 等本机扩展入口；
 * 2. 本机扩展的模块名称与 id 没有被编进产物；
 * 3. src/modules/local-modules 与 electron/local 仍被 .gitignore 忽略。
 *
 * 由 `postbuild` 自动执行；失败时退出码非 0，构建命令会报错。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const distDir = path.join(root, 'dist');
const localModuleDir = path.join(root, 'src', 'modules', 'local-modules');
const localRuntimeDir = path.join(root, 'electron', 'local');

const problems = [];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(target, files);
    else files.push(target);
  }
  return files;
}

function readAll(files) {
  return files
    .filter((file) => /\.(js|mjs|css|html|json|map)$/i.test(file))
    .map((file) => {
      try {
        return { file, text: fs.readFileSync(file, 'utf8') };
      } catch {
        return { file, text: '' };
      }
    });
}

if (!fs.existsSync(distDir)) {
  console.error('[verify-public] 找不到 dist，请先执行 npm run build');
  process.exit(1);
}

const distFiles = walk(distDir);
const distText = readAll(distFiles);

const entryMarkers = [
  './local-modules/',
  'local-modules/*.tsx',
  'local-modules/config.ts',
  'local.host.ts',
];

for (const marker of entryMarkers) {
  const hit = distText.find((item) => item.text.includes(marker));
  if (hit) problems.push(`产物包含本机扩展入口 ${marker}：${path.relative(root, hit.file)}`);
}

/** 只截取 manifest 对象本体，避免把文件里其他 name/id（标签、主题、选项）误当模块标识。 */
function readManifest(text) {
  const start = text.search(/manifest\s*:\s*\{/);
  if (start < 0) return '';
  const open = text.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, index + 1);
    }
  }
  return text.slice(open);
}

const externalNames = new Set();
const externalIds = new Set();
if (fs.existsSync(localModuleDir)) {
  for (const file of fs.readdirSync(localModuleDir)) {
    if (!file.endsWith('.tsx')) continue;
    const manifest = readManifest(fs.readFileSync(path.join(localModuleDir, file), 'utf8'));
    if (!manifest) continue;
    for (const match of manifest.matchAll(/name:\s*['"`]([^'"`\n]{2,40})['"`]/g)) {
      externalNames.add(match[1]);
    }
    for (const match of manifest.matchAll(/id:\s*['"`]([a-z][a-z0-9-]*\.[a-z][a-z0-9._-]*)['"`]/g)) {
      externalIds.add(match[1]);
    }
  }
}

for (const name of externalNames) {
  const hit = distText.find((item) => item.text.includes(name));
  if (hit) problems.push(`产物包含外部模块「${name}」：${path.relative(root, hit.file)}`);
}

for (const id of externalIds) {
  const hit = distText.find((item) => item.text.includes(id));
  if (hit) problems.push(`产物包含外部模块 id「${id}」：${path.relative(root, hit.file)}`);
}

try {
  const ignored = execFileSync(
    'git',
    ['check-ignore', '--no-index', 'src/modules/local-modules', 'electron/local'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  )
    .split(/\r?\n/)
    .filter(Boolean);
  if (!ignored.includes('src/modules/local-modules') || !ignored.includes('electron/local')) {
    problems.push(`.gitignore 未完整忽略外部目录：${ignored.join(', ') || '无匹配'}`);
  }
} catch {
  // 不在 Git 仓库里时跳过这一项（发布包所在的源码目录可能没有 .git）。
}

if (problems.length > 0) {
  console.error('[verify-public] 公开构建不干净：');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const summary =
  externalNames.size > 0
    ? `，已排除 ${externalNames.size} 个本机模块名称与 ${externalIds.size} 个模块 id`
    : '';
console.log(`[verify-public] 通过：dist 只包含自研与引擎能力${summary}`);