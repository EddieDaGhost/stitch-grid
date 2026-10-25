/**
 * Remembering things between visits. DOM.
 *
 * Settings and your place go in localStorage; the picture goes in IndexedDB, which is
 * the one part of this that used to be a flat no. The two objections to keeping it were
 * right and are both answered rather than ignored:
 *
 *   "a photo would blow the quota" — of localStorage, yes, which only holds strings and
 *   is a few megabytes. IndexedDB stores the Blob itself and is measured in hundreds.
 *
 *   "re-opening the app to somebody else's half-finished blanket would be worse than
 *   re-opening it empty" — which is an argument against restoring it SILENTLY, and that
 *   is not what happens. The empty state is still the empty state; it just offers the
 *   last picture back, by name, with a thumbnail and a way to forget it. Nobody is
 *   dropped into a chart they did not ask for.
 *
 * What it buys is the thing the app was missing: settings already survived a closed tab,
 * but the picture did not, and re-opening the same photo RESET the framing, the colour
 * cap and the locked colours, because that is what opening a new picture means. So you
 * came back to your gauge and nothing else. Keeping the file is what lets the whole
 * design come back — and, through `chartHash`, the row you had got to.
 *
 * Nothing is uploaded by any of this. The file never leaves the browser's own storage
 * on this device, which is the same promise the empty state has always made.
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


/* --- the last picture ---------------------------------------------------- */

const DB_NAME = 'stitch-grid'
const DB_VERSION = 1
const PICTURE_STORE = 'picture'
const PICTURE_KEY = 'last'

/**
 * Biggest file worth keeping. A phone photo is a few megabytes; a scanned poster can be
 * fifty, and writing that on every open would cost more than coming back to it is worth.
 * Above this the picture simply is not remembered — which is the behaviour the app had
 * for every picture until now, so nothing gets worse.
 */
const MAX_REMEMBERED_BYTES = 24 * 1024 * 1024

/**
 * IndexedDB, as a promise, and never as a thrown error.
 *
 * Private browsing in some browsers has no IndexedDB at all, and Firefox's throws on
 * `open` rather than returning null. Every caller below treats a null database as "this
 * device does not remember pictures", which is a feature quietly missing rather than a
 * crash on the path to a first chart.
 */
function openDb() {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(PICTURE_STORE)) db.createObjectStore(PICTURE_STORE)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function runPicture(mode, work) {
  return openDb().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(null)
        try {
          const tx = db.transaction(PICTURE_STORE, mode)
          const request = work(tx.objectStore(PICTURE_STORE))
          request.onsuccess = () => resolve(request.result ?? null)
          request.onerror = () => resolve(null)
          tx.oncomplete = () => db.close()
          tx.onabort = () => {
            db.close()
            resolve(null)
          }
        } catch {
          resolve(null)
        }
      }),
  )
}

/**
 * Keep this picture, so the next visit can offer it back.
 *
 * Fire and forget on purpose: the chart must appear the instant the file is decoded, and
 * a write that is still in flight — or that failed on a full disk — is not a reason to
 * make anybody wait or to show them an error about a feature they did not ask for.
 */
export function rememberPicture(file) {
  if (!file || (file.size ?? 0) > MAX_REMEMBERED_BYTES) return Promise.resolve(null)
  return runPicture('readwrite', (store) =>
    store.put({ name: file.name ?? 'image', type: file.type ?? '', blob: file, at: Date.now() }, PICTURE_KEY),
  )
}

/**
 * The last picture, as a File, or null.
 *
 * Rebuilt as a `File` rather than handed back as the stored Blob, because the name is
 * half of what makes the offer meaningful — "Pick up where you left off" under a
 * thumbnail of a picture the app cannot name is a worse offer than no offer — and
 * because `loadSource` reads `file.name` for the download filenames.
 */
export async function recallPicture() {
  const entry = await runPicture('readonly', (store) => store.get(PICTURE_KEY))
  if (!entry || !entry.blob) return null
  const name = typeof entry.name === 'string' && entry.name ? entry.name : 'image'
  try {
    return { name, at: entry.at ?? 0, file: new File([entry.blob], name, { type: entry.type || entry.blob.type }) }
  } catch {
    // No File constructor (old Safari): the Blob is enough for everything but the name.
    return { name, at: entry.at ?? 0, file: entry.blob }
  }
}

export function forgetPicture() {
  return runPicture('readwrite', (store) => store.delete(PICTURE_KEY))
}
