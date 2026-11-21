import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { APIRequestContext, Locator } from '@playwright/test'
import { expect, test, type Page } from './test'
import { record } from '../../src/api/transport'
import { defaultCapabilities } from '../../src/api/catalog-contracts'
import { parseImageConfiguration, parseTask } from '../../src/api/images'
import { observeErrors } from '../browser-errors'
import { fixturePNG } from '../image-fixture'
import { drawStroke, isSketchUpload, openSketch } from './sketch'

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
  const chatName = 'Canvas Text ' + suffix
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
    if (incoming.url === '/v1/chat/completions') {
      response.setHeader('Content-Type', 'text/event-stream')
      response.end('data: {"choices":[{"delta":{"content":"画布改写完成"}}]}\n\ndata: [DONE]\n\n')
      return
    }
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
    modelID = '',
    chatID = ''
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
            sizes: ['1024x1024', '1536x1024', 'auto'],
            max_n: 2,
            supports_edit: true,
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
        })
      ).id,
    )
    oldPricing = await admin('GET', '/admin/pricing')
    chatID = String(
      (
        await admin('POST', '/admin/models', {
          version: 0,
          display_name: chatName,
          type: 'chat',
          description: '',
          icon: '',
          sort_order: 0,
          enabled: true,
          is_default: true,
          capabilities: {
            ...defaultCapabilities('chat'),
            stream: true,
            vision: true,
            reasoning_effort: true,
          },
          routes: [
            {
              upstream_id: channelID,
              upstream_model_name: 'canvas-chat',
              priority: 0,
              weight: 1,
              enabled: true,
            },
          ],
        })
      ).id,
    )
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
    const drop = await page.evaluateHandle(
      (bytes) => {
        const data = new DataTransfer()
        data.items.add(new File([Uint8Array.from(bytes)], 'reference.png', { type: 'image/png' }))
        return data
      },
      [...png],
    )
    const dropArea = await box(viewport)
    await viewport.dispatchEvent('drop', {
      dataTransfer: drop,
      clientX: dropArea.x + dropArea.width / 2 - 140,
      clientY: dropArea.y + dropArea.height / 2 - 140,
    })
    await drop.dispose()
    await expect(nodes('image').locator('img')).toHaveCount(1, { timeout: 20_000 })
    const stage = await box(viewport)
    await page.mouse.dblclick(stage.x + stage.width * 0.22, stage.y + stage.height * 0.78)
    await page.getByRole('menuitem', { name: '文本', exact: true }).click()
    await expect(page.getByTestId('canvas-inspector')).toHaveAttribute('data-node-composer', 'text')
    await nodes('text').dblclick()
    const note = page.getByLabel('文本内容', { exact: true })
    await expect(note).toBeFocused()
    await note.fill('暖色水彩风格')
    await note.press('Escape')
    await expect(nodes('text')).toContainText('暖色水彩风格')

    // Start from the text node and add a reference in the generator composer.
    await nodes('text').first().click()
    await page
      .getByRole('toolbar', { name: '选中操作' })
      .getByRole('button', { name: '生成', exact: true })
      .click()
    await page.getByRole('button', { name: '适配全部（1）', exact: true }).click()
    const inspector = page.getByTestId('canvas-inspector')
    await expect(inspector).toBeVisible()
    await page.getByRole('button', { name: '切换深色主题', exact: true }).click()
    await drag(
      page,
      { x: stage.x + stage.width - 36, y: stage.y + stage.height * 0.65 },
      { x: stage.x + stage.width - 36, y: stage.y + stage.height * 0.35 },
    )
    const generator = await box(nodes('generator'))
    const composer = await box(inspector)
    expect(composer.y).toBeGreaterThan(generator.y + generator.height)
    const nodeTools = await box(page.getByRole('toolbar', { name: '选中操作' }))
    expect(nodeTools.y + nodeTools.height).toBeLessThan(generator.y)
    await expect(inspector.getByTestId('canvas-inputs')).toHaveText('0 张参考图 · 1 段文本')
    await inspector.getByRole('button', { name: '从画布添加引用' }).click()
    await page
      .getByRole('dialog', { name: '从画布添加引用' })
      .getByRole('button', { name: /图片/ })
      .click()
    await expect(inspector.getByTestId('canvas-inputs')).toHaveText('1 张参考图 · 1 段文本')
    await expect(edges).toHaveCount(2)
    await inspector.getByLabel('提示词', { exact: true }).fill('canvas-journey @')
    await expect(inspector.getByRole('listbox')).toBeVisible()
    await inspector.getByRole('option', { name: /暖色水彩风格/ }).click()
    await expect(inspector.getByLabel('提示词', { exact: true })).toHaveValue(/@\[/)
    await inspector.getByRole('button', { name: /断开 文本/ }).click()
    await expect(inspector.getByText(/引用已失效/)).toBeVisible()
    await expect(inspector.getByRole('button', { name: '生成', exact: true })).toBeDisabled()
    await inspector.getByRole('button', { name: '从画布添加引用' }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /暖色水彩风格/ })
      .click()
    await expect(inspector.getByText(/引用已失效/)).toHaveCount(0)
    await inspector.getByLabel('模型', { exact: true }).selectOption({ label: modelName })
    const parameters = inspector.getByRole('button', { name: '参数', exact: true })
    const summary = inspector.getByTestId('canvas-image-parameter-summary')
    await expect(summary).toHaveText('自动 · 1 张')
    const run = inspector.getByRole('button', { name: '生成', exact: true })
    // The quote can resize and re-anchor the editor after the model changes.
    await expect(run).toBeEnabled({ timeout: 15_000 })
    await parameters.click({ trial: true })
    await expect(async () => {
      const [parameterButtonBox, summaryBox] = await Promise.all([box(parameters), box(summary)])
      expect(summaryBox.x).toBeGreaterThan(parameterButtonBox.x + parameterButtonBox.width)
      expect(Math.abs(center(summaryBox).y - center(parameterButtonBox).y)).toBeLessThan(2)
    }).toPass({ timeout: 5_000 })
    const imageParameters = page.getByRole('dialog', { name: '生图参数', exact: true })
    const editorBox = await box(inspector)
    await parameters.click()
    await expect(imageParameters).toBeVisible()
    await expect(imageParameters.getByRole('radiogroup', { name: '质量' })).toBeVisible()
    const planning = imageParameters.getByLabel('规划强度', { exact: true })
    await expect(planning).toHaveValue('')
    await planning.selectOption('medium')
    const auto = imageParameters.getByRole('radio', { name: '自动', exact: true })
    await expect(auto).toBeChecked()
    await expect(imageParameters.getByLabel('分辨率', { exact: true })).toHaveCount(0)
    expect(await box(inspector)).toEqual(editorBox)
    await imageParameters.getByRole('radio', { name: '3:2', exact: true }).check()
    await expect(imageParameters.getByLabel('分辨率', { exact: true })).toBeVisible()
    await imageParameters.getByRole('radio', { name: '2 张', exact: true }).check()
    await expect(summary).toHaveText('3:2 · 1K · 2 张')
    await imageParameters.getByRole('radio', { name: '按尺寸', exact: true }).check()
    await expect(summary).toHaveText('按尺寸 · 1536 × 1024 · 2 张')
    await auto.check()
    await imageParameters.getByRole('radio', { name: '1 张', exact: true }).check()
    await page.keyboard.press('Escape')
    await expect(imageParameters).toBeHidden()
    await expect(parameters).toBeFocused()
    await expect(inspector.getByLabel('提示词', { exact: true })).toHaveValue(/@\[/)
    await expect(run).toBeEnabled({ timeout: 15_000 })
    const estimate = inspector.getByText(/^预计 [\d,]+ 积分$/)
    const cost = Number((await estimate.textContent())?.replace(/\D/g, ''))
    expect(cost).toBeGreaterThan(0)
    const balance = Number((await self('GET', '/me/credits')).total)
    const runRequest = page.waitForRequest(
      (request) =>
        request.url().endsWith('/canvases/' + canvasID + '/runs') && request.method() === 'POST',
    )
    await run.click()
    expect((await runRequest).postDataJSON()).toMatchObject({
      ratio: 'auto',
      size: 'auto',
      complexity: 'medium',
    })
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
    expect(stored).toMatchObject({
      title,
      node_count: 4,
      document: {
        nodes: expect.arrayContaining([
          expect.objectContaining({
            generator: expect.objectContaining({
              ratio: 'auto',
              size: 'auto',
              complexity: 'medium',
            }),
          }),
        ]),
      },
    })
    await page.reload()
    await expect(nodes()).toHaveCount(4)
    await expect(edges).toHaveCount(3)
    await expect(page.getByLabel('画布名称', { exact: true })).toHaveValue(title)
    await expect(zoom).toHaveAttribute('aria-label', zoomLabel ?? '')
    await expect(nodes('image').locator('img')).toHaveCount(2)
    await nodes('generator').click()
    await expect(summary).toHaveText('自动 · 1 张')

    await parameters.click()
    await expect(planning).toHaveValue('medium')
    await page.keyboard.press('Escape')

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
    const grip = { x: frame.x + frame.width - 6, y: frame.y + frame.height * 0.75 }
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
    expect(copied.startsWith('lumi-canvas/v2:')).toBe(true)
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
    await page.getByRole('link', { name: '新建画布', exact: true }).click()
    await expect(viewport).toBeVisible()
    await expect(page.locator('.desktop-sidebar')).toHaveCount(0)

    // Drag a connection to empty space and undo the new node and edge together.
    await page.getByRole('button', { name: '添加文本（T）', exact: true }).click()
    await nodes('text').dblclick()
    const newNote = page.getByLabel('文本内容', { exact: true })
    await newNote.fill('原位生图')
    await newNote.press('Escape')
    const stageBox = await box(viewport)
    const createTarget = {
      x: stageBox.x + stageBox.width * 0.7,
      y: stageBox.y + stageBox.height * 0.35,
    }
    const fromNote = nodes('text').locator('[data-handle="out"]')
    await drag(page, center(await box(fromNote)), createTarget)
    await page.getByRole('menuitem', { name: '图片', exact: true }).click()
    await expect(nodes('image')).toHaveCount(1)
    await expect(edges).toHaveCount(1)
    await page.keyboard.press('Control+Z')
    await expect(nodes('image')).toHaveCount(0)
    await expect(edges).toHaveCount(0)
    await page.keyboard.press('Control+Shift+Z')
    const imageId = await nodes('image').getAttribute('data-node-id')
    await nodes('image').getByRole('button', { name: '设置生成', exact: true }).click()
    await inspector.getByLabel('模型', { exact: true }).selectOption({ label: modelName })
    await expect(run).toBeEnabled()
    const sent = page.waitForResponse(
      (response) => response.url().endsWith('/runs') && response.status() === 202,
    )
    await run.click()
    const accepted = record(await (await sent).json())
    const savedCanvas = record(accepted.canvas)
    const storedNodes = record(savedCanvas.document).nodes
    expect(storedNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: imageId,
          image: expect.objectContaining({ state: 'pending', position: 0 }),
        }),
      ]),
    )
    await page.reload()
    await expect(nodes('image').locator('img')).toHaveCount(1, { timeout: 25_000 })
    await expect(nodes('image')).toHaveAttribute('data-node-id', imageId ?? '')
    expect(upstream.generations).toBeGreaterThan(0)
    await saved()

    // Modifier-drag selects both nodes even when the hand tool is active.
    await page.keyboard.press('1')
    const a = await box(nodes('text'))
    const b = await box(nodes('image'))
    await page.keyboard.down('Control')
    await drag(
      page,
      { x: Math.min(a.x, b.x) - 15, y: Math.min(a.y, b.y) - 15 },
      {
        x: Math.max(a.x + a.width, b.x + b.width) + 15,
        y: Math.max(a.y + a.height, b.y + b.height) + 15,
      },
    )
    await page.keyboard.up('Control')
    await expect(nodes('text')).toHaveAttribute('data-selected', 'true')
    await expect(nodes('image')).toHaveAttribute('data-selected', 'true')
    await nodes('image').click()
    await expect(inspector.getByTestId('canvas-inputs')).toHaveText('1 张参考图 · 1 段文本')
    await inspector.getByLabel('提示词', { exact: true }).fill('继续生成参考图')
    await inspector.getByLabel('模型', { exact: true }).selectOption({ label: modelName })
    await expect(run).toBeEnabled()
    await run.click()
    await expect(nodes('image').locator('img')).toHaveCount(2, { timeout: 25_000 })
    await expect(nodes('image').first()).toHaveAttribute('data-node-id', imageId ?? '')
    expect(upstream.edits).toBe(2)
    await saved()
    await page.keyboard.press('Control+Z')
    await expect(nodes('image')).toHaveCount(1)

    const uploadedFile = () =>
      page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/files') &&
          response.request().method() === 'POST' &&
          response.ok(),
      )
    const applyImageEdit = async (name: string) => {
      const uploaded = uploadedFile()
      await page.getByRole('dialog', { name }).getByRole('button', { name: '添加结果' }).click()
      return record(await (await uploaded).json())
    }
    await page.getByRole('button', { name: '裁剪图片', exact: true }).click()
    const cropArea = page.getByTestId('canvas-image-tool-preview')
    await expect(cropArea).toBeVisible()
    await cropArea.hover()
    const cropBox = await box(cropArea)
    await drag(
      page,
      { x: cropBox.x + cropBox.width * 0.25, y: cropBox.y + cropBox.height * 0.25 },
      { x: cropBox.x + cropBox.width * 0.75, y: cropBox.y + cropBox.height * 0.75 },
    )
    const cropped = await applyImageEdit('裁剪图片')
    expect(Math.abs(Number(cropped.width) - 450)).toBeLessThanOrEqual(3)
    expect(Math.abs(Number(cropped.height) - 300)).toBeLessThanOrEqual(3)
    await expect(nodes('image')).toHaveCount(2)
    await page.keyboard.press('Control+Z')
    await expect(nodes('image')).toHaveCount(1)

    await page.getByRole('button', { name: '放大图片', exact: true }).click()
    await page.getByLabel('目标长边').selectOption('1024')
    const enlarged = await applyImageEdit('放大图片')
    expect(enlarged).toMatchObject({ width: 1024, height: 683 })
    await expect(nodes('image')).toHaveCount(2)
    await page.keyboard.press('Control+Z')
    await expect(nodes('image')).toHaveCount(1)

    await page.getByRole('button', { name: '切分图片', exact: true }).click()
    await page
      .getByRole('dialog', { name: '切分图片' })
      .getByRole('button', { name: '添加结果' })
      .click()
    await expect(nodes('image')).toHaveCount(5)
    const splitBox = await box(nodes('image').nth(1))
    expect(splitBox.width / splitBox.height).toBeCloseTo(1.5)
    await page.keyboard.press('Control+Z')
    await expect(nodes('image')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await nodes('text').click()
    await expect(inspector).toHaveAttribute('data-node-composer', 'text')
    await inspector.getByLabel('提示词', { exact: true }).fill('改写成一句话')
    await inspector.getByLabel('模型', { exact: true }).selectOption({ label: chatName })
    await parameters.click()
    const textParameters = page.getByRole('dialog', { name: '文本参数', exact: true })
    await textParameters.getByLabel('推理强度').selectOption('high')
    await textParameters.getByLabel('生成次数').selectOption('2')
    await textParameters.getByRole('button', { name: '完成', exact: true }).click()
    const textAccepted = page.waitForResponse(
      (response) => response.url().endsWith('/text-runs') && response.status() === 202,
    )
    await run.click()
    await textAccepted
    await page.reload()
    await expect(nodes('text').filter({ hasText: '画布改写完成' })).toHaveCount(2, {
      timeout: 25_000,
    })
    await expect(nodes('text').first()).toContainText('原位生图')
    await page.route('**/api/v1/canvases/*', async (route) => {
      if (route.request().method() === 'PUT') {
        await new Promise<void>((resolve) => setTimeout(resolve, 2000))
      }
      await route.continue()
    })
    await page.getByLabel('画布名称', { exact: true }).fill('从结果继续')
    await page.getByRole('link', { name: '画布列表', exact: true }).click()
    const leaveDialog = page.getByRole('dialog', { name: '离开画布？' })
    await expect(leaveDialog).toBeVisible()
    await leaveDialog.getByRole('button', { name: '保存并离开' }).click()
    await expect(page).toHaveURL(/\/canvas$/)
    await expect(page.getByTestId('canvas-card').filter({ hasText: '从结果继续' })).toBeVisible()
    await expect(
      page.locator('.desktop-sidebar').getByRole('link', { name: title, exact: true }),
    ).toBeVisible()
    await card.getByRole('button', { name: '画布操作 · ' + title, exact: true }).click()
    await page.getByRole('menuitem', { name: '删除', exact: true }).click()
    await page.getByRole('button', { name: '删除画布', exact: true }).click()
    await expect(card).toHaveCount(0)
    expect(await self.status('GET', '/canvases/' + canvasID)).toBe(404)

    await page.unroute('**/api/v1/canvases/*')
    await page.getByRole('link', { name: '新建画布', exact: true }).click()
    await expect(page).toHaveURL(/\/canvas\/[0-9a-f-]{36}$/)
    await expect(viewport).toBeVisible()
    const sketch = await openSketch(page, 'canvas')
    await drawStroke(page, sketch.paper, false)
    let uploads = 0
    await page.route('**/api/v1/files*', async (route) => {
      if (isSketchUpload(route.request().url(), route.request().method()) && ++uploads === 1)
        await route.fulfill({ status: 503, json: { code: 'TEMPORARILY_UNAVAILABLE' } })
      else await route.continue()
    })
    await sketch.confirm.click()
    await expect(sketch.dialog.getByRole('alert')).toBeVisible()
    await expect(sketch.confirm).toBeEnabled()
    await expect(nodes('image')).toHaveCount(0)
    const sketchUpload = page.waitForResponse(
      (response) =>
        isSketchUpload(response.url(), response.request().method()) && response.status() === 201,
    )
    const autosaveSketch = page.waitForResponse(
      (response) =>
        response.url().endsWith(new URL(page.url()).pathname.replace('/canvas/', '/canvases/')) &&
        response.request().method() === 'PUT' &&
        response.ok(),
    )
    await sketch.confirm.click({ clickCount: 2 })
    const sketchFile = record(await (await sketchUpload).json())
    expect(sketchFile).toMatchObject({ id: expect.any(String), width: 1024, height: 1024 })
    await expect(sketch.dialog).toBeHidden()
    expect(uploads).toBe(2)
    const sketchNode = nodes('image')
    await expect(sketchNode).toHaveAttribute('data-selected', 'true')
    const sketchNodeID = await sketchNode.getAttribute('data-node-id')
    await autosaveSketch
    await page.reload()
    await expect(sketchNode).toHaveAttribute('data-node-id', sketchNodeID ?? '')
    await expect(sketchNode.locator('img')).toBeVisible()
    await sketchNode.click()
    await page
      .getByRole('toolbar', { name: '选中操作' })
      .getByRole('button', { name: '生成', exact: true })
      .click()
    await expect(inspector.getByTestId('canvas-inputs')).toHaveText('1 张参考图 · 0 段文本')
    await inspector.getByLabel('模型', { exact: true }).selectOption({ label: modelName })
    await inspector.getByLabel('提示词', { exact: true }).fill('Use the sketch composition')
    const sketchRun = page.waitForResponse(
      (response) => response.url().endsWith('/runs') && response.status() === 202,
    )
    await run.click()
    const task = parseTask(record(await (await sketchRun).json()).task)
    expect(task.reference_file_ids).toEqual([sketchFile.id])
    await expect(nodes('image').locator('img')).toHaveCount(2, { timeout: 30_000 })
    expect(upstream.prompts).toContain('Use the sketch composition')
    expect(errors).toEqual([])
  } finally {
    if (oldPricing) await admin('PUT', '/admin/pricing', oldPricing)
    if (oldSettings) {
      const latest = parseImageConfiguration(await admin('GET', '/admin/image-settings'))
      await admin('PUT', '/admin/image-settings', { ...oldSettings, version: latest.version })
    }
    if (channelID) await admin('DELETE', '/admin/upstreams/' + channelID)
    if (modelID) await admin('DELETE', '/admin/models/' + modelID)
    if (chatID) await admin('DELETE', '/admin/models/' + chatID)
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
  const inspector = page.getByTestId('canvas-inspector')
  await expect(inspector).toHaveAttribute('data-node-composer', 'text')
  const parameters = inspector.getByRole('button', { name: '参数', exact: true })
  await parameters.tap()
  const textParameters = page.getByRole('dialog', { name: '文本参数', exact: true })
  await textParameters.getByLabel('生成次数').selectOption('2')
  await textParameters.getByRole('button', { name: '完成', exact: true }).tap()
  await expect(textParameters).toBeHidden()
  await expect(inspector).toBeVisible()
  await expect(parameters).toBeFocused()
  await parameters.tap()
  await expect(textParameters.getByLabel('生成次数')).toHaveValue('2')
  await page.keyboard.press('Escape')
  await expect(textParameters).toBeHidden()
  await expect(inspector).toBeVisible()
  await expect(parameters).toBeFocused()
  await inspector.getByRole('button', { name: '完成', exact: true }).click()
  await page.getByRole('button', { name: '编辑正文', exact: true }).click()
  const note = page.getByLabel('文本内容', { exact: true })
  await note.fill('移动端笔记')
  await note.press('Escape')
  await expect(nodes('text')).toContainText('移动端笔记')

  // The generator composer stays in its sheet while parameters open separately.
  await toolbar.getByRole('button', { name: '添加生成节点（G）', exact: true }).click()
  await expect(inspector).toBeVisible()
  await parameters.tap()
  const imageParameters = page.getByRole('dialog', { name: '生图参数', exact: true })
  await expect(imageParameters.getByLabel(/^(尺寸|分辨率)$/)).toBeVisible()
  await noHorizontalOverflow(page)
  await imageParameters.getByRole('button', { name: '关闭', exact: true }).tap()
  await expect(imageParameters).toBeHidden()
  await expect(inspector).toBeVisible()
  await inspector.getByRole('button', { name: '完成', exact: true }).click()
  await expect(inspector).toBeHidden()
  await nodes('generator').getByRole('button', { name: '设置生成', exact: true }).click()
  await expect(inspector).toBeVisible()
  await inspector.getByRole('button', { name: '完成', exact: true }).click()

  // A one-finger drag on empty space pans the canvas.
  const stage = await box(viewport)
  const start = { x: stage.x + stage.width - 30, y: stage.y + stage.height - 170 }
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
  const zoom = page.getByRole('button', { name: /^缩放 \d+%$/ })
  const zoomBeforePinch = await zoom.getAttribute('aria-label')
  const pinch = (half: number) => [
    { x: stage.x + stage.width / 2 - half, y: stage.y + stage.height - 75, id: 1 },
    { x: stage.x + stage.width / 2 + half, y: stage.y + stage.height - 75, id: 2 },
  ]
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: pinch(25).slice(0, 1),
  })
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pinch(25) })
  for (let spread = 30; spread <= 65; spread += 5) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: pinch(spread),
    })
  }
  await expect(zoom).not.toHaveAttribute('aria-label', zoomBeforePinch ?? '')
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await noHorizontalOverflow(page)
  await expect(page.getByTestId('canvas-save-state')).toHaveAttribute('data-status', 'saved', {
    timeout: 15_000,
  })
  const sketch = await openSketch(page, 'canvas')
  await drawStroke(page, sketch.paper, true)
  await expect(sketch.confirm).toBeEnabled()
  await sketch.dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await sketch.dialog.getByRole('button', { name: '放弃草图', exact: true }).click()
  await expect(sketch.dialog).toBeHidden()
  await expect(sketch.trigger).toBeFocused()
  expect(errors).toEqual([])
})
