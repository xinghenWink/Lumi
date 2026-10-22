import type { components } from './schema'

export type Version = components['schemas']['Version']

export async function getVersion(signal?: AbortSignal): Promise<Version> {
  const response = await fetch('/api/version', signal ? { signal } : {})
  if (!response.ok) throw new Error('VERSION_UNAVAILABLE')

  // Generated types describe the contract; validate untrusted JSON at runtime too.
  const data: unknown = await response.json()
  if (
    typeof data !== 'object' ||
    data === null ||
    !('version' in data) ||
    typeof data.version !== 'string' ||
    !('commit' in data) ||
    typeof data.commit !== 'string' ||
    !('build_time' in data) ||
    typeof data.build_time !== 'string'
  ) {
    throw new Error('VERSION_INVALID')
  }
  return { version: data.version, commit: data.commit, build_time: data.build_time }
}
