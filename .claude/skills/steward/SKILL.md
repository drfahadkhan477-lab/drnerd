---
name: steward
description: This repository's conventions for opening and driving a pull request to green, read by the cloud session before it acts on CI or review events. Use when opening a PR, pushing to one, fixing its CI, answering its review, or writing its description.
---

# Stewarding a Systole PR

The rules in CLAUDE.md apply in full. This file is the order to apply them in
when a PR is open, plus the conventions that are only written down here. It
narrows nothing in the harness's PR rules; where the two seem to disagree,
the stricter one wins.

## Before every push

Run the checks CI's fast jobs run, and tail only the result lines:

1. `node --check` on every changed `.js` file.
2. `npm run steps` and `npm run suites`: both listings must still work.
3. `npm run test:pure`: every suite CI's `logic` job runs. The list is read
   from `.github/workflows/verify.yml`, so this and CI name the same set.
4. `node tests/verify-stats.js`: the counts quoted in prose still match the
   record and the workflow.
5. Commit through the pre-commit hook (`npm run hooks` if `git config
   core.hooksPath` is empty). It runs `scripts/leak-guard.js` on what is
   staged. Never pass `--no-verify`.

Then re-read the diff as a reviewer hunting for a hollow check
(`/prove-red` for any check you added or changed).

## Registering a new suite

A new `tests/verify-*.js` that needs no browser and no build goes in four
places, in one commit:

- `SUITES` in `scripts/verify.js`, with a comment saying what it guards.
- `PENDING_RECORD` in the same file. Never empty it: only a full green run on
  the owner's machine does that.
- A step in the `logic` job of `.github/workflows/verify.yml`, named with its
  check count.
- The pure-suite count in `README.md`, `docs/BUILD.md` and the workflow
  header. `node tests/verify-stats.js` derives it from the workflow and names
  each sentence that disagrees. Fix the sentences it names; do not hand-sum.

## What CI can and cannot tell you

- **`full` is always skipped in CI.** It needs the licensed export. Skipped is
  not green: a PR body never says the browser suites on the build ran unless
  the owner ran them.
- **`memorizer-browser`** runs the Memorizer in Chromium, WebKit and Firefox on
  documents the suite makes itself. A red one is this PR's to root-cause
  until shown otherwise, per the harness's CI rules.
- **Reading a failed job's log:** never paste it, and never quote it into a
  PR comment. Suite output can quote question text. Grep for the FAIL lines,
  page errors and stack traces. The `ci-log-reader` agent does this in its
  own context; per CLAUDE.md, use it only when the owner asks.

## Things that look like fixes and are not

- Editing `tests/test-stats.json`. It is machine-written on full green runs.
- Moving a threshold, a timeout or an expected count to turn a suite green.
- "Correcting" a count in prose that agrees with the record but not with
  reality. It is correct today and will correct itself on the next full run.
- Loosening a patch anchor in `scripts/build.js`'s chain so it matches.
  `patch()` matching exactly once is the whole safety model.
- Re-running a job and calling the second result the real one.

## Stacked PRs

When two PRs register a suite, they touch the same lines (`SUITES`,
`PENDING_RECORD`, the workflow, the counts). Stack the second on the first,
say so in the first line of its body, and name the merge order. When the
base merges, merge `master` into the stacked branch, re-run
`node tests/verify-stats.js`, and fix the counts it names.

## The PR description

Draft PRs. Sections, in this order, omitting any with nothing in it:

- **Why**: the gap, with the evidence that it is real.
- **What**: what changed, file by file if more than a few.
- **Found while building it**: what was found, including what came back
  clean, what you got wrong, and what you built and threw away and why.
- **What it does not claim**: the narrow statement of what the checks cover.
- **For you to decide**: anything left for the owner, with the one-line
  change that would do it.
- **Proven to fail**: the `/prove-red` table.
- **Records and counts**: `PENDING_RECORD`, the counts moved, and the
  results of the fast checks above.

## After a merge

Sync the working branch onto the merge commit and push it, so it is not one
commit behind its own remote ref.
