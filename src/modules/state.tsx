import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import type { ModuleStateUpdater } from './types';

interface ModuleStateContextValue {
  moduleId: string;
  value: unknown;
  update: (next: unknown | ModuleStateUpdater) => void;
}

const ModuleStateContext = createContext<ModuleStateContextValue | null>(null);

interface ModuleStateProviderProps {
  moduleId: string;
  value: unknown;
  onChange: (next: unknown | ModuleStateUpdater) => void;
  children: ReactNode;
}

/** 把某个会话内某个模块实例的状态切片注入视图，模块之间互不可见。 */
export function ModuleStateProvider({
  moduleId,
  value,
  onChange,
  children,
}: ModuleStateProviderProps) {
  const contextValue = useMemo<ModuleStateContextValue>(
    () => ({ moduleId, value, update: onChange }),
    [moduleId, onChange, value],
  );

  return (
    <ModuleStateContext.Provider value={contextValue}>
      {children}
    </ModuleStateContext.Provider>
  );
}

/**
 * 模块内部状态钩子：首次读取时使用 initial，之后持久化在
 * session.moduleState[moduleId] 中，随会话切换而隔离。
 */
export function useModuleState<T>(initial: T) {
  const context = useContext(ModuleStateContext);
  if (!context) {
    throw new Error('useModuleState 必须在模块槽位内使用');
  }

  const value = (context.value === undefined ? initial : context.value) as T;
  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      // 首次写入时存档里还没有该模块的状态，更新函数仍然要拿到 initial 兜底。
      context.update((previous: unknown) => {
        const base = (previous === undefined ? initial : previous) as T;
        return typeof next === 'function' ? (next as (prev: T) => T)(base) : next;
      });
    },
    [context, initial],
  );

  return [value, setValue] as const;
}
