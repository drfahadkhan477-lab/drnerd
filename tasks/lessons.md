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

## Process

- **Pushing a fix the reviewer called optional or the reverse.** → Rule: a
  red-circle review comment, a failing Approvals row and a P1/P2 bot finding
  that reproduces are all work now; verify each before replying.
- **Claiming "all green" from part of a run.** → Rule: say which suites ran,
  which did not (the licensed `full` job always skips in CI), and what was not
  measured. A skipped step is not a pass.
- **Reading or quoting suite output that holds licensed text.** → Rule: grep
  for `FAIL` lines and stack traces; never paste a log or `tests/last-run.log`.
- **Prose that leads the record.** → Rule: before editing a number in
  `README.md`, `docs/BUILD.md` or `verify.yml`, run `node tests/verify-stats.js`
  and find out whether it is guarded.
- **Doc sentence left behind by a behaviour change.** Firefox became a required
  CI engine and `docs/BUILD.md`, `package.json` and a skill still said two
  engines. → Rule: after changing what CI requires, grep the docs and the
  `.claude/` files for the old claim before pushing.
