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
/* Every band, not "whatever came back": [].every() is true, so a log with no answers returning no bands at all
   passed both of these. The card draws one row per band in BANDS. */
ok('no confidence bands claim an accuracy', empty.bands.length === C.BANDS.length && empty.bands.every(b => b.accuracy === null),
   `${empty.bands.length} of ${C.BANDS.length} bands`);
ok('every band is marked sparse', empty.bands.length === C.BANDS.length && empty.bands.every(b => b.sparse));
ok('the headline figure is null, not 0 — 0 would read as "never wrong"',
   empty.certainButWrong === null, String(empty.certainButWrong));
ok('and it reports that there is not enough', empty.enough === false);
ok('speed over an empty log is null, not 0', C.speed([]).correctMs === null);
ok('reasons over an empty log share nothing', C.reasons([]).counts.length === C.REASONS.length && C.reasons([]).counts.every(c => c.share === null),
   `${C.reasons([]).counts.length} of ${C.REASONS.length} reasons`);

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

head('a mock exam block: its misses join the error mix, and its answers join nothing else');
{
  const exam = (o = {}) => row({ m: 'exam', ...o });
  const em = C.reasons([
    ...many(N, { ok: 0, why: 'gap' }),
    ...many(3, exam({ ok: 0, why: 'misread' })),    // missed in a block, and the review asked why
    ...many(2, exam({ ok: 0, why: null })),         // missed in a block, not asked about yet
    ...many(4, exam({ ok: 1 })),                    // answered right in a block
  ]);
  const mis = em.counts.find(c => c.id === 'misread');
  ok('a reason given for a miss in a block is counted in the error mix', mis.n === 3 && em.tagged === N + 3, `${mis.n} of ${em.tagged}`);
  ok('a miss in a block that has no reason yet counts toward misses, like any other', em.misses === N + 3 + 2, String(em.misses));
  ok('and a right answer in a block is never a miss', em.misses === N + 5, String(em.misses));
  const ec = C.calibration(many(N, exam({ cf: 3, ok: 0 })));
  const es = C.speed([...many(N, exam({ ok: 1, ms: 3000 })), ...many(N, exam({ ok: 0, ms: 9000 }))]);
  ok('calibration leaves block answers out: no one was asked how sure they were', ec.bands[3].n === 0 && ec.rated === 0, `${ec.bands[3].n} / ${ec.rated}`);
  ok('and so does the speed reading: a block\'s time is not a practice answer\'s', es.n === 0 && es.correctMs === null, JSON.stringify(es));
}

head('the Certain-and-wrong queue: joined by a certain miss, left by the next right answer');
{
  const a = (q, o) => row({ q, ...o });
  const ids = C.certainWrong([
    a('A', { cf: 3, ok: 0 }),                         // certain and wrong
    a('B', { cf: 3, ok: 0 }),
    a('B', { cf: 1, ok: 0 }),                         // wrong again, unsure: still in
    a('C', { cf: 2, ok: 0 }),                         // wrong, but only fairly sure: never in
    a('D', { cf: 3, ok: 0 }),
    a('D', { cf: 0, ok: 1 }),                         // then right, even as a guess: out
    a('E', { cf: 3, ok: 0, m: 'something-else' }),    // not an answer
    a('F', { cf: 3, ok: 0 }),
    a('F', { ok: 1, m: 'exam' }),                     // right in a mock block: out
    a('G', { cf: 3, ok: 0, m: 'exam' }),              // a block never asks how sure
    a('H', { cf: 3, ok: 0, m: 'review-answer' }),
    a('A', { cf: 3, ok: 0 }),                         // A again: now the newest
  ]);
  ok('the queue holds exactly A, H and B, newest first', JSON.stringify(ids) === '["A","H","B"]', JSON.stringify(ids));
  ok('an empty log has an empty queue', C.certainWrong([]).length === 0 && C.certainWrong(null).length === 0);
}

head('a Brier score a week, from the bands\' stated chances');
{
  /* Local noon on a day of the reader's own calendar, stepped by setDate (AGENTS.md: step days by the calendar). */
  const day = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
  ok('a week starts on its Monday, on the local calendar',
     C.weekOf(day(2026, 11, 18)) === '2026-11-16' && C.weekOf(day(2026, 11, 16)) === '2026-11-16' && C.weekOf(day(2026, 11, 22)) === '2026-11-16'
     && C.weekOf(day(2026, 11, 23)) === '2026-11-23',
     [18, 16, 22, 23].map(d => C.weekOf(day(2026, 11, d))).join(' '));
  ok('and across the day the clocks change in autumn (America/New_York, Europe)',
     C.weekOf(day(2026, 11, 1)) === '2026-10-26' && C.weekOf(day(2026, 10, 25)) === '2026-10-19' && C.weekOf(day(2026, 11, 2)) === '2026-11-02',
     [C.weekOf(day(2026, 11, 1)), C.weekOf(day(2026, 10, 25)), C.weekOf(day(2026, 11, 2))].join(' '));
  /* Every clock in the zones CI runs in changes early on a Sunday, the last day of a Monday's week, so a week counted back
     by twenty-four-hour steps comes out right there by luck. Jerusalem's spring change is on a Friday (27 March 2026):
     counted back in hours from that Saturday, the Monday is missed by one. Asked in a child process in that zone, so
     this holds wherever the suite runs. */
  const there = require('child_process').spawnSync(process.execPath, ['-e',
    fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'calib.js'), 'utf8')
    + ';process.stdout.write([new Date(2026,2,28,0,30), new Date(2026,2,29,12), new Date(2026,9,24,23,30)].map(d => this.Calib.weekOf(d.getTime())).join(" "))'],
    { env: Object.assign({}, process.env, { TZ: 'Asia/Jerusalem' }), encoding: 'utf8' });
  ok('and where the clocks change midweek (Asia/Jerusalem, whose spring change is on a Friday)', there.stdout === '2026-03-23 2026-03-23 2026-10-19', there.stdout || there.stderr.slice(0, 120));
  const w1 = day(2026, 11, 3), w2 = day(2026, 11, 11), w3 = day(2026, 11, 17);
  const t = C.brierTrend([
    ...many(N, { t: w1, cf: 3, ok: 0 }),               // all certain and wrong: (0.95 - 0)² each
    ...many(N / 2, { t: w2, cf: 3, ok: 1 }),           // (0.95 - 1)²
    ...many(N / 2, { t: w2, cf: 0, ok: 0 }),           // (0.25 - 0)²
    ...many(N - 1, { t: w3, cf: 2, ok: 1 }),           // one short of a score
    ...many(N, { t: w3, cf: null, ok: 1 }),            // not rated: no part of it
    ...many(N, { t: w3, cf: 3, ok: 0, m: 'exam' }),    // a block: no part of it
  ]);
  const close = (x, y) => x != null && Math.abs(x - y) < 1e-9;
  ok('three weeks, oldest first', t.weeks.map(w => w.week).join(' ') === '2026-11-02 2026-11-09 2026-11-16', t.weeks.map(w => w.week).join(' '));
  ok('a week of Certain-and-wrong scores 0.9025', close(t.weeks[0].brier, 0.9025), String(t.weeks[0].brier));
  ok('a week half certain-and-right, half guessed-and-wrong scores the mean of the two', close(t.weeks[1].brier, (0.0025 + 0.0625) / 2), String(t.weeks[1].brier));
  ok('a week short of MIN_SAMPLES rated answers is listed, with no score', t.weeks[2].n === N - 1 && t.weeks[2].brier === null, JSON.stringify(t.weeks[2]));
  ok('two scored weeks are enough for a trend', t.enough === true);
  const one = C.brierTrend(many(N, { t: w1, cf: 3, ok: 1 }));
  ok('one scored week is not', one.enough === false && one.weeks.length === 1 && close(one.weeks[0].brier, 0.0025), JSON.stringify(one));
  ok('an empty log has no weeks and no trend', C.brierTrend([]).weeks.length === 0 && C.brierTrend([]).enough === false);
  const long = C.brierTrend(Array.from({ length: 10 }, (_, i) => row({ t: day(2026, 9, 1 + 7 * i), cf: 1, ok: 1 })), 8);
  ok('only the last eight weeks are kept', long.weeks.length === 8 && long.weeks[7].week === C.weekOf(day(2026, 9, 64)), long.weeks.map(w => w.week).join(' '));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
