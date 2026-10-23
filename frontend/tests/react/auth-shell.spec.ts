import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { parseAuth, parseSettings } from '../../src/api/contracts'
import { parseOperations } from '../../src/api/operations'
import { observeErrors } from '../browser-errors'

async function login(page: Page, email: string, password: string) {
  await page.getByLabel('邮箱地址', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '进入 Lumi', exact: true }).click()
}
async function openAccount(page: Page) {
  if (!(await page.getByRole('button', { name: '打开账户菜单' }).isVisible()))
    await page.getByRole('button', { name: '打开导航菜单' }).click()
  await page.getByRole('button', { name: '打开账户菜单' }).click()
}

test('real registration, deep links, role isolation, drawer focus, preferences and logout', async ({
  page,
  request,
  baseURL,
}, info) => {
  const email = process.env.E2E_ADMIN_EMAIL,
    password = process.env.E2E_ADMIN_PASSWORD
  if (!email || !password || !baseURL) throw new Error('Real E2E administrator fixture is required')
  const errors: string[] = []
  observeErrors(page, errors)
  const authResponse = await request.post('/api/v1/auth/login', {
    data: { email, password },
    headers: { 'X-Lumi-CSRF': '1', Origin: baseURL },
  })
  expect(authResponse.ok()).toBe(true)
  const admin = parseAuth(await authResponse.json())
  const headers = {
    Authorization: 'Bearer ' + admin.access_token,
    'X-Lumi-CSRF': '1',
    Origin: baseURL,
  }
  const settingsResponse = await request.get('/api/v1/admin/settings/registration', { headers })
  expect(settingsResponse.ok()).toBe(true)
  const settings = parseSettings(await settingsResponse.json())
  const operationsResponse = await request.get('/api/v1/admin/operations-settings', { headers })
  expect(operationsResponse.ok()).toBe(true)
  const { turnstile_secret_configured: configured, ...operationSettings } = parseOperations(
    await operationsResponse.json(),
  )
  void configured
  expect(
    (
      await request.put('/api/v1/admin/settings/registration', {
        headers,
        data: {
          registration: {
            ...settings.registration,
            enabled: true,
            email_verification_enabled: false,
          },
        },
      })
    ).ok(),
  ).toBe(true)
  const memberEmail = `react-${randomUUID()}@lumi.test`,
    memberPassword = randomBytes(18).toString('base64url') + 'Aa1'
  try {
    await page.goto('/create?draft=kept')
    await expect(page).toHaveURL(/\/login\?redirect=%2Fcreate%3Fdraft%3Dkept$/)
    await page.getByRole('link', { name: '注册', exact: true }).click()
    await page.getByLabel('昵称', { exact: true }).fill('React 创作者')
    await page.getByLabel('邮箱地址', { exact: true }).fill(memberEmail)
    await page.getByLabel('密码', { exact: true }).fill(memberPassword)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: '创建账号', exact: true }).click()
    await expect(page).toHaveURL(/\/create\?draft=kept$/)
    await expect(page.getByRole('heading', { name: '让想象成为画面', exact: true })).toBeVisible()
    const cookie = (await page.context().cookies()).find((entry) => entry.name === 'lumi_refresh')
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('Lax')
    expect(cookie?.path).toBe('/api/v1/auth')
    expect(
      await page.evaluate(() =>
        Object.values(localStorage).some((value) => value.startsWith('eyJ')),
      ),
    ).toBe(false)
    await page.reload()
    await expect(page).toHaveURL(/\/create\?draft=kept$/)
    await expect(page.getByRole('heading', { name: '让想象成为画面', exact: true })).toBeVisible()
    await page.goto('/admin/users')
    await expect(page).toHaveURL(/\/chat$/)
    await expect(page.getByRole('heading', { name: '今天想创造什么？', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '管理后台', exact: true })).toHaveCount(0)
    const mobile = info.project.name.includes('mobile')
    if (mobile) {
      const trigger = page.getByRole('button', { name: '打开导航菜单' })
      await trigger.click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(trigger).toBeFocused()
      await page.keyboard.press('Control+k')
      await expect(page.getByRole('searchbox')).toBeFocused()
    }
    await openAccount(page)
    const menu = await page.getByRole('menu').boundingBox()
    expect(menu).not.toBeNull()
    if (menu) {
      expect(menu.width).toBeLessThanOrEqual(264)
      expect(menu.x).toBeGreaterThanOrEqual(0)
      expect(menu.x + menu.width).toBeLessThanOrEqual(info.project.use.viewport?.width ?? 1440)
    }
    await expect(page.getByRole('menuitem', { name: '管理后台', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    if (mobile) await page.getByRole('button', { name: '关闭导航菜单' }).click()
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/me/preferences') && response.request().method() === 'PUT',
    )
    await page.getByRole('button', { name: '切换深色主题' }).click()
    expect((await saved).ok()).toBe(true)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.getByRole('heading', { name: '今天想创造什么？', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: info.outputPath('workspace-dark.png'),
      fullPage: true,
      animations: 'disabled',
    })
    expect(
      (
        await request.put('/api/v1/admin/operations-settings', {
          headers,
          data: { ...operationSettings, maintenance: true },
        })
      ).ok(),
    ).toBe(true)
    await page.reload()
    await expect(page.getByRole('heading', { name: '服务正在维护', exact: true })).toBeVisible()
    expect(
      (
        await request.put('/api/v1/admin/operations-settings', { headers, data: operationSettings })
      ).ok(),
    ).toBe(true)
    await page.getByRole('button', { name: '重新加载', exact: true }).click()
    await expect(page.getByRole('heading', { name: '今天想创造什么？', exact: true })).toBeVisible()
    await openAccount(page)
    await page.getByRole('menuitem', { name: '退出登录', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    await page.reload()
    await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible()
    await page.goto('/login?redirect=https%3A%2F%2Fexample.com')
    await login(page, email, password)
    await expect(page).toHaveURL(/\/chat$/)
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin\/dashboard$/)
    await expect(page.getByRole('heading', { name: '数据看板', exact: true })).toBeVisible()
    if (mobile) await page.getByRole('button', { name: '打开导航菜单' }).click()
    for (const group of ['用户与财务', 'AI 服务', '运营与安全'])
      await expect(page.getByRole('heading', { name: group, exact: true })).toBeVisible()
    await page.screenshot({
      path: info.outputPath('admin-navigation.png'),
      fullPage: true,
      animations: 'disabled',
    })
    expect(errors).toEqual([])
  } finally {
    await request.put('/api/v1/admin/operations-settings', { headers, data: operationSettings })
    await request.put('/api/v1/admin/settings/registration', {
      headers,
      data: { registration: settings.registration },
    })
  }
})

test('public legal, 404 and real password recovery keep reset tokens out of URLs', async ({
  page,
}) => {
  await page.goto('/terms')
  await expect(page.getByRole('heading', { name: '用户协议', exact: true })).toBeVisible()
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { name: '隐私政策', exact: true })).toBeVisible()
  await page.goto('/does-not-exist')
  await expect(page.getByRole('heading', { name: '这一页还没有内容', exact: true })).toBeVisible()
  await page.goto('/forgot-password')
  await page.getByLabel('邮箱地址', { exact: true }).fill(`missing-${randomUUID()}@lumi.test`)
  await page.getByRole('button', { name: '发送重置链接', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('如果该邮箱可重置密码')
  await page.getByRole('link', { name: '返回登录', exact: true }).click()
  await page.goto('/reset-password#token=invalid-test-token')
  await expect(page).toHaveURL(/\/reset-password$/)
  await page.getByLabel('新密码', { exact: true }).fill('TestOnlyPassword42')
  await page.getByRole('button', { name: '更新密码', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  expect(
    await page.evaluate(() =>
      Object.values(localStorage).some((value) => value.includes('invalid-test-token')),
    ),
  ).toBe(false)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
