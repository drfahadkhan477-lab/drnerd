#!/usr/bin/env node
/*
 * Run every behavioural suite against a build.
 *
 *   node scripts/verify.js [build/systole.html] [options]
 *
 *   --only <a,b>   run just these suites (names as in tests/verify-<name>.js)
 *   --skip <a,b>   run everything except these
 *   --bail         stop at the first failing suite
 *   --suite-timeout N  stop any one suite after N minutes (0 = never);
 *                  default 3x its recorded time, at least 20 minutes
 *   --pwa          also build, serve and test the Stage 1 split build
 *   --jobs N       run N suites at once (default 1; `auto` = cores-1, capped
 *                  at 4). The suites that measure wall-clock time or WebGL
 *                  contexts always run alone — see SERIAL below.
 *                  SYSTOLE_JOBS in the environment sets this machine's default.
 *   --engine <e>   chromium (default), webkit or firefox
 *   --tag <a,b>    run only suites with these tags: pure, browser, build, serial,
 *                  laptop (the suites no CI job runs: the quick run with your export)
 *                  (read from each suite's code — tests/_targets.js tagsOf)
 *   --report-json <file>  also write the results as JSON: suite, tags, status,
 *                  counts and time. No output text, so nothing licensed.
 *   --list         print the suites, their tags and what each covers, then exit
 *
 * WHY THIS EXISTS. There are 154 suites and roughly 6616 checks, and they
 * were only ever runnable by remembering both the file name and that Playwright
 * lives in the global node_modules. One command now runs the lot and prints a
 * table, so "is the build good?" has an answer rather than a procedure.
 *
 * They run one at a time on purpose. Most of them drive a real WebGL context —
 * the heart is a live renderer, not a fixture — and several measure timing or
 * animation. Running them concurrently would have them competing for the GPU
 * and for CPU time, and the failures that produced would be about the harness
 * rather than the app, which is the least useful kind of red.
 *
 * verify-pwa needs more than a file path — it tests the Stage 1 split build over
 * HTTP, so it has to be built, served and torn down. `--pwa` does all three.
 *
 * It is worth the trouble, and this review proved why: the split shell had
 * silently grown from 566 KB to 1.7 MB because a megabyte of base64 heart scan
 * was being inlined into it. verify-pwa asserts the shell stays under 800 KB
 * and would have caught it the day it happened — but nothing ran it, so nobody
 * knew. A check that exists and is never run is not a check.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

/* Every suite, with the claim it exists to defend. Order is roughly the order
   the features were built, so a regression reads as a story. */
const SUITES = [
  ['stage0',       'the single-file build is stable and works offline'],
  ['keys',         'the answer keys agree with the commentary that explains them'],
  ['apex',         'the tutor, its tools, and the 3D heart it sits beside'],
  ['stage2',       'FSRS-5 scheduling replaces SM-2'],
  ['stage3',       'Apex can read figures and remembers who it teaches'],
  ['polish',       'Pencil feel, the hero heart, the rhythm library'],
  ['splash',       'the pre-paint loading screen, on a throttled CPU'],
  ['braunwald',    'grounded mode answers only from your references'],
  ['leads',        'the 12-lead morphology falls out of one dipole'],
  ['physio',       'the cardiac cycle is computed, not drawn, and keeps its own clock'],
  ['theme',        'nine palettes, two axes, unthemed semantics'],
  ['home',         'the welcome bar, the progress bar, three layouts'],
  ['splash-heart', 'the photographed heart paints before the app parses'],
  ['crisp',        'every canvas backs itself at high device-pixel density'],
  ['type',         'one modular type scale and one spacing scale, still held'],
  ['references',   'the worked reference notes obey the guide, and are retrievable'],
  ['gemini',       'a free provider with real vision, wired to its own wire shape'],
  ['memory',       'Apex still knows you next time, and you can see what it kept'],
  ['assets',       'an imported chapter brings its figures, and keeps them'],
  ['chatfigs',     'the figure Apex is reasoning from is one you can see'],
  ['pearl',        'the home screen opens with something worth knowing'],
  ['worker',       'the Gemini key lives on the edge, and the site still serves'],
  ['fsrs',         'the scheduler cannot make forgetting a reward'],
  ['boundary',     'a retrieved note is material to teach from, never an instruction'],
  ['chat',         'the panel keeps what you typed, and sends a window not an archive'],
  ['store',        'the big stores live in a database, and nothing is ever in neither place'],
  ['quiznav',      'going back never re-grades a question or re-schedules a card'],
  ['homeprog',     'the progress card counts up in step with the bar it sits beside'],
  ['planscreen',   'the "I have N minutes" card plans a review session of that size, in order, and rating in it moves the schedule'],
  ['topicrunscreen', 'the Topic runs card asks three to five questions about one thing, from what you missed, each holding the words it says they share'],
  ['examdate', 'the exam date is set on the plan card, counted down from the calendar, kept across a reload, and refused when it is not a real day'],
  ['studyvisuals', 'the Study cards draw the app\'s own numbers: rings, chips, pace pill, countdown, run icons and pips, the voice dock, every icon resolving'],
  ['voicescreen', 'the Voice card reads a session aloud, scores a spoken letter as a tap would, rates it, skips and stops on command, and ends when you leave'],
  ['chapters',     'the chapter grid staggers in, and its bar fills instead of arriving drawn'],
  ['failsafe',     'render() throwing shows a real screen, never a blank or frozen one'],
  ['content',      'a question broken in a way the fellow cannot see is never shipped silently'],
  ['backup',       'a restored backup appears now, not only after the next launch'],
  ['tokens',       'the semantic colour names alias the legacy hue names, not just resemble them'],
  /* The three below need no browser and no build — they load a src/ module
     the way verify-fsrs does and assert properties over it. That is what lets
     CI run them: CI has the repository but never the licensed export, so a
     suite that needs build/systole.html cannot protect anything there. */
  ['physio-pure',  'valves open on real pressure crossings, and isovolumetric means isovolumetric'],
  ['leads-pure',   "Einthoven and Goldberger hold exactly — every lead is one dipole, projected"],
  ['zip',          'an imported archive cannot spend more memory than the device has'],
  ['calib-pure',   'the calibration arithmetic says nothing rather than something wrong'],
  ['calibrate',    'confidence is an option not a gate, and a tagged miss updates one row'],
  ['figzoom-pure', 'the point under your fingers does not move, over any number of pinches'],
  /* Written because docs/BUILD.md admitted the hole rather than closing it:
     the figure fade's error path was proven once in a scratch harness that was
     then thrown away. Hidden-by-default is the obvious way to write that
     feature and it makes every failure invisible. */
  ['figfade-pure',  'a figure that fails to load still appears, rather than being silently blank'],
  /* Written because two patch headers quoted luminances and contrast ratios to
     justify every colour they picked, and nothing checked a single one of them
     — the rule in CLAUDE.md that says guard a number or do not write it. */
  ['palette-pure',  'the contrast figures quoted in the palette patches are the figures those palettes produce'],
  /* Written because heroRhythm.js says in its own header that it is shaped
     this way — no DOM, no timers — so its rules can be called from a test
     without a browser, and then nobody wrote that test. The only suite that
     touched it drives a real build, which CI cannot do. */
  ['herorhythm-pure', 'the home strip does not repeat itself, and keeps vfib and asystole out of the wallpaper'],
  /* Written for the same reason as herorhythm-pure: pencil.js's own header
     says the width curve "can be unit-tested without a canvas or a real
     Pencil in the room". Nobody had. Only verify-polish touched it, and
     that needs a real build. */
  ['pencil-pure',   'the Pencil width curve only ever broadens with pressure or tilt, and stays in range'],
  /* The pure logic core for a new feature (the Living Diagram — an ambient
     home-screen mode composing the heart, the 12-lead and the PV loop when
     nobody has touched the screen in a while), written alongside the module
     rather than after it, the way heroRhythm.js and pencil.js went unheld
     for one build cycle each before this became the house style. */
  ['livingdiagram-pure', 'ambient mode is scoped as tightly as Focus Mode, and the view-cycling never repeats'],
  /* Pure sequencing over real activation times captured from Heart3D's own
     activationAt() — not a second, invented account of cardiac conduction
     timing. Part of the Living Diagram's family, built the same session. */
  ['conductionwave-pure', 'the conduction pathway fires in the right order, against real timing this app already computed'],
  /* Third and last of the Living Diagram family: a branching vessel
     geometry plus a flow-to-brightness curve, fed by Physio.coronaryFlow —
     already shipped, already correct — rather than a second account of
     what coronary flow does across the cycle. */
  ['coronarytree-pure', 'the branch geometry terminates and diverges correctly, and flow maps to a sane 0..1 glow'],
  /* Written the day a first build from the documented starting point died 63
     steps in: ref-images skipped its own injection when the corpus cited no
     figures, and assets anchors on what it skipped. */
  ['refimg-pure',    'a reference corpus with no figures in it still builds, and still renders imported ones'],
  ['figzoom',      'a figure can be examined, and still has four ways out'],
  ['focus',        'focus mode reclaims the bar’s space, and never the progress or the confidence row'],
  ['engine',       'the browser engine is a flag, not thirty-four hardcoded copies of one'],
  ['schema',       'an older copy of the app cannot silently eat a newer one’s saved data'],
  ['stats',        'the check counts in the README, BUILD.md and CI are the counts the tests produced'],
  ['selftest',     'the on-device self-test reports honestly, and can actually fail'],
  ['layout',       'every screen fits, at every frame a real device produces'],
  /* Build-side, not app-side. It drives the figure review sheet rather than
     the app, because a crop decided by a person is only worth an hour of
     tapping if the box it records is the box that gets applied. It needs
     python3 with Pillow, the same dependency tools/figure-review.py has. */
  ['figreview',    'the review sheet records the box in original pixels, not preview pixels'],
  /* Also build-side, and pure Node — no browser, no target, no licensed text.
     It guards tools/figure-audit.js, whose whole value is its false-positive
     rate: an auditor that flags a third of the bank as referring to missing
     pictures is worse than none, so the fixtures that must stay QUIET are the
     load-bearing half of that suite. */
  ['figaudit',     'a stem that points at a picture is told apart from one that only sounds like it'],
  /* Guards tests/_render.js against synthetic fixtures rather than the app: the
     race is a property of startViewTransition, so isolating it proves more than
     burying it under 42 MB of question bank, and it runs in seconds. */
  ['render',       'a suite that reads after a screen change reads the new screen, not the old one'],
  /* The permissive half of this one matters more than the restrictive half:
     the policy is shipped to an app that cannot be run here, so what must be
     proven first is that inline scripts, inline handlers, inline styles and
     data: images all still work under it. */
  ['csp',          'the policy contains an injection without breaking anything the app does'],
  /* Guards tools/figure-probe.js, whose whole value is the DISTINCTION it
     draws: absent, undecoded and unboxed are three different bugs with three
     different fixes, and a probe that confused them would send an
     investigation somewhere expensive and wrong. */
  ['figprobe',     'a figure that never rendered is told apart from one that rendered invisibly'],
  /* The one suite whose subject is the repository rather than the app: 638
     questions and 408 figures belonging to the ACC must not reach a public
     remote, and .gitignore stops being a boundary the moment somebody types
     `git add -f`. */
  ['leakguard',    'the licensed question bank cannot be committed, however it is renamed'],
  /* Its sibling for Claude Code sessions: .claude/hooks/guard.js refuses a
     read of the licensed paths and a commit leak-guard would refuse, before
     the tool runs, and lets a suite run on build/ through. */
  ['claude-guard', 'a Claude Code session cannot read the licensed export, or commit what leak-guard refuses'],
  /* The subagents in .claude/agents: each well formed, on a cheap model, and
     granted no tool that edits a file. */
  ['claude-agents', 'the Claude Code subagents are cheap, explicit about their tools, and cannot edit files'],
  /* The skills in .claude/skills: each where Claude Code looks for it, granting
     no tools, and citing only files, scripts, sections and agents that exist. */
  ['claude-skills', 'the Claude Code skills are found, widen no permissions, and cite only what exists'],
  /* tools/study-file-check.js, which the memorizer-study-file skill trusts:
     it runs Memorizer's own import path and reports what the app would drop,
     refuse or flag, without printing the file's text. */
  ['study-file-check', 'a study file is checked by the app\u2019s own import code before it is handed over'],
  /* Step 1 of retiring the patch chain: the chain's output cuts into the app
     and its payloads losslessly, and the app carries none of what was cut. */
  ['app-slots-pure', 'the built file cuts into the app and its payloads byte for byte, and the app carries none of the bank'],
  /* Step 2: the frozen shell's slots filled from where the chain gets them,
     ALL_Q held to keys-patch and flags-patch run as the chain runs them. */
  ['assemble-pure', 'the app assembles from app/systole.html, the export and the repository, stamped once'],
  /* Step 3: lines of the shell moved into files under app/. The committed
     app/ is audited here too, which needs no export. */
  ['carve-pure', 'a piece carved out of the shell loses nothing, and the committed app/ is whole'],
  /* The invented export CI builds the app from: in the app's shape, in the
     sizes the browser suites read, and marked so it is never recorded. */
  ['synthetic-pure', 'the synthetic export builds the real app, and is marked so its run is never recorded'],
  /* The Lab: heart sounds synthesised on physio's valve events, held by
     measuring the audio, not by reading the spec back. */
  ['lab-pure', 'each heart sound and murmur is on the valve events physio measures, with the shape and pitch of its lesion, and the heart map agrees with the audio on when it is heard'],
  /* The study planner and the readiness forecast, on real FSRS cards. */
  ['plan-pure', 'the study plan fits the time, puts the most forgotten first and the weak chapters next, and never throws on damaged data'],
  /* Topic runs: questions about the same thing, grouped by their distinctive words. */
  ['topicrun-pure', 'questions on one topic are gathered into a run by their distinctive words, never across chapters, never as a pair'],
  /* Voice mode's logic: what is read, what is heard, what happens next. */
  ['voice-pure', 'a spoken answer is understood as speech recognition delivers it, a doubtful one is asked again, and the session ends with a summary'],
  ['icons-pure', 'every icon the app names is drawn by the one sprite in the page, and no symbol is defined anywhere else'],
  /* The Lab's pressure tracings and the drill engine every Lab exercise shares. */
  ['drills-pure', 'each pressure tracing and ECG strip shows what it is named for, measured from the finished waveform; the drill offers what is due and the look-alikes; what the Lab remembers survives bad storage'],
  /* Guards the release gate's one job: never printing CERTIFIED over something
     it did not check. The permissive direction is the dangerous one here, so
     the checks are mostly about what it REFUSES to claim. */
  ['release',      'the release gate never claims more than it measured'],
  /* The rules tests/verify-content.js applies to the REAL bank, proven here
     against synthetic ones — so a checker for the licensed export is testable
     without the licensed export, which is the only way it gets tested anywhere
     but the one laptop that has it. */
  ['contentrules', 'a structurally broken question is caught, and a sound one is left alone'],
  /* Two core modules that had no direct test at all, each now carrying
     something worth proving without a forty-minute build: where a memory came
     from, and the one channel a fence cannot reach. */
  ['memory-pure',  'an inference is not stored, or read back, as something the fellow said'],
  ['vision-pure',  'text inside a figure is named as data, never as an instruction'],
  /* Two more core modules that had no direct test. Both turned out to be
     carrying a real failure: a torn store took the whole Apex turn down, and
     an empty note list reclaimed every imported figure. */
  ['profile-pure', 'a torn store costs the profile line, never the turn'],
  ['refassets-pure', 'imported figures are reclaimed only against notes that actually loaded'],
  /* rhythms-extra's header has invited a unit test since it was written — it
     duplicates the beat model rather than importing it for exactly that. The
     drift it guards is silent in the worst way for a study aid: a rhythm added
     to the picker table without its generator draws a NORMAL beat under a
     pathology's name and rate. */
  ['rhythms-pure', 'every arrhythmia the picker offers has something that draws it'],
  /* The suite runs on Chromium; the app runs on an iPad. A regex lookbehind is
     a parse-time SyntaxError below Safari 16.4 — a dead <script> block, not a
     caught exception — and this app lost most of itself to one once, with CI
     green throughout. verify-apex asserts it against the built bundle, which
     is broader and needs a build; this is the same rule on every push, over
     the files whose every character ships verbatim. */
  ['ipad-pure',    'nothing in src/ uses syntax the target device cannot parse'],
  /* The four keys that hold a fellow's work — annotations, notes, chat, the
     review log — and the only thing exercising them needed a build, a browser
     and the licensed export. migrate() resolved "both copies exist" by
     asserting the database was "the newer of the two by definition"; set()'s
     own localStorage fallback reaches the case where it is not, and the newer
     copy was being deleted. */
  ['store-pure',   'the newer copy survives, and a refused write is not lost'],
  /* The runner's own diagnosis of a dead suite, which is the only thing said
     about one on a machine the reader does not have. Its first version scanned
     the output from the wrong end and reported a check's own wrapped detail as
     the cause of a crash. */
  ['cause-pure',   'a dead suite is diagnosed by what killed it, not by what it last printed'],
  /* The one place a model's words become the page's HTML. md() escapes before
     it transforms, which is right and was asserted nowhere — and the escaper
     it leans on is not in this repository at all. */
  ['md-pure',      'nothing a model says can become something the page runs'],
  /* The 12-lead's paper. verify-leads covers the morphology and reaches ECG12
     in three of its checks; what a fellow MEASURES on — a millimetre, a big
     square, 0.04 s — had nothing on it, and needed a browser to reach. */
  ['ecg12-pure',   'a big square is 0.2 s, on every canvas the panel is given'],
  /* The only diagnostic a fellow standing in front of a broken deployment
     has. It said one sentence for every failure and that sentence was right
     for one of them; the wrong one cost an evening. */
  ['loader-pure',  'a splash that cannot load the bank says which failure it was'],
  /* The split build is assembled from two inputs produced by two different
     commands, and until now nothing checked they were the same build. A
     rebuilt single file split against a stale content/ gave a dist/ whose
     shell was new, whose bank was old, and whose three build stamps all
     agreed with each other — so every existing guard passed over it. */
  ['provenance-pure', 'a split build cannot be half of one build and half of another'],
  /* The five pairings a deploy can leave behind. One of them — a new shell
     against an app.js too old to carry a stamp — walked straight through the
     check meant to catch it, because the guard against a ReferenceError had
     become a guard against the test. */
  ['swupdate-pure', 'a deploy landing under a running app leaves a pair that is noticed'],
  /* Two facts that were true when an audit looked and had nothing holding
     them that way: four native dialogs, all deliberate, and no icon-only
     button without an accessible name. Written down where they fail. */
  ['ui-pure',      'no native dialog arrives unmeant, and an icon is not a name'],
  ['refscheck-pure','the corpus checker holds every floor it claims, and reads before reporting'],
  ['echo-pure',    'the echo tables point at what exists, and the arithmetic is the arithmetic'],
  ['echoui-pure',  'Echo Studio computes only what was measured, and restates no cutoff'],
  /* The three above stop where strings become a document. This one starts
     there: it runs echo-patch over a scaffold and drives the result, so the
     glue, the delegated listeners and the caret are held rather than argued
     about in a comment. It needs no build — see its header for what that
     buys and what it costs. */
  ['echo',         'Echo Studio routes, delegates and keeps the caret where it was'],
  /* Needs no build: the repository's own physio, coronaryTree and wiggers in
     a real browser, measured for the physiology the view is there to show. */
  ['coronaryview', 'the Coronary view draws the left bed collapsing in systole, on one scale'],
  /* Needs no build: the shipped ambient-patch over a scaffold, with the
     repository's own Heart3D, ECG12, Wiggers and LivingDiagram. */
  ['ambient',      'the Living Diagram waits, stays off the quiz, wakes without a click-through, frees its GL'],
  /* Search your notes: the ranking, quoting and markup in pure Node (with the
     proof that its four anchors are echo's own output), then the patched
     screen driven in a browser over a scaffold, the way echo is. */
  ['notesearch-pure','a note titled with the words is found first, quoted and escaped'],
  ['heartbake-pure', 'the heart is loaded from a mesh baked at build time, value for value, and any other copy is refused'],
  ['refsmerge-pure', 'a reference unit adds only sections that are new and high yield, and what it writes splits back into notes'],
  ['phrase-pure', 'a note holding the query\'s words in the query\'s order outranks one holding them scattered; questions, one-word queries and stubs rank as before'],
  ['olderacc-pure', 'an older ACC bank\'s questions parse in each layout, keep their answer or are left out, skip what the bank has, and print no word of it'],
  ['extract-pure', 'extraction refuses an id that could leave figures/, bytes that are not the image their mime claims, and damaged base64 — and a refusal leaves the last good content/ untouched'],
  ['bankpack-pure', 'the code-only deploy\'s package: packed, read back through the page\'s own reader and checker, and every bad package refused, naming why'],
  ['bankstore', 'the code-only deploy in a browser: import screen with no bank and no request to content/, a refused package changes nothing, a good one launches the app, a replacement is atomic, a normal build unchanged'],
  ['devtools-pure', 'each build in its own workspace, suite tags read from the code, a JSON report with no output text, doctor, and a clean that cannot reach the export'],
  ['testpublic-pure', '`npm test` runs every suite CI runs, pure and browser, from the workflow\'s own list — a failure, a missing file or a missing browser fails it, and a pure-only run says what it left out'],
  /* scripts/ci-changes.js: a pull request skips a browser job only when every
     changed file is known not to reach it, and anything doubtful runs both. */
  ['cichanges-pure', 'a pull request skips a browser job only when none of its files can reach it, and a failed decision runs both'],
  ['record-pure',    'the counts record in two halves: each written only from a run where every one of its suites ran and passed, the other half kept'],
  ['suitetime-pure', 'a suite that runs far past its recorded time is stopped and named with the section it was in, and every section is timed'],
  ['glass', 'neutral controls turn to glass, colours that mean something do not, and High contrast and reduced motion are left alone'],
  ['refimgdefer-pure', 'the note figures load after the home screen has drawn, one unit at a time, the pearl\'s first'],
  ['stripcomments-pure', 'the split build ships src/\'s modules without their comments, and every one still compiles and behaves'],
  ['notesearch',   'the notes search opens, keeps the caret, and opens a note with its figures'],
  /* Retrieval quality as a number rather than an impression. It exists because
     the adoption plan gated a MiniSearch swap on "measurably better recall"
     and nothing could measure either side. */
  ['retrieval',    'the library still finds the right note, and prose queries stay its best case'],
  /* The scheduler against an implementation that is not ours. Its 46 checks
     were all written by the hand that wrote the code, which catches typos and
     regressions but never a formula transcribed wrongly from the paper. */
  ['oracle',       'our FSRS agrees with ts-fsrs on our own weights, everywhere but the one cap we chose'],
  /* The two hearts the app shows are now one photograph, and the panel that
     reads the long answers can take the whole page. */
  ['heroart',      'the home hero beats on the rhythm, and the home screen spends no WebGL'],
  ['apexpage',     'Apex can take the whole page, and a numbered list stays numbered'],
  ['resume',       'a chapter you left is the chapter you come back to'],
  ['figsharp',     'no figure is drawn wider than the pixels it has'],
  ['heartreuse',   'navigating the app does not spend WebGL contexts'],
  ['flushguard',   'a reply can be stopped, and the last chunk is painted however the stream ends'],
  /* Memorizer — a second, standalone app in memorizer/: upload a PDF (or
     photos, or pasted notes), it is split into sections, and each is taught
     — key points, numbers, mnemonics, analogies — then drilled with
     multiple-choice questions; a final exam closes the unit, and every miss
     becomes an FSRS card. It carries no licensed
     content, so none of these needs a build: the -pure ones run in CI's
     logic job, and the two browser suites in its memorizer-browser job. */
  ['memorizer-chunk-pure',   'every word of the PDF is taught once, in sections of a teachable size, headings kept with their body'],
  ['memorizer-prompts-pure', 'the model is held to your PDF, only the section being studied goes out, and a bad reply is never a pass'],
  ['memorizer-session-pure', 'no phase of the protocol is skipped, and every miss becomes exactly one card'],
  ['memorizer-coach-pure',   'the built-in coach needs no key, invents nothing, and asks fair multiple-choice questions'],
  ['memorizer-appearance-pure', 'Daylight by day, Clinical at night, Paper and Neuron, and Systole\u2019s Contrast, each readable at every contrast and brightness, on glass over the aurora as well as solid'],
  ['memorizer-home-pure',    'the home screen\u2019s progress counts what happened, its brain lights a neuron per section drilled, and its pearl is your PDF\u2019s own sentence'],
  ['memorizer-book-pure',   'a whole textbook: its parts in order, its pages straight through, its chapters found three ways'],
  ['memorizer-ask-pure',    'asking your book: its own sentences with their pages, from the right section, or nothing found'],
  ['memorizer-ground-pure', 'the on-device AI says nothing the book does not: no new number or name, cited, answers found in the section'],
  ['memorizer-vec-pure',    'search by meaning: similarity, a measured floor, and the merge with search by words'],
  ['memorizer-sheet-pure',  'a lesson laid out to be remembered: points under clinical headings, numbers as tiles, nothing twice'],
  ['memorizer-figure-pure', 'figures made from the book: a study card and a comparison chart, every word the lesson\u2019s, escaped and wrapped'],
  ['memorizer-agent-pure',  'the Coach as an agent: each tool reached, its topic, follow-ups remembered, a model\u2019s plan used only when it names a real tool'],
  ['memorizer-study-pure',  'studying beyond the drill: recall and figure cards from the book, checks days apart, timed practice, an exam plan, teach-back, corrections, notes, progress'],
  ['memorizer-provenance-pure', 'where a unit came from: a real SHA-256 of its bytes, a duplicate recognised, and an import report that counts what happened'],
  ['memorizer-pack-pure',   'a study pack written with Claude: the prompt carries the chapter, and the reply is held to the book \u2014 numbers, pages, names and quotes \u2014 before any of it is used'],
  ['memorizer-studyimport-pure', 'a study file, markdown or a saved HTML page: every question read, an unmarked answer never guessed, and its points and questions held to the unit\u2019s own text'],
  ['memorizer',              'a real PDF becomes its sections, and a unit goes through lesson, multiple-choice drill, exam and review in a browser'],
  ['memorizer-misses-pure',  'what the misses say: the pairs taken for one another, and each missed item\u2019s attempts in order, with a lapse named'],
  ['memorizer-offline',       'Prepare for offline, with the app\u2019s service worker: nothing called ready before, every pinned reader kept after, and served with the network cut'],
  ['memorizer-spec-pure',    'one study format for both Claude prompts: spec.js\u2019s rules word for word in each, the counts the checker enforces, the prompt\u2019s own example read and passed, the doc the app\u2019s prompt'],
  ['memorizer-recall-pure',  'explain it first: on a later day the lesson waits for what you remember, marked point by point, the gaps taught first'],
  ['memorizer-layout-pure',  'the review\u2019s layout rules: a lesson\u2019s first five points, a unit\u2019s one next step, and when to remind about a backup'],
  ['memorizer-studyimport',  'a saved HTML page read in the browser, and the Import Study dialog driven: right options and answers, a real modal, too large refused, no half-imported unit'],
  ['memorizer-data',         'your data and what the page may do: a backup holds units, packs and progress and restores into an empty browser, a bad file is refused, and the browser refuses any host but the app\u2019s'],
  ['memorizer-hardening',    'a double tap lands once, a failed save is said and stores nothing half-way, a late reply is dropped, and a dialog holds focus'],
  ['lab',                    'the Lab, built and driven: the audio played is the item asked, nothing names the answer early, progress is real, and the heart map is drawn from the map'],
];

/* ── suites registered since the last full green run ──────────────────────────
   tests/test-stats.json records what a full green run measured, and nothing
   else may write it. A suite added between two such runs is therefore
   registered above and absent from the record, which is a real and temporary
   state rather than a defect — but it is indistinguishable, to a checker, from
   the defect verify-stats exists to catch: a suite registered and then quietly
   never run, showing up only as a total that is mysteriously too low.

   So the difference is DECLARED here instead of being inferred. Naming a suite
   in this list says "measured counts are pending, on purpose"; leaving it out
   says "this should already be in the record". verify-stats asserts both
   directions, and the second one is what keeps this list from rotting: an
   entry that IS in the record fails, so a name cannot be parked here to
   silence anything — the next full run forces its removal.

   Nothing is fabricated to clear it. Writing a measured count here by hand
   would mean also inventing the --pwa figure and the CI subset total, which is
   exactly the hand-maintained arithmetic that made verify-stats necessary.

   EMPTY, which is the state it should normally be in — and every time it
   has been emptied, it was a full green run that did it rather than anybody
   deciding it looked untidy. It held fourteen names for weeks, every suite
   added while the only machine that could run the full thing was not being
   run; the first full green run wrote all fourteen at once. It then filled
   again with eleven — focus, figfade-pure, palette-pure, herorhythm-pure,
   refimg-pure, shellanchor-pure, pencil-pure, refscheck-pure, echo-pure,
   echoui-pure and echoanchor-pure — which the green run of 2026-09-22
   measured. If it fills to fourteen again, that is the same gap reopening.

   Add a name when you register a suite; empty it AFTER the run that measures
   it, never before.

   Emptied a third time by the green run of 2026-09-22 on 28f4e5c, which
   measured the four that had been waiting — livingdiagram-pure,
   conductionwave-pure and coronarytree-pure from the Conduction Wave branch,
   and echo.

   Emptied a fourth time by the green run of 2026-09-25 on the owner's Windows
   laptop, which measured the twenty-one that had been waiting: notesearch-pure,
   notesearch, coronaryview, ambient, and the seventeen Memorizer suites. That
   run predates memorizer-pack-pure, which master registered meanwhile.

   Emptied a fifth time by the full green run with --pwa on the owner's
   Windows laptop at 9f57fa2 (recorded in 6c3bd7a: 4951 checks across 114
   suites, 133 on the split build), which measured the three that had been
   waiting: memorizer-pack-pure, heartbake-pure and stripcomments-pure.

   Emptied a sixth time by the full green run with --pwa on the owner's
   Windows laptop at 43b53db (5088 checks across 118 suites, 133 on the split
   build), which measured the four that had been waiting: refimgdefer-pure,
   glass, refsmerge-pure and phrase-pure.

   Emptied a seventh time by the full green run with --pwa on the owner's
   Windows laptop at 491e183 with the older ACC bank merged (681 questions,
   173 figures; 5229 checks across 119 suites, 133 on the split build), which
   measured the one that had been waiting: olderacc-pure.

   Emptied an eighth time by the full green run with --pwa on the owner's
   laptop at 573e571 (5387 checks across 123 suites, 134 on the split build),
   which measured the four that had been waiting: extract-pure, bankpack-pure,
   bankstore and testpublic-pure.

   Emptied a ninth time by the full green run with --pwa on the owner's
   laptop at 9a647f9 (5432 checks across 124 suites, 134 on the split build),
   which measured the one that had been waiting: devtools-pure (38 checks).

   Emptied a tenth time by the full green Chromium run on the owner's laptop at
   654315d (6447 checks across 147 suites), which measured the 23 that had been
   waiting. That run's --pwa step stopped at the stats suite, which found this
   prose stale against the record the same run had just written, so the
   split-build figure (134) is carried over from the ninth emptying and was
   not re-measured.

   Emptied an eleventh time by the Systole-only green Chromium run on the
   owner's laptop at 7252e87 (5970 checks across 149 suites, the Memorizer
   half kept from the tenth emptying), which measured the seven that had been
   waiting: topicrunscreen, voicescreen, examdate, studyvisuals, icons-pure,
   cichanges-pure and record-pure. That run's --pwa step did not start
   (build-pwa found content/ extracted from a different build), so the
   split-build figure (134) is carried over again and was not re-measured.

   Suites registered after that run are the pending ones now, and the record
   does not hold them yet: suitetime-pure. */
const PENDING_RECORD = ['suitetime-pure'];

/* ── suites deleted since their half of the record was last written ─────────
   The mirror of PENDING_RECORD. A suite removed from the registry is still in
   tests/test-stats.json until the next green run of its half rewrites it
   (scripts/record.js drops a name that is no longer registered), and until
   then verify-stats would read it as the record holding something that is no
   longer a suite. Naming it here says that is on purpose. Checked in both
   directions like PENDING_RECORD: a name here must still be in the record and
   must not be registered, so the next write forces it out of this list. */
/* echoanchor-pure and shellanchor-pure checked that patch steps' anchors
   survived the chain to the step that used them; deleted with the chain. */
const RETIRED_RECORD = ['shellanchor-pure', 'echoanchor-pure'];

/* ── the suites that must have the machine to themselves ──────────────────────
   --jobs runs suites concurrently, which is free for a suite that asserts on
   what is on screen and dishonest for one that asserts on how long something
   took. Four browsers competing for four cores make every wall-clock number
   larger and every animation advance smaller; a suite measuring those would
   fail for a reason that has nothing to do with the build.

   So these run alone, with the pool drained first, whatever --jobs says. Each
   is here because of a specific assertion, named — not because it felt risky:

     stage0       ok('launches without stalling', launchMs < 5000)
     physio       the cursor's advance over 600ms of wall clock, at 68 bpm
     homeprog     the progress ring's rAF timestamps against performance.now()
     splash       fixed waits for the splash sequence to have finished
     splash-heart the same, for the heart's own animation
     heroart      twenty mount/destroy cycles against the 16-context cap
     heartreuse   twenty navigations against the same cap

   heroart and heartreuse are here for a resource the driver shares between
   processes rather than for a clock.

   AND THREE MORE THE OWNER'S LAPTOP FOUND, which this machine did not:

     home         viewport sweeps with a five-identical-frames settle
     figsharp     waits for 55 ref figures to DECODE, 20s cap
     chatfigs     the same, for the figures under an Apex answer

   All three passed on that machine run serially and failed under --jobs 3 —
   home "did not report" after 170s, figsharp reported "0 of 55 placed" with
   every image still undecoded. They are not measuring a clock; they wait on
   work the browser does off the main thread, and three browsers sharing the
   cores starve exactly that. The tell was the wall time: that run went 23.6 min
   serial to 24.2 min at --jobs 3, so the parallelism bought nothing there and
   cost three suites to do it.

   Everything else in the registry asserts on content, geometry or arithmetic,
   and was verified to give the same result under --jobs 3 as it does alone —
   that comparison is the evidence, not this list. */
const SERIAL = new Set(['stage0', 'physio', 'homeprog', 'splash', 'splash-heart',
                        'heroart', 'heartreuse', 'home', 'figsharp', 'chatfigs']);

const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const opt = (n, fb) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] ? argv[i + 1] : fb; };
const list = v => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : []);

const { tagsOf } = require(path.join(ROOT, 'tests', '_targets.js'));
const { mergeRecord } = require(path.join(ROOT, 'scripts', 'record.js'));
const { limitFor, sectionClock, slowest, watch, spawnLimited, fmtMin } = require(path.join(ROOT, 'scripts', 'suitetime.js'));
/* `laptop`: a suite no CI job runs, so only a machine with the export ever
   does. Everything else GitHub runs on every pull request, on the synthetic
   bank or with no build at all, which makes `--tag laptop` the short routine
   run and the full registry the occasional one that writes the record. */
const CI_SUITES = require(path.join(ROOT, 'scripts', 'test-public.js'))
  .ciSuites(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'verify.yml'), 'utf8'));
const tagsFor = n => tagsOf(n).concat(SERIAL.has(n) ? ['serial'] : [], CI_SUITES.has(n) ? [] : ['laptop']);
if (flag('--list')) {
  console.log('\nSuites, their tags, and what each defends:\n');
  for (const [name, claim] of SUITES) console.log(`  ${name.padEnd(14)} ${('[' + tagsFor(name).join(',') + ']').padEnd(18)} ${claim}`);
  console.log(`\n  pwa            the Stage 1 split build over HTTP — needs a server, so:`);
  console.log(`                 node scripts/verify.js --pwa\n`);
  process.exit(0);
}

const VALUED = ['--only', '--skip', '--engine', '--tag', '--report-json', '--suite-timeout'];
const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUED.includes(argv[i - 1]));
/* A PATH OR A URL. Every suite already takes either — `file://` is just how a
   path reaches them — and the split build can only be driven over HTTP,
   because a fetch() will not cross file:// origins. Until now this file
   resolved the argument as a path unconditionally, so the only way to run the
   registry against a served build was --pwa, which runs one suite.

   That mattered the first time WebKit was pointed at the single file: the
   44 MB of inline base64 takes WebKitGTK about 150 seconds to parse, so every
   suite paid a 150s floor and a 5-second launch budget measured the container
   rather than the app. The same suites against dist/ over HTTP load a 731 KB
   shell — which is also what actually goes on the iPad. */
const rawTarget = positional[0] || path.join(ROOT, 'build', 'systole.html');
const TARGET_IS_URL = /^https?:\/\//.test(rawTarget);
const TARGET = TARGET_IS_URL ? rawTarget : path.resolve(rawTarget);
const shortTarget = TARGET_IS_URL ? TARGET : path.relative(process.cwd(), TARGET);

/* A build is needed only by suites that read one, and by --pwa. Checked once
   the selection is known (below): checked here, it refused `--tag pure` on a
   clean checkout, where the export and so the build cannot exist (found by
   review). */
function requireBuild() {
  if (TARGET_IS_URL || fs.existsSync(TARGET)) return;
  console.error(`\nNo build at ${TARGET}\n\n  Build one first:  npm run build -- path/to/your-export.html\n  or run only the suites that need none:  --tag pure\n`);
  process.exit(1);
}
/* --pwa builds dist/ from a standalone file and serves it. Handed a URL it has
   nothing to build FROM, and would be verifying whatever the URL already
   serves while claiming to have built it. */
if (TARGET_IS_URL && flag('--pwa')) {
  console.error('\n  --pwa builds the split build from a standalone file; it has nothing to do with a URL target.\n');
  process.exit(1);
}

const only = list(opt('--only')), skip = list(opt('--skip'));
/* --suite-timeout N: minutes any one suite may run before it is stopped; 0 for
   no limit. Without it each suite gets three times its recorded time, never
   under 20 minutes (scripts/suitetime.js). */
const SUITE_TIMEOUT = opt('--suite-timeout');
try { limitFor(undefined, SUITE_TIMEOUT); } catch (e) { console.error(e.message); process.exit(2); }
const TAGS = ['pure', 'browser', 'build', 'serial', 'laptop'];
const wantTags = list(opt('--tag'));
for (const t of wantTags) if (!TAGS.includes(t)) {
  console.error(`\n  --tag ${JSON.stringify(t)} is not a tag. Use one of: ${TAGS.join(', ')}.\n`);
  process.exit(1);
}
const REPORT_JSON = opt('--report-json', null);
if (flag('--report-json') && !REPORT_JSON) { console.error('\n  --report-json needs a file to write.\n'); process.exit(1); }

/* The engine, resolved once here and handed to every suite through the
   environment. Validated before a single browser starts: a typo discovered on
   suite thirty-four, forty minutes in, is a worse way to learn you meant
   "webkit" than a refusal on the first line. */
const { ENGINES, DEFAULT_ENGINE } = require(path.join(ROOT, 'tests', '_engine.js'));
/* SYSTOLE_ENGINE IS HONOURED HERE TOO, AND IT WAS NOT.
   tests/_engine.js reads the environment, so `SYSTOLE_ENGINE=webkit node
   tests/verify-layout.js …` runs one suite on WebKit exactly as documented.
   This file read only --engine, and then handed children an explicit
   SYSTOLE_ENGINE of its own — so the same variable set in the same shell was
   silently overwritten with chromium, and `SYSTOLE_ENGINE=webkit node
   scripts/verify.js` produced a full green chromium run that looked like a
   WebKit one. A run that reports the wrong browser is worse than one that
   refuses, because nobody re-reads a green summary.

   The flag still wins when both are given: an argument is a decision made for
   this run, an environment variable is a default set for the shell. */
const ENGINE = (opt('--engine', process.env.SYSTOLE_ENGINE || DEFAULT_ENGINE) || '').trim().toLowerCase();
if (!ENGINES.includes(ENGINE)) {
  console.error(`\n  --engine ${JSON.stringify(ENGINE)} is not an engine. Use one of: ${ENGINES.join(', ')}.\n`);
  process.exit(1);
}
/* AND THAT THE BROWSER IS ACTUALLY THERE. Naming an engine the harness accepts
   is not the same as having it installed: firefox is in ENGINES and is not
   provisioned in every environment, and without this the run spawns
   fifty-four suites that each launch, each fail with
   "Executable doesn't exist at .../firefox-1495/firefox/firefox", and take
   fifteen minutes to say one thing once. Checked by path rather than by
   launching, so it costs nothing on the ordinary run.
   AND ONLY WHEN A CHOSEN SUITE NEEDS ONE. It ran before --tag and --only
   were applied, so `--tag pure` on a machine with playwright but no browser
   downloaded refused to run suites that launch nothing (found by review on
   the PR that added --tag). Called below, once the selection is known. */
function requireBrowser() {
  /* Resolved where the suites will resolve it: this checkout's node_modules,
     then NODE_PATH with the global root added below. It used to try only a
     plain require() and return quietly when that threw — so with no
     playwright at all (CI's logic job never runs npm ci) every browser suite
     was spawned to die on the same missing module, the case this check
     exists to stop. */
  let pw = null;
  try { pw = require(require.resolve('playwright', { paths: [ROOT].concat(nodePath.split(path.delimiter).filter(Boolean)) })); }
  catch (_) {
    console.error(`\n  The chosen suites need a browser, and playwright is not installed.`);
    console.error(`  install    npm ci && npx playwright install ${ENGINE}`);
    console.error(`  or         node scripts/verify.js … --tag pure   (the suites that need no browser)\n`);
    process.exit(1);
  }
  let exe = null;
  try { exe = pw[ENGINE].executablePath(); } catch (_) { return; }
  if (exe && !fs.existsSync(exe)) {
    console.error(`\n  --engine ${ENGINE}: playwright has no browser installed for it.`);
    console.error(`  expected   ${exe}`);
    console.error(`  install    npx playwright install ${ENGINE}\n`);
    process.exit(1);
  }
}
/* WHICH SUITES CAN BE POINTED AT A URL. The first version of this asked the
   wrong question: it looked for the `^https?:` guard and called that the
   answer. Three suites have that guard AND read the target off disk as text
   afterwards — verify-apex threw ENOENT, and verify-splash-heart swallowed the
   read and finished GREEN with eight checks where it has fourteen. The rule
   and the reasoning now live in tests/_targets.js, with tests/verify-engine.js
   holding them to the suites whose behaviour was actually observed. */
const { classify } = require(path.join(ROOT, 'tests', '_targets.js'));

const urlIncapable = [];
const chosen = SUITES
  .filter(([n]) => (!only.length || only.includes(n)) && !skip.includes(n))
  .filter(([n]) => !wantTags.length || tagsFor(n).some(t => wantTags.includes(t)))
  .filter(([n]) => {
    const f = path.join(ROOT, 'tests', `verify-${n}.js`);
    if (fs.existsSync(f)) return true;
    console.error(`  (skipping ${n}: tests/verify-${n}.js not found)`);
    return false;
  })
  .filter(([n]) => {
    if (!TARGET_IS_URL) return true;
    const verdict = classify(n);
    if (verdict.capable) return true;
    urlIncapable.push(`${n} (${verdict.reason})`);
    return false;
  });

if (!chosen.length) { console.error('No suites selected.'); process.exit(1); }

/* Playwright is installed globally in this environment; the suites require it
   by bare name, so NODE_PATH has to point at the global root. Resolved once
   here rather than asked of every caller's shell. */
let nodePath = process.env.NODE_PATH || '';
try {
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  if (globalRoot && !nodePath.split(path.delimiter).includes(globalRoot)) {
    nodePath = nodePath ? `${nodePath}${path.delimiter}${globalRoot}` : globalRoot;
  }
} catch (_) { /* a local node_modules will do just as well */ }
/* The build first: with neither, "build one first" is the step that comes
   first, and it is the answer on a runner with no playwright at all. */
if (flag('--pwa') || chosen.some(([n]) => tagsFor(n).includes('build'))) requireBuild();
/* --pwa launches one too (verify-pwa), whatever the selection. */
if (flag('--pwa') || chosen.some(([n]) => tagsFor(n).includes('browser'))) requireBrowser();

/* ── how many at once ─────────────────────────────────────────────────────────
   One, unless asked otherwise: the default has to stay the arrangement every
   recorded number was produced under, so that turning this on is a decision
   somebody makes rather than something that happens to them. `auto` leaves a
   core for the parent and for whatever else is on the machine — four browsers
   on four cores is how you turn a 5s launch budget into a 6s launch. */
const CORES = require('os').cpus().length || 1;
/* SYSTOLE_JOBS is the same decision made once per machine instead of once per
   command — the checked-in default is still 1, and --jobs still wins. A value
   that is not a count is refused rather than read as 1: a machine set up to
   run fast that silently runs serially looks exactly like one that was never
   set up. Refused only when it would have been USED: it is a default, so a
   stale one must not stop a run that says --jobs for itself (found by
   review). */
const envJobs = (process.env.SYSTOLE_JOBS || '').trim();
const envJobsOk = envJobs === 'auto' || /^[1-9]\d*$/.test(envJobs);
if (envJobs && !envJobsOk && !flag('--jobs')) {
  console.error(`\n  SYSTOLE_JOBS ${JSON.stringify(envJobs)} is not a number of jobs. Use a count, or auto.\n`);
  process.exit(1);
}
const jobsArg = opt('--jobs', envJobsOk ? envJobs : '1');
const JOBS = jobsArg === 'auto' ? Math.max(1, Math.min(4, CORES - 1))
                                : Math.max(1, parseInt(jobsArg, 10) || 1);
/* SAID OUT LOUD, NOT CLAMPED. Asking for more workers than the machine has
   cores does not fail, it just makes every suite slower and starves the ones
   waiting on image decode — measured on a laptop where --jobs 3 took 24.2 min
   against 23.6 serial, bought nothing, and cost three suites. Printing the
   comparison is enough; someone who knows their machine better than this does
   should still be able to ask for it. */
if (JOBS > 1 && JOBS >= CORES) {
  console.log(`\n  note: --jobs ${JOBS} on ${CORES} core${CORES === 1 ? '' : 's'}.`
    + ` Suites will contend; --jobs ${Math.max(1, CORES - 1)} or the default 1 is usually faster.`);
}

/* Longest first, so the tail of the run is not one 90-second suite finishing
   alone while three workers idle. The durations come from the last recorded
   run — the same generated file the counts live in — and an unknown suite
   sorts first rather than last, because a suite nobody has timed is more
   likely to be new and slow than new and instant. */
const PREV_SECS = (() => {
  try { return require(path.join(ROOT, 'tests', 'test-stats.json')).seconds || {}; }
  catch (_) { return {}; }
})();
const cost = n => (n in PREV_SECS ? PREV_SECS[n] : Infinity);

const parallelSet = chosen.filter(([n]) => !SERIAL.has(n)).sort((a, b) => cost(b[0]) - cost(a[0]));
const serialSet = chosen.filter(([n]) => SERIAL.has(n));

console.log(`\nVerifying ${shortTarget}`);
/* A build assembled around scripts/synthetic-export.js (CI's build) runs the
   same suites, but its counts are of invented questions; writeStats will not
   record them. Said up front so a long run does not end in a surprise. */
const SYNTHETIC = !TARGET_IS_URL && require('./synthetic-export.js').isSyntheticBuild(TARGET);
if (SYNTHETIC) console.log('  synthetic build: tests/test-stats.json will not be written');
if (urlIncapable.length) {
  /* Named, counted, and NOT quietly re-pointed at the default build. Running
     them against a different artifact than the one on the command line would
     put two targets under one summary line. */
  console.log(`  ${urlIncapable.length} suite${urlIncapable.length === 1 ? '' : 's'} cannot take a URL and are not run:`);
  for (const line of urlIncapable) console.log(`    ${line}`);
  console.log(`    (give those a file path — and note the summary below is over the rest)`);
}
if (JOBS > 1) {
  console.log(`  ${chosen.length} suites on ${ENGINE}, ${JOBS} at a time`
    + ` — ${serialSet.length} of them alone (${serialSet.map(([n]) => n).join(', ')})\n`);
} else {
  console.log(`  ${chosen.length} suite${chosen.length === 1 ? '' : 's'}, one at a time, on ${ENGINE}\n`);
}

/* WHAT WAS TESTED, taken once, before any suite runs. Asked again later it
   describes a different tree: a --pwa run writes tests/test-stats.json after
   the suites and again after the split build, so the second write, and the
   "all green" line between them, saw the first write as an uncommitted change
   and labelled a clean checkout "+uncommitted changes" (the record of
   2026-10-08 says so of a tree that was clean). Set at the top of the run
   below, where provenance() is in scope. */
let STARTED_ON = '';
const results = [];
/* The --pwa phases, which run outside the suite loop. Recorded here so the
   report covers everything the invocation measured: without them a run whose
   split build failed reported every suite it listed as passing, and only
   exitCode said otherwise (found by review). */
const phases = [];
const phase = (name, out, status, ms) => {
  const c = require(path.join(ROOT, 'scripts', 'cause.js')).countsOf(out);
  phases.push({ suite: name, tags: ['pwa'], status: !c.reported ? 'died' : (status === 0 && c.failed === 0 ? 'pass' : 'fail'),
                checks: c.checks, passed: c.passed, failed: c.failed, durationMs: ms });
};
const t0 = Date.now();
/* --report-json: written on the way out, whatever the exit — a red run is
   the one most worth having as data. Names, tags, counts and times only:
   never a line of suite output, which can quote the licensed corpus (that
   is why tests/last-run.log is gitignored), and the target is named by its
   kind, not its path, because an export's file name can carry its title. */
if (REPORT_JSON) process.on('exit', code => {
  const git = c => { try { return execSync(c, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (_) { return ''; } };
  const suites = results.map(r => {
    const c = countsOf(r.out);   // a suite that died still ran what it printed
    return { suite: r.name, tags: tagsFor(r.name), status: r.failed === null ? 'died' : (r.ok ? 'pass' : 'fail'),
             checks: c.checks, passed: c.passed, failed: c.failed, durationMs: r.ms };
  }).concat(phases);
  const doc = {
    format: 'systole-verify-report', version: 1,
    commit: git('git rev-parse --short=12 HEAD') || 'unknown', engine: ENGINE,
    target: TARGET_IS_URL ? 'url' : 'file', exitCode: code,
    selected: chosen.length, ran: suites.length,
    passed: suites.filter(s => s.status === 'pass').length,
    checks: suites.reduce((n, s) => n + s.checks, 0),
    suites,
  };
  try { fs.mkdirSync(path.dirname(path.resolve(REPORT_JSON)), { recursive: true }); fs.writeFileSync(REPORT_JSON, JSON.stringify(doc, null, 2) + '\n'); }
  /* A report asked for and not written fails the run: automation that
     wanted the file must not read exit 0 as "it is there". */
  catch (e) { console.error(`  could not write --report-json ${REPORT_JSON}: ${e.message}`); process.exitCode = 1; }
});
let stopScheduling = false;

function runSuite(name, claim) {
  return new Promise(resolve => {
    const t = Date.now();
    const ch = spawn(process.execPath, [path.join(ROOT, 'tests', `verify-${name}.js`), TARGET], {
      env: { ...process.env, NODE_PATH: nodePath, SYSTOLE_ENGINE: ENGINE },
    });
    let out = '';
    /* Where the time went (scripts/suitetime.js): each "── section ──" heading
       timestamped as it arrives, and a ceiling past which the suite is stopped
       and reported as dead in the section it was in, instead of holding the
       whole run. */
    const clock = sectionClock(t);
    const limit = limitFor(PREV_SECS[name], SUITE_TIMEOUT);
    let stopped = false;
    const cancel = watch(ch, limit, () => {
      stopped = true;
      const where = clock.current();
      out += `\nError: stopped by verify.js after ${fmtMin(Date.now() - t)} (its limit: ${fmtMin(limit)})`
        + (where ? ` in section "${where}"` : ' before its first section') + '\n';
    });
    const take = d => { const s = String(d); out += s; clock.feed(s, Date.now()); };
    ch.stdout.on('data', take);
    ch.stderr.on('data', take);
    ch.on('error', e => { out += '\n' + (e && e.message || e); });
    ch.on('close', status => {
      cancel();
      const m = out.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
      const passed = m ? +m[1] : 0, failed = stopped ? null : (m ? +m[2] : null);
      resolve({
        name, claim, passed, failed, checks: passed + (failed || 0),
        secs: ((Date.now() - t) / 1000).toFixed(0), ms: Date.now() - t,
        ok: !stopped && status === 0 && failed === 0, out,
        sections: clock.end(Date.now()),
      });
    });
  });
}

/* One whole line per suite, written when it finishes. In serial mode the name
   still goes out first so a suite that hangs is visible while it hangs; in
   parallel mode that would interleave four half-written lines. */
/* WHY A SUITE DIED, not merely that it did.

   A suite that throws prints no summary line, so verify records "did not
   report" and that is all the table said. The reason was in the child's output
   the whole time and the filter below walked past it: it matches lines opening
   with Error, TypeError or ReferenceError, and Playwright's own failures do not
   open that way —

       page.goto: Timeout 200000ms exceeded.

   That one line is the entire diagnosis of the first WebKit run, where 34 of 68
   suites died loading the 42 MB single file, and reading it took a round trip
   through tests/last-run.log on someone else's machine.

   The extraction itself lives in scripts/cause.js, with tests/verify-cause-pure.js
   over it: the first version of it scanned from the wrong end of the output and
   reported a check's own wrapped detail as the cause of a crash. */
const { causeOf, noteOf, countsOf } = require(path.join(ROOT, 'scripts', 'cause.js'));

function report(r) {
  const head = JOBS > 1 ? `  ${r.name.padEnd(14)} ` : '';
  let said = '', note = [];
  if (r.failed === null) {
    /* Checks that ran before the throw are real and are lost from the count,
       so say how many rather than letting the table imply none happened. */
    const ran = (String(r.out || '').match(/^\s*PASS\s/gm) || []).length;
    said = causeOf(r.out);
    console.log(`${head}did not report  (${r.secs}s)`
      + (ran ? `  — ${ran} had passed first` : '')
      + (said ? `\n      ${said}` : ''));
    /* AND WHAT THE PAGE SAID, which the filter below cannot show: its lines
       open with none of FAIL, Error, TypeError or ReferenceError, so the first
       suite to leave a note had it written to tests/last-run.log and printed
       nowhere — evidence collected, kept, and still not read. */
    note = noteOf(r.out);
    for (const line of note) console.log(`      ${line}`);
  }
  else console.log(`${head}${r.ok ? '✓' : '✗'} ${String(r.passed).padStart(3)} passed`
    + `${r.failed ? `, ${r.failed} FAILED` : ''}   ${r.secs}s`);
  if (!r.ok) {
    /* Print only the failing lines: the full transcript of seventeen suites is
       thousands of lines, and the failures are what you came for. */
    for (const ln of r.out.split('\n')) {
      const t = ln.trim();
      /* Not the cause again: when node formats the rejection with an `Error`
         prefix the filter below matches the very line already printed above,
         and the table said the same thing twice. */
      if (t && t === said) continue;
      /* Nor anything the note already showed: the page's errors are error-
         shaped, so without this every one of them printed twice. */
      if (t && note.includes(t)) continue;
      if (/^\s*FAIL\s/.test(ln) || /^\s*(Error|TypeError|ReferenceError)/.test(ln)) console.log(`      ${t}`);
    }
    if (flag('--bail')) stopScheduling = true;
  }
}

async function runPool(list, n) {
  const queue = list.slice();
  const workers = [];
  for (let i = 0; i < Math.min(n, queue.length); i++) {
    workers.push((async () => {
      while (queue.length && !stopScheduling) {
        const [name, claim] = queue.shift();
        const r = await runSuite(name, claim);
        results.push(r);
        report(r);
      }
    })());
  }
  await Promise.all(workers);
}

async function runSerial(list) {
  for (const [name, claim] of list) {
    if (stopScheduling) break;
    if (JOBS === 1) process.stdout.write(`  ${name.padEnd(14)} `);
    const r = await runSuite(name, claim);
    results.push(r);
    report(r);
  }
}

/* The shared ones first, then the ones that need the machine quiet — so the
   serial suites are never measuring a machine with three browsers still on it.
   At --jobs 1 the two calls are the same thing and the registry order is
   preserved, which is what every previous run printed. */
(async () => {
STARTED_ON = provenance();
if (JOBS === 1) {
  await runSerial(chosen);
} else {
  await runPool(parallelSet, JOBS);
  await runSerial(serialSet);
}
/* Back into registry order: the run may have finished them in any order, and
   a log whose rows move between runs is a log nobody can diff. */
{
  const rank = new Map(chosen.map(([n], i) => [n, i]));
  results.sort((a, b) => rank.get(a.name) - rank.get(b.name));
}
if (flag('--bail') && stopScheduling) console.log('\n  --bail: stopping here.\n');

/* ── the counts, written down rather than remembered ──────────────────────────
   README.md, docs/BUILD.md and .github/workflows/verify.yml all quote how many
   checks exist and how many CI runs. Those numbers were maintained by hand, in
   three files, and they drifted — the CI header currently claims both "the
   other 1052" and "those 1210 checks" for the same quantity, because a total
   moved and only some of the sentences moved with it. tests/verify-stats.js
   reads this file and holds the prose to it, which is only possible if the
   file is generated. So: generated here, never edited.

   Written per FAMILY (scripts/record.js): Systole's half from a run in which
   every Systole suite ran and passed, the Memorizer's half likewise, and a
   half this run did not earn keeps its previous numbers. A --skip or --only
   run can therefore still write a half it covered completely — a run that
   skips the Memorizer writes Systole's numbers and leaves the Memorizer's
   alone — and a half it covered partly is not touched. A --engine webkit run
   still writes nothing: it measures a different browser. */
function writeStats(pwaCount) {
  /* A URL run measures the split build, and the numbers in the docs are the
     single-file build's. Same reason --engine webkit does not write: a true
     number about the wrong thing is still wrong in the sentence it lands in. */
  if (TARGET_IS_URL) return;
  if (SYNTHETIC) return;
  if (ENGINE !== DEFAULT_ENGINE) return;
  const file = path.join(ROOT, 'tests', 'test-stats.json');
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  /* Checks EXECUTED, not checks passed (results[].checks). On a green run
     these are the same number. They differ only in the one case that can still
     reach a write — verify-stats failing because the record is stale — and
     there, counting passes would record a smaller total than the same suite
     produces once it goes green, so the record would never settle.
     Seconds are a scheduling hint for the next --jobs run and nothing else; no
     check reads them. They move with their family's counts. */
  const out = mergeRecord(prev, results, SUITES.map(([n]) => n), {
    engine: ENGINE,
    /* 1 is one suite at a time; higher ran the shared suites concurrently.
       It changes no count — it says which arrangement produced the numbers. */
    jobs: JOBS,
    commit: STARTED_ON,
    pwaCount,
  });
  if (!out) {
    console.log('  counts not written: no family had every one of its suites run and pass\n');
    return;
  }
  fs.writeFileSync(file, JSON.stringify(out.record, null, 2) + '\n');
  console.log(`  counts written to ${path.relative(process.cwd(), file)}: ${out.written.join(', ')}` +
              (out.kept.length ? ` (kept from the previous record: ${out.kept.join(', ')})` : '') + '\n');
}

/* Written before the pass/fail gate, and deliberately NOT blocked by the one
   suite whose whole job is to notice that this file is out of date. Gating it
   on green would deadlock: add a suite, verify-stats fails because the record
   does not mention it, the run is red, the record is never rewritten, and the
   only way out is to know to pass --skip stats. So a run where verify-stats is
   the only casualty still rewrites the record — and still exits non-zero,
   because the prose in three documents may now disagree with it and that needs
   a person. Run it again after fixing those and it goes green. */
/* ── what ran, said in the log's own words ────────────────────────────────────
   A run reported from another machine arrives as the summary line — "17 suites
   failing: apex, polish, splash, …" — because that is what fits in a paste.
   The failures underneath it, which are the whole content of the report, get
   scrolled past. Worse, the summary carries no provenance: a run against a
   checkout three days old and a run against the current one produce the same
   shape of sentence, and the only way to tell them apart is to notice that the
   suite count is wrong, which nobody does.

   So a failing run writes the transcript out, with a header that names the
   branch, the commit and the build it tested. That header is the part that
   matters: it makes a stale run self-identifying instead of something to be
   deduced from arithmetic.

   Gitignored, deliberately: suite output quotes note titles and stem text out
   of the licensed corpus, and that stays on the machine that built it. */
function provenance() {
  const git = c => { try { return execSync(c, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch (_) { return ''; } };
  const sha = git('git rev-parse --short HEAD') || 'unknown';
  const branch = git('git rev-parse --abbrev-ref HEAD') || 'unknown';
  const dirty = git('git status --porcelain') ? ' +uncommitted changes' : '';
  return `${branch} @ ${sha}${dirty}`;
}

function writeFailLog() {
  const file = path.join(ROOT, 'tests', 'last-run.log');
  let built = TARGET_IS_URL ? 'served over HTTP' : 'not found';
  if (!TARGET_IS_URL) {
    try {
      const st = fs.statSync(TARGET);
      built = `${(st.size / 1048576).toFixed(2)} MB, modified ${st.mtime.toISOString()}`;
    } catch (_) {}
  }
  const header = [
    `# systole verify — ${new Date().toISOString()}`,
    `# checkout  ${STARTED_ON}`,
    `# engine    ${ENGINE}`,
    `# target    ${TARGET_IS_URL ? TARGET : path.relative(ROOT, TARGET)}  (${built})`,
    `# suites    ${results.length} run, ${total} checks, ${bad.length} failing`,
    `# failing   ${bad.map(r => r.name).join(', ')}`,
    '',
    '# Full output of the failing suites follows. The passing ones are omitted;',
    '# they are the same lines every time and they are not what you came for.',
  ].join('\n');
  const rule = '='.repeat(74);
  const body = bad.map(r =>
    `\n${rule}\n== verify-${r.name}  —  ${r.passed} passed, ${r.failed === null ? 'did not report' : r.failed + ' failed'}, ${r.secs}s\n${rule}\n${r.out.trimEnd()}\n`
  ).join('');
  fs.writeFileSync(file, header + body + '\n');
  return file;
}

const blockers = results.filter(r => !r.ok && r.name !== 'stats');

const total = results.reduce((n, r) => n + r.checks, 0);
const bad = results.filter(r => !r.ok);
console.log(`\n  ${total} checks across ${results.length} suites in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
/* Where the time went: the longest sections of the run, so the next speed-up
   is aimed at a measured step. Section names are the suites' own headings,
   never suite output. */
{
  const top = slowest(results, 8).filter(x => x.ms >= 60000);
  if (top.length) {
    console.log('  slowest sections:');
    for (const x of top) console.log(`    ${fmtMin(x.ms).padStart(8)}  ${x.suite} › ${x.section}`);
  }
}
/* CALLED ON EVERY RUN; writeStats decides, family by family, what this run
   earned. It used to wait for an all-green run, which tied Systole's record to
   the Memorizer's: one Memorizer browser suite failing on one machine held
   back Systole numbers measured green from end to end.
   It also writes before --pwa, carrying the previous split-build figure
   forward. A full green run of 86 suites was once lost because the split build
   refused after every suite had passed, and process.exit(1) came before the
   only line that wrote the record. If the split build succeeds, the call below
   rewrites the file with the real figure and supersedes this one. */
writeStats();
if (bad.length) {
  console.log(`\n  ${bad.length} suite${bad.length === 1 ? '' : 's'} failing: ${bad.map(r => r.name).join(', ')}`);
  console.log(`  full output of those suites: ${path.relative(process.cwd(), writeFailLog())}`);
  console.log(`  checkout: ${STARTED_ON}\n`);
  /* A stats-only failure means the record is out of date, which is the one
     failure that must NOT stop the run: --pwa has not happened yet, and the
     split build's count is part of what needs rewriting. Exiting here left the
     record unwritten and the only way out was to know to pass --skip stats —
     the deadlock this whole arrangement exists to avoid, reintroduced two
     lines below where it was solved. */
  if (blockers.length) process.exit(1);
  console.log('  (only the counts record is stale — continuing so it can be rewritten)\n');
} else console.log(`  all green   —   ${STARTED_ON} on ${ENGINE}\n`);

/* ── the split build ──────────────────────────────────────────────────────────
   Built, served on a free port, tested, torn down. Kept out of the loop above
   because it is the only suite that needs a running server, and mixing a
   server's lifetime into a loop over file-path suites is how a stray node
   process outlives its run. */
if (flag('--pwa')) {
  const PORT = 8137;
  /* Each phase below has no recorded time of its own, so it gets the default
     ceiling for an unrecorded suite, or what --suite-timeout says. */
  const PHASE_LIMIT = limitFor(undefined, SUITE_TIMEOUT);
  console.log('── the Stage 1 split build, over HTTP ──\n');
  let pt = Date.now();
  const b = spawnLimited(process.execPath, [path.join(ROOT, 'scripts', 'build-pwa.js'), TARGET], { encoding: 'utf8' }, PHASE_LIMIT, 'build-pwa');
  phases.push({ suite: 'build-pwa', tags: ['pwa'], status: b.status === 0 ? 'pass' : 'fail', checks: 0, passed: 0, failed: b.status === 0 ? 0 : null, durationMs: Date.now() - pt });
  if (b.status !== 0) { console.error(b.stdout + b.stderr); process.exit(1); }
  console.log((b.stdout.match(/shell total.*/) || ['  (built)'])[0].trim());

  const srv = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve.js'), String(PORT), path.join(ROOT, 'dist')],
                    { stdio: 'ignore', detached: false });
  const done = () => { try { srv.kill(); } catch (_) {} };
  process.on('exit', done); process.on('SIGINT', () => { done(); process.exit(130); });

  /* Give the listener a moment, then run. */
  const wait = spawnSync(process.execPath, ['-e',
    `const t=Date.now();(function p(){require('http').get('http://localhost:${PORT}/',r=>{r.destroy();process.exit(0)})
     .on('error',()=>{if(Date.now()-t>15000)process.exit(1);setTimeout(p,200)})})()`], { encoding: 'utf8' });
  if (wait.status !== 0) {
    phases.push({ suite: 'pwa', tags: ['pwa'], status: 'died', checks: 0, passed: 0, failed: null, durationMs: 0 });
    console.error('  the static server never came up'); done(); process.exit(1);
  }
  pt = Date.now();

  const r = spawnLimited(process.execPath, [path.join(ROOT, 'tests', 'verify-pwa.js'), `http://localhost:${PORT}`],
                      { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, NODE_PATH: nodePath, SYSTOLE_ENGINE: ENGINE } }, PHASE_LIMIT, 'verify-pwa');
  const out = (r.stdout || '') + (r.stderr || '');
  phase('pwa', out, r.status, Date.now() - pt);
  const m = out.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  for (const ln of out.split('\n')) if (/^\s*(PASS|FAIL)\s/.test(ln)) console.log(ln);
  /* AND WHY IT STOPPED, when it stopped. The filter above prints check lines
     and nothing else, which is right for a suite that finished and useless
     for one that died: its exception and its death note are exactly the lines
     that do not start with PASS or FAIL. The first --pwa death on the owner's
     laptop printed eighty-eight PASS lines, then "pwa FAILED", and nothing
     about the cause — the evidence was collected and thrown away at the one
     moment it was the only thing wanted. Same helpers the suite table uses. */
  if (!m) {
    const said = causeOf(out);
    console.log(`\n  verify-pwa did not report` + (said ? `\n      ${said}` : '  (and printed no cause)'));
    for (const line of noteOf(out)) console.log(`      ${line}`);
  }
  done();
  if (!m || +m[2] > 0 || r.status !== 0) {
    console.log(`\n  pwa FAILED\n`);
    process.exit(1);
  }
  console.log(`\n  pwa: ${m[1]} checks, all green\n`);

  /* The Worker Pages actually runs, against the directory just built. Here
     rather than in the suite list because it needs dist/ to exist and to be
     fresh — verify-pwa serves that directory with a plain static server and
     never touches _worker.js, which in advanced mode owns every request to the
     project. A deployment went down once while that path had no test at all. */
  pt = Date.now();
  const wk = spawnLimited(process.execPath, [path.join(ROOT, 'tests', 'verify-pages.js'),
                                          path.join(ROOT, 'dist')], { encoding: 'utf8' }, PHASE_LIMIT, 'verify-pages');
  const wout = (wk.stdout || '') + (wk.stderr || '');
  phase('pages', wout, wk.status, Date.now() - pt);
  const wm = wout.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  for (const ln of wout.split('\n')) if (/^\s*FAIL\s/.test(ln)) console.log(ln);
  if (!wm || +wm[2] > 0 || wk.status !== 0) {
    console.log(`\n  pages FAILED\n`);
    process.exit(1);
  }
  console.log(`  pages: ${wm[1]} checks on the Worker, all green\n`);

  /* And the cache buckets, read off the worker that was just generated. Here
     for the same reason as pages: it needs a dist/ that matches the build
     under test, and reading a stale one would report on a deploy that is not
     the one being verified. It drives no browser — the failure it guards is
     two deploys apart and is decidable from the worker's own source. */
  pt = Date.now();
  const cb = spawnLimited(process.execPath, [path.join(ROOT, 'tests', 'verify-cachebuckets.js'),
                                          path.join(ROOT, 'dist')], { encoding: 'utf8' }, PHASE_LIMIT, 'verify-cachebuckets');
  const cout = (cb.stdout || '') + (cb.stderr || '');
  phase('cachebuckets', cout, cb.status, Date.now() - pt);
  const cm = cout.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  for (const ln of cout.split('\n')) if (/^\s*FAIL\s/.test(ln)) console.log(ln);
  if (!cm || +cm[2] > 0 || cb.status !== 0) {
    console.log(`\n  cachebuckets FAILED\n`);
    process.exit(1);
  }
  console.log(`  cachebuckets: ${cm[1]} checks on the caches, all green\n`);

  writeStats(+m[1] + +wm[1] + +cm[1]);
}

/* Deferred to here so a stale record still gets rewritten above, but never
   reports as a pass: the prose in three documents may now disagree with the
   record, and that needs a person. */
if (bad.length) process.exit(1);

/* The whole run after the pool lives inside the async wrapper the scheduler
   needs. Nothing below it — every exit above is a real exit. */
})();
