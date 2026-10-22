import { createServer } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const database = new URL(process.env.E2E_DATABASE_URL ?? 'postgres://invalid')
// Test fixture commands must never write to an arbitrary development or production database.
if (
  !['127.0.0.1', 'localhost'].includes(database.hostname) ||
  !database.pathname.endsWith('_m7_load')
)
  throw new Error(
    'Use an explicit loopback database ending in _m7_load and a dedicated Redis database',
  )
if (!process.env.E2E_REDIS_URL) throw new Error('E2E_REDIS_URL required')
const output = resolve(root, '.tools/m7-load')
mkdirSync(output, { recursive: true })
const key = randomBytes(32).toString('base64url')
// Small valid PNG: image decoding, normalization, thumbnails and billing still execute.
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMIiDoBAAJwAXNTgWk3AAAAAElFTkSuQmCC'
const upstream = createServer(async (request, response) => {
  const received = Date.now()
  if (request.headers.authorization !== 'Bearer ' + key) {
    response.writeHead(401).end()
    return
  }
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (request.url === '/v1/chat/completions') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const delta = (content) =>
      response.write('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n')
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (input.messages?.[0]?.content?.startsWith('Return only')) {
      delta('Load conversation')
      response.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
      return
    }
    let count = 0
    const timer = setInterval(() => {
      delta('load ')
      if (++count === 20) {
        clearInterval(timer)
        delta('platform-timing:' + received + ':' + Date.now())
        response.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
      }
    }, 100)
    response.on('close', () => clearInterval(timer))
  } else if (request.url === '/v1/images/generations') {
    response
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ data: [{ b64_json: png }] }))
  } else if (request.url === '/v1/models') {
    response
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end('{"data":[{"id":"gpt-5-3-mini"},{"id":"gpt-image-2"}]}')
  } else response.writeHead(404).end()
})
await new Promise((done) => upstream.listen(0, '127.0.0.1', done))
const base = 'http://127.0.0.1:19080'
const env = {
  ...process.env,
  APP_ENV: 'test',
  HTTP_ADDR: '127.0.0.1:19080',
  PUBLIC_BASE_URL: base,
  DATABASE_URL: process.env.E2E_DATABASE_URL,
  REDIS_URL: process.env.E2E_REDIS_URL,
  DATA_DIR: resolve(output, 'data'),
  JWT_SECRET: randomBytes(32).toString('base64url'),
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  ADMIN_EMAIL: 'load-admin@lumi.test',
  ADMIN_PASSWORD: randomBytes(32).toString('hex') + 'Aa1',
  COOKIE_SECURE: 'false',
  GIN_MODE: 'release',
  UPSTREAM_ALLOW_PRIVATE_NETWORKS: 'true',
  UPSTREAM_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`,
  UPSTREAM_API_KEY: key,
  E2E_LOAD_OUTPUT: resolve(output, 'actors.json'),
}
const log = openSync(resolve(output, 'application.log'), 'w', 0o600)
const app = spawn(
  resolve(root, process.platform === 'win32' ? 'bin/lumi.exe' : 'bin/lumi'),
  ['serve'],
  { env, stdio: ['ignore', log, log] },
)
let appError
app.on('error', (error) => {
  appError = error
})
const stopped = new Promise((done) => app.on('exit', done))
try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (appError || app.exitCode !== null)
      throw new Error('Load app failed; inspect private application.log')
    try {
      ready = (await fetch(base + '/readyz')).ok
    } catch {
      /* Startup retries are bounded. */
    }
    if (ready) break
    await new Promise((done) => setTimeout(done, 300))
  }
  if (!ready) throw new Error('Load app readiness timed out')
  let token = ''
  async function api(method, path, body) {
    const response = await fetch(base + '/api/v1' + path, {
      method,
      headers: {
        Origin: base,
        'X-Lumi-CSRF': '1',
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`Fixture API ${path}: ${response.status}`)
    return response.status === 204 ? undefined : response.json()
  }
  token = (
    await api('POST', '/auth/login', { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD })
  ).access_token
  const pricing = await api('GET', '/admin/pricing')
  pricing.configuration.signup_bonus_credits = 10000
  await api('PUT', '/admin/pricing', pricing)
  const chat = (await api('GET', '/models?type=chat')).items[0]
  const image = (await api('GET', '/models?type=image')).items[0]
  execFileSync(
    process.env.LUMI_LOAD_SEED_BIN ?? 'go',
    process.env.LUMI_LOAD_SEED_BIN
      ? []
      : ['run', '-tags=integration', './internal/testsupport/loadseed'],
    {
      cwd: resolve(root, 'backend'),
      env,
      stdio: 'inherit',
    },
  )
  const k6env = {
    ...process.env,
    LUMI_BASE_URL: base,
    LUMI_ORIGIN: base,
    LUMI_CHAT_MODEL: chat.id,
    LUMI_IMAGE_MODEL: image.id,
    LUMI_ACTORS: env.E2E_LOAD_OUTPUT,
  }
  // The runner expects k6 on PATH; CI installs a pinned standalone binary.
  const k6 = spawn(
    process.env.K6_BIN ?? 'k6',
    [
      'run',
      '--summary-export',
      resolve(output, 'summary.json'),
      resolve(root, 'scripts/performance/load.js'),
    ],
    { env: k6env, stdio: 'inherit' },
  )
  const code = await new Promise((done, reject) => {
    k6.on('error', reject)
    k6.on('exit', done)
  })
  writeFileSync(
    resolve(output, 'environment.json'),
    JSON.stringify(
      {
        users: 100,
        readers: 75,
        chatStreams: 20,
        imageSubmitters: 5,
        duration: process.env.LUMI_DURATION ?? '60s',
        upstream: 'local deterministic SSE / PNG fixture; excludes real upstream latency',
        exitCode: code,
      },
      null,
      2,
    ),
  )
  if (code !== 0) throw new Error('k6 thresholds failed')
} finally {
  app.kill('SIGTERM')
  await Promise.race([stopped, new Promise((done) => setTimeout(done, 65000).unref())])
  if (app.exitCode === null) app.kill('SIGKILL')
  upstream.closeAllConnections()
  await new Promise((done) => upstream.close(done))
  closeSync(log)
}
