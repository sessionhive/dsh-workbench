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
