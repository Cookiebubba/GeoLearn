import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.E2E_PORT ?? 8799);
const dataDir = join(tmpdir(), `geolearn-e2e-${Date.now()}`);

export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone', use: { ...devices['iPhone SE (3rd gen)'], browserName: 'chromium' } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } }, testMatch: /desktop\.spec\.ts|multiplayer\.spec\.ts/ },
  ],
  webServer: {
    // Runs the production bundle (build first with `npm run build`).
    command: `node ../apps/server/dist/index.js`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT), DATA_DIR: dataDir, LOG_LEVEL: 'warn', HOST: '127.0.0.1' },
    timeout: 60_000,
  },
});
