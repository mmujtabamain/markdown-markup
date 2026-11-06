import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // GitHub Pages serves the build from /markdown-markup/
  base: process.env.PLAYGROUND_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@mkp/core': at('../../packages/core/src/index.ts'),
      '@mkp/react': at('../../packages/react/src/index.tsx'),
      '@mkp/shadcn': at('../../packages/shadcn/src/index.tsx'),
      '@mkp/page': at('../../packages/page/src/index.ts'),
      '@': at('src'),
    },
  },
  define: { __PG_COMMIT__: JSON.stringify((process.env.GITHUB_SHA ?? '').slice(0, 7)) },
  server: { fs: { allow: [root] }, port: 5181, strictPort: true },
  // the DevBench preview serves the built playground with `vite preview` behind its own host name
  preview: { port: 5182, strictPort: true, allowedHosts: ['.preview.devbench.sh'] },
  // two pages: the landing page at /, and the docs (the playground) at docs/
  build: { chunkSizeWarningLimit: 6000, target: 'es2022', rollupOptions: { input: { index: at('index.html'), docs: at('docs/index.html') } } },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
});
