/**
 * A canvas context that records instead of painting.
 *
 * Lets the drawing code be asserted in bare Node — you check the operation stream
 * ("these rectangles tile the canvas exactly once") rather than sampling pixels.
 */

export function recordingContext() {
  const ops = []
  let fillStyle = null
  let strokeStyle = null
  let lineWidth = 1
  let font = null
  let textAlign = null
  let textBaseline = null
  let path = []

  return {
    ops,
    get fillStyle() {
      return fillStyle
    },
    set fillStyle(v) {
      fillStyle = v
      ops.push({ op: 'fillStyle', value: v })
    },
    get strokeStyle() {
      return strokeStyle
    },
    set strokeStyle(v) {
      strokeStyle = v
      ops.push({ op: 'strokeStyle', value: v })
    },
    get lineWidth() {
      return lineWidth
    },
    set lineWidth(v) {
      lineWidth = v
      ops.push({ op: 'lineWidth', value: v })
    },
    fillRect(x, y, w, h) {
      ops.push({ op: 'fillRect', x, y, w, h, fill: fillStyle })
    },
    get font() {
      return font
    },
    set font(v) {
      font = v
      ops.push({ op: 'font', value: v })
    },
    get textAlign() {
      return textAlign
    },
    set textAlign(v) {
      textAlign = v
    },
    get textBaseline() {
      return textBaseline
    },
    set textBaseline(v) {
      textBaseline = v
    },
    fillText(text, x, y) {
      ops.push({ op: 'fillText', text, x, y, fill: fillStyle, font, textAlign, textBaseline })
    },
    beginPath() {
      path = []
      ops.push({ op: 'beginPath' })
    },
    moveTo(x, y) {
      path.push(['m', x, y])
    },
    lineTo(x, y) {
      path.push(['l', x, y])
      ops.push({ op: 'segment', x, y })
    },
    stroke() {
      ops.push({ op: 'stroke', segments: path.length / 2, strokeStyle, lineWidth })
    },
  }
}

/** Count how many times each pixel of a w x h canvas is covered by a fillRect. */
export function coverage(ops, w, h) {
  const counts = new Uint16Array(w * h)
  for (const op of ops) {
    if (op.op !== 'fillRect') continue
    for (let y = Math.max(0, op.y); y < Math.min(h, op.y + op.h); y++) {
      for (let x = Math.max(0, op.x); x < Math.min(w, op.x + op.w); x++) {
        counts[y * w + x]++
      }
    }
  }
  let uncovered = 0
  let doubled = 0
  for (const c of counts) {
    if (c === 0) uncovered++
    else if (c > 1) doubled++
  }
  return { uncovered, doubled }
}
