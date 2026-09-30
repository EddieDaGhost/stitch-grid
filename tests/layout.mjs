/**
 * Geometry. No colours, no pixels — just where every cell comes from.
 */

import {
  FULL_FRAME,
  MIN_CROP,
  cellRectToSource,
  computeLayout,
  coverSample,
  detailWasClamped,
  dragCrop,
  gridAspect,
  inBorder,
  inImage,
  isFullFrame,
  normalizeCrop,
  refocusTarget,
  relativeCrop,
  squareCrop,
  stitchesForDetail,
} from '../src/lib/layout.js'
import { rowsForAspect } from '../src/lib/gauge.js'
import { settings } from './fixtures.mjs'

const SC = { stitchesPer4: 16, rowsPer4: 18, unit: 'in' }
const DC = { stitchesPer4: 12, rowsPer4: 7, unit: 'in' }

export default async function run({ check }) {
  // --- the detail slider
  check.is('800px wide at 16px blocks is 50 stitches', stitchesForDetail(16, 800), 50)
  check.is('the same picture at 8px blocks is 100 stitches', stitchesForDetail(8, 800), 100)
  check.is('a huge picture is clamped, not obeyed', stitchesForDetail(5, 4000), 250)
  check('and the clamp is reported so the UI can say so', detailWasClamped(5, 4000))
  check('a normal request is not reported as clamped', !detailWasClamped(16, 800))
  check('never fewer than 2 stitches', stitchesForDetail(50, 10) >= 2)

  // --- no border, no target: the chart IS the picture
  const plain = computeLayout(settings({ gauge: SC, detailPx: 16 }), 1.0, 800)
  check.is('plain layout width', plain.stitches, 50)
  check.is('plain layout height comes from gauge, not pixels', plain.rows, 56)
  check.is('the picture starts at the origin', `${plain.image.x},${plain.image.y}`, '0,0')
  check.is('the picture fills the chart', `${plain.image.w},${plain.image.h}`, '50,56')
  check('nothing is padded', !plain.padded)

  // The same picture in double crochet is a completely different chart.
  const dc = computeLayout(settings({ gauge: DC, detailPx: 16 }), 1.0, 800)
  check.is('the same picture in double crochet', dc.rows, 29)
  check('double crochet needs far fewer rows for the same picture', dc.rows < plain.rows)

  // --- border
  const bordered = computeLayout(settings({ gauge: SC, detailPx: 16, border: { inches: 2, colorId: 'cream' } }), 1.0, 800)
  check.is('a 2 inch border is 8 stitches per side', bordered.border.sts, 8)
  check.is('a 2 inch border is 9 rows per side', bordered.border.rows, 9)
  check.is('the border widens the chart by both sides', bordered.stitches, 50 + 16)
  check.is('the border heightens the chart by both sides', bordered.rows, 56 + 18)
  check.is('the picture keeps its own size', `${bordered.image.w},${bordered.image.h}`, '50,56')
  check.is('the picture is inset by the border', `${bordered.image.x},${bordered.image.y}`, '8,9')
  check('the border band is border', inBorder(bordered, 0, 0))
  check('the middle is not border', !inBorder(bordered, 33, 37))
  check('the middle is in the picture', inImage(bordered, 33, 37))

  // --- target + contain
  const contain = computeLayout(
    settings({ gauge: SC, detailPx: 16, target: { stitches: 100, rows: 100 }, fit: 'contain' }),
    2.0,
    800,
  )
  check.is('a target sets the chart size exactly', `${contain.stitches},${contain.rows}`, '100,100')
  check.is('a wide picture fills the width', contain.image.w, 100)
  check.is('and takes the rows its shape needs', contain.image.h, 56)
  check('the leftover is padding', contain.padded)
  check.is('padding is centred', contain.image.x, 0)
  // The odd leftover cell always goes to the bottom. An unspecified tie-break makes
  // this suite flap depending on rounding.
  check.is('the odd leftover row goes to the bottom', contain.image.y, Math.floor((100 - 56) / 2))

  // A picture taller than the target flips to height-constrained.
  const tall = computeLayout(
    settings({ gauge: SC, detailPx: 16, target: { stitches: 100, rows: 40 }, fit: 'contain' }),
    0.5,
    800,
  )
  check('a tall picture is limited by rows, not stitches', tall.image.h <= 40 && tall.image.w < 100)
  check('and is padded left and right instead', tall.image.x > 0)

  // --- target + stretch
  const stretch = computeLayout(
    settings({ gauge: SC, detailPx: 16, target: { stitches: 100, rows: 100 }, fit: 'stretch' }),
    2.0,
    800,
  )
  check.is('stretch fills the grid exactly', `${stretch.image.w},${stretch.image.h}`, '100,100')
  check('stretch pads nothing', !stretch.padded)
  check('stretch says so', stretch.stretched)

  // --- cells tile the source with no gap and no overlap
  const layout = computeLayout(settings({ gauge: SC, detailPx: 20 }), 1.3, 640)
  let seamsAlign = true
  for (let y = layout.image.y; y < layout.image.y + layout.image.h; y++) {
    for (let x = layout.image.x; x < layout.image.x + layout.image.w - 1; x++) {
      const here = cellRectToSource(layout, x, y)
      const next = cellRectToSource(layout, x + 1, y)
      if (Math.abs(here.u1 - next.u0) > 1e-12) seamsAlign = false
    }
  }
  check('horizontal cell seams line up exactly', seamsAlign)

  let vSeamsAlign = true
  for (let y = layout.image.y; y < layout.image.y + layout.image.h - 1; y++) {
    const here = cellRectToSource(layout, layout.image.x, y)
    const below = cellRectToSource(layout, layout.image.x, y + 1)
    if (Math.abs(here.v1 - below.v0) > 1e-12) vSeamsAlign = false
  }
  check('vertical cell seams line up exactly', vSeamsAlign)

  const first = cellRectToSource(layout, layout.image.x, layout.image.y)
  const last = cellRectToSource(
    layout,
    layout.image.x + layout.image.w - 1,
    layout.image.y + layout.image.h - 1,
  )
  check.near('the first cell starts at the left edge of the source', first.u0, 0, 1e-12)
  check.near('the last cell ends at the right edge of the source', last.u1, 1, 1e-12)
  check.near('the first cell starts at the top of the source', first.v0, 0, 1e-12)
  check.near('the last cell ends at the bottom of the source', last.v1, 1, 1e-12)
  // --- the crop ------------------------------------------------------------
  //
  // A crop is a remap of the normalised coordinates every cell already reports, so the
  // thing to guard is that the remap composes: cells must still tile exactly, must stay
  // inside the crop, and must reach both its edges.

  check.is('a missing crop is the whole picture', JSON.stringify(normalizeCrop(undefined)), JSON.stringify(FULL_FRAME))
  check.is('so is junk', JSON.stringify(normalizeCrop({ x: 'a', y: null, w: NaN, h: undefined })), JSON.stringify(FULL_FRAME))
  check('the whole picture reports as full frame', isFullFrame(FULL_FRAME))
  check('a real crop does not', !isFullFrame({ x: 0.1, y: 0, w: 0.5, h: 1 }))

  const tiny = normalizeCrop({ x: 0.5, y: 0.5, w: 0.0001, h: 0 })
  check.is('a crop cannot be smaller than the floor, on width', tiny.w, MIN_CROP)
  check.is('nor on height', tiny.h, MIN_CROP)

  const escaped = normalizeCrop({ x: 0.9, y: 0.95, w: 0.5, h: 0.5 })
  check.near('a crop dragged off the right slides back in', escaped.x, 0.5, 1e-12)
  check.near('and off the bottom too', escaped.y, 0.5, 1e-12)
  check.near('keeping the size it was dragged to', escaped.w, 0.5, 1e-12)
  const negative = normalizeCrop({ x: -3, y: -3, w: 0.4, h: 0.4 })
  check.is('a negative origin clamps to the corner', `${negative.x},${negative.y}`, '0,0')
  const tooBig = normalizeCrop({ x: 0, y: 0, w: 5, h: 5 })
  check.is('an oversized crop clamps to the frame', `${tooBig.w},${tooBig.h}`, '1,1')

  // Detail is pixels per stitch, so half the width is half the stitches — cropping must
  // not quietly double the resolution of what is left.
  const uncropped = computeLayout(settings({ gauge: SC, detailPx: 16 }), 1.0, 800)
  const halfWide = computeLayout(
    settings({ gauge: SC, detailPx: 16, crop: { x: 0.25, y: 0, w: 0.5, h: 1 } }),
    1.0,
    800,
  )
  check.is('cropping to half the width halves the stitch count', halfWide.stitches, uncropped.stitches / 2)
  check('and the crop is reported', halfWide.cropped)
  check('while an uncropped layout is not', !uncropped.cropped)

  // A crop changes the picture's SHAPE, so it must change the row count through gauge.
  check.is(
    'a half-width crop of a square photo is a 1:2 picture, and gauge says so',
    halfWide.rows,
    rowsForAspect(halfWide.image.w, 0.5, SC),
  )
  const halfTall = computeLayout(
    settings({ gauge: SC, detailPx: 16, crop: { x: 0, y: 0.25, w: 1, h: 0.5 } }),
    1.0,
    800,
  )
  check.is('cropping the height leaves the stitch count alone', halfTall.stitches, uncropped.stitches)
  check('but halves the rows, near enough', Math.abs(halfTall.rows - uncropped.rows / 2) <= 1, `${halfTall.rows} vs ${uncropped.rows}`)

  // --- a cropped chart still tiles its crop exactly
  const cropRect = { x: 0.2, y: 0.1, w: 0.55, h: 0.7 }
  const cropped = computeLayout(settings({ gauge: SC, detailPx: 20, crop: cropRect }), 1.4, 800)

  let cropSeams = true
  let insideCrop = true
  for (let y = cropped.image.y; y < cropped.image.y + cropped.image.h; y++) {
    for (let x = cropped.image.x; x < cropped.image.x + cropped.image.w; x++) {
      const cell = cellRectToSource(cropped, x, y)
      if (
        cell.u0 < cropRect.x - 1e-9 ||
        cell.u1 > cropRect.x + cropRect.w + 1e-9 ||
        cell.v0 < cropRect.y - 1e-9 ||
        cell.v1 > cropRect.y + cropRect.h + 1e-9
      ) {
        insideCrop = false
      }
      if (x < cropped.image.x + cropped.image.w - 1) {
        const next = cellRectToSource(cropped, x + 1, y)
        if (Math.abs(cell.u1 - next.u0) > 1e-12) cropSeams = false
      }
    }
  }
  check('no cell of a cropped chart reads outside the crop', insideCrop)
  check('and the cells still tile with no seam', cropSeams)

  const cropFirst = cellRectToSource(cropped, cropped.image.x, cropped.image.y)
  const cropLast = cellRectToSource(
    cropped,
    cropped.image.x + cropped.image.w - 1,
    cropped.image.y + cropped.image.h - 1,
  )
  check.near('the first cell starts at the left edge of the CROP', cropFirst.u0, cropRect.x, 1e-12)
  check.near('the last cell ends at its right edge', cropLast.u1, cropRect.x + cropRect.w, 1e-12)
  check.near('the first cell starts at the top of the crop', cropFirst.v0, cropRect.y, 1e-12)
  check.near('the last cell ends at its bottom', cropLast.v1, cropRect.y + cropRect.h, 1e-12)

  // --- fill the grid by cropping, rather than by distorting
  check.near(
    'gridAspect inverts rowsForAspect',
    rowsForAspect(100, gridAspect(100, 60, SC), SC),
    60,
    1,
  )

  const target = { stitches: 100, rows: 60 }
  const coverLayout = computeLayout(settings({ gauge: SC, detailPx: 16, target, fit: 'cover' }), 1.0, 800)
  const stretchLayout = computeLayout(settings({ gauge: SC, detailPx: 16, target, fit: 'stretch' }), 1.0, 800)

  check.is('cover fills the grid exactly, like stretch', `${coverLayout.image.w},${coverLayout.image.h}`, '100,60')
  check('cover leaves nothing padded', !coverLayout.padded)
  check('and is not marked as stretched', !coverLayout.stretched)
  check('but it IS cropping something away', coverLayout.cropped)

  // The whole point: the sampled patch has the grid's shape, so nothing is squashed.
  const sampledAspect = (sample, sourceAspect) =>
    (sourceAspect * (sample.u1 - sample.u0)) / (sample.v1 - sample.v0)
  check.near(
    'cover samples a patch shaped exactly like the grid, so a circle stays a circle',
    sampledAspect(coverLayout.sample, 1.0),
    gridAspect(100, 60, SC),
    1e-9,
  )
  check(
    'stretch, by contrast, samples the whole frame and squashes it',
    Math.abs(sampledAspect(stretchLayout.sample, 1.0) - gridAspect(100, 60, SC)) > 0.1,
  )

  // Cover may trim the user's crop further, but must never reach outside it.
  const coverOnCrop = computeLayout(
    settings({ gauge: SC, detailPx: 16, target, fit: 'cover', crop: cropRect }),
    1.4,
    800,
  )
  check(
    'filling the grid never samples outside the crop you chose',
    coverOnCrop.sample.u0 >= cropRect.x - 1e-9 &&
      coverOnCrop.sample.u1 <= cropRect.x + cropRect.w + 1e-9 &&
      coverOnCrop.sample.v0 >= cropRect.y - 1e-9 &&
      coverOnCrop.sample.v1 <= cropRect.y + cropRect.h + 1e-9,
  )
  check(
    'and it keeps one axis of the crop whole, trimming only the other',
    Math.abs(coverOnCrop.sample.u1 - coverOnCrop.sample.u0 - cropRect.w) < 1e-9 ||
      Math.abs(coverOnCrop.sample.v1 - coverOnCrop.sample.v0 - cropRect.h) < 1e-9,
  )

  // Both ways round: a crop wider than the grid trims the sides, taller trims top and bottom.
  const wideIntoTall = coverSample(FULL_FRAME, 2.0, 0.5)
  check('a wide photo into a tall grid loses its sides', wideIntoTall.u1 - wideIntoTall.u0 < 1)
  check('and keeps its full height', Math.abs(wideIntoTall.v1 - wideIntoTall.v0 - 1) < 1e-9)
  const tallIntoWide = coverSample(FULL_FRAME, 0.5, 2.0)
  check('a tall photo into a wide grid loses its top and bottom', tallIntoWide.v1 - tallIntoWide.v0 < 1)
  check('and keeps its full width', Math.abs(tallIntoWide.u1 - tallIntoWide.u0 - 1) < 1e-9)
  const exact = coverSample(FULL_FRAME, 1.5, 1.5)
  check(
    'a photo already the right shape is not trimmed at all',
    Math.abs(exact.u1 - exact.u0 - 1) < 1e-9 && Math.abs(exact.v1 - exact.v0 - 1) < 1e-9,
  )
  check(
    'cover always centres what it keeps',
    Math.abs(wideIntoTall.u0 - (1 - (wideIntoTall.u1 - wideIntoTall.u0)) / 2) < 1e-9,
  )

  // --- a crop composes with a border rather than fighting it
  const croppedBorder = computeLayout(
    settings({ gauge: SC, detailPx: 16, crop: { x: 0, y: 0, w: 0.5, h: 1 }, border: { inches: 2, colorId: 'cream' } }),
    1.0,
    800,
  )
  check.is('a border still sits outside a cropped picture', croppedBorder.border.sts, 8)
  check.is('and the picture is the cropped size, inset', `${croppedBorder.image.x},${croppedBorder.image.w}`, '8,25')
  check(
    'border cells are still border on a cropped chart',
    inBorder(croppedBorder, 0, 0) && !inBorder(croppedBorder, croppedBorder.stitches >> 1, croppedBorder.rows >> 1),
  )
  // --- dragging the crop frame
  const half = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }

  const moved = dragCrop('move', half, 0.1, -0.1)
  check.is('dragging the frame moves it', `${moved.x.toFixed(2)},${moved.y.toFixed(2)}`, '0.35,0.15')
  check.is('without resizing it', `${moved.w},${moved.h}`, '0.5,0.5')

  const shoved = dragCrop('move', half, 5, 5)
  check.is('shoving it off the edge parks it against the edge', `${shoved.x},${shoved.y}`, '0.5,0.5')
  check.is('still the same size', `${shoved.w},${shoved.h}`, '0.5,0.5')

  // Resizing must anchor the edge you are not holding.
  const pulledWest = dragCrop('nw', half, -0.1, 0)
  check.near('dragging the left handle left grows the crop', pulledWest.w, 0.6, 1e-9)
  check.near('and moves only the left edge', pulledWest.x, 0.15, 1e-9)
  check.near('the right edge stays put', pulledWest.x + pulledWest.w, half.x + half.w, 1e-9)

  const pulledEast = dragCrop('se', half, 0.2, 0.1)
  check.near('dragging the bottom-right handle grows both axes', pulledEast.w, 0.7, 1e-9)
  check.near('and the top-left corner does not move', pulledEast.x + pulledEast.y, half.x + half.y, 1e-9)

  const inverted = dragCrop('nw', half, 5, 5)
  check(
    'dragging a handle past the opposite edge stops rather than inverting',
    inverted.w >= MIN_CROP && inverted.h >= MIN_CROP,
    `${inverted.w}x${inverted.h}`,
  )
  check.near('parking exactly at the minimum', inverted.w, MIN_CROP, 1e-9)
  check.near('with the anchored edge still where it was', inverted.x + inverted.w, half.x + half.w, 1e-9)

  const overEdge = dragCrop('nw', half, -5, -5)
  check.is('and dragging a handle off the photo stops at the photo', `${overEdge.x},${overEdge.y}`, '0,0')

  // --- square preset
  const wideSquare = squareCrop(2)
  check.near('a square crop of a wide photo is half its width', wideSquare.w, 0.5, 1e-9)
  check.near('all of its height', wideSquare.h, 1, 1e-9)
  check.near('and centred', wideSquare.x, 0.25, 1e-9)
  const tallSquare = squareCrop(0.5)
  check.near('a square crop of a tall photo is half its height', tallSquare.h, 0.5, 1e-9)
  check.near('and all of its width', tallSquare.w, 1, 1e-9)
  check('a square photo needs no square crop', isFullFrame(squareCrop(1)))

  // A square crop really is square, measured where it counts — in pixels.
  const squared = computeLayout(settings({ gauge: SC, detailPx: 16, crop: squareCrop(2) }), 2, 1600)
  check.is(
    'a square crop makes a chart with the gauge ratio, exactly as a square photo would',
    squared.rows,
    rowsForAspect(squared.image.w, 1, SC),
  )

  // --- the working copy's own coordinates
  //
  // The crop is a rectangle on the whole photo; the pixels are a rectangle on the whole
  // photo too, but not the same one. Getting this mapping wrong does not throw — it
  // charts the wrong part of the picture, or the right part at the wrong shape.
  const view = { x: 0.2, y: 0.1, w: 0.4, h: 0.5 }
  check.is(
    'against the whole frame, a crop is itself',
    JSON.stringify(relativeCrop({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, FULL_FRAME)),
    JSON.stringify({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }),
  )
  const inside = relativeCrop({ x: 0.3, y: 0.2, w: 0.2, h: 0.25 }, view)
  check.near('a crop inside the view is offset by it', inside.x, 0.25, 1e-9)
  check.near('on both axes', inside.y, 0.2, 1e-9)
  check.near('and scaled by it', inside.w, 0.5, 1e-9)
  check.near('on both axes', inside.h, 0.5, 1e-9)
  const sameRect = relativeCrop(view, view)
  check('a crop the view was built for fills it', isFullFrame(sameRect))
  const overhang = relativeCrop({ x: 0, y: 0, w: 1, h: 1 }, view)
  check('a crop wider than the view clamps to the view', isFullFrame(overhang))
  const partial = relativeCrop({ x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, view)
  check.near('a crop hanging off the left is intersected, not shifted', partial.x, 0, 1e-9)
  check.near('and keeps only the overlap', partial.w, 0.75, 1e-9)

  /*
    The invariant that matters: a rebuilt working copy must not change the chart's SHAPE.

    Every number the user sees — the stitch count, the row count, the finished size —
    must come out identical whether the pixels underneath happen to cover the whole photo
    or just the crop. If it does not, tightening the framing silently resizes a blanket
    somebody is about to spend forty hours on, and nothing anywhere throws.
  */
  const cropRect2 = { x: 0.2, y: 0.15, w: 0.4, h: 0.5 }
  const wide = settings({ gauge: SC, detailPx: 12, crop: cropRect2 })
  const beforeRefocus = computeLayout(wide, 1.5, 1024, FULL_FRAME)
  const afterRefocus = computeLayout(wide, 1.5, 1024, cropRect2)
  check.is('refocusing does not change the stitch count', afterRefocus.stitches, beforeRefocus.stitches)
  check.is('nor the row count', afterRefocus.rows, beforeRefocus.rows)
  check('a refocused chart still reports itself as cropped', afterRefocus.cropped)
  check.is(
    'and the cells still come from the same place on the photo',
    JSON.stringify(afterRefocus.sample),
    JSON.stringify({ u0: 0, v0: 0, u1: 1, v1: 1 }),
  )

  // Under the refocused view the sample is the whole raster, and the raster is the crop —
  // so mapping a cell through both must land in the same patch of the ORIGINAL photo.
  const toSource = (layout, v, x, y) => {
    const r = cellRectToSource(layout, x, y)
    return { u0: v.x + r.u0 * v.w, v0: v.y + r.v0 * v.h, u1: v.x + r.u1 * v.w, v1: v.y + r.v1 * v.h }
  }
  let worstDrift = 0
  for (let y = afterRefocus.image.y; y < afterRefocus.image.y + afterRefocus.image.h; y += 7) {
    for (let x = afterRefocus.image.x; x < afterRefocus.image.x + afterRefocus.image.w; x += 7) {
      const a = toSource(beforeRefocus, FULL_FRAME, x, y)
      const b = toSource(afterRefocus, cropRect2, x, y)
      for (const k of ['u0', 'v0', 'u1', 'v1']) worstDrift = Math.max(worstDrift, Math.abs(a[k] - b[k]))
    }
  }
  check('every cell reads the same patch of the original photo either way', worstDrift < 1e-9, worstDrift)

  // The same must hold for "fill the grid", which narrows the sample a second time.
  const covered = settings({ gauge: SC, detailPx: 12, crop: cropRect2, target: { stitches: 90, rows: 70 }, fit: 'cover' })
  const coverFull = computeLayout(covered, 1.5, 1024, FULL_FRAME)
  const coverView = computeLayout(covered, 1.5, 1024, cropRect2)
  check.is('cover keeps its stitch count across a refocus', coverView.stitches, coverFull.stitches)
  const cf = toSource(coverFull, FULL_FRAME, coverFull.image.x, coverFull.image.y)
  const cv = toSource(coverView, cropRect2, coverView.image.x, coverView.image.y)
  check.near('and trims to the same rectangle of the photo', cv.u0, cf.u0, 1e-9)
  check.near('on both axes', cv.v0, cf.v0, 1e-9)

  // --- when a rebuild is worth doing
  const big = { width: 4000, height: 3000, maxEdge: 1024 }
  const quarter = { x: 0.3, y: 0.3, w: 0.25, h: 0.25 }
  const firstTarget = refocusTarget(quarter, FULL_FRAME, big)
  check('a quarter-width crop of a big photo is worth rebuilding for', firstTarget !== null)
  check('the target covers the crop', firstTarget.x <= quarter.x && firstTarget.w >= quarter.w)
  check('with a margin, so a nudge does not redo it', firstTarget.w > quarter.w)
  check(
    'and the margin is slack, not a new crop',
    firstTarget.w < quarter.w * 1.5,
    firstTarget.w,
  )
  check.is('asking again for what was just built is a no-op', refocusTarget(quarter, firstTarget, big), null)
  check.is(
    'and so is a small nudge inside the margin',
    refocusTarget({ ...quarter, x: quarter.x + 0.005 }, firstTarget, big),
    null,
  )
  check(
    'but widening past the pixels on hand is a correction, not an optimisation',
    refocusTarget(FULL_FRAME, firstTarget, big) !== null,
  )
  check.is('a full-frame crop on a full-frame view needs nothing', refocusTarget(FULL_FRAME, FULL_FRAME, big), null)

  // A photo smaller than the budget has no detail left to recover, so a rebuild is pure
  // cost. Without this the app would re-decode a phone screenshot on every drag.
  const small = { width: 600, height: 400, maxEdge: 1024 }
  check.is('a small photo is never rebuilt for sharpness', refocusTarget(quarter, FULL_FRAME, small), null)
  check(
    'though a crop it does not hold is still honoured',
    refocusTarget({ x: 0, y: 0, w: 1, h: 1 }, { x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, small) !== null,
  )

  // Repeatedly refocusing must converge, or the app decodes the photo forever.
  let settle = FULL_FRAME
  let steps = 0
  for (; steps < 10; steps += 1) {
    const next = refocusTarget(quarter, settle, big)
    if (!next) break
    settle = next
  }
  check('refocusing settles', steps < 10, `${steps} rebuilds`)
  check('and it settles in one step', steps <= 1, `${steps} rebuilds`)
}
