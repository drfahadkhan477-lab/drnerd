# Memorizer fixes and validation

October 3, 2026. This follows the broad engineering review and the request to implement its fixes one by one. Changes are limited to Memorizer, its synthetic regression tests, and its standalone build script. The latest base-branch OCR recovery was merged and preserved.

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

## Validation

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

The next smallest validation step is a final-revision WebKit CI run followed by a real iPad test of a large multipart import, cancellation, backup rescue in memory mode, restore, offline update, model switching and keyboard/VoiceOver focus.

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
