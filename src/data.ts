import { createDefaultModules } from './moduleDefaults';
import type { IconName, RoleId, Session, SessionStatus } from './types';

export const statusLabel: Record<SessionStatus, string> = {
  running: '运行中',
  waiting: '等待',
  idle: '空闲',
  offline: '离线',
};

export const roleIcon: Record<RoleId, IconName> = {
  hub: 'command',
  coder: 'code',
  scout: 'search',
  scribe: 'pen',
  keeper: 'server',
  curator: 'database',
};

/**
 * 首次启动的本地会话骨架：只提供角色与布局，不伪造模型、上下文或消息记录。
 * 真实状态以 DSH 引擎和用户后续操作为准。
 */
const sessionSeed: Array<Omit<Session, 'modules' | 'moduleState' | 'icon'>> = [
  {
    id: 'hub',
    name: '中枢调度',
    role: '调度者 · Router',
    scene: '全局',
    status: 'running',
    color: '#38e1e6',
    model: 'DSH 引擎',
    unread: 0,
    context: 0,
    lastActive: '—',
    x: 50,
    y: 50,
    summary:
      '统一接收指令，拆解任务并路由到对应会话角色，同时汇总各会话的执行状态与上下文。',
    events: [],
  },
  {
    id: 'coder',
    name: '编码会话',
    role: 'Coder · 代码开发',
    scene: '开发',
    status: 'running',
    color: '#3bdeea',
    model: 'DSH 引擎',
    unread: 0,
    context: 0,
    lastActive: '—',
    x: 50,
    y: 15,
    summary:
      '负责 new-workbench 壳工程：Electron 窗口框架、React 组件系统、会话拓扑与构建链路。',
    events: [],
  },
  {
    id: 'scout',
    name: '调研会话',
    role: 'Scout · 信息检索',
    scene: '研究',
    status: 'waiting',
    color: '#8f80ff',
    model: 'DSH 引擎',
    unread: 0,
    context: 0,
    lastActive: '—',
    x: 82,
    y: 39,
    summary:
      '面向外部资料与竞品信息的检索会话，负责收集、比对并把结论压缩成可接入的摘要。',
    events: [],
  },
  {
    id: 'scribe',
    name: '写作会话',
    role: 'Scribe · 内容创作',
    scene: '写作',
    status: 'idle',
    color: '#f6b64c',
    model: 'DSH 引擎',
    unread: 0,
    context: 0,
    lastActive: '—',
    x: 68.5,
    y: 79,
    summary:
      '负责产品文案、使用说明与交接文档，把其他会话的产出整理成可读的成稿。',
    events: [],
  },
  {
    id: 'keeper',
    name: '运维会话',
    role: 'Keeper · 系统运维',
    scene: '运维',
    status: 'idle',
    color: '#3ee0a3',
    model: 'DSH 引擎',
    unread: 0,
    context: 0,
    lastActive: '—',
    x: 31.5,
    y: 79,
    summary:
      '关注本机环境、依赖版本与构建产物，负责安装、启动、诊断与运行状态回报。',
    events: [],
  },
  {
    id: 'curator',
    name: '知识会话',
    role: 'Curator · 记忆整理',
    scene: '知识',
    status: 'waiting',
    color: '#e468d4',
    model: 'DSH 引擎',
    unread: 0,
    context: 0,
    lastActive: '—',
    x: 18,
    y: 39,
    summary:
      '维护工作台的长期记忆：把会话产出沉淀为知识节点，处理冲突与过期条目。',
    events: [],
  },
];

/** 默认装配：中心视图 + 详情区块，所有内置会话一致。 */
export const initialSessions: Session[] = sessionSeed.map((session) => ({
  ...session,
  icon: roleIcon[session.id] ?? 'spark',
  modules: createDefaultModules(),
  moduleState: {},
}));
