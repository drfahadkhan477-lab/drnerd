# Systole work map

Use this guide to pick up work from another account. [ROADMAP.md](ROADMAP.md)
defines the work. GitHub PRs hold the source, decisions, and validation for
each change. A session can recover what another account pushed and documented.
Work left only in a chat, a laptop checkout, or an unpushed cloud worktree
needs a handoff from that account.

## Claim and hand off work

1. Read [AGENTS.md](../AGENTS.md) and the roadmap for the task. Fetch
   `origin/master`, check [open PRs](https://github.com/drfahadkhan477-lab/drnerd/pulls)
   and `git worktree list`, and compare the intended change with master.
2. Pick one owner for each branch and PR. Record the account or session alias
   in the PR description. Give review and investigation to other sessions as
   needed. Let the owner apply and push changes. Open a draft early so other
   accounts can see the assignment before starting work.
3. Use a separate worktree for each task. Continue an existing PR when its
   goal matches. Bring master in with a merge when reconciliation is needed.
   Preserve other worktrees, dirty edits, and stashes.
4. Record the base and head SHAs, the files in scope, the CI run, and the
   observed checks. Copy the verifier's measured and reused counts as printed.
   Keep failed, skipped, and interrupted runs distinct from successful ones.
5. Hand the merge or release to a single named coordinator. The coordinator
   checks the PR ordering, pins the source SHA, and rechecks the production
   commit after deploy. A private gate belongs to the commit it measured.

Use a section like this in each active PR or handoff:

```text
Task / owner alias / PR / branch
Base SHA / head SHA / affected files
Status and CI link / measured now / reused / checks still pending
Decision, blocker, or dependency / next action and its owner
Release only: tested SHA / gate verdict / live SHA / deployment URL and ID
```

Public CI uses invented content. Keep licensed exports, reference material,
raw private logs, API credentials, and Access tokens in the owner's authorized
workspace. Share only permitted source, safe counts, and artifact provenance.
See [BUILD.md](BUILD.md) and [RELEASE-GATE.md](RELEASE-GATE.md).

## Work to pick up

Snapshot taken on 21 November 2026. Refresh the PRs and master before using
these statuses to make a merge or release decision. The models below are
recommendations for Codex. Switch effort when the work changes as shown.

| Work | Where to continue | Model and effort |
| --- | --- | --- |
| A3 grounded Apex evaluation | [#399](https://github.com/drfahadkhan477-lab/drnerd/pull/399), `codex/apex-offline-scoring`. Capture invented requests, verify the mocked runner, and retain criterion-level review. Live sampling requires the owner's approved request budget. | GPT-6.2 Sol High for the runner and checks. Switch to GPT-6.2 Astra Extra high for rubric or evidence judgments. |
| A2 Gemini cache measurement | [#400](https://github.com/drfahadkhan477-lab/drnerd/pull/400), `codex/apex-cache-usage`. Reads raw per-case reviews produced by #399. Use existing saved reviews first. Missing counts mean savings are unmeasured. | GPT-6.2 Sol Medium for the CLI. Switch to GPT-6.2 Sol High for prompt assembly and measurement design. |
| A1 provider seam, then A4–A6 | Keep A1 separate from #399 and #400. Reassess citation or retrieval follow-ups once A3 exposes a measured need. The owner decides F9 provider and data-use terms. | GPT-6.2 Astra High for adapters, grounding, and retrieval. |
| Home, Pearl, and D5 | Home redesign is merged through [#396](https://github.com/drfahadkhan477-lab/drnerd/pull/396). Keep the heart live as requested. Remaining D5 work docks Apex in the tablet pencil rail and handles text clearance while scrolling. Compare #339 and #342 against current Home before salvaging code. | GPT-6.1 Terra High for visual checks at iPad and phone sizes. Switch to GPT-6.2 Sol High for behavior regressions. |
| Apex answer-limit behavior | [#333](https://github.com/drfahadkhan477-lab/drnerd/pull/333) and [#342](https://github.com/drfahadkhan477-lab/drnerd/pull/342) overlap. Check current Apex turn behavior and fixtures before opening a narrow follow-up. | GPT-6.2 Sol High. |
| Study engine | S4 is merged through #358 and #360. [#384](https://github.com/drfahadkhan477-lab/drnerd/pull/384) merged S5 calibration, S6 interleaving, S7 readiness intervals, and initial S8 circulation. Official S7 weights are owner-supplied. S2 exam-date scheduling and S9 usage review are separate work. | GPT-6.2 Astra High for S2 scheduling. GPT-6.2 Sol Medium for S9. |
| S8 circulation follow-up | [#394](https://github.com/drfahadkhan477-lab/drnerd/pull/394) owns the valve and normal-cycle changes. Keep physiology validation with that PR. | GPT-6.2 Astra Extra high for model and validation. |
| Architecture | E1 screen extraction and E2 delegated actions and split CSP are merged. Use the generated [shell map](SHELL-MAP.md) for current dependencies. | GPT-6.2 Sol Low for lookup. |
| E3, E4, and browser reliability | Check [#397](https://github.com/drfahadkhan477-lab/drnerd/pull/397) for shard timings before starting E4 analysis. [#398](https://github.com/drfahadkhan477-lab/drnerd/pull/398) owns the reference-pager timing fix. E3 workflow refactoring preserves required job names. | GPT-6.2 Sol Medium for CI log review. Switch to High for workflow changes and flake diagnosis. |
| E7 encrypted backup | Separate feature branch. Review the envelope, iPadOS compatibility, and atomic restore with the owner. | GPT-6.2 Sol High for implementation. Switch to GPT-6.2 Astra Extra high for cryptography review. |
| D1 theme tokens | Separate task for script colors and the new-literal lint. Verify the look in both engines. | GPT-6.2 Sol Medium for token moves. GPT-6.1 Terra High for visual comparisons. |
| Private release and suite record | [#370](https://github.com/drfahadkhan477-lab/drnerd/pull/370) is merged. [#374](https://github.com/drfahadkhan477-lab/drnerd/pull/374) records an earlier candidate and should be reconciled only after a current run. Production `systole` on Cloudflare Pages was observed at `adb50ee`. Confirm the report for the chosen SHA before running another gate. `APEX_DB` was unbound at last check. | GPT-6.2 Sol High to operate the gate. Switch to GPT-6.2 Astra Extra high for unexplained failures or certification review. |

The release coordinator can assign parallel reviews of Apex and physiology.
Keep one owner for the shared workflow files and one for production deployment.
