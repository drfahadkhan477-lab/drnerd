# Working on drnerd

Rules for any coding agent in this repository. Codex reads this file; Claude
Code reads it through `CLAUDE.md`. What the project is: `README.md`. How to
build and verify it: `docs/BUILD.md`. Each rule is here because it was broken
at least once.

## 1. Licensed content stays out of transcripts and out of git

The ACCSAP 12 export, and everything built or derived from it, is licensed:
`source/`, `content/` (with `content/refs-repo`), `build/`, `dist/` and
`tests/last-run.log`.

- Build from it and run suites on the build. Never read it as a document: no
  printing, grepping or quoting it, and never commit it in any form.
- Never paste suite output or CI logs whole; they can quote question text.
  Tail the result lines and grep for `FAIL`.
- Never put an API key or secret in source, a fixture, a log or a commit.
- Never weaken `scripts/leak-guard.js`, `.githooks/`, `.claude/hooks/guard.js`
  or their tests. Run `npm run hooks` once per clone, and never commit with
  `--no-verify`.

## 2. A check you have not seen fail is a check you have not written

This project's recurring bug is a check that passes without measuring
anything: `ok(label, true)`, a skipped step counted as a pass, a loop over
nothing, a probe compared against `undefined` (which a probe that never ran
also returns), a timeout in the wrong argument of `waitForFunction`.

- For every new or changed check: break the code it guards (never the check),
  watch that check's own `FAIL` line appear, restore, and see the same count
  pass. Put a table of what you broke and what failed in the commit or PR.
- If it stays green, narrow its comment. Never widen the test to fit the prose.
- Never move a threshold, timeout or expected count to turn a suite green.
- `tests/test-stats.json` is written by full green runs; never edit it by hand.
  `node tests/verify-stats.js` checks the counts in the prose: change only the
  sentences it names, and write no count of suites or checks it does not check.

## 3. Build and test

- `npm run build` fills the slots in `app/systole.html` from the export, the
  reference notes, `src/` and `assets/`. Edit `app/`, `src/` and `assets/`
  directly; never add a `*-patch.js` step or a find-and-replace build.
- No export needed: `npm test` (every suite CI runs) and `npm run test:pure`
  (no browser, no build: CI's `logic` job). With the export:
  `npm run build -- <export>`, then `npm run test:private`.
- Before every push: `node --check` on changed `.js` files, `npm run suites`,
  `npm run test:pure` and `node tests/verify-stats.js`.
- A new suite that needs no browser goes in `SUITES` and `PENDING_RECORD` in
  `scripts/verify.js`, and in a `logic` step of `.github/workflows/verify.yml`
  named with its check count. A deleted one goes in `RETIRED_RECORD`. Only a
  full green run on the owner's machine empties either list.
- Use the shared helpers: `tests/_source.js` to scan this repo's own source
  with its comments blanked (they quote the patterns being hunted),
  `tests/_render.js` for render waits, and the `--engine` flag rather than a
  suite launching a browser itself.
- The target is Safari on iPadOS 13.4 and later. Chromium is fast, not the
  truth about an iPad: use `--engine webkit` for anything iPad-sensitive.

## 4. Reporting

- Say what ran, what passed, what did not run and why. Skipped is not passed:
  CI's `full` job needs the export and never runs on a push or PR, and
  `scripts/ci-changes.js` can skip a browser job a PR cannot reach.
- Report what you found, including what came back clean and what you got
  wrong.
- Read `tasks/lessons.md` at the start of a session. After a correction, add
  the pattern and the rule that would have prevented it.
