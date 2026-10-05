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

## Process

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
- **Prose that leads the record.** → Rule: before editing a number in
  `README.md`, `docs/BUILD.md` or `verify.yml`, run `node tests/verify-stats.js`
  and find out whether it is guarded.
- **Doc sentence left behind by a behaviour change.** Firefox became a required
  CI engine and `docs/BUILD.md`, `package.json` and a skill still said two
  engines. → Rule: after changing what CI requires, grep the docs and the
  `.claude/` files for the old claim before pushing.
