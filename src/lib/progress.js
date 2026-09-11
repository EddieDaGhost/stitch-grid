/**
 * Keeping your place while you make the thing. Pure.
 *
 * The rest of the app ends at the moment the PDF downloads. This is the other half of
 * the job: a 60 x 80 chart is 4,800 stitches and forty hours, and the thing that
 * actually goes wrong in those forty hours is losing your place — which row, and how
 * far along it.
 *
 * A Progress is two small integers and nothing else:
 *
 *   step      the row (or C2C diagonal) you are working NOW, 1-based
 *   runsDone  how many colour runs of that step are behind you
 *
 * `step === reading.length + 1` is the finished state, which is why every clamp allows
 * one past the end. Keeping it a sentinel rather than a `done` flag means the stats
 * below stay monotonic and there is only ever one way to be complete.
 *
 * Progress is NOT part of the design and NOT part of undo. Undo steps back through
 * edits, not through how far you've crocheted — ticking off a row is not an edit to
 * the chart, and having undo yank you back twenty rows would be indefensible.
 */

import { readingFor, stepCells } from './pattern.js'

/** Mask values. */
export const AHEAD = 0
export const CURRENT = 1
export const WORKED = 2

export function emptyProgress() {
  return { step: 1, runsDone: 0 }
}

/**
 * Clamp anything into a usable Progress for this particular reading.
 *
 * Never throws. A stored position belongs to a chart that may since have been re-sized,
 * so a step past the end has to degrade to "finished" rather than crash or silently
 * read a run off the end of the array.
 */
export function normalizeProgress(raw, reading) {
  const p = raw && typeof raw === 'object' ? raw : {}
  const steps = reading.length
  const asInt = (v, fallback) => {
    const n = Math.round(Number(v))
    return Number.isFinite(n) ? n : fallback
  }
  const step = Math.min(steps + 1, Math.max(1, asInt(p.step, 1)))
  const runs = reading[step - 1]?.runs.length ?? 0
  // A full row of runsDone would mean the row is finished, which is the next step's
  // job to represent — so the last tick always rolls over rather than parking here.
  const runsDone = Math.min(Math.max(0, runs - 1), Math.max(0, asInt(p.runsDone, 0)))
  return { step, runsDone }
}

export function isComplete(progress, reading) {
  return progress.step > reading.length
}

/** Tick off the next colour run. Finishing the last run of a step moves you on. */
export function nextRun(progress, reading) {
  if (isComplete(progress, reading)) return progress
  const runs = reading[progress.step - 1].runs.length
  if (progress.runsDone + 1 >= runs) return { step: progress.step + 1, runsDone: 0 }
  return { step: progress.step, runsDone: progress.runsDone + 1 }
}

/** Undo one tick, stepping back into the end of the previous row when at its start. */
export function prevRun(progress, reading) {
  if (progress.runsDone > 0) return { step: progress.step, runsDone: progress.runsDone - 1 }
  if (progress.step <= 1) return { step: 1, runsDone: 0 }
  const previous = progress.step - 1
  const runs = reading[previous - 1]?.runs.length ?? 1
  return { step: previous, runsDone: Math.max(0, runs - 1) }
}

/** Done with this row — on to the next, however many runs were ticked. */
export function nextStep(progress, reading) {
  if (isComplete(progress, reading)) return progress
  return { step: progress.step + 1, runsDone: 0 }
}

export function prevStep(progress) {
  return { step: Math.max(1, progress.step - 1), runsDone: 0 }
}

/** Jump straight to a row, for when you pick the work up and count where you got to. */
export function goToStep(step, reading) {
  return normalizeProgress({ step, runsDone: 0 }, reading)
}

/**
 * Where you are, in the numbers worth showing.
 *
 * Stitches rather than time: how long a blanket takes depends on the person, and a
 * confident "4h 20m remaining" would be exactly the kind of fake-precise number this
 * app refuses to print elsewhere. Colour changes left is the honest measure of how
 * much fiddly work remains, the same way it measures the cost of a design.
 */
export function progressStats(reading, progress) {
  const steps = reading.length
  const step = Math.min(progress.step, steps + 1)

  let stitchesDone = 0
  let joinsLeft = 0
  let totalStitches = 0

  for (let i = 0; i < steps; i++) {
    const entry = reading[i]
    totalStitches += entry.total
    if (i < step - 1) {
      stitchesDone += entry.total
    } else if (i === step - 1) {
      for (let r = 0; r < progress.runsDone && r < entry.runs.length; r++) {
        stitchesDone += entry.runs[r].count
      }
      joinsLeft += Math.max(0, entry.runs.length - 1 - progress.runsDone)
    } else {
      joinsLeft += Math.max(0, entry.runs.length - 1)
    }
  }

  return {
    step,
    steps,
    stepsDone: step - 1,
    stepsLeft: Math.max(0, steps - step + 1),
    stitchesDone,
    stitches: totalStitches,
    stitchesLeft: Math.max(0, totalStitches - stitchesDone),
    joinsLeft,
    percent: totalStitches ? (stitchesDone / totalStitches) * 100 : 0,
    complete: step > steps,
  }
}

/**
 * Per-cell state for the on-chart overlay: worked, being worked now, or still ahead.
 *
 * Runs already ticked off inside the current row count as worked, which is what makes
 * ticking a run visibly move a marker across the row rather than just changing a label.
 *
 * O(cells), and deliberately not on any interaction path that also rebuilds a chart —
 * making mode has no sliders, so this runs once per tick rather than once per frame.
 */
export function workedMask(chart, reading, progress, opts = {}) {
  const mask = new Uint8Array(chart.cells.length)
  const step = Math.min(progress.step, reading.length + 1)

  for (let i = 0; i < step - 1 && i < reading.length; i++) {
    for (const cell of stepCells(chart, reading[i].row, opts)) mask[cell] = WORKED
  }

  const current = reading[step - 1]
  if (current) {
    const cells = stepCells(chart, current.row, opts)
    let k = 0
    for (let r = 0; r < current.runs.length; r++) {
      const value = r < progress.runsDone ? WORKED : CURRENT
      for (let n = 0; n < current.runs[r].count && k < cells.length; n++, k++) mask[cells[k]] = value
    }
  }

  return mask
}

/** Cell-space bounding box of one step, for drawing a marker around it. */
export function stepBounds(chart, step, opts = {}) {
  const cells = stepCells(chart, step, opts)
  if (!cells.length || !chart.stitches) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const cell of cells) {
    const x = cell % chart.stitches
    const y = Math.floor(cell / chart.stitches)
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  // Exclusive on the far edge, so it can be handed straight to a rectangle.
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 }
}

/** Everything making mode needs, from a chart and a position. */
export function makeView(chart, progress, opts = {}) {
  const reading = readingFor(chart, opts)
  const position = normalizeProgress(progress, reading)
  return {
    reading,
    progress: position,
    current: reading[position.step - 1] ?? null,
    next: reading[position.step] ?? null,
    stats: progressStats(reading, position),
  }
}

/**
 * Which stitch numbers a run covers, AS PRINTED ON THE CHART.
 *
 * Working order and printed order are not the same thing, and this is the one place
 * that difference is allowed to matter. The chart numbers stitch 1 at the right-hand
 * edge, because row 1 is worked right to left. A right-side row is therefore worked in
 * ascending printed numbers; a wrong-side row is worked from the left edge, so it
 * counts DOWN — position k is printed stitch `stitches - k`.
 *
 * Returned in travel order, so `from` is greater than `to` on a wrong-side row. That
 * reads oddly out of context and is exactly right in it: the numbers run the way your
 * hook does, and match the numbers printed along the edge of the sheet.
 *
 * Corner-to-corner has no stitch numbering across a diagonal, so there it is simply
 * the block's position in the band.
 */
export function runRange(entry, runIndex, { mode = 'rows', stitches = 0 } = {}) {
  if (!entry || !entry.runs[runIndex]) return null
  let start = 0
  for (let i = 0; i < runIndex; i++) start += entry.runs[i].count
  const count = entry.runs[runIndex].count

  if (mode === 'c2c' || entry.side === 'RS') return { from: start + 1, to: start + count }
  return { from: stitches - start, to: stitches - start - count + 1 }
}
