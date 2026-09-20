/**
 * Drawing, asserted on the operation stream rather than on pixels.
 */

import {
  cellEdges,
  cellHeightFor,
  chartPixelSize,
  drawChart,
  drawGrid,
  drawLetters,
  drawProgressMask,
  strokeCellRect,
} from '../src/lib/draw.js'
import { RESOLVED } from '../src/lib/palette.js'
import { inkOn, relativeLuminance } from '../src/lib/color.js'
import { legend } from '../src/lib/pattern.js'
import { chartLetter } from '../src/config/palette.js'
import { coverage, recordingContext } from './recording.mjs'

const SC = { stitchesPer4: 16, rowsPer4: 18, unit: 'in' }

function chartOf(stitches, rows, fn) {
  const cells = new Uint8Array(stitches * rows)
  for (let y = 0; y < rows; y++) for (let x = 0; x < stitches; x++) cells[y * stitches + x] = fn(x, y)
  return { stitches, rows, cells, palette: RESOLVED.slice(0, 4), gauge: SC, meta: {} }
}

export default async function run({ check }) {
  // --- cell edges
  const edges = cellEdges(84, 1008)
  check.is('edges start at zero', edges[0], 0)
  check.is('edges end exactly on the canvas', edges[84], 1008)
  check.is('there is one more edge than cells', edges.length, 85)

  let strictlyIncreasing = true
  for (let size = 1; size <= 64; size++) {
    for (const count of [1, 2, 7, 40, 84, 137]) {
      const e = cellEdges(count, count * size)
      for (let i = 1; i <= count; i++) if (e[i] <= e[i - 1]) strictlyIncreasing = false
    }
  }
  check('no cell is ever zero pixels wide, at any size', strictlyIncreasing)

  // Awkward sizes are where seams and doubled rows appear.
  let awkwardOk = true
  for (const [count, px] of [[37, 100], [13, 47], [7, 8], [100, 101]]) {
    const e = cellEdges(count, px)
    if (e[0] !== 0) awkwardOk = false
    for (let i = 1; i <= count; i++) if (e[i] <= e[i - 1]) awkwardOk = false
  }
  check('awkward cell-to-pixel ratios still tile', awkwardOk)

  // --- fills tile the canvas exactly once
  const chart = chartOf(20, 24, (x, y) => (x + y) % 4)
  const ctx = recordingContext()
  drawChart(ctx, chart, { width: 200, height: 240 })
  const { uncovered, doubled } = coverage(ctx.ops, 200, 240)
  check.is('every pixel of the chart is painted', uncovered, 0)
  check.is('and no pixel is painted twice', doubled, 0)

  // --- runs, not cells
  const striped = chartOf(20, 4, () => 0) // one colour, so each row is a single run
  const runCtx = recordingContext()
  drawChart(runCtx, striped, { width: 200, height: 40 })
  const fills = runCtx.ops.filter((o) => o.op === 'fillRect')
  check.is('a uniform chart is one rectangle per row', fills.length, 4)
  const styleSets = runCtx.ops.filter((o) => o.op === 'fillStyle')
  check.is('and sets its fill colour only once', styleSets.length, 1)

  const busy = chartOf(10, 1, (x) => x % 2)
  const busyCtx = recordingContext()
  drawChart(busyCtx, busy, { width: 100, height: 10 })
  check.is('an alternating row is one rectangle per cell', busyCtx.ops.filter((o) => o.op === 'fillRect').length, 10)

  // --- grid
  // Cells at 10px, so every boundary is drawn.
  const gridCtx = recordingContext()
  drawGrid(gridCtx, chart, { width: 200, height: 240 })
  const segments = gridCtx.ops.filter((o) => o.op === 'segment').length
  check.is('the grid draws every boundary once', segments, chart.stitches + 1 + chart.rows + 1)
  const strokes = gridCtx.ops.filter((o) => o.op === 'stroke')
  check.is('the grid is drawn in two passes, hairline and bold', strokes.length, 2)
  check('the bold pass is thicker', strokes[1].lineWidth > strokes[0].lineWidth)

  /**
   * Zoomed out, a line on every cell stops being a counting aid and becomes a grey
   * veil over the design. Only the tens survive.
   */
  const tinyCtx = recordingContext()
  drawGrid(tinyCtx, chart, { width: 40, height: 48 })
  const tinyStrokes = tinyCtx.ops.filter((o) => o.op === 'stroke')
  check.is('at small cell sizes only the bold lines are drawn', tinyStrokes.length, 1)
  const boldCount = 3 + 4 // stitch boundaries at 0,10,20 and row boundaries at 0,10,20,24
  check(
    'and those are the every-ten lines',
    tinyCtx.ops.filter((o) => o.op === 'segment').length <= boldCount + 2,
    String(tinyCtx.ops.filter((o) => o.op === 'segment').length),
  )

  // --- gauge drives the drawn shape
  check.near('at sc gauge a cell is taller than it is wide', cellHeightFor(10, SC), (10 * 16) / 18, 1e-9)
  const dc = { stitchesPer4: 12, rowsPer4: 7, unit: 'in' }
  check('at dc gauge a cell is much taller', cellHeightFor(10, dc) > cellHeightFor(10, SC))

  const square = chartOf(40, 45, () => 0)
  const size = chartPixelSize(square, 10)
  check.is('the drawing is as many cells wide as stitches', size.width, 400)
  check.near(
    'and its aspect matches the finished blanket, not the cell count',
    size.width / size.height,
    (40 * (4 / 16)) / (45 * (4 / 18)),
    0.02,
  )
  // --- the making overlay
  const overlay = chartOf(20, 24, () => 0)
  // Bottom array row current, everything below it in crochet terms (nothing) worked.
  const mask = new Uint8Array(overlay.stitches * overlay.rows).fill(0)
  for (let x = 0; x < overlay.stitches; x++) mask[(overlay.rows - 1) * overlay.stitches + x] = 1

  const maskCtx = recordingContext()
  drawProgressMask(maskCtx, overlay, { width: 200, height: 240, mask })
  const washes = maskCtx.ops.filter((o) => o.op === 'fillRect')
  check('the overlay paints something', washes.length > 0)
  // Exactly one row's worth of pixels is left bare: 200px wide by 240/24 tall.
  check.is(
    'but leaves the current row alone, so it stays at full strength',
    coverage(maskCtx.ops, 200, 240).uncovered,
    200 * (240 / overlay.rows),
  )
  check.is('and never washes a cell twice', coverage(maskCtx.ops, 200, 240).doubled, 0)

  const allWorked = new Uint8Array(overlay.stitches * overlay.rows).fill(2)
  const workedCtx = recordingContext()
  drawProgressMask(workedCtx, overlay, { width: 200, height: 240, mask: allWorked })
  check.is('a finished chart is washed edge to edge', coverage(workedCtx.ops, 200, 240).uncovered, 0)
  check.is('still with no overlap', coverage(workedCtx.ops, 200, 240).doubled, 0)
  check.is(
    'and in one fill per row, because the wash collapses runs',
    workedCtx.ops.filter((o) => o.op === 'fillRect').length,
    overlay.rows,
  )

  const noMaskCtx = recordingContext()
  drawProgressMask(noMaskCtx, overlay, { width: 200, height: 240, mask: null })
  check.is('no mask draws nothing at all', noMaskCtx.ops.length, 0)

  // --- the row marker
  const markerCtx = recordingContext()
  strokeCellRect(markerCtx, overlay, {
    width: 200,
    height: 240,
    rect: { x0: 0, y0: overlay.rows - 1, x1: overlay.stitches, y1: overlay.rows },
    colour: '#ff0000',
  })
  const marker = markerCtx.ops.filter((o) => o.op === 'segment')
  check.is('the marker is a closed rectangle', marker.length, 4)
  check.is('drawn in the colour it was given', markerCtx.ops.find((o) => o.op === 'strokeStyle')?.value, '#ff0000')
  const xsOf = marker.map((o) => o.x)
  const ysOf = marker.map((o) => o.y)
  check('the marker stays inside the canvas', Math.min(...xsOf) >= 0 && Math.max(...xsOf) <= 200)
  check('on both axes', Math.min(...ysOf) >= 0 && Math.max(...ysOf) <= 240)

  const clampCtx = recordingContext()
  strokeCellRect(clampCtx, overlay, {
    width: 200,
    height: 240,
    rect: { x0: -5, y0: -5, x1: 9999, y1: 9999 },
  })
  const clamped = clampCtx.ops.filter((o) => o.op === 'segment')
  check(
    'an out-of-range rectangle is clamped rather than drawn off-canvas',
    clamped.every((o) => o.x >= 0 && o.x <= 200 && o.y >= 0 && o.y <= 240),
  )

  const noRectCtx = recordingContext()
  strokeCellRect(noRectCtx, overlay, { width: 200, height: 240, rect: null })
  check.is('no rectangle draws nothing', noRectCtx.ops.length, 0)
  // --- a letter in every cell
  const lettered = chartOf(12, 14, (x, y) => (x + y) % 4)
  const letters = ['A', 'B', 'C', 'D']

  const bigCtx = recordingContext()
  drawLetters(bigCtx, lettered, { width: 12 * 20, height: 14 * 20, letters })
  const drawn = bigCtx.ops.filter((o) => o.op === 'fillText')
  check.is('every cell gets its letter', drawn.length, 12 * 14)
  check('and they are the letters it was handed', drawn.every((o) => letters.includes(o.text)))
  check.is('centred in the cell', `${drawn[0].textAlign},${drawn[0].textBaseline}`, 'center,middle')

  // Each letter must land inside its OWN cell, not on a boundary or its neighbour.
  const cellOf = (op) => `${Math.floor(op.x / 20)},${Math.floor(op.y / 20)}`
  check.is('one letter per cell, with none doubled up', new Set(drawn.map(cellOf)).size, 12 * 14)
  check(
    'and every letter sits within the canvas',
    drawn.every((o) => o.x > 0 && o.x < 240 && o.y > 0 && o.y < 280),
  )

  // Ink flips with the swatch, or a letter vanishes into its own cell.
  const inkFor = (letterIndex) => {
    const op = drawn.find((o) => o.text === letters[letterIndex])
    return op.fill
  }
  let inkAlwaysReadable = true
  for (let i = 0; i < letters.length; i++) {
    const wantDark = relativeLuminance(lettered.palette[i].rgb) > 0.42
    const isDark = inkFor(i) === '#000000'
    if (wantDark !== isDark) inkAlwaysReadable = false
  }
  check('the letter is inked black or white to stay readable on its own colour', inkAlwaysReadable)
  check(
    'which is the same rule the PDF uses',
    inkOn(lettered.palette[0].rgb).every((v) => v === 0 || v === 255),
  )

  // --- too small to read is worse than nothing
  const smallCtx = recordingContext()
  drawLetters(smallCtx, lettered, { width: 12 * 5, height: 14 * 5, letters })
  check.is('no letters are drawn when the cells are tiny', smallCtx.ops.filter((o) => o.op === 'fillText').length, 0)

  // The threshold is on the SHORTER axis — a cell can be wide and far too short.
  const squashedCtx = recordingContext()
  drawLetters(squashedCtx, lettered, { width: 12 * 40, height: 14 * 5, letters })
  check.is(
    'nor when only one axis is big enough',
    squashedCtx.ops.filter((o) => o.op === 'fillText').length,
    0,
  )

  const noneCtx = recordingContext()
  drawLetters(noneCtx, lettered, { width: 240, height: 280, letters: null })
  check.is('and nothing at all without a letter list', noneCtx.ops.length, 0)

  // The type must grow with the cells, or it is unreadable at one zoom and clipped at another.
  const fontAt = (px) => {
    const ctx2 = recordingContext()
    drawLetters(ctx2, lettered, { width: 12 * px, height: 14 * px, letters })
    return Number(ctx2.ops.find((o) => o.op === 'font')?.value.match(/(\d+)px/)?.[1] ?? 0)
  }
  check('the letters grow with the cells', fontAt(40) > fontAt(20) && fontAt(20) > fontAt(10))
  check('and always fit inside one', fontAt(40) < 40 && fontAt(20) < 20)

  /*
    The letters the chart shows must be the letters the colour key and the PDF name.
    `drawLetters` is handed a list rather than deriving one precisely so those cannot
    drift — but the caller builds that list by palette index, so the ranking behind it
    has to line up. This is the assertion that says so.
  */
  const ranked = chartOf(30, 30, (x, y) => (x < 20 ? 0 : x < 26 ? 1 : x < 29 ? 2 : 3))
  const key = legend(ranked)
  check.is('the legend ranks the most-used colour first', key[0].letter, 'A')
  check(
    'and a palette index IS its rank, so letters line up with the key',
    key.every((entry) => entry.letter === chartLetter(entry.index)),
    key.map((e) => `${e.index}:${e.letter}`).join(' '),
  )
  /*
    --- lines must land on whole pixels, at any resolution

    A stroke straddles its coordinate. One pixel wide it lands cleanly when centred on
    a half coordinate; two wide, on a whole one. The grid used to add a flat +0.5 to
    everything, which was right only while every line was exactly one device pixel —
    and stopped being right the moment the canvas started being drawn at the screen's
    real resolution, where the thin lines are two device pixels and the bold ones four.
    A line across a pixel boundary is not thin, it is grey and smeared.
  */
  const strokeGroups = (ops) => {
    const groups = []
    let pending = []
    for (const op of ops) {
      if (op.op === 'segment') pending.push(op)
      else if (op.op === 'stroke') {
        groups.push({ lineWidth: op.lineWidth, segments: pending })
        pending = []
      }
    }
    return groups
  }
  // A vertical line's aligned axis is x; a horizontal one's is y. The other endpoint
  // sits on the canvas edge, which is how they are told apart.
  const alignedValues = (group, width, height) =>
    group.segments.map((seg) => (Math.abs(seg.y - height) < 1e-9 ? seg.x : seg.y))
  const offsetOf = (v) => ((v % 1) + 1) % 1

  const gridChart = chartOf(20, 24, () => 0)
  for (const [lineWidth, thinOffset, boldOffset] of [
    [1, 0.5, 0],
    [2, 0, 0],
    [3, 0.5, 0],
  ]) {
    const ctx2 = recordingContext()
    drawGrid(ctx2, gridChart, { width: 400, height: 480, lineWidth })
    const groups = strokeGroups(ctx2.ops)
    const thinGroup = groups.find((g) => g.lineWidth === lineWidth)
    const boldGroup = groups.find((g) => g.lineWidth === lineWidth * 2)
    check(
      `at ${lineWidth}px, thin lines sit where a ${lineWidth}px stroke lands cleanly`,
      thinGroup && alignedValues(thinGroup, 400, 480).every((v) => Math.abs(offsetOf(v) - thinOffset) < 1e-9),
      thinGroup ? String(alignedValues(thinGroup, 400, 480)[0]) : 'no thin group',
    )
    check(
      `and the bold ones where a ${lineWidth * 2}px stroke does`,
      boldGroup && alignedValues(boldGroup, 400, 480).every((v) => Math.abs(offsetOf(v) - boldOffset) < 1e-9),
      boldGroup ? String(alignedValues(boldGroup, 400, 480)[0]) : 'no bold group',
    )
  }

  // The legibility floor travels in the caller's units, so a device-pixel canvas can
  // ask for the same apparent size by scaling the number it passes.
  const denseCtx = recordingContext()
  drawGrid(denseCtx, gridChart, { width: 400, height: 480, minCell: 6 })
  check.is('at twenty pixels a cell every line is drawn', strokeGroups(denseCtx.ops).length, 2)
  const sparseCtx = recordingContext()
  drawGrid(sparseCtx, gridChart, { width: 400, height: 480, minCell: 40 })
  check.is('but raising the floor above the cell size drops the thin ones', strokeGroups(sparseCtx.ops).length, 1)
  check.is(
    'leaving only the every-ten lines you actually count by',
    strokeGroups(sparseCtx.ops)[0].lineWidth,
    2,
  )
}
