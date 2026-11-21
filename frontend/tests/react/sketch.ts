import { expect, type Locator, type Page } from '@playwright/test'

export function isSketchUpload(url: string, method: string) {
  return new URL(url).pathname === '/api/v1/files' && method === 'POST'
}

export async function drawStroke(page: Page, paper: Locator, touch: boolean) {
  await paper.scrollIntoViewIfNeeded()
  const box = await paper.boundingBox()
  if (!box) throw new Error('Sketch paper is out of view')
  const x = box.x + box.width / 4
  const y = box.y + box.height / 4
  const to = { x: x + box.width / 2, y: y + box.height / 3 }
  if (touch) {
    const input = await page.context().newCDPSession(page)
    try {
      await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [to] })
      await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } finally {
      await input.detach()
    }
  } else {
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await page.mouse.up()
  }
}

export async function openSketch(page: Page, destination: 'reference' | 'canvas') {
  const trigger = page.getByRole('button', { name: '绘制草图', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '绘制草图', exact: true })
  const paper = dialog.locator('canvas')
  const confirm = dialog.getByRole('button', {
    name: destination === 'canvas' ? '添加到画布' : '添加为参考图',
    exact: true,
  })
  await expect(confirm).toBeDisabled()
  await expect(paper).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  const rect = await paper.boundingBox()
  expect(rect?.width).toBeGreaterThan(200)
  expect(rect?.height).toBe(rect?.width)
  return { trigger, dialog, paper, confirm }
}
