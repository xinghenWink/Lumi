import { expect, test, type Page } from '@playwright/test'
import { defaultCapabilities } from '../../src/api/catalog-contracts'
import type { ImageFile, ImageInput, ImageTask } from '../../src/api/images'
import { conversation, task } from '../../src/features/images/test-fixtures'
import { fixturePNG } from '../image-fixture'

const workspace = { ...conversation, id: 'workspace', model_id: 'current-model' }
const referenceId = 'a100'
const sourceTasks: ImageTask[] = [
  { ...task, id: 'plain', prompt: '从这张图找到原任务', ratio: '1:1' },
  {
    ...task,
    id: 'with-reference',
    prompt: '保留原始参考图\n第二行提示词也应显示',
    operation: 'edit',
    ratio: '1:1',
    reference_file_ids: [referenceId],
    edit_options: { action: 'markup', guide_file_id: 'a200' },
  },
]

async function mockImageAPI(page: Page) {
  const user = {
    id: task.user_id,
    timezone: 'Asia/Shanghai',
    email: 'gallery@example.test',
    nickname: 'Gallery member',
    status: 'active',
    role: 'user',
    locale: 'zh-CN',
    created_at: task.created_at,
    last_login_at: null,
    last_login_ip: '',
  }
  const options = {
    max_n: 2,
    max_references: 3,
    max_upload_bytes: 10 * 1024 * 1024,
    sizes: ['1024x1024'],
    ratio_sizes: { '1:1': '1024x1024' },
    per_user_concurrency: 1,
    global_concurrency: 2,
    timeout_seconds: 30,
    queue_timeout_seconds: 60,
    split_requests: false,
    retention_days: 0,
    admin_can_view_content: false,
    version: 1,
  }
  const png = fixturePNG()
  function file(id: string, kind: ImageFile['kind'] = 'generated'): ImageFile {
    return {
      id,
      kind,
      mime: 'image/png',
      size: png.length,
      width: 900,
      height: 600,
      thumbnail_width: 300,
      thumbnail_height: 200,
      url: '/api/v1/files/' + id + '?sig=fixture',
      thumbnail_url: '/api/v1/files/' + id + '/thumb?sig=fixture',
      expires_at: 4_000_000_000,
      created_at: task.created_at,
    }
  }
  const conversations = new Map([[workspace.id, workspace]])
  const accepted = new Map<string, ImageTask>()
  const detailReads: string[] = []
  const created: string[] = []
  const submissions: Array<{ key: string; body: ImageInput }> = []
  let detailFailure = false
  let submitFailure: 'lost' | 'credits' | undefined
  const paged = (items: unknown[]) => ({ items, next_cursor: '' })
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.slice('/api/v1'.length)
    const json = (value: unknown, status = 200) => route.fulfill({ status, json: value })
    if (path === '/auth/refresh')
      return json({ user, access_token: 'fixture', token_type: 'Bearer', expires_in: 3600 })
    if (path === '/public/config')
      return json({
        registration_enabled: false,
        email_verification_enabled: false,
        site: {
          name: 'Lumi',
          description: '',
          footer: '',
          contact: '',
          terms_url: '',
          privacy_url: '',
        },
      })
    if (path === '/me/preferences')
      return json({
        theme: 'system',
        instructions: '',
        image_quality: 'medium',
        image_ratio: '',
        image_count: 1,
      })
    if (path === '/me/credits')
      return json({
        user_id: user.id,
        timezone: user.timezone,
        permanent_balance: 100,
        daily_balance: 0,
        total: 100,
        daily_reset_on: '',
        next_reset_at: '',
        version: 1,
      })
    if (path === '/me/credits/quote') return json({ unit_price: 10, total_cost: 10, count: 1 })
    if (path === '/image-options') return json(options)
    if (path === '/models')
      return json({
        items: [task.model_id, workspace.model_id].map((id) => ({
          id,
          type: 'image',
          display_name: id === task.model_id ? task.model_name : 'Workspace model',
          icon: '',
          description: '',
          is_default: id === task.model_id,
          sort_order: 0,
          capabilities: {
            ...defaultCapabilities('image'),
            sizes: options.sizes,
            qualities: ['medium'],
            max_n: 2,
            supports_edit: true,
            max_reference_images: 3,
          },
        })),
      })
    if (path === '/me/images')
      return json(
        paged(
          sourceTasks.map((task, index) => ({
            ...task,
            task_id: task.id,
            file: file('b00' + index),
          })),
        ),
      )
    if (path === '/image-conversations') {
      if (request.method() !== 'POST') return json(paged([...conversations.values()]))
      const { id, model_id } = request.postDataJSON() as Pick<typeof workspace, 'id' | 'model_id'>
      const row = { ...workspace, id, model_id }
      created.push(id)
      conversations.set(id, row)
      return json(row, 201)
    }
    if (path.startsWith('/image-conversations/'))
      return json(conversations.get(path.split('/').at(-1) ?? ''))
    if (path === '/image-tasks') {
      if (request.method() !== 'POST')
        return json(
          paged(
            [...accepted.values()].filter(
              (task) => task.conversation_id === url.searchParams.get('conversation_id'),
            ),
          ),
        )
      const key = request.headers()['idempotency-key'] ?? ''
      const body = request.postDataJSON() as ImageInput
      submissions.push({ key, body })
      const failure = submitFailure
      submitFailure = undefined
      if (failure === 'credits') return json({ code: 'INSUFFICIENT_CREDITS' }, 409)
      const row = accepted.get(key) ?? { ...task, ...body, id: 'regenerated-' + accepted.size }
      accepted.set(key, row)
      if (failure === 'lost') return route.abort('failed')
      return json(row, 201)
    }
    if (path.startsWith('/image-tasks/')) {
      const id = path.split('/').at(-1) ?? ''
      detailReads.push(id)
      if (detailFailure) return json({ code: 'IMAGE_TASK_NOT_FOUND' }, 404)
      return json(sourceTasks.find((task) => task.id === id))
    }
    if (path.startsWith('/files/')) {
      if (path.endsWith('/metadata')) return json(file(referenceId, 'upload'))
      return route.fulfill({
        body: png,
        contentType: path.endsWith('/thumb') ? 'image/webp' : 'image/png',
      })
    }
    return json(paged([]))
  })
  return {
    detailReads,
    created,
    submissions,
    accepted,
    failDetails: (fail: boolean) => {
      detailFailure = fail
    },
    failSubmit: (failure: typeof submitFailure) => {
      submitFailure = failure
    },
  }
}

const name = (name: string) => ({ name, exact: true })
const preview = (page: Page) => page.getByRole('dialog', name('预览图片'))
const details = (page: Page) => page.getByRole('dialog', name('任务详情'))
const prompt = (page: Page) => page.getByRole('textbox', name('画面描述'))

async function openGallery(page: Page) {
  const menu = page.getByRole('button', name('打开导航菜单'))
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('link', name('我的图库')).click()
}

test('restores the current gallery image into the open conversation and preserves its draft on regeneration', async ({
  page,
}, info) => {
  const api = await mockImageAPI(page)
  await page.goto('/create/' + workspace.id)
  await expect(page.getByRole('button', name('选择模型'))).toContainText('Workspace model')
  await prompt(page).fill('保留这份未提交草稿')
  await openGallery(page)
  await page.getByRole('button', name('预览图片')).first().click()
  expect(api.detailReads).toEqual([])
  const trigger = preview(page).getByRole('button', name('任务详情'))
  api.failDetails(true)
  await trigger.press('Enter')
  await expect(details(page).getByRole('alert')).toBeVisible()
  api.failDetails(false)
  await details(page).getByRole('button', name('重试')).click()
  await expect(details(page)).toContainText(sourceTasks[0]?.prompt ?? '')
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await trigger.press('Enter')
  await expect(details(page)).toContainText('第二行提示词也应显示')
  await expect(details(page).getByRole('img', name('参考图'))).toBeVisible()
  await expect(details(page)).toContainText('实际 10 积分')
  expect(
    await details(page).evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true)
  await page.screenshot({
    path: info.outputPath('gallery-task-details-light.png'),
    animations: 'disabled',
  })
  await details(page).getByRole('button', name('重新编辑')).click()
  await expect(details(page)).toContainText('替换当前工作台中未提交的提示词和参考图')
  await details(page).getByRole('button', name('确认继续')).click()
  await expect(page).toHaveURL(/\/create\/workspace$/)
  await expect(prompt(page)).toHaveValue(sourceTasks[1]?.prompt ?? '')
  await expect(page.getByRole('button', name('选择模型'))).toContainText(task.model_name)
  await expect(page.locator('.image-references').getByRole('img')).toHaveCount(1)
  expect(api.submissions).toHaveLength(0)

  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', name('资产库')).click()
  await page.getByRole('button', name('预览图片')).nth(1).click()
  await preview(page).getByRole('button', name('任务详情')).click()
  await expect(details(page)).toContainText('第二行提示词也应显示')
  await page.screenshot({
    path: info.outputPath('gallery-task-details-dark.png'),
    animations: 'disabled',
  })
  api.failSubmit('credits')
  const regenerate = details(page).getByRole('button', name('重新生成'))
  await regenerate.click()
  await expect(details(page).getByRole('alert')).toBeVisible()
  await regenerate.click()
  await expect(details(page)).toHaveCount(0)
  await expect(page.locator('[data-task-id="regenerated-0"]')).toBeVisible()
  await expect(prompt(page)).toHaveValue(sourceTasks[1]?.prompt ?? '')
  expect(api.created).toEqual([])
  expect(api.submissions[1]?.body).toMatchObject({
    conversation_id: workspace.id,
    model_id: task.model_id,
    reference_file_ids: [referenceId],
    edit_options: sourceTasks[1]?.edit_options,
  })
})

test('uses a new conversation when none is open and retries regeneration with the same request', async ({
  page,
}) => {
  const api = await mockImageAPI(page)
  await page.goto('/me/images')
  await page.getByRole('button', name('预览图片')).first().click()
  await preview(page).getByRole('button', name('任务详情')).click()
  await details(page).getByRole('button', name('重新编辑')).click()
  await expect(page).toHaveURL(/\/create$/)
  await expect(prompt(page)).toHaveValue(sourceTasks[0]?.prompt ?? '')
  expect(api.created).toEqual([])

  await page.getByRole('button', name('资产库')).click()
  await page.getByRole('button', name('预览图片')).nth(1).click()
  await preview(page).getByRole('button', name('任务详情')).click()
  api.failSubmit('lost')
  await details(page).getByRole('button', name('重新生成')).click()
  await expect(details(page)).toHaveCount(0)
  await expect(page).toHaveURL(/\/create$/)
  await expect(prompt(page)).toHaveValue(sourceTasks[0]?.prompt ?? '')
  await page.getByRole('button', name('重试上次提交')).click()
  await expect(page).toHaveURL(/\/create\/[\da-f-]+$/)
  await expect(page.locator('[data-task-id="regenerated-0"]')).toBeVisible()
  expect(api.created).toHaveLength(1)
  expect(api.submissions).toHaveLength(2)
  expect(api.submissions[0]?.key).toBeTruthy()
  expect(api.submissions[1]).toEqual(api.submissions[0])
  expect(api.accepted.size).toBe(1)
})
