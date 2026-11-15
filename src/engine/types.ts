export interface EnginePanel {
  panelId: string;
  type: string;
  title: string;
}

export interface EngineSceneSession {
  panelId: string;
  sessionId: string;
  title: string;
}

export interface EngineScene {
  id: string;
  name: string;
  group: string;
  status: string;
  mission: string;
  responsibilities: string[];
  summaryText: string;
  panels: EnginePanel[];
  sessions: EngineSceneSession[];
  primarySessionId: string;
  primarySessionTitle: string;
  primaryPanelId: string;
  skill: string;
  memoryRoot: string;
  memoryFiles: string[];
  memoryCount: number;
  skillFiles: string[];
  skillCount: number;
}

export interface EngineEvent {
  ts?: string;
  type?: string;
  event?: string;
  status?: string;
  text?: string;
  order_id?: string;
  from?: string;
  to?: string;
  source?: string;
  scene?: string;
  protocol?: string;
  seeded?: boolean;
}

export interface EngineSnapshot {
  ok: boolean;
  root: string;
  scannedAt: string;
  scenes: EngineScene[];
  skills: { index: string; dirs: string[] };
  events: EngineEvent[];
  dispatches: EngineEvent[];
  errors: string[];
}

/** 神经元联动的轻量事件通道：只包含 events/ 下的会话事件与派单日志。 */
export interface EngineEventFeed {
  ok: boolean;
  root: string;
  readAt: number;
  events: EngineEvent[];
  dispatches: EngineEvent[];
  error?: string;
}

/** 派单流程状态（插件按事件推导，优先级见派单规范 v2.1）。 */
export type DispatchStage =
  | 'created'
  | 'dispatched'
  | 'delivered'
  | 'acked'
  | 'started'
  | 'submitted'
  | 'verified'
  | 'rejected'
  | 'closed';

export interface DispatchEventEntry {
  ts?: string;
  type?: string;
  from?: string;
  to?: string;
  status?: string;
  note?: string;
  reason?: string;
  refs?: string[];
  day?: string;
  order_id?: string;
  heartbeat?: boolean;
  seeded?: boolean;
}

export interface DispatchTiming {
  queue_ms?: number | null;
  start_delay_ms?: number | null;
  work_ms?: number | null;
  total_ms?: number | null;
  submit_to_verify_ms?: number | null;
  verify_to_close_ms?: number | null;
  durations?: DispatchTiming;
}

export interface DispatchOverdue {
  ack?: boolean;
  submit?: boolean;
  minutes?: number;
}

/** 插件按 day 隔离的订单对象；key = YYYY-MM-DD/dhNNN。 */
export interface DispatchOrder {
  key: string;
  day: string;
  id: string;
  assignee?: string;
  dispatcher?: string;
  owner?: string;
  current_owner?: string;
  flow?: string[];
  next?: string;
  stage?: DispatchStage | string;
  status?: string;
  done?: boolean;
  task?: string;
  dispatched_at?: string;
  submit_at?: string;
  closed_at?: string;
  handoff_count?: number;
  overdue?: DispatchOverdue;
  events?: DispatchEventEntry[];
  timing?: DispatchTiming;
}

export interface DispatchFeedDay {
  day: string;
  ok: boolean;
  count?: number;
  error?: string;
}

/** 插件下发的超时/心跳阈值；旧版接口没有该字段时 UI 用兜底值。 */
export interface DispatchThresholds {
  staleMinutes?: number;
  noticeMinutes?: number;
  heartbeatMinutes?: number;
}

export interface DispatchFeedResult {
  ok: boolean;
  readAt: number;
  days: DispatchFeedDay[];
  orders: DispatchOrder[];
  thresholds?: DispatchThresholds | null;
  error?: string;
}

export interface NotifyItem {
  id: string;
  type?: string;
  to?: string;
  order?: string;
  status?: string;
  count?: number;
  dedupKey?: string;
  createdAt?: string;
  sentAt?: string;
  content?: string;
}

export interface NotifyFeedDay {
  day: string;
  ok: boolean;
  count: number;
  error?: string;
}

export interface NotifyFeedResult {
  ok: boolean;
  readAt: number;
  days: NotifyFeedDay[];
  items: NotifyItem[];
  unread: number;
  error?: string;
}

export type EngineProcessStatus = 'idle' | 'starting' | 'ready' | 'error';

/** 计费账本里的余额快照（只来自 cost-meter 账本，不读凭据）。 */
export interface CostBalance {
  total: number | null;
  granted: number | null;
  topped: number | null;
  currency: string;
  date: string;
  updatedAt: number;
}

export interface CostDay {
  date: string;
  cost: number;
  costCny: number;
  calls: number;
}

export interface CostPeakConfig {
  enabled: boolean;
  effectiveAt: string;
  /** UTC 小时窗口；[start, end) */
  windows: { start: number; end: number }[];
  /** 北京时间节假日，全天谷价 */
  holidays: string[];
}

export interface CostSnapshot {
  ok: boolean;
  error?: string;
  readAt: number;
  symbol: string;
  decimals: number;
  currency: string;
  exchangeRate: number;
  balance: CostBalance | null;
  today: CostDay | null;
  peak: CostPeakConfig | null;
}

/** 工作台托管的 dsh web 进程状态；url 带本次启动的 token。 */
export interface EngineProcessInfo {
  status: EngineProcessStatus;
  /** 官方 Harness 页面地址（含 token）；未就绪时为空。 */
  url: string;
  error: string;
  /** 最近的启动日志，token 已脱敏。 */
  log: string;
  port: string;
  engineDir: string;
  dataHome: string;
  startedAt: number;
}

export interface FileEntry {
  name: string;
  type: 'dir' | 'file';
  size: number;
  modified: number;
  ext: string;
  /** 受保护的引擎目录（如 .dsh）：只显示名字，不可进入、预览或写入。 */
  protected?: boolean;
  /** 点开头的条目（含 .dsh）。 */
  hidden?: boolean;
}

export interface FileListing {
  ok: boolean;
  root?: string;
  relative?: string;
  entries: FileEntry[];
  error?: string;
}

export interface FilePreviewResult {
  ok: boolean;
  text?: string;
  size?: number;
  truncated?: boolean;
  binary?: boolean;
  error?: string;
}

export interface ImageFileResult {
  ok: boolean;
  size?: number;
  mime?: string;
  dataUrl?: string;
  error?: string;
}

export interface EngineDocResult {
  ok: boolean;
  relative?: string;
  size?: number;
  modified?: number;
  text?: string;
  error?: string;
}

export interface EngineSkillEntry {
  id: string;
  name: string;
  description: string;
  size: number;
  modified: number;
}

export interface EngineSkillScan {
  ok: boolean;
  root: string;
  entries: EngineSkillEntry[];
  error: string;
}

/** 工具目录里的一份脚本，摘要来自 README 或脚本头部注释。 */
export interface ToolScriptEntry {
  id: string;
  name: string;
  summary: string;
  ext: string;
  size: number;
  modified: number;
}

export interface ToolScanResult {
  ok: boolean;
  root: string;
  missing: boolean;
  entries: ToolScriptEntry[];
  error: string;
}

export type EngineScanResult = EngineSnapshot;

/** 主进程按程序位置推导出的默认目录；源码与界面都不写死绝对路径。 */
export interface PathDefaults {
  root: string;
  engineDir: string;
  dataPath: string;
  workspacePath: string;
  filesRoot: string;
  skillsPath: string;
  toolsPath: string;
}

export type HealthStatus = 'ok' | 'warn' | 'fail';

export interface HealthCheck {
  id: string;
  group: string;
  label: string;
  status: HealthStatus;
  detail: string;
  hint?: string;
}

export interface HealthReport {
  ok: boolean;
  checkedAt: number;
  checks: HealthCheck[];
  paths?: Partial<PathDefaults>;
  versions: Record<string, string>;
}
