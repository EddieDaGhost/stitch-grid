/**
 * Choosing which part of the photo becomes the blanket.
 *
 * This is the first place in the app that shows you the photo at all — everywhere else
 * shows the chart. It earns the space because the alternative was leaving the room:
 * until now, a picture of a dog with half a lawn around it had to be cropped in some
 * other app first, and "go and use a different tool, then come back" is a poor answer
 * from something that already has the pixels in memory.
 *
 * All the geometry lives in `lib/layout.js` and is tested there. This file owns pointer
 * events and nothing else — which is why the fiddly part (which edge stays anchored
 * when you drag the opposite one) is provable without a browser.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Crop, Maximize, Square } from 'lucide-react'
import { FULL_FRAME, dragCrop, isFullFrame, squareCrop } from '../lib/layout.js'
import { formatSize } from '../lib/gauge.js'

/** Corner handles, in the order they read on screen. */
const CORNERS = [
  { mode: 'nw', label: 'top left', style: { left: 0, top: 0 } },
  { mode: 'ne', label: 'top right', style: { left: '100%', top: 0 } },
  { mode: 'sw', label: 'bottom left', style: { left: 0, top: '100%' } },
  { mode: 'se', label: 'bottom right', style: { left: '100%', top: '100%' } },
]

const NUDGE = 0.02

export default function CropPanel({ source, settings, update, commit, dim }) {
  const crop = settings.crop
  const photoRef = useRef(null)
  const hostRef = useRef(null)
  const dragRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  // The source raster, straight onto a canvas at its own size. CSS scales it down to
  // the panel; the working copy is capped at 1024px, so there is nothing to stream.
  useLayoutEffect(() => {
    const canvas = photoRef.current
    const raster = source?.raster
    if (!canvas || !raster) return
    canvas.width = raster.width
    canvas.height = raster.height
    const ctx = canvas.getContext('2d')
    ctx.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0)
  }, [source])

  const beginDrag = (event, mode) => {
    if (event.button != null && event.button !== 0) return
    const box = hostRef.current?.getBoundingClientRect()
    if (!box?.width || !box?.height) return
    event.preventDefault()
    event.stopPropagation()
    // Anchored to the crop as it was when the drag STARTED, so a long drag can't
    // accumulate rounding drift the way a delta-per-frame version would.
    dragRef.current = { mode, box, startX: event.clientX, startY: event.clientY, from: crop }
    setDragging(true)
  }

  useEffect(() => {
    if (!dragging) return
    const onMove = (event) => {
      const drag = dragRef.current
      if (!drag) return
      const dx = (event.clientX - drag.startX) / drag.box.width
      const dy = (event.clientY - drag.startY) / drag.box.height
      update((s) => ({ ...s, crop: dragCrop(drag.mode, drag.from, dx, dy) }), 'crop')
    }
    const onEnd = () => {
      dragRef.current = null
      setDragging(false)
      // Ends the undo step, so one drag of the frame is one undo — same as a slider.
      commit()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }
  }, [dragging, update, commit])

  const onKeyDown = (event) => {
    const nudge = {
      ArrowLeft: [-NUDGE, 0],
      ArrowRight: [NUDGE, 0],
      ArrowUp: [0, -NUDGE],
      ArrowDown: [0, NUDGE],
    }[event.key]
    if (!nudge) return
    event.preventDefault()
    update((s) => ({ ...s, crop: dragCrop('move', s.crop, nudge[0], nudge[1]) }), 'crop')
    commit()
  }

  const setCrop = (next, label) => {
    update((s) => ({ ...s, crop: next }), label)
    commit()
  }

  const percent = Math.round(crop.w * crop.h * 100)

  return (
    <section className="panel p-4" aria-label="Framing">
      <h2 className="section-title">Framing</h2>
      <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-3)' }}>
        Drag the frame to choose what gets crocheted. A blanket is a long job — it is
        worth spending it on the part of the picture you actually want.
      </p>

      <div
        ref={hostRef}
        className="relative mt-3 select-none"
        /* Same rule as the sliders: without this iOS treats the drag as a page scroll
           and the frame never moves. */
        style={{ touchAction: 'none' }}
      >
        <canvas ref={photoRef} className="block h-auto w-full rounded-lg" aria-label="The photo you loaded" />

        {/* Four shades rather than one ring, so the corner handles can sit proud of the
            photo's edge instead of being clipped away by an overflow rule. */}
        <Shade style={{ left: 0, top: 0, width: '100%', height: `${crop.y * 100}%` }} />
        <Shade style={{ left: 0, top: `${(crop.y + crop.h) * 100}%`, width: '100%', bottom: 0 }} />
        <Shade style={{ left: 0, top: `${crop.y * 100}%`, width: `${crop.x * 100}%`, height: `${crop.h * 100}%` }} />
        <Shade
          style={{
            left: `${(crop.x + crop.w) * 100}%`,
            top: `${crop.y * 100}%`,
            right: 0,
            height: `${crop.h * 100}%`,
          }}
        />

        <div
          className="absolute"
          style={{
            left: `${crop.x * 100}%`,
            top: `${crop.y * 100}%`,
            width: `${crop.w * 100}%`,
            height: `${crop.h * 100}%`,
          }}
        >
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-move rounded-sm"
            style={{
              outline: '2px solid var(--accent)',
              outlineOffset: '-1px',
              boxShadow: '0 0 0 1px var(--crop-handle-edge)',
              background: 'transparent',
            }}
            aria-label="Move the crop frame. Arrow keys nudge it."
            onPointerDown={(event) => beginDrag(event, 'move')}
            onKeyDown={onKeyDown}
          />
          {CORNERS.map((corner) => (
            <button
              key={corner.mode}
              type="button"
              /* 44px of hit area centred on the corner, with a small visible dot inside
                 it. The target is a finger, not a mouse pointer. */
              className="absolute grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center"
              style={corner.style}
              aria-label={`Drag the ${corner.label} corner of the crop`}
              onPointerDown={(event) => beginDrag(event, corner.mode)}
            >
              <span
                className="block h-3 w-3 rounded-full"
                style={{
                  background: 'var(--crop-handle)',
                  boxShadow: '0 0 0 3px var(--accent), 0 0 0 4.5px var(--crop-handle-edge)',
                }}
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary"
          aria-label="Use the whole picture"
          disabled={isFullFrame(crop)}
          onClick={() => setCrop({ ...FULL_FRAME }, 'framing')}
        >
          <Maximize className="h-4 w-4" />
          Whole picture
        </button>
        <button
          type="button"
          className="btn-secondary"
          aria-label="Crop to a square"
          onClick={() => setCrop(squareCrop(source.aspect), 'framing')}
        >
          <Square className="h-4 w-4" />
          Square
        </button>
      </div>

      <p className="numeral mt-3 flex items-center gap-1.5 text-xs" style={{ color: 'var(--ink-3)' }}>
        <Crop className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {isFullFrame(crop)
          ? 'Using the whole picture'
          : `Using ${percent}% of the picture`}
        {dim ? ` · ${dim.stitches} × ${dim.rows} stitches · ${formatSize(dim, settings.gauge.unit)}` : ''}
      </p>
    </section>
  )
}

function Shade({ style }) {
  return (
    <div
      className="pointer-events-none absolute rounded-sm"
      style={{ background: 'var(--crop-shade)', ...style }}
      aria-hidden="true"
    />
  )
}
