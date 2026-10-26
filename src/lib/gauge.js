/**
 * The crochet maths. Pure, tiny, and the most load-bearing file in the repo.
 *
 * Everything here exists because a stitch is wider than a row is tall (or, in double
 * crochet, dramatically the other way round). Get this wrong and the tool is just
 * another pixelator that lies to you about what you're about to spend forty hours
 * making.
 */

import { CM_PER_INCH, MAX_PER_4, MIN_PER_4 } from '../config/gauge.js'

/** Width of one stitch, in inches. */
export function stitchWidthIn(gauge) {
  return 4 / gauge.stitchesPer4
}

/** Height of one row, in inches. */
export function rowHeightIn(gauge) {
  return 4 / gauge.rowsPer4
}

/**
 * How wide a chart cell is relative to its height. Above 1 means cells are wider than
 * they are tall (single crochet); below 1 means taller than wide (double crochet).
 */
export function cellAspect(gauge) {
  return gauge.rowsPer4 / gauge.stitchesPer4
}

/**
 * How many rows a picture needs so that the FINISHED FABRIC has the same proportions
 * as the picture. This is the line the whole product is built on.
 *
 *   finishedW = stitches * 4 / stitchesPer4
 *   finishedH = rows     * 4 / rowsPer4
 *   we want   finishedW / finishedH === imageAspect
 *   therefore rows = stitches * (rowsPer4 / stitchesPer4) / imageAspect
 *
 * A square photo in single crochet (16 x 18) needs 1.125x as many rows as stitches.
 * The same photo in double crochet (12 x 7) needs 0.583x. Same picture, wildly
 * different charts, both correct.
 */
export function rowsForAspect(stitches, imageAspect, gauge) {
  if (!(imageAspect > 0)) return Math.max(1, Math.round(stitches))
  return Math.max(1, Math.round((stitches * gauge.rowsPer4) / (gauge.stitchesPer4 * imageAspect)))
}

/** The inverse: how many stitches wide a picture is, given a row budget. */
export function stitchesForRows(rows, imageAspect, gauge) {
  if (!(imageAspect > 0)) return Math.max(1, Math.round(rows))
  return Math.max(1, Math.round((rows * gauge.stitchesPer4 * imageAspect) / gauge.rowsPer4))
}

/** Finished measurements of a chart, in both units, unrounded. */
export function finishedSize(stitches, rows, gauge) {
  const widthIn = stitches * stitchWidthIn(gauge)
  const heightIn = rows * rowHeightIn(gauge)
  return {
    widthIn,
    heightIn,
    widthCm: widthIn * CM_PER_INCH,
    heightCm: heightIn * CM_PER_INCH,
  }
}

/**
 * Inches -> counts. Note these are NOT the same number for the same distance: a 1 inch
 * border at single crochet gauge is 4 stitches on the sides but 5 rows top and bottom.
 * Specifying a border in cells rather than inches is what makes a "square" border come
 * out visibly thinner at the top.
 */
export function inchesToStitches(inches, gauge) {
  return Math.max(0, Math.round(inches / stitchWidthIn(gauge)))
}

export function inchesToRows(inches, gauge) {
  return Math.max(0, Math.round(inches / rowHeightIn(gauge)))
}

/** Clamp a gauge to something a human could actually have swatched. */
export function normalizeGauge(raw) {
  const clamp = (v, fallback) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return fallback
    return Math.min(MAX_PER_4, Math.max(MIN_PER_4, Math.round(n)))
  }
  return {
    stitchesPer4: clamp(raw?.stitchesPer4, 16),
    rowsPer4: clamp(raw?.rowsPer4, 18),
    unit: raw?.unit === 'cm' ? 'cm' : 'in',
  }
}

/** `21" x 24"` or `53 x 61 cm`, formatted the way the UI shows it. */
export function formatSize(size, unit = 'in') {
  if (unit === 'cm') {
    return `${Math.round(size.widthCm)} × ${Math.round(size.heightCm)} cm`
  }
  const round = (v) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10)
  return `${round(size.widthIn)}" × ${round(size.heightIn)}"`
}

/**
 * How many rounds a border worked AFTER the picture needs to be about this deep.
 *
 * A border worked into the fabric as you go can be any shape you like: it is simply
 * extra stitches on each row and extra rows top and bottom, so `inchesToStitches` and
 * `inchesToRows` give it the same depth in inches on both axes.
 *
 * A border worked round the finished panel cannot. One round travels the whole way
 * around, so it adds exactly one stitch of WIDTH at each side and one row of HEIGHT at
 * the top and bottom — and those two are not the same distance. Asking for 1.5" of
 * border therefore has one answer, not two, and the honest thing is to pick the round
 * count that comes closest and then say what it really measures rather than printing
 * the number that was asked for. The caller does the saying; this does the picking.
 *
 * At least one round whenever a border was asked for at all: rounding 0.25" to zero
 * would silently turn the border off.
 */
export function borderRounds(inches, gauge) {
  if (!(inches > 0)) return 0
  const perRound = (stitchWidthIn(gauge) + rowHeightIn(gauge)) / 2
  return Math.max(1, Math.round(inches / perRound))
}

/**
 * The distance a stitch makes the yarn travel: once across its width, and up and back
 * down its post.
 *
 * A stitch is not a dot, and how TALL it is matters as much as how wide. A double
 * crochet post is two and a half times the height of a single crochet one and swallows
 * yarn accordingly, which is the whole reason a double crochet blanket of the same size
 * is a different shopping list.
 */
export function stitchSpanIn(gauge) {
  return stitchWidthIn(gauge) + 2 * rowHeightIn(gauge)
}

/**
 * Rough yarn needed for one colour, in yards.
 *
 * The multiplier is yarn length per stitch expressed in stitch SPANS — see above. It
 * used to be expressed in stitch widths alone, which meant the estimate could not tell
 * a double crochet stitch from a corner-to-corner one: identical widths, wildly
 * different heights, and the same answer for both. Height was simply absent from the
 * arithmetic, so the taller the stitch, the further short the estimate fell.
 *
 * The scale is anchored where it has always been. This constant is chosen so single
 * crochet — the default gauge, and the one the old number was pitched at — comes out
 * exactly as before; what changes is that the other stitches now move away from it, in
 * the right direction and roughly the right amount.
 *
 * It is still a model and not a measurement. Real consumption varies with tension, hook
 * and how you carry colours more than any formula can predict, which is why the UI says
 * "rough, buy 20% more" rather than printing a confident number nobody should trust —
 * and why a wrong shape in the model is worth fixing even though the number stays rough.
 */
export const YARN_PER_STITCH = 1.98

export function yardsFor(cells, gauge) {
  return (cells * stitchSpanIn(gauge) * YARN_PER_STITCH) / 36
}
