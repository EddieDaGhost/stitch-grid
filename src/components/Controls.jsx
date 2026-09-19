/**
 * Every design control. Split into small panels but kept in one file — they share a
 * lot of small primitives and none of them is big enough to earn its own module.
 */

import { Lock, Ban, ArrowLeftRight, RotateCcw } from 'lucide-react'
import { PALETTE, SUBSETS, chartLetter } from '../config/palette.js'
import { STITCH_PRESETS } from '../config/gauge.js'
import { MAX_COLORS, MAX_DETAIL, MIN_COLORS, MIN_DETAIL } from '../lib/settings.js'
import { formatSize } from '../lib/gauge.js'

/* ---------------------------------------------------------------- primitives */

export function Panel({ title, hint, children }) {
  return (
    /* Named, so each panel is a landmark a screen reader can jump between — and so the
       browser suite can scope an assertion to one panel rather than the whole page. */
    <section className="panel p-4" aria-label={title}>
      <h2 className="section-title">{title}</h2>
      {hint ? (
        <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          {hint}
        </p>
      ) : null}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}

function Slider({ label, value, min, max, step = 1, onChange, onCommit, readout }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="label">{label}</span>
        {readout ? (
          <span className="numeral text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>
            {readout}
          </span>
        ) : null}
      </div>
      <input
        type="range"
        className="slider mt-0.5"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
    </div>
  )
}

function NumberField({ label, value, min, max, onChange, suffix }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <span className="mt-1 flex items-center gap-2">
        <input
          type="number"
          className="field numeral"
          aria-label={label}
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            const next = Number(e.target.value)
            if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)))
          }}
        />
        {suffix ? (
          <span className="shrink-0 text-xs" style={{ color: 'var(--ink-3)' }}>
            {suffix}
          </span>
        ) : null}
      </span>
    </label>
  )
}

function Segmented({ label, value, options, onChange }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="segmented mt-1 w-full" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="flex-1"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function ColorSelect({ label, value, onChange }) {
  const current = PALETTE.find((p) => p.id === value)
  return (
    <label className="block">
      <span className="label">{label}</span>
      <span className="mt-1 flex items-center gap-2">
        <span className="swatch" style={{ background: current?.hex ?? '#fff' }} aria-hidden="true" />
        <select className="field" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
          {PALETTE.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </span>
    </label>
  )
}

/* ------------------------------------------------------------------- panels */

export function GaugePanel({ settings, update, dim }) {
  const preset = STITCH_PRESETS.find(
    (p) => p.stitchesPer4 === settings.gauge.stitchesPer4 && p.rowsPer4 === settings.gauge.rowsPer4,
  )

  return (
    <Panel
      title="Your gauge"
      hint="Crochet stitches aren't square, so this decides the shape of the finished blanket — not just its size. Swatch and measure for the truest result."
    >
      <label className="block">
        <span className="label">Stitch</span>
        <select
          className="field mt-1"
          aria-label="Stitch type"
          value={preset?.id ?? 'custom'}
          onChange={(e) => {
            const next = STITCH_PRESETS.find((p) => p.id === e.target.value)
            if (next) {
              update(
                (s) => ({
                  ...s,
                  gauge: { ...s.gauge, stitchesPer4: next.stitchesPer4, rowsPer4: next.rowsPer4 },
                }),
                'stitch type',
              )
            }
          }}
        >
          {STITCH_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          {preset ? null : <option value="custom">Custom</option>}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Stitches per 4 inches"
          value={settings.gauge.stitchesPer4}
          min={4}
          max={60}
          onChange={(v) => update((s) => ({ ...s, gauge: { ...s.gauge, stitchesPer4: v } }), 'gauge')}
        />
        <NumberField
          label="Rows per 4 inches"
          value={settings.gauge.rowsPer4}
          min={4}
          max={60}
          onChange={(v) => update((s) => ({ ...s, gauge: { ...s.gauge, rowsPer4: v } }), 'gauge')}
        />
      </div>

      <Segmented
        label="Units"
        value={settings.gauge.unit}
        options={[
          { value: 'in', label: 'Inches' },
          { value: 'cm', label: 'Centimetres' },
        ]}
        onChange={(v) => update((s) => ({ ...s, gauge: { ...s.gauge, unit: v } }), 'units')}
      />

      {dim ? (
        <p className="numeral text-xs" style={{ color: 'var(--ink-2)' }}>
          One stitch is {(4 / settings.gauge.stitchesPer4).toFixed(2)}" wide and{' '}
          {(4 / settings.gauge.rowsPer4).toFixed(2)}" tall.
        </p>
      ) : null}
    </Panel>
  )
}

export function SizePanel({ settings, update, commit, dim, layout }) {
  const targeted = Boolean(settings.target)

  return (
    <Panel title="Size">
      <Slider
        label="Detail"
        min={MIN_DETAIL}
        max={MAX_DETAIL}
        value={MAX_DETAIL + MIN_DETAIL - settings.detailPx}
        onChange={(v) => update((s) => ({ ...s, detailPx: MAX_DETAIL + MIN_DETAIL - v }), 'detail')}
        onCommit={commit}
        readout={dim ? `${dim.stitches} sts × ${dim.rows} rows` : null}
      />

      {dim ? (
        <p className="numeral text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          {formatSize(dim, settings.gauge.unit)}
        </p>
      ) : null}

      {layout?.clamped ? (
        <p
          className="rounded-lg px-3 py-2 text-xs leading-relaxed"
          style={{ background: 'var(--attention-soft)', color: 'var(--attention)' }}
        >
          That's as fine as it goes — 250 stitches is already about five feet of worsted
          weight. Turn the detail down, or use a finer yarn.
        </p>
      ) : null}

      <Segmented
        label="Chart size"
        value={targeted ? 'target' : 'auto'}
        options={[
          { value: 'auto', label: 'From the photo' },
          { value: 'target', label: 'A size I choose' },
        ]}
        onChange={(v) =>
          update(
            (s) => ({
              ...s,
              target: v === 'target' ? { stitches: dim?.stitches ?? 60, rows: dim?.rows ?? 70 } : null,
            }),
            'chart size',
          )
        }
      />

      {targeted ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Stitches across"
              value={settings.target.stitches}
              min={2}
              max={250}
              onChange={(v) => update((s) => ({ ...s, target: { ...s.target, stitches: v } }), 'chart size')}
            />
            <NumberField
              label="Rows tall"
              value={settings.target.rows}
              min={1}
              max={400}
              onChange={(v) => update((s) => ({ ...s, target: { ...s.target, rows: v } }), 'chart size')}
            />
          </div>
          {/*
            Deliberately NOT labelled "keep ratio / stretch". Gauge correction applies in
            all three; a "keep ratio" label makes people think the others turn it off.

            "Fill the grid" now crops rather than squashes, which is what people meant by
            it all along — squashing a picture to fill a grid turns every circle in it
            into an oval, the exact failure this app exists to prevent on the fabric
            side. Stretching is still there for anyone who wants it, named for what it
            actually does.
          */}
          <Segmented
            label="Fit the picture"
            value={settings.fit}
            options={[
              { value: 'contain', label: 'Whole picture' },
              { value: 'cover', label: 'Fill the grid' },
              { value: 'stretch', label: 'Stretch' },
            ]}
            onChange={(v) => update((s) => ({ ...s, fit: v }), 'fit')}
          />
          {settings.fit === 'cover' ? (
            <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-3)' }}>
              The picture is cropped to the shape of the grid. Adjust the framing above to
              choose which part survives.
            </p>
          ) : null}
          {settings.fit === 'stretch' ? (
            <p
              className="rounded-lg px-3 py-2 text-xs leading-relaxed"
              style={{ background: 'var(--attention-soft)', color: 'var(--attention)' }}
            >
              This squashes the picture to fit. Circles in it will come out as ovals —
              "Fill the grid" crops instead, which usually looks better.
            </p>
          ) : null}
          {settings.fit === 'contain' ? (
            <ColorSelect
              label="Fill the spare space with"
              value={settings.padColorId}
              onChange={(v) => update((s) => ({ ...s, padColorId: v }), 'fill colour')}
            />
          ) : null}
        </>
      ) : null}
    </Panel>
  )
}

export function BorderPanel({ settings, update, commit, layout }) {
  return (
    <Panel
      title="Border"
      hint="Added around the picture as extra rows and stitches. The picture itself is never squashed to make room."
    >
      <Slider
        label="Border width"
        min={0}
        max={24}
        value={Math.round(settings.border.inches * 4)}
        onChange={(v) => update((s) => ({ ...s, border: { ...s.border, inches: v / 4 } }), 'border')}
        onCommit={commit}
        readout={
          settings.border.inches
            ? `${settings.border.inches}" · ${layout?.border.sts ?? 0} sts, ${layout?.border.rows ?? 0} rows`
            : 'None'
        }
      />
      {settings.border.inches > 0 ? (
        <ColorSelect
          label="Border colour"
          value={settings.border.colorId}
          onChange={(v) => update((s) => ({ ...s, border: { ...s.border, colorId: v } }), 'border colour')}
        />
      ) : null}
    </Panel>
  )
}

export function PalettePanel({ settings, update, commit, chart }) {
  const used = chart?.palette ?? []

  const toggle = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  return (
    <Panel
      title="Colours"
      hint="Fewer colours means fewer skeins to buy and fewer ends to weave in."
    >
      <label className="block">
        <span className="label">Choose from</span>
        <select
          className="field mt-1"
          aria-label="Colour range"
          value={settings.subsetId}
          onChange={(e) => update((s) => ({ ...s, subsetId: e.target.value }), 'colour range')}
        >
          {SUBSETS.map((subset) => (
            <option key={subset.id} value={subset.id}>
              {subset.label}
            </option>
          ))}
        </select>
      </label>

      <Slider
        label="Maximum colours"
        min={MIN_COLORS}
        max={MAX_COLORS}
        value={settings.maxColors}
        onChange={(v) => update((s) => ({ ...s, maxColors: v }), 'colour count')}
        onCommit={commit}
        readout={`${settings.maxColors}`}
      />

      {used.length ? (
        <ul className="space-y-1.5">
          {used.map((entry, index) => {
            const locked = settings.locked.includes(entry.id)
            const swappedTo = settings.swaps[entry.id]
            return (
              <li key={entry.id} className="flex items-center gap-2">
                <span className="swatch" style={{ background: entry.hex }} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{entry.name}</span>
                  <span className="numeral text-xs" style={{ color: 'var(--ink-3)' }}>
                    {chartLetter(index)}
                    {swappedTo ? ` → ${PALETTE.find((p) => p.id === swappedTo)?.name}` : ''}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn-ghost !min-h-11 !px-2.5"
                  aria-label={`${locked ? 'Stop keeping' : 'Always keep'} ${entry.name}`}
                  aria-pressed={locked}
                  title="Always keep this colour, even when limiting the count"
                  style={locked ? { color: 'var(--accent)' } : undefined}
                  onClick={() => update((s) => ({ ...s, locked: toggle(s.locked, entry.id) }), 'kept colours')}
                >
                  <Lock className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="btn-ghost !min-h-11 !px-2.5"
                  aria-label={`Do not use ${entry.name}`}
                  title="Never use this colour"
                  onClick={() =>
                    update((s) => ({ ...s, excluded: toggle(s.excluded, entry.id) }), 'excluded colours')
                  }
                >
                  <Ban className="h-4 w-4" />
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}

      {settings.excluded.length ? (
        <button
          type="button"
          className="btn-secondary w-full"
          onClick={() => update((s) => ({ ...s, excluded: [] }), 'excluded colours')}
        >
          <RotateCcw className="h-4 w-4" />
          Allow all {settings.excluded.length} hidden colours again
        </button>
      ) : null}
    </Panel>
  )
}

export function AdjustPanel({ settings, update, commit }) {
  const set = (key) => (v) => update((s) => ({ ...s, adjust: { ...s.adjust, [key]: v / 100 } }), key)
  return (
    <Panel
      title="Picture"
      hint="Yarn has a much narrower range of colour than a photo. Nudging these often does more for the result than anything else here."
    >
      <Slider
        label="Brightness"
        min={-50}
        max={50}
        value={Math.round(settings.adjust.brightness * 100)}
        onChange={set('brightness')}
        onCommit={commit}
        readout={`${Math.round(settings.adjust.brightness * 100)}`}
      />
      <Slider
        label="Contrast"
        min={-50}
        max={50}
        value={Math.round(settings.adjust.contrast * 100)}
        onChange={set('contrast')}
        onCommit={commit}
        readout={`${Math.round(settings.adjust.contrast * 100)}`}
      />
      <Slider
        label="Saturation"
        min={-100}
        max={100}
        value={Math.round(settings.adjust.saturation * 100)}
        onChange={set('saturation')}
        onCommit={commit}
        readout={`${Math.round(settings.adjust.saturation * 100)}`}
      />
    </Panel>
  )
}

export function CleanupPanel({ settings, update, flatArt }) {
  return (
    <Panel title="Tidying up">
      <Segmented
        label="What is this picture?"
        value={settings.sampling}
        options={[
          { value: 'area', label: 'A photo' },
          { value: 'nearest', label: 'Flat art' },
        ]}
        onChange={(v) => update((s) => ({ ...s, sampling: v }), 'picture type')}
      />
      {flatArt && settings.sampling === 'area' ? (
        <p className="text-xs leading-relaxed" style={{ color: 'var(--attention)' }}>
          This looks like flat artwork. Switching to "Flat art" keeps the edges hard
          instead of blending a third colour along them.
        </p>
      ) : null}

      <Segmented
        label="Stray stitches"
        value={String(settings.despeckle)}
        options={[
          { value: '0', label: 'Keep' },
          { value: '1', label: 'Tidy' },
          { value: '2', label: 'Tidy more' },
        ]}
        onChange={(v) => update((s) => ({ ...s, despeckle: Number(v) }), 'stray stitches')}
      />
      <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-3)' }}>
        A single stitch of its own colour costs you a join, a cut and two ends to weave
        in. Tidying removes the ones that aren't earning it.
      </p>
    </Panel>
  )
}

export function ReadingPanel({ settings, update }) {
  return (
    <Panel title="How you'll work it">
      <Segmented
        label="Method"
        value={settings.mode}
        options={[
          { value: 'rows', label: 'In rows' },
          { value: 'c2c', label: 'Corner to corner' },
        ]}
        onChange={(v) => update((s) => ({ ...s, mode: v }), 'method')}
      />
      <Segmented
        label="Row 1 is the"
        value={settings.startsOnRightSide ? 'rs' : 'ws'}
        options={[
          { value: 'rs', label: 'Right side' },
          { value: 'ws', label: 'Wrong side' },
        ]}
        onChange={(v) => update((s) => ({ ...s, startsOnRightSide: v === 'rs' }), 'first row')}
      />
      <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-3)' }}>
        {settings.mode === 'c2c'
          ? 'Corner to corner is read on the diagonal, increasing to the widest point and then decreasing.'
          : 'Worked bottom-up. Row 1 is the bottom of the picture, and odd rows are worked right to left.'}
      </p>
    </Panel>
  )
}

export { ArrowLeftRight }
