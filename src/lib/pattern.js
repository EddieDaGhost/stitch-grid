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
 * How many rounds of this chart's border are worked AFTER the picture, if any.
 *
 * Zero for every chart whose border is worked into the fabric as it goes — which is
 * every chart by default, and every chart made before this existed. Zero too if the
 * band would swallow the picture, because a border worked round a panel needs a panel.
 */
function roundsAfter(chart) {
  const rounds = chart.meta?.border?.rounds ?? 0
  const fits = chart.stitches > rounds * 2 && chart.rows > rounds * 2
  return rounds > 0 && fits ? rounds : 0
}

/**
 * The rectangle a reading walks before it starts going round.
 *
 * The whole chart, normally. When the border is worked at the end it is the picture
 * inside that border: those stitches are not part of any row you work: you make the
 * panel first and the frame goes on afterwards. Every walk over a chart goes through
 * here, so "which part am I working" is answered in one place rather than by each
 * caller remembering to subtract the band.
 */
export function readingArea(chart) {
  const d = roundsAfter(chart)
  if (!d) return { x: 0, y: 0, w: chart.stitches, h: chart.rows }
  return { x: d, y: d, w: chart.stitches - d * 2, h: chart.rows - d * 2 }
}

/**
 * The cells of one border round, in the order the hook meets them.
 *
 * Round 1 is the ring that touches the picture and the last round is the outside edge,
 * because that is the order they are worked: each round goes around what is already
 * there. Travel is the same direction row 1 goes — right to left along the bottom —
 * and then up the left side, back along the top and down the right, which is the way
 * round a right-handed crocheter works with the right side facing.
 *
 * The four sides between them touch every cell of the ring exactly once: each edge
 * owns its own corners and the two uprights stop short of them.
 */
export function roundCells(chart, round) {
  const rounds = roundsAfter(chart)
  if (round < 1 || round > rounds) return new Int32Array(0)

  const inset = rounds - round
  const x0 = inset
  const y0 = inset
  const x1 = chart.stitches - 1 - inset
  const y1 = chart.rows - 1 - inset
  const at = (x, y) => y * chart.stitches + x
  const out = []

  if (y1 === y0) {
    for (let x = x1; x >= x0; x--) out.push(at(x, y0))
  } else if (x1 === x0) {
    for (let y = y1; y >= y0; y--) out.push(at(x0, y))
  } else {
    for (let x = x1; x >= x0; x--) out.push(at(x, y1))
    for (let y = y1 - 1; y > y0; y--) out.push(at(x0, y))
    for (let x = x0; x <= x1; x++) out.push(at(x, y0))
    for (let y = y0 + 1; y < y1; y++) out.push(at(x1, y))
  }
  return Int32Array.from(out)
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
export function rowCells(chart, row, startsOnRightSide = true, area = readingArea(chart)) {
  // Row 1 is the bottom row OF THE AREA, which is the whole chart unless the border is
  // being left until the end.
  const y = area.y + area.h - row
  const { reversed } = rowSide(row, startsOnRightSide)
  const out = new Int32Array(area.w)
  for (let k = 0; k < area.w; k++) {
    const x = reversed ? area.w - 1 - k : k
    out[k] = y * chart.stitches + (area.x + x)
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
export function c2cBandCells(chart, band, area = readingArea(chart)) {
  const d = band - 1
  const coords = []
  for (let k = 0; k <= d; k++) {
    const x = k
    const y = area.h - 1 - (d - k)
    if (x >= 0 && x < area.w && y >= 0 && y < area.h) {
      coords.push((area.y + y) * chart.stitches + (area.x + x))
    }
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
  const area = readingArea(chart)
  const out = []
  for (let row = 1; row <= area.h; row++) {
    const { side, direction } = rowSide(row, startsOnRightSide)
    const runs = runsFrom(chart, rowCells(chart, row, startsOnRightSide, area))
    out.push({ row, kind: 'row', side, direction, runs, total: area.w })
  }
  return out
}

/**
 * The border, worked round the finished panel.
 *
 * Appended to whichever reading made the panel, so the two together still visit every
 * stitch of the chart exactly once — which is the invariant the progress tracker is
 * built on, and the reason this is a continuation of the same reading rather than a
 * second one alongside it.
 *
 * `row` carries the step's position in the whole reading, not the round number, because
 * everything that walks a reading looks a step up by it. `round` is the number to print.
 */
export function encodeBorderRounds(chart, after = 0) {
  const rounds = roundsAfter(chart)
  const out = []
  for (let round = 1; round <= rounds; round++) {
    const cells = roundCells(chart, round)
    out.push({
      row: after + round,
      kind: 'round',
      round,
      side: 'RS',
      direction: '↺',
      runs: runsFrom(chart, cells),
      total: cells.length,
    })
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
  const area = readingArea(chart)
  const stitches = area.w
  const rows = area.h
  const bands = stitches + rows - 1
  const out = []

  for (let d = 0; d < bands; d++) {
    const cells = c2cBandCells(chart, d + 1, area)
    if (!cells.length) continue

    out.push({
      row: d + 1,
      kind: 'band',
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
  const panel = mode === 'c2c' ? encodeC2C(chart) : encodeRows(chart, { startsOnRightSide })
  return [...panel, ...encodeBorderRounds(chart, panel.length)]
}

/**
 * What to call one step of a reading.
 *
 * Here rather than in the components so the screen, the written pattern and the printed
 * sheet cannot end up calling the same step different things — the same reason the
 * legend's letters are derived once and shared.
 */
export function stepLabel(entry) {
  if (!entry) return ''
  return entry.kind === 'round' ? `Round ${entry.round}` : `Row ${entry.row}`
}

/** How many steps the picture itself takes, before any border rounds. */
function panelSteps(chart, mode) {
  const area = readingArea(chart)
  return mode === 'c2c' ? area.w + area.h - 1 : area.h
}

/** Array indices worked in one step of that reading, in working order. */
export function stepCells(chart, step, { mode = 'rows', startsOnRightSide = true } = {}) {
  const panel = panelSteps(chart, mode)
  if (step > panel) return roundCells(chart, step - panel)
  const area = readingArea(chart)
  return mode === 'c2c'
    ? c2cBandCells(chart, step, area)
    : rowCells(chart, step, startsOnRightSide, area)
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
  // The whole reading, border rounds included: leaving the frame until the end changes
  // when you work those joins, not whether you work them.
  return readingFor(chart, { mode: 'rows', ...opts })
    .reduce((total, step) => total + Math.max(0, step.runs.length - 1), 0)
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
  lines.push(mode === 'c2c' ? 'Corner to corner' : 'Worked in rows, from the bottom up', '')

  let heading = false
  for (const entry of readingFor(chart, { mode, startsOnRightSide })) {
    if (entry.kind === 'round' && !heading) {
      heading = true
      lines.push(
        '',
        'Border, worked in rounds around the finished panel',
        'Round 1 goes around the picture; each one after that goes around the last.',
        '',
      )
    }
    const runs = entry.runs.map((r) => `${r.count} ${name(r.index)}`).join(', ')
    const how = entry.kind === 'round' ? entry.direction : `${entry.phase ?? entry.side}, ${entry.direction}`
    lines.push(`${stepLabel(entry)} (${how}): ${runs}  (${entry.total})`)
  }
  return lines.join('\n')
}
