/**
 * What a crocheter actually reads.
 *
 * The direction alternation is the thing to guard here. Row 1 is the right side and is
 * worked right to left; after you turn, row 2 is the wrong side and is worked left to
 * right. Get it backwards and every chart the tool prints is mirrored — which nobody
 * discovers until they've crocheted a reversed letter into a blanket.
 */

import {
  arrayRowIndex,
  colourChanges,
  colourCounts,
  crochetRowIndex,
  dimensions,
  encodeC2C,
  encodeRows,
  estimateYarn,
  legend,
  patternText,
  readingArea,
  readingFor,
  roundCells,
  rowSide,
  stepCells,
  stepLabel,
} from '../src/lib/pattern.js'
import { RESOLVED } from '../src/lib/palette.js'

const SC = { stitchesPer4: 16, rowsPer4: 18, unit: 'in' }

/** A 4x2 chart: bottom row is A A B B, top row is B B B B. */
function fixture() {
  return {
    stitches: 4,
    rows: 2,
    // Array row 0 is the TOP of the picture.
    cells: new Uint8Array([1, 1, 1, 1, 0, 0, 1, 1]),
    palette: [RESOLVED[0], RESOLVED[1]],
    gauge: SC,
    meta: {},
  }
}

export default async function run({ check }) {
  const chart = fixture()

  // --- row numbering runs bottom-up
  check.is('array row 0 is the top, so it is the LAST crochet row', crochetRowIndex(chart, 0), 2)
  check.is('the bottom array row is crochet row 1', crochetRowIndex(chart, chart.rows - 1), 1)
  check.is('and the inverse agrees', arrayRowIndex(chart, 1), chart.rows - 1)

  // --- sides and direction
  check.is('row 1 is the right side', rowSide(1).side, 'RS')
  check.is('row 1 is worked right to left', rowSide(1).direction, '←')
  check.is('row 2 is the wrong side', rowSide(2).side, 'WS')
  check.is('row 2 is worked left to right', rowSide(2).direction, '→')
  check.is('starting on the wrong side flips it', rowSide(1, false).side, 'WS')

  // --- the pinned encoding
  const rows = encodeRows(chart)
  check.is('there is one instruction per row', rows.length, 2)
  check.is('row 1 comes first', rows[0].row, 1)

  // Bottom array row is [A, A, B, B]. Row 1 is RS and reads it REVERSED: B B A A.
  check.is('row 1 reads the chart reversed', rows[0].runs.map((r) => `${r.count}x${r.index}`).join(' '), '2x1 2x0')
  // Row 2 is the top array row, all B, read forward.
  check.is('row 2 reads the chart forward', rows[1].runs.map((r) => `${r.count}x${r.index}`).join(' '), '4x1')

  check.is('row 1 is labelled RS', rows[0].side, 'RS')
  check.is('row 2 is labelled WS', rows[1].side, 'WS')

  // --- every row accounts for every stitch
  const wide = {
    stitches: 37,
    rows: 23,
    cells: new Uint8Array(37 * 23).map((_, i) => i % 5),
    palette: RESOLVED.slice(0, 5),
    gauge: SC,
    meta: {},
  }
  const allRows = encodeRows(wide)
  check.is('one instruction per row on a big chart', allRows.length, 23)
  check(
    'every row adds up to the stitch count',
    allRows.every((row) => row.runs.reduce((t, r) => t + r.count, 0) === wide.stitches),
  )
  check('every row reports its own total', allRows.every((row) => row.total === wide.stitches))
  check('rows are numbered 1..n with no gaps', allRows.every((row, i) => row.row === i + 1))
  check('sides alternate all the way up', allRows.every((row, i) => row.side === (i % 2 === 0 ? 'RS' : 'WS')))

  // --- corner to corner
  const c2c = encodeC2C(chart)
  check.is('a 4x2 chart is 5 diagonal rows', c2c.length, 4 + 2 - 1)
  check(
    'every diagonal accounts for its own cells',
    c2c.every((band) => band.runs.reduce((t, r) => t + r.count, 0) === band.total),
  )
  check.is('the first diagonal is a single block', c2c[0].total, 1)
  check('c2c increases then decreases', c2c.some((b) => b.phase === 'increase') && c2c.some((b) => b.phase === 'decrease'))
  check('c2c directions alternate', c2c.every((b, i) => b.direction === (i % 2 === 1 ? '↗' : '↙')))

  const bigC2C = encodeC2C(wide)
  const c2cCells = bigC2C.reduce((t, b) => t + b.total, 0)
  check.is('c2c visits every cell exactly once', c2cCells, wide.stitches * wide.rows)

  // --- counts, legend, yarn
  const counts = colourCounts(wide)
  check.is('counts cover every cell', counts.reduce((t, c) => t + c.cells, 0), wide.stitches * wide.rows)
  check.near('percentages add to 100', counts.reduce((t, c) => t + c.percent, 0), 100, 0.01)
  check('counts are sorted most-used first', counts.every((c, i) => i === 0 || counts[i - 1].cells >= c.cells))

  const key = legend(wide)
  check.is('legend letters start at A', key[0].letter, 'A')
  check.is('and continue B, C', `${key[1].letter}${key[2].letter}`, 'BC')
  check.is('legend letters are unique', new Set(key.map((k) => k.letter)).size, key.length)
  check('every legend row carries a yardage', key.every((k) => k.yards > 0))

  const yarn = estimateYarn(wide)
  check('yarn estimates track cell counts', yarn.every((y, i) => i === 0 || yarn[i - 1].yards >= y.yards))
  check('metres and yards agree', yarn.every((y) => Math.abs(y.metres - y.yards * 0.9144) < 1e-9))

  // --- joins
  check.is('a two-run row is one colour change', colourChanges(chart), 1)
  const solid = {
    ...chart,
    cells: new Uint8Array(chart.stitches * chart.rows).fill(0),
    palette: [RESOLVED[0]],
  }
  check.is('a one-colour chart has no colour changes', colourChanges(solid), 0)

  // --- dimensions
  const dim = dimensions(wide)
  check.is('dimensions report the stitch count', dim.stitches, 37)
  check.is('dimensions report the row count', dim.rows, 23)
  check.is('dimensions report the colour count', dim.colours, 5)
  check.near('dimensions report the finished width', dim.widthIn, 37 * 0.25, 1e-9)

  // --- written pattern
  const text = patternText(wide, { title: 'Test' })
  const lines = text.split('\n')
  check('the pattern names every row', wide.rows === lines.filter((l) => /^Row \d+ \(/.test(l)).length)
  check('row lines end with a stitch total', lines.filter((l) => l.startsWith('Row ')).every((l) => /\(\d+\)$/.test(l)))
  check('the pattern states the gauge it assumed', text.includes('Gauge assumed'))
  check('the pattern is honest about yarn estimates', text.includes('rough'))
  check('the pattern includes the colour key', text.includes('Colour key'))
  check('the first row line is row 1', lines.find((l) => l.startsWith('Row ')).startsWith('Row 1 '))

  const c2cText = patternText(wide, { mode: 'c2c' })
  check('c2c mode changes the written pattern', c2cText.includes('Corner to corner'))
  check('c2c mode still lists every diagonal', c2cText.split('\n').filter((l) => /^Row \d+ \(/.test(l)).length === bigC2C.length)

  /* ---------------------------------------------------------------------------
     A border worked at the end: the picture first, then rounds around it.

     The thing worth guarding is not the labelling, it is that the two halves of the
     reading still tile the chart. Making mode trusts that completely — it tots up
     every step's `total` to know how many stitches the job is, and paints the overlay
     from each step's cells — so a reading that visits a cell twice, or misses one,
     reports a blanket somebody is forty hours into as the wrong length and marks the
     wrong stitches done. A unit test is the only place that is cheap to notice.
  */
  const bordered = (rounds) => {
    const stitches = 9
    const rowCount = 7
    const cells = new Uint8Array(stitches * rowCount)
    // A picture that is NOT one flat colour, so runs differ row to row.
    for (let y = 0; y < rowCount; y++) {
      for (let x = 0; x < stitches; x++) cells[y * stitches + x] = (x + y) % 2
    }
    return {
      stitches,
      rows: rowCount,
      cells,
      palette: [RESOLVED[0], RESOLVED[1]],
      gauge: SC,
      meta: { border: { sts: rounds, rows: rounds, rounds } },
    }
  }

  const framed = bordered(2)
  const area = readingArea(framed)
  check.is('the reading area insets by the round count on x', area.x, 2)
  check.is('and on y', area.y, 2)
  check.is('leaving the picture width', area.w, 5)
  check.is('and the picture height', area.h, 3)

  const plain = bordered(0)
  check.is(
    'a border worked as you go leaves the area alone',
    `${readingArea(plain).w}x${readingArea(plain).h}`,
    '9x7',
  )

  for (const mode of ['rows', 'c2c']) {
    const reading = readingFor(framed, { mode })
    const seen = new Int32Array(framed.cells.length).fill(0)
    let counted = 0
    for (const entry of reading) {
      const cells = stepCells(framed, entry.row, { mode })
      check.is(
        `${mode}: every step's cell count matches the total it reports`,
        cells.length,
        entry.total,
      )
      for (const cell of cells) {
        seen[cell]++
        counted++
      }
    }
    check.is(`${mode}: the reading works every stitch of the chart`, counted, framed.cells.length)
    check(
      `${mode}: and works each of them exactly once`,
      seen.every((n) => n === 1),
      `${seen.filter((n) => n !== 1).length} cells visited the wrong number of times`,
    )

    // The order is the point of the whole feature: nothing of the border before the
    // picture is finished, and nothing of the picture after the border has started.
    const firstRound = reading.findIndex((entry) => entry.kind === 'round')
    check.is(`${mode}: there is one step per round, at the end`, reading.length - firstRound, 2)
    check(
      `${mode}: no border stitch is worked before the picture is done`,
      reading.slice(0, firstRound).every((entry) => {
        for (const cell of stepCells(framed, entry.row, { mode })) {
          const x = cell % framed.stitches
          const y = Math.floor(cell / framed.stitches)
          if (x < 2 || y < 2 || x >= 7 || y >= 5) return false
        }
        return true
      }),
    )
  }

  // Round 1 hugs the picture and the last round is the outside edge, because that is
  // the order they are worked: each goes around what is already there.
  const inner = [...roundCells(framed, 1)].map((c) => c % framed.stitches)
  const outer = [...roundCells(framed, 2)].map((c) => c % framed.stitches)
  check.is('round 1 is the inner ring', Math.min(...inner), 1)
  check.is('the last round is the outside edge', Math.min(...outer), 0)
  check.is('an inner ring is shorter than the one around it', inner.length < outer.length, true)
  check.is('the rings between them are the whole border', inner.length + outer.length, 9 * 7 - 5 * 3)

  // A round travels the way row 1 does: right to left along the bottom, then round.
  const outerCells = [...roundCells(framed, 2)]
  check.is('a round starts at the bottom right corner', outerCells[0], 6 * 9 + 8)
  check.is('and moves left along the bottom', outerCells[1], 6 * 9 + 7)
  check.is('a round has no repeats', new Set(outerCells).size, outerCells.length)

  check.is('a round is labelled a round', stepLabel({ kind: 'round', round: 3 }), 'Round 3')
  check.is('a row is labelled a row', stepLabel({ kind: 'row', row: 12 }), 'Row 12')

  // The written pattern has to say so too, or the sheet and the screen disagree.
  const framedText = patternText(framed, { title: 'Framed' })
  check('the written pattern announces the border section', framedText.includes('worked in rounds'))
  check('and names a round rather than a row', /^Round 1 \(/m.test(framedText))
  check(
    'the picture rows are the picture only',
    framedText.split('\n').filter((l) => /^Row \d+ \(/.test(l)).length === 3,
  )
}
