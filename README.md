# stitch-grid

Turn a photo into a crochet chart that comes out the right shape.

Drop in a picture, and you get a graphgan chart: a grid of yarn colours, a printable
pattern with the stitches numbered, a colour key with rough yarn amounts, and row-by-row
instructions. Then it keeps your place while you crochet it. Everything happens in your
browser — the picture is never uploaded anywhere, and the whole thing keeps working with
no signal.

---

## Why not just use a pixel-art tool

Because **crochet stitches are not square**, and every generic pixelator assumes they are.

Worked in single crochet, a row is shorter than a stitch is wide — about 16 stitches and
18 rows to four inches. Worked in double crochet it's the other way round and much more
extreme: roughly 12 stitches to 7 rows. So if you pixelate a photo on square graph paper
and crochet the result, the blanket comes out the wrong shape and every circle in it
comes out an oval.

stitch-grid asks for your gauge and does the arithmetic:

```
rows = stitches × (rows per 4in ÷ stitches per 4in) ÷ picture aspect
```

A square photo in single crochet needs **1.125× as many rows as stitches**. The same
photo in double crochet needs **0.583×**. Same picture, wildly different charts, both
correct. The preview, the exported PNG and the printed PDF are all drawn at your real
gauge, so what you see is the shape you'll end up holding.

---

## What it does

**Designing**
- Drag and drop a JPG, PNG or WebP
- **Framing**: drag a frame over the photo to pick the part you want. A blanket is a
  long job — it should be spent on the dog, not on the lawn around it
- A detail slider, showing the stitch count live rather than a pixel size
- Zoom, and a counting grid with a heavier line every ten stitches
- A letter in every cell, on demand — so the chart can be read without telling Sage from
  Moss by eye, which is a guess at arm's length and impossible for some people entirely
- A border of any width, in inches, added *around* the picture without squashing it
- Set an exact chart size, and either keep the whole picture, fill the grid by cropping,
  or stretch to fit — filling crops rather than squashing, because squashing turns every
  circle in the photo into an oval, which is the exact thing this tool exists to stop
- Brightness, contrast and saturation — yarn has a much narrower range than a photo,
  so these usually matter more than anything else
- Undo and reset, where a slider drag counts as one step

**Colours**
- Matching onto a curated palette of 40 generic yarn colours, or just the neutrals or
  pastels
- A cap on how many colours to use, so you aren't asked to buy forty skeins
- Keep a colour you care about, or ban one you don't have
- Stray single stitches tidied away — each one costs a join, a cut and two woven ends

**Making it**
- A **row tracker**: the current row, big, with each colour run as its own line and the
  stitch numbers it covers
- Tick off a colour run at a time, or call the whole row done
- The chart dims behind you as you go, so you can find your place from across the room
  without reading a number
- The same per-cell letters are available here, where the chart *is* the instructions
- Your place is kept per chart, so closing the tab and coming back tomorrow puts you on
  the row you left. Change the design and you get a new chart, and a fresh row 1
- How far in you are, in stitches and in colour changes still to come — not in minutes,
  because nobody can honestly tell you that
- Keeps the screen awake, because a row takes minutes and both hands are full

**Taking it with you**
- **Printable PDF**: the chart across as many sheets as it needs, numbered so they tape
  together, with a letter in every cell so it survives a black-and-white printer, the
  stitches numbered right-to-left and the rows numbered up both sides
- **PNG** of the chart, with the grid and letters if you had them on
- **Written pattern**, run-length encoded per row, with a running stitch total on every
  line so you catch a miscount two rows later instead of twenty
- **Corner-to-corner** mode, which reads the same chart on the diagonal

**Being honest**
- Finished size in inches or centimetres, at *your* gauge, with a note that it depends
  on your tension
- Rough yarn estimates per colour, clearly labelled as rough
- The number of colour changes, next to the colour count — a 12-colour chart with 900
  joins is far more work than a 20-colour one with 200

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static files in dist/
npm run check      # the whole test suite
npm run check -- gauge   # one suite; the pure ones need nothing but Node
```

Deploys as a static site anywhere. On Vercel: framework preset Vite, output `dist/`, no
environment variables.

---

## How it's put together

Everything is a pure function of one value:

```
source picture + settings  ──buildChart()──▶  Chart  ──▶  preview, PNG, PDF, legend,
                                                          yarn, pattern, C2C, progress
```

The row tracker is no exception: it reads the same `Chart` as everything else, which is
why switching to it cannot change a stitch, and why it works on a corner-to-corner
reading for free.

Five modules touch the DOM (`image`, `png`, `download`, `storage`, `wakelock`).
Everything else runs in bare Node, which is why about 85% of the logic — including the
entire hand-rolled PDF writer — is covered by a test suite that needs no browser.

There are three runtime dependencies: React, React DOM and an icon set. The PDF writer is
hand-rolled rather than pulled in, because the app is precached for offline use and a
350KB PDF library in the shell is a real cost paid by every visitor.

See `CLAUDE.md` for the design rules and the things that will bite you.

---

## Licence

MIT.
