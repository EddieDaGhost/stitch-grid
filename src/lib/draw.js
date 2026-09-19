/**
 * Drawing, without a canvas of its own. Pure.
 *
 * These functions take any object with the handful of 2D-context methods they use, so
 * the real preview canvas, the PNG export canvas and a twenty-line recording stub in
 * the test suite all drive the identical code. That's what lets `tests/draw.mjs` assert
 * "the cells tile with no gap and no overlap" in bare Node.
 */

import { inkOn, rgbToHex } from './color.js'

/**
 * Integer boundaries for `count` cells across `sizePx` pixels.
 *
 * Cells must not be drawn at fractional positions — you get seams of background colour
 * between them, or a doubled row of pixels, depending on which way the rounding lands.
 * Returning the edges instead of a width means every cell butts exactly against its
 * neighbour and the last one lands exactly on `sizePx`.
 */
export function cellEdges(count, sizePx) {
  const edges = new Int32Array(count + 1)
  for (let i = 0; i <= count; i++) edges[i] = Math.round((i * sizePx) / count)
  // A zero-width cell would make a stitch invisible. At small sizes, force at least 1px.
  for (let i = 1; i <= count; i++) if (edges[i] <= edges[i - 1]) edges[i] = edges[i - 1] + 1
  return edges
}

/**
 * Fill every cell of the chart.
 *
 * One `fillRect` per horizontal RUN rather than per cell, and `fillStyle` set only when
 * the colour changes. On a photo chart runs average three to eight cells, so this is
 * several times less work than the obvious loop — and it's the same run structure the
 * PDF uses, so the two exports can't drift apart.
 */
export function drawChart(ctx, chart, { width, height, originX = 0, originY = 0 }) {
  const xs = cellEdges(chart.stitches, width)
  const ys = cellEdges(chart.rows, height)
  let currentFill = null

  for (let y = 0; y < chart.rows; y++) {
    const top = originY + ys[y]
    const bottom = originY + ys[y + 1]
    let x = 0
    while (x < chart.stitches) {
      const index = chart.cells[y * chart.stitches + x]
      let end = x + 1
      while (end < chart.stitches && chart.cells[y * chart.stitches + end] === index) end++

      const hex = chart.palette[index] ? rgbToHex(chart.palette[index].rgb) : '#000000'
      if (hex !== currentFill) {
        ctx.fillStyle = hex
        currentFill = hex
      }
      ctx.fillRect(originX + xs[x], top, xs[end] - xs[x], bottom - top)
      x = end
    }
  }
}

/**
 * A letter in every cell.
 *
 * The PDF has done this since the first version, for a reason stated there: a chart is
 * often followed in black and white, and by someone who cannot reliably tell Sage from
 * Moss at a glance. Both halves of that are just as true on a screen — more so in
 * making mode, where the chart IS the instructions and a misread cell is a row to
 * unpick. A colour-only chart is also simply unusable for a good share of people, and
 * the app already knew how to fix that in print and not on screen.
 *
 * Letters are passed in rather than derived, so the screen and the printed sheet read
 * from the same ranking and cannot drift into calling the same colour different things.
 *
 * Below `minCell` nothing is drawn. A letter squeezed into six pixels is not a letter,
 * it is grit on the picture you are trying to judge — the same argument that stops
 * `drawGrid` hairlining every cell when it is zoomed out.
 */
export function drawLetters(
  ctx,
  chart,
  {
    width,
    height,
    originX = 0,
    originY = 0,
    letters,
    minCell = 8,
    font = "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
) {
  if (!letters) return
  const cellW = width / chart.stitches
  const cellH = height / chart.rows
  if (Math.min(cellW, cellH) < minCell) return

  const xs = cellEdges(chart.stitches, width)
  const ys = cellEdges(chart.rows, height)
  const size = Math.max(1, Math.round(Math.min(cellW, cellH) * 0.62))

  ctx.font = `600 ${size}px ${font}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Black or white per colour, and set only when it changes — on a photo chart the
  // runs are long, so this flips a handful of times per row rather than once per cell.
  let currentFill = null
  for (let y = 0; y < chart.rows; y++) {
    const midY = originY + (ys[y] + ys[y + 1]) / 2
    for (let x = 0; x < chart.stitches; x++) {
      const index = chart.cells[y * chart.stitches + x]
      const letter = letters[index]
      const colour = chart.palette[index]
      if (!letter || !colour) continue

      const ink = rgbToHex(inkOn(colour.rgb))
      if (ink !== currentFill) {
        ctx.fillStyle = ink
        currentFill = ink
      }
      ctx.fillText(letter, originX + (xs[x] + xs[x + 1]) / 2, midY)
    }
  }
}

/**
 * The counting grid.
 *
 * Every cell gets a hairline; every tenth gets a heavier one. The tens are the whole
 * point — nobody counts sixty individual squares, they count six blocks of ten, the
 * same way cross-stitch charts have always worked.
 */
export function drawGrid(
  ctx,
  chart,
  { width, height, originX = 0, originY = 0, boldEvery = 10, line = '#00000022', bold = '#00000055', lineWidth = 1 },
) {
  const xs = cellEdges(chart.stitches, width)
  const ys = cellEdges(chart.rows, height)

  /**
   * Below about six pixels a cell, a line on every boundary stops being a counting aid
   * and becomes a grey veil over the picture — you can no longer see the design you are
   * supposed to be judging. Zoomed out, only the tens are drawn; they're the ones you
   * actually count by anyway.
   */
  const cellW = width / chart.stitches
  const cellH = height / chart.rows
  const showEveryCell = Math.min(cellW, cellH) >= 6

  const stroke = (colour, w, segments) => {
    ctx.strokeStyle = colour
    ctx.lineWidth = w
    ctx.beginPath()
    for (const [x1, y1, x2, y2] of segments) {
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
    }
    ctx.stroke()
  }

  const thin = []
  const heavy = []
  for (let i = 0; i <= chart.stitches; i++) {
    // +0.5 keeps a 1px line on a pixel centre instead of straddling two.
    const x = originX + xs[i] + 0.5
    const seg = [x, originY, x, originY + height]
    ;(i % boldEvery === 0 || i === chart.stitches ? heavy : thin).push(seg)
  }
  for (let i = 0; i <= chart.rows; i++) {
    const y = originY + ys[i] + 0.5
    const seg = [originX, y, originX + width, y]
    // Bold lines are counted from the BOTTOM, because row 1 is the bottom row.
    const fromBottom = chart.rows - i
    ;(fromBottom % boldEvery === 0 || i === 0 || i === chart.rows ? heavy : thin).push(seg)
  }

  if (thin.length && showEveryCell) stroke(line, lineWidth, thin)
  if (heavy.length) stroke(bold, lineWidth * 2, heavy)
}

/** Cell height that keeps the drawing at true finished proportions for a given width. */
export function cellHeightFor(cellWidth, gauge) {
  return (cellWidth * gauge.stitchesPer4) / gauge.rowsPer4
}

/** Pixel size of a chart drawn at `cellWidth`, at true gauge proportions. */
export function chartPixelSize(chart, cellWidth) {
  const cellHeight = cellHeightFor(cellWidth, chart.gauge)
  return {
    width: Math.max(1, Math.round(chart.stitches * cellWidth)),
    height: Math.max(1, Math.round(chart.rows * cellHeight)),
    cellWidth,
    cellHeight,
  }
}

/**
 * The making overlay: what's done, what you're on, what's still ahead.
 *
 * Three states, two washes. Worked cells are lightened towards paper and cells still
 * ahead are darkened, so the row you are actually on is the only thing left at full
 * strength — you find your place by looking for the bright band, from across a table,
 * without reading a number.
 *
 * Takes the mask rather than a Progress so it stays a pure drawing function with no
 * opinion about rows, diagonals or where the hook is. Same run-collapsing as
 * `drawChart`, for the same reason.
 */
export function drawProgressMask(
  ctx,
  chart,
  {
    width,
    height,
    originX = 0,
    originY = 0,
    mask,
    worked = 'rgba(255, 255, 255, 0.62)',
    ahead = 'rgba(0, 0, 0, 0.34)',
  },
) {
  if (!mask) return
  const xs = cellEdges(chart.stitches, width)
  const ys = cellEdges(chart.rows, height)
  // Index by mask value; the current step is absent on purpose — it gets no wash.
  const fills = [ahead, null, worked]
  let currentFill = null

  for (let y = 0; y < chart.rows; y++) {
    const top = originY + ys[y]
    const bottom = originY + ys[y + 1]
    let x = 0
    while (x < chart.stitches) {
      const value = mask[y * chart.stitches + x]
      let end = x + 1
      while (end < chart.stitches && mask[y * chart.stitches + end] === value) end++

      const fill = fills[value]
      if (fill) {
        if (fill !== currentFill) {
          ctx.fillStyle = fill
          currentFill = fill
        }
        ctx.fillRect(originX + xs[x], top, xs[end] - xs[x], bottom - top)
      }
      x = end
    }
  }
}

/**
 * Outline a rectangle given in CELLS rather than pixels.
 *
 * Cell coordinates so the caller never has to know the pixel geometry, and so the
 * outline lands on exactly the same boundaries the cells were filled on — an outline
 * computed independently drifts half a pixel off at awkward zooms.
 */
export function strokeCellRect(
  ctx,
  chart,
  { width, height, originX = 0, originY = 0, rect, colour = '#000000', lineWidth = 2 },
) {
  if (!rect) return
  const xs = cellEdges(chart.stitches, width)
  const ys = cellEdges(chart.rows, height)
  const clamp = (v, hi) => Math.min(hi, Math.max(0, v))
  const left = originX + xs[clamp(rect.x0, chart.stitches)] + 0.5
  const right = originX + xs[clamp(rect.x1, chart.stitches)] - 0.5
  const top = originY + ys[clamp(rect.y0, chart.rows)] + 0.5
  const bottom = originY + ys[clamp(rect.y1, chart.rows)] - 0.5

  ctx.strokeStyle = colour
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  ctx.moveTo(left, top)
  ctx.lineTo(right, top)
  ctx.lineTo(right, bottom)
  ctx.lineTo(left, bottom)
  ctx.lineTo(left, top)
  ctx.stroke()
}
