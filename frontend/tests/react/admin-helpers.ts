import { journeyHeaders } from './client-headers'
import { expect, type Browser, type Page, type TestInfo } from '@playwright/test'
import { record } from '../../src/api/transport'

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('邮箱地址', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill(password)
  const pending = page.waitForResponse(
    (response) => response.url().endsWith('/auth/login') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: '进入 Lumi', exact: true }).click()
  const data = record(await (await pending).json())
  await expect(page).toHaveURL(/\/chat$/)
  if (typeof data.access_token !== 'string') throw new Error('Missing real session token')
  return data.access_token
}
export async function adminFixture(page: Page, baseURL: string | undefined) {
  const email = process.env.E2E_ADMIN_EMAIL,
    password = process.env.E2E_ADMIN_PASSWORD
  if (
    !baseURL ||
    !email ||
    !password ||
    !process.env.E2E_DATABASE_URL ||
    !process.env.E2E_REDIS_URL
  )
    throw new Error('Real administration fixtures require Go, PostgreSQL and Redis')
  const token = await login(page, email, password)
  return {
    email,
    token,
    api: async (
      method: string,
      path: string,
      body?: unknown,
      accessToken = token,
      key?: string,
    ) => {
      const response = await page.request.fetch('/api/v1' + path, {
        method,
        headers: {
          Authorization: 'Bearer ' + accessToken,
          'X-Lumi-CSRF': '1',
          Origin: baseURL,
          ...(key ? { 'Idempotency-Key': key } : {}),
        },
        ...(body === undefined ? {} : { data: body }),
      })
      expect(response.ok(), path + ' status ' + response.status()).toBe(true)
      return response.status() === 204 ? {} : record(await response.json())
    },
  }
}
export function memberContext(browser: Browser, baseURL: string | undefined, info: TestInfo) {
  if (!baseURL) throw new Error('Missing real server URL')
  return browser.newContext({
    baseURL,
    viewport: info.project.use.viewport ?? { width: 1440, height: 900 },
    ...(info.project.use.userAgent ? { userAgent: info.project.use.userAgent } : {}),
    deviceScaleFactor: info.project.use.deviceScaleFactor ?? 1,
    isMobile: info.project.use.isMobile ?? false,
    hasTouch: info.project.use.hasTouch ?? false,
    extraHTTPHeaders: journeyHeaders(info),
  })
}
export async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}
