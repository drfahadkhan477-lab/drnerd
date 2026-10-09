# Building Systole

Two commands.

```bash
npm run build -- path/to/ACCSAP_12_export.html      # → build/systole.html
node scripts/verify.js --pwa                           # → 6634 + 134 checks
```

Open `build/systole.html` in a browser. That single file is the whole app.

---

## The source export is not in this repository

Systole is built around your own ACCSAP 12 export. Those 638 questions,
408 figures and the ACC's commentary are licensed content: they stay on your
devices and are never committed. `.gitignore` blocks `source/`, `build/`,
`content/` and `dist/` for exactly that reason.

The build finds the export three ways, in order:

```bash
npm run build -- ~/Downloads/ACCSAP_12_super_v12.html      # explicit
SYSTOLE_SRC=~/path/to/export.html npm run build             # environment
mkdir -p source && cp ~/Downloads/ACCSAP*.html source/       # dropped in source/
```

## Prerequisites

- **Node 18+** — no dependencies for the build itself. `npm run build` installs nothing.
- **Playwright** — for the test suites only, and pinned:

  ```bash
  npm ci                                     # playwright 1.56.0, ts-fsrs 5.4.2, from the lockfile
  npx playwright install chromium webkit     # the engines the full run uses
  npx playwright install firefox             # also, to reproduce CI's memorizer-browser job
  ```

  Pinned rather than ranged, and with `package-lock.json` committed, because a
  suite that measures a browser is measuring a *specific* browser — `^1.56.0`
  would make a green run mean "green on whatever shipped this week".

  Firefox is required by CI's `memorizer-browser` job (Chromium, WebKit and
  Firefox each run the Memorizer suites), so install all three engines to
  reproduce that job locally. The full `scripts/verify.js` run in CI uses
  Chromium and WebKit only. `--engine firefox` works wherever Firefox is
  installed; `scripts/verify.js` checks the executable exists and tells
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

  Without it that one suite refuses with the install command and the other 152
  run normally — it is 35 of the 6634 checks. The suite tries `python3`,
  `python` and `py -3` in turn, so the Windows spelling is covered, and it
  checks both libraries before running rather than dying halfway through.

- **A reference corpus at `content/refs/`** — `.md` files in the shape
  `docs/REFERENCE-GUIDE.md` describes. Without it the build still finishes
  (since `dc26ab3` it prints "nothing to seed" and carries on), but the app
  ships with an empty notes library and the full suite cannot go green.

  **The three files in `docs/reference-examples/` are enough to build with and
  are not a test corpus**, which is worth stating because it is not guessable and
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

`npm run build -- path/to/export.html` runs `scripts/assemble-app.js`.
`app/systole.html` is the app with every payload replaced by a slot token
(`scripts/app-slots.js`), and the assembler fills each slot:

- **the question bank**: the export's, with the answer-key corrections
  (`scripts/answer-keys.js`) and then the content flags
  (`scripts/content-flags.js`) applied. Each correction states the value it
  replaces, so an export that has changed underneath it stops the build with
  the question's id instead of being "corrected" a second time;
- **the bank's figures**: the export's, verbatim;
- **the reference notes and their figures**: built from `content/refs` and
  `content/refs-images` (`scripts/ref-seed.js`, `scripts/ref-images.js`);
- **the heart's mesh**: `scripts/heart-bake.js` over `src/core/heart3d.js`;
- **every `src/` module and `assets/` file**: as they are in the repository.

Then it stamps the result (`scripts/stamp.js`) and writes it whole
(`scripts/atomic.js`): a build that fails part-way leaves the previous app
where it was. It finds the export the way you give it: a path, `SYSTOLE_SRC`,
or the one `.html` file in `source/`. With none it refuses and says why, and
CI's `build-guard` job holds it to that.

**Where to edit**: `app/systole.html`, `app/css/systole.css`, `src/` and
`assets/`. `scripts/carve.js` moves a range of lines out of
`app/systole.html` into a file of its own, leaving a slot token, and keeps the
result only if the app assembles to the same bytes as before.
`tests/verify-carve-pure.js` audits the committed `app/` without the export:
every token has its file and every piece is cited once.

`node scripts/assemble-app.js <export> --out a.html --compare b.html` says
whether two builds are the same bytes (stamps aside) and, if not, which part
differs, by name, never the text.

### How it got here

Until October 2026 the app was built by a patch chain: `scripts/build.js` ran
its `*-patch.js` scripts in order against the export, each a list of
exact-match find-and-replace edits that refused to run unless every edit
matched exactly once. The chain's output was frozen into `app/`
(`scripts/freeze-shell.js`), the assembler was shown to build the same bytes,
the chain was retired on 2026-10-04 and then deleted. Its scripts, and the
table of what each step did and why, are in git history:
`git show 11d588e:docs/BUILD.md` and `git show 11d588e:scripts/build.js`.
Comments in `app/`, `src/` and the suites still say "see scripts/X-patch.js"
where that step's header explained a decision at length; read it with
`git show 11d588e:scripts/X-patch.js`.

---

## Verifying

### The whole release, as one command

```bash
npm run release -- path/to/ACCSAP_export.html          # or: npm run release-check
npm run release -- path/to/export.html --skip webkit   # costs you the certificate
npm run release -- --dry-run                           # exercise the gate itself
```

`scripts/release-check.js` runs the sequence a release actually needs, in
order: the export is readable → nothing licensed is staged → the app
assembles → every figure decodes → the split build assembles → the full suite on
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

Without the export, `npm test` runs every suite CI runs: the pure-Node ones,
then the browser suites that make their own documents (the Memorizer and the
code-only deploy's import), then the app's browser suites on the synthetic
build, which it makes first with the same commands as CI's
`synthetic-browser` job (into `build/synthetic/`, never over your own
`build/systole.html`). It reads all of that from
`.github/workflows/verify.yml`, so the two cannot drift apart. That build is
marked synthetic, so no run on it is ever written to `tests/test-stats.json`.
`npm run test:pure` skips the browser suites and says which ones it skipped.
`SYSTOLE_ENGINE=webkit npm test` runs the browser half on WebKit. The full
registry below needs your build, and is `npm run test:private`.

`npm run doctor` says whether this machine is ready (Node, the test tools,
the browsers, the git hooks, whether the export is here) and the command that
fixes each gap. `npm run clean` removes what any clone can make again;
`npm run clean:private -- --yes` also removes what is built from the export
(build/, dist/, and what extract-content writes into content/). Neither ever
touches source/ or your notes in content/refs.

`--tag pure|browser|build|serial` selects suites by kind, read from each
suite's code (`node scripts/verify.js --list` shows them).
`--report-json <file>` writes the results as data: suite, tags, status,
counts and time, and no line of suite output.
`--jobs N|auto` runs suites side by side; `SYSTOLE_JOBS` in the environment
makes that this machine's default, and `--jobs` still overrides it. The suites
that measure time run alone either way.

```bash
node scripts/verify.js                       # everything, ~4 min
node scripts/verify.js --only physio,theme   # just these
node scripts/verify.js --skip keys --bail    # stop at the first failure
node scripts/verify.js --list                # what each suite defends
```

A suite that runs far past its recorded time is stopped and reported as having
died, with the section it was in, and the run carries on; `--suite-timeout N`
sets the limit in minutes (`0` for none, `scripts/suitetime.js` has the default).
Every run ends by naming its slowest sections, so a slow run says where its time
went instead of leaving it to be guessed.

### Which tests run where

| Where | What | When |
|---|---|---|
| GitHub, by itself | every suite that needs no export: the pure ones, the Memorizer in three browsers, and the app's own browser suites on an invented bank, in Chromium, and most of them again in WebKit, the iPad's engine (`synthetic-webkit`; the workflow names the ones left out and why) | on every pull request and every merge; nothing to do |
| Laptop, quick: `npm run test:laptop` | the suites tagged `laptop` (see `--list`): the ones no CI job runs, because they need your export | after a change to the app, in a few minutes |
| Laptop, full: `npm run test:private` | the whole registry on your real build; the only run that writes `tests/test-stats.json` | before a release, or when the record should move |
| iPad | Settings → Self-test, which checks the figure viewer and layout in the iPad's own Safari; and by hand, voice mode and the Lab's sounds | after installing a new version |

The `laptop` tag is read from `.github/workflows/verify.yml`, so a suite moved
into CI leaves the quick laptop run the same day. The full run repeats on your
real bank what GitHub already ran on the invented one, which is why it is the
occasional run rather than the routine one.

Across 153 suites, 6634 checks, plus 134 more on the split build. Those numbers are
not typed here by hand — `scripts/verify.js` writes `tests/test-stats.json` in
two halves, Systole's from a run where every Systole suite passed and the
Memorizer's likewise, the other half kept as it was — and `verify-stats`
fails if this sentence, the README or the CI header disagrees with it. They used to be maintained from memory in three files,
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
app/          systole.html · css/systole.css   (the app, payloads as slots)
scripts/      assemble-app · verify · build-pwa · serve · shots
tests/        153 suites · 89 need no browser · + pwa
docs/         BUILD · BUILD-PLAN · REFERENCE-GUIDE · reference-examples/
```

`src/` is the source of truth. The assembler embeds those modules into the
page — they are never edited in the built file, and the built file is never
edited by hand.

Modules are plain IIFEs that export onto `window`, so they can be required and
tested in bare Node without a bundler or a browser. That is not an accident of
style; it is what makes the numeric verification above possible.

## Security scanning

No static analysis runs on this repository. `.github/workflows/codeql.yml`
ran GitHub's CodeQL over the JavaScript, Python and workflow files here until
code scanning was turned off for the repository, after which every run failed
uploading its results; the workflow was removed rather than left red. Turning
code scanning back on in the repository settings and restoring that file from
history brings it back.

**The `github-advanced-security` check is not a security review of this
code.** It is a separate GitHub service whose file exclusions skip `*.js`,
`*.json`, `*.yml`, `*.html` and `*.py` — every language here. On a pull
request that changes only those files it reports success having read
nothing; on one that also changes Markdown it has crashed at startup. Read
its green as "did not run".

## The laptop as a CI runner (optional)

CI runs the honest subset because GitHub's runners cannot build the app from
the real bank — the ACCSAP 12 export is licensed and is not in this
repository nor in any secret GitHub holds. They build it around an invented
one, which leaves the suites about the real bank itself, and the split build,
running only when you remember to run them. Before the synthetic build that
was every browser suite, which is why "CSP has never met the real app" was
true for weeks.

The `full` job in `.github/workflows/verify.yml` closes that, by running on
your own machine. It is opt-in: with no runner registered it never starts, and
nothing else changes.

### Registering it

> **Stop first: this repository is public.** Do not register this runner, put
> the export's path in its environment, or start it while the repository is
> public. A fork's pull request can run its own workflow code on any
> self-hosted runner the repository has, and this one would sit on the machine
> that holds the licensed export. Make the repository private first, or apply
> every control in [Why it does not run on pull requests](#why-it-does-not-run-on-pull-requests)
> below, before any step in this section.

Settings → Actions → Runners → New self-hosted runner, then follow the
commands GitHub gives you. Three things must match this repository rather than
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

- **`SYSTOLE_REFS`.** In the same `.env`, the directory that holds the
  reference corpus as `refs/` and `refs-images/` — usually the `content/`
  folder of the clone you normally build in:

      SYSTOLE_REFS=/Users/you/systole/content

  The job copies both into its own checkout before the gate, because the
  corpus is gitignored and a fresh checkout has none. Without it the build
  still completes and the corpus suites fail, which is what the first real
  run did.

Run it with `./run.sh` when you want it, or install the service to have it
always on.

On Windows the same things apply, with `run.cmd` for `run.sh`. Write the
paths in `.env` with forward slashes (`SYSTOLE_SOURCE=C:/Users/you/Downloads/export.html`):
the first step tests it with bash's `[ -f ]`, and a backslash path is not a
valid path to bash. One more thing must be true there: the job's steps run
in bash, and the runner finds bash by searching `PATH`. Windows ships
`C:\Windows\System32\bash.exe`, which is the WSL launcher and not a shell, so
Git for Windows' `bin` directory has to come before `System32` in the `PATH`
of the process that starts `run.cmd`. A `.path` file beside it does nothing on
Windows — that was tried first, and the first dispatched run failed in
`System32\bash.exe`. A two-line launcher is enough:

    set "PATH=C:\Program Files\Git\bin;%PATH%"
    call "%~dp0run.cmd" %*

Do not kill the listener to restart it. Close its window or press Ctrl+C;
a killed listener leaves its session open on GitHub, and the next one is
refused with "a session for this runner already exists" for a few minutes.

### Turning it on properly, after the first green run

The job is **manual only** to begin with: Actions → `full` → Run workflow. That
is deliberate. A job whose labels match no online runner does not fail, it
QUEUES, and GitHub leaves a pending job for about a day before cancelling it —
so wiring it to `push` before a runner exists would have left every push to
master showing a check pending for 24 hours. `timeout-minutes` does not help;
it bounds execution, not the wait for a runner.

Once a dispatched run has gone green end to end, make it automatic by adding
the push arm back to the job's `if:`:

    if: (github.event_name == 'workflow_dispatch' || github.event_name == 'push') && github.ref == 'refs/heads/master'

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
that workflow comes from the PR's branch. This repository is public, so anyone
can open a pull request, and a fork's run uses the fork's own copy of the
workflow files: it can drop this job's restriction, or add a workflow of its own
that asks for this runner. Nothing written in a workflow file stops that. What
does:

- **Register no self-hosted runner while the repository is public** (GitHub's
  own advice), or make the repository private first.
- If a runner must exist on a public repository: Settings → Actions → General →
  fork pull request workflows, set **Require approval for all external
  contributors**, and never approve a fork's run at all. An approved job that
  asks for this runner waits in the queue, for up to 24 hours, and starts as
  soon as a runner comes online, so approving one "while no runner exists" is
  not safe either.
- **Before registering or starting the runner**, cancel every queued or
  waiting workflow run in the Actions tab.

The job itself runs only when started by hand on `master` (it is manual only,
above), so it does not start for pull requests on its own; never add
`pull_request` or `pull_request_target` to it.
