#!/usr/bin/env node
'use strict';
/*
 * The counts record, in two halves: scripts/record.js decides which half a run
 * earned, and keeps the other half as it was.
 *
 *   node tests/verify-record-pure.js
 *
 * The rule it holds: a family (Systole, or the Memorizer) is written only when
 * every one of its registered suites ran in this run and passed — 'stats'
 * excepted, since it fails exactly when the record is stale. A half the run
 * did not earn keeps its previous counts. The split-build figure moves only
 * with Systole. A suite no longer registered leaves the record. Totals add
 * both halves.
 *
 * Fixtures are invented names and numbers; nothing here reads the real record.
 */
const { familyOf, mergeRecord } = require('../scripts/record.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const REG = ['home', 'stats', 'memory', 'memorizer', 'memorizer-data', 'memorizer-chunk-pure'];
const PREV = {
  engine: 'chromium', jobs: 1, pwa: 134,
  families: { systole: { commit: 'old-s', jobs: 1 }, memorizer: { commit: 'old-m', jobs: 1 } },
  suites: { home: 10, stats: 5, memory: 7, memorizer: 20, 'memorizer-data': 8, 'memorizer-chunk-pure': 30, gone: 99 },
  seconds: { home: 1, stats: 1, memory: 1, memorizer: 9, 'memorizer-data': 2, 'memorizer-chunk-pure': 1, gone: 3 },
};
const run = (over = {}, drop = []) => REG.filter(n => !drop.includes(n)).map(n => Object.assign(
  { name: n, ok: true, checks: { home: 11, stats: 6, memory: 8, memorizer: 21, 'memorizer-data': 9, 'memorizer-chunk-pure': 31 }[n], secs: '4.0' },
  over[n] || {}));
const opts = { engine: 'chromium', jobs: 4, commit: 'master @ new' };

head('which family a suite belongs to');
ok('memorizer and memorizer-* are the Memorizer', ['memorizer', 'memorizer-data', 'memorizer-chunk-pure'].every(n => familyOf(n) === 'memorizer'));
ok('memory (Systole’s own screen) is Systole, not the Memorizer', familyOf('memory') === 'systole');
ok('lab and stats are Systole', familyOf('lab') === 'systole' && familyOf('stats') === 'systole');

head('Systole green, the Memorizer failing: Systole is written, the Memorizer kept');
{
  const out = mergeRecord(PREV, run({ memorizer: { ok: false } }), REG, Object.assign({ pwaCount: 140 }, opts));
  ok('a record comes back', !!out);
  if (out) {
    const r = out.record;
    ok('only systole was written', out.written.join() === 'systole', out.written.join());
    ok('the memorizer half is reported as kept', out.kept.join() === 'memorizer', out.kept.join());
    ok('Systole counts are this run’s', r.suites.home === 11 && r.suites.memory === 8 && r.suites.stats === 6, JSON.stringify(r.suites));
    ok('Memorizer counts are the previous record’s, the failing suite included',
       r.suites.memorizer === 20 && r.suites['memorizer-data'] === 8 && r.suites['memorizer-chunk-pure'] === 30, JSON.stringify(r.suites));
    ok('the split-build count moves with Systole', r.pwa === 140, String(r.pwa));
    ok('systole provenance is this run', r.families.systole.commit === 'master @ new' && r.families.systole.jobs === 4);
    ok('memorizer provenance is still the old run', r.families.memorizer.commit === 'old-m');
    ok('memorizer seconds are kept, systole seconds replaced', r.seconds.memorizer === 9 && r.seconds.home === 4);
  }
}

head('the Memorizer green, Systole not: the reverse');
{
  const out = mergeRecord(PREV, run({ home: { ok: false } }), REG, Object.assign({ pwaCount: 140 }, opts));
  ok('only memorizer was written', out && out.written.join() === 'memorizer', out && out.written.join());
  ok('Systole counts kept', out && out.record.suites.home === 10 && out.record.suites.memory === 7);
  ok('Memorizer counts are this run’s', out && out.record.suites.memorizer === 21);
  ok('the split-build count does NOT move without Systole', out && out.record.pwa === 134, out && String(out.record.pwa));
}

head('a half covered only partly is not written');
{
  const skipped = mergeRecord(PREV, run({}, ['memory']), REG, opts);
  ok('a skipped Systole suite keeps Systole from being written', skipped && !skipped.written.includes('systole'), skipped && skipped.written.join());
  ok('...and its old counts stand', skipped && skipped.record.suites.home === 10);
  const memSkip = mergeRecord(PREV, run({}, ['memorizer', 'memorizer-data']), REG, opts);
  ok('skipping Memorizer browser suites still writes Systole (the --skip memorizer,… run)',
     memSkip && memSkip.written.join() === 'systole', memSkip && memSkip.written.join());
  const zero = mergeRecord(PREV, run({ memory: { checks: 0 } }), REG, opts);
  ok('a suite that ran no checks does not count as covering its family', zero && !zero.written.includes('systole'));
  ok('nothing earned: null, and the caller leaves the file alone',
     mergeRecord(PREV, run({ home: { ok: false }, memorizer: { ok: false } }), REG, opts) === null);
}

head('stats failing is the record being stale, not Systole failing');
{
  const out = mergeRecord(PREV, run({ stats: { ok: false } }), REG, opts);
  ok('systole is still written when only stats failed', out && out.written.includes('systole'), out && out.written.join());
  ok('...with stats’ executed count', out && out.record.suites.stats === 6);
}

head('the totals and the record’s shape');
{
  const out = mergeRecord(PREV, run({ memorizer: { ok: false } }), REG, opts);
  const r = out.record;
  const sum = Object.values(r.suites).reduce((a, b) => a + b, 0);
  ok('total is the sum over both halves', r.total === sum && r.total === 11 + 6 + 8 + 20 + 8 + 30, `${r.total} vs ${sum}`);
  ok('suiteCount is the number of recorded suites', r.suiteCount === Object.keys(r.suites).length);
  ok('a suite no longer registered is dropped from counts and seconds', !('gone' in r.suites) && !('gone' in r.seconds));
  ok('suites are in registry order', Object.keys(r.suites).join() === REG.join(), Object.keys(r.suites).join());
  ok('pwa carried forward when this run did not measure it', r.pwa === 134, String(r.pwa));
  ok('the input record is not mutated', PREV.suites.home === 10 && PREV.families.systole.commit === 'old-s');
  const fresh = mergeRecord({}, run({ memorizer: { ok: false } }), REG, opts);
  ok('from no previous record, the unearned half is simply absent', fresh && !('memorizer' in fresh.record.suites) && fresh.record.pwa === null);
  ok('suiteCount counts what is recorded, not what is registered', fresh && fresh.record.suiteCount === 3, fresh && String(fresh.record.suiteCount));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
