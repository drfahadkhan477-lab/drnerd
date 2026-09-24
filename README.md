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
node scripts/verify.js                              # 2944 checks, 90 suites
node scripts/verify.js --pwa                        # + 133 more on the split build
node scripts/verify.js --engine webkit              # the engine an iPad runs
```

**The question bank is licensed content and is not in this repository.** It
stays on your own devices; `source/`, `build/`, `content/` and `dist/` are all
gitignored.

[![verify](https://github.com/drfahadkhan477-lab/drnerd/actions/workflows/verify.yml/badge.svg)](https://github.com/drfahadkhan477-lab/drnerd/actions/workflows/verify.yml)

**That badge is not the 2944 + 133 checks above — read it as 1393, not 3077.**
CI has no way to build the app at all: a real build needs the licensed
export, which is deliberately never committed here and never will be, on
GitHub or anywhere else that isn't your own devices. What CI *can* and does
run on every push, with no browser and no source file: every script parses,
the patch chain and the test-suite list both still list without crashing,
`scripts/build.js` still refuses to run and explains why when no source is
present, and the 47 suites that need neither a browser nor a build all stay
green. See [`.github/workflows/verify.yml`](.github/workflows/verify.yml) for
the exact scope and why the other 1684 checks can't run here.

### The device this is for

**iPadOS 13.4 or newer.** Not a preference — the shipped app uses optional
chaining and `??`, which Safari gained in 13.1 (iPadOS 13.4), and unsupported
syntax is not a caught exception: it is a `<script>` block that never runs, and
in this app that block holds the scheduler, the rhythm registry and most of the
rest. One character costs an older tablet the whole application.

Everything above that floor is either used freely or feature-guarded —
`ResizeObserver` falls back to a `resize` listener, `startViewTransition` is
guarded four times over, and `backdrop-filter` carries its `-webkit-` prefix.
Nothing in the app requires a Safari newer than 13.4 unconditionally, and
`tests/verify-ipad-pure.js` holds it to that.

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

## Memorizer — master any PDF

A second, standalone app in [`memorizer/`](memorizer/). Upload a PDF — any
subject — and it is read **in your browser** with pdf.js, split into sections
at its headings (including the ones set in body type and marked only by their
number, "A. Etiology." or "17.2 Clinical features", which are titled under the
heading above them), and taught one section at a time:

1. **Encode** — the key points, each citing its page; one mnemonic; a
   flowchart when the section describes a process.
2. **Recall** — free-recall questions, answered from memory and graded.
3. **Teach back** — explain the section aloud (dictation where the browser
   has it) as if to a colleague; scored, with the gaps named.
4. **Gauntlet** — after the last section, hostile examiner questions leaning
   on your weakest sections.

Every missed answer and every gap becomes a review card, scheduled with the
same FSRS scheduler Systole uses (`src/core/fsrs.js`, shared, not copied).

Sections are short, and the study page shows each one as a handful of
bullets with the key term first, the memory hook in a handwritten face beside
them — built from the section's own lists where it has one — a flowchart drawn
from its cause-and-effect sentences, its tables as tables, its figures cut
from the page — pictures, and charts drawn as lines, but not a highlight band
behind text or ruled lines under a table — under their own captions, and the
pages themselves. A numbered figure is
shown with the section whose text names it ("see Fig. 17.3"), wherever it was
printed; one that nothing names is shown with the section on its page.

The home screen is laid out as Systole's, and holds still: a hero band with
where you are and a two-layer progress bar (sections studied; review cards
FSRS says you still hold today), a pearl of the day — a sentence from your
own PDF, found and broken into steps by Systole's `src/core/pearl.js`, shared
rather than copied — doors to continue, review, add a PDF or change
settings, and your weak spots: the sections your sessions say you hold least
well, each with a drill of its review cards, due or not. The look is Systole's too: its themes, colour for colour, and its
type scale, with text size, reading width, line spacing, font, contrast and
brightness to choose. Contrast and brightness are computed from the theme you
pick, and every theme at every setting is tested to keep its text at WCAG AA
or better, with form controls outlined to WCAG's floor for controls.

```bash
npm run memorizer          # → dist-memorizer/index.html, one self-contained file
npm run memorizer:serve    # the same, served on :8081 so it installs as an app
```

**It needs no API key.** The default is a built-in coach that runs the whole
protocol on the device: key points are the PDF's own sentences, verbatim;
recall asks the section's definitions, its "most common" facts and its
longest list, then fill-in-the-blank; the gauntlet asks definitions
backwards (the meaning given, the term wanted), names the lists recall did
not, and blanks sentences recall never showed; grading matches words, and a
synonym can be counted as correct by you. Nothing leaves the device. For
deeper questions and grading that understands answers in your own words, add
a Claude key in Settings — then each step sends only the text of the section
being studied, and every prompt forbids the model from adding anything that
is not in your PDF. Either way the PDF is never uploaded; it is kept only on
your device, so its pages and figures can be shown.
Memorizer carries no content of its own, so unlike Systole it builds
anywhere, CI included.
