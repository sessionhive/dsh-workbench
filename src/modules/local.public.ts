import type { ModuleDefinition, SlotId } from './types';

/**
 * 公开构建的本地扩展占位：不导入、不打包任何外部模块。
 *
 * `npm run build` / `npm run dev` 会解析到这里，保证从 Git 克隆的版本
 * 只显示自研与引擎能力；只有 `build:local` / `dev:local`
 * （Vite 模式 `local-extensions`）才会换成 `local.host.ts`。
 */
export const localModules: ModuleDefinition[] = [];

export const localModuleDefaults: Record<
  string,
  { enabled: boolean; order: number; slotOrders?: Partial<Record<SlotId, number>> }
> = {};

export const localTemplateExtras: Record<string, string[]> = {};