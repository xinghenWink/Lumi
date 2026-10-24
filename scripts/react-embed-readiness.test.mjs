import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { postgresReady, redisReady } from './lib/react-embed-readiness.mjs'

test(
  'production probes reject temporary PostgreSQL and require Redis authentication',
  {
    timeout: 120_000,
  },
  async () => {
    const suffix = randomBytes(6).toString('hex'),
      label = 'io.lumi.readiness-regression',
      directory = await mkdtemp(join(tmpdir(), 'lumi-readiness-')),
      owned = []
    const docker = (args) =>
      execFileSync('docker', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim()
    const wait = async (check) => {
      const deadline = Date.now() + 60_000
      while (Date.now() < deadline) {
        try {
          if (check()) return
        } catch {
          /* The real dependency is still starting. */
        }
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      throw new Error('Readiness regression deadline exceeded')
    }
    const start = (kind, args) => {
      const name = 'lumi-readiness-' + suffix + '-' + kind
      docker(['create', '--name', name, '--label', label + '=' + suffix, ...args])
      owned.push(name)
      docker(['start', name])
      return name
    }
    try {
      const pgEnv = join(directory, 'postgres.env'),
        initSQL = join(directory, 'initialize.sql'),
        redisEnv = join(directory, 'redis.env'),
        redisConfig = join(directory, 'redis.conf'),
        password = randomBytes(24).toString('hex')
      await writeFile(
        pgEnv,
        'POSTGRES_USER=lumi\nPOSTGRES_DB=lumi\nPGPORT=55432\nPOSTGRES_PASSWORD=' + password + '\n',
        { mode: 0o600 },
      )
      await writeFile(
        initSQL,
        'SELECT pg_sleep(12);\nCREATE TABLE public.fixture_ready AS SELECT 1 AS marker;\n',
        { mode: 0o644 },
      )
      await writeFile(redisEnv, 'REDISCLI_AUTH=' + password + '\n', { mode: 0o600 })
      await writeFile(
        redisConfig,
        'bind 0.0.0.0\nport 56379\nprotected-mode yes\nrequirepass ' + password + '\n',
        { mode: 0o644 },
      )
      const pg = start('pg', [
        '--env-file',
        pgEnv,
        '--mount',
        'type=bind,src=' + initSQL + ',dst=/docker-entrypoint-initdb.d/initialize.sql,readonly',
        'postgres:16-alpine',
        'postgres',
        '-p',
        '55432',
      ])
      await wait(() =>
        docker(['logs', pg]).includes('running /docker-entrypoint-initdb.d/initialize.sql'),
      )
      assert.match(
        docker(['exec', pg, 'pg_isready', '-p', '55432', '-U', 'lumi', '-d', 'lumi']),
        /accepting connections/,
      )
      assert.throws(
        () => postgresReady(docker, pg, 55432),
        'TCP must reject the temporary initialization server',
      )
      await wait(() => postgresReady(docker, pg, 55432))
      assert.equal(
        docker([
          'exec',
          pg,
          'psql',
          '-p',
          '55432',
          '-U',
          'lumi',
          '-d',
          'lumi',
          '-tAc',
          'SELECT marker FROM public.fixture_ready',
        ]),
        '1',
      )
      const redis = start('redis', [
        '--env-file',
        redisEnv,
        '--mount',
        'type=bind,src=' + redisConfig + ',dst=/usr/local/etc/redis/redis.conf,readonly',
        'redis:7-alpine',
        'redis-server',
        '/usr/local/etc/redis/redis.conf',
      ])
      await wait(() => redisReady(docker, redis, 56379))
      assert.match(
        docker(['exec', '--env', 'REDISCLI_AUTH=', redis, 'redis-cli', '-p', '56379', 'ping']),
        /NOAUTH/,
      )
      assert.equal(redisReady(docker, redis, 56379), true)
    } finally {
      try {
        for (const name of owned.reverse()) {
          assert.equal(
            docker(['inspect', name, '--format', '{{index .Config.Labels "' + label + '"}}']),
            suffix,
          )
          docker(['rm', '-f', '-v', name])
        }
      } finally {
        // mkdtemp supplies the exact owned directory; never enumerate unrelated resources.
        assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
        assert.match(basename(directory), /^lumi-readiness-[A-Za-z0-9]+$/)
        await rm(directory, { recursive: true, force: true })
      }
    }
  },
)
