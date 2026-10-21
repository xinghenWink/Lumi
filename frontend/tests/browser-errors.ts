import type { Page } from '@playwright/test'

export function observeErrors(page: Page, errors: string[]) {
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    // Expected API rejections use inline errors; framework failures must fail QA.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:'))
      errors.push(message.text())
  })
}
