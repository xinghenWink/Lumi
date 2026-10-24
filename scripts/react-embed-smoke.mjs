import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile, readFile, unlink, rmdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { postgresReady, redisReady } from './lib/react-embed-readiness.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suffix = randomBytes(6).toString('hex'),
  label = 'io.lumi.react-embed-run',
  prefix = 'lumi-react-embed-' + suffix,
  network = prefix + '-network',
  tag = 'lumi-react-embed:' + suffix,
  output = join(root, '.tools', 'react-embed', suffix),
  secrets = join(output, 'secrets')
const owned = [],
  files = [],
  secretValues = []
let networkCreated = false
const docker = (args) =>
  execFileSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(command + ' exited ' + code)),
    )
  })
}
async function secretFile(name, contents, mode = 0o600) {
  const path = join(secrets, name)
  await writeFile(path, contents, { mode, flag: 'wx' })
  files.push(path)
  return path
}
async function waitFor(check, description, assertAlive) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    assertAlive?.()
    try {
      if (await check()) return
    } catch {
      /* Dependencies may still be starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('Timed out waiting for ' + description)
}
function start(name, args) {
  if (!name.startsWith(prefix + '-')) throw new Error('Unowned container name')
  docker(['create', '--name', name, '--label', label + '=' + suffix, '--network', network, ...args])
  owned.push(name)
  docker(['start', name])
}
await mkdir(secrets, { recursive: true, mode: 0o700 })
try {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty =
      execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== '',
    buildCommit = commit + (dirty ? '-dirty' : '')
  await run('docker', [
    'build',
    '--build-arg',
    'VERSION=react-embed-smoke',
    '--build-arg',
    'COMMIT=' + buildCommit,
    '--build-arg',
    'BUILD_TIME=' + new Date().toISOString(),
    '-t',
    tag,
    '.',
  ])
  const imageID = docker(['image', 'inspect', tag, '--format', '{{.Id}}'])
  await writeFile(
    join(output, 'report.json'),
    JSON.stringify({ commit: buildCommit, imageID, passed: false }, null, 2) + '\n',
  )
  docker(['network', 'create', '--label', label + '=' + suffix, network])
  networkCreated = true
  const databasePassword = randomBytes(24).toString('hex'),
    cachePassword = randomBytes(24).toString('hex'),
    password = randomBytes(24).toString('base64url') + 'Aa1',
    jwtSecret = randomBytes(32).toString('base64url'),
    encryptionKey = randomBytes(32).toString('base64'),
    email = 'embed-' + suffix + '@lumi.test'
  secretValues.push(databasePassword, cachePassword, password, jwtSecret, encryptionKey)
  const pgEnv = await secretFile(
      'postgres.env',
      'POSTGRES_USER=lumi\nPOSTGRES_DB=lumi\nPOSTGRES_PASSWORD=' + databasePassword + '\n',
    ),
    redisEnv = await secretFile('redis.env', 'REDISCLI_AUTH=' + cachePassword + '\n'),
    redisConfig = await secretFile(
      'redis.conf',
      'bind 0.0.0.0\nprotected-mode yes\nrequirepass ' + cachePassword + '\n',
      0o644,
    )
  start(prefix + '-pg', ['--network-alias', 'postgres', '--env-file', pgEnv, 'postgres:16-alpine'])
  start(prefix + '-redis', [
    '--network-alias',
    'redis',
    '--env-file',
    redisEnv,
    '--mount',
    'type=bind,src=' + redisConfig + ',dst=/usr/local/etc/redis/redis.conf,readonly',
    'redis:7-alpine',
    'redis-server',
    '/usr/local/etc/redis/redis.conf',
  ])
  await waitFor(() => postgresReady(docker, prefix + '-pg'), 'PostgreSQL TCP readiness')
  await waitFor(() => redisReady(docker, prefix + '-redis'), 'authenticated Redis readiness')
  // Reserve a loopback-only ephemeral port; no production ports or volumes are used.
  const listener = createServer()
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve))
  const address = listener.address()
  if (!address || typeof address === 'string') throw new Error('No loopback port')
  const baseURL = 'http://127.0.0.1:' + address.port
  await new Promise((resolve) => listener.close(resolve))
  const appEnv = await secretFile(
    'app.env',
    [
      'DATABASE_URL=postgres://lumi:' + databasePassword + '@postgres:5432/lumi?sslmode=disable',
      'REDIS_URL=redis://:' + cachePassword + '@redis:6379/0',
      'JWT_SECRET=' + jwtSecret,
      'ENCRYPTION_KEY=' + encryptionKey,
      'ADMIN_EMAIL=' + email,
      'ADMIN_PASSWORD=' + password,
      'PUBLIC_BASE_URL=' + baseURL,
      'COOKIE_SECURE=false',
      // A real environment override is part of the container acceptance matrix.
      'SITE_NAME=Lumi Docker',
    ].join('\n') + '\n',
  )
  start(prefix + '-app', ['--env-file', appEnv, '-p', '127.0.0.1:' + address.port + ':8080', tag])
  await waitFor(
    async () => (await fetch(baseURL + '/readyz')).ok,
    'production readiness',
    () => {
      const state = JSON.parse(docker(['inspect', prefix + '-app', '--format', '{{json .State}}']))
      if (!state.Running)
        throw new Error('Production fixture exited before readiness (exit ' + state.ExitCode + ')')
    },
  )
  const version = await (await fetch(baseURL + '/api/version')).json()
  if (version.commit !== buildCommit) throw new Error('Embedded version differs from build')
  await writeFile(
    join(output, 'report.json'),
    JSON.stringify({ commit: buildCommit, imageID, version, passed: false }, null, 2) + '\n',
  )
  // Resolve the already locked Playwright CLI directly to avoid shell interpolation on Windows.
  const frontendPackage = JSON.parse(await readFile(join(root, 'frontend', 'package.json'), 'utf8'))
  const cli = join(root, 'frontend', 'node_modules', '@playwright', 'test', 'cli.js')
  await run(process.execPath, [cli, 'test', '--config', 'playwright.embed.config.ts'], {
    cwd: join(root, 'frontend'),
    env: {
      ...process.env,
      E2E_EMBED_URL: baseURL,
      E2E_EMBED_EMAIL: email,
      E2E_EMBED_PASSWORD: password,
      E2E_EMBED_COMMIT: buildCommit,
    },
  })
  await writeFile(
    join(output, 'report.json'),
    JSON.stringify(
      {
        commit: buildCommit,
        imageID,
        version,
        playwright: frontendPackage.devDependencies['@playwright/test'],
        projects: ['chrome-desktop', 'chrome-mobile-320', 'chrome-mobile-390'],
        passed: true,
      },
      null,
      2,
    ) + '\n',
  )
  console.log('PASS: React production Docker embed; evidence: ' + output)
} catch (error) {
  const redact = (value) =>
    secretValues.reduce(
      (text, secret) =>
        text.split(secret).join('[redacted]').split(encodeURIComponent(secret)).join('[redacted]'),
      String(value),
    )
  const diagnostics = []
  for (const name of owned) {
    try {
      if (
        docker(['inspect', name, '--format', '{{index .Config.Labels "' + label + '"}}']) !== suffix
      )
        throw new Error('Unowned diagnostic target')
      const state = JSON.parse(docker(['inspect', name, '--format', '{{json .State}}']))
      const logs = spawnSync('docker', ['logs', '--tail', '80', name], {
        cwd: root,
        encoding: 'utf8',
      })
      diagnostics.push({
        name,
        status: state.Status,
        exitCode: state.ExitCode,
        error: redact(state.Error),
        logs: redact((logs.stdout ?? '') + (logs.stderr ?? '')),
      })
    } catch (failure) {
      diagnostics.push({ name, error: redact(failure.message) })
    }
  }
  await writeFile(
    join(output, 'diagnostics.json'),
    JSON.stringify({ error: redact(error.message), containers: diagnostics }, null, 2) + '\n',
  )
  console.error('FAIL: redacted fixture diagnostics saved to ' + output)
  throw error
} finally {
  const cleanupErrors = []
  for (const name of owned.reverse()) {
    try {
      if (
        docker(['inspect', name, '--format', '{{index .Config.Labels "' + label + '"}}']) !== suffix
      )
        throw new Error('Refusing to remove unowned container')
      docker(['rm', '-f', '-v', name])
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (networkCreated) {
    try {
      if (
        docker(['network', 'inspect', network, '--format', '{{index .Labels "' + label + '"}}']) !==
        suffix
      )
        throw new Error('Refusing to remove unowned network')
      docker(['network', 'rm', network])
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  for (const path of files) await unlink(path)
  await rmdir(secrets)
  if (cleanupErrors.length)
    throw new AggregateError(cleanupErrors, 'Isolated container cleanup failed')
}
