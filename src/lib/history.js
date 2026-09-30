/**
 * Undo, as a stack of whole settings snapshots.
 *
 * Snapshots rather than a command log, for one reason above the others: the state is
 * tiny. Settings serialise to under a kilobyte and the Chart is derived and never
 * stored, so sixty steps of history is sixty kilobytes. A command log's only real
 * advantage is memory, and there is no memory problem to solve — while its costs are
 * real: every verb needs a correct inverse forever, and "set max colours to 8" has no
 * inverse without storing the old value, at which point you have snapshots anyway.
 *
 * Two scoping decisions that make the difference between undo feeling useful and
 * feeling broken:
 *
 *   - Zoom and grid visibility are NOT committed. They're how you're looking at the
 *     design, not the design. Undo should step back through your edits, not your looks.
 *   - Loading a new image clears the stack. It's a new document.
 */

export const MAX_HISTORY = 60

/** A drag emits a couple of hundred events and must land as ONE undo step. */
export const COALESCE_MS = 600

/** Entries carry the label of the edit that PRODUCED them, so undo can name itself. */
export function emptyHistory(settings) {
  return { past: [], present: settings, presentLabel: null, future: [], lastAt: 0 }
}

/**
 * Record a change.
 * @param label groups rapid consecutive edits AND names the undo button, so it reads
 *              "Undo detail" rather than "Undo".
 */
export function commit(history, next, label, now = Date.now()) {
  if (next === history.present) return history

  // A continuing drag replaces the present in place instead of stacking a step.
  if (label != null && label === history.presentLabel && now - history.lastAt < COALESCE_MS) {
    return { ...history, present: next, future: [], lastAt: now }
  }

  const past = [...history.past, { value: history.present, label: history.presentLabel }]
  return {
    past: past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past,
    present: next,
    presentLabel: label,
    future: [],
    lastAt: now,
  }
}

export function canUndo(history) {
  return history.past.length > 0
}

export function canRedo(history) {
  return history.future.length > 0
}

export function undo(history) {
  if (!canUndo(history)) return history
  const entry = history.past[history.past.length - 1]
  return {
    past: history.past.slice(0, -1),
    present: entry.value,
    presentLabel: entry.label,
    future: [{ value: history.present, label: history.presentLabel }, ...history.future],
    lastAt: 0,
  }
}

export function redo(history) {
  if (!canRedo(history)) return history
  const [entry, ...future] = history.future
  return {
    past: [...history.past, { value: history.present, label: history.presentLabel }],
    present: entry.value,
    presentLabel: entry.label,
    future,
    lastAt: 0,
  }
}

/** Reset is an ordinary commit, which is what makes it undoable like anything else. */
export function reset(history, defaults, now = Date.now()) {
  return commit(history, defaults, 'reset', now)
}

/** What the undo button should say — it names the edit it is about to take back. */
export function describeUndo(history) {
  return canUndo(history) && history.presentLabel ? `Undo ${history.presentLabel}` : 'Undo'
}

/**
 * And what redo should say. It names the edit it is about to put BACK, which lives on
 * the entry being restored rather than on the present one — the mirror of undo, where
 * the label travels with the state it produced.
 */
export function describeRedo(history) {
  const next = history.future[0]
  return canRedo(history) && next?.label ? `Redo ${next.label}` : 'Redo'
}
