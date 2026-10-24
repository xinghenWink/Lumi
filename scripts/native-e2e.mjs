import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile, unlink, rmdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { postgresReady, redisReady } from './lib/react-embed-readiness.mjs'

const command = process.argv[2]
if (process.platform !== 'linux') throw new Error('Native CI host networking requires Linux')
if (!['test:e2e', 'test:e2e:react'].includes(command)) throw new Error('Unexpected browser command')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  suffix = randomBytes(6).toString('hex'),
  label = 'io.lumi.native-e2e-run',
  prefix = 'lumi-native-e2e-' + suffix,
  output = join(root, '.tools', 'native-e2e', suffix),
  secrets = join(output, 'secrets'),
  password = randomBytes(24).toString('hex'),
  database = 'lumi_native_e2e',
  postgresPort = 25432,
  redisPort = 26379,
  owned = [],
  files = []
const docker = (args) =>
  execFileSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
const redact = (value) => String(value).split(password).join('[redacted]')
async function secretFile(name, contents, mode = 0o600) {
  const path = join(secrets, name)
  await writeFile(path, contents, { mode, flag: 'wx' })
  files.push(path)
  return path
}
function start(name, args) {
  if (!name.startsWith(prefix + '-')) throw new Error('Unowned fixture name')
  docker(['create', '--name', name, '--label', label + '=' + suffix, '--network', 'host', ...args])
  owned.push(name)
  docker(['start', name])
}
async function waitFor(check) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    for (const name of owned) {
      const state = JSON.parse(docker(['inspect', name, '--format', '{{json .State}}']))
      if (!state.Running) throw new Error('Native dependency exited: ' + name)
    }
    try {
      if (check()) return
    } catch {
      /* The dependency may still be initializing. */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('Native dependency readiness deadline exceeded')
}
async function assertFree(port) {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}
await mkdir(secrets, { recursive: true, mode: 0o700 })
try {
  await assertFree(postgresPort)
  await assertFree(redisPort)
  const pgEnv = await secretFile(
      'postgres.env',
      'POSTGRES_USER=lumi\nPOSTGRES_DB=' +
        database +
        '\nPOSTGRES_PASSWORD=' +
        password +
        '\nPGPORT=' +
        postgresPort +
        '\n',
    ),
    redisEnv = await secretFile('redis.env', 'REDISCLI_AUTH=' + password + '\n'),
    redisConfig = await secretFile(
      'redis.conf',
      'bind 127.0.0.1\nport ' + redisPort + '\nprotected-mode yes\nrequirepass ' + password + '\n',
      0o644,
    )
  start(prefix + '-pg', [
    '--env-file',
    pgEnv,
    'postgres:16-alpine',
    'postgres',
    '-c',
    'listen_addresses=127.0.0.1',
    '-p',
    String(postgresPort),
  ])
  start(prefix + '-redis', [
    '--env-file',
    redisEnv,
    '--mount',
    'type=bind,src=' + redisConfig + ',dst=/usr/local/etc/redis/redis.conf,readonly',
    'redis:7-alpine',
    'redis-server',
    '/usr/local/etc/redis/redis.conf',
  ])
  await waitFor(() => postgresReady(docker, prefix + '-pg', postgresPort, database))
  await waitFor(() => redisReady(docker, prefix + '-redis', redisPort))
  const durability = docker([
    'exec',
    prefix + '-pg',
    'psql',
    '-U',
    'lumi',
    '-d',
    database,
    '-tAc',
    "SELECT current_setting('fsync') || ',' || current_setting('synchronous_commit') || ',' || current_setting('full_page_writes')",
  ])
  if (durability !== 'on,on,on')
    throw new Error('PostgreSQL durability differs from production defaults')
  const topology = owned.map((name) => {
    const network = docker(['inspect', name, '--format', '{{.HostConfig.NetworkMode}}'])
    if (network !== 'host') throw new Error('Native fixture unexpectedly uses port forwarding')
    return { name, network, imageID: docker(['inspect', name, '--format', '{{.Image}}']) }
  })
  const report = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    command,
    topology,
    postgresPort,
    redisPort,
    durability,
  }
  await writeFile(
    join(output, 'report.json'),
    JSON.stringify({ ...report, passed: false }, null, 2) + '\n',
  )
  console.log(
    'Native browser fixture: host loopback, PostgreSQL durability on/on/on; report ' + output,
  )
  // Preserve the normal commands, full discovery and every existing assertion.
  await new Promise((resolve, reject) => {
    const child = spawn('pnpm', [command], {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        E2E_DATABASE_URL:
          'postgres://lumi:' +
          password +
          '@127.0.0.1:' +
          postgresPort +
          '/' +
          database +
          '?sslmode=disable',
        E2E_REDIS_URL: 'redis://:' + password + '@127.0.0.1:' + redisPort + '/0',
      },
    })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Native browser command exited ' + code)),
    )
  })
  await writeFile(
    join(output, 'report.json'),
    JSON.stringify({ ...report, passed: true }, null, 2) + '\n',
  )
} catch (error) {
  const containers = []
  for (const name of owned) {
    try {
      if (
        docker(['inspect', name, '--format', '{{index .Config.Labels "' + label + '"}}']) !== suffix
      )
        throw new Error('Unowned diagnostic target')
      const state = JSON.parse(docker(['inspect', name, '--format', '{{json .State}}']))
      const logs = spawnSync('docker', ['logs', '--tail', '60', name], { encoding: 'utf8' })
      containers.push({
        name,
        status: state.Status,
        exitCode: state.ExitCode,
        logs: redact((logs.stdout ?? '') + (logs.stderr ?? '')),
      })
    } catch (failure) {
      containers.push({ name, error: redact(failure.message) })
    }
  }
  await writeFile(
    join(output, 'diagnostics.json'),
    JSON.stringify({ error: redact(error.message), containers }, null, 2) + '\n',
  )
  throw error
} finally {
  const errors = []
  for (const name of owned.reverse()) {
    try {
      if (
        docker(['inspect', name, '--format', '{{index .Config.Labels "' + label + '"}}']) !== suffix
      )
        throw new Error('Refusing unowned container cleanup')
      docker(['rm', '-f', '-v', name])
    } catch (error) {
      errors.push(error)
    }
  }
  for (const path of files) await unlink(path)
  await rmdir(secrets)
  if (errors.length) throw new AggregateError(errors, 'Native browser fixture cleanup failed')
}
