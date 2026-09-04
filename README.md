# drnerd

Personal project, not for redistribution — see `LICENSE`. The ACCSAP 12
question bank it is built from is licensed content and is never committed
here; `content/`, `build/`, `dist/` and `source/` are all gitignored.

## Systole — cardiology board review

A single-file study app for the ABIM cardiovascular boards, built by patching a
personal ACCSAP 12 export. A procedural WebGL heart that beats on a real cardiac
clock, a 12-lead derived from one electrical dipole, a computed cardiac cycle
(Wiggers, pressure–volume loop, coronary flow, Starling and Guyton), FSRS-5–derived
spaced repetition, and Apex — an AI tutor that can be grounded in your own
reference notes, reads the figures they cite, and remembers you between
sessions.

The home screen says one thing: a live ECG, one pearl drawn from your own
reference notes — broken at its own joints into a numbered ladder, over ECG
paper, with the pressure–volume loop turning in its corner — how far through
the bank you are,
and a row of glass doors to everything else.

```bash
node scripts/build.js path/to/ACCSAP_export.html   # → build/systole.html
node scripts/verify.js                              # 1583 checks, 47 suites
node scripts/verify.js --pwa                        # + 76 more on the split build
node scripts/verify.js --engine webkit              # the engine an iPad runs
```

**The question bank is licensed content and is not in this repository.** It
stays on your own devices; `source/`, `build/`, `content/` and `dist/` are all
gitignored.

[![verify](https://github.com/drfahadkhan477-lab/drnerd/actions/workflows/verify.yml/badge.svg)](https://github.com/drfahadkhan477-lab/drnerd/actions/workflows/verify.yml)

**That badge is not the 1583 + 91 checks above — read it as 247, not 1674.**
CI has no way to build the app at all: a real build needs the licensed
export, which is deliberately never committed here and never will be, on
GitHub or anywhere else that isn't your own devices. What CI *can* and does
run on every push, with no browser and no source file: every script parses,
the patch chain and the test-suite list both still list without crashing,
`scripts/build.js` still refuses to run and explains why when no source is
present, and the two suites that are pure logic with zero build dependency —
`verify-fsrs.js` (the scheduler, 38 checks) and `verify-worker.js` (the
Cloudflare Worker holding the Gemini key, 51 checks) — both stay green. See
[`.github/workflows/verify.yml`](.github/workflows/verify.yml) for the exact
scope and why the other 1210 checks can't run here.

- **[docs/BUILD.md](docs/BUILD.md)** — how to build and verify it
- **[docs/BUILD-PLAN.html](docs/BUILD-PLAN.html)** — what was built, measured, and why
- **[docs/IPAD.md](docs/IPAD.md)** — getting it onto an iPad, in Safari, without a third-party app
- **[docs/REFERENCE-GUIDE.md](docs/REFERENCE-GUIDE.md)** — writing reference notes for Apex, with [three worked examples](docs/reference-examples/)

Lives in `src/`, `scripts/`, `tests/`, `assets/`, `docs/`.

### The figure tools

`tools/` holds three Python scripts. `visual-atlas.py` (extraction and OCR) and
`trim-figure.py` (whitespace trimming, and replaying a crop record) were used
when the figures were first pulled out of the export. `figure-review.py` builds
the sheet a person decides crops on.

```bash
python3 tools/figure-review.py                      # → build/figure-review.html
python3 tools/trim-figure.py --apply-crops content/refs-images
```

**Why a person decides.** Every automatic cropper tried on this corpus has been
wrong in a way that destroys information: the colour-based one cut TABLE 56.5
down to 5% of its page, and the ink-profile detector scores clean multi-panel
artwork as prose — on `022_FIG.55.1` it would have cut at 177px and taken panel
A with it. Three of the four figures it flagged were false positives. So it no
longer decides anything; it *ranks*, worst first, and `figure-review.py` builds
a self-contained offline sheet — every image inlined, so it opens on an iPad
with no network — where each figure is kept whole or given a box by hand.

What comes out is `tools/figure-crops.<tree>.json`: boxes in the original
image's pixels with the reason each was cropped, alongside the figures looked
at and deliberately left alone. That record is the durable artefact, because
`content/` is gitignored — a crop that lives only in a JPEG is lost the next
time the images are built. `tests/verify-figreview.js` drives the whole round
trip, sheet to cropped pixels, and holds the one invariant the hour of tapping
depends on: the box recorded is in *original* pixels, not preview pixels.

`figure-review.py` and `trim-figure.py` are not part of the build; nothing in
`scripts/build.js` touches them. They need more than the standard library,
which nothing said until now:

```bash
pip install Pillow numpy
# visual-atlas.py shells out to tesseract for the OCR pass:
sudo apt-get install -y tesseract-ocr     # Debian/Ubuntu
brew install tesseract                    # macOS
```

---
