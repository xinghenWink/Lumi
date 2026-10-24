import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test } from './test'
import { record } from '../../src/api/transport'
import { observeErrors } from '../browser-errors'
import { adminFixture, login, memberContext, noOverflow } from './admin-helpers'

test('real administrator user CRUD, self protection, bulk idempotent grant, CSV and session revocation', async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180_000)
  const f = await adminFixture(page, baseURL),
    errors: string[] = [],
    seed = randomUUID().slice(0, 10)
  const emails = ['one', 'two'].map((value) => `admin-${seed}-${value}@lumi.test`),
    password = randomBytes(20).toString('base64url') + 'Aa1'
  const context = await memberContext(browser, baseURL, info),
    member = await context.newPage()
  observeErrors(page, errors)
  observeErrors(member, errors)
  const created: { id: string; email: string }[] = []
  async function search(value: string) {
    await page.goto('/admin/users')
    await page.getByRole('searchbox').fill(value)
    await page.getByRole('button', { name: '搜索', exact: true }).click()
  }
  try {
    await search(f.email)
    const self = page.getByRole('row').filter({ hasText: f.email })
    await expect(self.getByRole('checkbox')).toBeDisabled()
    await expect(self.getByRole('button', { name: '禁用 ' + f.email, exact: true })).toBeDisabled()
    await expect(
      self.getByRole('button', { name: '删除用户 ' + f.email, exact: true }),
    ).toBeDisabled()
    await self.getByRole('button', { name: '编辑用户 ' + f.email, exact: true }).click()
    await expect(page.getByRole('dialog').getByLabel('角色', { exact: true })).toBeDisabled()
    await expect(page.getByRole('dialog').getByLabel('状态', { exact: true })).toBeDisabled()
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    for (const email of emails) {
      await page.getByRole('button', { name: '新增用户', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('邮箱地址', { exact: true }).fill(email)
      await dialog.getByLabel('昵称', { exact: true }).fill('管理员创建 ' + seed)
      await dialog.getByLabel('密码', { exact: true }).fill(password)
      await dialog.getByLabel('初始积分', { exact: true }).fill('12')
      const result = page.waitForResponse(
        (response) =>
          response.url().endsWith('/admin/users') && response.request().method() === 'POST',
      )
      await dialog.getByRole('button', { name: '创建用户', exact: true }).click()
      const data = record(await (await result).json())
      created.push({ id: String(data.id), email })
      await expect(dialog).not.toBeVisible()
    }
    const first = created[0]
    if (!first) throw new Error('Missing first user')
    await login(member, first.email, password)
    await member.goto('/admin/users')
    await expect(member).toHaveURL(/\/chat$/)
    await search(first.email)
    let row = page.getByRole('row').filter({ hasText: first.email })
    await row.getByRole('button', { name: '禁用 ' + first.email, exact: true }).click()
    await expect(
      row.getByRole('button', { name: '启用 ' + first.email, exact: true }),
    ).toBeVisible()
    await member.reload()
    await expect(member).toHaveURL(/\/login/)
    await member.getByLabel('邮箱地址', { exact: true }).fill(first.email)
    await member.getByLabel('密码', { exact: true }).fill(password)
    await member.getByRole('button', { name: '进入 Lumi', exact: true }).click()
    await expect(member.getByRole('alert')).toContainText('账号已被禁用')
    await row.getByRole('button', { name: '启用 ' + first.email, exact: true }).click()
    await expect(
      row.getByRole('button', { name: '禁用 ' + first.email, exact: true }),
    ).toBeVisible()
    await login(member, first.email, password)
    await row.getByRole('button', { name: '编辑用户 ' + first.email, exact: true }).click()
    await page.getByRole('dialog').getByLabel('昵称', { exact: true }).fill('管理已改名')
    await page.getByRole('dialog').getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await row.locator('a.identity-link').click()
    await expect(page.getByRole('heading', { name: '管理已改名', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '最近会话', exact: true })).toBeVisible()
    await noOverflow(page)
    await page.screenshot({ path: info.outputPath('user-detail.png'), animations: 'disabled' })
    await page.getByRole('button', { name: '强制全部设备下线', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await member.reload()
    await expect(member).toHaveURL(/\/login/)
    const balances = await Promise.all(
      created.map((user) => f.api('GET', '/admin/users/' + user.id + '/credits')),
    )
    await search('admin-' + seed)
    await expect(page.getByRole('row')).toHaveCount(3)
    await page.getByRole('checkbox', { name: '选择本页', exact: true }).check()
    await page.getByRole('button', { name: '批量发放积分', exact: true }).click()
    const grant = page.getByRole('dialog')
    await grant.getByLabel('每人发放积分', { exact: true }).fill('7')
    await grant.getByLabel('操作备注', { exact: true }).fill('Unknown response ' + seed)
    const keys: string[] = []
    let dropped = false
    await page.route('**/api/v1/admin/users/batch', async (route) => {
      keys.push(route.request().headers()['idempotency-key'] ?? '')
      const response = await route.fetch()
      if (response.ok() && !dropped) {
        dropped = true
        await route.abort('failed')
      } else await route.fulfill({ response })
    })
    await grant.getByRole('button', { name: '确认操作', exact: true }).click()
    await expect(grant.getByRole('alert')).toContainText('网络')
    await grant.getByRole('button', { name: '确认操作', exact: true }).click()
    await expect(grant).not.toBeVisible()
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
    await page.unroute('**/api/v1/admin/users/batch')
    for (const [index, user] of created.entries()) {
      const account = await f.api('GET', '/admin/users/' + user.id + '/credits')
      expect(account.permanent_balance).toBe(Number(balances[index]?.permanent_balance) + 7)
      expect(account.daily_balance).toBe(balances[index]?.daily_balance)
    }
    for (const label of ['批量禁用', '批量启用']) {
      await page.getByRole('checkbox', { name: '选择本页', exact: true }).check()
      await page.getByRole('button', { name: label, exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click()
      await expect(page.getByRole('dialog')).not.toBeVisible()
      for (const user of created)
        expect(record((await f.api('GET', '/admin/users/' + user.id)).user).status).toBe(
          label === '批量启用' ? 'active' : 'disabled',
        )
    }
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '导出用户 CSV', exact: true }).click(),
    ])
    expect(download.suggestedFilename()).toBe('lumi-users.csv')
    const path = await download.path()
    if (!path) throw new Error('Missing real CSV')
    const csv = await readFile(path, 'utf8')
    for (const email of emails) expect(csv).toContain(email)
    expect(csv.trim().split(/\r?\n/)).toHaveLength(3)
    await noOverflow(page)
    await page.screenshot({ path: info.outputPath('admin-users.png'), animations: 'disabled' })
    row = page.getByRole('row').filter({ hasText: first.email })
    await row.getByRole('button', { name: '删除用户 ' + first.email, exact: true }).click()
    await expect(
      page.getByRole('dialog').getByRole('button', { name: '确认删除', exact: true }),
    ).toBeDisabled()
    await page.getByRole('dialog').getByRole('textbox').fill(first.email)
    await page.getByRole('dialog').getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: first.email })).toHaveCount(0)
    created.shift()
    await page.getByRole('checkbox', { name: '选择本页', exact: true }).check()
    await page.getByRole('button', { name: '批量删除', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(page.getByRole('row')).toHaveCount(0)
    created.length = 0
    expect(errors).toEqual([])
  } finally {
    await context.close()
    for (const user of created)
      await f.api('DELETE', '/admin/users/' + user.id, { email: user.email })
  }
})
