# Branch and PR overlap review

Observed 2026-11-01 04:33 PKT.

Snapshot based on fetched master `9605a0aafeecf242fdc8a4d047c749b36041222c`.
Git refs and GitHub PR metadata were checked together. This is a snapshot, not live branch ownership; fetch and compare again before future work. The bounded GitHub event feed is not a complete push audit log, so current fetched head SHAs are authoritative here.

| Branch | Head | Behind / ahead of master | Review and action |
|---|---|---|---|
| `ccr-4a586d2b-55rh9m` | `396a4654` | 15 / 0 | Ancestor of master; no unique commits to integrate. |
| `claude/bank-swap-rollback` | `dd28940c` | 256 / 1 | Old rollback commit dd28940 is not an ancestor, but its functionality already landed as da9808d with broader failure coverage. Preserve master’s implementation. |
| `claude/exciting-fermi-330ukl` | `b63984b3` | 0 / 1 | PR #328: independent removal of overridden Atlas CSS rules. Leave its CSS work separate. |
| `codex/apex-local-first` | `22ef69bc` | 2 / 5 | PR #325: distinct local study actions, explanation reuse and Gemini error handling. Reserve app/systole.html, verify-chat and verify-gemini for that work. |
| `codex/apex-quality` | `4990bbe4` | 5 / 5 | PR #322 stacked on #319. Its work was incorporated in release #323; quality docs, evaluation script and fixture match master. Reopening this old stack would overlap delivered work. |
| `codex/atlas-reference-home` | `12a9d729` | 5 / 16 | PR #318 was incorporated through release #323. Its original branch still diverges and the PR reports conflicts; retain later master fixes rather than merging this branch again. |
| `codex/master-audit-fixes` | `dc408e79` | 0 / 2 | PR #329: current audit branch; Apex worker, ZIP/bank validation and runner diagnostics. The proposed mock-clock change adds no shared files with other open PRs. |
| `codex/quiet-atlas-tablet` | `1d797e46` | 23 / 7 | Historical precursor: this head is an ancestor of codex/atlas-reference-home. Review it through the later Atlas/release history rather than as independent fresh work. |
| `codex/unified-settings` | `b8652bc7` | 20 / 9 | Historical Settings/Atlas variant. It is not patch-identical to the later Settings release; inspect any remaining differences individually rather than treating the whole branch as new work. |
| `codex/unified-settings-release` | `75ce6fc6` | 5 / 2 | PR #319 was incorporated through release #323. Settings documentation matches master; master additionally includes later regression coverage and fixes. |
| `master` | `9605a0aa` | 0 / 0 | Protected integration branch; verified remote head for this snapshot. |

## Open PRs

| PR | Base | Changed-file overlap with audit work | Disposition |
|---|---|---|---|
| [#318](https://github.com/drfahadkhan477-lab/drnerd/pull/318) | `master` | None in this snapshot | Delivered through #323; superseded draft closed during completion. |
| [#319](https://github.com/drfahadkhan477-lab/drnerd/pull/319) | `master` | None in this snapshot | Delivered through #323; superseded draft closed during completion. |
| [#322](https://github.com/drfahadkhan477-lab/drnerd/pull/322) | `codex/unified-settings-release` | None in this snapshot | Delivered through #323; superseded stacked draft closed during completion. |
| [#325](https://github.com/drfahadkhan477-lab/drnerd/pull/325) | `master` | None in this snapshot | Distinct pending feature; avoid its frontend/tool-action edits. |
| [#328](https://github.com/drfahadkhan477-lab/drnerd/pull/328) | `master` | None in this snapshot | Independent CSS cleanup; leave separate. |
| [#329](https://github.com/drfahadkhan477-lab/drnerd/pull/329) | `master` | Current audit PR | Current audit work. |

## Commit review evidence

- Release PR [#323](https://github.com/drfahadkhan477-lab/drnerd/pull/323), merged as `f6d63d0`, explicitly combines Settings `75ce6fc`, Apex quality `4990bbe`, and Atlas `12a9d72`. Original commit ancestry alone would misleadingly mark that work as unmerged because it was integrated into a release commit.
- The current master retains the exact Apex quality documentation, evaluation script and grounding fixture from the quality branch. Settings documentation and Atlas artwork also match their release inputs; later master fixes must be preserved.
- The independent rollback commit `dd28940` changes `scripts/bank-folder.js` and its build-bank regression suite. This audit deliberately leaves those paths alone.
- Our pushed commits `6be8dab` and `dc408e7` are on PR #329. Follow-up mock timing changes are confined to `src/core/mockexam.js` and `tests/verify-mockexam-pure.js`; comparison against every other fetched branch found no changes to either path in their branch diffs.

## Integration boundaries

Keep new audit fixes on PR #329. Do not cherry-pick the old Settings, Atlas or grounded-evidence stacks wholesale, duplicate the pending bank rollback fix, or change the frontend actions reserved by #325. Review old drafts for administrative closure separately; the initial audit left those records intact. Completion subsequently closed the already-delivered drafts, while retaining their branch refs.

## Continued audit finding

A delayed mock-exam tick could charge a question beyond the deadline while `finish()` clamped only the block total. The regression reproduces an inconsistent per-question report. The tick now charges only the time remaining in the block, preserving the existing untimed-clock and inactivity-gap rules. The pure suite demonstrates the original failure and the corrected totals; browser integration is checked with synthetic content in Chromium and WebKit.


## Completion of the remaining work

The unfinished feature work is integrated on `codex/finish-pending-branches`:
Apex local actions, safe explanation reuse and actionable provider errors from
#325, plus the independent CSS cleanup from #328. Master’s later key-redaction,
Settings, and grounded-context-budget fixes are preserved.

The bank rollback branch required no new implementation: `da9808d` already
provides rollback and broader failure controls on master. Its original older
commit was not reapplied. The build-bank regression suite passes on the retained
implementation. The previous interpretation of that branch as pending work was
corrected by comparing implementation and tests, rather than commit ancestry.

Historical Atlas/Settings branches contain precursor implementations and old
validation records. The paused/empty Home, expanded figures, active headings,
unified Settings and grounded-evidence behavior are present in current master;
those stacks are not being merged over newer fixes. Their branch refs remain
available as history. Superseded drafts #318, #319 and #322 were closed because
release #323 already delivered their work. PRs #325, #328 and #329 remain open
until the combined integration is accepted into master.


## Integration test correction

The final WebKit Home check exposed a measurement race in the existing ECG
regression: rhythm rotation resets the monitor clock, so subtracting its values
can report negative elapsed time even while the canvas draws. The check now
counts canvas paint calls across a forced rhythm reset. It still requires no
painting in the hidden illustration view and actual painting in the visible
view. An injected hidden-ECG defect is used as the negative control; application
motion guards are unchanged.


## Provenance UI integration

The local-action feature reused the reference strip’s visual classes. That made
an existing reference-isolation check count local buttons as stale evidence.
The rendered groups now carry distinct semantic markers for local actions and
reference sources, while keeping their shared styles. The isolation check
measures the source group, verifies that the current thread’s source pills
really are counted, and verifies that local actions remain available. Disabling
the per-thread evidence filter remains the negative control, so this does not
hide a real provenance leak.
