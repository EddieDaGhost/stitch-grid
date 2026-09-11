/**
 * The happy path, in a real browser.
 *
 * The assertion that matters most is the gauge one: changing the ROW gauge must change
 * the row count and leave the stitch count alone. That's the browser-side proof that
 * the core idea is actually wired through the UI, not just correct in a pure function.
 */

import { asUpload, photoPng } from './pngfixture.mjs'

// Big enough that the detail slider has real range, and colourful enough that the
// colour-limit controls have something to do.
const upload = asUpload('garden-photo.png', photoPng(800, 800))

/** The summary bar reads "84 × 96" under the "Chart" heading. */
async function readChart(page) {
  const text = await page.getByLabel('Chart summary').innerText()
  const match = text.match(/(\d+)\s*×\s*(\d+)/)
  return match ? { stitches: Number(match[1]), rows: Number(match[2]) } : null
}

async function setNumber(page, label, value) {
  const field = page.getByLabel(label, { exact: true })
  await field.fill(String(value))
  await field.blur()
  await page.waitForTimeout(120)
}

export default async function run({ page, check, errors, URL }) {
  await page.goto(URL, { waitUntil: 'networkidle' })

  // --- the empty state
  check('the empty state explains what this is', (await page.locator('h1').innerText()).includes('stitch-grid'))
  check('and says the picture stays on the device', await page.getByText(/never uploaded/i).isVisible())

  // --- load a picture
  await page.setInputFiles('input[type=file]', upload)
  await page.waitForSelector('[aria-label="Chart summary"]', { timeout: 15000 })
  check('loading a picture opens the designer', await page.getByLabel('Chart summary').isVisible())

  const initial = await readChart(page)
  check('a chart appears with real dimensions', initial && initial.stitches > 2 && initial.rows > 2, JSON.stringify(initial))

  // A square photo at single crochet gauge needs MORE rows than stitches, because rows
  // are shorter than stitches are wide. This is the whole product in one assertion.
  check(
    'a square photo at sc gauge has more rows than stitches',
    initial.rows > initial.stitches,
    `${initial.stitches} sts x ${initial.rows} rows`,
  )
  check.near('and the ratio matches the gauge ratio', initial.rows / initial.stitches, 18 / 16, 0.05)

  // --- the detail slider
  const detail = page.getByLabel('Detail', { exact: true })
  await detail.fill('40')
  await page.waitForTimeout(150)
  const finer = await readChart(page)
  check('more detail means more stitches', finer.stitches > initial.stitches, `${initial.stitches} -> ${finer.stitches}`)
  check('and proportionally more rows', finer.rows > initial.rows)
  check.near(
    'the gauge ratio holds at any detail setting',
    finer.rows / finer.stitches,
    18 / 16,
    0.05,
  )

  await detail.fill('10')
  await page.waitForTimeout(150)
  const coarser = await readChart(page)
  check('less detail means fewer stitches', coarser.stitches < finer.stitches)

  // --- gauge drives rows, and only rows
  await setNumber(page, 'Rows per 4 inches', 7)
  const loose = await readChart(page)
  check.is('changing the row gauge leaves the stitch count alone', loose.stitches, coarser.stitches)
  check('and drops the row count sharply', loose.rows < coarser.rows, `${coarser.rows} -> ${loose.rows}`)
  check.near('to the new gauge ratio', loose.rows / loose.stitches, 7 / 16, 0.06)

  await setNumber(page, 'Rows per 4 inches', 18)
  check.is('and setting it back restores the rows', (await readChart(page)).rows, coarser.rows)

  // --- the finished size is reported, not just the cell count
  check('the finished size is shown', await page.getByText(/\d+(\.\d+)?"\s*×/).first().isVisible())

  // --- colours
  const maxColors = page.getByLabel('Maximum colours', { exact: true })
  await maxColors.fill('4')
  await page.waitForTimeout(200)
  const keyRows = await page.locator('[aria-label="Colour key"] li').count()
  check('limiting to 4 colours gives at most 4 key entries', keyRows <= 4, `got ${keyRows}`)
  check('and at least one', keyRows >= 1)

  await maxColors.fill('12')
  await page.waitForTimeout(200)
  check('raising the limit brings colours back', (await page.locator('[aria-label="Colour key"] li').count()) > keyRows)

  // --- the key carries what you need to shop
  const keyText = await page.getByLabel('Colour key').innerText()
  check('the key lists stitch counts', /\d+\s*stitches/.test(keyText))
  check('and a yarn estimate', /~\d+/.test(keyText))
  check('and is honest that the estimate is rough', /rough/i.test(keyText))

  // --- joins are surfaced next to the colour count
  // innerText is the RENDERED text, and the label style uppercases it.
  check('colour changes are reported', /colour changes/i.test(await page.getByLabel('Chart summary').innerText()))

  // --- undo names the thing it will undo
  const undoLabel = await page.locator('header button[aria-label^="Undo"]').getAttribute('aria-label')
  check('the undo button names the last edit', undoLabel !== 'Undo', undoLabel)

  // Pause past the coalescing window so this counts as a separate undo step. Without
  // the pause the two colour edits merge into one, which is correct behaviour for a
  // drag but makes for a confusing assertion.
  const raised = await page.locator('[aria-label="Colour key"] li').count()
  await page.waitForTimeout(700)
  await maxColors.fill('3')
  await page.waitForTimeout(200)
  await page.locator('header button[aria-label^="Undo"]').click()
  await page.waitForTimeout(250)
  const afterUndo = await page.locator('[aria-label="Colour key"] li').count()
  check.is('undo steps the colour limit back to what it was', afterUndo, raised)

  // --- reset
  await page.getByLabel('Reset all settings').click()
  await page.waitForTimeout(250)
  const afterReset = await readChart(page)
  check.is('reset restores the default detail', afterReset.stitches, initial.stitches)
  check('reset is itself undoable', await page.locator('header button[aria-label^="Undo"]').isEnabled())

  // --- border
  const border = page.getByLabel('Border width', { exact: true })
  await border.fill('4')
  await page.waitForTimeout(200)
  const bordered = await readChart(page)
  check('a border makes the chart bigger', bordered.stitches > afterReset.stitches)
  check(
    'and grows both axes by the same distance, not the same cell count',
    bordered.rows - afterReset.rows !== bordered.stitches - afterReset.stitches,
    `+${bordered.stitches - afterReset.stitches} sts, +${bordered.rows - afterReset.rows} rows`,
  )
  await border.fill('0')
  await page.waitForTimeout(150)

  // --- corner to corner is a different reading, not a different chart
  const beforeC2C = await readChart(page)
  await page.getByRole('group', { name: 'Method' }).getByText('Corner to corner').click()
  await page.waitForTimeout(200)
  const afterC2C = await readChart(page)
  check.is('c2c does not change the chart size', `${afterC2C.stitches}x${afterC2C.rows}`, `${beforeC2C.stitches}x${beforeC2C.rows}`)
  check('and explains how it is read', await page.getByText(/diagonal/i).isVisible())
  await page.getByRole('group', { name: 'Method' }).getByText('In rows').click()

  // --- zoom never changes the design
  const beforeZoom = await readChart(page)
  await page.getByLabel('Zoom in').click()
  await page.getByLabel('Zoom in').click()
  await page.waitForTimeout(150)
  check.is('zooming does not change the chart', JSON.stringify(await readChart(page)), JSON.stringify(beforeZoom))
  const undoAfterZoom = await page.locator('header button[aria-label^="Undo"]').getAttribute('aria-label')
  check('and zoom is not something undo steps through', !undoAfterZoom.includes('zoom'), undoAfterZoom)
  await page.getByLabel('Fit to screen').click()

  // --- preview mode strips the workshop, keeps the work
  await page.getByLabel('Preview mode').click()
  await page.waitForTimeout(200)
  check('preview mode hides the controls', !(await page.getByLabel('Maximum colours', { exact: true }).isVisible().catch(() => false)))
  check('but keeps the summary', await page.getByLabel('Chart summary').isVisible())
  check('and keeps the colour key', await page.getByLabel('Colour key').isVisible())
  check('and keeps the download buttons', await page.getByRole('button', { name: 'Download printable chart PDF' }).isVisible())
  // The grid is a counting aid, so it goes with the rest of the workshop.
  check(
    'preview mode drops the counting grid',
    !(await page.getByLabel('Show counting grid').isVisible().catch(() => false)),
  )
  check('the chart is still on screen', await page.getByRole('img', { name: /Chart preview/ }).isVisible())

  await page.getByLabel('Design mode').click()
  await page.waitForTimeout(200)
  check('going back to design restores the controls', await page.getByLabel('Maximum colours', { exact: true }).isVisible())

  // --- making mode: the half of the job that happens after the PDF
  await page.getByLabel('Make mode').click()
  await page.waitForTimeout(250)

  const rowPanel = page.getByLabel('Current row')
  check('making mode shows the row you are on', await rowPanel.isVisible())
  check('starting at row 1', /Row 1\b/.test(await rowPanel.innerText()))
  check(
    'and says which side it is and which way it runs',
    /RS/.test(await rowPanel.innerText()),
    await rowPanel.innerText(),
  )

  // Switching to making mode must not touch the design — it reads the same Chart.
  await page.getByLabel('Design mode').click()
  await page.waitForTimeout(150)
  const beforeMake = await readChart(page)
  await page.getByLabel('Make mode').click()
  await page.waitForTimeout(200)
  await page.getByLabel('Design mode').click()
  await page.waitForTimeout(200)
  check.is(
    'going in and out of making mode changes nothing',
    JSON.stringify(await readChart(page)),
    JSON.stringify(beforeMake),
  )
  await page.getByLabel('Make mode').click()
  await page.waitForTimeout(200)

  // The controls that EDIT are gone, so a mis-tap cannot alter a chart you are hours into.
  check(
    'making mode hides the design controls',
    !(await page.getByLabel('Maximum colours', { exact: true }).isVisible().catch(() => false)),
  )
  check(
    'and hides undo, because ticking off a row is not an edit',
    !(await page.locator('header button[aria-label^="Undo"]').isVisible().catch(() => false)),
  )
  check(
    'and hides reset for the same reason',
    !(await page.getByLabel('Reset all settings').isVisible().catch(() => false)),
  )
  // Counting is exactly what you are doing here, so the grid stays.
  check('but keeps the counting grid', await page.getByLabel('Show counting grid').isVisible())
  check('and keeps the colour key within reach', await page.getByLabel('Colour key').isVisible())

  // --- ticking off a colour run
  const firstRun = await page.locator('[aria-label="Current row"] [aria-current="step"]').innerText()
  await page.getByLabel('Done with this colour run').click()
  await page.waitForTimeout(150)
  const secondRun = await page.locator('[aria-label="Current row"] [aria-current="step"]').innerText()
  check('ticking a colour run moves to the next one', firstRun !== secondRun, `${firstRun} -> ${secondRun}`)

  // --- finishing rows
  await page.getByLabel('Skip to the next row').click()
  await page.waitForTimeout(150)
  check('finishing a row moves to the next', /Row 2\b/.test(await rowPanel.innerText()))

  await page.getByLabel('Back one colour run').click()
  await page.waitForTimeout(150)
  check('stepping back returns to the row before', /Row 1\b/.test(await rowPanel.innerText()))

  // --- jumping to a row, the way you do when you pick the work back up
  await page.getByLabel('Go to row').fill('5')
  await page.getByRole('button', { name: 'Go', exact: true }).click()
  await page.waitForTimeout(200)
  check('you can jump straight to a row', /Row 5\b/.test(await rowPanel.innerText()))
  check('and the progress panel follows', /4 of/.test(await page.getByLabel('Progress', { exact: true }).innerText()))

  // --- your place survives closing the tab
  // The position is keyed by the chart's own hash, so re-opening the same picture with
  // the same settings has to land on the same row. This is the whole persistence design
  // in one assertion: no project file, no account, nothing but the chart itself.
  await page.reload({ waitUntil: 'networkidle' })
  await page.setInputFiles('input[type=file]', upload)
  await page.waitForSelector('[aria-label="Chart summary"]', { timeout: 15000 })
  const afterReload = await readChart(page)
  check.is(
    'reopening the same picture rebuilds the same chart',
    JSON.stringify(afterReload),
    JSON.stringify(beforeMake),
  )
  await page.getByLabel('Make mode').click()
  await page.waitForTimeout(300)
  check(
    'and your place in it was kept',
    /Row 5\b/.test(await page.getByLabel('Current row').innerText()),
    await page.getByLabel('Current row').innerText(),
  )

  // --- but a DIFFERENT chart is a different piece of work, and starts at row 1
  await page.getByLabel('Design mode').click()
  await page.waitForTimeout(150)
  await page.getByLabel('Detail', { exact: true }).fill('30')
  await page.waitForTimeout(250)
  await page.getByLabel('Make mode').click()
  await page.waitForTimeout(300)
  check(
    'changing the design gives you a fresh row 1, not a stale position',
    /Row 1\b/.test(await page.getByLabel('Current row').innerText()),
    await page.getByLabel('Current row').innerText(),
  )

  await page.getByLabel('Design mode').click()
  await page.waitForTimeout(150)

  check.is('no page errors along the way', errors.join(' | '), '')
}
