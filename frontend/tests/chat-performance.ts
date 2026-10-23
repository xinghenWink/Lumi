import { createServer } from 'node:net'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { chromium, expect, type Page, type TestInfo } from '@playwright/test'

interface Measurements {
  start: number
  longTaskMS: number
  eventMaxMS: number
}
declare global {
  interface Window {
    lumiMeasurements: Measurements
    lumiObservers: PerformanceObserver[]
  }
}
export async function streamPerformance(page: Page, token: string, info: TestInfo) {
  await page.goto('/chat')
  await expect(page.getByRole('button', { name: '选择模型', exact: true })).toBeEnabled()
  await page.evaluate(() => {
    const target = window
    target.lumiMeasurements = { start: performance.now(), longTaskMS: 0, eventMaxMS: 0 }
    target.lumiObservers = []
    const long = new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        if (entry.startTime >= target.lumiMeasurements.start)
          target.lumiMeasurements.longTaskMS += entry.duration
    })
    long.observe({ type: 'longtask', buffered: true })
    target.lumiObservers.push(long)
    const events = new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        if (entry.startTime >= target.lumiMeasurements.start)
          target.lumiMeasurements.eventMaxMS = Math.max(
            target.lumiMeasurements.eventMaxMS,
            entry.duration,
          )
    })
    events.observe({
      type: 'event',
      durationThreshold: 16,
      buffered: true,
    } as PerformanceObserverInit)
    target.lumiObservers.push(events)
  })
  const input = page.getByLabel('消息内容', { exact: true })
  await input.fill('流式性能测试')
  await input.press('Space')
  await input.press('Backspace')
  await input.press('Enter')
  await expect(page.locator('.chat-message-assistant').last()).toContainText('结束。')
  await expect(
    page
      .locator('.chat-message-assistant')
      .last()
      .getByRole('button', { name: '重新生成', exact: true }),
  ).toBeEnabled()
  const metrics = await page.evaluate(() => {
    const target = window
    for (const observer of target.lumiObservers) observer.disconnect()
    const duration = performance.now() - target.lumiMeasurements.start
    return {
      durationMS: duration,
      longTaskMS: target.lumiMeasurements.longTaskMS,
      longTaskPercent: (target.lumiMeasurements.longTaskMS / duration) * 100,
      eventMaxMS: Math.max(16, target.lumiMeasurements.eventMaxMS),
    }
  })
  expect(metrics.eventMaxMS).toBeLessThan(200)
  expect(metrics.longTaskPercent).toBeLessThan(5)
  const id = page.url().split('/').at(-1)
  if (!id) throw new Error('No performance conversation')
  const latency = await page.evaluate(
    async ({ id, token }) => {
      const model = (await (
        await fetch('/api/v1/conversations/' + id, {
          headers: { Authorization: 'Bearer ' + token },
        })
      ).json()) as { model_id: string | null }
      const samples: number[] = []
      let encoding: string | null = null
      for (let attempt = 0; attempt < 60; attempt++) {
        const started = Date.now()
        const response = await fetch('/api/v1/conversations/' + id + '/messages', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-Lumi-CSRF': '1',
            Authorization: 'Bearer ' + token,
          },
          body: JSON.stringify({
            request_id: crypto.randomUUID(),
            model_id: model.model_id,
            action: 'send',
            content: 'latency',
          }),
        })
        if (!response.ok || !response.body) throw new Error('Latency stream rejected')
        const reader = response.body.getReader(),
          decoder = new TextDecoder()
        let buffer = ''
        try {
          while (true) {
            const chunk = await reader.read()
            buffer += decoder.decode(chunk.value, { stream: !chunk.done })
            let end = buffer.indexOf('\n\n')
            while (end >= 0) {
              const frame = buffer.slice(0, end)
              buffer = buffer.slice(end + 2)
              const lines = frame.split('\n')
              if (lines.some((line) => line.trim() === 'event: delta')) {
                const data = lines
                  .filter((line) => line.startsWith('data:'))
                  .map((line) => line.slice(5).trimStart())
                  .join('\n')
                const value: unknown = JSON.parse(data)
                if (
                  typeof value === 'object' &&
                  value !== null &&
                  'content' in value &&
                  typeof value.content === 'string'
                )
                  for (const match of value.content.matchAll(/@(\d+),(\d+)\|/g))
                    samples.push(
                      Math.max(0, Date.now() - started - (Number(match[1]) - Number(match[2]))),
                    )
              }
              end = buffer.indexOf('\n\n')
            }
            if (chunk.done) break
          }
        } finally {
          reader.releaseLock()
        }
        encoding = response.headers.get('Content-Encoding')
      }
      samples.sort((a, b) => a - b)
      return {
        samples: samples.length,
        p95MS: samples[Math.max(0, Math.ceil(samples.length * 0.95) - 1)] ?? -1,
        encoding,
      }
    },
    { id, token },
  )
  expect(latency.samples).toBe(60)
  expect(latency.p95MS).toBeLessThan(100)
  expect(latency.encoding).toBeNull()
  writeFileSync(
    info.outputPath('chat-stream-performance.json'),
    JSON.stringify(
      {
        environment:
          'CI Chromium, local upstream fixture; event maximum is an upper bound for sampled interactions, not a field INP score',
        ...metrics,
        platformLatency: latency,
      },
      null,
      2,
    ),
  )
}

async function unusedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No debug port')
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  return address.port
}
export async function desktopLighthouse(
  baseURL: string,
  email: string,
  password: string,
  info: TestInfo,
) {
  const port = await unusedPort()
  const context = await chromium.launchPersistentContext('', {
    headless: true,
    args: ['--remote-debugging-port=' + port],
    viewport: { width: 1440, height: 900 },
  })
  try {
    const page = await context.newPage()
    await page.goto(baseURL + '/login')
    await page.getByLabel('邮箱地址', { exact: true }).fill(email)
    await page.getByLabel('密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '进入 Lumi', exact: true }).click()
    await expect(page).toHaveURL(/\/chat$/)
    await expect(page.getByRole('button', { name: '选择模型', exact: true })).toBeEnabled()
    await page.waitForLoadState('networkidle')
    const scripts = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter(
          (url) =>
            new URL(url).pathname.startsWith('/assets/') && new URL(url).pathname.endsWith('.js'),
        ),
    )
    const assets = fileURLToPath(new URL('../../backend/web/dist/', import.meta.url))
    let gzipBytes = 0
    for (const source of new Set(scripts)) {
      const name = new URL(source).pathname.split('/').at(-1)
      if (name) gzipBytes += gzipSync(readFileSync(assets + 'assets/' + name)).length
    }
    expect(gzipBytes).toBeLessThanOrEqual(250000)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.clearBrowserCache')
    await cdp.detach()
    const { default: lighthouse } = await import('lighthouse')
    const result = await lighthouse(baseURL + '/chat', {
      port,
      onlyCategories: ['performance'],
      disableStorageReset: true,
      formFactor: 'desktop',
      screenEmulation: {
        mobile: false,
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        disabled: false,
      },
      throttlingMethod: 'provided',
      logLevel: 'error',
      maxWaitForLoad: 30000,
    })
    if (!result) throw new Error('Lighthouse produced no report')
    const score = (result.lhr.categories.performance?.score ?? 0) * 100
    const audits = result.lhr.audits
    writeFileSync(
      info.outputPath('chat-lighthouse.json'),
      JSON.stringify(
        {
          environment:
            'Authenticated desktop, cold HTTP cache, CI-provided CPU/network, Lighthouse 13.5.0',
          score,
          initialScriptGzipBytes: gzipBytes,
          firstContentfulPaint: audits['first-contentful-paint']?.numericValue,
          largestContentfulPaint: audits['largest-contentful-paint']?.numericValue,
          totalBlockingTime: audits['total-blocking-time']?.numericValue,
          cumulativeLayoutShift: audits['cumulative-layout-shift']?.numericValue,
        },
        null,
        2,
      ),
    )
    expect(score).toBeGreaterThanOrEqual(90)
  } finally {
    await context.close()
  }
}
