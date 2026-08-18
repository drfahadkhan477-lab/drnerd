# Building Systole

Two commands.

```bash
node scripts/build.js path/to/ACCSAP_12_export.html   # → build/systole.html
node scripts/verify.js                                 # → 354 checks
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
- **`assets/heart-scan/`** — committed, so nothing to do. To rebuild it from a
  different scan: `node scripts/prep-glb.js <model.glb>`. It refuses any model
  without a licence in `asset.extras`, and the credit it extracts is rendered
  at runtime because CC-BY requires it.

---

## How the build works

Seventeen patch scripts run in order against the export. Each applies a list of
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
| 2 | `apex` | embeds `heart3d.js` and `apex.js`; the only place the heart enters |
| 3–4 | `stage2`, `stage3` | FSRS-5 scheduling, then Apex's vision and memory |
| 5 | `polish` | the rhythm registry the hero and Rhythm Lab both read |
| 6 | `splash` | the pre-paint loading screen |
| 7 | `ink` | the engraved drawing style |
| 8 | `braunwald` | the grounded reference library |
| 9 | `art` | the design pass the later panels sit inside |
| 10 | `leads` | the 12-lead — needs `art`'s panel styles |
| 11 | `scan` | the photoreal heart — needs `assets/heart-scan` |
| 12 | `physio` | the cardiac cycle — anchors on the 12-lead's embed comment |
| 13 | `name` | Systole |
| 14 | `theme` | palettes — must follow `name`, it restyles the hero wordmark |
| 15 | `home` | welcome bar, progress bar, layouts |
| 16 | `splash-heart` | the crystal heart, into `splash`'s markup |
| 17 | `crisp` | device-pixel ceilings, applied last over everything |

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
node scripts/build.js --keep              # once, keeps all 17 intermediates
# ...edit scripts/theme-patch.js...
node scripts/build.js --keep --from theme # only steps 14-17 rerun
```

---

## Verifying

```bash
node scripts/verify.js                       # everything, ~8 min
node scripts/verify.js --only physio,theme   # just these
node scripts/verify.js --skip scan --bail    # stop at the first failure
node scripts/verify.js --list                # what each suite defends
```

Fifteen suites, ~354 checks. They run one at a time deliberately: most drive a
real WebGL context and several measure timing, so running them concurrently
would produce failures about the harness rather than the app.

Every suite asserts the *claim*, not that something rendered. `verify-physio`
checks that valve events are measured pressure crossings and that raising
afterload lowers ejection fraction; `verify-leads` checks that aVR is inverted
and the R wave progresses; `verify-scan` checks that the mesh actually deforms
across the cardiac cycle and that the CC-BY credit is on screen.

Some modules can be checked without a browser at all, which is much faster
while iterating on the physiology or the ECG maths:

```bash
node -e "global.window=global; require('./src/core/physio.js');
         console.log(window.Physio.derived(0.8))"
```

### The PWA suite

`verify-pwa` tests the Stage 1 split build over HTTP, so it needs a server:

```bash
node scripts/build-pwa.js build/systole.html    # → dist/
node scripts/serve.js 8080 dist &
node tests/verify-pwa.js http://localhost:8080
```

---

## Repository shape

```
src/core/     heart3d · physio · leads12 · fsrs · vision · profile · rhythms-extra
src/ui/       wiggers · ecg12 · apex · pencil · heroRhythm
scripts/      build · verify · 17 *-patch · prep-glb · build-pwa · serve · shots
tests/        16 Playwright suites
assets/       heart-scan (CC-BY-4.0, credited at runtime)
docs/         BUILD · BUILD-PLAN · REFERENCE-GUIDE
```

`src/` is the source of truth. The patch scripts embed those modules into the
page — they are never edited in the built file, and the built file is never
edited by hand.

Modules are plain IIFEs that export onto `window`, so they can be required and
tested in bare Node without a bundler or a browser. That is not an accident of
style; it is what makes the numeric verification above possible.
