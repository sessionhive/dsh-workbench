import type { ComponentType } from 'react';
import type { EngineSnapshot } from '../engine/types';
import type { WorkbenchSettings } from '../settings';
import type { IconName, RoleId, Session, ToastTone } from '../types';

/** 工作台允许模块挂载的槽位。 */
export type SlotId =
  | 'center.view'
  | 'detail.block'
  | 'command.action'
  | 'rail.widget'
  | 'status.item';

/** 模块承担的角色，用于抽屉分组与后续权限控制。 */
export type ModuleKind = 'view' | 'panel' | 'tool' | 'context';

/** 模块分类：区分全局能力与只作用于单个会话的模块。 */
export type ModuleCategory = 'core' | 'workspace' | 'knowledge' | 'session';

/** 模块声明的能力范围，M1 只做记录，M2 起用于运行时校验。 */
export type ModulePermission =
  | 'sessions:read'
  | 'sessions:write'
  | 'module:state'
  | 'events:emit'
  | 'notify'
  | 'fs:read'
  | 'fs:write'
  | 'net:fetch';

/** 模块自描述。注册表以 id 为唯一键。 */
export interface ModuleManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: IconName;
  kind: ModuleKind[];
  slots: SlotId[];
  /** 模块归属分类；缺省按会话内模块处理。 */
  category?: ModuleCategory;
  permissions?: ModulePermission[];
  /** 是否允许把该模块的运行时状态写入本地存档。 */
  persistState?: boolean;
}

/** 挂在某个会话上的模块实例，启停、排序和配置都属于实例而非定义。 */
export interface ModuleInstance {
  moduleId: string;
  enabled: boolean;
  order: number;
  /** 同一模块挂多个槽位时，可为每个槽位单独排序。 */
  slotOrders?: Partial<Record<SlotId, number>>;
  config: Record<string, unknown>;
}

/** 中心视图模块的页签与标题信息。 */
export interface ModuleCenterMeta {
  tabLabel: string;
  title: string;
  subtitle: (ctx: {
    sessionCount: number;
    runningCount: number;
    unreadCount: number;
  }) => string;
}

/** 宿主提供给模块的动作集合，模块不直接持有工作台状态。 */
export interface ModuleActions {
  selectSession: (id: RoleId) => void;
  openSession: (id: RoleId) => void;
  dispatchTask: (id: RoleId, text: string) => void;
  notify: (message: string, tone?: ToastTone) => void;
  openSettings: () => void;
  openNewSession: () => void;
  openModuleDrawer: () => void;
}

/** 槽位注入给模块的视图属性。 */
export interface ModuleViewProps {
  slot: SlotId;
  session: Session;
  sessions: Session[];
  module: ModuleInstance;
  /** 同一模块多开时的实例标识（场景桌面里按盒子区分）。 */
  instanceKey?: string;
  actions: ModuleActions;
  settings: WorkbenchSettings;
  engine: EngineSnapshot | null;
  engineLoading: boolean;
  refreshEngine: () => void;
}

/** 模块定义：清单 + 可选视图 + 可选中心视图元信息。 */
export interface ModuleDefinition {
  manifest: ModuleManifest;
  View?: ComponentType<ModuleViewProps>;
  center?: ModuleCenterMeta;
}

/** 场景模板描述一类会话默认装配哪些模块（M4 新建会话时使用）。 */
export interface SceneTemplate {
  id: string;
  name: string;
  description: string;
  role: string;
  model: string;
  modules: ModuleInstance[];
}

export type ModuleStateUpdater = (prev: unknown) => unknown;

export type ModuleStateChangeHandler = (
  sessionId: RoleId,
  moduleId: string,
  update: unknown | ModuleStateUpdater,
) => void;
