import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Film } from 'lucide-react'
import { canvases, type CanvasNode } from '../../../api/canvases'
import { ApiError } from '../../../api/transport'
import { videoAPI, videoPending, type VideoReference } from '../../../api/videos'
import { updateNode } from '../../../features/canvas/commands'
import { useCanvas, useEditor } from '../../features/canvas/context'
import { useSession } from '../../features/auth/hooks'
import { Button } from '../ui/button'
import { ModalDialog } from '../ui/modal-dialog'
import { AssetPicker, VideoComposer } from '../videos/VideoComposer'
import { VideoPlayer } from '../videos/VideoPlayer'

export function CanvasVideoContent({ node }: { node: CanvasNode }) {
  const { t } = useTranslation()
  const { user } = useSession()
  const { editor, autosave } = useCanvas()
  const client = useQueryClient()
  const video = node.video
  const taskId = video?.task_id
  const [show, setShow] = useState(false)
  const [importing, setImporting] = useState(false)
  const submission = useRef<{ key: string; version: number } | undefined>(undefined)
  const nodes = useEditor((state) => state.doc.nodes)
  const edges = useEditor((state) => state.doc.edges)
  const linked: VideoReference[] = []
  const sourceText: string[] = []
  for (const edge of edges) {
    if (edge.kind !== 'input' || edge.to !== node.id) continue
    const source = nodes.find((item) => item.id === edge.from)
    if (source?.image?.file_id)
      linked.push({ file_id: source.image.file_id, role: 'reference_image' })
    if (source?.video?.file_id)
      linked.push({ file_id: source.video.file_id, role: 'reference_video' })
    if (source?.text?.content && source.text.state !== 'pending' && source.text.state !== 'failed')
      sourceText.push(source.text.content)
  }
  const task = useQuery({
    queryKey: ['user', user?.id, 'video-task', taskId],
    queryFn: ({ signal }) => videoAPI.task(taskId ?? '', signal),
    enabled: Boolean(taskId) && video?.state === 'pending',
    refetchInterval: (query) =>
      !query.state.data || videoPending(query.state.data.status) ? 3000 : false,
  })
  useEffect(() => {
    const result = task.data
    if (!result) return
    editor.patchEverywhere((doc) => {
      let changed = false
      const nodes = doc.nodes.map((item) => {
        const slot = item.video
        if (!slot || slot.task_id !== result.id || slot.state !== 'pending') return item
        const part = result.items.find(({ position }) => position === slot.position)
        if (!part || !(part.status === 'succeeded' || part.status === 'failed')) return item
        changed = true
        return {
          ...item,
          video: {
            ...slot,
            state: part.status === 'succeeded' ? ('ready' as const) : ('failed' as const),
            file_id: part.file_id ?? null,
            error_code: part.error_code ?? '',
          },
        }
      })
      return changed ? { ...doc, nodes } : doc
    })
    if (!videoPending(result.status))
      void client.invalidateQueries({ queryKey: ['user', user?.id, 'credits'] })
  }, [task.data, editor, client, user?.id])

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-sm">
      {video?.file_id ? (
        <div
          className="min-h-0 flex-1 overflow-hidden [&_video]:aspect-auto"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <VideoPlayer fileId={video.file_id} download={false} />
        </div>
      ) : (
        <span className="grid flex-1 place-items-center px-2 text-center text-muted-foreground">
          {t(
            video?.state === 'pending'
              ? 'video.running'
              : video?.state === 'failed'
                ? 'video.failed'
                : 'video.emptyNode',
          )}
        </span>
      )}
      {video?.state !== 'pending' ? (
        <div
          className="flex flex-wrap items-center justify-center gap-1 border-t border-border p-1"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Button type="button" variant="ghost" size="sm" onClick={() => setShow(true)}>
            <Film />
            {t('video.openComposer')}
          </Button>
          {video?.state === 'empty' ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setImporting(true)}>
              {t('video.importVideo')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {importing ? (
        <AssetPicker
          roles={['reference_video']}
          onClose={() => setImporting(false)}
          onSelect={(asset) => {
            editor.apply((doc) =>
              updateNode(doc, node.id, (value) => ({
                ...value,
                video: {
                  state: 'ready',
                  file_id: asset.id,
                  task_id: null,
                  position: null,
                  error_code: '',
                },
              })),
            )
            setImporting(false)
          }}
        />
      ) : null}
      {show ? (
        <ModalDialog
          open
          wide
          title={t('video.openComposer')}
          description={t('video.prompt')}
          onOpenChange={(open) => setShow(open)}
        >
          <VideoComposer
            linked={linked}
            sourceText={sourceText.join('\n\n')}
            quoteVideo={async (input) => {
              await autosave.flush()
              if (autosave.pending()) throw new ApiError('CANVAS_CONFLICT', 409)
              return canvases.videoQuote(editor.state.canvasId, {
                ...input,
                version: editor.state.version,
                node_id: node.id,
              })
            }}
            submitVideo={async (body, key) => {
              const accepted = await autosave.submit(
                (version) => {
                  if (submission.current?.key !== key) submission.current = { key, version }
                  return canvases.videoRun(
                    editor.state.canvasId,
                    { ...body, version: submission.current.version, node_id: node.id },
                    key,
                  )
                },
                (board, task) => {
                  const slots = board.document.nodes.filter(
                    (item) => item.video?.task_id === task.id,
                  )
                  const byId = new Map(slots.map((item) => [item.id, item]))
                  editor.apply((doc) => {
                    const current = new Set(doc.nodes.map((item) => item.id))
                    return {
                      ...doc,
                      nodes: [
                        ...doc.nodes.map((currentNode) => {
                          const video = byId.get(currentNode.id)?.video
                          return video ? { ...currentNode, video } : currentNode
                        }),
                        ...slots.filter((item) => !current.has(item.id)),
                      ],
                      edges: [
                        ...doc.edges,
                        ...board.document.edges.filter(
                          (edge) =>
                            edge.kind === 'result' &&
                            byId.has(edge.to) &&
                            !current.has(edge.to) &&
                            current.has(edge.from),
                        ),
                      ],
                    }
                  })
                },
              )
              if (!accepted) throw new ApiError('CANVAS_CONFLICT', 409)
              submission.current = undefined
              return accepted
            }}
            onSubmitted={() => {
              void client.invalidateQueries({ queryKey: ['user', user?.id, 'credits'] })
              void client.invalidateQueries({ queryKey: ['user', user?.id, 'video-tasks'] })
              setShow(false)
            }}
          />
        </ModalDialog>
      ) : null}
    </div>
  )
}
