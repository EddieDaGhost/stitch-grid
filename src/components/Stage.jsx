/**
 * The chart on screen.
 *
 * Two stacked canvases. The chart canvas is sized in whole cells and drawn with
 * nearest-neighbour scaling — the chart genuinely IS made of blocks, so pixelated
 * upscaling is the correct rendering rather than a compromise. The grid is a separate
 * canvas sized to the VIEWPORT, so its hairlines stay hairlines at any zoom instead of
 * thickening along with a CSS transform.
 *
 * Zoom never rebuilds the chart. It only changes how many screen pixels one stitch gets.
 */

import { useEffect, useLayoutEffect, useRef } from 'react'
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { cellHeightFor, drawChart, drawGrid, drawProgressMask, strokeCellRect } from '../lib/draw.js'

const MIN_CELL = 2
const MAX_CANVAS = 4096

export default function Stage({ chart, view, setView, showGrid, showRulers, fullBleed, mask, marker }) {
  const wrapRef = useRef(null)
  const chartRef = useRef(null)
  const gridRef = useRef(null)
  const frame = useRef(0)

  const cellW = Math.max(MIN_CELL, view.zoom * 8)
  const cellH = cellHeightFor(cellW, chart.gauge)

  // Cap the backing canvas and let CSS scale beyond it, so a deep zoom never tries to
  // allocate a 20,000 pixel canvas.
  const rawW = chart.stitches * cellW
  const rawH = chart.rows * cellH
  const cap = Math.min(1, MAX_CANVAS / Math.max(rawW, rawH, 1))
  const backingW = Math.max(1, Math.round(rawW * cap))
  const backingH = Math.max(1, Math.round(rawH * cap))
  const displayW = Math.max(1, Math.round(rawW))
  const displayH = Math.max(1, Math.round(rawH))

  useLayoutEffect(() => {
    if (!chart.stitches) return
    if (frame.current) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      frame.current = 0

      const canvas = chartRef.current
      if (canvas) {
        canvas.width = backingW
        canvas.height = backingH
        const ctx = canvas.getContext('2d')
        ctx.imageSmoothingEnabled = false
        ctx.clearRect(0, 0, backingW, backingH)
        drawChart(ctx, chart, { width: backingW, height: backingH })
        if (mask) {
          // On the chart canvas, not the grid one: the wash is made of cells and should
          // scale with them. A hairline outline must not, which is why the marker below
          // goes on the viewport-sized canvas instead.
          const style = getComputedStyle(document.documentElement)
          drawProgressMask(ctx, chart, {
            width: backingW,
            height: backingH,
            mask,
            worked: style.getPropertyValue('--made-worked').trim() || 'rgba(255,255,255,0.62)',
            ahead: style.getPropertyValue('--made-ahead').trim() || 'rgba(0,0,0,0.34)',
          })
        }
      }

      const grid = gridRef.current
      if (grid) {
        grid.width = displayW
        grid.height = displayH
        const ctx = grid.getContext('2d')
        ctx.clearRect(0, 0, displayW, displayH)
        if (showGrid) {
          const style = getComputedStyle(document.documentElement)
          drawGrid(ctx, chart, {
            width: displayW,
            height: displayH,
            line: style.getPropertyValue('--grid-line').trim() || 'rgba(0,0,0,0.16)',
            bold: style.getPropertyValue('--grid-bold').trim() || 'rgba(0,0,0,0.42)',
          })
        }
        if (marker) {
          const style = getComputedStyle(document.documentElement)
          strokeCellRect(ctx, chart, {
            width: displayW,
            height: displayH,
            rect: marker,
            colour: style.getPropertyValue('--accent').trim() || '#2b7977',
            lineWidth: 3,
          })
        }
      }
    })
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current)
    }
  }, [chart, backingW, backingH, displayW, displayH, showGrid, mask, marker])

  // Pinch and ctrl-wheel zoom, which is what a tablet user reaches for first.
  useEffect(() => {
    const node = wrapRef.current
    if (!node) return
    const onWheel = (event) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      setView((v) => ({ ...v, zoom: clampZoom(v.zoom * (event.deltaY < 0 ? 1.08 : 0.93)) }))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [setView])

  const fit = () => {
    const node = wrapRef.current
    if (!node || !chart.stitches) return
    const padding = 32
    const zoomX = (node.clientWidth - padding) / (chart.stitches * 8)
    const zoomY = (node.clientHeight - padding) / (chart.rows * cellHeightFor(8, chart.gauge))
    setView((v) => ({ ...v, zoom: clampZoom(Math.min(zoomX, zoomY)) }))
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-2">
      <div
        ref={wrapRef}
        /* Stacked, `flex-1` has no height to be a fraction of, so the stage needs a
           floor of its own or it collapses behind the panels below it. */
        className="stage relative flex min-h-[55vh] flex-1 items-center justify-center p-4 lg:min-h-0"
        style={fullBleed ? { borderRadius: 0 } : undefined}
      >
        <div className="relative" style={{ width: displayW, height: displayH }}>
          <canvas
            ref={chartRef}
            className="chart-canvas absolute inset-0"
            style={{ width: displayW, height: displayH }}
            aria-label={`Chart preview, ${chart.stitches} stitches by ${chart.rows} rows`}
            role="img"
          />
          <canvas
            ref={gridRef}
            className="pointer-events-none absolute inset-0"
            style={{ width: displayW, height: displayH }}
            aria-hidden="true"
          />
        </div>

        {showRulers ? (
          <div
            className="numeral pointer-events-none absolute bottom-1 left-0 right-0 text-center text-[10px]"
            style={{ color: 'var(--ink-3)' }}
          >
            stitch 1 is the right-hand edge · row 1 is the bottom
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          className="btn-secondary !min-h-11 !px-3"
          aria-label="Zoom out"
          onClick={() => setView((v) => ({ ...v, zoom: clampZoom(v.zoom / 1.3) }))}
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button type="button" className="btn-secondary !min-h-11" aria-label="Fit to screen" onClick={fit}>
          <Maximize2 className="h-4 w-4" />
          Fit
        </button>
        <button
          type="button"
          className="btn-secondary !min-h-11 !px-3"
          aria-label="Zoom in"
          onClick={() => setView((v) => ({ ...v, zoom: clampZoom(v.zoom * 1.3) }))}
        >
          <ZoomIn className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function clampZoom(z) {
  return Math.min(16, Math.max(0.15, z))
}
