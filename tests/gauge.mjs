/**
 * The crochet maths — the part that makes this a crochet tool and not a pixelator.
 */

import {
  cellAspect,
  finishedSize,
  formatSize,
  inchesToRows,
  inchesToStitches,
  normalizeGauge,
  rowHeightIn,
  rowsForAspect,
  stitchWidthIn,
  stitchesForRows,
  stitchSpanIn,
  yardsFor,
} from '../src/lib/gauge.js'

const SC = { stitchesPer4: 16, rowsPer4: 18, unit: 'in' }
const DC = { stitchesPer4: 12, rowsPer4: 7, unit: 'in' }
const SQUARE = { stitchesPer4: 16, rowsPer4: 16, unit: 'in' }

export default async function run({ check }) {
  // --- cell shape
  check.near('single crochet cells are wider than tall', cellAspect(SC), 18 / 16, 1e-9)
  check.near('double crochet cells are much taller than wide', cellAspect(DC), 7 / 12, 1e-9)
  check.near('a square gauge gives square cells', cellAspect(SQUARE), 1, 1e-9)

  check.near('stitch width at sc gauge', stitchWidthIn(SC), 0.25, 1e-9)
  check.near('row height at sc gauge', rowHeightIn(SC), 4 / 18, 1e-9)

  // --- rowsForAspect: the single most important function in the repo
  check.is('a 2:1 photo at sc gauge', rowsForAspect(40, 2.0, SC), 23)
  check.is('a square photo at dc gauge needs far fewer rows', rowsForAspect(60, 1.0, DC), 35)
  check.is('a square photo at sc gauge needs MORE rows than stitches', rowsForAspect(80, 1.0, SC), 90)

  let squareHolds = true
  for (let n = 1; n <= 200; n++) if (rowsForAspect(n, 1.0, SQUARE) !== n) squareHolds = false
  check('a square gauge on a square picture is 1:1 for every size', squareHolds)

  // The whole promise: the finished fabric has the picture's proportions.
  for (const [gauge, label] of [[SC, 'sc'], [DC, 'dc']]) {
    for (const aspect of [0.5, 0.75, 1, 1.5, 2, 3]) {
      const stitches = 120
      const rows = rowsForAspect(stitches, aspect, gauge)
      const size = finishedSize(stitches, rows, gauge)
      const actual = size.widthIn / size.heightIn
      check(
        `finished shape matches a ${aspect}:1 picture at ${label} gauge`,
        Math.abs(actual - aspect) / aspect < 0.02,
        `got ${actual.toFixed(3)}`,
      )
    }
  }

  // The inverse agrees with the forward direction.
  check.is('stitchesForRows inverts rowsForAspect', stitchesForRows(rowsForAspect(90, 1.4, SC), 1.4, SC), 90)

  // Changing the row gauge must not touch the stitch count.
  const before = rowsForAspect(60, 1, SC)
  const after = rowsForAspect(60, 1, { ...SC, rowsPer4: 7 })
  check('loosening the row gauge changes the row count', before !== after, `${before} vs ${after}`)

  // --- distances, which are NOT the same number on both axes
  check.is('1 inch is 4 stitches at sc gauge', inchesToStitches(1, SC), 4)
  check.is('1 inch is 5 rows at sc gauge', inchesToRows(1, SC), 5)
  check(
    'the same border distance is a different cell count per axis',
    inchesToStitches(2, SC) !== inchesToRows(2, SC),
  )
  check.is('a zero border is zero stitches', inchesToStitches(0, SC), 0)

  // --- finished size
  const size = finishedSize(84, 96, SC)
  check.near('84 stitches at sc gauge is 21 inches', size.widthIn, 21, 1e-9)
  check.near('96 rows at sc gauge is 21.33 inches', size.heightIn, 96 * (4 / 18), 1e-9)
  check.near('centimetres convert', size.widthCm, 21 * 2.54, 1e-9)
  check.is('inches format', formatSize(size, 'in'), '21" × 21"')
  check.is('centimetres format', formatSize(size, 'cm'), '53 × 54 cm')
  check.is('small sizes keep a decimal', formatSize(finishedSize(20, 20, SC), 'in'), '5" × 4.4"')

  // --- gauge input is clamped, never trusted
  check.is('a nonsense gauge falls back', normalizeGauge({ stitchesPer4: 'x' }).stitchesPer4, 16)
  check.is('an absurd gauge is clamped', normalizeGauge({ stitchesPer4: 900 }).stitchesPer4, 60)
  check.is('a tiny gauge is clamped', normalizeGauge({ rowsPer4: 0 }).rowsPer4, 4)
  check.is('unknown units fall back to inches', normalizeGauge({ unit: 'furlongs' }).unit, 'in')
  check.is('centimetres are kept', normalizeGauge({ unit: 'cm' }).unit, 'cm')

  // --- yarn
  check('yardage grows with stitch count', yardsFor(2000, SC) > yardsFor(1000, SC))
  check.near('yardage is linear in cells', yardsFor(2000, SC), yardsFor(1000, SC) * 2, 1e-9)
  check('a looser gauge uses more yarn per stitch', yardsFor(1000, DC) > yardsFor(1000, SC))
  check.is('no cells means no yarn', yardsFor(0, SC), 0)

  /*
    Height is half the answer, and used to be absent from it entirely.

    A stitch is not a dot: a double crochet post is two and a half times the height of
    a single crochet one and swallows yarn to match. The old estimate was a multiple of
    the stitch's WIDTH alone, so it could not tell double crochet from corner-to-corner
    — same width, very different height — and returned the same number for both.
  */
  const C2C = { stitchesPer4: 12, rowsPer4: 12, unit: 'in' }
  check.is(
    'double crochet and corner-to-corner are the same width',
    stitchWidthIn(DC),
    stitchWidthIn(C2C),
  )
  check('but double crochet is much taller', rowHeightIn(DC) > rowHeightIn(C2C) * 1.5)
  check(
    'so it cannot want the same amount of yarn',
    yardsFor(1000, DC) > yardsFor(1000, C2C) * 1.2,
    `dc ${yardsFor(1000, DC).toFixed(1)} vs c2c ${yardsFor(1000, C2C).toFixed(1)}`,
  )
  check('a taller stitch always spans further', stitchSpanIn(DC) > stitchSpanIn(SC))

  /*
    The sanity check that says the shape is right rather than merely different: single
    crochet is the most yarn-hungry stitch there is per unit of fabric, and each taller
    stitch covers the same area for less. A model that got this backwards would be
    telling people to buy more yarn for the stitch that uses less.
  */
  const yardsPerSquareFoot = (gauge) => {
    const areaSqFt = (1000 * stitchWidthIn(gauge) * rowHeightIn(gauge)) / 144
    return yardsFor(1000, gauge) / areaSqFt
  }
  const HDC = { stitchesPer4: 14, rowsPer4: 12, unit: 'in' }
  check(
    'single crochet eats the most yarn per square foot of fabric',
    yardsPerSquareFoot(SC) > yardsPerSquareFoot(HDC),
    `sc ${yardsPerSquareFoot(SC).toFixed(0)} vs hdc ${yardsPerSquareFoot(HDC).toFixed(0)}`,
  )
  check(
    'and double crochet the least of the three',
    yardsPerSquareFoot(HDC) > yardsPerSquareFoot(DC),
    `hdc ${yardsPerSquareFoot(HDC).toFixed(0)} vs dc ${yardsPerSquareFoot(DC).toFixed(0)}`,
  )
}
