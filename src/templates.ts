import type { EngineSnapshot } from './engine/types';
import { createDefaultModules } from './moduleDefaults';
import type { HarnessBinding, IconName, Session } from './types';

export type TemplateSource = 'builtin' | 'custom' | 'engine';

export interface SessionTemplate {
  id: string;
  name: string;
  description: string;
  role: string;
  scene: string;
  model: string;
  color: string;
  icon: IconName;
  summary: string;
  /** 模板默认启用的模块 id 列表。 */
  modules: string[];
  source: TemplateSource;
  engineSceneId?: string;
  memoryRoot?: string;
  /** 模板默认绑定的 Harness 会话。 */
  harness?: HarnessBinding | null;
  tags: string[];
}

export interface SessionConfig {
  name: string;
  role: string;
  scene: string;
  model: string;
  color: string;
  icon: IconName;
  modules: string[];
  /** 打开该场景 DSH 时自动跳转的 Harness 会话。 */
  harness: HarnessBinding | null;
}

/** 会话标识图标候选，新建 / 编辑会话和自定义模板共用。 */
export const SESSION_ICONS: IconName[] = [
  'command',
  'code',
  'search',
  'pen',
  'server',
  'database',
  'spark',
  'layers',
  'activity',
  'globe',
  'folder',
  'neuron',
  'sliders',
  'panel',
  'clock',
  'monitor',
  'terminal',
  'bot',
  'cpu',
  'rocket',
  'shield',
  'wrench',
  'bug',
  'book',
  'chart',
  'compass',
  'cloud',
  'git',
  'wand',
  'image',
  'mic',
  'key',
  'mail',
  'cube',
  'orbit',
  'wave',
];

const PALETTE = [
  '#3bdeea',
  '#8f80ff',
  '#f6b64c',
  '#3ee0a3',
  '#e468d4',
  '#5aa9ff',
  '#ff8f6b',
  '#b6d66b',
];

const BASE_MODULES = ['session.chat'];

const builtinTemplates: SessionTemplate[] = [
  {
    id: 'builtin-dev',
    name: '编码会话',
    description: '围绕工作区代码的日常开发、调试与构建，预装文件浏览和神经元。',
    role: 'Coder · 代码开发',
    scene: '开发',
    model: 'DSH 引擎',
    color: '#3bdeea',
    icon: 'code',
    summary: '负责代码实现、调试与构建验证，默认挂载文件浏览与待办清单。',
    modules: ['neuron.view', 'files.browser', 'terminal.console', 'todo.list', ...BASE_MODULES],
    source: 'builtin',
    tags: ['开发', '文件', '终端'],
  },
  {
    id: 'builtin-research',
    name: '调研会话',
    description: '外部资料检索、竞品对比和结论压缩，预装网页检索与记忆检索。',
    role: 'Scout · 信息检索',
    scene: '研究',
    model: 'DSH 引擎',
    color: '#8f80ff',
    icon: 'search',
    summary: '收集外部资料并压缩成可接入的摘要，输出带出处的调研结论。',
    modules: ['neuron.view', 'web.search', 'memory.search', 'todo.list', ...BASE_MODULES],
    source: 'builtin',
    tags: ['检索', '网页', '记忆'],
  },
  {
    id: 'builtin-writing',
    name: '写作会话',
    description: '把会话产出整理成可读成稿，聚焦文档结构与表达。',
    role: 'Scribe · 内容创作',
    scene: '写作',
    model: 'DSH 引擎',
    color: '#f6b64c',
    icon: 'pen',
    summary: '负责产品文案、使用说明与交接文档，把碎片产出整理成可读成稿。',
    modules: ['neuron.view', 'todo.list', ...BASE_MODULES],
    source: 'builtin',
    tags: ['文档', '文案'],
  },
  {
    id: 'builtin-ops',
    name: '运维会话',
    description: '本机环境、依赖版本、构建产物与运行状态诊断。',
    role: 'Keeper · 系统运维',
    scene: '运维',
    model: 'DSH 引擎',
    color: '#3ee0a3',
    icon: 'server',
    summary: '关注本机环境、依赖版本与构建产物，负责安装、启动、诊断与状态回报。',
    modules: ['neuron.view', 'files.browser', 'terminal.console', 'todo.list', ...BASE_MODULES],
    source: 'builtin',
    tags: ['环境', '诊断', '终端'],
  },
  {
    id: 'builtin-memory',
    name: '知识会话',
    description: '维护长期记忆：沉淀产物、处理冲突与过期条目。',
    role: 'Curator · 记忆整理',
    scene: '知识',
    model: 'DSH 引擎',
    color: '#e468d4',
    icon: 'database',
    summary: '把会话产出沉淀为知识节点，维护记忆索引并处理冲突与过期条目。',
    modules: ['neuron.view', 'memory.search', 'todo.list', ...BASE_MODULES],
    source: 'builtin',
    tags: ['记忆', '知识'],
  },
  {
    id: 'builtin-blank',
    name: '空白会话',
    description: '只保留 DSH 引擎，其余模块按需在模块抽屉里启用。',
    role: 'Worker · 通用执行',
    scene: '自定义',
    model: 'DSH 引擎',
    color: '#5aa9ff',
    icon: 'spark',
    summary: '从零开始装配的通用会话，按任务需要逐步启用模块。',
    modules: [...BASE_MODULES],
    source: 'builtin',
    tags: ['自定义', '轻量'],
  },
];

function sceneIcon(name: string, group: string): IconName {
  const text = `${name} ${group}`.toLowerCase();
  if (/(开发|编码|dev|code|frontend|backend|gui)/.test(text)) return 'code';
  if (/(调研|检索|信息|search|scout|bili)/.test(text)) return 'search';
  if (/(写|文档|笔|内容|scribe|review)/.test(text)) return 'book';
  if (/(运维|清理|系统|clean|ops|keeper)/.test(text)) return 'server';
  if (/(知识|记忆|整理|memory|curator|product)/.test(text)) return 'database';
  if (/(部署|发布|上线|deploy|release|rocket)/.test(text)) return 'rocket';
  if (/(测试|调试|缺陷|test|debug|bug)/.test(text)) return 'bug';
  if (/(安全|权限|审计|security|auth|shield)/.test(text)) return 'shield';
  if (/(数据|报表|指标|chart|metric)/.test(text)) return 'chart';
  if (/(设计|视觉|配色|design|visual)/.test(text)) return 'palette';
  if (/(终端|命令|shell|cli)/.test(text)) return 'terminal';
  return 'command';
}

function engineModules(scene: EngineSnapshot['scenes'][number]): string[] {
  const types = new Set(scene.panels.map((panel) => panel.type));
  const text = `${scene.name} ${scene.group}`;
  const modules = ['neuron.view', 'todo.list'];

  if (types.has('file')) modules.push('files.browser');
  if (/(运维|系统|终端|命令|ops|shell|cli)/.test(text)) modules.push('terminal.console');
  if (types.has('embed') || /(调研|检索|信息|网页|bili)/.test(text)) modules.push('web.search');
  if (/(知识|记忆|整理|memory|curator)/.test(text)) modules.push('memory.search');

  return [...modules, ...BASE_MODULES];
}

/** 内置模板 + 自定义模板 + 引擎场景模板；引擎不可用时只返回本地模板。 */
export function buildTemplates(
  engine: EngineSnapshot | null,
  customTemplates: SessionTemplate[] = [],
): SessionTemplate[] {
  const engineTemplates: SessionTemplate[] = (engine?.scenes ?? []).map((scene, index) => ({
    id: `engine-${scene.id}`,
    name: scene.name,
    description:
      scene.responsibilities[0] ||
      scene.summaryText ||
      `${scene.panels.length} 个面板 · ${scene.memoryCount} 份记忆`,
    role: scene.mission ? scene.mission.replace(/\s+/g, ' ').slice(0, 34) : `${scene.group || '引擎'} · 场景角色`,
    scene: scene.group || '引擎',
    model: 'DSH Engine · 只读',
    color: PALETTE[index % PALETTE.length],
    icon: sceneIcon(scene.name, scene.group),
    summary: scene.mission || scene.summaryText || `${scene.name} 引擎场景，点击可查看记忆与技能索引。`,
    modules: engineModules(scene),
    source: 'engine',
    engineSceneId: scene.id,
    memoryRoot: scene.memoryRoot,
    harness:
      scene.primarySessionId && scene.primarySessionTitle
        ? { sessionId: scene.primarySessionId, title: scene.primarySessionTitle }
        : null,
    tags: [scene.group || '引擎', `${scene.memoryCount} 记忆`, `${scene.skillCount} 技能`],
  }));

  const custom = customTemplates.map((template) => ({
    ...template,
    source: 'custom' as const,
    icon: template.icon ?? 'spark',
    modules: Array.isArray(template.modules) ? template.modules : [...BASE_MODULES],
    tags: Array.isArray(template.tags) ? template.tags : ['自定义'],
  }));

  return [...builtinTemplates, ...custom, ...engineTemplates];
}

let templateSequence = 0;

/** 从向导表单生成或更新一个自定义模板。 */
export function templateFromConfig(
  config: SessionConfig,
  base?: SessionTemplate | null,
  id?: string,
): SessionTemplate {
  templateSequence += 1;
  return {
    id: id ?? `custom-${Date.now().toString(36)}-${templateSequence}`,
    name: config.name.trim() || base?.name || '未命名模板',
    description: base?.description || `${config.scene || '自定义'}场景 · ${config.modules.length} 个模块`,
    role: config.role.trim() || base?.role || 'Worker · 自定义角色',
    scene: config.scene.trim() || base?.scene || '自定义',
    model: config.model.trim() || base?.model || 'DSH 引擎',
    color: config.color,
    icon: config.icon,
    summary: base?.summary || '由用户保存的自定义模板，可在新建会话时复用。',
    modules: [...config.modules],
    harness: config.harness ?? base?.harness ?? null,
    source: 'custom',
    tags: base?.tags?.length ? base.tags : ['自定义', config.scene || '场景'],
  };
}

function uniqueName(base: string, sessions: Session[]) {
  const names = new Set(sessions.map((session) => session.name));
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

/** 用模板 + 向导里的最终配置创建一个本地会话。 */
export function createSessionFromTemplate(
  template: SessionTemplate,
  config: SessionConfig,
  sessions: Session[],
): Session {
  const id = `session-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
  const count = sessions.filter((session) => session.id !== 'hub').length;
  const angle = -Math.PI / 2 + count * 2.399;
  const radius = 30 + (count % 3) * 3;

  return {
    id,
    name: uniqueName(config.name.trim() || template.name, sessions),
    role: config.role.trim() || template.role,
    scene: config.scene.trim() || template.scene,
    status: 'idle',
    color: config.color,
    model: config.model.trim() || template.model,
    unread: 0,
    // 上下文占用只有引擎侧才知道；本地新建时保持 0，不做估算。
    context: 0,
    summary: template.summary,
    lastActive: '刚刚',
    x: 50 + Math.cos(angle) * radius,
    y: 50 + Math.sin(angle) * radius,
    icon: config.icon || template.icon,
    events: [
      {
        id: `event-${Date.now().toString(36)}`,
        time: '刚刚',
        ago: 0,
        kind: 'info',
        text: `由「${template.name}」模板创建，等待派发首个任务。`,
      },
    ],
    modules: createDefaultModules().map((instance) => ({
      ...instance,
      enabled: config.modules.includes(instance.moduleId),
    })),
    moduleState: {},
    engine: template.engineSceneId
      ? {
          sceneId: template.engineSceneId,
          sessionId: config.harness?.sessionId,
          memoryRoot: template.memoryRoot,
        }
      : undefined,
    harness: config.harness ?? template.harness ?? undefined,
    templateId: template.id,
  };
}
