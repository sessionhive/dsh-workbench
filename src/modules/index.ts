import { engineChatModule } from './builtin/engine-chat';
import { filesBrowserModule } from './builtin/files-browser';
import { memorySearchModule } from './builtin/memory-search';
import { neuronViewModule } from './builtin/neuron-graph';
import { terminalModule } from './builtin/terminal';
import { todoListModule } from './builtin/todo-list';
import { webSearchModule } from './builtin/web-search';
import { registerModules } from './runtime';

/** 内置模块在模块包加载时统一注册，后续外部模块可在同一注册表追加。 */
registerModules([
  neuronViewModule,
  engineChatModule,
  todoListModule,
  filesBrowserModule,
  webSearchModule,
  terminalModule,
  memorySearchModule,
]);

export { categoryOf, MODULE_CATEGORIES } from './categories';
export type { ModuleCategoryMeta } from './categories';
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
  ModulePermission,
  ModuleStateChangeHandler,
  ModuleStateUpdater,
  ModuleViewProps,
  SceneTemplate,
  SlotId,
} from './types';
