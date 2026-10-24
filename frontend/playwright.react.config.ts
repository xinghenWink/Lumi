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
      },
    },
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
})
