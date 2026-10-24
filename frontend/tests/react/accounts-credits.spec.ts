import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test'
import { record } from '../../src/api/transport'
import { observeErrors } from '../browser-errors'
import { fixturePNG } from '../image-fixture'

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('邮箱地址', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill(password)
  const response = page.waitForResponse(
    (response) => response.url().endsWith('/auth/login') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: '进入 Lumi', exact: true }).click()
  const data = record(await (await response).json())
  await expect(page).toHaveURL(/\/chat$/)
  if (typeof data.access_token !== 'string') throw new Error('Missing real session token')
  return data.access_token
}
async function fixture(page: Page, browser: Browser, baseURL: string | undefined, info: TestInfo) {
  const email = process.env.E2E_ADMIN_EMAIL,
    password = process.env.E2E_ADMIN_PASSWORD
  if (!baseURL || !email || !password || !process.env.E2E_DATABASE_URL)
    throw new Error('Real account fixtures require Go, PostgreSQL and Redis')
  const adminToken = await login(page, email, password)
  const api = async (
    method: string,
    path: string,
    body?: unknown,
    token = adminToken,
    key?: string,
  ) => {
    const response = await page.request.fetch('/api/v1' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        'X-Lumi-CSRF': '1',
        Origin: baseURL,
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body === undefined ? {} : { data: body }),
    })
    expect(response.ok(), path + ' status ' + response.status()).toBe(true)
    return response.status() === 204 ? {} : record(await response.json())
  }
  const context = await browser.newContext({
    baseURL,
    viewport: info.project.use.viewport ?? { width: 1440, height: 900 },
    ...(info.project.use.userAgent ? { userAgent: info.project.use.userAgent } : {}),
    deviceScaleFactor: info.project.use.deviceScaleFactor ?? 1,
    isMobile: info.project.use.isMobile ?? false,
    hasTouch: info.project.use.hasTouch ?? false,
    extraHTTPHeaders: info.project.use.extraHTTPHeaders ?? {},
  })
  return {
    api,
    context,
    member: await context.newPage(),
    password: randomBytes(20).toString('base64url') + 'Aa1',
    email: 'account-' + randomUUID().slice(0, 12) + '@lumi.test',
    baseURL,
  }
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

test('real credits, unknown redemption replay, private records, statistics and cursor filter binding', async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180_000)
  const f = await fixture(page, browser, baseURL, info),
    errors: string[] = []
  observeErrors(page, errors)
  observeErrors(f.member, errors)
  const previousPricing = await f.api('GET', '/admin/pricing'),
    registration = await f.api('GET', '/admin/settings/registration')
  let memberID = ''
  try {
    await f.api('PUT', '/admin/pricing', {
      ...previousPricing,
      configuration: {
        ...record(previousPricing.configuration),
        signup_bonus_credits: 10,
        daily_free_credits: 5,
        credits_timezone: 'Asia/Shanghai',
      },
    })
    await f.api('PUT', '/admin/settings/registration', {
      registration: {
        ...record(registration.registration),
        enabled: true,
        email_verification_enabled: false,
      },
    })
    await f.member.goto('/register')
    await f.member.getByLabel('昵称', { exact: true }).fill('积分创作者')
    await f.member.getByLabel('邮箱地址', { exact: true }).fill(f.email)
    await f.member.getByLabel('密码', { exact: true }).fill(f.password)
    await f.member.getByRole('checkbox').check()
    const registered = f.member.waitForResponse(
      (response) =>
        response.url().endsWith('/auth/register') && response.request().method() === 'POST',
    )
    await f.member.getByRole('button', { name: '创建账号', exact: true }).click()
    const auth = record(await (await registered).json()),
      token = String(auth.access_token)
    memberID = String(record(auth.user).id)
    await expect(f.member).toHaveURL(/\/chat$/)
    await f.member.goto('/me/credits')
    await expect(f.member.getByTestId('credit-total')).toHaveText('15')
    await expect(f.member.getByTestId('daily-balance')).toHaveText('5')
    await expect(f.member.getByTestId('permanent-balance')).toHaveText('10')
    await expect(f.member.getByText('近 30 天还没有积分消耗', { exact: true })).toBeVisible()
    await f.member.getByRole('list', { name: '近 30 天每日积分消耗' }).scrollIntoViewIfNeeded()
    await expect(
      f.member.getByRole('list', { name: '近 30 天每日积分消耗' }).locator('li'),
    ).toHaveCount(30)
    await noOverflow(f.member)
    await f.member.screenshot({
      path: info.outputPath('credits-light.png'),
      animations: 'disabled',
    })
    const batch = await f.api(
      'POST',
      '/admin/redeem-batches',
      {
        name: 'Account regression ' + randomUUID(),
        note: '',
        prefix: '',
        quantity: 2,
        credits: 15,
        max_uses: 2,
        expires_at: null,
      },
      undefined,
      randomUUID(),
    )
    const codes = await f.api('GET', '/admin/redeem-codes?batch_id=' + String(batch.id))
    if (!Array.isArray(codes.items) || !codes.items.length)
      throw new Error('Missing actual redemption code')
    const code = record(codes.items[0])
    await f.api('PATCH', '/admin/redeem-codes', { ids: [code.id], enabled: false })
    await f.member.getByLabel('兑换积分', { exact: true }).fill(String(code.code))
    await f.member.getByRole('button', { name: '确认兑换', exact: true }).click()
    await expect(f.member.getByRole('alert')).toContainText('已被停用')
    await f.api('PATCH', '/admin/redeem-codes', { ids: [code.id], enabled: true })
    const keys: string[] = []
    let dropped = false
    await f.member.route('**/api/v1/me/redeem', async (route) => {
      keys.push(route.request().headers()['idempotency-key'] ?? '')
      const response = await route.fetch()
      if (response.ok() && !dropped) {
        dropped = true
        await route.abort('failed')
      } else await route.fulfill({ response })
    })
    await f.member.getByRole('button', { name: '确认兑换', exact: true }).click()
    await expect(f.member.getByRole('alert')).toContainText('网络')
    await f.member.getByRole('button', { name: '确认兑换', exact: true }).click()
    await expect(f.member.getByRole('status').filter({ hasText: '已兑换 15 积分' })).toBeVisible()
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
    await f.member.unroute('**/api/v1/me/redeem')
    await expect(f.member.getByTestId('credit-total')).toHaveText('30')
    await expect(f.member.getByTestId('permanent-balance')).toHaveText('25')
    await f.member.getByRole('button', { name: '兑换记录', exact: true }).click()
    await expect(
      f.member.getByRole('row').filter({ hasText: String(code.code).slice(-4) }),
    ).toHaveCount(1)
    await expect(f.member.getByRole('columnheader', { name: '来源 IP', exact: true })).toHaveCount(
      0,
    )
    await f.member.getByLabel('兑换积分', { exact: true }).fill(String(code.code))
    await f.member.getByRole('button', { name: '确认兑换', exact: true }).click()
    await expect(f.member.getByRole('alert')).toContainText('已经使用过')
    for (let index = 0; index < 25; index++)
      await f.api(
        'POST',
        '/admin/users/' + memberID + '/credits',
        { action: 'add', bucket: 'permanent', amount: 1, note: 'cursor fixture ' + index },
        undefined,
        randomUUID(),
      )
    await f.member.reload()
    await expect(f.member.getByTestId('credit-total')).toHaveText('55')
    await expect(f.member.getByRole('row')).toHaveCount(21)
    await f.member.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(f.member.getByText('第 2 页', { exact: true })).toBeVisible()
    await f.member.getByLabel('类型', { exact: true }).selectOption('redeem')
    await f.member.getByRole('button', { name: '上一页', exact: true }).click()
    await expect(f.member.getByRole('row')).toHaveCount(21)
    await f.member.getByRole('button', { name: '搜索', exact: true }).click()
    await expect(f.member.getByRole('row').filter({ hasText: '兑换入账' })).toHaveCount(1)
    expect((await f.api('GET', '/me/credits', undefined, token)).total).toBe(55)
    await f.member.getByRole('button', { name: '切换深色主题', exact: true }).click()
    await noOverflow(f.member)
    await f.member.screenshot({ path: info.outputPath('credits-dark.png'), animations: 'disabled' })
    expect(errors).toEqual([])
  } finally {
    await f.context.close()
    await f.api('PUT', '/admin/pricing', previousPricing)
    await f.api('PUT', '/admin/settings/registration', { registration: registration.registration })
    if (memberID) await f.api('DELETE', '/admin/users/' + memberID, { email: f.email })
  }
})

test('real profile, avatar, preferences, device revocation, exports, password change and deletion', async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180_000)
  const f = await fixture(page, browser, baseURL, info),
    errors: string[] = []
  observeErrors(page, errors)
  observeErrors(f.member, errors)
  const created = await f.api('POST', '/admin/users', {
    email: f.email,
    password: f.password,
    nickname: 'Profile member',
    role: 'user',
    initial_credits: 0,
  })
  let deleted = false
  const second = await browser.newContext({
      baseURL: f.baseURL,
      extraHTTPHeaders: info.project.use.extraHTTPHeaders ?? {},
    }),
    other = await second.newPage()
  observeErrors(other, errors)
  try {
    let token = await login(f.member, f.email, f.password)
    await f.member.goto('/me')
    await f.member.getByLabel('昵称', { exact: true }).fill('账户已更新')
    await f.member.getByLabel('显示时区', { exact: true }).fill('UTC')
    await f.member.getByLabel('界面语言', { exact: true }).selectOption('en')
    await f.member.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(f.member.getByLabel('Display name', { exact: true })).toHaveValue('账户已更新')
    await f.member.reload()
    await expect(f.member.getByLabel('Display time zone', { exact: true })).toHaveValue('UTC')
    await f.member.getByLabel('Language', { exact: true }).selectOption('zh-CN')
    await f.member.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(f.member.getByLabel('昵称', { exact: true })).toHaveValue('账户已更新')
    await f.member
      .locator('input[type=file]')
      .setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: fixturePNG() })
    await expect(f.member.locator('.profile-avatar img')).toBeVisible()
    const profile = await f.api('GET', '/me', undefined, token),
      avatar = await f.api(
        'GET',
        '/files/' + String(profile.avatar_file_id) + '/metadata',
        undefined,
        token,
      )
    expect(avatar.width).toBe(256)
    expect(avatar.height).toBe(256)
    await f.member.reload()
    await expect(f.member.locator('.profile-avatar img')).toBeVisible()
    await noOverflow(f.member)
    await f.member.screenshot({ path: info.outputPath('profile.png'), animations: 'disabled' })
    await login(other, f.email, f.password)
    await f.member.goto('/me/security')
    const sessions = await f.api('GET', '/me/sessions', undefined, token)
    if (!Array.isArray(sessions.items)) throw new Error('Missing sessions')
    const target = sessions.items.map(record).find((item) => item.id !== sessions.current_id)
    if (!target) throw new Error('Missing second real device')
    await f.member
      .locator('[data-session-id="' + String(target.id) + '"]')
      .getByRole('button', { name: '退出此设备', exact: true })
      .click()
    await f.member
      .getByRole('dialog')
      .getByRole('button', { name: '确认操作', exact: true })
      .click()
    await expect(f.member.getByRole('dialog')).not.toBeVisible()
    await other.reload()
    await expect(other).toHaveURL(/\/login/)
    await f.member.getByLabel('自定义指令', { exact: true }).fill('Private account preference')
    await f.member.getByLabel('默认生图质量', { exact: true }).selectOption('high')
    await f.member.getByLabel('默认宽高比', { exact: true }).selectOption('9:16')
    await f.member.getByLabel('默认生成数量', { exact: true }).fill('2')
    await f.member.getByLabel('主题', { exact: true }).selectOption('dark')
    await f.member.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(f.member.getByRole('status').filter({ hasText: '修改已保存' })).toBeVisible()
    await f.member.reload()
    await expect(f.member.getByLabel('自定义指令', { exact: true })).toHaveValue(
      'Private account preference',
    )
    expect(await f.api('GET', '/me/preferences', undefined, token)).toMatchObject({
      theme: 'dark',
      instructions: 'Private account preference',
      image_quality: 'high',
      image_ratio: '9:16',
      image_count: 2,
    })
    await noOverflow(f.member)
    await f.member.screenshot({
      path: info.outputPath('security-dark.png'),
      animations: 'disabled',
    })
    for (const [label, filename] of [
      ['导出聊天 JSON', 'lumi-chats.json'],
      ['导出聊天 Markdown', 'lumi-chats.md'],
    ] as const) {
      const [download] = await Promise.all([
        f.member.waitForEvent('download'),
        f.member.getByRole('button', { name: label, exact: true }).click(),
      ])
      expect(download.suggestedFilename()).toBe(filename)
      const path = await download.path()
      if (!path) throw new Error('Missing real export')
      if (filename.endsWith('.json')) {
        const value: unknown = JSON.parse(await readFile(path, 'utf8'))
        expect(value).toBeDefined()
      }
    }
    const nextPassword = randomBytes(20).toString('base64url') + 'Aa1'
    await f.member.goto('/me')
    await f.member.getByLabel('当前密码', { exact: true }).fill(f.password)
    await f.member.getByLabel('新密码', { exact: true }).fill(nextPassword)
    await f.member.getByLabel('再次输入新密码', { exact: true }).fill('MismatchPassword42')
    await f.member.getByRole('button', { name: '修改密码', exact: true }).click()
    await expect(f.member.getByRole('alert')).toContainText('两次输入的密码不一致')
    await f.member.getByLabel('再次输入新密码', { exact: true }).fill(nextPassword)
    await f.member.getByRole('button', { name: '修改密码', exact: true }).click()
    await expect(f.member).toHaveURL(/\/login\?changed=1$/)
    await f.member.getByLabel('邮箱地址', { exact: true }).fill(f.email)
    await f.member.getByLabel('密码', { exact: true }).fill(f.password)
    await f.member.getByRole('button', { name: '进入 Lumi', exact: true }).click()
    await expect(f.member.getByRole('alert')).toBeVisible()
    token = await login(f.member, f.email, nextPassword)
    await f.member.goto('/me/security')
    const current = await f.api('GET', '/me/sessions', undefined, token)
    await f.member
      .locator('[data-session-id="' + String(current.current_id) + '"]')
      .getByRole('button', { name: '退出此设备', exact: true })
      .click()
    await f.member
      .getByRole('dialog')
      .getByRole('button', { name: '确认操作', exact: true })
      .click()
    await expect(f.member).toHaveURL(/\/login$/)
    await login(f.member, f.email, nextPassword)
    await f.member.goto('/me/security')
    await f.member.getByRole('button', { name: '删除账号', exact: true }).click()
    const dialog = f.member.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: '确认操作', exact: true })
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel('输入完整邮箱确认', { exact: true }).fill(f.email)
    await dialog.getByLabel('当前密码', { exact: true }).fill(nextPassword)
    await confirm.click()
    await expect(f.member).toHaveURL(/\/login$/)
    deleted = true
    expect(
      (await f.api('GET', '/admin/users?search=' + encodeURIComponent(f.email))).items,
    ).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await second.close()
    await f.context.close()
    if (!deleted) await f.api('DELETE', '/admin/users/' + String(created.id), { email: f.email })
  }
})
