import { beforeEach, describe, expect, it } from 'vitest'
import { announcementSessionId, dismissAnnouncement, isAnnouncementDismissed } from './dismissal'
import { announcementCharacterLimit, releaseDraft } from './release'

const family = '019a0000-0000-7000-8000-000000000001'
const nextFamily = '019a0000-0000-7000-8000-000000000002'

beforeEach(() => localStorage.clear())

describe('announcement dismissal', () => {
  it('uses the same session family across token rotations', () => {
    const token = (exp: number) => `header.${window.btoa(JSON.stringify({ sid: family, exp }))}.sig`
    expect(announcementSessionId(token(1))).toBe(family)
    expect(announcementSessionId(token(2))).toBe(family)
    expect(announcementSessionId('opaque-token')).toBeNull()
    expect(announcementSessionId('prefix.broken.suffix')).toBeNull()
  })

  it('scopes the current dismissal to one account and login', () => {
    dismissAnnouncement('alice', family, 'current')
    expect(isAnnouncementDismissed('alice', family)).toBe(true)
    expect(isAnnouncementDismissed('alice', nextFamily)).toBe(false)
    expect(isAnnouncementDismissed('bob', family)).toBe(false)
  })

  it('scopes the daily dismissal to the account and expires at local midnight', () => {
    const late = new Date(2026, 10, 18, 23, 59, 59)
    const midnight = new Date(2026, 10, 19, 0, 0, 0)
    dismissAnnouncement('alice', family, 'today', late)
    expect(isAnnouncementDismissed('alice', nextFamily, late)).toBe(true)
    expect(isAnnouncementDismissed('bob', nextFamily, late)).toBe(false)
    expect(isAnnouncementDismissed('alice', nextFamily, midnight)).toBe(false)
  })
})

describe('GitHub announcement draft', () => {
  const version = 'v1.2.3'
  const release = { version, name: 'Release', published_at: '2026-11-18T01:00:00Z' }

  it('preserves Markdown and handles blank notes', () => {
    expect(releaseDraft({ ...release, notes: ' ' })).toEqual({
      tag: version,
      content: '## v1.2.3',
      truncated: false,
    })
    expect(releaseDraft({ ...release, notes: '- Feature\r\n\t- Details\u0000' }).content).toBe(
      '## v1.2.3\n\n- Feature\n\t- Details',
    )
  })

  it('truncates without breaking Unicode characters', () => {
    const draft = releaseDraft({ ...release, notes: '🌟'.repeat(announcementCharacterLimit) })
    expect(draft.truncated).toBe(true)
    expect(Array.from(draft.content)).toHaveLength(announcementCharacterLimit)
    expect(draft.content.endsWith('🌟…')).toBe(true)
  })
})
