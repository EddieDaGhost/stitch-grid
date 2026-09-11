/**
 * The layout on the device this is actually for.
 *
 * A tablet propped on a craft table, and a phone in a pocket. Both get checked, because
 * the failure modes differ: the tablet reveals cramped two-column layouts, the phone
 * reveals horizontal overflow and controls too small to hit with yarn in your hand.
 */

import { asUpload, photoPng } from './pngfixture.mjs'

const upload = asUpload('garden-photo.png', photoPng(600, 600))

const overflow = (page) =>
  page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))

async function assertNoOverflow(page, check, label) {
  const { scroll, client } = await overflow(page)
  check(`${label}: nothing spills off the side`, scroll <= client + 1, `${scroll} > ${client}`)
}

/**
 * 44px is the size a finger reliably hits, and this app is used one-handed with the
 * other hand holding a hook. Run per mode, not once — making mode is the one used
 * while actually crocheting, so its targets matter most of all.
 */
async function assertTapTargets(page, check, label) {
  const small = await page.evaluate(() => {
    const bad = []
    for (const el of document.querySelectorAll('button, input[type=range], select')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      if (Math.min(r.width, r.height) < 43.5) {
        bad.push(`${el.tagName}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''} ${Math.round(r.width)}x${Math.round(r.height)}`)
      }
    }
    return bad
  })
  check(`${label}: every control is at least 44px`, small.length === 0, small.slice(0, 4).join(', '))

  // iOS zooms the whole page when a field under 16px takes focus.
  const tiny = await page.evaluate(() =>
    [...document.querySelectorAll('input:not([type=range]), select, textarea')]
      .map((el) => ({ label: el.getAttribute('aria-label'), size: getComputedStyle(el).fontSize }))
      .filter((x) => parseFloat(x.size) < 16),
  )
  check(`${label}: no field is small enough to make iOS zoom`, tiny.length === 0, JSON.stringify(tiny.slice(0, 3)))
}

export default async function run({ browser, check, URL }) {
  for (const device of [
    { label: 'tablet', width: 834, height: 1112 },
    { label: 'phone', width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height },
      deviceScaleFactor: 2,
    })
    const page = await context.newPage()

    try {
      await page.goto(URL, { waitUntil: 'networkidle' })
      await assertNoOverflow(page, check, `${device.label} empty state`)

      await page.setInputFiles('input[type=file]', upload)
      await page.waitForSelector('[aria-label="Chart summary"]', { timeout: 15000 })
      await assertNoOverflow(page, check, `${device.label} design mode`)

      await page.getByLabel('Preview mode').click()
      await page.waitForTimeout(200)
      await assertNoOverflow(page, check, `${device.label} preview mode`)

      // Making mode is the one held in a lap with a hook in the other hand.
      await page.getByLabel('Make mode').click()
      await page.waitForTimeout(300)
      await assertNoOverflow(page, check, `${device.label} making mode`)
      await assertTapTargets(page, check, `${device.label} making mode`)
      const advance = await page.getByLabel('Done with this colour run').boundingBox()
      check(
        `${device.label}: the button you press every few minutes is a big one`,
        advance && advance.height >= 52,
        advance ? `${Math.round(advance.width)}x${Math.round(advance.height)}` : 'missing',
      )

      await page.getByLabel('Design mode').click()
      await page.waitForTimeout(200)

      await assertTapTargets(page, check, `${device.label} design mode`)

      // --- the slider must not lose its drag to page scrolling
      const touchAction = await page.evaluate(() => {
        const slider = document.querySelector('input[type=range]')
        return slider ? getComputedStyle(slider).touchAction : null
      })
      check(`${device.label}: sliders claim the drag from the page`, touchAction === 'none', String(touchAction))

      // --- the chart is actually visible, not scrolled off somewhere
      const canvas = await page.getByRole('img', { name: /Chart preview/ }).boundingBox()
      check(`${device.label}: the chart is on screen`, canvas && canvas.width > 40 && canvas.height > 40)

      /*
        And the viewport HOLDING the chart is a usable size. Stacked under a panel column
        taller than the screen, a fixed-height layout gives the stage whatever is left
        over — which is nothing, so the chart ends up a sliver with the canvas spilling
        out of it. Checking the canvas alone misses that entirely: it keeps its own size
        and simply overflows.
      */
      const stage = await page.locator('.stage').boundingBox()
      check(
        `${device.label}: the chart viewport is big enough to judge a chart in`,
        stage && stage.height >= 280,
        stage ? `${Math.round(stage.width)}x${Math.round(stage.height)}` : 'missing',
      )

      // --- accessible names exist for everything interactive
      const unnamed = await page.evaluate(() =>
        [...document.querySelectorAll('button')].filter((b) => {
          const r = b.getBoundingClientRect()
          if (r.width === 0 && r.height === 0) return false
          return !(b.getAttribute('aria-label') || b.textContent.trim())
        }).length,
      )
      check.is(`${device.label}: every button has a name`, unnamed, 0)
    } finally {
      await context.close()
    }
  }
}
