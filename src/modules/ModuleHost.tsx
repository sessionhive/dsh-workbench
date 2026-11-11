import {
  Component,
  Fragment,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import type { EngineSnapshot } from '../engine/types';
import type { WorkbenchSettings } from '../settings';
import type { Session } from '../types';
import { getModuleDefinition, resolveModules } from './runtime';
import { ModuleStateProvider } from './state';
import type {
  ModuleActions,
  ModuleStateChangeHandler,
  ModuleStateUpdater,
  SlotId,
} from './types';

interface SlotHostProps {
  slot: SlotId;
  session: Session;
  sessions: Session[];
  actions: ModuleActions;
  settings: WorkbenchSettings;
  engine: EngineSnapshot | null;
  engineLoading: boolean;
  refreshEngine: () => void;
  onModuleStateChange: ModuleStateChangeHandler;
  /** 中心槽位只渲染当前页签对应的模块。 */
  onlyModuleId?: string;
}

/**
 * 槽位宿主：按会话实例解析模块，逐个套上状态隔离与错误边界。
 * 不额外包裹 DOM，保证原有布局结构不变。
 */
export function SlotHost({
  slot,
  session,
  sessions,
  actions,
  settings,
  engine,
  engineLoading,
  refreshEngine,
  onModuleStateChange,
  onlyModuleId,
}: SlotHostProps) {
  const instances = resolveModules(session, slot).filter(
    (instance) => !onlyModuleId || instance.moduleId === onlyModuleId,
  );

  return (
    <>
      {instances.map((instance) => {
        const definition = getModuleDefinition(instance.moduleId);
        if (!definition?.View) return null;

        const ModuleView = definition.View;
        const handleChange = (update: unknown | ModuleStateUpdater) =>
          onModuleStateChange(session.id, instance.moduleId, update);

        return (
          <ModuleStateProvider
            key={`${session.id}:${instance.moduleId}`}
            moduleId={instance.moduleId}
            value={session.moduleState[instance.moduleId]}
            onChange={handleChange}
          >
            <ModuleBoundary moduleId={instance.moduleId} label={definition.manifest.name}>
              <ModuleView
                slot={slot}
                session={session}
                sessions={sessions}
                module={instance}
                instanceKey={`${session.id}:${instance.moduleId}`}
                actions={actions}
                settings={settings}
                engine={engine}
                engineLoading={engineLoading}
                refreshEngine={refreshEngine}
              />
            </ModuleBoundary>
          </ModuleStateProvider>
        );
      })}
    </>
  );
}

interface ModuleBoundaryProps {
  moduleId: string;
  label: string;
  children: ReactNode;
}

interface ModuleBoundaryState {
  error: Error | null;
}

/** 单个模块崩溃不拖垮整个工作台。 */
export class ModuleBoundary extends Component<ModuleBoundaryProps, ModuleBoundaryState> {
  state: ModuleBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ModuleBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[workbench] module ${this.props.moduleId} crashed`, error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="module-error" role="alert">
          模块「{this.props.label}」加载失败：{this.state.error.message}
        </div>
      );
    }
    return <Fragment>{this.props.children}</Fragment>;
  }
}
