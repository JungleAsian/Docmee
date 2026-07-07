// Generates the PWA app icons (Req 23 — PWA foundation).
//
// The manifest referenced /icon-192.png and /icon-512.png but no icon files
// existed, so the panel could never be installed on Android/iOS. This script
// renders the icons with zero dependencies (raw PNG encoding) so they can be
// regenerated deterministically: a brand-blue tile with a white medical cross,
// padded to stay inside the maskable safe zone.
//
//   node scripts/generate-icons.mjs
//
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

// Brand palette (matches manifest theme_color / background_color).
const BG = [59, 130, 246] // #3b82f6
const FG = [255, 255, 255] // white cross

// CRC-32 (PNG chunk checksum) — small table-driven implementation.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

// Render an RGBA raster: brand background + centered white plus sign.
function renderCross(size) {
  const px = (x, y, [r, g, b]) => {
    const i = (y * size + x) * 4
    raster[i] = r
    raster[i + 1] = g
    raster[i + 2] = b
    raster[i + 3] = 255
  }
  const raster = Buffer.alloc(size * size * 4)
  // Cross arm half-thickness and reach (kept within the inner 80% safe zone).
  const half = Math.round(size * 0.1) // arm half-width => 20% thick
  const reach = Math.round(size * 0.28) // arm extent from center => 56% long
  const c = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x - c)
      const dy = Math.abs(y - c)
      const inVertical = dx <= half && dy <= reach
      const inHorizontal = dy <= half && dx <= reach
      px(x, y, inVertical || inHorizontal ? FG : BG)
    }
  }
  return raster
}

function encodePng(size) {
  const raster = renderCross(size)
  // Prefix each scanline with filter byte 0 (none).
  const stride = size * 4
  const rows = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    rows[y * (stride + 1)] = 0
    raster.copy(rows, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(PUBLIC_DIR, { recursive: true })
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  const out = join(PUBLIC_DIR, name)
  writeFileSync(out, encodePng(size))
  console.log(`wrote ${name} (${size}x${size})`)
}
