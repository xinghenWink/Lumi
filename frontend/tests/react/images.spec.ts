import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { record } from '../../src/api/transport'
import { defaultCapabilities } from '../../src/api/catalog-contracts'
import { parseTask, parseImageConfiguration } from '../../src/api/images'
import { observeErrors } from '../browser-errors'
import { fixturePNG } from '../image-fixture'
async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  const pending = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/auth/login') && r.request().method() === 'POST',
  )
  await page.getByLabel('邮箱地址', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '进入 Lumi', exact: true }).click()
  const body = record(await (await pending).json())
  await expect(page).toHaveURL(/\/chat$/)
  if (typeof body.access_token !== 'string') throw new Error('Missing login token')
  return body.access_token
}
test('React real image generation editing gallery cancellation and administrator privacy', async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(240_000)
  const adminEmail = process.env.E2E_ADMIN_EMAIL,
    adminPassword = process.env.E2E_ADMIN_PASSWORD
  if (!adminEmail || !adminPassword || !baseURL || !process.env.E2E_DATABASE_URL)
    throw new Error('M5 requires real dependencies')
  const suffix = randomUUID().slice(0, 8),
    key = randomBytes(24).toString('base64url'),
    png = fixturePNG()
  const wire = 'private-image-' + suffix,
    modelName = 'Lumi Image ' + suffix
  let calls = 0,
    edits = 0,
    reusedReference = false
  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== 'Bearer ' + key) {
      response.writeHead(401)
      response.end()
      return
    }
    if (request.url === '/v1/models') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ data: [{ id: wire }] }))
      return
    }
    if (request.url === '/v1/chat/completions') {
      for await (const chunk of request) void chunk
      response.setHeader('Content-Type', 'text/event-stream')
      response.end(
        'data: {"choices":[{"delta":{"content":"旅程中的第一段回答。"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      )
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
    const raw = Buffer.concat(chunks)
    let prompt: string,
      count = 1
    if (request.url === '/v1/images/edits') {
      edits++
      prompt = raw.toString('utf8').match(/name="prompt"\r\n\r\n([^\r]*)/)?.[1] ?? ''
      reusedReference = raw.includes(Buffer.from([137, 80, 78, 71]))
    } else if (request.url === '/v1/images/generations') {
      const input = record(JSON.parse(raw.toString('utf8')) as unknown)
      prompt = String(input.prompt)
      count = Number(input.n)
    } else {
      response.writeHead(404)
      response.end()
      return
    }
    calls++
    if (prompt === 'cancel') {
      // Keep a real outstanding upstream request until application cancellation closes it.
      response.on('close', () => undefined)
      return
    }
    if (prompt === 'partial') count = 1
    if (prompt === 'reject') {
      response.writeHead(400)
      response.end(
        JSON.stringify({
          error: { code: 'content_policy_violation', message: 'private-provider-error' },
        }),
      )
      return
    }
    const finish = () => {
      response.setHeader('Content-Type', 'application/json')
      response.end(
        JSON.stringify({
          data: Array.from({ length: count }, () => ({ b64_json: png.toString('base64') })),
        }),
      )
    }
    if (prompt === 'background') setTimeout(finish, 2500)
    else finish()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const endpoint = 'http://127.0.0.1:' + address.port + '/v1',
    errors: string[] = []
  const memberContext = await browser.newContext({
    baseURL,
    viewport: info.project.use.viewport ?? { width: 1440, height: 900 },
    extraHTTPHeaders: info.project.use.extraHTTPHeaders ?? {},
    ...(info.project.use.userAgent ? { userAgent: info.project.use.userAgent } : {}),
    deviceScaleFactor: info.project.use.deviceScaleFactor ?? 1,
    isMobile: info.project.use.isMobile ?? false,
    hasTouch: info.project.use.hasTouch ?? false,
  })
  const member = await memberContext.newPage()
  observeErrors(page, errors)
  observeErrors(member, errors)
  let adminToken = '',
    modelID = '',
    chatModelID = '',
    channelID = ''
  let oldPricing: Record<string, unknown> | undefined,
    oldSettings: ReturnType<typeof parseImageConfiguration> | undefined
  async function api(
    method: string,
    path: string,
    body?: unknown,
    token = adminToken,
    idempotencyKey?: string,
  ) {
    const response = await page.request.fetch('/api/v1' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        'X-Lumi-CSRF': '1',
        Origin: baseURL ?? '',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { data: body }),
    })
    expect(response.ok(), path + ' status ' + response.status()).toBe(true)
    return response.status() === 204 ? {} : record(await response.json())
  }
  try {
    adminToken = await login(page, adminEmail, adminPassword)
    const password = randomBytes(18).toString('base64url') + 'Aa1',
      email = 'image-admin-' + suffix + '@lumi.test'
    await api('POST', '/admin/users', {
      email,
      password,
      nickname: 'Image administrator',
      role: 'admin',
      initial_credits: 0,
    })
    await page.context().clearCookies()
    adminToken = await login(page, email, password)
    const channel = await api('POST', '/admin/upstreams', {
      version: 0,
      name: 'Image fixture ' + suffix,
      base_url: endpoint,
      api_key: key,
      timeout_chat_s: 10,
      timeout_image_s: 15,
      proxy_url: '',
      enabled: true,
      priority: 0,
      weight: 1,
      edit_format: 'multipart',
      note: '',
    })
    channelID = String(channel.id)
    chatModelID = String(
      (
        await api('POST', '/admin/models', {
          version: 0,
          display_name: 'Journey Chat ' + suffix,
          type: 'chat',
          description: '',
          icon: '',
          sort_order: 0,
          enabled: true,
          is_default: true,
          capabilities: defaultCapabilities('chat'),
          routes: [
            {
              upstream_id: channelID,
              upstream_model_name: wire,
              priority: 0,
              weight: 1,
              enabled: true,
            },
          ],
        })
      ).id,
    )
    const model = await api('POST', '/admin/models', {
      version: 0,
      display_name: modelName,
      type: 'image',
      description: '',
      icon: '',
      sort_order: 0,
      enabled: true,
      is_default: true,
      capabilities: {
        ...defaultCapabilities('image'),
        qualities: ['low', 'medium', 'high'],
        sizes: ['1024x1024', '1536x1024', 'auto'],
        max_n: 4,
        supports_edit: true,
        max_reference_images: 4,
      },
      routes: [
        {
          upstream_id: channelID,
          upstream_model_name: wire,
          priority: 0,
          weight: 1,
          enabled: true,
        },
      ],
    })
    modelID = String(model.id)
    oldPricing = await api('GET', '/admin/pricing')
    if (!Array.isArray(oldPricing.rules)) throw new Error('Missing price rules')
    await api('PUT', '/admin/pricing', {
      ...oldPricing,
      configuration: { ...record(oldPricing.configuration), signup_bonus_credits: 10 },
      rules: [
        ...oldPricing.rules,
        ...(['generate', 'edit'] as const).flatMap((operation) =>
          (['low', 'medium', 'high'] as const).map((quality) => ({
            model_id: modelID,
            operation,
            quality,
            credits_per_image: 10,
            enabled: quality === 'medium',
          })),
        ),
      ],
    })
    oldSettings = parseImageConfiguration(await api('GET', '/admin/image-settings'))
    await api('PUT', '/admin/image-settings', {
      ...oldSettings,
      sizes: ['1024x1024', '1536x1024', 'auto'],
      ratio_sizes: { '1:1': '1024x1024', '3:2': '1536x1024' },
      per_user_concurrency: 1,
      global_concurrency: 2,
      timeout_seconds: 15,
      split_requests: false,
      admin_can_view_content: false,
    })
    const memberEmail = 'image-member-' + suffix + '@lumi.test'
    const registration = await api('GET', '/admin/settings/registration')
    await api('PUT', '/admin/settings/registration', {
      registration: {
        ...record(registration.registration),
        enabled: true,
        email_verification_enabled: false,
      },
    })
    await member.goto('/register')
    await member.getByLabel('昵称', { exact: true }).fill('Image member')
    await member.getByLabel('邮箱地址', { exact: true }).fill(memberEmail)
    await member.getByLabel('密码', { exact: true }).fill(password)
    await member.getByRole('checkbox').check()
    const registered = member.waitForResponse(
      (r) => r.url().endsWith('/auth/register') && r.request().method() === 'POST',
    )
    await member.getByRole('button', { name: '创建账号', exact: true }).click()
    const registrationResult = record(await (await registered).json())
    const memberToken = String(registrationResult.access_token),
      memberUser = record(registrationResult.user)
    await expect(member).toHaveURL(/\/chat$/)
    await member.getByLabel('消息内容', { exact: true }).fill('开始完整旅程')
    await member.getByLabel('消息内容', { exact: true }).press('Enter')
    await expect(member.locator('.chat-message-assistant').last()).toContainText(
      '旅程中的第一段回答。',
    )
    const batch = await api(
      'POST',
      '/admin/redeem-batches',
      {
        name: 'Journey ' + suffix,
        note: '',
        prefix: '',
        quantity: 1,
        credits: 10000,
        max_uses: 1,
        expires_at: null,
      },
      adminToken,
      randomUUID(),
    )
    const codes = await api('GET', '/admin/redeem-codes?batch_id=' + String(batch.id))
    if (!Array.isArray(codes.items)) throw new Error('Journey code missing')
    // Credit forms are assigned to PR-5; the original journey still covers them.
    await api(
      'POST',
      '/me/redeem',
      { code: String(record(codes.items[0]).code) },
      memberToken,
      randomUUID(),
    )
    expect(
      Number((await api('GET', '/me/credits', undefined, memberToken)).permanent_balance),
    ).toBe(10010)
    const beforeAdjustment = record(await api('GET', '/me/credits', undefined, memberToken))
    const adjusted = await api(
      'POST',
      '/admin/users/' + String(memberUser.id) + '/credits',
      { action: 'add', bucket: 'permanent', amount: 5, note: 'M7 full journey' },
      adminToken,
      randomUUID(),
    )
    expect(Number(adjusted.total)).toBe(Number(beforeAdjustment.total) + 5)
    expect(
      Number((await api('GET', '/me/credits', undefined, memberToken)).permanent_balance),
    ).toBe(10015)
    await member.goto('/create')
    await expect(member.getByRole('button', { name: '选择模型', exact: true })).toContainText(
      modelName,
    )
    const prompt = member.getByLabel('画面描述', { exact: true }),
      send = member.getByRole('button', { name: '开始生成', exact: true })
    await prompt.fill('image-only draft')
    await member
      .getByRole('navigation', { name: '创作模式' })
      .getByRole('link', { name: '聊天', exact: true })
      .click()
    await member.getByLabel('消息内容', { exact: true }).fill('chat-only draft')
    await member
      .getByRole('navigation', { name: '创作模式' })
      .getByRole('link', { name: '生图', exact: true })
      .click()
    await expect(prompt).toHaveValue('image-only draft')
    await member.getByRole('button', { name: '生图参数', exact: true }).click()
    await expect(member.getByLabel('质量', { exact: true })).toHaveValue('medium')
    expect(await member.getByLabel('质量', { exact: true }).locator('option').count()).toBe(1)
    await member.getByLabel('比例', { exact: true }).selectOption('3:2')
    await expect(member.getByLabel('尺寸', { exact: true })).toHaveValue('1536x1024')
    await member.getByLabel('尺寸', { exact: true }).selectOption('1024x1024')
    await expect(member.getByLabel('比例', { exact: true })).toHaveValue('')
    await member.getByLabel('张数', { exact: true }).selectOption('2')
    const parameters = member.getByRole('dialog', { name: '生图参数', exact: true })
    expect(
      await parameters.evaluate((element) => {
        const box = element.getBoundingClientRect()
        return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
      }),
    ).toBe(true)
    await member.screenshot({
      path: info.outputPath('image-parameters.png'),
      animations: 'disabled',
    })
    await member.keyboard.press('Escape')
    await prompt.fill('IME draft')
    await prompt.dispatchEvent('compositionstart')
    await prompt.dispatchEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      isComposing: true,
      keyCode: 229,
    })
    expect(calls).toBe(0)
    await expect(member).toHaveURL(/\/create$/)
    await prompt.dispatchEvent('compositionend')
    await prompt.press('Shift+Enter')
    await expect(prompt).toHaveValue('IME draft\n')
    await prompt.fill('partial')
    const keys: string[] = []
    let dropped = false
    await member.route('**/api/v1/image-tasks', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue()
        return
      }
      keys.push(route.request().headers()['idempotency-key'] ?? '')
      if (keys.length === 2) {
        await route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'RATE_LIMITED' }),
        })
        return
      }
      const response = await route.fetch()
      if (response.ok() && !dropped) {
        dropped = true
        await route.abort('failed')
      } else await route.fulfill({ response })
    })
    await expect(send).toBeEnabled()
    await send.click()
    await expect(member.getByRole('button', { name: '重试上次提交', exact: true })).toBeVisible()
    await member.getByRole('button', { name: '重试上次提交', exact: true }).click()
    await expect(member.getByRole('alert')).toContainText('操作过于频繁')
    await expect(member.getByRole('button', { name: '重试上次提交', exact: true })).toBeVisible()
    await member.keyboard.press('Control+k')
    const history = member.locator(
      info.project.name.includes('mobile') ? '.mobile-sidebar' : '.desktop-sidebar',
    )
    const historySearch = history.getByRole('searchbox', { name: '搜索生图会话', exact: true })
    await expect(historySearch).toBeFocused()
    await historySearch.fill('partial')
    await historySearch.press('Enter')
    await history.locator('.chat-sidebar-row a').filter({ hasText: 'partial' }).click()
    await expect(member).toHaveURL(/\/create\/[a-f0-9-]+$/)
    await expect(member.getByRole('button', { name: '重试上次提交', exact: true })).toBeVisible()
    await member.getByRole('button', { name: '重试上次提交', exact: true }).click()
    await expect(member).toHaveURL(/\/create\/[a-f0-9-]+$/)
    const conversationURL = member.url()
    const task = member.locator('.image-task').first()
    await expect(task.locator('.image-status')).toHaveText('部分完成', { timeout: 20_000 })
    await expect(task).toContainText('实际 10 积分')
    await expect(task).toContainText('已退 10 积分')
    expect(keys).toHaveLength(3)
    expect(keys[0]).toBeTruthy()
    expect(keys[0]).toBe(keys[1])
    expect(keys[0]).toBe(keys[2])
    expect(calls).toBe(1)
    await member.unroute('**/api/v1/image-tasks')
    const firstID = await task.getAttribute('data-task-id')
    if (!firstID) throw new Error('Missing task ID')
    const persisted = parseTask(await api('GET', '/image-tasks/' + firstID, undefined, memberToken))
    const original = persisted.items[0]?.file
    if (!original) throw new Error('Missing image file')
    expect(original.width).toBe(900)
    expect(original.thumbnail_width).toBe(512)
    const forbidden = await page.request.get('/api/v1/image-tasks/' + firstID, {
      headers: { Authorization: 'Bearer ' + adminToken },
    })
    expect(forbidden.status()).toBe(404)
    const denied = await page.request.get(original.url, {
      headers: { Authorization: 'Bearer ' + adminToken },
    })
    expect(denied.status()).toBe(404)
    await expect(task.locator('img').first()).toBeVisible()
    for (const region of [
      member.locator('.image-composer'),
      task.locator('.image-result-actions').first(),
    ]) {
      expect(
        await region.evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          return Array.from(element.querySelectorAll('button')).every((button) => {
            const box = button.getBoundingClientRect()
            return box.left >= bounds.left - 1 && box.right <= bounds.right + 1
          })
        }),
      ).toBe(true)
    }
    expect(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
    await member.screenshot({ path: info.outputPath('images-light.png'), animations: 'disabled' })
    await member.getByRole('button', { name: '切换深色主题', exact: true }).click()
    await member.screenshot({ path: info.outputPath('images-dark.png'), animations: 'disabled' })
    await task.getByRole('button', { name: '预览图片 1', exact: true }).click()
    let dialog = member.getByRole('dialog')
    await expect(dialog.getByRole('img')).toBeVisible()
    await dialog.getByLabel('缩放', { exact: true }).selectOption('150')
    const download = member.waitForEvent('download')
    await dialog.getByRole('button', { name: '下载原图', exact: true }).click()
    expect((await download).suggestedFilename()).toBe('lumi-' + original.id + '.png')
    await memberContext.grantPermissions(['clipboard-read', 'clipboard-write'])
    await dialog.getByRole('button', { name: '复制图片', exact: true }).click()
    await expect(dialog.getByRole('button', { name: '图片已复制', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: '加入改图', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(member.locator('.image-references img')).toHaveCount(1)
    await expect(prompt).toBeFocused()
    await member.getByRole('button', { name: '生图参数', exact: true }).click()
    await member.getByLabel('张数', { exact: true }).selectOption('1')
    await member.keyboard.press('Escape')
    await prompt.fill('edit reference')
    await send.click()
    await expect(member.locator('.image-task').last().locator('.image-status')).toHaveText(
      '已完成',
      { timeout: 20_000 },
    )
    expect(edits).toBe(1)
    expect(reusedReference).toBe(true)
    // Uploaded references use real multipart validation; library choices reuse existing IDs.
    await member
      .locator('input[type=file]')
      .setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: png })
    await expect(member.locator('.image-references img')).toHaveCount(1)
    await member.getByRole('button', { name: '移除参考图', exact: true }).click()
    await member.getByRole('button', { name: '从已有图片选择', exact: true }).click()
    dialog = member.getByRole('dialog')
    await expect(dialog.locator('.image-library-item').first()).toBeVisible()
    await dialog.locator('.image-library-item').first().click()
    await expect(member.locator('.image-references img')).toHaveCount(1)
    await member.getByRole('button', { name: '移除参考图', exact: true }).click()
    const beforeBackground = calls
    let disconnected = false,
      pollRequests = 0
    member.on('request', (request) => {
      if (request.method() === 'GET' && /\/api\/v1\/image-tasks\/[a-f0-9-]+$/.test(request.url()))
        pollRequests++
    })
    await member.route('**/api/v1/image-tasks/*/events', async (route) => {
      disconnected = true
      await route.abort('failed')
    })
    await prompt.fill('background')
    await send.click()
    await expect(member.locator('.image-task')).toHaveCount(3)
    await member
      .getByRole('navigation', { name: '创作模式' })
      .getByRole('link', { name: '聊天', exact: true })
      .click()
    await member
      .getByRole('navigation', { name: '创作模式' })
      .getByRole('link', { name: '生图', exact: true })
      .click()
    await expect(member).toHaveURL(conversationURL)
    await expect(member.locator('.image-task').last().locator('.image-status')).toHaveText(
      '已完成',
      { timeout: 20_000 },
    )
    expect(disconnected).toBe(true)
    expect(pollRequests).toBeGreaterThan(0)
    expect(calls).toBe(beforeBackground + 1)
    await member.unroute('**/api/v1/image-tasks/*/events')
    await prompt.fill('cancel')
    await send.click()
    const cancelTask = member.locator('.image-task').last()
    await expect(cancelTask.locator('.image-status')).toHaveText('生成中', { timeout: 15_000 })
    await cancelTask.getByRole('button', { name: '取消任务', exact: true }).click()
    await expect(cancelTask.locator('.image-status')).toHaveText('已取消', { timeout: 15_000 })
    await expect(cancelTask).toContainText('实际 0 积分')
    await expect(cancelTask).toContainText('已退 10 积分')
    await prompt.fill('reject')
    await send.click()
    await expect(member.locator('.image-task').last().locator('.image-status')).toHaveText(
      '生成失败',
      { timeout: 20_000 },
    )
    await expect(member.locator('.image-task').last()).toContainText('已退 10 积分')
    const adminView = await api('GET', '/admin/image-tasks/' + firstID)
    expect(adminView.content_visible).toBe(false)
    expect(adminView.prompt).toBe('')
    // Admin forms remain covered by the legacy suite until PR-6. Check the same real privacy contract here.
    expect(adminView.items).toEqual(persisted.items.map((item) => ({ ...item, file: null })))
    const settings = parseImageConfiguration(await api('GET', '/admin/image-settings'))
    await api('PUT', '/admin/image-settings', { ...settings, admin_can_view_content: true })
    const visible = parseTask(await api('GET', '/admin/image-tasks/' + firstID))
    expect(visible.content_visible).toBe(true)
    expect(visible.prompt).toBe('partial')
    expect(visible.items[0]?.file?.id).toBe(original.id)
    const adminDetail = await api('GET', '/admin/image-tasks/' + firstID)
    for (const secret of [
      key,
      wire,
      endpoint,
      'private-provider-error',
      'request_hash',
      'thumbnail_path',
      'charge_id',
    ])
      expect(JSON.stringify(adminDetail)).not.toContain(secret)
    await member.goto('/me/images')
    await expect(member.locator('.image-gallery-card')).toHaveCount(3)
    expect(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
    await member.screenshot({ path: info.outputPath('image-gallery.png'), animations: 'disabled' })
    await member.locator('.image-gallery-card').first().getByRole('checkbox').check()
    const [archive] = await Promise.all([
      member.waitForEvent('download'),
      member.getByRole('button', { name: '下载 ZIP', exact: true }).click(),
    ])
    expect(archive.suggestedFilename()).toBe('lumi-images.zip')
    const archivePath = await archive.path()
    if (!archivePath) throw new Error('Missing ZIP download')
    expect((await readFile(archivePath)).subarray(0, 2).toString()).toBe('PK')
    await member.getByLabel('质量', { exact: true }).selectOption('high')
    await member.getByRole('button', { name: '筛选', exact: true }).click()
    await expect(
      member.getByRole('heading', { name: '这里将收藏你的每一次创作', exact: true }),
    ).toBeVisible()
    await member.getByLabel('质量', { exact: true }).selectOption('')
    await member.getByRole('button', { name: '筛选', exact: true }).click()
    await expect(member.locator('.image-gallery-card')).toHaveCount(3)
    await member
      .locator('.image-gallery-card')
      .first()
      .getByRole('button', { name: '删除图片', exact: true })
      .click()
    dialog = member.getByRole('dialog')
    await dialog.getByRole('button', { name: '删除', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(member.locator('.image-gallery-card')).toHaveCount(2)
    await member
      .locator('.image-gallery-card')
      .first()
      .getByRole('button', { name: '加入改图', exact: true })
      .click()
    await expect(member).toHaveURL(/\/create$/)
    await expect(member.locator('.image-references img')).toHaveCount(1)
    await member.goto('/me/images')
    await expect(member.locator('.image-gallery-card')).toHaveCount(2)
    await member.locator('.image-gallery-card').first().getByRole('checkbox').check()
    await member.getByRole('button', { name: '批量删除', exact: true }).click()
    await member.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click()
    await expect(member.getByRole('dialog')).not.toBeVisible()
    await expect(member.locator('.image-gallery-card')).toHaveCount(1)
    const account = await api('GET', '/me/credits', undefined, memberToken)
    expect(Number(account.total)).toBeGreaterThanOrEqual(9970)
    // Profile UI is assigned to PR-5. Retain the real avatar upload/ownership/dimension assertions.
    const avatarResponse = await member.request.post('/api/v1/files?kind=avatar', {
      headers: { Authorization: 'Bearer ' + memberToken, 'X-Lumi-CSRF': '1', Origin: baseURL },
      multipart: { file: { name: 'avatar.png', mimeType: 'image/png', buffer: png } },
    })
    expect(avatarResponse.ok()).toBe(true)
    const avatarUpload = record(await avatarResponse.json())
    const profile = await api('GET', '/me', undefined, memberToken)
    expect(profile.avatar_file_id).toBe(avatarUpload.id)
    const avatar = await api(
      'GET',
      '/files/' + String(profile.avatar_file_id) + '/metadata',
      undefined,
      memberToken,
    )
    expect(avatar.width).toBe(256)
    expect(avatar.height).toBe(256)
    await member.reload()
    expect((await api('GET', '/me', undefined, memberToken)).avatar_file_id).toBe(avatarUpload.id)
    // Real generated files exercise cursor pagination and bounded gallery rendering.
    const galleryEmail = 'image-gallery-' + suffix + '@lumi.test'
    await api('POST', '/admin/users', {
      email: galleryEmail,
      password,
      nickname: 'Gallery member',
      role: 'user',
      initial_credits: 10000,
    })
    await memberContext.clearCookies()
    const galleryToken = await login(member, galleryEmail, password),
      galleryConversation = randomUUID()
    await api(
      'POST',
      '/image-conversations',
      { id: galleryConversation, model_id: modelID },
      galleryToken,
    )
    for (let index = 0; index < 15; index++) {
      await api(
        'POST',
        '/image-tasks',
        {
          conversation_id: galleryConversation,
          model_id: modelID,
          prompt: 'gallery ' + index,
          quality: 'medium',
          size: '1024x1024',
          ratio: '',
          n: 4,
          reference_file_ids: [],
        },
        galleryToken,
        randomUUID(),
      )
    }
    // Workers can finish queued tasks out of submission order; wait for the full fixture.
    await expect
      .poll(
        async () => {
          const gallery = await api('GET', '/me/images?limit=100', undefined, galleryToken)
          return Array.isArray(gallery.items) ? gallery.items.length : 0
        },
        { timeout: 60_000, intervals: [500] },
      )
      .toBe(60)
    const requested: string[] = []
    member.on('request', (request) => {
      if (request.url().includes('/api/v1/files/')) requested.push(request.url())
    })
    const firstPageResponse = member.waitForResponse(
      (r) => r.url().includes('/api/v1/me/images?') && r.status() === 200,
    )
    await member.goto('/me/images')
    const firstPage = record(await (await firstPageResponse).json())
    expect(Array.isArray(firstPage.items) && firstPage.items.length).toBe(40)
    const nextPageResponse = member.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/me/images?') && r.url().includes('cursor=') && r.status() === 200,
    )
    await member.getByRole('button', { name: '加载更多', exact: true }).click()
    const nextPage = record(await (await nextPageResponse).json())
    expect(Array.isArray(nextPage.items) && nextPage.items.length).toBe(20)
    if (!Array.isArray(firstPage.items) || !Array.isArray(nextPage.items))
      throw new Error('Invalid gallery page')
    expect(
      new Set([...firstPage.items, ...nextPage.items].map((item) => record(record(item).file).id))
        .size,
    ).toBe(60)
    const bounded = member.locator('.image-gallery-card')
    await expect(bounded.first()).toBeVisible()
    expect(await bounded.count()).toBeLessThan(info.project.name.includes('mobile') ? 12 : 30)
    expect(requested.length).toBeGreaterThan(0)
    expect(requested.every((url) => url.includes('/thumb?'))).toBe(true)
    expect(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
    await member.screenshot({
      path: info.outputPath('image-gallery-virtualized.png'),
      animations: 'disabled',
    })
    execFileSync('go', ['run', '-tags=integration', './internal/testsupport/galleryseed'], {
      cwd: fileURLToPath(new URL('../../../backend', import.meta.url)),
      env: {
        ...process.env,
        APP_ENV: 'test',
        E2E_IMAGE_USER_ID: String((await api('GET', '/me', undefined, galleryToken)).id),
        E2E_DATA_DIR: fileURLToPath(new URL('../../../.tools/e2e-data', import.meta.url)),
      },
      stdio: 'pipe',
      timeout: 90_000,
    })
    await member.reload()
    // Load every cursor page, then exercise the beginning, middle and end of 1000 real files.
    for (let loaded = 40; loaded < 1000; loaded += 40) {
      const response = member.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/me/images?') &&
          r.url().includes('cursor=') &&
          r.status() === 200,
      )
      await member.getByRole('button', { name: '加载更多', exact: true }).click()
      await response
    }
    await expect(member.getByRole('button', { name: '加载更多', exact: true })).toHaveCount(0)
    for (const fraction of [0, 0.5, 1]) {
      await member.locator('.image-gallery-scroll').evaluate((el, ratio) => {
        el.scrollTop = (el.scrollHeight - el.clientHeight) * ratio
      }, fraction)
      await expect(bounded.first()).toBeVisible()
      expect(await bounded.count()).toBeLessThan(info.project.name.includes('mobile') ? 12 : 30)
    }
    await member.screenshot({
      path: info.outputPath('image-gallery-1000.png'),
      animations: 'disabled',
    })
    expect(errors).toEqual([])
  } finally {
    await memberContext.close()
    if (oldPricing) await api('PUT', '/admin/pricing', oldPricing)
    if (oldSettings) {
      const latest = parseImageConfiguration(await api('GET', '/admin/image-settings'))
      await api('PUT', '/admin/image-settings', { ...oldSettings, version: latest.version })
    }
    if (channelID) await api('DELETE', '/admin/upstreams/' + channelID)
    if (modelID) await api('DELETE', '/admin/models/' + modelID)
    if (chatModelID) await api('DELETE', '/admin/models/' + chatModelID)
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  }
})
