/**
 * The pipeline, and the one value everything else is a function of.
 *
 * A Chart is the whole design. The preview, the PNG, the PDF, the legend, the yardage
 * estimate, the written pattern and the C2C reading are ALL pure functions of a Chart
 * and nothing else. If a feature needs to reach back past the Chart to the source
 * pixels or to the settings, that feature is designed wrong — that rule is what keeps
 * the on-screen preview and the printed pattern from ever disagreeing.
 */

import { PALETTE_SIZE, RESOLVED, composeMaps, excludeMap, histogram, quantize, reduceMap, swapMap }
  from './palette.js'
import { paletteIndex } from '../config/palette.js'
import { cellRectToSource, inBorder, inImage } from './layout.js'
import { applyAdjust, boxAverage, createModeSampler, nearestSample } from './raster.js'

/**
 * @typedef {{
 *   stitches: number,
 *   rows: number,
 *   cells: Uint8Array,        // row-major; index 0 is the TOP-LEFT of the picture
 *   palette: Array<{id,name,hex,rgb,lab}>,  // dense, only the colours actually used
 *   gauge: {stitchesPer4:number, rowsPer4:number, unit:string},
 *   meta: object,
 * }} Chart
 */

export function emptyChart(gauge) {
  return {
    stitches: 0,
    rows: 0,
    cells: new Uint8Array(0),
    palette: [],
    gauge,
    meta: {},
  }
}

/**
 * Source + geometry + palette settings -> Chart.
 *
 * Ten steps, one direction, no back-references:
 *   1. border cells      2. pad cells         3. sample the source
 *   4. transparent -> pad                     5. tone adjust
 *   6. quantize (one array index)             7. histogram
 *   8. exclude / cap / swap, folded into one remap
 *   9. despeckle         10. compact to a dense palette
 *
 * Note that border and pad take their palette index BEFORE quantization and are skipped
 * by the remap and by despeckle. A border the user chose is a border, even if that
 * colour appears nowhere in the picture and the cap is set to two.
 */
export function buildChart({ sat, raster, layout, settings, lut }) {
  const { stitches, rows } = layout
  const n = stitches * rows
  const cells = new Uint8Array(n)
  const protectedCells = new Uint8Array(n)

  const borderIdx = Math.max(0, paletteIndex(settings.border.colorId))
  const padIdx = Math.max(0, paletteIndex(settings.padColorId))
  // 'mode' picks the cell's most common colour and so decides the palette index itself;
  // the other two hand back a colour for the same quantize step everything else uses.
  const sampleMode = settings.sampling === 'mode' ? createModeSampler(raster, lut, settings.adjust) : null
  const useArea = settings.sampling === 'area'

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < stitches; x++) {
      const i = y * stitches + x

      if (inBorder(layout, x, y)) {
        cells[i] = borderIdx
        protectedCells[i] = 1
        continue
      }
      if (!inImage(layout, x, y)) {
        cells[i] = padIdx
        protectedCells[i] = 1
        continue
      }

      const { u0, v0, u1, v1 } = cellRectToSource(layout, x, y)

      if (sampleMode) {
        const voted = sampleMode(u0, v0, u1, v1)
        // A mostly-transparent cell is background, not black.
        if (voted.coverage < 0.5) {
          cells[i] = padIdx
          protectedCells[i] = 1
          continue
        }
        cells[i] = voted.index
        continue
      }

      const sample = useArea
        ? boxAverage(sat, u0, v0, u1, v1)
        : nearestSample(raster, (u0 + u1) / 2, (v0 + v1) / 2)

      if (sample.coverage < 0.5) {
        cells[i] = padIdx
        protectedCells[i] = 1
        continue
      }

      const [r, g, b] = applyAdjust(sample.rgb, settings.adjust)
      cells[i] = quantize(lut, r, g, b)
    }
  }

  // 7-8. One pass of remapping for all three palette controls at once.
  const counts = histogram(cells, PALETTE_SIZE)
  // Don't let border/pad colours skew the reduction toward keeping them.
  const pictureCounts = new Uint32Array(counts)
  for (let i = 0; i < n; i++) if (protectedCells[i]) pictureCounts[cells[i]]--

  const map = composeMaps(
    excludeMap(settings.excluded ?? []),
    reduceMap(pictureCounts, settings.maxColors, settings.locked ?? []),
    swapMap(settings.swaps),
  )
  for (let i = 0; i < n; i++) {
    if (!protectedCells[i]) cells[i] = map[cells[i]]
  }

  // 9. Tidy up stray single stitches. Never inside the border.
  despeckle(cells, stitches, rows, layout.image, settings.despeckle, protectedCells)

  // 10.
  const compacted = compact(cells)
  return {
    stitches,
    rows,
    cells: compacted.cells,
    palette: compacted.palette,
    gauge: settings.gauge,
    meta: {
      sourceName: settings.sourceName ?? '',
      sampling: settings.sampling,
      despeckle: settings.despeckle,
      stretched: layout.stretched,
      padded: layout.padded,
    },
  }
}

/**
 * Absorb isolated stitches.
 *
 * This is what ships INSTEAD of dithering, and the reasoning matters enough to write
 * down. Floyd-Steinberg buys colour fidelity by spending spatial resolution, and a
 * chart is sixty cells wide — there is nothing to spend. Worse, dithering assumes the
 * eye blends adjacent cells, but a cell is a quarter inch of yarn viewed from three
 * feet, so every dot is plainly visible. And each stray dot costs a join, a cut and two
 * woven ends — hours of tedium for a worse fabric, and a written pattern that reads
 * "1 Cream, 1 Denim, 1 Cream" forever.
 *
 * So: the opposite. Strength 1 removes single strays; strength 2 also absorbs runs of
 * two. Iterated to a fixed point so the result doesn't depend on scan order.
 */
export function despeckle(cells, stitches, rows, region, strength = 1, protectedCells = null) {
  if (!strength) return cells
  const inside = (x, y) =>
    x >= region.x && x < region.x + region.w && y >= region.y && y < region.y + region.h

  for (let pass = 0; pass < 4; pass++) {
    let changed = 0
    const before = cells.slice()

    for (let y = region.y; y < region.y + region.h; y++) {
      for (let x = region.x; x < region.x + region.w; x++) {
        const i = y * stitches + x
        if (protectedCells && protectedCells[i]) continue
        const me = before[i]
        const neighbours = []
        if (inside(x - 1, y)) neighbours.push(before[i - 1])
        if (inside(x + 1, y)) neighbours.push(before[i + 1])
        if (inside(x, y - 1)) neighbours.push(before[i - stitches])
        if (inside(x, y + 1)) neighbours.push(before[i + stitches])
        if (neighbours.length < 3) continue
        if (neighbours.every((v) => v === neighbours[0]) && neighbours[0] !== me) {
          cells[i] = neighbours[0]
          changed++
        }
      }
    }

    if (strength >= 2) {
      for (let y = region.y; y < region.y + region.h; y++) {
        for (let x = region.x; x < region.x + region.w - 2; x++) {
          const i = y * stitches + x
          const left = x - 1 >= region.x ? cells[i - 1] : -1
          if (left < 0) continue
          const a = cells[i]
          if (a === left) continue
          // A run of one or two flanked by the same colour on both sides.
          for (const len of [1, 2]) {
            const endX = x + len
            if (endX >= region.x + region.w) break
            let uniform = true
            for (let k = 0; k < len; k++) if (cells[i + k] !== a) uniform = false
            if (!uniform) continue
            if (cells[i + len] === left) {
              for (let k = 0; k < len; k++) {
                if (protectedCells && protectedCells[i + k]) continue
                cells[i + k] = left
                changed++
              }
              break
            }
          }
        }
      }
    }

    if (!changed) break
  }
  return cells
}

/** Re-index so the palette holds only colours actually used, densely, most-used first. */
export function compact(cells) {
  const counts = histogram(cells, PALETTE_SIZE)
  const used = []
  for (let i = 0; i < PALETTE_SIZE; i++) if (counts[i] > 0) used.push(i)
  used.sort((a, b) => counts[b] - counts[a] || a - b)

  const remap = new Uint8Array(PALETTE_SIZE)
  used.forEach((paletteIdx, dense) => {
    remap[paletteIdx] = dense
  })

  const out = new Uint8Array(cells.length)
  for (let i = 0; i < cells.length; i++) out[i] = remap[cells[i]]

  return { cells: out, palette: used.map((i) => RESOLVED[i]) }
}

/** FNV-1a over cells and palette. Cheap cache key for "has the drawing changed?". */
export function chartHash(chart) {
  let h = 0x811c9dc5
  for (let i = 0; i < chart.cells.length; i++) {
    h ^= chart.cells[i]
    h = Math.imul(h, 0x01000193)
  }
  for (const entry of chart.palette) {
    for (let k = 0; k < entry.id.length; k++) {
      h ^= entry.id.charCodeAt(k)
      h = Math.imul(h, 0x01000193)
    }
  }
  h ^= chart.stitches * 31 + chart.rows
  return (h >>> 0).toString(36)
}
