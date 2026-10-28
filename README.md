# drnerd

Personal project, not for redistribution — see `LICENSE`. The ACCSAP 12
question bank it is built from is licensed content and is never committed
here; `content/`, `build/`, `dist/` and `source/` are all gitignored.

## Systole — cardiology board review

A single-file study app for the ABIM cardiovascular boards, built from a
personal ACCSAP 12 export. A procedural WebGL heart that beats on a real cardiac
clock, a 12-lead derived from one electrical dipole, a computed cardiac cycle
(Wiggers, pressure–volume loop, coronary flow, Starling and Guyton), FSRS-5–derived
spaced repetition, a timed mock exam that gives no feedback until you hand it in,
a flag for questions to come back to and a list of every question you have
written on, a text size for the question that each device keeps for itself, and Apex — an AI tutor that can be grounded in your own reference
notes, reads the figures they cite, knows what you chose and how you tend to
miss, plans a session from it, and remembers you between sessions.

Home pairs a live cardiac cycle with a pearl drawn from your own reference
notes. Read the pearl as labelled steps, or choose **Paragraph** for the complete
statement with its punctuation intact. **Recall** hides the explanation and
figure while you explain the rule and its qualifications; **Read note** opens
the selected source. Brain holds your progress, and Labs opens the practice tools.

```bash
npm test                                            # no export needed: every suite CI runs
npm run build -- path/to/ACCSAP_export.html       # → build/systole.html
node scripts/verify.js                              # 6950 checks, 155 suites
node scripts/extract-content.js build/systole.html   # refresh content for the split build
node scripts/verify.js --pwa                        # + 147 more on the split build
node scripts/verify.js --engine webkit              # the engine an iPad runs
```

**The question bank is licensed content and is not in this repository.** It
stays on your own devices; `source/`, `build/`, `content/` and `dist/` are all
gitignored.

[![verify](https://github.com/drfahadkhan477-lab/drnerd/actions/workflows/verify.yml/badge.svg)](https://github.com/drfahadkhan477-lab/drnerd/actions/workflows/verify.yml)

**That badge is not the 6950 + 147 checks above — read it as 6867, not 7097.**
CI cannot build the app from the real bank: that needs the licensed export,
which is deliberately never committed here and never will be, on GitHub or
anywhere else that isn't your own devices. So it builds the real app around
an invented bank (`scripts/synthetic-export.js`) and runs the browser suites
on that, except the few whose subject is the real bank itself. It also splits
that build the way a release does and checks the split build over HTTP, in
Chromium and WebKit; those checks are not in the count above, because the
record counts the split build only from a run on the real bank. On every push
it also checks, with no source file: every script parses, the test-suite
list still lists without crashing, `npm run build` still refuses to run and
explains why when no source is present, and
the 76 suites that need neither a browser nor a build all stay green. See
[`.github/workflows/verify.yml`](.github/workflows/verify.yml) for the exact
scope and why the other 230 checks can't run here.

These totals use the last recorded measurements for active suites. The three
Claude configuration suites were retired when that configuration was deleted;
their measurements were removed by qualifying family runs. New assertions
are counted when the next complete run updates the record.

### The device this is for

**iPadOS 13.4 or newer.** Not a preference — the shipped app uses optional
chaining and `??`, which Safari gained in 13.1 (iPadOS 13.4), and unsupported
syntax is not a caught exception: it is a `<script>` block that never runs, and
in this app that block holds the scheduler, the rhythm registry and most of the
rest. One character costs an older tablet the whole application.

Everything above that floor is either used freely or feature-guarded —
`ResizeObserver` falls back to a `resize` listener, `startViewTransition` is
guarded four times over, `backdrop-filter` carries its `-webkit-` prefix, every
`dvh` has the same value in `vh` before it (Safari before 15.4 drops the whole declaration), and a
file the picker hands over is read through `FileReader` where `Blob.arrayBuffer()`
and `Blob.text()` (Safari 14) are missing. What holds this is narrower than the
sentence: `tests/verify-ipad-pure.js` holds the script to a list of constructs
that arrived later, and cannot see a method that is older on one object than on
another, so it counts the places that read a file instead (the shell, and the
page that opens a code-only deploy), and `tests/verify-assets.js` and
`tests/verify-bankstore.js` run the two imports on a page made to lack those
two methods.

The stylesheets are held to a table. `tests/css-floor-table.json` lists every
property, function, unit, pseudo-class, at-rule and media feature they use with
the first iOS Safari that reads it (MDN's data: `scripts/css-floor-table.js`
writes the table from it), and `tests/verify-floor-css-pure.js` fails on a use that is not
in it, so a newer feature cannot arrive unclassified. An older Safari does not
stop at what it does not know: it skips the declaration, or the whole rule that
holds an unknown pseudo-class, or the whole `@media`, and says nothing. A
feature newer than the floor has a row that says what the stylesheets do about
it, and the guard reads that claim where the text can show it. A rule that
uses `color-mix()` or `aspect-ratio` is followed by an `@supports not` rule
that spells it the older way (a plain value written before it would not help:
a declaration with a `var()` in it is taken at face value and comes to nothing
when the page is drawn), a keyword that is newer has the older one before it, no
selector list holds a pseudo-class the floor does not read with one it does,
and `inset` and `padding-block` are not used. The rest is named as progressive
(smooth scrolling, `text-wrap: pretty`: not having it is the older default),
accepted, or inert. `tests/verify-floor.js` is the browser half. It makes the
features that have a fallback unknown to the engine, the way an older Safari
does not know them, and checks that nothing in the app moves, resizes or loses a
ground, a border or a text colour, and that each fallback draws what the rule
it stands in for would have. The first version of the fallback for the diagram
stages had their height and not their width, and that suite is what found it.

What is left is the gap on a flex box, which Safari reads from 14.5 (on a grid
it already does): before it the items of a row close up, a chip against its icon,
an option's letter against its text. Put on every flex box in this machine's
engine, a gap of 0 leaves the screens that were looked at (the home screen, the
study screen, a question answered) complete and legible with their rows touching.
It is accepted, not fixed, and it cannot be made unknown the way the rest can,
so it is the one thing that suite does not hold. Where `color-mix()` is not read
a theme colour stands in for each tint and glow. Nothing has been run on a Safari
as old as 13.4: what is measured is an engine that knows more, with the names of
the features changed.

- **[docs/BUILD.md](docs/BUILD.md)** — how to build and verify it
- **[docs/BUILD-PLAN.html](docs/BUILD-PLAN.html)** — what was built, measured, and why
- **[docs/IPAD.md](docs/IPAD.md)** — getting it onto an iPad, in Safari, without a third-party app
- **[docs/REFERENCE-GUIDE.md](docs/REFERENCE-GUIDE.md)** — writing reference notes for Apex, with [three worked examples](docs/reference-examples/)

Lives in `src/`, `scripts/`, `tests/`, `assets/`, `docs/`.

### The figure tools

`tools/` holds the Python figure scripts. `visual-atlas.py` (extraction and OCR) and
`trim-figure.py` (whitespace trimming, and replaying a crop record) were used
when the figures were first pulled out of the export. `figure-review.py` builds
the sheet a person decides crops on. `add-unit.py` bakes a unit written for the
in-app importer — notes citing `page_figures/…` — into `content/refs/` and
`content/refs-images/<unit>/`, copying only the cited images and re-encoding
them so a unit's page renders do not balloon its figure file (`content/refs-images/<unit>.json`
in the split build, one per unit).

```bash
python3 tools/figure-review.py                      # → build/figure-review.html
python3 tools/trim-figure.py --apply-crops content/refs-images
```

The Braunwald units are baked the same way from the notes in
`content/refs-repo`, each with its reviewed crop record
(`tools/figure-crops.<unit>.json`). That folder lives only on the owner's own
machine: it was a submodule pointing at a private repository, which has been
deleted, so there is no copy to fetch and it should be backed up like the export.
`content/refs` is a real folder that add-unit writes into:

```bash
python3 tools/add-unit.py --unit hf --quality 70 --crops tools/figure-crops.hf.json \
  --notes content/refs-repo/references/heart-failure --figures content/refs-repo/references/heart-failure/visuals
python3 tools/add-unit.py --unit ischemia --crops tools/figure-crops.ischemia.json \
  --notes content/refs-repo/references/ischemia --figures content/refs-repo/references/ischemia/visuals
```

`--quality 70` on hf keeps `content/refs-images/hf.json` under the host's 25 MB
per-file limit; add-unit prints the projected size of each unit's file.

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

`figure-review.py` and `trim-figure.py` are not part of the build; nothing
`npm run build` runs touches them. They need more than the standard library,
which nothing said until now:

```bash
pip install Pillow numpy
# visual-atlas.py shells out to tesseract for the OCR pass:
sudo apt-get install -y tesseract-ocr     # Debian/Ubuntu
brew install tesseract                    # macOS
```

---

## Memorizer

Memorizer, the PDF and study-file learning app that lived in `memorizer/`, is
its own repository now: [drfahadkhan477-lab/Memorizer](https://github.com/drfahadkhan477-lab/Memorizer),
copied from this one at `396a465` with its suites. Two things of it stay here
for Systole: its study-file parser, which `npm run bank` reads study files
with (`scripts/study-file/`, see [`docs/OWN-BANK.md`](docs/OWN-BANK.md)), and
the brain the Brain page draws (`src/core/brain.js`).

## The Practice Lab — heart sounds, tracings, strips

A screen of Systole, opened from its own door on the home screen, carrying
nothing from the export: twelve heart sounds synthesised on `physio.js`'s valve
events, pressure tracings, ECG strips, and a map of which valve and chamber each
one is. It remembers what you miss. It was a separate app until it moved in. See
`docs/LAB.md`.
