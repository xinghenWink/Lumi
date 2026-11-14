import { useEffect, useRef, useState } from 'react'
import { Navigate, useBlocker, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { canvases, type Canvas } from '../../api/canvases'
import { useSession } from '../features/auth/hooks'
import { createAutosave } from '../features/canvas/autosave'
import { useStore } from 'zustand'
import { createBlobCache } from '../features/canvas/blob-cache'
import { CanvasContext, type CanvasServices } from '../features/canvas/context'
import { createCanvasEditor } from '../features/canvas/editor'
import { createCanvasGeneration } from '../features/canvas/generation'
import { useCanvasCatalog } from '../features/canvas/i18n'
import { canvasListKey, patchCanvasList, useCanvasMutations } from '../features/canvas/queries'
import { createCanvasUploads } from '../features/canvas/uploads'
import { useImageConfig } from '../features/images/config'
import type { Rejections } from '../features/files/reference-rules'
import { CanvasEditor } from '../components/canvas/CanvasEditor'
import { PageStatus } from '../components/shared/PageStatus'
import { DropLayer } from '../components/shared/DropLayer'
import { ModalDialog } from '../components/ui/modal-dialog'
import { Button } from '../components/ui/button'
import { RuntimeBanner } from '../components/shared/RuntimeBanner'

function Workspace({ canvas }: { canvas: Canvas }) {
  const client = useQueryClient()
  const { t } = useTranslation()
  const { user } = useSession()
  const config = useImageConfig()
  const [rejected, setRejected] = useState<Rejections | null>(null)
  const [services] = useState<CanvasServices>(() => {
    const editor = createCanvasEditor(canvas)
    const owner = user?.id
    const refresh = () => {
      for (const key of ['credits', 'image-gallery', 'image-library'])
        void client.invalidateQueries({ queryKey: ['user', owner, key] })
    }
    const autosave = createAutosave(editor, {
      save: async (body) => {
        const result = await canvases.save(canvas.id, body)
        patchCanvasList(client, owner, result)
        return result
      },
      load: () => canvases.get(canvas.id),
    })
    return {
      editor,
      autosave,
      generation: createCanvasGeneration(editor, autosave, { changed: refresh }),
      uploads: createCanvasUploads(editor, { rejected: setRejected }),
      blobs: createBlobCache(),
    }
  })
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname && services.autosave.unsaved(),
  )
  const [leaving, setLeaving] = useState(false)
  const title = useStore(services.editor.store, (state) => state.title)
  useEffect(() => {
    document.title = `${title || t('canvas.editor.titlePlaceholder')} · ${t('app.name')}`
  }, [title, t])

  const maxBytes = config.data?.max_upload_bytes
  useEffect(() => services.uploads.setMaxBytes(maxBytes), [services, maxBytes])

  useEffect(() => {
    const { autosave, generation, uploads, blobs } = services
    // Each controller restarts cleanly when React StrictMode replays this effect.
    const stops = [autosave.mount(), generation.mount(), uploads.mount()]
    const hidden = () => {
      if (document.visibilityState === 'hidden') void autosave.flush()
    }
    const leave = (event: BeforeUnloadEvent) => {
      void autosave.flush()
      if (autosave.unsaved()) event.preventDefault()
    }
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('beforeunload', leave)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('beforeunload', leave)
      // The autosave cleanup still sends the last edits after the page is left.
      for (const stop of stops) stop()
      blobs.clear()
      void client.invalidateQueries({ queryKey: canvasListKey(user?.id) })
    }
  }, [services, client, user?.id])

  return (
    <CanvasContext.Provider value={services}>
      <main
        id="main-content"
        className="flex h-dvh flex-col overflow-hidden bg-background text-foreground"
      >
        <RuntimeBanner />
        <DropLayer>
          <CanvasEditor rejected={rejected} />
        </DropLayer>
      </main>
      <ModalDialog
        open={blocker.state === 'blocked'}
        busy={leaving}
        title={t('canvas.editor.leaveTitle')}
        description={t('canvas.editor.leaveDescription')}
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') blocker.reset()
        }}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => blocker.reset?.()}>
            {t('canvas.editor.stay')}
          </Button>
          <Button
            variant="outline"
            disabled={leaving}
            onClick={() => {
              services.autosave.discard()
              blocker.proceed?.()
            }}
          >
            {t('canvas.editor.leave')}
          </Button>
          <Button
            disabled={leaving}
            onClick={() => {
              setLeaving(true)
              void services.autosave
                .flush()
                .then(() => {
                  if (!services.autosave.unsaved()) blocker.proceed?.()
                  else blocker.reset?.()
                })
                .finally(() => setLeaving(false))
            }}
          >
            {t('canvas.editor.saveAndLeave')}
          </Button>
        </div>
      </ModalDialog>
    </CanvasContext.Provider>
  )
}

function NewCanvas() {
  const navigate = useNavigate()
  const { create } = useCanvasMutations()
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    create.mutate('', {
      onSuccess: (canvas) => void navigate('/canvas/' + canvas.id, { replace: true }),
    })
  }, [create, navigate])
  return <PageStatus error={create.error} retry={() => create.mutate('')} />
}

export default function CanvasPage() {
  const { id = '' } = useParams()
  const { user } = useSession()
  const ready = useCanvasCatalog()
  const valid = /^[0-9a-f-]{36}$/i.test(id)
  const query = useQuery({
    queryKey: ['user', user?.id, 'canvas', id],
    enabled: !!user && valid && id !== 'new',
    queryFn: ({ signal }) => canvases.get(id, signal),
    // The editor owns the live copy; every visit starts from the server version.
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  if (!ready) return <PageStatus />
  if (id === 'new') return <NewCanvas />
  if (!valid) return <Navigate to="/canvas" replace />
  if (!query.data) return <PageStatus error={query.error} retry={() => void query.refetch()} />
  return <Workspace key={query.data.id} canvas={query.data} />
}
