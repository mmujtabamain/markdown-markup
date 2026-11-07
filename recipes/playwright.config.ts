import { defineConfig, devices } from '@playwright/test';

// npm run setup && npm run build first: the tests open each recipe's built site
export default defineConfig({
  testDir: 'test',
  timeout: 60000,
  reporter: process.env.CI ? 'github' : 'line',
  use: { ...devices['Desktop Chrome'] },
});
