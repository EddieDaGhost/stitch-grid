/**
 * Geometry: settings + the source picture's proportions -> where every cell comes from.
 *
 * This module never sees a colour and never touches a pixel. That's deliberate — the
 * gauge arithmetic is the part most likely to be wrong and the part easiest to get
 * wrong silently, so it gets a suite that can prove "a 2:1 photo in double crochet is
 * N rows" without constructing a single image.
 *
 * Order of operations is load-bearing. Four things want to change the grid and they
 * compose in exactly one order:
 *
 *   A. the crop                   (which part of the photo is the picture at all)
 *   B. how many stitches across   (the detail slider, horizontal only)
 *   C. how many rows              (from gauge, never from the image's pixel height)
 *   D. the border                 (added AROUND the picture, never scaling it)
 *   E. the target grid            (padding, cropping or stretching to a size typed)
 *
 * The crop comes first because everything after it is a question about the CROPPED
 * picture: its aspect, how many stitches its width is worth, how it fills a grid. It
 * costs nothing at chart-build time — a crop is a remap of the normalised coordinates
 * `cellRectToSource` already returns, so no pixel is read twice and nothing is copied.
 */

import { MAX_ROWS, MAX_STITCHES, MIN_STITCHES } from '../config/gauge.js'
import { inchesToRows, inchesToStitches, rowsForAspect, stitchesForRows } from './gauge.js'

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** The whole photo, which is what you get until you say otherwise. */
export const FULL_FRAME = { x: 0, y: 0, w: 1, h: 1 }

/**
 * The smallest crop allowed, as a fraction of each axis.
 *
 * The working copy is rebuilt to cover the crop, so this is no longer about the budget —
 * a 5% crop now gets the full 1024px, not a 51px strip of it. What is left is the photo
 * itself: below about a twentieth of the frame you are charting JPEG blocks and sensor
 * noise rather than the subject, and no amount of resolution makes those into yarn.
 * It also keeps four drag handles from landing on top of each other.
 */
export const MIN_CROP = 0.05

/**
 * Clamp a crop into the frame. Never throws.
 *
 * Width and height are settled before x and y, because a crop that hangs off the edge
 * should slide back into view rather than silently shrink — dragging a frame past the
 * corner of a photo is an ordinary thing to do with a finger.
 */
export function normalizeCrop(raw) {
  const c = raw && typeof raw === 'object' ? raw : FULL_FRAME
  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback)
  const w = clamp(num(c.w, 1), MIN_CROP, 1)
  const h = clamp(num(c.h, 1), MIN_CROP, 1)
  return {
    x: clamp(num(c.x, 0), 0, 1 - w),
    y: clamp(num(c.y, 0), 0, 1 - h),
    w,
    h,
  }
}

/** True when the crop is the whole picture, to within rounding. */
export function isFullFrame(crop) {
  const c = normalizeCrop(crop)
  return c.x < 1e-9 && c.y < 1e-9 && c.w > 1 - 1e-9 && c.h > 1 - 1e-9
}

/**
 * Re-express a crop given in WHOLE-PICTURE coordinates against a working copy that only
 * covers `view` of the picture.
 *
 * The working copy is not always the whole photo. Once the framing settles, the pixels
 * get rebuilt to cover just the part being charted, so the resolution budget is spent
 * where it shows — but the crop the user dragged is still a rectangle on the whole photo,
 * and must stay that way: it is what the framing panel draws, what undo restores and what
 * gets saved. This is the one place the two coordinate systems meet.
 *
 * With `view` the full frame it is the identity, which is why nothing else had to change.
 *
 * The two are intersected rather than merely offset, because they go out of step for a
 * moment every time the framing widens: the crop updates on the drag and the pixels are
 * rebuilt afterwards, so in between the crop asks for picture the working copy does not
 * hold. Clamping charts a slightly tight frame for one rebuild; not clamping would
 * sample past the edge of the raster and smear its border pixels across the difference.
 */
export function relativeCrop(crop, view) {
  const c = normalizeCrop(crop)
  const v = normalizeCrop(view)
  const x0 = Math.max(c.x, v.x)
  const y0 = Math.max(c.y, v.y)
  const x1 = Math.min(c.x + c.w, v.x + v.w)
  const y1 = Math.min(c.y + c.h, v.y + v.h)
  // Disjoint is only reachable mid-rebuild, and only if the crop jumped clean across the
  // picture. The whole working copy is the honest answer for the one frame it lasts.
  if (!(x1 > x0) || !(y1 > y0)) return { ...FULL_FRAME }
  return normalizeCrop({
    x: (x0 - v.x) / v.w,
    y: (y0 - v.y) / v.h,
    w: (x1 - x0) / v.w,
    h: (y1 - y0) / v.h,
  })
}

/**
 * How much slack to leave around the crop when the working copy is rebuilt, as a fraction
 * of the crop. Nudging a frame a couple of percent is the most ordinary thing anyone does
 * in this panel, and without a margin every nudge would re-decode the photo.
 */
export const REFOCUS_MARGIN = 0.08

/**
 * How much sharper a rebuild has to make the working copy before it is worth doing.
 *
 * 1.25 is a quarter more pixels along the tighter axis — visible in the chart, since a
 * stitch is an average of a few dozen pixels and a quarter more of them is a different
 * average. Lower and the photo is re-decoded for changes nobody could see; higher and a
 * moderate crop stays soft.
 */
export const REFOCUS_GAIN = 1.25

/**
 * The region the working copy SHOULD cover for this crop, or null if rebuilding it would
 * not buy anything.
 *
 * The resolution budget used to be spent on the whole photo before the crop existed, which
 * is exactly backwards: the crop is the statement of which pixels matter. A quarter-width
 * crop of a 4000px photo was charted from a 256px strip of a 1024px copy — three quarters
 * of the detail the photographer captured, discarded before anyone had said which quarter
 * of the frame was the subject, and no setting anywhere could get it back.
 *
 * Pure, so the awkward parts are provable in bare Node: that it says no to a rebuild it
 * has just done (or the app re-decodes the photo forever), and that it says no on a small
 * photo, where the copy is already every pixel there is and a rebuild cannot add one.
 *
 * @param crop The user's framing, in whole-picture coordinates.
 * @param view What the working copy covers now.
 * @param source `{ width, height }` of the ORIGINAL picture, and the `maxEdge` budget.
 */
export function refocusTarget(crop, view, source, options = {}) {
  const margin = Number.isFinite(options.margin) ? options.margin : REFOCUS_MARGIN
  const gain = Number.isFinite(options.gain) ? options.gain : REFOCUS_GAIN
  const c = normalizeCrop(crop)
  const v = normalizeCrop(view)
  const px = Math.max(1, Number(source?.width) || 1)
  const py = Math.max(1, Number(source?.height) || 1)
  const maxEdge = Math.max(1, Number(source?.maxEdge) || 1)

  const padX = c.w * margin
  const padY = c.h * margin
  const target = normalizeCrop({
    x: c.x - padX,
    y: c.y - padY,
    w: c.w + padX * 2,
    h: c.h + padY * 2,
  })

  // Widening the frame past what the copy holds is not an optimisation, it is a
  // correction: `relativeCrop` is clamping the chart to the pixels that exist.
  const holds =
    v.x <= c.x + 1e-9 &&
    v.y <= c.y + 1e-9 &&
    v.x + v.w >= c.x + c.w - 1e-9 &&
    v.y + v.h >= c.y + c.h - 1e-9

  /*
    Pixels of working copy per pixel of original, which is the thing that actually gets
    better. Comparing the regions' sizes instead would be wrong twice: it ignores which
    axis the long-edge cap is binding on, and it promises a gain on a small photo where
    the ratio is already 1 and clamped — so a 600px snapshot would be re-decoded on every
    nudge of the frame, for pixels that do not exist.
  */
  const resolution = (r) => Math.min(1, maxEdge / Math.max(r.w * px, r.h * py))
  const sharper = resolution(target) >= resolution(v) * gain

  return holds && !sharper ? null : target
}

/**
 * The picture aspect that would exactly fill a grid of this size at this gauge, with no
 * distortion. The inverse of `rowsForAspect`, solved for the aspect.
 */
export function gridAspect(stitches, rows, gauge) {
  return (stitches * gauge.rowsPer4) / (gauge.stitchesPer4 * Math.max(1, rows))
}

/**
 * The largest sub-rectangle of `crop` whose shape fills the grid without distorting.
 *
 * This is what "fill the grid" ought to have meant all along. Stretching to fit turns
 * every circle in the picture into an oval, which is the exact failure this whole app
 * exists to prevent on the fabric side — so doing it to the picture on the way in is a
 * strange thing to offer as the only way to fill a grid. Cropping loses the edges
 * instead, and the edges are usually what you wanted gone.
 */
export function coverSample(crop, sourceAspect, wantAspect) {
  const c = normalizeCrop(crop)
  const safeSource = sourceAspect > 0 ? sourceAspect : 1
  const want = wantAspect > 0 ? wantAspect : 1
  const cropAspect = safeSource * (c.w / c.h)

  let w = c.w
  let h = c.h
  if (want <= cropAspect) w = Math.min(c.w, (c.h * want) / safeSource)
  else h = Math.min(c.h, (c.w * safeSource) / want)

  return {
    u0: c.x + (c.w - w) / 2,
    v0: c.y + (c.h - h) / 2,
    u1: c.x + (c.w + w) / 2,
    v1: c.y + (c.h + h) / 2,
  }
}

/**
 * Move or resize a crop by a drag, in normalised units.
 *
 * Pure, so the panel that owns the pointer events owns nothing else — and so the thing
 * most likely to be subtly wrong (which edge is anchored when you drag the opposite
 * one) is testable without a browser.
 *
 * Resizing anchors the edge you are NOT holding. Dragging the left handle past the
 * right edge stops at the minimum rather than turning the rectangle inside out, and
 * dragging past the edge of the photo stops at the photo.
 */
export function dragCrop(mode, crop, dx, dy) {
  const c = normalizeCrop(crop)
  if (mode === 'move') return normalizeCrop({ ...c, x: c.x + dx, y: c.y + dy })

  let { x, y, w, h } = c
  const right = x + w
  const bottom = y + h

  if (mode.includes('w')) {
    x = clamp(x + dx, 0, right - MIN_CROP)
    w = right - x
  }
  if (mode.includes('e')) {
    w = clamp(right + dx, x + MIN_CROP, 1) - x
  }
  if (mode.includes('n')) {
    y = clamp(y + dy, 0, bottom - MIN_CROP)
    h = bottom - y
  }
  if (mode.includes('s')) {
    h = clamp(bottom + dy, y + MIN_CROP, 1) - y
  }

  return normalizeCrop({ x, y, w, h })
}

/** The largest centred crop that is square IN PIXELS, not in fractions of the frame. */
export function squareCrop(sourceAspect) {
  const s = coverSample(FULL_FRAME, sourceAspect, 1)
  return { x: s.u0, y: s.v0, w: s.u1 - s.u0, h: s.v1 - s.v0 }
}

/**
 * The detail slider maps source pixels per block to a stitch count.
 *
 * The slider is spec'd in pixels and labelled "Detail", but the number that matters to
 * the user is the stitch count underneath it — nobody planning a blanket thinks in
 * source pixels. Clamped hard: 5px blocks on a 4000px photo would be 800 stitches,
 * which at worsted gauge is a sixteen foot blanket.
 */
export function stitchesForDetail(detailPx, sourceWidthPx) {
  const raw = Math.round(sourceWidthPx / Math.max(1, detailPx))
  return clamp(raw, MIN_STITCHES, MAX_STITCHES)
}

/** True when the requested detail was clipped, so the UI can say so out loud. */
export function detailWasClamped(detailPx, sourceWidthPx) {
  return Math.round(sourceWidthPx / Math.max(1, detailPx)) > MAX_STITCHES
}

/**
 * @typedef {{
 *   stitches: number, rows: number,
 *   border: { sts: number, rows: number },
 *   image:  { x: number, y: number, w: number, h: number },
 *   crop:   { x: number, y: number, w: number, h: number },
 *   sample: { u0: number, v0: number, u1: number, v1: number },
 *   stretched: boolean, padded: boolean, cropped: boolean, clamped: boolean,
 * }} Layout
 *
 * `image` is where the picture sits in CELLS. `sample` is the patch of the source it
 * comes from, in normalised 0..1 coordinates — the user's crop, narrowed further if
 * "fill the grid" had to trim it. Keeping them apart is what lets one composed
 * rectangle answer every "where does this cell come from" question.
 *
 * `crop` and `sample` are both in WORKING-COPY coordinates, because the sampler indexes
 * the working copy. On a full-frame view they are also whole-picture coordinates; once
 * the view narrows they are not, and `settings.crop` remains the whole-picture version.
 */

/**
 * @param {object} settings
 * @param {number} sourceAspect Aspect of the WHOLE picture, however much of it is loaded.
 * @param {number} sourceWidthPx Width a FULL-FRAME working copy would have, in pixels.
 *   Not the raster's own width: the raster gets sharper as the framing tightens, and a
 *   stitch count read off it would mean the blanket changed size when you cropped.
 * @param {{x,y,w,h}} [view] Which part of the picture the working copy actually holds.
 * @returns {Layout}
 */
export function computeLayout(settings, sourceAspect, sourceWidthPx, view = FULL_FRAME) {
  const gauge = settings.gauge
  const sourceAspectSafe = sourceAspect > 0 ? sourceAspect : 1

  // A. The crop, moved into the working copy's coordinates — see `relativeCrop`. Every
  // rectangle below this line is a rectangle on the RASTER, because that is what the
  // sampler will index; `view` is the only thing that still speaks whole-picture.
  const v = normalizeCrop(view)
  const crop = relativeCrop(settings.crop, v)
  // The working copy's own aspect, which is the picture's narrowed by the view. Keeping
  // the two apart here is what stops a refocused raster from charting as a different
  // shape: `aspect` below comes out identical to `sourceAspect * cropW / cropH` on the
  // whole picture, whatever the view.
  const rasterAspect = sourceAspectSafe * (v.w / v.h)
  const aspect = rasterAspect * (crop.w / crop.h)
  let sample = { u0: crop.x, v0: crop.y, u1: crop.x + crop.w, v1: crop.y + crop.h }

  // How wide the cropped picture is in full-frame pixels — the detail slider's basis, and
  // deliberately independent of how sharp the working copy currently is.
  const cropWidthPx = sourceWidthPx * v.w * crop.w

  // B + C. The picture's own size, in cells. Detail is pixels per stitch, so cropping
  // to half the width halves the stitch count rather than quietly doubling the detail.
  let imageW = stitchesForDetail(settings.detailPx, cropWidthPx)
  let imageH = clamp(rowsForAspect(imageW, aspect, gauge), 1, MAX_ROWS)

  // C. The border, per axis, from a distance rather than a cell count.
  const border = {
    sts: settings.border.inches > 0 ? inchesToStitches(settings.border.inches, gauge) : 0,
    rows: settings.border.inches > 0 ? inchesToRows(settings.border.inches, gauge) : 0,
  }

  let stitches = imageW + border.sts * 2
  let rows = imageH + border.rows * 2
  let imageX = border.sts
  let imageY = border.rows
  let stretched = false
  let padded = false

  // D. A target the user typed, e.g. "make it exactly 100 stitches for a cot blanket".
  const target = settings.target
  if (target && target.stitches > 0 && target.rows > 0) {
    stitches = clamp(Math.round(target.stitches), MIN_STITCHES, MAX_STITCHES)
    rows = clamp(Math.round(target.rows), 1, MAX_ROWS)

    const interiorW = Math.max(1, stitches - border.sts * 2)
    const interiorH = Math.max(1, rows - border.rows * 2)

    if (settings.fit === 'stretch') {
      // Stretch to fit. The sampling rectangle distorts; the picture stretches with it.
      imageW = interiorW
      imageH = interiorH
      imageX = border.sts
      imageY = border.rows
      stretched = true
    } else if (settings.fit === 'cover') {
      // Fill the grid by cropping further, not by distorting. Same cells as stretch,
      // but the sampled rectangle is trimmed to the grid's shape instead of squashed
      // into it, so a circle in the photo is still a circle on the hook.
      imageW = interiorW
      imageH = interiorH
      imageX = border.sts
      imageY = border.rows
      sample = coverSample(crop, rasterAspect, gridAspect(interiorW, interiorH, gauge))
    } else {
      // Whole picture: fit inside the interior at gauge-correct proportions, centred.
      const wantRows = rowsForAspect(interiorW, aspect, gauge)
      if (wantRows <= interiorH) {
        imageW = interiorW
        imageH = Math.max(1, wantRows)
      } else {
        imageH = interiorH
        imageW = Math.max(1, Math.min(interiorW, stitchesForRows(interiorH, aspect, gauge)))
      }
      // The odd leftover cell always goes bottom and right. Stated here, asserted in
      // tests/layout.mjs — an unspecified tie-break makes the whole suite flap.
      imageX = border.sts + Math.floor((interiorW - imageW) / 2)
      imageY = border.rows + Math.floor((interiorH - imageH) / 2)
      padded = imageW !== interiorW || imageH !== interiorH
    }
  }

  return {
    stitches,
    rows,
    border,
    image: { x: imageX, y: imageY, w: imageW, h: imageH },
    crop,
    sample,
    stretched,
    padded,
    /*
      True when anything of the photo is being left out, by the user's crop or by the grid
      trimming it further — which is what the UI needs to say so out loud.

      Measured back against the WHOLE picture. Read off the sample alone it would come out
      false the moment the working copy was rebuilt to cover exactly the crop: the sample
      is then the whole raster, and the notice saying part of the photo is not in the chart
      would vanish precisely when it became most true.
    */
    cropped:
      v.w * (sample.u1 - sample.u0) < 1 - 1e-9 || v.h * (sample.v1 - sample.v0) < 1 - 1e-9,
    clamped: detailWasClamped(settings.detailPx, cropWidthPx),
  }
}

/** True when (x, y) is in the border band rather than the interior. */
export function inBorder(layout, x, y) {
  const { border, stitches, rows } = layout
  return x < border.sts || y < border.rows || x >= stitches - border.sts || y >= rows - border.rows
}

/** True when (x, y) is inside the picture itself. */
export function inImage(layout, x, y) {
  const { image } = layout
  return x >= image.x && x < image.x + image.w && y >= image.y && y < image.y + image.h
}

/**
 * The patch of source picture one chart cell covers, in normalised 0..1 coordinates.
 *
 * Cells tile exactly: cell x's right edge is cell x+1's left edge, to the bit. Gaps
 * would drop source pixels; overlaps would double-count them. tests/layout.mjs walks
 * every cell of a chart and asserts the seams line up.
 */
export function cellRectToSource(layout, x, y) {
  const { image, sample } = layout
  // Where the cell falls within the PICTURE, 0..1.
  const fu0 = (x - image.x) / image.w
  const fu1 = (x - image.x + 1) / image.w
  const fv0 = (y - image.y) / image.h
  const fv1 = (y - image.y + 1) / image.h
  // Then through the sampled rectangle, into the source. An uncropped chart has a
  // sample of the whole frame, so this reduces exactly to the line it replaced.
  const su = sample ? sample.u1 - sample.u0 : 1
  const sv = sample ? sample.v1 - sample.v0 : 1
  const ou = sample ? sample.u0 : 0
  const ov = sample ? sample.v0 : 0
  return {
    u0: ou + fu0 * su,
    u1: ou + fu1 * su,
    v0: ov + fv0 * sv,
    v1: ov + fv1 * sv,
  }
}
