import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test, type Page } from './test'
import { observeErrors } from '../browser-errors'
import { memberContext as createMemberContext } from './admin-helpers'

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('邮箱地址', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '进入 Lumi', exact: true }).click()
  await expect(page).toHaveURL(/\/chat$/)
}
async function accountMenu(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) < 768)
    await page.getByRole('button', { name: '打开导航菜单' }).click()
  await page.getByRole('button', { name: '打开账户菜单' }).click()
}
async function users(page: Page, email: string) {
  await page.goto('/admin/users')
  await page.getByRole('searchbox').fill(email)
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  const row = page.getByRole('row').filter({ hasText: email })
  await expect(row).toBeVisible()
  return row
}

test('M1 real registration, sessions, administration, settings and audit', async ({
  page,
  browser,
  baseURL,
}, info) => {
  if (!process.env.E2E_DATABASE_URL || !process.env.E2E_REDIS_URL)
    throw new Error(
      'Full M1 E2E requires E2E_DATABASE_URL and E2E_REDIS_URL. Use --grep @guest for infrastructure-only checks.',
    )
  const adminEmail = process.env.E2E_ADMIN_EMAIL
  const adminPassword = process.env.E2E_ADMIN_PASSWORD
  if (!adminEmail || !adminPassword || !baseURL)
    throw new Error('E2E bootstrap configuration is missing')
  const errors: string[] = []
  observeErrors(page, errors)
  await login(page, adminEmail, adminPassword)
  await accountMenu(page)
  await page.getByRole('menuitem', { name: '管理后台', exact: true }).click()
  await expect(page.getByRole('heading', { name: '数据看板', exact: true })).toBeVisible()
  await page.goto('/admin/settings/registration')
  await page.getByRole('switch', { name: /开放注册/ }).check()
  await page.getByRole('switch', { name: /注册时验证邮箱/ }).uncheck()
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('修改已保存')

  const email = `member-${randomUUID().slice(0, 10)}@lumi.test`
  const password = `${randomBytes(18).toString('base64url')}Aa1`
  const memberContext = await createMemberContext(browser, baseURL, info)
  const member = await memberContext.newPage()
  observeErrors(member, errors)
  try {
    await member.goto('/register')
    await member.getByLabel('昵称', { exact: true }).fill('创作者')
    await member.getByLabel('邮箱地址', { exact: true }).fill(email)
    await member.getByLabel('密码', { exact: true }).fill(password)
    await member.getByRole('checkbox').check()
    await member.getByRole('button', { name: '创建账号', exact: true }).click()
    await expect(member).toHaveURL(/\/chat$/)
    await expect(
      member.getByRole('heading', { name: '今天想创造什么？', exact: true }),
    ).toBeVisible()
    const cookie = (await memberContext.cookies()).find((entry) => entry.name === 'lumi_refresh')
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('Lax')
    expect(cookie?.path).toBe('/api/v1/auth')
    expect(
      await member.evaluate(() =>
        Object.values(localStorage).some((value) => value.startsWith('eyJ')),
      ),
    ).toBe(false)
    await member.reload()
    await expect(member).toHaveURL(/\/chat$/)
    await member.goto('/admin/users')
    await expect(member).toHaveURL(/\/chat$/)
    await accountMenu(member)
    const menu = await member.getByRole('menu').boundingBox()
    expect(menu).not.toBeNull()
    if (menu) {
      expect(menu.width).toBeLessThanOrEqual(264)
      expect(menu.x).toBeGreaterThanOrEqual(0)
      expect(menu.x + menu.width).toBeLessThanOrEqual(info.project.use.viewport?.width ?? 1440)
    }
    await expect(member.getByRole('menuitem', { name: '管理后台', exact: true })).toHaveCount(0)
    await member.getByRole('menuitem', { name: '个人资料', exact: true }).click()
    await member.getByLabel('昵称', { exact: true }).fill('资料已更新')
    await member.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(member.getByRole('status')).toContainText('修改已保存')
    await member.getByRole('button', { name: '切换深色主题' }).click()
    expect(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
    await member.screenshot({
      path: info.outputPath('profile-dark.png'),
      fullPage: true,
      animations: 'disabled',
    })

    let row = await users(page, email)
    const id = await row.locator('code.user-id').innerText()
    await row.getByRole('button', { name: `禁用 ${email}`, exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '账号状态已更新' })).toBeVisible()
    await expect(row.getByRole('button', { name: `启用 ${email}`, exact: true })).toBeVisible()
    await member.reload()
    await expect(member).toHaveURL(/\/login/)
    await member.getByLabel('邮箱地址', { exact: true }).fill(email)
    await member.getByLabel('密码', { exact: true }).fill(password)
    await member.getByRole('button', { name: '进入 Lumi', exact: true }).click()
    await expect(member.getByRole('alert')).toContainText('账号已被禁用')
    row = page.getByRole('row').filter({ hasText: email })
    await row.getByRole('button', { name: `启用 ${email}`, exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '账号状态已更新' })).toBeVisible()
    await expect(row.getByRole('button', { name: `禁用 ${email}`, exact: true })).toBeVisible()
    await login(member, email, password)
    await row.getByRole('button', { name: `编辑用户 ${email}`, exact: true }).click()
    const edit = page.getByRole('dialog')
    await edit.getByLabel('昵称', { exact: true }).fill('管理已改名')
    await edit.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(edit).not.toBeVisible()
    await row.locator('a.identity-link').click()
    await expect(page.getByRole('heading', { name: '管理已改名', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '最近会话', exact: true })).toBeVisible()
    await page.screenshot({
      path: info.outputPath('user-detail.png'),
      fullPage: true,
      animations: 'disabled',
    })

    await page.goto('/admin/audit')
    await page.getByRole('textbox', { name: '对象 ID', exact: true }).fill(id)
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    const auditRecord = page
      .getByRole('article')
      .filter({ hasText: id })
      .filter({ hasText: '修改用户' })
      .first()
    await expect(auditRecord.getByText('修改用户', { exact: true })).toBeVisible()
    await auditRecord.getByText('查看变更', { exact: true }).click()
    expect((await auditRecord.locator('pre').allTextContents()).join('')).not.toContain(email)
    await page.screenshot({
      path: info.outputPath('audit.png'),
      fullPage: true,
      animations: 'disabled',
    })

    await page.goto('/admin/settings/mail')
    await page.getByLabel('SMTP 密码', { exact: true }).fill(`${randomBytes(16).toString('hex')}`)
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('修改已保存')
    await expect(page.getByLabel('SMTP 密码', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('SMTP 密码', { exact: true })).toHaveAttribute(
      'placeholder',
      '已保存密码；留空保持现有密码',
    )
    await page.getByLabel('清除已保存的密码', { exact: true }).check()
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByLabel('SMTP 密码', { exact: true })).toHaveAttribute(
      'placeholder',
      '尚未保存密码',
    )

    row = await users(page, email)
    await row.getByRole('button', { name: `删除用户 ${email}`, exact: true }).click()
    const deletion = page.getByRole('dialog')
    await expect(deletion.getByRole('button', { name: '确认删除', exact: true })).toBeDisabled()
    await deletion.getByRole('textbox').fill(email)
    await deletion.getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(deletion).not.toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: email })).toHaveCount(0)
    await member.reload()
    await expect(member).toHaveURL(/\/login/)
    await page.goto('/admin/settings/registration')
    await page.getByRole('switch', { name: /开放注册/ }).uncheck()
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('修改已保存')
    await member.goto('/register')
    await expect(member.getByText('当前暂未开放注册，你仍可使用已有账号登录。')).toBeVisible()
    await page.getByRole('switch', { name: /开放注册/ }).check()
    await page.getByRole('switch', { name: /注册时验证邮箱/ }).check()
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('修改已保存')
    expect(errors).toEqual([])
  } finally {
    await memberContext.close()
  }
})
