'use strict';
/* ── the counts record, in two halves ─────────────────────────────────────────
   tests/test-stats.json holds what a green run measured. It used to be written
   only when EVERY registered suite was green, which tied Systole's numbers to
   the Memorizer's: a Memorizer browser suite failing on one machine held the
   whole record back, and Systole runs that were green from end to end wrote
   nothing.

   So the record is split into families, and each is written from its own green
   run. A family is written only when every registered suite in it ran in this
   run and passed; 'stats' may fail (it is the suite that notices the record is
   stale, and blocking on it would deadlock — see scripts/verify.js). A family
   that did not qualify keeps its previous entries untouched. Totals are summed
   over both halves, so the prose still quotes one number.

   Pure: no fs, no process. scripts/verify.js does the I/O and
   tests/verify-record-pure.js holds this to its rules. */

const familyOf = name => (/^memorizer(-|$)/.test(name) ? 'memorizer' : 'systole');

/* Which families this run earned: every registered member present and ok. */
function qualifying(results, registered) {
  const byName = new Map(results.map(r => [r.name, r]));
  const fams = {};
  for (const n of registered) {
    const f = familyOf(n);
    if (!(f in fams)) fams[f] = true;
    const r = byName.get(n);
    if (!r || !(r.ok || n === 'stats') || !(r.checks > 0)) fams[f] = false;
  }
  return Object.keys(fams).filter(f => fams[f]);
}

/* prev: the record as read (or {}). results: [{name, ok, checks, secs}].
   registered: every suite name in the registry. opts: {engine, jobs, commit,
   pwaCount}. Returns {record, written, kept}, or null when no family earned a
   write — the caller then leaves the file alone. */
function mergeRecord(prev, results, registered, opts = {}) {
  prev = prev || {};
  const written = qualifying(results, registered);
  if (!written.length) return null;
  const reg = new Set(registered);
  const byName = new Map(results.map(r => [r.name, r]));
  const suites = {};
  const seconds = {};
  const prevSuites = prev.suites || {};
  const prevSecs = prev.seconds || {};
  /* Registry order, so the file diffs cleanly between runs. A name no longer
     registered is dropped from both halves: a deleted suite's count is not a
     count of anything. */
  for (const n of registered) {
    if (written.includes(familyOf(n))) {
      suites[n] = byName.get(n).checks;
      seconds[n] = +byName.get(n).secs;
    } else {
      if (n in prevSuites) suites[n] = prevSuites[n];
      if (n in prevSecs) seconds[n] = prevSecs[n];
    }
  }
  for (const n of Object.keys(prevSecs)) if (!reg.has(n)) delete seconds[n];
  const families = Object.assign({}, prev.families || {});
  for (const f of written) families[f] = { commit: opts.commit || null, jobs: opts.jobs === undefined ? null : opts.jobs };
  const all = new Set(registered.map(familyOf));
  const kept = [...all].filter(f => !written.includes(f));
  /* The split-build count measures Systole, so only a Systole-green run may
     replace it; otherwise the previous figure is carried forward. */
  const pwa = written.includes('systole') && opts.pwaCount !== undefined
    ? opts.pwaCount
    : (prev.pwa === undefined ? null : prev.pwa);
  const record = {
    _generated: 'by scripts/verify.js, each family from its own green run — do not hand-edit',
    engine: opts.engine,
    jobs: opts.jobs,
    families,
    suiteCount: Object.keys(suites).length,
    total: Object.values(suites).reduce((a, b) => a + b, 0),
    pwa,
    suites,
    seconds,
  };
  return { record, written, kept };
}

module.exports = { familyOf, qualifying, mergeRecord };
