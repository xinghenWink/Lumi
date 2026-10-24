import { journeyHeaders } from './client-headers'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { expect, test, type Page } from './test'
import { observeErrors } from '../browser-errors'
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
async function createUser(
  page: Page,
  email: string,
  password: string,
  role: 'user' | 'admin' = 'user',
) {
  await page.goto('/admin/users')
  await page.getByRole('button', { name: '新增用户', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('邮箱地址', { exact: true }).fill(email)
  await dialog.getByLabel('昵称', { exact: true }).fill('模型验收成员')
  await dialog.getByLabel('密码', { exact: true }).fill(password)
  if (role === 'admin') await dialog.getByLabel('角色').selectOption('admin')
  await dialog.getByRole('button', { name: '创建用户', exact: true }).click()
  await expect(dialog).not.toBeVisible()
}
test('React real channel configuration import routing and safe model selection', async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180_000)
  const adminEmail = process.env.E2E_ADMIN_EMAIL,
    adminPassword = process.env.E2E_ADMIN_PASSWORD
  if (!adminEmail || !adminPassword || !baseURL || !process.env.E2E_DATABASE_URL)
    throw new Error('M3 requires real application dependencies')
  const suffix = randomUUID().slice(0, 8),
    channelName = `验收渠道-${info.project.name}-${suffix}`
  const chatName = `Lumi 对话-${suffix}`,
    imageName = `Lumi 图像-${suffix}`
  const wireChat = `wire-text-${suffix}`,
    wireImage = `wire-image-${suffix}`
  const key = randomBytes(24).toString('base64url'),
    authorization: string[] = []
  const server = createServer((request, response) => {
    authorization.push(request.headers.authorization ?? '')
    response.setHeader('Content-Type', 'application/json')
    if (request.headers.authorization !== `Bearer ${key}`) {
      response.writeHead(401)
      response.end(JSON.stringify({ error: { message: 'private-diagnostic' } }))
      return
    }
    if (request.url === '/v1/models') {
      response.end(JSON.stringify({ data: [{ id: wireChat }, { id: wireImage }] }))
      return
    }
    response.writeHead(404)
    response.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture has no TCP address')
  const endpoint = `http://127.0.0.1:${address.port}/v1`
  const errors: string[] = []
  observeErrors(page, errors)
  const memberContext = await browser.newContext({
    baseURL,
    viewport: info.project.use.viewport ?? { width: 1440, height: 900 },
    ...(info.project.use.userAgent ? { userAgent: info.project.use.userAgent } : {}),
    deviceScaleFactor: info.project.use.deviceScaleFactor ?? 1,
    isMobile: info.project.use.isMobile ?? false,
    hasTouch: info.project.use.hasTouch ?? false,
    extraHTTPHeaders: journeyHeaders(info),
  })
  const member = await memberContext.newPage()
  observeErrors(member, errors)
  try {
    await login(page, adminEmail, adminPassword)
    // Each scenario owns an administrator so independent write-rate windows stay realistic.
    const scenarioEmail = `catalog-admin-${suffix}@lumi.test`,
      scenarioPassword = `${randomBytes(18).toString('base64url')}Aa1`
    await createUser(page, scenarioEmail, scenarioPassword, 'admin')
    await page.context().clearCookies()
    await login(page, scenarioEmail, scenarioPassword)
    await page.goto('/admin/upstreams')
    await page.getByRole('button', { name: '新增渠道', exact: true }).click()
    let dialog = page.getByRole('dialog')
    await dialog.getByLabel('渠道名称', { exact: true }).fill(channelName)
    await dialog.getByLabel('Base URL', { exact: true }).fill(endpoint)
    await dialog.getByLabel('API Key', { exact: true }).fill(key)
    await dialog.getByRole('button', { name: '保存渠道', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    let channelRow = page.getByRole('row').filter({ hasText: channelName })
    await expect(channelRow).toBeVisible()
    await channelRow.getByRole('button', { name: '测试连接', exact: true }).click()
    await expect(channelRow.getByRole('status')).toContainText('连接成功')
    await channelRow.getByRole('button', { name: `编辑渠道 ${channelName}`, exact: true }).click()
    dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('API Key', { exact: true })).toHaveValue('')
    await dialog.getByLabel('备注', { exact: true }).fill('E2E preserved secret')
    await dialog.getByRole('button', { name: '保存渠道', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(channelRow.getByRole('status')).not.toBeVisible()
    await channelRow.getByRole('button', { name: '测试连接', exact: true }).click()
    await expect(channelRow.getByRole('status')).toContainText('连接成功')
    await channelRow.getByRole('button', { name: '同步模型', exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByRole('checkbox', { name: `选择模型 ${wireChat}`, exact: true }).check()
    await dialog.getByLabel(`展示名称 ${wireChat}`, { exact: true }).fill(chatName)
    await dialog.getByRole('checkbox', { name: `选择模型 ${wireImage}`, exact: true }).check()
    await dialog.getByLabel(`展示名称 ${wireImage}`, { exact: true }).fill(imageName)
    await dialog.getByLabel(`模型类型 ${wireImage}`, { exact: true }).selectOption('image')
    await noOverflow(page)
    await page.screenshot({ path: info.outputPath('model-import.png'), animations: 'disabled' })
    await dialog.getByRole('button', { name: '导入所选模型', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: '已处理 2 个模型' })).toBeVisible()
    await page.goto('/admin/models')
    await page.getByRole('searchbox').fill(suffix)
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await expect(page.getByRole('row')).toHaveCount(3)
    for (const name of [chatName, imageName]) {
      const row = page.getByRole('row').filter({ hasText: name })
      await expect(row.getByText('已停用', { exact: true })).toBeVisible()
      await row.getByRole('button', { name: `编辑模型 ${name}`, exact: true }).click()
      dialog = page.getByRole('dialog')
      await dialog.getByRole('checkbox', { name: '启用', exact: true }).check()
      await dialog.getByRole('checkbox', { name: '默认模型', exact: true }).check()
      if (name === chatName) {
        await expect(dialog.getByLabel('上游模型 ID 1', { exact: true })).toHaveValue(wireChat)
        await dialog.getByLabel('上游模型 ID 1', { exact: true }).scrollIntoViewIfNeeded()
        await page.screenshot({ path: info.outputPath('model-routes.png'), animations: 'disabled' })
      }
      await dialog.getByRole('button', { name: '保存模型', exact: true }).click()
      await expect(dialog).not.toBeVisible()
    }
    await noOverflow(page)
    await page.screenshot({ path: info.outputPath('platform-models.png'), animations: 'disabled' })
    const memberEmail = `catalog-${randomUUID().slice(0, 12)}@lumi.test`,
      password = `${randomBytes(18).toString('base64url')}Aa1`
    await page.goto('/admin/users')
    await page.getByRole('button', { name: '新增用户', exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByLabel('邮箱地址', { exact: true }).fill(memberEmail)
    await dialog.getByLabel('昵称', { exact: true }).fill('模型验收成员')
    await dialog.getByLabel('密码', { exact: true }).fill(password)
    await dialog.getByRole('button', { name: '创建用户', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    const publicResponse = member.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/models?type=chat') && response.status() === 200,
    )
    await login(member, memberEmail, password)
    const publicBody = JSON.stringify(await (await publicResponse).json())
    for (const secret of [key, wireChat, wireImage, endpoint, 'upstream_id', 'routes'])
      expect(publicBody).not.toContain(secret)
    const picker = member.getByRole('button', { name: '选择模型', exact: true })
    await expect(picker).toContainText(chatName)
    await member
      .getByRole('navigation', { name: '创作模式' })
      .getByRole('link', { name: '生图', exact: true })
      .click()
    await expect(picker).toContainText(imageName)
    await member
      .getByRole('navigation', { name: '创作模式' })
      .getByRole('link', { name: '聊天', exact: true })
      .click()
    await expect(picker).toContainText(chatName)
    // Keep the menu above the model selector inside the bottom composer.
    await picker.scrollIntoViewIfNeeded()
    const triggerBox = await picker.boundingBox()
    await picker.click()
    const menu = member.getByRole('menu', { name: '可用模型', exact: true })
    await expect(menu.getByRole('menuitem', { name: chatName, exact: true })).toBeVisible()
    const menuBox = await menu.boundingBox()
    expect(menuBox && triggerBox && menuBox.y + menuBox.height <= triggerBox.y + 2).toBeTruthy()
    await noOverflow(member)
    await member.screenshot({
      path: info.outputPath('model-picker-light.png'),
      animations: 'disabled',
    })
    await member.keyboard.press('Escape')
    await member.getByRole('button', { name: '切换深色主题', exact: true }).click()
    await picker.click()
    await member.screenshot({
      path: info.outputPath('model-picker-dark.png'),
      animations: 'disabled',
    })
    await member.keyboard.press('Escape')
    await page.goto('/admin/upstreams')
    channelRow = page.getByRole('row').filter({ hasText: channelName })
    await channelRow.getByRole('button', { name: '停用', exact: true }).click()
    await expect(channelRow.getByText('已停用', { exact: true })).toBeVisible()
    await member.reload()
    await expect(picker).toBeDisabled()
    await expect(picker).toContainText('暂无可用模型')
    await channelRow.getByRole('button', { name: '启用', exact: true }).click()
    await expect(channelRow.getByText('已启用', { exact: true })).toBeVisible()
    await member.reload()
    await expect(picker).toContainText(chatName)
    await channelRow.getByRole('button', { name: `编辑渠道 ${channelName}`, exact: true }).click()
    dialog = page.getByRole('dialog')
    await expect(
      dialog.getByLabel('清除已保存的渠道密钥（仅停用时可用）', { exact: true }),
    ).toBeDisabled()
    await dialog.getByRole('checkbox', { name: '启用', exact: true }).uncheck()
    await dialog.getByLabel('清除已保存的渠道密钥（仅停用时可用）', { exact: true }).check()
    await dialog.getByRole('button', { name: '保存渠道', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(channelRow).toContainText('未配置密钥')
    await expect(channelRow.getByText('已停用', { exact: true })).toBeVisible()
    await member.reload()
    await expect(picker).toBeDisabled()
    await channelRow.getByRole('button', { name: `编辑渠道 ${channelName}`, exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByLabel('API Key', { exact: true }).fill(key)
    await dialog.getByRole('checkbox', { name: '启用', exact: true }).check()
    await dialog.getByRole('button', { name: '保存渠道', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await channelRow.getByRole('button', { name: '测试连接', exact: true }).click()
    await expect(channelRow.getByRole('status')).toContainText('连接成功')
    await member.reload()
    await expect(picker).toContainText(chatName)
    await noOverflow(page)
    await page.screenshot({
      path: info.outputPath('upstream-connections.png'),
      animations: 'disabled',
    })
    await channelRow.getByRole('button', { name: `删除渠道 ${channelName}`, exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await member.reload()
    await expect(picker).toBeDisabled()
    await page.goto('/admin/models')
    await page.getByRole('searchbox').fill(suffix)
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    for (const name of [chatName, imageName]) {
      await page
        .getByRole('row')
        .filter({ hasText: name })
        .getByRole('button', { name: `删除模型 ${name}`, exact: true })
        .click()
      dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: '确认删除', exact: true }).click()
      await expect(dialog).not.toBeVisible()
    }
    expect(authorization.length).toBeGreaterThan(3)
    expect(authorization.every((value) => value === `Bearer ${key}`)).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await memberContext.close()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
