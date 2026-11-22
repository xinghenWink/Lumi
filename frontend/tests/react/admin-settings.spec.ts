import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from './test'
import { adminFixture, noOverflow } from './admin-helpers'
import { observeErrors } from '../browser-errors'
import { fixturePNG } from '../image-fixture'
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

async function addModelPricingRule(page: Page) {
  await page.getByRole('button', { name: '添加模型规则', exact: true }).click()
  const trigger = page.getByRole('button', { name: '选择生图模型', exact: true }).last()
  await trigger.click()
  const picker = page.getByRole('dialog', { name: '选择生图模型', exact: true })
  return { picker, search: picker.getByRole('searchbox', { name: '搜索模型', exact: true }) }
}

test('real model version conflict and explicit pricing override retain server-owned prices and decimals', async ({
  page,
  baseURL,
}, info) => {
  const f = await adminFixture(page, baseURL),
    errors: string[] = [],
    suffix = randomUUID().slice(0, 10)
  observeErrors(page, errors)
  const pricing = await f.api('GET', '/admin/pricing')
  const channelName = 'Pricing channel ' + suffix
  const channel = await f.api('POST', '/admin/upstreams', {
    version: 0,
    name: channelName,
    base_url: 'http://127.0.0.1:1/v1',
    api_key: 'browser-pricing-fixture',
    timeout_chat_s: 5,
    timeout_image_s: 5,
    enabled: true,
    priority: 0,
    weight: 1,
    edit_format: 'multipart',
  })
  const model = parseModel(
    await f.api('POST', '/admin/models', {
      version: 0,
      display_name: 'Pricing model ' + suffix,
      type: 'image',
      description: '',
      icon: '',
      sort_order: 0,
      enabled: true,
      is_default: false,
      capabilities: defaultCapabilities('image'),
      routes: ['image-a', 'image-b'].map((upstream_model_name) => ({
        upstream_id: channel.id,
        upstream_model_name,
        priority: 0,
        weight: 1,
        enabled: true,
      })),
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
    const concurrent = parseModel(
      await f.api('PUT', '/admin/models/' + model.id, {
        ...modelInput(model),
        description: 'Concurrent model description',
      }),
    )
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
    const { picker, search } = await addModelPricingRule(page)
    const option = picker.getByRole('button', { name: new RegExp(model.id) })
    for (const term of [model.display_name, model.id, channelName]) {
      await search.fill(term)
      await expect(option).toBeVisible()
    }
    await expect(option.getByText('渠道 ' + channelName, { exact: true })).toBeVisible()
    await option.click()
    await expect(picker).toBeHidden()
    const override = page.getByRole('row').filter({ hasText: model.id })
    await override.getByLabel('操作', { exact: true }).selectOption('generate')
    await override.getByLabel('质量', { exact: true }).selectOption('low')
    await expect(override.getByRole('spinbutton')).toHaveValue('')
    await override.getByRole('spinbutton').fill('9')
    await page.getByLabel('改图倍率', { exact: true }).fill('1.25')
    const tier = (name: string) => page.getByLabel(name, { exact: true })
    await expect(tier('1K')).toHaveValue('1.00')
    await tier('2K').fill('1.6250')
    await tier('4K').fill('2.25')
    await page.getByRole('button', { name: '保存价格与赠送', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('价格与赠送配置已保存')
    await page.reload()
    await expect(page.getByLabel('改图倍率', { exact: true })).toHaveValue('1.25')
    await expect(tier('2K')).toHaveValue('1.6250')
    await expect(tier('4K')).toHaveValue('2.25')
    const result = await f.api('GET', '/admin/pricing')
    expect(result.configuration).toMatchObject({
      size_multipliers: { '1k': '1.00', '2k': '1.6250', '4k': '2.25' },
    })
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
    await expect(override).toContainText(model.display_name)
    await expect(override).toContainText(channelName)
    await f.api('PUT', '/admin/models/' + model.id, { ...modelInput(concurrent), enabled: false })
    await page.reload()
    await expect(override).toContainText('已停用')
    await override.getByRole('button', { name: '更换生图模型', exact: true }).click()
    await search.fill(model.id)
    await expect(option).toHaveCount(0)
    await expect(picker.getByText(/暂无已启用的生图模型|没有匹配的生图模型/)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(override.getByRole('button', { name: '移除规则', exact: true })).toBeEnabled()
    expect(errors).toEqual([])
  } finally {
    await f.api('PUT', '/admin/pricing', pricing)
    await f.api('DELETE', '/admin/models/' + model.id)
    await f.api('DELETE', '/admin/upstreams/' + String(channel.id))
  }
})

test('advanced image qualities follow global and model pricing and remain keyboard selectable', async ({
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
          supports_edit: true,
          max_reference_images: 1,
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
    await expect(dialog.getByText(/全局默认价/)).toBeVisible()
    await saveModel()
    await openEditor()
    await expect(extra).toBeChecked()
    await expect(maximum).toBeChecked()

    const group = await qualityOptions()
    const extraRadio = group.getByRole('radio', { name: '超高', exact: true })
    const maxRadio = group.getByRole('radio', { name: '最高', exact: true })
    const showQuote = async (points: number) => {
      if (mobile) await page.keyboard.press('Escape')
      await expect(page.getByText('预计 ' + points + ' 积分', { exact: true })).toBeVisible()
    }
    await expect(group.getByRole('radio')).toHaveCount(5)
    await maxRadio.check()
    await showQuote(10)
    await page.goto('/admin/pricing')
    await page.getByLabel('每张积分 改图 最高（max）', { exact: true }).fill('19')
    for (const quality of ['xhigh', 'max']) {
      const { picker, search } = await addModelPricingRule(page)
      await search.fill(model.id)
      await picker.getByRole('button', { name: new RegExp(model.id) }).click()
      const rule = page.getByRole('row').filter({ hasText: model.id }).last()
      await rule.getByLabel('操作', { exact: true }).selectOption('generate')
      await rule.getByLabel('质量', { exact: true }).selectOption(quality)
      await rule.getByRole('spinbutton').fill(quality === 'xhigh' ? '11' : '17')
      if (quality === 'max') await rule.getByRole('checkbox').uncheck()
    }
    await page.getByRole('button', { name: '保存价格与赠送', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('价格与赠送配置已保存')
    await qualityOptions()
    await extraRadio.check()
    await showQuote(11)
    if (mobile) await page.getByRole('button', { name: '生图参数', exact: true }).click()
    await maxRadio.check()
    await showQuote(10)
    await page.locator('input[type=file]').setInputFiles({
      name: 'pricing-reference.png',
      mimeType: 'image/png',
      buffer: fixturePNG(),
    })
    await expect(page.locator('.image-references img')).toHaveCount(1)
    await expect(page.getByText('预计 19 积分', { exact: true })).toBeVisible()

    const updated = parsePricing(await f.api('GET', '/admin/pricing'))
    await f.api('PUT', '/admin/pricing', {
      ...updated,
      rules: updated.rules.map((rule) =>
        rule.model_id === model.id && rule.quality === 'max' ? { ...rule, enabled: true } : rule,
      ),
    })
    await qualityOptions()
    await expect(group.getByRole('radio')).toHaveCount(5)
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
    await showQuote(17)

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

test('image model resolution defaults and selections persist through the admin form', async ({
  page,
  baseURL,
}, info) => {
  const f = await adminFixture(page, baseURL)
  const modelName = 'Resolution fixture ' + randomUUID().slice(0, 10)
  let modelID = ''
  try {
    await page.goto('/admin/models')
    await page.getByRole('button', { name: '切换深色主题', exact: true }).click()
    await page.getByRole('button', { name: '新增模型', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const oneK = dialog.getByRole('checkbox', { name: '1K', exact: true })
    const twoK = dialog.getByRole('checkbox', { name: '2K', exact: true })
    const fourK = dialog.getByRole('checkbox', { name: '4K', exact: true })
    await dialog.getByLabel('展示名称', { exact: true }).fill(modelName)
    await dialog.getByLabel('模型类型', { exact: true }).selectOption('image')
    await expect(oneK).toBeChecked()
    await expect(oneK).toBeDisabled()
    await expect(twoK).not.toBeChecked()
    await expect(fourK).not.toBeChecked()
    await twoK.focus()
    await page.keyboard.press('Space')
    await expect(twoK).toBeChecked()
    await noOverflow(page)
    await page.screenshot({
      path: info.outputPath('model-resolutions-dark.png'),
      animations: 'disabled',
    })
    const response = page.waitForResponse(
      (response) =>
        response.url().endsWith('/admin/models') && response.request().method() === 'POST',
    )
    await dialog.getByRole('button', { name: '保存模型', exact: true }).click()
    const saved = parseModel(await (await response).json())
    modelID = saved.id
    expect(saved.capabilities.supported_resolutions).toEqual(['1k', '2k'])
    await expect(dialog).toBeHidden()
    await page.reload()
    await page.getByRole('searchbox').fill(modelName)
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await page.getByRole('button', { name: '编辑模型 ' + modelName, exact: true }).click()
    await expect(oneK).toBeChecked()
    await expect(twoK).toBeChecked()
    await expect(fourK).not.toBeChecked()
  } finally {
    if (modelID) await f.api('DELETE', '/admin/models/' + modelID)
  }
})
