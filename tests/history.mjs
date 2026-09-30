/**
 * Undo, and the settings it carries.
 */

import {
  MAX_HISTORY,
  canRedo,
  canUndo,
  commit,
  describeRedo,
  describeUndo,
  emptyHistory,
  redo,
  reset,
  undo,
} from '../src/lib/history.js'
import { DEFAULT_SETTINGS, normalizeSettings, settingsKey } from '../src/lib/settings.js'

export default async function run({ check }) {
  // --- settings are clamped, never trusted
  const wild = normalizeSettings({
    detailPx: 900,
    maxColors: -4,
    despeckle: 99,
    fit: 'sideways',
    subsetId: 'nope',
    border: { inches: -3, colorId: 'not-a-colour' },
    locked: ['cream', 'fake'],
    swaps: { cream: 'fake', sage: 'moss' },
    adjust: { brightness: 5 },
  })
  check.is('detail is clamped to the slider range', wild.detailPx, 50)
  check.is('colour count is clamped up', wild.maxColors, 2)
  check.is('despeckle is clamped', wild.despeckle, 2)
  check.is('an unknown fit falls back', wild.fit, 'contain')
  check.is('an unknown subset falls back', wild.subsetId, 'all')
  check.is('a negative border becomes zero', wild.border.inches, 0)
  check.is('an unknown border colour falls back', wild.border.colorId, 'cream')
  check.is('unknown locked colours are dropped', wild.locked.join(','), 'cream')
  check.is('unknown swaps are dropped', Object.keys(wild.swaps).join(','), 'sage')
  check.is('adjustments are clamped', wild.adjust.brightness, 1)
  check('normalizing garbage never throws', normalizeSettings(null) !== null)
  check('normalizing a string never throws', normalizeSettings('nonsense').detailPx === DEFAULT_SETTINGS.detailPx)

  // --- the chart cache key
  const base = normalizeSettings(DEFAULT_SETTINGS)
  check.is('the same settings key the same', settingsKey(base, 'a'), settingsKey(base, 'a'))
  check('a different source is a different key', settingsKey(base, 'a') !== settingsKey(base, 'b'))
  check(
    'changing detail changes the key',
    settingsKey({ ...base, detailPx: 20 }, 'a') !== settingsKey(base, 'a'),
  )
  check(
    'changing gauge changes the key',
    settingsKey({ ...base, gauge: { ...base.gauge, rowsPer4: 7 } }, 'a') !== settingsKey(base, 'a'),
  )
  /**
   * Reading a chart corner-to-corner does not move a single stitch, so switching modes
   * must not throw away the built chart.
   */
  check.is(
    'switching to c2c does NOT rebuild the chart',
    settingsKey({ ...base, mode: 'c2c' }, 'a'),
    settingsKey(base, 'a'),
  )

  // --- the stack
  let h = emptyHistory({ n: 0 })
  check('a fresh history cannot undo', !canUndo(h))
  check('a fresh history cannot redo', !canRedo(h))
  check.is('and the button just says Undo', describeUndo(h), 'Undo')

  h = commit(h, { n: 1 }, 'detail', 1000)
  check('after one edit undo is available', canUndo(h))
  check.is('the button names the edit', describeUndo(h), 'Undo detail')

  h = commit(h, { n: 2 }, 'gauge', 5000)
  check.is('two edits, two steps', h.past.length, 2)
  check.is('the button names the most recent edit', describeUndo(h), 'Undo gauge')

  h = undo(h)
  check.is('undo steps back', h.present.n, 1)
  check('and offers a redo', canRedo(h))
  check.is('and now names the earlier edit', describeUndo(h), 'Undo detail')

  h = redo(h)
  check.is('redo steps forward again', h.present.n, 2)

  // --- coalescing: a drag is ONE undo step, not two hundred
  let drag = emptyHistory({ n: 0 })
  for (let i = 1; i <= 200; i++) drag = commit(drag, { n: i }, 'detail', 1000 + i)
  check.is('a 200-event drag is a single undo step', drag.past.length, 1)
  check.is('and lands on the final value', drag.present.n, 200)
  drag = undo(drag)
  check.is('undoing the drag returns to before it started', drag.present.n, 0)

  // A pause between edits breaks the coalescing.
  let paused = emptyHistory({ n: 0 })
  paused = commit(paused, { n: 1 }, 'detail', 1000)
  paused = commit(paused, { n: 2 }, 'detail', 5000)
  check.is('a pause starts a new undo step', paused.past.length, 2)

  // A different control never coalesces with the previous one.
  let mixed = emptyHistory({ n: 0 })
  mixed = commit(mixed, { n: 1 }, 'detail', 1000)
  mixed = commit(mixed, { n: 2 }, 'gauge', 1100)
  check.is('different controls never merge', mixed.past.length, 2)

  // --- a new edit clears the redo branch
  let branch = emptyHistory({ n: 0 })
  branch = commit(branch, { n: 1 }, 'a', 1000)
  branch = commit(branch, { n: 2 }, 'b', 5000)
  branch = undo(branch)
  branch = commit(branch, { n: 9 }, 'c', 9000)
  check('editing after an undo drops the redo branch', !canRedo(branch))

  // --- bounds
  let deep = emptyHistory({ n: 0 })
  for (let i = 1; i <= MAX_HISTORY + 40; i++) deep = commit(deep, { n: i }, `edit${i}`, i * 10000)
  check('the stack is bounded', deep.past.length <= MAX_HISTORY, `${deep.past.length}`)
  check('and still undoes', undo(deep).present.n === MAX_HISTORY + 39)

  // --- undo at the ends is a no-op, not a crash
  let edge = emptyHistory({ n: 0 })
  check.is('undo on an empty history is a no-op', undo(edge).present.n, 0)
  check.is('redo on an empty history is a no-op', redo(edge).present.n, 0)

  // --- reset is an ordinary, undoable edit
  let r = emptyHistory({ n: 5 })
  r = commit(r, { n: 6 }, 'detail', 1000)
  r = reset(r, { n: 0 }, 9000)
  check.is('reset sets the defaults', r.present.n, 0)
  check('reset is itself undoable', canUndo(r))
  check.is('and undoing it restores what you had', undo(r).present.n, 6)

  // --- committing the same value changes nothing
  const same = { n: 1 }
  let stable = emptyHistory(same)
  stable = commit(stable, same, 'detail', 1000)
  check.is('committing an identical value adds no step', stable.past.length, 0)

  // --- redo names itself the same way undo does
  let labelled = emptyHistory({ n: 0 })
  check.is('with nothing to redo the button just says Redo', describeRedo(labelled), 'Redo')
  labelled = commit(labelled, { n: 1 }, 'detail', 1000)
  labelled = commit(labelled, { n: 2 }, 'gauge', 5000)
  labelled = undo(labelled)
  check.is('after undoing, redo names the edit it would put back', describeRedo(labelled), 'Redo gauge')
  labelled = undo(labelled)
  check.is('and stepping back again names the next one along', describeRedo(labelled), 'Redo detail')
  labelled = redo(labelled)
  check.is('redoing moves the label on', describeRedo(labelled), 'Redo gauge')
  labelled = redo(labelled)
  check.is('and the far end says Redo again', describeRedo(labelled), 'Redo')
  check('with nothing left to redo', !canRedo(labelled))
}
