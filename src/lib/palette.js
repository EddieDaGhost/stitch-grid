/**
 * Palette-derived lookup tables. Pure, cached, no DOM.
 *
 * The job of this module is to keep CIEDE2000 off the interaction path. Matching one
 * colour costs about forty floating point operations and two `pow(x, 7)` calls; a chart
 * has ten thousand cells and the slider fires sixty times a second. Doing it live would
 * be roughly half a million evaluations per frame, so none of it happens live:
 *
 *   - a 5-bit RGB cube (32,768 entries) is built ONCE per palette subset, off the
 *     interaction path, and turns per-cell matching into a single array index;
 *   - excluding, swapping and capping colours are `Uint8Array(40)` remaps folded into
 *     one array, so none of them rebuild the cube.
 */

import { PALETTE, normalizeHex, paletteIndex, stockHex, subsetIndices } from '../config/palette.js'
import { deltaE2000, hexToRgb, labDistanceSq, rgbToLab } from './color.js'

/** Every palette entry, with rgb and lab resolved once at module load. */
export const RESOLVED = PALETTE.map((entry) => {
  const rgb = hexToRgb(entry.hex)
  return { ...entry, rgb, lab: rgbToLab(rgb) }
})

export const PALETTE_SIZE = RESOLVED.length

/**
 * The palette as the user has recoloured it.
 *
 * A custom hex is a RESTYLE of a yarn, not a different yarn. "The Pumpkin I am actually
 * crocheting with is #C83803" changes every place that colour is DRAWN — the preview,
 * the contrast of the letter on top of it, the key, the printed sheet — and changes
 * nothing about which cell got which yarn. That is the whole reason it is cheap enough
 * to follow a colour picker live, and it is also the honest behaviour: rematching the
 * photo against the edited shade would restructure the chart underneath the row being
 * edited, and the row could vanish from the list mid-drag.
 *
 * So this is deliberately NOT fed to `lutFor`, `NEIGHBOURS` or `reduceMap`. Those are
 * built from the shop shades, which is what the picture was matched against and what
 * the user will buy. See `restyle` in chart.js for the other half.
 */
const recolourCache = new Map()
const RECOLOUR_CACHE_MAX = 32

/**
 * A stable key for a set of overrides: sorted, normalised, and with anything that
 * merely restates the stock shade dropped, so "no overrides" has exactly one spelling.
 */
export function recolourKey(customHex) {
  if (!customHex || typeof customHex !== 'object') return ''
  const pairs = []
  for (const [id, raw] of Object.entries(customHex)) {
    const hex = normalizeHex(raw)
    if (!hex || paletteIndex(id) < 0 || hex === stockHex(id)) continue
    pairs.push(`${id}:${hex}`)
  }
  return pairs.sort().join(',')
}

/**
 * Every palette entry, with any override applied and `rgb`/`lab` recomputed for it.
 *
 * Returns the shared `RESOLVED` array itself when nothing is overridden — identity, not
 * a copy, so the no-override case costs nothing and downstream memos do not churn.
 */
export function recolour(customHex) {
  const key = recolourKey(customHex)
  if (!key) return RESOLVED
  const hit = recolourCache.get(key)
  if (hit) return hit

  // Read the overrides back out of the KEY rather than off the input, so what is cached
  // and what the key names cannot drift apart.
  const overrides = new Map(key.split(',').map((pair) => {
    const at = pair.indexOf(':')
    return [pair.slice(0, at), pair.slice(at + 1)]
  }))
  const out = RESOLVED.map((entry) => {
    const hex = overrides.get(entry.id)
    if (!hex) return entry
    const rgb = hexToRgb(hex)
    return { ...entry, hex, rgb, lab: rgbToLab(rgb), custom: true }
  })

  // Bounded, because a colour picker drag can mint a new key per frame.
  if (recolourCache.size >= RECOLOUR_CACHE_MAX) {
    recolourCache.delete(recolourCache.keys().next().value)
  }
  recolourCache.set(key, out)
  return out
}

/** 5 bits per channel. See `quantize` for why the truncation is harmless. */
const BITS = 5
const LEVELS = 1 << BITS
const LUT_SIZE = LEVELS * LEVELS * LEVELS

/**
 * Shortlist size for the exact match. Cheap Lab distance and CIEDE2000 disagree only
 * about near-ties, so the true winner is essentially always in the closest few by the
 * cheap metric. Eight is generous.
 */
const SHORTLIST = 8

/**
 * Every palette index ranked by perceptual distance from every other. Built once
 * (40 x 40 = 1,600 evaluations, about a millisecond) and then reused forever by
 * `nearestAllowed` and `reduceMap`, which is what makes excluding and capping colours
 * cost microseconds instead of a cube rebuild.
 */
export const NEIGHBOURS = buildNeighbours()

function buildNeighbours() {
  const table = new Uint8Array(PALETTE_SIZE * PALETTE_SIZE)
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const ranked = RESOLVED.map((entry, j) => ({ j, d: deltaE2000(RESOLVED[i].lab, entry.lab) }))
      .sort((a, b) => a.d - b.d || a.j - b.j)
      .map((e) => e.j)
    table.set(ranked, i * PALETTE_SIZE)
  }
  return table
}

/** A stable cache key for a cube. Sorted so key order can't create a false miss. */
export function lutKey(subsetId, excludedIds = []) {
  return `${subsetId}|${[...excludedIds].sort().join(',')}`
}

const lutCache = new Map()

/**
 * The 5-bit cube: quantized sRGB triple -> nearest allowed palette index.
 *
 * Costs roughly 32,768 Lab conversions plus 32,768 x SHORTLIST exact matches. That is
 * a fraction of a second, paid once per subset, never during a drag.
 */
export function buildLut(allowedIndices) {
  const allowed = allowedIndices.length ? allowedIndices : RESOLVED.map((_, i) => i)
  const lut = new Uint8Array(LUT_SIZE)
  const labs = allowed.map((i) => RESOLVED[i].lab)
  const shortlist = Math.min(SHORTLIST, allowed.length)
  const candidates = new Array(allowed.length)

  for (let r = 0; r < LEVELS; r++) {
    for (let g = 0; g < LEVELS; g++) {
      for (let b = 0; b < LEVELS; b++) {
        // Expand 5 bits back to the centre of the byte range it represents, so the
        // cube samples the middle of each cell rather than its dark corner.
        const lab = rgbToLab([expand(r), expand(g), expand(b)])

        for (let k = 0; k < allowed.length; k++) {
          candidates[k] = { k, d: labDistanceSq(lab, labs[k]) }
        }
        candidates.sort((x, y) => x.d - y.d)

        let best = candidates[0].k
        let bestD = Infinity
        for (let s = 0; s < shortlist; s++) {
          const k = candidates[s].k
          const d = deltaE2000(lab, labs[k])
          if (d < bestD) {
            bestD = d
            best = k
          }
        }
        lut[(r << (BITS * 2)) | (g << BITS) | b] = allowed[best]
      }
    }
  }
  return lut
}

function expand(v) {
  return Math.min(255, Math.round((v * 255) / (LEVELS - 1)))
}

/** Cached cube for a subset. `excluded` are palette ids the user has switched off. */
export function lutFor(subsetId, excludedIds = []) {
  const key = lutKey(subsetId, excludedIds)
  const hit = lutCache.get(key)
  if (hit) return hit
  const excluded = new Set(excludedIds)
  const allowed = subsetIndices(subsetId).filter((i) => !excluded.has(RESOLVED[i].id))
  const lut = buildLut(allowed)
  lutCache.set(key, lut)
  return lut
}

/**
 * The whole hot path: one array index.
 *
 * The 5-bit truncation loses at most 4/255 per channel. With forty well separated yarn
 * colours that changes the winner only on exact ties, where either answer is right.
 */
export function quantize(lut, r, g, b) {
  return lut[((r >> 3) << (BITS * 2)) | ((g >> 3) << BITS) | (b >> 3)]
}

/** Nearest palette index to `index` that is in `allowedSet`. */
export function nearestAllowed(index, allowedSet) {
  const base = index * PALETTE_SIZE
  for (let rank = 0; rank < PALETTE_SIZE; rank++) {
    const candidate = NEIGHBOURS[base + rank]
    if (allowedSet.has(candidate)) return candidate
  }
  return index
}

/** How many cells each palette index covers. */
export function histogram(cells, size = PALETTE_SIZE) {
  const counts = new Uint32Array(size)
  for (let i = 0; i < cells.length; i++) counts[cells[i]]++
  return counts
}

/** The do-nothing remap. */
export function identityMap() {
  const map = new Uint8Array(PALETTE_SIZE)
  for (let i = 0; i < PALETTE_SIZE; i++) map[i] = i
  return map
}

/** Fold remaps left to right: `composeMaps(a, b)` applies a, then b. */
export function composeMaps(...maps) {
  const out = identityMap()
  for (const map of maps) {
    if (!map) continue
    for (let i = 0; i < PALETTE_SIZE; i++) out[i] = map[out[i]]
  }
  return out
}

/** Send every excluded colour to its nearest surviving neighbour. */
export function excludeMap(excludedIds) {
  const map = identityMap()
  if (!excludedIds.length) return map
  const excluded = new Set(excludedIds)
  const allowedSet = new Set(
    RESOLVED.map((entry, i) => (excluded.has(entry.id) ? -1 : i)).filter((i) => i >= 0),
  )
  if (!allowedSet.size) return map
  for (let i = 0; i < PALETTE_SIZE; i++) {
    if (excluded.has(RESOLVED[i].id)) map[i] = nearestAllowed(i, allowedSet)
  }
  return map
}

/** "I have Moss in my stash, use that wherever you wanted Sage." */
export function swapMap(swaps) {
  const map = identityMap()
  for (const [from, to] of Object.entries(swaps ?? {})) {
    const a = RESOLVED.findIndex((e) => e.id === from)
    const b = RESOLVED.findIndex((e) => e.id === to)
    if (a >= 0 && b >= 0) map[a] = b
  }
  return map
}

/**
 * Cap the chart at `maxColors` distinct yarns.
 *
 * Weighted k-medoids restricted to palette members, seeded by cell count. Plain
 * top-K-by-frequency is the obvious approach and it is noticeably worse: on a portrait
 * the twelve most common colours are twelve skin tones and the entire background
 * collapses into one of them.
 *
 * `lockedIds` survive the cut regardless of how few cells they cover — that's the
 * escape hatch for one critical accent, an eye or a logo.
 */
export function reduceMap(counts, maxColors, lockedIds = []) {
  const used = []
  for (let i = 0; i < PALETTE_SIZE; i++) if (counts[i] > 0) used.push(i)
  const map = identityMap()
  if (used.length <= maxColors) return map

  const locked = new Set(
    lockedIds.map((id) => RESOLVED.findIndex((e) => e.id === id)).filter((i) => i >= 0 && counts[i] > 0),
  )

  // Seed: locked first, then the most-used colours, until we have maxColors of them.
  const byCount = [...used].sort((a, b) => counts[b] - counts[a] || a - b)
  const kept = [...locked]
  for (const i of byCount) {
    if (kept.length >= maxColors) break
    if (!locked.has(i)) kept.push(i)
  }

  // Refine. Assign every used colour to its nearest kept one, then move each cluster's
  // medoid to the palette member that minimises weighted distance within it. Locked
  // members never move. Converges in a handful of passes; 8 is a hard stop.
  let current = kept.slice(0, maxColors)
  for (let pass = 0; pass < 8; pass++) {
    const clusters = new Map(current.map((c) => [c, []]))
    for (const i of used) {
      const nearest = nearestOf(i, current)
      clusters.get(nearest).push(i)
    }
    const next = []
    for (const [centre, members] of clusters) {
      if (locked.has(centre) || members.length === 0) {
        next.push(centre)
        continue
      }
      let best = centre
      let bestCost = Infinity
      for (const candidate of members) {
        let cost = 0
        for (const m of members) {
          cost += counts[m] * deltaE2000(RESOLVED[candidate].lab, RESOLVED[m].lab)
        }
        if (cost < bestCost) {
          bestCost = cost
          best = candidate
        }
      }
      next.push(best)
    }
    next.sort((a, b) => a - b)
    if (next.join(',') === [...current].sort((a, b) => a - b).join(',')) break
    current = next
  }

  const keptSet = new Set(current)
  for (const i of used) map[i] = keptSet.has(i) ? i : nearestOf(i, current)
  return map
}

function nearestOf(index, candidates) {
  let best = candidates[0]
  let bestD = Infinity
  for (const c of candidates) {
    const d = deltaE2000(RESOLVED[index].lab, RESOLVED[c].lab)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}
