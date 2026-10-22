import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { deflateSync } from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'
import { record } from '../src/api/transport'
import { defaultCapabilities } from '../src/api/catalog-contracts'
import { parseTask, parseImageConfiguration } from '../src/api/images'
import { observeErrors } from './browser-errors'
// A deterministic PNG fixture exercises decoding, normalization and real WebP thumbnails.
function fixturePNG() {
  const width = 900,
    height = 600,
    pixels = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = y * (width * 3 + 1) + x * 3 + 1
      pixels[at] = 30 + Math.floor((x / width) * 110)
      pixels[at + 1] = 35 + Math.floor((y / height) * 100)
      pixels[at + 2] = 135 + Math.floor((x / width) * 90)
    }
  function chunk(name: string, data: Buffer) {
    const tag = Buffer.from(name),
      input = Buffer.concat([tag, data])
    let crc = 0xffffffff
    for (const byte of input) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    const length = Buffer.alloc(4),
      checksum = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([length, input, checksum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
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
test('M5 real image generation editing gallery cancellation and administrator privacy', async ({
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
  })
  const member = await memberContext.newPage()
  observeErrors(page, errors)
  observeErrors(member, errors)
  let adminToken = '',
    modelID = '',
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
    const memberUser = await api('POST', '/admin/users', {
      email: memberEmail,
      password,
      nickname: 'Image member',
      role: 'user',
      initial_credits: 10000,
    })
    const memberToken = await login(member, memberEmail, password)
    await member.goto('/create')
    await expect(member.getByRole('button', { name: '选择模型', exact: true })).toContainText(
      modelName,
    )
    const prompt = member.getByLabel('画面描述', { exact: true }),
      send = member.getByRole('button', { name: '开始生成', exact: true })
    await expect(member.getByLabel('质量', { exact: true })).toHaveValue('medium')
    expect(await member.getByLabel('质量', { exact: true }).locator('option').count()).toBe(1)
    await member.getByLabel('比例', { exact: true }).selectOption('3:2')
    await expect(member.getByLabel('尺寸', { exact: true })).toHaveValue('1536x1024')
    await member.getByLabel('尺寸', { exact: true }).selectOption('1024x1024')
    await expect(member.getByLabel('比例', { exact: true })).toHaveValue('')
    await member.getByLabel('张数', { exact: true }).selectOption('2')
    await prompt.fill('partial')
    const keys: string[] = []
    let dropped = false
    await member.route('**/api/v1/image-tasks', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue()
        return
      }
      keys.push(route.request().headers()['idempotency-key'] ?? '')
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
    await expect(member).toHaveURL(/\/create\/[a-f0-9-]+$/)
    const conversationURL = member.url()
    const task = member.locator('.image-task').first()
    await expect(task.locator('.image-status')).toHaveText('部分完成', { timeout: 20_000 })
    await expect(task).toContainText('实际 10 积分')
    await expect(task).toContainText('已退 10 积分')
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[0]).toBe(keys[1])
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
    await member.getByLabel('张数', { exact: true }).selectOption('1')
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
    await page.goto('/admin/image-tasks')
    await page.getByLabel('用户 ID', { exact: true }).fill(String(memberUser.id))
    await page.getByRole('button', { name: '筛选', exact: true }).click()
    await page
      .getByRole('row')
      .filter({ hasText: firstID })
      .getByRole('button', { name: '任务详情', exact: true })
      .click()
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
    await page.getByLabel('允许管理员查看提示词、参考图与结果', { exact: true }).check()
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('生图设置已保存')
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
    let lastTaskID = ''
    for (let index = 0; index < 15; index++) {
      const row = await api(
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
      lastTaskID = String(row.id)
    }
    await expect
      .poll(
        async () =>
          (await api('GET', '/image-tasks/' + lastTaskID, undefined, galleryToken)).status,
        { timeout: 60_000, intervals: [500] },
      )
      .toBe('succeeded')
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
    expect(await bounded.count()).toBeLessThan(info.project.name === 'mobile' ? 12 : 30)
    expect(requested.length).toBeGreaterThan(0)
    expect(requested.every((url) => url.includes('/thumb?'))).toBe(true)
    expect(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
    await member.screenshot({
      path: info.outputPath('image-gallery-virtualized.png'),
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
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  }
})
