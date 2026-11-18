import { randomBytes, randomUUID } from 'node:crypto'
import { record } from '../../src/api/transport'
import { adminFixture, login, noOverflow } from './admin-helpers'
import { expect, test } from './test'

test('imports a GitHub release as editable Markdown and publishes it explicitly', async ({
  page,
  baseURL,
}, info) => {
  const f = await adminFixture(page, baseURL)
  const published = 'Release notes ' + randomUUID()
  const version = 'v1.2.3'
  let id: string | undefined
  let unavailable = true
  await page.route('**/api/v1/admin/announcements/github-releases?*', async (route) => {
    if (unavailable) {
      unavailable = false
      await route.fulfill({ status: 503, json: { code: 'ANNOUNCEMENT_GITHUB_UNAVAILABLE' } })
      return
    }
    const first = new URL(route.request().url()).searchParams.get('page') === '1'
    await route.fulfill({
      json: {
        items: [
          {
            version: first ? 'v1.2.4' : version,
            name: first ? 'Newer release' : 'Selected release',
            notes: first ? '' : '- First update\n- Second update',
            published_at: '2026-11-17T08:00:00Z',
          },
        ],
        stale: first,
        next_page: first ? 2 : 0,
      },
    })
  })
  try {
    await page.goto('/admin/announcements')
    await page.getByRole('button', { name: '从 GitHub 导入', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '从 GitHub 导入' })
    await expect(picker.getByRole('alert')).toContainText('暂时无法获取 GitHub 版本')
    await picker.getByRole('button', { name: '重试', exact: true }).click()
    await expect(picker).toContainText('正在显示上次获取的版本')
    await picker.getByRole('button', { name: '下一页', exact: true }).click()
    await noOverflow(page)
    await picker.getByRole('button', { name: /v1\.2\.3 Selected release/ }).click()
    const editor = page.getByRole('dialog', { name: '新增公告' })
    const field = editor.getByLabel('公告内容（Markdown）', { exact: true })
    await expect(field).toHaveValue('## v1.2.3\n\n- First update\n- Second update')
    await expect(field).toBeFocused()
    await expect(editor.getByRole('radio', { name: '系统更新', exact: true })).toBeChecked()
    await expect(editor.getByRole('radio', { name: '历史展示', exact: true })).toBeChecked()
    await expect(page.locator('.ops-section').filter({ hasText: 'Selected release' })).toHaveCount(
      0,
    )
    await field.fill(`## ${version}\n\n**${published}**\n\n- Edited update`)
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/admin/announcements') && response.request().method() === 'POST',
    )
    await editor.getByRole('button', { name: '发布公告' }).click()
    const response = await saved
    expect(response.ok()).toBe(true)
    const row = record(await response.json())
    id = String(row.id)
    expect(row.github_release_tag).toBe(version)
    expect(row.announcement_type).toBe('system_update')
    expect(row.display_mode).toBe('history')
    const card = page.locator('.ops-section').filter({ hasText: published })
    await expect(card.getByRole('link', { name: `GitHub 来源版本 ${version}` })).toHaveAttribute(
      'href',
      `https://github.com/xinghenWink/Lumi/releases/tag/${version}`,
    )
    await page.getByRole('button', { name: '公告', exact: true }).click()
    const notice = page.getByRole('dialog', { name: '系统公告' })
    await expect(notice.locator('strong')).toHaveText(published)
    await noOverflow(page)
    await page.screenshot({
      path: info.outputPath('release-announcement.png'),
      animations: 'disabled',
    })
  } finally {
    if (id) await f.api('DELETE', '/admin/announcements/' + id)
  }
})

test('presents system update history newest first and keeps standalone notices separate', async ({
  page,
  baseURL,
}, info) => {
  const f = await adminFixture(page, baseURL)
  const ids: string[] = []
  const oldTitle = 'Older update ' + randomUUID()
  const latestTitle = 'Latest update ' + randomUUID()
  const dailyTitle = 'Daily notice ' + randomUUID()
  try {
    const older = await f.api('POST', '/admin/announcements', {
      announcement_type: 'system_update',
      display_mode: 'history',
      starts_at: new Date(Date.now() - 120_000).toISOString(),
      ends_at: new Date(Date.now() - 60_000).toISOString(),
      content: `## ${oldTitle}\n\n${Array.from({ length: 12 }, (_, index) => `- Change ${index + 1}`).join('\n')}`,
      enabled: true,
      version: 0,
    })
    ids.push(String(older.id))
    await page.goto('/admin/announcements')
    await page.getByRole('button', { name: '新增公告', exact: true }).click()
    const editor = page.getByRole('dialog', { name: '新增公告' })
    const type = editor.getByRole('radiogroup', { name: '公告类型' })
    const mode = editor.getByRole('radiogroup', { name: '展示方式' })
    const historyChoice = mode.getByRole('radio', { name: '历史展示' })
    const standalone = mode.getByRole('radio', { name: '单独展示' })
    await expect(type.getByRole('radio', { name: '日常', exact: true })).toBeChecked()
    await expect(standalone).toBeChecked()
    await type.getByRole('radio', { name: '系统更新', exact: true }).check()
    await expect(historyChoice).toBeChecked()
    await standalone.check()
    await historyChoice.check()
    await editor.getByLabel('公告内容（Markdown）', { exact: true }).fill(`## ${latestTitle}`)
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/admin/announcements') && response.request().method() === 'POST',
    )
    await editor.getByRole('button', { name: '保存修改', exact: true }).click()
    const latest = await saved
    expect(latest.ok()).toBe(true)
    const row = record(await latest.json())
    ids.push(String(row.id))
    expect(row.announcement_type).toBe('system_update')
    expect(row.display_mode).toBe('history')
    await expect(editor).toHaveCount(0)
    const daily = await f.api('POST', '/admin/announcements', {
      content: dailyTitle,
      starts_at: new Date(Date.now() - 60_000).toISOString(),
      ends_at: null,
      enabled: true,
      version: 0,
    })
    ids.push(String(daily.id))

    await page.getByRole('button', { name: '公告', exact: true }).click()
    const notice = page.getByRole('dialog', { name: '系统公告' })
    const history = notice.getByRole('region', { name: '系统更新历史' })
    const entries = history.getByRole('list').first().locator(':scope > li')
    await expect(entries).toHaveCount(2)
    await expect(entries.nth(0)).toContainText(latestTitle)
    await expect(entries.nth(1)).toContainText(oldTitle)
    await expect(notice.getByRole('article')).toContainText(dailyTitle)
    await expect(history).not.toContainText(dailyTitle)
    await history.getByText('Change 12', { exact: true }).scrollIntoViewIfNeeded()
    await expect(history.getByText('Change 12', { exact: true })).toBeInViewport()
    await expect(notice.getByRole('button', { name: '当前关闭' })).toBeVisible()
    await noOverflow(page)
    await page.screenshot({
      path: info.outputPath('announcement-history.png'),
      animations: 'disabled',
    })
  } finally {
    for (const id of ids) await f.api('DELETE', '/admin/announcements/' + id)
  }
})

test('announcements match the browser day and the authenticated session', async ({
  page,
  baseURL,
}) => {
  const f = await adminFixture(page, baseURL)
  const adminPassword = process.env.E2E_ADMIN_PASSWORD
  if (!baseURL || !adminPassword) throw new Error('Missing administration fixture')
  const headers = { 'X-Lumi-CSRF': '1', Origin: baseURL }
  const logout = async () => {
    expect((await page.request.post('/api/v1/auth/logout', { headers })).ok()).toBe(true)
  }
  const users = ['First', 'Second'].map((nickname) => ({
    email: `${randomUUID()}@lumi.test`,
    password: `${randomBytes(24).toString('base64url')}Aa1`,
    nickname,
    role: 'user',
    initial_credits: 0,
  }))
  const userIds: { id: string; email: string }[] = []
  const [first, second] = users
  if (!first || !second) throw new Error('Missing member fixtures')
  const title = 'System update ' + randomUUID()
  let id: string | undefined
  const trigger = page.getByRole('button', { name: '公告', exact: true })
  const dialog = page.getByRole('dialog', { name: '系统公告' })
  const current = dialog.getByRole('button', { name: '当前关闭' })
  const today = dialog.getByRole('button', { name: '今日关闭' })
  try {
    for (const user of users) {
      const created = await f.api('POST', '/admin/users', user)
      userIds.push({ id: String(created.id), email: user.email })
    }
    id = String(
      (
        await f.api('POST', '/admin/announcements', {
          content: title,
          starts_at: new Date(Date.now() - 60_000).toISOString(),
          ends_at: null,
          enabled: true,
          version: 0,
        })
      ).id,
    )
    await logout()
    await login(page, first.email, first.password)
    await expect(dialog).toContainText(title)
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(trigger).toBeFocused()

    await page.reload()
    await trigger.click()
    await expect(dialog).toContainText(title)
    await current.click()

    await logout()
    await login(page, first.email, first.password)
    await expect(dialog).toContainText(title)
    const [before, after] = await page.evaluate(() => [
      new Date(2030, 0, 10, 23, 59).toISOString(),
      new Date(2030, 0, 11, 0, 0).toISOString(),
    ])
    if (!before || !after) throw new Error('Missing browser time fixture')
    await page.clock.setFixedTime(new Date(before))
    await today.click()

    await logout()
    await login(page, first.email, first.password)
    await trigger.click()
    await expect(dialog).toContainText(title)
    await today.click()

    await logout()
    await login(page, second.email, second.password)
    await expect(dialog).toContainText(title)
    await current.click()

    await page.clock.setFixedTime(new Date(after))
    await logout()
    await login(page, first.email, first.password)
    await expect(dialog).toContainText(title)
    await noOverflow(page)
  } finally {
    const admin = await page.request.post('/api/v1/auth/login', {
      headers,
      data: { email: f.email, password: adminPassword },
    })
    expect(admin.ok()).toBe(true)
    const token = String(record(await admin.json()).access_token)
    if (id) await f.api('DELETE', '/admin/announcements/' + id, undefined, token)
    for (const user of userIds)
      await f.api('DELETE', '/admin/users/' + user.id, { email: user.email }, token)
  }
})
