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
- `lab/` and `src/lab/`: interactive learning tools.
- `tests/`: logic and browser suites. `scripts/verify.js` is the suite registry;
  `scripts/test-public.js` derives the public test run from the CI workflow and
  reuses a browser suite's pass when nothing it read has changed
  (`scripts/suite-cache.js`, `scripts/trace-inputs.js`).

## Start a task

1. Check the branch and working tree; preserve existing changes.
2. Read `package.json`, the affected source, and its tests. Use Node 22 or newer;
   `.node-version` and CI select Node 24.
3. Use `npm run doctor` to diagnose setup. Install pinned dependencies with
   `npm ci`; use repository Playwright browsers, not global packages.
4. State the intended behavior and choose a bounded change. Keep refactors
   separate from bug fixes unless they are needed for the fix.
5. One session per task. When the prompt names files and tests, start there:
   search for the exact symbol before reading, and read only the parts needed.
6. Use `npm test`, which reuses unchanged suites; keep `npm run test:fresh` for
   the cases listed below.
7. End with a handoff note of five lines or fewer: task, outcome, files
   changed, checks run (measured vs reused), and the next step.

Keep this guide short: it is loaded in full every session. Remove a rule when
the code stops needing it, and put long explanations in `docs/`.

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

`git push` runs the leak guard and then the pure suites (`.githooks/pre-push`,
installed by `npm run hooks`). On a loaded machine that can outlast a short
command timeout, so run a push as a background command rather than retrying it.

`npm test` does not measure a browser suite again when everything its last pass
read is byte-identical (`docs/BUILD.md`, "Reusing a pass"). It prints that suite
`REUSED`, never `PASS`, and its last line says how many were measured now. The
first run in a clone measures everything; after a change, only what the change
reaches, and restoring an edit finds the pass from before it, so an inject,
watch FAIL, restore loop re-measures only the suites the defect reaches. Report
that line as it stands ("N measured now, M reused"), keep reused suites apart
from measured ones as you keep the record apart from observed results, and do
not shorten it to "all passed". `npm run test:plan` says what
would run and why, and runs nothing. `npm run test:fresh` measures every suite:
use it for a release, a doubt, or a change to the cache or to Playwright or a
browser. CI always measures, and Firefox is not cached. Do not run the whole
browser suite to establish a baseline: CI measured the base commit, so read its
result and measure your change.

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
- **Step days by the calendar.** A local day is not always twenty-four hours,
  and `toISOString()` is the UTC day, not the reader's. Move a date with
  `setDate` (or by arithmetic on the `YYYY-MM-DD` string) and read it back with
  `FSRS.localDateToISO`; never add a milliseconds-per-day product to a local
  moment or slice its `toISOString()`. CI runs in UTC, where this is invisible,
  so its `logic` job runs the pure suites a second time under
  `TZ=America/New_York`. A suite that handles dates has not been checked until
  it has run in a zone whose clocks change.
- **A hover style is asked for only where a device can hover.** On a touch
  screen the element that was tapped keeps matching `:hover` until something
  else is tapped, so every `:hover` rule goes inside `@media (hover:hover)`
  (the primary input; `any-hover` is not a guard). `tests/verify-hover-pure.js`
  reads every shipped stylesheet, `tests/verify-taps.js` walks the Systole
  app's as the engine holds them, and both decide what a guard is through
  `tests/_hover.js`.
- **CSS newer than the floor is classified, and has its fallback.** A Safari
  older than a feature skips the declaration, or the whole rule that holds an
  unknown pseudo-class, and says nothing; a plain value written before a
  declaration with a `var()` in it is no fallback, because that one is judged
  when the page is drawn. `tests/css-floor-table.json` lists every feature the
  stylesheets use, and the scripts and pages write inline, with the first iOS
  Safari that reads it, and `tests/verify-floor-css-pure.js` fails on a use that
  is not in it, or whose row's claim (an `@supports not` rule after the rule,
  an older value before it, a split selector list, no use) is not so.
  `tests/verify-floor.js` draws the app with those features made unknown.
  `scripts/css-floor-table.js` writes a row; it needs MDN's
  browser-compat-data, which is not a dependency (`docs/BUILD.md`, "When a
  stylesheet uses CSS that the floor does not read").

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

“Claude may build from the licensed export and deploy it to my Access-protected systole Pages project.”

Finish with the changed behavior, validation results, remaining limits, and
the next useful step. Update this guide only when the working facts change.
