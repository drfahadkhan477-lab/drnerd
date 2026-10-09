# Claude Code laptop task: Runs only

This task is for the owner's Claude Code “Runs only” session with access to the Windows 10 laptop. It is prepared in the repository; this cloud session has no tool that sends it directly to that session. Private results remain **not run** until that session returns evidence.

Read AGENTS.md, CLAUDE.md and tasks/lessons.md. Stay on the assigned branch and preserve existing changes. Record branch, HEAD and working-tree status first. Runtime target: `400e1ae1232cd6ea0551caf6e40e182be86f2eae`, Memorizer build `2f5728796a54`. Confirm the target is in the tree being tested; do not silently label a different revision as this one. A documentation-only descendant is fine when its runtime files match. Use a safe fast-forward if appropriate; report a blocker instead of resetting work.

The owner confirms the repository and licensed export/build are already on the laptop. Use that existing source locally to build the code actually being tested. An older generated build is not validation of newer code. Use `npm run build` with the configured local export, or pass its existing local path. Capture build output in a gitignored/local log. Do not upload or quote the export, figures, raw HTML, question/answer text or raw build/test logs.

Run the complete private registry and split-build check on Chromium. Repository-pinned public tools/browser may be installed if missing. Use separate PowerShell statements:

```powershell
$memorizerRunDir = Join-Path $env:TEMP ('drnerd-private-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $memorizerRunDir | Out-Null
$memorizerReport = Join-Path $memorizerRunDir 'results.json'
$memorizerLog = Join-Path $memorizerRunDir 'private-run.log'
$ErrorActionPreference = 'Continue'
npm run test:private -- --pwa --report-json "$memorizerReport" *> "$memorizerLog"
$memorizerExitCode = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
```

Let the native command finish and capture its exit code. The temporary `Continue` setting avoids PowerShell treating redirected native stderr as a terminating error. A missing report or incomplete run is unverified even if no failed check is printed. Keep `private-run.log` and `tests/last-run.log` on the laptop. Windows does not supply the Linux WebKit/iPad result; mark that unrun.

Return only:

- exact tested commit/branch, build freshness, Node/Playwright/browser versions;
- native exit code and the report's selected, ran, passed and check totals;
- split-build result and failed, died, skipped or blocked suite ids;
- sanitized error category and code stack location for failures, with no licensed text;
- whether the run changed generated count metadata.

`--report-json` contains suite ids, tags, status, counts and timings without suite-output lines. Inspect that metadata for completeness before sharing it. Do not edit app code, thresholds, fixtures, guards or timeouts to force a pass. This is a runs-only assignment: no commits, deployments, merges, or generated-record/prose updates. Preserve any real failure evidence locally for a later bounded fix.

Physical iPad memory, Home Screen reopening and real model switching are separate trials in [IPAD-RUNSHEET.md](IPAD-RUNSHEET.md). Laptop results cannot establish their acceptance.
