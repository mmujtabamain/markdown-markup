import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@mkp/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@mkp/react': fileURLToPath(new URL('./packages/react/src/index.tsx', import.meta.url)),
      '@mkp/shadcn': fileURLToPath(new URL('./packages/shadcn/src/index.tsx', import.meta.url)),
      '@mkp/page': fileURLToPath(new URL('./packages/page/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./apps/site/src', import.meta.url)),
    },
  },
  test: {
    include: ['scripts/**/*.test.ts', 'packages/core/test/**/*.test.ts', 'packages/cli/test/**/*.test.ts', 'packages/react/test/**/*.test.tsx', 'packages/shadcn/test/**/*.test.tsx', 'packages/page/test/**/*.test.ts', 'packages/dom/test/**/*.test.tsx', 'apps/site/test/**/*.test.tsx'],
    testTimeout: 60000,
    hookTimeout: 120000,
    pool: 'threads',
    // the CLI built once, before any test: the tests that spawn it never see it half-rewritten
    globalSetup: ['./scripts/test-setup.mjs'],
  },
});
