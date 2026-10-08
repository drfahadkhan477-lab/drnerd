# Memorizer device preflight — October 8, 2026

This records automated Linux measurements and checks requested before an iPad trial. No physical iPad is connected to this workspace. iPad memory limits, Home Screen/whole-browser reopening, a physical network toggle and actual GPU model execution remain **not run**.

Runtime base: `b5c546f3fd3e5d4ce6aa6e0f65e3f63586c36300`; Memorizer build `ef4010c85482`. No app storage, IndexedDB, model or service-worker behavior was changed for these checks.

## Backup memory measurements

Node v24.19.0, Linux x64, V8 heap limit 2,240 MiB. Each case ran in a fresh process using memory-fallback storage, without forced garbage collection. Both checksum paths exported, previewed, removed and restored the fixture. Every byte, document, note, progress record and review card matched in all twelve cases.

| Synthetic binary size | Checksum | Observed peak process RSS | Repetitions |
| --- | --- | --- | --- |
| 8 MiB | sha256 | 204.7–205.4 MiB | 3 |
| 8 MiB | fnv1a64 | 186.4–187.3 MiB | 3 |
| 32 MiB | sha256 | 637.8–638.1 MiB | 3 |
| 32 MiB | fnv1a64 | 486.1–560.1 MiB | 3 |

The 32 MiB input required up to 638.1 MiB of process memory in this experiment. RSS includes Node/VM overhead, input and stored copies, snapshots, JSON/base64, preview, restore and verification reads. These are observations on this host, not Safari memory measurements or a safe iPad capacity limit. The synthetic binary is not a parseable PDF. IndexedDB storage, rendering and GPU allocations were not measured by this benchmark.

Source hash: `004c9b1e8d366189a57dbf5b1e37a676aa14f4527f7d9b9dd676a5f3e0b216c0`.
Harness hash: `fd612a3226083011ecae91580b31b8326053210ebd6611cb7a1ea74e5376d1bb`.

Reproduce and retain the full JSON lines:

```sh
node memorizer/tools/benchmark-backup.js --sizes-mib 8,32 --checksums sha256,fnv1a64 --repeat 3 > /tmp/memorizer-backup-results.jsonl
```

## Offline reopening

The updated offline regression passed **16 checks each** in Playwright 1.56.0 Chromium, WebKit and Firefox. It stores synthetic text, a session, a note and binary bytes; closes the tab; stops the origin server and all its sockets; proves the origin is unreachable with an independent HTTP probe; then opens a new tab at a different navigation URL. The cached app boots, saved data matches, and SHA-256 of all seven reader dependencies plus Mermaid matches the original upstream bytes. Origin responses use `no-store`, preventing the browser HTTP cache from concealing a broken service-worker cache.

This reopens a tab within the same browser context. It does not quit the browser, restart an iPad, render the synthetic binary as a PDF, or test Safari storage eviction. The controlled CDN transport preserves the production cache logic and verifies public pinned dependency bytes; direct browser-to-CDN CORS/TLS is not measured.

Proven to fail: bypassing the service worker's cached navigation fallback let the preceding twelve checks pass, then failed exactly at `?offline-reopen`. Restoring the fallback passed. The initial new run exposed a harness assumption: the Import Study chip is present only in an empty library. The helper now waits for Settings navigation, which exists with saved material too; no timeout or assertion was weakened.

Additional mutations proved the other new assertions fail: leaving the origin online failed the independent outage probe; zeroing stored ArrayBuffers failed the saved-data comparison; corrupting cached Mermaid bytes failed the reopened-reader hash comparison. Each temporary change was restored before normal validation.

WebKit ran with checksum-verified Debian libraries extracted into an isolated workspace directory. A copied launcher preserved that directory in `LD_LIBRARY_PATH`; browser binaries were unchanged. Playwright's `ldconfig` host preflight was skipped because the local directory is absent from the system cache. The native WebKit browser actually launched and all assertions ran; no app or WebKit test guard was skipped. CI should use its usual `playwright install --with-deps` setup instead.

```sh
NODE_USE_ENV_PROXY=1 node tests/verify-memorizer-offline.js
SYSTOLE_ENGINE=webkit NODE_USE_ENV_PROXY=1 node tests/verify-memorizer-offline.js
SYSTOLE_ENGINE=firefox NODE_USE_ENV_PROXY=1 node tests/verify-memorizer-offline.js
```

## Model switching

The lifecycle regression now holds the first engine's unload promise open. It verifies that the second engine is not constructed until unload resolves and that neither model is reported ready during the switch. It uses the configured Qwen3 model ids with stand-in GPU/engine and file-verification boundaries; it downloads no model. The new check failed when unload was called without being awaited, then passed after restoring the source.

Native capability probes found no usable WebGPU adapter: Chromium exposed the API but returned no adapter; Linux WebKit and Firefox exposed no WebGPU API. No real model weights were downloaded, no inference ran and no GPU-memory release was measured. An unload call completing does not establish how much memory a physical GPU reclaimed.

```sh
node tests/verify-memorizer-runtime-pure.js
```

## Remaining physical acceptance

Other local checks passed: all 90 pure suites, the public Memorizer build, and all 60 stats checks. No licensed-content build or private fixture was used.

Use [IPAD-RUNSHEET.md](IPAD-RUNSHEET.md) on a disposable test origin. Record the iPad model/iPadOS version, hosted commit/build, largest completed file/backup size and any involuntary reload; test Home Screen reopening with the real network off; then start Qwen3 0.6B, switch to another supported model and back, and verify a short answer after each switch. Retain the exact failure message if a model cannot start. A device trial is required before setting a backup limit or claiming real on-device switching works.
