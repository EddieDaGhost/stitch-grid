/**
 * The design document. Everything a Chart is built from, and nothing derived.
 *
 * Small on purpose — under a kilobyte serialised — which is what makes undo a stack of
 * whole snapshots rather than a command log with an inverse for every verb.
 */

import { DEFAULT_GAUGE, MAX_ROWS, MAX_STITCHES, MIN_STITCHES } from '../config/gauge.js'
import { PALETTE, SUBSETS } from '../config/palette.js'
import { normalizeGauge } from './gauge.js'
import { FULL_FRAME, normalizeCrop } from './layout.js'

export const MIN_DETAIL = 5
export const MAX_DETAIL = 50
export const MIN_COLORS = 2
export const MAX_COLORS = 24

export const DEFAULT_SETTINGS = {
  gauge: { ...DEFAULT_GAUGE },
  /** Source pixels per block. Shown as "Detail", with the stitch count underneath. */
  detailPx: 16,
  /** Which part of the photo is the picture at all, normalised 0..1. */
  crop: { ...FULL_FRAME },
  /** null = let the picture decide the size. Otherwise {stitches, rows}. */
  target: null,
  /**
   * How a picture fills a grid whose size the user typed. Never whether gauge
   * correction happens — that applies in all three.
   *   'contain' the whole picture, padded out to the grid
   *   'cover'   fills the grid by cropping the edges away, undistorted
   *   'stretch' fills the grid by squashing the picture into it
   */
  fit: 'contain',
  border: { inches: 0, colorId: 'cream' },
  padColorId: 'cream',
  subsetId: 'all',
  maxColors: 12,
  locked: [],
  excluded: [],
  swaps: {},
  /** 'area' for photographs, 'nearest' for flat art with hard edges. */
  sampling: 'area',
  despeckle: 1,
  adjust: { brightness: 0, contrast: 0, saturation: 0 },
  startsOnRightSide: true,
  /** 'rows' or 'c2c'. Only changes how the chart is READ, never the chart. */
  mode: 'rows',
  sourceName: '',
}

/** View state. Deliberately NOT part of the design, and so not part of undo. */
export const DEFAULT_VIEW = { zoom: 1, showGrid: true, showLetters: false, mode: 'design' }

const clamp = (v, lo, hi, fallback) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}

const VALID_IDS = new Set(PALETTE.map((p) => p.id))
const cleanIds = (list) => (Array.isArray(list) ? list.filter((id) => VALID_IDS.has(id)) : [])

/**
 * Clamp and repair anything. Never throws — a settings blob from an older version, a
 * corrupted localStorage key or a hand-edited share link should degrade to something
 * usable rather than white-screening the app.
 */
export function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {}
  const target =
    s.target && Number(s.target.stitches) > 0 && Number(s.target.rows) > 0
      ? {
          stitches: Math.round(clamp(s.target.stitches, MIN_STITCHES, MAX_STITCHES, 60)),
          rows: Math.round(clamp(s.target.rows, 1, MAX_ROWS, 80)),
        }
      : null

  const swaps = {}
  for (const [from, to] of Object.entries(s.swaps ?? {})) {
    if (VALID_IDS.has(from) && VALID_IDS.has(to) && from !== to) swaps[from] = to
  }

  return {
    gauge: normalizeGauge(s.gauge ?? DEFAULT_SETTINGS.gauge),
    detailPx: Math.round(clamp(s.detailPx, MIN_DETAIL, MAX_DETAIL, DEFAULT_SETTINGS.detailPx)),
    target,
    crop: normalizeCrop(s.crop),
    fit: s.fit === 'stretch' || s.fit === 'cover' ? s.fit : 'contain',
    border: {
      inches: clamp(s.border?.inches, 0, 12, 0),
      colorId: VALID_IDS.has(s.border?.colorId) ? s.border.colorId : DEFAULT_SETTINGS.border.colorId,
    },
    padColorId: VALID_IDS.has(s.padColorId) ? s.padColorId : DEFAULT_SETTINGS.padColorId,
    subsetId: SUBSETS.some((x) => x.id === s.subsetId) ? s.subsetId : 'all',
    maxColors: Math.round(clamp(s.maxColors, MIN_COLORS, MAX_COLORS, DEFAULT_SETTINGS.maxColors)),
    locked: cleanIds(s.locked),
    excluded: cleanIds(s.excluded),
    swaps,
    sampling: s.sampling === 'nearest' ? 'nearest' : 'area',
    despeckle: Math.round(clamp(s.despeckle, 0, 2, 1)),
    adjust: {
      brightness: clamp(s.adjust?.brightness, -1, 1, 0),
      contrast: clamp(s.adjust?.contrast, -1, 1, 0),
      saturation: clamp(s.adjust?.saturation, -1, 1, 0),
    },
    startsOnRightSide: s.startsOnRightSide !== false,
    mode: s.mode === 'c2c' ? 'c2c' : 'rows',
    sourceName: typeof s.sourceName === 'string' ? s.sourceName : '',
  }
}

/**
 * Cache key for a built Chart.
 *
 * Only the fields that can change the cells are in it. `mode` is deliberately absent —
 * reading a chart corner-to-corner doesn't change a single stitch, so switching modes
 * must not throw the memo away.
 */
export function settingsKey(settings, sourceId = '') {
  const s = settings
  return [
    sourceId,
    s.gauge.stitchesPer4,
    s.gauge.rowsPer4,
    s.detailPx,
    // Rounded, because a crop comes from a finger on a photo: full float precision
    // would miss the cache on sub-pixel jitter that cannot change a single cell.
    [s.crop.x, s.crop.y, s.crop.w, s.crop.h].map((v) => v.toFixed(5)).join(','),
    s.target ? `${s.target.stitches}x${s.target.rows}` : '-',
    s.fit,
    s.border.inches,
    s.border.colorId,
    s.padColorId,
    s.subsetId,
    s.maxColors,
    s.locked.join('.'),
    s.excluded.join('.'),
    Object.entries(s.swaps).sort().map(([a, b]) => `${a}>${b}`).join('.'),
    s.sampling,
    s.despeckle,
    s.adjust.brightness,
    s.adjust.contrast,
    s.adjust.saturation,
  ].join('|')
}
