/**
 * File -> Raster. DOM.
 *
 * The only module that decodes an image, and it does the decode exactly once. Everything
 * downstream works from the Raster and the summed-area table built from it.
 */

import { buildSat, countDistinctColors } from './raster.js'

export const ACCEPTED = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp'

/**
 * Longest edge of the working copy.
 *
 * Well above any chart we'd ever build (250 stitches max), so a box average still has
 * plenty of pixels to average, while keeping the summed-area table's four Float64
 * planes at a sane ~33MB rather than hundreds.
 */
const MAX_EDGE = 1024

let nextId = 1

/**
 * @returns {Promise<{id, name, width, height, aspect, raster, sat, flatArt}>}
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

  const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight))
  let width = Math.max(1, Math.round(sourceWidth * scale))
  let height = Math.max(1, Math.round(sourceHeight * scale))

  // Halve repeatedly rather than doing one big drawImage. A single >2x reduction
  // aliases badly in every browser — fine detail turns into shimmer rather than an
  // average — and that noise then quantizes into speckle in the chart.
  let source = bitmap
  let currentW = sourceWidth
  let currentH = sourceHeight
  while (currentW > width * 2 && currentH > height * 2) {
    const halfW = Math.max(width, Math.round(currentW / 2))
    const halfH = Math.max(height, Math.round(currentH / 2))
    source = drawTo(source, halfW, halfH)
    currentW = halfW
    currentH = halfH
  }

  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(source, 0, 0, width, height)
  const imageData = ctx.getImageData(0, 0, width, height)
  bitmap.close?.()

  const raster = { width, height, data: imageData.data }
  return {
    id: `src-${nextId++}`,
    name: file.name ?? 'image',
    width: sourceWidth,
    height: sourceHeight,
    aspect: sourceWidth / sourceHeight,
    raster,
    sat: buildSat(raster),
    // Few distinct colours means a logo or cartoon, where averaging across hard edges
    // invents halo colours. The UI offers to switch sampling rather than doing it
    // silently — it's a guess, and a wrong guess should be one click to undo.
    flatArt: countDistinctColors(raster) <= 64,
  }
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas
}

function drawTo(source, w, h) {
  const canvas = makeCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  return canvas
}
