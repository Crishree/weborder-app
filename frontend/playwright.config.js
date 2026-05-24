import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: [
    {
      command: 'PORT=4000 FRONTEND_BASE_URL=http://127.0.0.1:4173 node /Users/shreedhar/Downloads/neubar-web-order-mvp/backend/src/server.js',
      url: 'http://127.0.0.1:4000/health',
      reuseExistingServer: true
    },
    {
      command: 'VITE_API_BASE=http://127.0.0.1:4000 npm run dev -- --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: true
    }
  ]
});
