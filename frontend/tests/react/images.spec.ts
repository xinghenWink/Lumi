import { journeyHeaders } from './client-headers'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from './test'
import { record } from '../../src/api/transport'
import { defaultCapabilities } from '../../src/api/catalog-contracts'
import { parseTask, parseImageConfiguration } from '../../src/api/images'
import { observeErrors } from '../browser-errors'
import { fixturePNG } from '../image-fixture'
import { drawStroke, isSketchUpload, openSketch } from './sketch'
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
  // Two solid-color frames with different delays and an infinite loop.
  const gif = Buffer.from(
    'R0lGODlhBAADAIAAAP8AAAD/ACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAFAAAACwAAAAABAADAAACCgRBEARBEARBEAUAIfkEAB4AAAAsAAAAAAQAAwAAAgoMwzAMwzAMwzAFADs=',
    'base64',
  )
  const wire = 'private-image-' + suffix,
    modelName = 'Lumi Image ' + suffix,
    alternateModelName = 'Alternate Image ' + suffix
  const backgroundPrompt = Array.from(
    { length: 24 },
    (_, index) => `第 ${index + 1} 段：薄雾中的海边灯塔，暖色调胶片摄影，保留海面细节。`,
  ).join('\n')
  const filteredLivePrompt = 'Live search result ' + suffix
  let finishFilteredTask: (() => void) | undefined
  const upstreamPlanning = new Map<string, unknown>()
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
      outputFormat: unknown,
      complexity: unknown,
      size: unknown,
      count = 1
    if (request.url === '/v1/images/edits') {
      edits++
      const form = raw.toString('utf8')
      prompt = form.match(/name="prompt"\r\n\r\n([^\r]*)/)?.[1] ?? ''
      outputFormat = form.match(/name="output_format"\r\n\r\n([^\r]*)/)?.[1]
      complexity = form.match(/name="complexity"\r\n\r\n([^\r]*)/)?.[1]
      size = form.match(/name="size"\r\n\r\n([^\r]*)/)?.[1]
      reusedReference = raw.includes(Buffer.from([137, 80, 78, 71]))
    } else if (request.url === '/v1/images/generations') {
      const input = record(JSON.parse(raw.toString('utf8')) as unknown)
      prompt = String(input.prompt)
      count = Number(input.n)
      outputFormat = input.output_format
      complexity = input.complexity
      size = input.size
    } else {
      response.writeHead(404)
      response.end()
      return
    }
    calls++
    upstreamPlanning.set(prompt, complexity)
    if (
      prompt.includes('自拍比耶') &&
      (request.url !== '/v1/images/edits' || outputFormat !== 'gif' || size !== '1024x768')
    ) {
      response.writeHead(422)
      response.end()
      return
    }
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
          data: Array.from({ length: count }, () => ({
            b64_json: (outputFormat === 'gif' ? gif : png).toString('base64'),
          })),
        }),
      )
    }
    if (prompt === filteredLivePrompt) finishFilteredTask = finish
    else if (prompt === backgroundPrompt) setTimeout(finish, 2500)
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
    extraHTTPHeaders: journeyHeaders(info),
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
    alternateModelID = '',
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
      timeout_image_s: 30,
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
    const modelInput = {
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
        supported_resolutions: ['1k', '2k'],
        sizes: ['1024x1024', '1536x1024', '2016x1344', '4032x2688', '1024x768', 'auto'],
        max_n: 4,
        supports_edit: true,
        supports_gif: true,
        supports_complexity: true,
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
    }
    const model = await api('POST', '/admin/models', modelInput)
    modelID = String(model.id)
    const alternateModel = await api('POST', '/admin/models', {
      ...modelInput,
      display_name: alternateModelName,
      is_default: false,
      capabilities: { ...modelInput.capabilities, supports_complexity: false },
    })
    alternateModelID = String(alternateModel.id)
    oldPricing = await api('GET', '/admin/pricing')
    if (!Array.isArray(oldPricing.rules)) throw new Error('Missing price rules')
    await api('PUT', '/admin/pricing', {
      ...oldPricing,
      configuration: { ...record(oldPricing.configuration), signup_bonus_credits: 10 },
      rules: [
        ...oldPricing.rules,
        ...[modelID, alternateModelID].flatMap((model_id) =>
          (['generate', 'edit'] as const).flatMap((operation) =>
            (['low', 'medium', 'high'] as const).map((quality) => ({
              model_id,
              operation,
              quality,
              credits_per_image: 10,
              enabled: quality === 'medium',
            })),
          ),
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
      timeout_seconds: 30,
      split_requests: false,
      admin_can_view_content: false,
    })
    const memberEmail = ('image-member-' + suffix).padEnd(62, 'x') + '@lumi.test'
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
    await expect(member.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled()
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
    await member.goto('/me/credits')
    await member.getByLabel('兑换积分', { exact: true }).fill(String(record(codes.items[0]).code))
    await member.getByRole('button', { name: '确认兑换', exact: true }).click()
    await expect(member.getByTestId('permanent-balance')).toHaveText('10,010')
    const beforeAdjustment = record(await api('GET', '/me/credits', undefined, memberToken))
    const adjusted = await api(
      'POST',
      '/admin/users/' + String(memberUser.id) + '/credits',
      { action: 'add', bucket: 'permanent', amount: 5, note: 'M7 full journey' },
      adminToken,
      randomUUID(),
    )
    expect(Number(adjusted.total)).toBe(Number(beforeAdjustment.total) + 5)
    await member.reload()
    await expect(member.getByTestId('permanent-balance')).toHaveText('10,015')
    await member.goto('/create')
    await expect(member.getByRole('button', { name: '选择模型', exact: true })).toContainText(
      modelName,
    )
    const prompt = member.getByRole('textbox', { name: '画面描述', exact: true }),
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
    // Desktop keeps parameters visible in the studio panel; smaller screens open a sheet.
    const mobile = info.project.name.includes('mobile')
    if (!mobile) {
      await expect(send).toHaveText('开始生成')
      await expect(send.locator('svg')).toHaveCount(0)
    }
    const parameters = member.getByRole(mobile ? 'dialog' : 'region', {
      name: '生图参数',
      exact: true,
    })
    if (mobile) await member.getByRole('button', { name: '生图参数', exact: true }).click()
    const planning = parameters.getByLabel('规划强度', { exact: true })
    await expect(planning).toHaveValue('')
    await expect(planning.locator('option')).toHaveText(['官方默认', '低', '中', '高'])
    if (mobile) await planning.selectOption('low')
    else {
      await planning.focus()
      await expect(planning).toBeFocused()
      await member.keyboard.press('ArrowDown')
    }
    await expect(planning).toHaveValue('low')
    await planning.selectOption('')
    await expect(planning).toHaveValue('')
    const auto = parameters.getByRole('radio', { name: '自动', exact: true })
    const bySize = parameters.getByRole('radio', { name: '按尺寸', exact: true })
    const resolution = parameters.getByLabel('分辨率', { exact: true })
    await expect(auto).toBeChecked()
    await expect(resolution).toHaveCount(0)
    await auto.focus()
    await member.keyboard.press('ArrowRight')
    await expect(bySize).toBeChecked()
    await expect(parameters.getByLabel('尺寸', { exact: true })).toHaveValue('1024x1024')
    await member.keyboard.press('ArrowLeft')
    await expect(auto).toBeChecked()
    await expect(parameters.getByRole('radio', { name: '精细', exact: true })).toBeChecked()
    // Disabled model overrides fall back to the active global price.
    await expect(
      parameters.getByRole('radiogroup', { name: '质量', exact: true }).locator('label'),
    ).toHaveText(['标准', '精细', '高清'])
    await parameters.getByRole('radio', { name: '3:2', exact: true }).check()
    await expect(resolution).toHaveValue('1536x1024')
    await expect(resolution.locator('option[value="4032x2688"]')).toHaveCount(0)
    await resolution.selectOption({ label: '2K · 2016 × 1344' })
    await expect(parameters.getByRole('radio', { name: '3:2', exact: true })).toBeChecked()
    await expect(resolution).toHaveValue('2016x1344')
    await bySize.check()
    await parameters.getByLabel('尺寸', { exact: true }).selectOption('1024x1024')
    await expect(bySize).toBeChecked()
    await parameters.getByRole('radio', { name: '3:2', exact: true }).check()
    await resolution.selectOption({ label: '2K · 2016 × 1344' })
    await parameters.getByRole('radio', { name: '2 张', exact: true }).check()
    await parameters.scrollIntoViewIfNeeded()
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
    expect(persisted).toMatchObject({ ratio: '3:2', size: '2016x1344' })
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
    const topActions = task.getByTestId('image-task-top-actions')
    const detailsButton = topActions.getByRole('button', { name: '任务详情', exact: true })
    await detailsButton.click()
    const taskDetails = member.getByRole('dialog', { name: '任务详情', exact: true })
    await expect(taskDetails.getByText(firstID, { exact: true })).toBeVisible()
    await member.keyboard.press('Escape')
    await expect(taskDetails).toBeHidden()
    await expect(detailsButton).toBeFocused()
    await topActions.getByRole('button', { name: '使用相同参数', exact: true }).click()
    await expect(prompt).toHaveValue('partial')
    expect(calls).toBe(1)
    if (mobile) await member.getByRole('button', { name: '生图参数', exact: true }).click()
    await expect(parameters.getByLabel('分辨率', { exact: true })).toHaveValue('2016x1344')
    await member.keyboard.press('Escape')
    await member.screenshot({ path: info.outputPath('images-light.png'), animations: 'disabled' })
    await member.getByRole('button', { name: '切换深色主题', exact: true }).click()
    await member.screenshot({ path: info.outputPath('images-dark.png'), animations: 'disabled' })
    const resultPreview = task.getByRole('button', { name: '预览图片 1', exact: true })
    await resultPreview.click()
    let dialog = member.getByRole('dialog')
    await expect(dialog.getByRole('img')).toBeVisible()
    await expect(dialog.getByRole('button', { name: '移除背景', exact: true })).toBeDisabled()
    await dialog.getByRole('button', { name: '标注', exact: true }).click()
    await dialog.getByRole('button', { name: '标注颜色', exact: true }).click()
    await member.getByRole('menuitem', { name: '蓝色', exact: true }).click()
    const overlay = dialog.locator('[data-slot="image-editor-overlay"]')
    await overlay.press('Enter')
    await overlay.press('Enter')
    const centerAlpha = () =>
      overlay.evaluate((element) => {
        if (!(element instanceof HTMLCanvasElement)) throw new Error('Missing drawing canvas')
        return element.getContext('2d')?.getImageData(element.width / 2, element.height / 2, 1, 1)
          .data[3]
      })
    await expect.poll(centerAlpha).toBeGreaterThan(0)
    await dialog.getByLabel('缩放', { exact: true }).selectOption('150')
    await expect.poll(centerAlpha).toBeGreaterThan(0)
    await dialog.getByLabel('缩放', { exact: true }).selectOption('100')
    await dialog.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(centerAlpha).toBe(0)
    await dialog.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(centerAlpha).toBeGreaterThan(0)
    await dialog.getByRole('button', { name: '添加评论', exact: true }).click()
    await overlay.press('ArrowRight')
    await overlay.press('Enter')
    await dialog.getByLabel('添加评论', { exact: true }).fill('保留此处纹理')
    await dialog.getByRole('button', { name: '保存修改', exact: true }).click()
    await dialog.getByRole('button', { name: /保留此处纹理/ }).click()
    await dialog.getByLabel('添加评论', { exact: true }).fill('保留此处颜色')
    await dialog.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(dialog.getByRole('button', { name: /保留此处颜色/ })).toBeVisible()
    await member.screenshot({
      path: info.outputPath('image-editor-dark.png'),
      animations: 'disabled',
    })
    await member.keyboard.press('Escape')
    const discard = member.getByRole('dialog', { name: '丢弃未提交的修改？' })
    await discard.getByRole('button', { name: '丢弃修改' }).click()
    await expect(resultPreview).toBeFocused()
    await resultPreview.click()
    await expect(dialog.getByRole('img')).toBeVisible()
    const zoom = dialog.getByLabel('缩放', { exact: true })
    if (!mobile) {
      const image = dialog.getByRole('img')
      const viewport = dialog.locator('[data-slot="image-preview-viewport"]')
      expect(
        await viewport.evaluate(
          (element) =>
            element.scrollWidth <= element.clientWidth + 1 &&
            element.scrollHeight <= element.clientHeight + 1,
        ),
      ).toBe(true)
      const fitted = await image.boundingBox()
      if (!fitted) throw new Error('Missing image preview bounds')
      await image.hover()
      await member.mouse.wheel(0, -120)
      await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(100)
      await expect
        .poll(async () => (await image.boundingBox())?.width ?? 0)
        .toBeGreaterThan(fitted.width)
      await member.mouse.wheel(0, 120)
      await expect(zoom).toHaveValue('100')
    }
    await zoom.selectOption('150')
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
    if (mobile) await member.getByRole('button', { name: '生图参数', exact: true }).click()
    await parameters.getByRole('radio', { name: '1 张', exact: true }).check()
    await member.keyboard.press('Escape')
    await prompt.fill('edit reference')
    await send.click()
    await expect(member.locator('.image-task').first().locator('.image-status')).toHaveText(
      '已完成',
      { timeout: 20_000 },
    )
    expect(edits).toBe(1)
    expect(reusedReference).toBe(true)
    const referenceDialog = member.getByRole('dialog', { name: '预览图片', exact: true })
    const submittedReference = member
      .locator('.image-task')
      .first()
      .getByRole('button', { name: '预览参考图 1', exact: true })
    if (mobile) await submittedReference.tap()
    else await submittedReference.press('Enter')
    await expect(referenceDialog.getByRole('img')).toHaveAttribute('width', String(original.width))
    await expect(referenceDialog.getByRole('button', { name: '标注', exact: true })).toBeVisible()
    await expect(referenceDialog.getByLabel('缩放', { exact: true })).toHaveValue('100')
    await member.keyboard.press('Escape')
    await expect(referenceDialog).toBeHidden()
    await expect(submittedReference).toBeFocused()

    // A library image and a fresh upload share one row of square thumbnails.
    const references = member.locator('.image-references')
    await member.getByRole('button', { name: '从已有图片选择', exact: true }).click()
    dialog = member.getByRole('dialog')
    await expect(dialog.locator('.image-library-item').first()).toBeVisible()
    await dialog.locator('.image-library-item').first().click()
    await expect(references.getByRole('img')).toHaveCount(1)
    await member
      .locator('input[type=file]')
      .setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: png })
    await expect(references.getByRole('img')).toHaveCount(2)
    const [first, second] = await references
      .locator('div[data-slot="attachment"]')
      .evaluateAll((tiles) =>
        tiles.map((tile) => {
          if (!(tile instanceof HTMLElement)) throw new Error('Expected an HTML attachment')
          return {
            x: tile.offsetLeft,
            y: tile.offsetTop,
            width: tile.offsetWidth,
            height: tile.offsetHeight,
          }
        }),
      )
    if (!first || !second) throw new Error('Missing reference thumbnails')
    expect(first).toMatchObject({ width: 64, height: 64 })
    expect(second).toMatchObject({ width: 64, height: 64 })
    expect(second.x).toBeGreaterThan(first.x)
    expect(second.y).toBe(first.y)
    const uploadedReference = references.getByRole('button', { name: '预览参考图 2', exact: true })
    if (mobile) await uploadedReference.tap()
    else await uploadedReference.click()
    await expect(referenceDialog.getByRole('img')).toBeVisible()
    await expect(referenceDialog.getByRole('button', { name: '擦除', exact: true })).toBeVisible()
    await referenceDialog.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(referenceDialog).toBeHidden()
    await expect(uploadedReference).toBeFocused()
    const removeReference = references.getByRole('button', { name: '移除参考图', exact: true })
    await expect(removeReference).toHaveCount(2)
    if (!mobile) {
      const action = removeReference.nth(1)
      const html = member.locator('html')
      const initialTheme = (await html.getAttribute('data-theme')) === 'dark' ? 'dark' : 'light'
      async function selectTheme(theme: 'light' | 'dark') {
        if ((await html.getAttribute('data-theme')) !== theme) {
          const name = theme === 'light' ? '切换浅色主题' : '切换深色主题'
          await member.getByRole('button', { name, exact: true }).click()
        }
        await expect(html).toHaveAttribute('data-theme', theme)
      }
      for (const colorScheme of ['light', 'dark'] as const) {
        await selectTheme(colorScheme)
        const theme = await member.locator('body').evaluate((body) => {
          const { backgroundColor, color } = getComputedStyle(body)
          return { backgroundColor, color }
        })
        await member.mouse.move(0, 0)
        await uploadedReference.focus()
        await member.keyboard.press('Tab')
        await expect(action).toBeFocused()
        await expect(action).toHaveCSS('background-color', theme.color)
        await expect(action.locator('svg')).toHaveCSS('stroke', theme.backgroundColor)
        await action.hover()
        await expect(action).toHaveCSS('background-color', theme.color)
        await expect(action.locator('svg')).toHaveCSS('stroke', theme.backgroundColor)
      }
      await selectTheme(initialTheme)
    }
    await removeReference.first().click()
    await removeReference.click()
    // Files dropped anywhere in the workspace, or pasted outside a text field, become references.
    const transfer = await member.evaluateHandle((encoded) => {
      const bytes = Uint8Array.from(atob(encoded), (value) => value.charCodeAt(0))
      const data = new DataTransfer()
      data.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }))
      return data
    }, png.toString('base64'))
    await member.locator('main').dispatchEvent('dragenter', { dataTransfer: transfer })
    await expect(member.getByText('松开以添加图片', { exact: true })).toBeVisible()
    await member.locator('main').dispatchEvent('drop', { dataTransfer: transfer })
    await expect(member.getByText('松开以添加图片', { exact: true })).toHaveCount(0)
    await expect(member.locator('.image-references img')).toHaveCount(1)
    await member.getByRole('button', { name: '移除参考图', exact: true }).click()
    await expect(member.locator('.image-references img')).toHaveCount(0)
    await member.evaluate((data) => {
      document.body.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      )
    }, transfer)
    await expect(member.locator('.image-references img')).toHaveCount(1)
    await member.getByRole('button', { name: '移除参考图', exact: true }).click()
    await transfer.dispose()
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
    await prompt.fill(backgroundPrompt)
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
    await expect(member.locator('.image-task').first().locator('.image-status')).toHaveText(
      '已完成',
      { timeout: 20_000 },
    )
    expect(disconnected).toBe(true)
    expect(pollRequests).toBeGreaterThan(0)
    expect(calls).toBe(beforeBackground + 1)
    await member.unroute('**/api/v1/image-tasks/*/events')

    if (!mobile) await member.getByRole('button', { name: '切换浅色主题', exact: true }).click()
    const promptTask = member.locator('.image-task').first()
    const promptTrigger = promptTask.getByRole('button', { name: '完整提示词', exact: true })
    const fullPrompt = member.getByRole('dialog', { name: '完整提示词', exact: true })
    const promptText = fullPrompt.getByRole('region', { name: '画面描述', exact: true })
    await expect(promptTrigger).toHaveAttribute('aria-expanded', 'false')
    expect(
      await promptTrigger.locator('span').evaluate((element) => {
        const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight)
        return element.clientHeight <= 2 * lineHeight && element.scrollHeight > element.clientHeight
      }),
    ).toBe(true)
    if (!mobile) {
      await prompt.focus()
      await promptTrigger.hover()
      await expect(fullPrompt).toBeVisible()
      await expect(prompt).toBeFocused()
      await promptText.hover()
      await member.mouse.wheel(0, 180)
      await expect
        .poll(() => promptText.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0)
      await promptTask.getByTestId('image-task-top-actions').hover()
      await expect(fullPrompt).toBeHidden()
      await expect(prompt).toBeFocused()
      await promptTrigger.press('Enter')
      await expect(promptText).toBeFocused()
    } else {
      await promptTrigger.tap()
    }
    await expect(fullPrompt).toBeVisible()
    expect(await promptText.textContent()).toBe(backgroundPrompt)
    expect(
      await fullPrompt.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        // A fractional Radix transform can introduce rounding error on mobile Chrome.
        return Math.round(bounds.height) <= 320 && bounds.left >= 0 && bounds.right <= innerWidth
      }),
    ).toBe(true)
    await member.screenshot({
      path: info.outputPath('image-task-prompt.png'),
      animations: 'disabled',
    })
    await fullPrompt.getByRole('button', { name: '复制提示词', exact: true }).click()
    await expect(fullPrompt.getByRole('status')).toHaveText('已复制')
    // Windows stores clipboard line endings as CRLF.
    const copiedPrompt = await member.evaluate(() => navigator.clipboard.readText())
    expect(copiedPrompt.replaceAll('\r\n', '\n')).toBe(backgroundPrompt)
    await member.keyboard.press('Escape')
    await expect(fullPrompt).toBeHidden()
    await expect(promptTrigger).toBeFocused()

    const waitForSubmission = () =>
      member.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/image-tasks') && response.request().method() === 'POST',
      )
    const waitForSavedModel = (conversation: string, model: string) =>
      member.waitForResponse(
        async (response) =>
          response.url().endsWith('/api/v1/image-conversations/' + conversation) &&
          response.request().method() === 'GET' &&
          response.ok() &&
          record(await response.json()).model_id === model,
      )
    const taskWithID = (id: string) => member.locator(`.image-task[data-task-id="${id}"]`)
    await member
      .locator('input[type=file]')
      .setInputFiles({ name: 'rerun-reference.png', mimeType: 'image/png', buffer: png })
    await expect(references.getByRole('img')).toHaveCount(1)
    await prompt.fill('cancel')
    const sourceResponse = waitForSubmission()
    await send.click()
    const source = parseTask(await (await sourceResponse).json())
    const cancelTask = taskWithID(source.id)
    await expect(cancelTask.locator('.image-status')).toHaveText('生成中', { timeout: 15_000 })
    const sourceActions = cancelTask.getByTestId('image-task-top-actions')
    const cards = member.locator('.image-task')
    const originalCount = await cards.count()
    await sourceActions.getByRole('button', { name: '使用相同参数', exact: true }).click()
    await expect(prompt).toHaveValue('cancel')
    await expect(references.getByRole('img')).toHaveCount(1)
    await expect(cards).toHaveCount(originalCount)
    const modelPicker = member.getByRole('button', { name: '选择模型', exact: true })
    await modelPicker.click()
    await member.getByRole('menuitemradio', { name: alternateModelName, exact: true }).click()
    if (mobile) await member.getByRole('button', { name: '生图参数', exact: true }).click()
    await expect(planning).toHaveCount(0)
    if (mobile) await member.keyboard.press('Escape')
    await prompt.fill('reject')
    const manualResponse = waitForSubmission()
    const savedAlternateModel = waitForSavedModel(source.conversation_id, alternateModelID)
    await send.click()
    const manual = parseTask(await (await manualResponse).json())
    expect(manual).toMatchObject({
      model_id: alternateModelID,
      prompt: 'reject',
      reference_file_ids: source.reference_file_ids,
    })
    await savedAlternateModel
    await expect(taskWithID(manual.id).locator('.image-status')).toHaveText('排队中')
    await prompt.fill('Keep this draft')
    const beforeRerun = await api('GET', '/me/credits', undefined, memberToken)
    const rerunResponse = waitForSubmission()
    const savedSourceModel = waitForSavedModel(source.conversation_id, modelID)
    await sourceActions.getByRole('button', { name: '重新生成', exact: true }).click()
    const rerun = parseTask(await (await rerunResponse).json())
    expect(rerun.id).not.toBe(source.id)
    expect(rerun).toMatchObject({
      conversation_id: source.conversation_id,
      model_id: source.model_id,
      prompt: source.prompt,
      operation: source.operation,
      quality: source.quality,
      size: source.size,
      ratio: source.ratio,
      n: source.n,
      reference_file_ids: source.reference_file_ids,
    })
    expect((await api('GET', '/me/credits', undefined, memberToken)).total).toBe(
      Number(beforeRerun.total) - rerun.total_cost,
    )
    await savedSourceModel
    await expect(cards.first()).toHaveAttribute('data-task-id', rerun.id)
    await expect(prompt).toHaveValue('Keep this draft')
    await expect(modelPicker).toContainText(alternateModelName)
    const rerunTask = taskWithID(rerun.id)
    await expect(rerunTask.locator('.image-status')).toHaveText('排队中')
    await expect(cancelTask.locator('.image-status')).toHaveText('生成中')
    await member.screenshot({
      path: info.outputPath('image-task-rerun-queued.png'),
      animations: 'disabled',
    })
    await rerunTask.getByRole('button', { name: '取消任务', exact: true }).click()
    await expect(rerunTask.locator('.image-status')).toHaveText('已取消')
    await expect(cancelTask.locator('.image-status')).toHaveText('生成中')
    await cancelTask.getByRole('button', { name: '取消任务', exact: true }).click()
    await expect(cancelTask.locator('.image-status')).toHaveText('已取消', { timeout: 15_000 })
    await expect(cancelTask).toContainText('实际 0 积分')
    await expect(cancelTask).toContainText('已退 10 积分')
    const manualTask = taskWithID(manual.id)
    await expect(manualTask.locator('.image-status')).toHaveText('生成失败', { timeout: 20_000 })
    await expect(manualTask).toContainText('已退 10 积分')
    const adminView = await api('GET', '/admin/image-tasks/' + firstID)
    expect(adminView.content_visible).toBe(false)
    expect(adminView.prompt).toBe('')
    expect(adminView.items).toEqual(persisted.items.map((item) => ({ ...item, file: null })))
    await page.goto('/admin/image-tasks')
    await page.getByLabel('用户 ID', { exact: true }).fill(String(memberUser.id))
    await page.getByRole('button', { name: '筛选', exact: true }).click()
    const taskTable = page.getByRole('region', { name: '图片任务', exact: true })
    const taskRow = taskTable.getByRole('row').filter({ hasText: firstID })
    const emailCell = taskRow.getByText(memberEmail, { exact: true })
    await expect(taskTable.getByRole('columnheader', { name: '用户信息' })).toBeVisible()
    await expect(taskRow.getByText('Image member', { exact: true })).toBeVisible()
    await expect(emailCell).toBeVisible()
    await expect(taskRow.getByText(String(memberUser.id), { exact: true })).toBeVisible()
    expect(await emailCell.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    )
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await taskTable.focus()
    await expect(taskTable).toBeFocused()
    if (info.project.use.isMobile) {
      await taskTable.press('ArrowRight')
      await expect
        .poll(() => taskTable.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0)
    }
    await taskRow.getByRole('button', { name: '任务详情', exact: true }).click()
    await expect(
      page.getByRole('dialog').getByText('内容访问未开启', { exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('img')).toHaveCount(0)
    await expect(
      page.getByRole('dialog').getByRole('button', { name: '删除图片 1', exact: true }),
    ).toBeVisible()
    await page.screenshot({
      path: info.outputPath('image-admin-private.png'),
      animations: 'disabled',
    })
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
    await page.goto('/admin/image-settings')
    await page.getByRole('switch', { name: '4K', exact: true }).uncheck()
    await page.getByRole('switch', { name: '9:16', exact: true }).uncheck()
    await page.getByLabel('允许管理员查看提示词、参考图与结果', { exact: true }).check()
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('生图设置已保存')
    await page.reload()
    await expect(page.getByRole('switch', { name: '4K', exact: true })).not.toBeChecked()
    await expect(page.getByRole('switch', { name: '9:16', exact: true })).not.toBeChecked()
    expect(parseImageConfiguration(await api('GET', '/admin/image-settings'))).toMatchObject({
      disabled_resolutions: ['4k'],
      disabled_ratios: ['9:16'],
    })
    await page.screenshot({ path: info.outputPath('image-settings.png'), animations: 'disabled' })
    await page.goto('/admin/image-tasks')
    await page.getByLabel('用户 ID', { exact: true }).fill(String(memberUser.id))
    await page.getByRole('button', { name: '筛选', exact: true }).click()
    await page
      .getByRole('row')
      .filter({ hasText: firstID })
      .getByRole('button', { name: '任务详情', exact: true })
      .click()
    await expect(page.getByRole('dialog').getByText('partial', { exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('image-admin-task.png'), animations: 'disabled' })
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
    await member.goto('/me')
    await member
      .locator('input[type=file]')
      .setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: png })
    await expect(member.locator('.profile-avatar img')).toBeVisible()
    const profile = await api('GET', '/me', undefined, memberToken)
    expect(typeof profile.avatar_file_id).toBe('string')
    const avatar = await api(
      'GET',
      '/files/' + String(profile.avatar_file_id) + '/metadata',
      undefined,
      memberToken,
    )
    expect(avatar.width).toBe(256)
    expect(avatar.height).toBe(256)
    await member.reload()
    await expect(member.locator('.profile-avatar img')).toBeVisible()
    expect((await api('GET', '/me', undefined, memberToken)).avatar_file_id).toBe(
      profile.avatar_file_id,
    )
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

    const galleryWorkspace = '/create/' + galleryConversation
    const tasksURL = '**/api/v1/image-tasks?*'
    await member.route(tasksURL, async (route) => {
      const url = new URL(route.request().url())
      if (
        url.searchParams.size === 2 &&
        url.searchParams.get('conversation_id') === galleryConversation
      ) {
        // Keep one real row in the initial history so the oldest task requires server search.
        url.searchParams.set('limit', '1')
      }
      await route.continue({ url: url.toString() })
    })
    await member.goto(galleryWorkspace)
    await expect(member.locator('.image-task')).toHaveCount(1)
    await expect(member.locator('.image-task').first()).toContainText('gallery 14')
    const searchTasks = member.getByRole('button', { name: '搜索当前会话', exact: true })
    const filterTasks = member.getByRole('button', { name: '筛选当前会话', exact: true })
    await searchTasks.click()
    const searchBox = member.getByRole('searchbox', { name: '搜索当前会话', exact: true })
    await expect(searchBox).toBeFocused()
    await searchBox.fill('GALLERY 0')
    await searchBox.press('Enter')
    await expect(member.locator('.image-task')).toHaveCount(1)
    await expect(member.locator('.image-task').first()).toContainText('gallery 0')
    await filterTasks.click()
    const filterPanel = member.getByRole('dialog', { name: '筛选当前会话' })
    await filterPanel.getByRole('button', { name: '最近一周', exact: true }).click()
    await filterPanel.getByLabel('状态', { exact: true }).selectOption('failed')
    await filterPanel.getByLabel('质量', { exact: true }).selectOption('medium')
    await member.screenshot({
      path: info.outputPath('image-workspace-filter.png'),
      animations: 'disabled',
    })
    await filterPanel.getByRole('button', { name: '应用筛选', exact: true }).click()
    await expect(member.getByText('没有符合条件的创作')).toBeVisible()
    await filterTasks.click()
    await filterPanel.getByRole('button', { name: '清空筛选', exact: true }).click()
    await expect(member.locator('.image-task').first()).toContainText('gallery 0')
    await filterTasks.click()
    await filterPanel.getByLabel('状态', { exact: true }).selectOption('succeeded')
    await filterPanel.getByRole('button', { name: '应用筛选', exact: true }).click()
    await expect(member.getByText('已应用筛选')).toBeVisible()

    const liveConversation = randomUUID()
    await api(
      'POST',
      '/image-conversations',
      { id: liveConversation, model_id: modelID },
      galleryToken,
    )
    const liveTask = parseTask(
      await api(
        'POST',
        '/image-tasks',
        {
          conversation_id: liveConversation,
          model_id: modelID,
          prompt: filteredLivePrompt,
          quality: 'medium',
          size: '1024x1024',
          ratio: '',
          n: 1,
          reference_file_ids: [],
        },
        galleryToken,
        randomUUID(),
      ),
    )
    await member.unroute(tasksURL)
    // Load the new conversation in the sidebar and switch without reloading the React workspace.
    await member.keyboard.press('Control+k')
    const workHistory = member.locator(mobile ? '.mobile-sidebar' : '.desktop-sidebar')
    const workHistorySearch = workHistory.getByRole('searchbox', {
      name: '搜索生图会话',
      exact: true,
    })
    await workHistorySearch.fill('Live search result')
    await workHistorySearch.press('Enter')
    await workHistory.locator(`a[href="/create/${liveConversation}"]`).click()
    await expect(member.locator(`[data-task-id="${liveTask.id}"]`)).toBeVisible()
    await expect(member.getByText('搜索词「GALLERY 0」')).toHaveCount(0)
    await expect(member.getByText('已应用筛选')).toHaveCount(0)
    await filterTasks.click()
    await filterPanel.getByLabel('状态', { exact: true }).selectOption('succeeded')
    await filterPanel.getByRole('button', { name: '应用筛选', exact: true }).click()
    await expect(member.getByText('没有符合条件的创作')).toBeVisible()
    await expect.poll(() => !!finishFilteredTask).toBe(true)
    finishFilteredTask?.()
    await expect(member.locator(`[data-task-id="${liveTask.id}"] .image-status`)).toHaveText(
      '已完成',
    )
    // Keep the original gallery fixture size for its pagination and performance assertions.
    const liveResult = parseTask(
      await api('GET', '/image-tasks/' + liveTask.id, undefined, galleryToken),
    )
    const liveFile = liveResult.items[0]?.file
    if (!liveFile) throw new Error('Missing live search result file')
    await api('DELETE', '/me/images/' + liveFile.id, undefined, galleryToken)

    await member.goto('/create')
    const assets = member.getByRole('button', { name: '资产库', exact: true })
    await expect(assets).toBeVisible()
    const theme = member.getByRole('button', { name: '切换深色主题', exact: true })
    if (await theme.isVisible()) await theme.click()
    await expect(member.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(searchTasks).toBeDisabled()
    const assetRequests: string[] = []
    const captureAsset = (request: import('@playwright/test').Request) => {
      if (request.url().includes('/api/v1/files/'))
        assetRequests.push(new URL(request.url()).pathname)
    }
    member.on('request', captureAsset)
    await assets.click()
    const assetPanel = member.getByRole(mobile ? 'dialog' : 'complementary', {
      name: '资产库',
      exact: true,
    })
    const tile = assetPanel.getByRole('button', { name: '预览图片', exact: true }).first()
    await expect(tile).toBeVisible()
    const assetNextPage = member.waitForResponse((response) => {
      const url = new URL(response.url())
      return (
        url.pathname.endsWith('/api/v1/me/images') &&
        url.searchParams.has('cursor') &&
        response.ok()
      )
    })
    await assetPanel.getByRole('button', { name: '加载更多', exact: true }).click()
    await assetNextPage
    await assetPanel.locator('.image-gallery-scroll').evaluate((element) => {
      element.scrollTop = 0
    })
    await expect(tile).toBeInViewport()
    expect(assetRequests.length).toBeGreaterThan(0)
    expect(assetRequests.every((url) => url.endsWith('/thumb'))).toBe(true)
    expect(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
    await member.screenshot({
      path: info.outputPath('image-workspace-assets.png'),
      animations: 'disabled',
    })
    await tile.focus()
    await member.keyboard.press('Enter')
    const assetPreview = member.getByRole('dialog', { name: '预览图片', exact: true })
    await expect(assetPreview.getByRole('img')).toBeVisible()
    await expect(assetPreview.getByRole('button', { name: '下载原图' })).toBeVisible()
    await expect(assetPreview.getByRole('button', { name: '擦除', exact: true })).toBeVisible()
    await expect(assetPreview.getByText(modelName, { exact: false }).first()).toBeVisible()
    expect(assetRequests.some((url) => !url.endsWith('/thumb'))).toBe(true)
    const detailsTrigger = assetPreview.getByRole('button', { name: '任务详情', exact: true })
    await detailsTrigger.click()
    const assetTaskDetails = member.getByRole('dialog', { name: '任务详情', exact: true })
    await expect(assetTaskDetails.getByText(modelName, { exact: false })).toBeVisible()
    await expect(
      assetTaskDetails.getByRole('button', { name: '重新编辑', exact: true }),
    ).toBeEnabled()
    await expect(
      assetTaskDetails.getByRole('button', { name: '重新生成', exact: true }),
    ).toBeEnabled()
    await member.keyboard.press('Escape')
    await expect(detailsTrigger).toBeFocused()
    await member.keyboard.press('Escape')
    await expect(assetPreview).toHaveCount(0)
    await expect(tile).toBeFocused()
    await member.keyboard.press('Escape')
    await expect(assetPanel).toHaveCount(0)
    await expect(assets).toBeFocused()
    member.off('request', captureAsset)

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
    const beforeRefund = await api('GET', '/me/credits', undefined, memberToken)
    const refundable = parseTask(await api('GET', '/admin/image-tasks/' + firstID))
    expect(refundable.actual_cost).toBeGreaterThan(0)
    await page.goto('/admin/image-tasks')
    await page.getByLabel('用户 ID', { exact: true }).fill(String(memberUser.id))
    await page.getByRole('button', { name: '筛选', exact: true }).click()
    await page
      .getByRole('row')
      .filter({ hasText: firstID })
      .getByRole('button', { name: '任务详情', exact: true })
      .click()
    await page
      .getByRole('dialog', { name: '任务详情', exact: true })
      .getByRole('button', { name: '手动退还剩余费用', exact: true })
      .click()
    const refundDialog = page.getByRole('dialog', { name: '手动退还剩余费用', exact: true }),
      refundNote = 'React manual refund ' + randomUUID()
    await refundDialog.getByLabel('操作备注', { exact: true }).fill(refundNote)
    let refundDropped = false,
      refundCalls = 0
    await page.route('**/api/v1/admin/image-tasks/' + firstID + '/refund', async (route) => {
      refundCalls++
      const response = await route.fetch()
      if (response.ok() && !refundDropped) {
        refundDropped = true
        await route.abort('failed')
      } else await route.fulfill({ response })
    })
    await refundDialog.getByRole('button', { name: '确认操作', exact: true }).click()
    await expect(refundDialog.getByRole('alert')).toContainText('网络')
    await refundDialog.getByRole('button', { name: '确认操作', exact: true }).click()
    await expect(refundDialog).not.toBeVisible()
    await expect(page.getByRole('button', { name: '手动退还剩余费用', exact: true })).toHaveCount(0)
    expect(refundCalls).toBe(2)
    await page.unroute('**/api/v1/admin/image-tasks/' + firstID + '/refund')
    const afterRefund = await api('GET', '/me/credits', undefined, memberToken)
    expect(afterRefund.total).toBe(Number(beforeRefund.total) + refundable.actual_cost)
    const refunded = parseTask(await api('GET', '/admin/image-tasks/' + firstID))
    expect(refunded.actual_cost).toBe(0)
    expect(refunded.refunded_cost).toBe(refunded.total_cost)
    const refundAudit = await api(
      'GET',
      '/admin/audit-logs?target_id=' + firstID + '&action=image.refund',
    )
    if (!Array.isArray(refundAudit.items)) throw new Error('Missing real refund audit')
    expect(refundAudit.items).toHaveLength(1)

    await member.getByRole('button', { name: '切换浅色主题', exact: true }).click()
    await bounded.first().getByRole('button', { name: '预览图片', exact: true }).click()
    const galleryEditor = member.getByRole('dialog', { name: '预览图片', exact: true })
    await expect(galleryEditor.getByRole('img')).toBeVisible()
    await galleryEditor.getByRole('button', { name: '调整大小', exact: true }).click()
    const ratios = galleryEditor.getByRole('menu', { name: '调整大小' })
    await expect(ratios.getByRole('menuitem')).toHaveCount(2)
    await ratios.getByRole('menuitem', { name: '正方形 1:1' }).click()
    await expect(galleryEditor.getByRole('button', { name: '调整大小 1:1' })).toBeVisible()
    await galleryEditor.getByRole('button', { name: '添加评论', exact: true }).click()
    const galleryOverlay = galleryEditor.locator('[data-slot="image-editor-overlay"]')
    if (mobile) await galleryOverlay.tap()
    else await galleryOverlay.click()
    await galleryEditor.getByLabel('添加评论', { exact: true }).fill('将此处改成浅蓝色')
    await galleryEditor.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(galleryEditor.getByText(/预计 \d+ 积分/)).toBeVisible()
    const editorPlanning = galleryEditor.getByLabel('规划强度', { exact: true })
    await expect(editorPlanning).toHaveValue('')
    await editorPlanning.selectOption('medium')
    await member.screenshot({
      path: info.outputPath('image-editor-light.png'),
      animations: 'disabled',
    })
    const requests: { key?: string; body: string | null }[] = []
    await member.route('**/api/v1/image-tasks', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const key = route.request().headers()['idempotency-key']
      requests.push({ ...(key ? { key } : {}), body: route.request().postData() })
      const response = await route.fetch()
      if (requests.length === 1 && response.ok()) await route.abort('failed')
      else await route.fulfill({ response })
    })
    await galleryEditor.getByRole('button', { name: '提交改图', exact: true }).click()
    await expect(galleryEditor.getByRole('alert')).toContainText('网络')
    await galleryEditor.getByRole('button', { name: '重试', exact: true }).click()
    await expect(member).toHaveURL(/\/create\/[0-9a-f-]+$/)
    await expect(member.locator('.image-task .image-status')).toHaveText('已完成', {
      timeout: 20_000,
    })
    expect(requests).toHaveLength(2)
    expect(requests[0]?.key).toBeTruthy()
    expect(requests[1]).toEqual(requests[0])
    expect(JSON.parse(requests[0]?.body ?? '{}')).toMatchObject({
      n: 1,
      edit_options: { action: 'markup', guide_file_id: expect.any(String) },
      complexity: 'medium',
    })
    await member.unroute('**/api/v1/image-tasks')

    const imageCatalog = '**/api/v1/models?type=image'
    await member.route(imageCatalog, async (route) => {
      const response = await route.fetch()
      const data = record(await response.json())
      if (!Array.isArray(data.items)) throw new Error('Missing image models')
      const items: unknown[] = data.items
      await route.fulfill({
        response,
        json: {
          ...data,
          items: items.map((item) => {
            const model = record(item)
            return {
              ...model,
              capabilities: {
                ...record(model.capabilities),
                supports_edit: false,
                max_reference_images: 0,
              },
            }
          }),
        },
      })
    })
    await member.goto('/create')
    const sketchTrigger = member.getByRole('button', { name: '绘制草图', exact: true })
    await expect(member.getByRole('button', { name: '选择模型', exact: true })).toContainText(
      modelName,
    )
    await expect(sketchTrigger).toBeDisabled()
    await member.unroute(imageCatalog)
    await member.route('**/api/v1/image-options', async (route) => {
      const response = await route.fetch()
      await route.fulfill({
        response,
        json: { ...record(await response.json()), max_references: 1 },
      })
    })
    await member.goto('/create')
    if (mobile) await member.getByRole('button', { name: '生图参数', exact: true }).click()
    const format = parameters.getByLabel('输出格式', { exact: true })
    await expect(format).toHaveValue('auto')
    await expect(planning).toHaveValue('')
    await planning.selectOption('high')
    await format.selectOption('gif')
    await expect(format).toHaveValue('gif')
    await format.selectOption('auto')
    await parameters.getByRole('radio', { name: '4:3', exact: true }).check()
    await expect(resolution).toHaveValue('1024x768')
    await parameters.getByRole('radio', { name: '1 张', exact: true }).check()
    await member.keyboard.press('Escape')
    const sketch = await openSketch(member, 'reference')
    await member.keyboard.press('Escape')
    await expect(sketch.dialog).toBeHidden()
    await expect(sketch.trigger).toBeFocused()
    await sketch.trigger.click()
    await drawStroke(member, sketch.paper, mobile)
    await expect(sketch.confirm).toBeEnabled()
    await member.keyboard.press('Control+Z')
    await expect(sketch.confirm).toBeDisabled()
    await member.keyboard.press('Control+Shift+Z')
    await expect(sketch.confirm).toBeEnabled()
    if (!mobile) {
      const paperSize = await sketch.paper.boundingBox()
      if (!paperSize) throw new Error('Missing paper bounds')
      const sampleInk = (x: number, y: number) =>
        sketch.paper.evaluate(
          (canvas, [x, y]) => {
            if (!(canvas instanceof HTMLCanvasElement)) return false
            return canvas
              .getContext('2d')
              ?.getImageData(x - 2, y - 2, 5, 5)
              .data.some((value, index) => index % 4 === 3 && value > 0)
          },
          [x, y] as const,
        )
      await expect.poll(() => sampleInk(512, 427)).toBe(true)
      await sketch.dialog.getByRole('button', { name: '橡皮擦', exact: true }).click()
      await sketch.paper.click({
        position: { x: paperSize.width / 2, y: (paperSize.height * 5) / 12 },
      })
      await expect.poll(() => sampleInk(512, 427)).toBe(false)
      await expect.poll(() => sampleInk(256, 256)).toBe(true)
      await sketch.dialog.getByRole('button', { name: '文字', exact: true }).click()
      await sketch.paper.click({ position: { x: paperSize.width / 4, y: paperSize.height / 2 } })
      await sketch.dialog.getByRole('textbox', { name: '文字', exact: true }).fill('草图备注')
      await sketch.dialog.getByRole('button', { name: '保存修改', exact: true }).click()
      await sketch.dialog.getByRole('button', { name: '选择和移动', exact: true }).click()
      await sketch.paper.focus()
      await member.keyboard.press('BracketLeft')
      await member.keyboard.press('ArrowRight')
      await member.keyboard.press('Enter')
      await expect(sketch.dialog.getByRole('textbox', { name: '文字', exact: true })).toHaveValue(
        '草图备注',
      )
      await member.keyboard.press('Escape')

      const initialViewport = member.viewportSize()
      if (!initialViewport) throw new Error('Missing desktop viewport')
      await member.setViewportSize({ ...initialViewport, width: 1000 })
      await expect(sketch.confirm).toBeEnabled()
      await expect.poll(() => sampleInk(256, 256)).toBe(true)
      await member.setViewportSize(initialViewport)
    }
    await sketch.dialog.getByRole('button', { name: '形状', exact: true }).click()
    await expect(sketch.dialog.getByRole('menuitem')).toHaveCount(8)
    await sketch.dialog.getByRole('menuitem', { name: '星形', exact: true }).click()
    await drawStroke(member, sketch.paper, mobile)

    let attempts = 0
    await member.route('**/api/v1/files*', async (route) => {
      if (isSketchUpload(route.request().url(), route.request().method()) && ++attempts === 1)
        await route.fulfill({ status: 503, json: { code: 'TEMPORARILY_UNAVAILABLE' } })
      else await route.continue()
    })
    await sketch.confirm.click({ clickCount: 2 })
    await expect(sketch.dialog).toBeHidden()
    const retrySketch = member.getByRole('button', { name: '重试上传', exact: true })
    await expect(retrySketch).toBeVisible()
    expect(attempts).toBe(1)
    const uploadedSketch = member.waitForResponse(
      (response) =>
        isSketchUpload(response.url(), response.request().method()) && response.status() === 201,
    )
    await retrySketch.click()
    const sketchFile = record(await (await uploadedSketch).json())
    expect(sketchFile).toMatchObject({ id: expect.any(String), width: 1024, height: 1024 })
    await expect(member.locator('.image-references img')).toHaveCount(1)
    await expect(sketchTrigger).toBeDisabled()
    await member.unroute('**/api/v1/files*')
    await prompt.fill('使用参考图，生成角色自拍比耶的 GIF 动图')
    const gifSubmission = member.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/image-tasks') && response.request().method() === 'POST',
    )
    await send.click()
    const animatedTask = parseTask(await (await gifSubmission).json())
    expect(animatedTask).toMatchObject({
      operation: 'edit',
      ratio: '4:3',
      output_format: 'gif',
      complexity: 'high',
      reference_file_ids: [sketchFile.id],
    })
    const gifCard = member.locator('.image-task').first()
    await expect(gifCard.locator('.image-status')).toHaveText('已完成', { timeout: 20_000 })
    await gifCard.getByRole('button', { name: '预览图片 1', exact: true }).click()
    const gifPreview = member.getByRole('dialog', { name: '预览图片', exact: true })
    const animatedImage = gifPreview.getByRole('img')
    await expect(animatedImage).toBeVisible()
    await expect
      .poll(() => animatedImage.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBe(4)
    const firstFrame = await animatedImage.screenshot()
    await expect
      .poll(async () => (await animatedImage.screenshot()).equals(firstFrame), {
        intervals: [80, 140, 220, 300],
      })
      .toBe(false)
    const gifDownload = member.waitForEvent('download')
    await gifPreview.getByRole('button', { name: '下载原图', exact: true }).click()
    const savedGIF = await gifDownload
    expect(savedGIF.suggestedFilename()).toMatch(/\.gif$/)
    expect(await readFile(await savedGIF.path())).toEqual(gif)
    await gifPreview.getByRole('button', { name: '复制图片', exact: true }).click()
    await expect(gifPreview.getByRole('button', { name: '图片已复制', exact: true })).toBeVisible()
    await member.keyboard.press('Escape')
    await gifCard
      .getByTestId('image-task-top-actions')
      .getByRole('button', { name: '使用相同参数', exact: true })
      .click()
    if (mobile) await member.getByRole('button', { name: '生图参数', exact: true }).click()
    await expect(format).toHaveValue('gif')
    await expect(planning).toHaveValue('high')
    expect(upstreamPlanning.has('partial')).toBe(true)
    expect(upstreamPlanning.get('partial')).toBeUndefined()
    expect(upstreamPlanning.get('使用参考图，生成角色自拍比耶的 GIF 动图')).toBe('high')
    expect([...upstreamPlanning.entries()]).toContainEqual([
      expect.stringContaining('将此处改成浅蓝色'),
      'medium',
    ])
    expect(errors).toEqual([])
  } finally {
    await memberContext.close()
    if (oldPricing) await api('PUT', '/admin/pricing', oldPricing)
    if (oldSettings) {
      const latest = parseImageConfiguration(await api('GET', '/admin/image-settings'))
      await api('PUT', '/admin/image-settings', { ...oldSettings, version: latest.version })
    }
    if (channelID) await api('DELETE', '/admin/upstreams/' + channelID)
    if (alternateModelID) await api('DELETE', '/admin/models/' + alternateModelID)
    if (modelID) await api('DELETE', '/admin/models/' + modelID)
    if (chatModelID) await api('DELETE', '/admin/models/' + chatModelID)
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  }
})
