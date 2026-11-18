import { describe, it, expect } from 'vitest'
import { parseIllustration, partitionMarkdown, renderMarkdown } from './markdown'
import { parseAssistantReply } from './reply-markup'
import type { ChatSource } from '../../api/chat'

async function renderReply(
  source: string,
  complete: boolean,
  sources?: ChatSource[],
): Promise<HTMLDivElement> {
  const reply = parseAssistantReply(source, complete, sources, {
    unavailable: 'Source unavailable',
    sources: 'Sources',
  })
  const parts = reply.parts.flatMap((part) => partitionMarkdown(part.source, complete))
  const blocks = await Promise.all(
    parts.map((part) =>
      renderMarkdown(part.source, part.complete, 'Copy', undefined, {
        decorations: reply.decorations,
        unavailable: 'Source unavailable',
      }),
    ),
  )
  const element = document.createElement('div')
  element.innerHTML = blocks.join('')
  return element
}

describe('safe incremental markdown', () => {
  it('recovers replayed fragments before rendering or copying streamed and saved replies', async () => {
    const fragments = [
      '# Weekend plan\n\nStart at the muse',
      'um and follow the river until the obser',
      'vation deck.\n\n<text',
      ' color="secondary" size="xs">Per person</text>\n\n## Bud',
      'get\n\n| Item | Cost |\n| --- | --- |\n| Tour | ¥25 |\n',
    ]
    const original = fragments.join('')
    const replayed = fragments.map((fragment) => fragment.repeat(2)).join('')
    for (const complete of [false, true]) {
      const element = await renderReply(replayed, complete)
      expect([...element.querySelectorAll('h1, h2')].map((heading) => heading.textContent)).toEqual(
        ['Weekend plan', 'Budget'],
      )
      expect(element.querySelectorAll('table')).toHaveLength(1)
      expect(element.textContent).toContain(
        'museum and follow the river until the observation deck',
      )
      expect(element.textContent).not.toMatch(/<text|color=|size=/)
      expect(parseAssistantReply(replayed, complete).copy).toBe(
        parseAssistantReply(original, complete).copy,
      )
    }
    expect(parseAssistantReply(replayed + '\nIt is open', false).copy).toContain('It is open')
  })

  it('keeps intentional Markdown and code repetitions', () => {
    const stanza =
      '## Refrain\n\nWalk down by the river, over the bridge, and back to the river.\n\n'
    const source = stanza.repeat(2) + '```js\n' + 'console.log("again")\n'.repeat(4) + '```'
    expect(parseAssistantReply(source, true).copy).toBe(source)
  })

  it('renders map itineraries and entity names as safe Markdown', async () => {
    const source = [
      '<Entity value="Museum" category="point_of_interest" />',
      '',
      '<MapWidgetV2 title="Weekend stops"',
      ' points={[{"id":"museum","name":"Museum","address":"West Bank"},{"ref":"turn23business1"}]}',
      ' groups={[{"title":"Saturday","locations":[{"point_id":"museum","notes":"Use the north entrance"},{"point_id":"turn23business1","notes":"Walk across the bridge"}]}]} />',
      '',
      '<MapWidgetV2 points={[{"name":"[example](javascript:alert(1)) <script>"}]} />',
    ].join('\n')
    const element = await renderReply(source, true)
    expect(element.querySelector('p')?.textContent).toBe('Museum')
    expect([...element.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'Museum (West Bank) — Use the north entrance',
      'Walk across the bridge',
      '[example](javascript:alert(1)) <script>',
    ])
    expect(element.querySelector('a, script')).toBeNull()
    expect(element.textContent).not.toMatch(/MapWidgetV2|turn23business1/)
  })

  it('drops broken component fragments and preserves subsequent headings and code examples', async () => {
    const source = [
      '<Map# Itinerary',
      '',
      '<MapWidgetV2 points={[{"name":"Missing close',
      '<text## Budget',
      '',
      '```tsx',
      '<MapWidgetV2 points={[]} />',
      '```',
    ].join('\n')
    const element = await renderReply(source, true)
    expect(element.querySelector('h1')?.textContent).toBe('Itinerary')
    expect(element.querySelector('h2')?.textContent).toBe('Budget')
    expect(element.querySelector('code')?.textContent).toContain('<MapWidgetV2 points={[]} />')
    expect(element.textContent).not.toMatch(/Missing close|<text|<Map#/)
  })

  it('shows grouped image suggestions through the existing illustration cards', async () => {
    const source = '<AsyncImageGroup query={["A bridge", "A museum"]} aspectRatio="4:3" />'
    const reply = parseAssistantReply(source, true)
    const html = await renderMarkdown(reply.parts[0]?.source ?? '', true, 'Copy', {
      label: 'Suggested image',
      pending: 'Preparing suggestion',
      action: 'Open studio',
    })
    const element = document.createElement('div')
    element.innerHTML = html
    expect(
      [...element.querySelectorAll('button')].map((button) => button.dataset.illustrationPrompt),
    ).toEqual(['A bridge', 'A museum'])
    expect(element.querySelectorAll('[data-ratio="4:3"]')).toHaveLength(2)
    expect(reply.copy).toBe('A bridge\n\nA museum')
  })

  it('renders legacy code blocks with their language, indentation and blank lines intact', async () => {
    const code = 'function identity<T>(value: T) {\n\n  return value\n}'
    const source =
      '### Example\r\n<CodeBlock language={"TypeScript"} editable>\r\n' +
      code.replaceAll('\n', '\r\n') +
      '\r\n</CodeBlock>\r\n\r\n**After**'
    const element = await renderReply(source, true)
    expect(element.querySelectorAll('.chat-code')).toHaveLength(1)
    expect(element.querySelector('.chat-code .shiki code')?.textContent?.trimEnd()).toBe(code)
    expect(element.querySelector('.chat-code-heading span')?.textContent).toBe('typescript')
    expect(element.querySelector('button[data-copy-code]')?.textContent).toBe('Copy')
    expect(element.querySelector('strong')?.textContent).toBe('After')
    expect(element.textContent).not.toContain('CodeBlock')
  })

  it('keeps streamed code readable before a closing tag arrives', async () => {
    const start = 'Before\n\n<CodeBlock language="text">'
    const code = '\n~~~\n\n<radio-group>\ncode'
    for (const trailing of ['\n</CodeB', '\n</CodeBlock', '']) {
      const streaming = await renderReply(start + code + trailing, false)
      expect(streaming.querySelector('pre code')?.textContent?.trimEnd()).toBe(code.slice(1))
      expect(streaming.textContent).not.toContain('CodeBlock')
    }
    expect((await renderReply(start + code + '\n</CodeB', true)).textContent).not.toContain('CodeB')
    expect((await renderReply('Before\n<Code', false)).textContent?.trim()).toBe('Before')
    expect(
      (await renderReply(start + '\n<', true)).querySelector('code')?.textContent?.trim(),
    ).toBe('<')
  })

  it('retains GenUI questions and static radio labels without rendering controls or expressions', async () => {
    const source = [
      '## 比较模型',
      '{@body const [scope, setScope] = DIL.useState("全球")}',
      '<box border radius="lg" padding={3}>',
      '**你最想了解什么？**',
      '<radio-group value={scope} onChange={setScope}>',
      '{#each ["综合","编程 *代码*","<b>示例</b>"] as v}<radio value={v}>{v}</radio>{/each}',
      '</radio-group>',
      '<divider color="subtle"/>',
      '**比较范围**',
      '<radio-group direction="col">',
      '<radio value="全球">全球</radio>',
      '<radio value="中国">中国</radio>',
      '</radio-group>',
      '<button onClick={() => GenUI.issueNewTurn(scope)}>查看详细结果</button>',
      '</box>',
      '',
      '后续说明',
    ].join('\n')
    const element = await renderReply(source, true)
    expect([...element.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      '综合',
      '编程 *代码*',
      '<b>示例</b>',
      '全球',
      '中国',
    ])
    expect([...element.querySelectorAll('strong')].map((item) => item.textContent)).toEqual([
      '你最想了解什么？',
      '比较范围',
    ])
    expect(element.textContent).toContain('后续说明')
    expect(element.textContent).not.toMatch(/DIL\.useState|GenUI\.|radio-group|查看详细结果/)
    expect(element.querySelector('button,input,b,[onclick]')).toBeNull()
    for (let end = 1; end <= source.length; end++) {
      expect(parseAssistantReply(source.slice(0, end), false).copy).not.toMatch(
        /(?:^|\n)\s*(?:[<{]\/?(?:Code|box|radio|button|divider|@body|[#/]each))/,
      )
    }
  })

  it('preserves literal component examples inside Markdown code and math', () => {
    const source = [
      'Show `<CodeBlock>` and `<radio-group>` inline.',
      '',
      '````md',
      '<CodeBlock language="js" editable>',
      '<box>',
      '{@body example}',
      '</box>',
      '</CodeBlock>',
      '````',
      '',
      '    <CodeBlock language="js">',
      '    </CodeBlock>',
      '    <badge>literal</badge>',
      '',
      '> ~~~html',
      '> <Cite ref="turn23news2"/>',
      '> ~~~',
      '',
      '$$',
      'x < y',
      '$$',
      '',
      'Array<Type> where x < y and \\<badge> is written literally.',
    ].join('\n')
    expect(parseAssistantReply(source, true).copy).toBe(source)
  })

  it('renders inline citations and badges, keeping missing references and source titles readable', async () => {
    const source = [
      '1. **Research:** found results. <Cite',
      '   refs={["turn23news16","turn23news2"]}/> Next sentence.',
      '',
      '<badge color="danger">Confirmed</badge>',
      '',
      '- <Link ref="turn23news16" title="Provider report"/>',
      '- <Link ref="turn23news2" title="Missing report"/>',
      'A second marker: \uE200cite\uE202turn23news16\uE201',
      'A third marker: [turn23news16]',
    ].join('\n')
    const sources = [{ url: 'https://example.com/report', title: 'Report', ref: 'turn23news16' }]
    const element = await renderReply(source, true, sources)
    expect(element.querySelectorAll('a[href="https://example.com/report"]')).toHaveLength(4)
    expect(element.querySelector('.chat-citation-unavailable')?.textContent).toBe(
      'Source unavailable',
    )
    expect(element.querySelector('.chat-reply-badge[data-tone="danger"]')?.textContent).toBe(
      'Confirmed',
    )
    expect(element.textContent).toContain('Missing report')
    expect(element.textContent).toContain('Next sentence.')
    expect(element.textContent).not.toMatch(/turn23|<Cite|<Link|<badge/)
    expect(parseAssistantReply(source, true, sources).copy).toContain('https://example.com/report')
    expect(parseAssistantReply(source, true, sources).copy).not.toContain('turn23')
  })

  it('binds position-only sources at a clear Unicode sentence boundary and lists ambiguous sources', async () => {
    const source = '🙂第一句。 下一句。'
    const element = await renderReply(source, true, [
      { url: 'https://example.com/first', title: 'First', start_index: 0, end_index: 4 },
      { url: 'https://example.com/unclear', title: 'Unclear', start_index: 0, end_index: 1 },
    ])
    expect(element.querySelector('p a.chat-citation')?.textContent).toBe('First')
    expect(element.querySelector('ul a')?.textContent).toBe('Unclear')
  })

  it('handles nested layout, quoted expressions, and static loop values', async () => {
    const source = [
      '<box border radius="lg">',
      '**Continuous events**',
      '<row><text color="secondary">Trigger</text><text>Wait 500ms</text></row>',
      '<row gap={1}>',
      '{#each ["100ms","200ms","300ms","400ms","900ms"] as t,i}',
      '<box background={i===4?"#16A34A":"surface-tertiary"}>',
      '<text color={i===4?"#FFFFFF":"default"}>{t}</text>',
      '</box>',
      '{/each}',
      '</row>',
      '<UnknownWidget title="heading">Readable <b>content</b></UnknownWidget>',
      '</box>',
    ].join('\n')
    const element = await renderReply(source, true)
    expect(element.textContent).toMatch(/100ms\s+200ms\s+300ms\s+400ms\s+900ms/)
    expect(element.querySelector('strong')?.textContent).toBe('Continuous events')
    expect(element.textContent).toContain('Readable content')
    expect(element.textContent).not.toMatch(/<row|<box|<text|\{#each|UnknownWidget|i===/)
  })

  it.each([false, true])(
    'renders indented component content as Markdown (complete: %s)',
    async (complete) => {
      const source = [
        '## 两天行程总览',
        '<box>',
        '  <row>',
        '    <badge color="success">DAY 1</badge>',
        '    **西湖经典路线**',
        '    <ul>',
        '      <li>**09:00 — 西湖断桥残雪** 从断桥开始。</li>',
        '      <li>',
        '        **10:00 — 白堤** 沿湖散步。',
        '      </li>',
        '    </ul>',
        '    <card>',
        '      <AsyncImage query="杭州龙井虾仁 杭帮菜" aspectRatio="5:4" width="100%"/>',
        '      **龙井虾仁**',
        '      清香鲜嫩，杭州代表菜。 <Cite ref="turn23news2"/>',
        '    </card>',
        '    <text>**{schoolName}**</text>',
        '    <text><strong>{schoolName}</strong></text>',
        '    Guizhou University · GZU',
        '  </row>',
        '</box>',
      ].join('\n')
      const sources = [{ url: 'https://example.com/report', title: 'Report', ref: 'turn23news2' }]
      const element = await renderReply(source, complete, sources)
      expect(element.querySelector('.chat-reply-badge')?.textContent).toBe('DAY 1')
      expect(element.querySelector('.chat-illustration-prompt')?.textContent).toBe(
        '杭州龙井虾仁 杭帮菜',
      )
      expect(element.querySelector('.chat-citation')?.textContent).toBe('Report')
      expect([...element.querySelectorAll('strong')].map((item) => item.textContent)).toEqual([
        '西湖经典路线',
        '09:00 — 西湖断桥残雪',
        '10:00 — 白堤',
        '龙井虾仁',
      ])
      expect(element.querySelectorAll('ul')).toHaveLength(1)
      expect(element.querySelectorAll('li')).toHaveLength(2)
      expect(element.querySelector('pre')).toBeNull()
      expect(element.textContent).toContain('Guizhou University · GZU')
      expect(element.textContent).not.toMatch(/AsyncImage|<\uE000|\*\*|schoolName/)
      expect(parseAssistantReply(source, complete, sources).copy).toContain(
        '- **09:00 — 西湖断桥残雪**',
      )
    },
  )

  it('preserves Markdown list nesting and literal code inside an indented layout', async () => {
    const source = [
      '<box>',
      '    - **行程**',
      '      - **西湖**',
      '',
      '    ```html',
      '      <AsyncImage query="literal"/>',
      '    ```',
      '',
      '        <badge>indented example</badge>',
      '',
      '    **正文**',
      '</box>',
    ].join('\n')
    const element = await renderReply(source, true)
    expect(element.querySelector('li ul li strong')?.textContent).toBe('西湖')
    expect(
      [...element.querySelectorAll('pre code')].map((item) => item.textContent?.trimEnd()),
    ).toEqual(['  <AsyncImage query="literal"/>', '<badge>indented example</badge>'])
    expect(element.querySelector('.chat-illustration, .chat-reply-badge')).toBeNull()
  })

  it('keeps earlier layout content visible when an illustration tag is still incomplete', async () => {
    const source = '<box>\n    **已生成的行程**\n\n    <AsyncImage query="杭州西湖'
    for (const complete of [false, true]) {
      const element = await renderReply(source, complete)
      expect(element.querySelector('strong')?.textContent).toBe('已生成的行程')
      expect(element.querySelector('pre')).toBeNull()
      expect(element.textContent).not.toContain('AsyncImage')
    }
  })

  it('never exposes a partial known inline tag and leaves reasoning out of message copy', () => {
    const source =
      'Answer. <Cite\n refs={["turn1search2"]}/> <badge color="warning">Pending</badge>'
    for (let end = 1; end <= source.length; end++) {
      const parsed = parseAssistantReply(source.slice(0, end), false)
      expect(parsed.copy).not.toMatch(/<|refs=|turn1|color=/)
    }
    const parsed = parseAssistantReply('<think>Auxiliary text</think>Final answer', true)
    expect(parsed.parts).toEqual([
      { kind: 'reasoning', source: 'Auxiliary text' },
      { kind: 'markdown', source: 'Final answer' },
    ])
    expect(parsed.copy).toBe('Final answer')
    expect(parseAssistantReply('Before <Widget>Visible', false).copy).toBe('Before Visible')
    for (const tail of [
      '<button onClick={() => GenUI.issueNewTurn("x")}>Pending label',
      '<tool_call>{"name":"search"}',
    ]) {
      expect(parseAssistantReply('Answer. ' + tail, false).copy).toBe('Answer. ')
    }
  })

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
