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

- **Marking a PR ready at the moment of merging skips the Codex review.** Codex reviews when a draft is marked ready, and takes a few minutes. I marked #186/#187 (and later #194–#196) ready and merged in the same minute, so Codex's findings on #186/#187 arrived after the merge and needed a follow-up PR (#194). Rule: mark a PR ready as soon as its CI is running, wait for the "Codex Review Summary" to say Completed (or for its inline findings), and only then merge.

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
