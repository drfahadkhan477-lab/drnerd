# Backup measurements and iPad acceptance

The Node benchmark verifies the production backup codec against deterministic synthetic bytes and study records. The iPad checklist measures the app with real PDF files on the target device. Neither supplies a safe backup size limit for a device that has not been tested.

## Reproduce the Node measurements

Node 20 or newer is sufficient; no package installation, browser, build or licensed source is needed. From the repository root:

```sh
node memorizer/tools/benchmark-backup.js --help
node memorizer/tools/benchmark-backup.js --sizes-mib 8,32 --checksums sha256,fnv1a64 --repeat 3 > /tmp/memorizer-backup-results.jsonl
```

Use a path outside the checkout for result files. Each size/checksum/repetition runs sequentially in a fresh Node process. The default is 8 and 32 MiB, both checksum paths, one repetition. A case has a three-minute timeout; sizes above 128 MiB are refused by this harness. These are harness limits, not Memorizer or iPad capacity limits.

Each case seeds one document, a deterministic binary record, a note, completed progress and a card with review history. It exports, previews, removes the saved bytes/progress/cards/note, restores, and compares every restored byte and the study records. SHA-256 is requested explicitly for one path; SubtleCrypto is absent for the fallback path. A checksum downgrade, byte mismatch, missing record, timeout or failed child exits nonzero. Earlier JSON lines describe completed cases only; a failed batch does not validate its unfinished cases.

One JSON line is printed per successful case. Preserve the full result rather than only its peak:

| Field | What it measures |
| --- | --- |
| `node`, `platform`, `arch`, `heapLimitBytes`, `pid` | Runtime and process identity. |
| `sourceSha256` | Hash of the exact `store.js`, `provenance.js` and `backup.js` source loaded. |
| `harnessSha256` | Hash of the benchmark script, identifying its measurement procedure. |
| `fixture`, `fixtureSha256`, `binaryBytes` | Version, hash and byte length of the deterministic binary fixture. |
| `backupUtf8Bytes`, `checksum` | Exported JSON size and actual backup checksum. |
| `milliseconds` | Export, preview and restore durations, excluding fixture seeding and deliberately removing records. |
| `rssBytes` | Whole-process RSS at each stage; `peak` is the process maximum through verification, in bytes. |
| `counts`, `verified` | Preview counts and completed byte/study-record verification. |

Divide byte figures by 1,048,576 for MiB. Record the Git revision and run on the same Node version, machine, heap configuration and harness/source/fixture hashes when comparing results. Keep other workloads idle. Garbage collection is not forced; compare several fresh-process repetitions and retain variation. Peak RSS includes Node/VM overhead, the retained input fixture, snapshots, JSON/base64, preview, restore and verification reads. Timing and memory are observations, not regression thresholds.

The benchmark always uses an isolated **memory fallback** store. It does not measure IndexedDB, PWA downloads, Safari, VoiceOver or WebGPU. The synthetic byte pattern is **not a parseable PDF**, and the tool does not write it or a backup for import. Use actual self-authored PDFs for the device trial below. Do not substitute zero for unavailable device memory measurements.

## Prepare an iPad trial

A one-page order of work for the day, with a results table, is in [IPAD-RUNSHEET.md](IPAD-RUNSHEET.md).

1. Use a dedicated test origin and only self-authored synthetic PDFs/notes. Backup restore replaces that origin's study records. Build with `npm run memorizer`; follow [the existing iPad hosting instructions](../docs/IPAD.md) for a secure test address. No deployment is performed by the benchmark.
2. Record commit/build stamp, iPad model, iPadOS version, Safari versus Home Screen mode, free storage, power/thermal state, and network connection. Use the same files for repeated trials.
3. Create numbered synthetic PDF pages with distinctive first/last text and headings. Include a text PDF, a self-created scanned PDF, and a multipart pair with explicit part/page-range filenames. Record file names, SHA-256 hashes, bytes and page counts. Increase bytes and page counts separately; large compressed files and long/scanned books exercise different costs.
4. Start small, then increase only after the previous trial completes. The Node benchmark's 8/32 MiB inputs are comparison points, not proven iPad limits. Stop and record any crash, involuntary reload, stuck operation or missing data.
5. In Settings, record the displayed storage mode. Private browsing does not prove that IndexedDB is unavailable. To exercise memory fallback, use a disposable test launch that refuses database opening **before** `MemStore.open()` first runs. For example, Safari's remote Web Inspector can pause at the beginning of that function on reload, then run:

   ```js
   Object.defineProperty(window, 'indexedDB', {
     configurable: true,
     value: { open() { throw new Error('Synthetic database refusal'); } }
   });
   ```

   Resume and confirm Settings says “Kept only for this visit.” Repeat that setup for each fallback reload. A normal trial should say “Saved in this browser.” If the required launch/debugger is unavailable, record the fallback trial as **not run**. Do not modify the production build or loosen its guards.

## Record acceptance results

Every item starts **not run**. Record pass, fail or not run, with file sizes/page counts, elapsed time from the action to its completion, and supporting observations. A tab surviving once does not establish a maximum safe backup size.

- [ ] **Import and cancellation:** import the multipart pair, review/reorder its parts and verify first/last pages. Cancel a long import before final commit; wait for the current page to finish. Confirm no new book/unit appears, then repeat the import successfully. Include a scanned-file trial separately.
- [ ] **Persistent backup:** add an identifiable note, complete study progress and create/review a card. Export and save the actual download in Files. Confirm restore previews counts before replacement; cancel once and verify current data is intact. Restore, verify bytes/notes/progress/cards, close/reopen and verify again.
- [ ] **Memory fallback rescue:** repeat export/restore while Settings confirms temporary memory. Close the tab after saving the download; reopen with the same database-refusal setup. Empty study storage is expected. Restore the saved backup and verify the study records during that visit. Persistence after a fallback reload is not expected.
- [ ] **Failed-write rescue:** if remote inspection is available, make only the test note write reject, save a distinctive note and confirm the failure banner. Export while that write is pending. Remove the injected failure before restoring and verify that the exact note is rescued. If no failure was actually induced, record this case as not run.
- [ ] **Offline and PWA update:** use “Prepare for offline” online and confirm readiness. Cut the physical network, reopen the installed app and verify PDF pages and study records. Restore connectivity, update the test deployment, reopen, confirm the new build stamp and verify records/cached dependencies again. Distinguish a controlled fixture outage from a real device/CDN test.
- [ ] **Accessibility:** with VoiceOver and a keyboard, reach export/restore controls, read the preview, cancel, restore and check focus return. Verify status/error announcements and focus containment in the restore dialog.
- [ ] **Real models:** separately download a real on-device model, switch models and delete its cache. Record model IDs and download/storage failures. Mock engines and backup round trips do not validate WebGPU behavior.

For byte verification with remote Web Inspector, evaluate this expression before export and again after restore. It retains only IDs, lengths and fingerprints as its result. Compare all entries; also compare the saved note text, progress and card review state through the app. Keep fingerprint work outside the timed backup action.

```js
await Promise.all((await MemStore.all('files')).map(async f => {
  const bytes = f.bytes instanceof ArrayBuffer ? new Uint8Array(f.bytes) :
    new Uint8Array(f.bytes.buffer, f.bytes.byteOffset, f.bytes.byteLength);
  return { id: f.id, bytes: bytes.byteLength, fingerprint: await MemProvenance.fingerprint(bytes) };
}));
```

For the failed-write trial in persistent storage, inject the following once before saving the synthetic note. Export while the banner is present, then call `undoSyntheticNoteFailure()` before restoring or retrying. Reloading also removes the injection.

```js
{
  const put = IDBObjectStore.prototype.put;
  window.undoSyntheticNoteFailure = () => {
    IDBObjectStore.prototype.put = put;
    delete window.undoSyntheticNoteFailure;
  };
  IDBObjectStore.prototype.put = function (record) {
    if (this.name === 'meta' && record && record.id === 'notes')
      throw new DOMException('Synthetic note-write refusal', 'QuotaExceededError');
    return put.apply(this, arguments);
  };
}
```

Opening a restored PDF confirms readability, not exact byte equality. Record the exact-byte check as unmeasured if fingerprints cannot be compared. iPad memory metrics may be unavailable; record available profiler observations or OS reload/crash evidence and label unavailable metrics unmeasured.

Use this result template for each trial:

```text
Commit/build:
Device/iPadOS/browser mode:
Storage mode and how verified:
Fixture hashes, bytes and page counts:
Free storage, network, power/thermal state:
Export / preview / restore elapsed time:
Bytes / notes / progress / cards verified:
Available memory measurements and tool (or unmeasured):
Reloads, crashes, errors or cancellation delay:
Acceptance items passed / failed / not run, with evidence:
Next action:
```

Select a lower-memory backup format or a device-specific size recommendation only after these measurements show what needs changing. Checksum/schema checks and atomic replacement remain required in any follow-up.
