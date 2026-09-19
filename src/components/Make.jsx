/**
 * Making mode — the app's other half.
 *
 * Everything else here helps you decide what to crochet. This is the only screen you
 * look at while you actually crochet it, and it is designed for exactly one posture:
 * a tablet propped against the yarn bowl, read from two feet away, advanced by a
 * knuckle because both hands are full.
 *
 * So the current row is the biggest thing on screen, the button that advances it is
 * the biggest target, and nothing that isn't the current row competes for attention.
 * There are no sliders here on purpose — an accidental drag while you reach past the
 * screen must not be able to change the chart you are forty hours into.
 */

import { forwardRef, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Lightbulb, PartyPopper, RotateCcw } from 'lucide-react'
import { inkOn } from '../lib/color.js'
import {
  goToStep,
  isComplete,
  nextRun,
  nextStep,
  prevRun,
  prevStep,
  runRange,
} from '../lib/progress.js'
import { holdScreenAwake, wakeLockSupported } from '../lib/wakelock.js'

export default function Make({ chart, make, setProgress, letters, mode, onRestart }) {
  const { reading, progress, current, next, stats } = make
  const done = isComplete(progress, reading)
  const currentRunRef = useRef(null)
  const runListRef = useRef(null)

  // --- keyboard, for the rare session at a desk rather than on a sofa
  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const step = {
        ArrowRight: (p) => nextRun(p, reading),
        ' ': (p) => nextRun(p, reading),
        ArrowLeft: (p) => prevRun(p, reading),
        ArrowUp: (p) => nextStep(p, reading),
        ArrowDown: (p) => prevStep(p),
      }[event.key]

      if (step) {
        event.preventDefault()
        setProgress(step)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reading, setProgress])

  /**
   * Long rows run off the bottom of the list, so keep the run you're on in sight.
   *
   * Done by hand rather than with `scrollIntoView`, which scrolls every scrollable
   * ancestor — including the page. On a stacked phone or tablet layout that quietly
   * scrolls the chart off the top of the screen every time you tick a colour off,
   * which is the opposite of helpful. This moves the list and nothing else.
   */
  useEffect(() => {
    const item = currentRunRef.current
    const list = runListRef.current
    if (!item || !list) return
    const itemBox = item.getBoundingClientRect()
    const listBox = list.getBoundingClientRect()
    if (itemBox.top < listBox.top) list.scrollTop -= listBox.top - itemBox.top
    else if (itemBox.bottom > listBox.bottom) list.scrollTop += itemBox.bottom - listBox.bottom
  }, [progress.step, progress.runsDone])

  if (done) {
    return (
      <section className="panel p-4 text-center" aria-label="Finished">
        <PartyPopper className="mx-auto h-8 w-8" style={{ color: 'var(--accent)' }} aria-hidden="true" />
        <h2 className="mt-2 text-lg font-bold">All {stats.steps} rows worked</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--ink-2)' }}>
          {stats.stitches.toLocaleString()} stitches. Go and block it.
        </p>
        <button type="button" className="btn-secondary mt-4 w-full" onClick={onRestart}>
          <RotateCcw className="h-4 w-4" />
          Start this chart again
        </button>
      </section>
    )
  }

  return (
    <>
      <section className="panel p-4" aria-label="Current row">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="numeral text-xl font-bold leading-none">
            Row {current.row}
            <span className="ml-1.5 text-sm font-medium" style={{ color: 'var(--ink-3)' }}>
              of {stats.steps}
            </span>
          </h2>
          <span className="numeral text-sm font-semibold" style={{ color: 'var(--accent)' }}>
            {mode === 'c2c' ? current.phase : current.side} {current.direction}
          </span>
        </div>

        <ProgressBar percent={stats.percent} />

        <ol ref={runListRef} className="scroll-y mt-3 max-h-64 space-y-1.5 pr-1">
          {current.runs.map((run, index) => (
            <RunRow
              key={index}
              ref={index === progress.runsDone ? currentRunRef : null}
              run={run}
              colour={chart.palette[run.index]}
              letter={letters[run.index]}
              range={runRange(current, index, { mode, stitches: chart.stitches })}
              state={index < progress.runsDone ? 'done' : index === progress.runsDone ? 'current' : 'ahead'}
              onPick={() => setProgress((p) => ({ step: p.step, runsDone: index }))}
            />
          ))}
        </ol>

        <p className="numeral mt-2 text-center text-xs" style={{ color: 'var(--ink-3)' }}>
          {current.total} stitches in this row
        </p>

        <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
          <button
            type="button"
            className="btn-secondary !min-h-14 !px-4"
            aria-label="Back one colour run"
            onClick={() => setProgress((p) => prevRun(p, reading))}
            disabled={progress.step === 1 && progress.runsDone === 0}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="btn-primary !min-h-14 text-base"
            aria-label="Done with this colour run"
            onClick={() => setProgress((p) => nextRun(p, reading))}
          >
            <Check className="h-5 w-5" />
            {progress.runsDone + 1 >= current.runs.length ? 'Finish row' : 'Next colour'}
          </button>
        </div>

        <button
          type="button"
          className="btn-ghost mt-2 w-full"
          aria-label="Skip to the next row"
          onClick={() => setProgress((p) => nextStep(p, reading))}
        >
          Row {current.row} done
          <ArrowRight className="h-4 w-4" />
        </button>

        {next ? (
          <p className="mt-3 border-t pt-3 text-xs leading-relaxed" style={{ borderColor: 'var(--line)', color: 'var(--ink-3)' }}>
            <span className="label">Next</span>{' '}
            <span className="numeral">
              Row {next.row} ({mode === 'c2c' ? next.phase : next.side} {next.direction}):{' '}
              {next.runs.map((run) => `${run.count} ${chart.palette[run.index]?.name ?? '?'}`).join(', ')}
            </span>
          </p>
        ) : null}
      </section>

      <section className="panel p-4" aria-label="Progress">
        <h2 className="section-title">How far in</h2>
        <dl className="numeral mt-3 flex flex-wrap gap-x-6 gap-y-3">
          <Stat label="Done" value={`${Math.floor(stats.percent)}%`} note={`${stats.stepsDone} of ${stats.steps} rows`} />
          <Stat
            label="Stitches"
            value={stats.stitchesDone.toLocaleString()}
            note={`${stats.stitchesLeft.toLocaleString()} to go`}
          />
          {/* The honest measure of what's left: joins, not minutes. How long a blanket
              takes depends on the person, so this app will not print a time. */}
          <Stat label="Colour changes" value={stats.joinsLeft.toLocaleString()} note="still to come" />
        </dl>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <JumpToRow steps={stats.steps} current={current.row} onJump={(row) => setProgress(() => goToStep(row, reading))} />
          <button type="button" className="btn-ghost" onClick={onRestart} aria-label="Start this chart again">
            <RotateCcw className="h-4 w-4" />
            Start over
          </button>
        </div>

        <KeepAwake />

        <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          Your place is kept on this device for this exact chart. Change the design and
          you get a different chart — and a fresh row 1.
        </p>
      </section>
    </>
  )
}

function ProgressBar({ percent }) {
  return (
    <div
      className="mt-3 h-2 w-full overflow-hidden rounded-full"
      style={{ background: 'var(--surface-2)' }}
      role="progressbar"
      aria-valuenow={Math.floor(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Rows worked"
    >
      <div className="h-full rounded-full" style={{ width: `${percent}%`, background: 'var(--accent)' }} />
    </div>
  )
}

const RunRow = forwardRef(function RunRow({ run, colour, letter, range, state, onPick }, ref) {
  const rgb = colour?.rgb ?? [0, 0, 0]
  const [r, g, b] = inkOn(rgb)
  const done = state === 'done'
  const isCurrent = state === 'current'

  return (
    <li ref={ref}>
      <button
        type="button"
        className="flex w-full min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 text-left"
        style={{
          background: isCurrent ? 'var(--accent-soft)' : 'transparent',
          outline: isCurrent ? '2px solid var(--accent)' : 'none',
          opacity: done ? 0.45 : 1,
        }}
        aria-current={isCurrent ? 'step' : undefined}
        onClick={onPick}
      >
        <span
          className="swatch grid shrink-0 place-items-center text-xs font-bold"
          style={{ background: colour?.hex ?? '#000', color: `rgb(${r},${g},${b})` }}
          aria-hidden="true"
        >
          {letter}
        </span>
        <span className="min-w-0 flex-1">
          <span className="numeral block text-base font-semibold leading-tight">
            {run.count} <span className="font-medium">{colour?.name ?? 'Unknown'}</span>
          </span>
          {range ? (
            <span className="numeral text-xs" style={{ color: 'var(--ink-3)' }}>
              {range.from === range.to ? `stitch ${range.from}` : `stitches ${range.from}–${range.to}`}
            </span>
          ) : null}
        </span>
        {done ? <Check className="h-4 w-4 shrink-0" style={{ color: 'var(--ink-3)' }} aria-label="worked" /> : null}
      </button>
    </li>
  )
})

function JumpToRow({ steps, current, onJump }) {
  const [value, setValue] = useState('')

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        const row = Number(value)
        if (Number.isFinite(row) && row >= 1) onJump(Math.min(steps, Math.round(row)))
        setValue('')
      }}
    >
      <label className="block">
        <span className="label block">Go to row</span>
        {/* 16px minimum, like every field here: anything smaller makes iOS zoom the
            page the moment it gets focus. */}
        <input
          className="field mt-1 w-24"
          type="number"
          inputMode="numeric"
          min={1}
          max={steps}
          placeholder={String(current)}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <button type="submit" className="btn-secondary" disabled={!value}>
        Go
      </button>
    </form>
  )
}

/**
 * The screen blanking mid-row is the single most irritating thing about following a
 * chart on a tablet, and the fix is one API call — but it is not available everywhere,
 * so the control only appears where it will actually do something.
 */
function KeepAwake() {
  const [awake, setAwake] = useState(false)
  const release = useRef(null)

  useEffect(() => () => release.current?.(), [])

  if (!wakeLockSupported()) return null

  return (
    <button
      type="button"
      className="btn-ghost mt-3 w-full"
      aria-pressed={awake}
      style={awake ? { color: 'var(--accent)' } : undefined}
      onClick={() => {
        if (release.current) {
          release.current()
          release.current = null
          setAwake(false)
        } else {
          release.current = holdScreenAwake(setAwake)
        }
      }}
    >
      <Lightbulb className="h-4 w-4" />
      {awake ? 'Screen staying awake' : 'Keep screen awake'}
    </button>
  )
}

function Stat({ label, value, note }) {
  return (
    <div className="min-w-[5.5rem]">
      <dt className="label">{label}</dt>
      <dd className="text-base font-semibold leading-tight">{value}</dd>
      <dd className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
        {note}
      </dd>
    </div>
  )
}
