export type Crop = { x: number; y: number; w: number; h: number }

export function cropPixels(crop: Crop, width: number, height: number): Crop {
  const x = Math.max(0, Math.min(width - 1, Math.floor(crop.x * width)))
  const y = Math.max(0, Math.min(height - 1, Math.floor(crop.y * height)))
  return {
    x,
    y,
    w: Math.max(1, Math.min(width, Math.ceil((crop.x + crop.w) * width)) - x),
    h: Math.max(1, Math.min(height, Math.ceil((crop.y + crop.h) * height)) - y),
  }
}

export function splitPixels(
  width: number,
  height: number,
  vertical: number[],
  horizontal: number[],
): Crop[] {
  const cuts = (size: number, lines: number[]) => [
    0,
    ...new Set(
      lines
        .map((line) => Math.max(1, Math.min(size - 1, Math.round(line * size))))
        .sort((a, b) => a - b),
    ),
    size,
  ]
  const xs = cuts(width, vertical)
  const ys = cuts(height, horizontal)
  return ys.slice(0, -1).flatMap((y, row) =>
    xs.slice(0, -1).map((x, column) => ({
      x,
      y,
      w: (xs[column + 1] ?? width) - x,
      h: (ys[row + 1] ?? height) - y,
    })),
  )
}

export const gridCuts = (count: number) =>
  Array.from({ length: count - 1 }, (_, index) => (index + 1) / count)

export function scalePixels(width: number, height: number, longEdge: number) {
  const scale = longEdge / Math.max(width, height)
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) }
}

export async function renderImage(
  source: ImageBitmap,
  crop: Crop,
  size: Pick<Crop, 'w' | 'h'> = crop,
  sharp = false,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = size.w
  canvas.height = size.h
  try {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image context is unavailable')
    context.imageSmoothingEnabled = !sharp
    context.imageSmoothingQuality = 'high'
    context.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, size.w, size.h)
    return await new Promise((resolve, reject) =>
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Image encoding failed'))
      }, 'image/png'),
    )
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}
