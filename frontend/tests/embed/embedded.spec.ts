import { expect, test } from '@playwright/test'
import { observeErrors } from '../browser-errors'
import { record } from '../../src/api/transport'

test('production Docker Go embed serves authenticated React deep links and static boundaries', async ({
  page,
  request,
}, info) => {
  const email = process.env.E2E_EMBED_EMAIL,
    password = process.env.E2E_EMBED_PASSWORD,
    commit = process.env.E2E_EMBED_COMMIT
  if (!email || !password || !commit) throw new Error('Missing isolated container fixture')
  const errors: string[] = []
  observeErrors(page, errors)
  expect((await request.get('/readyz')).ok()).toBe(true)
  const version = record(await (await request.get('/api/version')).json())
  expect(version.commit).toBe(commit)
  expect(version.version).toBe('react-embed-smoke')
  const entry = await page.goto('/admin/system')
  expect(entry?.headers()['content-security-policy']).toContain("default-src 'self'")
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await page.getByLabel('邮箱地址', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '进入 Lumi', exact: true }).click()
  await expect(page.getByRole('heading', { name: '系统信息', exact: true })).toBeVisible()
  await expect(page.getByText(commit, { exact: true })).toBeVisible()
  await expect(page.getByText('数据库连接', { exact: true })).toBeVisible()
  const cookie = (await page.context().cookies()).find((item) => item.name === 'lumi_refresh')
  expect(cookie?.httpOnly).toBe(true)
  expect(cookie?.sameSite).toBe('Lax')
  await page.reload()
  await expect(page.getByRole('heading', { name: '系统信息', exact: true })).toBeVisible()
  await page.goto('/chat')
  await expect(page.getByRole('heading', { name: '今天想创造什么？', exact: true })).toBeVisible()
  // All projects deliberately reuse one real account, including its saved appearance.
  if (await page.getByRole('button', { name: '切换浅色主题', exact: true }).isVisible()) {
    await page.getByRole('button', { name: '切换浅色主题', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  }
  await page.getByRole('button', { name: '切换深色主题', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.goto('/create')
  await expect(page.getByLabel('画面描述', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('docker-react-dark.png'), animations: 'disabled' })
  for (const path of ['/assets/does-not-exist.js', '/api/v1/does-not-exist']) {
    const missing = await request.get(path)
    expect(missing.status()).toBe(404)
    expect(missing.headers()['content-type']).not.toContain('text/html')
  }
  const assets = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((url) => new URL(url).pathname.startsWith('/assets/')),
  )
  expect(assets.length).toBeGreaterThan(0)
  for (const asset of assets) expect((await request.get(asset)).ok()).toBe(true)
  await page.goto('/admin/settings/site')
  await expect(page.getByLabel('站点名称 · 环境配置', { exact: true })).toBeDisabled()
  await expect(page.getByLabel('站点名称 · 环境配置', { exact: true })).toHaveValue('Lumi Docker')
  expect(errors).toEqual([])
})
