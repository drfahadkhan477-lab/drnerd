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
node scripts/verify.js                              # 4412 checks, 111 suites
node scripts/verify.js --pwa                        # + 133 more on the split build
node scripts/verify.js --engine webkit              # the engine an iPad runs
```

**The question bank is licensed content and is not in this repository.** It
stays on your own devices; `source/`, `build/`, `content/` and `dist/` are all
gitignored.

[![verify](https://github.com/drfahadkhan477-lab/drnerd/actions/workflows/verify.yml/badge.svg)](https://github.com/drfahadkhan477-lab/drnerd/actions/workflows/verify.yml)

**That badge is not the 4412 + 133 checks above — read it as 2807, not 4545.**
CI has no way to build the app at all: a real build needs the licensed
export, which is deliberately never committed here and never will be, on
GitHub or anywhere else that isn't your own devices. What CI *can* and does
run on every push, with no browser and no source file: every script parses,
the patch chain and the test-suite list both still list without crashing,
`scripts/build.js` still refuses to run and explains why when no source is
present, and the 58 suites that need neither a browser nor a build all stay
green. See [`.github/workflows/verify.yml`](.github/workflows/verify.yml) for
the exact scope and why the other 1738 checks can't run here.

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
   tap away; what an exam asks — the most common cause, the first-line
   drug, what to avoid, a threshold, what predicts death — is taken first
   and tagged "High yield" with why; a figure's caption is never a point), the numbers to know with their values marked, a mnemonic for
   every list, everyday analogies for the mechanisms, a flowchart drawn from
   its cause-and-effect sentences, its tables as tables and its figures cut
   from the page under their own captions.
2. **Drilled** — single-best-answer multiple-choice questions, four options,
   never a blank to type into, board-style where the book allows ("What is
   the first-line therapy for …?", "Which is contraindicated with …?", a drug
   against other drugs), from high-yield sentences first: the right option turns green, a wrong choice
   red, and the book's own sentence says why. A question missed on the first
   try is asked again at the end of the drill, and only first tries count
   toward the score.
3. **Examined** — after the last section, a final exam across the unit,
   weighted to your weakest sections, that does not name the section a
   question is from until you have answered it.

**The owner's Supreme Memorizer skill is built into the coach**
([`memorizer/src/skill.js`](memorizer/src/skill.js)). Every miss is typed by
what happened, and the type decides the fix:
- **Confusion:** a wrong option picked. It is shown side by side with the right one.
- **Never encountered:** "Not sure". It is re-taught from the page.
- **Retrieval:** missed, then right when asked again. It gets more retrieval and no new hook.
- **Encoding:** missed twice. It is re-taught with a different kind of hook.

Each fix is built from the book's own sentences. A missed item stays on a
weak list until it is right in two rounds far enough apart. Mixed review
rounds are offered as you go and run before the exam, and the exam result
carries the skill's closing sheet: three pillars, the mnemonics, and a
weak-area report. Asked where you are weak, the Coach names the items still
weak, with their types. With Claude, the same protocol is sent as a cached system
prompt, after the rule that it may teach only from your PDF.

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

**A study pack written with Claude.** On a unit's page — through the
*Study pack* button beside *Learn unit*, or straight from a unit's or a
chapter's ⋮ menu, which open its card in view — *Copy the prompt*
gives a request for your own Claude chat — claude.ai, with your own skills —
that carries the unit's text page by page and asks for every section's lesson
and questions in a fixed JSON shape: the key points, the numbers, the
mechanism, the pairs students confuse and the exam pearls; board-style
questions that say why each wrong option is wrong and name the trap each one
sets. A long chapter is asked for a few sections to a reply, so none is cut
off. Paste each reply back and Memorizer checks it against your book
([`memorizer/src/pack.js`](memorizer/src/pack.js)) before any of it is used.
A number not in the section or on the page it cites is flagged on screen
where it is shown. So is a page outside the section, a condition, test or
treatment the chapter never names, and a quoted sentence that is not the
book's. Three things are refused, with the reason: a section from another
unit, a question that is not a fair single-best-answer, and anything Claude
itself marked `NOT_IN_PDF`. What passes teaches the section, labelled
"Written with Claude · checked against your book", and the drill asks its
questions. The pack stays on the device, and `scripts/leak-guard.js` refuses
a saved pack or prompt at commit, since both carry your book.

**A lesson built as one mental model.** Step by step, a section is taught
in stages — *orient*, *mechanism*, *recognise*, *numbers*, *don't confuse*,
*recall* — shown as a strip over the slides, each a tap straight to its
first slide, and only the stages the section has material for. It opens
with a **clinical map** of what the section names (conditions, scenarios,
tests, treatments, each with the page it is first named on), asks **"why?"
down the section's own chain of cause and effect** one link at a time,
and ends with recall: the mnemonics, a check, teaching it back and, from a
pack, **rounds** — an oral case, the examiner's question, the model answer
on request. Every page reference opens that page of the PDF as printed,
and *One screen* puts the whole section — idea, points, values, the pairs
confused, hooks, pearls — on one card to glance at before a drill.

**Misses taught by their kind, and exams under exam conditions.** A wrong
number for the right thing is its own kind of miss, *wrong value*, and is
anchored at once among the section's other values rather than contrasted
like a confusion. A pack's teach-back is scored against its rubric — the
points, its pearls and its mechanism. **Review asks the most dangerous
first:** a confident miss, then the kinds a hook has not yet held (an
encoding miss, a wrong value, a confusion) before those that only need
retrieving, the most-lapsed and longest-overdue first, mixed across
sections so no two in a row come from one while another is waiting. The final exam asks a pack's
questions for the sections it covers, and can be taken under **exam
conditions**: a clock at a board's pace, each answer held rather than
marked, and at the end what was missed with the answer picked, the right
one and why. **Focus** hides the dock, the robot and the background while
studying; the dock itself carries the one next thing on the screen
(learn, memorise, drill, next, sections), and none while a question is
open. The pearl of the day can be **recalled first**, its values hidden
until asked for, with an honest "I knew it" kept by the day.

**An on-device AI tutor, optional.** Turned on in Settings, a small language
model (Qwen3 0.6B, 1.7B or 4B, Apache-2.0, through WebLLM on WebGPU) is downloaded
once and runs on the iPad with no key and no connection. Where the GPU has no
16-bit shaders (many iPads), the 32-bit build of the same model is fetched
instead; a download that breaks is retried, then moved to the browser's other
store, and a failure says what went wrong. Settings can delete the model. It explains a
section in plain words, suggests an analogy, summarises what the book says in
answer to a question, and writes harder questions. It is not a source of
facts, and nothing it writes is shown unchecked (`memorizer/src/ground.js`):
a sentence with a number or a disease, test or drug its book passage does
not have is dropped; a summary sentence must cite the passage it comes from
and mostly use its words; and a question is asked only when a sentence of
the section states its answer — that sentence, with its page, is the
explanation shown, not the model's. What is dropped is counted on screen.
With it on, the model also runs the Coach as an agent: it names a tool, sees
what the tool found in your book, names the next, and then answers; each
sentence of its answer must cite the step it rests on and pass the same
checks, or it is dropped. A reply that names no real tool hands the message
back to the Coach's rules.

**The Coach's own tools** also say why your misses happened — each by its
error type, what that type means and its fix — show the cards due each day
this week, and start a review round of what you still get wrong. It
remembers, on the device only, which of its tools you use and the book's
section titles they landed on, never what you typed; the Coach screen shows
what it remembers, with a button to forget it.

Every missed answer becomes a review card — the same multiple-choice question
— scheduled with the same FSRS scheduler Systole uses (`src/core/fsrs.js`,
shared, not copied).

**Recall, not only recognition** (`memorizer/src/study.js`). Multiple choice
puts the answer on the screen; an exam asks you to bring it back. So each
drilled section also makes recall cards, due from the next day: **cloze
cards** — the book's own sentence with its number or key term blanked,
answered by typing (a number must be the book's number; a word may be a
letter out, rated Hard) — and **figure cards**, where one of the labels the
book printed inside a figure is hidden and asked for among the others. A
drilled section comes back as a short **section check** on a widening
schedule of days and weeks; a failed check starts it again. **Timed
practice** mixes due cards, weak items and each unit's hardest questions for
the minutes you have, and shows the score across days. Say **"I'm sure"**
before answering: a confident wrong answer is the most dangerous kind, so it
is flagged and asked again before the review ends. With the on-device AI on,
a section's result offers a **case** — a short patient story whose answer is
a sentence of your book; a case that adds a number, disease, test or drug
the section does not have is not shown.

**Planning and explaining.** Tell the Coach or the home screen your exam
date and each day gets its sections to learn, with the last days kept for
review; the plan is worked out again each day from where you are. **Teach it
back**: explain a section in your own words — typed or spoken, through your
device's dictation — and it is checked against the section's key points:
what you covered, what you left out (in your book's words, and as cards if
you like), and any number you gave that the section does not have. With the
on-device AI's answers, each sentence names the section and page it rests
on.

**Your book, as it was printed and as you read it.** Text recognition's
confidence is kept for every scanned page, and the pages it was unsure of
are named on the source card; a paragraph it misread can be corrected in
the lesson, and the correction is kept with what it said before. Your own
notes on a section are kept as yours — shown with its cards and in the
Coach, labelled as yours, never mixed with the book's words — and a key
point you mark becomes a cloze card. The Coach asks a section's table row
by row.

**Progress.** The mastery map is a brain, straight under the hero: a
side view drawn as an atlas draws one — the cortex folded all over, each fold
a soft groove with a lit lip, the main fissures deeper, the cerebellum's folia
fanned round its stem, a shade toward the underside and a shadow beneath —
every section you have opened a neuron inside it. A neuron is dark until its section is drilled, then lit
green, amber or red — solid, fading or weak, from its drill and its cards'
recall today. Each unit is a lobe of neighbouring neurons wired into one net,
its first section at the lobe's heart and the rest spreading outward in
order, and the lobes are wired to one another; a connection is lit when both
its neurons are, and a signal runs along it. The brain is live: impulses run
the wiring as glowing sparks with a tail, the connection they travel lit as
they go; where one lands the neuron flashes and may fire on — a solid
section almost always passes it on, one not yet drilled seldom, so a cascade
runs through what you know and dies at the edge of what you do not. Lit
neurons also fire on their own and breathe, the tissue breathes, and a light
glances across the cortex every few seconds. A tap fires the neuron, names
its section and how it stands, with a button to open it; arrow keys walk the
neurons in order. It runs only while it is on the screen, stops when you
leave the home screen, and is still when the device asks for reduced
motion. "This week" gives time,
answers, accuracy, reviews and the topics missed most, against last week;
and the streak forgives one missed day a week.

The home screen is two cards. At the top, a hero band: the greeting, what
is up next with a small button under it to continue, and three numbers in a
row of chips — your streak, the cards due, and how much of what you have
studied is held today — over a gradient with an ECG trace along its foot,
clear of everything above it. Then one card: the brain, its numbers under it,
and beside it on an iPad (below it on a phone) the pearl of the day, marked
by a gem rather than a heading — the feature of the
page — a sentence from your own PDF, found and broken into steps by
Systole's `src/core/pearl.js`, shared rather than copied, never a trial's
read-out (a hazard ratio, a P value) or a sentence leaning on the one before
it, and never cut inside its brackets — shown beside its
own section's figure, drawn from the stored PDF, or the first rows of that
section's table, with a small button to open the section. Everything about the
chapters is its own tab, **Chapters**: the box to add a chapter, with chips
for a PDF, the whole book, photos or pasted notes; your books and units, each
with its progress (a unit opened from here goes back here); and beside them
on an iPad held landscape (below them on a phone) the exam plan, "jump back
in" cards with a progress ring and the section up next, the section checks
that are due, the sections that need work — each with a drill of its review
cards, due or not — and the week. Before anything is added, the box to add a
chapter is on the home screen too. Surfaces are clear frosted glass, as on an iPad — a heavy
blur, a bright rim, a sheen, and a light that follows the finger — over a slow
aurora in the theme's own colours, with the accent solid rather than run into
a second colour; Systole's live rhythm strip sweeps across the hero, a
rhythm named in monitor type; cards rise in when a screen opens (not again on
every tap), give under the finger, and the pearl's steps arrive one by one.
With reduced motion asked for, nothing moves, the strip is drawn still, and
there is no light to follow; at High
contrast, with less transparency asked for, or where the browser cannot
blur, the glass is solid. The themes are the owner's choice from mock-ups
drawn on these screens: **Daylight** by day — the iPad's own grey grouped
ground, white cards and system blue — and **Clinical** at night — near-black,
graphite cards and monitor green — with Systole's **Contrast** kept, colour
for colour. The rest are Memorizer's own: **Paper**, a warm page for long
reading; **Neuron**, a deep indigo with an electric cyan; **Ice**, pale ice
glass with a quantum blue; **Butter**, butter yellow with a royal iris;
**Mint Night**, zero black with a ghost green; **Graphite**, with a blue
accent; and **Cyber Grape**, deep grape with an acid lime. The picker
shows each theme as itself in miniature, and each draws the brain in its own
tissue and wiring. The type scale is Systole's, with text size, reading width,
line spacing, font, contrast and brightness to choose. Contrast and
brightness are computed from the theme you pick, and every theme at every
setting is tested to keep its text at WCAG AA or better — measured against
the glass as it composites over the page and each pool of the aurora, under its
sheen and the finger's light at their brightest — with form controls
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
from recognition rather than the PDF itself — and so does the lesson of any
section printed on such a page.

**It keeps where each unit came from.** A unit stores a SHA-256 of the exact
file (or notes) it was made from, the build of Memorizer and the PDF reader
that read it, and an import report: pages read from the PDF's own text, by
recognition, and not at all, with what was found. Adding the same file twice
opens the unit already there, with its progress. Each unit's Source card says
all of this, and that the text is what your book says as of its edition — not
a check against current guidelines.

**It says when something did not work.** A step and the review cards it made
are stored in one transaction, so they cannot disagree; a save that fails
(a full disk) puts a banner on every screen until it succeeds, and a browser
that will not store anything (private browsing) is named on every screen too.
A second quick tap is ignored rather than skipping a card, a lesson that
arrives after you have moved to another section is dropped rather than filed
there, and an enlarged page or figure holds keyboard focus and gives it back
on close. Nothing is fetched to draw the page: the handwriting face is the
device's own.

Memorizer carries no content of its own, so unlike Systole it builds
anywhere, CI included — and CI runs it: its pure suites in the logic job, and
the whole app in Chromium, on a PDF and notes the tests write themselves, in
the memorizer-browser job.
