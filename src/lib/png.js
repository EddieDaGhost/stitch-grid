/**
 * Chart -> PNG blob. DOM.
 *
 * Uses the same `drawChart`/`drawGrid` the preview uses, so the file you download and
 * the thing you were looking at cannot disagree.
 */

import { chartPixelSize, drawChart, drawGrid, drawLetters } from './draw.js'

/**
 * @param cellPx  width of one stitch in the exported image. Height follows from gauge,
 *                so the PNG is a scale drawing of the finished blanket rather than a
 *                square-celled approximation of it.
 */
export async function chartToPngBlob(chart, { cellPx = 14, grid = false, letters = null, boldEvery = 10 } = {}) {
  const size = chartPixelSize(chart, cellPx)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = false

  drawChart(ctx, chart, { width: size.width, height: size.height })
  if (letters) {
    drawLetters(ctx, chart, { width: size.width, height: size.height, letters })
  }
  if (grid) {
    drawGrid(ctx, chart, {
      width: size.width,
      height: size.height,
      boldEvery,
      line: 'rgba(0,0,0,0.18)',
      bold: 'rgba(0,0,0,0.45)',
    })
  }

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'))
}
