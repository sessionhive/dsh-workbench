$ErrorActionPreference = 'Stop'

# 在桌面创建启动快捷方式。所有路径都从脚本所在目录推导，仓库可以放在任意位置。
$root = $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$icon = Join-Path $root 'assets\icon.ico'

if (-not (Test-Path $electron)) {
  throw '未找到 Electron。请先在项目目录执行 npm install。'
}
if (-not (Test-Path $icon)) {
  throw '未找到 assets\icon.ico。'
}
if (-not (Test-Path (Join-Path $root 'dist\index.html'))) {
  Write-Warning '尚未构建前端，请先执行 npm run build，否则启动后是空白窗口。'
}

$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$name = "DSH " + [char]0x4E2D + [char]0x67A2
$description = "DSH " + [char]0x4E2D + [char]0x67A2 + " " + [char]0x00B7 + " " + [char]0x96C6 + [char]0x6210 + [char]0x5DE5 + [char]0x4F5C + [char]0x53F0
$lnk = $shell.CreateShortcut((Join-Path $desktop ($name + '.lnk')))
$lnk.TargetPath = $electron
$lnk.Arguments = '"' + $root + '"'
$lnk.WorkingDirectory = $root
$lnk.IconLocation = $icon + ',0'
$lnk.Description = $description
$lnk.Save()
Write-Output ('created: ' + (Join-Path $desktop ($name + '.lnk')))
