# Working on Systole

Systole is an iPad-first, offline-capable cardiology study PWA. Public development
must work with synthetic fixtures; the licensed question bank stays private.

## Current architecture

- `app/systole.html` and `app/css/`: the application shell and styles.
- `src/`: shared logic, visualizations, and worker code.
- `scripts/assemble-app.js`: fills the shell's payload, source, and asset slots,
  from the export or a bank folder (`docs/CONTENT-SCHEMA.md`). The legacy patch
  chain has been retired; use the assembler. `scripts/build-bank.js` makes a
  bank of your own from reviewed study files, `scripts/import-bank.js` one
  from a licensed bank's CSV or JSON export (`docs/OWN-BANK.md`), and
  `scripts/which-bank.js` keeps ACCSAP's corrections to ACCSAP's bank.
- `memorizer/`: PDF and study-file learning app, with its own storage and backup.
- `lab/` and `src/lab/`: interactive learning tools.
- `tests/`: logic and browser suites. `scripts/verify.js` is the suite registry;
  `scripts/test-public.js` derives the public test run from the CI workflow.

## Start a task

1. Check the branch and working tree; preserve existing changes.
2. Read `package.json`, the affected source, and its tests. Use Node 22 or newer;
   `.node-version` and CI select Node 24.
3. Use `npm run doctor` to diagnose setup. Install pinned dependencies with
   `npm ci`; use repository Playwright browsers, not global packages.
4. State the intended behavior and choose a bounded change. Keep refactors
   separate from bug fixes unless they are needed for the fix.

## Validate changes

Add a regression for a bug fix, and run the affected suite first. Then use:

```sh
npm run test:pure       # source-independent logic checks
npm run leak-guard      # licensing guard over tracked files
npm run suites         # registry and suite descriptions
npm test               # public browser checks with synthetic content
SYSTOLE_ENGINE=webkit npm test
```

Browser checks require `npx playwright install chromium webkit` and the host
libraries those browsers need. WebKit is required for iPad-sensitive changes;
Chromium alone does not establish iPad compatibility. Report unavailable
measurements and checks that did not run, with their reasons.

Use `npm run test:prepare` to download and verify the pinned public reader
libraries, then `SYSTOLE_TEST_READERS_OFFLINE=1 npm test` to exercise the public
run without downloading those libraries during browser scenarios. This mode
does not disable the app's requests or replace the real parsers and OCR engine.

`npm run build` and `npm run test:private` require the owner's private export.
For public build checks, use `scripts/synthetic-export.js` with the assembler;
see `docs/BUILD.md`. Keep isolated test builds from overwriting private output.

## Checks and records

The code's comments cite these rules; each was broken at least once.

- **A check you have not seen fail is a check you have not written.** This
  project's recurring bug is a check that passes without measuring anything.
  It has come in these disguises: `ok(label, true)`; a skipped step counted as
  a pass; a timeout in the wrong argument of `waitForFunction(fn, arg,
  options)`; a scan of a field the data does not have; a probe compared against
  `undefined`, which a probe that never ran also returns; a fixer with the same
  blind spot as the lint it fixes; a test whose input a later build step
  rewrites. For every new or changed check, inject the defect it claims to
  catch, watch that check's own `FAIL` line, restore, and put the evidence in
  the commit or PR.
- **When a check stays green, narrow its comment.** Never widen the test to fit
  the prose. Never move a threshold, timeout or expected count to turn a suite
  green.
- **Prose follows the record.** `tests/test-stats.json` is written only by full
  green runs (`scripts/record.js`), never by hand. `tests/verify-stats.js`
  checks the counts quoted in `README.md`, `docs/BUILD.md` and
  `.github/workflows/verify.yml` against it, so a checked number that disagrees
  with reality is correct until the next full run. If you write a sentence
  containing a number, guard it or do not write it: a guard with a hole in it
  is worse than no guard, because the green around an unguarded sentence reads
  as coverage of it. `PENDING_RECORD` and `RETIRED_RECORD` in
  `scripts/verify.js` list suites added or deleted since the record was written.
- **Scan this repository's own source through `tests/_source.js`**, which
  blanks comments and keeps positions and lines. The comments quote the
  patterns being hunted, so a scan that reads them reports the warning as the
  bug.
- **Wait with `tests/_render.js`.** A wait is a precondition, never the
  proposition under test. `render()` swaps the DOM inside an async
  `startViewTransition` callback, a gap that has caused suite races again and
  again.

## Boundaries

- Never print, commit, upload, or recreate licensed question text or figures.
  Build from the export; never read it as a document. Keep `source/`,
  `content/` (with `content/refs-repo`), `build/`, and `dist/` out of Git.
- Suite output, CI logs and `tests/last-run.log` can quote question text: tail
  their result lines and look for `FAIL`; never paste them whole.
- Preserve `scripts/leak-guard.js`, Git hooks, provenance, schema validation,
  atomic storage/restore behavior, service-worker guards, and their tests.
- Keep credentials out of client source, fixtures, logs, and commits.
- Preserve offline behavior and the supported Safari floor. Use synthetic
  fixtures for public CI and browser tests.
- Do not count skipped, unavailable, or unmeasured checks as passing. Keep
  recorded test results distinct from newly observed results.

Finish with the changed behavior, validation results, remaining limits, and
the next useful step. Update this guide only when the working facts change.
