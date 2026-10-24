export function postgresReady(docker, name) {
  // Initialization's temporary server accepts Unix sockets before production TCP exists.
  return docker([
    'exec',
    name,
    'pg_isready',
    '-h',
    '127.0.0.1',
    '-p',
    '5432',
    '-U',
    'lumi',
    '-d',
    'lumi',
  ]).includes('accepting connections')
}

export function redisReady(docker, name) {
  return (
    docker(['exec', name, 'redis-cli', '--no-auth-warning', '-h', '127.0.0.1', 'ping']) === 'PONG'
  )
}
