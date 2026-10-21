import { defineConfig } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:18080'
const serverBinary = process.platform === 'win32' ? '..\\bin\\lumi-e2e.exe' : '../bin/lumi-e2e'
process.env.E2E_ADMIN_EMAIL ??= 'admin@lumi.test'
process.env.E2E_ADMIN_PASSWORD ??= `${randomBytes(24).toString('base64url')}Aa1`
process.env.E2E_JWT_SECRET ??= randomBytes(32).toString('base64url')
process.env.E2E_ENCRYPTION_KEY ??= randomBytes(32).toString('base64')

export default defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 120_000,
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 320, height: 740 } } },
  ],
  webServer: {
    command: `go build -tags=production -o ${serverBinary} ./cmd/lumi && ${serverBinary} serve`,
    cwd: '../backend',
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_ENV: 'test',
      HTTP_ADDR: `127.0.0.1:${new URL(baseURL).port || '18080'}`,
      PUBLIC_BASE_URL: baseURL,
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? '',
      REDIS_URL: process.env.E2E_REDIS_URL ?? '',
      JWT_SECRET: process.env.E2E_JWT_SECRET,
      ENCRYPTION_KEY: process.env.E2E_ENCRYPTION_KEY,
      ADMIN_EMAIL: process.env.E2E_ADMIN_EMAIL,
      ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD,
      COOKIE_SECURE: 'false',
      GIN_MODE: 'release',
    },
  },
})
