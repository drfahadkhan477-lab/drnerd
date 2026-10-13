# Working on Systole

Systole is an iPad-first, offline-capable cardiology study PWA. Public development
must work with synthetic fixtures; the licensed question bank stays private.

## Current architecture

- `app/systole.html` and `app/css/`: the application shell and styles.
- `src/`: shared logic, visualizations, and worker code.
- `scripts/assemble-app.js`: fills the shell's payload, source, and asset slots.
  The legacy patch chain has been retired; use the assembler.
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

## Boundaries

- Never print, commit, upload, or recreate licensed question text or figures.
  Keep `source/`, `content/`, `build/`, and `dist/` out of Git.
- Preserve `scripts/leak-guard.js`, Git hooks, provenance, schema validation,
  atomic storage/restore behavior, service-worker guards, and their tests.
- Keep credentials out of client source, fixtures, logs, and commits.
- Preserve offline behavior and the supported Safari floor. Use synthetic
  fixtures for public CI and browser tests.
- Do not count skipped, unavailable, or unmeasured checks as passing. Keep
  recorded test results distinct from newly observed results.

Finish with the changed behavior, validation results, remaining limits, and
the next useful step. Update this guide only when the working facts change.
