# Systole — review and roadmap

Written 2026-11-10 from a whole-repository review of `master` at `af0e384`.
The findings are observations of that commit, not maintained claims: a later
commit may already have changed one. The plan is the owner's to reorder.

Every item has an id (`F1`, `E2`, `S3` …) and a model tier, so a session can be
started with "do S1 from docs/ROADMAP.md" on the model that item names. The tier
table is in section 7.

**Done since:** F1, F2, F3 (the Apex button; the chip is PR #339's), F5, F6,
F7 and F8 (it needs one dashboard step), in PR #340. Each item below says what
was done.

## How this review was done

- **Read:** `AGENTS.md`, every page in `docs/`, `tasks/lessons.md`, the shell
  (`app/systole.html`), `src/`, the Apex Worker, `scripts/`, the CI workflow.
- **Measured in this session:** `npm run test:pure` (every pure suite passed,
  measured, none reused) and `npm run leak-guard` (clean). The browser suites
  were not run here; CI's run of `af0e384` on master was green.
- **Looked at:** the app built around the synthetic bank
  (`scripts/synthetic-export.js`, then `scripts/assemble-app.js`, output kept
  outside `build/`), with Home, Chapters, a question before and after answering,
  and Brain captured in Chromium at iPad landscape, iPad portrait and phone
  widths, light and dark.
- **Not seen:** the real bank, the owner's notes, a physical iPad, WebKit
  rendering, production Cloudflare, and any live Apex answer. Every layout
  observation below is Chromium's.

## The verdict

What is strong, and should be kept as it is: the verification culture (checks
seen to fail, the CSS floor table, honest records, reuse that says REUSED), the
licensing boundary (leak guard, synthetic fixtures, private build kept apart),
physiology that is computed rather than drawn, a storage design that has thought
about quota and atomicity, and Apex's grounding discipline (fenced evidence,
grounded mode withholding the key).

The risks, in the order they matter:

1. **Use lags build.** `docs/ux-discovery/2026-10-27-systole-discovery.md` says
   it plainly, and nothing since changes it. No item below is worth more than
   real study sessions, so Phase 0 is studying.
2. **The app lives in the shell.** `src/` holds the models; most application
   logic is one inline script in `app/systole.html` over a global `S`, wired by
   inline `onclick` handlers. It cannot be tested without a browser, every
   change to it is a change to one very large file, and the inline handlers are
   why the split build cannot have a `script-src` (`scripts/csp.js` says so).
3. **Two design languages.** The landing pages (Quiet Atlas: warm surface, teal
   rail, serif) and the inner screens (navy bar, cool gradient, dark gradient
   buttons) differ by accident rather than decision. F1 is one result.
4. **The study engine discards signal.** Quiz answers never reach the scheduler,
   target retention is fixed, and the exam date does not shape intervals.
5. **Apex depends on one vendor's free tier** for a request that, in open mode,
   carries licensed text. Cost and latency are fine; the data-use terms need a
   decision (F9).

## 1. Fix now

**F1 — The inner-screen header is unreadable in light themes.** `app/css/home.css`
(the `.nav-title` and `.nav-sub` rules near line 666) colours the wordmark with
`var(--text)` and the subtitle with `var(--muted)` on every screen, while on
screens other than Home `#navbar` is navy (`app/css/cardiac.css:527`). Measured in
Chromium, Daylight, on Chapters: wordmark 1.34:1, subtitle 1.76:1, where text
needs 4.5:1. Dark themes read about 12:1. Why no suite caught it:
`tests/verify-a11y.js` keeps only axe's `violations`, and axe files contrast over
a translucent or backdrop-filtered ground as `incomplete`; `tests/verify-ink.js`
measures a list of texts that does not include the header. Fix: scope the Quiet
Atlas wordmark colours to `body.on-home`, or give `#navbar` its own ink tokens.
Regression: add the header's two texts to verify-ink's measured text in every
theme state; inject today's rule, watch that check's FAIL, restore. *Sonnet.*
*Done:* the colours are scoped to Home; verify-ink reads the bar on Study and on
Home in every theme state.

**F2 — First run asks for a decision.** With nothing seen and nothing due, Home's
Continue opens Chapters, which is a menu. The discovery doc's first principle is
that removing the decision beats adding a feature. When there is no history,
label it Start and open a planned session (`studyplan.plan` at the default
length); keep Chapters one tap away. *Sonnet.*
*Done:* with nothing answered, the strip's button says Start and begins the
20-minute plan; with history it still says Continue and opens Chapters.
verify-homepager holds both.

**F3 — Floating controls cover text on a phone.** At phone width the Apex button
sits over the pearl's text and the "Live cardiac cycle" chip sits over the heart.
A floating control reserves its own space in the scroll container and never sits
over text. Check: at phone width, on Home, a question and an explanation, no
floating control's box intersects a text node's box. Read PR #339 first; it
touches Home. *Sonnet.*
*Done, for Home:* on a phone the Apex button is a round button at the end of the
tab bar's row, which the pages never reach; verify-home asserts its box never
meets the pager's at three phone sizes. PR #339 hides the chip. On the quiz the
button still floats over text mid-scroll and the page's end scrolls clear of it,
which is the ordinary trade for a floating button; it was left as it is.

**F4 — On iPad landscape the ECG panel covers the heart.** The strip's glass panel
and the Illustration and Pause controls sit over the lower half of the 3D heart.
Put the strip beside or below the heart, or size the heart's box to clear it.
Coordinate with PR #339. *Sonnet* (Opus if it becomes a layout-system change).

**F5 — A storage premise to re-check.** `src/core/store.js` (the paragraph ending
near line 93) says the keys moved to IndexedDB are protected from eviction.
WebKit's seven-day cap on script-writable storage, for a site used in a Safari
tab, covers IndexedDB as well as localStorage; Home Screen web apps are exempt.
If that is still WebKit's policy, the IndexedDB mirror protects against
localStorage alone being cleared, not against the cap. Confirm against WebKit's
current storage policy, then correct the comment, and in a Safari tab (not
`display-mode: standalone`) show a one-line nudge to Add to Home Screen beside a
more prominent backup reminder. *Sonnet* (Opus if the policy reading is unclear).
*Done:* WebKit's tracking-prevention page confirms the cap covers IndexedDB and
the service worker's cache, exempts the Home Screen app, and says nothing of
`persist()`. `store.js` and `docs/IPAD.md` say so; in a Safari tab the Progress
screen's data panel tells the fellow to add it to the Home Screen and back up
(verify-backup).

**F6 — Comments that point at files that no longer exist.** Comments send the
reader to retired patch scripts for the reasoning behind a rule:
`scripts/glass-patch.js`, `schema-patch.js`, `curate-patch.js`,
`offline-patch.js`, `resume-patch.js` and `selftest-patch.js` (in
`app/systole.html`, and `src/core/store.js` for resume). The banner over the FSRS
code still reads "SM-2 spaced repetition" (`app/systole.html:1878`);
`scripts/csp.js` describes inline handlers as living in the patch scripts;
`src/core/notesearch.js` says the question search lives in the licensed export.
Recover each "why" from history (`git log -S` on the deleted file) into the
comment or a docs page, or remove the pointer. *Haiku* (Sonnet where the history
has to be read).
*Done:* each reason recovered from the scripts as they stood before `c57a593`
and written where the pointer was, including five more pointers in the
stylesheets.

**F7 — Two numbers for one question.** The quiz header reads "Q 1/20" and the
card under it "Question 10 · Arrhythmias": position in the session and the bank's
item number, in the same words. Call the second one "Item 10", or move it to a
meta line. *Sonnet.*
*Done, the other way round:* the tag keeps "Question 10", the bank's own number
and what Apex cites; the counter reads "1 of 20", with "in this session" for a
screen reader. verify-quiznav holds it.

**F8 — The Worker's rate limit is per isolate.** `src/worker/apex.js` says so
itself. Replace it with Cloudflare's Workers rate-limiting binding, or a Durable
Object counter, keyed by the verified Access identity, and keep the in-memory map
as the fallback. Needed before the URL is shared with anyone else. *Opus.*
*Done, with D1:* Pages does not list the rate-limiting binding, and a Durable
Object needs a second Worker, so an optional D1 binding (`APEX_DB`) holds one
atomic count per caller per minute; unbound, nothing changes, and a failing
database falls back to the per-isolate limiter. verify-worker holds it.
**Owner step:** create the D1 database and bind it (`docs/IPAD.md`).

**F9 — Decide the data-use terms for Apex.** Open mode sends a question's stem,
options and commentary to the model provider. Check the bank licence's terms on
third-party processors, and the provider tier's data-use terms (free API tiers
have historically allowed use for product improvement; paid tiers generally have
not). Choose a paid tier or a provider whose terms exclude training, or make
grounded mode the default. The owner's decision; no code until it is made.

## 2. Engineering

**E1 — Move the app out of the shell, one module at a time.** Target: the shell
holds markup, slots and a boot; application logic lives in `src/app/*.js`,
included through `src:` slots in today's order. No bundler, no new runtime, the
same Safari floor. Order: (1) helpers that already touch no DOM (`md()`, the
provider-error classifier, interval formatting, the review queue) move to
`src/core/` with pure suites; (2) the Apex send loop and its wire format, which
A1 needs; (3) each screen's render function, one per change. Each move is
behaviour-preserving: the browser suites in Chromium and WebKit before and after,
measured rather than reused, and `docs/ARCHITECTURE.md`'s warnings about the
baked heart mesh respected. *Fable* (very high effort) for the dependency map of
the globals and the first two moves; *Opus* for each screen after that, following
the map.

**E2 — Delegated events, then a real `script-src`.** Replace `onclick="fn(this)"`
with `data-action` attributes and one delegated listener per root, screen by
screen after E1. The split build can then ship `script-src 'self'` with the hash
of its boot script. Checks: a scan that no `on*` attribute remains in emitted
markup, and `tests/verify-csp.js` extended to show an injected inline handler is
blocked. *Opus.*

**E3 — Make the CI workflow reviewable.** Most of `verify.yml` is rationale in
comments. Move it to `docs/BUILD.md` under anchors the YAML links to, and express
the browser shards as one reusable workflow. Keep every job's `name:` text exactly
as it is: branch protection matches on it (`AGENTS.md`). *Opus.*

**E4 — A budget for the checks on the checks.** The suite cache, input tracing,
records and stats are now a codebase of their own. Before adding another
meta-check, measure CI minutes per pull request, the flake rate, and which
meta-suites have failed across recent merges. Retire what has never failed and
guards nothing that can still break. *Opus* for the analysis; *Haiku* to read the
logs.

**E5 — Measure battery on the iPad, then set a frame budget.** The discovery doc
showed the container cannot measure it. Add a hidden diagnostics line that counts
frames drawn per second per canvas, note the iPad's battery percentage before and
after a real session, and confirm every canvas stops when off screen or when the
page is hidden (several already do). A likely policy: one live animation on Home
at a time. *Sonnet.*

**E6 — Sync, only if two devices are really used.** The sync weeks in
`docs/BUILD-PLAN.html` were never built. If wanted: the review log append-only,
cards last-write-wins per field, encrypted on the device, stored in the same
Cloudflare account behind the same Access (D1 or R2) rather than a second vendor;
the bank never syncs. *Fable* for the design (conflict rules, encryption, the
licensing boundary); *Opus* to build it.

**E7 — An encrypted backup.** A backup holds chats, notes and memory. Offer a
passphrase option (WebCrypto AES-GCM with a PBKDF2-derived key) beside the plain
export. *Sonnet*, with *Opus* reviewing the cryptography.

## 3. Design, themes and UI

**D1 — One design language.** Decide whether the inner screens adopt Quiet Atlas
or are deliberately different, then make it so: (a) collect the tokens, which are
declared across `base.css`, `themes.css`, `figures.css`, `tablet.css`,
`refinements.css`, `nav.css`, `home.css` and `apex.css`, into one tokens block;
(b) move colours written as literals in script (the rating colours at
`app/systole.html:1940`, among others) into CSS variables so themes reach them;
(c) add a pure lint that fails on a new hex literal outside the tokens and themes
files, with an allowlist for illustration, and watch it fail on an injected one.
*Opus* (it reads screenshots well); *Sonnet* for the mechanical moves.

**D2 — Contrast for every text, not a list of texts.** Sweep every visible text
node on each landing and study screen in every theme state, against its effective
ground (composite translucent layers; read a backdrop-filtered layer as the page
under it). F1 is what the list missed. *Opus.*

**D3 — Figure questions on iPad landscape.** A figure item shows the figure full
width and pushes the stem below it. When there is width, default figure items to
side by side (figure left; stem and options right), keeping the reading measure;
the split control already exists. Check in WebKit at iPad sizes. *Opus.*

**D4 — One focal point on Home.** The pearl teaches; the heart decorates unless
touched. Candidates to try in a real session: the heart still until tapped, the
strip beside rather than over it, the stats row hidden until there is data. The
owner picks, then *Sonnet*.

**D5 — A rule for floating controls.** The pencil and Apex buttons get defined
safe areas, never cover text, and on tablets fold into the rail. *Sonnet.*

**D6 — Fewer themes, each kept correct.** Every palette multiplies the contrast
and floor checks. Once usage shows which are used, keep those (at least Auto, one
light, one dark and the high-contrast one) and retire or freeze the rest. The
owner's decision.

## 4. AI — Apex

**A1 — A provider seam, and a second provider.** The tool list is already written
in Anthropic's `input_schema` shape, and `src/core/vision.js` was written against
Anthropic's image blocks. After E1 step 2, define one internal turn format with a
Gemini adapter and a Claude adapter, both behind the Worker so no key reaches the
device. Route by task: the smallest tier for memory extraction, session summaries
and classifying a miss; the middle tier for ordinary tutoring; the Opus tier for
figure reading and multi-step reasoning. Handle every stop reason explicitly
(refusal, output limit; PR #333 covers the output limit on the Gemini side).
Model ids are discovered at Connect through the provider's models endpoint, never
shipped as guesses, which is already the app's rule for Gemini. *Opus.*

**A2 — Prompt caching.** The system instruction carries the prompt, the profile,
memory and retrieved notes. Order it so the stable part (prompt, profile, memory)
comes first and retrieval last, and both providers can cache the prefix. Claim a
saving only from the cached-token counts the responses report. *Opus.*

**A3 — Measure live answers.** `tests/fixtures/apex-grounding/cases.json` and
`scripts/prepare-apex-eval.js` exist, and `docs/APEX-QUALITY.md` describes the
half that does not. Build the runner that sends the prepared requests to a
configured provider (the owner's key, with spend approved first), a claim-level
judge using the existing rubric, and a results file recording model id, date,
answer and a verdict per criterion, where unmeasured stays unmeasured. Keep it
apart from suite counts. *Fable* to design the judge and the adversarial cases
(conflicting notes, late exceptions, insufficient evidence); *Sonnet* to run it.

**A4 — Check citations in the app.** After a grounded answer, a small-model pass
compares each sentence that cites a note with the fenced excerpt and marks the
unsupported ones. Build it only if A3 shows unsupported claims are common. *Opus.*

**A5 — Retrieval before embeddings.** BM25 is the retriever, and
`docs/APEX-LOCAL-FIRST.md` rules out embeddings for now. Use A3 to count retrieval
misses; consider a small on-device embedding model only if they matter, and only
within the shell budget. *Opus.*

**A6 — Batch work on the owner's own notes.** A contradiction audit across the
notes, and drafted own-bank items with citations into the folder
`scripts/build-bank.js` already reads (`docs/OWN-BANK.md`, "Drafted by Claude").
Use the provider's batch interface. Never on the licensed bank unless F9 settles
that it is allowed. The most capable tier is worth its price here: offline, low
volume, quality-critical. *Opus* to build.

## 5. SI — the study engine

Read here as study intelligence: scheduling, calibration and planning.

**S1 — Every answer counts.** Only review-session ratings update FSRS; a quiz
answer leaves the card as it was (the comment above `fsrsPreview` in
`app/systole.html`). A retrieval in a quiz is still a retrieval. Map each answer
to a default rating — wrong is Again; right with Guess or Unsure is Hard; right
with Fairly sure is Good; right with Certain and faster than the fellow's median
is Easy — offered preselected and overridable, or applied silently to a first
exposure only. The testing effect is the reason; grading by confidence is what
keeps a lucky guess from being scheduled as known. Checks: a pure suite over the
mapping; a browser check that a quiz answer creates a card. *Opus* (it changes
the scheduler's contract and the oracle's scope).

**S2 — Schedule toward the exam.** With an exam date set: no interval ends past
the exam, so each card is seen once more before it; target retention rises as
the date nears, which needs the general interval formula, because `fsrs.js`
equates interval with stability only at 90%; and the final fortnight orders by
lowest retrievability weighted by chapter. Bump `SCHEDULER_VERSION`, and compare
with ts-fsrs at the same requested retention in the oracle suite. *Opus*, with
*Fable* reviewing the mathematics.

**S3 — Weights fitted to the fellow.** `fsrs.js` runs FSRS-5's population weights
and is already built for a change (`SCHEDULER_VERSION`, the parameter
fingerprint). Once the log is large enough for the FSRS optimizer's guidance, fit
personal weights offline from an exported log with the reference optimizer (FSRS-6
also fits the decay), ship them as data, and switch only if held-out log-loss and
calibration improve. *Fable* for the fitting and validation design; *Opus* to
implement.

**S4 — Spread the load.** Without fuzz, cards learned together come due together.
Add a small fuzz seeded by card id and review count, so the same inputs still give
the same day and tests stay deterministic. *Sonnet.*

**S5 — Calibration as a skill.** `src/core/calib.js` measures it; make it
trainable: a queue of answers marked Certain and wrong, and a Brier-score trend on
Brain once the bands have enough answers. *Sonnet.*

**S6 — Interleave the look-alikes.** Topic runs are blocked practice, which helps
first understanding; telling similar diagnoses apart improves with interleaving.
Build "confusable pair" sets from Apex's `gap` memories (constriction against
restriction, for example), and interleave chapters in review and mocks. *Opus.*

**S7 — Readiness with its uncertainty.** `studyplan.readiness` gives a verdict
from point estimates. Use per-chapter beta-binomial posteriors weighted by the
exam blueprint, and show an interval rather than one number. The owner supplies
the official blueprint weights; do not estimate them. *Fable* for the model;
*Sonnet* for the screen.

**S8 — One physiology engine.** `src/core/physio.js` draws the resting cycle as
curves whose crossings are measured, and solves the PV loop from the elastances
for its presets; the Wiggers traces do not follow the presets. A lumped-parameter
circulation (time-varying elastance chambers, valves with forward and regurgitant
paths, an arterial Windkessel, pericardial constraint and ventricular
interdependence) would let one parameter set drive the Wiggers diagram, the PV
loop, heart sounds, Doppler and the 3D heart for aortic and mitral stenosis and
regurgitation, HFrEF, HFpEF, and tamponade against constriction with respiratory
variation. Validate each lesion against textbook haemodynamics with tolerance
tables, and keep the rule that valve events are curve crossings. *Fable* (very
high effort) for the model and its validation; *Opus* to wire the views.

**S9 — Study the study.** Three readings from data already logged: sessions per
week, reviews done against reviews due, and the Certain-and-wrong rate. Read them
after two weeks of real use, and let them choose the next feature. *Sonnet.*

## 6. Phases

- **Phase 0, this week.** Study: three real sessions, notes per the discovery doc.
  Fix F1, F3, F6 and F7. Decide F9.
- **Phase 1, the following weeks.** F2, F4, F5, F8; S1 and S4; D2; A2.
- **Phase 2.** E1 steps 1 and 2; A1 and A3; S2; D1 and D3.
- **Phase 3, chosen by what Phases 0 to 2 show.** S3, S7, S8, E2, E6, D6, A4 to A6.

One standing rule until S9 has data: no new screen and no new element on Home.

## 7. Which model for which work

Switch with `/model` in Claude Code. Start a fresh session per item (`AGENTS.md`:
one session per task), give the item's id and its acceptance line, and let the
session read this page. Fable is the most capable tier and is metered the
heaviest, so it is kept for the work below; giving it Sonnet's work buys nothing.

| Tier | What it is for here | Items |
| --- | --- | --- |
| **Fable** | Long, cross-cutting work where a mistake is silent; scientific and mathematical modelling; evaluation and architecture design. Give it the whole specification at the start and a high effort; very high only for E1 and S8. | E1 (the map and the first two moves), E6 design, A3 design, S2 review, S3, S7, S8, and a whole-repository review like this one each quarter |
| **Opus** | Hard engineering inside clear bounds; small security-relevant changes; layout work judged from screenshots; scheduler changes; WebKit races and flaky suites. | F8, E1 (per screen), E2, E3, E4, E6 build, D1, D2, D3, A1, A2, A4, A5, A6, S1, S2, S6 |
| **Sonnet** | Features and fixes with a clear specification and an existing suite to extend. | F1, F2, F3, F4, F5, F7, E5, E7, D4, D5, S4, S5, S7 screen, S9, running A3 |
| **Haiku** | Comment and doc tidying, lookups, reading a CI log for its FAIL lines. | F6, E4 log reading |
