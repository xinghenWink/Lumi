import { expect, test } from './test'
import { adminFixture, noOverflow } from './admin-helpers'
import type { components } from '../../src/api/schema'

type Release = components['schemas']['DeploymentRelease']
type Job = components['schemas']['DeploymentJob']

const time = '2026-11-16T00:00:00Z'
const jobID = '019a0735-0efb-74fc-aabb-96d76f0c7b3a'
const digest = 'sha256:' + 'a'.repeat(64)
const latest: Release = {
  version: 'v0.5.0',
  name: 'Lumi v0.5.0',
  notes: '发布说明示例',
  url: 'https://github.com/xinghenWink/Lumi/releases/tag/v0.5.0',
  published_at: time,
  action: 'update',
  current: false,
  reason: '',
}
const older: Release = {
  ...latest,
  version: 'v0.3.0',
  name: 'Lumi v0.3.0',
  url: 'https://github.com/xinghenWink/Lumi/releases/tag/v0.3.0',
  action: 'rollback',
}
const job: Job = {
  id: jobID,
  action: 'update',
  source_version: 'v0.4.0',
  source_digest: digest,
  target_version: latest.version,
  target_digest: 'sha256:' + 'b'.repeat(64),
  stage: 'queued',
  reason: '',
  created_at: time,
  updated_at: time,
  finished_at: null,
}

test('version management handles confirmation, restart, and stale releases', async ({
  page,
  baseURL,
}) => {
  await adminFixture(page, baseURL)
  let sent = false
  let stale = false
  let requests = 0
  await page.route('**/api/v1/admin/system/releases?*', async (route) => {
    const url = new URL(route.request().url())
    const secondPage = url.searchParams.get('page') === '2'
    const json: components['schemas']['DeploymentReleases'] = {
      current_digest: digest,
      latest: stale ? { ...latest, action: '', reason: 'DEPLOYMENT_UNVERIFIED' } : latest,
      items: secondPage ? [older] : [latest],
      checked_at: time,
      stale,
      executor_reason: '',
      next_page: secondPage ? 0 : 2,
      recent_job: sent ? job : null,
    }
    await route.fulfill({ json })
  })
  await page.route('**/api/v1/admin/system/deployment-jobs', async (route) => {
    expect(route.request().headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
    expect(route.request().postDataJSON()).toEqual({
      action: 'update',
      target_version: latest.version,
      expected_current_digest: digest,
    })
    sent = true
    await route.fulfill({ status: 202, json: job })
  })
  await page.route('**/api/v1/admin/system/deployment-jobs/' + jobID, async (route) => {
    requests++
    if (requests === 1) await route.fulfill({ status: 503, json: { code: 'MAINTENANCE' } })
    else await route.fulfill({ json: { ...job, stage: 'succeeded', finished_at: time } })
  })
  await page.goto('/admin/system')
  await expect(page.getByRole('heading', { name: '版本管理' })).toBeVisible()
  await expect(page.getByText('GitHub 最新正式版 v0.5.0')).toBeVisible()
  await page.getByRole('button', { name: '下一页' }).click()
  const rollback = page.getByRole('button', { name: '回滚到此版本' })
  await rollback.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('切换到 v0.3.0')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(rollback).toBeFocused()
  await page.getByRole('button', { name: '上一页' }).click()
  await page.getByRole('button', { name: '更新说明' }).click()
  await expect(dialog).toContainText('发布说明示例')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '更新到最新版' }).click()
  await dialog.getByRole('button', { name: '确认切换' }).click()
  await expect(page.getByText('服务连接中断，正在重新连接', { exact: false })).toBeVisible()
  await expect(page.getByText('版本切换成功')).toBeVisible({ timeout: 15_000 })
  stale = true
  const refresh = page.waitForRequest((req) => req.url().includes('refresh=1'))
  await page.getByRole('button', { name: '检查更新' }).click()
  await refresh
  await expect(page.getByText('暂时无法获取 GitHub 的最新数据', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: '更新到最新版' })).toHaveCount(0)
  await noOverflow(page)
})
