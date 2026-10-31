# Master audit: AI proxy and import boundaries

Reviewed master at `9605a0aafeecf242fdc8a4d047c749b36041222c`.
This review concentrated on the AI proxy, archive reader, bank validation and
public synthetic-content development workflow. It is not a claim that every
application path or the production deployment has been audited.

## Fixes

- **AI output cost boundary:** `maxOutputTokens` limits each candidate, but the
  proxy forwarded requests for additional candidates. The app consumes a single
  answer. The proxy now refuses a supplied `candidateCount` unless it names a
  single candidate, and rejects duplicate keys and the protobuf snake_case alias. Omission and unrelated nested
  schema fields still work. Access authentication remains required.
- **Bank validation:** a figure list supplied as an object or number threw
  instead of producing a refusal. Strings were interpreted as individual
  characters. Non-list figure values now produce an explicit validation problem,
  with no usable question bank returned. Missing and null optional lists retain
  their previous behavior.
- **Archive handling:** encrypted entries and entries with invalid local header
  signatures or inconsistent compression methods were accepted as files. They
  are now skipped by name, while valid neighboring entries remain readable.
  Inflated sizes must match the central directory for deflated entries as well
  as stored entries. An end-of-directory signature inside an archive comment
  must satisfy the archive's comment-length boundary before it can be used.

- **Test failure reporting:** an incidental stderr warning hid browser death
  diagnostics written to stdout. The public runner now retains that diagnostic
  context even when a warning is present, while keeping successful assertions
  from obscuring a real stderr error. A fake failing suite reproduces the loss
  and verifies the corrected output.

## Regression evidence

The new worker, bank-package and ZIP regressions were run against isolated copies
of the original source and produced their own FAIL lines. The same regressions
pass with the fixes. Both valid stored and deflated entries are exercised, and
valid single-candidate requests are forwarded byte for byte. No licensed export
or production credentials were used.

Commands for the focused checks:

```sh
node tests/verify-worker.js
node tests/verify-bankpack-pure.js
node tests/verify-zip.js
node tests/verify-testpublic-pure.js
node tests/verify-bankstore.js
SYSTOLE_ENGINE=webkit node tests/verify-bankstore.js
npm run leak-guard
npm run suites
git diff --check
```

## Validation and runtime limits

The full Chromium public run and split-PWA build passed, with every suite
measured and no passes reused. The pure suites also passed after the final
runner-reporting fix. The focused worker, bank-package, archive and runner
regressions passed, and bank-store browser integration passed in both engines.
The scheduler suite also passed in a daylight-saving timezone.

WebKit's initial full run includes an unexplained pearl-suite exit. The old
runner hid the stdout diagnostic behind the host-check warning. An isolated
rerun of the pearl suite passed every check, including all sampled themes, and
reported no page or console errors. The original exit is not counted as a pass,
and its cause cannot be reconstructed from the discarded output. All other
WebKit suites and the split-PWA check passed, with no cached passes reused. The
initial full WebKit command remains a failed run; the isolated pass is reported
separately. The reporting fix prevents the warning from hiding that context in
future runs.
Private-bank and production Cloudflare behavior are outside these checks.

This cloud host lacks system WebKit libraries and an administrative installer.
Signed Debian package metadata was used to download the missing shared libraries
for local extraction under `/workspace/browser-libs`. The browser wrapper resets
its library search path, so missing libraries were linked into its local runtime.
WebKit launched and rendered successfully after that correction. Its advisory
host check consults the system linker cache and does not see these local
libraries; `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` is needed for this
instance. This does not skip application tests or artifact/TLS verification.

The cloud runtime restarted during earlier checks. Working-tree edits survived,
but `/tmp` logs and live processes did not. Checkpoints, test logs and a resource
monitor are kept outside the checkout under
`/workspace/scratch/drnerd-recovery`. Current-runtime resource counters do not
establish why earlier runtimes disconnected. No environment configuration was
republished, and no source changes were pushed or deployed.
