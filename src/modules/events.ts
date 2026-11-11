import type { RoleId } from '../types';

export type WorkbenchEvent =
  | { type: 'session.select'; sessionId: RoleId }
  | { type: 'session.create'; sessionId: RoleId }
  | { type: 'session.dispatch'; sessionId: RoleId; text: string }
  | { type: 'module.toggle'; sessionId: RoleId; moduleId: string; enabled: boolean }
  | { type: 'settings.change' };

type WorkbenchEventListener = (event: WorkbenchEvent) => void;

const listeners = new Set<WorkbenchEventListener>();

/** 工作台级事件总线：模块后续可订阅会话动作，而不必层层透传回调。 */
export function emitWorkbenchEvent(event: WorkbenchEvent) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error('[workbench] event listener failed', error);
    }
  }
}

export function onWorkbenchEvent(listener: WorkbenchEventListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
