import { defineConfig, devices } from '@playwright/test'
import legacy from './playwright.config'

export default defineConfig({
  ...legacy,
  testDir: './tests/react',
  testIgnore: [],
  outputDir: './test-results/react',
  projects: [
    {
      name: 'chrome-desktop',
      use: {
        channel: 'chrome',
        viewport: { width: 1440, height: 900 },
        extraHTTPHeaders: { 'X-Forwarded-For': '198.19.0.1' },
      },
    },
    ...[320, 390].map((width, index) => ({
      name: `chrome-mobile-${width}`,
      use: {
        ...devices['Pixel 7'],
        channel: 'chrome',
        viewport: { width, height: 740 },
        isMobile: true,
        hasTouch: true,
        extraHTTPHeaders: { 'X-Forwarded-For': `198.19.0.${index + 2}` },
      },
    })),
  ],
})
