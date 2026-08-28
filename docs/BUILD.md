# Building Systole

Two commands.

```bash
node scripts/build.js path/to/ACCSAP_12_export.html   # → build/systole.html
node scripts/verify.js --pwa                           # → 612 + 40 checks
```

Open `build/systole.html` in a browser. That single file is the whole app.

---

## The source export is not in this repository

Systole is built by patching your own ACCSAP 12 export. Those 638 questions,
408 figures and the ACC's commentary are licensed content: they stay on your
devices and are never committed. `.gitignore` blocks `source/`, `build/`,
`content/` and `dist/` for exactly that reason.

The build finds the export three ways, in order:

```bash
node scripts/build.js ~/Downloads/ACCSAP_12_super_v12.html   # explicit
SYSTOLE_SRC=~/path/to/export.html node scripts/build.js      # environment
mkdir -p source && cp ~/Downloads/ACCSAP*.html source/       # dropped in source/
```

## Prerequisites

- **Node 18+** — no dependencies for the build itself.
- **Playwright + Chromium** — for the test suites only:
  `npm i -g playwright && npx playwright install chromium`
---

## How the build works

Thirty-three patch scripts run in order against the export. Each applies a list of
exact-match find/replace edits and **throws unless every edit matches exactly
once**.

That strictness is the point. A patch that silently matched zero times would be
a feature that quietly disappeared, and a patch that matched twice would be one
applied somewhere it was never meant to go. The failure mode of this build is a
loud error naming the step, not a subtly wrong app.

The cost is that order matters, and the dependencies are real:

| # | Step | Depends on |
|---|------|-----------|
| 1 | `stage0` | stabilises the raw export — everything assumes it |
| 2 | `keys` | six answer keys the export gets wrong, fixed before anything reads them |
| 3 | `apex` | embeds `heart3d.js` and `apex.js`; the only place the heart enters |
| 4–5 | `stage2`, `stage3` | FSRS-5 scheduling, then Apex's vision and memory |
| 6 | `polish` | the rhythm registry the hero and Rhythm Lab both read |
| 7 | `splash` | the pre-paint loading screen |
| 8 | `braunwald` | the grounded reference library |
| 9 | `art` | the design pass the later panels sit inside |
| 10 | `leads` | the 12-lead — needs `art`'s panel styles |
| 11 | `physio` | the cardiac cycle — anchors on the 12-lead's embed comment |
| 12 | `name` | Systole |
| 13 | `theme` | palettes — must follow `name`, it restyles the hero wordmark |
| 14 | `home` | welcome bar, progress bar, layouts |
| 15 | `splash-heart` | the mechanistic heart, into `splash`'s markup |
| 16 | `crisp` | device-pixel ceilings |
| 17 | `scale` | the 4pt spacing scale, and bars that reveal without layout |
| 18 | `type`  | the modular type scale, snapped over everything above |
| 19 | `lab` | removes the Rhythm Lab's 3D heart — late, so what it deletes is final |
| 20 | `review`| fixes from the full code review |
| 21 | `refs` | the reference-note store, and the seeded library that ships with it |
| 22 | `read` | the reading view those notes are read in |
| 23 | `ref-images` | `refimg://`, so a note can cite a figure |
| 24 | `gemini` | a third provider, with its own wire shape and model discovery |
| 25 | `memory` | what Apex keeps about you between sessions |
| 26 | `assets` | an imported chapter brings its figures — rewrites the importer, the renderer and the vision path, so it must follow all three |
| 27 | `chatfigs` | the figure Apex reasons from appears in the answer — after `assets` and `ref-images`, whose work it rewrites |
| 28 | `pearl` | one sentence from your own notes, on the home screen |
| 29 | `homeflow` | home cut to the trace, the pearl and the progress bar; everything else behind a door — last, so it moves finished markup |
| 30 | `pearlcard` | the pearl as a numbered ladder on ECG paper, and the `-webkit-` spellings Safari needs |
| 31 | `offline` | one press pulls all 408 figures onto the device — under `homeflow`'s door row, and only alive in the split build |
| 32 | `pvloop` | the pearl's strip becomes the pressure–volume loop the cardiac-cycle screen already computes |
| 33 | `fullbleed` | the navigation bar leaves the reading column so its colour reaches both edges of an iPad, and reserves the strip the status bar sits in — last, it moves finished chrome |

`node scripts/build.js --list` prints this. The order lives in `CHAIN` in
`scripts/build.js` and nowhere else.

### Useful flags

```bash
node scripts/build.js --keep              # keep every intermediate step
node scripts/build.js --from theme        # resume mid-chain, reusing build/
node scripts/build.js --out ~/systole.html
```

`--from` is what saves time while iterating: change `theme-patch.js`, rerun from
`theme`, and the earlier steps are reused rather than recomputed.

It needs those earlier steps to still be on disk, and a normal build cleans them
up. So the iterating loop is:

```bash
node scripts/build.js --keep              # once, keeps all 20 intermediates
# ...edit scripts/theme-patch.js...
node scripts/build.js --keep --from theme # only steps 14-20 rerun
```

---

## Verifying

```bash
node scripts/verify.js                       # everything, ~4 min
node scripts/verify.js --only physio,theme   # just these
node scripts/verify.js --skip keys --bail    # stop at the first failure
node scripts/verify.js --list                # what each suite defends
```

Twenty-one suites, 612 checks, plus 40 more on the split build. They run one at a
time deliberately: several drive a real WebGL context and several measure
timing, so running them concurrently would produce failures about the harness
rather than the app.

Every suite asserts the *claim*, not that something rendered. `verify-physio`
checks that valve events are measured pressure crossings and that raising
afterload lowers ejection fraction; `verify-leads` checks that aVR is inverted
and the R wave progresses; `verify-keys` re-runs the comparison that found six
mis-keyed questions, so a future export cannot introduce a seventh silently;
`verify-splash-heart` measures that the splash heart's conduction nodes light
in the order the heart depolarises rather than blinking together.

Some modules can be checked without a browser at all, which is much faster
while iterating on the physiology or the ECG maths:

```bash
node -e "global.window=global; require('./src/core/physio.js');
         console.log(window.Physio.derived(0.8))"
```

### The PWA suite

`verify-pwa` tests the Stage 1 split build over HTTP, so it needs building,
serving and tearing down. One flag does all three:

```bash
node scripts/verify.js --pwa
```

**Run it.** It is the only suite that sees the split build, and this is not
theoretical: it asserts the shell stays under 800 KB and that the app boots with
the network cut off. Both of those had silently broken — the shell had grown to
1.7 MB with an inlined heart scan, and the service worker was failing to install
because it precached an icon the build never generated. The checks existed the
whole time; nothing ran them.

The steps by hand, if you need them:

```bash
node scripts/build-pwa.js build/systole.html    # → dist/, icons included
node scripts/serve.js 8080 dist &
node tests/verify-pwa.js http://localhost:8080
```

---

## Repository shape

```
src/core/     heart3d · physio · leads12 · fsrs · vision · profile · rhythms-extra
src/ui/       wiggers · ecg12 · apex · pencil · heroRhythm
scripts/      build · verify · 20 *-patch · build-pwa · serve · shots
tests/        22 Playwright suites (21 single-file + pwa)
docs/         BUILD · BUILD-PLAN · REFERENCE-GUIDE · reference-examples/
```

`src/` is the source of truth. The patch scripts embed those modules into the
page — they are never edited in the built file, and the built file is never
edited by hand.

Modules are plain IIFEs that export onto `window`, so they can be required and
tested in bare Node without a bundler or a browser. That is not an accident of
style; it is what makes the numeric verification above possible.
