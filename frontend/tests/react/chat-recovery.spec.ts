import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { record } from '../../src/api/transport'
import { parseAuth, parseUser } from '../../src/api/contracts'
import { parseFile } from '../../src/api/images'
import { defaultCapabilities } from '../../src/api/catalog-contracts'
import { observeErrors } from '../browser-errors'
import { fixturePNG } from '../image-fixture'

test('real vision, IME, protected blobs, reload and cursor replay survive a browser reader failure', async ({
  page,
  request,
  baseURL,
}, info) => {
  if (!baseURL || !process.env.E2E_ADMIN_EMAIL || !process.env.E2E_ADMIN_PASSWORD)
    throw new Error('Real administrator fixture is required')
  const errors: string[] = []
  observeErrors(page, errors)
  const password = randomBytes(18).toString('base64url') + 'Aa1'
  const suffix = randomUUID().slice(0, 8),
    key = randomBytes(24).toString('base64url')
  const releases = new Map<string, () => void>(),
    calls = new Map<string, number>()
  let visionSeen = false
  const server = createServer(async (incoming, response) => {
    if (incoming.headers.authorization !== 'Bearer ' + key) {
      response.writeHead(401)
      response.end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of incoming)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
    const body = record(JSON.parse(Buffer.concat(chunks).toString()) as unknown)
    if (!Array.isArray(body.messages)) {
      response.writeHead(400)
      response.end()
      return
    }
    const messages = body.messages.map(record)
    response.setHeader('Content-Type', 'text/event-stream')
    response.flushHeaders()
    const delta = (content: string) =>
      response.write('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n')
    const done = () =>
      response.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
    if (typeof messages[0]?.content === 'string' && messages[0].content.startsWith('Return only')) {
      delta('恢复验收')
      done()
      return
    }
    const content = messages.at(-1)?.content
    const parts = Array.isArray(content) ? content.map(record) : []
    const prompt =
      typeof content === 'string' ? content : parts.find((part) => part.type === 'text')?.text
    if (typeof prompt !== 'string') {
      done()
      return
    }
    if (
      parts.some(
        (part) =>
          part.type === 'image_url' &&
          typeof part.image_url === 'object' &&
          part.image_url !== null &&
          'url' in part.image_url &&
          typeof part.image_url.url === 'string' &&
          part.image_url.url.startsWith('data:image/png;base64,'),
      )
    )
      visionSeen = true
    calls.set(prompt, (calls.get(prompt) ?? 0) + 1)
    delta('Start ' + prompt + ' ')
    releases.set(prompt, () => {
      if (response.destroyed || response.writableEnded) return
      delta('End')
      done()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No local upstream port')
  let channelID = '',
    modelID = '',
    memberID = '',
    otherID = ''
  const adminLogin = await request.post('/api/v1/auth/login', {
    data: { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD },
    headers: { 'X-Lumi-CSRF': '1', Origin: baseURL },
  })
  expect(adminLogin.ok()).toBe(true)
  const admin = parseAuth(await adminLogin.json())
  const headers = {
    Authorization: 'Bearer ' + admin.access_token,
    'X-Lumi-CSRF': '1',
    Origin: baseURL,
  }
  async function api(method: string, path: string, body?: unknown) {
    const result = await request.fetch('/api/v1' + path, {
      method,
      headers,
      ...(body !== undefined ? { data: body } : {}),
    })
    expect(result.ok(), path + ' status ' + result.status()).toBe(true)
    return result.status() === 204 ? {} : record(await result.json())
  }
  try {
    const channel = await api('POST', '/admin/upstreams', {
      version: 0,
      name: 'Recovery ' + suffix,
      base_url: `http://127.0.0.1:${address.port}/v1`,
      api_key: key,
      timeout_chat_s: 30,
      timeout_image_s: 30,
      proxy_url: '',
      enabled: true,
      priority: 0,
      weight: 1,
      edit_format: 'multipart',
      note: '',
    })
    if (typeof channel.id !== 'string') throw new Error('No channel ID')
    channelID = channel.id
    const model = await api('POST', '/admin/models', {
      version: 0,
      display_name: 'Vision ' + suffix,
      type: 'chat',
      description: '',
      icon: '',
      sort_order: 0,
      enabled: true,
      is_default: true,
      capabilities: { ...defaultCapabilities('chat'), vision: true, max_context_tokens: 32768 },
      routes: [
        {
          upstream_id: channelID,
          upstream_model_name: 'vision-fixture',
          priority: 0,
          weight: 1,
          enabled: true,
        },
      ],
    })
    if (typeof model.id !== 'string') throw new Error('No model ID')
    modelID = model.id
    const email = `vision-${suffix}@lumi.test`
    memberID = parseUser(
      await api('POST', '/admin/users', {
        email,
        password,
        nickname: '视觉验收',
        role: 'user',
        initial_credits: 0,
      }),
    ).id
    const otherEmail = `other-vision-${suffix}@lumi.test`
    otherID = parseUser(
      await api('POST', '/admin/users', {
        email: otherEmail,
        password,
        nickname: 'Other',
        role: 'user',
        initial_credits: 0,
      }),
    ).id
    await page.addInitScript(() => {
      const live = new Set<string>(),
        create = URL.createObjectURL.bind(URL),
        revoke = URL.revokeObjectURL.bind(URL)
      URL.createObjectURL = (blob) => {
        const url = create(blob)
        live.add(url)
        return url
      }
      URL.revokeObjectURL = (url) => {
        live.delete(url)
        revoke(url)
      }
      ;(window as Window & { lumiLiveBlobs?: () => number }).lumiLiveBlobs = () => live.size
    })
    await page.goto('/login')
    await page.getByLabel('邮箱地址', { exact: true }).fill(email)
    await page.getByLabel('密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '进入 Lumi', exact: true }).click()
    await expect(page).toHaveURL(/\/chat$/)
    await expect(page.getByRole('button', { name: '选择模型', exact: true })).toContainText(
      'Vision ' + suffix,
    )
    const input = page.getByLabel('消息内容', { exact: true })
    await input.fill('输入法草稿')
    await input.dispatchEvent('compositionstart')
    await input.dispatchEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 229,
      isComposing: true,
    })
    await expect(input).toHaveValue('输入法草稿')
    expect(calls.size).toBe(0)
    await input.dispatchEvent('compositionend')
    const upload = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/files',
    )
    await page
      .getByLabel('添加图片', { exact: true })
      .setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: fixturePNG() })
    const uploaded = await upload
    expect(uploaded.ok()).toBe(true)
    const file = parseFile(await uploaded.json())
    await expect(page.locator('.chat-composer img[src^="blob:"]')).toBeVisible()
    await page
      .getByRole('navigation', { name: '创作模式' })
      .getByRole('link', { name: '生图', exact: true })
      .click()
    await page
      .getByRole('navigation', { name: '创作模式' })
      .getByRole('link', { name: '聊天', exact: true })
      .click()
    await expect(input).toHaveValue('输入法草稿')
    await expect(page.locator('.chat-composer img[src^="blob:"]')).toBeVisible()
    const otherLogin = await request.post('/api/v1/auth/login', {
      data: { email: otherEmail, password },
      headers: { 'X-Lumi-CSRF': '1', Origin: baseURL },
    })
    expect(otherLogin.ok()).toBe(true)
    const other = parseAuth(await otherLogin.json())
    expect(
      (
        await request.get('/api/v1/files/' + file.id + '/metadata', {
          headers: { Authorization: 'Bearer ' + other.access_token },
        })
      ).status(),
    ).toBe(404)
    expect((await request.get(file.url)).status()).toBe(401)
    await input.fill('视觉验收')
    await input.press('Shift+Enter')
    await expect(input).toHaveValue('视觉验收\n')
    expect(calls.size).toBe(0)
    await input.fill('视觉验收')
    await input.press('Enter')
    const answer = page.locator('.chat-message-assistant').last()
    await expect(answer).toContainText('Start 视觉验收')
    expect(visionSeen).toBe(true)
    releases.get('视觉验收')?.()
    await expect(answer.getByRole('button', { name: '重新生成', exact: true })).toBeEnabled()
    await expect(page.locator('.chat-message-user img[src^="blob:"]')).toBeVisible()
    expect(calls.get('视觉验收')).toBe(1)
    await input.fill('刷新恢复')
    await input.press('Enter')
    await expect(answer).toContainText('Start 刷新恢复')
    let injectedRotation = false
    await page.route(
      '**/api/v1/files/*/metadata',
      async (route) => {
        injectedRotation = true
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'AUTH_REQUIRED', request_id: 'test-session-rotation' }),
        })
      },
      { times: 1 },
    )
    const rotated = page.waitForResponse(
      (response) => injectedRotation && response.url().endsWith('/api/v1/auth/refresh'),
    )
    const replay = page.waitForRequest(
      (incoming) => incoming.url().includes('/events?request_id=') && incoming.method() === 'GET',
    )
    await page.reload()
    await replay
    expect((await rotated).ok()).toBe(true)
    await expect(page.locator('.chat-message-user img[src^="blob:"]')).toBeVisible()
    await expect(answer).toContainText('Start 刷新恢复')
    expect(calls.get('刷新恢复')).toBe(1)
    releases.get('刷新恢复')?.()
    await expect(answer.getByRole('button', { name: '重新生成', exact: true })).toBeEnabled()
    await expect(answer.locator('.chat-markdown')).toHaveText('Start 刷新恢复 End')
    // Fail only the browser reader after real SSE data arrives; replay still reaches the real backend.
    await page.evaluate(() => {
      const native = window.fetch.bind(window)
      window.fetch = async (url, init) => {
        const response = await native(url, init)
        if (init?.method !== 'POST' || !String(url).endsWith('/messages') || !response.body)
          return response
        window.fetch = native
        const reader = response.body.getReader()
        let failed = false,
          sink: ReadableStreamDefaultController<Uint8Array> | undefined
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            sink = controller
          },
          async pull(controller) {
            try {
              const chunk = await reader.read()
              if (!failed) {
                if (chunk.done) controller.close()
                else controller.enqueue(chunk.value)
              }
            } catch (failure) {
              if (!failed) controller.error(failure)
            }
          },
          cancel: () => reader.cancel(),
        })
        ;(window as Window & { lumiCutReader?: () => Promise<void> }).lumiCutReader = async () => {
          failed = true
          sink?.error(new TypeError('Injected reader disconnect'))
          await reader.cancel()
        }
        return new Response(body, { status: response.status, headers: response.headers })
      }
    })
    await input.fill('断线恢复')
    await input.press('Enter')
    await expect(answer).toContainText('Start 断线恢复')
    const resumed = page.waitForRequest(
      (incoming) => incoming.url().includes('/events?request_id=') && incoming.method() === 'GET',
    )
    await page.evaluate(async () => {
      const cut = (window as Window & { lumiCutReader?: () => Promise<void> }).lumiCutReader
      if (!cut) throw new Error('No captured reader')
      await cut()
    })
    expect((await resumed).headers()['last-event-id']).toMatch(/^\d+-\d+$/)
    releases.get('断线恢复')?.()
    await expect(answer.getByRole('button', { name: '重新生成', exact: true })).toBeEnabled()
    await expect(answer.locator('.chat-markdown')).toHaveText('Start 断线恢复 End')
    expect(calls.get('断线恢复')).toBe(1)
    for (const format of ['JSON', 'Markdown']) {
      await page.locator('.chat-current-title').getByRole('button').click()
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('menuitem', { name: '导出聊天 ' + format, exact: true }).click(),
      ])
      const path = await download.path()
      if (!path) throw new Error('No export artifact')
      const exported = await readFile(path, 'utf8')
      expect(exported).toContain('视觉验收')
      expect(exported).not.toContain(key)
    }
    await page.screenshot({
      path: info.outputPath('chat-vision-recovery.png'),
      animations: 'disabled',
    })
    if (!(await page.getByRole('button', { name: '打开账户菜单' }).isVisible()))
      await page.getByRole('button', { name: '打开导航菜单' }).click()
    await page.getByRole('button', { name: '打开账户菜单' }).click()
    await page.getByRole('menuitem', { name: '退出登录', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as Window & { lumiLiveBlobs?: () => number }).lumiLiveBlobs?.(),
        ),
      )
      .toBe(0)
    expect(errors).toEqual([])
  } finally {
    for (const release of releases.values()) release()
    try {
      if (channelID) await api('DELETE', '/admin/upstreams/' + channelID)
      if (modelID) await api('DELETE', '/admin/models/' + modelID)
      if (memberID)
        await api('DELETE', '/admin/users/' + memberID, { email: `vision-${suffix}@lumi.test` })
      if (otherID)
        await api('DELETE', '/admin/users/' + otherID, {
          email: `other-vision-${suffix}@lumi.test`,
        })
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  }
})
