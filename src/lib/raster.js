/**
 * Pixels, without a canvas. Pure.
 *
 * The summed-area table in here is the single reason the detail slider is free. Instead
 * of averaging N source pixels per cell — which gets slower as the chart gets coarser,
 * exactly backwards from what you want — a prefix sum is built once per image and then
 * every cell average is four lookups per channel, whatever size the cell is.
 *
 * Building a chart therefore costs O(stitches x rows), roughly ten thousand lookups,
 * rather than O(source pixels). Dragging from 50px blocks to 5px blocks multiplies the
 * cell count by a hundred, and a hundred times thirty microseconds is still nothing.
 */

import { linearToSrgb, srgbToLinear } from './color.js'
import { PALETTE_SIZE, quantize } from './palette.js'

/** @typedef {{width:number, height:number, data:Uint8ClampedArray}} Raster */

/**
 * @param {Raster} raster
 * @returns {{w:number, h:number, sum:Float64Array, alpha:Float64Array}}
 *
 * Sums are in LINEAR light, not sRGB bytes — see `srgbToLinear`. They are also
 * premultiplied by alpha, with the alpha carried in its own plane, so a transparent
 * background doesn't drag every edge cell toward black.
 *
 * Float64, not Uint32: a 1024x1024 image summing 16-bit-ish linear values reaches about
 * 6.5e10, which overflows a uint32 and silently corrupts the bottom-right quadrant of
 * every table. That bug is invisible until someone charts a large photo.
 */
export function buildSat(raster) {
  const { width: w, height: h, data } = raster
  const rowStride = (w + 1) * 3
  const sum = new Float64Array((w + 1) * (h + 1) * 3)
  const alpha = new Float64Array((w + 1) * (h + 1))

  for (let y = 1; y <= h; y++) {
    for (let x = 1; x <= w; x++) {
      const s = (y * (w + 1) + x) * 3
      const up = s - rowStride
      const left = s - 3
      const upLeft = up - 3
      const p = ((y - 1) * w + (x - 1)) * 4
      const a = data[p + 3] / 255

      sum[s] = srgbToLinear(data[p]) * a + sum[left] + sum[up] - sum[upLeft]
      sum[s + 1] = srgbToLinear(data[p + 1]) * a + sum[left + 1] + sum[up + 1] - sum[upLeft + 1]
      sum[s + 2] = srgbToLinear(data[p + 2]) * a + sum[left + 2] + sum[up + 2] - sum[upLeft + 2]

      const ai = y * (w + 1) + x
      alpha[ai] = a + alpha[ai - 1] + alpha[ai - (w + 1)] - alpha[ai - (w + 1) - 1]
    }
  }
  return { w, h, sum, alpha }
}

/**
 * Average colour of a normalised 0..1 rectangle of the source.
 *
 * @returns {{rgb:[number,number,number], coverage:number}} coverage is the mean alpha,
 * so a caller can treat a mostly-transparent cell as background rather than as a colour.
 */
export function boxAverage(sat, u0, v0, u1, v1) {
  const { w, h, sum, alpha } = sat
  // Snap to whole pixels. Round rather than floor/ceil so adjacent cells agree on the
  // boundary between them and no source pixel is counted twice or skipped.
  let x0 = Math.round(u0 * w)
  let x1 = Math.round(u1 * w)
  let y0 = Math.round(v0 * h)
  let y1 = Math.round(v1 * h)
  x0 = Math.min(Math.max(x0, 0), w)
  x1 = Math.min(Math.max(x1, 0), w)
  y0 = Math.min(Math.max(y0, 0), h)
  y1 = Math.min(Math.max(y1, 0), h)
  // A cell smaller than one source pixel still has to sample something.
  if (x1 <= x0) x1 = Math.min(w, x0 + 1)
  if (y1 <= y0) y1 = Math.min(h, y0 + 1)
  if (x1 <= x0 || y1 <= y0) return { rgb: [0, 0, 0], coverage: 0 }

  const a = (y1 * (w + 1) + x1) * 3
  const b = (y1 * (w + 1) + x0) * 3
  const c = (y0 * (w + 1) + x1) * 3
  const d = (y0 * (w + 1) + x0) * 3

  const area = (x1 - x0) * (y1 - y0)
  const cov =
    (alpha[y1 * (w + 1) + x1] -
      alpha[y1 * (w + 1) + x0] -
      alpha[y0 * (w + 1) + x1] +
      alpha[y0 * (w + 1) + x0]) /
    area

  if (cov <= 0) return { rgb: [0, 0, 0], coverage: 0 }

  // Divide by the alpha weight, not the area — un-premultiplying, so a half
  // transparent cell reports the colour that IS there rather than a darkened version.
  const weight = cov * area
  return {
    rgb: [
      linearToSrgb((sum[a] - sum[b] - sum[c] + sum[d]) / weight),
      linearToSrgb((sum[a + 1] - sum[b + 1] - sum[c + 1] + sum[d + 1]) / weight),
      linearToSrgb((sum[a + 2] - sum[b + 2] - sum[c + 2] + sum[d + 2]) / weight),
    ],
    coverage: cov,
  }
}

/**
 * Single pixel at the centre of a cell.
 *
 * For flat art — a logo, a cartoon, existing pixel art — averaging across a hard edge
 * invents a halfway colour that then matches to a third yarn, so a two-colour logo
 * charts with five colours and a fringe. Nearest sampling keeps edges hard.
 */
export function nearestSample(raster, u, v) {
  const { width: w, height: h, data } = raster
  const x = Math.min(w - 1, Math.max(0, Math.floor(u * w)))
  const y = Math.min(h - 1, Math.max(0, Math.floor(v * h)))
  const p = (y * w + x) * 4
  return { rgb: [data[p], data[p + 1], data[p + 2]], coverage: data[p + 3] / 255 }
}

/**
 * Rough count of distinct colours, capped so it stays cheap. Used to notice that an
 * upload is flat art and suggest the sampling mode that suits it.
 */
/**
 * At or below this many colours, a picture is flat artwork rather than a photograph.
 * Measured: logos land on two to five, photographs on eleven to twenty.
 */
export const FLAT_ART_COLOURS = 8

/** How many samples to take when profiling. Enough to be stable, few enough to be free. */
const PROFILE_SAMPLES = 4096

/**
 * How many yarn colours a picture actually needs.
 *
 * The question is not "how many distinct colours are in this file" — that counts the
 * antialiasing along every edge and the noise left by whatever saved it, so a logo of
 * three flat colours answers in the hundreds. It is "how few colours carry almost all
 * of the picture", which is what somebody buying yarn means by the question.
 *
 * Measured by quantizing a sample of pixels onto the palette and asking how many of
 * them it takes to cover `coverage` of the picture. A three-colour logo answers 3
 * whether it is a crisp PNG, an antialiased one, or a JPEG with artefacts all over the
 * edges — the noise is real, but it is a fraction of a percent of the pixels, so it
 * falls outside the coverage rather than dominating the count.
 *
 * The old measure counted distinct 5-bit colours and called anything under 64 flat. A
 * noisy logo and a photograph both came back 65: the same answer for two pictures that
 * want opposite treatment.
 */
export function colourProfile(raster, lut, { samples = PROFILE_SAMPLES, coverage = 0.95 } = {}) {
  const counts = new Uint32Array(PALETTE_SIZE)
  const { data } = raster
  const step = Math.max(4, Math.floor(data.length / 4 / samples) * 4)
  let total = 0

  for (let p = 0; p < data.length; p += step) {
    if (data[p + 3] < 128) continue
    counts[quantize(lut, data[p], data[p + 1], data[p + 2])]++
    total++
  }
  if (!total) return { needed: 1, used: 0, flat: true }

  const sorted = Array.from(counts).filter((c) => c > 0).sort((a, b) => b - a)
  let covered = 0
  let needed = sorted.length
  for (let i = 0; i < sorted.length; i++) {
    covered += sorted[i]
    if (covered / total >= coverage) {
      needed = i + 1
      break
    }
  }

  return { needed, used: sorted.length, flat: needed <= FLAT_ART_COLOURS }
}

/** Fewest sample points per axis inside a cell when taking its most common colour. */
export const MODE_GRID = 4

/**
 * Most sample points per axis. Sixty-four samples a cell, still O(cells).
 *
 * Four per axis is sixteen samples, and a cell of a 1024px working copy charted at
 * sixty stitches covers about seventeen source pixels each way — nearly three hundred
 * pixels. Deciding what such a cell is "mostly" from sixteen of them is a straw poll:
 * along a diagonal or a curve the count is close, so which colour wins turns on which
 * sixteen pixels happened to be looked at, and the edge wobbles a cell in and out. That
 * wobble is what makes a charted logo look soft — the individual cells are hard-edged,
 * but the LINE they form is ragged.
 *
 * So the grid follows the cell: as many samples per axis as the cell is source pixels
 * wide, up to this cap. Small cells keep taking every pixel they have; big ones take
 * enough to make the vote stable rather than every pixel, which would put the sampler
 * back to O(source pixels) and undo the point of the summed-area table beside it.
 */
export const MODE_MAX_GRID = 8

/**
 * A sampler that answers "what colour is this cell MOSTLY", for flat artwork.
 *
 * Averaging is right for a photograph and wrong for a logo: a cell straddling the edge
 * between navy and orange averages to a muddy brown that appears nowhere in the design,
 * and every edge in the picture grows a halo of invented colours. Taking the single
 * centre pixel instead avoids the halo but believes whatever that one pixel happens to
 * be — an antialiased edge, or a speck of JPEG noise.
 *
 * So: a grid of samples, each quantized onto the palette, and the winner takes the
 * cell. A cell that is nine tenths navy comes out navy no matter what the other tenth is
 * doing. The grid is sized to the cell (see `MODE_MAX_GRID`) so the count is decided by
 * enough of the cell to be stable, while staying O(cells) like the summed-area table it
 * sits beside rather than O(source pixels).
 *
 * A TIE is decided by whichever colour has a sample closest to the middle of the cell.
 * That sounds like a detail and is not: on any straight edge that runs near a cell
 * boundary the vote is routinely tied, and taking the first colour the scan happened to
 * see hands every one of those cells to its top-left corner. The whole edge then sits up
 * to half a cell up and to the left of where the picture puts it, so a shape comes out
 * shifted on one side and thin on the other. The middle of the cell is the one tie-break
 * that has no direction in it.
 *
 * Returns a closure so the tally is allocated once rather than per cell.
 */
export function createModeSampler(raster, lut, adjust, grid = 0) {
  const { width, height, data } = raster
  const counts = new Uint16Array(PALETTE_SIZE)
  // How close to the middle of the cell that colour's nearest sample fell, 1 = dead
  // centre. Only meaningful for an index `counts` is currently holding.
  const central = new Float64Array(PALETTE_SIZE)
  const touched = new Int32Array(MODE_MAX_GRID * MODE_MAX_GRID)
  const adjusting = Boolean(
    adjust && (adjust.brightness || adjust.contrast || adjust.saturation),
  )
  // A caller may pin the grid — the tests do, to hold one variable still.
  const fixed = grid > 0 ? Math.min(MODE_MAX_GRID, Math.max(1, Math.round(grid))) : 0

  return (u0, v0, u1, v1) => {
    /*
      As many samples per axis as the cell has source pixels, capped. `ceil` rather than
      `round` so a cell narrower than a pixel still gets one sample per axis, and so a
      cell of three-and-a-bit pixels does not sample only three of them.
    */
    const span = (n) => Math.min(MODE_MAX_GRID, Math.max(MODE_GRID, Math.ceil(n)))
    const gx = fixed || span((u1 - u0) * width)
    const gy = fixed || span((v1 - v0) * height)

    let distinct = 0
    let opaque = 0
    let best = 0
    let bestCount = 0
    let bestCentral = -1

    for (let j = 0; j < gy; j++) {
      const ty = (j + 0.5) / gy
      const v = v0 + ty * (v1 - v0)
      const y = Math.min(height - 1, Math.max(0, Math.floor(v * height)))
      // 1 in the middle of the cell, 0 at its edge, on each axis independently.
      const nearY = 1 - Math.abs(ty - 0.5) * 2
      for (let i = 0; i < gx; i++) {
        const tx = (i + 0.5) / gx
        const u = u0 + tx * (u1 - u0)
        const x = Math.min(width - 1, Math.max(0, Math.floor(u * width)))
        const p = (y * width + x) * 4
        if (data[p + 3] < 128) continue
        opaque++

        let r = data[p]
        let g = data[p + 1]
        let b = data[p + 2]
        if (adjusting) {
          const out = applyAdjust([r, g, b], adjust)
          r = out[0]
          g = out[1]
          b = out[2]
        }

        const index = quantize(lut, r, g, b)
        const near = (1 - Math.abs(tx - 0.5) * 2) * nearY
        if (counts[index] === 0) {
          touched[distinct++] = index
          central[index] = near
        } else if (near > central[index]) {
          central[index] = near
        }

        const n = ++counts[index]
        if (n > bestCount || (n === bestCount && central[index] > bestCentral)) {
          bestCount = n
          best = index
          bestCentral = central[index]
        }
      }
    }

    // Clear only what was touched, so the tally stays O(samples) rather than O(palette).
    for (let k = 0; k < distinct; k++) counts[touched[k]] = 0
    return { index: best, coverage: opaque / (gx * gy) }
  }
}

/** Brightness / contrast / saturation, applied per CELL rather than per pixel. */
export function applyAdjust([r, g, b], adjust) {
  if (!adjust) return [r, g, b]
  const { brightness = 0, contrast = 0, saturation = 0 } = adjust
  if (!brightness && !contrast && !saturation) return [r, g, b]

  const clamp8 = (v) => Math.min(255, Math.max(0, v))
  const bAdd = brightness * 255
  const cMul = (100 + contrast * 100) / 100

  let out = [r, g, b].map((v) => clamp8((v - 128) * cMul + 128 + bAdd))
  if (saturation) {
    const grey = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]
    const s = 1 + saturation
    out = out.map((v) => clamp8(grey + (v - grey) * s))
  }
  return [Math.round(out[0]), Math.round(out[1]), Math.round(out[2])]
}
