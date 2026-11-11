# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。版本号对应 Git 标签 `v<major>.<minor>.<patch>`。

## [0.1.0] - 2026-11-11

首个公开版本。

### 新增

- **中枢台**：会话栏 + 中心视图，引擎、文件、待办、神经元、网页、记忆、终端按会话启用与排序。
- **场景桌面**：每个会话一块 12 列网格桌面，盒子支持拖拽、缩放、专注、隐藏、收纳与 `Ctrl + S` 保存。
- **引擎托管**：启动时拉起 `dsh web --no-open --port <port>`，抓取 token 地址嵌入 webview，退出时收掉进程树。
- **本地模块**：文件浏览/编辑、多标签网页、终端多开、场景待办、记忆检索、3D 神经元。
- **协作数据**：通过 [dsh-collab](https://github.com/sessionhive/dsh-collab) 读取角色卡、总结、按日记忆、技能与工单。
- **七套主题**：黑、青、蓝、白、绿、粉、紫，自定义主题随存档保存。
- **设置与体检**：引擎路径、终端 shell、文件根目录、技能与工具、核心插件健康检查。

### 文档

- 新增使用流程、DSH 引擎与插件、Agent 一键部署、项目结构四份文档。
- README 补充截图、目录结构、隐私说明与 dsh-collab 安装方式。

### 安全

- 引擎数据默认只读，只扫描场景注册表、角色卡、总结、记忆目录与 `SKILL.md`。
- `.dsh` 目录与 `.credentials.yaml` 不经过文件浏览、预览与写入通道。
- 内嵌页面运行在关闭 Node 集成、开启 sandbox 的 webview 中；外部链接只允许 `http/https`。
- 启动命令中的 token 在写日志前脱敏为 `token=***`。

### 已知限制

- 需要本机已安装并可运行的 DSH 引擎；工作台仓库不包含引擎本体。
- 目前主要面向 Windows 10/11，macOS 与 Linux 未做完整验证。
- 没有内置安装程序；当前版本从源码安装依赖并构建后运行。
- 场景与会话的定位依赖 DSH 侧栏标题匹配，DSH 页面结构变化时可能需要调整。

### 依赖

- Node.js 20 或更高版本。
- DSH 引擎，需包含 `apps/cli/lib/bin.js`。
- [dsh-collab](https://github.com/sessionhive/dsh-collab) `@sessionhive/dsh-collab` 0.1.1（协作功能必装，装在 DSH profile 中）。

[0.1.0]: https://github.com/sessionhive/dsh-workbench/releases/tag/v0.1.0
