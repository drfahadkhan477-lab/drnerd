# Building Systole

Two commands.

```bash
node scripts/build.js path/to/ACCSAP_12_export.html   # → build/systole.html
node scripts/verify.js --pwa                           # → 2944 + 133 checks
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

- **Node 18+** — no dependencies for the build itself. `npm run build` installs nothing.
- **Playwright** — for the test suites only, and pinned:

  ```bash
  npm ci                                     # playwright 1.56.0, ts-fsrs 5.4.2, from the lockfile
  npx playwright install chromium webkit     # the two engines the suites are run on
  ```

  Pinned rather than ranged, and with `package-lock.json` committed, because a
  suite that measures a browser is measuring a *specific* browser — `^1.56.0`
  would make a green run mean "green on whatever shipped this week".

  `--engine firefox` is accepted by the harness but is not part of the
  provisioned set; `scripts/verify.js` checks the executable exists and tells
  you how to install it before it spawns a single suite, rather than failing
  fifty-four times identically.

  A global install still works — the suites resolve Playwright through
  `NODE_PATH`, which `scripts/verify.js` fills in from `npm root -g` — so
  `npm i -g playwright` remains a valid way to run them. The lockfile is what
  makes a run reproducible, not where the package lives.

  `ts-fsrs` regenerates `tests/fixtures/fsrs-oracle.json` and is used for
  nothing else; the fixture is committed, so `verify-oracle` runs without it.

- **Python 3 with Pillow and numpy** — for `verify-figreview` only, which
  drives the figure-review sheet the way `tools/figure-review.py` and
  `tools/trim-figure.py` do:

  ```bash
  python -m pip install Pillow numpy
  ```

  Without it that one suite refuses with the install command and the other 89
  run normally — it is 35 of the 2944 checks. The suite tries `python3`,
  `python` and `py -3` in turn, so the Windows spelling is covered, and it
  checks both libraries before running rather than dying halfway through.

- **A reference corpus at `content/refs/`** — `.md` files in the shape
  `docs/REFERENCE-GUIDE.md` describes. The build REQUIRES it: `refs-patch`
  exits 1 on a missing or empty directory, so there is no such thing as a
  build without one.

  **The three files in `docs/reference-examples/` unblock the build and are
  not a test corpus**, which is worth stating because it is not guessable and
  because assuming otherwise costs a full run. Copying them in produces 12
  notes citing no figures, and six suites then fail for want of a corpus
  rather than for anything wrong with the app:

  | Suite | Needs |
  |---|---|
  | `retrieval` | more than 100 notes, and an index over 700 documents; R@1 thresholds calibrated on a real corpus |
  | `figsharp`, `chatfigs`, `layout` | notes citing `![…](refimg://KEY)`, with the images present in `content/refs-images/` |
  | `pearl`, `chat` | the same figure citations, reached through an Apex answer |

  They fail rather than skip, and that is correct: each says what was missing
  ("no reference notes cite a figure", "12 notes"). A suite that passed here
  would be measuring nothing, which is the failure this project keeps
  producing. Do not lower a threshold to accommodate a stand-in corpus — the
  numbers are meaningless on 12 notes either way.

  A full green run therefore needs the real corpus, notes and figures both.
---

## How the build works

The chain is 88 patch scripts, run in order against the export. Each applies a list of
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
| 3 | `flags` | two questions whose lettered answer panels the export never shipped; flagged beside `keys`, for the same reason |
| 4 | `apex` | embeds `heart3d.js` and `apex.js`; the only place the heart enters |
| 5–6 | `stage2`, `stage3` | FSRS-5–derived scheduling, then Apex's vision and memory |
| 7 | `polish` | the rhythm registry the hero and Rhythm Lab both read. Also now embeds the Living Diagram family (`livingDiagram.js`, `conductionWave.js`, `coronaryTree.js`) beside heroRhythm/pencil, the same way and for the same reason. **Build-verified**: the full green run recorded in `94823e0` built this embed. Before that it had only been checked mechanically for collisions against every `find` anchor in every other `*-patch.js` script (none found), and its find/replace pair is the one heroRhythm/pencil had already proved |
| 8 | `splash` | the pre-paint loading screen |
| 9 | `braunwald` | the grounded reference library |
| 10 | `art` | the design pass the later panels sit inside |
| 11 | `leads` | the 12-lead — needs `art`'s panel styles |
| 12 | `physio` | the cardiac cycle — anchors on the 12-lead's embed comment. `PHYSIO_VIEWS` now carries a sixth entry, `conduction`, and `physioNoteHtml()` a matching case, so Lab's chip picker and its teaching note both cover the view `wiggers.js` gained the same session. **Build-verified**: the full green run recorded in `94823e0` built both edits. They sit inside the same find/replace pair that `lab-patch.js`'s later anchor depends on, and that anchor still matched |
| 13 | `name` | Systole |
| 14 | `theme` | palettes — must follow `name`, it restyles the hero wordmark |
| 15 | `home` | welcome bar, progress bar, layouts |
| 16 | `splash-heart` | the mechanistic heart, into `splash`'s markup |
| 17 | `crisp` | device-pixel ceilings |
| 18 | `scale` | the 4pt spacing scale, and bars that reveal without layout |
| 19 | `type` | the modular type scale, snapped over everything above |
| 20 | `lab` | removes the Rhythm Lab's 3D heart — late, so what it deletes is final |
| 21 | `review` | fixes from the full code review |
| 22 | `refs` | the reference-note store, and the seeded library that ships with it |
| 23 | `read` | the reading view those notes are read in |
| 24 | `ref-images` | `refimg://`, so a note can cite a figure — the renderer is injected whether or not the corpus cites one, because `assets` anchors on it and because the same code resolves figures imported at runtime. A figure-free corpus used to skip it and kill the build at step 63; `verify-refimg-pure` holds that now |
| 25 | `gemini` | a third provider, with its own wire shape and model discovery |
| 26 | `memory` | what Apex keeps about you between sessions |
| 27 | `assets` | an imported chapter brings its figures — rewrites the importer, the renderer and the vision path, so it must follow all three |
| 28 | `chatfigs` | the figure Apex reasons from appears in the answer — after `assets` and `ref-images`, whose work it rewrites |
| 29 | `pearl` | one sentence from your own notes, on the home screen |
| 30 | `homeflow` | home cut to the trace, the pearl and the progress bar; everything else behind a door — last, so it moves finished markup |
| 31 | `pearlcard` | the pearl as a numbered ladder on ECG paper, and the `-webkit-` spellings Safari needs |
| 32 | `offline` | one press pulls all 408 figures onto the device — under `homeflow`'s door row, and only alive in the split build |
| 33 | `pvloop` | the pearl's strip becomes the pressure–volume loop the cardiac-cycle screen already computes |
| 34 | `fullbleed` | the navigation bar leaves the reading column so its colour reaches both edges of an iPad, and reserves the strip the status bar sits in |
| 35 | `figview` | a figure opens full size and closes four ways |
| 36 | `slowcycle` | the cardiac cycle runs at a fraction of real time, with a speed control that does not pretend to be a heart rate |
| 37 | `hosted` | Gemini moves behind the Cloudflare Worker, Groq and Anthropic stay bring-your-own-key — last, it rewrites what `gemini` built |
| 38 | `split` | Apex sits beside the question in landscape and under it in portrait, never over it — last, it re-lays out screens every earlier step built |
| 39 | `boundary` | a retrieved note is fenced with a per-turn nonce and named as data, not direction — after every earlier retrieval step, because it wraps the text they produce |
| 40 | `toolfence` | the same fence on `search_question_bank`, the channel the model opens itself; and a failed request stops being something Apex said — after `boundary`, whose `refBlock`/`refSafe` it reuses |
| 41 | `chatfix` | the panel keeps the sentence you were typing and the place you were reading, and sends a window of the thread rather than all of it |
| 42 | `autotheme` | `auto` notices the system flipping, so the heart, the 12-lead and the cardiac cycle follow it instead of waiting for a reload |
| 43 | `store` | ink, notes, chats and the review log move to IndexedDB — after every step that reads or writes through `loadJSON` |
| 44 | `homewide` | the home screen fills a landscape iPad instead of a 960px column with 406px of dead space either side, and portrait stops being sized by the length of whichever pearl was picked |
| 45 | `pearlrich` | a pearl is a whole thought — up to three sentences, median 143→295 characters — over a travelling ECG current instead of a corner PV loop; after `homewide`, which gives it a tall column to be long in |
| 46 | `apexroom` | the tutor panel is spacious, its nine prompts are behind a button, and the two known iOS scroll traps are closed |
| 47 | `mistral` | Groq and Anthropic leave, Mistral arrives BYOK and vision-capable — genuinely last, it revises code that `apex`, `gemini`, `hosted`, `memory`, `ref-images`, `toolfence`, `chatfix` and `apexroom` all touched |
| 48 | `guards` | the quiz keyboard steps aside for a focused `<select>` — after `apexroom`, which is what put one over the quiz screen |
| 49 | `chipfix` | `apexroom` hid `.chips` globally to fold the tutor's prompts away; the Lab and the search screen share that class and lost their rows. Scoped to `#aiChips` |
| 50 | `quiznav` | a Previous button, and the per-question memory that makes going back safe without re-grading or re-scheduling |
| 51 | `homeprog` | the home screen's progress bar becomes a card: a legend, a due-review pill, numbers that count up with the fill |
| 52 | `calibrationtrack` | ten faint calibration ticks across the home progress track — a static `repeating-linear-gradient` layered under the existing fill bars, in the `--border3` token every theme already resolves. No new markup, no animation. Built and run at `a0a94f9`: `verify-home` and `verify-homeprog` both pass, so the track still animates, counts up and reports the `aria-valuenow` it did before. **No suite asserts the ticks are visible** — none was written, and the measured `--border3`-against-`--border2` ratio is 1.23–1.42:1 across the named palettes, which is a hairline by intent and close enough to nothing that only an eye on a real screen can tell subtle from invisible |
| 53 | `chapters` | the Chapters grid uses its own stagger timing, and the bar transition gets a starting point to run from |
| 54 | `studyflow` | the Signal/Focus/Grid switcher removed — it only ever affected Chapters despite the name — and the page's sections cascade in like the home screen's |
| 55 | `welcome` | one dismissable line under the doors naming Chapters and Apex, for a first-time reader only — after `homeflow`, whose door row it sits beneath |
| 56 | `streamthrottle` | a streaming reply repaints on animation frames, not on every network chunk — after `mistral` and `gemini`, whose `oneTurn*` functions it wraps a shared painter around |
| 57 | `contrastfix` | the 46 sites using `--dim` for text anyone is expected to read move to the already-AA `--muted`, and every interactive element gains a `:focus-visible` ring |
| 58 | `highcontrast` | a ninth theme preset, Contrast — near-black ground, near-white text, on the same `data-palette` mechanism the other eight already use. Its accent luminance is deliberately held inside the range `verify-pearl` and `verify-home`'s AA sweeps already clear, rather than picked for looking bright. `verify-theme.js`/`verify-tokens.js` asserted an exact eight-theme set and were extended to nine — the count, the light/dark split, the distinct-background and distinct-accent sets, the picker's option count, and `ACCENT_BY_THEME`, which is looped by its own keys and so would have skipped the new preset silently rather than failing. Built and run at `a0a94f9`: both pass. What no suite covers is whether the palette reads well; that is eyeball-only |
| 59 | `failsafe` | `render()` throwing stops meaning a blank or frozen screen — wraps every earlier step's own version of `render()`, and boot's own call |
| 60 | `semantictokens` | `--accent`/`--success`/`--danger`/`--warning` become canonical; `--teal`, `--green`, `--red`, `--amber` and their `-2` variants become pure `var()` aliases — after `failsafe`, rewriting `theme`'s own settled literals |
| 61 | `splashtiming` | the rhythm trace waits for the heart to settle instead of sweeping in parallel with it — after `splash-heart`, whose 1s settle it now sequences after |
| 62 | `haptics` | a felt pulse alongside the correct/wrong feedback `selectOpt` already draws — feature-detected, and silent under `prefers-reduced-motion` |
| 63 | `designfollowup` | `--warn`/`--warn-bg`/`--warn-b` become real aliases rather than four independently-restated literals (fixing a latent auto+dark mismatch), and the splash heart gets its own `@keyframes` back from a same-named collision |
| 64 | `disclaimer` | the app says what it is — educational board review, not clinical decision support — in both of the Apex panel's states and on the Progress screen, and gains the `<main>` and `<h1>` landmarks it never had |
| 65 | `announce` | the quiz says what just happened: `aria-pressed` reports the user's own selection instead of the answer key, which had been announcing the correct option as pressed; a permanent live region outside `#app` speaks the verdict; focus follows the reading order; `ArrowLeft` reaches the Previous button `quiznav` shipped without a key; and the last `--dim` on read text moves to `--muted` |
| 66 | `curate` | the document-wide double-tap trap is scoped to the controls that need it — it had been swallowing pinch and double-tap zoom on figures; the hero rotation stops while the page is hidden; `.q-card` gains the accessible name it needed once `announce` gave it focus; and `reviewQueue`'s "cap" and "storage marked persistent" stop misdescribing what they do |
| 67 | `calibrate` | the review log stops recording only right-or-wrong — how long the answer took, how sure you were before giving it, and after a miss why you think you missed it; `calib.js` reads the three back as calibration, pace and error mix. Also finishes the WebGL context recovery `hardening` left half-wired, and stops `restoreQuizState` inferring "answered" from an `S.answers` entry merely existing |
| 68 | `figzoom` | a figure stops being fitted-or-natural and becomes something you examine — pinch, wheel, drag to pan, double-tap, a control row and the keyboard, over `figzoom.js`'s zoom-about-a-point arithmetic. `figview`'s four ways out survive intact, which is most of what the event handling is for: a pan ends on the image, so without care the drag that moved the figure is also the tap that dismisses it |
| 69 | `figloadfade` | a figure fades in once its full-resolution image finishes loading, instead of popping in mid-decode — the hidden state is opt-in, added only on a path that has already committed to removing it on both `load` and `error`, so a failed load is never silently blank. That inversion is the whole design: written the obvious way round — `img{opacity:0}` plus a class the script adds — a figure whose decode errors or whose script never ran is not a broken-image mark but nothing at all, on a screen whose only content is that figure. Built and run at `a0a94f9`: `verify-figzoom` passes, so the viewer still opens, zooms, pans and closes four ways with the fade in place. **The error path is guarded by `verify-figfade-pure`** — which exists because this row previously admitted the hole instead of closing it. That suite lifts the patch's own `replace` block and runs it against stub images, so the four outcomes (cached, pending-then-load, pending-then-**error**, script-never-ran) are checked against the lines that actually ship rather than a copy. Proven red twice: delete the `error` listener and the third case fails; write the CSS hidden-by-default and the inversion sweep fails |
| 70 | `schema` | the saved blob carries a `DATA_SCHEMA_VERSION`, and `save()` preserves fields it does not recognise. Systole is a file you copy between your own devices, so two copies at different versions is the ordinary case — and until now the older one would silently drop whatever the newer one had added, the next time it wrote. Paired with `SCHEDULER_VERSION` in `fsrs.js`, which stamps each card with the model that scheduled it, pinned by a fingerprint of the FSRS weights so a tuning change cannot pass unnoticed |
| 71 | `figfit` | two things a real iPad found, neither reachable by a synthetic test. **"Fit" did not fit**: the viewer image was `max-width` only, so a TALL figure overflowed into a clipped middle band — `figzoom` had replaced scrolling with transform panning, and panning is disabled while fitted because a fitted image is assumed whole. One `max-height:100%` makes scale 1 a true contain. **And the figures under an Apex answer had no control of any kind** — they arrived with the reply and stayed, taking a third of the panel. Now a disclosure, shut by default, following `apexChipsOpen` exactly: a module-level flag so it survives the re-render, a class toggle so a half-typed question is not destroyed |
| 72 | `selftest` | the invariants run **on the device**, in the engine, at the size the iPad is actually held: open the app with `#selftest`. Both bugs that reached the fellow were invisible to 1,496 checks because the harness is Blink, portrait-ish, and a 400×300 rectangle — while the app is WebKit, landscape, and 408 real figures, 401 of which were clipped at "Fit". That gap cannot be closed from the harness, so the checks go to the device. It opens real figures and measures them rather than recomputing the sizing rule, which would agree with a wrong one |
| 73 | `answerroom` | opening the figures under an Apex answer crushed the answer to **43px** on an iPad held portrait — one line. `.ai-body` was the panel's only `flex:1` child and carried `min-height:0`, so every pixel the figure list took came out of the answer with nothing to stop it at zero. An explicit `8rem` floor, and the list gives up the difference. Four candidates were measured at three frames before this one was chosen; shrinking the figures too was rejected, because a 12-lead too small to read is not a saving |
| 74 | `avatarfit` | the Apex avatar's canvas threw `IndexSizeError` whenever it was briefly under 4px — a collapsing panel, a rotating iPad — because `R = min(w,h)/2 - 2` goes negative and `createRadialGradient` refuses a negative `r0`. The throw happens inside the rAF loop, so it killed the animation for the session rather than skipping a frame. `fit()` tested the width and never the height. Found by `verify-layout`, which resizes |
| 75 | `prefixq` | `tok()` stems, and the stem of a truncation is a truncation — "amylo" is not "amyloidosis", so `IDX.df` has no entry, no document scores, and the library's own search box answered **ten of 146** title queries with nothing at all. Query tokens the index has *never seen* are completed against the vocabulary, at most two, nearest in length first; tokens it knows are left exactly alone. `54.1% → 80.1%` R@1 on truncated terms, empty results to zero, and the other three query shapes unchanged to the decimal. Measured by `verify-retrieval` |
| 76 | `prefixrank` | The rest of that gap, by **scoring** the prefix instead of substituting for it. Two chosen completions make a document whose only matching term is a *third* one invisible, credit a document holding both twice, and give each completion its own idf so a rare wrong one outargues the common right one. Raising the cap fixes none of these — at 2/3/4/6/8 it measured `63.4 / 61.7 / 61.0 / 62.7 / 63.4`, noise around a ceiling. A stub is now **one term whose postings are the union of every term it prefixes**: tf summed, df counted over documents. `buildIndex` keeps postings, so a stub costs the postings that can match rather than the whole collection — and stub queries got *faster*, 0.25 → 0.11 ms. A known token is still never treated as a prefix: `as` is aortic stenosis. `66.8% → 87.1%` R@1 on the 295-note shelf, above the `80.1%` the old mechanism reached on half as many notes; floor raised 0.79 → 0.86. Measured by `verify-retrieval` |
| 77 | `heroart` | the home hero becomes the anatomical heart again — `heart3d.js` gains a fourth style, `specimen`, and the conduction system is drawn as a source rather than a lit surface. The current is not an effect: `uAct` is the depolarisation front in ms since the sinus node fired and each vertex carries its own activation time, driven by the same cardiac clock as the ECG strip beside it, so when the hero rotation reaches atrial fibrillation the current goes irregular too |
| 78 | `apexpage` | Apex gets the whole viewport under the nav, and its answers get set like prose. Full-page is a class on `#shell` rather than an `S.screen`, because `#ai` lives outside `#app` precisely so `render()` cannot tear down a conversation mid-reply — one Apex, one thread, one composer, a different box |
| 79 | `resume` | a chapter you left is the chapter you come back to. The place is written per chapter under `resume` in the saved blob (added to `SCHEMA_KEYS`, capped at 12 chapters), restored when the same deck is opened again, and cleared by a reset — with an explicit restart control, because resuming has to be refusable |
| 80 | `figsharp` | a note figure is drawn at the size it has rather than the size of the card. `.ref-fig` was a full-width block, so a 480 px figure was upscaled to fill it and read as blurry on every screen wider than the figure. `width:fit-content` on the frame and `width:auto` on the image; the copy Apex shows gets the same treatment |
| 81 | `heartreuse` | navigating the app stops spending WebGL contexts. The hero built a new one on every visit home — twenty round trips, forty contexts — which Chromium absorbs because it returns a released slot and WebKit does not, so the same code hit the sixteen-context cap after about eight visits and began evicting a LIVE context. The markup now carries a slot; the canvas is created once and moved into it, and leaving home pauses the heart instead of destroying it |
| 82 | `onetutor` | asked for after an audit that found no dead code at all, which leaves only this kind of removal: the second provider, working and not wanted. 7.6 KB out across 23 edits. The in-app importer stays — the step was scoped to both and narrowed to Mistral only before a line was written, and the patch's own header went on describing the wider version until it was corrected. `PROVIDERS`/`ENDPOINT`/`MODELS` stay maps with one entry rather than collapsing into bare Gemini constants, and the nine suites that mocked Mistral's OpenAI shape move onto `tests/_wire.js`, which says what a suite wants to know — the system prompt, the turns — instead of spelling Gemini's JSON out nine times |
| 83 | `flushguard` | the last chunk is painted however the stream ends. `makeStreamPainter` exists so that "the very last chunk is never left unpainted waiting on a frame that may not come", and its `flush()` sat after the read loop — honoured on the one path where the loop ends tidily and on no other. Now a `try`/`finally` around the loop. Found in the same pass: the composer rendered `<button id="aiSend" ${aiBusy?'disabled':''}>` with a ■ glyph, so the stop button was disabled in exactly the state where it was the stop button, and `aiAbort.abort()` — its only caller anywhere — was unreachable |
| 84 | `heroflex` | the hero stops reserving vertical space by how **wide** the screen is. `.hero-ecg{height:clamp(92px,13.5vw,140px)}` and `.hero-live{padding-bottom:clamp(104px,16vw,158px)}` both take their tallest value at 1194px wide — which is an 11-inch iPad in *landscape*, the shortest shape the app is held in. Rotate it to portrait and the hero gets shorter on a screen with 360px more room. Each clamp gains a height term through `min()`, so whichever axis is scarcer decides; the floors are untouched, and a phone renders identically. Measured by `verify-home`: the 11-inch landscape home screen goes from `97px over` to `47px over` |
| 85 | `offhome` | the offline-download card moves off the home screen and onto Progress. The landscape home grid budgets itself exactly one screen and gives all of it to four named areas, sweeping every other child into implicit rows **beyond** that budget — under a rule whose own comment describes it as a fallback for the story rail and feed that had moved to the Chapters page. The card inherited that fallback and became 114.5px of guaranteed overflow on an 11-inch iPad held sideways. Bringing the tail into the grid and capping the wrap was tested and reaches 0px too, but squashes the hero 268px → 200px and widens the medallion/ECG overlap from 19px to 87px; the owner chose the move. Progress already opens with "Saved locally on this device", which is the same subject, and the cache survey moved with the card so it no longer runs on every visit home. `verify-pwa`: `0px over — first run, with the welcome card, was 43px` |
| 86 | `focusmode` | the quiz, without the chrome around it. `#navbar` is fixed and outside the reading column, and one variable — `--navh` — is what `.nav`'s height, `#shell`'s `padding-top` and the Apex panel's `top`/`height` all measure from, so the whole feature is hiding the bar and setting that to `0px`: the shell and the tutor reclaim the space themselves. `--sat` is deliberately left alone, being the status bar's reserve rather than the app's chrome. The screen test is in JS and not CSS on purpose — `#navbar` is a *sibling* of `#app`, so scoping it to the quiz in CSS would need `:has()`, which Safari gained in 15.4 against this app's 13.4 floor. Two controls, each rendered only where it can act: the way in sits in the nav and only on the quiz screen (offered on Home it would flip `aria-pressed`, save, re-render and visibly do nothing), and the way out is a fixed 44px button in the shell, outside everything `render()` replaces — quiznav's action row is `reviewing ? '' : ...`, so putting it there would strand a fellow with no chrome and no way back. Keeps the progress bar, and keeps the confidence row, which feeds `calib.js`: hiding that would change what gets recorded, which is a behaviour change wearing a layout change's clothes. **Before any build reached it**: every anchor was read verbatim from a committed patch script and proven to match exactly once against a fixture, but nothing has built it. `tests/verify-focus.js` ships with it and was listed in `PENDING_RECORD` until the full green run recorded in `6ee3e5a` took its count  **Build-verified at last.** The first run that ever reached step 86 died here: the exit button anchored on three lines copied out of `fullbleed`(34), but `disclaimer`(64) had swapped that `<div id="app">` for the `<main>` landmark and `announce`(65) had put a live region beside it, so the anchor described markup gone since step 64 — `found 0`. Reading a patch script is how you get that wrong, and it is all anyone without a build can read. The anchor is now `<header id="navbar"></header>` alone, which is unique and is the insertion point; the other two lines were never load-bearing. `verify-shellanchor-pure` replays the whole shell region through the chain and checks every anchor into it at the step that uses it |
| 87 | `ambient` | the Living Diagram's ambient mode. `livingDiagram.js` has decided since the Conduction Wave branch *when* ambient mode may run — the home screen only, after two minutes with no interaction, never with the Apex panel open, in Focus Mode or under `prefers-reduced-motion` — and *which* view comes next, never the same twice running; this step draws it. The views are the repository's own: `Heart3D` (whose `destroy()` and WebGL budget `verify-heartreuse` already holds), `ECG12` and `Wiggers`' PV loop. The earlier deferral was about `ECGMonitor`, which lives only inside the licensed export; this does not touch it. **One anchor**, the Durable memory banner, re-emitted so `echo` still finds it once; no state on `S`, no mount, the stylesheet injected on first use. A tap closes the overlay through its own `click`, so waking the screen never presses what was under the finger; a mouse closes it by moving a real distance, not a jitter. A change of screen counts as activity, so returning home after time elsewhere does not raise it at once. `verify-ambient` drives the shipped step over a scaffold: every promise above, and twenty visits to the heart view with no WebGL context discarded |
| 88 | `echo` | Echo Studio: a reference you can browse and a calculator you can drive, as two tabs over one set of tables. The thinking is in `src/core/echo.js` (12 views with window, position, index mark and angle; 14 measurements; 9 severity tables as ordered bands; 9 disease profiles; the continuity, PISA, Bernoulli, Simpson and Devereux arithmetic) and `src/ui/echo.js` (strings in, strings out — no DOM, no timers), so both are held by `verify-echo-pure` and `verify-echoui-pure` without a browser. The calculator's rule is that a derived row appears only when every input it names is a finite number: never defaulted, never guessed, never `NaN`, because a plausible wrong number on a study screen gets memorised while an absent one gets investigated. **Four anchors, and three more deliberately avoided**: Echo's state lives in a closure here rather than on `S`, which drops the state-object anchor, the save-tail anchor and any concern about `SCHEMA_KEYS`; interaction is delegated from `document` once, which drops the mount anchor. Each of the four was replayed through the chain before it was written down — `verify-echoanchor-pure` does that replay as a check, seeding from the step that emits each region and applying every later step that touches it. It carries the focusmode bug as a fixture: `<div id="app">` is emitted by `fullbleed`(34) and destroyed by `disclaimer`(64), and must be reported REWRITTEN rather than merely absent, so a replay that goes blind is caught by its own self-test. **Build-verified**: the full green run recorded in `94823e0` built step 87, so `patch()` found all four anchors unique in the whole document. The replay alone could not show that. It proves each anchor SURVIVES to step 87, not that it is UNIQUE, because the rest of the document is the licensed export |
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
node scripts/build.js --keep              # once, keeps all 88 intermediates
# ...edit scripts/theme-patch.js...
node scripts/build.js --keep --from theme # only steps 14-88 rerun
```

---

## Verifying

### The whole release, as one command

```bash
npm run release -- path/to/ACCSAP_export.html          # or: npm run release-check
npm run release -- path/to/export.html --skip webkit   # costs you the certificate
npm run release -- --dry-run                           # exercise the gate itself
```

`scripts/release-check.js` runs the sequence a release actually needs, in
order: the export is readable → nothing licensed is staged → the patch chain
applies → every figure decodes → the split build assembles → the full suite on
Chromium → the full suite against `dist/` over http → the full suite on WebKit.

**It does not deploy.** It certifies, or it refuses to, and there are three
outcomes rather than two:

| | |
|---|---|
| `CERTIFIED` | every step ran and every step passed — the only exit 0 |
| `NOT CERTIFIED` | something failed |
| `INCOMPLETE` | nothing failed, but something was skipped, and each skip is named |

A skip is never folded into a pass. Skipping WebKit — the engine the app is
actually used on — costs you the certificate rather than passing quietly.

It writes `build/release-report.md`: the commit, the source digest, a SHA-256
of the single file and a content-addressed root over every file in `dist/`, so
two deployments can be compared without either being opened. Counts and
digests only, and that is enforced rather than intended — a step reports
itself through `safeDetail()`, which rebuilds each line from facts it could
parse and emits nothing it could not.

`release` and `release-check` are the same command; the first delegates to the
second so there is one spelling of the path to the gate.
`tests/verify-release.js` holds it to that, and to forwarding the exit code —
a wrapper that swallowed a `NOT CERTIFIED` would be the overclaim the gate
exists to prevent, arriving through the convenience alias.

### The suites on their own

```bash
node scripts/verify.js                       # everything, ~4 min
node scripts/verify.js --only physio,theme   # just these
node scripts/verify.js --skip keys --bail    # stop at the first failure
node scripts/verify.js --list                # what each suite defends
```

Across 90 suites, 2944 checks, plus 133 more on the split build. Those numbers are
not typed here by hand — `scripts/verify.js` writes `tests/test-stats.json` on a
full green run and `verify-stats` fails if this sentence, the README or the CI
header disagrees with it. They used to be maintained from memory in three files,
and they drifted: the CI header claimed both "the other 1052" and "those 1210
checks" for the same quantity.

### When a screen overflows

Two checks can fail with a bare pixel count, one per axis, and both now name
a lead beside it.

`verify-layout` sweeps every screen at each device frame it defines and
fails sideways scrolling like this:

```
FAIL  no screen scrolls sideways  → refs +9px [section.refs > div.note-body > table.tbl > td +9px]
```

The bracket is the widest element overflowing the right edge, with decoration
(`pointer-events:none`) skipped and the deepest element winning a tie, because
a parent is only ever as wide as the content forcing it.

The `--pwa` phase does **not** run `verify-layout`. Its pixel check is
vertical, the landscape home screen on an 11-inch iPad, and fails like this:

```
FAIL  an 11-inch iPad in landscape needs no scrolling on the home screen
      → 9px over — … [lowest: section.today > div.pearl-card, 433px tall, ends at 843 of 834]
```

Both are leads rather than verdicts, and both carry their own figures so you
can tell which. Sideways: when the two numbers match, that element is the
thing overflowing. Vertical: when the lowest element ends *inside* the
viewport while the page still scrolls, the overflow is padding or margin
below the content, which is a different fix.

Each finder runs only when its check has already failed, which is the one
moment nobody is also checking the diagnostic, so both have a proof that
needs no build:

```bash
NODE_PATH=$(npm root -g) node tools/layout-culprit-proof.js
```

It extracts both functions out of the suites rather than keeping copies,
and drives them over pages built to give each answer that matters,
including the ones each first draft got wrong.

### The one suite that checks us against somebody else

`verify-oracle` is different in kind from the rest. Every other suite was
written by the same hand that wrote the code it checks, which catches typos and
regressions but never a formula transcribed wrongly from the paper — the check
would carry the same wrong transcription.

So `src/core/fsrs.js` is compared against **ts-fsrs**, an independent
implementation, fed *our* nineteen weights so the parameters are not the
variable. It ran once; its answers are checked in as `tests/fixtures/`
data, and the suite needs no dependency at all, which is what lets CI run it.

```bash
npm i ts-fsrs                      # dev-only; nothing ships it
node tools/gen-fsrs-oracle.js      # → tests/fixtures/fsrs-oracle.json
```

Across 700 states the two agree to ts-fsrs's full output precision on
retrievability, difficulty, and stability after Hard, Good and Easy. They part
on exactly one thing, and the suite **asserts** the parting rather than
tolerating it: on Again, ours is `min(theirs, the stability the card already
had)`. `fsrsNextStabilityFail` explains why — without that cap, 275 of 616
reachable states came out *more* durable after pressing Again than before it.

Two things about the fixture are load-bearing. It is pinned to the parameter
fingerprint, so weights that move make it stale rather than silently wrong — a
mismatch says regenerate, never adjust. And the comparison tolerance is `1e-8`
**absolute**, because ts-fsrs rounds every public result to eight decimals; the
first draft compared at `1e-9` relative and reported five failures that were
entirely its serialisation.

The suites run one at a time deliberately: several drive a real WebGL context and several measure
timing, so running them concurrently would produce failures about the harness
rather than the app.

### Checking a build on the device itself

Open the app on the iPad and add `#selftest` to the URL — or tap **Run again** in
the panel after rotating. It runs the invariants in real Safari, at the real
size, in the orientation you are holding:

```
systole-9hq.pages.dev/#selftest        the hosted split build
file:///…/systole.html#selftest        the single file
```

Five rows: the environment it is running in, whether every sampled figure fits
the viewer at Fit, whether anything scrolls sideways, whether the Apex figures
arrive folded, and whether annotations can actually be saved on this device.

It is deliberately small. It cannot check that FSRS schedules correctly or that
an answer key is right — those are settled exhaustively in Node and do not vary
by device. It checks the things that only vary by device, which is exactly the
set that has been reaching the fellow.

### Which engine they run in

Every suite launches through `tests/_engine.js`, so the engine is a flag:

```bash
node scripts/verify.js --engine webkit     # or firefox; chromium is the default
```

**They have not been run on WebKit yet, and that matters.** The target device
for this app is an iPad, which is WebKit — Blink was never the engine that
mattered most here, it was the engine that was easy. All thirty-four browser
suites opened with `chromium.launch()`, not as a decision but because each was
copied from the one before it. That is now one line instead of thirty-four, and
`verify-engine` is what stops it drifting back: it fails if any suite launches
an engine itself.

What this does *not* do is claim the suites pass on WebKit. Nobody has run them
there, because Playwright's WebKit build could not be downloaded in the
environment this was written in. Expect real failures the first time — WebKit
differs on `performance.memory` (absent, already guarded), on IndexedDB timing,
on `hasTouch` pointer coalescing, and on how it resolves fonts. Those are worth
finding. Finding them is the next piece of work, not this one.

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

That finding is why the scheduler is described as FSRS-5–**derived** rather
than FSRS-5. On the reference weights alone, 275 of 616 reachable states came
out more durable after pressing Again than before it, and 136 of them
scheduled the card *further out* than it already was. `fsrsNextStabilityFail`
therefore caps the result at the stability it started from
(`src/core/fsrs.js`, which carries the full reasoning). Everything else
follows FSRS-5 as published; this one clamp does not, deliberately, and
calling the whole thing canonical would misdescribe it.

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
  `capabilities.completion_chat`; a real key is what exposed it. (The suite
  that caught it went with the provider `onetutor` — the lesson
  outlived the code, which is why it is still written down here.)
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
node scripts/extract-content.js build/systole.html  # → content/
node scripts/build-pwa.js build/systole.html        # → dist/, icons included
node scripts/serve.js 8080 dist &
node tests/verify-pwa.js http://localhost:8080
```

The extract is not optional on a rebuild. `content/` surviving from the last
build is what makes it look optional, and a split build whose shell and bank
came from different extractions is silent — its three build stamps are written
in the same run and agree with each other. `build-pwa.js` compares
`content/manifest.json`'s `sourceDigest` against the file it is splitting and
refuses the pair; `tests/verify-provenance-pure.js` holds it to that.

---

## Repository shape

```
src/core/     heart3d · physio · leads12 · fsrs · vision · profile · rhythms-extra · echo
src/ui/       wiggers · ecg12 · apex · pencil · heroRhythm · echo
scripts/      build · verify · 88 *-patch · build-pwa · serve · shots
tests/        90 suites · 41 need no browser · + pwa
docs/         BUILD · BUILD-PLAN · REFERENCE-GUIDE · reference-examples/
```

`src/` is the source of truth. The patch scripts embed those modules into the
page — they are never edited in the built file, and the built file is never
edited by hand.

Modules are plain IIFEs that export onto `window`, so they can be required and
tested in bare Node without a bundler or a browser. That is not an accident of
style; it is what makes the numeric verification above possible.

## Security scanning

`.github/workflows/codeql.yml` runs GitHub's CodeQL over the code this
repository holds: the JavaScript in `src/`, the patch chain, the suites and
`tools/`; the Python in `tools/`; and the workflow files themselves. It runs
on every pull request, on pushes to `master`, and weekly, with the
`security-extended` query suite. Findings appear under the repository's
Security tab and as a check on the pull request.

It cannot scan the built app. The licensed export is never committed, so
nothing it contributes to `build/systole.html` is visible to CodeQL — only
the code this repository patches in.

**The `github-advanced-security` check is not a security review of this
code.** It is a separate GitHub service whose file exclusions skip `*.js`,
`*.json`, `*.yml`, `*.html` and `*.py` — every language here. On a pull
request that changes only those files it reports success having read
nothing; on one that also changes Markdown it has crashed at startup. Read
its green as "did not run", and CodeQL's as the scan.

## The laptop as a CI runner (optional)

CI runs the honest subset because GitHub's runners cannot build the app — the
ACCSAP 12 export is licensed and is not in this repository nor in any secret
GitHub holds. That leaves the browser suites running only when you remember to
run them, which is why "CSP has never met the real app" was true for weeks.

The `full` job in `.github/workflows/verify.yml` closes that, by running on
your own machine. It is opt-in: with no runner registered it never starts, and
nothing else changes.

### Registering it

Settings → Actions → Runners → New self-hosted runner, then follow the
commands GitHub gives you. Two things must match this repository rather than
the defaults:

- **Labels.** Add `systole`. The job asks for `[self-hosted, systole]`, so a
  runner without that label is ignored — which is what you want if you ever
  register a second one for something else.
- **`SYSTOLE_SOURCE`.** Put the absolute path of the export in the runner's
  own environment, in the `.env` file beside `run.sh` in the runner directory:

      SYSTOLE_SOURCE=/Users/you/Downloads/ACCSAP_12_super_v12.html

  In the runner's environment and **not** as a repository secret. A secret is
  a copy of the path on GitHub's infrastructure, and while a path is not the
  content, the rule that the export has exactly one home is worth keeping
  boring.

Run it with `./run.sh` when you want it, or install the service to have it
always on.

### Turning it on properly, after the first green run

The job is **manual only** to begin with: Actions → `full` → Run workflow. That
is deliberate. A job whose labels match no online runner does not fail, it
QUEUES, and GitHub leaves a pending job for about a day before cancelling it —
so wiring it to `push` before a runner exists would have left every push to
master showing a check pending for 24 hours. `timeout-minutes` does not help;
it bounds execution, not the wait for a runner.

Once a dispatched run has gone green end to end, make it automatic by adding
the push arm back to the job's `if:`:

    if: github.event_name == 'workflow_dispatch' || (github.event_name == 'push' && github.ref == 'refs/heads/master')

Do that when the runner is proven and not before. Checks that are usually
yellow are checks people stop reading.

### What it will and will not tell you

The log holds the verdict and, if it failed, which step failed. That is all it
will ever hold, deliberately: an Actions log is shared infrastructure, suite
output quotes question text, and streaming a verify run into one would upload
the licensed corpus by a route nobody would think of as uploading. The report
and the failing suite output stay on the machine, at
`build/release-report.md` and `tests/last-run.log`.

So the workflow answers *did it certify* and the machine answers *why not*.
If you find yourself wanting to add `actions/upload-artifact` to get the
report into the run summary — that is the leak. Read it locally.

### Why it does not run on pull requests

A self-hosted runner executes the workflow on real hardware that has the
licensed corpus and your home directory on it, and on a `pull_request` trigger
that workflow comes from the PR's branch. This repository is private and
single-author so the exposure is small, but the mitigation costs nothing.
