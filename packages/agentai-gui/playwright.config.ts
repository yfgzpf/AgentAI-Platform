import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: 'C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
        },
      },
    },
  ],
  webServer: [
    {
      // 1. Gateway (真后端, E2E 必需)
      command: 'cd ../agentai-gateway && node dist/index.js',
      url: 'http://127.0.0.1:18789/health',
      reuseExistingServer: true,
      timeout: 30000,
      stdout: 'pipe',
    },
    {
      // 2. Vite preview (前端)
      command: 'node ./node_modules/vite/bin/vite.js preview --port 4173 --host 127.0.0.1',
      url: 'http://localhost:4173',
      reuseExistingServer: true,
      timeout: 30000,
    },
  ],
});
