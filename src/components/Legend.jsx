/**
 * The shopping list. Letter, swatch, name, how much of the chart it covers, and roughly
 * how much yarn to buy.
 */

import { inkOn } from '../lib/color.js'

export default function Legend({ entries, unit }) {
  if (!entries?.length) return null
  return (
    <section className="panel p-4" aria-label="Colour key">
      <h2 className="section-title">Colour key</h2>
      <ul className="mt-3 space-y-2">
        {entries.map((entry) => (
          <li key={entry.colour.id} className="flex items-center gap-3">
            <span
              className="swatch grid place-items-center text-xs font-bold"
              style={{ background: entry.colour.hex, color: `rgb(${inkOn(entry.colour.rgb).join(',')})` }}
              aria-hidden="true"
            >
              {entry.letter}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{entry.colour.name}</span>
              <span className="numeral text-xs" style={{ color: 'var(--ink-3)' }}>
                {entry.cells.toLocaleString()} stitches · {entry.percent.toFixed(1)}%
              </span>
            </span>
            <span className="numeral shrink-0 text-right text-xs" style={{ color: 'var(--ink-2)' }}>
              ~{Math.ceil(unit === 'cm' ? entry.yards * 0.9144 : entry.yards)}
              <span className="block" style={{ color: 'var(--ink-3)' }}>
                {unit === 'cm' ? 'm' : 'yd'}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--ink-3)' }}>
        Yarn amounts are a rough guess from your gauge — real use depends on your tension
        and how you carry colours. Buy about 20% more than this.
      </p>
    </section>
  )
}
