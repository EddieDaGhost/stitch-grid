/**
 * Downloads, checked as real files.
 *
 * The PDF gets the SAME structural assertions the bare-Node suite runs, against bytes
 * that actually came out of a browser download. That's deliberate: it's the only thing
 * stopping the browser path and the Node path from quietly drifting apart.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { asUpload, photoPng, readPngSize } from './pngfixture.mjs'
import { MIN_EXPORT_CELL, cellEdges, chartPixelSize, exportCellPx } from '../src/lib/draw.js'

/** The gauge the app opens with, which is what this walkthrough charts at. */
const SC = { stitchesPer4: 16, rowsPer4: 18, unit: 'in' }

const upload = asUpload('garden-photo.png', photoPng(600, 400))

async function download(page, trigger, tmp, name) {
  const [event] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), trigger()])
  const path = join(tmp, name)
  await event.saveAs(path)
  return { bytes: readFileSync(path), suggested: event.suggestedFilename() }
}

export default async function run({ page, check, errors, URL, tmp }) {
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.setInputFiles('input[type=file]', upload)
  await page.waitForSelector('[aria-label="Chart summary"]', { timeout: 15000 })

  const summary = await page.getByLabel('Chart summary').innerText()
  const [, stitches, rows] = summary.match(/(\d+)\s*×\s*(\d+)/).map(Number)

  // --- PNG
  const png = await download(
    page,
    () => page.getByRole('button', { name: 'Download chart image PNG' }).click(),
    tmp,
    'chart.png',
  )
  check('the PNG is really a PNG', png.bytes.subarray(1, 4).toString() === 'PNG')
  check('the filename comes from the picture', png.suggested.startsWith('garden-photo'), png.suggested)
  check('and is named as a chart', png.suggested.endsWith('-chart.png'))

  const size = readPngSize(png.bytes)
  /*
    The exported file is sized from the chart, not at a fixed fourteen pixels a stitch —
    that fixed size is what made a downloaded chart look softer than the preview did, and
    it put rows of two different heights in every file at the default gauge. Asserted
    against the same pure function the app calls, so this cannot drift from it.
  */
  const cell = exportCellPx({ stitches, rows, gauge: SC, cells: new Uint8Array(0), palette: [], meta: {} })
  const expectedSize = chartPixelSize({ stitches, rows, gauge: SC }, cell)
  check.is('the PNG is one cell block per stitch', size.width, stitches * cell)
  check.is('and holds the height the chart asks for', size.height, expectedSize.height)
  check(
    'the export is no longer a fixed fourteen pixels a stitch',
    cell > MIN_EXPORT_CELL,
    `${cell}px a stitch for a ${stitches}x${rows} chart`,
  )

  // Every row exactly the same height, which is what stops a big chart looking soft.
  const ys = cellEdges(rows, size.height)
  const heights = new Set()
  for (let i = 0; i < rows; i++) heights.add(ys[i + 1] - ys[i])
  check.is('every row of the exported file is the same height', heights.size, 1, [...heights].join(','))

  /**
   * The important one: the exported image's shape must match the FINISHED BLANKET, not
   * the cell count. A square-celled export would be a different picture from the one
   * the preview showed.
   */
  const expected = (stitches * (4 / 16)) / (rows * (4 / 18))
  check.near('the PNG aspect matches the finished size', size.width / size.height, expected, expected * 0.02)

  // --- PDF
  const pdf = await download(
    page,
    () => page.getByRole('button', { name: 'Download printable chart PDF' }).click(),
    tmp,
    'chart.pdf',
  )
  const s = pdf.bytes.toString('latin1')
  check('the PDF is really a PDF', s.startsWith('%PDF-'))
  check('and is named after the picture', pdf.suggested === 'garden-photo-chart.pdf', pdf.suggested)

  // The same structural checks the Node suite runs, on a real downloaded file.
  const startxref = Number(s.match(/startxref\n(\d+)\n%%EOF/)[1])
  check('startxref points at the xref table', s.slice(startxref, startxref + 4) === 'xref')

  const header = s.slice(startxref).match(/^xref\n0 (\d+)\n/)
  const entriesStart = startxref + header[0].length
  const objectCount = Number(header[1])
  let offsetsOk = true
  let widthsOk = true
  for (let i = 1; i < objectCount; i++) {
    const entry = s.slice(entriesStart + i * 20, entriesStart + (i + 1) * 20)
    if (!/^\d{10} \d{5} n \n$/.test(entry)) widthsOk = false
    const offset = Number(entry.slice(0, 10))
    if (!s.startsWith(`${i} 0 obj`, offset)) offsetsOk = false
  }
  check('every xref entry in the downloaded file is 20 bytes', widthsOk)
  check('every xref offset in the downloaded file is correct', offsetsOk)
  check('the downloaded PDF ends properly', s.trimEnd().endsWith('%%EOF'))

  check('the PDF states the chart size', s.includes(`${stitches} stitches wide`))
  check('the PDF carries a colour key', s.includes('Colour key'))
  check('the PDF carries the written pattern', s.includes('Row 1 \\(RS'))
  check('the PDF names its sheets', s.includes('Sheet 1 of'))
  check('the PDF states the gauge it assumed', s.includes('Assuming a gauge'))

  // --- written pattern to the clipboard
  await page.getByRole('button', { name: 'Copy written pattern' }).click()
  await page.waitForTimeout(300)
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '')
  check('the written pattern reaches the clipboard', clip.length > 0)
  check('it starts at row 1 on the right side', /Row 1 \(RS, ←\)/.test(clip), clip.slice(0, 80))
  check('every row line carries a running stitch total', clip.split('\n').filter((l) => l.startsWith('Row ')).every((l) => /\(\d+\)$/.test(l)))
  check('it names the gauge it assumed', clip.includes('Gauge assumed'))
  check('it is honest about yarn estimates', /rough/i.test(clip))

  // --- c2c changes what gets written
  await page.getByRole('group', { name: 'Method' }).getByText('Corner to corner').click()
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: 'Copy written pattern' }).click()
  await page.waitForTimeout(300)
  const c2cClip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '')
  check('corner to corner writes a different pattern', c2cClip.includes('Corner to corner'))
  check('and works on the diagonal', /Row 1 \((increase|decrease)/.test(c2cClip))

  check.is('no page errors during export', errors.join(' | '), '')
}
