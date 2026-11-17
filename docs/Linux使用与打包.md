# Linux 使用与打包

提供 Linux x86_64 的 AppImage 与 deb。工作台仍然是 DSH 引擎的外壳：它负责界面、会话桌面、文件、终端和浏览器收纳，DSH 引擎与本机 Node.js 需要单独准备。

## 1. 前提

- Linux x86_64，建议 Ubuntu 22.04+、Debian 12+ 或同代发行版。
- Node.js 20 或更高版本。
- 本机已安装 DSH 引擎，目录下能看到 `apps/cli/lib/bin.js`。
- 引擎数据目录下能看到 `_meta/registry.json`。
- 中文字体。最小安装的发行版可能没有 CJK 字体，界面中文会变成方框；Ubuntu/Debian 可安装 `fonts-noto-cjk`（或文泉驿）。
- 不需要把引擎放进工作台安装目录，工作台通过路径设置或环境变量找到它。

工作台不包含 DSH 引擎、模型凭据、`dsh-collab` 数据和任何第三方模块的代码或资源。

## 2. 安装

### 2.1 AppImage

```bash
chmod +x dsh-workbench-0.2.2-x86_64.AppImage
./dsh-workbench-0.2.2-x86_64.AppImage
```

AppImage 是单文件，不需要安装。想放进应用菜单时，可以配合 AppImageLauncher，或自己创建一个 `.desktop` 文件：

```ini
[Desktop Entry]
Type=Application
Name=DSH Workbench
Exec=/home/you/Apps/dsh-workbench-0.2.2-x86_64.AppImage
Icon=/home/you/Apps/dsh-workbench.png
Terminal=false
Categories=Utility;Development;
```

AppImage 的启动脚本会先用 `unshare -Ur` 检测用户命名空间：可用时保留 Chromium 沙箱；不可用时自动补 `--no-sandbox`，避免直接崩溃。想手动指定时仍然可以：

```bash
./dsh-workbench-0.2.2-x86_64.AppImage --no-sandbox
```

### 2.2 deb

```bash
sudo apt install ./dsh-workbench-0.2.2-amd64.deb
dsh-workbench
```

deb 安装时会检测用户命名空间，必要时给 `chrome-sandbox` 设置 SUID；在 Ubuntu 24+ 上还会尝试安装 AppArmor 配置。若菜单启动报 sandbox 错误，可先升级系统或临时用 `dsh-workbench --no-sandbox` 排查。

卸载：

```bash
sudo apt remove dsh-workbench
```

卸载不会删除 `~/.config/DSH-Workbench` 里的工作台存档，也不会动 DSH 引擎数据。

## 3. 第一次运行

### 3.1 配置引擎路径

打开顶栏右侧设置，切到「引擎」：

| 设置项 | Linux 建议值 |
| --- | --- |
| 引擎安装目录 | `~/DSH/engine`，确认存在 `apps/cli/lib/bin.js` |
| 引擎数据目录 | `~/.dsh`，确认存在 `_meta/registry.json` |
| 工作区目录 | 你的代码目录，例如 `~/code` |
| 文件浏览根目录 | 建议 `~/` 或某个项目目录，不要指向 `/` |
| 技能目录 | 默认 `<数据目录>/skills` |
| 工具目录 | 默认 `~/.config/DSH-Workbench/tools` |

默认值会按安装形态推导：源码运行优先用工作台上一级的 `engines/` 与 `data/.dsh/`（兼容旧的 `engine/`、`engine-data/.dsh`）；安装态优先找 `~/DSH/engine`、`~/dsh/engine`、`~/.dsh`。找不到时仍然可以在设置里手动指定。

也可以完全不改设置，用环境变量启动：

```bash
DSH_ENGINE_DIR="$HOME/DSH/engine" \
DSH_HOME="$HOME/.dsh" \
DSH_PORT=3083 \
./dsh-workbench-0.2.2-x86_64.AppImage
```

### 3.2 确认引擎连接

底栏左侧显示「DSH 引擎已连接」即可。启动时工作台会拉起：

```bash
node <引擎目录>/apps/cli/lib/bin.js web --no-open --port 3083
```

退出工作台会结束这个进程组。若上次异常退出留下同一个引擎占着 3083，工作台会先识别再清理；外部启动的 DSH 或其他服务只提示，不会结束。托管引擎启动时会写入内部标记，即使父进程退出后进程号被 init 收养，也能认出自己的残留进程。

### 3.3 终端

设置 → 终端会探测 Bash、Zsh、Sh，默认优先 Bash。终端盒子支持多开、历史指令和真实 shell；工作目录仍受「引擎 → 工作区目录」约束。

## 4. 从源码运行

适合想跟进代码或自己打包的人。推荐让仓库位于 `<root>/app`，并用一键脚本准备好引擎、数据和插件：

```bash
git clone https://github.com/sessionhive/dsh-workbench.git app
cd app
node scripts/setup.mjs
```

也可以手动安装：

```bash
npm ci
npm run build
npm start
```

`npm start` 使用项目内的 Electron，不要求系统全局安装 Electron。运行时仍然需要本机 Node 与 DSH 引擎；脚本与手动命令的差异见 [一键部署](一键部署.md)。

开发模式：

```bash
npm run dev
```

## 5. 自己打包

```bash
npm run dist:linux
```

产物在 `release/`：

- `dsh-workbench-0.2.2-x86_64.AppImage`
- `dsh-workbench-0.2.2-amd64.deb`

打包配置在 `package.json` 的 `build` 字段，目标是 AppImage + deb，分类 `Utility`，图标使用 `assets/icon.png`。`release/` 不进仓库。

在 Windows 上不推荐直接跨编译 Linux 包。仓库带了 `.github/workflows/linux.yml`：推送 `v*` 标签时，会在 Ubuntu 22.04 上执行 `npm ci`、构建、打包，并把 AppImage/deb 作为 Actions artifact 和 GitHub Release 附件上传。也可以手动触发 `workflow_dispatch` 只取 artifact。

本地用 Docker 构建时，注意不要复用 Windows 的 `node_modules`：

```bash
docker run --rm \
  -v "$PWD:/project" \
  -v dsh-wb-node:/project/node_modules \
  -w /project \
  electronuserland/builder:22 \
  bash -lc "npm ci && npm run dist:linux"
```

## 6. 与 Windows 版的差异

- 终端使用 Bash / Zsh / Sh，不再有 PowerShell、CMD、Git Bash 选项。
- 引擎残留进程通过 `/proc` 识别，不依赖 `ss` 或 `lsof`。
- 安装态的文件根默认收在家目录，不会把 `/` 暴露给文件工作台。
- 工作台状态在 `~/.config/DSH-Workbench/workbench-state.json`。
- 托盘图标按 22px 读取；部分桌面环境需要安装 AppIndicator 扩展才会显示托盘。
- 无边框窗口、透明背景和 `backdrop-filter` 在 Wayland 与部分显卡驱动下可能降级；如果界面发黑或模糊异常，可以尝试用 X11 会话启动。
- 首次启动如果出现 GPU 相关白屏，可临时加 `--disable-gpu` 验证，再检查驱动。

## 7. 常见问题

**提示找不到引擎 CLI。**
检查「设置 → 引擎 → 引擎安装目录」下是否有 `apps/cli/lib/bin.js`。AppImage 不会自带引擎。

**端口 3083 被占用。**
工作台只会清理自己上次留下的同一个 `dsh web`。先用 `ss -ltnp 'sport = :3083'` 确认占用者；如果是外部 DSH，关掉它或用 `DSH_PORT` 换端口。

**终端里没有提示符。**
终端以非登录 shell 启动，不加载 `.bashrc` / `.zshrc` 里的交互配置。需要某个环境变量时，写进工作台启动环境或系统登录环境。

**界面里的中文是方框。**
系统缺少中文字体。Ubuntu/Debian 安装 `sudo apt install fonts-noto-cjk`，Arch 安装 `noto-fonts-cjk`，然后重启工作台。工作台的字体会按 Noto Sans CJK / 思源黑体 / 文泉驿的顺序回退。

**AppImage 双击没反应。**
先在终端运行看报错。常见原因是缺少 FUSE，可安装 `libfuse2`，或使用 `--appimage-extract-and-run`。

**托盘图标不显示。**
GNOME 默认不显示传统托盘，需要 AppIndicator/KStatusNotifier 扩展；这不影响主窗口和关闭到托盘的行为。

## 8. 安全边界

Linux 版沿用同一套边界：

- 不读取或暴露引擎 `.credentials.yaml`。
- 引擎读取仅限会话注册表、角色卡、总结、记忆与 `SKILL.md` 白名单。
- 写入仅限角色卡与 `SKILL.md`。
- 内嵌页面关闭 Node 集成并开启 sandbox。
- 外部链接只允许 `http/https`。
- 日志中的 token 仍然脱敏为 `token=***`。
