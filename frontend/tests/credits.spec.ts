import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { observeErrors } from './browser-errors'

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('邮箱地址', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '进入 Lumi', exact: true }).click()
  await expect(page).toHaveURL(/\/chat$/)
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}
test('M2 real gifts redemption retry pricing exports and administrator adjustments', async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180_000)
  if (!process.env.E2E_DATABASE_URL || !process.env.E2E_REDIS_URL)
    throw new Error('Full M2 E2E requires real PostgreSQL and Redis')
  const adminEmail = process.env.E2E_ADMIN_EMAIL,
    adminPassword = process.env.E2E_ADMIN_PASSWORD
  if (!adminEmail || !adminPassword || !baseURL)
    throw new Error('E2E bootstrap configuration is missing')
  const errors: string[] = []
  observeErrors(page, errors)
  await login(page, adminEmail, adminPassword)
  await page.goto('/admin/settings/registration')
  await page.getByRole('switch', { name: /开放注册/ }).check()
  await page.getByRole('switch', { name: /注册时验证邮箱/ }).uncheck()
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('修改已保存')
  await page.goto('/admin/pricing')
  await page.getByLabel('注册赠送积分', { exact: true }).fill('10')
  await page.getByLabel('每日赠送积分', { exact: true }).fill('5')
  await page.getByLabel('每日重置时区', { exact: true }).fill('Asia/Shanghai')
  await page.getByLabel('每张积分 生图 低', { exact: true }).fill('6')
  await page.getByRole('button', { name: '保存价格与赠送', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('价格与赠送配置已保存')
  await page.reload()
  await expect(page.getByLabel('每张积分 生图 低', { exact: true })).toHaveValue('6')
  await noOverflow(page)
  await page.screenshot({
    path: info.outputPath('pricing.png'),
    fullPage: true,
    animations: 'disabled',
  })

  const email = `credits-${randomUUID().slice(0, 12)}@lumi.test`
  const password = `${randomBytes(18).toString('base64url')}Aa1`
  const context = await browser.newContext({
    baseURL,
    viewport: info.project.use.viewport ?? { width: 1440, height: 900 },
  })
  const member = await context.newPage()
  observeErrors(member, errors)
  try {
    await member.goto('/register')
    await member.getByLabel('昵称', { exact: true }).fill('积分创作者')
    await member.getByLabel('邮箱地址', { exact: true }).fill(email)
    await member.getByLabel('密码', { exact: true }).fill(password)
    await member.getByRole('checkbox').check()
    await member.getByRole('button', { name: '创建账号', exact: true }).click()
    await expect(member).toHaveURL(/\/chat$/)
    await member.goto('/me/credits')
    await expect(member.getByTestId('credit-total')).toHaveText('15')
    await expect(member.getByTestId('daily-balance')).toHaveText('5')
    await expect(member.getByTestId('permanent-balance')).toHaveText('10')
    await expect(member.getByText('近 30 天还没有积分消耗', { exact: true })).toBeVisible()
    await noOverflow(member)
    await member.screenshot({
      path: info.outputPath('credits-light.png'),
      fullPage: true,
      animations: 'disabled',
    })

    const batchName = `验收-${info.project.name}-${randomUUID().slice(0, 8)}`
    await page.goto('/admin/redeem-codes')
    await page.getByRole('button', { name: '生成兑换码', exact: true }).click()
    const batchDialog = page.getByRole('dialog')
    await batchDialog.getByLabel('批次名称', { exact: true }).fill(batchName)
    await batchDialog.getByLabel('生成数量', { exact: true }).fill('100')
    await batchDialog.getByLabel('每码积分', { exact: true }).fill('15')
    await batchDialog.getByLabel('每码可用次数', { exact: true }).fill('2')
    await batchDialog.getByRole('button', { name: '确认生成', exact: true }).click()
    await expect(batchDialog).not.toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: '已生成 100 个兑换码' })).toBeVisible()
    await expect(page.getByRole('row')).toHaveCount(21)
    await page.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(page.getByText('第 2 页', { exact: true })).toBeVisible()
    // Editing a draft filter must not alter the active cursor's filter binding.
    await page.getByLabel('搜索完整兑换码', { exact: true }).fill('UNSUBMITTED')
    await page.getByRole('button', { name: '上一页', exact: true }).click()
    await expect(page.getByRole('row')).toHaveCount(21)
    await page.getByLabel('搜索完整兑换码', { exact: true }).fill('')
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出筛选结果', exact: true }).click()
    const download = await downloadPromise,
      path = await download.path()
    expect(path).not.toBeNull()
    if (!path) throw new Error('CSV download did not produce a file')
    const lines = (await readFile(path, 'utf8')).trim().split(/\r?\n/)
    expect(lines).toHaveLength(101)
    const code = lines[1]?.split(',')[2],
      unusedCode = lines[2]?.split(',')[2]
    if (!code || !unusedCode) throw new Error('CSV is missing actual generated codes')
    await page.getByLabel('搜索完整兑换码', { exact: true }).fill(code)
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    let codeRow = page.getByRole('row').filter({ hasText: code })
    await expect(codeRow).toBeVisible()
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await codeRow.getByRole('button', { name: `复制兑换码 ${code.slice(-4)}`, exact: true }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code)
    await codeRow.getByRole('button', { name: '停用', exact: true }).click()
    await expect(codeRow.getByText('已停用', { exact: true })).toBeVisible()
    await member.getByLabel('兑换积分', { exact: true }).fill(code)
    await member.getByRole('button', { name: '确认兑换', exact: true }).click()
    await expect(member.getByRole('alert')).toContainText('已被停用')
    await codeRow.getByRole('button', { name: '启用', exact: true }).click()
    await expect(codeRow.getByText('可兑换', { exact: true })).toBeVisible()

    const keys: string[] = []
    let dropped = false
    // Execute the real transaction, then drop its first successful response.
    await member.route('**/api/v1/me/redeem', async (route) => {
      keys.push(route.request().headers()['idempotency-key'] ?? '')
      const response = await route.fetch()
      if (response.ok() && !dropped) {
        dropped = true
        await route.abort('failed')
      } else await route.fulfill({ response })
    })
    await member.getByRole('button', { name: '确认兑换', exact: true }).click()
    await expect(member.getByRole('alert')).toContainText('网络')
    await member.getByRole('button', { name: '确认兑换', exact: true }).click()
    await expect(member.getByRole('status').filter({ hasText: '已兑换 15 积分' })).toBeVisible()
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
    await member.unroute('**/api/v1/me/redeem')
    await expect(member.getByTestId('credit-total')).toHaveText('30')
    await expect(member.getByTestId('permanent-balance')).toHaveText('25')
    await member.getByRole('button', { name: '兑换记录', exact: true }).click()
    await expect(member.getByRole('row').filter({ hasText: code.slice(-4) })).toHaveCount(1)
    await expect(member.getByRole('columnheader', { name: '来源 IP', exact: true })).toHaveCount(0)
    await member.getByRole('button', { name: '积分流水', exact: true }).click()
    await member.getByLabel('类型', { exact: true }).selectOption('redeem')
    await member.getByRole('button', { name: '搜索', exact: true }).click()
    await expect(member.getByRole('row').filter({ hasText: '兑换入账' })).toHaveCount(1)
    await member.getByRole('button', { name: '切换深色主题', exact: true }).click()
    await noOverflow(member)
    await member.screenshot({
      path: info.outputPath('credits-dark.png'),
      fullPage: true,
      animations: 'disabled',
    })

    await page.goto('/admin/users')
    await page.getByRole('searchbox').fill(email)
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    const row = page.getByRole('row').filter({ hasText: email })
    await row.getByRole('link', { name: `调整积分 ${email}`, exact: true }).click()
    await expect(page.getByTestId('credit-total')).toHaveText('30')
    for (const [action, amount, total] of [
      ['add', '7', '37'],
      ['subtract', '2', '35'],
      ['set', '3', '8'],
    ] as const) {
      await page.getByRole('button', { name: '调整积分', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('调整方式', { exact: true }).selectOption(action)
      await dialog.getByLabel('积分数量', { exact: true }).fill(amount)
      await dialog.getByLabel('备注', { exact: true }).fill(`E2E ${action} ${info.project.name}`)
      await dialog.getByRole('button', { name: '确认调整', exact: true }).click()
      await expect(dialog).not.toBeVisible()
      await expect(page.getByTestId('credit-total')).toHaveText(total)
    }
    await expect(page.getByTestId('daily-balance')).toHaveText('5')
    await expect(page.getByTestId('permanent-balance')).toHaveText('3')
    await noOverflow(page)
    await page.screenshot({
      path: info.outputPath('credit-adjustments.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await member.reload()
    await expect(member.getByTestId('credit-total')).toHaveText('8')

    await page.goto('/admin/users')
    await page.getByRole('button', { name: '新增用户', exact: true }).click()
    const createDialog = page.getByRole('dialog')
    const initialEmail = `initial-${randomUUID().slice(0, 12)}@lumi.test`
    await createDialog.getByLabel('邮箱地址', { exact: true }).fill(initialEmail)
    await createDialog.getByLabel('昵称', { exact: true }).fill('初始积分验收')
    await createDialog
      .getByLabel('密码', { exact: true })
      .fill(`${randomBytes(18).toString('base64url')}Aa1`)
    await createDialog.getByLabel('初始积分', { exact: true }).fill('12')
    await createDialog.getByRole('button', { name: '创建用户', exact: true }).click()
    await expect(createDialog).not.toBeVisible()
    await page.getByRole('searchbox').fill(initialEmail)
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await expect(
      page.getByRole('row').filter({ hasText: initialEmail }).locator('td.numeric strong'),
    ).toHaveText('17')

    await page.goto('/admin/redeem-codes')
    await page.getByLabel('搜索完整兑换码', { exact: true }).fill(code)
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    codeRow = page.getByRole('row').filter({ hasText: code })
    await codeRow.getByRole('checkbox').check()
    await page.getByRole('button', { name: '删除未使用码', exact: true }).click()
    let deleteDialog = page.getByRole('dialog')
    await deleteDialog.getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(deleteDialog.getByRole('alert')).toContainText('不能删除')
    await deleteDialog.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByLabel('搜索完整兑换码', { exact: true }).fill(unusedCode)
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await page.getByRole('row').filter({ hasText: unusedCode }).getByRole('checkbox').check()
    await page.getByRole('button', { name: '删除未使用码', exact: true }).click()
    deleteDialog = page.getByRole('dialog')
    await deleteDialog.getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(deleteDialog).not.toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: unusedCode })).toHaveCount(0)
    await page.getByRole('button', { name: '兑换记录', exact: true }).click()
    await expect(page.getByRole('row').filter({ hasText: code.slice(-4) })).toHaveCount(1)
    await noOverflow(page)
    await page.screenshot({
      path: info.outputPath('redeem-records.png'),
      fullPage: true,
      animations: 'disabled',
    })

    await page.goto('/admin/credit-ledger')
    const ledgerDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出筛选结果', exact: true }).click()
    expect((await ledgerDownload).suggestedFilename()).toBe('lumi-credit-ledger.csv')
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})
