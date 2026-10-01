/**
 * Matching arbitrary photo colours onto a fixed shelf of yarn.
 */

import { PALETTE, subsetIndices } from '../src/config/palette.js'
import { applyAdjust } from '../src/lib/raster.js'
import {
  NEIGHBOURS,
  PALETTE_SIZE,
  RESOLVED,
  composeMaps,
  excludeMap,
  histogram,
  identityMap,
  lutFor,
  lutKey,
  nearestAllowed,
  quantize,
  reduceMap,
  swapMap,
} from '../src/lib/palette.js'
import { deltaE2000 } from '../src/lib/color.js'

export default async function run({ check }) {
  check.is('the palette is 40 colours', PALETTE.length, 40)
  check.is('every id is unique', new Set(PALETTE.map((p) => p.id)).size, PALETTE.length)
  check.is('every name is unique', new Set(PALETTE.map((p) => p.name)).size, PALETTE.length)
  check('every entry has a group', PALETTE.every((p) => p.groups?.length > 0))
  check('every hex parses to a real colour', RESOLVED.every((p) => p.rgb.every((v) => v >= 0 && v <= 255)))

  // --- subsets
  check.is('the full subset is everything', subsetIndices('all').length, PALETTE.length)
  check('neutrals is a real subset', subsetIndices('neutrals').length < PALETTE.length)
  check('neutrals is not empty', subsetIndices('neutrals').length >= 8)
  check('pastels includes neutrals to build on', subsetIndices('pastels').length > 8)
  check.is('an unknown subset falls back to everything', subsetIndices('nonsense').length, PALETTE.length)

  // --- the lookup cube
  const lut = lutFor('all', [])
  check.is('the cube is 32768 entries', lut.length, 32768)

  /**
   * If a palette colour doesn't match itself, the cube's 5-bit resolution is too coarse
   * for the palette and everything downstream is subtly wrong.
   */
  let selfMatches = 0
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const [r, g, b] = RESOLVED[i].rgb
    if (quantize(lut, r, g, b) === i) selfMatches++
  }
  check.is('every palette colour matches itself through the cube', selfMatches, PALETTE_SIZE)

  const lightest = RESOLVED.reduce((a, b) => (a.lab[0] > b.lab[0] ? a : b))
  const darkest = RESOLVED.reduce((a, b) => (a.lab[0] < b.lab[0] ? a : b))
  check.is('white matches the palest yarn', RESOLVED[quantize(lut, 255, 255, 255)].id, lightest.id)
  check.is('black matches the darkest yarn', RESOLVED[quantize(lut, 0, 0, 0)].id, darkest.id)

  check.is('cache keys are stable regardless of order', lutKey('all', ['b', 'a']), lutKey('all', ['a', 'b']))
  check('the cube is cached, not rebuilt', lutFor('all', []) === lut)

  // A neutrals-only cube can only ever answer with neutrals.
  const neutralOnly = new Set(subsetIndices('neutrals'))
  const neutralLut = lutFor('neutrals', [])
  let allNeutral = true
  for (let i = 0; i < 4096; i++) {
    const r = (i * 61) % 256
    const g = (i * 113) % 256
    const b = (i * 187) % 256
    if (!neutralOnly.has(quantize(neutralLut, r, g, b))) allNeutral = false
  }
  check('a neutrals-only palette never returns a colour outside it', allNeutral)

  // --- neighbour table
  let selfFirst = true
  let monotonic = true
  for (let i = 0; i < PALETTE_SIZE; i++) {
    if (NEIGHBOURS[i * PALETTE_SIZE] !== i) selfFirst = false
    let previous = -Infinity
    for (let rank = 0; rank < PALETTE_SIZE; rank++) {
      const d = deltaE2000(RESOLVED[i].lab, RESOLVED[NEIGHBOURS[i * PALETTE_SIZE + rank]].lab)
      if (d < previous - 1e-9) monotonic = false
      previous = d
    }
  }
  check('every colour is its own nearest neighbour', selfFirst)
  check('neighbours are ranked by increasing distance', monotonic)

  // --- remaps
  const identity = identityMap()
  check('the identity map maps everything to itself', identity.every((v, i) => v === i))

  const a = new Uint8Array(PALETTE_SIZE).map((_, i) => (i + 1) % PALETTE_SIZE)
  const b = new Uint8Array(PALETTE_SIZE).map((_, i) => (i + 5) % PALETTE_SIZE)
  const composed = composeMaps(a, b)
  check('composing maps applies them left to right', composed.every((v, i) => v === b[a[i]]))

  // --- exclusion
  const creamIndex = RESOLVED.findIndex((p) => p.id === 'cream')
  const excluded = excludeMap(['cream'])
  check('an excluded colour is redirected', excluded[creamIndex] !== creamIndex)
  check(
    'and redirected to its closest surviving neighbour',
    excluded[creamIndex] === nearestAllowed(creamIndex, new Set(RESOLVED.map((_, i) => i).filter((i) => i !== creamIndex))),
  )
  check('excluding nothing changes nothing', excludeMap([]).every((v, i) => v === i))

  // --- swapping
  const sage = RESOLVED.findIndex((p) => p.id === 'sage')
  const moss = RESOLVED.findIndex((p) => p.id === 'moss')
  check.is('a swap redirects one colour to another', swapMap({ sage: 'moss' })[sage], moss)
  check('an unknown swap is ignored', swapMap({ nope: 'moss' }).every((v, i) => v === i))
  check('a self-swap is harmless', swapMap({ sage: 'sage' })[sage] === sage)

  // --- capping the colour count
  const cells = new Uint8Array(1200)
  for (let i = 0; i < cells.length; i++) cells[i] = i % 12
  const counts = histogram(cells, PALETTE_SIZE)

  const capped = reduceMap(counts, 4, [])
  const survivors = new Set()
  for (let i = 0; i < PALETTE_SIZE; i++) if (counts[i] > 0) survivors.add(capped[i])
  check.is('capping at 4 leaves exactly 4 colours', survivors.size, 4)

  const under = reduceMap(counts, 20, [])
  check('a cap above the colour count changes nothing', under.every((v, i) => v === i))

  // A locked colour survives even as the rarest one.
  const skewed = new Uint32Array(PALETTE_SIZE)
  for (let i = 0; i < 12; i++) skewed[i] = 1000 - i * 10
  const rare = 11
  skewed[rare] = 1
  const lockedId = RESOLVED[rare].id
  const lockedMap = reduceMap(skewed, 4, [lockedId])
  check.is('a locked colour survives the cap', lockedMap[rare], rare)

  const unlockedMap = reduceMap(skewed, 4, [])
  check('and would not have survived without the lock', unlockedMap[rare] !== rare)

  // Ordering: a swap applied after a reduction must not be undone by it.
  const order = composeMaps(excludeMap([]), reduceMap(counts, 4, []), swapMap({ sage: 'moss' }))
  check.is('a swap survives a reduction applied before it', order[sage], moss)

  /*
    --- greyscale needs no palette of its own, and that is load-bearing

    Greyscale in this app is saturation at the bottom of its range: the pixels arrive grey
    and the quantizer picks from the whole shelf. That only produces a grey chart because
    CIEDE2000 charges a warm neutral for its chroma, so Cream, Ecru, Oatmeal and Linen lose
    to Fog and Silver even though they are pale and unsaturated to look at.

    This is exactly the kind of thing that stays true until it doesn't. Add one low-chroma
    putty or warm grey to the palette and greyscale charts would quietly start putting beige
    in them, with nothing anywhere throwing. So the invariant is asserted over the whole
    256-level ramp rather than on a couple of examples.
  */
  const greyLut = lutFor('all', [])
  const reached = new Set()
  for (let v = 0; v <= 255; v += 1) reached.add(PALETTE[quantize(greyLut, v, v, v)].id)

  const chromaOf = (hex) => {
    const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16))
    return Math.max(r, g, b) - Math.min(r, g, b)
  }
  const warmest = [...reached].reduce((worst, id) => {
    const here = chromaOf(PALETTE.find((p) => p.id === id).hex)
    return here > worst.chroma ? { id, chroma: here } : worst
  }, { id: 'none', chroma: 0 })

  check(
    'a grey ramp only ever reaches near-neutral yarns',
    warmest.chroma <= 20,
    `worst was ${warmest.id} at chroma ${warmest.chroma}`,
  )
  check(
    'and never a warm neutral, however pale it looks',
    !['cream', 'ecru', 'oatmeal', 'linen'].some((id) => reached.has(id)),
    [...reached].join(' '),
  )
  check(
    'with enough steps for a picture to survive losing its hues',
    reached.size >= 5,
    `${reached.size} greys: ${[...reached].join(' ')}`,
  )

  /*
    And the desaturation itself must weight the channels by how bright they look. A flat
    (r+g+b)/3 average is the classic shortcut and it makes pure green and pure blue the same
    grey, which flattens exactly the contrast a greyscale chart has left to work with.
  */
  const flat = (rgb) => {
    const [r, g, b] = applyAdjust(rgb, { saturation: -1 })
    return r === g && g === b ? r : null
  }
  const greenGrey = flat([0, 255, 0])
  const blueGrey = flat([0, 0, 255])
  const redGrey = flat([255, 0, 0])
  check('full desaturation leaves every channel equal', greenGrey !== null && blueGrey !== null)
  check(
    'and green reads far brighter than blue, as the eye sees it',
    greenGrey - blueGrey > 150,
    `green ${greenGrey} vs blue ${blueGrey}`,
  )
  check('with red between the two', redGrey > blueGrey && redGrey < greenGrey, `red ${redGrey}`)
  check(
    'a flat channel average would have made them identical, and does not',
    greenGrey !== redGrey && redGrey !== blueGrey,
  )
  check.is('and no saturation change leaves a colour exactly alone', applyAdjust([10, 20, 30], { saturation: 0 }).join(), '10,20,30')
}
