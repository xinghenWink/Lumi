import { randomBytes, randomUUID } from 'node:crypto'
import { record } from '../../src/api/transport'
import { journeyHeaders } from './client-headers'
import { expect, test, type Page } from './test'

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('邮箱地址', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill(password)
  const response = page.waitForResponse('**/api/v1/auth/login')
  await page.getByRole('button', { name: '进入 Lumi', exact: true }).click()
  const result = record(await (await response).json())
  await expect(page).toHaveURL(/\/chat$/)
  if (typeof result.access_token !== 'string') throw new Error('Missing session token')
  return result.access_token
}

async function fillRegistration(page: Page, email: string, password: string) {
  await page.getByLabel('昵称', { exact: true }).fill('新朋友')
  await page.getByLabel('邮箱地址', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('checkbox').check()
}

test('invite link, editable registration and permanent rewards for both users', async ({
  page,
  browser,
  baseURL,
}, info) => {
  const adminEmail = process.env.E2E_ADMIN_EMAIL
  const adminPassword = process.env.E2E_ADMIN_PASSWORD
  if (!adminEmail || !adminPassword || !baseURL)
    throw new Error('Missing real administrator fixture')
  const token = await login(page, adminEmail, adminPassword)
  async function api(method: string, path: string, data?: unknown) {
    const response = await page.request.fetch('/api/v1' + path, {
      method,
      headers: { Origin: String(baseURL), 'X-Lumi-CSRF': '1', Authorization: 'Bearer ' + token },
      ...(data === undefined ? {} : { data }),
    })
    expect(response.ok(), path + ' status ' + response.status()).toBe(true)
    return response.status() === 204 ? {} : record(await response.json())
  }
  const pricing = await api('GET', '/admin/pricing')
  const { registration } = await api('GET', '/admin/settings/registration')
  const contextOptions = {
    baseURL,
    viewport: info.project.use.viewport ?? { width: 1440, height: 900 },
    ...(info.project.use.userAgent ? { userAgent: info.project.use.userAgent } : {}),
    deviceScaleFactor: info.project.use.deviceScaleFactor ?? 1,
    isMobile: info.project.use.isMobile ?? false,
    hasTouch: info.project.use.hasTouch ?? false,
    extraHTTPHeaders: journeyHeaders(info),
  }
  const inviterContext = await browser.newContext(contextOptions)
  const guestContext = await browser.newContext(contextOptions)
  const ordinaryContext = await browser.newContext(contextOptions)
  const accounts: { id: string; email: string }[] = []
  const password = randomBytes(24).toString('base64url') + 'Aa1'
  const inviterEmail = 'inviter-' + randomUUID() + '@lumi.test'
  const register = async (guest: Page, email: string) => {
    const response = guest.waitForResponse('**/api/v1/auth/register')
    await guest.getByRole('button', { name: '创建账号', exact: true }).click()
    const result = await response
    expect(result.status()).toBe(201)
    const user = record(record(await result.json()).user)
    accounts.push({ id: String(user.id), email })
    await expect(guest).toHaveURL(/\/chat$/)
    await guest.goto('/me/credits')
  }

  try {
    await api('PUT', '/admin/settings/registration', {
      registration: { ...record(registration), enabled: true, email_verification_enabled: false },
    })
    await page.goto('/admin/pricing')
    await page.getByLabel('注册赠送积分', { exact: true }).fill('10')
    await page.getByLabel('邀请人奖励积分', { exact: true }).fill('7')
    await page.getByLabel('被邀请人奖励积分', { exact: true }).fill('3')
    await page.getByRole('button', { name: '保存价格与赠送', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('价格与赠送配置已保存')
    await page.reload()
    await expect(page.getByLabel('邀请人奖励积分', { exact: true })).toHaveValue('7')
    await expect(page.getByLabel('被邀请人奖励积分', { exact: true })).toHaveValue('3')

    const created = await api('POST', '/admin/users', {
      email: inviterEmail,
      password,
      nickname: '邀请人',
      role: 'user',
      initial_credits: 20,
    })
    accounts.push({ id: String(created.id), email: inviterEmail })
    await inviterContext.grantPermissions(['clipboard-read', 'clipboard-write'])
    const inviter = await inviterContext.newPage()
    await login(inviter, inviterEmail, password)
    await inviter.goto('/me/credits')
    await expect(
      inviter.getByText('每邀请一位好友注册，你获得 7 积分，好友获得 3 积分。', { exact: true }),
    ).toBeVisible()
    await inviter.getByRole('button', { name: '生成邀请链接', exact: true }).press('Enter')
    const linkField = inviter.getByLabel('我的邀请链接', { exact: true })
    await expect(linkField).toHaveValue(/\/register\?invite_code=[A-F0-9]{16}$/)
    const code = await inviter.getByLabel('我的邀请码', { exact: true }).inputValue()
    const link = await linkField.inputValue()
    expect(link).toBe(baseURL + '/register?invite_code=' + code)
    await inviter.getByRole('button', { name: '复制邀请链接', exact: true }).press('Enter')
    await expect(inviter.getByText('邀请链接已复制。', { exact: true })).toBeVisible()
    expect(await inviter.evaluate(() => navigator.clipboard.readText())).toBe(link)
    await inviter.evaluate(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', {
        value: () => Promise.reject(new DOMException('Clipboard unavailable', 'NotAllowedError')),
      })
    })
    await inviter.getByRole('button', { name: '复制邀请链接', exact: true }).press('Enter')
    await expect(inviter.getByText('无法自动复制，已选中链接，请手动复制。')).toBeVisible()
    await expect(linkField).toBeFocused()
    expect(await linkField.evaluate((input: HTMLInputElement) => input.selectionEnd)).toBe(
      link.length,
    )

    const guest = await guestContext.newPage()
    await guest.goto(link)
    const inviteField = guest.getByLabel('邀请码（选填）', { exact: true })
    await expect(inviteField).toHaveValue(code)
    const guestEmail = 'invitee-' + randomUUID() + '@lumi.test'
    await fillRegistration(guest, guestEmail, password)
    await inviteField.fill('INVALID')
    await guest.getByRole('button', { name: '创建账号', exact: true }).click()
    await expect(guest.getByRole('alert')).toContainText('邀请码无效或已失效')
    await expect(inviteField).toHaveAttribute('aria-invalid', 'true')
    await expect(inviteField).toHaveAccessibleDescription(
      '邀请码无效或已失效，请修改或清空后重试。',
    )
    await expect(guest.getByLabel('邮箱地址', { exact: true })).toHaveValue(guestEmail)
    await inviteField.fill(' ' + code.toLowerCase() + ' ')
    await register(guest, guestEmail)
    await expect(guest.getByTestId('permanent-balance')).toHaveText('13')
    await expect(guest.getByRole('row').filter({ hasText: '受邀注册奖励' })).toContainText('+3')

    const ordinary = await ordinaryContext.newPage()
    const ordinaryEmail = 'ordinary-' + randomUUID() + '@lumi.test'
    await ordinary.goto(link)
    await expect(ordinary.getByLabel('邀请码（选填）', { exact: true })).toHaveValue(code)
    await ordinary.getByLabel('邀请码（选填）', { exact: true }).clear()
    await fillRegistration(ordinary, ordinaryEmail, password)
    await register(ordinary, ordinaryEmail)
    await expect(ordinary.getByTestId('permanent-balance')).toHaveText('10')

    await inviter.reload()
    await expect(linkField).toHaveValue(link)
    await expect(inviter.getByTestId('permanent-balance')).toHaveText('27')
    await expect(inviter.getByRole('row').filter({ hasText: '邀请好友奖励' })).toContainText('+7')
    await inviter.getByRole('button', { name: '切换深色主题', exact: true }).click()
    await expect(inviter.locator('html')).toHaveAttribute('data-theme', 'dark')
    const card = inviter.getByRole('region', { name: '邀请好友', exact: true })
    await expect(card).toBeVisible()
    expect(await inviter.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
    await card.screenshot({ path: info.outputPath('referral-dark.png'), animations: 'disabled' })
  } finally {
    await Promise.all([inviterContext.close(), guestContext.close(), ordinaryContext.close()])
    await api('PUT', '/admin/pricing', pricing)
    await api('PUT', '/admin/settings/registration', { registration })
    for (const account of accounts)
      await api('DELETE', '/admin/users/' + account.id, { email: account.email })
  }
})
