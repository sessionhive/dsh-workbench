import type { ModuleDefinition, SlotId } from './types';

/**
 * 本地扩展模块：只在本机存在，不进公共仓库与公开发布包。
 * 把扩展的 .tsx 放进 `src/modules/local-modules/`，导出 `definition` 即可被自动注册；
 * 同目录的 config.ts 可补充默认装配与模板模块。目录本身被 .gitignore 忽略。
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
