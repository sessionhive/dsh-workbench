#Requires -Version 5.1
<#
  check-package.ps1 — Workbench 打包配置与产物校验

  用法：
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-package.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-package.ps1 -Unpacked ..\release\win-unpacked
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-package.ps1 -Unpacked ..\release\win-unpacked -Strict

  检查项：
    1. electron-builder 的 files 只允许 dist / electron / assets / package.json
    2. extraResources / extraFiles 不得指向运行期数据或外部内容
    3. -Unpacked 时扫描安装目录，不得出现 engine* / data / workspace / projects /
       agents / collab / attachments / backups / third-party
    4. 平台 target 是否齐全（-Strict 时缺 win 视为失败）
#>
[CmdletBinding()]
param(
  [string]$Unpacked = '',
  [switch]$Strict
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$pkgPath = Join-Path $root 'package.json'
if (-not (Test-Path $pkgPath)) { throw "找不到 $pkgPath" }

$pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$build = $pkg.build
if (-not $build) { throw 'package.json 里没有 build 配置（electron-builder）' }

$problems = New-Object System.Collections.ArrayList
function Bad([string]$msg) { [void]$problems.Add($msg); Write-Host "[check-package] FAIL  $msg" -ForegroundColor Red }
function Pass([string]$msg) { Write-Host "[check-package] OK    $msg" -ForegroundColor Green }
function Warn([string]$msg) { Write-Host "[check-package] WARN  $msg" -ForegroundColor Yellow }

$allowedRoots = @('dist', 'electron', 'assets')
$forbiddenPattern = '(^|/)(node_modules|engine|engine-next|engine-data|data|workspace|projects|agents|collab|attachments|backups|third-party|tmp|local-tts)(/|$)'

# ---- 1. files 白名单 ----
$files = @($build.files)
if ($files.Count -eq 0) {
  Bad 'build.files 为空，electron-builder 会默认打包整个目录（危险）'
} else {
  Write-Host "[check-package] build.files = $($files -join ', ')"
  $extra = @()
  foreach ($f in $files) {
    if ($f -match $forbiddenPattern) { Bad "files 里出现禁入路径：$f"; continue }
    $head = ($f -split '/')[0]
    if ($head -notin $allowedRoots -and $f -ne 'package.json') { $extra += $f }
  }
  if ($extra.Count -gt 0) {
    Warn "files 里有白名单外的条目，确认是必要的：$($extra -join ', ')"
  }
  if ($problems.Count -eq 0) { Pass 'files 白名单干净（无运行期数据目录）' }
}

# ---- 2. extraResources / extraFiles ----
foreach ($key in @('extraResources', 'extraFiles')) {
  $val = $build.$key
  if (-not $val) { continue }
  foreach ($item in @($val)) {
    $src = if ($item -is [string]) { $item } else { $item.from }
    if ($src -match $forbiddenPattern) {
      Bad "$key 指向了运行期数据：$src"
    } else {
      Warn "$key 额外打入：$src（确认安装包需要它）"
    }
  }
}

# ---- 3. 平台 target ----
$targets = @()
foreach ($p in @('win', 'linux', 'mac')) {
  if ($build.$p -and $build.$p.target) { $targets += "$p($(@($build.$p.target) -join ','))" }
}
if ($targets.Count -eq 0) {
  Warn '没有配置任何平台 target，将使用 electron-builder 默认值'
} else {
  Write-Host "[check-package] target = $($targets -join ' | ')"
}
if (-not $build.win) {
  if ($Strict) { Bad '未配置 win target（-Strict）' } else { Warn '未配置 win target，Windows 打包会走默认配置' }
}

if ($build.asar -ne $true) { Warn 'asar 未开启，源码会明文进安装包' } else { Pass 'asar 已开启' }

# ---- 4. 产物扫描 ----
if ($Unpacked) {
  if (-not (Test-Path $Unpacked)) {
    Bad "产物目录不存在：$Unpacked"
  } else {
    $unpackedPath = (Resolve-Path $Unpacked).Path
    Write-Host "[check-package] 扫描产物 $unpackedPath"
    $badNames = @('engine', 'engine-next', 'engine-data', 'data', 'workspace', 'projects',
      'agents', 'collab', 'attachments', 'backups', 'third-party', 'local-tts')
    $hits = @(Get-ChildItem -Path $unpackedPath -Directory -Recurse -Depth 2 -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -in $badNames })
    if ($hits.Count -gt 0) {
      $hits | ForEach-Object { Write-Host "        外部内容: $($_.FullName)" -ForegroundColor Red }
      Bad "产物里出现 $($hits.Count) 个不该有的目录"
    } else {
      Pass '产物内无运行期数据目录'
    }

    $asar = Get-ChildItem -Path $unpackedPath -Filter 'app.asar' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($asar) { Pass "找到 app.asar（$([math]::Round($asar.Length / 1MB, 1)) MB）" }
  }
}

Write-Host ''
if ($problems.Count -gt 0) {
  Write-Host "[check-package] 共 $($problems.Count) 项问题，禁止发布" -ForegroundColor Red
  exit 1
}
Pass "全部通过：$($pkg.name) $($pkg.version)"
exit 0
