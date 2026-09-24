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
present, and the 50 suites that need neither a browser nor a build all stay
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

A second, standalone app in [`memorizer/`](memorizer/). Add a chapter — a PDF,
photos of its pages, or pasted notes — and it is read **in your browser** and
split into sections first: at its topic headings, so each topic is a section
of its own, and at the headings set in body type and marked only by their
number ("A. Etiology.", "17.2 Clinical features"), which stay inside their
topic. Pages of two columns are read column by column however the PDF wrote
them, and scanned pages and photos — pictures of text — are read by text
recognition, on the device. The unit then opens as a grid of its sections,
each with its state and its best score, and a final exam that unlocks when
every section is done. Each section is:

1. **Taught** — the big idea first, then the key points as numbered cards
   (the key term bold, each citing its page, the paragraph it came from one
   tap away), the numbers to know with their values marked, a mnemonic for
   every list, everyday analogies for the mechanisms, a flowchart drawn from
   its cause-and-effect sentences, its tables as tables and its figures cut
   from the page under their own captions.
2. **Drilled** — single-best-answer multiple-choice questions, four options,
   never a blank to type into: the right option turns green, a wrong choice
   red, and the book's own sentence says why. A question missed on the first
   try is asked again at the end of the drill, and only first tries count
   toward the score.
3. **Examined** — after the last section, a final exam across the unit,
   weighted to your weakest sections, that does not name the section a
   question is from until you have answered it.

**A whole textbook** can be added as one book, in as many PDFs as it came
in: the parts are put in order by the numbers in their names and their pages
numbered straight through, so a page reference means the same page wherever
the split fell. The book is cut into chapters three independent ways — the
PDF's own bookmarks, its "Chapter N" headings and running headers, and the
heading size that opens chapters — and the one that fits best is used; the
book's page shows the others, and any chapter can be joined to the one before
it. A chapter whose pages do not change keeps its progress. Each chapter is a
unit like any other, and its figures are found the first time it is opened.

**Ask your book.** Type a question and the built-in coach answers with the
book's own sentences, word for word, each labelled with where it was printed,
arranged under clinical headings (definition, causes, mechanism,
presentation, diagnosis, treatment, complications) that are marked as
Memorizer's arrangement, not the book's; when nothing matches it says "Not
found in your book" rather than guess. It finds sentences through five
indexes — chapters, diseases, clinical scenarios, diagnostic tests and
treatments — built on the device from a vocabulary of cardiology terms and
their synonyms ("NT-proBNP", "TAVI", a drug by its suffix), and the indexes
can be browsed too. Nothing is sent anywhere.

**An on-device AI tutor, optional.** Turned on in Settings, a small language
model (Llama 3.2 1B or Gemma 3 1B, through WebLLM on WebGPU) is downloaded
once and runs on the iPad with no key and no connection. It explains a
section in plain words, suggests an analogy, summarises what the book says in
answer to a question, and writes harder questions. It is not a source of
facts, and nothing it writes is shown unchecked (`memorizer/src/ground.js`):
a sentence with a number or a disease, test or drug its book passage does
not have is dropped; a summary sentence must cite the passage it comes from
and mostly use its words; and a question is asked only when a sentence of
the section states its answer — that sentence, with its page, is the
explanation shown, not the model's. What is dropped is counted on screen.

Every missed answer becomes a review card — the same multiple-choice question
— scheduled with the same FSRS scheduler Systole uses (`src/core/fsrs.js`,
shared, not copied).

The home screen asks what you want to learn: a big box to add a chapter, with
chips for a PDF, photos or pasted notes; your streak and the cards due; "jump
back in" cards with a progress ring and the section up next; the sections
that need work, each with a drill of its review cards, due or not; a pearl of
the day — a sentence from your own PDF, found and broken into steps by
Systole's `src/core/pearl.js`, shared rather than copied — and your units,
each with its progress. Nothing on it moves. The look is Systole's too: its
themes, colour for colour, and its type scale, with text size, reading width,
line spacing, font, contrast and brightness to choose. Contrast and
brightness are computed from the theme you pick, and every theme at every
setting is tested to keep its text at WCAG AA or better, with form controls
outlined to WCAG's floor for controls.

```bash
npm run memorizer          # → dist-memorizer/index.html, one self-contained file
npm run memorizer:serve    # the same, served on :8081 so it installs as an app
```

**It needs no API key.** The default is a built-in coach that runs the whole
protocol on the device. Its lessons are the book's own sentences, verbatim.
Its analogies come from a bank written for common cardiology mechanisms —
preload, afterload, stenosis, re-entry, tamponade and more — matched to the
section, and each is labelled as Memorizer's, not the book's: the book is the
authority. Its questions are built from the book: the right option and its
explanation are the book's words, and the wrong options are real terms,
causes, list items and values from elsewhere in the same unit — "which is
most common", "all of the following EXCEPT", table values, a sentence with
one term or number to choose. Nothing leaves the device. For deeper lessons,
analogies for any topic and clinical-vignette questions, add a Claude key in
Settings — then each lesson and drill sends only the text of the section
being studied, the exam sends the key points of every section and the full
text of only your weakest, and every prompt forbids the model from adding
anything that is not in your PDF; the one thing it may write itself is an
analogy, labelled as Claude's and barred from carrying a fact. Either way the
PDF is never uploaded; it is kept only on your device, so its pages and
figures can be shown. Scanned pages and photos are read by Tesseract,
fetched from jsDelivr the first time it is needed — pinned and
integrity-checked like the PDF reader, and kept for offline use after that —
and your units name every page read that way, so you know which text came
from recognition rather than the PDF itself.
Memorizer carries no content of its own, so unlike Systole it builds
anywhere, CI included.
