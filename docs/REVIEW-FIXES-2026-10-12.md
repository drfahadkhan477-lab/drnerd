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
- Independent source/generator counts and question-order checks in PWA tests,
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

## Remaining restore finding completed

Restore now captures the current write ticket when its replacement is queued.
After commit it removes failure/latest entries only at or before that boundary;
tickets for newer queued writes remain. A refused replacement clears nothing.
This preserves the original ordering fix while retaining newer failed notes for
live reads, backup export and retry.

Native regressions cover both successful and refused replacement, inject a quota
failure into a newer queued note, compare the exact read/export payload, verify
old failure cleanup follows commit/rollback, and retry after removing the
refusal. All eight code findings from the review are now addressed. Device-only
acceptance items above remain unmeasured.

Validation of this final fix: the focused storage/backup pure regressions and all
89 pure suites passed. The complete Memorizer hardening suite passed 107 checks
in Chromium and 107 in WebKit, including the ten new native assertions. Staged
content and whitespace guards passed; the full browser registry and physical
iPad trials were not rerun for this bounded storage change.

## PR publication follow-up

The transport fixture now fixes its destination to the configured upstream and
refuses absolute, authority-form, backslash-host and malformed request paths.
Its regression verifies that none reaches a separate synthetic endpoint.

PWA completeness never uses the extraction manifest as its own oracle. The
normal runner passes the assembled source, synthetic URL-only runs regenerate
the independent fixture, and other URL-only runs require a source before
claiming completeness. Regressions reject a shortened bank with a matching
shortened manifest and check the runner's source wiring.

## Pending branch integration — 2026-10-13

PR #245's process lessons are already on master. PR #241 is integrated on a
separate branch to preserve the fresh setup: its deleted Claude hook and test
stay deleted, while the licensing guard, CSP checks and supported Node versions
are retained. Node 22 is the minimum; local defaults and CI select Node 24.

The licensing guard detects renamed BMP, TIFF, AVIF/HEIC and SVG files. It reads
the complete bounded SVG text and scans doctypes without regex backtracking,
honoring quoted brackets and comments. Namespace-prefixed SVG roots are checked
against their namespace declaration. These last two cases address the remaining
SVG review findings on #241. CSP source checks inspect every srcset and preload
candidate, with a regression for an external second candidate.

Focused validation on Node 24.19: licensing regressions 99 passed; CSP 26 passed
in Chromium and 26 in WebKit. The earlier measured private family records remain
historical results of their recorded commits; these selected checks do not
replace them or claim a new full private run. Physical iPad acceptance and live
model execution remain unmeasured. Old scratch branches are retained for diagnosis.
