/**
 * Chart -> PNG blob. DOM.
 *
 * Uses the same `drawChart`/`drawGrid` the preview uses, so the file you download and
 * the thing you were looking at cannot disagree.
 */

import {
  MIN_EXPORT_CELL,
  chartPixelSize,
  drawChart,
  drawGrid,
  drawLetters,
  exportCellPx,
} from './draw.js'

/**
 * @param cellPx  width of one stitch in the exported image. Height follows from gauge,
 *                so the PNG is a scale drawing of the finished blanket rather than a
 *                square-celled approximation of it.
 *
 *                Left out, it is chosen from the chart by `exportCellPx` — big enough
 *                that the file can be zoomed into or printed without being stretched,
 *                and snapped so every cell is exactly the same size. A fixed fourteen
 *                pixels was the whole of why the exported image looked softer than the
 *                preview did.
 */
export async function chartToPngBlob(chart, { cellPx = null, grid = false, letters = null, boldEvery = 10 } = {}) {
  const cell = cellPx ?? exportCellPx(chart)
  const size = chartPixelSize(chart, cell)
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
      /*
        The grid is a counting aid, so it has to stay the same WEIGHT relative to a cell
        however many pixels the cell got. Left at one pixel, the lines that read clearly
        at fourteen pixels a stitch become invisible hairlines at fifty — which looks
        like the grid failed to draw rather than like a bigger image.
      */
      lineWidth: Math.max(1, Math.round(cell / MIN_EXPORT_CELL)),
      line: 'rgba(0,0,0,0.18)',
      bold: 'rgba(0,0,0,0.45)',
    })
  }

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'))
}
