import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import type { HighlighterCore } from 'shiki/core'
import {
  advanceMarkdownFence,
  readIllustrationQueries,
  readReplyTag,
  replyDecorationIndex,
  type ReplyDecoration,
} from './reply-markup'

export interface MarkdownPart {
  key: number
  source: string
  complete: boolean
}
// Blank lines outside fenced code/math close stable blocks; the tail remains editable.
export function partitionMarkdown(text: string, final: boolean): MarkdownPart[] {
  const lines = text.split('\n'),
    parts: MarkdownPart[] = []
  let current = '',
    offset = 0,
    start = 0,
    fence = '',
    math = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '',
      newline = i < lines.length - 1 ? '\n' : ''
    current += line + newline
    offset += line.length + newline.length
    if (!math) fence = advanceMarkdownFence(line.replace(/^(?: {0,3}>[ \t]?)+/, ''), fence)
    if (!fence && line.trim() === '$$') math = !math
    if (!fence && !math && !line.trim() && newline) {
      parts.push({ key: start, source: current, complete: true })
      current = ''
      start = offset
    }
  }
  if (current) parts.push({ key: start, source: current, complete: final })
  return parts
}
/** A model-suggested illustration: an image description the reader may choose to generate. */
export interface Illustration {
  prompt: string
  ratio: string
}
/** Visible illustration text; without `action` the card offers no generate button. */
export interface IllustrationLabels {
  label: string
  pending: string
  action?: string
}
const illustrationName = '<AsyncImage'
const illustrationRatios = new Set(['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'])
// Some upstream models emit JSX-style <AsyncImage query="…" aspectRatio="16:9"/> placeholders.
export function parseIllustration(attributes: string): Illustration {
  const tag = readReplyTag('<AsyncImage' + attributes + '>', 0)
  const prompt = tag ? readIllustrationQueries(tag)[0] : ''
  return illustrationFrom(prompt ?? '', tag?.attributes.get('aspectratio'))
}
function illustrationFrom(prompt: string, aspectRatio = ''): Illustration {
  const ratio = aspectRatio.replace(/\s+/g, '').replace('/', ':')
  return {
    prompt: prompt.replace(/\s+/g, ' ').trim().slice(0, 2000),
    ratio: /^\d{1,2}:\d{1,2}$/.test(ratio) ? ratio : '',
  }
}
function illustrationHTML(
  escape: (value: string) => string,
  item: Illustration | null,
  labels: IllustrationLabels | undefined,
): string {
  if (item && !item.prompt) return ''
  const ratio = item?.ratio ?? ''
  const label = item ? (labels?.label ?? '') : (labels?.pending ?? '')
  const caption = label && ratio ? label + ' · ' + ratio : label
  const icon =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3"></rect><circle cx="9" cy="10" r="1.6"></circle><path d="m5 17.5 4.5-4.5 3.5 3.5 2.5-2.5 3.5 3.5"></path></svg>'
  return (
    '<span class="chat-illustration' +
    (item ? '' : ' chat-illustration-pending') +
    '" role="group"' +
    (caption ? ' aria-label="' + escape(caption) + '"' : '') +
    (illustrationRatios.has(ratio) ? ' data-ratio="' + ratio + '"' : '') +
    '><span class="chat-illustration-frame' +
    (item ? '' : ' lumi-shimmer') +
    '" aria-hidden="true">' +
    icon +
    '</span><span class="chat-illustration-body">' +
    (caption ? '<span class="chat-illustration-label">' + escape(caption) + '</span>' : '') +
    (item ? '<span class="chat-illustration-prompt">' + escape(item.prompt) + '</span>' : '') +
    '</span>' +
    (item && labels?.action
      ? '<button type="button" class="chat-illustration-action" data-illustration-prompt="' +
        escape(item.prompt) +
        '" data-illustration-ratio="' +
        escape(ratio) +
        '">' +
        escape(labels.action) +
        '</button>'
      : '') +
    '</span>'
  )
}
let highlighter: Promise<HighlighterCore> | undefined
let mathLoader: Promise<typeof import('katex')> | undefined
const supported = new Set([
  'javascript',
  'typescript',
  'js',
  'ts',
  'python',
  'py',
  'go',
  'json',
  'bash',
  'sh',
  'html',
  'css',
  'sql',
  'yaml',
  'yml',
  'markdown',
  'md',
  'text',
  'plaintext',
])
const aliases: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  text: 'plaintext',
}
const languages = {
  javascript: () => import('shiki/langs/javascript.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
}
async function codeHTML(code: string, language: string): Promise<string> {
  const lang = supported.has(language) ? (aliases[language] ?? language) : 'plaintext'
  highlighter ??= Promise.all([import('shiki/core'), import('shiki/engine/javascript')]).then(
    ([core, engine]) =>
      core.createHighlighterCore({
        themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
        langs: [],
        engine: engine.createJavaScriptRegexEngine({ target: 'ES2018' }),
      }),
  )
  const high = await highlighter
  if (lang !== 'plaintext' && !high.getLoadedLanguages().includes(lang))
    await high.loadLanguage(languages[lang as keyof typeof languages])
  return high.codeToHtml(code, { lang, themes: { light: 'github-light', dark: 'github-dark' } })
}
async function mathHTML(source: string, display: boolean): Promise<string> {
  mathLoader ??= import('katex')
  await import('katex/dist/katex.min.css')
  const math = await mathLoader
  return math.renderToString(source, {
    displayMode: display,
    throwOnError: false,
    trust: false,
    strict: 'ignore',
    maxExpand: 200,
    maxSize: 20,
    output: 'htmlAndMathml',
  })
}
export async function renderMarkdown(
  source: string,
  complete: boolean,
  copyLabel: string,
  illustration?: IllustrationLabels,
  reply?: { decorations: readonly ReplyDecoration[]; unavailable: string },
): Promise<string> {
  const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
  if (reply) {
    md.inline.ruler.before('autolink', 'lumi_reply_decoration', (state, silent) => {
      if (state.src[state.pos] !== '<') return false
      const match = replyDecorationIndex(state.src, state.pos)
      if (!match || !reply.decorations[match.index]) return false
      if (!silent) state.push('lumi_reply_decoration', '', 0).meta = { index: match.index }
      state.pos = match.end
      return true
    })
    md.renderer.rules.lumi_reply_decoration = (tokens, index) => {
      const value = reply.decorations[Number(tokens[index]?.meta?.index)]
      const escape = md.utils.escapeHtml
      if (!value) return ''
      if (value.kind === 'badge-open')
        return '<span class="chat-reply-badge" data-tone="' + escape(value.tone) + '">'
      if (value.kind === 'badge-close') return '</span>'
      return (
        value.items
          .map(
            ({ url, title }) =>
              '<a class="chat-citation" rel="noopener noreferrer nofollow" href="' +
              escape(url) +
              '">' +
              escape(title) +
              '</a>',
          )
          .join('') +
        (value.unavailable
          ? '<span class="chat-citation chat-citation-unavailable">' +
            escape(reply.unavailable) +
            '</span>'
          : '')
      )
    }
  }
  // Raw HTML stays disabled. The known placeholder becomes a controlled illustration card.
  md.inline.ruler.before('autolink', 'lumi_illustration', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x3c) return false
    const rest = state.src.slice(state.pos, state.posMax)
    const tag = rest.startsWith(illustrationName) ? readReplyTag(state.src, state.pos) : undefined
    if (
      tag &&
      (tag.name === 'asyncimage' || tag.name === 'asyncimagegroup') &&
      !tag.incomplete &&
      tag.end <= state.posMax
    ) {
      if (!silent) {
        for (const query of readIllustrationQueries(tag)) {
          const item = illustrationFrom(query, tag.attributes.get('aspectratio'))
          const token = state.push('lumi_illustration', '', 0)
          token.attrSet('prompt', item.prompt)
          token.attrSet('ratio', item.ratio)
        }
      }
      state.pos = tag.end
      return true
    }
    // While streaming, an unfinished tag shows a placeholder instead of flashing raw markup.
    if (complete || !(rest.startsWith(illustrationName) || illustrationName.startsWith(rest)))
      return false
    if (!silent) state.push('lumi_illustration_pending', '', 0)
    state.pos = state.posMax
    return true
  })
  md.renderer.rules.lumi_illustration = (tokens, index) =>
    illustrationHTML(
      md.utils.escapeHtml,
      {
        prompt: String(tokens[index]?.attrGet('prompt') ?? ''),
        ratio: String(tokens[index]?.attrGet('ratio') ?? ''),
      },
      illustration,
    )
  md.renderer.rules.lumi_illustration_pending = () =>
    illustrationHTML(md.utils.escapeHtml, null, illustration)
  // Capture raw TeX before Markdown interprets its backslashes, braces or underscores.
  md.inline.ruler.before('escape', 'lumi_math', (state, silent) => {
    const start = state.pos
    if (state.src[start] !== '$') return false
    const display = state.src[start + 1] === '$',
      marker = display ? '$$' : '$'
    const from = start + marker.length
    let end = state.src.indexOf(marker, from)
    while (end >= 0 && state.src[end - 1] === '\\')
      end = state.src.indexOf(marker, end + marker.length)
    if (end < 0 || end === from) return false
    if (!silent) {
      const token = state.push(display ? 'math_display' : 'math_inline', '', 0)
      token.content = state.src.slice(from, end)
    }
    state.pos = end + marker.length
    return true
  })
  md.block.ruler.before('fence', 'lumi_math_block', (state, start, end, silent) => {
    const position = (state.bMarks[start] ?? 0) + (state.tShift[start] ?? 0)
    const first = state.src.slice(position, state.eMarks[start]).trim()
    if (first !== '$$') return false
    let last = start + 1
    while (
      last < end &&
      state.src
        .slice((state.bMarks[last] ?? 0) + (state.tShift[last] ?? 0), state.eMarks[last])
        .trim() !== '$$'
    )
      last++
    if (last >= end) return false
    if (silent) return true
    const token = state.push('math_block', '', 0)
    token.block = true
    token.map = [start, last + 1]
    token.content = state.getLines(start + 1, last, state.blkIndent, false)
    state.line = last + 1
    return true
  })
  // Do not load remote image URLs just because an assistant included one.
  md.renderer.rules.image = (tokens, index) => md.utils.escapeHtml(tokens[index]?.content ?? '')
  const originalLink = md.renderer.rules.link_open
  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    tokens[index]?.attrSet('rel', 'noopener noreferrer nofollow')
    return originalLink
      ? originalLink(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options)
  }
  const blocks = md.parse(source, {})
  const highlights = new Map<string, string>(),
    formulae = new Map<string, string>()
  const mathTokens: { source: string; display: boolean; key: string }[] = []
  for (const token of blocks) {
    if (token.type === 'math_block')
      mathTokens.push({ source: token.content, display: true, key: 'block:' + token.content })
    if (token.type === 'fence' && complete && token.content.length <= 40000) {
      const language = token.info.trim().split(/\s/)[0] ?? ''
      const key = token.content + '\0' + language
      highlights.set(
        key,
        await codeHTML(token.content, language).catch(
          () => '<pre><code>' + md.utils.escapeHtml(token.content) + '</code></pre>',
        ),
      )
    }
    if (token.type === 'inline' && token.children) {
      for (const child of token.children) {
        if (child.type === 'math_inline' || child.type === 'math_display')
          mathTokens.push({
            source: child.content,
            display: child.type === 'math_display',
            key: child.type + ':' + child.content,
          })
      }
    }
  }
  for (const item of mathTokens) {
    if (!formulae.has(item.key))
      formulae.set(
        item.key,
        item.source.length <= 20000
          ? await mathHTML(item.source, item.display).catch(() => md.utils.escapeHtml(item.source))
          : md.utils.escapeHtml(item.source),
      )
  }
  md.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index]
    if (!token) return ''
    const language = token.info.trim().split(/\s/)[0] ?? ''
    const html =
      highlights.get(token.content + '\0' + language) ??
      '<pre><code>' + md.utils.escapeHtml(token.content) + '</code></pre>'
    return (
      '<div class="chat-code"><div class="chat-code-heading"><span>' +
      md.utils.escapeHtml(language) +
      '</span><button type="button" data-copy-code>' +
      md.utils.escapeHtml(copyLabel) +
      '</button></div>' +
      html +
      '</div>'
    )
  }
  md.renderer.rules.math_block = (tokens, index) =>
    formulae.get('block:' + (tokens[index]?.content ?? '')) ?? ''
  for (const type of ['math_inline', 'math_display'])
    md.renderer.rules[type] = (tokens, index) =>
      formulae.get(type + ':' + (tokens[index]?.content ?? '')) ?? ''
  return DOMPurify.sanitize(md.renderer.render(blocks, md.options, {}), {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    FORBID_TAGS: ['img', 'iframe', 'object', 'embed', 'style', 'form', 'input'],
    ADD_ATTR: [
      'data-copy-code',
      'rel',
      'data-illustration-prompt',
      'data-illustration-ratio',
      'data-ratio',
    ],
  })
}
