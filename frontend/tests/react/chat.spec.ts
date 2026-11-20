import { journeyHeaders } from './client-headers'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from './test'
import { record } from '../../src/api/transport'
import { defaultCapabilities } from '../../src/api/catalog-contracts'
import { observeErrors } from '../browser-errors'
import { streamPerformance, desktopLighthouse } from '../chat-performance'

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  const pending = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/auth/login') && r.request().method() === 'POST',
  )
  await page.getByLabel('邮箱地址', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '进入 Lumi', exact: true }).click()
  const response = record(await (await pending).json())
  if (typeof response.access_token !== 'string') throw new Error('No login token')
  await expect(page).toHaveURL(/\/chat$/)
  return { token: response.access_token, user: record(response.user) }
}
test('React real streaming history stop editing isolation and bounded rendering', async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(240_000)
  const adminEmail = process.env.E2E_ADMIN_EMAIL,
    adminPassword = process.env.E2E_ADMIN_PASSWORD
  if (!adminEmail || !adminPassword || !baseURL || !process.env.E2E_DATABASE_URL)
    throw new Error('M4 requires real dependencies')
  const suffix = randomUUID().slice(0, 8),
    key = randomBytes(24).toString('base64url')
  const wire = 'private-wire-' + suffix,
    channelName = 'Chat channel ' + suffix,
    modelName = 'Lumi Chat ' + suffix
  const errors: string[] = []
  observeErrors(page, errors)
  let badCalls = 0,
    systemSeen = false,
    interruptions = 0
  const markdown =
    '## 灯塔与海风\n\n先把问题拆成两步，再观察光线。\n\n| 项目 | 结果 |\n| --- | --- |\n| 风向 | 东南 |\n\n' +
    '<CodeBlock language="go" editable>\nfunc main() {\n\n    fmt.Println("lumi")\n}\n</CodeBlock>\n\n' +
    '公式 $E=mc^2$。\n\n$$\n\\frac{a_1}{b}\n$$\n\n<script>window.untrusted=true</script>\n\n' +
    '{@body const [scope, setScope] = DIL.useState("海风")}\n<box gap={3}>\n**比较范围**\n' +
    '<radio-group value={scope} onChange={setScope}>\n<radio value="海风">海风</radio>\n' +
    '{#each ["远处灯塔","海岸地形"] as v}<radio value={v}>{v}</radio>{/each}\n</radio-group>\n' +
    '<button onClick={() => GenUI.issueNewTurn(scope)}>查看详细结果</button>\n</box>'
  const sourceURL = 'https://example.com/lighthouse'
  const source = {
    type: 'url_citation',
    ref: 'turn123news16',
    url_citation: { url: sourceURL, title: '灯塔报告' },
  }
  const richMarkdown =
    markdown +
    '\n\n<badge color="success">观测完成</badge>。<Cite\n refs={["turn123news16","turn123news2"]}/>' +
    '\n\n- <Link ref="turn123news16" title="查看报告"/>' +
    '\n- <Link ref="turn123news2" title="仅有标题的报告"/>' +
    '\n\n<row>{#each ["100ms","200ms","900ms"] as t,i}<box><text color={i===2?"green":"default"}>{t}</text></box>{/each}</row>' +
    '\n\n<box>\n  <row>\n    <badge color="warning">行程预览</badge>\n' +
    '    <AsyncImage query="杭州龙井虾仁" aspectRatio="5:4"/>\n    **龙井虾仁**\n' +
    '    <ul>\n      <li>**09:00 — 西湖断桥** 从断桥开始。</li>\n    </ul>\n  </row>\n</box>' +
    '\n\n<think>观测草稿</think>'
  const server = createServer(async (request, response) => {
    const receivedAt = Date.now()
    if (request.headers.authorization !== `Bearer ${key}`) {
      response.writeHead(401)
      response.end('private-credential-error')
      return
    }
    if (request.url === '/v1/models') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ data: [{ id: wire }] }))
      return
    }
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404)
      response.end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
    const body = record(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
    if (body.model === 'bad-' + wire) {
      badCalls++
      response.setHeader('Content-Type', 'text/event-stream')
      response.write(
        'data: ' +
          JSON.stringify({
            choices: [
              {
                delta: {
                  annotations: [
                    {
                      type: 'url_citation',
                      ref: source.ref,
                      url_citation: { url: 'https://example.com/discard' },
                    },
                  ],
                },
              },
            ],
          }) +
          '\n\n',
      )
      response.end('data: {"error":{"message":"private-provider-error"}}\n\n')
      return
    }
    if (!Array.isArray(body.messages)) {
      response.writeHead(400)
      response.end()
      return
    }
    const messages = body.messages.map(record),
      first = messages[0],
      last = messages.at(-1)
    const title = typeof first?.content === 'string' && first.content.startsWith('Return only')
    if (!title && first?.content === '用中文回答，保留上下文。') systemSeen = true
    const prompt = typeof last?.content === 'string' ? last.content : ''
    response.setHeader('Content-Type', 'text/event-stream')
    response.flushHeaders()
    const delta = (text: string) =>
      response.write(
        'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n',
      )
    const done = () => {
      response.end(
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":6,"total_tokens":18}}\n\ndata: [DONE]\n\n',
      )
    }
    if (title) {
      delta('海风与灯塔')
      done()
      return
    }
    if (prompt === '中断测试' && interruptions++ === 0) {
      delta('已生成的片段')
      response.end()
      return
    }
    if (prompt === '慢速测试') {
      delta('正在整理思路。\n\n')
      const timer = setInterval(() => delta('还在继续。'), 150)
      response.on('close', () => clearInterval(timer))
      return
    }
    if (prompt === 'latency') {
      delta('@' + Date.now() + ',' + receivedAt + '|')
      done()
      return
    }
    const output =
      prompt === '流式性能测试' ? '一段流畅的回答。'.repeat(180) + '\n\n结束。' : richMarkdown
    let position = 0
    const timer = setInterval(() => {
      delta(output.slice(position, position + 12))
      position += 12
      if (position >= output.length) {
        clearInterval(timer)
        if (output === richMarkdown) {
          response.write(
            'data: ' +
              JSON.stringify({
                choices: [
                  {
                    delta: {
                      annotations: [
                        source,
                        source,
                        { type: 'url_citation', url_citation: { url: 'javascript:invalid' } },
                      ],
                    },
                  },
                ],
              }) +
              '\n\n',
          )
        }
        done()
      }
    }, 20)
    response.on('close', () => clearInterval(timer))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No upstream address')
  const endpoint = `http://127.0.0.1:${address.port}/v1`
  const memberContext = await browser.newContext({
    baseURL,
    viewport: info.project.use.viewport ?? { width: 1440, height: 900 },
    ...(info.project.use.userAgent ? { userAgent: info.project.use.userAgent } : {}),
    ...(info.project.use.deviceScaleFactor
      ? { deviceScaleFactor: info.project.use.deviceScaleFactor }
      : {}),
    isMobile: info.project.use.isMobile ?? false,
    hasTouch: info.project.use.hasTouch ?? false,
    extraHTTPHeaders: journeyHeaders(info),
  })
  const member = await memberContext.newPage()
  observeErrors(member, errors)
  let cleanup: (() => Promise<void>) | undefined
  let previousSettings: Record<string, unknown> | undefined
  try {
    let auth = await login(page, adminEmail, adminPassword)
    const api = async (method: string, path: string, body?: unknown) => {
      const response = await page.request.fetch('/api/v1' + path, {
        method,
        headers: { Authorization: 'Bearer ' + auth.token, 'X-Lumi-CSRF': '1', Origin: baseURL },
        ...(body !== undefined ? { data: body } : {}),
      })
      expect(response.ok(), path + ' status ' + response.status()).toBe(true)
      return response.status() === 204 ? undefined : record(await response.json())
    }
    const password = randomBytes(18).toString('base64url') + 'Aa1',
      email = `chat-admin-${suffix}@lumi.test`
    await api('POST', '/admin/users', {
      email,
      password,
      nickname: '聊天验收',
      role: 'admin',
      initial_credits: 0,
    })
    await page.context().clearCookies()
    auth = await login(page, email, password)
    const channel = await api('POST', '/admin/upstreams', {
      version: 0,
      name: channelName,
      base_url: endpoint,
      api_key: key,
      timeout_chat_s: 15,
      timeout_image_s: 15,
      proxy_url: '',
      enabled: true,
      priority: 0,
      weight: 1,
      edit_format: 'multipart',
      note: '',
    })
    if (typeof channel?.id !== 'string') throw new Error('No channel')
    const channelID = channel.id
    let modelID = ''
    cleanup = async () => {
      if (previousSettings) {
        const current = await api('GET', '/admin/chat-settings')
        await api('PUT', '/admin/chat-settings', { ...previousSettings, version: current?.version })
      }
      await api('DELETE', '/admin/upstreams/' + channelID)
      if (modelID) await api('DELETE', '/admin/models/' + modelID)
    }
    const model = await api('POST', '/admin/models', {
      version: 0,
      display_name: modelName,
      type: 'chat',
      description: '',
      icon: '',
      sort_order: 0,
      enabled: true,
      is_default: true,
      capabilities: { ...defaultCapabilities('chat'), max_context_tokens: 32768 },
      routes: [
        {
          upstream_id: channel.id,
          upstream_model_name: 'bad-' + wire,
          priority: 0,
          weight: 1,
          enabled: true,
        },
        {
          upstream_id: channel.id,
          upstream_model_name: wire,
          priority: 1,
          weight: 1,
          enabled: true,
        },
      ],
    })
    if (typeof model?.id !== 'string') throw new Error('No model')
    modelID = model.id
    previousSettings = await api('GET', '/admin/chat-settings')
    await page.goto('/admin/chat-settings')
    await page.getByLabel('每用户每分钟请求数', { exact: true }).fill('0')
    await page.getByLabel('全局 system prompt', { exact: true }).fill('用中文回答，保留上下文。')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('聊天设置已保存')
    await page.screenshot({ path: info.outputPath('chat-settings.png'), animations: 'disabled' })
    const configured = await api('GET', '/admin/chat-settings')
    expect(configured?.per_minute).toBe(0)
    expect(configured?.system_prompt).toBe('用中文回答，保留上下文。')
    await page.goto('/chat')
    await expect(page.getByRole('button', { name: '选择模型', exact: true })).toContainText(
      modelName,
    )
    await page.evaluate(() => {
      const nativeFetch = window.fetch.bind(window)
      const capture = window as Window & { lumiChatWire?: Promise<string> }
      // Tee the real browser response before Chromium evicts a completed streaming body.
      window.fetch = async (input, init) => {
        const response = await nativeFetch(input, init)
        if (response.headers.get('Content-Type')?.startsWith('text/event-stream')) {
          capture.lumiChatWire = response.clone().text()
          window.fetch = nativeFetch
        }
        return response
      }
    })
    const stream = page.waitForResponse(
      (r) =>
        r.url().includes('/conversations/') &&
        r.url().endsWith('/messages') &&
        r.request().method() === 'POST',
    )
    const input = page.getByLabel('消息内容', { exact: true })
    await input.fill('解释海风与灯塔')
    await input.press('Shift+Enter')
    await expect(input).toHaveValue('解释海风与灯塔\n')
    await input.fill('解释海风与灯塔')
    await input.evaluate((element) => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    })
    await input.press('Enter')
    await expect(page).toHaveURL(/\/chat$/)
    await expect(page.locator('.chat-message')).toHaveCount(0)
    await input.evaluate((element) => {
      element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    })
    await input.press('Enter')
    await expect(page).toHaveURL(/\/chat\/[a-f0-9-]+$/)
    const assistantLogo = page.locator('.chat-message-assistant [aria-hidden="true"] img[alt=""]')
    await expect(assistantLogo).toBeVisible()
    await expect(assistantLogo).toHaveAttribute('src', /\/assets\/lumi-mark-[^/]+\.webp$/)
    await expect(
      page
        .locator('.chat-message-assistant')
        .last()
        .getByRole('button', { name: '重新生成', exact: true }),
    ).toBeEnabled()
    const answer = page.locator('.chat-message-assistant').last().locator('.chat-markdown')
    await expect(answer.locator('.shiki')).toBeVisible()
    await expect(answer.locator('.katex')).toHaveCount(2)
    await expect(answer.getByRole('listitem')).toHaveText([
      '海风',
      '远处灯塔',
      '海岸地形',
      '查看报告',
      '仅有标题的报告',
      '09:00 — 西湖断桥 从断桥开始。',
    ])
    await expect(answer).not.toContainText(/CodeBlock|radio-group|DIL\.useState|GenUI\./)
    await expect(answer.locator('script,img,input,[onclick]')).toHaveCount(0)
    await expect(answer.getByRole('link', { name: '灯塔报告' })).toHaveAttribute('href', sourceURL)
    await expect(answer.getByRole('link', { name: '查看报告' })).toHaveAttribute('href', sourceURL)
    await expect(answer.getByText('来源不可用', { exact: true })).toBeVisible()
    await expect(answer.locator('.chat-reply-badge[data-tone="success"]')).toHaveText('观测完成')
    await expect(answer.locator('.chat-reply-badge[data-tone="warning"]')).toHaveText('行程预览')
    await expect(answer.locator('.chat-illustration-prompt')).toHaveText('杭州龙井虾仁')
    await expect(answer.locator('li strong')).toHaveText('09:00 — 西湖断桥')
    await expect(answer.locator('pre')).toHaveCount(1)
    await expect(answer).not.toContainText(/AsyncImage|\uE000|\uE001/)
    await expect(answer).toContainText(/100ms\s+200ms\s+900ms/)
    await expect(answer.getByText('观测草稿')).toBeHidden()
    const reasoning = answer.getByText('思考过程', { exact: true })
    await reasoning.focus()
    await reasoning.press('Enter')
    await expect(answer.getByText('观测草稿')).toBeVisible()
    await reasoning.press('Enter')
    await expect(answer.getByText('观测草稿')).toBeHidden()
    await answer.getByRole('link', { name: '灯塔报告' }).focus()
    await expect(answer.getByRole('link', { name: '灯塔报告' })).toBeFocused()
    await page.screenshot({
      path: info.outputPath('chat-sources-light.png'),
      animations: 'disabled',
    })
    const streamed = await stream
    expect(streamed.headers()['x-accel-buffering']).toBe('no')
    const wireResponse = await page.evaluate(async () => {
      const response = (window as Window & { lumiChatWire?: Promise<string> }).lumiChatWire
      if (!response) throw new Error('No captured browser SSE response')
      return response
    })
    expect(wireResponse).toContain('event: done')
    for (const value of [
      key,
      wire,
      endpoint,
      channelName,
      'private-provider-error',
      'upstream_id',
      'request_hash',
      'https://example.com/discard',
      'javascript:invalid',
    ])
      expect(wireResponse).not.toContain(value)
    const conversationID = page.url().split('/').at(-1)
    if (!conversationID) throw new Error('No conversation ID')
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    const answerCard = page.locator('.chat-message-assistant').last()
    await answerCard.getByRole('button', { name: '复制消息', exact: true }).click()
    await expect(answerCard.getByRole('button', { name: '已复制', exact: true })).toBeVisible()
    const copiedAnswer = await page.evaluate(() => navigator.clipboard.readText())
    expect(copiedAnswer).toContain('灯塔与海风')
    expect(copiedAnswer).toContain('- 远处灯塔')
    expect(copiedAnswer).not.toMatch(/CodeBlock|radio-group|DIL\.useState|GenUI\./)
    expect(copiedAnswer).toContain(sourceURL)
    expect(copiedAnswer).not.toMatch(/turn123|观测草稿/)
    await page.locator('.chat-code').getByRole('button', { name: '复制代码', exact: true }).click()
    await expect
      .poll(() =>
        page.evaluate(async () => (await navigator.clipboard.readText()).replaceAll('\r\n', '\n')),
      )
      .toContain('func main() {\n\n    fmt.Println("lumi")\n}')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath('chat-light.png'), animations: 'disabled' })
    await page.getByRole('button', { name: '切换深色主题', exact: true }).click()
    await page.screenshot({ path: info.outputPath('chat-dark.png'), animations: 'disabled' })
    await answer.getByRole('link', { name: '灯塔报告' }).scrollIntoViewIfNeeded()
    await page.screenshot({
      path: info.outputPath('chat-sources-dark.png'),
      animations: 'disabled',
    })
    await answer.locator('.chat-illustration').scrollIntoViewIfNeeded()
    await expect(answer.getByRole('button', { name: '生成这张图', exact: true })).toBeInViewport()
    await page.screenshot({ path: info.outputPath('chat-layout-dark.png'), animations: 'disabled' })
    await page.reload()
    await expect(answer.locator('.shiki')).toBeVisible()
    await expect(answer.locator('.chat-illustration-prompt')).toHaveText('杭州龙井虾仁')
    await expect(answer.locator('li strong')).toHaveText('09:00 — 西湖断桥')
    await expect(answer.getByRole('link', { name: '灯塔报告' })).toHaveAttribute('href', sourceURL)
    await expect(answer.getByText('仅有标题的报告', { exact: true })).toBeVisible()
    await expect(answer).not.toContainText(/CodeBlock|radio-group|DIL\.useState|GenUI\./)
    await input.fill('保留的草稿')
    await page
      .getByRole('navigation', { name: '创作模式' })
      .getByRole('link', { name: '生图', exact: true })
      .click()
    await page
      .getByRole('navigation', { name: '创作模式' })
      .getByRole('link', { name: '聊天', exact: true })
      .click()
    await expect(input).toHaveValue('保留的草稿')
    await input.fill('')
    const oldAssistant = await page
      .locator('.chat-message-assistant')
      .last()
      .getAttribute('data-message-id')
    await page
      .locator('.chat-message-assistant')
      .last()
      .getByRole('button', { name: '重新生成', exact: true })
      .click()
    await expect(page.locator('.chat-message-assistant').last()).not.toHaveAttribute(
      'data-message-id',
      oldAssistant ?? '',
    )
    await expect(
      page
        .locator('.chat-message-assistant')
        .last()
        .getByRole('button', { name: '重新生成', exact: true }),
    ).toBeEnabled()
    await expect(page.locator('.chat-message-user')).toHaveCount(1)
    await page
      .locator('.chat-message-user')
      .last()
      .getByRole('button', { name: '编辑并重发', exact: true })
      .click()
    let dialog = page.getByRole('dialog')
    await dialog.getByLabel('消息内容', { exact: true }).fill('修改后的问题')
    await dialog.getByRole('button', { name: '重发消息', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.locator('.chat-message-user')).toContainText('修改后的问题')
    await expect(
      page
        .locator('.chat-message-assistant')
        .last()
        .getByRole('button', { name: '重新生成', exact: true }),
    ).toBeEnabled()
    await input.fill('慢速测试')
    await input.press('Enter')
    await expect(page.locator('.chat-message-assistant').last()).toContainText('正在整理思路')
    await page.getByRole('button', { name: '停止生成', exact: true }).click()
    await expect(page.locator('.chat-message-assistant').last()).toContainText('已停止生成')
    await page.reload()
    await expect(page.locator('.chat-message-assistant').last()).toContainText('正在整理思路')
    await input.fill('中断测试')
    await input.press('Enter')
    await expect(page.locator('.chat-message-assistant').last()).toContainText('已生成的片段')
    await page
      .locator('.chat-message-assistant')
      .last()
      .getByRole('button', { name: '重试回复', exact: true })
      .click()
    await expect(
      page
        .locator('.chat-message-assistant')
        .last()
        .getByRole('button', { name: '重新生成', exact: true }),
    ).toBeEnabled()
    await page.locator('.chat-current-title').getByRole('button').click()
    await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
    dialog = page.getByRole('dialog')
    const renamed = '灯塔记录-' + suffix
    await dialog.getByLabel('对话名称', { exact: true }).fill(renamed)
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.locator('.chat-current-title')).toContainText(renamed)
    await expect(page.locator('.chat-current-title').getByRole('button')).toBeFocused()
    await page.locator('.chat-current-title').getByRole('button').click()
    await page.getByRole('menuitem', { name: '置顶', exact: true }).click()
    await expect
      .poll(async () => (await api('GET', '/conversations/' + conversationID))?.pinned)
      .toBe(true)
    // Performance fixtures use real database rows on a different, ordinary account.
    const memberEmail = `chat-member-${suffix}@lumi.test`,
      memberPassword = randomBytes(18).toString('base64url') + 'Aa1'
    const createdMember = await api('POST', '/admin/users', {
      email: memberEmail,
      password: memberPassword,
      nickname: '聊天成员',
      role: 'user',
      initial_credits: 0,
    })
    if (typeof createdMember?.id !== 'string') throw new Error('No member')
    const memberAuth = await login(member, memberEmail, memberPassword)
    const denied = await member.request.get(
      '/api/v1/conversations/' + conversationID + '/messages',
      { headers: { Authorization: 'Bearer ' + memberAuth.token } },
    )
    expect(denied.status()).toBe(404)
    const deniedConfig = await member.request.get('/api/v1/admin/chat-settings', {
      headers: { Authorization: 'Bearer ' + memberAuth.token },
    })
    expect(deniedConfig.status()).toBe(403)
    const secondID = randomUUID()
    // Metadata must never prefetch content; the server enforces and audits explicit reads.
    const imageConfiguration = await api('GET', '/admin/image-settings')
    if (!imageConfiguration) throw new Error('Missing content access configuration')
    let contentReads = 0
    const observeContent = (request: import('@playwright/test').Request) => {
      if (request.url().includes('/admin/conversations/') && request.url().includes('/messages'))
        contentReads++
    }
    page.on('request', observeContent)
    try {
      await api('PUT', '/admin/image-settings', {
        ...imageConfiguration,
        admin_can_view_content: false,
      })
      await page.goto('/admin/conversations?user_id=' + auth.user.id)
      const metadata = page.getByRole('row').filter({ hasText: conversationID })
      await expect(metadata).toBeVisible()
      await expect(page.getByRole('columnheader', { name: '会话 ID', exact: true })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: '用户信息', exact: true })).toBeVisible()
      await expect(metadata.getByText(String(auth.user.nickname), { exact: true })).toBeVisible()
      await expect(metadata.getByText(String(auth.user.email), { exact: true })).toBeVisible()
      expect(contentReads).toBe(0)
      await expect(page.getByText('灯塔与海风', { exact: true })).toHaveCount(0)
      const deniedContent = page.waitForResponse((response) =>
        response.url().includes('/admin/conversations/' + conversationID + '/messages'),
      )
      await metadata
        .getByRole('button', { name: '查看消息（需开启内容权限）', exact: true })
        .click()
      expect((await deniedContent).status()).toBe(403)
      await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
      await page.goto('/admin/image-settings')
      await page.getByLabel('允许管理员查看提示词、参考图与结果', { exact: true }).check()
      await page.getByRole('button', { name: '保存修改', exact: true }).click()
      await expect(page.getByRole('status')).toContainText('生图设置已保存')
      await page.goto('/admin/conversations?user_id=' + auth.user.id)
      expect(contentReads).toBe(1)
      await page
        .getByRole('row')
        .filter({ hasText: conversationID })
        .getByRole('button', { name: '查看消息（需开启内容权限）', exact: true })
        .click()
      await expect(page.getByRole('dialog')).toContainText('灯塔与海风')
      await expect(
        page.getByRole('dialog').getByRole('link', { name: '灯塔报告' }).first(),
      ).toHaveAttribute('href', sourceURL)
      expect(contentReads).toBe(2)
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
      const audit = await api(
        'GET',
        '/admin/audit-logs?action=chat.content_view&target_id=' + conversationID,
      )
      expect(audit?.items).toHaveLength(1)
      await page.getByRole('button', { name: /简体中文/ }).click()
      await page.getByRole('menuitemradio', { name: 'English', exact: true }).click()
      await expect(
        page.getByRole('columnheader', { name: 'Conversation ID', exact: true }),
      ).toBeVisible()
      await expect(
        page.getByRole('columnheader', { name: 'User information', exact: true }),
      ).toBeVisible()
      const darkTheme = page.getByRole('button', { name: 'Use dark theme', exact: true })
      const startedInLightTheme = await darkTheme.isVisible()
      if (startedInLightTheme) await darkTheme.click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      await expect(metadata.getByText(String(auth.user.email), { exact: true })).toBeVisible()
      if (startedInLightTheme)
        await page.getByRole('button', { name: 'Use light theme', exact: true }).click()
      await page.getByRole('button', { name: /English/ }).click()
      await page.getByRole('menuitemradio', { name: '简体中文', exact: true }).click()
      await expect(page.getByRole('columnheader', { name: '用户信息', exact: true })).toBeVisible()
    } finally {
      page.off('request', observeContent)
      const latest = await api('GET', '/admin/image-settings')
      await api('PUT', '/admin/image-settings', { ...imageConfiguration, version: latest?.version })
    }
    await api('POST', '/conversations', { id: secondID, model_id: model.id })
    await api('PATCH', '/conversations/' + secondID, {
      title: '第二段-' + suffix,
      pinned: false,
      version: 1,
    })
    await page.goto('/me/chats')
    await page.locator('.chat-history').getByRole('searchbox').fill(suffix)
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await page.getByRole('checkbox', { name: '选择对话 ' + renamed, exact: true }).check()
    await page.getByRole('checkbox', { name: '选择对话 第二段-' + suffix, exact: true }).check()
    await page.screenshot({ path: info.outputPath('chat-history.png'), animations: 'disabled' })
    await page.getByRole('button', { name: '删除所选', exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole('heading', { name: '还没有对话', exact: true })).toBeVisible()
    await api('POST', '/conversations', { id: randomUUID(), model_id: model.id })
    await page.reload()
    await page.getByRole('button', { name: '清空全部', exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    expect((await api('GET', '/conversations'))?.items).toEqual([])
    await streamPerformance(page, auth.token, info)
    if (info.project.name.includes('desktop'))
      await desktopLighthouse(baseURL, memberEmail, memberPassword, info, 'chrome')
    const performanceID = randomUUID()
    execFileSync('go', ['run', '-tags=integration', './internal/testsupport/chatseed'], {
      cwd: fileURLToPath(new URL('../../../backend', import.meta.url)),
      env: {
        ...process.env,
        APP_ENV: 'test',
        E2E_CHAT_USER_ID: createdMember.id,
        E2E_CHAT_CONVERSATION_ID: performanceID,
        E2E_CHAT_PREFIX: suffix,
      },
      stdio: 'pipe',
      timeout: 45_000,
    })
    await member.goto('/chat/' + performanceID)
    const older = member.getByRole('button', { name: '加载更早的消息', exact: true })
    // The first request crosses the threshold with the reader at the oldest loaded row.
    const viewport = member.locator('.chat-message-scroll')
    const anchor = viewport.locator('article').filter({ hasText: 'Message 400.' })
    await expect(anchor).toHaveCount(1)
    await older.scrollIntoViewIfNeeded()
    await viewport.evaluate((element) => {
      element.scrollTop = 0
    })
    const anchorOffset = () =>
      anchor.evaluate((element) => {
        const viewport = element.closest('.chat-message-scroll')
        if (!viewport) throw new Error('Missing chat viewport')
        return element.getBoundingClientRect().top - viewport.getBoundingClientRect().top
      })
    await expect.poll(anchorOffset).toBeGreaterThanOrEqual(0)
    const offset = await anchorOffset()
    let firstPage = true
    let hasMore = true
    while (hasMore) {
      const response = member.waitForResponse(
        (r) => r.url().includes('/messages?') && r.status() === 200,
      )
      await older.click()
      hasMore = record(await (await response).json()).next_cursor !== ''
      if (firstPage) {
        await expect(member.locator('.chat-virtual-row').first()).toBeVisible()
        await expect(anchor).toBeInViewport()
        // Dynamic Markdown and virtual row measurement may settle within a line of text.
        await expect.poll(async () => Math.abs((await anchorOffset()) - offset)).toBeLessThan(24)
        firstPage = false
      }
    }
    await expect(member.locator('.chat-virtual-row').first()).toBeVisible()
    expect(await member.locator('.chat-message').count()).toBeLessThan(60)
    await member.keyboard.press('Control+k')
    const sidebar = member.locator(
      info.project.name.includes('mobile') ? '.mobile-sidebar' : '.desktop-sidebar',
    )
    await expect(
      sidebar.getByRole('searchbox', { name: '搜索对话标题', exact: true }),
    ).toBeFocused()
    expect(await sidebar.locator('.chat-sidebar-row').count()).toBeLessThan(30)
    await member.screenshot({
      path: info.outputPath('chat-virtualized.png'),
      animations: 'disabled',
    })
    if (info.project.name.includes('mobile'))
      await member.getByRole('button', { name: '关闭导航菜单', exact: true }).click()
    expect(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
    expect(badCalls).toBeGreaterThan(3)
    expect(systemSeen).toBe(true)
    expect(errors).toEqual([])
  } finally {
    try {
      await cleanup?.()
    } finally {
      await memberContext.close()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  }
})
