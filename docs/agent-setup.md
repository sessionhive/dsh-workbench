# Agent 一键部署

这是一份给 AI Agent 执行的操作说明。目标是在一台 Windows 机器上，从空目录开始，把 DSH 中枢工作台跑起来，装上 dsh-collab（npm 包 `@sessionhive/dsh-collab`，仓库 <https://github.com/sessionhive/dsh-collab>），并完成可验证的验收。

> 如果你是把任务交给另一个 Agent，直接把下面这段话连同本文件一起发给它：
>
> “请按 `docs/agent-setup.md` 在 Windows 上部署 DSH 中枢。先做预检，缺少引擎或路径时停下来问我；不要读取或提交 `.credentials.yaml`；不要杀死不是我启动的进程；安装完成后启动客户端并告诉我验收结果。”

## 1. 执行契约

### 1.1 目标产物

- 工作台仓库在 `-AppDir` 指定的目录，依赖已安装，`dist/` 已构建。
- DSH 引擎能被工作台托管拉起，端口 `-Port`（默认 `3083`）可访问。
- dsh-collab（<https://github.com/sessionhive/dsh-collab>，npm 包 `@sessionhive/dsh-collab`）已装进正确的 DSH profile，并在 `cordis.patch.yml` 登记。
- 引擎重启后，工作台状态栏显示「DSH 引擎已连接」。
- 工作台「设置 → 体检 → 核心插件」没有 fail；DSH 侧自检通过。

### 1.2 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `-AppDir` | `%USERPROFILE%\DSH\workbench` | 工作台仓库目录 |
| `-RepoUrl` | `https://github.com/sessionhive/dsh-workbench.git` | 仓库地址 |
| `-EngineDir` | 从 `DSH_ENGINE_DIR` 或 `AppDir` 的上级推导 | 必须包含 `apps/cli/lib/bin.js` |
| `-DshHome` | 从 `DSH_HOME` 或 `AppDir` 的上级推导 | 必须包含 `_meta/registry.json` |
| `-ProfileDir` | 自动探测 | 必须包含 `cordis.patch.yml` |
| `-Port` | `3083` | 引擎端口 |
| `-SkipLaunch` | 关闭 | 只安装，不启动客户端 |

### 1.3 硬性规则

- **不要读取、复制、提交 `.credentials.yaml`。**
- 不要删除 `DshHome`、profile 或工作台状态文件。
- 不要用全局 `npm install -g`，也不要把依赖装到系统目录。
- 不要杀死不是本次启动的 Electron、Node 或 `dsh web` 进程。
- 端口被占用时停下来问用户，或换 `-Port`，不要直接杀进程。
- 不要 `git push`；不要提交任何本地状态、截图或引擎数据。
- 改 `cordis.patch.yml` 前先备份；不要重复插入同一个插件条目。
- 需要管理员权限时先停下来说明原因，不要静默提权。

### 1.4 停止条件

遇到以下情况，停止并询问用户，不要猜：

- 找不到 `apps/cli/lib/bin.js` 或 `_meta/registry.json`。
- 找到多个 profile，且没有 `-ProfileDir`。
- `cordis.patch.yml` 已有 `@sessionhive/dsh-collab`，但 `dataRoot` 与预期不一致。
- `cordis.patch.yml` 不是可追加的 YAML 列表结构。
- 工作台仓库有未提交改动，且不是本次安装造成的。
- 端口被一个不是本次启动的进程占用。

## 2. 预检

Agent 先执行并记录结果：

```powershell
node -v
npm -v
git --version
$PSVersionTable.PSVersion
```

要求：

- Node.js `>= 20`。
- npm 可用。
- Git 可用。
- PowerShell 5.1 或 7。

确认 DSH 引擎：

```powershell
Test-Path "<EngineDir>\apps\cli\lib\bin.js"
Test-Path "<DshHome>\_meta\registry.json"
```

两个都必须是 `True`。如果不是，说明 DSH 没装好，或路径填错；按 [engine-and-plugins.md](engine-and-plugins.md) 的目录约定与用户确认。

检查端口：

```powershell
Get-NetTCPConnection -LocalPort 3083 -State Listen -ErrorAction SilentlyContinue
```

有结果就记录下来，启动前再处理。

## 3. 执行脚本

以下脚本是幂等的：已克隆、已安装、已登记时会跳过对应步骤。它不会自动删除数据，也不会杀未知进程。

把脚本保存为 `setup-workbench.ps1`，然后运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-workbench.ps1 `
  -AppDir "D:\DSH\workbench" `
  -EngineDir "D:\DSH\engine" `
  -DshHome "D:\DSH\engine-data\.dsh"
```

```powershell
param(
  [string]$RepoUrl = 'https://github.com/sessionhive/dsh-workbench.git',
  [string]$AppDir = (Join-Path $env:USERPROFILE 'DSH\workbench'),
  [string]$EngineDir = $env:DSH_ENGINE_DIR,
  [string]$DshHome = $env:DSH_HOME,
  [string]$ProfileDir = '',
  [int]$Port = 3083,
  [switch]$SkipLaunch
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "== $Message" -ForegroundColor Cyan
}

function Stop-WithError([string]$Message) {
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

function Test-PortListening([int]$Number) {
  $listener = Get-NetTCPConnection -LocalPort $Number -State Listen -ErrorAction SilentlyContinue
  return [bool]$listener
}

# ---------- 0. 基本工具 ----------
Write-Step '检查 Node / npm / Git'
foreach ($command in @('node', 'npm', 'git')) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    Stop-WithError "找不到 $command，请先安装并加入 PATH"
  }
}
$nodeVersion = (& node -v).TrimStart('v')
if ([int]($nodeVersion.Split('.')[0]) -lt 20) {
  Stop-WithError "Node.js 版本过低：$nodeVersion，需要 >= 20"
}

# ---------- 1. 推导引擎路径 ----------
Write-Step '推导 DSH 引擎与数据目录'
$parent = Split-Path -Parent $AppDir
if (-not $EngineDir) {
  $candidate = Join-Path $parent 'engine'
  if (Test-Path (Join-Path $candidate 'apps\cli\lib\bin.js')) { $EngineDir = $candidate }
}
if (-not $DshHome) {
  $candidate = Join-Path $parent 'engine-data\.dsh'
  if (Test-Path (Join-Path $candidate '_meta\registry.json')) { $DshHome = $candidate }
}
if (-not $EngineDir) { Stop-WithError '找不到引擎目录，请传 -EngineDir' }
if (-not $DshHome) { Stop-WithError '找不到 DSH 数据目录，请传 -DshHome' }

$EngineDir = (Resolve-Path $EngineDir).Path
$DshHome = (Resolve-Path $DshHome).Path
if (-not (Test-Path (Join-Path $EngineDir 'apps\cli\lib\bin.js'))) {
  Stop-WithError "引擎目录不完整：$EngineDir 缺少 apps\cli\lib\bin.js"
}
if (-not (Test-Path (Join-Path $DshHome '_meta\registry.json'))) {
  Stop-WithError "数据目录不完整：$DshHome 缺少 _meta\registry.json"
}
Write-Host "EngineDir = $EngineDir"
Write-Host "DshHome   = $DshHome"

if (Test-PortListening $Port) {
  Stop-WithError "端口 $Port 已被占用。请先关闭外部 DSH，或改用 -Port 指定其他端口"
}

# ---------- 2. 克隆或更新仓库 ----------
Write-Step '准备工作台仓库'
if (Test-Path (Join-Path $AppDir '.git')) {
  $dirty = git -C $AppDir status --porcelain
  if ($dirty) {
    Stop-WithError "仓库有未提交改动：$AppDir。请先处理，再重新运行"
  }
  git -C $AppDir pull --ff-only
} elseif (Test-Path $AppDir) {
  Stop-WithError "目标目录已存在但不是 Git 仓库：$AppDir"
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $AppDir) | Out-Null
  git clone $RepoUrl $AppDir
}

# ---------- 3. 安装与构建 ----------
Write-Step '安装依赖并构建'
Push-Location $AppDir
try {
  if (Test-Path 'package-lock.json') {
    npm ci
  } else {
    npm install
  }
  npm run build
} finally {
  Pop-Location
}

# ---------- 4. 探测 DSH profile ----------
Write-Step '探测 DSH profile'
$profilesRoot = Join-Path $DshHome 'profiles'
if (-not (Test-Path $profilesRoot)) {
  Stop-WithError "找不到 profiles 目录：$profilesRoot。请确认 DSH 版本与数据目录"
}
if ($ProfileDir) {
  $ProfileDir = (Resolve-Path $ProfileDir).Path
  if (-not (Test-Path (Join-Path $ProfileDir 'cordis.patch.yml'))) {
    Stop-WithError "指定的 profile 没有 cordis.patch.yml：$ProfileDir"
  }
} else {
  $profiles = @(Get-ChildItem -Path $profilesRoot -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName 'cordis.patch.yml') })
  if ($profiles.Count -eq 0) {
    Stop-WithError "没有找到包含 cordis.patch.yml 的 profile：$profilesRoot"
  }
  if ($profiles.Count -gt 1) {
    $names = ($profiles | ForEach-Object { $_.Name }) -join ', '
    Stop-WithError "找到多个 profile（$names），请用 -ProfileDir 指定"
  }
  $ProfileDir = $profiles[0].FullName
}
Write-Host "ProfileDir = $ProfileDir"

# ---------- 5. 安装 dsh-collab ----------
# 插件必须来自 https://github.com/sessionhive/dsh-collab
# npm 包：@sessionhive/dsh-collab。不要安装名称相近的其他包。
Write-Step '安装 @sessionhive/dsh-collab'
$pluginVersion = '0.1.1'
$pluginDir = Join-Path $ProfileDir 'node_modules\@sessionhive\dsh-collab'
$pluginManifest = Join-Path $pluginDir 'package.json'
if (-not (Test-Path $pluginManifest)) {
  Push-Location $ProfileDir
  try {
    $usesPnpm = (Test-Path 'pnpm-lock.yaml') -or (Test-Path 'pnpm-workspace.yaml')
    if ($usesPnpm) {
      if (Get-Command pnpm -ErrorAction SilentlyContinue) {
        pnpm add "@sessionhive/dsh-collab@$pluginVersion"
      } else {
        corepack pnpm add "@sessionhive/dsh-collab@$pluginVersion"
      }
    } else {
      npm install "@sessionhive/dsh-collab@$pluginVersion" --no-audit --no-fund
    }
  } finally {
    Pop-Location
  }
} else {
  Write-Host '插件已存在，跳过安装'
}
if (-not (Test-Path $pluginManifest)) {
  Stop-WithError '插件安装后仍找不到 package.json，请检查 profile 的包管理器'
}

# ---------- 6. 登记到 cordis.patch.yml ----------
Write-Step '登记插件配置'
$patchPath = Join-Path $ProfileDir 'cordis.patch.yml'
$existing = if (Test-Path $patchPath) {
  Get-Content -Path $patchPath -Raw -Encoding UTF8
} else {
  ''
}
if ($existing -match '@sessionhive/dsh-collab') {
  Write-Host 'cordis.patch.yml 已包含 dsh-collab，跳过写入'
  Write-Host '请人工确认 config.dataRoot 指向：'
  Write-Host "  $DshHome"
} else {
  $dataRootYaml = $DshHome.Replace('\', '/').Replace("'", "''")
  $block = @"

- insert:
    - id: workbench-core
      name: '@sessionhive/dsh-collab'
      config:
        dataRoot: '$dataRootYaml'
"@
  if ($existing.Length -gt 0) {
    $backup = "$patchPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item -Path $patchPath -Destination $backup
    Write-Host "已备份：$backup"
    if (-not $existing.EndsWith("`n")) { $existing += "`r`n" }
  }
  $newText = $existing + $block.TrimStart("`r", "`n") + "`r`n"
  [System.IO.File]::WriteAllText($patchPath, $newText, [System.Text.UTF8Encoding]::new($false))
  Write-Host "已写入：$patchPath"
}

# ---------- 7. 启动并等待引擎 ----------
if ($SkipLaunch) {
  Write-Step '已跳过启动（-SkipLaunch）'
  exit 0
}

Write-Step '启动工作台'
$env:DSH_ENGINE_DIR = $EngineDir
$env:DSH_HOME = $DshHome
$env:DSH_PORT = "$Port"
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { $npm = (Get-Command npm).Source }
Start-Process -FilePath $npm -ArgumentList 'start' -WorkingDirectory $AppDir -WindowStyle Hidden

$deadline = (Get-Date).AddSeconds(75)
$ready = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  if (Test-PortListening $Port) { $ready = $true; break }
}
if (-not $ready) {
  Stop-WithError "引擎在 75 秒内没有监听端口 $Port。请在工作台目录前台运行 npm start 查看日志"
}

# ---------- 8. 汇总 ----------
Write-Step '部署完成，验收信息'
Write-Host "AppDir     = $AppDir"
Write-Host "EngineDir  = $EngineDir"
Write-Host "DshHome    = $DshHome"
Write-Host "ProfileDir = $ProfileDir"
Write-Host "Port       = $Port"
Write-Host "插件目录   = $pluginDir"
Write-Host ""
Write-Host '请在工作台里确认：'
Write-Host '1. 底栏显示“DSH 引擎已连接”'
Write-Host '2. 设置 → 体检 → 核心插件没有 fail'
Write-Host '3. DSH 设置 → 会话协作可见'
Write-Host '4. 协作看板可以打开'
```

## 4. 手动验收

脚本只保证“进程、路径、文件”到位，界面还需要看一眼：

1. 工作台底栏左侧显示引擎场景数量，右侧显示「DSH 引擎已连接」。
2. 「设置 → 体检」里：
   - 工作台运行时：ok
   - 模块注册表：ok
   - 路径：引擎安装目录、数据目录、工作区都存在
   - 核心插件：没有 fail；`collab/` 为空可以是 warn
3. DSH 页面里「设置 → 会话协作」能打开。
4. 打开一次协作看板 `/plugins/workbench-core/board`。
5. 新建一个场景会话，进入场景桌面，添加一个「文件」盒子和一个「终端」盒子，按 `Ctrl + S` 保存后重启客户端，布局应还在。

## 5. 重跑与回滚

重跑脚本是安全的：

- 仓库已存在时只做 `git pull --ff-only`，有未提交改动会停下；
- 依赖已存在时仍会执行 `npm ci`/`npm install` 与构建；
- 插件已存在时跳过安装；
- `cordis.patch.yml` 已登记时跳过写入，只提示人工核对 `dataRoot`。

回滚：

1. 退出工作台。
2. 用 `cordis.patch.yml.bak-*` 恢复 profile 配置。
3. 在 profile 里卸载 `@sessionhive/dsh-collab`。
4. 重启引擎。
5. 不要删除 `DshHome`，除非用户明确要求；插件数据默认保留。

## 6. 常见故障

| 现象 | 处理 |
| --- | --- |
| `npm ci` 失败 | 确认 Node >= 20；检查网络/代理；不要直接删 `node_modules`，先问用户 |
| Electron 下载失败 | 可设置 `ELECTRON_MIRROR` 后重试；不要全局安装 Electron |
| 找不到引擎 CLI | 检查 `-EngineDir` 是否包含 `apps/cli/lib/bin.js` |
| 找不到数据目录 | 检查 `-DshHome` 是否包含 `_meta/registry.json` |
| 端口被占用 | 关闭外部 DSH，或用 `-Port` 换端口；不要杀未知进程 |
| 引擎启动超时 | 在前台运行 `npm start` 看日志；检查 `DSH_NODE` 与原生模块 ABI |
| 插件没加载 | 检查 profile、`cordis.patch.yml` 缩进、包目录；重启引擎 |
| 体检核心插件 warn | 首次派单前 `collab/` 为空是正常；自检通过即可 |
| 工作台白屏 | 检查 `dist/` 是否构建；开发态用 `npm run dev` |

## 7. 交付给用户时说明

- 工作台仓库位置与启动命令。
- 引擎目录、数据目录、profile 目录和端口。
- 插件版本。
- 哪些检查通过，哪些是 warn。
- 是否有任何步骤需要用户手动处理。
- 不要贴出引擎 token、账号余额、角色记忆或 `.credentials.yaml` 内容。
