import type { ModuleCategory, ModuleManifest } from './types';

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
    hint: '检索引擎场景、记忆文件与会话历史',
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
