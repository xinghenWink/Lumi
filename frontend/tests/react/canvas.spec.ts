import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { APIRequestContext, Locator } from '@playwright/test'
import { expect, test, type Page } from './test'
import { record } from '../../src/api/transport'
import { defaultCapabilities } from '../../src/api/catalog-contracts'
import { parseImageConfiguration } from '../../src/api/images'
import { observeErrors } from '../browser-errors'
import { fixturePNG } from '../image-fixture'

interface Caller {
  (method: string, path: string, body?: unknown): Promise<Record<string, unknown>>
  status(method: string, path: string): Promise<number>
}

function caller(request: APIRequestContext, origin: string, token: string): Caller {
  const send = (method: string, path: string, body?: unknown) =>
    request.fetch('/api/v1' + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, 'X-Lumi-CSRF': '1', Origin: origin },
      ...(body === undefined ? {} : { data: body }),
    })
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await send(method, path, body)
    expect(response.ok(), method + ' ' + path + ' status ' + response.status()).toBe(true)
    return response.status() === 204 ? {} : record(await response.json())
  }
  return Object.assign(call, {
    status: async (method: string, path: string) => (await send(method, path)).status(),
  })
}

async function administrator(request: APIRequestContext, origin: string) {
  const email = process.env.E2E_ADMIN_EMAIL,
    password = process.env.E2E_ADMIN_PASSWORD
  if (!email || !password) throw new Error('Missing journey administrator')
  const response = await request.post('/api/v1/auth/login', {
    headers: { 'X-Lumi-CSRF': '1', Origin: origin },
    data: { email, password },
  })
  expect(response.ok(), 'Administrator login status ' + response.status()).toBe(true)
  const token = record(await response.json()).access_token
  if (typeof token !== 'string') throw new Error('Missing administrator token')
  return caller(request, origin, token)
}

async function createMember(admin: Caller, credits: number) {
  const email = 'canvas-' + randomUUID().slice(0, 8) + '@lumi.test',
    password = randomBytes(18).toString('base64url') + 'Aa1'
  await admin('POST', '/admin/users', {
    email,
    password,
    nickname: 'Canvas member',
    role: 'user',
    initial_credits: credits,
  })
  return { email, password }
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

async function box(locator: Locator) {
  const value = await locator.boundingBox()
  if (!value) throw new Error('Element has no box')
  return value
}

const center = (value: { x: number; y: number; width: number; height: number }) => ({
  x: value.x + value.width / 2,
  y: value.y + value.height / 2,
})

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
}

async function noHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const main = document.querySelector('main')
        return Math.max(
          document.documentElement.scrollWidth - window.innerWidth,
          main ? main.scrollWidth - main.clientWidth : 0,
        )
      }),
    )
    .toBeLessThanOrEqual(0)
}

function canvasLocators(page: Page) {
  const viewport = page.getByTestId('canvas-viewport')
  return {
    viewport,
    nodes: (kind?: string) => viewport.locator(kind ? `[data-kind="${kind}"]` : '[data-node-id]'),
    edges: viewport.locator('[data-edge-id]'),
    saveState: page.getByTestId('canvas-save-state'),
  }
}

test('canvas journey composes, generates from references, persists and edits', async ({
  page,
  request,
  baseURL,
}, info) => {
  test.skip(info.project.name !== 'chrome-desktop', 'Small screens run their own canvas check.')
  test.setTimeout(240_000)
  if (!baseURL || !process.env.E2E_DATABASE_URL) throw new Error('M8 requires real dependencies')
  const errors: string[] = []
  observeErrors(page, errors)
  const suffix = randomUUID().slice(0, 8),
    key = randomBytes(24).toString('base64url'),
    png = fixturePNG()
  const wire = 'canvas-image-' + suffix,
    modelName = 'Canvas Image ' + suffix
  const upstream = { generations: 0, edits: 0, referenced: false, prompts: [] as string[] }
  const server = createServer(async (incoming, response) => {
    if (incoming.headers.authorization !== 'Bearer ' + key) {
      response.writeHead(401)
      response.end()
      return
    }
    if (incoming.url === '/v1/models') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ data: [{ id: wire }] }))
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of incoming)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
    const raw = Buffer.concat(chunks)
    let count = 1
    if (incoming.url === '/v1/images/edits') {
      upstream.edits++
      upstream.referenced = raw.includes(Buffer.from([137, 80, 78, 71]))
      upstream.prompts.push(raw.toString('utf8').match(/name="prompt"\r\n\r\n([^\r]*)/)?.[1] ?? '')
    } else if (incoming.url === '/v1/images/generations') {
      upstream.generations++
      const input = record(JSON.parse(raw.toString('utf8')) as unknown)
      upstream.prompts.push(String(input.prompt))
      count = Number(input.n) || 1
    } else {
      response.writeHead(404)
      response.end()
      return
    }
    response.setHeader('Content-Type', 'application/json')
    response.end(
      JSON.stringify({
        data: Array.from({ length: count }, () => ({ b64_json: png.toString('base64') })),
      }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const admin = await administrator(request, baseURL)
  let channelID = '',
    modelID = ''
  let oldPricing: Record<string, unknown> | undefined,
    oldSettings: ReturnType<typeof parseImageConfiguration> | undefined
  try {
    channelID = String(
      (
        await admin('POST', '/admin/upstreams', {
          version: 0,
          name: 'Canvas fixture ' + suffix,
          base_url: 'http://127.0.0.1:' + address.port + '/v1',
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
      ).id,
    )
    modelID = String(
      (
        await admin('POST', '/admin/models', {
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
            qualities: ['medium'],
            sizes: ['1024x1024', '1536x1024'],
            max_n: 2,
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
      ).id,
    )
    oldPricing = await admin('GET', '/admin/pricing')
    if (!Array.isArray(oldPricing.rules)) throw new Error('Missing price rules')
    await admin('PUT', '/admin/pricing', {
      ...oldPricing,
      rules: [
        ...oldPricing.rules,
        ...(['generate', 'edit'] as const).map((operation) => ({
          model_id: modelID,
          operation,
          quality: 'medium',
          credits_per_image: 10,
          enabled: true,
        })),
      ],
    })
    oldSettings = parseImageConfiguration(await admin('GET', '/admin/image-settings'))
    await admin('PUT', '/admin/image-settings', {
      ...oldSettings,
      sizes: ['1024x1024', '1536x1024', 'auto'],
      ratio_sizes: { '1:1': '1024x1024', '3:2': '1536x1024' },
    })
    const member = await createMember(admin, 100)
    const memberToken = await login(page, member.email, member.password)
    const self = caller(request, baseURL, memberToken)
    const { viewport, nodes, edges, saveState } = canvasLocators(page)
    const saved = () =>
      expect(saveState).toHaveAttribute('data-status', 'saved', { timeout: 15_000 })
    const title = 'M8 旅程画布'

    // The list starts empty and creates a canvas on demand.
    await page.goto('/canvas')
    await expect(page.getByRole('heading', { name: '无限画布', exact: true })).toBeVisible()
    await expect(page.getByText('还没有画布', { exact: true }).first()).toBeVisible()
    await page.getByRole('link', { name: '新建画布', exact: true }).click()
    await expect(page).toHaveURL(/\/canvas\/[0-9a-f-]{36}$/)
    const canvasID = new URL(page.url()).pathname.split('/').pop() ?? ''
    await expect(viewport).toBeVisible()
    await page.getByLabel('画布名称', { exact: true }).fill(title)

    // Upload a reference image and add a text note on empty space.
    await page.getByTestId('canvas-upload-input').setInputFiles({
      name: 'reference.png',
      mimeType: 'image/png',
      buffer: png,
    })
    await expect(nodes('image').locator('img')).toHaveCount(1, { timeout: 20_000 })
    const stage = await box(viewport)
    await page.mouse.dblclick(stage.x + stage.width * 0.22, stage.y + stage.height * 0.78)
    const note = page.getByLabel('文本内容', { exact: true })
    await expect(note).toBeFocused()
    await note.fill('暖色水彩风格')
    await note.press('Escape')
    await expect(nodes('text')).toContainText('暖色水彩风格')

    // Generate from the selected image, then wire the note in as extra prompt text.
    await nodes('image').first().click()
    await page
      .getByRole('toolbar', { name: '选中操作' })
      .getByRole('button', { name: '生成', exact: true })
      .click()
    const inspector = page.getByTestId('canvas-inspector')
    await expect(inspector).toBeVisible()
    await expect(inspector.getByTestId('canvas-inputs')).toHaveText('1 张参考图 · 0 段文本')
    await page.getByRole('button', { name: '适配全部（1）', exact: true }).click()
    const port = nodes('text').locator('[data-handle="out"]')
    await drag(page, center(await box(port)), center(await box(nodes('generator'))))
    await expect(inspector.getByTestId('canvas-inputs')).toHaveText('1 张参考图 · 1 段文本')
    await expect(edges).toHaveCount(2)
    await inspector.getByLabel('提示词', { exact: true }).fill('canvas-journey')
    await inspector.getByLabel('模型', { exact: true }).selectOption({ label: modelName })
    const run = inspector.getByRole('button', { name: '生成', exact: true })
    await expect(run).toBeEnabled({ timeout: 15_000 })
    const estimate = inspector.getByText(/^预计 [\d,]+ 积分$/)
    const cost = Number((await estimate.textContent())?.replace(/\D/g, ''))
    expect(cost).toBeGreaterThan(0)
    const balance = Number((await self('GET', '/me/credits')).total)
    await run.click()
    await expect(nodes('image').locator('img')).toHaveCount(2, { timeout: 30_000 })
    await expect(edges).toHaveCount(3)
    expect(upstream.edits).toBe(1)
    expect(upstream.referenced).toBe(true)
    expect(upstream.prompts[0]).toContain('canvas-journey')
    expect(upstream.prompts[0]).toContain('暖色水彩风格')
    await expect
      .poll(async () => Number((await self('GET', '/me/credits')).total))
      .toBe(balance - cost)
    await saved()

    // Viewport moves save on their own slower schedule and survive a reload.
    const viewSave = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/v1/canvases/' + canvasID) &&
        r.request().method() === 'PUT' &&
        r.ok(),
    )
    await page.getByRole('button', { name: '放大', exact: true }).click()
    const zoom = page.getByRole('button', { name: /^缩放 \d+%$/ })
    const zoomLabel = await zoom.getAttribute('aria-label')
    await viewSave
    const stored = await self('GET', '/canvases/' + canvasID)
    expect(stored).toMatchObject({ title, node_count: 4 })
    await page.reload()
    await expect(nodes()).toHaveCount(4)
    await expect(edges).toHaveCount(3)
    await expect(page.getByLabel('画布名称', { exact: true })).toHaveValue(title)
    await expect(zoom).toHaveAttribute('aria-label', zoomLabel ?? '')
    await expect(nodes('image').locator('img')).toHaveCount(2)

    // Undo and redo a deletion.
    await page.keyboard.press('1')
    await nodes('text').click()
    await page.keyboard.press('Delete')
    await expect(nodes()).toHaveCount(3)
    await expect(edges).toHaveCount(2)
    await page.keyboard.press('Control+Z')
    await expect(nodes()).toHaveCount(4)
    await expect(edges).toHaveCount(3)
    await page.keyboard.press('Control+Shift+Z')
    await expect(nodes()).toHaveCount(3)
    await page.keyboard.press('Control+Z')
    await expect(nodes()).toHaveCount(4)

    // Group everything and drag the group by its frame; members follow.
    await nodes('text').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Control+G')
    await expect(nodes('group')).toHaveCount(1)
    await page.keyboard.press('1')
    const frame = await box(nodes('group'))
    const before = await box(nodes('text'))
    const grip = { x: frame.x + 6, y: frame.y + frame.height - 6 }
    await drag(page, grip, { x: grip.x + 60, y: grip.y + 40 })
    await expect
      .poll(async () => {
        const after = await box(nodes('text'))
        return [Math.round(after.x - before.x), Math.round(after.y - before.y)]
      })
      .toEqual([60, 40])

    // Copy and paste through the system clipboard format, then duplicate.
    await nodes('text').click()
    const copied = await page.evaluate(() => {
      const source = new DataTransfer()
      document.dispatchEvent(
        new ClipboardEvent('copy', { clipboardData: source, bubbles: true, cancelable: true }),
      )
      const text = source.getData('text/plain')
      const target = new DataTransfer()
      target.setData('text/plain', text)
      document.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: target, bubbles: true, cancelable: true }),
      )
      return text
    })
    expect(copied.startsWith('lumi-canvas/v1:')).toBe(true)
    await expect(nodes('text')).toHaveCount(2)
    await page.keyboard.press('Control+D')
    await expect(nodes('text')).toHaveCount(3)

    // The minimap recenters the view.
    const minimap = page.getByTestId('canvas-minimap')
    await expect(minimap).toBeVisible()
    const anchor = await box(nodes('generator'))
    await minimap.click({ position: { x: 8, y: 8 } })
    await expect.poll(async () => (await box(nodes('generator'))).x).not.toBe(anchor.x)
    await saved()

    // The list shows the cover and node count, and deleting removes the canvas.
    await page.getByRole('link', { name: '画布列表', exact: true }).click()
    await expect(page).toHaveURL(/\/canvas$/)
    const card = page.getByTestId('canvas-card').filter({ hasText: title })
    await expect(card).toContainText('7 个节点')
    await expect(card.locator('img')).toBeVisible()
    await expect(
      page.locator('.desktop-sidebar').getByRole('link', { name: title, exact: true }),
    ).toBeVisible()
    await card.getByRole('button', { name: '画布操作 · ' + title, exact: true }).click()
    await page.getByRole('menuitem', { name: '删除', exact: true }).click()
    await page.getByRole('button', { name: '删除画布', exact: true }).click()
    await expect(card).toHaveCount(0)
    expect(await self.status('GET', '/canvases/' + canvasID)).toBe(404)
    expect(errors).toEqual([])
  } finally {
    if (oldPricing) await admin('PUT', '/admin/pricing', oldPricing)
    if (oldSettings) {
      const latest = parseImageConfiguration(await admin('GET', '/admin/image-settings'))
      await admin('PUT', '/admin/image-settings', { ...oldSettings, version: latest.version })
    }
    if (channelID) await admin('DELETE', '/admin/upstreams/' + channelID)
    if (modelID) await admin('DELETE', '/admin/models/' + modelID)
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  }
})

test('canvas on small screens keeps tools reachable and pans by touch', async ({
  page,
  request,
  baseURL,
}, info) => {
  test.skip(info.project.name === 'chrome-desktop', 'Desktop runs the full canvas journey.')
  if (!baseURL || !process.env.E2E_DATABASE_URL) throw new Error('M8 requires real dependencies')
  const errors: string[] = []
  observeErrors(page, errors)
  const admin = await administrator(request, baseURL)
  const member = await createMember(admin, 0)
  await login(page, member.email, member.password)
  const { viewport, nodes } = canvasLocators(page)

  await page.goto('/canvas')
  await expect(page.getByRole('heading', { name: '无限画布', exact: true })).toBeVisible()
  await noHorizontalOverflow(page)
  await page.getByRole('link', { name: '新建画布', exact: true }).click()
  await expect(page).toHaveURL(/\/canvas\/[0-9a-f-]{36}$/)
  await expect(viewport).toBeVisible()

  const width = page.viewportSize()?.width ?? 0
  const toolbar = page.getByRole('toolbar', { name: '画布工具' })
  for (const button of await toolbar.getByRole('button').all()) {
    const area = await box(button)
    expect(area.x).toBeGreaterThanOrEqual(0)
    expect(area.x + area.width).toBeLessThanOrEqual(width)
  }
  await toolbar.getByRole('button', { name: '添加文本（T）', exact: true }).click()
  const note = page.getByLabel('文本内容', { exact: true })
  await note.fill('移动端笔记')
  await note.press('Escape')
  await expect(nodes('text')).toContainText('移动端笔记')

  // Generator parameters open as a sheet on small screens.
  await toolbar.getByRole('button', { name: '添加生成节点（G）', exact: true }).click()
  const inspector = page.getByTestId('canvas-inspector')
  await expect(inspector).toBeVisible()
  await inspector.getByRole('button', { name: '完成', exact: true }).click()
  await expect(inspector).toBeHidden()
  await nodes('generator').getByRole('button', { name: '编辑', exact: true }).click()
  await expect(inspector).toBeVisible()
  await inspector.getByRole('button', { name: '完成', exact: true }).click()

  // A one-finger drag on empty space pans the canvas.
  const stage = await box(viewport)
  const start = { x: stage.x + stage.width - 30, y: stage.y + 120 }
  const before = await box(nodes('text'))
  const session = await page.context().newCDPSession(page)
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
  for (let step = 1; step <= 5; step++)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: start.x - step * 12, y: start.y + step * 8 }],
    })
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect
    .poll(async () => {
      const after = await box(nodes('text'))
      return [Math.round(after.x - before.x), Math.round(after.y - before.y)]
    })
    .toEqual([-60, 40])
  await noHorizontalOverflow(page)
  await expect(page.getByTestId('canvas-save-state')).toHaveAttribute('data-status', 'saved', {
    timeout: 15_000,
  })
  expect(errors).toEqual([])
})
