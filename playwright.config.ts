import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    headless: true,
    baseURL: process.env.QA_BASE_URL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 30_000,
  },
  projects: [
    // Script API theo task: không cần browser.
    { name: 'api', testMatch: /tests\/api\/.*\.spec\.ts/ },
    { name: 'e2e', testMatch: /tests\/e2e\/.*\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
  ],
});
