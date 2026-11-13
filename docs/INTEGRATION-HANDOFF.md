# Combined branch handoff — 13 November 2026

Continue on `codex/integrate-home-and-claude`, in a separate worktree.
Read AGENTS.md first. Preserve private inputs and all existing worktrees.

Fetched master remains af0e384437d3196e88c3a1ff3a2c7efa3db6775a.
This integration combines these existing PR branches without changing them:
- #339 `codex/home-glass-refinement` at ee944c9054747fea29f823a885701ff1b2fa69f9:
  glass/HD homepage, horizontal navigation and final Brain fit correction.
- #341 `claude/e1-shell-map-first-moves` at b791631 (full SHA in merge parent):
  shared modules and generated shell map; includes #340's review/roadmap,
  phone Apex placement, first-visit study action, study-card creation,
  Safari retention messaging and optional Worker D1 rate limiting.
- #333 `codex/apex-answer-completeness-local` at 6decda0:
  output-limit status and regression coverage.

These are local integration merges, not merges of the original GitHub PRs.
No deployment or external resource configuration has changed.

The Apex merge overlapped newer finishReason handling. Preserve the new module
structure and descriptive warning, expose both finishReason and incomplete,
and retain partial-answer state when either interface indicates a limit.
The imported regression failed before the compatibility fix and passed after.
The shell map was regenerated and its freshness check passes.

Validation is running locally under build/integration: pure suites in UTC and
America/New_York, then public synthetic Chromium and WebKit sequentially.
The standalone completeness regression and licensing guard pass. CI on the
source Claude branches passed, but does not certify this combined branch.
Consult current logs/exit files and integration CI before claiming completion.
No private certification exists for this combined source.

Next: resolve combined-source failures without loosening assertions, review
phone/tablet navigation and preserved study state, obtain green integration CI,
then run the private release gate against the actual licensed export in a fresh
isolated worktree. Production deployment remains authorized to systole/main
only after certification; preserve Access, Gemini secrets and SITE_KV. Optional
D1 support does not authorize provisioning or replacing production bindings.
Keep all licensed inputs and raw private logs outside GitHub.

Earlier homepage-only evidence and private asset requirements are retained in
HOME-GLASS-HANDOFF.md. ROADMAP.md contains Claude's remaining work; its historical
status is not evidence of validation or deployment of this integrated source.
