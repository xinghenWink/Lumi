import { expect, test } from '@playwright/test'

test('@guest serves the sign-in page, route guard and theme at 320px', async ({
  page,
  request,
}, info) => {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  expect((await request.get('/healthz')).ok()).toBe(true)
  expect((await request.get('/api/version')).ok()).toBe(true)
  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  await page.getByRole('button', { name: '切换深色主题' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('login-dark.png'), fullPage: true })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(failures).toEqual([])
})

test('@guest legal pages and unknown SPA routes remain accessible', async ({ page }, info) => {
  await page.goto('/register')
  await expect(page.getByRole('heading', { name: '创建你的账号' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('register.png'), fullPage: true })
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { name: '隐私政策', exact: true })).toBeVisible()
  await page.goto('/page-that-does-not-exist')
  await expect(page.getByRole('heading', { name: '这一页还没有内容' })).toBeVisible()
  await page.getByRole('link', { name: '返回首页' }).click()
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
})
