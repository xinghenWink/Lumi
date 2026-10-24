import { useEffect, useRef, useState } from 'react'
import { images, type ImageFile } from '../../../api/images'
import { ApiError } from '../../../api/transport'
import { authorizedResponse } from '../../../api/protected'
import { useRuntime } from '../../app/context'

export function useImageActions() {
  const runtime = useRuntime()
  const [error, setError] = useState<unknown>(null),
    [copied, setCopied] = useState(false)
  const controllers = useRef(new Set<AbortController>())
  const urls = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    const cleanup = () => {
      for (const controller of controllers.current) controller.abort()
      controllers.current.clear()
      for (const [url, timer] of urls.current) {
        clearTimeout(timer)
        URL.revokeObjectURL(url)
      }
      urls.current.clear()
    }
    let identity = runtime.session.getSnapshot().user?.id,
      epoch = runtime.session.snapshot().epoch
    const unsubscribe = runtime.session.subscribe(() => {
      const next = runtime.session.getSnapshot()
      if (identity !== next.user?.id || epoch !== next.epoch) {
        cleanup()
        identity = next.user?.id
        epoch = next.epoch
      }
    })
    return () => {
      mounted.current = false
      cleanup()
      unsubscribe()
    }
  }, [runtime])
  async function perform(
    load: (signal: AbortSignal) => Promise<Blob>,
    filename: string,
    copy: boolean,
  ) {
    const owner = runtime.session.getSnapshot().user?.id,
      epoch = runtime.session.snapshot().epoch,
      controller = new AbortController()
    controllers.current.add(controller)
    const valid = () =>
      mounted.current &&
      !controller.signal.aborted &&
      !!owner &&
      owner === runtime.session.getSnapshot().user?.id &&
      epoch === runtime.session.snapshot().epoch
    setError(null)
    setCopied(false)
    try {
      if (copy && (!navigator.clipboard?.write || !window.ClipboardItem))
        throw new ApiError('IMAGE_COPY_UNAVAILABLE')
      const blob = load(controller.signal).then((value) => {
        if (!valid()) throw new ApiError('AUTH_REQUIRED')
        return value
      })
      // Clipboard implementations can reject before consuming the supplied promise.
      void blob.catch(() => undefined)
      if (copy) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        if (valid()) setCopied(true)
      } else {
        const value = await blob
        if (!valid()) return
        const url = URL.createObjectURL(value),
          link = document.createElement('a')
        link.href = url
        link.download = filename
        link.click()
        urls.current.set(
          url,
          setTimeout(() => {
            URL.revokeObjectURL(url)
            urls.current.delete(url)
          }, 1000),
        )
      }
    } catch (failure) {
      if (valid()) setError(failure)
    } finally {
      controllers.current.delete(controller)
    }
  }
  return {
    error,
    copied,
    download: (file: ImageFile) =>
      perform((signal) => images.blob(file, false, signal), 'lumi-' + file.id + '.png', false),
    copy: (file: ImageFile) => perform((signal) => images.blob(file, false, signal), '', true),
    downloadBatch: (ids: string[]) =>
      perform(
        async (signal) => {
          const response = await authorizedResponse('/api/v1/me/images/batch-download', {
            method: 'POST',
            body: { ids },
            signal,
          })
          return response.blob()
        },
        'lumi-images.zip',
        false,
      ),
  }
}
