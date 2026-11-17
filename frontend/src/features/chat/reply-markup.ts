import { publicSourceURL, type ChatSource } from '../../api/chat'

export function advanceMarkdownFence(line: string, fence: string): string {
  const mark = /^ {0,3}(\x60{3,}|~{3,})/.exec(line)?.[1]
  if (!mark) return fence
  if (!fence) return mark
  return mark[0] === fence[0] && mark.length >= fence.length && /^ {0,3}(\x60+|~+)\s*$/.test(line)
    ? ''
    : fence
}

interface Tag {
  name: string
  end: number
  closing: boolean
  selfClosing: boolean
  attributes: Map<string, string>
  incomplete: boolean
}

function braceEnd(source: string, start: number): number {
  let depth = 1
  for (let pos = start + 1; pos < source.length; pos++) {
    const char = source[pos]
    if (char === '"' || char === "'" || char === '\x60') {
      for (pos += 1; pos < source.length && source[pos] !== char; pos++) {
        if (source[pos] === '\\') pos++
      }
    } else if (char === '{') depth++
    else if (char === '}' && --depth === 0) return pos + 1
  }
  return -1
}

export function readReplyTag(source: string, start: number): Tag | undefined {
  const head = /^<(\/?)([A-Za-z][\w.-]*)(?=[\s/>]|$)/.exec(source.slice(start, start + 260))
  if (!head?.[2]) return undefined
  const tag: Tag = {
    name: head[2].toLowerCase(),
    closing: !!head[1],
    end: start + head[0].length,
    selfClosing: false,
    attributes: new Map(),
    incomplete: true,
  }
  const attribute = /([A-Za-z_:][\w.:-]*)\s*(=)?/y
  const space = /\s*/y
  const quoted = /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/y
  const bare = /[^\s"'=<>{}\x60]+/y
  while (tag.end < source.length) {
    space.lastIndex = tag.end
    space.exec(source)
    const pos = space.lastIndex
    if (source[pos] === '>' || source.startsWith('/>', pos)) {
      tag.selfClosing = source[pos] === '/'
      tag.end = pos + (tag.selfClosing ? 2 : 1)
      tag.incomplete = false
      return tag
    }
    if (tag.closing) break
    attribute.lastIndex = pos
    const match = attribute.exec(source)
    if (!match?.[1]) break
    tag.end = attribute.lastIndex
    let value = ''
    if (match[2]) {
      space.lastIndex = tag.end
      space.exec(source)
      const from = space.lastIndex
      const char = source[from]
      if (char === '"' || char === "'") {
        quoted.lastIndex = from
        const token = quoted.exec(source)?.[0]
        if (!token) break
        value = token.slice(1, -1)
        tag.end = quoted.lastIndex
      } else if (char === '{') {
        const end = braceEnd(source, from)
        if (end < 0) break
        value = source.slice(from + 1, end - 1).trim()
        quoted.lastIndex = 0
        if (quoted.exec(value)?.[0] === value) value = value.slice(1, -1)
        tag.end = end
      } else {
        bare.lastIndex = from
        value = bare.exec(source)?.[0] ?? ''
        if (!value) break
        tag.end = bare.lastIndex
        if (value.endsWith('/') && source[tag.end] === '>') {
          value = value.slice(0, -1)
          tag.end--
        }
      }
    }
    tag.attributes.set(match[1].toLowerCase(), value)
  }
  const recovery = /\n[ \t]*\n|[<>]/g
  recovery.lastIndex = tag.end
  tag.end = recovery.exec(source)?.index ?? source.length
  return tag
}

const blocks = new Set(
  'box row column col stack grid card panel callout alert text title paragraph section article div p blockquote ul ol list table thead tbody tr th td radio-group checkbox-group select details summary h1 h2 h3 h4 h5 h6'.split(
    ' ',
  ),
)
const formatting: Readonly<Record<string, string>> = {
  b: '**',
  strong: '**',
  em: '*',
  i: '*',
  s: '~~',
  del: '~~',
  mark: '**',
}
const privateTags = new Set(
  'script style iframe object embed svg math form input textarea video audio tool-call tool_call tool-result tool_result tool_calls function_call function_result button'.split(
    ' ',
  ),
)
const reasoning = new Set(['think', 'thinking', 'reason', 'reasoning', 'thought'])
const options = new Set(['radio', 'checkbox', 'option'])
const listItems = new Set(['list-item', 'li'])
const known = new Set([
  ...blocks,
  ...Object.keys(formatting),
  ...privateTags,
  ...reasoning,
  ...options,
  ...listItems,
  'codeblock',
  'asyncimage',
  'cite',
  'link',
  'a',
  'badge',
  'divider',
  'hr',
  'br',
  'img',
  'image',
  'icon',
  'span',
  'small',
  'sub',
  'sup',
  'code',
  'pre',
])
const prefixes = [...known]
const eachHeader = /^\{#each\s+([\s\S]+)\s+as\s+([A-Za-z_]\w*)(?:\s*,\s*[A-Za-z_]\w*)?\s*\}$/
const privateCitation = /\uE200(?:cite|filecite)\uE202([^\uE201]*)\uE201/y
const turnCitation =
  /\[(turn[A-Za-z0-9_-]*(?:search|news|view|file|image|product|video|finance|sports|weather|time|calculator|open|fetch|doc|result)\d+)\](?![([])/iy

function escapeMarkdown(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\uE000\uE001]/g, '\uFFFD')
    .replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^_\x60{|}~-]/g, '\\$&')
}

function markdownLink(title: string, url: string): string {
  return '[' + escapeMarkdown(title) + '](<' + url.replace(/[<>"\x60]/g, encodeURIComponent) + '>)'
}

function closingTag(source: string, from: number, name: string): RegExpExecArray | null {
  const closing = new RegExp('</' + name.replaceAll('.', '\\.') + '\\s*>', 'gi')
  closing.lastIndex = from
  return closing.exec(source)
}

function fencedCode(body: string, lang: string): string {
  const code = body.replace(/^\r?\n/, '').replace(/\r?\n[ \t]*$/, '')
  let length = 3
  for (const marker of code.matchAll(/^ {0,3}(~{3,})[ \t]*\r?$/gm))
    length = Math.max(length, (marker[1]?.length ?? 0) + 1)
  const fence = '~'.repeat(length)
  return (
    '\n\n' + fence + (/^[\w+#.-]+$/.test(lang) ? lang : '') + '\n' + code + '\n' + fence + '\n\n'
  )
}

interface SourceLink {
  url: string
  title: string
}
export type ReplyDecoration =
  | { kind: 'badge-open'; tone: string }
  | { kind: 'badge-close' }
  | { kind: 'citation'; items: SourceLink[]; unavailable: boolean }
export interface ReplyPart {
  kind: 'markdown' | 'reasoning'
  source: string
}
export interface AssistantReply {
  parts: ReplyPart[]
  decorations: ReplyDecoration[]
  copy: string
}
interface Fragment {
  markdown: string
  copy: string
}

export function replyDecorationIndex(
  source: string,
  start: number,
): { index: number; end: number } | undefined {
  const marker = /<\uE000(\d+)\uE001>/y
  marker.lastIndex = start
  const match = marker.exec(source)
  return match ? { index: Number(match[1]), end: marker.lastIndex } : undefined
}

// Use only clear sentence boundaries for position-only annotations. Keep other URLs in the sources list.
function sourcePositions(source: string, sources: readonly ChatSource[]): Map<number, string[]> {
  const offsets = new Map<number, string[]>()
  for (const item of sources) {
    const url = publicSourceURL(item.url)
    if (
      !url ||
      item.ref ||
      item.start_index === undefined ||
      item.end_index === undefined ||
      item.start_index < 0 ||
      item.end_index < item.start_index
    )
      continue
    offsets.set(item.end_index, [...(offsets.get(item.end_index) ?? []), url])
  }
  const positions = new Map<number, string[]>()
  if (!offsets.size) return positions
  let index = 0,
    pos = 0
  for (const char of source) {
    pos += char.length
    const urls = offsets.get(index++)
    if (
      urls &&
      /[。！？!?\n.]/.test(char) &&
      (pos === source.length || /\s/.test(source[pos] ?? ''))
    )
      positions.set(pos, urls)
  }
  return positions
}

export function parseAssistantReply(
  source: string,
  complete: boolean,
  sources: readonly ChatSource[] = [],
  labels = { unavailable: '', sources: '' },
): AssistantReply {
  const decorations: ReplyDecoration[] = []
  const parts: ReplyPart[] = []
  const used = new Set<string>()
  const urls = new Map<string, SourceLink>()
  const refs = new Map<string, string | undefined>()
  const positions = sourcePositions(source, sources)
  let expansionBudget = 65536
  for (const item of sources) {
    const url = publicSourceURL(item.url)
    if (!url) continue
    if (!urls.has(url) || item.title)
      urls.set(url, { url, title: item.title || new URL(url).hostname })
    if (item.ref && !refs.has(item.ref)) refs.set(item.ref, url)
    else if (item.ref && refs.get(item.ref) !== url) refs.set(item.ref, undefined)
  }

  function mark(value: ReplyDecoration): string {
    return '<\uE000' + (decorations.push(value) - 1) + '\uE001>'
  }

  function citation(references: string[], direct: string[] = [], title = ''): Fragment {
    const items: SourceLink[] = []
    for (const url of new Set(references.map((ref) => refs.get(ref)).concat(direct))) {
      if (!url) continue
      used.add(url)
      items.push(urls.get(url) ?? { url, title: title || new URL(url).hostname })
    }
    return {
      markdown: mark({
        kind: 'citation',
        items,
        unavailable: !items.length || references.some((ref) => !refs.get(ref)),
      }),
      copy: items.length
        ? ' ' + items.map(({ title, url }) => markdownLink(title, url)).join(' ')
        : '',
    }
  }

  function scan(
    text: string,
    depth: number,
    bindings: ReadonlyMap<string, string>,
    root: boolean,
    listItem = false,
  ): Fragment {
    const markdown: string[] = [],
      copy: string[] = []
    const layouts: { name: string; margin?: string }[] = []
    if (listItem) layouts.push({ name: '' })
    let pos = 0,
      start = 0,
      lineStart = 0
    let fence = '',
      blank = true,
      indentedCode = false,
      hasBadge = false
    const flush = () => {
      const literal = text.slice(start, pos).replace(/[\uE000\uE001]/g, '\uFFFD')
      markdown.push(literal)
      copy.push(literal)
      start = pos
    }
    const replace = (end: number, value: string, copied = value) => {
      flush()
      markdown.push(value)
      copy.push(copied)
      pos = start = end
    }
    while (pos < text.length) {
      const at = root && !layouts.length && !fence ? positions.get(pos) : undefined
      if (at) {
        const found = citation([], at)
        replace(pos, found.markdown, found.copy)
      }
      if (pos === 0 || text[pos - 1] === '\n') {
        lineStart = pos
        const nextLine = text.indexOf('\n', pos)
        const lineEnd = nextLine < 0 ? text.length : nextLine + 1
        let line = text.slice(pos, lineEnd).replace(/\r?\n$/, '')
        const layout = layouts.at(-1)
        if (layout) {
          const indent = /^[ \t]*/.exec(line)?.[0] ?? ''
          const trimmed = line.slice(indent.length)
          // Remove the component's formatting indent and leave relative Markdown indentation in place.
          if (trimmed && !(listItem && pos === 0)) layout.margin ??= indent
          const margin = layout.margin ?? ''
          const offset = indent.startsWith(margin)
            ? margin.length
            : margin.startsWith(indent)
              ? indent.length
              : 0
          if (offset) {
            replace(pos + offset, '')
            line = line.slice(offset)
          }
        }
        const nextFence = advanceMarkdownFence(line.replace(/^(?: {0,3}>[ \t]?)+/, ''), fence)
        const indented = /^(?: {4}| *\t)/.test(line)
        const code: boolean =
          (blank || indentedCode) && (indented || (indentedCode && !line.trim()))
        if (fence || nextFence || code) {
          fence = nextFence
          indentedCode = code
          pos = lineEnd
          continue
        }
        indentedCode = false
        blank = !line.trim()
      }
      const char = text[pos]
      if (char === '\\' && /[!-/:-@[-\x60{-~]/.test(text[pos + 1] ?? '')) {
        pos += 2
        continue
      }
      if (char === '\x60' || char === '$') {
        const size =
          char === '\x60'
            ? (/^\x60+/.exec(text.slice(pos))?.[0].length ?? 1)
            : text[pos + 1] === '$'
              ? 2
              : 1
        const marker = char.repeat(size)
        let end = text.indexOf(marker, pos + size)
        while (
          end >= 0 &&
          (char === '\x60'
            ? text[end - 1] === char || text[end + size] === char
            : text[end - 1] === '\\')
        )
          end = text.indexOf(marker, end + size)
        if (end >= 0 || (!complete && (char === '\x60' || size === 2))) {
          pos = end >= 0 ? end + size : text.length
          continue
        }
        pos += size
        continue
      }
      if (char === ']' && text[pos + 1] === '(') {
        const destination = /^\((?:\\.|[^()\\\n]|\([^()\n]*\))*\)/.exec(text.slice(pos + 1))
        if (destination) {
          pos += destination[0].length + 1
          continue
        }
      }
      if (char === '\uE200') {
        privateCitation.lastIndex = pos
        const term = privateCitation.exec(text)
        if (term) {
          const found = citation((term[1] ?? '').split('\uE202').filter(Boolean))
          replace(privateCitation.lastIndex, found.markdown, found.copy)
          continue
        }
        if (!complete || /^\uE200(?:cite|filecite)(?:\uE202|$)/.test(text.slice(pos))) {
          replace(text.length, '')
          continue
        }
      }
      if (char === '[') {
        turnCitation.lastIndex = pos
        const marker = turnCitation.exec(text)
        if (marker?.[1]) {
          const found = citation([marker[1]])
          replace(turnCitation.lastIndex, found.markdown, found.copy)
          continue
        }
        const tail = text.slice(pos, pos + 128)
        if (!complete && tail.length === text.length - pos && /^\[turn[\w-]*$/i.test(tail)) {
          replace(text.length, '')
          continue
        }
      }
      if (char === '{') {
        const directive = /^\{(?:@(?:body|const|html|debug)|[#/:][A-Za-z]+)(?=[\s}]|$)/.exec(
          text.slice(pos),
        )
        if (directive) {
          const end = braceEnd(text, pos)
          if (end < 0) {
            replace(text.length, '')
            continue
          }
          if (directive[0] !== '{#each') {
            replace(end, '')
            continue
          }
          const loopTags = /\{#each(?=[\s}])|\{\/each\s*\}/g
          loopTags.lastIndex = end
          let close = loopTags.exec(text),
            open = 1
          while (close) {
            open += close[0].startsWith('{/') ? -1 : 1
            if (open === 0) break
            close = loopTags.exec(text)
          }
          if (!close) {
            replace(text.length, '')
            continue
          }
          const header = eachHeader.exec(text.slice(pos, end))
          const template = text.slice(end, close.index)
          const output: Fragment = { markdown: '', copy: '' }
          if (depth < 8 && header?.[1] && header[2]) {
            let values: unknown
            try {
              values = JSON.parse(header[1])
            } catch {
              /* Ignore dynamic loops. */
            }
            if (Array.isArray(values)) {
              for (const value of values.slice(0, 50)) {
                if (
                  typeof value !== 'string' &&
                  typeof value !== 'number' &&
                  typeof value !== 'boolean'
                )
                  continue
                const cost = template.length + String(value).length
                if (cost > expansionBudget) break
                expansionBudget -= cost
                const item = scan(
                  template,
                  depth + 1,
                  new Map(bindings).set(header[2], String(value)),
                  false,
                )
                output.markdown += item.markdown
                output.copy += item.copy
              }
            }
          }
          replace(loopTags.lastIndex, output.markdown, output.copy)
          continue
        }
        const variable = /^\{([A-Za-z_]\w*)\}/.exec(text.slice(pos))
        if (variable?.[1] && (bindings.has(variable[1]) || layouts.length || depth > 0)) {
          const value = escapeMarkdown(bindings.get(variable[1]) ?? '')
          const end = pos + variable[0].length
          const emphasis = /^(\*{1,3}|_{1,3}|~~)(?![*_~])/.exec(text.slice(end, end + 4))?.[0]
          if (
            !value &&
            emphasis &&
            pos - emphasis.length >= start &&
            text.slice(pos - emphasis.length, pos) === emphasis &&
            !/[*_~\\]/.test(text[pos - emphasis.length - 1] ?? '')
          ) {
            pos -= emphasis.length
            replace(end + emphasis.length, '')
          } else {
            replace(end, value)
          }
          continue
        }
        if (
          !complete &&
          ['{@body', '{#each', '{/each', '{@const'].some((prefix) =>
            prefix.startsWith(text.slice(pos)),
          )
        ) {
          replace(text.length, '')
          continue
        }
      }
      if (char !== '<') {
        pos++
        continue
      }
      const head = text.slice(pos, pos + 260)
      if (head.startsWith('<!--')) {
        const end = text.indexOf('-->', pos + 4)
        replace(end < 0 ? text.length : end + 3, '')
        continue
      }
      const tag = readReplyTag(text, pos)
      if (!tag) {
        if (!complete && (head === '<' || head === '</')) replace(text.length, '')
        else pos++
        continue
      }
      const { name, end, attributes, closing, selfClosing, incomplete } = tag
      const componentName = /^<[A-Z][\w.-]{1,}/.test(head) && !/[\w$\])]/.test(text[pos - 1] ?? '')
      const component =
        selfClosing ||
        attributes.size > 0 ||
        closing ||
        componentName ||
        /^<[A-Z][a-z0-9]*[A-Z]|^<[a-z]+-/.test(head)
      if (incomplete) {
        if (
          known.has(name) ||
          (end === text.length &&
            (component ||
              prefixes.some((item) => item.startsWith(name) && (!complete || name.length > 3))))
        )
          replace(end, '')
        else pos++
        continue
      }
      if (!known.has(name) && !component && !closingTag(text, end, name)) {
        pos = end
        continue
      }
      const close = () => (closing || selfClosing ? null : closingTag(text, end, name))
      if ((name === 'codeblock' || name === 'pre' || name === 'code') && !closing && !selfClosing) {
        const last = close()
        if (name === 'code' && last) {
          const value = text.slice(end, last.index)
          let count = 1
          for (const match of value.matchAll(/\x60+/g)) count = Math.max(count, match[0].length + 1)
          const delimiter = '\x60'.repeat(count)
          replace(last.index + last[0].length, delimiter + ' ' + value + ' ' + delimiter)
          continue
        }
        let code = text.slice(end, last?.index ?? text.length)
        if (!last) code = code.replace(/<\/CodeB(?:l(?:o(?:c(?:k)?)?)?)?$/i, '')
        replace(
          last ? last.index + last[0].length : text.length,
          fencedCode(code, attributes.get('language')?.toLowerCase() ?? ''),
        )
      } else if (name === 'asyncimage' && !closing) {
        const prompt =
          attributes.get('query') ?? attributes.get('prompt') ?? attributes.get('alt') ?? ''
        const tagSource = text.slice(pos, end).replace(/^<asyncimage/i, '<AsyncImage')
        replace(end, tagSource, escapeMarkdown(prompt))
      } else if (name === 'cite' && !closing) {
        let ids: string[] = []
        try {
          const values: unknown = JSON.parse(attributes.get('refs') ?? '')
          if (Array.isArray(values))
            ids = values.filter((value): value is string => typeof value === 'string').slice(0, 20)
        } catch {
          /* A single reference may be provided on ref. */
        }
        const ref = attributes.get('ref')
        const url = publicSourceURL(attributes.get('url'))
        const found = citation(ref ? [ref, ...ids] : ids, url ? [url] : [])
        replace(end, found.markdown, found.copy)
      } else if (name === 'link' || name === 'a') {
        const last = close()
        const title =
          attributes.get('title') ??
          attributes.get('label') ??
          (last ? text.slice(end, last.index).replace(/<[^>]*>/g, '') : '')
        const ref = attributes.get('ref')
        const url =
          (ref ? refs.get(ref) : undefined) ??
          publicSourceURL(attributes.get('href') ?? attributes.get('url'))
        if (url) used.add(url)
        const label = title.trim() || (url ? (urls.get(url)?.title ?? new URL(url).hostname) : '')
        replace(
          last ? last.index + last[0].length : end,
          url ? markdownLink(label, url) : escapeMarkdown(label || (ref ? labels.unavailable : '')),
        )
      } else if (name === 'badge') {
        const color = attributes.get('color') ?? ''
        const tone = ['danger', 'success', 'warning'].includes(color) ? color : 'neutral'
        let value = ''
        if (hasBadge) value = mark({ kind: 'badge-close' })
        hasBadge = !closing && !selfClosing
        if (hasBadge) value += mark({ kind: 'badge-open', tone })
        replace(end, value, '')
      } else if (
        privateTags.has(name) ||
        (name === 'details' && attributes.get('type')?.startsWith('tool'))
      ) {
        const last = name === 'input' ? null : close()
        const openBody = !closing && !selfClosing && !['input', 'embed'].includes(name)
        const boundary = /\n[ \t]*\n/g
        boundary.lastIndex = end
        replace(
          last
            ? last.index + last[0].length
            : openBody
              ? (boundary.exec(text)?.index ?? text.length)
              : end,
          '',
        )
      } else if (
        (reasoning.has(name) || (name === 'details' && attributes.get('type') === 'reasoning')) &&
        !closing &&
        !selfClosing &&
        root
      ) {
        const last = close()
        replace(end, '')
        const section = markdown.join('')
        if (section.trim()) parts.push({ kind: 'markdown', source: section })
        markdown.length = 0
        const bodyEnd = last?.index ?? text.length
        const thought = scan(text.slice(end, bodyEnd), depth + 1, new Map(), false).markdown.trim()
        if (thought) parts.push({ kind: 'reasoning', source: thought })
        pos = start = last ? last.index + last[0].length : bodyEnd
      } else if (options.has(name) || listItems.has(name)) {
        const last = close()
        const raw = last
          ? text.slice(end, last.index)
          : (attributes.get('label') ?? attributes.get('title') ?? '')
        const next = last ? last.index + last[0].length : end
        if (last && listItems.has(name) && depth < 8) {
          const body = scan(raw, depth + 1, bindings, false, true)
          const prefix = /^[ \t]*$/.test(text.slice(lineStart, pos)) ? '' : '\n'
          const asItem = (value: string) => {
            const content = value.trim().replace(/\r?\n(?=[^\r\n])/g, '\n  ')
            return content ? prefix + '- ' + content : ''
          }
          replace(next, asItem(body.markdown), asItem(body.copy))
        } else {
          const variable = /^\{([A-Za-z_]\w*)\}$/.exec(raw.trim())?.[1]
          const label = escapeMarkdown(variable ? (bindings.get(variable) ?? '') : raw)
          replace(next, !closing && label ? '\n- ' + label : '')
        }
      } else if (Object.hasOwn(formatting, name)) {
        if (!closing && !selfClosing) {
          const empty = /^\s*(?:\{([A-Za-z_]\w*)\}\s*)?<\//.exec(text.slice(end))
          const last = empty ? readReplyTag(text, end + empty[0].length - 2) : undefined
          if (
            last?.name === name &&
            !last.incomplete &&
            (!empty?.[1] ||
              ((layouts.length || depth > 0 || bindings.has(empty[1])) &&
                !bindings.get(empty[1])?.trim()))
          ) {
            replace(last.end, '')
            continue
          }
        }
        replace(end, selfClosing ? '' : (formatting[name] ?? ''))
      } else if (name === 'img' || name === 'image' || name === 'icon') {
        replace(end, escapeMarkdown(attributes.get('alt') ?? attributes.get('title') ?? ''))
      } else if (name === 'br' || name === 'hr' || name === 'divider') {
        replace(end, name === 'br' ? '\n' : '\n\n---\n\n')
      } else if (blocks.has(name)) {
        if (closing) {
          let opened = layouts.length - 1
          while (opened >= 0 && layouts[opened]?.name !== name) opened--
          if (opened >= 0) layouts.length = opened
        } else if (!selfClosing) {
          layouts.push({ name })
        }
        const heading = /^h([1-6])$/.exec(name)?.[1]
        replace(end, heading && !closing ? '\n\n' + '#'.repeat(Number(heading)) + ' ' : '\n')
      } else {
        const title = !closing ? (attributes.get('title') ?? attributes.get('label') ?? '') : ''
        replace(end, title ? escapeMarkdown(title) + (selfClosing ? '' : ' ') : '')
      }
    }
    const atEnd = root && !layouts.length && !fence ? positions.get(text.length) : undefined
    if (atEnd && !/[<>$\x60]/.test(text.slice(text.lastIndexOf('\n') + 1))) {
      const found = citation([], atEnd)
      replace(pos, found.markdown, found.copy)
    }
    flush()
    if (hasBadge) markdown.push(mark({ kind: 'badge-close' }))
    return { markdown: markdown.join(''), copy: copy.join('') }
  }

  if (!sources.length && !/[<{\uE200\uE000\uE001]|\[turn/i.test(source)) {
    return { parts: [{ kind: 'markdown', source }], decorations, copy: source }
  }
  const body = scan(source, 0, new Map(), true)
  const remaining = [...urls.values()].filter(({ url }) => !used.has(url))
  if (remaining.length) {
    const list =
      '\n\n' +
      escapeMarkdown(labels.sources) +
      '\n\n' +
      remaining.map(({ title, url }) => '- ' + markdownLink(title, url)).join('\n')
    body.markdown += list
    body.copy += list
  }
  if (body.markdown.trim()) parts.push({ kind: 'markdown', source: body.markdown })
  return { parts, decorations, copy: body.copy }
}
