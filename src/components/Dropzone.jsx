/**
 * The empty state, and the way a picture gets in.
 *
 * Drag and drop plus a file input. Nothing is uploaded anywhere — the file is decoded
 * in the page and never leaves the device, which is worth saying out loud because
 * "upload your photo" is what every other tool of this kind asks for.
 */

import { useEffect, useRef, useState } from 'react'
import { ImagePlus, ShieldCheck, Ruler, Printer, RotateCcw, X } from 'lucide-react'
import { ACCEPTED } from '../lib/image.js'

export default function Dropzone({ onFile, busy, error, resumable, onResume, onForget }) {
  const input = useRef(null)
  const [over, setOver] = useState(false)

  const take = (file) => {
    if (file) onFile(file)
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">stitch-grid</h1>
        <p className="mt-2 text-base leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          Turn a photo into a crochet chart that comes out the right shape.
        </p>
      </header>

      {resumable ? <Resume entry={resumable} busy={busy} onResume={onResume} onForget={onForget} /> : null}

      <div
        className="dropzone flex flex-col items-center justify-center gap-4 px-6 py-14 text-center"
        data-over={over}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          take(e.dataTransfer.files?.[0])
        }}
      >
        <ImagePlus className="h-10 w-10" style={{ color: 'var(--ink-3)' }} aria-hidden="true" />
        <div>
          <p className="text-lg font-semibold">Drop a picture here</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-3)' }}>
            JPG, PNG or WebP
          </p>
        </div>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Reading…' : 'Choose a picture'}
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          aria-label="Choose a picture"
          onChange={(e) => {
            take(e.target.files?.[0])
            // Clearing lets the same file be picked twice in a row.
            e.target.value = ''
          }}
        />
      </div>

      {error ? (
        <p
          className="rounded-xl px-4 py-3 text-sm"
          role="alert"
          style={{ background: 'var(--attention-soft)', color: 'var(--attention)' }}
        >
          {error}
        </p>
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-3">
        <Point icon={Ruler} title="Shaped by your gauge">
          A stitch is wider than a row is tall. This works in your real gauge, so circles
          stay round and the finished size is the one it tells you.
        </Point>
        <Point icon={Printer} title="A chart you can follow">
          Print a numbered chart with a colour key, plus row-by-row instructions and a
          rough yarn estimate for each colour.
        </Point>
        <Point icon={ShieldCheck} title="Stays on your device">
          The picture is never uploaded. Everything happens in this browser tab, and it
          keeps working with no signal.
        </Point>
      </ul>
    </div>
  )
}

function Point({ icon: Icon, title, children }) {
  return (
    <li className="panel p-4">
      <Icon className="h-5 w-5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
      <h2 className="mt-2 text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }}>
        {children}
      </p>
    </li>
  )
}

/**
 * The last picture, offered back.
 *
 * Above the dropzone rather than instead of it, because starting something new is still
 * the commonest reason anybody opens this — and because restoring silently is the thing
 * that would make a shared tablet unpleasant. The thumbnail is the point: a filename
 * alone ("IMG_4471.jpeg") tells nobody whether this is the chart they were forty hours
 * into or a photo they tried once and abandoned.
 */
function Resume({ entry, busy, onResume, onForget }) {
  const [thumb, setThumb] = useState('')

  /*
    An object URL holds the Blob alive until it is revoked, and this component is on the
    screen for as long as the empty state is. Revoked on the way out, and keyed on the
    file so swapping pictures cannot leak the previous one.
  */
  useEffect(() => {
    if (!entry?.file) return undefined
    const url = URL.createObjectURL(entry.file)
    setThumb(url)
    return () => URL.revokeObjectURL(url)
  }, [entry?.file])

  return (
    <div className="panel flex flex-wrap items-center gap-3 p-3">
      <img
        src={thumb}
        alt=""
        className="h-16 w-16 shrink-0 rounded-lg object-cover"
        style={{ background: 'var(--surface-2)' }}
      />
      <div className="min-w-0 flex-1 basis-40">
        <p className="text-sm font-semibold">Pick up where you left off</p>
        <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--ink-2)' }} title={entry.name}>
          {entry.name}
        </p>
        {/* Its own line, not tacked onto the filename: a long name truncates, and this is
            the one part of the card that must never be the bit that gets cut off. */}
        <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
          kept on this device only
        </p>
      </div>
      <div className="flex flex-1 items-center justify-end gap-2">
        <button type="button" className="btn-primary" disabled={busy} onClick={onResume}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Resume
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={onForget}
          aria-label={`Forget ${entry.name}`}
          title="Forget this picture"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
