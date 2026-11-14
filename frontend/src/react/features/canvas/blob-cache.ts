import { images, type ImageFile } from '../../../api/images'

type Variant = 'thumb' | 'original'

interface Entry {
  url: string | null
  promise: Promise<string>
  users: number
  controller: AbortController
}

/**
 * Shares object URLs between nodes showing the same file. Entries are reference counted
 * and the least recently released ones are revoked once the cache exceeds its size.
 */
export function createBlobCache(limit = 120) {
  const entries = new Map<string, Entry>()
  const idle: string[] = []

  const key = (file: ImageFile, variant: Variant) => file.id + ':' + variant

  function evict() {
    while (entries.size > limit && idle.length) {
      const id = idle.shift()
      const entry = id ? entries.get(id) : undefined
      if (!id || !entry || entry.users) continue
      entries.delete(id)
      entry.controller.abort()
      if (entry.url) URL.revokeObjectURL(entry.url)
    }
  }

  return {
    /** Resolves an object URL for the file; call release with the same arguments later. */
    acquire(file: ImageFile, variant: Variant): Promise<string> {
      const id = key(file, variant)
      let entry = entries.get(id)
      if (!entry) {
        const controller = new AbortController()
        const created: Entry = {
          url: null,
          users: 0,
          controller,
          promise: images.blob(file, variant === 'thumb', controller.signal).then((blob) => {
            const url = URL.createObjectURL(blob)
            if (entries.get(id) !== created) {
              URL.revokeObjectURL(url)
              throw new DOMException('Released', 'AbortError')
            }
            created.url = url
            return url
          }),
        }
        // A failed fetch is retried by the next acquire instead of being cached.
        created.promise.catch(() => {
          if (entries.get(id) === created) entries.delete(id)
        })
        entry = created
        entries.set(id, entry)
      }
      entry.users += 1
      const position = idle.indexOf(id)
      if (position >= 0) idle.splice(position, 1)
      return entry.promise
    },
    release(file: ImageFile, variant: Variant) {
      const id = key(file, variant)
      const entry = entries.get(id)
      if (!entry) return
      entry.users = Math.max(0, entry.users - 1)
      if (!entry.users) {
        idle.push(id)
        evict()
      }
    },
    /** Revokes every URL; later acquisitions fetch again. */
    clear() {
      for (const entry of entries.values()) {
        entry.controller.abort()
        if (entry.url) URL.revokeObjectURL(entry.url)
      }
      entries.clear()
      idle.length = 0
    },
  }
}

export type BlobCache = ReturnType<typeof createBlobCache>
