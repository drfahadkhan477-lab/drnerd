#!/usr/bin/env node
'use strict';
/*
 * The counts record: scripts/record.js decides whether a run earned a write,
 * and what the write keeps.
 *
 *   node tests/verify-record-pure.js
 *
 * The rule it holds: the record is written only when every registered suite
 * ran in this run and passed — 'stats' excepted, since it fails exactly when
 * the record is stale. Any other run writes nothing. A suite no longer
 * registered leaves the record, and so does the Memorizer's half of the
 * record from before Memorizer moved to its own repository. The split-build
 * figure is carried forward from a run without --pwa.
 *
 * Fixtures are invented names and numbers; nothing here reads the real record.
 */
const { mergeRecord } = require('../scripts/record.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const REG = ['home', 'stats', 'memory', 'lab'];
/* A record in the shape the two-half writer left it: a Memorizer half, a
   suite since deleted, and provenance per family. */
const PREV = {
  engine: 'chromium', jobs: 1, pwa: 134,
  families: { systole: { commit: 'old-s', jobs: 1 }, memorizer: { commit: 'old-m', jobs: 1 } },
  suites: { home: 10, stats: 5, memory: 7, lab: 3, memorizer: 20, 'memorizer-data': 8, gone: 99 },
  seconds: { home: 1, stats: 1, memory: 1, lab: 1, memorizer: 9, 'memorizer-data': 2, gone: 3 },
};
const CHECKS = { home: 11, stats: 6, memory: 8, lab: 4 };
const run = (over = {}, drop = []) => REG.filter(n => !drop.includes(n)).map(n => Object.assign(
  { name: n, ok: true, checks: CHECKS[n], secs: '4.0' }, over[n] || {}));
const opts = { engine: 'chromium', jobs: 4, commit: 'master @ new' };

head('a green run writes the record');
{
  const out = mergeRecord(PREV, run(), REG, Object.assign({ pwaCount: 140 }, opts));
  ok('a record comes back', !!(out && out.record));
  const r = (out && out.record) || { suites: {}, seconds: {} };
  ok('every count is this run’s', r.suites.home === 11 && r.suites.stats === 6 && r.suites.memory === 8 && r.suites.lab === 4, JSON.stringify(r.suites));
  ok('the split-build count is this run’s', r.pwa === 140, String(r.pwa));
  ok('provenance is this run', r.commit === 'master @ new' && r.jobs === 4 && r.engine === 'chromium', `${r.commit} ${r.jobs} ${r.engine}`);
  ok('seconds are this run’s', r.seconds.home === 4 && r.seconds.lab === 4, JSON.stringify(r.seconds));
}

head('what is no longer registered leaves the record');
{
  const r = mergeRecord(PREV, run(), REG, opts).record;
  ok('a deleted suite is dropped from counts and seconds', !('gone' in r.suites) && !('gone' in r.seconds));
  ok('so are the Memorizer’s suites, which left with it', !('memorizer' in r.suites) && !('memorizer-data' in r.suites) && !('memorizer' in r.seconds),
     Object.keys(r.suites).join());
  ok('and the half that held them: no per-family provenance is carried forward', !('families' in r), JSON.stringify(r.families));
  ok('suites are in registry order', Object.keys(r.suites).join() === REG.join(), Object.keys(r.suites).join());
}

head('any run short of every suite green writes nothing');
{
  ok('a failing suite: null, and the caller leaves the file alone', mergeRecord(PREV, run({ memory: { ok: false } }), REG, opts) === null);
  ok('a skipped suite: null', mergeRecord(PREV, run({}, ['lab']), REG, opts) === null);
  ok('a suite that ran no checks does not count as having run', mergeRecord(PREV, run({ lab: { checks: 0 } }), REG, opts) === null);
  ok('a suite that reported no count at all does not either', mergeRecord(PREV, run({ lab: { checks: undefined } }), REG, opts) === null);
  ok('an empty registry earns nothing', mergeRecord(PREV, [], [], opts) === null);
  ok('a result for a suite not registered does not stand in for one that is',
     mergeRecord(PREV, run({}, ['lab']).concat([{ name: 'memorizer', ok: true, checks: 21, secs: '1' }]), REG, opts) === null);
}

head('stats failing is the record being stale, not the run failing');
{
  const out = mergeRecord(PREV, run({ stats: { ok: false } }), REG, opts);
  ok('the record is still written when only stats failed', !!out);
  ok('...with stats’ executed count', !!out && out.record.suites.stats === 6);
  ok('but not when another suite failed beside it', mergeRecord(PREV, run({ stats: { ok: false }, home: { ok: false } }), REG, opts) === null);
}

head('the totals and the record’s shape');
{
  const r = mergeRecord(PREV, run(), REG, opts).record;
  const sum = Object.values(r.suites).reduce((a, b) => a + b, 0);
  ok('total is the sum of the counts', r.total === sum && r.total === 11 + 6 + 8 + 4, `${r.total} vs ${sum}`);
  ok('suiteCount is the number of recorded suites', r.suiteCount === Object.keys(r.suites).length && r.suiteCount === 4, String(r.suiteCount));
  ok('pwa carried forward when this run did not measure it', r.pwa === 134, String(r.pwa));
  ok('the input record is not mutated', PREV.suites.home === 10 && PREV.suites.memorizer === 20 && PREV.families.memorizer.commit === 'old-m');
  const fresh = mergeRecord({}, run(), REG, opts);
  ok('from no previous record, an unmeasured split build is null, not invented', !!fresh && fresh.record.pwa === null, fresh && String(fresh.record.pwa));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
