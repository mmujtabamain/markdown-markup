import { defineConfig } from '@playwright/test';

// PG_PORT lets two copies of the repository test at once
const port = Number(process.env.PG_PORT) || 5182;

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1280, height: 900 }, launchOptions: { args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] } },
  webServer: { command: `node node_modules/vite/bin/vite.js build && node node_modules/vite/bin/vite.js preview --port ${port} --strictPort`, port, timeout: 300_000, reuseExistingServer: true },
});
