import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { expect, test } from './test'
import { record } from '../../src/api/transport'
import { defaultCapabilities } from '../../src/api/catalog-contracts'

test('video workspace and canvas recover and play billed results', async ({
  page,
  request,
  baseURL,
}) => {
  const email = process.env.E2E_ADMIN_EMAIL,
    password = process.env.E2E_ADMIN_PASSWORD
  if (!email || !password || !baseURL) throw new Error('Missing video journey credentials')
  const video = execFileSync('ffmpeg', [
    '-nostdin',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=320x240:r=24',
    '-t',
    '1',
    '-c:v',
    'libx264',
    '-movflags',
    'frag_keyframe+empty_moov',
    '-f',
    'mp4',
    'pipe:1',
  ])
  const apiKey = 'fixture-' + randomUUID()
  const submits: { duration?: unknown; generate_audio?: unknown }[] = []
  const upstream = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/fixture.mp4') {
      res.setHeader('Content-Type', 'video/mp4')
      res.end(video)
      return
    }
    if (req.headers.authorization !== 'Bearer ' + apiKey) {
      res.writeHead(401).end()
      return
    }
    if (req.method === 'POST' && req.url === '/api/v3/contents/generations/tasks') {
      const chunks: Buffer[] = []
      for await (const part of req) chunks.push(Buffer.from(part))
      const body = record(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      submits.push(body)
      res.end(JSON.stringify({ id: 'task-' + submits.length }))
      return
    }
    if (req.method === 'GET' && req.url?.startsWith('/api/v3/contents/generations/tasks/task-')) {
      const id = req.url.split('/').at(-1)
      res.end(
        JSON.stringify({
          id,
          status: 'succeeded',
          content: { video_url: 'http://' + req.headers.host + '/fixture.mp4' },
        }),
      )
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const address = upstream.address()
  if (!address || typeof address === 'string') throw new Error('Unable to start video fixture')
  try {
    await page.goto('/login')
    const signingIn = page.waitForResponse((response) =>
      response.url().endsWith('/api/v1/auth/login'),
    )
    await page.getByLabel('邮箱地址', { exact: true }).fill(email)
    await page.getByLabel('密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '进入 Lumi', exact: true }).click()
    const response = await signingIn,
      auth = record(await response.json())
    const account = record(auth.user)
    if (typeof auth.access_token !== 'string' || typeof account.id !== 'string')
      throw new Error('Missing fixture identity')
    const headers = {
      Origin: baseURL,
      'X-Lumi-CSRF': '1',
      Authorization: 'Bearer ' + auth.access_token,
    }
    const key = randomUUID().slice(0, 8)
    const channelResponse = await request.post('/api/v1/admin/upstreams', {
      headers,
      data: {
        name: 'Video fixture ' + key,
        base_url: 'http://127.0.0.1:' + address.port,
        api_key: apiKey,
        timeout_chat_s: 5,
        timeout_image_s: 5,
        proxy_url: '',
        enabled: true,
        priority: 0,
        weight: 1,
        edit_format: 'multipart',
        note: '',
      },
    })
    expect(channelResponse.ok()).toBeTruthy()
    const channel = record(await channelResponse.json())
    const modelResponse = await request.post('/api/v1/admin/models', {
      headers,
      data: {
        display_name: 'Video fixture ' + key,
        type: 'video',
        enabled: true,
        is_default: true,
        capabilities: defaultCapabilities('video'),
        routes: [
          {
            upstream_id: channel.id,
            upstream_model_name: 'fixture-model',
            priority: 0,
            weight: 1,
            enabled: true,
            video_protocol: 'ark',
          },
        ],
      },
    })
    expect(modelResponse.ok()).toBeTruthy()
    const model = record(await modelResponse.json())
    expect(
      (
        await request.put('/api/v1/admin/video-pricing/' + model.id, {
          headers,
          data: {
            mode: 'second',
            version: 0,
            rates: [{ resolution: '720p', has_video_reference: false, credits: 1 }],
          },
        })
      ).ok(),
    ).toBeTruthy()
    expect(
      (
        await request.post('/api/v1/admin/users/' + account.id + '/credits', {
          headers: { ...headers, 'Idempotency-Key': randomUUID() },
          data: { bucket: 'video', action: 'add', amount: 20, note: 'Video browser fixture' },
        })
      ).ok(),
    ).toBeTruthy()

    await page.goto('/video')
    await expect(page.getByRole('heading', { name: '视频工作台' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '视频模型' })).toHaveValue(String(model.id))
    await page
      .getByRole('textbox', { name: '描述你想生成的视频，输入 @ 选择素材' })
      .fill('Video workspace fixture')
    await page.getByRole('checkbox', { name: '生成声音' }).uncheck()
    await page.getByRole('button', { name: '生成视频', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '确认生成' })).toContainText('本次使用 5 积分')
    await page.getByRole('button', { name: '确认生成', exact: true }).click()
    await expect(page.getByRole('link', { name: '下载视频' }).first()).toBeVisible({
      timeout: 20_000,
    })
    await page.reload()
    await expect(page.getByRole('link', { name: '下载视频' }).first()).toBeVisible()
    await expect(page.getByText('可用 15 积分')).toBeVisible()
    expect(submits[0]).toMatchObject({ duration: 5, generate_audio: false })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)

    await page.goto('/canvas')
    await page.getByRole('link', { name: '新建画布', exact: true }).click()
    await expect(page).toHaveURL(/\/canvas\/[0-9a-f-]{36}$/)
    await page.getByRole('button', { name: '添加节点', exact: true }).click()
    await page.getByRole('menuitem', { name: '视频节点', exact: true }).click()
    const node = page.locator('[data-kind="video"]').first()
    await node.getByRole('button', { name: '打开视频生成' }).click()
    await page
      .getByRole('textbox', { name: '描述你想生成的视频，输入 @ 选择素材' })
      .fill('Canvas video fixture')
    await page.getByRole('button', { name: '生成视频', exact: true }).click()
    await page.getByRole('button', { name: '确认生成', exact: true }).click()
    await expect(node.locator('video')).toBeVisible({ timeout: 20_000 })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.reload()
    await expect(node.locator('video')).toBeVisible()
    expect(submits).toHaveLength(2)
  } finally {
    upstream.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
