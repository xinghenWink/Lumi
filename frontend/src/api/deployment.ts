import type { components } from './schema'
import { integer, text } from './operations'
import { authorized } from './protected'
import { ApiError, record } from './transport'

export type DeploymentRelease = components['schemas']['DeploymentRelease']
export type DeploymentJob = components['schemas']['DeploymentJob']
type DeploymentReleases = components['schemas']['DeploymentReleases']
type DeploymentRequest = components['schemas']['DeploymentRequest']

const stages = [
  'queued',
  'preflight',
  'stopping',
  'backup',
  'switching',
  'verifying',
  'reverting',
  'succeeded',
  'failed',
  'rolled_back',
  'recovery_required',
] as const satisfies readonly DeploymentJob['stage'][]

function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  const matched = choices.find((candidate) => candidate === value)
  if (matched === undefined) throw new ApiError('RESPONSE_INVALID')
  return matched
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new ApiError('RESPONSE_INVALID')
  return value
}

function release(value: unknown): DeploymentRelease {
  const item = record(value)
  const version = text(item.version)
  const url = text(item.url)
  if (
    !/^v\d+\.\d+\.\d+$/.test(version) ||
    url !== 'https://github.com/xinghenWink/Lumi/releases/tag/' + version
  )
    throw new ApiError('RESPONSE_INVALID')
  return {
    version,
    url,
    name: text(item.name),
    notes: text(item.notes),
    published_at: text(item.published_at),
    current: bool(item.current),
    action: choice(item.action, ['', 'update', 'rollback'] as const),
    reason: text(item.reason),
  }
}

function job(value: unknown): DeploymentJob {
  const item = record(value)
  return {
    id: text(item.id),
    action: choice(item.action, ['update', 'rollback'] as const),
    source_version: text(item.source_version),
    source_digest: text(item.source_digest),
    target_version: text(item.target_version),
    target_digest: text(item.target_digest),
    stage: choice(item.stage, stages),
    reason: text(item.reason),
    created_at: text(item.created_at),
    updated_at: text(item.updated_at),
    finished_at: item.finished_at === null ? null : text(item.finished_at),
  }
}

function catalogue(value: unknown): DeploymentReleases {
  const item = record(value)
  if (!Array.isArray(item.items)) throw new ApiError('RESPONSE_INVALID')
  return {
    current_digest: text(item.current_digest),
    latest: item.latest === null ? null : release(item.latest),
    items: item.items.map(release),
    checked_at: item.checked_at === null ? null : text(item.checked_at),
    stale: bool(item.stale),
    next_page: integer(item.next_page),
    executor_reason: text(item.executor_reason),
    recent_job: item.recent_job === null ? null : job(item.recent_job),
  }
}

const systemPath = '/api/v1/admin/system'

export const deployment = {
  releases(page: number, refresh: boolean, signal?: AbortSignal) {
    return authorized(
      systemPath + '/releases?page=' + page + (refresh ? '&refresh=1' : ''),
      catalogue,
      signal ? { signal } : {},
    )
  },
  enqueue(body: DeploymentRequest, idempotencyKey: string) {
    return authorized(systemPath + '/deployment-jobs', job, {
      method: 'POST',
      body,
      idempotencyKey,
    })
  },
  job(id: string, signal: AbortSignal) {
    return authorized(systemPath + '/deployment-jobs/' + encodeURIComponent(id), job, { signal })
  },
}
