# Systole Agent Instructions

These instructions apply to Codex and other coding agents working in this repository.

## Project goal

Systole is an iPad-first cardiology board-review PWA. The long-term engineering goal is to make normal development, testing, and deployment independent of a laptop-local Chromium installation and independent of the licensed ACCSAP export.

## Non-negotiable safety and licensing rules

- Never commit, print, upload, embed, or recreate licensed ACCSAP question-bank content or figures.
- Never weaken `scripts/leak-guard.js`, `.githooks/pre-commit`, or their tests.
- Never add `content/`, `build/`, `dist/`, `source/`, ACCSAP exports, private question-bank JSON, or licensed generated artifacts to Git.
- Never expose API keys or secrets in client-side source, logs, fixtures, tests, commits, or CI output.
- Never turn a skipped or unmeasured check into a passing result.
- Never remove provenance, schema, backup, service-worker, or WebKit/iPad guards simply to make a test green.

## Architecture direction

Normal public engineering should converge toward:

```text
src/ + synthetic fixtures + public assets
        -> build
        -> GitHub CI
        -> Chromium/WebKit/Firefox checks
        -> deployable PWA shell
```

Private licensed content should remain a separate path:

```text
licensed/private source
        -> private ingestion
        -> normalized private corpus
        -> local/private Systole storage
```

The current patch chain is legacy application assembly and must be preserved until equivalent behavior is proven. Do not rewrite Systole from scratch.

## Primary target

- iPad/iPadOS Safari/WebKit is the primary runtime target.
- Chromium is useful for fast CI but is not the source of truth for iPad behavior.
- Preserve offline-first behavior and installability as a PWA.

## Before changing code

1. Read the relevant existing source and tests first.
2. Identify the invariant the existing code is defending.
3. Prefer the smallest change that preserves that invariant.
4. Add or update a regression test for any bug fix or behavior change.
5. Run the narrow affected tests first.
6. Run all source-independent regression tests that are practical in the environment.
7. Report anything that could not be tested and why.

## Testing rules

- Prefer pure/unit tests for logic that does not require a browser.
- Use synthetic, non-licensed fixtures for CI browser/PWA coverage.
- Do not make public CI depend on the ACCSAP export.
- Keep WebKit coverage mandatory for iPad-sensitive behavior.
- Do not depend on globally installed packages; use repository dependencies.
- Do not reduce existing assertions merely because a refactor changes implementation details.

## Change discipline

Do not:

- mass-reformat unrelated files;
- rename broad parts of the repository without need;
- migrate frameworks only for modernization;
- delete patch scripts before parity is demonstrated;
- alter licensing boundaries as a convenience;
- commit generated private build output;
- replace fail-closed behavior with warnings;
- bypass a failing test without documenting the reason.

Prefer:

- small reviewable commits;
- explicit schemas and data contracts;
- deterministic/reproducible builds;
- atomic writes and atomic build output replacement;
- structured test metadata instead of hard-coded suite knowledge;
- test-only bridges rather than production globals when browser tests need internals.

## Commands to understand first

Read `package.json`, then use the repository's own commands. Common source-independent checks include:

```bash
npm run suites
npm run leak-guard
```

Do not assume `npm run build` is available in a clean cloud environment: the build intentionally requires the private ACCSAP source.

## Codex task style

For architectural work, handle one bounded migration step at a time.

Good task:

```text
Create a synthetic non-licensed fixture corpus and make one browser suite run against it in CI without changing private build behavior.
```

Bad task:

```text
Rewrite the whole app architecture and remove the patch chain.
```

For each task, finish with:

- changed files;
- tests run;
- tests not run;
- remaining risk;
- next smallest recommended step.
