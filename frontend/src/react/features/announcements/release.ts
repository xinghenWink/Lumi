import type { AnnouncementRelease } from '../../../api/operations'

export const announcementCharacterLimit = 10_000

export function releaseDraft(release: AnnouncementRelease) {
  const notes = release.notes
    .replace(/\r\n?/g, '\n')
    .replace(/\p{Cc}/gu, (character) => (character === '\n' || character === '\t' ? character : ''))
  const heading = `## ${release.version}`
  const characters = Array.from(notes.trim() ? `${heading}\n\n${notes}` : heading)
  const truncated = characters.length > announcementCharacterLimit
  return {
    tag: release.version,
    content: truncated
      ? characters.slice(0, announcementCharacterLimit - 1).join('') + '…'
      : characters.join(''),
    truncated,
  }
}

export function announcementReleaseURL(tag: string) {
  return `https://github.com/xinghenWink/Lumi/releases/tag/${encodeURIComponent(tag)}`
}
