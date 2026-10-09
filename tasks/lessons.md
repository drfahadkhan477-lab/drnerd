# Lessons

Read this at the start of a session. Add an entry after **any** correction from
the owner or a reviewer: the pattern, then a rule that would have prevented it.
Keep entries short and keep them true — prune one that stops being so.

Format: `- **Pattern.** What went wrong. → Rule: what to do instead.`

This file is for rules about how to work. Facts about the code belong in the
code's own comments; facts the whole project must obey belong in `CLAUDE.md`
(and only after the second time).

## Checks

- **A check that never ran.** A retry test passed because it entered the code
  below the path it claimed to cover (`readImage()` for a scanned-PDF fix; the
  review bot caught it, the author did not). → Rule: name the entry point the
  user hits, and call *that* in the test. Then inject the defect and watch the
  check fail before trusting it (`/prove-red`).
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

- **A stub in the wrong provider's wire format.** verify-chat opened the panel on
  Gemini and fed it OpenAI-shaped stream lines, which Gemini's reader skips. The
  "tool step" never ran and no reply was ever appended; the composer checks passed
  on rebuilds that happen anyway. → Rule: a stubbed reply must be in the shape of
  the provider the test selects, and the test must wait on something only the
  stubbed reply can produce (its text in the panel), so a skipped stub times out.

- **A click that "did nothing" because it missed.** Firefox CI intermittently
  stayed on the lesson after "now memorise it" (phase teach, nothing logged). Reading
  the app's logic found nothing. A capture-phase click listener showed the click
  landing on `<main>`: lazy figures grew 324 px as the scroll brought them near, and
  the button moved after Playwright had aimed (#185). → Rule: when a click changes
  nothing, record what it actually hit and where the target was at that instant
  before reasoning about handlers. Reproduce locally (`npx playwright install
  firefox`, or `webkit` plus `install-deps`) and loop until it fails, rather than
  guessing from one CI log.

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

## Process

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
