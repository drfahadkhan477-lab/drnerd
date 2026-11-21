# Systole — review and roadmap

Written 2026-11-10 from a whole-repository review of `master` at `af0e384`.
The findings are observations of that commit, not maintained claims: a later
commit may already have changed one. The plan is the owner's to reorder.

Every item has an id (`F1`, `E2`, `S3` …) and a model tier, so a session can be
started with "do S1 from docs/ROADMAP.md" on the model that item names. The tier
table is in section 7.

**Done since:** F1, F2, F3 (the Apex button; the chip is PR #339's), F5, F6,
F7, F8 (it needs one dashboard step) and S1 (first answer only), in PR #340. Each item below says what
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
   inline `onclick` handlers. It cannot be tested without a browser, and every
   change to it is a change to one very large file. (The inline handlers are
   gone since E2, and the split build now ships a `script-src`.)
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
*Done, for Home:* on a phone the Apex button is a round button in a band of its
own under the pages (where the tab bar stood until the owner removed it in
November 2026), which the pages never reach; verify-home asserts its box never
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
*Done so far:* the map (`docs/SHELL-MAP.md`, written by `tools/shell-map.js`);
step 1 (`src/core/markdown.js`, `providererror.js`, `reviewqueue.js`); and the
wire half of step 2 (`src/core/apexwire.js`: the window, Gemini's request and
its stream, as `ApexWire.gemini`, which is where A1's second adapter goes).
Each is held by a pure suite, and the shell keeps a one-line function of each
old name. Then the rest of step 2: the seven names a turn rebinds (`aiBusy`,
`aiAbort`, `toolTrace`, `groundedTurnLeft`, `lastHits`, `lastHitsKey`,
`pendingNav`) became one owner, `APEX_TURN` (`src/core/apexturn.js`), with the
old names kept as views of its fields; and `streamReply()`, the loop that runs a
turn, moved there as `ApexTurn.run()`, handed the page's parts. The views go
when nothing says the old names; the map lists who still does, and fourteen
browser suites say them from inside the page. Step 3 has begun, in the map's
order of screens: its first rows were already calls into a module
(`buildEchoScreen`, `buildNoteSearch`) or one line of markup (`buildPractice`),
so the first screen to move is the results screen, now `src/app/results.js`
(`ResultsScreen.screenHtml(S, CHAPTERS, CH_COLORS, kit)`), held by
`verify-results-pure`. The map now follows state handed whole to a module's
function, so a screen that has moved is still listed under the fields it reads
and changes. The Memory screen followed (`src/app/memory.js`,
`MemoryScreen.screenHtml(all, kit)`, held by `verify-memoryscreen-pure`): its
builder only, because `memForget()` and `memForgetAll()` ask with `confirm()`,
which `verify-ui-pure` reads where it is called. Then the Rhythm Lab
(`src/app/rhythmlab.js`, `RhythmLabScreen.screenHtml(p)`, held by
`verify-rhythmlab-pure`): `buildLab()` with `buildPhysio()` and
`buildTwelveLead()`, the first screen with state of its own. `labKind`,
`setLab()` and the mounts stay in the shell, and the module is handed the
values. Then "Your annotations" (`src/app/annotations.js`,
`AnnotationsScreen`, held by `verify-annotations-pure`): the screen and the
three pieces of it that typing repaints, five functions in all. `ANNO`,
`annoInput()` and `practiceAnnotated()` stay in the shell, and of the page's
state the module is handed the flagged and the missed and no more. Then the
mock block's report (`src/app/mockreport.js`,
`MockReportScreen.screenHtml(S, CH_COLORS, CH_SHORT, kit)`, held by
`verify-mockreport-pure`): its builder only; `mockReview()`, which two of its
buttons name, stays in the shell. Then the topic search
(`src/app/search.js`, `SearchScreen.screenHtml(SQ, S, CHAPTERS, CH_COLORS, kit)`,
held by `verify-search-pure`): the builder with `hl()` and `snippet()`, which
only it used; `SQ`, `runSearch()`, `searchInput()` and its timer and the
handlers stay in the shell. Then the Study screen (`src/app/study.js`,
`StudyScreen.screenHtml(S, CHAPTERS, CH_COLORS, kit)`, held by
`verify-study-pure`): the builder with `arc()` and `examLeftText()`. Its one
write, the topic runs into `_runsShown`, which `startRun()` reads, stays in the
shell and happens before the module is asked. Then the reference library
(`src/app/refs.js`, `RefsScreen.screenHtml(REF, kit)`, held by
`verify-refs-pure`): the builder and its pager; `refCard()` stays in the shell
because `refMore()` adds cards with it, and the import, export and edit
handlers stay there too. Then the question screen (`src/app/quiz.js`,
`QuizScreen.screenHtml(S, LOG, CH_COLORS, kit)`, held by `verify-quiz-pure`):
the builder with its confidence and miss rows; `fsrsPreview()`,
`fmtInterval()`, `hasPeers` and every handler stay in the shell, and so do
`setConfidence()` and `setMissReason()`, which repaint those rows' chips in
place. Then a mock exam block (`src/app/mock.js`,
`MockScreen.screenHtml(S, kit)`, held by `verify-mock-pure`): the builder and
its summary before handing in; `mockQ()`, `mockClockText()`, `mockPaceText()`
and `mockCellLabel()` stay in the shell, because the ticker and the keys
repaint the clock, the pace line and the grid with them. Then the Sessions
screen (`src/app/sessions.js`, `SessionsScreen.screenHtml(S, CHAPTERS, kit)`,
held by `verify-sessions-pure`): the screen, the mock exam's card and the voice
card. `mockCardInner()` stays in the shell as one line, because `setMockCfg()`
draws the card's inside again in place; `_mockCfg`, `_mockArm` and `_mockLost`
are handed over as they stand at each drawing, and every handler that writes
them stays in the shell. The row after it, `buildNoteSearch`, was already a
call into a module before step 3 began (`NoteSearch.screenHtml`, in
`src/core/notesearch.js`). Then the Progress screen (`src/app/stats.js`,
`StatsScreen.screenHtml(S, LOG, CHAPTERS, CH_COLORS, kit)`, held by
`verify-statsscreen-pure`): the screen with its calibration, retention and mock
panels. `buildStats()` keeps the line that starts the survey of the figures on
this device, which is the page's doing and not the markup's; the export,
import, reset and download handlers stay in the shell, and so do the functions
the screen is handed, which read the page's state, storage and browser. That left
one screen in the shell, `buildHome`, with the Apex panel's `buildAI`
listed apart. It was three pages and left in three parts, into
`src/app/home.js`, held by `verify-homescreen-pure`. The Labs page is the
first (`HomeScreen.labsHtml(S, CHAPTERS, dueN, kit)`): `buildLabs()` stays one
line, and hands the notes and Apex's memory only where the app has them. The
Brain page is the second (`HomeScreen.brainHtml`, `.brainArtHtml` and
`.brainInfoHtml`): `buildBrain()`, `buildBrainArt()` and `brainInfoHtml()` each
stay one line, the last because `brainPick()` repaints the info in place, and
the Brain page is handed the other two, which it draws art first, because the
art can lay the brain out anew and the info reads that layout.
`brainLayoutNow()` and the layout it keeps stay the page's. The Home page is
the last (`HomeScreen.homeHtml(S, CHAPTERS, kit)`), the hero and the pearl:
`buildHome()` keeps its one write, `atlasReading`, set before the page is
drawn, and the two inlined heart images, whose asset slots the assembler fills
in the shell only, are handed over as whole elements. The pearl's and the
greeting's helpers, and every handler the page names, stay in the shell. With
it the screens of step 3 have left the shell. Last is the Apex panel, which
the screens table lists apart (`src/app/apexpanel.js`, held by
`verify-apexpanel-pure`): its head, the setup it shows where there is no key,
and the conversation leave as `ApexPanel.headHtml`, `.setupPanelHtml` and
`.panelHtml`. `buildAI()` stays the page's, because it is what touches the
page: it reads what was being typed and where the panel was scrolled, draws the
head before it asks whether there is a key, puts the markup in, wires the chat
and the avatar, and restores what it read. The figures from the notes drawn on
are found by the page's `apexFigsFor()`, which keeps the last answer
(`apexFigMemo`), and handed in.
Then the map's first group again, the leaves, a feature at a time: the notes
importer's parsers (`src/core/refimport.js`, `RefImport`, held by
`verify-refimport-pure`): a file into notes (`parse`), its front matter and its
sections, the file an image link names, and a note's figures, which were
`parseImportText()`, `stripFrontmatter()`, `splitSections()`,
`refResolveAsset()` and `extractRefImages()` and stay those names as one line
each. `refAbsorbImages()`, which stores the bytes, stays the page's.
Then what a saved progress record may hold (`src/core/progressdata.js`,
`ProgressData`, held by `verify-progressdata-pure`): the one table a restore,
an export and a record from another window are read by, and the rules over it,
which were `STAT_ENTRY`, `statDay()`, `statRecord()`, `statEntryOk()`,
`usableStats()`, `progressFromBackup()` and `validExamDate()`. The page keeps
the five it calls by name as one line each; `load()`, `save()` and
`adoptProgress()`, which touch storage and the page's state, stay the page's.
Then the pen's stroke geometry (`src/core/stroke.js`, `Stroke`, held by
`verify-stroke-pure`): a point rounded to what a screen shows, the
Ramer–Douglas–Peucker simplification, a stroke simplified before it is stored,
and an outline filled as one curved path, which were `roundPt()`, `rdp()`,
`simplifyStroke()` and `fillOutline()`. `penOutline()`, which reads the page's
pen and PencilFX's width curve, stays the page's.
Then the map's second group, the readers, a screen's numbers at a time: what
the Progress, Study and Brain screens lead with (`src/core/progressstats.js`,
`ProgressStats`, held by `verify-progressstats-pure`): a chapter's mastery, the
mean recall, the week's due cards, the questions started and the last thirty
days, which were `masteryFor()`, `avgRetention()`, `forecast7()`,
`startedCount()` and `last30()` reading `POOL`, `S` and the clock, and are now
handed them. The three screen suites that run the page's own lines
(`verify-statsscreen-pure`, `verify-homescreen-pure`, `verify-study-pure`)
load the module beside them.
Then the rules of connecting a key, into the modules that already hold the
wire and the refusals rather than a new one: `cleanKey()`, the reading of a
ListModels page and `geminiDefaultModel()` are `ApexWire.key`,
`ApexWire.gemini.models` and `ApexWire.gemini.pick`, and `networkErrorMsg()`
is `ProviderError.network`, each held by its module's suite. The fetch, the
pages and the errors of `geminiModels()` stay the page's; `ProviderError`'s
slot moved up beside `ApexWire`'s, above its first caller. `toOpenAITools()`
is called by nothing, and is left for a change of its own.

**E2 — Delegated events, then a real `script-src`.** Replace `onclick="fn(this)"`
with `data-action` attributes and one delegated listener per root, screen by
screen after E1. The split build can then ship `script-src 'self'` with the hash
of its boot script. Checks: a scan that no `on*` attribute remains in emitted
markup, and `tests/verify-csp.js` extended to show an injected inline handler is
blocked. *Opus.*
*Done so far:* the check, then the listener. `scripts/csp.js` holds the policy
E2 aims at (`scriptPolicy(hashes)`: today's directives and a `script-src` of
`'self'` and the boot's hash), shipped nowhere yet. `tests/verify-csp.js`
shows, in Chromium and WebKit, that under today's policy an injected `onclick`
runs, and that under the E2 policy the hashed boot and a same-origin script
run and a delegated `data-action` listener hears its button, while a
written-in `onclick`, an injected one and an injected unhashed script are each
refused with a `script-src` report. `src/core/actions.js` installs one
delegated listener that calls a `data-action` by name from the page's
`ACTIONS` table, which is the allowlist (`verify-actions-pure`). The Memory
screen is the first to carry no inline handler (`verify-memoryscreen-pure`
scans what it draws for any `on*` attribute; `verify-memory` and
`verify-backup-ids` tap it through the real page), then the Rhythm Lab
(`verify-rhythmlab-pure`; `verify-physio` taps a rhythm chip) and the
results screen (`verify-results-pure`; `verify-flags` taps Flagged Again and
`verify-apexask` Explain my misses), the annotations screen
(`verify-annotations-pure`; `verify-flags` types into its box and taps
Practise), the mock report (`verify-mockreport-pure`; `verify-mockscreen`
taps its review), the topic search (`verify-search-pure`; `verify-searchwarm`
taps, types into and chooses from it) and the Progress screen
(`verify-statsscreen-pure`; `verify-backup` taps each of its buttons), and the
notes library (`verify-refs-pure`; `verify-reflist` taps each of its buttons), and
the Sessions screen (`verify-sessions-pure`; `verify-mockscreen` and
`verify-voicescreen` tap its controls), and the quiz (`verify-quiz-pure`;
`verify-quiznav`, `verify-flags`, `verify-apexask` and `verify-mockscreen` tap
its buttons) and the mock block (`verify-mock-pure`; `verify-mockscreen` taps
its buttons) and the Study screen (`verify-study-pure`; `verify-chapters`
taps its rings, tiles, review, missed, every-question and back buttons,
`verify-planscreen` a plan, `verify-topicrunscreen` a run, `verify-examdate`
the date and its clear, and `verify-flags` the flagged and annotated cards), and the
home screen's three pages (`verify-homescreen-pure`; `verify-home` taps the buttons
no other suite taps, and `verify-homepager`, `verify-pearl`, `verify-pwa`,
`verify-mockscreen`, `verify-lab` and `verify-echo` the rest). Its keys are
in `KEY_ACTIONS`, under the name of the element pressed on: a tab's `homeGo`
calls `homeTabKey()`, the brain's `brainTap` calls `brainKey()`
(`verify-homepager` presses a tab's arrow, `verify-home` the brain's). Its
scrolls are in `SCROLL_ACTIONS`, which listens as a scroll goes down, since
one does not bubble, and acts only for the element scrolled
(`verify-home` scrolls each, and holds the statement's scroll, inside the pager,
to the statement alone; `verify-homepager` swipes the pager). An action that needs state reads it when
tapped, as its handler did: Restart reads the chapter then. What a field does
as it is typed in is in a table of its own, `INPUT_ACTIONS`, listened to for
input only, so a tap on a field calls nothing and a key in a button calls
nothing; what a choice does when another is chosen is in `CHANGE_ACTIONS`,
listened to for change only. Settings (`openSettings()` and the rows it draws)
carries none either: its text sizes, widths, themes, reset, close and Apex
memory are in `ACTIONS`, its two sliders in `INPUT_ACTIONS` and its layout in
`CHANGE_ACTIONS` (`verify-settings` scans the open dialog for any `on*`
attribute and taps, types into or chooses from each control; `verify-theme`
taps a theme). The bar along the top (`buildNav()`) carries none: its brand is
`goHome` and its search `openSearch`, and focus mode, the notes search, Home's
light and dark button (which asks which the theme is when tapped) and Settings
are in `ACTIONS` (`verify-theme` scans the bar on Home and on a question and taps
its brand, search and light and dark button; `verify-focus` taps focus mode,
`verify-notesearch` the notes search and `verify-settings` Settings). The Apex
panel's head and its figure strip (`src/app/apexpanel.js`) carry none: grounding,
full page, Apex's settings, close and a figure are in `ACTIONS`, and a figure is
handed to `openFigureFrom()`, which gathers a figure that names the action with
the ones that still carry the handler (`verify-apexpanel-pure` holds the markup
and the table; `verify-apexpage` taps the four buttons and `verify-figzoom` a
figure). Every figure that opens full size names an action: markdown's
(`verify-md-pure` now counts any `on*` attribute in `md()`'s output as an
offence) and the Apex strip's `openFigureFrom`, the pearl's `openPearlFigure`,
whose keys are in `KEY_ACTIONS` (`verify-pearl` opens it with Enter;
`verify-homepager` holds that End scrolls it and goes no further), and a
question figure's full-screen button `openQuestionFigures` (`verify-figzoom`
taps it; `verify-chatfigs` taps a reply's figure). The last ones name actions
too: Leave focus mode (`verify-focus` taps it), the related question's Close and
Go to this question (`verify-figzoom`), a note card's Edit and Delete
(`verify-backup-ids`), Apex's actions on this device (`verify-chat`) and the
voice dock's Stop (`verify-studyvisuals`). The crash screen's Reload has a
listener of its own, added when the screen is drawn, because that screen is
shown when something has already failed (`verify-failsafe` taps it), and the
last-resort fallback links to the page itself rather than to `javascript:`. No
`on*` attribute is left in `app/systole.html` or `src/`, and `verify-actions-pure`
keeps it so: it reads the shell and every module with comments blanked and fails,
naming the file and line, on one put back. *Done:* the split build ships the
`script-src`. `scripts/build-pwa.js`, as the last thing it does to the shell,
hashes each inline script and puts `scriptMeta(hashes)` in place of the base
`<meta>`, and refuses to build a shell with a script it cannot account for, an
inline handler or a `javascript:` URL in its markup; the Worker's header keeps
the other directives, since it ships verbatim. `verify-pwa` holds on the served
build that the hashes are exactly the inline scripts', that the app boots and
works with no violation, and that an injected `onclick`, inline script and
`javascript:` link are each refused and reported.

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

*Measured 21 November 2026:* the 30 most recently merged PRs targeting
`master`, from #365 to #396 by merge time, had 55 Verify workflow runs and
59 attempts. Match each `pull_request` run to the PR's head branch between
its opening and merge timestamps, then include every attempt. All 30 PRs
had a run at the merged head. Runner-minutes sum the GitHub Actions job
start-to-completion intervals, including time spent on failed or cancelled
jobs with timestamps and excluding skipped jobs. These are elapsed runner
minutes across jobs, so they differ from time spent waiting for a PR and
from billed minutes. The sample excludes post-merge pushes and manual runs.

| Scope | Median per PR | Mean per PR | 90th percentile per PR | Total |
| --- | ---: | ---: | ---: | ---: |
| All observed PR runs | 94.9 min | 176.0 min | 188.9 min | 5,281.5 min |
| Merged-head runs and their attempts | 91.9 min | 99.3 min | 101.2 min | 2,979.1 min |

The synthetic Chromium and WebKit shards accounted for 4,748.2 minutes
(89.9%), with 2,461.9 minutes in WebKit. PR #384 alone used 1,713.6
runner-minutes across its successive commits and attempts.

Four runs failed and then passed on the same workflow run and SHA. That is
4 of 55 observed runs (7.3%), or 3 of 30 at merged heads (10.0%). This is an
observed lower bound because failures without a same-SHA rerun are
unclassified. Eight runs ended cancelled. The four confirmed reruns used
364.2 runner-minutes:

- [#384](https://github.com/drfahadkhan477-lab/drnerd/actions/runs/44524340807),
  `verify-splash-heart`.
- [#387](https://github.com/drfahadkhan477-lab/drnerd/actions/runs/44514933922),
  `verify-mockscreen`.
- [#369](https://github.com/drfahadkhan477-lab/drnerd/actions/runs/44208390958)
  and [#365](https://github.com/drfahadkhan477-lab/drnerd/actions/runs/44183762046),
  `verify-lab`.

The named meta-suites all completed green. Durations below cover named
steps, separate from setup and the second timezone's grouped rerun. The
Actions API timestamps have second-level precision.

| Meta-suites | Successful measurements | Runner-minutes |
| --- | ---: | ---: |
| `verify-devtools-pure` | 59 | 13.0 |
| `verify-suitecache-pure`, `verify-suitetime-pure` | 59 each | 10.5 |
| `verify-suitecache` | 118 across both engines | 2.8 |
| `verify-testpublic-pure`, `verify-cichanges-pure`, `verify-stats`, `verify-shard-pure`, `verify-record-pure` | 59 each | 2.0 |

*Retirement recommendation:* keep these suites. They exercised distinct
contracts and together cost about 0.5% of measured runner time. Focus the
next measurement on WebKit shard balance and the browser suites that drove
reruns. The earlier `verify-homepager` Brain-turn failure was addressed by
[#357](https://github.com/drfahadkhan477-lab/drnerd/pull/357).
*WebKit follow-up after #397 merged:* two completed master push runs on each
side of the change ran the shared browser workflow and passed all WebKit shards
on attempt 1. The median slowest shard went from 15.25 to 11.72 minutes. The
median elapsed time from the first WebKit shard's start to the last one's
completion went from 15.80 to 11.72 minutes. The median sum of shard
runner-minutes went from 39.52 to 40.37. The push at the merge commit was
cancelled before its WebKit shards ran. One later workflow failed in Chromium
and is included because its WebKit jobs all completed successfully.
[Before](https://github.com/drfahadkhan477-lab/drnerd/actions/runs/44857423826),
[before](https://github.com/drfahadkhan477-lab/drnerd/actions/runs/44861112392),
[after](https://github.com/drfahadkhan477-lab/drnerd/actions/runs/44861285980),
[after](https://github.com/drfahadkhan477-lab/drnerd/actions/runs/44864440401).

Two later PR runs with four green first-attempt WebKit shards took 13.73 and
16.50 elapsed minutes, with 40.68 and 45.32 runner-minutes. The small master
sample supports keeping the weights. The PR timings show that the slowest
shard still varies across runs, so collect more data before retuning.
[#406 run](https://github.com/drfahadkhan477-lab/drnerd/actions/runs/44862935819),
[#408 run](https://github.com/drfahadkhan477-lab/drnerd/actions/runs/44866313083).

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
*Started:* a probe that composites background colours read 3,704 texts across
nine screens and twelve theme states and found one real failure: an unchosen
option's letter, the accent at 3.5-3.9:1 (fixed; verify-ink holds it, and its
scan now sees the `--acc` alias). It could not measure 2,319 texts on gradients
or images, and it mis-read the selected tab, whose ground is a sibling pill. The
rest of D2 needs pixel sampling: hide the text, screenshot, read the ground
under each text box. Also seen, not fixed: the mock exam's chosen letter is
white on the raw accent (about 4.1:1).
*Done, pixel sampling:* `tests/verify-contrast.js` hides the text, photographs
eight screens in twelve theme states, and reads every text box against the
pixels under it (median; 10th percentile reported). It found three more: the
Apex button's name on a light accent (3.2:1), the score pill's red on
Parchment's bar (3.2:1), and the study-plan card's grey over its glow in the
dark themes (4.1:1); all fixed. It now also reads Sessions, the mock exam with
an answer chosen and its report, and five screens on a phone; the mock exam's
chosen letter, white on the raw accent, read 1.9:1 to 4.1:1 in nine theme
states and now fills with the accent's ink. Then a figure question, Apex
(before a key, and with a conversation) and Settings, on both devices: a
reader's own Apex message was white on the raw accent (1.9:1 on the light
accents) and now takes the same ink. Still not read: other screens, other
phone sizes, pages scrolled past their top, and moving states.

**D3 — Figure questions on iPad landscape.** A figure item shows the figure full
width and pushes the stem below it. When there is width, default figure items to
side by side (figure left; stem and options right), keeping the reading measure;
the split control already exists. Check in WebKit at iPad sizes. *Opus.*
*Done:* where two columns of 28em fit (an iPad on its side
at Standard text, Apex closed), a figure question draws the figure on the left
and the stem and options on the right; on an iPad Air on its side the options
had begun at 911px of 820. Upright, on a phone, with Apex's column open or at
the Largest text the figure stays above. With the split preference the
explanation takes the second column once answered, never a third.
A mock block does the same. `verify-readsize` holds both.

**D4 — One focal point on Home.** The pearl teaches; the heart decorates unless
touched. Candidates to try in a real session: the heart still until tapped, the
strip beside rather than over it, the stats row hidden until there is data. The
owner picks, then *Sonnet*.

**D5 — A rule for floating controls.** The pencil and Apex buttons get defined
safe areas, never cover text, and on tablets fold into the rail. *Sonnet.*
*Started, the end of every screen:* scrolled to its end, Sessions' last line
sat under the Apex button on a phone; the other seven screens read cleared it,
and an iPad either way up was clear. Below 1024px every screen but Home now
ends in the button's own space; from 1024px the column's padding already
clears it. `verify-readsize` reads eight screens at three sizes. Still open: text
passes under the button while a page scrolls (a sweep counted it on the
notes, Progress, Chapters and the Lab, mostly on a phone), and folding the
Apex button into the rail on tablets is a design decision.

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

*Gemini:* #410 moved the profile and study signals before memory and
question context. Explain-only also puts its instructions before the
context, so retrieved notes end the system instruction in both modes.
Memory and notes keep the per-turn fence, which changes on each turn.
#400 reports cached-token counts from saved exchanges. The saved sample
omitted those counts, so provider savings remain unmeasured.

**A3 — Measure live answers.** `tests/fixtures/apex-grounding/cases.json` and
`scripts/prepare-apex-eval.js` exist, and `docs/APEX-QUALITY.md` describes the
half that does not. Build the runner that sends the prepared requests to a
configured provider (the owner's key, with spend approved first), a claim-level
judge using the existing rubric, and a results file recording model id, date,
answer and a verdict per criterion, where unmeasured stays unmeasured. Keep it
apart from suite counts. *Fable* to design the judge and the adversarial cases
(conflicting notes, late exceptions, insufficient evidence); *Sonnet* to run it.

*Implemented in #399:* the synthetic runner has a provider request limit,
and the offline scorer records each claim's verdict. See
[APEX-QUALITY.md](APEX-QUALITY.md) for the rubric and replay commands.

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
*Done, as the owner chose (first answer only):* a quiz's first answer to a
question with no card makes its card (wrong: Again; right and Guess or Unsure:
Hard; otherwise Good; never Easy). A card that exists is still moved by the
review queue alone, and the mock exam and its review schedule nothing.
`FSRS.firstRating` (verify-fsrs), the app (verify-stage0, verify-stage2).

**S2 — Schedule toward the exam.** With an exam date set: no interval ends past
the exam, so each card is seen once more before it; target retention rises as
the date nears, which needs the general interval formula, because `fsrs.js`
equates interval with stability only at 90%; and the final fortnight orders by
lowest retrievability weighted by chapter. Bump `SCHEDULER_VERSION`, and compare
with ts-fsrs at the same requested retention in the oracle suite. *Opus*, with
*Fable* reviewing the mathematics.

The S2 policy keeps 90% retention until 60 days out, then raises it
linearly to 95% on the eve. Leave room for a review on the eve; a card rated
that day may come due on exam day. From exam day onward, a new rating starts
an ordinary interval. Bring existing cards into the pre-exam queue without
rewriting their saved dates when the fellow changes or clears the exam date.
Quiz, review and Practice Lab ratings use the same deadline.
In the last 14 days rank due bank cards by estimated chance of forgetting times
chapter share, with equal shares until a matching owner blueprint is supplied.

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
*Done:* a named card's interval of 2.5 days or more moves within the range
upstream FSRS-5 draws from (ts-fsrs's own ranges, recorded in a fixture), by a
hash of its id, review count and lapse count; Again is not moved, and an
unnamed card is not either, which is what the oracle compares. Forty cards
learned on one day and answered Good twice came due on one day; named, over 22.
The rating, its preview and the first-answer card all pass the question's id,
and the Practice Lab's drill items pass theirs.

**S5 — Calibration as a skill.** `src/core/calib.js` measures it; make it
trainable: a queue of answers marked Certain and wrong, and a Brier-score trend on
Brain once the bands have enough answers. *Sonnet.*
*Done, on Progress rather than Brain:* the standing rule in section 6 keeps new
elements off Home, and Progress already holds the calibration panel. A question
answered Certain and wrong joins a queue (`Calib.certainWrong`) and leaves it the
next time it is answered right; the panel's button practises the queue as a quiz
of its own (`startQuiz(null,'certain')`). A Brier score a week
(`Calib.brierTrend`), over answers rated with a band, each band read as a stated
chance (Guess 0.25, Unsure 0.5, Fairly sure 0.75, Certain 0.95, in `BANDS`), is
drawn once two weeks each have `MIN_SAMPLES` rated answers. verify-calib-pure,
verify-statsscreen-pure, verify-results-pure, verify-calibrate.

**S6 — Interleave the look-alikes.** Topic runs are blocked practice, which helps
first understanding; telling similar diagnoses apart improves with interleaving.
Build "confusable pair" sets from Apex's `gap` memories (constriction against
restriction, for example), and interleave chapters in review and mocks. *Opus.*
*Done:* `src/core/confusable.js` reads each `gap` memory as the two things it
names ("X as Y", "X vs Y", "X with Y", "between X and Y" …) and finds the
bank's questions that hold every word of a side. A review session, and Home's
review of every card due, deal a question on the other side straight after one
on a side when the deck holds none of it (at most `PAIR_MAX`, a card already met
first), keep every due card, and take chapters in turn; so does the mock block.
A gap that names no two things is left out, not guessed at. Apex's `remember`
tool now asks for a gap written as the two things. verify-confusable-pure.

**S7 — Readiness with its uncertainty.** `studyplan.readiness` gives a verdict
from point estimates. Use per-chapter beta-binomial posteriors weighted by the
exam blueprint, and show an interval rather than one number. The owner supplies
the official blueprint weights; do not estimate them. *Fable* for the model;
*Sonnet* for the screen.
*Done, all but the weights:* `StudyPlan.readiness` gives each chapter a Beta
posterior (a prior worth `PRIOR_N` answers centred on the fellow's own pooled
accuracy, updated by the chapter's right and wrong) and its middle 80%. With a
blueprint it gives the exam score as the Beta matching the weighted sum's mean
and variance, chapters taken as independent (checked against sums drawn
at random in verify-plan-pure). The readiness line names the weakest chapters as
intervals. `src/core/blueprint.js` ships empty: the line says a likely exam
score waits for the blueprint, and a table naming a chapter the bank lacks is
refused by name. Still the owner's: the weights, mapped onto the bank's
chapter names, and their source.

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
*Started, the engine:* `src/core/circulation.js` is the closed circulation
above, with no view wired to it yet. It has four elastance chambers, Bernoulli
valves with forward and regurgitant orifices and no inertance, so a valve moves
only where two pressures cross. Its beds are three-element Windkessels, and a
pericardium holds the chambers and any fluid. Breathing reaches the chambers
only through a pericardium that passes it on. Each lesion is a change from
normal, run to a steady state and held by `Circulation.VALIDATION` to its
textbook ranges (verify-circulation-pure). Not yet reproduced: constriction's
breathing signs (the mitral E wave falls a few percent where the textbook has a
quarter or more), so constriction is held to its catheter signs alone.
*The Wiggers view, wired:* `Circulation.cycle(preset)` gives one steady beat
with the chest held still, its valve events measured where the pressures cross
and its phases between them. The Wiggers view offers each lesion as a chip and
draws its beat, with axes sized to it; Normal stays physio.js's drawn cycle
(verify-physio, verify-rhythmlab-pure). *The PV loop, wired:* each beat
carries its loop, its corners where the physiologist puts them (end-diastole at
the R wave, end-systole at peak elastance) and on its own ESPVR and EDPVR; the
PV view draws a lesion's loop over the normal one, and offers the interventions
on Normal alone. *Flow, wired:* a lesion's valve flows, below the line where a
leak runs back (AR in diastole, MR in systole), and its coronary flow by
physio.js's own rule, so AR and AS starve the left coronary as the textbook
says. *The right heart, wired:* a lesion's RA, RV and PA on axes that fit, the
JVP's waves found on its own trace, and S2's split off the crossings: reversed
in severe AS, wide in MR. S1's split is left unsaid for a lesion: with no
inertia the mitral valve shuts at the end of the atrial kick in a stiff
ventricle. *Heart sounds, wired:* the Practice Lab places AS, AR, MS and MR's
sounds and murmurs on the engine's valve events (`HeartSounds.eventsFor`), so
AS is heard with P2 before A2 and its murmur running to its own late A2; the
other lesions keep physio.js's events, and the heart map still draws physio's
spans (it only names each lesion systolic or diastolic, and on the engine's
events every one is named the same). *Coronary, wired:* a lesion's coronary
glow and traces, on a scale that holds the normal heart's peak, so AR's starved
left bed reads dimmer. Curves and Conduction take no lesion.
*The constriction gap, measured:* the mitral E wave's inspiratory fall reaches
a quarter only with a pulmonary-vein-to-LA resistance of about 0.12 mmHg·s/mL
and a venous compliance of 40 to 60 mL/mmHg (with the stressed volume they hold
added back). That resistance drops 11 mmHg between the veins and the LA at a
normal output, where the real gradient is one or two, and the normal LA mean
falls to about zero and tamponade loses its pulsus. Within this structure the
gap cannot be closed by its numbers. Two mechanisms were then tried on every
preset and VALIDATION row. Inspiratory pooling in the lungs (their vessels'
compliance rising with inspiration) raises constriction's E-wave fall to 20%,
but the normal heart's to 12%, past its textbook ceiling of about 10%, so it
does not tell the two apart. A slower pulmonary venous refill (compliance 40 to
80 mL/mmHg, normal resistance, the volume added back) separates them cleanly
(constriction 11 to 15%, normal under 1%), but falls short of a quarter and
moves MS, HFpEF and tamponade out of their rows. An abdominal push on venous
return raised the normal RA on inspiration, which is wrong. One mechanism not
yet tried is a septum with its own mechanics, so that a filling RV pushes into
the LV; that is the modelling still open here.
*The 3D heart, wired (the owner asked for it on Home, 2026-11-19):*
`Circulation.heartSpec(preset)` reads a lesion off the engine's beat against
the normal one (each chamber's size, how deeply the ventricles squeeze, how far
each valve opens or fails to shut), and `Heart3D.setLesion` shows it: chamber
sizes in the beat's shader, the squeeze and the valves on each moment of the
cycle. The Home heart's menu offers the lesions. *Remodelling:* the chronic
presets now carry what they do over years: AS's concentric hypertrophy (a
stronger, somewhat stiffer LV, and a wall 1.35 times as thick, which the 3D
heart draws), MS's dilated atrium (LA 1.6 times the normal volume), HFpEF's
hypertensive LV; every VALIDATION row still holds. MR comes twice, as acute
(a stiff, small LA and its tall v wave) and as chronic (`mrchronic`: the same
leak into a large, compliant LA, a small v wave, a wedge near normal, and a
dilated LV keeping forward output up); a check holds the two apart.
*Timing (before Normal can come from the engine):* the ventricles' half-cosine
activation gave isovolumic phases about twice the textbook's and a short
ejection. They now carry the double-Hill elastance curve (Stergiopulos,
Meister and Westerhof, 1996), and three VALIDATION rows hold the normal heart's
isovolumic contraction, ejection and isovolumic relaxation to the textbook's
ranges; the old curve fails all three. The RV's curve lasts a little longer,
standing in for the pulmonary hangout the engine has no inertance to make, so
S2 splits as it should. Three lesions were refitted, not their checks: AS's
hypertrophied LV contracts later and longer and relaxes slowly (so its loop
still sits high and its S2 still reverses); AR's dilated LV is more compliant
and its leak wider (so its coronaries still starve); MS's valve and blood
volume moved so the spared LV is not left empty.
*Valves with mass (the owner chose the notch before Normal, 2026-11-20):* drawn
from the engine, the normal Wiggers diagram had no incisura, which physio.js
draws by hand. Each valve now has leaflets that open on a forward gradient and
shut on a reversed one, and the blood through it has mass (after Mynard,
Davidson, Penny and Smolich, 2012, with a closing rate that reaches shut in a
finite time). The blood runs on against the gradient (the hangout), a valve
lets a little back as it shuts, and that backflow against the aortic root's
impedance is the incisura, which a VALIDATION row now holds; it is absent in
AS and AR, as the textbook has it. Valve events are where leaflets open and
seal, no longer where two pressures cross, and the checks that assumed
massless valves were re-derived, each with its injected defect. The AV
valves' blood columns are short, or the atrial kick's flow runs on and shuts
the tricuspid before systole; a check holds M1 before T1. AR and MS were
refitted again. A beat costs about half as much again to compute.
*Normal from the engine:* the cycle panel's Normal is now the engine's normal
beat in the Wiggers, PV, Flow, Right heart and Coronary views, so a lesion is
drawn against the same heart it is measured against: the PV loop's dashed loop
and the coronary glow's scale are the engine's normal. The PV loop's
interventions are engine runs too (`Circulation.INTERVENTIONS`: a fluid load,
the systemic resistance raised, Ees raised, and the two failures as their
lesions), each held to what the textbook says it does; the resting loop's note
gives the engine's own Ees, Ea and EDV. This LV's EDPVR is steep, so preload
widens its loop less than physio.js draws. physio.js still draws until the
engine has loaded (the split build), and draws the Starling, Guyton and
conduction views, and ambient mode's loop.
Next: a septum with its own mechanics, for constriction; a
normal EDPVR as compliant as the textbook's (it would widen preload's loop,
and every preset would be fitted again). The split build lifts
src/ui/wiggers.js too (it was the shell's last kilobyte): the shell is at 278 KB
of 288.

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
(The owner lifted it for the Home heart's lesion chooser, S8, 2026-11-19.)

## 7. Which model and effort for which work

### How to switch

Start a fresh session for each item (`AGENTS.md`: one session per task), set the
model and effort before the first message, then give the item's id and its
acceptance line ("Do S1 from docs/ROADMAP.md").

| Where | Model | Effort |
| --- | --- | --- |
| Terminal CLI | `/model fable` (or `opus`, `sonnet`, `haiku`); or start with `claude --model fable` | `/effort high` (levels `low`, `medium`, `high`, `xhigh`, `max`); or start with `--effort high` |
| Model picker (`/model` with no argument) | arrows to choose, `Enter` saves it as your default, `s` keeps it to this session | left and right arrows move the effort slider |
| Cloud session (claude.ai/code, the Claude app) | `/model fable`: the cloud session takes the name as an argument rather than opening the picker | `/effort high` typed the same way; if the session will not take it, run that item from the terminal CLI |
| One turn only | | put `ultrathink` in the message |

Defaults to know: Fable, Opus, Sonnet and Haiku all start at `medium` effort.
`/effort status` shows the level in force; a change applies from your next
message. Use `s` in the picker (session only) when you try a tier for one task,
so your default does not move.

What the levels are for, in this repository:

- `low`: tidying comments and docs, lookups, reading a CI log for its FAIL lines.
- `medium`: a change with a clear specification and a suite that already covers it.
- `high`: a bug fix or check where the "see it fail" evidence matters, anything
  that touches WebKit, the scheduler, storage, the Worker or the build. The
  default for this repository's real work.
- `xhigh`: long work across many files where a mistake is silent, and
  modelling (E1's map, S3, S8).
- `max`: only to probe the hardest problem once, unattended; the returns
  diminish and it can overthink. Not a default for anything here.

On Fable: give it the whole specification at the start and leave out the
"remember to verify" reminders; it checks its own work, and the reminders cost
tokens without adding care. Keep AGENTS.md's evidence rules in force all the
same: they are the project's, not a reminder.

### Every open item

| Item | Model | Effort | Note |
| --- | --- | --- | --- |
| F4 | `sonnet` | `medium` | Only if PR #339 does not already settle it; check its head first |
| F9 | (you) | | A decision, not a task; A1 follows if you change provider or tier |
| E1 map and first two moves | `fable` | `xhigh` | The dependency map of the shell's globals; one module per PR |
| E1 each screen after | `opus` | `high` | Follow E1's map; Chromium and WebKit before and after, measured |
| E2 | `opus` | `high` | After E1's screens; needs the CSP suite's injected-handler check |
| E3 | `opus` | `medium` | Never rename a job's `name:` (branch protection) |
| E4 analysis | `opus` | `high` | Reading the CI logs for it: `haiku`, `low` |
| E5 | `sonnet` | `medium` | Needs your iPad battery readings from a real session |
| E6 design | `fable` | `xhigh` | Only if you study on two devices |
| E6 build | `opus` | `high` | |
| E7 | `sonnet` | `high` | Then an `opus` `high` session to review the cryptography |
| D1 decisions | `opus` | `high` | Works from screenshots; you choose the direction |
| D1 token moves | `sonnet` | `medium` | Mechanical once D1's decisions are made |
| D2 | `opus` | `high` | The contrast sweep; F1 is its first finding |
| D3 | `opus` | `high` | Measure in WebKit at iPad sizes |
| D4, D5 | `sonnet` | `medium` | D4 after you pick from the candidates |
| D6 | (you), then `sonnet` | `low` | Which themes to keep is yours |
| A1 | `opus` | `high` | The provider seam and a Claude adapter behind the Worker |
| A2 | `opus` | `medium` | Claim savings only from reported cached tokens |
| A3 design | `fable` | `high` | The judge and the adversarial cases |
| A3 runs | `sonnet` | `medium` | Spends your API credit; approve the budget first |
| A4, A5 | `opus` | `high` | Only after A3 shows the need |
| A6 | `opus` | `high` | Your own notes only, unless F9 allows more |
| S1 | `opus` | `high` | Changes the scheduler's contract and the oracle's scope |
| S2 | `opus` | `high` | Then a `fable` `high` session to review the mathematics |
| S3 | `fable` | `xhigh` | Fitting and validation design; an `opus` `high` session implements |
| S4, S5, S9 | `sonnet` | `medium` | |
| S6 | `opus` | `high` | |
| S7 model | `fable` | `high` | You supply the blueprint weights |
| S7 screen | `sonnet` | `medium` | |
| S8 | `fable` | `xhigh` | Validation tables per lesion; an `opus` `high` session wires the views |
| A whole-repository review like this one | `fable` | `high` | Once a quarter |
| Watching a PR, reading CI | `sonnet` | `low` | `haiku` `low` to read one log |
