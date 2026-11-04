import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@mkp/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@mkp/react': fileURLToPath(new URL('./packages/react/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/core/test/**/*.test.ts', 'packages/cli/test/**/*.test.ts', 'packages/react/test/**/*.test.tsx'],
    testTimeout: 60000,
    hookTimeout: 120000,
    pool: 'threads',
  },
});
