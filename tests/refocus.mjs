/**
 * Cropping must spend the resolution budget on the crop, in a real browser.
 *
 * The working copy used to be built once, from the whole photo, before anyone had said
 * which part of it was the subject. So the tighter you framed, the less of the photo's own
 * detail was left: a quarter-width crop of a big photo was charted from a quarter of a
 * 1024 pixel copy — 256 pixels — and no setting anywhere could get the rest back. The
 * framing panel exists so nobody has to crop in another app first, and that made cropping
 * in another app first strictly better, which is the opposite of the point.
 *
 * The measurement is a controlled one. The fixture is the same stripes everywhere, so the
 * same grid size on the same picture is charted twice and only one thing differs: whether
 * the working copy covers the whole photo or the part being charted. Everything is read
 * off the interface, so this tests what a person would see rather than what the modules do.
 */

import { asUpload, finePatternPng } from './pngfixture.mjs'

/*
  4200px square, and the size is load-bearing rather than incidental.

  A whole-frame copy is capped at 1024px, so this is downscaled by 4.1 and the stripes land
  at two and a half pixels, which averaging flattens. A quarter of it is 1050 pixels, which
  the budget holds nearly whole, so the same stripes come back at eight. Shrink the fixture
  and the two paths converge and the suite proves nothing.
*/
const upload = asUpload('fine-stripes.png', finePatternPng(4200, 4200))

/** The grid, from the summary bar's "220 × 248". */
async function readChart(page) {
  const text = await page.getByLabel('Chart summary').innerText()
  const match = text.match(/(\d+)\s*×\s*(\d+)/)
  return match ? { stitches: Number(match[1]), rows: Number(match[2]) } : null
}

/**
 * Colours and colour changes, which is the pair that says how much detail reached the
 * chart. Changes is the sensitive one: it counts every place two neighbouring stitches
 * differ, so a chart that resolved the stripes has tens of thousands and a chart that
 * averaged them away has almost none.
 */
async function readSummary(page) {
  const text = await page.getByLabel('Chart summary').innerText()
  return {
    colours: Number(text.match(/COLOURS\s+(\d+)/i)?.[1] ?? -1),
    changes: Number((text.match(/CHANGES\s+([\d,]+)/i)?.[1] ?? '-1').replace(/,/g, '')),
  }
}

/**
 * Wait for the summary the rebuild should produce, and return whatever it actually is.
 *
 * Polled rather than slept through, because rebuilding means re-decoding a seventeen
 * megapixel PNG and how long that takes is a property of the machine. A fixed wait is
 * either slow on a fast machine or flaky on a loaded one, and flaky is much worse — it
 * teaches everyone to re-run a red suite instead of reading it.
 *
 * Waiting for a specific answer rather than for the chart to stop changing, because
 * "stopped changing" is not decidable here: widening the frame back out passes through a
 * real intermediate state — the crop is already the whole picture while the pixels still
 * cover only the old one — and that state can easily outlast any stability window. On a
 * timeout this returns the wrong answer instead of throwing, so the assertion that follows
 * reports what the chart actually said.
 */
async function waitForSummary(page, wanted, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs
  let last = await readSummary(page)
  while (Date.now() < deadline && !wanted(last)) {
    await page.waitForTimeout(150)
    last = await readSummary(page)
  }
  return last
}

async function setNumber(page, label, value) {
  const field = page.getByLabel(label, { exact: true })
  await field.fill(String(value))
  await field.blur()
  await page.waitForTimeout(120)
}

export default async function run({ page, check, errors, URL }) {
  const framing = page.getByRole('region', { name: 'Framing' })

  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.setInputFiles('input[type=file]', upload)
  await page.waitForSelector('[aria-label="Chart summary"]', { timeout: 30000 })
  await page.waitForTimeout(400)

  /*
    Three settings, so that the only variable left is resolution.

    Averaging, because it is the sampler whose answer does not depend on how the pixels
    happen to be laid out — a cell is the mean of what is under it either way, so any
    difference that survives is a difference in what the working copy kept. Every stray
    stitch kept, because here the stripes ARE single stitches. And the colour cap lifted
    off where the picture measured, because the whole photo measures as one flat tone and
    that is the very thing under test.
  */
  await page.getByRole('group', { name: 'What is this picture?' }).getByText('A photo').click()
  await page.getByRole('group', { name: 'Stray stitches' }).getByText('Keep', { exact: true }).click()
  await setNumber(page, 'Maximum colours', 8)

  /*
    A grid size typed by hand, and the same one for both measurements.

    The detail slider is deliberately calibrated against a whole-frame copy — it is pixels
    per stitch, so a tight crop asks for a small chart, and that is a product decision
    rather than an oversight. Asking for a big chart of a small crop is exactly the case
    that used to have no pixels behind it.
  */
  await page.getByRole('group', { name: 'Chart size' }).getByText('A size I choose').click()
  await page.waitForTimeout(200)
  await setNumber(page, 'Stitches across', 220)
  await setNumber(page, 'Rows tall', 248)
  await page.waitForTimeout(250)

  const beforeCrop = await readChart(page)
  check.is('the grid is the size that was asked for', beforeCrop.stitches, 220)
  const whole = await readSummary(page)
  check(
    'across the whole photo the stripes are finer than a stitch, and average away',
    whole.colours > 2,
    `${whole.colours} colours, ${whole.changes} changes`,
  )

  // --- crop to a quarter of the photo
  const handle = page.getByLabel('Drag the bottom right corner of the crop')
  await handle.scrollIntoViewIfNeeded()
  await page.waitForTimeout(100)
  const frameBox = await page.getByLabel('Move the crop frame. Arrow keys nudge it.').boundingBox()
  const handleBox = await handle.boundingBox()
  const grab = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 }
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x - frameBox.width * 0.5, grab.y - frameBox.height * 0.5, { steps: 8 })
  await page.mouse.up()

  /*
    Read the grid straight away, inside the debounce, so this is the chart built from the
    pixels already on hand. The stitch count must be the same before and after the rebuild:
    a sharper working copy is more detail in the same blanket, never a different blanket.
    Getting that wrong would resize something somebody is forty hours into, and nothing
    anywhere would throw.
  */
  await page.waitForTimeout(120)
  const duringCrop = await readChart(page)
  const duringSummary = await readSummary(page)

  /*
    The un-refocused chart is the interesting number here, and it is worse in both of the
    ways this app measures a chart. A quarter of a 1024px copy is 256 pixels for 220
    stitches — about one pixel each — so the stripes arrive as noise: an invented
    intermediate colour that is in no part of the photo, and far MORE colour changes than
    the picture contains, each one a join, a cut and two ends to weave in. It is the
    dithered chart that rule 2 exists to prevent, arrived at by accident.
  */
  check(
    'a crop of one pixel per stitch invents a colour that is in no part of the photo',
    duringSummary.colours > 2,
    `${duringSummary.colours} colours, ${duringSummary.changes} changes`,
  )

  // Two colours is the answer a rebuilt copy gives, so it is also the signal that the
  // rebuild has landed — and if it never does, the assertions below say what came back.
  const settled = await waitForSummary(page, (v) => v.colours === 2)
  const afterCrop = await readChart(page)
  check.is('the stitch count is untouched by the rebuild', afterCrop.stitches, duringCrop.stitches)
  check.is('and is still the size that was asked for', afterCrop.stitches, 220)
  check.is('as is the row count', afterCrop.rows, duringCrop.rows)

  check.is(
    'rebuilt around the crop, the chart is the two colours the photo is made of',
    settled.colours,
    2,
  )
  check(
    'and costs far fewer joins, because the stripes are stripes rather than speckle',
    settled.changes < duringSummary.changes * 0.75,
    `${duringSummary.changes} changes before the rebuild, ${settled.changes} after`,
  )
  check(
    'the framing panel agrees it is about a quarter of the picture',
    /using ([1-9]|1\d|2\d|3[0-5])% of the picture/i.test(await framing.innerText()),
    (await framing.innerText()).match(/using [^·]*/i)?.[0] ?? 'no percentage shown',
  )

  /*
    And back again. The whole picture is still the whole picture — the framing panel draws
    its own copy, kept separate from the working copy precisely so widening the frame is
    possible at all. Drawing the working copy there would have left nothing to widen into,
    because after a crop it no longer contains the rest of the photo.
  */
  await page.getByLabel('Use the whole picture').click()
  const reopened = await waitForSummary(
    page,
    (v) => v.colours === whole.colours && v.changes === whole.changes,
  )
  check.is(
    'widening back gives exactly the chart the whole picture gave before',
    `${reopened.colours}/${reopened.changes}`,
    `${whole.colours}/${whole.changes}`,
  )
  check.is('at the grid size that was asked for', (await readChart(page)).stitches, 220)
  check('and the framing panel still says so', /whole picture/i.test(await framing.innerText()))

  check.is('no page errors along the way', errors.join(' | '), '')
}
