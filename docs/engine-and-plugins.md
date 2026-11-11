# DSH 引擎与插件依赖

工作台只带外壳，不带 DSH 引擎本体。要让引擎视图、场景、记忆、技能和协作面板真正可用，本机需要两样东西：

1. 一个可运行的 **DSH 引擎**；
2. 装在 DSH profile 里的 **dsh-collab 插件**（社区插件，非 DeepSeek 官方产品）。

文件、终端、网页、待办这些本地模块不依赖 dsh-collab；但引擎侧的角色卡、记忆归档、技能索引、工单与协作看板都来自它。

## 1. 引擎目录约定

工作台会在启动时拉起：

```text
node <engine>/apps/cli/lib/bin.js web --no-open --port 3083
```

它不读取模型凭据，也不介入模型与工具执行；只负责：

- 找到 CLI；
- 抓取 `dsh web:` 打印出的带 token 地址；
- 把地址交给内嵌页面；
- 退出时用 `taskkill /T /F` 收掉整个进程树。

### 1.1 默认路径

程序根目录的推导规则：

- 开发态：`electron/main.cjs` 的上两级；
- 安装态：可执行文件所在目录。

以仓库位于 `<root>/workbench` 为例：

| 用途 | 默认位置 | 判断标准 |
| --- | --- | --- |
| 引擎安装目录 | `<root>/engine` | 存在 `apps/cli/lib/bin.js` |
| 引擎数据目录 | `<root>/engine-data/.dsh` | 存在 `_meta/registry.json` |
| 工作区 | `<root>/workspace` | 终端/场景的默认 cwd |
| 文件根 | `<root>` | 文件工作台的沙箱边界 |
| 技能目录 | `<dataPath>/skills` | 存在技能子目录或 `SKILL.md` |
| 工具目录 | `<root>/tools` | 工具页签扫描范围 |

路径可以在「设置 → 引擎」里逐项覆盖。环境变量优先级更高：

```powershell
$env:DSH_ENGINE_DIR = "D:\DSH\engine"
$env:DSH_HOME = "D:\DSH\engine-data\.dsh"
$env:DSH_PORT = "3083"
$env:DSH_NODE = "C:\Program Files\nodejs\node.exe"
```

`DSH_NODE` 可选。不设置时，工作台按 `PATH` 找系统 Node；找不到才退回 Electron 自带的 Node 模式。建议使用系统 Node，避免原生模块 ABI 不一致。

### 1.2 托管启动的边界

- 工作台只托管自己拉起的引擎进程。
- 端口 `3083` 已被占用时，工作台会报错，不会去杀外部进程。
- 引擎日志会脱敏 `token=...`，完整地址只在内存里交给内嵌页面。
- 退出工作台会一起收掉引擎；如果你同时用外部 DSH，请不要让两边抢同一个端口。

## 2. dsh-collab 是什么

仓库：<https://github.com/sessionhive/dsh-collab>

它把多个 AI 会话变成可审计的小团队：

- 每个会话有 `card.json`（身份/职责/边界/技能）、`summary.md`（在做/下一步/卡点/指针）和按日期的 `memory/`；
- 写入必须走 `wb_read` / `wb_write`，不直接改状态文件；
- 工单有派单、ack、交接、验收、完成索引和证据校验；
- 提供看板、会话生命周期、技能与模板。

工作台读取它在 DSH 数据目录里写下的：

```text
<dataRoot>/agents/<id>/card.json
<dataRoot>/agents/<id>/summary.md
<dataRoot>/agents/<id>/memory/*.md
<dataRoot>/skills/<id>/SKILL.md
<dataRoot>/collab/...
```

没有插件时，这些位置为空，工作台的记忆、技能、神经元和协作相关面板就没有内容。

## 3. 安装 dsh-collab

dsh-collab 要装进 **DSH profile**，不是工作台仓库。先找到当前引擎使用的 profile：

```text
<DSH_HOME>/
├─ profiles/
│  └─ <profile>/
│     ├─ cordis.patch.yml
│     ├─ cordis.yml
│     ├─ package.json
│     └─ node_modules/
├─ _meta/
├─ agents/
└─ skills/
```

`<DSH_HOME>` 就是工作台设置里的「引擎数据目录」，通常以 `.dsh` 结尾。一个数据目录下可能有多个 profile；要改的是引擎实际加载的那个。判断方法：

- profile 目录里有 `cordis.patch.yml`；
- 引擎启动日志或 DSH 设置里能看到该 profile；
- 只有一个 profile 时直接用那个。

### 方式 A：从 DSH 插件市场安装（推荐）

在 DSH 的「插件 → Discover」里添加市场索引：

```text
https://cdn.jsdelivr.net/gh/sessionhive/dsh-collab@main/market/index.json
```

备用地址：

```text
https://raw.githubusercontent.com/sessionhive/dsh-collab/main/market/index.json
```

之后在 Discover 里找到 `dsh-collab` 一键安装。市场会处理 npm/git 来源和版本，适合不想手改 YAML 的用户。

### 方式 B：在 profile 里安装 npm 包并登记

进入 profile 目录，按它现有的包管理器安装。当前版本以 npm 上的为准，本文写作时是 `0.1.1`：

```powershell
cd "<DSH_HOME>\profiles\<profile>"
npm install @sessionhive/dsh-collab@0.1.1
```

如果 profile 里有 `pnpm-lock.yaml` 或 `pnpm-workspace.yaml`，优先用它，避免 npm 和 pnpm 混用同一份 `node_modules`：

```powershell
cd "<DSH_HOME>\profiles\<profile>"
pnpm add @sessionhive/dsh-collab@0.1.1
```

然后编辑该 profile 的 `cordis.patch.yml`，加入一个 `insert` 条目：

```yaml
- insert:
    - id: workbench-core
      name: '@sessionhive/dsh-collab'
      config:
        dataRoot: 'D:/DSH/engine-data/.dsh'
```

要点：

- `dataRoot` 必须写 **DSH 数据目录的绝对路径**，不是 profile 目录，也不是工作台仓库。
- 同一台机器上多个 DSH 实例可以共用插件源码，但每个实例要给不同的 `dataRoot`，避免数据混在一起。
- `id` 建议保持 `workbench-core`；如果文件里已经有同名条目，只更新它的 `config.dataRoot`，不要再插一份。
- 修改前先备份 `cordis.patch.yml`。
- YAML 的缩进必须保留；Windows 路径建议用正斜杠，或放在单引号里。

### 方式 C：离线 tgz

没有 npm 网络时，可以在任意临时目录打包，再解压到 profile 的 `node_modules`：

```powershell
npm pack @sessionhive/dsh-collab@0.1.1
mkdir "<DSH_HOME>\profiles\<profile>\node_modules\@sessionhive\dsh-collab"
tar -xzf sessionhive-dsh-collab-0.1.1.tgz --strip-components=1 `
  -C "<DSH_HOME>\profiles\<profile>\node_modules\@sessionhive\dsh-collab"
```

同样需要补 `cordis.patch.yml` 的 `insert` 条目。

## 4. 重启与验证

插件在引擎启动时加载，装完必须重启引擎：

1. 完全退出工作台（托盘里也要退出），或重启外部 DSH；
2. 重新 `npm start`；
3. 等状态栏显示「DSH 引擎已连接」。

依次检查：

| 检查点 | 预期 |
| --- | --- |
| DSH 设置 → 会话协作 | 出现协作页签/会话管理界面 |
| DSH 设置 → 一键自检 | 通过；失败项会给出原因 |
| 工作台设置 → 体检 → 核心插件 | `_meta/plugin-manifest.json`、`collab/` 条目、技能索引有结果 |
| 协作看板 | 打开 `/plugins/workbench-core/board` 能看到实时面板 |
| 数据目录 | 出现 `agents/`、`collab/`、`events/` 等目录（首次写入后） |

插件自带自检接口 `/ops/selfcheck`，不依赖工作台外壳；独立 DSH 也能用。日志在 `<dataRoot>/_meta/logs/plugin.log`。

## 5. 升级与卸载

升级：

```powershell
cd "<DSH_HOME>\profiles\<profile>"
npm install @sessionhive/dsh-collab@latest
```

或：

```powershell
pnpm add @sessionhive/dsh-collab@latest
```

升级后重启引擎，再跑一次自检。生产环境建议固定版本，不要直接跟 `latest`。

卸载：

1. 备份 `<dataRoot>`；
2. 从 `cordis.patch.yml` 删除 `workbench-core` 的 `insert` 条目；
3. 从 profile 的依赖里移除包；
4. 重启引擎。

插件数据默认留在 `dataRoot`，不会因为卸载自动删除。确认不再需要后再手动清理。

## 6. 常见问题

**启动后没有「会话协作」页。**
插件没加载。检查 `cordis.patch.yml` 是否在正确的 profile、YAML 是否合法、包是否真的在 `node_modules/@sessionhive/dsh-collab`，然后重启引擎。

**有页面但看板没数据。**
先看 `/ops/selfcheck`。再看 `_meta/config.json` 的 `dataRoot` 是否指向当前 DSH 数据目录；指向错误目录时插件会另建一份空数据。

**工作台体检里核心插件是 warn。**
`warn` 不一定是故障：`collab/` 在第一次派单前本来就是空的，技能索引也可能还没生成。只要自检通过、看板能打开，就可以继续用。

**端口 3083 被占用。**
先确认是不是另一个 DSH 实例。不要直接杀进程；关掉那个实例，或用 `DSH_PORT` 给工作台换端口。

**引擎页面白屏。**
先等插件加载完；仍然白屏时检查插件日志和浏览器控制台。工作台内嵌页面关闭了 Node 集成并开启 sandbox，这是预期行为。

**路径里的反斜杠。**
YAML 的单引号字符串里反斜杠是字面量，可以直接写；更推荐用正斜杠，减少转义问题。

## 7. 安全与备份

- 永远不要读取、复制或提交 DSH 的 `.credentials.yaml`。
- 不要把 `dataRoot` 指到工作台仓库或 Git 工作区里；角色记忆和工单可能包含私人内容。
- 工作台对引擎数据默认只读：只扫描注册表、角色卡、总结、记忆目录和 `SKILL.md`；只有角色卡和 `SKILL.md` 允许写回。
- 升级或迁移前备份整个 `dataRoot`，以及 profile 的 `cordis.patch.yml`。
- 插件是社区项目，许可证为 MIT；它不是 DeepSeek 官方产品，遇到问题优先看它的仓库文档与 issue。
