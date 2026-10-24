import { defineConfig } from '@playwright/test'
import candidate from './playwright.react.config'

// The driver starts the actual production container; no native server is allowed here.
const { webServer: nativeServer, ...shared } = candidate
void nativeServer
if (!process.env.E2E_EMBED_URL) throw new Error('Run scripts/react-embed-smoke.mjs')
export default defineConfig({
  ...shared,
  testDir: './tests/embed',
  outputDir: './test-results/embed',
  use: { ...shared.use, baseURL: process.env.E2E_EMBED_URL },
})
