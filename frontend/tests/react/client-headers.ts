import { createHash } from 'node:crypto'
import type { TestInfo } from '@playwright/test'

export function journeyHeaders(info: TestInfo) {
  const digest = createHash('sha256').update(info.testId).digest()
  // Independent journeys represent separate clients; each journey retains shared real IP quotas.
  return { 'X-Forwarded-For': `198.19.${digest[0]}.${digest[1]}` }
}
