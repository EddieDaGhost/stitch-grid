/**
 * File -> Raster. DOM.
 *
 * The only module that decodes an image. It holds on to the FILE rather than to the
 * decoded picture, because the working copy is not fixed: it covers whichever part of
 * the photo you are actually charting, and gets rebuilt from the original when that
 * changes. Everything downstream works from the Raster and the summed-area table.
 */

import { buildSat, colourProfile } from './raster.js'
import { lutFor } from './palette.js'
import { FULL_FRAME, normalizeCrop } from './layout.js'

export const ACCEPTED = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp'

/**
 * Longest edge of the working copy.
 *
 * Well above any chart we'd ever build (250 stitches max), so a box average still has
 * plenty of pixels to average, while keeping the summed-area table's four Float64
 * planes at a sane ~33MB rather than hundreds.
 */
export const MAX_EDGE = 1024

/**
 * How much of the picture the framing panel needs, which is all of it and none of it
 * sharply. Kept whole and separate from the working copy, because the working copy
 * stops being the whole picture the moment you crop.
 */
export const PREVIEW_EDGE = 1024

let nextId = 1

/**
 * Pixels for a REGION of a decoded picture, at up to `maxEdge` on its long side.
 *
 * `region` is normalised against the whole picture. Cropping used to be free here and
 * expensive later: the budget was spent on the whole photo before anyone had said which
 * part of it mattered, so a quarter-width crop of a 4000px original was charted from a
 * 256 pixel strip of a 1024 pixel copy — three quarters of the resolution the photo
 * actually had, thrown away before the crop existed. Asking for the region directly
 * spends the same budget on the part being charted.
 */
function rasteriseRegion(bitmap, region, maxEdge) {
  const r = normalizeCrop(region)
  const bw = bitmap.width
  const bh = bitmap.height
  let sx = r.x * bw
  let sy = r.y * bh
  let sw = Math.max(1, r.w * bw)
  let sh = Math.max(1, r.h * bh)

  const scale = Math.min(1, maxEdge / Math.max(sw, sh))
  const width = Math.max(1, Math.round(sw * scale))
  const height = Math.max(1, Math.round(sh * scale))

  /*
    Halve repeatedly rather than doing one big drawImage. A single >2x reduction aliases
    badly in every browser — fine detail turns into shimmer rather than an average — and
    that noise then quantizes into speckle in the chart. The first step also does the
    cropping, after which each intermediate is the whole of what remains.
  */
  let source = bitmap
  let currentW = sw
  let currentH = sh
  while (currentW > width * 2 && currentH > height * 2) {
    const halfW = Math.max(width, Math.round(currentW / 2))
    const halfH = Math.max(height, Math.round(currentH / 2))
    source = drawRegionTo(source, sx, sy, currentW, currentH, halfW, halfH)
    sx = 0
    sy = 0
    currentW = halfW
    currentH = halfH
  }

  const canvas = drawRegionTo(source, sx, sy, currentW, currentH, width, height)
  const ctx = canvas.getContext('2d')
  const imageData = ctx.getImageData(0, 0, width, height)
  return { width, height, data: imageData.data }
}

/**
 * Rebuild the working copy so it covers `region` of the picture at full resolution.
 *
 * Re-decodes rather than holding the decoded picture: a twelve megapixel photo is close
 * to fifty megabytes of bitmap, which is a lot to keep alive on a phone for something
 * needed only when the framing settles. The `File` is a handle, and costs nothing.
 */
export async function refocusSource(source, region) {
  const view = normalizeCrop(region)
  const bitmap = await createImageBitmap(source.file, { imageOrientation: 'from-image' })
  try {
    const raster = rasteriseRegion(bitmap, view, MAX_EDGE)
    /*
      Re-measure, because the picture being charted is not the picture that was loaded.

      Rule 11 is "measure what the picture needs, never assume it", and after a crop the
      whole photo's measurement is an assumption about a different picture — crop into the
      flat back of a jersey and the flat-art hint should appear; crop a photograph out of a
      poster and it should go. Cheap: a fixed number of samples, not a pass over the
      raster. It moves the HINT only. The colour cap it seeded is a setting the user owns
      by now, and rewriting that behind a crop would be an edit nobody made — and one that
      would land in the undo stack with somebody else's name on it.
    */
    const profile = colourProfile(raster, lutFor('all', []))
    return {
      ...source,
      rev: source.rev + 1,
      view,
      raster,
      sat: buildSat(raster),
      profile,
      flatArt: profile.flat,
    }
  } finally {
    bitmap.close?.()
  }
}

/**
 * @returns {Promise<{id, rev, name, file, width, height, aspect, workingWidth,
 *                    preview, view, raster, sat, profile, flatArt}>}
 */
export async function loadSource(file) {
  // `imageOrientation: 'from-image'` is not optional. Without it every photo taken in
  // portrait on a phone arrives rotated ninety degrees, and it is the first thing
  // anyone would report.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })

  /*
    Read the dimensions BEFORE anything closes the bitmap.

    `ImageBitmap.close()` sets width and height to zero, so reading them afterwards
    gives 0/0 — NaN — and every downstream guard of the form `aspect > 0 ? aspect : 1`
    then quietly treats the photo as square. That is not a cosmetic failure here: the
    picture's own shape is half of `rowsForAspect`, so a 3:2 photo charted as 1:1 comes
    out squashed into a square blanket, which is the precise thing this app exists to
    prevent. tests/walkthrough.mjs now charts a non-square photo for exactly this reason.
  */
  const sourceWidth = bitmap.width
  const sourceHeight = bitmap.height

  const raster = rasteriseRegion(bitmap, FULL_FRAME, MAX_EDGE)
  /*
    The framing panel shows the WHOLE picture, and the working copy above stops being
    the whole picture as soon as the framing narrows. So the panel gets its own copy,
    kept for as long as the picture is open. Pixels only — no summed-area table, since
    nothing charts from it.
  */
  const preview = rasteriseRegion(bitmap, FULL_FRAME, PREVIEW_EDGE)
  bitmap.close?.()
  /*
    How many yarn colours the picture actually needs, measured against the full palette.

    This decides two things at once: whether to treat the picture as flat artwork, and
    how many colours to start the chart at. Both were guesses before — flat art from a
    distinct-colour count that antialiasing defeated, and the colour cap from a constant
    that never looked at the picture, so a three-colour logo was charted in twelve.
  */
  const profile = colourProfile(raster, lutFor('all', []))
  return {
    id: `src-${nextId++}`,
    // Bumped whenever the working copy is rebuilt, so the chart cache knows the pixels
    // underneath it changed even though every setting stayed put.
    rev: 0,
    name: file.name ?? 'image',
    // Kept so the working copy can be rebuilt for a narrower view. A handle, not a copy.
    file,
    width: sourceWidth,
    height: sourceHeight,
    aspect: sourceWidth / sourceHeight,
    /*
      The width of a FULL-FRAME working copy, which is what the detail slider counts
      against. Held separately from `raster.width` on purpose: the raster grows sharper
      as you crop in, and if the stitch count were read off it, tightening the framing
      would silently change how big a blanket you are making.
    */
    workingWidth: raster.width,
    preview,
    /** Which part of the picture `raster` currently covers. */
    view: { ...FULL_FRAME },
    raster,
    sat: buildSat(raster),
    profile,
    // A guess, and a wrong guess should be one click to undo — so the UI offers to
    // switch rather than locking it in.
    flatArt: profile.flat,
  }
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas
}

/**
 * Draw a source rectangle onto a canvas of the given size.
 *
 * The good filter on EVERY step, the last one included. Left at the default, a reduction
 * is a cheap box-ish filter, and what it leaves behind is per-pixel noise along every
 * edge — which the quantizer then turns into single stray stitches of an invented colour.
 */
function drawRegionTo(source, sx, sy, sw, sh, w, h) {
  const canvas = makeCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h)
  return canvas
}
