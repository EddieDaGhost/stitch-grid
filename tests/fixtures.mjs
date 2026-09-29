/**
 * Synthetic rasters, so the pure suites never need an image file on disk.
 * Every builder returns the same shape `loadSource` produces: {width, height, data}.
 */

import { buildSat } from '../src/lib/raster.js'
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/lib/settings.js'

export function raster(width, height, fn) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = fn(x, y)
      const p = (y * width + x) * 4
      data[p] = r
      data[p + 1] = g
      data[p + 2] = b
      data[p + 3] = a
    }
  }
  return { width, height, data }
}

export const solid = (w, h, rgb) => raster(w, h, () => rgb)

/** Left half one colour, right half another. Seam is exact. */
export const halves = (w, h, left, right) => raster(w, h, (x) => (x < w / 2 ? left : right))

export const gradient = (w, h) => raster(w, h, (x) => {
  const v = Math.round((x / Math.max(1, w - 1)) * 255)
  return [v, v, v]
})

/** A filled circle — the shape that proves gauge correction works. */
export const circle = (w, h, inside, outside) =>
  raster(w, h, (x, y) => {
    const dx = (x + 0.5) / w - 0.5
    const dy = (y + 0.5) / h - 0.5
    return Math.hypot(dx, dy) < 0.35 ? inside : outside
  })

export const checker = (w, h, size, a, b) =>
  raster(w, h, (x, y) => ((Math.floor(x / size) + Math.floor(y / size)) % 2 ? a : b))

/** Opaque shape on a fully transparent background. */
export const transparentLogo = (w, h, rgb) =>
  raster(w, h, (x, y) => {
    const inShape = x > w * 0.25 && x < w * 0.75 && y > h * 0.25 && y < h * 0.75
    return inShape ? [...rgb, 255] : [0, 0, 0, 0]
  })

/**
 * A logo: a few flat colours in hard-edged shapes, optionally with the antialiasing and
 * compression noise every real logo file carries. `ss` supersamples the edges; `noise`
 * jitters every channel the way a JPEG does.
 *
 * The noisy variant matters more than the clean one. A crisp logo is easy to recognise;
 * the bug worth guarding is the one where a logo saved as a JPEG stops being recognised
 * as flat artwork and gets averaged like a photograph.
 */
export function flatLogo(w, h, { ss = 1, noise = 0 } = {}) {
  const NAVY = [11, 22, 42]
  const ORANGE = [200, 56, 3]
  const WHITE = [245, 245, 245]
  const shape = (x, y) => {
    const u = (x / w - 0.5) * 2.2
    const v = (y / h - 0.5) * 2.2
    const r = Math.hypot(u, v * 0.78)
    if (Math.abs(Math.atan2(v, u)) < 0.38) return WHITE
    if (r < 0.92 && r > 0.34) return r > 0.82 || r < 0.44 ? NAVY : ORANGE
    return WHITE
  }
  // A fixed sequence, so a fixture is the same picture on every run.
  let seed = 20260920
  const jitter = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return (seed / 0x7fffffff - 0.5) * 2 * noise
  }
  return raster(w, h, (x, y) => {
    let r = 0
    let g = 0
    let b = 0
    for (let sy = 0; sy < ss; sy++) {
      for (let sx = 0; sx < ss; sx++) {
        const [cr, cg, cb] = shape(x + (sx + 0.5) / ss, y + (sy + 0.5) / ss)
        r += cr
        g += cg
        b += cb
      }
    }
    const n = ss * ss
    return [r / n + jitter(), g / n + jitter(), b / n + jitter()]
  })
}

/** A photograph-ish picture: continuous tone everywhere, no flat regions to speak of. */
export const photo = (w, h) =>
  raster(w, h, (x, y) => {
    const u = x / w
    const v = y / h
    const r = Math.hypot(u - 0.45, (v - 0.42) * 1.15)
    if (r < 0.26) return [226 * (0.75 + 0.25 * Math.cos(r * 6)), 186, 158]
    return [230 - v * 180, 120 + u * 110, 60 + v * 170]
  })

/** A raster plus its summed-area table, which is what buildChart actually wants. */
export function source(r) {
  return { raster: r, sat: buildSat(r), aspect: r.width / r.height, width: r.width }
}

export function settings(overrides = {}) {
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...overrides })
}
