/**
 * 本地扩展入口。
 *
 * 该文件只做转发：真正的装配取决于构建模式。
 * - 公开构建（`npm run build` / `npm run dev`）：解析到 `local.public.ts`，没有外部模块；
 * - 本机扩展（`npm run build:local` / `npm run dev:local`）：解析到 `local.host.ts`，
 *   读取被 .gitignore 忽略的 `src/modules/local-modules/`。
 *
 * 解析由 `tsconfig.json` 的 paths（类型检查）与 `vite.config.ts` 的 alias（打包）共同完成。
 */
export { localModules, localModuleDefaults, localTemplateExtras } from '#local-modules';

/**
 * 当前构建是否包含外部扩展；设置里的体检和模块来源标识会用到。
 * 值由 vite.config.ts 按别名选择结果注入，避免 mode 与环境变量两种入口判断不一致。
 */
export const localExtensionsEnabled = __LOCAL_EXTENSIONS__;
