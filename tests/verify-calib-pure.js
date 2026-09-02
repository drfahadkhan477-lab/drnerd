#!/usr/bin/env node
/*
 * The calibration arithmetic, in bare Node — no browser, no build.
 *
 *   node tests/verify-calib-pure.js
 *
 * src/core/calib.js reduces the review log to three readings. It is pure
 * arithmetic over an array, so it runs where CI runs — which matters more
 * here than usual: these numbers are the ones a fellow would change their
 * study plan on, and a silently wrong denominator is the kind of bug that
 * looks plausible for months.
 *
 * The cases that matter are the empty and the sparse ones. A calibration
 * readout that quotes 100% over three answers is worse than one that says it
 * does not know yet, because the first is believed.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const mod = {};
new Function('module', 'exports', fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'calib.js'), 'utf8'))
  .call(mod, { exports: mod }, mod);
const C = mod.Calib;
const N = C.MIN_SAMPLES;

const row = (o = {}) => ({ m: 'practice', ok: 1, cf: null, ms: null, why: null, ...o });
const many = (n, o) => Array.from({ length: n }, () => row(o));

head('an empty log says nothing rather than saying zero');
const empty = C.calibration([]);
ok('no confidence bands claim an accuracy', empty.bands.every(b => b.accuracy === null));
ok('every band is marked sparse', empty.bands.every(b => b.sparse));
ok('the headline figure is null, not 0 — 0 would read as "never wrong"',
   empty.certainButWrong === null, String(empty.certainButWrong));
ok('and it reports that there is not enough', empty.enough === false);
ok('speed over an empty log is null, not 0', C.speed([]).correctMs === null);
ok('reasons over an empty log share nothing', C.reasons([]).counts.every(c => c.share === null));

head('a sparse band refuses to quote a percentage');
const sparse = C.calibration([...many(3, { cf: 3, ok: 1 })]);
ok('three certain answers do not produce an accuracy', sparse.bands[3].accuracy === null,
   String(sparse.bands[3].accuracy));
ok('but the count is still reported honestly', sparse.bands[3].n === 3, String(sparse.bands[3].n));

head('a full band computes the accuracy it should');
const full = C.calibration([
  ...many(N, { cf: 3, ok: 1 }),                      // certain and right
  ...many(N, { cf: 3, ok: 0 }),                      // certain and wrong
  ...many(N, { cf: 0, ok: 0 }),                      // guessing, wrong
]);
ok('the Certain band is 50% over an even split',
   Math.abs(full.bands[3].accuracy - 0.5) < 1e-9, String(full.bands[3].accuracy));
ok('so "certain but wrong" reads 50%',
   Math.abs(full.certainButWrong - 0.5) < 1e-9, String(full.certainButWrong));
ok('the Guess band is 0%', full.bands[0].accuracy === 0, String(full.bands[0].accuracy));
ok('and rated counts every rated answer, not every answer', full.rated === N * 3, String(full.rated));

head('skipped confidence is absent, not counted as a guess');
/* The skip path is the common path. If a skipped prompt landed in the Guess
   band it would invent a self-assessment the learner never made. */
const skipped = C.calibration([...many(N, { cf: null, ok: 1 }), ...many(N, { cf: 0, ok: 0 })]);
ok('unrated answers stay out of every band', skipped.rated === N, String(skipped.rated));
ok('and out of the Guess band in particular', skipped.bands[0].n === N, String(skipped.bands[0].n));

head('speed is a median, and nulls are absent rather than zero');
const sp = C.speed([
  ...many(N, { ok: 1, ms: 4000 }),
  ...many(N, { ok: 0, ms: 20000 }),
  ...many(5,  { ok: 1, ms: null }),      // walked away, or predates the field
]);
ok('correct answers median to their own value', sp.correctMs === 4000, String(sp.correctMs));
ok('incorrect answers median separately', sp.wrongMs === 20000, String(sp.wrongMs));
ok('null timings do not drag the median toward zero', sp.correctMs === 4000);
ok('and are excluded from the count', sp.n === N * 2, String(sp.n));
ok('fast-and-right is not flagged fragile', sp.fragile === false);

const fragile = C.speed([...many(N, { ok: 1, ms: 30000 }), ...many(N, { ok: 0, ms: 5000 })]);
ok('right-but-slower-than-wrong is flagged as fragile retrieval', fragile.fragile === true);

head('the error mix counts only tagged misses');
const rs = C.reasons([
  ...many(N, { ok: 0, why: 'misread' }),
  ...many(4, { ok: 0, why: 'gap' }),
  ...many(6, { ok: 0, why: null }),       // wrong, untagged
  ...many(N, { ok: 1, why: null }),       // correct — never a miss
]);
ok('correct answers are never in the error mix',
   rs.counts.reduce((n, c) => n + c.n, 0) === N + 4, String(rs.tagged));
ok('untagged misses count toward misses but not shares',
   rs.misses === N + 4 + 6, String(rs.misses));
ok('the dominant reason is identified', rs.top && rs.top.id === 'misread',
   rs.top && rs.top.id);
ok('shares are over tagged misses, and sum to one',
   Math.abs(rs.counts.reduce((n, c) => n + (c.share || 0), 0) - 1) < 1e-9);

head('review answers count alongside practice, other log rows do not');
const mixed = C.calibration([
  ...many(N, { m: 'review-answer', cf: 3, ok: 1 }),
  ...many(N, { m: 'something-else', cf: 3, ok: 0 }),
]);
ok('a review answer is a real answer', mixed.bands[3].n === N, String(mixed.bands[3].n));
ok('and an unrelated log row is not', mixed.bands[3].accuracy === 1, String(mixed.bands[3].accuracy));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
