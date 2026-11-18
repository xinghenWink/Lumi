// Some replies contain an exact replay of each streamed fragment. Require a
// run of differently sized pairs that also split words before removing copies.
export function recoverReplayedReply(content: string, complete: boolean): string {
  if (content.length < 128 || content.length > 128 * 1024) return content

  const fragments: string[] = []
  const sizes = new Set<number>()
  const wordCharacter = /[\p{L}\p{N}]/u
  let cursor = 0
  let splitWords = 0
  while (cursor < content.length) {
    const window = content.slice(cursor, cursor + 4096)
    const prefix = window.slice(0, 4)
    let size = window.indexOf(prefix, 8)
    while (size >= 0 && size <= 2048 && !window.startsWith(window.slice(0, size), size)) {
      size = window.indexOf(prefix, size + 1)
    }
    if (size < 0 || size > 2048) break

    const fragment = window.slice(0, size)
    if (wordCharacter.test(fragments.at(-1)?.at(-1) ?? '') && wordCharacter.test(fragment[0] ?? ''))
      splitWords++
    fragments.push(fragment)
    sizes.add(size)
    cursor += size * 2
  }

  if (cursor < 128 || sizes.size < 3 || splitWords < 2 || (complete && cursor !== content.length))
    return content
  return fragments.join('') + content.slice(cursor)
}
