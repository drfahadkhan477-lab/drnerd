'use strict';
/* ── the counts record ────────────────────────────────────────────────────────
   tests/test-stats.json holds what a green run measured. It is written only
   from a run in which every registered suite ran and passed; 'stats' may fail
   (it is the suite that notices the record is stale, and blocking on it would
   deadlock — see scripts/verify.js). Any other run leaves the file alone.

   The record was kept in two halves, Systole's and the Memorizer's, each
   written from its own green run, until Memorizer moved to its own repository
   and its suites left the registry. A write keeps nothing that is no longer
   registered: not a count, not a time, and not the half that held them.

   Pure: no fs, no process. scripts/verify.js does the I/O and
   tests/verify-record-pure.js holds this to its rules. */

/* Whether this run earned a write: every registered suite present and ok. */
function qualifies(results, registered) {
  const byName = new Map(results.map(r => [r.name, r]));
  return registered.length > 0 && registered.every(n => {
    const r = byName.get(n);
    return !!r && (r.ok || n === 'stats') && r.checks > 0;
  });
}

/* prev: the record as read (or {}). results: [{name, ok, checks, secs}].
   registered: every suite name in the registry. opts: {engine, jobs, commit,
   pwaCount}. Returns {record}, or null when the run earned no write — the
   caller then leaves the file alone. */
function mergeRecord(prev, results, registered, opts = {}) {
  prev = prev || {};
  if (!qualifies(results, registered)) return null;
  const byName = new Map(results.map(r => [r.name, r]));
  const suites = {};
  const seconds = {};
  /* Registry order, so the file diffs cleanly between runs. */
  for (const n of registered) {
    suites[n] = byName.get(n).checks;
    seconds[n] = +byName.get(n).secs;
  }
  /* The split-build count is measured only with --pwa; a run without it
     carries the previous figure forward. */
  const pwa = opts.pwaCount !== undefined ? opts.pwaCount : (prev.pwa === undefined ? null : prev.pwa);
  const record = {
    _generated: 'by scripts/verify.js from a green run — do not hand-edit',
    engine: opts.engine,
    jobs: opts.jobs,
    commit: opts.commit || null,
    suiteCount: Object.keys(suites).length,
    total: Object.values(suites).reduce((a, b) => a + b, 0),
    pwa,
    suites,
    seconds,
  };
  return { record };
}

module.exports = { qualifies, mergeRecord };
