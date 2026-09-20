/**
 * The chart on screen.
 *
 * Three stacked canvases, all sharing one backing store measured in DEVICE pixels:
 * `chart` (the cells, then the making wash), `letters` above it, and `grid` on top.
 * Sharing the size is what makes a letter land exactly on its cell and a grid line
 * exactly on a cell boundary — computed independently they drift apart by half a pixel
 * at awkward zooms.
 *
 * Device pixels rather than CSS pixels because a canvas sized in CSS pixels is stretched
 * by the browser on any dense screen, which is every phone and tablet this is built for.
 * The chart survives that (its cells are blocks, and `image-rendering: pixelated` is the
 * right rendering for them), but hairlines and letters do not: they come back soft.
 *
 * Zoom never rebuilds the chart. It only changes how many screen pixels one stitch gets.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import {
  cellHeightFor,
  drawChart,
  drawGrid,
  drawLetters,
  drawProgressMask,
  strokeCellRect,
} from '../lib/draw.js'

const MIN_CELL = 2
const MAX_CANVAS = 4096

/**
 * Cap on how much resolution to buy from a dense screen.
 *
 * Three covers every phone worth covering; beyond that the memory is real and the
 * difference is not.
 */
const MAX_DPR = 3

/** A cell must be at least this many CSS pixels before the grid draws every line. */
const GRID_MIN_CELL = 6
/** Below this a letter is grit on the picture rather than a label. Matches `drawLetters`. */
const LETTER_MIN_CELL = 8

/**
 * How long the chart must sit still before the letters are painted.
 *
 * One `fillText` per cell is not cheap: measured in Chromium it is about 44ms for a
 * five thousand cell chart and 350ms for a big one, which is three to twenty frames.
 * Design mode rebuilds the chart on every tick of the detail slider, so painting them
 * inline would put the single most expensive thing in the renderer directly on the
 * interaction path — precisely what the rest of this app is arranged to avoid.
 *
 * So they get their own layer and their own pass. Drag a slider and the letters simply
 * are not there; stop, and they appear. Short enough that a click feels immediate.
 */
const LETTER_DELAY_MS = 90

export default function Stage({
  chart,
  view,
  setView,
  showGrid,
  showRulers,
  fullBleed,
  mask,
  marker,
  letters,
  fitKey,
}) {
  const wrapRef = useRef(null)
  const chartRef = useRef(null)
  const lettersRef = useRef(null)
  const gridRef = useRef(null)
  const frame = useRef(0)

  const dpr = Math.min(MAX_DPR, Math.max(1, useDevicePixelRatio()))

  const cellW = Math.max(MIN_CELL, view.zoom * 8)
  const cellH = cellHeightFor(cellW, chart.gauge)

  /*
    Two sizes, and keeping them apart is the whole of it.

    `display` is CSS pixels — how big the chart looks. `backing` is DEVICE pixels — how
    many the canvas actually holds. A canvas sized in CSS pixels on a 2x screen is
    stretched to twice its resolution by the browser, which turns every counting-grid
    hairline into a soft two-pixel smear. Since the target device is a tablet, that was
    the normal case rather than an edge one.

    The cap still binds: a deep zoom asks for more than any browser will allocate, so
    past that point resolution is traded away rather than the canvas failing outright.
  */
  const rawW = chart.stitches * cellW
  const rawH = chart.rows * cellH
  const scale = Math.min(dpr, MAX_CANVAS / Math.max(rawW, rawH, 1))
  const backingW = Math.max(1, Math.round(rawW * scale))
  const backingH = Math.max(1, Math.round(rawH * scale))
  const displayW = Math.max(1, Math.round(rawW))
  const displayH = Math.max(1, Math.round(rawH))

  // Whole device pixels, so the parity trick in `drawGrid` can land lines cleanly.
  const lineScale = Math.max(1, Math.round(scale))
  // The legibility floors are about apparent size, so they stay in CSS pixels.
  const lettersFit = chart.stitches > 0 && Math.min(cellW, cellH) >= LETTER_MIN_CELL

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
        grid.width = backingW
        grid.height = backingH
        const ctx = grid.getContext('2d')
        ctx.clearRect(0, 0, backingW, backingH)
        if (showGrid) {
          const style = getComputedStyle(document.documentElement)
          drawGrid(ctx, chart, {
            width: backingW,
            height: backingH,
            line: style.getPropertyValue('--grid-line').trim() || 'rgba(0,0,0,0.16)',
            bold: style.getPropertyValue('--grid-bold').trim() || 'rgba(0,0,0,0.42)',
            lineWidth: lineScale,
            minCell: GRID_MIN_CELL * scale,
          })
        }
        if (marker) {
          const style = getComputedStyle(document.documentElement)
          strokeCellRect(ctx, chart, {
            width: backingW,
            height: backingH,
            rect: marker,
            colour: style.getPropertyValue('--accent').trim() || '#2b7977',
            lineWidth: 3 * lineScale,
          })
        }
      }
    })
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current)
    }
  }, [chart, backingW, backingH, showGrid, mask, marker, lineScale, scale])

  useEffect(() => {
    const canvas = lettersRef.current
    if (!canvas) return

    // Resize first, which also clears. Stale letters sitting over a chart that has
    // already changed would be actively wrong, and wrong is worse than absent.
    canvas.width = backingW
    canvas.height = backingH
    if (!letters || !chart.stitches) return

    const timer = setTimeout(() => {
      const ctx = canvas.getContext('2d')
      drawLetters(ctx, chart, {
        width: backingW,
        height: backingH,
        letters,
        minCell: LETTER_MIN_CELL * scale,
      })
    }, LETTER_DELAY_MS)
    return () => clearTimeout(timer)
  }, [chart, letters, backingW, backingH, scale])

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

  const fit = useCallback(() => {
    const node = wrapRef.current
    if (!node || !chart.stitches) return
    const padding = 32
    const zoomX = (node.clientWidth - padding) / (chart.stitches * 8)
    const zoomY = (node.clientHeight - padding) / (chart.rows * cellHeightFor(8, chart.gauge))
    setView((v) => ({ ...v, zoom: clampZoom(Math.min(zoomX, zoomY)) }))
  }, [chart.stitches, chart.rows, chart.gauge, setView])

  /**
   * Fit a newly loaded picture to the stage.
   *
   * A fixed starting zoom meant every chart opened at eight pixels a stitch whatever
   * its size and whatever the screen was: a small chart sat as a stamp in a field of
   * grey, and a large one spilled off the edge. Eight pixels is also below the grid's
   * own legibility floor on the short axis at most gauges, so the counting grid was
   * half-drawn on arrival too — which reads as a blurry chart rather than a small one.
   *
   * Keyed on the picture, not the chart, so it happens once when you open something and
   * never fights the zoom you chose afterwards. Zoom is a way of looking, so this stays
   * out of undo like the rest of the view.
   */
  const fitted = useRef(null)
  useLayoutEffect(() => {
    if (!fitKey || !chart.stitches || fitted.current === fitKey) return
    fitted.current = fitKey
    fit()
  }, [fitKey, chart.stitches, fit])

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
            data-layer="chart"
            className="chart-canvas absolute inset-0"
            style={{ width: displayW, height: displayH }}
            aria-label={`Chart preview, ${chart.stitches} stitches by ${chart.rows} rows`}
            role="img"
          />
          {/* Sized to the BACKING canvas, like the chart itself, so the letters land
              exactly on the cells rather than half a pixel off them at odd zooms. */}
          <canvas
            ref={lettersRef}
            data-layer="letters"
            className="pointer-events-none absolute inset-0"
            style={{ width: displayW, height: displayH }}
            aria-hidden="true"
          />
          <canvas
            ref={gridRef}
            data-layer="grid"
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
            {letters && !lettersFit
              ? 'zoom in to read the colour letters'
              : 'stitch 1 is the right-hand edge · row 1 is the bottom'}
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

/**
 * The screen's pixel density, kept current when a window moves between displays.
 *
 * There is no `devicePixelRatio` change event. The standard way round it is to watch a
 * media query pinned to the ratio you currently believe in, and re-arm it the moment it
 * stops matching — which is what the dependency on `dpr` below does.
 */
function useDevicePixelRatio() {
  const [dpr, setDpr] = useState(() =>
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const media = window.matchMedia(`(resolution: ${dpr}dppx)`)
    const onChange = () => setDpr(window.devicePixelRatio || 1)
    media.addEventListener?.('change', onChange)
    return () => media.removeEventListener?.('change', onChange)
  }, [dpr])

  return dpr
}
