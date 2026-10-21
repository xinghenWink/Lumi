import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://127.0.0.1:8080', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 320, height: 740 } } },
  ],
  webServer: {
    command: 'go run -tags=production ./cmd/lumi serve',
    cwd: '../backend',
    url: 'http://127.0.0.1:8080/healthz',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      APP_ENV: 'test',
      HTTP_ADDR: '127.0.0.1:8080',
      DATABASE_URL: '',
      REDIS_URL: '',
      GIN_MODE: 'release',
    },
  },
})
