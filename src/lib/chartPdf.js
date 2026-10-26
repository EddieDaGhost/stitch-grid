/**
 * The printable chart. Pure — takes a Chart, returns PDF bytes.
 *
 * This file owns margins, tiling, rulers, the legend and the written pattern. It never
 * writes a byte offset; `pdf.js` handles that. Coordinates here are top-down points
 * (1 point = 1/72 inch), which is what the builder's API speaks.
 *
 * The thing that makes this a CROCHET chart rather than graph paper: cells are drawn at
 * the real gauge aspect ratio, so the printed chart is a scale drawing of the finished
 * blanket. Seeing a circle stay circular on paper is the whole point of the tool, and
 * it would be undone by printing it on squares.
 */

import { inkOn } from './color.js'
import { createPdf, measureText } from './pdf.js'
import { cellHeightFor } from './draw.js'
import { colourChanges, dimensions, legend, readingFor, stepLabel } from './pattern.js'

const MARGIN = 40
const INK = [30, 34, 38]
const MUTED = [110, 118, 126]
const HAIRLINE = [190, 195, 200]
const RULE = [70, 76, 82]

export function buildChartPdf(
  chart,
  {
    paper = 'letter',
    title = 'Crochet chart',
    cellPt = 13,
    squareCells = false,
    letters = true,
    includePattern = true,
    startsOnRightSide = true,
    mode = 'rows',
    maxPages = 60,
  } = {},
) {
  const doc = createPdf({ paper })
  const dim = dimensions(chart)
  const key = legend(chart)

  const usableW = doc.pageWidth - MARGIN * 2
  const usableH = doc.pageHeight - MARGIN * 2

  // Room for the rulers along the bottom and both sides of every tile.
  const GUTTER = 22
  const availW = usableW - GUTTER * 2
  const availH = usableH - GUTTER - 24

  // `cellPt` sets how many sheets the chart needs...
  const maxCols = Math.max(1, Math.floor(availW / cellPt))
  const maxRows = Math.max(1, Math.floor(availH / (squareCells ? cellPt : cellHeightFor(cellPt, chart.gauge))))
  const tilesX = Math.ceil(chart.stitches / maxCols)
  const tilesY = Math.ceil(chart.rows / maxRows)

  /**
   * ...and then the chart is spread EVENLY over those sheets rather than each one
   * being filled to the brim. Packing greedily is what gives you a 57-row sheet
   * followed by a 6-row sliver — the same chart, but a miserable thing to tape up.
   */
  const perPageCols = Math.ceil(chart.stitches / tilesX)
  const perPageRows = Math.ceil(chart.rows / tilesY)

  /**
   * Finally the cells grow to use the paper. Once the sheet count is settled there is
   * no reason to print a half-empty page — bigger cells are easier to follow, and the
   * whole point of printing is to mark off stitches as you go.
   *
   * The gauge aspect is preserved while growing, so the printed chart stays a scale
   * drawing of the finished blanket.
   */
  const aspect = squareCells ? 1 : chart.gauge.stitchesPer4 / chart.gauge.rowsPer4
  const grown = Math.min(availW / perPageCols, availH / perPageRows / aspect)
  // A cap, so a ten-stitch chart doesn't print at two inches a stitch.
  const cellW = Math.max(cellPt, Math.min(grown, 30))
  const cellH = cellW * aspect

  drawCover(doc, chart, { title, dim, key, tilesX, tilesY, mode, startsOnRightSide })

  let drawn = 0
  // Tiles run bottom-to-top so sheet 1 holds row 1 — you tape them up in the order you
  // crochet them, not in the order a computer happens to scan the array.
  for (let ty = tilesY - 1; ty >= 0; ty--) {
    for (let tx = 0; tx < tilesX; tx++) {
      if (drawn >= maxPages) break
      drawTile(doc, chart, {
        tx,
        ty,
        tilesX,
        tilesY,
        perPageCols,
        perPageRows,
        cellW,
        cellH,
        letters,
        key,
        sheet: drawn + 1,
        sheets: Math.min(maxPages, tilesX * tilesY),
        gutter: GUTTER,
      })
      drawn++
    }
  }

  if (includePattern) drawPattern(doc, chart, { mode, startsOnRightSide, key })

  return doc.finish()
}

function drawCover(doc, chart, { title, dim, key, tilesX, tilesY, mode, startsOnRightSide }) {
  doc.page()
  let y = MARGIN + 18

  doc.text(MARGIN, y, title, { font: 'F2', size: 20, color: INK })
  y += 26

  doc.text(MARGIN, y, `${dim.stitches} stitches wide  x  ${dim.rows} rows tall`, {
    font: 'F2',
    size: 12,
    color: INK,
  })
  y += 17
  doc.text(
    MARGIN,
    y,
    `Finished size ${dim.widthIn.toFixed(1)}" x ${dim.heightIn.toFixed(1)}"  ` +
      `(${Math.round(dim.widthCm)} x ${Math.round(dim.heightCm)} cm)`,
    { size: 11, color: INK },
  )
  y += 15
  doc.text(
    MARGIN,
    y,
    `Assuming a gauge of ${chart.gauge.stitchesPer4} stitches and ${chart.gauge.rowsPer4} rows ` +
      `to 4 inches.`,
    { size: 10, color: MUTED },
  )
  y += 13
  doc.text(
    MARGIN,
    y,
    'Your finished size depends on your own tension. Swatch first if the size matters.',
    { size: 10, color: MUTED },
  )
  y += 22

  const joins = colourChanges(chart, { startsOnRightSide })
  doc.text(
    MARGIN,
    y,
    `${chart.palette.length} colours  ·  about ${joins} colour changes  ·  ` +
      `${mode === 'c2c' ? 'corner to corner' : 'worked in rows, bottom up'}`,
    { size: 10, color: MUTED },
  )
  y += 24

  doc.text(MARGIN, y, `Chart is ${tilesX} sheet${tilesX === 1 ? '' : 's'} across and ` +
    `${tilesY} down. Sheet 1 is the bottom-left corner, where row 1 starts.`,
    { size: 10, color: MUTED })
  y += 26

  // --- Colour key
  doc.text(MARGIN, y, 'Colour key', { font: 'F2', size: 13, color: INK })
  y += 8
  doc.lines([[MARGIN, y, doc.pageWidth - MARGIN, y]], HAIRLINE, 0.7)
  y += 15

  const cols = [MARGIN, MARGIN + 26, MARGIN + 48, MARGIN + 190, MARGIN + 270, MARGIN + 350]
  doc.text(cols[1], y, 'Key', { font: 'F2', size: 9, color: MUTED })
  doc.text(cols[3], y, 'Colour', { font: 'F2', size: 9, color: MUTED })
  doc.text(cols[4], y, 'Stitches', { font: 'F2', size: 9, color: MUTED })
  doc.text(cols[5], y, 'Yarn (rough)', { font: 'F2', size: 9, color: MUTED })
  y += 13

  for (const entry of key) {
    doc.rect(cols[0], y - 8, 18, 11, entry.colour.rgb)
    doc.lines(
      [
        [cols[0], y - 8, cols[0] + 18, y - 8],
        [cols[0], y + 3, cols[0] + 18, y + 3],
        [cols[0], y - 8, cols[0], y + 3],
        [cols[0] + 18, y - 8, cols[0] + 18, y + 3],
      ],
      HAIRLINE,
      0.5,
    )
    doc.text(cols[1], y, entry.letter, { font: 'F2', size: 10, color: INK })
    doc.text(cols[3], y, entry.colour.name, { size: 10, color: INK })
    doc.text(cols[4], y, `${entry.cells}  (${entry.percent.toFixed(1)}%)`, { size: 10, color: INK })
    doc.text(cols[5], y, `${Math.ceil(entry.yards)} yd / ${Math.ceil(entry.yards * 0.9144)} m`, {
      size: 10,
      color: INK,
    })
    y += 15
    if (y > doc.pageHeight - MARGIN - 40) break
  }

  y += 8
  doc.text(MARGIN, y, 'Yarn amounts are a rough estimate from your gauge. Buy about 20% more.', {
    size: 9,
    color: MUTED,
  })
}

function drawTile(
  doc,
  chart,
  { tx, ty, tilesX, tilesY, perPageCols, perPageRows, cellW, cellH, letters, key, sheet, sheets, gutter },
) {
  doc.page()

  const x0 = tx * perPageCols
  const y0 = ty * perPageRows
  const cols = Math.min(perPageCols, chart.stitches - x0)
  const rows = Math.min(perPageRows, chart.rows - y0)

  const left = MARGIN + gutter
  const top = MARGIN + 22

  // Header naming exactly which stitches and rows this sheet holds, so taping several
  // together is unambiguous.
  const firstRow = chart.rows - (y0 + rows) + 1
  const lastRow = chart.rows - y0
  doc.text(MARGIN, MARGIN + 8, `Sheet ${sheet} of ${sheets}`, { font: 'F2', size: 10, color: INK })
  doc.text(
    doc.pageWidth - MARGIN,
    MARGIN + 8,
    `stitches ${x0 + 1}–${x0 + cols}  ·  rows ${firstRow}–${lastRow}`,
    { size: 10, color: MUTED, align: 'right' },
  )

  // --- Fills, one rectangle per horizontal run.
  const byColour = new Map()
  for (let r = 0; r < rows; r++) {
    const y = y0 + r
    let c = 0
    while (c < cols) {
      const index = chart.cells[y * chart.stitches + (x0 + c)]
      let end = c + 1
      while (end < cols && chart.cells[y * chart.stitches + (x0 + end)] === index) end++
      if (!byColour.has(index)) byColour.set(index, [])
      byColour.get(index).push([left + c * cellW, top + r * cellH, (end - c) * cellW, cellH])
      c = end
    }
  }
  for (const [index, boxes] of byColour) {
    doc.rects(boxes, chart.palette[index]?.rgb ?? [0, 0, 0])
  }

  // --- Letters, so the chart survives a black-and-white printer and so nobody has to
  // distinguish Sage from Moss by eye. Inked black or white by luminance.
  if (letters && cellW >= 7 && cellH >= 7) {
    const letterFor = new Map(key.map((e) => [e.index, e.letter]))
    const size = Math.min(cellW, cellH) * 0.62
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const index = chart.cells[(y0 + r) * chart.stitches + (x0 + c)]
        const colour = chart.palette[index]
        if (!colour) continue
        doc.text(
          left + c * cellW + cellW / 2,
          top + r * cellH + cellH / 2 + size * 0.36,
          letterFor.get(index) ?? '',
          { size, color: inkOn(colour.rgb), align: 'center' },
        )
      }
    }
  }

  // --- The counting grid. Drawn after the fills so it sits on top of them.
  const thin = []
  const heavy = []
  for (let c = 0; c <= cols; c++) {
    const x = left + c * cellW
    const absolute = x0 + c
    const seg = [x, top, x, top + rows * cellH]
    ;(absolute % 10 === 0 || c === 0 || c === cols ? heavy : thin).push(seg)
  }
  for (let r = 0; r <= rows; r++) {
    const y = top + r * cellH
    // Tens counted from the bottom, because row 1 is the bottom row.
    const fromBottom = chart.rows - (y0 + r)
    const seg = [left, y, left + cols * cellW, y]
    ;(fromBottom % 10 === 0 || r === 0 || r === rows ? heavy : thin).push(seg)
  }
  doc.lines(thin, HAIRLINE, 0.3)
  doc.lines(heavy, RULE, 0.9)

  // --- Stitch numbers along the bottom, counted RIGHT TO LEFT. Stitch 1 is the right
  // edge because row 1 is worked right to left. Numbering these the other way is a
  // subtle, infuriating error that only shows up once someone has crocheted it.
  for (let c = 0; c < cols; c++) {
    const stitchNo = chart.stitches - (x0 + c)
    if (stitchNo % 10 !== 0 && stitchNo !== 1) continue
    doc.text(left + c * cellW + cellW / 2, top + rows * cellH + 12, String(stitchNo), {
      size: 7,
      color: MUTED,
      align: 'center',
    })
  }

  // --- Row numbers up both sides: odd (right-side) rows on the right, even on the
  // left, which is the standard convention and tells you at a glance which edge each
  // row starts from.
  for (let r = 0; r < rows; r++) {
    const rowNo = chart.rows - (y0 + r)
    if (rowNo % 10 !== 0 && rowNo !== 1) continue
    const cy = top + r * cellH + cellH / 2 + 2.5
    const label = String(rowNo)
    if (rowNo % 2 === 1) {
      doc.text(left + cols * cellW + 5, cy, label, { size: 7, color: MUTED })
    } else {
      doc.text(left - 5 - measureText(label, 7), cy, label, { size: 7, color: MUTED })
    }
  }
}

function drawPattern(doc, chart, { mode, startsOnRightSide, key }) {
  const name = (index) => chart.palette[index]?.name ?? '?'
  const letterFor = new Map(key.map((e) => [e.index, e.letter]))
  const lines = []

  lines.push([mode === 'c2c' ? 'Corner to corner' : 'Worked in rows, from the bottom up', true])

  // A border left until the end is a second section of the same pattern, not a second
  // pattern: the rounds continue straight on from the last row of the picture.
  let heading = false
  for (const entry of readingFor(chart, { mode, startsOnRightSide })) {
    if (entry.kind === 'round' && !heading) {
      heading = true
      lines.push(['Border, worked in rounds around the finished panel', true])
    }
    const runs = entry.runs
      .map((r) => `${r.count} ${letterFor.get(r.index) ?? '?'} ${name(r.index)}`)
      .join(', ')
    const how = entry.kind === 'round' ? entry.direction : `${entry.phase ?? entry.side}, ${entry.direction}`
    lines.push([`${stepLabel(entry)} (${how}): ${runs}  (${entry.total})`, false])
  }

  const lineHeight = 11
  const colWidth = (doc.pageWidth - MARGIN * 2 - 20) / 2
  const perColumn = Math.floor((doc.pageHeight - MARGIN * 2 - 20) / lineHeight)
  const perPage = perColumn * 2

  for (let i = 0; i < lines.length; i += perPage) {
    doc.page()
    const chunk = lines.slice(i, i + perPage)
    chunk.forEach(([text, isHeading], k) => {
      const column = Math.floor(k / perColumn)
      const row = k % perColumn
      const x = MARGIN + column * (colWidth + 20)
      const y = MARGIN + 16 + row * lineHeight
      doc.text(x, y, text, {
        size: isHeading ? 11 : 8,
        font: isHeading ? 'F2' : 'F1',
        color: isHeading ? INK : [50, 55, 60],
      })
    })
  }
}
