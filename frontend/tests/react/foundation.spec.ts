import { expect, test } from './test'
import { observeErrors } from '../browser-errors'

test('candidate loads embedded assets, real version, locale and persistent appearance', async ({
  page,
  request,
}, info) => {
  const failures: string[] = []
  observeErrors(page, failures)
  const response = await request.get('/api/version')
  expect(response.ok()).toBe(true)
  const version: unknown = await response.json()
  if (
    typeof version !== 'object' ||
    version === null ||
    !('version' in version) ||
    typeof version.version !== 'string'
  )
    throw new Error('Invalid real version response')
  await page.goto('/chat')
  await expect(page).toHaveURL(/\/login\?redirect=%2Fchat$/)
  await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible()
  await expect(page.getByRole('contentinfo')).toContainText(version.version)
  await page.getByRole('button', { name: '切换深色主题' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: '切换语言' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  if (info.project.name.includes('mobile'))
    expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0)
  await page.screenshot({
    path: info.outputPath('react-foundation-dark.png'),
    fullPage: true,
    animations: 'disabled',
  })
  expect(failures).toEqual([])
})
