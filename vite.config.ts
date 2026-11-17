import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * 两种构建：
 * - 默认（production）：公开版本，只装配自研与引擎能力；
 * - `local-extensions`：本机扩展版本，额外装配被 .gitignore 忽略的 local-modules。
 *
 * 用别名在编译期切换，外部扩展的源码与清单不会进入公开构建的产物。
 */
const localExtensions = process.env.DSH_LOCAL_EXTENSIONS === '1';

export default defineConfig(({ mode }) => {
  const withLocalExtensions = localExtensions || mode === 'local-extensions';
  return {
    base: './',
    plugins: [react()],
    // 编译期常量：无论通过 --mode 还是环境变量启用本机扩展，
    // 运行时判断都与实际别名保持一致。
    define: {
      __LOCAL_EXTENSIONS__: JSON.stringify(withLocalExtensions),
    },
    resolve: {
      alias: {
        '#local-modules': fileURLToPath(
          new URL(
            withLocalExtensions
              ? './src/modules/local.host.ts'
              : './src/modules/local.public.ts',
            import.meta.url,
          ),
        ),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
