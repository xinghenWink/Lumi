import { defineConfig, devices } from '@playwright/test'
import { randomBytes } from 'node:crypto'

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:18080'
const serverBinary = process.platform === 'win32' ? '..\\bin\\lumi-e2e.exe' : '../bin/lumi-e2e'
process.env.E2E_ADMIN_EMAIL ??= 'admin@lumi.test'
process.env.E2E_ADMIN_PASSWORD ??= `${randomBytes(24).toString('base64url')}Aa1`
process.env.E2E_JWT_SECRET ??= randomBytes(32).toString('base64url')
process.env.E2E_ENCRYPTION_KEY ??= randomBytes(32).toString('base64')

export default defineConfig({
  testDir: './tests',
  // Original entry files import these complete ports; avoid collecting them twice.
  testIgnore: [
    '**/embed/**',
    '**/react/account-settings.spec.ts',
    '**/react/accounts-credits.spec.ts',
    '**/react/admin-finance.spec.ts',
    '**/react/catalog.spec.ts',
    '**/react/chat.spec.ts',
    '**/react/images.spec.ts',
    '**/react/operations.spec.ts',
  ],
  testMatch: '**/*.spec.ts',
  outputDir: './test-results/e2e',
  workers: 1,
  timeout: 120_000,
  use: { baseURL, trace: 'retain-on-failure', actionTimeout: 10_000, navigationTimeout: 15_000 },
  projects: [
    { name: 'chrome-desktop', use: { channel: 'chrome', viewport: { width: 1440, height: 900 } } },
    ...[320, 390].map((width) => ({
      name: `chrome-mobile-${width}`,
      use: {
        ...devices['Pixel 7'],
        channel: 'chrome',
        viewport: { width, height: 740 },
        isMobile: true,
        hasTouch: true,
      },
    })),
  ],
  webServer: {
    command: `go build -tags=production -o ${serverBinary} ./cmd/lumi && ${serverBinary} serve`,
    cwd: '../backend',
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_ENV: 'test',
      DATA_DIR: '../.tools/e2e-data',
      UPSTREAM_ALLOW_PRIVATE_NETWORKS: 'true',
      // Viewport projects represent separate clients while retaining real IP rate limits.
      TRUSTED_PROXIES: '127.0.0.1',
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
