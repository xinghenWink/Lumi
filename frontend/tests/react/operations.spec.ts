import { randomUUID } from 'node:crypto'
import { expect, test } from './test'
import { observeErrors } from '../browser-errors'

test('M6 dashboard, preferences, announcements, exports and system information', async ({
  page,
}, info) => {
  const email = process.env.E2E_ADMIN_EMAIL,
    password = process.env.E2E_ADMIN_PASSWORD
  if (!email || !password || !process.env.E2E_DATABASE_URL)
    throw new Error('M6 E2E requires the real database and administrator fixture')
  const errors: string[] = []
  observeErrors(page, errors)
  await page.goto('/login')
  await page.getByLabel('邮箱地址', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '进入 Lumi', exact: true }).click()
  await expect(page).toHaveURL(/\/chat$/)
  const login = await page.request.post('/api/v1/auth/login', {
    headers: { 'X-Lumi-CSRF': '1', Origin: new URL(page.url()).origin },
    data: { email, password },
  })
  expect(login.ok()).toBe(true)
  const result: unknown = await login.json()
  if (
    typeof result !== 'object' ||
    result === null ||
    !('access_token' in result) ||
    typeof result.access_token !== 'string'
  )
    throw new Error('Invalid login response')
  const headers = {
    Authorization: 'Bearer ' + result.access_token,
    'X-Lumi-CSRF': '1',
    Origin: new URL(page.url()).origin,
  }
  const name = 'M6 ' + randomUUID(),
    announcement = await page.request.post('/api/v1/admin/announcements', {
      headers,
      data: {
        content: name,
        starts_at: new Date(Date.now() - 60000).toISOString(),
        ends_at: null,
        enabled: true,
        version: 0,
      },
    })
  expect(announcement.ok()).toBe(true)
  const announcementData: unknown = await announcement.json()
  if (
    typeof announcementData !== 'object' ||
    announcementData === null ||
    !('id' in announcementData) ||
    typeof announcementData.id !== 'string'
  )
    throw new Error('Invalid announcement')
  try {
    await page.goto('/admin/dashboard')
    await expect(page.getByRole('heading', { name: '数据看板', exact: true })).toBeVisible()
    await expect(page.locator('.ops-announcements')).toContainText(name)
    await expect(page.getByRole('heading', { name: '每日趋势（UTC）' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: info.outputPath('m6-dashboard.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await page.goto('/me/security')
    await expect(page.getByRole('heading', { name: '个人偏好', exact: true })).toBeVisible()
    await page.getByLabel('自定义指令', { exact: true }).fill('M6 browser preference')
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('修改已保存')
    await page.reload()
    await expect(page.getByLabel('自定义指令', { exact: true })).toHaveValue(
      'M6 browser preference',
    )
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出聊天 JSON', exact: true }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('lumi-chats.json')
    await page.goto('/admin/operations-settings')
    await expect(page.getByRole('heading', { name: '安全与维护', exact: true })).toBeVisible()
    await expect(
      page.getByLabel('每 IP 每 24 小时注册配额（0 不限制）', { exact: true }),
    ).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: info.outputPath('m6-operations.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await page.goto('/admin/system')
    await expect(page.getByRole('heading', { name: '系统信息', exact: true })).toBeVisible()
    await expect(page.getByText('数据库连接', { exact: true })).toBeVisible()
    await page.goto('/admin/announcements')
    await expect(page.locator('.ops-section').filter({ hasText: name })).toBeVisible()
    const metrics = await page.request.get('/metrics', { headers })
    expect(metrics.ok()).toBe(true)
    expect(await metrics.text()).toContain('lumi_http_requests_total')
  } finally {
    await page.request.delete('/api/v1/admin/announcements/' + announcementData.id, { headers })
    await page.request.put('/api/v1/me/preferences', {
      headers,
      data: {
        theme: 'system',
        instructions: '',
        image_quality: 'medium',
        image_ratio: '1:1',
        image_count: 1,
      },
    })
  }
  expect(errors).toEqual([])
})
