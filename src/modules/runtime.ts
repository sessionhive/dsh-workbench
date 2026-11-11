import type { Session } from '../types';
import type { ModuleDefinition, ModuleInstance, SlotId } from './types';

const registry = new Map<string, ModuleDefinition>();

/** 注册模块定义；重复 id 直接覆盖，便于开发期热替换。 */
export function registerModules(definitions: ModuleDefinition[]) {
  for (const definition of definitions) {
    registry.set(definition.manifest.id, definition);
  }
}

export function getModuleDefinition(moduleId: string) {
  return registry.get(moduleId);
}

export function listModules() {
  return Array.from(registry.values());
}

/**
 * 解析某个会话在指定槽位上的模块实例：
 * 实例启用 + 注册表存在 + 清单声明了该槽位，最后按实例 order 排序。
 */
export function resolveModules(session: Session, slot: SlotId): ModuleInstance[] {
  return session.modules
    .filter((instance) => instance.enabled)
    .filter((instance) => {
      const definition = registry.get(instance.moduleId);
      return Boolean(definition?.manifest.slots.includes(slot));
    })
    .sort(
      (left, right) =>
        (left.slotOrders?.[slot] ?? left.order) - (right.slotOrders?.[slot] ?? right.order),
    );
}

/** 判断某个模块是否可用于某槽位，供启停抽屉展示。 */
export function moduleSupportsSlot(moduleId: string, slot: SlotId) {
  return Boolean(registry.get(moduleId)?.manifest.slots.includes(slot));
}
