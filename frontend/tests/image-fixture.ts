import { deflateSync } from 'node:zlib'
// A deterministic PNG fixture exercises decoding, normalization and real WebP thumbnails.
export function fixturePNG() {
  const width = 900,
    height = 600,
    pixels = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = y * (width * 3 + 1) + x * 3 + 1
      pixels[at] = 30 + Math.floor((x / width) * 110)
      pixels[at + 1] = 35 + Math.floor((y / height) * 100)
      pixels[at + 2] = 135 + Math.floor((x / width) * 90)
    }
  function chunk(name: string, data: Buffer) {
    const tag = Buffer.from(name),
      input = Buffer.concat([tag, data])
    let crc = 0xffffffff
    for (const byte of input) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    const length = Buffer.alloc(4),
      checksum = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([length, input, checksum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
