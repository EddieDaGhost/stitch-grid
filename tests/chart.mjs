/**
 * The pipeline: source pixels in, a Chart out.
 */

import { buildChart, chartHash, compact, despeckle } from '../src/lib/chart.js'
import { computeLayout } from '../src/lib/layout.js'
import { RESOLVED, lutFor, quantize } from '../src/lib/palette.js'
import {
  checker,
  circle,
  halves,
  flatLogo,
  photo,
  settings,
  solid,
  source,
  transparentLogo,
} from './fixtures.mjs'
import { FLAT_ART_COLOURS, colourProfile } from '../src/lib/raster.js'
import { colourChanges } from '../src/lib/pattern.js'

const SC = { stitchesPer4: 16, rowsPer4: 18, unit: 'in' }

function make(raster, overrides = {}) {
  const src = source(raster)
  const s = settings({ gauge: SC, ...overrides })
  const layout = computeLayout(s, src.aspect, src.width)
  const lut = lutFor(s.subsetId, s.excluded)
  return buildChart({ sat: src.sat, raster: src.raster, layout, settings: s, lut })
}

export default async function run({ check }) {
  // --- a flat colour is one colour, at every detail setting
  let alwaysOne = true
  for (let detail = 5; detail <= 50; detail += 5) {
    const chart = make(solid(200, 200, [198, 48, 58]), { detailPx: detail })
    if (chart.palette.length !== 1) alwaysOne = false
  }
  check('a solid picture is one colour at every detail setting', alwaysOne)

  // --- a hard split lands where it should
  const split = make(halves(200, 200, [0, 0, 0], [255, 255, 255]), { detailPx: 20, maxColors: 2 })
  check.is('a half-and-half picture is 2 colours', split.palette.length, 2)
  const midRow = Math.floor(split.rows / 2)
  const left = split.cells[midRow * split.stitches]
  const right = split.cells[midRow * split.stitches + split.stitches - 1]
  check('the two halves are different colours', left !== right)
  let seamAt = -1
  for (let x = 1; x < split.stitches; x++) {
    if (split.cells[midRow * split.stitches + x] !== left) {
      seamAt = x
      break
    }
  }
  check.is('the seam is exactly halfway', seamAt, split.stitches / 2)

  // --- determinism. Catches key ordering, Math.random, or any Set iteration creeping in.
  const a = make(circle(160, 160, [40, 90, 130], [242, 232, 213]), { detailPx: 12 })
  const b = make(circle(160, 160, [40, 90, 130], [242, 232, 213]), { detailPx: 12 })
  check.is('building the same chart twice is byte-identical', a.cells.join(','), b.cells.join(','))
  check.is('and hashes the same', chartHash(a), chartHash(b))
  const different = make(circle(160, 160, [40, 90, 130], [242, 232, 213]), { detailPx: 13 })
  check('a different chart hashes differently', chartHash(a) !== chartHash(different))

  // --- gauge really does change the chart
  const scChart = make(circle(200, 200, [0, 0, 0], [255, 255, 255]), { detailPx: 10 })
  const dcChart = make(circle(200, 200, [0, 0, 0], [255, 255, 255]), {
    detailPx: 10,
    gauge: { stitchesPer4: 12, rowsPer4: 7, unit: 'in' },
  })
  check.is('same picture, same stitch count', scChart.stitches, dcChart.stitches)
  check('but a very different row count', dcChart.rows < scChart.rows)

  // --- the border is sacred
  const bordered = make(solid(200, 200, [0, 0, 0]), {
    detailPx: 20,
    maxColors: 2,
    border: { inches: 1, colorId: 'cherry' },
  })
  const cherry = bordered.palette.findIndex((p) => p.id === 'cherry')
  check('the border colour is present even though the picture is black', cherry >= 0)
  check.is('the top-left cell is border', bordered.cells[0], cherry)
  check.is(
    'the bottom-right cell is border',
    bordered.cells[bordered.stitches * bordered.rows - 1],
    cherry,
  )

  // ...even when the cap would otherwise reduce it away
  const squeezed = make(circle(200, 200, [30, 60, 120], [230, 120, 60]), {
    detailPx: 20,
    maxColors: 2,
    border: { inches: 1, colorId: 'cherry' },
  })
  check('a border survives a maxColors of 2', squeezed.palette.some((p) => p.id === 'cherry'))

  // --- transparency is background, not black
  const logo = make(transparentLogo(120, 120, [200, 40, 50]), {
    detailPx: 10,
    padColorId: 'snow',
    maxColors: 4,
  })
  check('a transparent background becomes the pad colour', logo.palette.some((p) => p.id === 'snow'))
  check(
    'and does not become black',
    logo.cells[0] === logo.palette.findIndex((p) => p.id === 'snow'),
  )

  // --- sampling modes differ, which is the whole reason the toggle exists
  const flat = checker(160, 160, 40, [0, 0, 0], [255, 255, 255])
  const areaSampled = make(flat, { detailPx: 7, sampling: 'area', maxColors: 24, despeckle: 0 })
  const nearestSampled = make(flat, { detailPx: 7, sampling: 'nearest', maxColors: 24, despeckle: 0 })
  check(
    'nearest sampling on flat art keeps the colour count down',
    nearestSampled.palette.length <= areaSampled.palette.length,
    `nearest ${nearestSampled.palette.length}, area ${areaSampled.palette.length}`,
  )
  check.is('nearest sampling on a 2-colour checker gives 2 colours', nearestSampled.palette.length, 2)

  // --- max colours is honoured
  for (const cap of [2, 4, 8]) {
    const chart = make(circle(200, 200, [200, 60, 40], [40, 80, 160]), { detailPx: 8, maxColors: cap })
    check(`a cap of ${cap} produces at most ${cap} colours`, chart.palette.length <= cap, `got ${chart.palette.length}`)
  }

  // --- despeckle
  const stitches = 9
  const rows = 9
  const cells = new Uint8Array(stitches * rows).fill(3)
  cells[4 * stitches + 4] = 7 // one stray stitch in the middle
  const region = { x: 0, y: 0, w: stitches, h: rows }
  const kept = cells.slice()
  despeckle(kept, stitches, rows, region, 0)
  check.is('despeckle 0 leaves a stray alone', kept[4 * stitches + 4], 7)

  const cleaned = cells.slice()
  despeckle(cleaned, stitches, rows, region, 1)
  check.is('despeckle 1 absorbs a lone stray stitch', cleaned[4 * stitches + 4], 3)

  // Order independence: reversing the scan must give the same answer.
  const twice = cells.slice()
  despeckle(twice, stitches, rows, region, 1)
  despeckle(twice, stitches, rows, region, 1)
  check.is('despeckle reaches a fixed point', twice.join(','), cleaned.join(','))

  // A protected cell is never touched.
  const guarded = cells.slice()
  const guard = new Uint8Array(stitches * rows)
  guard[4 * stitches + 4] = 1
  despeckle(guarded, stitches, rows, region, 2, guard)
  check.is('despeckle never touches a protected cell', guarded[4 * stitches + 4], 7)

  // --- compact
  const sparse = new Uint8Array([9, 9, 9, 30, 30, 17])
  const packed = compact(sparse)
  check.is('compact produces a dense palette', packed.palette.length, 3)
  check.is('and indices stop at length - 1', Math.max(...packed.cells), 2)
  check.is('the most used colour is index 0', packed.cells[0], 0)
  const packedCounts = [0, 1, 2].map((i) => packed.cells.filter((v) => v === i).length)
  check(
    'the palette is ordered most-used first',
    packedCounts[0] >= packedCounts[1] && packedCounts[1] >= packedCounts[2],
    packedCounts.join(' >= '),
  )

  // --- the chart covers every cell
  const full = make(circle(180, 180, [10, 10, 10], [250, 250, 250]), { detailPx: 12 })
  check.is('every cell has a colour', full.cells.length, full.stitches * full.rows)
  check(
    'every cell index is inside the palette',
    Array.from(full.cells).every((v) => v < full.palette.length),
  )

  /*
    --- how many colours a picture actually needs

    Not how many are in the file. A logo of three flat colours is still three flat
    colours after antialiasing has softened every edge and a JPEG has scattered noise
    across it — the extra values are real, but they are a fraction of a percent of the
    pixels. The old measure counted distinct colours and answered "lots" for exactly
    those files, which is how a three-colour logo came to be charted in twelve.
  */
  const fullLut = lutFor('all', [])
  const profileOf = (raster) => colourProfile(raster, fullLut)

  const crispLogo = profileOf(flatLogo(400, 300))
  check.is('a three-colour logo needs three colours', crispLogo.needed, 3)
  check('and reads as flat artwork', crispLogo.flat)

  const softLogo = profileOf(flatLogo(400, 300, { ss: 8 }))
  check.is('antialiasing the edges does not change what it needs', softLogo.needed, 3)
  check('it is still flat artwork', softLogo.flat)
  check(
    'even though antialiasing really did add colours to the file',
    softLogo.used > crispLogo.used,
    `${crispLogo.used} -> ${softLogo.used} present`,
  )

  const jpegLogo = profileOf(flatLogo(400, 300, { ss: 8, noise: 6 }))
  check.is('nor does compression noise', jpegLogo.needed, 3)
  check('a logo saved as a JPEG is still flat artwork', jpegLogo.flat)

  const photoProfile = profileOf(photo(400, 300))
  check('a photograph needs many more colours', photoProfile.needed > FLAT_ART_COLOURS, String(photoProfile.needed))
  check('and does not read as flat artwork', !photoProfile.flat)
  /*
    The point of the whole measure: the noisy logo and the photograph hold a similar
    number of distinct colours, so counting them cannot tell these two apart. What
    separates them is how few of those colours carry the picture.
  */
  check(
    'a noisy logo and a photograph are told apart by need, not by how many colours they hold',
    jpegLogo.needed * 2 < photoProfile.needed,
    `logo needs ${jpegLogo.needed} (holds ${jpegLogo.used}), photo needs ${photoProfile.needed} (holds ${photoProfile.used})`,
  )

  const blank = profileOf(solid(64, 64, [200, 40, 40]))
  check.is('a single flat colour needs one', blank.needed, 1)

  // --- flat art keeps its own colours, and invents none
  const softLogoRaster = flatLogo(400, 300, { ss: 8 })
  const modeChart = make(softLogoRaster, { sampling: 'mode', detailPx: 6, despeckle: 0 })
  const areaChart = make(softLogoRaster, { sampling: 'area', detailPx: 6, despeckle: 0 })
  check(
    'flat art sampling gives a logo far fewer colours than averaging does',
    modeChart.palette.length < areaChart.palette.length,
    `mode ${modeChart.palette.length}, area ${areaChart.palette.length}`,
  )
  check(
    'and far fewer colour changes, which is what a join costs you',
    colourChanges(modeChart, {}) < colourChanges(areaChart, {}),
    `mode ${colourChanges(modeChart, {})}, area ${colourChanges(areaChart, {})}`,
  )

  /*
    The invariant that matters. Averaging across an edge between navy and orange produces
    a muddy value that is in neither, so the chart grows a halo of colours that appear
    nowhere in the picture. Taking the colour a cell is MOSTLY made of cannot do that:
    every cell comes back as a colour some pixel of the source already quantized to.
  */
  const sourceColours = new Set()
  {
    const d = softLogoRaster.data
    for (let p = 0; p < d.length; p += 4) {
      sourceColours.add(quantize(fullLut, d[p], d[p + 1], d[p + 2]))
    }
  }
  const idsIn = (chart) => new Set(chart.palette.map((c) => c.id))
  const paletteIdsOf = (indices) =>
    new Set([...indices].map((i) => RESOLVED[i].id))
  const allowed = paletteIdsOf(sourceColours)
  const invented = [...idsIn(modeChart)].filter((id) => !allowed.has(id))
  check.is('flat art sampling never invents a colour the picture does not contain', invented.length, 0, invented.join(','))

  const areaInvented = [...idsIn(areaChart)].filter((id) => !allowed.has(id))
  check(
    'whereas averaging does, which is the halo along every edge',
    areaInvented.length > 0,
    areaInvented.join(',') || 'none',
  )

  // --- a two-colour picture stays two colours
  const twoTone = make(halves(200, 200, [10, 20, 40], [240, 240, 240]), {
    sampling: 'mode',
    detailPx: 7,
    despeckle: 0,
  })
  check.is('flat art sampling on a two-colour picture gives two colours', twoTone.palette.length, 2)

  // --- transparency still reads as background, not as a colour
  const cutout = make(transparentLogo(120, 120, [200, 40, 40]), { sampling: 'mode', despeckle: 0 })
  check(
    'a mostly-transparent cell is still background under flat art sampling',
    cutout.palette.length <= 2,
    `${cutout.palette.length} colours`,
  )
}
