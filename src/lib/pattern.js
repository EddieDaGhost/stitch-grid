/**
 * Everything a crocheter reads, derived from a Chart. Pure.
 *
 * The one inversion in the codebase lives here and nowhere else: the cells array runs
 * top-down because that's how pictures work, but crochet row 1 is the BOTTOM row,
 * because a blanket is worked bottom-up. `crochetRowIndex` is the only place that
 * conversion is allowed to happen.
 */

import { chartLetter } from '../config/palette.js'
import { finishedSize, yardsFor } from './gauge.js'

/** Array row y (0 = top) -> crochet row number (1 = bottom). */
export function crochetRowIndex(chart, y) {
  return chart.rows - y
}

/** Crochet row number -> array row y. */
export function arrayRowIndex(chart, row) {
  return chart.rows - row
}

/**
 * Which side you're looking at, and which way you work.
 *
 * Row 1 is the right side and is worked RIGHT TO LEFT. After you turn, row 2 is the
 * wrong side and is worked left to right — because the chart's left edge is now at your
 * right hand. So an odd row reads the cells array REVERSED and an even row reads it
 * forward. Getting this backwards mirrors every chart, which is why tests/pattern.mjs
 * pins it with a four-cell fixture.
 */
export function rowSide(row, startsOnRightSide = true) {
  const odd = row % 2 === 1
  const rs = startsOnRightSide ? odd : !odd
  return {
    side: rs ? 'RS' : 'WS',
    // The arrow shows the direction of travel across the chart as printed.
    direction: rs ? '←' : '→',
    reversed: rs,
  }
}

/**
 * @typedef {{row:number, side:string, direction:string,
 *            runs:Array<{count:number, index:number}>, total:number}} RowInstruction
 */

/**
 * Array indices of one crochet row's cells, in the order the hook meets them.
 *
 * Working order, not chart order: an odd row is worked right to left, so it walks the
 * array row backwards. Everything that needs to know WHERE a row is — the written
 * pattern and the progress mask alike — goes through here, so the direction rule stays
 * in one place rather than being re-derived by each caller.
 */
export function rowCells(chart, row, startsOnRightSide = true) {
  const y = arrayRowIndex(chart, row)
  const { reversed } = rowSide(row, startsOnRightSide)
  const out = new Int32Array(chart.stitches)
  for (let k = 0; k < chart.stitches; k++) {
    const x = reversed ? chart.stitches - 1 - k : k
    out[k] = y * chart.stitches + x
  }
  return out
}

/**
 * Array indices of one corner-to-corner diagonal, in the order it is worked.
 *
 * Bands are anti-diagonals of the cell grid, counted from the bottom-left corner.
 * Direction alternates band to band the same way rows do, because you turn at the end
 * of each one.
 */
export function c2cBandCells(chart, band) {
  const { stitches, rows } = chart
  const d = band - 1
  const coords = []
  for (let k = 0; k <= d; k++) {
    const x = k
    const y = rows - 1 - (d - k)
    if (x >= 0 && x < stitches && y >= 0 && y < rows) coords.push(y * stitches + x)
  }
  if (d % 2 === 0) coords.reverse()
  return Int32Array.from(coords)
}

/** Run-length encode a walk over the chart. */
function runsFrom(chart, cells) {
  const runs = []
  for (let i = 0; i < cells.length; i++) {
    const index = chart.cells[cells[i]]
    const last = runs[runs.length - 1]
    if (last && last.index === index) last.count++
    else runs.push({ count: 1, index })
  }
  return runs
}

/** Run-length encode every row, bottom row first. @returns {RowInstruction[]} */
export function encodeRows(chart, { startsOnRightSide = true } = {}) {
  const out = []
  for (let row = 1; row <= chart.rows; row++) {
    const { side, direction } = rowSide(row, startsOnRightSide)
    const runs = runsFrom(chart, rowCells(chart, row, startsOnRightSide))
    out.push({ row, side, direction, runs, total: chart.stitches })
  }
  return out
}

/**
 * Corner-to-corner.
 *
 * C2C is worked in diagonal blocks from one corner, increasing every row until the
 * chart's short side is reached, then decreasing to the opposite corner. It is a second
 * READING of the same Chart, not a second chart — so it inherits the gauge, the palette
 * and the colour cap for free.
 *
 * Bands are anti-diagonals of the cell grid. Direction alternates band to band the same
 * way rows do, because you turn at the end of each one.
 */
export function encodeC2C(chart) {
  const { stitches, rows } = chart
  const bands = stitches + rows - 1
  const out = []

  for (let d = 0; d < bands; d++) {
    const cells = c2cBandCells(chart, d + 1)
    if (!cells.length) continue

    out.push({
      row: d + 1,
      phase: d < Math.min(stitches, rows) ? 'increase' : 'decrease',
      direction: d % 2 === 1 ? '↗' : '↙',
      runs: runsFrom(chart, cells),
      total: cells.length,
    })
  }
  return out
}

/**
 * The reading of a chart in the mode the user picked: rows from the bottom up, or
 * corner-to-corner diagonals. Both are the same shape, so everything downstream —
 * the written pattern, the progress tracker — works on either without branching.
 */
export function readingFor(chart, { mode = 'rows', startsOnRightSide = true } = {}) {
  return mode === 'c2c' ? encodeC2C(chart) : encodeRows(chart, { startsOnRightSide })
}

/** Array indices worked in one step of that reading, in working order. */
export function stepCells(chart, step, { mode = 'rows', startsOnRightSide = true } = {}) {
  return mode === 'c2c' ? c2cBandCells(chart, step) : rowCells(chart, step, startsOnRightSide)
}

/** Cells per colour, most used first. */
export function colourCounts(chart) {
  const counts = new Array(chart.palette.length).fill(0)
  for (let i = 0; i < chart.cells.length; i++) counts[chart.cells[i]]++
  const total = chart.cells.length || 1
  return chart.palette
    .map((colour, index) => ({
      index,
      colour,
      cells: counts[index],
      percent: (counts[index] / total) * 100,
    }))
    .sort((a, b) => b.cells - a.cells)
}

/** The printable key: letter, swatch, name, coverage, yardage. */
export function legend(chart) {
  return colourCounts(chart).map((entry, rank) => ({
    ...entry,
    letter: chartLetter(rank),
    yards: yardsFor(entry.cells, chart.gauge),
  }))
}

/** Yarn needed per colour. Rough by nature — the UI says so. */
export function estimateYarn(chart) {
  return colourCounts(chart).map((entry) => ({
    ...entry,
    yards: yardsFor(entry.cells, chart.gauge),
    metres: yardsFor(entry.cells, chart.gauge) * 0.9144,
  }))
}

/**
 * How many times you'd pick up a new colour working the chart in rows.
 *
 * This is the number that tells you what a chart actually COSTS to make, and it's why
 * it sits next to the colour count in the UI: a twelve-colour chart with nine hundred
 * joins is far more work than a twenty-colour one with two hundred, and without this
 * number the "fewer colours" slider is optimising the wrong thing.
 */
export function colourChanges(chart, opts) {
  return encodeRows(chart, opts).reduce((total, row) => total + Math.max(0, row.runs.length - 1), 0)
}

/** Headline numbers for the summary bar and the PDF cover. */
export function dimensions(chart) {
  const size = finishedSize(chart.stitches, chart.rows, chart.gauge)
  return {
    stitches: chart.stitches,
    rows: chart.rows,
    cells: chart.stitches * chart.rows,
    colours: chart.palette.length,
    ...size,
  }
}

/**
 * The written pattern.
 *
 * Every line ends with its stitch total in parentheses. That's not decoration — it's
 * how you catch a miscount two rows later instead of twenty.
 */
export function patternText(chart, { startsOnRightSide = true, mode = 'rows', title = '' } = {}) {
  const lines = []
  const dim = dimensions(chart)
  if (title) lines.push(title, '')
  lines.push(
    `${dim.stitches} stitches x ${dim.rows} rows`,
    `Gauge assumed: ${chart.gauge.stitchesPer4} sts and ${chart.gauge.rowsPer4} rows per 4 inches`,
    `Finished size at that gauge: ${dim.widthIn.toFixed(1)}" x ${dim.heightIn.toFixed(1)}"`,
    '',
    'Colour key',
  )
  for (const entry of legend(chart)) {
    lines.push(
      `  ${entry.letter}  ${entry.colour.name.padEnd(12)} ${String(entry.cells).padStart(6)} sts` +
        `  ~${Math.ceil(entry.yards)} yd`,
    )
  }
  lines.push('', 'Yarn estimates are rough. Buy about 20% more than listed.', '')

  const name = (index) => chart.palette[index]?.name ?? '?'
  if (mode === 'c2c') {
    lines.push('Corner to corner', '')
    for (const band of encodeC2C(chart)) {
      const runs = band.runs.map((r) => `${r.count} ${name(r.index)}`).join(', ')
      lines.push(`Row ${band.row} (${band.phase}, ${band.direction}): ${runs}  (${band.total})`)
    }
  } else {
    lines.push('Worked in rows, from the bottom up', '')
    for (const row of encodeRows(chart, { startsOnRightSide })) {
      const runs = row.runs.map((r) => `${r.count} ${name(r.index)}`).join(', ')
      lines.push(`Row ${row.row} (${row.side}, ${row.direction}): ${runs}  (${row.total})`)
    }
  }
  return lines.join('\n')
}
