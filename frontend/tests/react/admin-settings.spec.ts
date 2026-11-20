import { randomUUID } from 'node:crypto'
import { test, expect } from './test'
import { adminFixture, noOverflow } from './admin-helpers'
import { observeErrors } from '../browser-errors'
import { parseConfiguration } from '../../src/api/chat'
import { parseImageConfiguration } from '../../src/api/images'
import { defaultCapabilities, parseModel } from '../../src/api/catalog-contracts'
import { parsePricing } from '../../src/api/credit-contracts'
import { modelInput } from '../../src/react/features/admin/catalog'

test('real versioned chat and image settings preserve drafts on conflicts and reject duplicate ratios', async ({
  page,
  baseURL,
}, info) => {
  const f = await adminFixture(page, baseURL),
    errors: string[] = []
  observeErrors(page, errors)
  const chat = parseConfiguration(await f.api('GET', '/admin/chat-settings')),
    image = parseImageConfiguration(await f.api('GET', '/admin/image-settings'))
  try {
    await page.goto('/admin/chat-settings')
    await page.getByLabel('全局 system prompt', { exact: true }).fill('Unsaved local draft')
    const updated = parseConfiguration(
      await f.api('PUT', '/admin/chat-settings', {
        ...chat,
        system_prompt: 'Concurrent server edit',
      }),
    )
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('配置已被其他操作修改')
    await expect(page.getByLabel('全局 system prompt', { exact: true })).toHaveValue(
      'Unsaved local draft',
    )
    await page.getByRole('button', { name: '刷新', exact: true }).click()
    await expect(page.getByLabel('全局 system prompt', { exact: true })).toHaveValue(
      updated.system_prompt,
    )
    await page.getByLabel('全局 system prompt', { exact: true }).fill('Confirmed configuration')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('聊天设置已保存')
    await page.reload()
    await expect(page.getByLabel('全局 system prompt', { exact: true })).toHaveValue(
      'Confirmed configuration',
    )
    const savedChat = parseConfiguration(await f.api('GET', '/admin/chat-settings'))
    expect(savedChat).toMatchObject({
      ...chat,
      system_prompt: 'Confirmed configuration',
      version: updated.version + 1,
    })
    await page.goto('/admin/image-settings')
    const ratioMapping = page.getByLabel('比例映射（每行 比例=尺寸）', { exact: true })
    await page.locator('details').filter({ has: ratioMapping }).locator('summary').click()
    const size = image.sizes[0]
    if (!size) throw new Error('Missing actual image size')
    await page
      .getByLabel('比例映射（每行 比例=尺寸）', { exact: true })
      .fill('1:1=' + size + '\n1:1 =' + size)
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    expect(parseImageConfiguration(await f.api('GET', '/admin/image-settings')).version).toBe(
      image.version,
    )
    await page.getByLabel('比例映射（每行 比例=尺寸）', { exact: true }).fill(
      Object.entries(image.ratio_sizes)
        .map(([ratio, size]) => ratio + '=' + size)
        .join('\n'),
    )
    await page.getByLabel('最大生成张数', { exact: true }).fill('1')
    const latest = parseImageConfiguration(
      await f.api('PUT', '/admin/image-settings', {
        ...image,
        retention_days: image.retention_days === 1 ? 2 : 1,
      }),
    )
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('配置已被其他操作修改')
    await expect(page.getByLabel('最大生成张数', { exact: true })).toHaveValue('1')
    await page.getByRole('button', { name: '刷新', exact: true }).click()
    await expect(page.getByLabel('最大生成张数', { exact: true })).toHaveValue(String(latest.max_n))
    await page.getByLabel('最大生成张数', { exact: true }).fill('2')
    const auto = page.getByRole('switch', { name: '自动', exact: true })
    await expect(auto).toBeChecked()
    await auto.uncheck()
    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('生图设置已保存')
    await page.reload()
    await expect(page.getByLabel('最大生成张数', { exact: true })).toHaveValue('2')
    await expect(auto).not.toBeChecked()
    const savedImage = parseImageConfiguration(await f.api('GET', '/admin/image-settings'))
    expect(savedImage).toEqual({
      ...latest,
      max_n: 2,
      disabled_ratios: [...(latest.disabled_ratios ?? []), 'auto'],
      version: latest.version + 1,
    })
    await noOverflow(page)
    await page.screenshot({
      path: info.outputPath('versioned-image-settings.png'),
      animations: 'disabled',
    })
    expect(errors).toEqual([])
  } finally {
    const currentChat = parseConfiguration(await f.api('GET', '/admin/chat-settings')),
      currentImage = parseImageConfiguration(await f.api('GET', '/admin/image-settings'))
    await f.api('PUT', '/admin/chat-settings', { ...chat, version: currentChat.version })
    await f.api('PUT', '/admin/image-settings', { ...image, version: currentImage.version })
  }
})

test('real model version conflict and explicit pricing override retain server-owned prices and decimals', async ({
  page,
  baseURL,
}, info) => {
  const f = await adminFixture(page, baseURL),
    errors: string[] = [],
    suffix = randomUUID().slice(0, 10)
  observeErrors(page, errors)
  const pricing = await f.api('GET', '/admin/pricing')
  const model = parseModel(
    await f.api('POST', '/admin/models', {
      version: 0,
      display_name: 'Pricing model ' + suffix,
      type: 'image',
      description: '',
      icon: '',
      sort_order: 0,
      enabled: false,
      is_default: false,
      capabilities: defaultCapabilities('image'),
      routes: [],
    }),
  )
  try {
    await page.goto('/admin/models')
    await page.getByRole('searchbox').fill(suffix)
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await page
      .getByRole('row')
      .filter({ hasText: model.display_name })
      .getByRole('button', { name: '编辑模型 ' + model.display_name, exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('描述', { exact: true }).fill('Unsaved model description')
    await f.api('PUT', '/admin/models/' + model.id, {
      ...modelInput(model),
      description: 'Concurrent model description',
    })
    await dialog.getByRole('button', { name: '保存模型', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('配置已被其他操作修改')
    await expect(dialog.getByLabel('描述', { exact: true })).toHaveValue(
      'Unsaved model description',
    )
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await page.reload()
    await page.getByRole('searchbox').fill(suffix)
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await expect(page.getByRole('row').filter({ hasText: model.display_name })).toContainText(
      'Concurrent model description',
    )
    await page.goto('/admin/pricing')
    await page.getByRole('button', { name: '添加模型规则', exact: true }).click()
    const override = page
      .getByRole('row')
      .filter({ has: page.getByLabel('模型 ID', { exact: true }) })
      .last()
    await override.getByLabel('模型 ID', { exact: true }).fill(model.id)
    await override.getByLabel('操作', { exact: true }).selectOption('generate')
    await override.getByLabel('质量', { exact: true }).selectOption('low')
    await expect(override.getByRole('spinbutton')).toHaveValue('')
    await override.getByRole('spinbutton').fill('9')
    await page.getByLabel('改图倍率', { exact: true }).fill('1.25')
    await page.getByRole('button', { name: '保存价格与赠送', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('价格与赠送配置已保存')
    await page.reload()
    await expect(page.getByLabel('改图倍率', { exact: true })).toHaveValue('1.25')
    const result = await f.api('GET', '/admin/pricing')
    if (!Array.isArray(result.rules)) throw new Error('Missing actual pricing rules')
    expect(result.rules).toContainEqual({
      model_id: model.id,
      operation: 'generate',
      quality: 'low',
      credits_per_image: 9,
      enabled: true,
    })
    await noOverflow(page)
    await page.screenshot({
      path: info.outputPath('model-price-override.png'),
      animations: 'disabled',
    })
    expect(errors).toEqual([])
  } finally {
    await f.api('PUT', '/admin/pricing', pricing)
    await f.api('DELETE', '/admin/models/' + model.id)
  }
})

test('advanced image qualities are opt-in, priced by model, and keyboard selectable', async ({
  page,
  baseURL,
}, info) => {
  const f = await adminFixture(page, baseURL)
  const mobile = info.project.name.includes('mobile')
  await page.emulateMedia({ colorScheme: mobile ? 'dark' : 'light' })
  const suffix = randomUUID().slice(0, 10)
  const displayName = 'Advanced quality ' + suffix
  const pricing = parsePricing(await f.api('GET', '/admin/pricing'))
  const channel = await f.api('POST', '/admin/upstreams', {
    version: 0,
    name: displayName,
    base_url: 'http://127.0.0.1:1/v1',
    api_key: 'browser-quality-fixture',
    timeout_chat_s: 5,
    timeout_image_s: 5,
    enabled: true,
    priority: 0,
    weight: 1,
    edit_format: 'multipart',
  })
  let modelId: string | undefined
  try {
    const model = parseModel(
      await f.api('POST', '/admin/models', {
        version: 0,
        display_name: displayName,
        type: 'image',
        enabled: true,
        capabilities: {
          ...defaultCapabilities('image'),
          qualities: ['low', 'medium', 'high'],
        },
        routes: [
          {
            upstream_id: channel.id,
            upstream_model_name: 'image-2.6',
            priority: 0,
            weight: 1,
            enabled: true,
          },
        ],
      }),
    )
    modelId = model.id
    const dialog = page.getByRole('dialog')
    const extra = dialog.getByRole('checkbox', { name: '超高（xhigh）', exact: true })
    const maximum = dialog.getByRole('checkbox', { name: '最高（max）', exact: true })
    const openEditor = async () => {
      await page.goto('/admin/models')
      await page.getByRole('searchbox').fill(suffix)
      await page.getByRole('button', { name: '搜索', exact: true }).click()
      await page.getByRole('button', { name: '编辑模型 ' + displayName, exact: true }).click()
    }
    const saveModel = async () => {
      await dialog.getByRole('button', { name: '保存模型', exact: true }).click()
      await expect(dialog).toHaveCount(0)
    }
    const qualityOptions = async () => {
      await page.goto('/create')
      await page.getByRole('button', { name: '选择模型', exact: true }).click()
      await page.getByRole('menuitemradio', { name: displayName, exact: true }).click()
      if (mobile) await page.getByRole('button', { name: '生图参数', exact: true }).click()
      return page
        .getByRole(mobile ? 'dialog' : 'region', { name: '生图参数', exact: true })
        .getByRole('radiogroup', { name: '质量', exact: true })
    }
    await openEditor()
    await expect(extra).not.toBeChecked()
    await expect(maximum).not.toBeChecked()
    await extra.press('Space')
    await maximum.check()
    await expect(dialog.getByText(/请在「价格与赠送」中/)).toBeVisible()
    await saveModel()
    await openEditor()
    await expect(extra).toBeChecked()
    await expect(maximum).toBeChecked()

    const group = await qualityOptions()
    await expect(group.getByRole('radio')).toHaveCount(3)
    await expect(group.getByRole('radio', { name: '超高', exact: true })).toHaveCount(0)
    await page.goto('/admin/pricing')
    for (const quality of ['xhigh', 'max']) {
      await page.getByRole('button', { name: '添加模型规则', exact: true }).click()
      const rule = page
        .getByRole('row')
        .filter({ has: page.getByLabel('模型 ID', { exact: true }) })
        .last()
      await rule.getByLabel('模型 ID', { exact: true }).fill(model.id)
      await rule.getByLabel('操作', { exact: true }).selectOption('generate')
      await rule.getByLabel('质量', { exact: true }).selectOption(quality)
      await rule.getByRole('spinbutton').fill(quality === 'xhigh' ? '11' : '17')
      if (quality === 'max') await rule.getByRole('checkbox').uncheck()
    }
    await page.getByRole('button', { name: '保存价格与赠送', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('价格与赠送配置已保存')
    await qualityOptions()
    await expect(group.getByRole('radio', { name: '超高', exact: true })).toBeVisible()
    await expect(group.getByRole('radio', { name: '最高', exact: true })).toHaveCount(0)

    const updated = parsePricing(await f.api('GET', '/admin/pricing'))
    await f.api('PUT', '/admin/pricing', {
      ...updated,
      rules: updated.rules.map((rule) =>
        rule.model_id === model.id && rule.quality === 'max' ? { ...rule, enabled: true } : rule,
      ),
    })
    await qualityOptions()
    await expect(group.getByRole('radio')).toHaveCount(5)
    const extraRadio = group.getByRole('radio', { name: '超高', exact: true })
    await expect(extraRadio).toBeEnabled()
    await extraRadio.press('ArrowRight')
    await expect(group.getByRole('radio', { name: '最高', exact: true })).toBeChecked()
    expect(
      await group
        .locator('label > span > span')
        .evaluateAll((labels) => labels.every((label) => label.scrollWidth <= label.clientWidth)),
    ).toBe(true)
    await expect(page.locator('html')).toHaveAttribute('data-theme', mobile ? 'dark' : 'light')
    await noOverflow(page)
    await page.screenshot({
      path: info.outputPath('advanced-image-qualities.png'),
      animations: 'disabled',
    })

    await openEditor()
    await extra.uncheck()
    await saveModel()
    await qualityOptions()
    await expect(group.getByRole('radio', { name: '最高', exact: true })).toBeVisible()
    await expect(group.getByRole('radio', { name: '超高', exact: true })).toHaveCount(0)
  } finally {
    await f.api('PUT', '/admin/pricing', pricing)
    if (modelId) await f.api('DELETE', '/admin/models/' + modelId)
    await f.api('DELETE', '/admin/upstreams/' + String(channel.id))
  }
})
