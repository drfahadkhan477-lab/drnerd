# Building Systole

Two commands.

```bash
node scripts/build.js path/to/ACCSAP_12_export.html   # → build/systole.html
node scripts/verify.js --pwa                           # → 1194 + 76 checks
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

Fifty-six patch scripts run in order against the export. Each applies a list of
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
| 33 | `fullbleed` | the navigation bar leaves the reading column so its colour reaches both edges of an iPad, and reserves the strip the status bar sits in |
| 34 | `figview` | a figure opens full size and closes four ways |
| 35 | `slowcycle` | the cardiac cycle runs at a fraction of real time, with a speed control that does not pretend to be a heart rate |
| 36 | `hosted` | Gemini moves behind the Cloudflare Worker, Groq and Anthropic stay bring-your-own-key — last, it rewrites what `gemini` built |
| 37 | `split` | Apex sits beside the question in landscape and under it in portrait, never over it — last, it re-lays out screens every earlier step built |
| 38 | `boundary` | a retrieved note is fenced with a per-turn nonce and named as data, not direction — after every earlier retrieval step, because it wraps the text they produce |
| 39 | `toolfence` | the same fence on `search_question_bank`, the channel the model opens itself; and a failed request stops being something Apex said — after `boundary`, whose `refBlock`/`refSafe` it reuses |
| 40 | `chatfix` | the panel keeps the sentence you were typing and the place you were reading, and sends a window of the thread rather than all of it |
| 41 | `autotheme` | `auto` notices the system flipping, so the heart, the 12-lead and the cardiac cycle follow it instead of waiting for a reload |
| 42 | `store` | ink, notes, chats and the review log move to IndexedDB — after every step that reads or writes through `loadJSON` |
| 43 | `homewide` | the home screen fills a landscape iPad instead of a 960px column with 406px of dead space either side, and portrait stops being sized by the length of whichever pearl was picked |
| 44 | `pearlrich` | a pearl is a whole thought — up to three sentences, median 143→295 characters — over a travelling ECG current instead of a corner PV loop; after `homewide`, which gives it a tall column to be long in |
| 45 | `apexroom` | the tutor panel is spacious, its nine prompts are behind a button, and the two known iOS scroll traps are closed |
| 46 | `mistral` | Groq and Anthropic leave, Mistral arrives BYOK and vision-capable — genuinely last, it revises code that `apex`, `gemini`, `hosted`, `memory`, `ref-images`, `toolfence`, `chatfix` and `apexroom` all touched |

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

Thirty-four suites, 1194 checks, plus 76 more on the split build. They run one at a
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

Two of them have no browser in them at all, because the thing under test has
no browser in it either. `verify-worker` drives the Cloudflare Worker's exported
`handleApex` with a fake `env` and a stub `fetch`; `verify-fsrs` sweeps the
scheduler across the whole reachable state space rather than checking a handful
of remembered numbers — it is what found that a lapse could make a card *more*
durable.

Of the rest, `verify-boundary` imports a note whose title, tags and body are all
trying to end the app's framing and give orders, fires a real turn — including
one that calls a tool — and reads what left the app; `verify-chat` types into
the composer, fires a turn with a tool step underneath it, and checks the
sentence is still there afterwards; `verify-store` drives the IndexedDB
migration from each of its starting states, including the one where a previous
migration was interrupted half-way.

**A check that passes on the broken build is worth nothing.** Every check added
for a bug was run against the build from before the fix and confirmed to fail
there first. That is not ceremony: three of them passed on the broken build the
first time — one asserted on an error string `apiError()` never produces, one
used a fixture that sat exactly at the ceiling it was meant to prove, and one
opened a second browser context so the localStorage fixture it depended on was
never loaded. All three looked green and measured nothing.

### A fixture is not evidence until it has been checked against reality

A fixture written from documentation, memory, or "this looks about right" can
encode the exact same wrong assumption as the code it is meant to be checking
— and the two will agree with each other while both disagree with the real
API. That is not a hypothetical: it happened three times, in three unrelated
places, each caught only after the fact:

- **Gemini's model filter** required a `streamGenerateContent` entry in
  `supportedGenerationMethods`. A hand-written `ListModels` fixture had
  invented that entry because it seemed like the obvious name for the
  streaming variant. Google's real response never sends it — streaming is a
  parameter on `generateContent`, not its own advertised method — so filter
  and fixture agreed with each other and rejected every real model.
  (`tests/verify-gemini.js`)
- **Mistral's capability filter** checked `capabilities.chat`. A first draft
  of the fixture also guessed `chat`. Mistral's real field is
  `capabilities.completion_chat`; a real key is what exposed it.
  (`tests/verify-mistral.js`)
- **`Store.merge`'s array path** was tested by handing it a *delta* — `[3]`
  folded onto `[1, 2]` — which is not a shape the app ever produces:
  `saveJSON` persists the *whole* array on every write. Against a plain
  concat, the fixture and the code agreed, and every stored row came back
  duplicated on reload. (`tests/verify-store.js`)

None of these were caught by review or by the tests passing green — a fixture
that encodes the assumption under test proves nothing, on purpose or not.
**Before writing `verify-<provider>.js` for a new integration:**

1. Make one real call to the real API, with a real key, for every response
   shape the code branches on differently — a normal reply, the model-list or
   capability-discovery response, an error, a tool call.
2. Save the raw response body, then redact only what must never be
   committed: the key itself, any account-identifying field. Leave every
   field name, nesting level and type exactly as the API sent it — those are
   the parts a guess gets wrong.
3. Write the fixture from that saved response, not from the provider's docs
   page. Documentation drifts from the real wire format, or was wrong to
   begin with, more often than the actual bytes on the wire do.
4. If the fixture and the code's assumption about a field name were both
   guessed rather than checked, they will agree — that agreement is the
   failure mode this section is about, not evidence the field name is right.
   Treat a fixture as unverified until a real round-trip has confirmed it,
   even if every test using it is green.

For a same-shape sibling of an existing provider — another OpenAI-compatible
API, say — starting from that provider's already-real fixture and changing
only what the docs say differs is safer than writing a new one from scratch:
it inherits what was already checked instead of re-guessing it.

### An animation is not shipped until something has watched it move

CSS that reads correctly is not evidence that anything moves. Two animations
in this app shipped having never once fired, and both survived review because
the stylesheet looked right:

- **The chapter progress bars** were written with a `width` transition but
  their markup shipped the final width inline, so there was no starting value
  for the transition to run *from*. Every bar arrived already full. The fix
  was to ship `width:0` plus the real value in a `data-` attribute and set it
  two animation frames later (`mountChapterBars`).
- **The suggested-prompt chip rows** were hidden outright by a rule that
  renamed a shared class, which silently took two *other* screens' chip rows
  down with it. Nothing errored; the rows simply were not there.

Neither was caught by reading the diff. Both were caught by driving a real
browser and reading `getComputedStyle`. So, for anything that moves or that
has a distinct empty/zero state:

1. Drive it in Playwright and assert on **computed style or measured
   geometry**, sampled more than once over the animation's window — a single
   reading cannot tell "it animated" from "it was already there".
2. Capture a before/after pair from the actual build and *look at it*. The
   zero-state chapter track in this repo was verified exactly that way: the
   before shot showed a flat grey bar indistinguishable from a loading
   skeleton, which is what the change existed to fix.
3. Sample only once the entrance animation has finished. Read a frame too
   early and an element reports its own container's colour back at you —
   which scores a perfect 1.00 contrast ratio and looks like a catastrophic
   bug rather than a mistimed measurement. `verify-homeprog` waits for the
   card's opacity to reach 1 rather than guessing a delay, and
   `verify-chapters` carries a header note about the same trap in
   `document.startViewTransition`.

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
scripts/      build · verify · 46 *-patch · build-pwa · serve · shots
tests/        28 Playwright suites (27 single-file + pwa)
docs/         BUILD · BUILD-PLAN · REFERENCE-GUIDE · reference-examples/
```

`src/` is the source of truth. The patch scripts embed those modules into the
page — they are never edited in the built file, and the built file is never
edited by hand.

Modules are plain IIFEs that export onto `window`, so they can be required and
tested in bare Node without a bundler or a browser. That is not an accident of
style; it is what makes the numeric verification above possible.
