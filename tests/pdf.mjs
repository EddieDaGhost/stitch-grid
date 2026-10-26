/**
 * The hand-rolled PDF.
 *
 * This is the highest-value suite in the repo, because a broken PDF fails silently:
 * some viewers tolerate a wrong cross-reference offset, so a corrupt file can look fine
 * on the machine that made it and refuse to open on the machine that matters. The
 * structural assertions below are the only thing standing in for a real parser.
 */

import { buildChartPdf } from '../src/lib/chartPdf.js'
import { createPdf, escapeText, measureText } from '../src/lib/pdf.js'
import { RESOLVED } from '../src/lib/palette.js'

const SC = { stitchesPer4: 16, rowsPer4: 18, unit: 'in' }

function chartOf(stitches, rows, colours = 4) {
  const cells = new Uint8Array(stitches * rows)
  for (let i = 0; i < cells.length; i++) cells[i] = i % colours
  return { stitches, rows, cells, palette: RESOLVED.slice(0, colours), gauge: SC, meta: {} }
}

const text = (bytes) => Array.from(bytes, (b) => String.fromCharCode(b)).join('')

/** Every structural invariant a PDF must satisfy. Run against both build paths. */
function structural(check, bytes, label) {
  const s = text(bytes)

  check(`${label}: starts with a PDF header`, s.startsWith('%PDF-'))
  check(`${label}: ends with %%EOF`, s.trimEnd().endsWith('%%EOF'))
  check(`${label}: every byte fits in a byte`, bytes.every((b) => b >= 0 && b <= 255))

  const startxrefMatch = s.match(/startxref\n(\d+)\n%%EOF/)
  check(`${label}: has a startxref`, Boolean(startxrefMatch))
  const xrefStart = Number(startxrefMatch[1])
  check(
    `${label}: startxref points at the xref table`,
    s.slice(xrefStart, xrefStart + 4) === 'xref',
    `found ${JSON.stringify(s.slice(xrefStart, xrefStart + 8))}`,
  )

  const header = s.slice(xrefStart).match(/^xref\n0 (\d+)\n/)
  check(`${label}: the xref declares its size`, Boolean(header))
  const size = Number(header[1])

  // Entries are fixed-width: 10 digits, space, 5 digits, space, type, space, newline.
  const entriesStart = xrefStart + header[0].length
  let entriesOk = true
  let offsetsOk = true
  for (let i = 0; i < size; i++) {
    const entry = s.slice(entriesStart + i * 20, entriesStart + (i + 1) * 20)
    if (entry.length !== 20) entriesOk = false
    if (!/^\d{10} \d{5} [nf] \n$/.test(entry)) entriesOk = false

    if (i === 0) continue
    // THE assertion: each offset must land exactly on "<n> 0 obj".
    const offset = Number(entry.slice(0, 10))
    const expected = `${i} 0 obj`
    if (s.slice(offset, offset + expected.length) !== expected) offsetsOk = false
  }
  check(`${label}: every xref entry is exactly 20 bytes`, entriesOk)
  check(`${label}: every xref offset lands on its own object`, offsetsOk)

  check(`${label}: the free entry heads the list`, /^0000000000 65535 f \n/.test(s.slice(entriesStart)))

  const trailerSize = s.match(/\/Size (\d+)/)
  check(`${label}: the trailer size matches the xref`, Number(trailerSize[1]) === size)

  // Stream lengths must be exact or a viewer reads past the end.
  let lengthsOk = true
  const streamRe = /<< \/Length (\d+) >>\nstream\n/g
  let m
  while ((m = streamRe.exec(s))) {
    const declared = Number(m[1])
    const from = m.index + m[0].length
    if (s.slice(from + declared, from + declared + 10) !== '\nendstream') lengthsOk = false
  }
  check(`${label}: every stream length is exact`, lengthsOk)

  const pageCount = (s.match(/\/Type \/Page[^s]/g) ?? []).length
  const declaredCount = Number(s.match(/\/Count (\d+)/)[1])
  check(`${label}: /Count matches the number of pages`, pageCount === declaredCount, `${pageCount} vs ${declaredCount}`)

  return s
}

export default async function run({ check }) {
  // --- escaping
  check.is('backslashes escape first', escapeText('a\\b'), 'a\\\\b')
  check.is('parentheses escape', escapeText('Blue (Dark)'), 'Blue \\(Dark\\)')
  check.is('an unbalanced paren still escapes', escapeText(')'), '\\)')
  check.is('newlines escape to octal', escapeText('a\nb'), 'a\\012b')
  check.is('plain text is untouched', escapeText('Cream 12'), 'Cream 12')
  // Dropping these instead would turn "stitches 1–30" into "stitches 130", which is a
  // wrong instruction rather than a cosmetic loss.
  check.is('an em dash becomes a hyphen, not nothing', escapeText('a—b'), 'a-b')
  check.is('an en dash in a range survives', escapeText('1–30'), '1-30')
  check.is('smart quotes become plain ones', escapeText('“x”'), '"x"')
  check.is('the row arrows become ASCII', escapeText('← →'), '<-- -->')
  check.is('a backslash arrow is escaped after transliteration', escapeText('↙'), '\\\\')
  check('escaped output is pure ASCII', /^[\x20-\x7E\\]*$/.test(escapeText('Blue (Dark) — 12 ← ↗')))

  // --- measurement, so centred labels actually centre
  check('a wide letter measures wider than a narrow one', measureText('W', 10) > measureText('i', 10))
  check.near('measurement scales with font size', measureText('Hello', 20), measureText('Hello', 10) * 2, 1e-9)
  check.is('an empty string measures zero', measureText('', 10), 0)

  // --- a minimal document
  const doc = createPdf({ paper: 'letter' })
  doc.page()
  doc.rect(10, 10, 100, 50, [200, 40, 40])
  doc.text(20, 80, 'Cream (Dark) 12', { size: 10 })
  doc.lines([[0, 0, 100, 100]], [0, 0, 0], 0.5)
  doc.page()
  doc.text(20, 20, 'Sheet 2', { font: 'F2', size: 12 })
  const bytes = doc.finish()

  check('finish returns bytes', bytes instanceof Uint8Array)
  const s = structural(check, bytes, 'minimal')
  check.is('two pages were written', (s.match(/\/Type \/Page[^s]/g) ?? []).length, 2)
  check('the media box is letter sized', s.includes('/MediaBox [0 0 612 792]'))
  check('Helvetica is referenced', s.includes('/BaseFont /Helvetica'))
  check('Helvetica-Bold is referenced', s.includes('/BaseFont /Helvetica-Bold'))
  check('no font is embedded', !s.includes('/FontFile'))
  check('the escaped text made it into the stream', s.includes('Cream \\(Dark\\) 12'))

  // The top-down API must actually flip: y=10 from the top is y=782 from the bottom.
  check('the y axis is flipped exactly once', s.includes('10 732 100 50 re f'), 'rect at top y=10 height=50')

  // --- a real chart
  const small = buildChartPdf(chartOf(30, 34), { title: 'Test chart' })
  structural(check, small, 'chart')
  const smallText = text(small)
  check('the cover names the chart', smallText.includes('Test chart'))
  check('the cover states the stitch and row count', smallText.includes('30 stitches wide'))
  check('the cover states the gauge it assumed', smallText.includes('Assuming a gauge'))
  check('the cover warns that gauge is personal', smallText.includes('your own tension') || smallText.includes('own tension'))
  check('the cover carries a colour key', smallText.includes('Colour key'))
  check('yarn honesty survives into the PDF', smallText.includes('20%'))
  // Parens are escaped inside a PDF string literal, so this is what it looks like on disk.
  check('the written pattern is included', smallText.includes('Row 1 \\(RS'))
  check('and the direction arrow survived as ASCII', smallText.includes('<--'))

  // --- a chart big enough to tile
  const big = buildChartPdf(chartOf(140, 180, 6), { title: 'Big', cellPt: 13 })
  const bigText = structural(check, big, 'tiled')
  check('a large chart tiles across several sheets', bigText.includes('Sheet 1 of'))
  // The en dash in the source becomes an ASCII hyphen on the way into the PDF, which is
  // the whole point — "stitches 1-30" is readable, "stitches 130" is a wrong instruction.
  check('and says which stitches each sheet holds', /stitches \d+-\d+/.test(bigText))
  check('and which rows', /rows \d+-\d+/.test(bigText))
  check('a large chart makes more pages than a small one', big.length > small.length)

  // --- awkward content must not corrupt the file
  const awkward = {
    ...chartOf(12, 12, 2),
    palette: [
      { ...RESOLVED[0], name: 'Blue (Dark)' },
      { ...RESOLVED[1], name: 'Grey — Warm \\ Deep' },
    ],
  }
  const awkwardBytes = buildChartPdf(awkward, { title: 'Odd (names) \\ here' })
  structural(check, awkwardBytes, 'awkward names')

  // --- options actually do something
  const noPattern = buildChartPdf(chartOf(30, 34), { includePattern: false })
  check('turning the written pattern off shortens the document', noPattern.length < small.length)
  check('and removes the row instructions', !text(noPattern).includes('Row 1 \\(RS'))

  const c2c = buildChartPdf(chartOf(30, 34), { mode: 'c2c' })
  check('c2c mode writes a corner-to-corner pattern', text(c2c).includes('Corner to corner'))
  structural(check, c2c, 'c2c')

  const a4 = buildChartPdf(chartOf(30, 34), { paper: 'a4' })
  check('A4 uses a different media box', text(a4).includes('/MediaBox [0 0 595.28 841.89]'))
  structural(check, a4, 'a4')

  /*
    A border worked at the end prints as a second section of the same pattern.

    Worth its own structural pass rather than only a text check: the rounds add lines
    and therefore pages, and the whole point of this suite is that a document which
    grows a page still has every cross-reference offset landing on its own object. A
    pattern that reads correctly inside a file no viewer will open is not a pattern.
  */
  const framed = {
    ...chartOf(24, 20),
    meta: { border: { sts: 4, rows: 4, rounds: 4 } },
  }
  const framedPdf = buildChartPdf(framed, { title: 'Framed' })
  // Unescaped, because every paren in a PDF literal is written as `\(` — comparing
  // against the raw bytes would be testing the escaper rather than the pattern.
  const framedText = text(framedPdf).replace(/\\([()])/g, '$1')
  check('the printed pattern announces the border section', framedText.includes('worked in rounds'))
  check('and numbers the rounds', framedText.includes('Round 1 ('))
  check(
    'a round says it goes around rather than printing a character no PDF font has',
    framedText.includes('Round 1 (around)'),
    framedText.match(/Round 1 \([^)]*\)/)?.[0] ?? 'no round line found',
  )

  // The picture rows are the picture wide: 24 stitches less four rounds either side.
  const rowTotals = [...framedText.matchAll(/Row \d+ \((?:RS|WS)[^:]*: .*?\((\d+)\)/g)].map((m) => Number(m[1]))
  check(
    'every picture row is the picture wide, not the chart wide',
    rowTotals.length > 0 && rowTotals.every((n) => n === framed.stitches - 8),
    `totals seen: ${[...new Set(rowTotals)].join(', ') || 'none'}`,
  )
  structural(check, framedPdf, 'border worked at the end')

  // --- a one-cell chart is still a valid document
  structural(check, buildChartPdf(chartOf(1, 1, 1), { title: 'Tiny' }), 'single cell')

  // --- the page cap holds
  const huge = buildChartPdf(chartOf(250, 400, 12), { cellPt: 13, maxPages: 4, includePattern: false })
  const hugePages = (text(huge).match(/\/Type \/Page[^s]/g) ?? []).length
  check('the page cap is respected', hugePages <= 5, `got ${hugePages} pages`)
  structural(check, huge, 'capped')
}
