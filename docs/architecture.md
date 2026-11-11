# 项目结构

这篇文档写给想改代码或做二次开发的人。它说明进程怎么分层、状态怎么流动、模块怎么装配，以及哪些边界是刻意保留的安全约束。

## 1. 技术栈

- Electron 38：窗口、托盘、单实例锁、IPC、终端子进程、引擎托管。
- React 19 + TypeScript：界面、场景桌面、模块渲染。
- Vite 6：开发服务器与生产构建。
- 无 UI 组件库、无状态管理库；状态集中在 `App.tsx`，通过 props 和模块动作下发。

## 2. 进程模型

```text
Electron main (electron/main.cjs)
├─ BrowserWindow（无边框窗口）
│  └─ preload.cjs（contextBridge，白名单 IPC）
│     └─ React renderer
│        ├─ 中枢台
│        ├─ 场景桌面 / 盒子
│        └─ sandboxed webview（DSH Harness 页面）
├─ DSH 引擎子进程（dsh web --no-open --port 3083）
└─ 终端 shell 子进程（每个终端盒子一个常驻 shell）
```

### 2.1 主进程

`electron/main.cjs` 负责：

- 创建窗口、托盘、单实例锁、关闭到托盘；
- 加载 `dist/` 或开发服务器；
- 托管 DSH 引擎：启动、抓取地址、脱敏日志、退出清理；
- 文件沙箱：`fs:list` / `fs:preview` / `fs:write` / `fs:resolve`；
- 引擎文档读写：`engine:doc-read` / `engine:doc-write` / `engine:skills` / `engine:skill-doc`；
- 终端：`terminal:start` / `terminal:exec` / `terminal:kill`；
- 体检、系统指标、计费快照、窗口控制。

主进程不读取模型凭据，不代理模型调用，也不直接操作引擎内部会话。

### 2.2 Preload

`electron/preload.cjs` 用 `contextBridge` 暴露一个窄接口 `window.desktop`。渲染层拿不到 Node、`require` 或任意 IPC 通道；每个能力都要在主进程显式注册。

### 2.3 渲染层

`src/App.tsx` 是状态中心：

- `sessions`：会话、场景绑定、模块实例、桌面盒子；
- `settings`：主题、引擎路径、终端 shell、关闭行为；
- `customTemplates`：自定义模板；
- `selectedId`、`railCollapsed`、`sceneShelf`：界面态。

状态变更后 500ms 防抖写回 `workbench-state.json`。模块运行时状态只有在模块声明 `persistState: true` 时才进入存档。

### 2.4 内嵌页面

DSH Harness 页面运行在关闭 Node 集成、开启 sandbox 的 webview 里：

- 外链只允许 `http/https`，交给系统浏览器；
- 导航和 `window.open` 有守卫；
- 引擎 token 只在内存中传入 URL，不写日志。

## 3. 目录结构

```text
electron/
  main.cjs              主进程入口：窗口、托盘、IPC、沙箱、体检
  preload.cjs           contextBridge 白名单
  engine-manager.cjs    引擎进程生命周期
src/
  App.tsx               状态中心、视图切换、全局快捷键
  board/                场景桌面：网格、盒子壳、拖拽/缩放、专注模式
  components/           顶栏、底栏、会话栏、详情、设置、弹窗
  modules/              模块注册表、宿主、运行时
    builtin/            文件、待办、网页、终端、记忆、神经元、DSH 引擎
  hooks/                引擎数据、进程状态、计费、系统指标、长按排序
  engine/               引擎数据类型、场景绑定、峰谷时段
  terminal/             终端运行时与类型
  neuron/               3D 神经元的渲染数据
  styles.css            全局样式、主题变量、布局
assets/                 图标
dist/                   构建产物（不提交）
```

## 4. 模块系统

模块是“挂在会话上的能力实例”，不是全局页面。

### 4.1 清单

每个模块提供 `ModuleManifest`：

```ts
interface ModuleManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: IconName;
  kind: ModuleKind[];
  slots: SlotId[];
  category?: ModuleCategory;
  permissions?: ModulePermission[];
  persistState?: boolean;
}
```

槽位目前有：

- `center.view`：中心视图页签；
- `detail.block`：会话详情块；
- `command.action`：指令面板动作（预留）；
- `rail.widget`：会话栏小组件（预留）；
- `status.item`：状态栏项（预留）。

### 4.2 实例

会话里的模块是 `ModuleInstance`：

```ts
interface ModuleInstance {
  moduleId: string;
  enabled: boolean;
  order: number;
  slotOrders?: Partial<Record<SlotId, number>>;
  config: Record<string, unknown>;
}
```

启停、排序和配置属于实例；停用模块不会删除它的桌面盒子，盒子会显示“会话已停用”，可通过「盒子设置」重新启用。

### 4.3 宿主边界

模块不直接持有工作台状态，只通过宿主提供的 `ModuleActions` 和 `ModuleViewProps` 工作：

- `selectSession`、`openSession`、`dispatchTask`；
- `notify`；
- `openSettings`、`openNewSession`、`openModuleDrawer`；
- `updateState` 用于模块自己的持久化状态。

这条边界保证模块不能随意改别的会话或全局设置。

## 5. 场景桌面

场景桌面是每个会话的一块 12 列网格：

- 行高固定，模块按 `x/y/w/h` 定位；
- 盒子可以移动、缩放、隐藏、删除、专注；
- 碰撞检测与落底规则在 `src/board/SceneBoard.tsx`；
- 布局保存在 `session.board.tiles`；
- 场景标签的「收纳」只影响桌面标签栏，不改变会话栏；
- 拖动到画布上下边缘会持续自动滚动，指针离开画布也能继续收尾。

## 6. IPC 一览

| 通道 | 作用 |
| --- | --- |
| `state:load` / `state:save` | 工作台状态存档 |
| `fs:list` / `fs:preview` / `fs:write` / `fs:resolve` | 文件沙箱 |
| `engine:scan` | 扫描场景注册表 |
| `engine:doc-read` / `engine:doc-write` | 角色卡、总结、记忆等白名单文档 |
| `engine:skills` / `engine:skill-doc` | 技能列表与 `SKILL.md` 预览 |
| `engine:start` / `engine:restart` / `engine:status` | 托管引擎进程 |
| `cost:snapshot` | 计费账本快照 |
| `health:check` | 上传体检项 |
| `terminal:shells` / `terminal:start` / `terminal:exec` / `terminal:kill` | 终端 |
| `window:*` | 窗口控制 |
| `app:set-close-to-tray` | 关闭行为 |
| `shell:open-external` / `shell:open-path` | 系统浏览器/资源管理器 |
| `path:pick-directory` / `workspace:pick-root` / `engine:pick-root` | 目录选择 |

## 7. 状态与存档

存档文件：

```text
%APPDATA%/DSH-Workbench/workbench-state.json
```

写不进去时退回项目内 `.data/workbench-state.json`。可以用 `--state-dir` 或 `DSH_STATE_DIR` 覆盖，便于做隔离演示和截图。

存档包含：

- `version`（当前为 3）；
- `sessions`：身份、场景绑定、模块实例、模块状态、桌面盒子；
- `settings`：主题、密度、引擎路径、终端 shell、关闭行为；
- `customTemplates`；
- `railCollapsed`、`selectedId`、`sceneShelf`。

不包含引擎凭据、模型 key、账号余额。

## 8. 安全边界

- 引擎数据默认只读；只有 `agents/<id>/card.json` 和 `skills/<id>/SKILL.md` 允许写回。
- 文件浏览、预览、写入全部限制在设置的文件根目录内，`..` 穿越会被拒绝。
- `.dsh` 目录与 `.credentials.yaml` 不经过文件通道。
- 引擎命令里的 token 写日志前脱敏为 `token=***`。
- webview 关闭 Node 集成并开启 sandbox。
- 终端 shell 由用户选择的根目录决定，不写死机器路径。
- 单实例锁避免两个工作台抢同一个状态文件与端口。

## 9. 构建与发布

```bash
npm run dev        # Vite + Electron，热更新
npm run typecheck  # 只做类型检查
npm run build      # tsc --noEmit + vite build
npm start          # 启动已构建客户端
npm run shot       # 启动并截图到 shot.png
```

`dist/`、`node_modules/`、`.data/`、日志和截图都在 `.gitignore` 里，不应提交。

## 10. 已知限制

- 主要面向 Windows；macOS/Linux 的托盘、shell 探测和快捷方式脚本未完整验证。
- 场景与 Harness 会话的定位依赖标题匹配，DSH 页面结构大改时可能需要重新绑定。
- 没有内置安装包；分发安装器需要自行接入 electron-builder 等工具。
- 引擎是外部依赖；没有引擎时外壳可以启动，但引擎视图与场景数据为空。
