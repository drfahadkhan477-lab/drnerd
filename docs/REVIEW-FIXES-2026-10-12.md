# Review fixes, updated to master

The review branch was updated from `770f4cd` to `c6f12d9`. Current master
already includes fixes for recovery snapshots, nested progress records, bank
generation collisions, image CSP restrictions, splash observation, and PWA
corpus/image assumptions. Those upstream implementations and their additional
storage protections are retained.

This follow-up adds:

- Actual-calendar validation for daily keys and SRS dates, and validation of
  resume indexes and answer maps before backup import writes anything.
- Regressions for concurrent bank replacement at one timestamp and deletion
  recovery from a known complete snapshot, including clearing the final entry.
- Independent source/manifest counts and question-order checks in PWA tests,
  with a compressed transfer comparison and the existing absolute shell budget.
- A forwarding-origin fixture that cuts actual network transport, independently
  checks that requests fail, and exercises the unchanged service worker in both
  engines. Cache readiness uses the existing Promise-aware `resolved()` helper;
  no missing observation or literal success is counted as a pass.

Validation after the update: 89 pure suites passed. Backup checks passed 86 in
each engine; bankstore passed 33 in Chromium and 32 in WebKit; CSP passed 24
and splash passed 14 in each. The synthetic PWA run completed with 116 passed
in Chromium, and 115 passed plus one explicitly unmeasured check in WebKit.
The fresh synthetic assembly/extraction/PWA build, staged-content guard and
whitespace checks also passed. These are selected checks, not the complete
61-suite browser registry.

Only synthetic content and public repository assets were used. Browser checks
require the repository-pinned Playwright browsers. Physical iPad/Home Screen
reopening, Firefox, licensed-export parity and live API/model access remain
outside this verification. WebKit heap measurements must be reported as
unmeasurable when the browser cannot provide them.

The separate restore failure-bookkeeping finding remains open: replacement
clears tickets for newer queued writes, preventing rescue/retry after a quota
failure. Its next bounded fix should scope cleanup to the replaced state and
test native failure, export rescue and retry.
