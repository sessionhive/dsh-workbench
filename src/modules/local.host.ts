import type { ModuleDefinition, SlotId } from './types';

/**
 * 本机扩展装配：仅在 `dev:local` / `build:local` 模式下由 Vite 别名接管。
 *
 * - 扩展的 .tsx 放进 `src/modules/local-modules/`，导出 `definition` 即自动注册；
 * - 同目录 `config.ts` 可补充默认装配与模板模块；
 * - 该目录与 `electron/local/` 都在 .gitignore 内，不进入公共仓库和公开发布包。
 */
type LocalModuleFile = { definition?: ModuleDefinition };

type LocalConfig = {
  defaults?: Record<
    string,
    { enabled: boolean; order: number; slotOrders?: Partial<Record<SlotId, number>> }
  >;
  templateExtras?: Record<string, string[]>;
};

const moduleFiles = import.meta.glob<LocalModuleFile>('./local-modules/*.tsx', { eager: true });
const configFiles = import.meta.glob<{ default?: LocalConfig } & LocalConfig>(
  './local-modules/config.ts',
  { eager: true },
);

export const localModules: ModuleDefinition[] = Object.values(moduleFiles)
  .map((file) => file.definition)
  .filter((definition): definition is ModuleDefinition => Boolean(definition));

const localConfig = Object.values(configFiles)[0] ?? {};

export const localModuleDefaults = localConfig.defaults ?? {};
export const localTemplateExtras = localConfig.templateExtras ?? {};