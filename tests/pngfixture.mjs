/**
 * A minimal PNG encoder, so browser suites can hand Playwright a real image file
 * without a binary fixture committed to the repo. Uncompressed-friendly and tiny —
 * it only has to produce something a browser will decode.
 */

import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  const body = out.subarray(4, 8 + data.length)
  out.writeUInt32BE(crc32(body), 8 + data.length)
  return out
}

/**
 * @param fn (x, y) -> [r, g, b]
 * @returns {Buffer} a valid 8-bit RGB PNG
 */
export function makePng(width, height, fn) {
  const raw = Buffer.alloc(height * (width * 3 + 1))
  let p = 0
  for (let y = 0; y < height; y++) {
    raw[p++] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fn(x, y)
      raw[p++] = r
      raw[p++] = g
      raw[p++] = b
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** A circle on a plain ground — the shape that shows whether gauge correction works. */
export function circlePng(width, height) {
  return makePng(width, height, (x, y) => {
    const dx = (x + 0.5) / width - 0.5
    const dy = (y + 0.5) / height - 0.5
    return Math.hypot(dx, dy) < 0.34 ? [42, 92, 132] : [242, 232, 213]
  })
}

/**
 * A circle over a two-axis gradient. Stands in for a photograph: enough distinct
 * colours that the colour-limit controls have something to actually do, which a flat
 * two-colour fixture cannot exercise.
 */
export function photoPng(width, height) {
  return makePng(width, height, (x, y) => {
    const u = x / Math.max(1, width - 1)
    const v = y / Math.max(1, height - 1)
    const dx = (x + 0.5) / width - 0.5
    const dy = (y + 0.5) / height - 0.5
    if (Math.hypot(dx, dy) < 0.3) {
      return [Math.round(40 + u * 160), Math.round(90 + v * 120), 150]
    }
    return [Math.round(230 - v * 180), Math.round(120 + u * 110), Math.round(60 + v * 170)]
  })
}

/** Read an IHDR back out, for asserting on a downloaded PNG. */
export function readPngSize(bytes) {
  const buf = Buffer.from(bytes)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** Playwright's setInputFiles payload. */
/**
 * A logo file as one actually arrives: a few flat colours, antialiased edges, and a
 * dusting of compression noise. The noise is the point — a crisp logo is easy to
 * recognise as flat artwork, and a logo that has been through a JPEG is what defeated
 * the old detection.
 */
export function logoPng(width, height) {
  const NAVY = [11, 22, 42]
  const ORANGE = [200, 56, 3]
  const WHITE = [245, 245, 245]
  const SS = 4
  let seed = 20260920
  const jitter = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return (seed / 0x7fffffff - 0.5) * 12
  }
  const shape = (x, y) => {
    const u = (x / width - 0.5) * 2.2
    const v = (y / height - 0.5) * 2.2
    const r = Math.hypot(u, v * 0.78)
    if (Math.abs(Math.atan2(v, u)) < 0.38) return WHITE
    if (r < 0.92 && r > 0.34) return r > 0.82 || r < 0.44 ? NAVY : ORANGE
    return WHITE
  }
  return makePng(width, height, (x, y) => {
    let r = 0
    let g = 0
    let b = 0
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const [cr, cg, cb] = shape(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)
        r += cr
        g += cg
        b += cb
      }
    }
    const n = SS * SS
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)))
    return [clamp(r / n + jitter()), clamp(g / n + jitter()), clamp(b / n + jitter())]
  })
}

export function asUpload(name, buffer) {
  return { name, mimeType: 'image/png', buffer }
}

/**
 * A big picture whose detail is FINER than a whole-frame working copy can hold.
 *
 * Vertical stripes, ten pixels to a pair. In a 4200px photo scaled down to the 1024px
 * whole-frame copy that is a period of two and a half pixels, which averaging flattens to
 * a single mid-tone. Rebuild the copy around a quarter of the photo and the same stripes
 * are eight pixels apart — two chart stitches — and plainly chartable.
 *
 * Uniform on purpose: every part of the picture holds the same stripes, so a chart of a
 * crop and a chart of the whole photo differ in exactly one thing, which is how much
 * detail the working copy kept. Anything less regular and the comparison would be
 * measuring the content instead.
 */
export function finePatternPng(width, height) {
  const NAVY = [18, 30, 62]
  const CREAM = [242, 232, 208]
  return makePng(width, height, (x) => (x % 10 < 5 ? NAVY : CREAM))
}
