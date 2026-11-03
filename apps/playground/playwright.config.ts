import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 600_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5182', viewport: { width: 1100, height: 900 }, launchOptions: { args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] } },
  webServer: { command: 'node node_modules/vite/bin/vite.js build && node node_modules/vite/bin/vite.js preview --port 5182 --strictPort', port: 5182, timeout: 300_000, reuseExistingServer: true },
});
