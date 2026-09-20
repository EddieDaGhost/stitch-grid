# Working in this repo

Notes for Claude Code, and for anyone else picking this up. The README says what the app
*is* — this file is about changing it without breaking it.

---

## The one-paragraph version

A static React + Vite app that turns a photo into a crochet chart. Everything happens in
the browser; nothing is uploaded, there are no accounts and no backend. The whole design
reduces to one value — a `Chart` — and every feature is a pure function of it. Deploys to
a static host from `main`.

---

## Design rules — please don't quietly break these

These are product decisions, not oversights. If a change would violate one, say so and
ask rather than "improving" it.

1. **A stitch is not square, and gauge is never optional.** `rowsForAspect()` in
   `src/lib/gauge.js` is the whole product. Gauge correction applies in every mode,
   including "fill the grid" — the fit toggle governs how a picture fills a grid whose
   size the user overrode, not whether the maths happens. Anything that draws the chart
   on square cells is a bug, including in the PDF.

   The *picture's* own aspect is the other half of that formula, and it is easier to
   lose than the gauge is. If a photo ever charts as though it were square, suspect
   `source.aspect` before suspecting the maths — see the `ImageBitmap.close()` note
   below, which is exactly how it went wrong once already.

2. **No dithering. Not even as an option.** This gets proposed every time someone looks
   at the quantizer, so: a chart is ~60 cells wide, so there is no spatial resolution to
   trade away; a cell is a quarter-inch of yarn viewed from three feet, so the eye
   resolves every dot instead of blending it; each stray dot costs a join, a cut and two
   woven ends; and it turns the written pattern into `1 Cream, 1 Denim, 1 Cream…`
   forever. `despeckle()` is the feature that ships instead, and it goes the other way.

3. **Be honest about estimates.** Yarn amounts are labelled rough and told to buy 20%
   more. Finished size is stated as "at your gauge" with a note that tension varies.
   Never print a confident number the user would be right to distrust — a fake-precise
   estimate is worse than an openly rough one.

4. **Show what a chart costs, not just what it looks like.** `colourChanges()` sits next
   to the colour count because a 12-colour chart with 900 joins is far more work than a
   20-colour one with 200. Removing it makes the "fewer colours" slider optimise the
   wrong thing.

5. **The picture never leaves the device.** No uploads, no analytics, no telemetry, no
   third-party scripts, no fonts from a CDN. The empty state says so out loud, and that
   promise is why it can be believed.

6. **It works with no signal.** A craft room is often the worst-connected room in the
   house. The service worker precaches the shell; nothing on the path to a first chart
   may wait on the network.

7. **Undo undoes edits, not looks.** Zoom, grid visibility and the current mode are
   view state and are never committed to history. This is the single thing that decides
   whether undo feels useful or broken.

8. **Progress is not a design edit, and making mode cannot make one.** How far up the
   chart you have crocheted lives outside the undo stack entirely — undo dragging
   somebody back twenty rows of finished work would be indefensible. For the same
   reason making mode shows no control that can alter a stitch: no sliders, no undo, no
   reset. A mis-tap while reaching past a propped-up tablet must not be able to change a
   chart somebody is forty hours into.

9. **Fill the grid crops; it does not squash.** `fit: 'cover'` trims the sampled
   rectangle to the grid's shape. Squashing a picture to fit turns every circle in it
   into an oval, which is the precise failure rule 1 exists to prevent on the fabric —
   offering it as the only way to fill a grid was a bug in the product, not a feature.
   `fit: 'stretch'` is still there for anyone who wants it, named for what it does and
   carrying a warning that says so.

10. **A chart must be readable without relying on colour.** Every cell can carry its
   key letter — in the PDF since the first version, and on screen since letters got
   their own layer. A yarn palette is dense in near-neutrals, so Sage and Moss are a
   guess at arm's length even for someone who sees both perfectly; for the share of
   people who do not, a colour-only chart is not hard, it is unusable. The letters come
   from the legend's ranking so the screen, the key and the printed sheet can never call
   the same colour different things.

11. **Your place is keyed by the chart, not by a slot.** `loadProgress` is keyed on
   `chartHash`, so re-opening the same picture with the same settings lands on the row
   you left, and changing the design gives you a fresh row 1 rather than a position that
   silently means something else. That is what buys persistence with no project file, no
   account and no stored image.

---

## Ids are permanent

Every palette entry has an `id`. Saved settings, and any future shared link or saved
project, record a colour **by id**. Renaming an id un-picks that colour for everybody who
already chose it. Display names are free to change; ids never move.

---

## Layout

```
src/
├── config/
│   ├── palette.js   The 40 yarn colours. The ONE place a literal colour is allowed —
│   │                these are content (a physical ball of wool), not theme.
│   └── gauge.js     Stitch presets, default gauge, the hard limits
├── lib/             Pure functions, no React. Tested in bare Node.
│   ├── color.js     sRGB <-> linear <-> CIELAB, CIEDE2000
│   ├── palette.js   The 32³ lookup cube, neighbour table, colour capping
│   ├── gauge.js     THE CORE: rowsForAspect, finished size, yardage
│   ├── layout.js    Crop, settings + picture shape -> where every cell comes from
│   ├── raster.js    Summed-area table — why the slider is free
│   ├── chart.js     The pipeline, and the Chart type
│   ├── pattern.js   Rows, corner-to-corner, legend, yarn, written pattern
│   ├── draw.js      Context-agnostic drawing (canvas OR a test stub)
│   ├── pdf.js       Hand-rolled PDF: objects, xref, streams, escaping
│   ├── chartPdf.js  The printable document: cover, tiles, pattern
│   ├── settings.js  Defaults, clamping, the chart cache key
│   ├── history.js   Undo
│   ├── progress.js  Where you are while making: stepping, stats, the chart overlay
│   └── image/png/download/storage/wakelock.js  ← the ONLY modules that touch the DOM
├── components/      All UI
└── index.css        Every interface colour, as CSS variables
```

**Where things live, in one line each:**

- Changing the yarn colours → `src/config/palette.js`
- Changing how a photo becomes a grid → `src/lib/chart.js`
- Changing which part of the photo is used at all → `src/lib/layout.js` (the crop)
- Changing the crochet maths → `src/lib/gauge.js`
- Changing what gets printed → `src/lib/chartPdf.js`
- Changing how you keep your place while crocheting → `src/lib/progress.js`
- Changing how it looks → `src/index.css` (tokens) or the component

---

## Conventions that matter

**Colours in the interface are never hardcoded.** Everything reads a CSS variable
(`var(--ink)`, `var(--surface)`, `var(--accent)`). The exception, stated in the file
itself, is the 40 yarn hexes in `config/palette.js`.

**The order of the pipeline is load-bearing.** Border and pad cells take their palette
index *before* quantization and are skipped by the remap and by despeckle, which is why a
border colour survives a `maxColors` of 2. Reordering those steps silently changes output.

**Average in linear light, never in sRGB bytes.** Averaging black and white as bytes
gives 128; the true middle grey is 188. `tests/color.mjs` pins this, because getting it
wrong doesn't crash — it just makes every photograph muddy.

**Never put CIEDE2000 on the interaction path.** It's ~40 flops with two `pow(x, 7)`
calls. The 5-bit cube is built once per colour subset; excluding, capping and swapping
colours are `Uint8Array(40)` remaps composed into one. If a slider ever feels slow, check
whether something moved a colour computation into the render loop.

**Draw through `lib/draw.js`, not directly on a context.** It takes anything with the few
2D methods it uses, so the preview, the PNG export and a 20-line recording stub in the
tests all drive identical code.

**The stage is three stacked canvases, and the order is load-bearing.** `data-layer`
names each one in the markup: `chart` (cells, then the making wash), `letters` above it,
and `grid` on top. All three share ONE backing size, so a letter lands exactly on its
cell and a grid line exactly on a cell boundary; sized independently they drift apart by
half a pixel at awkward zooms.

**Canvas backing stores are in DEVICE pixels, never CSS pixels.** `Stage.jsx` multiplies
by `devicePixelRatio` (capped at `MAX_DPR`, and still bounded by `MAX_CANVAS` so a deep
zoom cannot ask for a canvas the browser refuses). Anything measured for legibility —
a grid line's width, the floor below which letters or hairlines stop being drawn — is
then scaled by the caller so the rule still means the same apparent size. Get this wrong
and nothing throws; the chart just comes back soft on every device the app is for.

**Mobile and tablet first, genuinely.** The target is an iPad propped on a craft table and
a phone in a pocket, operated by someone holding a hook. Tap targets ≥ 44px on *both*
axes, every field at exactly 16px (smaller makes iOS zoom the page), `touch-action: none`
on slider tracks (or iOS steals the drag), and no horizontal overflow. `tests/tablet.mjs`
asserts all of it at two viewports.

---

## Testing

```bash
npm run check              # everything
npm run check -- pure      # only the suites that need nothing but Node
npm run check -- browser   # only the ones that drive Chromium
npm run check -- gauge     # one suite
TEST_URL=https://... npm run check
```

The pure suites need nothing but Node — `playwright-core` is imported lazily so a bare
checkout can run them. Browser suites drive real Chromium found via `CHROME_PATH` or
`PLAYWRIGHT_BROWSERS_PATH`; no browser is downloaded at install.

**Run `npm run check` before pushing anyway.** `.github/workflows/check.yml` runs the
same suites on every pull request, split into a pure job and a browser job, but CI is a
backstop rather than the loop you work in — a red pull request costs a round trip that
thirty seconds locally would have saved. The groups live in `tests/run.mjs`, not in the
workflow, so adding a suite cannot forget to run it.

The suites worth knowing about:

- **`color.mjs`** carries the published CIEDE2000 test vectors. They're the only thing
  standing between this repo and the three classic bugs — degrees/radians confusion in
  the T and RT terms, the mean-hue wraparound branches, and the sign of RT. All three
  produce a function that looks fine and matches colours wrongly forever.
- **`pdf.mjs`** asserts that **every cross-reference offset lands exactly on its own
  `N 0 obj`**, that every entry is exactly 20 bytes, and that every `/Length` matches its
  real stream. A broken PDF fails silently — some viewers tolerate a wrong offset, so a
  corrupt file can look fine locally and refuse to open on the machine that matters.
- **`export.mjs`** runs the *same* structural checks against a PDF actually downloaded
  from a browser, so the two code paths can't drift apart.
- **`pattern.mjs`** pins the row direction with a four-cell fixture. Get it backwards and
  every chart is mirrored — which nobody discovers until they've crocheted it.
- **`progress.mjs`** asserts an invariant rather than examples: ticking through a whole
  chart run by run visits every stitch exactly once, the overlay and the numbers agree
  at every single tick, and stitch ranges tile each row with no gap or overlap. An
  off-by-one at a row boundary is not a cosmetic bug here — it is somebody crocheting
  the wrong thing and not finding out for a fortnight.
- **`walkthrough.mjs`** charts a NON-square photo before anything else, and that is not
  incidental. Every other browser fixture is square, so a bug that loses the picture's
  aspect leaves the whole suite green while charting every photograph as a square. Do
  not make that first fixture square to simplify an assertion.
- **`tablet.mjs`** checks the stage's own box, not just the canvas inside it. A canvas
  keeps its size and quietly overflows a collapsed parent, so asserting on the canvas
  alone will happily pass while the chart is a 32-pixel sliver.

---

## Things that will bite you

- **PDF cross-reference offsets are BYTE offsets, and `String.length` is not byte length.**
  The whole file is assembled as a latin1 string so the two are equal by construction;
  `assertLatin1` throws if anything else reaches the buffer.
- **Characters with no WinAnsi byte are transliterated, not dropped.** Dropping an en
  dash turns "stitches 1–30" into "stitches 130", which is a wrong instruction rather
  than a cosmetic loss. See `TRANSLITERATE` in `pdf.js`.
- **`createImageBitmap` needs `imageOrientation: 'from-image'`** or every photo taken in
  portrait on a phone arrives rotated.
- **`ImageBitmap.close()` sets width and height to ZERO.** Read them into locals before
  closing. Reading them afterwards gives `0 / 0`, and every `aspect > 0 ? aspect : 1`
  guard downstream then silently treats the photo as square — so the app charts a 3:2
  photo into a square blanket and nothing anywhere throws. This shipped once and was
  invisible because every browser fixture was square.
- **A canvas sized in CSS pixels is half resolution on a retina screen.** `canvas.width`
  is the backing store; the CSS width is how big it is drawn. Set them equal and the
  browser stretches every hairline into a soft two-pixel smear — which is what the app
  did on every phone and tablet for its whole life, invisibly, because nothing asserted
  on canvas resolution. `tests/tablet.mjs` now runs at `deviceScaleFactor: 2` and checks
  every layer holds `dpr` times the pixels it is shown at.
- **A stroke straddles its coordinate, so line alignment depends on its WIDTH.** An odd
  width lands on whole pixels when centred on a half coordinate, an even one when
  centred on a whole coordinate. `drawGrid` derives the offset from `lineWidth` rather
  than adding a flat `+0.5`; that constant was correct only while every line was exactly
  one device pixel wide.
- **The summed-area table must be `Float64Array`.** A 1024² image sums past 6×10¹⁰, which
  overflows a uint32 and silently corrupts the bottom-right quadrant.
- **Crochet row 1 is the BOTTOM row**, and odd rows read the cells array reversed. That
  inversion lives in `pattern.js` and must not be duplicated anywhere else.
- **Stitch numbers along the PDF run RIGHT TO LEFT.** Stitch 1 is the right-hand edge,
  because row 1 is worked right to left. Numbering them the other way is subtle and
  infuriating.
- **`innerText` in tests returns the RENDERED text**, so `.label` elements come back
  uppercased by CSS. Match case-insensitively.
- **Tailwind only keeps classes it can literally see.** No constructed class names.
- **One `fillText` per cell is the most expensive thing the renderer does.** Measured in
  Chromium: ~44ms for a 5,000 cell chart, ~350ms for a big one — three to twenty frames.
  Design mode rebuilds the chart on every tick of the detail slider, so the letters get
  their OWN canvas layer and their own delayed pass (`LETTER_DELAY_MS` in `Stage.jsx`).
  Drag a slider and they are simply absent; stop, and they appear. Never move them back
  into the chart-canvas pass to "simplify" it.
- **Printed stitch numbers are not working order.** Stitch 1 is the right-hand edge, so
  a right-side row is worked in ascending numbers and a wrong-side row counts DOWN from
  the stitch count. `runRange` is the only place allowed to know that; everywhere else
  works in hook order.
- **`scrollIntoView` scrolls every scrollable ancestor, the page included.** Keeping the
  current run visible with it silently scrolls the chart off the top of a stacked
  layout on every tick. Move the list's own `scrollTop` instead.
- **Below `lg` the app stacks, and must NOT be a fixed height.** The panel column is
  taller than the screen, so `h-[100dvh]` hands the stage whatever is left — nothing.
  The stage carries its own `min-h` for the stacked case; `tests/tablet.mjs` guards it.

---

## Workflow

- Develop on a branch, keep adding to the open pull request until it's merged.
- After a merge, restart the branch from the new `main` rather than stacking on merged
  history.
- Commit messages explain *why*, and note what was verified and what wasn't.
