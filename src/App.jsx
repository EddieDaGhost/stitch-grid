/**
 * The whole app.
 *
 * Owns the source picture, the settings, the undo stack and the view. Renders nothing
 * itself — but this is where the cache chain that keeps the sliders at sixty frames a
 * second lives, so the order of the memos below is the performance story:
 *
 *   image + summed-area table   rebuilt only when a new picture is loaded
 *   colour lookup cube          rebuilt only when the colour range changes
 *   layout                      trivial arithmetic
 *   chart                       rebuilt on every slider tick, in well under a millisecond
 *
 * The expensive things are never on the interaction path. That's the whole trick.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Grid3x3, Type, Undo2, RotateCcw, PanelLeftClose, PanelLeft, Loader2 } from 'lucide-react'
import Dropzone from './components/Dropzone.jsx'
import CropPanel from './components/CropPanel.jsx'
import Make from './components/Make.jsx'
import Stage from './components/Stage.jsx'
import Summary from './components/Summary.jsx'
import Legend from './components/Legend.jsx'
import ExportBar from './components/ExportBar.jsx'
import {
  AdjustPanel,
  BorderPanel,
  CleanupPanel,
  GaugePanel,
  PalettePanel,
  ReadingPanel,
  SizePanel,
} from './components/Controls.jsx'

import { buildChart, chartHash, emptyChart } from './lib/chart.js'
import { FULL_FRAME, computeLayout } from './lib/layout.js'
import { lutFor } from './lib/palette.js'
import { colourChanges, dimensions, legend, patternText } from './lib/pattern.js'
import { DEFAULT_SETTINGS, DEFAULT_VIEW, normalizeSettings, settingsKey } from './lib/settings.js'
import { canUndo, commit, describeUndo, emptyHistory, reset, undo } from './lib/history.js'
import { loadSource } from './lib/image.js'
import { chartToPngBlob } from './lib/png.js'
import { buildChartPdf } from './lib/chartPdf.js'
import { downloadBlob, downloadData, suggestName } from './lib/download.js'
import { loadProgress, loadSettings, saveProgress, saveSettings } from './lib/storage.js'
import { emptyProgress, makeView, stepBounds, workedMask } from './lib/progress.js'

export default function App() {
  const [source, setSource] = useState(null)
  const [history, setHistory] = useState(() => emptyHistory(loadSettings()))
  const [view, setView] = useState(DEFAULT_VIEW)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [panelsOpen, setPanelsOpen] = useState(true)

  const settings = history.present
  const designMode = view.mode === 'design'
  const makeMode = view.mode === 'make'

  /** Edits go through here so undo, coalescing and persistence all happen in one place. */
  const update = useCallback((producer, label) => {
    setHistory((h) => commit(h, normalizeSettings(producer(h.present)), label))
  }, [])

  /** Ends a drag, so the next change starts a fresh undo step. */
  const endDrag = useCallback(() => {
    setHistory((h) => ({ ...h, lastAt: 0 }))
  }, [])

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  const openFile = useCallback(async (file) => {
    setBusy(true)
    setError('')
    try {
      const loaded = await loadSource(file)
      setSource(loaded)
      // A new picture is a new document, so the old undo stack no longer means anything.
      setHistory((h) =>
        emptyHistory(
          normalizeSettings({
            ...h.present,
            sourceName: loaded.name,
            // A new picture is a new framing; the last one's crop means nothing here.
            crop: { ...FULL_FRAME },
            target: null,
            locked: [],
            excluded: [],
            swaps: {},
            sampling: loaded.flatArt ? 'nearest' : 'area',
          }),
        ),
      )
      setView((v) => ({ ...v, zoom: 1 }))
    } catch {
      setError("That file couldn't be read as an image. Try a JPG, PNG or WebP.")
    } finally {
      setBusy(false)
    }
  }, [])

  // --- the cache chain ----------------------------------------------------

  const lut = useMemo(
    () => lutFor(settings.subsetId, settings.excluded),
    [settings.subsetId, settings.excluded],
  )

  const layout = useMemo(
    () => (source ? computeLayout(settings, source.aspect, source.raster.width) : null),
    [source, settings],
  )

  const chartKey = settingsKey(settings, source?.id ?? '')
  const chartCache = useRef({ key: null, chart: null })

  const chart = useMemo(() => {
    if (!source || !layout) return emptyChart(settings.gauge)
    if (chartCache.current.key === chartKey) return chartCache.current.chart
    const built = buildChart({ sat: source.sat, raster: source.raster, layout, settings, lut })
    chartCache.current = { key: chartKey, chart: built }
    return built
    // chartKey is the real dependency — it names every input that can change a cell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartKey, source, layout, lut])

  const dim = useMemo(() => (chart.stitches ? dimensions(chart) : null), [chart])
  const key = useMemo(() => (chart.stitches ? legend(chart) : []), [chart])
  const joins = useMemo(
    () => (chart.stitches ? colourChanges(chart, { startsOnRightSide: settings.startsOnRightSide }) : 0),
    [chart, settings.startsOnRightSide],
  )

  // --- where you are, if you're making rather than designing -----------------

  /**
   * The position is keyed by the chart's own hash, and deliberately not held in the
   * undo stack: ticking off a row is not an edit to the design, and undo dragging you
   * back twenty rows of crochet would be indefensible.
   *
   * Hashing is gated on making mode because it's O(cells), and design mode rebuilds the
   * chart on every slider tick — there is no reason to pay for a key nothing reads.
   */
  const chartId = useMemo(
    () => (makeMode && chart.stitches ? chartHash(chart) : ''),
    [makeMode, chart],
  )

  const [place, setPlace] = useState(() => ({ chartId: '', progress: emptyProgress() }))

  useEffect(() => {
    if (!chartId) return
    setPlace((p) => (p.chartId === chartId ? p : { chartId, progress: loadProgress(chartId) ?? emptyProgress() }))
  }, [chartId])

  useEffect(() => {
    // Only ever write a position back to the chart it was read for. Without this guard
    // the save would fire once with the new chart's id and the old chart's row.
    if (place.chartId && place.chartId === chartId) saveProgress(place.chartId, place.progress)
  }, [chartId, place])

  const setProgress = useCallback((producer) => {
    setPlace((p) => ({ ...p, progress: producer(p.progress) }))
  }, [])

  const reading = useMemo(
    () => ({ mode: settings.mode, startsOnRightSide: settings.startsOnRightSide }),
    [settings.mode, settings.startsOnRightSide],
  )

  const make = useMemo(() => {
    if (!makeMode || !chart.stitches) return null
    const position = place.chartId === chartId ? place.progress : emptyProgress()
    return makeView(chart, position, reading)
  }, [makeMode, chart, chartId, place, reading])

  const mask = useMemo(
    () => (make ? workedMask(chart, make.reading, make.progress, reading) : null),
    [make, chart, reading],
  )

  const marker = useMemo(
    () => (make?.current ? stepBounds(chart, make.current.row, reading) : null),
    [make, chart, reading],
  )

  /**
   * Letter per palette index, from the legend's ranking — the same ranking the colour
   * key and the PDF print, so the chart on screen cannot call a colour something else.
   */
  const letters = useMemo(() => {
    const byIndex = []
    for (const entry of key) byIndex[entry.index] = entry.letter
    return byIndex
  }, [key])

  // --- exports ------------------------------------------------------------

  const exportPng = useCallback(async () => {
    const blob = await chartToPngBlob(chart, {
      cellPx: 14,
      grid: view.showGrid,
      // What you were looking at is what you get, letters included.
      letters: view.showLetters ? letters : null,
    })
    if (blob) downloadBlob(blob, suggestName(settings.sourceName, 'chart', 'png'))
  }, [chart, view.showGrid, view.showLetters, letters, settings.sourceName])

  const exportPdf = useCallback(async () => {
    // Yield a frame so the button can show its busy state before we block on a big chart.
    await new Promise((r) => setTimeout(r, 0))
    const bytes = buildChartPdf(chart, {
      title: settings.sourceName ? stripExtension(settings.sourceName) : 'Crochet chart',
      mode: settings.mode,
      startsOnRightSide: settings.startsOnRightSide,
    })
    downloadBlob(
      new Blob([bytes], { type: 'application/pdf' }),
      suggestName(settings.sourceName, 'chart', 'pdf'),
    )
  }, [chart, settings.sourceName, settings.mode, settings.startsOnRightSide])

  const copyPattern = useCallback(async () => {
    const text = patternText(chart, {
      startsOnRightSide: settings.startsOnRightSide,
      mode: settings.mode,
      title: settings.sourceName ? stripExtension(settings.sourceName) : '',
    })
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard blocked (insecure context, or the user said no) — hand them a file
      // instead of failing silently.
      downloadData(text, suggestName(settings.sourceName, 'pattern', 'txt'), 'text/plain')
    }
  }, [chart, settings.startsOnRightSide, settings.mode, settings.sourceName])

  // --- render -------------------------------------------------------------

  if (!source) {
    return <Dropzone onFile={openFile} busy={busy} error={error} />
  }

  return (
    /*
      Two layouts, not one. Wide enough for side-by-side, the app is a fixed-height
      workspace whose panes scroll independently. Narrower than that it stacks, and a
      fixed height would be actively harmful: the panel column is taller than the
      screen, so it squeezes the stage down to a sliver and the chart — the thing you
      came to look at — ends up a few pixels tall. Stacked, the page scrolls as a page.
    */
    <div className="flex min-h-[100dvh] flex-col lg:h-[100dvh]">
      <header
        className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}
      >
        <h1 className="mr-1 text-base font-bold tracking-tight">stitch-grid</h1>

        {/*
          Three modes, in the order you meet them: decide what to make, see what it will
          look like, then make it. Making is a mode rather than a separate page because
          it reads the same Chart as everything else — switching cannot alter a stitch.
        */}
        <div className="segmented" role="group" aria-label="Mode">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={view.mode === item.id}
              aria-label={`${item.label} mode`}
              onClick={() => setView((v) => ({ ...v, mode: item.id }))}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {designMode || makeMode ? (
            <>
              <button
                type="button"
                className="btn-ghost !min-h-11 !px-2.5"
                aria-label="Show counting grid"
                aria-pressed={view.showGrid}
                style={view.showGrid ? { color: 'var(--accent)' } : undefined}
                onClick={() => setView((v) => ({ ...v, showGrid: !v.showGrid }))}
              >
                <Grid3x3 className="h-4 w-4" />
              </button>
              {/*
                Letters are how the chart stays readable without relying on colour at
                all — the same reason the PDF has printed them from the first version.
                Off by default: in design mode you are judging how the picture reads,
                and a grid of letters over it gets in the way of exactly that.
              */}
              <button
                type="button"
                className="btn-ghost !min-h-11 !px-2.5"
                aria-label="Show colour letters"
                aria-pressed={view.showLetters}
                style={view.showLetters ? { color: 'var(--accent)' } : undefined}
                onClick={() => setView((v) => ({ ...v, showLetters: !v.showLetters }))}
              >
                <Type className="h-4 w-4" />
              </button>
            </>
          ) : null}
          {makeMode ? null : (
            <>
              <button
                type="button"
                className="btn-ghost !min-h-11 !px-2.5"
                aria-label={describeUndo(history)}
                disabled={!canUndo(history)}
                onClick={() => setHistory(undo)}
              >
                <Undo2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="btn-ghost !min-h-11 !px-2.5"
                aria-label="Reset all settings"
                onClick={() =>
                  setHistory((h) =>
                    reset(h, normalizeSettings({ ...DEFAULT_SETTINGS, sourceName: h.present.sourceName })),
                  )
                }
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </>
          )}
          {designMode ? (
            <button
              type="button"
              className="btn-ghost !min-h-11 !px-2.5 lg:hidden"
              aria-label={panelsOpen ? 'Hide controls' : 'Show controls'}
              onClick={() => setPanelsOpen((open) => !open)}
            >
              {panelsOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
            </button>
          ) : null}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-3 lg:flex-row">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {busy ? (
            <p className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink-2)' }}>
              <Loader2 className="h-4 w-4 animate-spin" /> Reading the picture…
            </p>
          ) : null}
          <Stage
            chart={chart}
            view={view}
            setView={setView}
            /* The grid is a counting aid, not part of the blanket, so preview mode
               drops it along with everything else you wouldn't see in the finished
               object. Making mode keeps it — that is when you are counting most. */
            showGrid={(designMode || makeMode) && view.showGrid}
            showRulers={designMode || makeMode}
            fullBleed={view.mode === 'preview'}
            mask={mask}
            marker={reading.mode === 'c2c' ? null : marker}
            letters={view.showLetters && (designMode || makeMode) ? letters : null}
          />
          {makeMode ? null : <Summary dim={dim} joins={joins} unit={settings.gauge.unit} />}
        </div>

        {/*
          Preview mode strips every affordance that wouldn't exist in the finished
          blanket — the controls, the counting grid, the rulers — so it answers "what
          will this look like on a couch?". Both modes render the identical chart, so
          switching is instant and cannot change the design.
        */}
        {designMode && panelsOpen ? (
          <div className="scroll-y flex w-full shrink-0 flex-col gap-3 lg:w-[22rem]">
            <CropPanel source={source} settings={settings} update={update} commit={endDrag} dim={dim} />
            <SizePanel settings={settings} update={update} commit={endDrag} dim={dim} layout={layout} />
            <GaugePanel settings={settings} update={update} dim={dim} />
            <PalettePanel settings={settings} update={update} commit={endDrag} chart={chart} />
            <AdjustPanel settings={settings} update={update} commit={endDrag} />
            <BorderPanel settings={settings} update={update} commit={endDrag} layout={layout} />
            <CleanupPanel settings={settings} update={update} flatArt={source.flatArt} />
            <ReadingPanel settings={settings} update={update} />
            <Legend entries={key} unit={settings.gauge.unit} />
            <ExportBar onPng={exportPng} onPdf={exportPdf} onCopy={copyPattern} disabled={!chart.stitches} />
          </div>
        ) : null}

        {makeMode && make ? (
          <div className="scroll-y flex w-full shrink-0 flex-col gap-3 lg:w-[22rem]">
            <Make
              chart={chart}
              make={make}
              setProgress={setProgress}
              letters={letters}
              mode={reading.mode}
              onRestart={() => setProgress(() => emptyProgress())}
            />
            <Legend entries={key} unit={settings.gauge.unit} />
          </div>
        ) : null}

        {view.mode === 'preview' ? (
          <div className="scroll-y flex w-full shrink-0 flex-col gap-3 lg:w-[22rem]">
            <Legend entries={key} unit={settings.gauge.unit} />
            <ExportBar onPng={exportPng} onPdf={exportPdf} onCopy={copyPattern} disabled={!chart.stitches} />
          </div>
        ) : null}
      </main>
    </div>
  )
}

const MODES = [
  { id: 'design', label: 'Design' },
  { id: 'preview', label: 'Preview' },
  { id: 'make', label: 'Make' },
]

function stripExtension(name) {
  return name.replace(/\.[^.]+$/, '')
}
