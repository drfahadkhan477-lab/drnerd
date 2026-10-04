# Memorizer fixes and validation

October 3, 2026. This follows the broad engineering review and the request to implement its fixes one by one. Changes are limited to Memorizer, its synthetic regression tests, and its standalone build script. The latest base-branch OCR recovery was merged and preserved.

## Completion status — October 4

The implementation and follow-up fixes are complete and merged: [#116](https://github.com/drfahadkhan477-lab/drnerd/pull/116), [#126](https://github.com/drfahadkhan477-lab/drnerd/pull/126), and [#127](https://github.com/drfahadkhan477-lab/drnerd/pull/127). The final Memorizer merge, `fd3abd3`, passed Chromium, WebKit, logic, syntax, build-guard and CodeQL checks. The subsequent `master` revision `84da234` also passed all source-independent CI jobs ([run](https://github.com/drfahadkhan477-lab/drnerd/actions/runs/37168903989)). A separate repository change, #128, removed the checked-in CodeQL workflow after the Memorizer work; GitHub still reports CodeQL checks on this report's PR.

The sections below record validation at each stage. Firefox offline validation and final-revision WebKit CI are resolved. Local WebKit remains unavailable because system libraries are missing, but CI WebKit coverage passed. One earlier Chromium run lost its page context near the end of the main suite; the final merge and subsequent `master` passed that suite, so this remains an intermittent observation rather than a reproduced application defect.

The remaining acceptance work needs a real iPad: import a large synthetic multipart book, cancel an import, export/rescue a backup in temporary-memory mode, restore and verify it, reopen offline, switch real on-device models, and check keyboard/VoiceOver focus. Device memory use, a physical network toggle and browser-to-CDN CORS/TLS were not measured here. The 32 MiB Node backup experiment below used 576 MiB peak RSS; it does not establish a safe iPad backup size. The next step is that device trial, followed by a smaller-memory backup format if its measurements warrant one.

## Changes, in review order

| Finding | Result |
| --- | --- |
| Binary fallback | ArrayBuffers and typed views survive memory put/get; reads and writes do not share caller-owned objects. Native IndexedDB storage remains the primary path. |
| Section deletion | Document, session, cards, packs, notes and checks are remapped together; surviving section identities remain stable. |
| OCR corrections | Source revisions advance; affected learning state, cards, packs, checks and retrieval vectors are invalidated together. |
| Failed saves | Retained payloads are retried exactly. Unrelated saves cannot acknowledge them. Failed atomic actions explicitly require repeating that action. |
| Grounding | New generated graded questions complete a literal source quote with a valid page and a unique supported answer. Facts memorised from generated lessons must be extractive; generated notes are labelled for comparison with the source. Obvious negation, comparator and unit contradictions are screened. |
| Blocked database | Late open success cannot falsely report persistence; unused connections close and version changes close old connections. |
| Draft loss | Drafts, focus and caret survive redraws; programmatic dictation reconciles with the input model. |
| Navigation races | Older document-open results cannot replace a newer selection or reopen a screen after navigation away. |
| Partial imports / recuts / deletion | Bounded changes use multi-store transactions. Long book imports stage records and clean failure/cancellation; abandoned stages older than 24 hours are cleaned on startup. Rejected recuts retain the old manifest in memory. |
| Multipart order | Edition numbers cannot override trailing page ranges or explicit part numbers. Users see sizes, review/reorder parts, and see filename gap/overlap hints before import. |
| Card metadata | Repeated mistakes update learning fields while preserving stored scheduling history and hazard flags. |
| PDF loading | Worker verification fails closed; parsed documents, canvases and evicted resources are released. |
| Offline caching | Cached shell recovers from eligible HTTP errors; pinned dependencies survive shell updates and asynchronous cache writes retain worker lifetime. |
| Local models | Startup is deduplicated, model identity checked, switching unloads prior engines, and failed cache deletion is reported. |
| Practice / checks | First misses enter persisted weak-card remediation without an extra scheduler review; empty checks are guarded. |

Additional improvements: versioned binary-preserving backups with checksums, preview and atomic replacement; pending failed writes included in exports; storage estimates and persistence requests; cooperative import cancellation; OCR worker shutdown; visible-image PDF rendering with coalesced requests and a bounded cache; reusable search indexes built in a disposable worker; standard radio keyboard behavior; visible speech-service privacy disclosure.

## Validation for the original review

All fixtures were synthetic. No private licensed-content build or fixture was added.

- `npm run test:pure`: 68 suites passed, including binary fallback with and without native structured cloning, blocked-open ordering, transactional cleanup, source evidence, backup corruption, PDF/model/service-worker failures, and OCR fault recovery/queued shutdown.
- `NODE_USE_ENV_PROXY=1 node tests/verify-memorizer.js`: 479 Chromium checks passed after merging the latest OCR recovery.
- `node tests/verify-memorizer-hardening.js`: 63 Chromium checks passed after that merge. Includes deletion/reload, correction invalidation, exact note retry, atomic restore rollback, pending-note export, navigation races, drafts/caret, practice/reload, failed recut, import cancellation/preview, worker indexing, radio keys and voice disclosure.
- `npm run memorizer`: standalone build passed.
- `npm run leak-guard` and `git diff --check`: passed.
- Local WebKit launch was attempted and blocked by missing GTK/Graphene/WOFF/Harfbuzz/Hyphen/Manette/GLES libraries: **zero local WebKit checks passed**. CI results must be assessed on the final pushed revision, not earlier successful PR runs.

Not run locally: Firefox, real iPad/Safari/VoiceOver, real WebGPU model switching/downloads, platform speech-service traffic capture, device memory measurements on very large books, full real deployment/update scenarios, the unrelated Bankstore browser suite, and private licensed-content builds.

## Remaining limits and next step

Source quotes establish an extractive completion, not medical correctness or a valid clinical vignette. Generated explanatory notes and analogies still require comparison with the source. Older saved generated learning material is not automatically audited against these new rules; regenerate it before relying on it.

Memory fallback remains temporary; closing/reloading loses it unless exported. Backup export/restore expands binary data into JSON/base64 in memory, so very large backups need a device benchmark and may exceed memory. Restore replaces all study records after a preview; keep the prior export if rollback is needed. Provider keys and model downloads are excluded, but books and personal notes remain sensitive and must be kept privately.

Cancellation stops between pages and before the final commit; a currently executing PDF/OCR page can still take time to finish. The render cache is bounded, but full PDF extraction, page text and visible images still consume memory. Worker indexing falls back to the existing main-thread implementation when workers are unavailable. Startup cleanup deliberately leaves recent staged imports alone to avoid deleting another tab's active import.

Final-revision WebKit CI subsequently passed. The remaining device validation is described in the completion status above.

## October 4 follow-up: large binary backups

PR [#116](https://github.com/drfahadkhan477-lab/drnerd/pull/116) merged after its final Chromium and WebKit CI checks passed. This follow-up includes the subsequent `master` updates through `19ae1ed`; their study-import and model work is preserved.

Stress testing exposed a separate restore failure: the repeated base64 regex exhausted V8's regex stack on an 8 MiB payload. A constant-stack alphabet/padding scan now accepts the same base64 syntax while retaining checksum, schema and atomic-write checks. The pure regression failed with `RangeError: Maximum call stack size exceeded` when run against the pre-fix module, and passes with the fix. Malformed payloads with valid checksums still reject without altering saved bytes.

The browser backup flow now exports and restores an 8 MiB synthetic payload and compares every byte. The skipped-question test uses the existing recall helper to wait for the asynchronous transition before starting its drill assertions; no scoring or skip assertion was removed.

The newly merged study-import suite also needed to scroll its lazy SVG into view before waiting for visibility in Firefox. Its existing image, sanitizer, strict-mode and import assertions remain intact.

Local checks on the updated branch:

- `npm run test:pure`: 77 suites passed; its six browser suites were explicitly excluded.
- `node tests/verify-memorizer-hardening.js`: 64 Chromium checks passed.
- `SYSTOLE_ENGINE=firefox node tests/verify-memorizer-hardening.js`: 64 Firefox checks passed.
- `NODE_USE_ENV_PROXY=1 SYSTOLE_ENGINE=firefox node tests/verify-memorizer.js`: 483 checks passed.
- Firefox study-import: 69 checks passed; Firefox data-protection: 18 checks passed.
- `npm run memorizer`, `npm run leak-guard`, and `git diff --check`: passed.
- A separate synthetic Node v24.19.0 experiment exported/restored 32 MiB with an exact full-byte comparison: 42.67 MiB JSON, 1,901 ms export, 1,251 ms restore, and 576 MiB peak process RSS from a 28 MiB baseline. These measurements are from Node, not Safari or an iPad.

Local WebKit remains unavailable because its system libraries are missing; PR #126's mandatory WebKit CI subsequently passed on its final revision. Real iPad/Safari/VoiceOver, real WebGPU models, private licensed-content builds and large-book device memory measurements were not run. The memory expansion of JSON/base64 backups remains a risk; the next bounded step is an iPad memory benchmark and then a lower-memory backup format if needed.

At this stage, Firefox offline preparation failed to cache CDN dependencies in this environment, including a repeat with Node's environment proxy enabled; its later cache comparison could not run. PR #127 resolved the harness failure as described below. CodeQL initially failed because repository code scanning was disabled, then its rerun passed on #126's final revision. The later removal of the checked-in CodeQL workflow was a separate repository change; CodeQL checks still appear on later PRs.

Follow-up files: `memorizer/src/backup.js`, `tests/verify-memorizer-backup-pure.js`, `tests/verify-memorizer-hardening.js`, `tests/verify-memorizer.js`, `tests/verify-memorizer-studyimport.js`, and this report. The list below records the original merged review.

## October 4 follow-up: offline checks across engines

Both Chromium and WebKit CI runs passed on PR #126's final revision, `881473fe2df832626220bb6b04570b65917c2a85`. Its CodeQL rerun passed too.

The Firefox offline failure came from the harness: Playwright implements the experimental service-worker request interception in its Chromium backend. The generated test worker now delegates only its CDN network boundary to a local HTTP fixture server. The production worker's fetch handler, pinned-host predicate, cache keys and cache writes remain intact; the delegated native fetch retains the original Request's integrity metadata. The fixture uses the actual public pinned dependency bytes and prevents browser HTTP caching.

The suite now rejects incorrect bytes without caching them, proves the changed upstream response with an uncached probe, compares every cached reader byte, cuts the dependency transport's sockets, and verifies that cached readers and Mermaid require no upstream request. These assertions run on every engine, replacing the unmeasurable WebKit offline-emulation checks with a controlled transport outage. A mutation that bypassed the generated worker's cache failed four assertions, establishing that the fixture cannot conceal a broken cache path.

WebKit also reports page errors for the two intentionally rejected fetches. The test accepts only the exact pair of diagnostics for each known URL; any other page error still fails the suite.

Checks: 12 Chromium and 12 Firefox offline checks passed; 77 pure suites, standalone Memorizer build, leak guard and whitespace checks passed. Both Chromium and WebKit CI runs passed on #127's final revision, `6403975`, and on the merged `master` revision, `fd3abd3`. Local WebKit remains blocked by missing system libraries. No real iPad network toggle, browser-to-CDN CORS/TLS behavior, WebGPU operation or private licensed-content build was measured by this test. The existing full app suite covers direct PDF loading; a real iPad offline/large-backup trial remains the next device validation step.

This follow-up changes only `tests/verify-memorizer-offline.js` and this report. No production app or shared dependency change is required.

## October 4 follow-up: bounded binary backup conversions

The version 1 backup codec now converts PDF bytes in chunks: at most 8,190 binary characters for an encode call and 10,920 base64 characters for a decode call. Encoding uses complete three-byte groups and decoding uses complete four-character groups, so existing backup files, typed-view offsets and padding remain compatible. The full syntax scan still precedes decoding, and checksum/schema validation and atomic replacement remain intact.

The regression enforces a 64 KiB conversion-input budget on an 8 MiB export/restore and compares every restored byte. It fails against the previous codec because export submits the entire PDF as one binary string. Independent Node base64 fixtures cover empty data, both padding cases and chunk boundaries, rather than only comparing the codec with itself.

Local validation: the focused backup regression, all 80 pure suites, all 64 Chromium and all 64 Firefox hardening checks, `npm run memorizer`, leak guard and whitespace checks passed. Local WebKit launch again failed before any check because system libraries are missing; the PR's mandatory WebKit result must be assessed separately. No real iPad, WebGPU model or licensed-content build was tested.

Exploratory Node v24.19.0 processes exported/restored the same synthetic 32 MiB file with exact byte comparisons. Fallback-checksum peak RSS was 510.7 MiB before and 457.1 MiB after; SHA-256 peak RSS was 576.3 MiB before and 585.5 MiB after. These process measurements vary with allocation and garbage collection; they do not demonstrate lower overall memory for every path. This change bounds temporary conversion strings, while snapshots, JSON/base64 strings and atomic restore still consume memory proportional to the full backup. A real iPad trial remains necessary before setting a backup size limit or selecting a new format.

Follow-up files: `memorizer/src/backup.js`, `tests/verify-memorizer-backup-pure.js`, and this report.

## Changed files

- `memorizer/index.html`
- `memorizer/src/backup.js`
- `memorizer/src/book.js`
- `memorizer/src/coach.js`
- `memorizer/src/ground.js`
- `memorizer/src/indexer.js`
- `memorizer/src/llm.js`
- `memorizer/src/ocr.js`
- `memorizer/src/pack.js`
- `memorizer/src/pdf.js`
- `memorizer/src/session.js`
- `memorizer/src/store.js`
- `memorizer/src/study.js`
- `memorizer/src/ui.js`
- `scripts/build-memorizer.js`
- `tests/verify-memorizer-backup-pure.js`
- `tests/verify-memorizer-book-pure.js`
- `tests/verify-memorizer-chunk-pure.js`
- `tests/verify-memorizer-ground-pure.js`
- `tests/verify-memorizer-hardening.js`
- `tests/verify-memorizer-pack-pure.js`
- `tests/verify-memorizer-provenance-pure.js`
- `tests/verify-memorizer-runtime-pure.js`
- `tests/verify-memorizer-session-pure.js`
- `tests/verify-memorizer-store-pure.js`
- `tests/verify-memorizer-study-pure.js`
- `tests/verify-memorizer.js`
- `memorizer/REVIEW.md`
