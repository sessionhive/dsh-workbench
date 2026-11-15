import { dispatchTimelineModule } from './builtin/dispatch-timeline';
import { engineChatModule } from './builtin/engine-chat';
import { filesBrowserModule } from './builtin/files-browser';
import { memorySearchModule } from './builtin/memory-search';
import { neuronViewModule } from './builtin/neuron-graph';
import { runStatusModule } from './builtin/run-status';
import { terminalModule } from './builtin/terminal';
import { todoListModule } from './builtin/todo-list';
import { webSearchModule } from './builtin/web-search';
import { localModules } from './local';
import { registerModules } from './runtime';

/** 内置模块在模块包加载时统一注册，本地扩展模块随后追加。 */
registerModules([
  neuronViewModule,
  engineChatModule,
  todoListModule,
  filesBrowserModule,
  webSearchModule,
  terminalModule,
  memorySearchModule,
  dispatchTimelineModule,
  runStatusModule,
  ...localModules,
]);

export { categoryOf, MODULE_CATEGORIES, MODULE_ORIGINS, originOf } from './categories';
export type { ModuleCategoryMeta, ModuleOriginMeta } from './categories';
export { emitWorkbenchEvent, onWorkbenchEvent } from './events';
export type { WorkbenchEvent } from './events';
export { SlotHost } from './ModuleHost';
export {
  getModuleDefinition,
  listModules,
  moduleSupportsSlot,
  registerModules,
  resolveModules,
} from './runtime';
export { useModuleState } from './state';
export type {
  ModuleActions,
  ModuleCategory,
  ModuleCenterMeta,
  ModuleDefinition,
  ModuleInstance,
  ModuleKind,
  ModuleManifest,
  ModuleOrigin,
  ModulePermission,
  ModuleStateChangeHandler,
  ModuleStateUpdater,
  ModuleViewProps,
  SceneTemplate,
  SlotId,
} from './types';
