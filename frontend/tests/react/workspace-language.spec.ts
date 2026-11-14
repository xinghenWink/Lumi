import { login } from './admin-helpers'
import { expect, test } from './test'

test('workspace language switches with the keyboard and persists in the account', async ({
  page,
}, info) => {
  const { E2E_ADMIN_EMAIL: email, E2E_ADMIN_PASSWORD: password } = process.env
  if (!email || !password) throw new Error('Real E2E administrator fixture is required')
  await page.emulateMedia({ colorScheme: 'light' })
  await login(page, email, password)

  const chineseHeading = page.getByRole('heading', { name: '今天想创造什么？' })
  const englishHeading = page.getByRole('heading', { name: 'What would you like to create today?' })
  const chineseTrigger = page.getByRole('button', { name: '切换语言（简体中文）' })
  const englishTrigger = page.getByRole('button', { name: 'Change language (English)' })
  const chineseOption = page.getByRole('menuitemradio', { name: '简体中文' })
  const englishOption = page.getByRole('menuitemradio', { name: 'English' })
  await expect(chineseHeading).toBeVisible()

  await page.route('**/api/v1/me', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 503, json: { code: 'UNKNOWN_ERROR' } })
      : route.continue(),
  )
  await chineseTrigger.click()
  await expect(chineseOption).toBeChecked()
  await englishOption.click()
  await expect(page.getByRole('alert').filter({ hasText: '操作暂未完成' })).toBeVisible()
  await expect(chineseHeading).toBeVisible()
  await page.unroute('**/api/v1/me')

  await chineseTrigger.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('End')
  await expect(englishOption).toBeFocused()
  await page.screenshot({ path: info.outputPath('workspace-language-light.png') })
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/me') && response.request().method() === 'PATCH',
  )
  await page.keyboard.press('Enter')
  const response = await saved
  expect(response.ok()).toBe(true)
  expect(response.request().postDataJSON()).toEqual({ locale: 'en' })
  await expect(englishTrigger).toBeFocused()
  await expect(englishHeading).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  const mode = page.getByRole('navigation', { name: 'Creation mode' })
  await expect(mode).toBeVisible()
  const [modeBounds, headingBounds] = await Promise.all([
    mode.boundingBox(),
    englishHeading.boundingBox(),
  ])
  if (!modeBounds || !headingBounds) throw new Error('Chat layout is missing')
  expect(headingBounds.y).toBeGreaterThanOrEqual(modeBounds.y + modeBounds.height)

  await page.reload()
  await expect(englishTrigger).toBeVisible()
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await englishTrigger.click()
  await expect(englishOption).toBeChecked()
  await page.screenshot({ path: info.outputPath('workspace-language-dark.png') })
  await page.keyboard.press('Escape')
  await expect(englishTrigger).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  await page.goto('/me')
  await expect(page.getByLabel('Language', { exact: true })).toHaveValue('en')
  await page.getByLabel('Display name', { exact: true }).fill('Language switch draft')
  await englishTrigger.click()
  await chineseOption.click()
  await expect(page.getByLabel('界面语言', { exact: true })).toHaveValue('zh-CN')
  await expect(page.getByLabel('昵称', { exact: true })).toHaveValue('Language switch draft')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByText('修改已保存', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(page.getByLabel('昵称', { exact: true })).toHaveValue('Language switch draft')
})
