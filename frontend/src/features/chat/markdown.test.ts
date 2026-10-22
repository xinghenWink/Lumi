import { describe, it, expect } from 'vitest'
import { partitionMarkdown, renderMarkdown } from './markdown'
describe('safe incremental markdown', () => {
  it('keeps unfinished code and math in the tail while closing stable paragraphs', () => {
    const parts = partitionMarkdown('first\n\n```go\none\n\nsecond', false)
    expect(parts).toHaveLength(2)
    expect(parts[0]?.complete).toBe(true)
    expect(parts[1]?.complete).toBe(false)
    expect(partitionMarkdown('$$\nx\n\nz\n$$\n\nnext', false)).toHaveLength(2)
  })
  it('sanitizes HTML and URLs without loading assistant image references', async () => {
    const html = await renderMarkdown(
      '<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1)) ![remote](https://external.invalid/tracker)\n\n<script>alert(1)</script>',
      true,
      'Copy',
    )
    const element = document.createElement('div')
    element.innerHTML = html
    expect(element.querySelector('img,script,iframe')).toBeNull()
    expect(element.querySelector('[onerror],[onclick]')).toBeNull()
    expect([...element.querySelectorAll('a')].some((a) => a.href.startsWith('javascript:'))).toBe(
      false,
    )
    expect(html).not.toContain('src="https://external.invalid')
  })
  it('renders tables code highlighting and raw TeX with a safe math configuration', async () => {
    const html = await renderMarkdown(
      '| A | B |\n|---|---|\n|1|2|\n\n```go\nfmt.Println("hello")\n```\n\n$\\frac{a_1}{b}$\n\n$$\n\\sum_{i=1}^{n} i\n$$',
      true,
      'Copy',
    )
    const el = document.createElement('div')
    el.innerHTML = html
    expect(el.querySelector('table')).not.toBeNull()
    expect(el.querySelector('.shiki')).not.toBeNull()
    expect(el.querySelector('button[data-copy-code]')?.textContent).toBe('Copy')
    expect(el.querySelectorAll('.katex')).toHaveLength(2)
    expect(el.querySelector('math')).not.toBeNull()
    const unsafe = await renderMarkdown('$\\href{javascript:alert(1)}{bad}$', true, 'Copy')
    const safe = document.createElement('div')
    safe.innerHTML = unsafe
    expect(safe.querySelector('a[href^="javascript:"]')).toBeNull()
  })
})
