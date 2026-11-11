import type { ModuleInstance } from './modules/types';
import type { SceneBoardState } from './board/types';

export type SessionStatus = 'running' | 'waiting' | 'idle' | 'offline';

/** 会话 id 不再限定内置角色，模板和引擎场景都可以创建新会话。 */
export type RoleId = string;

export type EventKind = 'info' | 'task' | 'done' | 'warn';

export type ToastTone = 'info' | 'success' | 'warn';

export type IconName =
  | 'search'
  | 'plus'
  | 'x'
  | 'minus'
  | 'square'
  | 'restore'
  | 'send'
  | 'refresh'
  | 'code'
  | 'pen'
  | 'server'
  | 'database'
  | 'command'
  | 'activity'
  | 'layers'
  | 'sliders'
  | 'clock'
  | 'chevronDown'
  | 'chevronLeft'
  | 'chevronRight'
  | 'sun'
  | 'moon'
  | 'palette'
  | 'trash'
  | 'save'
  | 'copy'
  | 'tag'
  | 'monitor'
  | 'arrowUpRight'
  | 'pause'
  | 'check'
  | 'alert'
  | 'spark'
  | 'panel'
  | 'neuron'
  | 'folder'
  | 'globe'
  | 'arrowLeft'
  | 'arrowRight'
  | 'home'
  | 'bot'
  | 'cpu'
  | 'rocket'
  | 'shield'
  | 'wrench'
  | 'bug'
  | 'book'
  | 'chart'
  | 'compass'
  | 'cloud'
  | 'git'
  | 'terminal'
  | 'wand'
  | 'image'
  | 'mic'
  | 'key'
  | 'mail'
  | 'cube'
  | 'orbit'
  | 'wave'
  | 'pin';

export interface SessionEvent {
  id: string;
  time: string;
  ago: number;
  kind: EventKind;
  text: string;
}

/** 场景绑定的 Harness 会话；打开该场景的 DSH 时按标题定位并切换。 */
export interface HarnessBinding {
  sessionId: string;
  title: string;
}

export interface Session {
  id: RoleId;
  name: string;
  role: string;
  scene: string;
  status: SessionStatus;
  color: string;
  model: string;
  unread: number;
  context: number;
  summary: string;
  lastActive: string;
  x: number;
  y: number;
  icon: IconName;
  events: SessionEvent[];
  /** 该会话挂载的模块实例（启停 / 排序 / 配置）。 */
  modules: ModuleInstance[];
  /** 按模块 id 隔离的运行时状态。 */
  moduleState: Record<string, unknown>;
  /** 场景桌面的盒子布局，写入存档。 */
  board?: SceneBoardState;
  /** 由引擎场景创建的会话，保留只读引用。 */
  engine?: {
    sceneId: string;
    sessionId?: string;
    memoryRoot?: string;
  };
  /** 打开本场景的 DSH 时自动切换到的 Harness 会话。 */
  harness?: HarnessBinding;
  templateId?: string;
}

export interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
}

export interface PaletteAction {
  id: string;
  group: string;
  title: string;
  hint?: string;
  icon: IconName;
  color?: string;
  run: () => void;
}
