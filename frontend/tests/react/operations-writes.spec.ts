import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test } from './test'
import { record } from '../../src/api/transport'
import { adminFixture, noOverflow } from './admin-helpers'
import { observeErrors } from '../browser-errors'

test('real announcement CRUD, optimistic conflicts, active banners and dashboard ranges', async ({
  page,
  baseURL,
}, info) => {
  const f = await adminFixture(page, baseURL),
    errors: string[] = [],
    first = 'Announcement ' + randomUUID(),
    second = 'Second ' + randomUUID()
  observeErrors(page, errors)
  const ids: string[] = []
  try {
    await page.goto('/admin/announcements')
    await page.getByRole('button', { name: '新增公告', exact: true }).click()
    let dialog = page.getByRole('dialog')
    await dialog.getByLabel('公告内容（Markdown）', { exact: true }).fill('**' + first + '**')
    await dialog
      .getByLabel('开始时间（UTC）', { exact: true })
      .fill(new Date(Date.now() - 120_000).toISOString().slice(0, 16))
    const created = page.waitForResponse(
      (r) => r.url().endsWith('/admin/announcements') && r.request().method() === 'POST',
    )
    await dialog.getByRole('button', { name: '保存修改', exact: true }).click()
    const row = record(await (await created).json())
    ids.push(String(row.id))
    await expect(dialog).not.toBeVisible()
    await expect(page.locator('.ops-announcements')).toContainText(first)
    const extra = await f.api('POST', '/admin/announcements', {
      content: second,
      starts_at: new Date(Date.now() - 60_000).toISOString(),
      ends_at: null,
      enabled: true,
      version: 0,
    })
    ids.push(String(extra.id))
    await page.reload()
    await expect(page.locator('.ops-announcements')).toContainText(first)
    await expect(page.locator('.ops-announcements')).toContainText(second)
    const card = page.locator('.ops-section').filter({ hasText: first })
    await card.getByRole('button', { name: '编辑', exact: true }).click()
    dialog = page.getByRole('dialog')
    const external = await f.api('PUT', '/admin/announcements/' + row.id, {
      ...row,
      content: first + ' external',
    })
    await dialog.getByLabel('公告内容（Markdown）', { exact: true }).fill(first + ' retained draft')
    const conflict = page.waitForResponse(
      (r) => r.url().endsWith('/admin/announcements/' + row.id) && r.request().method() === 'PUT',
    )
    await dialog.getByRole('button', { name: '保存修改', exact: true }).click()
    expect((await conflict).status()).toBe(409)
    await expect(dialog.getByRole('alert')).toBeVisible()
    await expect(dialog.getByLabel('公告内容（Markdown）', { exact: true })).toHaveValue(
      first + ' retained draft',
    )
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '刷新', exact: true }).click()
    await expect(card).toContainText('external')
    await card.getByRole('button', { name: '编辑', exact: true }).click()
    await dialog.getByLabel('公告内容（Markdown）', { exact: true }).fill(first + ' final')
    await dialog.getByLabel('启用', { exact: true }).uncheck()
    await dialog.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.locator('.ops-announcements')).not.toContainText(first)
    const stored = await f.api('GET', '/admin/announcements')
    expect(
      (stored.items as unknown[]).map(record).find((item) => item.id === row.id)?.version,
    ).toBe(Number(external.version) + 1)
    await card.getByRole('button', { name: '删除', exact: true }).click()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: '删除', exact: true }).click()
    await dialog.getByRole('button', { name: '确认操作', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(card).toHaveCount(0)
    ids.splice(ids.indexOf(String(row.id)), 1)
    await page.goto('/admin/dashboard')
    for (const [label, days] of [
      ['今日', '1'],
      ['最近 30 天', '30'],
      ['最近 7 天', '7'],
    ] as const) {
      const response = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname.endsWith('/admin/dashboard') &&
          new URL(r.url()).searchParams.get('days') === days,
      )
      await page.getByRole('button', { name: label, exact: true }).click()
      expect((await response).ok()).toBe(true)
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    }
    for (const heading of ['注册赠送', '每日赠送', '兑换发放', '管理员发放'])
      await expect(page.getByRole('columnheader', { name: heading, exact: true })).toBeVisible()
    await noOverflow(page)
    await page.screenshot({
      path: info.outputPath('operations-dashboard.png'),
      animations: 'disabled',
    })
    expect(errors).toEqual([])
  } finally {
    for (const id of ids) await f.api('DELETE', '/admin/announcements/' + id)
  }
})

test('real operations secret preserve and clear, maintenance, system confirmation and redacted audit', async ({
  page,
  baseURL,
}, info) => {
  const f = await adminFixture(page, baseURL),
    before = await f.api('GET', '/admin/operations-settings'),
    secret = randomBytes(24).toString('hex'),
    marker = 'blocked-' + randomUUID(),
    errors: string[] = []
  observeErrors(page, errors)
  expect(before.turnstile_secret_configured).toBe(false)
  try {
    await page.goto('/admin/operations-settings')
    await page.getByLabel('Turnstile Secret Key（留空保留）', { exact: true }).fill(secret)
    await page.getByLabel('每 IP 每 24 小时注册配额（0 不限制）', { exact: true }).fill('17')
    await page.getByLabel('熔断前连续失败次数', { exact: true }).fill('6')
    await page.getByLabel('熔断持续秒数', { exact: true }).fill('37')
    await page
      .getByLabel('生图提示词敏感词（每行一个）', { exact: true })
      .fill(marker + '\nsecond-word')
    await page.getByLabel('开启维护模式', { exact: true }).check()
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('修改已保存')
    await expect(page.getByLabel('Turnstile Secret Key（留空保留）', { exact: true })).toHaveValue(
      '',
    )
    const saved = await f.api('GET', '/admin/operations-settings')
    expect(saved).toMatchObject({
      turnstile_secret_configured: true,
      maintenance: true,
      register_per_ip_day: 17,
      circuit_failures: 6,
      circuit_seconds: 37,
      sensitive_words: [marker, 'second-word'],
    })
    expect(JSON.stringify(saved)).not.toContain(secret)
    await page.reload()
    await expect(page.getByLabel('开启维护模式', { exact: true })).toBeChecked()
    await page.getByLabel('开启维护模式', { exact: true }).uncheck()
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('修改已保存')
    expect((await f.api('GET', '/admin/operations-settings')).turnstile_secret_configured).toBe(
      true,
    )
    await page.getByLabel('启用 Turnstile', { exact: true }).check()
    await expect(
      page.getByLabel('清除已保存的 Turnstile 密钥（仅停用时可用）', { exact: true }),
    ).toBeDisabled()
    await page.getByLabel('启用 Turnstile', { exact: true }).uncheck()
    await page.getByLabel('清除已保存的 Turnstile 密钥（仅停用时可用）', { exact: true }).check()
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('修改已保存')
    expect((await f.api('GET', '/admin/operations-settings')).turnstile_secret_configured).toBe(
      false,
    )
    await noOverflow(page)
    await page.screenshot({
      path: info.outputPath('operations-settings.png'),
      animations: 'disabled',
    })
    await page.goto('/admin/system')
    let cleanupRequests = 0
    page.on('request', (r) => {
      if (r.url().endsWith('/admin/system/cleanup')) cleanupRequests++
    })
    await page.getByRole('button', { name: '清理过期图片', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    expect(cleanupRequests).toBe(0)
    await page.getByRole('button', { name: '清理过期图片', exact: true }).click()
    const cleanup = page.waitForResponse((r) => r.url().endsWith('/admin/system/cleanup'))
    await dialog.getByRole('button', { name: '确认操作', exact: true }).click()
    expect((await cleanup).status()).toBe(204)
    await expect(dialog).not.toBeVisible()
    expect(cleanupRequests).toBe(1)
    const testMail = page.waitForResponse((r) => r.url().endsWith('/admin/mail/test'))
    await page.getByRole('button', { name: '发送测试邮件给当前管理员', exact: true }).click()
    expect((await testMail).status()).toBe(503)
    await expect(page.getByRole('alert')).toBeVisible()
    await page.goto('/admin/audit')
    await page.getByLabel('操作类型', { exact: true }).selectOption('settings.update')
    await page.getByLabel('对象类型', { exact: true }).selectOption('operations')
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    const audit = page.getByRole('article').filter({ hasText: '修改系统设置' }).first()
    await expect(audit).toBeVisible()
    await audit.getByText('查看变更', { exact: true }).click()
    expect((await audit.locator('pre').allTextContents()).join('')).not.toContain(secret)
    await noOverflow(page)
    await page.screenshot({ path: info.outputPath('operations-audit.png'), animations: 'disabled' })
    expect(errors).toEqual([])
  } finally {
    const { turnstile_secret_configured: configured, ...settings } = before
    void configured
    await f.api('PUT', '/admin/operations-settings', { ...settings, turnstile_secret: '' })
  }
})
