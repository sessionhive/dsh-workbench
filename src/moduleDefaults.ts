import type { ModuleInstance, SlotId } from './modules/types';

interface ModuleDefault {
  enabled: boolean;
  order: number;
  slotOrders?: Partial<Record<SlotId, number>>;
  config?: Record<string, unknown>;
}

/** 已下线的内置模块：旧存档里的实例、状态和盒子都要清理。 */
export const REMOVED_MODULE_IDS = new Set([
  'hub.map',
  'activity.feed',
  'session.quick-actions',
  'session.events',
]);

export function isRemovedModule(moduleId: string): boolean {
  return REMOVED_MODULE_IDS.has(moduleId);
}

/** 所有内置模块的默认装配。新增模块在这里登记一次即可。 */
export const MODULE_DEFAULTS: Record<string, ModuleDefault> = {
  'neuron.view': { enabled: true, order: 1 },
  'session.chat': { enabled: false, order: 0 },
  'todo.list': { enabled: true, order: 1, slotOrders: { 'center.view': 3, 'detail.block': 1 } },
  'files.browser': { enabled: false, order: 4 },
  'web.search': { enabled: false, order: 5 },
  'terminal.console': { enabled: false, order: 6 },
  'memory.search': { enabled: false, order: 3, slotOrders: { 'center.view': 6, 'detail.block': 3 } },
};

export const DEFAULT_MODULE_ORDER = Object.keys(MODULE_DEFAULTS);

export function createDefaultModules(): ModuleInstance[] {
  return DEFAULT_MODULE_ORDER.map((moduleId) => {
    const preset = MODULE_DEFAULTS[moduleId];
    return {
      moduleId,
      enabled: preset.enabled,
      order: preset.order,
      slotOrders: preset.slotOrders,
      config: { ...(preset.config ?? {}) },
    };
  });
}

/** 给旧存档补齐新模块实例；已下线的模块丢弃，未知模块保持原样但默认停用。 */
export function normalizeModules(instances: ModuleInstance[]): ModuleInstance[] {
  const source = instances.filter((instance) => !isRemovedModule(instance.moduleId));
  const known = new Set(source.map((instance) => instance.moduleId));
  const added = DEFAULT_MODULE_ORDER.filter((moduleId) => !known.has(moduleId)).map((moduleId) => {
    const preset = MODULE_DEFAULTS[moduleId];
    return {
      moduleId,
      enabled: false,
      order: preset.order,
      slotOrders: preset.slotOrders,
      config: { ...(preset.config ?? {}) },
    } satisfies ModuleInstance;
  });

  return [...source, ...added].map((instance) => {
    if (MODULE_DEFAULTS[instance.moduleId]) return instance;
    return { ...instance, enabled: false };
  });
}

/** 清理已下线模块的存档状态，并移除早期内置的待办演示条目。 */
export function normalizeModuleState(
  state: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [moduleId, value] of Object.entries(state)) {
    if (isRemovedModule(moduleId)) continue;
    if (moduleId === 'todo.list' && Array.isArray(value)) {
      next[moduleId] = value.filter(
        (task) => !String((task as { id?: string } | null)?.id ?? '').startsWith('todo-seed-'),
      );
      continue;
    }
    next[moduleId] = value;
  }
  return next;
}

export function resetModules(enabledIds: string[] = []): ModuleInstance[] {
  return createDefaultModules().map((instance) => ({
    ...instance,
    enabled: enabledIds.length ? enabledIds.includes(instance.moduleId) : instance.enabled,
  }));
}
