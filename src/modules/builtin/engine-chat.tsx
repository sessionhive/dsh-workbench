import type { ModuleDefinition } from '../types';

/**
 * DSH 引擎页签。
 * 内容由应用层的 EngineSurface 常驻 webview 接管，直接显示 dsh 官方 Harness 页面；
 * 这里只保留页签清单与占位槽，不再维护工作台自己的消息流。
 */
export const engineChatModule: ModuleDefinition = {
  manifest: {
    id: 'session.chat',
    name: 'DSH 引擎',
    version: '0.2.0',
    description:
      '嵌入 DSH 官方 Harness 页面；会话、模型与执行都由引擎侧负责，工作台只提供宿主。',
    icon: 'spark',
    kind: ['view'],
    slots: ['center.view'],
    category: 'session',
    permissions: ['sessions:read', 'notify'],
    persistState: false,
  },
  center: {
    tabLabel: 'DSH 引擎',
    title: 'DSH 引擎',
    subtitle: ({ runningCount }) =>
      `官方 Harness 页面 · ${runningCount} 个任务运行中`,
  },
  View: () => <div className="engine-surface-slot" aria-hidden="true" />,
};
