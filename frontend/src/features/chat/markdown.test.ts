import { describe, it, expect } from 'vitest'
import { parseIllustration, partitionMarkdown, renderMarkdown } from './markdown'
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
  it('turns AsyncImage placeholders into safe illustration cards', async () => {
    const labels = { label: 'Illustration', pending: 'Preparing', action: 'Create' }
    const html = await renderMarkdown(
      'Before\n\n<AsyncImage query="two &quot;linked&quot; particles <b>glowing</b>" aspectRatio="16:9" width="100%"/>\n\nAfter',
      true,
      'Copy',
      labels,
    )
    const element = document.createElement('div')
    element.innerHTML = html
    const card = element.querySelector('.chat-illustration')
    expect(card?.getAttribute('data-ratio')).toBe('16:9')
    expect(card?.getAttribute('aria-label')).toBe('Illustration · 16:9')
    expect(element.textContent).not.toContain('AsyncImage')
    expect(element.querySelector('b,img,script')).toBeNull()
    const action = element.querySelector<HTMLButtonElement>('button[data-illustration-prompt]')
    expect(action?.textContent).toBe('Create')
    expect(action?.dataset.illustrationPrompt).toBe(
      'two &quot;linked&quot; particles <b>glowing</b>',
    )
    expect(action?.dataset.illustrationRatio).toBe('16:9')
    const passive = await renderMarkdown('<AsyncImage query="sky"/>', true, 'Copy', {
      label: 'Illustration',
      pending: 'Preparing',
    })
    expect(passive).toContain('chat-illustration-prompt')
    expect(passive).not.toContain('<button')
  })
  it('hides unfinished placeholders only while streaming and leaves code untouched', async () => {
    const labels = { label: 'Illustration', pending: 'Preparing', action: 'Create' }
    const streaming = await renderMarkdown('<AsyncImage query="quantum ent', false, 'Copy', labels)
    expect(streaming).toContain('chat-illustration-pending')
    expect(streaming).not.toContain('quantum')
    expect(await renderMarkdown('<Asy', false, 'Copy', labels)).not.toContain('&lt;Asy')
    expect(await renderMarkdown('<AsyncImage query="quantum ent', true, 'Copy', labels)).toContain(
      '&lt;AsyncImage',
    )
    const code = await renderMarkdown('```html\n<AsyncImage query="x"/>\n```', true, 'Copy', labels)
    expect(code).not.toContain('chat-illustration')
    expect(parseIllustration(' query={"a cat"} aspectRatio={\'4/3\'} ')).toEqual({
      prompt: 'a cat',
      ratio: '4:3',
    })
    expect(parseIllustration(' alt="x" aspectRatio="wide"')).toEqual({ prompt: 'x', ratio: '' })
  })
})
