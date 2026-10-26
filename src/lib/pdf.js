/**
 * A minimal PDF writer. Pure — no dependency, no DOM, testable in bare Node.
 *
 * It knows about objects, cross-reference offsets, streams, fonts and escaping. It
 * knows nothing about crochet; `chartPdf.js` sits on top and does the layout. Keeping
 * them apart matters because the two halves fail in completely different ways — a bug
 * here produces a file Acrobat refuses to open, a bug there produces an ugly chart —
 * and a single file mixing byte arithmetic with margin arithmetic is unreviewable.
 *
 * Only the standard-14 fonts are used, so nothing is embedded and there is no font
 * descriptor, no subsetting and no CMap. That is the entire reason this fits in a page.
 *
 * THE INVARIANT THAT KEEPS IT CORRECT: the whole file is assembled as a latin1 string,
 * where `str.length` is exactly the byte length. Cross-reference entries are byte
 * offsets, so the moment a multi-byte character sneaks in, every offset after it is
 * wrong and the file is quietly corrupt. Text is escaped to pure ASCII on the way in
 * and `assertLatin1` throws if anything else ever reaches the buffer.
 */

export const PAPER = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
}

const FONTS = { F1: 'Helvetica', F2: 'Helvetica-Bold' }

function assertLatin1(chunk) {
  if (/[^\x00-\xFF]/.test(chunk)) {
    throw new Error('pdf: non-latin1 byte reached the buffer; escape text before writing')
  }
  return chunk
}

/**
 * Characters with no WinAnsi byte, rewritten to something that survives printing.
 *
 * Dropping them instead is a trap: an en dash in "stitches 1–30" silently prints as
 * "stitches 130", which is not a typo but a wrong instruction. Anything a user might
 * paste into a title — smart quotes from a word processor, an em dash, an ellipsis —
 * and every arrow the pattern uses to show direction of travel gets an ASCII stand-in.
 */
const TRANSLITERATE = {
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-',
  '‘': "'", '’': "'", '‚': ',', '‛': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"',
  '…': '...', '•': '-', '′': "'", '″': '"',
  '×': 'x', '÷': '/',
  '←': '<--', '→': '-->', '↑': '^', '↓': 'v',
  '↗': '/', '↙': '\\', '↖': '\\', '↘': '/',
  // A border round travels all four sides, so it has no single direction to draw.
  '↺': 'around', '↻': 'around',
  ' ': ' ',
}

/**
 * Escape a string for a PDF literal `( ... )`.
 * Backslash FIRST — escaping the parens first would then double-escape their backslashes.
 */
export function escapeText(s) {
  return String(s)
    .replace(/[^\x00-\xFF]/g, (c) => TRANSLITERATE[c] ?? '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, (c) => `\\${c.charCodeAt(0).toString(8).padStart(3, '0')}`)
}

const fmt = (n) => {
  const r = Math.round(n * 1000) / 1000
  return Object.is(r, -0) ? '0' : String(r)
}

const rgbOp = ([r, g, b], op) => `${fmt(r / 255)} ${fmt(g / 255)} ${fmt(b / 255)} ${op}`

/**
 * Create a document.
 *
 * The public API is TOP-DOWN: y = 0 is the top of the page, y grows downward, matching
 * canvas and matching how anyone lays out a page. PDF's own origin is bottom-left with
 * y growing up. The flip happens in exactly one place (`Y`), so no caller ever has to
 * think about it — every layout bug in a hand-rolled PDF is otherwise a flipped y.
 */
export function createPdf({ paper = 'letter', width, height } = {}) {
  const size = PAPER[paper] ?? PAPER.letter
  const pageWidth = width ?? size.width
  const pageHeight = height ?? size.height

  const pages = []
  let current = null

  const Y = (y) => pageHeight - y

  const api = {
    pageWidth,
    pageHeight,

    page() {
      current = { ops: [] }
      pages.push(current)
      return api
    },

    get pageCount() {
      return pages.length
    },

    /** Filled rectangle. (x, y) is its TOP-left corner. */
    rect(x, y, w, h, fill) {
      if (w <= 0 || h <= 0) return api
      current.ops.push(`${rgbOp(fill, 'rg')}`, `${fmt(x)} ${fmt(Y(y + h))} ${fmt(w)} ${fmt(h)} re f`)
      return api
    },

    /** Many rectangles sharing one fill — one colour operator for the lot. */
    rects(boxes, fill) {
      if (!boxes.length) return api
      current.ops.push(`${rgbOp(fill, 'rg')}`)
      for (const [x, y, w, h] of boxes) {
        if (w <= 0 || h <= 0) continue
        current.ops.push(`${fmt(x)} ${fmt(Y(y + h))} ${fmt(w)} ${fmt(h)} re f`)
      }
      return api
    },

    /** Many line segments sharing one stroke colour and width. */
    lines(segments, stroke, lineWidth = 0.4) {
      if (!segments.length) return api
      current.ops.push(`${rgbOp(stroke, 'RG')}`, `${fmt(lineWidth)} w`)
      for (const [x1, y1, x2, y2] of segments) {
        current.ops.push(`${fmt(x1)} ${fmt(Y(y1))} m ${fmt(x2)} ${fmt(Y(y2))} l S`)
      }
      return api
    },

    /**
     * Text. (x, y) is the BASELINE start, in top-down coordinates.
     * `align` shifts by the measured width; `rotate: 90` uses a text matrix, which
     * needs no extra operators at all.
     */
    text(x, y, str, { font = 'F1', size: fontSize = 9, color = [0, 0, 0], align = 'left', rotate = 0 } = {}) {
      const safe = escapeText(str)
      if (!safe) return api
      const w = measureText(str, fontSize, font)
      let tx = x
      if (align === 'center') tx = x - w / 2
      else if (align === 'right') tx = x - w

      const placement =
        rotate === 90
          ? `0 1 -1 0 ${fmt(x)} ${fmt(Y(y))} Tm`
          : `1 0 0 1 ${fmt(tx)} ${fmt(Y(y))} Tm`

      current.ops.push(
        'BT',
        `/${font} ${fmt(fontSize)} Tf`,
        `${rgbOp(color, 'rg')}`,
        placement,
        `(${safe}) Tj`,
        'ET',
      )
      return api
    },

    /** Serialise. @returns {Uint8Array} */
    finish() {
      // Object numbering: 1 Catalog, 2 Pages, 3 F1, 4 F2, then page/content pairs.
      const objects = []
      const add = (body) => {
        objects.push(body)
        return objects.length // 1-based object number
      }

      add('<< /Type /Catalog /Pages 2 0 R >>')
      add('') // placeholder for Pages, filled once kids are known
      add(`<< /Type /Font /Subtype /Type1 /BaseFont /${FONTS.F1} /Encoding /WinAnsiEncoding >>`)
      add(`<< /Type /Font /Subtype /Type1 /BaseFont /${FONTS.F2} /Encoding /WinAnsiEncoding >>`)

      const kids = []
      for (const page of pages) {
        const stream = page.ops.join('\n')
        const contentNum = objects.length + 2 // this page's object, then its contents
        const pageNum = add(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(pageWidth)} ${fmt(pageHeight)}] ` +
            `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNum} 0 R >>`,
        )
        // /Length must be the exact byte count of what sits between the stream markers.
        add(`<< /Length ${assertLatin1(stream).length} >>\nstream\n${stream}\nendstream`)
        kids.push(`${pageNum} 0 R`)
      }
      objects[1] = `<< /Type /Pages /Kids [ ${kids.join(' ')} ] /Count ${pages.length} >>`

      let out = '%PDF-1.4\n'
      const offsets = []
      objects.forEach((body, i) => {
        offsets.push(out.length)
        out += assertLatin1(`${i + 1} 0 obj\n${body}\nendobj\n`)
      })

      const xrefStart = out.length
      out += `xref\n0 ${objects.length + 1}\n`
      // Entry 0 is the head of the free list. Every entry is EXACTLY 20 bytes:
      // ten digits, space, five digits, space, type, space, newline. Off-by-one here
      // is the classic hand-rolled-PDF bug, so it's asserted rather than trusted.
      const entry = (offset, gen, type) =>
        `${String(offset).padStart(10, '0')} ${String(gen).padStart(5, '0')} ${type} \n`
      const head = entry(0, 65535, 'f')
      if (head.length !== 20) throw new Error('pdf: xref entry is not 20 bytes')
      out += head
      for (const offset of offsets) out += entry(offset, 0, 'n')

      out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`

      assertLatin1(out)
      return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff)
    },
  }

  return api
}

/**
 * Helvetica advance widths, per 1000 units, for the ASCII range.
 *
 * Only needed so text can be centred and right-aligned. Approximating this with a flat
 * per-character width makes every centred label sit visibly off-centre, which on a
 * chart's row numbers looks like a bug in the chart.
 */
const HELVETICA_WIDTHS = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  0: 556, 1: 556, 2: 556, 3: 556, 4: 556, 5: 556, 6: 556, 7: 556, 8: 556, 9: 556,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
}

/** Text width in points. Bold is ~5% wider across the board; close enough to centre by. */
export function measureText(str, fontSize, font = 'F1') {
  let units = 0
  for (const ch of String(str)) units += HELVETICA_WIDTHS[ch] ?? 556
  const width = (units / 1000) * fontSize
  return font === 'F2' ? width * 1.05 : width
}
