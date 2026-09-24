#!/usr/bin/env node
/*
 * Run every behavioural suite against a build.
 *
 *   node scripts/verify.js [build/systole.html] [options]
 *
 *   --only <a,b>   run just these suites (names as in tests/verify-<name>.js)
 *   --skip <a,b>   run everything except these
 *   --bail         stop at the first failing suite
 *   --pwa          also build, serve and test the Stage 1 split build
 *   --jobs N       run N suites at once (default 1; `auto` = cores-1, capped
 *                  at 4). The suites that measure wall-clock time or WebGL
 *                  contexts always run alone — see SERIAL below.
 *   --engine <e>   chromium (default), webkit or firefox
 *   --list         print the suites and what each covers, then exit
 *
 * WHY THIS EXISTS. There are 90 suites and roughly 2944 checks, and they
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
  /* Written because focusmode anchored on three lines copied out of
     fullbleed's source, and two steps in between had rewritten them — which
     reading the source cannot tell you and a build would have, if a build
     were something everyone could run. */
  ['shellanchor-pure', 'every anchor into the shell markup still matches at the step that uses it'],
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
  ['echoanchor-pure','every anchor echo-patch uses still exists at the step it runs from'],
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
  ['memorizer-appearance-pure', 'the themes are Systole\u2019s, colour for colour, and readable at every contrast and brightness'],
  ['memorizer-home-pure',    'the home screen\u2019s progress counts what happened, and its pearl is your PDF\u2019s own sentence'],
  ['memorizer-book-pure',   'a whole textbook: its parts in order, its pages straight through, its chapters found three ways'],
  ['memorizer-ask-pure',    'asking your book: its own sentences with their pages, from the right section, or nothing found'],
  ['memorizer-ground-pure', 'the on-device AI says nothing the book does not: no new number or name, cited, answers found in the section'],
  ['memorizer-vec-pure',    'search by meaning: similarity, a measured floor, and the merge with search by words'],
  ['memorizer-sheet-pure',  'a lesson laid out to be remembered: points under clinical headings, numbers as tiles, nothing twice'],
  ['memorizer-figure-pure', 'figures made from the book: a study card and a comparison chart, every word the lesson\u2019s, escaped and wrapped'],
  ['memorizer-agent-pure',  'the Coach as an agent: each tool reached, its topic, follow-ups remembered, a model\u2019s plan used only when it names a real tool'],
  ['memorizer-study-pure',  'studying beyond the drill: recall and figure cards from the book, checks days apart, timed practice, an exam plan, teach-back, corrections, notes, progress'],
  ['memorizer-provenance-pure', 'where a unit came from: a real SHA-256 of its bytes, a duplicate recognised, and an import report that counts what happened'],
  ['memorizer',              'a real PDF becomes its sections, and a unit goes through lesson, multiple-choice drill, exam and review in a browser'],
  ['memorizer-hardening',    'a double tap lands once, a failed save is said and stores nothing half-way, a late reply is dropped, and a dialog holds focus'],
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
   and echo. */
const PENDING_RECORD = ['notesearch-pure', 'notesearch',
  'coronaryview', 'ambient',
  'memorizer-chunk-pure', 'memorizer-prompts-pure', 'memorizer-session-pure', 'memorizer-coach-pure', 'memorizer-appearance-pure', 'memorizer-home-pure', 'memorizer-book-pure', 'memorizer-ask-pure', 'memorizer-ground-pure', 'memorizer-vec-pure', 'memorizer-sheet-pure', 'memorizer-figure-pure', 'memorizer-agent-pure', 'memorizer',
  'memorizer-provenance-pure', 'memorizer-hardening', 'memorizer-study-pure'];

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

if (flag('--list')) {
  console.log('\nSuites, and what each defends:\n');
  for (const [name, claim] of SUITES) console.log(`  ${name.padEnd(14)} ${claim}`);
  console.log(`\n  pwa            the Stage 1 split build over HTTP — needs a server, so:`);
  console.log(`                 node scripts/verify.js --pwa\n`);
  process.exit(0);
}

const VALUED = ['--only', '--skip', '--engine'];
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

if (!TARGET_IS_URL && !fs.existsSync(TARGET)) {
  console.error(`\nNo build at ${TARGET}\n\n  Build one first:  node scripts/build.js\n`);
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
   launching, so it costs nothing on the ordinary run. */
(() => {
  let exe = null;
  try { exe = require('playwright')[ENGINE].executablePath(); } catch (_) { return; }
  if (exe && !fs.existsSync(exe)) {
    console.error(`\n  --engine ${ENGINE}: playwright has no browser installed for it.`);
    console.error(`  expected   ${exe}`);
    console.error(`  install    npx playwright install ${ENGINE}\n`);
    process.exit(1);
  }
})();
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

/* ── how many at once ─────────────────────────────────────────────────────────
   One, unless asked otherwise: the default has to stay the arrangement every
   recorded number was produced under, so that turning this on is a decision
   somebody makes rather than something that happens to them. `auto` leaves a
   core for the parent and for whatever else is on the machine — four browsers
   on four cores is how you turn a 5s launch budget into a 6s launch. */
const CORES = require('os').cpus().length || 1;
const jobsArg = opt('--jobs', '1');
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

const results = [];
const t0 = Date.now();
let stopScheduling = false;

function runSuite(name, claim) {
  return new Promise(resolve => {
    const t = Date.now();
    const ch = spawn(process.execPath, [path.join(ROOT, 'tests', `verify-${name}.js`), TARGET], {
      env: { ...process.env, NODE_PATH: nodePath, SYSTOLE_ENGINE: ENGINE },
    });
    let out = '';
    ch.stdout.on('data', d => { out += d; });
    ch.stderr.on('data', d => { out += d; });
    ch.on('error', e => { out += '\n' + (e && e.message || e); });
    ch.on('close', status => {
      const m = out.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
      const passed = m ? +m[1] : 0, failed = m ? +m[2] : null;
      resolve({
        name, claim, passed, failed, checks: passed + (failed || 0),
        secs: ((Date.now() - t) / 1000).toFixed(0),
        ok: status === 0 && failed === 0, out,
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
const { causeOf, noteOf } = require(path.join(ROOT, 'scripts', 'cause.js'));

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

   Written ONLY from a complete run on the default engine. A --only run knows
   the count of two suites, a --skip run is missing some, and a --engine webkit
   run measures a different browser; any of those overwriting this file would
   put a confidently wrong number into three documents at once, which is worse
   than the hand-editing it replaces. */
function writeStats(pwaCount) {
  if (only.length || skip.length) return;
  /* A URL run measures the split build, and the numbers in the docs are the
     single-file build's. Same reason --engine webkit does not write: a true
     number about the wrong thing is still wrong in the sentence it lands in. */
  if (TARGET_IS_URL) return;
  if (ENGINE !== DEFAULT_ENGINE) return;
  if (chosen.length !== SUITES.length) return;
  const file = path.join(ROOT, 'tests', 'test-stats.json');
  /* --pwa is a separate opt-in, so a run without it has nothing to say about
     the split build. Carrying the previous value forward is the honest move:
     the alternative is deleting a true number because this run did not measure
     it. */
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  const suites = {};
  /* Checks EXECUTED, not checks passed. On a green run these are the same
     number. They differ only in the one case that can still reach this
     function — verify-stats failing because the record is stale — and there,
     counting passes would record a smaller total than the same suite produces
     once it goes green, so the docs would be updated to a number the next run
     immediately contradicts. The record would never settle. */
  for (const r of results) suites[r.name] = r.checks;
  /* How long each one took, so the next parallel run can pack the slow ones
     first instead of discovering them. Wall-clock seconds from THIS machine
     under THIS --jobs, which makes them a scheduling hint and nothing else —
     no check reads them, and a wrong one costs a worse packing, not a wrong
     verdict. Carried forward for a suite this run did not time. */
  const seconds = Object.assign({}, prev.seconds || {});
  for (const r of results) seconds[r.name] = +r.secs;
  const stats = {
    _generated: 'by scripts/verify.js on a full green run — do not hand-edit',
    engine: ENGINE,
    /* The arrangement the numbers were produced under. 1 is one suite at a
       time; anything higher ran the shared suites concurrently and the ones in
       SERIAL alone. It changes no count — it is here so a reader of the record
       knows which it is looking at. */
    jobs: JOBS,
    suiteCount: results.length,
    total: results.reduce((n, r) => n + r.checks, 0),
    pwa: pwaCount === undefined ? (prev.pwa === undefined ? null : prev.pwa) : pwaCount,
    suites,
    seconds,
  };
  fs.writeFileSync(file, JSON.stringify(stats, null, 2) + '\n');
  console.log(`  counts written to ${path.relative(process.cwd(), file)}\n`);
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
    `# checkout  ${provenance()}`,
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
/* WRITTEN WHENEVER THE RUN IS GREEN, even with --pwa pending. It used to be
   skipped here under --pwa so the record could be written once, below, with a
   real split-build count in it — which is right when the split build works and
   throws away a true measurement when it does not. A full green run of 86
   suites was lost exactly that way: every suite passed, then the split build
   refused because content/ had been extracted from an earlier build, and
   process.exit(1) came before the only line that writes the record. Twenty-
   three minutes of true numbers discarded over a staleness in a directory the
   suites had nothing to say about.
   Writing here carries the previous pwa figure forward, which is what
   writeStats already does for a run without --pwa and for the same stated
   reason: the alternative is deleting a true number because this run did not
   measure it. If the split build then succeeds, the call below rewrites the
   file with the real figure and supersedes this one. */
if (!blockers.length) writeStats();
if (bad.length) {
  console.log(`\n  ${bad.length} suite${bad.length === 1 ? '' : 's'} failing: ${bad.map(r => r.name).join(', ')}`);
  console.log(`  full output of those suites: ${path.relative(process.cwd(), writeFailLog())}`);
  console.log(`  checkout: ${provenance()}\n`);
  /* A stats-only failure means the record is out of date, which is the one
     failure that must NOT stop the run: --pwa has not happened yet, and the
     split build's count is part of what needs rewriting. Exiting here left the
     record unwritten and the only way out was to know to pass --skip stats —
     the deadlock this whole arrangement exists to avoid, reintroduced two
     lines below where it was solved. */
  if (blockers.length) process.exit(1);
  console.log('  (only the counts record is stale — continuing so it can be rewritten)\n');
} else console.log(`  all green   —   ${provenance()} on ${ENGINE}\n`);

/* ── the split build ──────────────────────────────────────────────────────────
   Built, served on a free port, tested, torn down. Kept out of the loop above
   because it is the only suite that needs a running server, and mixing a
   server's lifetime into a loop over file-path suites is how a stray node
   process outlives its run. */
if (flag('--pwa')) {
  const PORT = 8137;
  console.log('── the Stage 1 split build, over HTTP ──\n');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-pwa.js'), TARGET], { encoding: 'utf8' });
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
  if (wait.status !== 0) { console.error('  the static server never came up'); done(); process.exit(1); }

  const r = spawnSync(process.execPath, [path.join(ROOT, 'tests', 'verify-pwa.js'), `http://localhost:${PORT}`],
                      { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, NODE_PATH: nodePath, SYSTOLE_ENGINE: ENGINE } });
  const out = (r.stdout || '') + (r.stderr || '');
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
  const wk = spawnSync(process.execPath, [path.join(ROOT, 'tests', 'verify-pages.js'),
                                          path.join(ROOT, 'dist')], { encoding: 'utf8' });
  const wout = (wk.stdout || '') + (wk.stderr || '');
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
  const cb = spawnSync(process.execPath, [path.join(ROOT, 'tests', 'verify-cachebuckets.js'),
                                          path.join(ROOT, 'dist')], { encoding: 'utf8' });
  const cout = (cb.stdout || '') + (cb.stderr || '');
  const cm = cout.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  for (const ln of cout.split('\n')) if (/^\s*FAIL\s/.test(ln)) console.log(ln);
  if (!cm || +cm[2] > 0 || cb.status !== 0) {
    console.log(`\n  cachebuckets FAILED\n`);
    process.exit(1);
  }
  console.log(`  cachebuckets: ${cm[1]} checks on the caches, all green\n`);

  if (!blockers.length) writeStats(+m[1] + +wm[1] + +cm[1]);
}

/* Deferred to here so a stale record still gets rewritten above, but never
   reports as a pass: the prose in three documents may now disagree with the
   record, and that needs a person. */
if (bad.length) process.exit(1);

/* The whole run after the pool lives inside the async wrapper the scheduler
   needs. Nothing below it — every exit above is a real exit. */
})();
