import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@mkp/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@mkp/react': fileURLToPath(new URL('../../packages/react/src/index.tsx', import.meta.url)),
    },
  },
  server: { fs: { allow: [root] }, port: 5181, strictPort: true },
  preview: { port: 5182, strictPort: true },
  build: { chunkSizeWarningLimit: 6000, target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
});
