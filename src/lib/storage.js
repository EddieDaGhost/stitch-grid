/**
 * Remembering settings between visits. DOM.
 *
 * Settings only — never the image. A photo would blow the localStorage quota, and
 * re-opening the app to somebody else's half-finished blanket would be worse than
 * re-opening it empty.
 *
 * Every read validates and falls back rather than throwing. A corrupt key should never
 * white-screen the app; the worst it should cost you is your gauge.
 */

import { DEFAULT_SETTINGS, normalizeSettings } from './settings.js'

const KEY = 'stitch-grid/settings/v1'

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return normalizeSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings) {
  try {
    // The source name belongs to one picture, not to the next session.
    const { sourceName, ...rest } = settings
    localStorage.setItem(KEY, JSON.stringify(rest))
  } catch {
    // Private browsing, a full quota — not worth interrupting anybody over.
  }
}

/**
 * Where you got to, per chart.
 *
 * Keyed by `chartHash`, not by a session or a slot, and that choice is the whole
 * design. Change the detail slider and you have a different chart, so the old position
 * is meaningless and must not be restored onto it — but come back to the same chart
 * tomorrow, from the same settings and the same photo, and the hash matches and you are
 * exactly where you left off. Re-deriving the key from the chart is what makes that
 * work without storing a project file, an account or the picture itself.
 *
 * A handful of charts are remembered, oldest evicted first. Someone who tries four
 * colourways of the same blanket should not lose their place in the one they committed
 * to, and thirty-odd bytes each means there is no reason to keep only one.
 */
const PROGRESS_KEY = 'stitch-grid/progress/v1'
const REMEMBERED_CHARTS = 8

function readProgressMap() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** The stored position for a chart, or null. Unvalidated — `normalizeProgress` clamps. */
export function loadProgress(chartId) {
  if (!chartId) return null
  const entry = readProgressMap()[chartId]
  return entry && typeof entry === 'object' ? { step: entry.step, runsDone: entry.runsDone } : null
}

export function saveProgress(chartId, progress) {
  if (!chartId) return
  try {
    const map = readProgressMap()
    map[chartId] = { step: progress.step, runsDone: progress.runsDone, at: Date.now() }

    const ids = Object.keys(map)
    if (ids.length > REMEMBERED_CHARTS) {
      ids
        .sort((a, b) => (map[a].at ?? 0) - (map[b].at ?? 0))
        .slice(0, ids.length - REMEMBERED_CHARTS)
        .forEach((id) => delete map[id])
    }

    localStorage.setItem(PROGRESS_KEY, JSON.stringify(map))
  } catch {
    // Private browsing, a full quota. Losing your place is a shame, not a crash.
  }
}

export function clearProgress(chartId) {
  if (!chartId) return
  try {
    const map = readProgressMap()
    delete map[chartId]
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(map))
  } catch {
    // As above.
  }
}
