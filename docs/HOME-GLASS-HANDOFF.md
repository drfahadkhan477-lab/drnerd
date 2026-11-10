# Systole glass homepage handoff — 10 November 2026

## Resume here

Repository: drfahadkhan477-lab/drnerd. Branch: `codex/home-glass-refinement`.
PR: https://github.com/drfahadkhan477-lab/drnerd/pull/339 (draft).
Read AGENTS.md first. Preserve dirty work, stashes, other worktrees, private
exports, notes, images and credentials. Memorizer is outside this task.
Fetch this branch into a separate worktree. Do not reset an existing checkout.

## Implemented

- Taller live physiological heart and separate responsive ECG lane.
- Quieter glass surfaces, reduced wording/borders, concise accessible controls.
- Compact expandable Pearl figure/caption band and actual study progress counts.
- Desktop heart density up to 3x with a four-million-pixel and hardware-size
  budget; touch remains capped at 2x. Mesh fingerprint matches source.
- Vector navigation selection motion; Pause, reduced motion, reduced
  transparency and forced-color behavior preserved.
- Sidebar replaced by centered horizontal tablet tabs; phones retain bottom
  tabs. Horizontal keyboard and ARIA behavior, reclaimed content width, Apex
  positioned separately at top right.
- Short landscape tablets use a four-column Brain chapter grid to recover the
  top-tab space without shrinking text or hiding content.

Main files: app/css/home.css, app/systole.html, src/core/heart3d.js,
tests/verify-home.js, tests/verify-homepager.js, tests/verify-crisp.js.
Earlier source commits: 9a93357 (glass/HD), e0708ec (navigation).
The commit containing this document includes the final Brain layout correction.

## Measured validation — distinguish revisions

Before sidebar removal, seven affected synthetic suites passed 401 checks in
Chromium and 401 in WebKit; required CI passed at 9a93357. A synthetic 3840x2160
preview was captured with reduced motion and view transitions disabled only
in the screenshot harness. This is image-resolution evidence, not device FPS.

Negative old-artifact checks failed for anatomy/rhythm separation and the new
renderer density/budget (old renderer 2.5x and 8.75 million backing pixels).
The old sidebar also failed horizontal placement and reclaimed-width checks.

After sidebar removal, tests exposed stale vertical-axis and 80px rail
assumptions, which were corrected. The real remaining failure was 61px Brain
scroll overflow at 1024x768. Before the final CSS correction that assertion
failed in both engines. With the correction, four affected suites passed
211 checks per engine: Home 68, typography 12, accessibility 19, homepager 112.
These final runs used synthetic content and the exact corrected CSS.

Other measured checks during this work: CSS floor 142, hover 21, record
consistency 54, heart mesh 39, high-density rendering 8 per engine; licensing
guard clean. They were not all rerun after the final CSS-only correction.
Earlier concurrent runs stalled in Home settling; isolated and sequential
runs passed without changing timeouts or tolerances. Do not call failed or
interrupted runs passes. Do not hand-edit tests/test-stats.json.

## Release state and remaining work

This redesign is NOT deployed and has NO final private certification.
PR #339 should remain unmerged until the final checks and release process are
completed. Verify CI for the new head; older green CI does not cover it.

Production remains the certified PR #338 release:
source f5b41c603a4f8da28697707d1dc1c847070603d2;
Cloudflare deployment 2c756f03-c292-40c7-bd51-db96bac0a549;
https://systole-9hq.pages.dev . It includes progress-count/pause corrections
and accessible Pearl sources. Prior production gate measured 7245 Chromium
and 7241 WebKit checks (158 suites each), plus 130 PWA/Worker/offline checks.

Next:
1. Inspect final source diff and current CI; inspect tablet portrait/landscape,
   phone safe areas, enlarged text, Apex placement, themes and focus order.
2. Run required public validation using synthetic content and Node 24/pinned
   dependencies. Read verifier help and registry before selecting options.
3. Obtain the owner's licensed export and complete refs separately. Hash them.
   Build and run the private gate in a fresh isolated worktree at the final SHA.
   Regenerate PWA and validate the actual dist; never use an old certification.
4. User already authorized deployment to existing Cloudflare Pages `systole`,
   production branch `main`. Preserve Access, Gemini secrets and SITE_KV.
   Deploy only certified dist, verify canonical source/deployment and Access,
   verify artifact content counts, then complete PR/merge/post-merge checks.
5. Authenticated live reading and physical-iPad performance/offline update
   remain unmeasured; state that limitation accurately.

The superseded cloud private gate at 9a93357 was interrupted intentionally
when the sidebar design changed; its logs were preserved. It is not certified.

## Private assets and cross-account limits

Cloud-only input location: /workspace/drnerd/build/private-recovery/complete.
Owner laptop: C:\Users\Fairy\drnerd.
Required files: source/ACCSAP_12_super_v12.html, content/refs,
content/refs-images. Last verified set: 774 files (export + 49 refs + 724 images),
639 release questions. Counts do not replace hash verification.

GitHub contains neither licensed content nor credentials. Another account
cannot automatically access this workspace or Cloudflare authentication.
Transfer licensed assets privately or use the existing laptop checkout;
authenticate Cloudflare separately. Never commit licensed content, raw private
logs or secret material. Never run clean:private. Keep the old laptop on light
manual/device work; use cloud compute for browser suites and certification.

## Design direction and research

Use glass as a navigation/control layer, quiet reading surfaces, visible
navigation labels and brief state transitions. Do not auto-advance Pearls.
Full captions and original medical-figure fidelity remain important.

Sources consulted:
- https://developer.apple.com/design/human-interface-guidelines/materials
- https://developer.apple.com/design/human-interface-guidelines/tab-bars
- https://developer.apple.com/videos/play/wwdc2025/219/
- https://www.nngroup.com/articles/tabs-used-right/
- https://linear.app/now/behind-the-latest-design-refresh
- https://webflow.com/made-in-webflow/glass

Optional later work, not implemented: further distinction between Pearl view
selection and study actions; measured physical-device thermal/FPS behavior;
Apex grounding/stream recovery and durable hosted usage limits. These are
recommendations, not claims of completed fixes or exhaustive review.
