export function postgresReady(docker, name, port = 5432, database = 'lumi') {
  // Initialization's temporary server accepts Unix sockets before production TCP exists.
  return docker([
    'exec',
    name,
    'pg_isready',
    '-h',
    '127.0.0.1',
    '-p',
    String(port),
    '-U',
    'lumi',
    '-d',
    database,
  ]).includes('accepting connections')
}

export function redisReady(docker, name, port = 6379) {
  return (
    docker([
      'exec',
      name,
      'redis-cli',
      '--no-auth-warning',
      '-h',
      '127.0.0.1',
      '-p',
      String(port),
      'ping',
    ]) === 'PONG'
  )
}
