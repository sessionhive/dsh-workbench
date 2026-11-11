# DSH 中枢 · 集成工作台

一个围绕 DSH 引擎的本地桌面工作台：Electron 负责窗口、终端、文件与系统能力，React 负责场景桌面、盒子布局和模块装配。它不是聊天客户端的替代品，而是把 DSH 的会话、记忆、技能与本机工具投射到一块可编排的桌面上。

![中枢台 · 文件工作台](docs/screenshots/workbench-hub.png)

- 代码仓库：<https://github.com/sessionhive/dsh-workbench>
- 完整文档：[docs/README.md](docs/README.md)
- 协作插件：[sessionhive/dsh-collab](https://github.com/sessionhive/dsh-collab)

> 仓库只包含工作台外壳，不包含 DSH 引擎本体。使用前需要本机已安装 DSH，并能找到它的 CLI 与数据目录。

## 功能一览

- **中枢台**：左侧会话栏 + 中心视图。引擎、文件、待办、神经元、网页、记忆、终端按会话启用和排序。
- **场景桌面**：每个会话一块 12 列网格桌面，用盒子自由拼装；支持拖拽、缩放、专注、隐藏、收纳和 `Ctrl + S` 保存。
- **引擎托管**：启动时拉起 `dsh web --no-open --port 3083`，抓取 token 地址并嵌入 webview，退出时收掉进程树。
- **本地工具**：文件浏览/编辑、多标签网页、终端多开、场景待办、记忆检索、3D 神经元。
- **协作数据**：通过 dsh-collab 读取角色卡、总结、按日记忆、技能与工单，并接受只读边界约束。
- **七套主题**：黑、青、蓝、白、绿、粉、紫，自定义主题随存档保存。

## 环境要求

- Windows 10 / 11（当前主要目标平台；托盘、快捷方式和部分终端探测是 Windows 优先）
- Node.js 20 或更高版本
- 已安装并可运行的 DSH 引擎
- 首次安装依赖需要网络

## 快速开始

推荐把仓库克隆为 `<root>/workbench`，并让 `<root>/engine` 与 `<root>/engine-data/.dsh` 分别存在：

```powershell
mkdir D:\DSH
cd D:\DSH
git clone https://github.com/sessionhive/dsh-workbench.git workbench
cd workbench
npm install
npm run build
npm start
```

`npm start` 需要先有 `dist/` 构建产物。开发时用：

```powershell
npm run dev
```

开发模式会启动 Vite（127.0.0.1:5173）并拉起 Electron，改前端代码自动热更新。

## 配置引擎路径

工作台不写死任何机器路径。第一次启动时按“程序所在位置”推导默认值，也可以在设置面板的「引擎」页签里逐项覆盖。默认布局（以仓库位于 `<root>/workbench` 为例）：

| 用途 | 默认位置 |
| --- | --- |
| 引擎安装目录 | `<root>/engine`（需包含 `apps/cli/lib/bin.js`） |
| 引擎数据目录 | `<root>/engine-data/.dsh`（需包含 `_meta/registry.json`） |
| 工作区目录 | `<root>/workspace` |
| 文件浏览根目录 | `<root>` |
| 技能目录 | `<dataPath>/skills` |
| 工具目录 | `<root>/tools` |

也可以不移动目录，直接用环境变量指定：

```powershell
$env:DSH_ENGINE_DIR = "D:\DSH\engine"
$env:DSH_HOME = "D:\DSH\engine-data\.dsh"
$env:DSH_PORT = "3083"
$env:DSH_NODE = "C:\Program Files\nodejs\node.exe"
$env:DSH_STATE_DIR = "D:\DSH\state"   # 可选：覆盖工作台存档目录
```

`npm start` 会自动拉起 `dsh web --no-open --port 3083`，抓取它打印的本地地址并嵌到工作台里；退出时一并收掉该进程。端口被占用时会在界面上提示，可用 `DSH_PORT` 换端口。

更完整的路径、端口和日志说明见 [docs/engine-and-plugins.md](docs/engine-and-plugins.md)。

## 安装 dsh-collab（协作功能必装）

引擎侧的角色卡、总结、按日记忆、技能索引、工单与协作看板都来自 [dsh-collab](https://github.com/sessionhive/dsh-collab)。不装插件时工作台仍可启动，文件、终端、网页和待办可用，但引擎协作相关面板会是空的。

最简方式是在 DSH 的「插件 → Discover」里添加市场索引：

```text
https://cdn.jsdelivr.net/gh/sessionhive/dsh-collab@main/market/index.json
```

然后从 Discover 安装 `dsh-collab`。也可以手动装进 DSH profile 并在 `cordis.patch.yml` 里登记：

```yaml
- insert:
    - id: workbench-core
      name: '@sessionhive/dsh-collab'
      config:
        dataRoot: 'D:/DSH/engine-data/.dsh'
```

安装后重启引擎，工作台底栏显示「DSH 引擎已连接」，再在「设置 → 体检 → 核心插件」确认没有异常。完整步骤、升级、卸载和故障排查见 [docs/engine-and-plugins.md](docs/engine-and-plugins.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [文档索引](docs/README.md) | 先看哪一篇、三分钟路径 |
| [使用流程](docs/usage.md) | 中枢台、场景桌面、盒子、设置与日常流程 |
| [DSH 引擎与插件](docs/engine-and-plugins.md) | 引擎目录约定、托管启动、dsh-collab 安装与验证 |
| [Agent 一键部署](docs/agent-setup.md) | 给 AI Agent 的端到端执行清单与 PowerShell 脚本 |
| [项目结构](docs/architecture.md) | 进程模型、模块系统、IPC、存档与安全边界 |

场景桌面示例：

![场景桌面](docs/screenshots/scene-desktop.png)

## 常用脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | Vite + Electron 开发模式 |
| `npm run build` | 类型检查并构建到 `dist/` |
| `npm run typecheck` | 只做 TypeScript 类型检查 |
| `npm start` | 启动已构建的桌面客户端 |
| `npm run shot` | 启动并截一张图到 `shot.png` |

Windows 下可以运行 `create-shortcut.ps1` 在桌面创建启动快捷方式。脚本从自身位置推导路径，仓库放在哪里都可以，但需要先 `npm install` 和 `npm run build`。

## 数据与隐私

- 工作台自己的状态（会话、布局、主题、路径设置）保存在 `%APPDATA%/DSH-Workbench/workbench-state.json`；无法写入时退回项目内 `.data/`。可用 `--state-dir` 或 `DSH_STATE_DIR` 覆盖。
- 这两个位置都不应提交到仓库，已加入 `.gitignore`。
- 引擎数据默认只读：只扫描场景注册表、角色卡、总结、记忆目录与 `SKILL.md`，只有角色卡和 `SKILL.md` 允许写回。
- `.dsh` 目录与 `.credentials.yaml` 永远不经过文件浏览/预览/写入通道。
- 引擎启动命令里的 token 只在内存中传给内嵌页面，写日志前会脱敏成 `token=***`。
- 内嵌的 DSH 页面运行在关闭 Node 集成、开启 sandbox 的 webview 中；外部链接只允许 `http/https` 并交给系统浏览器。
- 终端、文件浏览和选择目录的权限范围由用户在设置里选择的根目录决定。
- dsh-collab 写入的角色卡、记忆和工单属于引擎数据，备份或迁移前请先退出工作台。

## 目录结构

```
electron/            主进程：窗口、托盘、引擎托管、IPC、文件沙箱、终端
src/
  components/        顶栏、底栏、会话栏、场景桌面、设置等界面
  board/             场景桌面的网格、盒子、拖拽与存档
  modules/           内置模块（引擎、待办、文件、网页、终端、记忆、神经元）
  hooks/             引擎数据、进程状态、计费、系统指标、长按排序
  terminal/          终端运行时（按盒子常驻 shell）
  engine/            引擎数据类型与场景绑定
  styles.css         全局样式与主题变量
docs/                使用流程、插件依赖、Agent 部署、结构说明
assets/              图标
dist/                构建产物（不提交）
```

## 已知限制

- 需要外部的 DSH 引擎；没有引擎时外壳可以启动，终端/文件/网页/待办仍可用，但引擎页与场景数据为空。
- 目前主要面向 Windows；在 macOS / Linux 上托盘、终端 shell 探测和快捷方式脚本未做完整验证。
- 场景与会话的定位依赖 DSH 侧栏标题匹配，DSH 页面结构变化时可能需要调整。
- 没有内置打包安装程序；如需分发安装包，可自行接入 electron-builder 等工具。

## 许可证

本项目使用 [MIT License](LICENSE)。
