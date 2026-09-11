/**
 * Keeping your place, asserted the way the drawing code is: on an invariant rather
 * than on a handful of examples.
 *
 * The invariant that matters is that walking the whole chart run by run visits every
 * stitch exactly once, in the order the hook meets it. Anything that breaks that — an
 * off-by-one at a row boundary, a rollover that skips a run, a mask that paints a cell
 * twice — means somebody following the tracker crochets the wrong thing, and would not
 * find out until the blanket was finished.
 */

import {
  AHEAD,
  CURRENT,
  WORKED,
  emptyProgress,
  goToStep,
  isComplete,
  makeView,
  nextRun,
  nextStep,
  normalizeProgress,
  prevRun,
  prevStep,
  progressStats,
  runRange,
  stepBounds,
  workedMask,
} from '../src/lib/progress.js'
import { colourChanges, readingFor, stepCells } from '../src/lib/pattern.js'
import { RESOLVED } from '../src/lib/palette.js'

const SC = { stitchesPer4: 16, rowsPer4: 18, unit: 'in' }

/** A chart with plenty of runs per row, and rows that differ from each other. */
function chartOf(stitches, rows, fn) {
  const cells = new Uint8Array(stitches * rows)
  for (let y = 0; y < rows; y++) for (let x = 0; x < stitches; x++) cells[y * stitches + x] = fn(x, y)
  return { stitches, rows, cells, palette: RESOLVED.slice(0, 4), gauge: SC, meta: {} }
}

/** Tick through the entire chart one colour run at a time. */
function walk(chart, reading, onTick) {
  let progress = emptyProgress()
  let guard = 0
  const limit = chart.stitches * chart.rows + reading.length + 10
  while (!isComplete(progress, reading)) {
    if (++guard > limit) throw new Error('walk never finished')
    const before = progress
    progress = nextRun(progress, reading)
    onTick?.(before, progress)
  }
  return { progress, ticks: guard }
}

export default async function run({ check }) {
  const chart = chartOf(24, 16, (x, y) => (Math.floor(x / 3) + y) % 4)
  const rows = readingFor(chart, { mode: 'rows' })

  // --- starting position
  const start = emptyProgress()
  check.is('you start on row 1', start.step, 1)
  check.is('with nothing ticked off', start.runsDone, 0)
  check('row 1 is not the finished state', !isComplete(start, rows))

  // --- ticking a run
  const afterOne = nextRun(start, rows)
  check.is('one tick stays on row 1', afterOne.step, 1)
  check.is('and moves to the second run', afterOne.runsDone, 1)

  // --- a row rolls over to the next
  let end = start
  for (let i = 0; i < rows[0].runs.length; i++) end = nextRun(end, rows)
  check.is('ticking every run of a row moves to the next row', end.step, 2)
  check.is('and starts it at the first run', end.runsDone, 0)

  // --- stepping back lands at the END of the previous row
  const back = prevRun({ step: 3, runsDone: 0 }, rows)
  check.is('stepping back from the start of a row goes to the row before', back.step, 2)
  check.is('and to its LAST run, not its first', back.runsDone, rows[1].runs.length - 1)
  check.is('stepping back from the very beginning stays put', prevRun(start, rows).step, 1)

  // --- next and previous undo each other
  let roundTrip = true
  let cursor = emptyProgress()
  for (let i = 0; i < 200 && !isComplete(cursor, rows); i++) {
    const forward = nextRun(cursor, rows)
    const returned = prevRun(forward, rows)
    if (returned.step !== cursor.step || returned.runsDone !== cursor.runsDone) roundTrip = false
    cursor = forward
  }
  check('a tick and a step back always cancel out', roundTrip)

  // --- whole-row jumps
  check.is('finishing a row skips its remaining runs', nextStep({ step: 4, runsDone: 2 }, rows).step, 5)
  check.is('and starts the next row clean', nextStep({ step: 4, runsDone: 2 }, rows).runsDone, 0)
  check.is('going back a row lands on its first run', prevStep({ step: 4, runsDone: 2 }).runsDone, 0)
  check.is('going back from row 1 stays on row 1', prevStep({ step: 1, runsDone: 0 }).step, 1)
  check.is('you can jump straight to a row', goToStep(9, rows).step, 9)
  check.is('a jump past the end clamps to finished', goToStep(9999, rows).step, rows.length + 1)

  // --- the finished state
  const walked = walk(chart, rows)
  check('walking every run reaches the finished state', isComplete(walked.progress, rows))
  check.is('finished is exactly one past the last row', walked.progress.step, rows.length + 1)
  check.is('ticking again from finished changes nothing', nextRun(walked.progress, rows).step, rows.length + 1)
  const totalRuns = rows.reduce((t, r) => t + r.runs.length, 0)
  check.is('it took exactly one tick per colour run', walked.ticks, totalRuns)

  // --- normalizing junk
  check.is('junk normalizes to row 1', normalizeProgress(null, rows).step, 1)
  check.is('a zero row clamps up to 1', normalizeProgress({ step: 0 }, rows).step, 1)
  check.is('a negative row clamps up to 1', normalizeProgress({ step: -7 }, rows).step, 1)
  check.is('a row past the end clamps to finished', normalizeProgress({ step: 500 }, rows).step, rows.length + 1)
  check.is('a fractional row rounds', normalizeProgress({ step: 4.6 }, rows).step, 5)
  check.is('a negative run count clamps to zero', normalizeProgress({ step: 2, runsDone: -3 }, rows).runsDone, 0)
  check.is(
    'a run count past the end of the row clamps inside it',
    normalizeProgress({ step: 2, runsDone: 999 }, rows).runsDone,
    rows[1].runs.length - 1,
  )
  check.is('the finished state has nothing ticked', normalizeProgress({ step: 999, runsDone: 5 }, rows).runsDone, 0)

  // A position saved against a bigger chart must degrade, not explode.
  const smaller = readingFor(chartOf(8, 4, () => 0), { mode: 'rows' })
  check.is('a position from a bigger chart clamps to finished', normalizeProgress({ step: 300 }, smaller).step, 5)
  check.is('and normalizing an empty reading survives', normalizeProgress({ step: 3 }, []).step, 1)

  // --- stats
  const atStart = progressStats(rows, emptyProgress())
  check.is('nothing is worked at the start', atStart.stitchesDone, 0)
  check.is('every stitch is still to go', atStart.stitchesLeft, chart.stitches * chart.rows)
  check.is('the total is the whole chart', atStart.stitches, chart.stitches * chart.rows)
  check.near('and you are 0% in', atStart.percent, 0)
  check('nothing is complete at the start', !atStart.complete)
  check.is(
    'colour changes left starts at the chart total',
    atStart.joinsLeft,
    colourChanges(chart, { startsOnRightSide: true }),
  )

  const atEnd = progressStats(rows, walked.progress)
  check.is('every stitch is worked at the end', atEnd.stitchesDone, chart.stitches * chart.rows)
  check.is('nothing is left', atEnd.stitchesLeft, 0)
  check.is('no colour changes remain', atEnd.joinsLeft, 0)
  check.near('and you are 100% in', atEnd.percent, 100)
  check('the end reports complete', atEnd.complete)
  check.is('rows done is the whole chart', atEnd.stepsDone, chart.rows)

  // --- the invariant: stitches only ever go forwards, one run at a time
  let monotonic = true
  let joinsNeverRise = true
  let previousStitches = 0
  let previousJoins = atStart.joinsLeft
  walk(chart, rows, (before, after) => {
    const stats = progressStats(rows, after)
    const expected = previousStitches + rows[before.step - 1].runs[before.runsDone].count
    if (stats.stitchesDone !== expected) monotonic = false
    if (stats.joinsLeft > previousJoins) joinsNeverRise = false
    previousStitches = stats.stitchesDone
    previousJoins = stats.joinsLeft
  })
  check('every tick advances by exactly that run’s stitch count', monotonic)
  check('colour changes left never goes up', joinsNeverRise)

  // --- the mask agrees with the stats, tick for tick
  const countWorked = (mask) => mask.reduce((t, v) => t + (v === WORKED ? 1 : 0), 0)

  const freshMask = workedMask(chart, rows, emptyProgress(), { mode: 'rows' })
  check.is('the mask covers every cell', freshMask.length, chart.cells.length)
  check.is('nothing is marked worked at the start', countWorked(freshMask), 0)
  check.is(
    'the whole first row is marked current',
    freshMask.reduce((t, v) => t + (v === CURRENT ? 1 : 0), 0),
    chart.stitches,
  )
  check(
    'the current row is the bottom one',
    Array.from({ length: chart.stitches }).every(
      (_, x) => freshMask[(chart.rows - 1) * chart.stitches + x] === CURRENT,
    ),
  )
  check.is(
    'everything above it is still ahead',
    freshMask.reduce((t, v) => t + (v === AHEAD ? 1 : 0), 0),
    chart.cells.length - chart.stitches,
  )

  let maskTracksStats = true
  walk(chart, rows, (_before, after) => {
    const mask = workedMask(chart, rows, after, { mode: 'rows' })
    if (countWorked(mask) !== progressStats(rows, after).stitchesDone) maskTracksStats = false
  })
  check('the chart overlay and the numbers never disagree', maskTracksStats)

  const finalMask = workedMask(chart, rows, walked.progress, { mode: 'rows' })
  check.is('every cell is worked at the end', countWorked(finalMask), chart.cells.length)

  // --- stitch numbering, which is NOT the same as working order
  const rsRow = rows[0]
  check.is('row 1 is a right-side row', rsRow.side, 'RS')
  const rsFirst = runRange(rsRow, 0, { mode: 'rows', stitches: chart.stitches })
  check.is('a right-side row starts at stitch 1', rsFirst.from, 1)
  const rsLast = runRange(rsRow, rsRow.runs.length - 1, { mode: 'rows', stitches: chart.stitches })
  check.is('and ends on the last stitch', rsLast.to, chart.stitches)

  const wsRow = rows[1]
  check.is('row 2 is a wrong-side row', wsRow.side, 'WS')
  const wsFirst = runRange(wsRow, 0, { mode: 'rows', stitches: chart.stitches })
  check.is('a wrong-side row starts at the HIGHEST stitch number', wsFirst.from, chart.stitches)
  check('and counts down, because the hook travels the other way', wsFirst.to < wsFirst.from)
  const wsLast = runRange(wsRow, wsRow.runs.length - 1, { mode: 'rows', stitches: chart.stitches })
  check.is('and finishes on stitch 1', wsLast.to, 1)

  // Ranges must tile their row with no gap and no overlap, on both sides.
  let rangesTile = true
  for (const row of rows) {
    const seen = new Set()
    for (let i = 0; i < row.runs.length; i++) {
      const range = runRange(row, i, { mode: 'rows', stitches: chart.stitches })
      const lo = Math.min(range.from, range.to)
      const hi = Math.max(range.from, range.to)
      if (hi - lo + 1 !== row.runs[i].count) rangesTile = false
      for (let n = lo; n <= hi; n++) {
        if (seen.has(n)) rangesTile = false
        seen.add(n)
      }
    }
    if (seen.size !== chart.stitches) rangesTile = false
  }
  check('stitch ranges tile every row exactly once', rangesTile)

  check.is('an out-of-range run has no stitch range', runRange(rsRow, 999, { mode: 'rows' }), null)

  // --- the marker sits on exactly one row, full width
  const bounds = stepBounds(chart, 1, { mode: 'rows' })
  check.is('the row 1 marker spans the full width', bounds.x1 - bounds.x0, chart.stitches)
  check.is('and is exactly one row tall', bounds.y1 - bounds.y0, 1)
  check.is('row 1 is the BOTTOM array row', bounds.y0, chart.rows - 1)
  check.is('the top row marker is array row 0', stepBounds(chart, chart.rows, { mode: 'rows' }).y0, 0)

  // --- corner to corner reads the same chart the same way
  const c2c = readingFor(chart, { mode: 'c2c' })
  check.is('c2c has one step per diagonal', c2c.length, chart.stitches + chart.rows - 1)

  const c2cWalk = walk(chart, c2c)
  check('c2c also reaches the finished state', isComplete(c2cWalk.progress, c2c))
  const c2cFinal = workedMask(chart, c2c, c2cWalk.progress, { mode: 'c2c' })
  check.is('and marks every cell worked', c2cFinal.reduce((t, v) => t + (v === WORKED ? 1 : 0), 0), chart.cells.length)
  check.is(
    'c2c stitch totals still cover the chart',
    progressStats(c2c, c2cWalk.progress).stitchesDone,
    chart.cells.length,
  )

  let c2cMaskTracks = true
  walk(chart, c2c, (_before, after) => {
    const mask = workedMask(chart, c2c, after, { mode: 'c2c' })
    if (countWorked(mask) !== progressStats(c2c, after).stitchesDone) c2cMaskTracks = false
  })
  check('the c2c overlay and its numbers never disagree', c2cMaskTracks)

  // --- every step's cells are real, distinct cells of the chart
  let cellsSane = true
  const everySeen = new Set()
  for (const step of rows) {
    for (const cell of stepCells(chart, step.row, { mode: 'rows' })) {
      if (cell < 0 || cell >= chart.cells.length) cellsSane = false
      if (everySeen.has(cell)) cellsSane = false
      everySeen.add(cell)
    }
  }
  check('walking every row visits each cell exactly once', cellsSane && everySeen.size === chart.cells.length)

  // --- makeView ties it together
  const viewAt = makeView(chart, { step: 5, runsDone: 1 }, { mode: 'rows' })
  check.is('makeView reports the row you are on', viewAt.current.row, 5)
  check.is('and the one after it', viewAt.next.row, 6)
  check.is('and normalizes the position it was handed', viewAt.progress.step, 5)
  check.is('and carries the stats', viewAt.stats.steps, chart.rows)
  const viewAtEnd = makeView(chart, { step: chart.rows + 1, runsDone: 0 }, { mode: 'rows' })
  check.is('at the end there is no current row', viewAtEnd.current, null)
  check('and the stats say complete', viewAtEnd.stats.complete)

  // --- a one-colour chart still works (every row is a single run)
  const plain = chartOf(6, 3, () => 0)
  const plainRows = readingFor(plain, { mode: 'rows' })
  const plainWalk = walk(plain, plainRows)
  check.is('a one-colour chart takes one tick per row', plainWalk.ticks, 3)
  check.is('and still finishes', progressStats(plainRows, plainWalk.progress).stitchesDone, 18)
}
