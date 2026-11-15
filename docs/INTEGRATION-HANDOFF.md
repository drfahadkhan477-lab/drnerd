# PR #342 integration handoff — 14 November 2026

**Resumed under the owner's targeted tap/WebKit instructions.** The circular
Apex hit-area fix and updated horizontal placement check pass in both engines.
WebKit's swallowed mock-screen click timeout has been reproduced in the pinned
CI container. Those fixes passed public validation and branch CI. The first private
gate exposed a separate short-portrait Pearl overflow. A bounded hero-height fix
now passes the targeted private regression in both engines. Fresh Chromium and WebKit both passed after the WebKit runtime prerequisites
were repaired. No deployment or merge into master has followed this correction.

## Source and changes

Worktree: `/workspace/drnerd-integration`; branch: `codex/integrate-home-and-claude`.
Preserve all existing worktrees, stashes, private inputs and generated evidence.

- Merged master `c45ea79ac9886b2d3001819c7a8db91d168956ae` in `6d95907`.
  Exactly the expected two files conflicted: `app/systole.html` and
  `docs/SHELL-MAP.md`. Kept master's complete short `streamReply` adapter and
  comment, regenerated the map, and observed `docs/SHELL-MAP.md is current.`
- Merged #340 at `082e816e491b5e227fe5cad661bb864067b56b42` in `0ad388e`,
  without conflicts. This includes D2 and the earlier private count record.
- The fix changes only the authorized condition in `ApexTurn.run`:
  `turn.incomplete||turn.finishReason==='MAX_TOKENS'`. ApexWire is unchanged.
  Gemini's existing `incomplete:finishReason==='MAX_TOKENS'` remains in the shell.
- Registered `verify-apexloop-pure` now propagates the scripted incomplete flag
  and checks both explicit true and false. Its workflow step label is 60 checks;
  no protected CI job name changed. The obsolete standalone completeness test
  was observed throwing `TypeError: ctx.streamReply is not a function`, then
  removed as requested. No history was rewritten.

## Negative evidence measured here

Each defect was deliberately applied to the ApexTurn condition, tested, and
restored. These are this session's observed target lines:

```text
FAIL  a turn that says only that it is incomplete, with no finish reason, is marked the same
FAIL  and one that says it is complete carries no mark
FAIL  cut off by the output limit, its words are kept and marked incomplete, and no notice is added
```

Restored: `60 passed, 0 failed`. The prepared commit message and full synthetic
logs are ignored under `build/integration-20261113/`; no raw logs belong in Git.

## Earlier measured public validation (before the tap/WebKit fixes)

Node 24.19.0 and `npm ci`. UTC and America/New_York each measured 83 pure suites
successfully, with 77 browser/split entries explicitly NOT run by those commands.
Both commands' literal final line was:

```text
  The suites that drive a real build need your export: npm run test:private
```

The leak guard's final line was:

```text
leak-guard: 421 file(s) checked, nothing licensed
```

Synthetic split-shell transferred size, gzip level 6 for index.html plus app.js:
**282,629 bytes against the unchanged 294,912-byte limit**. The owner's supplied
master comparison was 281,660 bytes; that baseline size was not remeasured here.

`npm run test:fresh` in Chromium was interrupted under the stop rule after
`verify-taps` failed. It produced 141 completed suite results: 140 passed,
1 failed, 0 reused. Those include 83 pure results and 58 browser results.
This is partial measurement, not a full-run success. It has no final verdict
line. The failure was:

```text
FAIL  on Home, Apex is in the rail under the three tabs, and takes a press anywhere within 21 px of its centre  → {"rail":[{"id":"aiFab","w":52,"h":52,"wrong":4}],"place":{"fabLeft":762,"fabTop":76,"tabLeft":475,"tabBottom":116}}
```

These earlier results are not certification of the current fixes. The subsequent
private worktrees and outcomes are described below. Earlier #340 private outputs
belong to a different source and remain preserved.

## Tap and WebKit diagnosis measured on 14 November

- The 52px circular tablet Apex keeps its appearance. Its `::before` now supplies
  a centered, transparent 44px square target on tablets and phones. The old
  `::before` was a 1px rail divider; `::after` was disabled and pointer-transparent.
  This explains why reusing those pseudos without replacing their rules failed.
- The original `under('#aiFab', 21, 21)` sampling and numeric hit requirements
  are unchanged. Placement now measures the button beside the horizontal tabs,
  inside the right viewport edge, with vertical overlap.
- Both deliberate defects (moving Apex to top:400px and shrinking the transparent
  target to 32px) produced this check's own line, then were restored:

```text
FAIL  on Home, Apex is at the top right beside the horizontal tabs, and takes a press anywhere within 21 px of its centre
```

- Restored `verify-taps`: Chromium `27 passed, 0 failed`; WebKit
  `27 passed, 0 failed`. Additional real-click probes hit all nine points at
  widths 375, 700, 834 and 1194 in both engines. The circular appearance remains.
- Historical CI had swallowed the original click rejection; its actionability
  log cannot be recovered. Removing that catch in a diagnostic copy reproduced
  `page.click: Timeout 4000ms exceeded.` in the pinned CI image with one CPU.
  It spent 3.1s reaching stable, then timed out during scrolling. No covering
  element was reported. This is a local constrained reproduction, not a claim
  that historical CI recorded those timings.
- Waiting only for DOM quiet, or for the view transition, did not reliably solve
  it. Those attempted changes were removed. The final test explicitly prepares
  the nested scroller with `scrollIntoViewIfNeeded({ timeout: 8000 })` instead of
  merely waiting for visibility. The real click retains `timeout: 4000`; its
  rejection is no longer swallowed. Neither timeout was increased, and no app
  animation or design was changed for this test.
- Three constrained replays with scroll preparation each reported `5 passed,
  0 failed`. The first took 1.9s to prepare and 0.26s to click. Full public
  validation finished in Chromium, then WebKit, never together.
  Complete mock-screen runs on intermediate readiness versions each reported
  `174 passed, 0 failed` in Chromium and WebKit; they are not final-source passes.
- Ignored evidence is under `build/taps-20261114/`. Raw logs do not belong in Git.

## Public validation at 49626c7, before the portrait correction

Full fresh Chromium and WebKit both completed successfully. Chromium
measured 159 suites, 0 reused, plus the split build, and printed:

```text
  all 159 no-export suites passed (83 pure, 76 in chromium, 74 of them on a synthetic build), and the split build made from it.
  The suites that drive a real build need your export: npm run test:private
```

WebKit measured 159 suites, 0 reused, plus the split build, and printed:

```text
  all 159 no-export suites passed (83 pure, 76 in webkit, 74 of them on a synthetic build), and the split build made from it.
  The suites that drive a real build need your export: npm run test:private
```

The split shell measured **282,673 bytes**, below the unchanged **294,912-byte**
limit (gzip level 6, index.html plus app.js). This supersedes the earlier size
measurement for the source before the tap fix.

At that source, the
New York pure run measured 83 suites successfully, 0 reused; its literal final
line was `  The suites that drive a real build need your export: npm run test:private`.
The final-source leak guard reported `leak-guard: 421 file(s) checked, nothing licensed`.
## CI, private regression and current integration

- Branch CI run `43587318438` at `49626c7` completed successfully; the private
  self-hosted job was skipped. It was a manually dispatched branch run, not PR
  certification. The PR's merge conflict prevented its automatic workflow.
- The private Chromium gate at that source failed Pearl's existing
  `744x1000: no pearl runs past its card` assertion. Running the same suite on
  pinned master `c45ea79` passed. The top tabs reserve vertical space which the
  old fixed hero height did not give back. This was not an Apex-turn regression.
- After the owner continued the proposed short-portrait correction, merged
  current master `d33cab5` in `ffcccd5`. Only the generated shell map conflicted;
  regenerated it and checked it is current. This includes the Results and Memory
  screen extractions and their public checks. The pinned failure-comparison
  baseline remains `c45ea79`.
- The CSS gives the Pearl more room by shortening the hero in compact portrait
  tablet windows, growing it again as height permits. It does not reduce the
  Pearl's type floor or change any test threshold. A synthetic visual check
  confirmed that the heart, ECG and both touch controls remain visible.
- Injecting the former hero height into the current private build reproduced
  the existing assertion's own failure, then restoring it passed the fit block
  in Chromium and WebKit. This targeted development check is not a full release
  gate. Safe numeric results are retained locally under `build/portrait-fix/`;
  licensed inputs and raw logs are never included in this handoff.
- All private input hashes matched before and after the development run.
  Removed its temporary worktree, build, source and content copies after testing;
  the original private inputs and every pre-existing worktree remain preserved.
  The development run did not rewrite the test-stats record.
- The first fresh WebKit run on this candidate stopped after 144 passing suites,
  with no failure line and no final verdict. Its process was absent after the
  connection gap; that run is incomplete, not a pass. A replacement fresh run
  uses the pinned Playwright container and Node 24, detached from the chat's
  command session. Its logs stay under `build/portrait-fix/webkit-recovery/`.
  That replacement subsequently stopped at the missing Python prerequisite
  described below; it did not complete the full run either.
- During recovery, origin/master advanced to `caafb4a` with the Rhythm Lab
  extraction. That change is not included in this candidate. Do not silently
  advance the source during certification; report mergeability against the newer
  master separately from the candidate's CI and private validation.

## Remaining sequence and model switch points

The combined source's fresh Chromium run completed successfully: **161 measured
now, 0 reused**, plus the split build. Its summary and literal final line were:

```text
  all 161 no-export suites passed (85 pure, 76 in chromium, 74 of them on a synthetic build), and the split build made from it.
  The suites that drive a real build need your export: npm run test:private
```

The split shell measured **282,848 bytes** against the unchanged **294,912-byte**
limit (gzip level 6, index.html plus app.js). The New York pure run measured
85 suites successfully, 0 reused. Its literal final line was the same export
notice above. The leak guard printed:

```text
leak-guard: 425 file(s) checked, nothing licensed
```

Replacement WebKit measured **146 suites now, 0 reused**: 145 passed and
`verify-figreview` failed its setup check before measuring its assertions. The
remaining 15 suites and split build did not run. Its literal final line was:

```text
  FAIL  verify-figreview                         exit 1  0.1s
```

The diagnostic was `Python is here but PIL is not`. `docs/BUILD.md` documents
Python with Pillow and numpy, and this branch's CI installs `Pillow==12.3.0`
and `numpy==2.4.6` separately from the pinned Playwright image. The recovery
container was missing that installation. No application assertion failed in
that suite, but this remains a failed, incomplete validation run. Stopped under
the owner's rule for an unexpected suite failure; no threshold, timeout,
expected count or skipped-test workaround was used.

A new fresh WebKit run with Pillow 12.3.0 and numpy 2.4.6 completed:

```text
  all 161 no-export suites passed (85 pure, 76 in webkit, 74 of them on a synthetic build), and the split build made from it.
  The suites that drive a real build need your export: npm run test:private
```

That run measured 161 suites now, 0 reused, plus the split build. Next, commit
and push the owned branch and wait for CI on that exact head. After CI passes,
use a new temporary worktree outside the checkout for the full private gate.
The corrected source has not yet been pushed, and its full private gate has
not started. The temporary private development worktree is already removed;
the original private inputs and all pre-existing worktrees remain preserved.

Recommended models and effort for the requested stages:

| Stage | Recommended model | Effort / switch point |
| --- | --- | --- |
| Merge reconciliation | GPT-6.1 Terra | High, when resolving merges |
| Apex regression and negative evidence | GPT-6 Astra | Extra high, before test design and defect injection |
| Public validation and CI | GPT-6.1 Terra | High, after regression evidence is complete |
| Unexpected failure attribution | GPT-6 Astra | Extra high, when a new blocker needs diagnosis |
| Private gate and final certification review | GPT-6 Astra | Extra high, only after public validation and CI pass |

These are recommendations, not claims that the chat's model was changed.
Do not integrate further master changes without a new instruction; the current
combined source includes master through d33cab5, and failure comparisons stay
pinned to c45ea79.
The private gate must use a fresh temporary worktree outside the repository,
Node 24 and `npm ci`, actual licensed inputs, and `npm run release-check`.
Upload nothing from it to GitHub. Do not commit its rewritten test-stats record;
report changed counts for the owner's decision. Compare a failing private suite
with master c45ea79 in that same temporary workspace, then delete the temporary
worktree and its outputs when finished. Do not deploy or merge #342 into master.

## Master integration — 15 November

Merged master `1a19b56aef9834b1952bce887b5b67426c15a5a1` in `0d80831`.
Only `docs/SHELL-MAP.md` conflicted; it was regenerated and checked current.
The prior 161-suite runs above measure the earlier candidate, not this merge.
Fresh public runs on the merged source, with Node 24 and the pinned browsers:

```text
  all 167 no-export suites passed (91 pure, 76 in chromium, 74 of them on a synthetic build), and the split build made from it.
  all 167 no-export suites passed (91 pure, 76 in webkit, 74 of them on a synthetic build), and the split build made from it.
  The suites that drive a real build need your export: npm run test:private
```

Each engine measured 167 suites now, 0 reused. The New York pure run measured
91 suites now, 0 reused, and ended with the same export notice. The leak guard
reported `leak-guard: 437 file(s) checked, nothing licensed`. The synthetic
split shell measured 283,720 bytes against the unchanged 294,912-byte limit.
These public results do not certify licensed content. Next: push the merge,
check CI on the pushed head, then run the private gate in a fresh temporary
worktree as specified above. Do not deploy or merge the PR.
