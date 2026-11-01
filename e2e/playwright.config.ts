import { defineConfig, devices } from '@playwright/test'

// Runs against the built store (vite preview :4173) + the FastAPI backend with zero-unit renders.
// E2E_API_PORT moves the backend off :8000 when something else already listens there.
const API_PORT = process.env.E2E_API_PORT ?? '8010' // off :8000, where the live dev backend usually runs

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, browserName: 'chromium' } },
  ],
  webServer: [
    {
      command: `uv run uvicorn app.main:app --port ${API_PORT}`,
      cwd: '../backend',
      url: `http://localhost:${API_PORT}/api/status`,
      // Own DB + never reuse a running (possibly live, unit-spending) backend.
      env: { YOUCAM_DEMO_MODE: '1', RENDER_STUB: '1', ELARA_DB_PATH: 'var/e2e/elara.db' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm build && pnpm preview',
      cwd: '../web',
      env: { ELARA_API: `http://localhost:${API_PORT}` },
      url: 'http://localhost:4173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
})
