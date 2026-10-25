/**
 * Coming back to a picture, and the difference between that and opening one.
 *
 * The assertion that matters is not "the picture came back" — it is that the FRAMING
 * came back with it. Settings already survived a closed tab before any of this; what
 * did not survive was the photo, and re-opening the same file counted as opening a new
 * document, which reset the crop, the target size, the colour cap and the locked
 * colours. So you returned to your gauge and nothing else, and the chart you were part
 * way through crocheting was a different chart from the one on screen.
 *
 * That is why the crop is cropped to a square here before reloading: a resumed session
 * whose crop silently went back to the whole picture would pass any check that only
 * asked whether a chart appeared.
 */

import { asUpload, logoPng } from './pngfixture.mjs'

const upload = asUpload('bears-logo.png', logoPng(900, 600))

async function readChart(page) {
  const text = await page.getByLabel('Chart summary').innerText()
  const match = text.match(/(\d+)\s*×\s*(\d+)/)
  return match ? { stitches: Number(match[1]), rows: Number(match[2]) } : null
}

export default async function run({ page, check, errors, URL }) {
  await page.goto(URL, { waitUntil: 'networkidle' })

  check(
    'a first visit offers nothing to resume',
    !(await page.getByText('Pick up where you left off').isVisible().catch(() => false)),
  )

  await page.setInputFiles('input[type=file]', upload)
  await page.waitForSelector('[aria-label="Chart summary"]', { timeout: 20000 })
  const whole = await readChart(page)

  // A framing decision, which is the thing that used to be lost.
  await page.getByLabel('Crop to a square').click()
  await page.waitForTimeout(600)
  const square = await readChart(page)
  /*
    A SQUARE crop does not give a square chart, and that is the point of the whole app:
    a square of picture worked in single crochet is 37 stitches by 42 rows, because a
    stitch is wider than a row is tall. So the proof that the crop took is the stitch
    count moving, not the two numbers meeting.
  */
  check(
    'cropping to a square really did change the chart',
    square.stitches < whole.stitches,
    `whole ${whole.stitches}x${whole.rows} -> square ${square.stitches}x${square.rows}`,
  )

  // --- close the tab and come back
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(800)

  check('the empty state is still the empty state', await page.locator('h1').isVisible())
  check('and offers the last picture back', await page.getByText('Pick up where you left off').isVisible())
  check('by name, so you can tell which one it is', await page.getByText(/bears-logo/).isVisible())
  check(
    'and says where it is kept, because that promise is the whole product',
    await page.getByText(/kept on this device only/i).isVisible(),
  )
  check(
    'nothing is charted until you ask for it',
    !(await page.locator('[aria-label="Chart summary"]').isVisible().catch(() => false)),
  )

  const card = page.locator('.panel', { hasText: 'Pick up where you left off' })
  const box = await card.boundingBox()
  const viewport = page.viewportSize()
  check(
    'the card fits the window it is offered in',
    box && box.x >= 0 && box.x + box.width <= viewport.width + 1,
    `${JSON.stringify(box)} in ${viewport.width}`,
  )

  await page.getByRole('button', { name: 'Resume' }).click()
  await page.waitForSelector('[aria-label="Chart summary"]', { timeout: 20000 })
  await page.waitForTimeout(900)

  const resumed = await readChart(page)
  check.is('resuming gives back the same number of stitches', resumed.stitches, square.stitches)
  check.is('and the same number of rows, which means the framing came back', resumed.rows, square.rows)
  check(
    'and is not the whole picture again, which is what it used to do',
    !(resumed.stitches === whole.stitches && resumed.rows === whole.rows),
    `resumed ${resumed.stitches}x${resumed.rows}, whole frame is ${whole.stitches}x${whole.rows}`,
  )

  // --- forgetting it
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.getByLabel(/^Forget /).click()
  await page.waitForTimeout(400)
  check('forgetting it takes the offer away', !(await page.getByText('Pick up where you left off').isVisible()))

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  check(
    'and it stays forgotten across a reload, not just on screen',
    !(await page.getByText('Pick up where you left off').isVisible().catch(() => false)),
  )

  check.is('no page errors along the way', errors.join(' | '), '')
}
