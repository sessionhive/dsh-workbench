import type { ModuleCategory, ModuleManifest, ModuleOrigin } from './types';

export interface ModuleCategoryMeta {
  id: ModuleCategory;
  label: string;
  hint: string;
}

/** 分类顺序即展示顺序：先全局，再工作区与知识，最后会话内。 */
export const MODULE_CATEGORIES: ModuleCategoryMeta[] = [
  {
    id: 'core',
    label: '中枢全局',
    hint: '读取全部会话与引擎数据，装配在任意会话都可使用',
  },
  {
    id: 'workspace',
    label: '工作区工具',
    hint: '面向工作区文件与网页的外部操作入口',
  },
  {
    id: 'knowledge',
    label: '知识与记忆',
    hint: '检索引擎会话、记忆文件与会话历史',
  },
  {
    id: 'session',
    label: '会话内模块',
    hint: '只服务当前会话的详情、待办与协作面板',
  },
];

const CATEGORY_MAP = new Map(MODULE_CATEGORIES.map((item) => [item.id, item]));
const FALLBACK = CATEGORY_MAP.get('session') as ModuleCategoryMeta;

export function categoryOf(manifest: ModuleManifest): ModuleCategoryMeta {
  return CATEGORY_MAP.get(manifest.category ?? 'session') ?? FALLBACK;
}

export interface ModuleOriginMeta {
  id: ModuleOrigin;
  label: string;
  short: string;
  hint: string;
}

/** 来源顺序即图例顺序：先自研，再引擎，最后外部。 */
export const MODULE_ORIGINS: ModuleOriginMeta[] = [
  {
    id: 'workbench',
    label: '工作台自研',
    short: '自研',
    hint: '本仓库自己的模块，可随工作台一起开源',
  },
  {
    id: 'engine',
    label: 'DSH 引擎',
    short: '引擎',
    hint: '引擎官方界面与能力，随引擎提供，不属于本仓库',
  },
  {
    id: 'third-party',
    label: '外部能力',
    short: '外部',
    hint: '第三方项目或工具，遵循其自身许可，不要并入仓库发布',
  },
];

const ORIGIN_MAP = new Map(MODULE_ORIGINS.map((item) => [item.id, item]));

export function originOf(manifest: ModuleManifest): ModuleOriginMeta {
  return ORIGIN_MAP.get(manifest.origin ?? 'workbench') ?? MODULE_ORIGINS[0];
}
