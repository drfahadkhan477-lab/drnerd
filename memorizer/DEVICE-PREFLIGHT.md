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

The updated offline regression passed **16 checks each** in Playwright 1.56.0 Chromium and Firefox. In WebKit the reopen section now prints NOT RUN and the suite reports its other 12 checks; see the correction below. It stores synthetic text, a session, a note and binary bytes; closes the tab; stops the origin server and all its sockets; proves the origin is unreachable with an independent HTTP probe; then opens a new tab at a different navigation URL. The cached app boots, saved data matches, and SHA-256 of all seven reader dependencies plus Mermaid matches the original upstream bytes. Origin responses use `no-store`, preventing the browser HTTP cache from concealing a broken service-worker cache.

This reopens a tab within the same browser context. It does not quit the browser, restart an iPad, render the synthetic binary as a PDF, or test Safari storage eviction. The controlled CDN transport preserves the production cache logic and verifies public pinned dependency bytes; direct browser-to-CDN CORS/TLS is not measured.

Proven to fail: bypassing the service worker's cached navigation fallback let the preceding twelve checks pass, then failed exactly at `?offline-reopen`. Restoring the fallback passed. The initial new run exposed a harness assumption: the Import Study chip is present only in an empty library. The helper now waits for Settings navigation, which exists with saved material too; no timeout or assertion was weakened.

Additional mutations proved the other new assertions fail: leaving the origin online failed the independent outage probe; zeroing stored ArrayBuffers failed the saved-data comparison; corrupting cached Mermaid bytes failed the reopened-reader hash comparison. Each temporary change was restored before normal validation.

WebKit ran with checksum-verified Debian libraries extracted into an isolated workspace directory. A copied launcher preserved that directory in `LD_LIBRARY_PATH`; browser binaries were unchanged. Playwright's `ldconfig` host preflight was skipped because the local directory is absent from the system cache. The native WebKit browser actually launched and all assertions ran; no app or WebKit test guard was skipped. CI should use its usual `playwright install --with-deps` setup instead.

**Correction (#198).** The WebKit passes above were not measurements. CI's WebKit job failed the reopen on a later run, and a standalone probe found why. With no page of the origin open, Playwright's Linux WebKit temporary profile drops the origin's Cache Storage within 4–12 s: 5 entries after a 4 s pause, only the page just fetched after 12 s. Its saved profile (`launchPersistentContext`) reads back an empty cache even while the first tab is open. The service worker then correctly answers "offline, and nothing cached". The suite fails every time with a 12 s pause before reopening, and passed only when the reopen beat the discard. Chromium and Firefox pass with the same pause. So the reopen section runs in Chromium and Firefox only. Whether Safari on an iPad keeps the cache across an idle period is not measured here; it stays on the run sheet.

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

## October 9 follow-up

The runtime has since advanced to `400e1ae1232cd6ea0551caf6e40e182be86f2eae`, build `2f5728796a54`. The October 8 benchmark above remains a measurement of its stated base and harness; it was not rerun as a physical iPad benchmark.

A separate clean-context shell probe on base `7b451b87dacdf44e65788d075b8b6f0a65627248`, build `ef4010c85482`, compared immediate reopening with reopening after twelve seconds idle. For each case, the actual app/worker cached the shell, saved synthetic binary bytes to IndexedDB, closed its last origin tab, stopped the origin server and confirmed connection refusal independently. Chromium and Firefox reopened with intact bytes in both repetitions at each delay. WebKit reopened in both immediate repetitions but failed both delayed repetitions with “offline, and nothing cached”, despite its shell cache being populated before closing. This supports the correction above; immediate success does not establish durable reopening. The probe did not cache reader dependencies, render a PDF, restart a browser or measure Safari on an iPad.

The earlier Cloudflare build `f418e3bf3418` passed live reader preparation and offline reopening in Chromium and Firefox. Firefox required importing the workspace's configured CA certificates into a temporary profile because its initial trust store rejected the session proxy certificate; TLS verification remained enabled. Linux WebKit failed the live reopening. No physical network switch was involved.

The current [stable Cloudflare origin](https://supreme-cnf.pages.dev/) now serves build `2f5728796a54`, with all public app assets matching the generated build byte for byte. Its live Chromium check prepared all reader groups, closed the tab, and reopened offline after twelve seconds with a service-worker controller and every synthetic saved byte intact. No PDF/OCR rendering or dependency hash comparison was performed after that reopening. WebKit/Firefox live reopening was not repeated on this newer build; required merged-runtime CI ran their synthetic Memorizer suites, while WebKit's unsupported reopening section remains explicitly not run.

The stable origin and a deployment-specific Cloudflare subdomain have separate study storage. Prepare and test the origin installed on Home Screen; export before changing origins. The owner's reported device is an 11-inch M5 iPad on iPadOS 27. Physical memory capacity, whole-browser/Home Screen reopening, storage eviction and actual model inference/GPU-memory release remain **not run**. Linux capability probes found no usable GPU adapter, so no model weights were downloaded for those probes.

Private suites must run on the owner's Windows 10 laptop using its existing licensed source. The “Runs only” task and metadata reporting requirements are in [LAPTOP-RUNS.md](LAPTOP-RUNS.md). That task is prepared; no remote session delivery or completed private run is claimed. The physical run sheet still needs recorded observations before changing backup limits or claiming device acceptance.
