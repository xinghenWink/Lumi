import { expect, test } from '@playwright/test'

test('serves the embedded page and real version API', async ({ page, request }, testInfo) => {
  const response = await request.get('/api/version')
  expect(response.ok()).toBe(true)
  const version: unknown = await response.json()
  expect(version).toMatchObject({ version: expect.any(String), commit: expect.any(String) })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '让想法，慢慢成形。' })).toBeVisible()
  await expect(page.getByRole('definition').first()).toBeVisible()
  await page.getByRole('button', { name: '刷新版本信息' }).click()
  await expect(page.getByText('正在读取版本信息…')).not.toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: testInfo.outputPath('welcome.png'), fullPage: true })
})

test('supports error retry and SPA navigation', async ({ page }) => {
  await page.route('**/api/version', (route) => route.fulfill({ status: 503, body: '{}' }))
  await page.goto('/')
  await expect(page.getByText('暂时无法读取版本信息，请确认服务已启动后重试。')).toBeVisible()
  await page.unroute('**/api/version')
  await page.getByRole('button', { name: '重新获取' }).click()
  await expect(page.getByRole('definition').first()).toBeVisible()
  await page.goto('/page-that-does-not-exist')
  await expect(page.getByRole('heading', { name: '这一页还没有内容' })).toBeVisible()
  await page.getByRole('link', { name: '返回首页' }).click()
  await expect(page.getByRole('heading', { name: '让想法，慢慢成形。' })).toBeVisible()
})
