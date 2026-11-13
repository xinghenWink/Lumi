import type { CanvasNode } from '../../../api/canvases'
import type { ImageFile } from '../../../api/images'
import {
  addNodes,
  bringToFront,
  cascade,
  extractFragment,
  groupNodes,
  insertFragment,
  moveNodes,
  removeEdges,
  removeNodes,
  ungroup,
  type Fragment,
} from '../../../features/canvas/commands'
import {
  DEFAULT_SIZE,
  fitImage,
  generatorNode,
  imageNode,
  textNode,
} from '../../../features/canvas/document'
import {
  boundsOf,
  fitBounds,
  screenToWorld,
  wheelZoom,
  zoomAt,
  type Point,
} from '../../../features/canvas/geometry'
import { generatorFromSelection } from '../../../features/canvas/workflow'
import type { CanvasEditor } from './editor'

/** World point at the middle of the visible stage. */
export function stageCenter(editor: CanvasEditor): Point {
  const { stage, viewport } = editor.state
  return screenToWorld({ x: stage.width / 2, y: stage.height / 2 }, viewport)
}

function place(editor: CanvasEditor, wanted: CanvasNode) {
  const node = cascade(editor.state.doc, wanted)
  if (!editor.apply((doc) => addNodes(doc, [node]))) {
    editor.notify({ key: 'canvas.editor.limit' })
    return false
  }
  editor.select([node.id])
  return true
}

/** Places a library file at the stage center, sized to its aspect ratio. */
export function insertFile(editor: CanvasEditor, file: ImageFile) {
  const center = stageCenter(editor)
  const size = fitImage(file.width, file.height)
  editor.addFiles([file])
  return place(
    editor,
    imageNode(
      { x: center.x - size.w / 2, y: center.y - size.h / 2, ...size },
      { state: 'ready', file_id: file.id },
    ),
  )
}

export function addText(editor: CanvasEditor, at = stageCenter(editor)) {
  const { w, h } = DEFAULT_SIZE.text
  const node = textNode({ x: at.x - w / 2, y: at.y - h / 2 })
  if (place(editor, node)) editor.setEditing(node.id)
}

export function addGenerator(editor: CanvasEditor, at = stageCenter(editor)) {
  const { w, h } = DEFAULT_SIZE.generator
  const node = generatorNode({ x: at.x - w / 2, y: at.y - h / 2 })
  if (place(editor, node)) editor.openInspector(node.id)
}

/** Creates a generator fed by the selection and opens its parameters. */
export function generateFromSelection(editor: CanvasEditor) {
  let created: string | null = null
  editor.apply((doc) => {
    const result = generatorFromSelection(doc, editor.state.selection)
    created = result.generator
    return result.doc
  })
  if (created) {
    editor.select([created])
    editor.openInspector(created)
  }
}

export function removeSelection(editor: CanvasEditor) {
  const { selection, edgeSelection } = editor.state
  if (selection.length) editor.apply((doc) => removeNodes(doc, selection))
  else if (edgeSelection.length) editor.apply((doc) => removeEdges(doc, edgeSelection))
}

export function groupSelection(editor: CanvasEditor, title: string) {
  let group: string | null = null
  editor.apply((doc) => {
    const result = groupNodes(doc, editor.state.selection, title)
    group = result.group
    return result.doc
  })
  if (group) editor.select([group])
}

export function ungroupSelection(editor: CanvasEditor) {
  editor.apply((doc) => ungroup(doc, editor.state.selection))
}

export function raiseSelection(editor: CanvasEditor) {
  editor.apply((doc) => bringToFront(doc, editor.state.selection))
}

export function nudgeSelection(editor: CanvasEditor, dx: number, dy: number) {
  editor.apply((doc) => moveNodes(doc, editor.state.selection, dx, dy), { key: 'nudge' })
}

export function selectAll(editor: CanvasEditor) {
  editor.select(editor.state.doc.nodes.map((node) => node.id))
}

export function copySelection(editor: CanvasEditor): Fragment | null {
  const fragment = extractFragment(editor.state.doc, editor.state.selection)
  return fragment.nodes.length ? fragment : null
}

/** Inserts a fragment centered on a world point and selects the copy. */
export function pasteFragment(editor: CanvasEditor, fragment: Fragment, at = stageCenter(editor)) {
  const bounds = boundsOf(fragment.nodes)
  if (!bounds) return
  const offset = { x: at.x - (bounds.x + bounds.w / 2), y: at.y - (bounds.y + bounds.h / 2) }
  let pasted: string[] = []
  const changed = editor.apply((doc) => {
    const result = insertFragment(doc, fragment, offset)
    pasted = result.ids
    return result.doc
  })
  if (changed) editor.select(pasted)
  else editor.notify({ key: 'canvas.editor.limit' })
}

export function duplicateSelection(editor: CanvasEditor) {
  const fragment = copySelection(editor)
  const bounds = fragment && boundsOf(fragment.nodes)
  if (!fragment || !bounds) return
  pasteFragment(editor, fragment, {
    x: bounds.x + bounds.w / 2 + 32,
    y: bounds.y + bounds.h / 2 + 32,
  })
}

export function zoomBy(editor: CanvasEditor, factor: number) {
  const { stage, viewport } = editor.state
  editor.setViewport(
    zoomAt(viewport, { x: stage.width / 2, y: stage.height / 2 }, viewport.zoom * factor),
  )
}

export function resetZoom(editor: CanvasEditor) {
  const { stage, viewport } = editor.state
  editor.setViewport(zoomAt(viewport, { x: stage.width / 2, y: stage.height / 2 }, 1))
}

export function wheel(editor: CanvasEditor, point: Point, deltaY: number) {
  editor.setViewport(wheelZoom(editor.state.viewport, point, deltaY))
}

export function fitAll(editor: CanvasEditor) {
  const { doc, stage } = editor.state
  editor.setViewport(fitBounds(boundsOf(doc.nodes), stage))
}
