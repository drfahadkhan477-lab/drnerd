# Lessons

Read this at the start of a session. Add an entry after **any** correction from
the owner or a reviewer: the pattern, then a rule that would have prevented it.
Keep entries short and keep them true — prune one that stops being so.

Format: `- **Pattern.** What went wrong. → Rule: what to do instead.`

This file is for rules about how to work. Facts about the code belong in the
code's own comments; facts the whole project must obey belong in `AGENTS.md`
(and only after the second time).

## Checks

- **A check that never ran.** A retry test passed because it entered the code
  below the path it claimed to cover (`readImage()` for a scanned-PDF fix; the
  review bot caught it, the author did not). → Rule: name the entry point the
  user hits, and call *that* in the test. Then inject the defect and watch the
  check fail before trusting it (`AGENTS.md`, section 2).
- **An anchor tested only against a stand-in.** A string patch can pass its own
  synthetic fixture and still miss the real pinned file. → Rule: when a patch
  targets third-party code pinned by SRI, run the real fixed file through the
  patch once (fetch it, confirm its hash) and say so in the commit.
- **A check CI cannot exercise.** A timezone fix and an OS-clipboard fix both
  pass on a UTC Linux runner whether or not they are right. → Rule: reproduce
  the condition instead of reasoning about it: `TZ=Pacific/Kiritimati` (UTC+14)
  makes the local day differ from the UTC day for most of the day, and showed
  master failing two checks the fix passes. Where the condition cannot be made
  (a Windows clipboard), say the branch is unexercised and narrow the comment.
- **A normalisation applied on the wrong side.** Making a read-back match its
  expectation can hide the very defect the check exists for (CRLF the app wrote
  itself). → Rule: normalise only what the environment changes, and assert the
  value the app produced on the way out as well.
- **A number moved to turn a suite green.** → Rule: the suite is right until
  proven otherwise. Never move a threshold, timeout or count.
- **A guard (and its check) for a case that cannot occur.** A study plan "does not
  resume a saved deck" guard and its check passed with the guard removed, because
  `resumeKey` is null for review decks: nothing is ever saved to resume. → Rule: make the
  case happen once, by injecting the defect, before guarding or testing it; if it cannot
  happen, delete the guard and say why in a comment. Do not invent a scenario.
- **A fixture that cannot show the quantity under test.** "Runs of three to five" passed
  with a size limit of nine, because the invented bank only ever forms runs of three; a
  silent murmur passed "twice as loud in its window" because both windows read 0 and
  `0 < 0` is false. → Rule: for any at-most, at-least or ratio check, make the fixture able
  to break the bound, assert the measured quantity is not trivially zero, then inject the
  bound's removal. Fix the fixture, never the bound.
- **Measuring with the thing that moves.** A sideways-scroll check read the viewport, which
  mobile emulation widens to fit the overflow; a zip's expected file list came from the
  builder's own constant. → Rule: measure with an instrument the defect cannot move (every
  element's right edge, a literal list written in the test).
- **Asking the code under test whether it worked.** An import check read
  `RefAssets.pending()`; with write-tracking removed it said 0 and passed. → Rule: count
  at a layer the change cannot reach (here, `IDBDatabase.prototype.transaction`), then
  inject the defect that would make the self-report lie.
- **A wait sized for the small build.** On the owner's laptop, late in a full run on the
  real build, a run failed a different suite each time: a reload on Playwright's default
  timeout, layout waits shorter than the shared one, fixed short reads, a suite that loaded
  the app once per section. Each passed alone and in CI. → Rule: a page load or reload of
  the build under test takes the boot timeout; a precondition goes through `settled()` with
  its standard timeout and a label; a fixed sleep before a read becomes a wait for what the
  app sets; load the build once per suite. A precondition must not be what the next check
  asserts: a wait on `S.screen` before a check on `S.screen` leaves the check nothing to
  catch (found in review of #180). Reproduce by making the app slow (a `setTimeout` around
  the step), not by loading the CPU, which did not reproduce any of them.
- **A build handed to the browser in one message.** #232's hosted section of
  verify-memory served the build through `route.fulfill({ path })`. CI's 5 MB
  synthetic build passed; on the owner's 92 MB build the page closed at that
  `goto` and the suite died 45 checks in, with no FAIL line to say why. → Rule:
  serve a build from a server of the suite's own on 127.0.0.1, streamed, never
  through `route.fulfill`. Before pushing a suite change that loads the build in a
  new way, run it once on a synthetic build padded to the real one's size (an HTML
  comment after it); that reproduced this one here.

- **A stub in the wrong provider's wire format.** verify-chat opened the panel on
  Gemini and fed it OpenAI-shaped stream lines, which Gemini's reader skips. The
  "tool step" never ran and no reply was ever appended; the composer checks passed
  on rebuilds that happen anyway. → Rule: a stubbed reply must be in the shape of
  the provider the test selects, and the test must wait on something only the
  stubbed reply can produce (its text in the panel), so a skipped stub times out.

- **A suite that measured a substitute.** Several suites read the retired
  patch scripts, or a tokenizer written in the test, instead of the code that
  ships. Moving them to app/ found an icon button with no name, four alert()s,
  a palette check reading a fallback literal, and a ranking fixture whose
  central case failed on the real tokenizer. → Rule: a suite lifts the code
  under test from the file that ships (app/, src/), between anchors that must
  each occur once; never from a build step, and never a copy kept in the test.

- **A replace-instead-of-merge rule tested only at the moment it is written.**
  #224 marked a fallback copy "whole" so recovery would take it over the
  database; every test ended the session right after the fallback. A review
  found the copy outliving later writes that did land, so the next launch threw
  them away, where the old merge had kept them. → Rule: when a copy gains
  authority over another, test what happens to it after the other moves on
  (a later successful write, a second session) before trusting it.
- **A fake whose options were copied.** A store test turned `putFails` off
  mid-session on an options object `reload()` had already copied, so the
  "write that lands" never landed and the check passed an injected defect.
  → Rule: when a test changes the fake's behaviour mid-run, assert the effect
  (the value is in the database) as a precondition before the claim.

- **A check that reads the input, not the output.** "It opens full size" read the
  lightbox image's `naturalWidth > 0`, true whatever size it was shown at, so a held
  `width` attribute that drew "Enlarge" at 1x of a 2.5x render passed (three reviews
  found it; no suite did). → Rule: a claim about what the reader sees measures the
  rendered box (`getBoundingClientRect`) against what it should be, never a property
  of the source.
- **A shared helper changed for one caller.** Space held for lazy figures in the lesson
  also applied in the lightbox and the occlusion card, whose CSS took the held size
  differently. → Rule: before changing a helper's output, grep every caller and read the
  CSS each one's output lands in; measure at each, not only at the caller that prompted it.
- **A fix placed in one caller of a shared hazard.** The hung-save bound went into
  `go()`; Review's rating, opening a unit and filing a lesson waited on the same kind of
  save and still froze. → Rule: fix the hazard where it happens or at every caller that
  waits on it — grep for every `.then` on that promise before calling it fixed, and
  narrow the commit title to what was covered.
- **Two causes reasoned, neither reproduced; CI runners said which.** My occlusion
  check drew the card's `<img>` into a canvas and looked for the label's magenta.
  CI's WebKit read nothing. I blamed an image not yet decoded, waited for `complete`
  and `decode()`, and called it fixed unseen; it failed again (`inked: 0`). Six
  copies on CI runners with the read instrumented failed in 3: the PNG decoded whole
  and the canvas read back its own pixels, but the `<img>` drew nothing. A
  `willReadFrequently` canvas had read it whole, so I blamed WebKit's GPU-backed
  canvas; six more copies with that fix and plain-canvas controls drawn in the same
  tick failed in 4, every canvas empty. The CPU read had worked only because it ran
  later: the `<img>` was complete, sized and decoded and still not drawable for a
  moment. Waiting until a draw left ink, six more passed, the old read empty in 2 of
  them; the wait took 12 to 25 ms. This container never failed it in seven runs.
  → Rule: before reading an image's pixels, wait until a draw of it leaves ink (a
  precondition; the claim is read after it), and keep what was read in the check's
  detail. When a failure shows only in CI, reproduce it there (a scratch branch
  whose own workflow runs the suite several times in parallel, the read
  instrumented), and try a fix with a control in the same tick, so a cause is told
  apart from a delay.
- **A state wait before a DOM read.** A hardening check waited on
  `ui.docRec.revision`, which `saveFix` sets before `refresh()` and `render()`, then
  read the banner from the DOM; it failed once in four runs on the #232 merge. My
  first fix waited on `#notice`, which only the unit screen draws, so it timed out
  on the lesson screen where the check runs. → Rule: when a check reads the DOM,
  its precondition must be a redraw made after the state it waits on (a
  `MutationObserver` that checks that state when it fires), never the state alone.
  Before waiting on an element, grep which view draws it. Reproduce the race by
  delaying the app's redraw, and show the old wait failing and the new one passing.
- **A fault injection that broke the syntax, not the rule.** To prove a date rule
  was guarded, I rewrote `s=>{…}` as `s=>true||{…}`. That made an object literal and
  a syntax error, and the suite's one FAIL was "no uncaught page error". → Rule: an
  injection must leave the code valid and change only the guarded behaviour (here
  `s=>true, unused=s=>{…}`). Read the FAIL lines it produces: only the checks that
  name the rule failing counts as proof.

- **A bound set to the screen's patience aborted real work.** #232 cut off
  every Memorizer write at 5 s, "the same 5 s the screen waits for a save".
  The screen's 5 s is when it says the save is still going, not when the save
  has failed. On the owner's laptop a first save took longer, and the import
  failed (#238 moved the bound to 30 s). → Rule: a timeout that aborts work
  needs headroom over the slowest legitimate case. When adding one, say what
  that case is and where it was measured. Never borrow a number that means
  something else.
- **A parser more correct than the one it replaced, and weaker.** I made the
  guard read quotes the way the shell does. That fixed reads the old
  quote-blind split let through, but it stopped judging `bash -c "make; cat x"`.
  The old split had caught that by cutting inside the quotes. AGENTS.md's
  "never weaken the guard" caught it before the push. → Rule: when replacing a
  guard's reading of its input, keep the old reading and refuse if either
  refuses, then list what the old one refused and prove each case is still
  refused.
- **A rule over a set, tested on its first members.** Codex's review of #240
  caught two of mine in one day:
  - leak-guard's image rule said it knew a renamed image "by its first
    bytes", while the extension list named ten formats and the bytes were
    read for five;
  - verify-csp read a srcset as one URL, so only its first candidate was
    judged.
  Each test exercised the first members and stopped. → Rule: when a rule or
  a comment names a set (formats, candidates, routes, spellings), write one
  case per member, disguised the way the rule claims to see through. Where a
  member cannot be covered, narrow the claim to the members that are.
- **A race between two real timers, judged by the scheduler.** My #232 check
  "a write is given time in proportion to the bytes it carries" held a write
  with a real sleep against the store's real bound. It passed here, in CI,
  and under my own load test (eight busy loops on four CPUs). It failed on
  the owner's laptop in a full run: "a 400-byte write held 150 ms was cut
  off". Session 01Nk4 reproduced it with three copies pinned to one CPU at
  nice 19, and moved it onto a clock the test turns (#242). → Rule: a check
  about which of two timers fires first owns the clock; with real timers the
  scheduler decides the result. And a load test that passes has not shown
  much: make it harsher (one CPU, low priority, copies side by side) before
  calling a timing check robust.

## Process

- **A debug copy that edited a different line than the one I then read.** To see
  why verify-voicescreen timed out, I replaced "line 163" in a copy, but an edit
  just before had moved the wait I meant; the state I printed belonged to another
  wait, I read it as "the condition was already true", blamed rAF polling, and
  pushed a 100 ms poll that passed 20 runs here by luck and failed CI. The real
  cause was in the app (a voice listener outliving its session). -> Rule: in a
  debug copy, anchor the edit on the line's text, not its number, and print which
  wait fired with the state; and treat "0 of N" on a flake as evidence only when N
  is several times the runs a failure took before.

- **A browser upgrade judged on Chromium alone.** I moved playwright 1.56 -> 1.64
  (released the day before) after a green local Chromium run; both CI WebKit jobs
  then hit their time limits still passing, because 1.64's WebKit 27.2 drew 2-3
  frames a second after the Memorizer loaded (memorizer-data: 63 s against 20 s on
  1.56 and 10 s on 1.63). -> Rule: before pushing a playwright bump, time one
  Memorizer suite in WebKit on the old pin and the new one (`npm i --no-save
  playwright@X`, `npx playwright install webkit`); a slower engine is a finding,
  never a reason to raise `timeout-minutes`.

- **A click that "did nothing" because it missed.** Firefox CI intermittently
  stayed on the lesson after "now memorise it" (phase teach, nothing logged). Reading
  the app's logic found nothing. A capture-phase click listener showed the click
  landing on `<main>`: lazily drawn figures and page thumbnails grew as the scroll
  brought them near, and the button moved after Playwright had aimed (#185); fixing
  the figures alone still failed on a thumbnail. → Rule: when a click changes
  nothing, record what it actually hit and where the target was at that instant
  before reasoning about handlers. Reproduce locally (`npx playwright install
  firefox`, or `npx playwright install --with-deps webkit` as CI does) and loop
  until it fails, rather than guessing from one CI log.

- **Handing the owner a retired command.** I gave `node scripts/build.js` (the
  retired patch chain) for a laptop build; it ran for four minutes and built an app
  that no longer matches `app/`. → Rule: before giving a build command, read what
  `npm run build` and `scripts/release-check.js` invoke today and give that.

- **Handing an agent a command its tools cannot run.** I asked a read-only
  reviewer (Read, Grep, Glob) to run `git diff`; it came back with questions and
  no verdict. → Rule: check the agent's `tools:` line first; give agents without
  Bash the diff inline or a path to it.
- **Pushing a fix the reviewer called optional or the reverse.** → Rule: a
  red-circle review comment, a failing Approvals row and a P1/P2 bot finding
  that reproduces are all work now; verify each before replying.
- **Claiming "all green" from part of a run.** → Rule: say which suites ran,
  which did not (the licensed `full` job always skips in CI), and what was not
  measured. A skipped step is not a pass.
- **Reading or quoting suite output that holds licensed text.** → Rule: grep
  for `FAIL` lines and stack traces; never paste a log or `tests/last-run.log`.
  A check's own detail is output too: print counts and ids, never a stem, an option
  or a run's shared words, since the owner pastes those lines here.
- **A command typed after another on one PowerShell line.** The owner's `git pull`
  ran as a continuation of the release-check line (`>>`), so a 90-minute run tested
  old code. → Rule: give each command its own block, and before a long run ask for
  `git log --oneline -1` and check the commit against the one just merged.
- **A pull on the wrong branch.** I told the owner to `git pull` and check for the
  merge commit, but not to switch to master first. The checkout was an old session
  branch, so the pull changed nothing, and the full run tested a tree 115 commits
  behind (`claude/new-session-t4ftue @ baaa1e2`). → Rule: hand the owner
  `git switch master` before `git pull`, and the exact `git log --oneline -1` line
  to expect; check the `checkout:` line of their run against it before reading any
  result.
- **Prose that leads the record.** → Rule: before editing a number in
  `README.md`, `docs/BUILD.md` or `verify.yml`, run `node tests/verify-stats.js`
  and find out whether it is guarded.
- **Doc sentence left behind by a behaviour change.** Firefox became a required
  CI engine and `docs/BUILD.md`, `package.json` and a skill still said two
  engines. → Rule: after changing what CI requires, grep the docs and the
  `.claude/` files for the old claim before pushing.
- **A clean merge that made a number wrong.** Two branches each moved the
  browser-free suite count from 86 to 87, for different suites. The lines were
  identical, so git merged them with no conflict, and the real count was 88. →
  Rule: after any merge, run `node tests/verify-stats.js` before pushing, even
  when git reported no conflict. A clean merge only means the lines agreed.
- **A cancelled job read as a red PR.** GitHub's hosted runners failed to start
  jobs ("not acquired by Runner of type hosted") or shut one down mid-step.
  → Rule: read the job's annotations and failed step before calling it a test
  failure; re-run once, and say so on the PR. Merge only on a run where every
  required job actually ran.

- **A test wrote to a path a probe returned, and the probe could return a real binary.** Making devtools-pure independent of browser install state, I created a stand-in file at whatever path `playwright.chromium.executablePath()` gave. With no real playwright, the test's own stand-in module answered with `process.execPath`, and the test tried to overwrite `/opt/node22/bin/node`; ETXTBSY stopped it. Rule: a test writes only under its own temp dir, checked with `path.resolve(p).startsWith(TMP + sep)` before the write, and never over a file that exists. Run a new fixture in every machine state it claims to handle (here: no playwright, playwright without browsers, with browsers) before trusting it.

- **A CI suite set chosen from too few runs.** I chose synthetic-webkit's set from
  two full WebKit runs, and the first run of the chosen set failed a suite that had
  passed both (theme: the sweep read the splash before WebKit's slow frames removed
  it). Frame starvation on a GPU-less runner (2 frames in 2.8 s, measured) makes any
  wait that leans on rAF timing a coin toss there. → Rule: before trusting a new
  browser job, run its suites at least three times and treat a single failure as a
  race to root-cause in the test, not as noise; print frame counts and wall time in
  a timing check's detail so the failing run says which cause it was.

- **A bake that re-derives its own address keeps the cost it was meant to remove.** The
  first pearl table named each pearl by paragraph and sentence index. It was proven
  correct and was faster in Node, but the owner's laptop profile showed `fromTable`
  still costing 0.64 s of the 0.77 s scan: reaching "paragraph p" meant cleaning the
  whole note, which was most of what the search had cost. My Node benchmark ran
  only the Arrhythmias notes (235, ~1 KB each), not the owner's full seed, so it
  under-weighted the walk. → Rule: when caching a computed answer, the cached address
  must be readable without redoing the work that found it (here, a raw character
  span rather than an index into a derived structure). Break the lookup itself into
  its steps and time each one before calling the cache done.

- **"The browser CRASHED the page" read as a test race.** synthetic-webkit's
  intermittent red on verify-selftest looked like the timing races above, and the
  crash point moved every run. It was neither memory nor the test: the kernel log
  on the runner (`sudo dmesg`) showed `trap invalid opcode in libWPEWebKit` for every
  crash, a WebKit release assertion in its compositor, fired by animated layers
  torn down mid-animation 24 times in a row. → Rule: when Playwright reports a
  crashed page, read `dmesg` on the runner before reading the suite, and isolate the
  trigger by switching ingredients off in a copy of the build across enough runs to
  count (PR #211: 14/24 crashed as built, 0/36 with motion off, 0/32 with the fix).

- **A handoff inherited a different browser.** A laptop task required Chromium but its command omitted --engine, so SYSTOLE_ENGINE could select Firefox or WebKit. → Rule: when a result requires a specific browser, pin it in the command and verify the flag wins over the inherited environment.

- **A push from a worktree rewrote the repository it was pushing from.** I used `git worktree add` to prepare the `rc` branch. Its pre-push hook ran the pure suites with `GIT_DIR` set, because git exports it to a linked worktree's hooks (and `rebase -x`, `bisect run` and `git -c` pass such variables on too). Two suites ran fixture git commands by cwd with the inherited environment. Sixteen fixture commits landed on `rc` and `core.bare=true` was set on the clone. The hook failed, so nothing was pushed, and I noticed only because `git log` showed commits by "t". → Rule: anything that spawns git for a throwaway repository must not inherit `GIT_DIR` and its siblings (`scripts/gitenv.js` strips git's own list of them for `test-public.js` and `verify.js`). After a hook fails, look at `git log` and `git config core.bare` before retrying.

- **Branch counts read from a shallow clone.** The cloud clone is shallow, so
  `git rev-list --count master..branch` reported 36 branches as 800 commits
  ahead and 241 behind: a "history rewrite" that was only the clone's depth.
  → Rule: run `git rev-parse --is-shallow-repository` before comparing
  branches, and `git fetch --unshallow` first if it says true.
- **"Merged" is not "unused".** A branch with no commits beyond master was a
  live session's working branch; a PR was opened from it minutes after I had
  listed it for deletion. → Rule: before deleting a branch, check open PRs,
  sessions working on it, and when it last moved; list, don't delete, anything
  that moved in the last day.
- **A result quoted from a different tree.** I wrote "verify-memorizer 486
  passed" into a commit message from a run on an earlier tree, before the tree
  had the check that commit added. I caught it before pushing. → Rule: a
  number in a commit message comes from a run of that commit's own tree; after
  any merge or patch, run again and quote that run.
- **A fix that refused the action left the fellow worse off.** A backup that
  a restore would refuse was counted as a backup; my fix stopped exporting it
  at all. Review caught that one bad record then left no copy of any book or
  note, and the reason showed in Settings, not on the Home reminder where the
  tap was. → Rule: before a fix refuses an action, say what the user is left
  holding if it does; prefer doing the action and not counting it, and show
  the reason where the user acted.
- **Three sessions fixed one report.** My findings report went to other
  sessions while mine was stopped by usage limits. Three of my unpushed fixes
  had landed from another session, theirs more thorough, and a second
  session's PR (#238) was open on my branch. I found this only because the
  owner asked me to check before I integrated. → Rule: before integrating
  work held back for a while, fetch; list every branch and PR that moved since
  its base; diff each held commit's files against them; and drop what has
  landed. Never push onto a branch another session is driving; wait for its
  PR, or ask.
- **A one-suite run read as a full one.** The owner pasted the last line of
  verify.js, "all green — master @ a48fec8 on chromium", from the one-suite
  run I had asked for. I told them it was a full green run that had rewritten
  the record. Every run whose chosen suites all pass ends with that line, one
  suite or all of them; their clean `git status` gave it away. → Rule: before
  saying what a run did, read the line near its top that counts the suites
  it chose ("1 suite" against "152 suites") and the "counts written" or
  "counts not written" line, or ask for them.
- **A cause guessed from the wrong setting.** The owner's full run recorded
  `jobs: 3`, and I told them three suites at once was likely part of why
  verify-memorizer passed its 20-minute limit. verify.js runs its SERIAL
  suites, memorizer among them, one at a time after the shared pool, so that
  suite had the machine to itself. → Rule: before naming a setting as a likely
  cause, read the code that applies it to the thing that failed.
- **An afternoon spent on a file an open PR was deleting.** Codex found
  another hole in the Claude guard's reader on #241, and I rewrote the
  reader, fuzzed it against bash and proved each check red. #244, opened
  before I started, removed the guard with the rest of the Claude Code setup,
  and merged while I worked; I learned it at the fetch before pushing. →
  Rule: before substantial work on a file, list the open PRs and the branches
  that moved since the base, and check whether any changes or deletes that
  file; if one does, ask before building on it.
- **An instrument that changed what it measured.** The result cache's tracer
  wrapped `fs.*` and `child_process.*` and dropped the properties node hangs on
  them: `fs.realpathSync.native` became undefined, and `promisify(exec)`
  resolved a string where it resolves `{ stdout, stderr }`. I found it by
  reading node's function table, not from a failing run. → Rule: a wrapper
  carries its target's name, length and own properties (`mimic()` in
  scripts/trace-inputs.js), and a test compares the whole surface with and
  without it.
- **A hook assumed to work in every engine.** The cache learns what a page
  loads from Playwright's request events. In Firefox they are not emitted for
  file:// at all (Firefox 155, Playwright 1.63), so a cache that traced Firefox
  would have missed every file a page loads and reused passes over edited
  pages. → Rule: hold such a hook with a suite that runs in each engine
  (tests/verify-suitecache.js), keep the cache off where an engine reports
  nothing, and print the checks that cannot be made as not measurable.
- **Negative checks that passed over an empty record.** The first run of the
  browser suite recorded nothing (I had required the tracer before setting the
  two variables it reads once, at load), and every "X is not recorded" check
  passed. Two cache checks also ran nothing, because a pass kept by an earlier
  section satisfied them. → Rule: a negative holds a positive from the same
  run, and a check about what a run kept starts from an empty cache and shows
  that the run measured first.
- **A wait written as the proposition.** The mock exam suite said "Resume opens
  the block" as `await onScreen(page, 'mock', …)` and went on to check what
  was on it. With Resume broken, `onScreen` timed out and threw: the run ended
  at that line, no check was named, and every later section went unrun. The
  same shape hid four other defects (the review not returning to the report,
  the report not opening from its card, a missing summary read as
  `mocks[0].n`). → Rule: when reaching the screen is what the check is about,
  ask `reached()` and `ok()` it, and skip the steps that need the screen
  rather than letting them throw; keep `onScreen` for a step that is only a way
  to get somewhere.
- **Two defences, each hiding the other's removal.** A block's clock is
  stopped when its screen is drawn away, and again by the next tick, which
  finds the screen gone. Taking out either left every check green, because the
  other did the same job a second later, and the check waited up to five
  seconds for the timer to be gone. → Rule: to test one of a pair, make the
  other do nothing (the timer's tick replaced by a no-op) and read at the moment
  the first should have acted; a check that waits for the effect cannot tell
  which defence produced it.
- **A timer waited out before the thing it guards is tried.** The Discard
  button asks again for five seconds, then goes back by itself. The test waited
  those five seconds and then pressed Resume, so a Resume that left Discard
  armed looked identical to one that did not. → Rule: when a check is about what
  an action does to a timed state, act inside the timer's window, not after it.
- **A negative that a blank screen satisfies.** "There is no #mockPanel" passed
  when the Progress screen failed to draw at all: the defect that put the panel
  there made its code throw. This is the rule of "Negative checks that passed
  over an empty record" again, in a screen instead of a record. → Rule: pair
  every "X is absent" with something that must be on the same screen.
- **A state set up by hand, so the check passes by hand.** The mock exam suite
  made Apex "open" by adding the class `ai-open`. The app's own buttons also
  hide the round button with an inline style, and a block took the class away
  and never gave it back, so after any block begun with Apex open there was no
  way to open it until a reload. The check "gives the search and the tutor
  back" read the button's display, which the test had never hidden, and
  passed. → Rule: set a state up with the function the user's tap calls
  (`toggleAI()`), not the class it leaves behind, and compare the state before
  and after.
- **Injection tests the checks; it does not find the bugs nobody tested.** The
  mock exam's shell code had about a hundred defects injected, and every one
  was caught once the checks were tightened. A reader who had not seen the
  checks, given only the diff, then found a dozen real problems in code no
  check reached: a quiz verdict left in the screen-reader live region, an
  enlarged figure carried to the next question, a held key picking and
  un-picking, focus dropped by every redraw, a last-question row 7 px wider
  than a phone. → Rule: before the injection round, give the diff to someone
  who has not seen the tests and ask what it does wrong; inject defects to
  prove the checks, not to find the faults.

## Flags and annotations (the second upgrade)

- **A fixture in a shape the app never writes fails when the shuffle says so.**
  The suite put a stroke on a question as `[[{x, y}]]`; the app writes
  `{t, c, p: [[x, y, pressure]], sz}`, and the question's canvas throws on the
  first. It passed whenever the shuffle did not draw that question and failed
  the layout sweep's "no page errors" when it did. → Rule: make marks with the
  tool that makes them (the pencil and a pointer), or copy the shape from the
  code that writes it, and assert the precondition (one stroke, two points).
- **A colour read mid-ease, or under the pointer, is not the state's colour.**
  `.btn` eases all properties for 180 ms and `.btn-flag:hover` colours the
  border: the "on" reading was half-way between two states and the "off" one
  was the hover state, so "looks different" failed for the right reason twice.
  → Rule: wait for the finite animations, move the pointer away, then read.
- **`hidden` loses to a class that sets `display`.** The badge beside a stem is
  shown and hidden with the attribute, and `.src-badge{display:inline-flex}`
  beat the browser's own `[hidden]{display:none}`. A check that read the
  attribute would have stayed green with the fix removed. → Rule: put
  `.x[hidden]{display:none}` beside the rule that sets display, and measure the
  box (`offsetWidth`) in the check, not the attribute.
- **A new `confirm()` is a decision, and the house answer is two taps.**
  verify-ui-pure pins the five dialogs by their text and fails on a sixth.
  Clearing every flag arms the button for five seconds and clears on the second
  tap, as the mock's Discard does; "nothing is flagged" is a toast.
- **A check that hedges is two checks that cannot fail.** `same(x, a) || same(x, b)`
  was written to avoid working out which; it passes for either, and for a
  defect that produces the other. → Rule: work the expected value out from the
  fixture; if two answers are possible, the fixture is under-specified.
- **On the synthetic bank a search returns no question for most words.** A
  reference note is scored at 2.1 times plus a coverage bonus and the search
  drops everything under 32% of the best score, so "pericarditis" returns notes
  and no question. A test that needs question hits uses a word no note holds
  (`arr`) and asserts that it got hits before it asserts what the hits show.
- **A suite ends with `})();` and nothing after it.** verify-engine reads the
  tail of every browser suite: a `.catch` of its own eats the rejection that
  `onDeath` is waiting to turn into a note.
- **Hit-testing is not the DOM, and `quiet()` only watches the DOM.** A change
  of screen starts a view transition (Chromium; WebKit runs with them off), and
  while it runs the page is not hit-tested: a pointer lands on `<html>` and the
  canvas under it never hears of it. The Annotations section reached its first
  pencil stroke 0.6 s after the screen change, inside the animation on CI's
  Chromium and after it on a slower machine, so the stroke was missing
  (`{n:0, pts:0}`) there and only there. → Rule: before a gesture, wait until
  `elementFromPoint(x, y)` is the element it is meant for, and make that a check
  of its own, so a canvas that is never there is named and not mistaken for a
  pencil that drew nothing.
- **A lookup of what the test may not find returns nothing, not a throw.**
  `at(C).none` threw when the list lacked C and ended the suite with a stack
  where the FAIL lines would have said why. → Rule: the helper returns an empty
  object, and the check that wants the row fails by name.
- **A change to what is stored runs every suite that reads the store.** The fix
  that kept flags in a restored record added a field to a record verify-backup
  compares byte for byte, and was pushed without running it; both CI engines
  failed it. → Rule: grep for the function (`importMarkup`,
  `validateAnnotationBackup`, `progressFromBackup`: verify-backup, verify-flags,
  verify-fsrs, verify-mockscreen) and run those suites before the push.

## Smarter Apex (the third upgrade)

- **A suite that cuts functions out of the shell breaks when a cut function
  gains a dependency.** `aiCtx` now calls `apexDid` and `apexStanding`;
  verify-memory-pure cuts `aiCtx` into a vm and failed with `apexDid is not
  defined`, a ReferenceError and not a FAIL line. → Rule: when a function that
  some suite cuts out starts to call another, extend that suite's cut in the
  same change (the harness, not the checks), and run every suite that cuts
  from the shell (`grep -l _appcut tests/*.js`).
- **A new check in a record-bound suite moves the label the record compares.**
  verify-memory-pure's 28 is written to `tests/test-stats.json` and quoted in
  the workflow; adding checks to it would make a label that disagrees with the
  record until the next full run. → Rule: new checks about new behaviour go in
  a new suite (listed in `PENDING_RECORD` until a full green run writes it),
  not into an old one whose number is pinned.
- **Anchor uniqueness finds a second definition before the browser does.** The
  first draft defined `examDaysLeft` again; the cut helper stopped with "anchor
  occurs twice", which was the only warning, since the later definition would
  have silently won in the page. → Rule: grep for a helper's name before
  writing it; the app has more than it shows.
- **A page function cannot see a Node variable.** `page.waitForFunction(n =>
  captured.length >= n, …)` read `captured`, which lives in the suite, and
  timed out for the wrong reason. → Rule: wait on page state in the page and on
  suite state in the suite (poll the Node-side array with a plain loop).
- **A probe must survive the defect it hunts.** Injected defects made the unit
  return nothing, so a check that read `.indexOf` on it threw and ended the
  suite with a stack instead of a named FAIL. → Rule: read the result through a
  guard that falls back to a value that fails the comparison (`['THREW']`, `''`),
  and compare against the exact expected string, never `!== undefined`.
- **A reading of the page that a render may still be replacing is a race.** The
  mock block's report and sub-line are written inside the view transition's
  update callback; a read right after the click saw the previous screen.
  → Rule: wait for the element the new screen owns (`#mockSub`, `.mock-report`)
  before reading anything on it, and make the wait a precondition, not the
  proposition.
- **Read which check names the defect, not only that one did.** With the key
  guard on "ask Apex" removed, the only FAIL was "the page threw nothing": the
  send went to a hosted route that a `file:` page cannot reach, so the console
  logged an error, and the check written for it ("nothing is sent") stayed
  green because the request never reached the stub. → Rule: after an injection
  round, list each defect with the check that failed; where it is a hygiene
  check, the designed check is blind. Here it now reads what a send leaves
  behind that a stub does not need to see, the prompt in the thread.
- **A click that waits for the element makes a missing element a crash.**
  `display:none` on the new button left Playwright waiting 30 s to click it and
  the suite ended in a TimeoutError with no FAIL line. → Rule: put "it is on the
  screen" (`offsetWidth`) in a check of its own, and click with a short timeout
  whose failure is swallowed, so the checks that follow name the consequence.
- **A guard the page can never reach is an equivalent defect: say so.** The
  `!S.answered` test in `apexDid` cannot be told from its absence, because
  `restoreQuizState` sets `S.selected` to null whenever `S.answered` is false.
  Chasing it would have meant a check on a state the page cannot be in. → Rule:
  hold it where the state can be made (the page-code suite builds it), and write
  the survivor into the PR rather than into a test that cannot fail.
- **Another row of the log can answer for the question.** A card rated in a
  review has two rows, the answer and the rating, and the rating is the later
  one; reading "the last row for this question" would give Apex the rating's
  time and none of the reason. The code looks the row up through `ANSWER_MODES`,
  but the browser suite never looked at a card again after rating it, so the
  injected defect survived. → Rule: name what counts as an answer, look the row
  up through it, and exercise the case where the wrong row is the later one.
- **A fact that is safe alone can give the key beside one the model already
  has.** Grounded mode was told which option the fellow chose and never whether
  it was right, and that sentence was checked to read the same either way. But
  the model already gets the ids of recent misses: "chose D", and the question
  not among the misses, is "D is the key". The independent read found it; my
  checks read the new line alone. → Rule: for anything grounded mode is told,
  ask what it adds to what the model already holds (Profile, the tools), not
  only what it says by itself.

## The iPad pass (the fourth upgrade)

- **A rule with a breakpoint is checked on both sides of it.** The text size
  scaled an option from 13 px only up to 380 px, but options are 13 px up to
  767; the suite measured 360 px, the one band where the factor was right, and
  stayed green while every phone in portrait and every Split View window got
  options up to 1.7 times larger. → Rule: find the breakpoints the rule depends
  on (`grep -n "@media" app/css/*.css` for the property) and measure a width in
  each band.
- **An entrance animation owns the transform.** The rail's `popIn` leaves
  `transform` at its last keyframe, so the column meant to be centred with
  `translateY(-50%)` sat from the middle down and ran off an iPad on its side;
  and a tap measured during the animation landed nowhere. → Rule: do not
  centre with a transform an animation also sets; wait for
  `getAnimations({subtree:true})` to finish as a precondition before measuring
  where something rests.
- **Replace a count only inside the label it belongs to.** A `sed` of
  "(43 checks)" to "(71 checks)" for the new suite also changed the Voice
  card's, which had 43 too; verify-stats stayed green because both suites are
  outside the record's comparison. → Rule: edit the one step by its run line,
  and read the workflow diff before committing.
- **Look at what lies on top, not only at what is there.** The reviewer of the
  composer asked for 44 px buttons; measuring the hit area from the centre
  outward found the pencil's rail lying over half of Send on an iPad in
  portrait, a defect no layout check had seen because each looked at one layer.
  → Rule: a tap target's check walks `elementFromPoint` across the target.
