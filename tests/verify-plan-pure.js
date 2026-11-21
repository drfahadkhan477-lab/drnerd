#!/usr/bin/env node
/*
 * "I have 20 minutes", and "am I on track?" — src/core/studyplan.js.
 *
 *   node tests/verify-plan-pure.js
 *
 * Pure Node. The fixtures are real spaced-repetition cards made by the app's own
 * scheduler (FSRS.update), over an invented bank of invented chapters and ids, so
 * the planner is held to the shapes the app really stores, not look-alikes.
 *
 * What is measured, rather than assumed:
 *   - the plan fits the time, repeats nothing, and draws only from the pool;
 *   - due cards come first and the MOST FORGOTTEN first (not the oldest due date);
 *   - the weak-chapter share goes to chapters below the fellow's own average, and
 *     to what was missed or never seen there;
 *   - a fresh start spreads across chapters;
 *   - damaged data (a backup with fields missing) gives a plan or an honest
 *     "nothing to plan", never a throw and never NaN;
 *   - the readiness verdict follows the numbers it is given.
 */
'use strict';
const FSRS = require('../src/core/fsrs.js').FSRS;
const SP = require('../src/core/studyplan.js').StudyPlan;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const TODAY = '2026-10-10';
/* Calendar days, not 24-hour steps: where the clocks change, a day is 23 or 25 hours, and TODAY plus n times 86400000 ms lands on the
   day before once a change has been crossed (2026-10-10 plus 60 is 2026-12-08 in New York). setDate() steps the calendar. */
const day = n => { const d = FSRS.isoToLocalDate(TODAY); d.setDate(d.getDate() + n); return FSRS.localDateToISO(d); };
const CH = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
const pool = [];
for (const ch of CH) for (let i = 1; i <= 24; i++) pool.push({ id: `${ch.slice(0, 3).toUpperCase()}_${i}`, ch });
const byCh = ch => pool.filter(q => q.ch === ch);

/* A card reviewed `ago` days back with a given rating, as the app would have stored it. */
const card = (ago, rating) => FSRS.update(FSRS.update(null, rating || 3, day(-ago - 20)), rating || 3, day(-ago));
const ids = p => p.items.map(i => i.id);

head('the plan fits the time and repeats nothing');
{
  const srs = {};
  byCh('Alpha').slice(0, 20).forEach((q, i) => { srs[q.id] = card(30 + i, 3); });   // long overdue
  const p20 = SP.plan({ minutes: 20, pool, srs, chStats: {}, today: TODAY });
  const p45 = SP.plan({ minutes: 45, pool, srs, chStats: {}, today: TODAY });
  ok('20 minutes at 75 s a question is 16 questions', p20.budget === 16 && p20.items.length === 16, `${p20.items.length} of ${p20.budget}`);
  ok('45 minutes is a longer plan', p45.items.length === 36 && p45.items.length > p20.items.length, String(p45.items.length));
  ok('no question appears twice', new Set(ids(p45)).size === ids(p45).length);
  ok('every question is in the pool', ids(p45).every(id => pool.some(q => q.id === id)));
  const fast = SP.plan({ minutes: 20, secPerQuestion: 40, pool, srs, chStats: {}, today: TODAY });
  ok('a faster reader gets more questions in the same time', fast.items.length === 30, String(fast.items.length));
  ok('the same input gives the same plan', JSON.stringify(SP.plan({ minutes: 20, pool, srs, chStats: {}, today: TODAY })) === JSON.stringify(p20));
}

head('due cards come first, most forgotten first');
{
  const srs = {};
  const [a, b, c] = byCh('Beta');
  srs[a.id] = card(2, 3);                 // reviewed 2 days ago, due, but fresh in memory
  srs[b.id] = FSRS.update(null, 1, day(-40));   // a card the fellow lapsed on, long ago: nearly forgotten
  srs[b.id].due = day(-1);
  srs[a.id].due = day(-30);               // due much longer ago, but remembered better
  srs[c.id] = card(5, 3); srs[c.id].due = day(2);   // not due yet
  const p = SP.plan({ minutes: 20, pool, srs, chStats: {}, today: TODAY });
  const dueIds = p.items.filter(i => i.reason === 'due').map(i => i.id);
  ok('the least-remembered card is first, though it was due more recently', dueIds[0] === b.id && dueIds.includes(a.id), dueIds.join(', '));
  ok('a card that is not due yet is not in the due part', !dueIds.includes(c.id));
  const r = id => SP.retrievability(srs[id], TODAY);
  ok('and that is because it is the less remembered of the two', r(b.id) < r(a.id), `${r(b.id).toFixed(2)} vs ${r(a.id).toFixed(2)}`);
}

head('the weak-chapter share goes to chapters below your own average');
{
  const chStats = { Alpha: { correct: 28, total: 30 }, Beta: { correct: 8, total: 30 }, Gamma: { correct: 24, total: 30 }, Delta: { correct: 25, total: 30 }, Epsilon: { correct: 26, total: 30 } };
  const missed = new Set(byCh('Beta').slice(0, 4).map(q => q.id));
  const srs = {}; byCh('Beta').slice(0, 6).forEach(q => { srs[q.id] = card(1, 3); srs[q.id].due = day(3); });   // seen, not due
  const p = SP.plan({ minutes: 20, pool, srs, chStats, missed, today: TODAY });
  const weak = p.items.filter(i => i.reason === 'weak');
  ok('the weakest chapter is named', p.weakChapters[0] && p.weakChapters[0].ch === 'Beta' && p.weakChapters[0].pct === 27, JSON.stringify(p.weakChapters[0]));
  ok('weak questions come only from chapters below the average', weak.length > 0 && weak.every(i => i.ch === 'Beta'), `${weak.length} from ${[...new Set(weak.map(i => i.ch))]}`);
  ok('and missed questions come before ones never seen', weak.slice(0, 4).every(i => missed.has(i.id)), weak.slice(0, 4).map(i => i.id).join(', '));
  ok('questions seen and answered well are not drawn as "weak"', weak.every(i => missed.has(i.id) || !srs[i.id]));
  ok('the explanation names the chapter and its score', /Beta 27%/.test(p.text), p.text);
  /* The weak part and the new part can both want the same never-seen question in a weak
     chapter; a repeat there is the one place the no-repeat rule is really under test. So
     first check the overlap exists: the weak part took a never-seen question, which is also
     the first thing the new part would take from that chapter. */
  const firstUnseenBeta = byCh('Beta').find(q => !srs[q.id]);
  ok('the weak part takes a never-seen question the new part would also want', weak.some(i => i.id === firstUnseenBeta.id), firstUnseenBeta.id);
  ok('and still no question is chosen twice', new Set(ids(p)).size === ids(p).length, `${ids(p).length - new Set(ids(p)).size} repeated`);
  /* Beta is the only chapter below average above, so the order of weak chapters was never
     exercised. Here two are below it. */
  const two2 = SP.weakChapters({ Alpha: { correct: 28, total: 30 }, Beta: { correct: 8, total: 30 }, Gamma: { correct: 15, total: 30 }, Delta: { correct: 27, total: 30 }, Epsilon: { correct: 26, total: 30 } }, 3);
  ok('with two chapters below average the weakest is first', two2.length === 2 && two2[0].ch === 'Beta' && two2[1].ch === 'Gamma', JSON.stringify(two2.map(w => w.ch + w.pct)));
  const two = SP.plan({ minutes: 20, pool, srs: {}, chStats: { Alpha: { correct: 28, total: 30 }, Beta: { correct: 4, total: 30 } }, today: TODAY });
  ok('with two chapters attempted only the one below average is weak', two.weakChapters.length === 1 && two.weakChapters[0].ch === 'Beta', JSON.stringify(two.weakChapters.map(w => w.ch)));
  const even = SP.plan({ minutes: 20, pool, srs: {}, chStats: { Alpha: { correct: 20, total: 30 }, Beta: { correct: 20, total: 30 } }, today: TODAY });
  ok('and when every chapter is equal none is called weak', even.weakChapters.length === 0 && even.counts.weak === 0);
}

head('chapter ranking uses accuracy before display rounding');
{
  const tied = { Alpha: { correct: 10, total: 30 }, Beta: { correct: 10, total: 30 } };
  ok('equal one-third accuracy does not make either chapter weak', SP.weakChapters(tied).length === 0);
  ok('a single chapter cannot be weaker than itself', SP.weakChapters({ Alpha: tied.Alpha }).length === 0);
  const close = SP.weakChapters({ Alpha: { correct: 506, total: 1000 }, Beta: { correct: 505, total: 1000 } });
  ok('a weaker chapter is found even when rounded percentages hide the difference', close.length === 1 && close[0].ch === 'Beta');
  const ranked = SP.weakChapters({ Alpha: { correct: 504, total: 1000 }, Beta: { correct: 501, total: 1000 }, Strong: { correct: 900, total: 1000 } });
  ok('weak chapters with the same display percentage are ordered by measured accuracy', ranked.length === 2 && ranked[0].ch === 'Beta');
}

head('chapter names are data, including inherited object names');
{
  const special = ['constructor', '__proto__', 'toString'];
  const sample = special.map((ch, i) => ({ id: 'special-' + i, ch }));
  let fresh, weak, freshError, weakError;
  try { fresh = SP.plan({ pool: sample, today: TODAY }); } catch (e) { freshError = e.message; }
  const chStats = Object.fromEntries(special.map(ch => [ch, { correct: 1, total: 10 }]));
  chStats.Strong = { correct: 90, total: 100 };
  try { weak = SP.plan({ pool: sample, chStats, today: TODAY }); } catch (e) { weakError = e.message; }
  ok('new-question planning accepts chapter names that exist on Object.prototype', !freshError && fresh.items.length === 3 && new Set(ids(fresh)).size === 3, freshError || '');
  ok('weak-chapter planning accepts those chapter names too', !weakError && weak.items.some(i => i.reason === 'weak'), weakError || '');
}

head('a fresh start spreads across chapters');
{
  const p = SP.plan({ minutes: 20, pool, srs: {}, chStats: {}, today: TODAY });
  const chs = new Set(p.items.map(i => i.ch));
  ok('a first plan is all new questions', p.items.length === 16 && p.items.every(i => i.reason === 'new'));
  ok('drawn from every chapter, not the first one alphabetically', chs.size === CH.length, [...chs].join(', '));
  const biggest = Math.max(...CH.map(ch => p.items.filter(i => i.ch === ch).length));
  ok('and no chapter has more than a fair share', biggest <= Math.ceil(16 / CH.length), String(biggest));
}

head('a heavy review load fills the time');
{
  const srs = {};
  pool.forEach((q, i) => { srs[q.id] = card(10 + (i % 5), 3); srs[q.id].due = day(-1); });
  const p = SP.plan({ minutes: 20, pool, srs, chStats: {}, today: TODAY });
  ok('with more due than time, the plan is all due and nothing is new', p.counts.due === 16 && p.counts.new === 0, JSON.stringify(p.counts));
}

head('damaged data never throws and never reports NaN');
{
  const bad = [undefined, null, 5, 'x', [], {}, { pool: 7 }, { pool: [null, 3, { id: 9 }, { id: 'A', ch: 'Z' }], srs: { A: { stability: NaN, due: 5 } }, chStats: { Z: { correct: 'x', total: 3 } }, missed: 3 }];
  let threw = null, nan = false;
  for (const b of bad) {
    try {
      const p = SP.plan(b), r = SP.readiness(b);
      if (/NaN|undefined/.test(p.text + r.text)) nan = true;
    } catch (e) { threw = e.message; }
  }
  ok('plan() and readiness() accept anything', threw === null, threw || `${bad.length} inputs`);
  ok('and say nothing like NaN or undefined', !nan);
  const empty = SP.plan({ pool: [], today: TODAY });
  ok('an empty bank is an honest empty plan', empty.items.length === 0 && /Nothing to plan/.test(empty.text), empty.text);
  const odd = SP.plan({ minutes: -5, pool, today: TODAY }), odd2 = SP.plan({ minutes: 'soon', pool, today: TODAY });
  ok('a nonsense number of minutes falls back to 20', odd.minutes === 20 && odd2.minutes === 20 && odd.items.length === 16);
  ok('a card with no last-review date counts as forgotten, not remembered', SP.retrievability({ stability: 50, due: day(-1) }, TODAY) === 0);
}

head('readiness follows the numbers');
{
  const srs = {};
  pool.slice(0, 60).forEach(q => { srs[q.id] = card(3, 3); srs[q.id].due = day(4); });
  const chStats = { Alpha: { correct: 28, total: 30 }, Beta: { correct: 10, total: 30 }, Gamma: { correct: 24, total: 30 } };
  const base = { pool, srs, chStats, today: TODAY };
  const r0 = SP.readiness(Object.assign({}, base, { examDate: day(60), recentPerDay: 30 }));
  ok('coverage counts what has been seen', r0.seen === 60 && r0.unseen === 60 && Math.abs(r0.coverage - 0.5) < 1e-9, `${r0.seen} of ${r0.total}`);
  ok('retention is a probability', r0.retention > 0 && r0.retention <= 1, r0.retention.toFixed(2));
  ok('the weakest chapter is the one furthest below the average', r0.weakChapters[0].ch === 'Beta', JSON.stringify(r0.weakChapters.map(w => w.ch)));
  ok('plenty of days and a good pace is ahead', r0.status === 'ahead' && r0.daysLeft === 60, `${r0.status}, ${r0.daysToFinish} days to finish of ${r0.daysLeft}`);
  /* 60 questions unseen and none due: 10 days at 4 a day needs 15; 6 a day would do it. */
  const tight = SP.readiness(Object.assign({}, base, { examDate: day(10), recentPerDay: 4 }));
  ok('too few days for the pace is behind, and says what pace would do', tight.status === 'behind' && tight.needPerDay === 6 && /about 6 a day/.test(tight.text), tight.text);
  /* 20 days left, 3.5 a day: 18 days. Over three quarters of the time, so not "ahead". */
  const edge = SP.readiness(Object.assign({}, base, { examDate: day(20), recentPerDay: 3.5 }));
  ok('finishing with little to spare is on track, not ahead', edge.status === 'on-track', `${edge.status}: ${edge.daysToFinish} of ${edge.daysLeft}`);
  ok('no pace given gives the pace needed', SP.readiness(Object.assign({}, base, { examDate: day(30) })).status === 'pace-unknown');
  ok('no exam date gives no countdown', SP.readiness(base).status === 'no-exam-date');
  const invalidDates = ['next week', '2099-02-30', '2099-13-01', '2100-02-29'];
  ok('invalid calendar dates give no forecast countdown', invalidDates.every(examDate => {
    const r = SP.readiness(Object.assign({}, base, { examDate }));
    return r.status === 'no-exam-date' && r.daysLeft === null;
  }));
  ok('a valid leap day remains usable', SP.readiness(Object.assign({}, base, { examDate: '2028-02-29' })).daysLeft > 0);

  ok('too little data gives no forecast at all', SP.readiness({ pool, srs: {}, chStats: {}, today: TODAY }).status === 'no-data');
  ok('an exam date in the past says so', SP.readiness(Object.assign({}, base, { examDate: day(-2) })).status === 'exam-day');
  ok('the verdict reads as a sentence with the real numbers', /60 of 120/.test(r0.text) && /60 days left/.test(r0.text), r0.text);
}

head('the last fortnight gives due reviews the time available');
{
  const pool = [{id:'cold',ch:'Alpha'},{id:'warm',ch:'Beta'},{id:'new',ch:'Alpha'}];
  const srs = {
    cold:{stability:1,last:day(-10),due:day(-1)},
    warm:{stability:4,last:day(-10),due:TODAY}
  };
  const order = (days, blueprint) => SP.plan({pool,srs,today:TODAY,minutes:3,secPerQuestion:60,
    examDate:day(days),blueprint}).items.map(it=>it.id).join(',');
  ok('a matching blueprint can put a higher-share chapter first; both due precede new',
    order(14,{Alpha:1,Beta:5}) === 'warm,cold,new');
  ok('without usable weights the lowest recall leads, including on the eve',
    [null,{}, {Absent:10,Beta:5}].every(w => order(1,w) === 'cold,warm,new'));
  ok('at fifteen days ordinary planning still interleaves new and due cards',
    order(15,{Alpha:1,Beta:5}) === 'cold,new,warm');
}

head('S7: each chapter, and the exam, as an interval');
{
  const near = (x, y, tol) => Math.abs(x - y) < (tol || 1e-9);
  /* The beta distribution itself, against values known in closed form. */
  ok('the Beta cdf: Beta(2,3) at 0.5 is 11/16, Beta(1,1) is the identity, Beta(5,5) is even at 0.5',
     near(SP.betaCdf(0.5, 2, 3), 11 / 16) && [0.1, 0.37, 0.9].every(x => near(SP.betaCdf(x, 1, 1), x)) && near(SP.betaCdf(0.5, 5, 5), 0.5)
     && SP.betaCdf(0, 2, 3) === 0 && SP.betaCdf(1, 2, 3) === 1, [SP.betaCdf(0.5, 2, 3), SP.betaCdf(0.5, 5, 5)].join(' '));
  ok('and its quantile undoes it, at both tails and in the middle', [[0.1, 2, 8], [0.5, 30, 12], [0.9, 2, 8], [0.95, 0.7, 0.9]].every(([p, a, b]) => near(SP.betaCdf(SP.betaQuantile(p, a, b), a, b), p, 1e-9)),
     [[0.1, 2, 8], [0.9, 2, 8]].map(([p, a, b]) => SP.betaQuantile(p, a, b).toFixed(6)).join(' '));
  ok('Beta(2,8)\'s 90th percentile is 0.36836, as tabulated', near(SP.betaQuantile(0.9, 2, 8), 0.368362, 1e-5), SP.betaQuantile(0.9, 2, 8).toFixed(6));

  const stats = { Alpha: { correct: 28, total: 30 }, Beta: { correct: 10, total: 30 }, Gamma: { correct: 24, total: 30 }, Delta: { correct: 3, total: 5 } };
  const srs = {};
  pool.slice(0, 60).forEach(q => { srs[q.id] = card(3, 3); srs[q.id].due = day(4); });
  const base = { pool, srs, chStats: stats, today: TODAY, examDate: day(60), recentPerDay: 30 };
  const r = SP.readiness(Object.assign({}, base, { blueprint: null }));
  const row = ch => r.chapters.find(x => x.ch === ch);
  ok('every chapter row has an interval around what was measured', r.chapters.length === 4 && r.chapters.every(x => x.lo <= x.pct && x.pct <= x.hi && x.lo < x.hi),
     r.chapters.map(x => `${x.ch} ${x.lo}-${x.pct}-${x.hi}`).join(', '));
  ok('five answers give a wider interval than thirty', row('Delta').hi - row('Delta').lo > row('Gamma').hi - row('Gamma').lo, `Delta ${row('Delta').hi - row('Delta').lo}, Gamma ${row('Gamma').hi - row('Gamma').lo}`);
  /* What a flat Beta(1,1) prior would centre one right of five on: the middle of Beta(2,5)'s interval. */
  const flat = 50 * (SP.betaQuantile(0.1, 2, 5) + SP.betaQuantile(0.9, 2, 5));
  const thin = SP.weakChapters({ Alpha: { correct: 90, total: 100 }, Beta: { correct: 1, total: 5 } }, 3)[0];
  ok('a chapter with few answers leans toward the fellow\'s own accuracy, not toward 50%: one of five, among ninety of a hundred, has the middle of its interval above where a flat prior puts it, and still below a half',
     thin.ch === 'Beta' && thin.pct === 20 && (thin.lo + thin.hi) / 2 > flat && (thin.lo + thin.hi) / 2 < 50, JSON.stringify(thin) + ' · with a flat prior the middle is ' + flat.toFixed(1));
  ok('the weakest chapters carry their interval', r.weakChapters.length && r.weakChapters.every(w => Number.isInteger(w.lo) && Number.isInteger(w.hi) && w.lo <= w.pct && w.pct <= w.hi), JSON.stringify(r.weakChapters));
  ok('and the sentence says them as intervals, not one number', /Weakest: Beta \(likely \d+ to \d+%\)/.test(r.text) && !/Beta \(\d+%\)/.test(r.text), r.text);

  ok('with no blueprint there is no exam score, and the sentence says it waits for one', r.score.state === 'none' && /A likely exam score waits for the exam blueprint\./.test(r.text) && !/Across the exam/.test(r.text), r.text);
  const bad = SP.readiness(Object.assign({}, base, { blueprint: { Alpha: 30, Omega: 20, Zeta: 5 } }));
  ok('a blueprint naming chapters the bank does not have is refused, by name, not scaled over the rest', bad.score.state === 'refused' && JSON.stringify(bad.score.unknown) === '["Omega","Zeta"]' && /does not have \(Omega, Zeta\)/.test(bad.text) && !/Across the exam/.test(bad.text), bad.text);

  const W = { Alpha: 30, Beta: 30, Gamma: 20, Delta: 10, Epsilon: 10 };
  const sc = SP.readiness(Object.assign({}, base, { blueprint: W })).score;
  ok('a blueprint gives an exam score: its interval is around its mean', sc.state === 'ok' && sc.lo < sc.mean && sc.mean < sc.hi && sc.level === 0.8 && sc.chapters === 5, JSON.stringify(sc));
  const asShares = SP.examScore(pool, stats, { Alpha: 0.3, Beta: 0.3, Gamma: 0.2, Delta: 0.1, Epsilon: 0.1 });
  ok('weights in percent or as shares are the same blueprint', near(asShares.mean, sc.mean) && near(asShares.lo, sc.lo) && near(asShares.hi, sc.hi));
  const pr = { a: 1 + (SP.PRIOR_N - 2) * (65 / 95), b: 1 + (SP.PRIOR_N - 2) * (30 / 95) };      // pooled: 65 right of 95
  const mean = ch => { const s = stats[ch] || { correct: 0, total: 0 }; return (pr.a + s.correct) / (pr.a + pr.b + s.total); };
  ok('its mean is each chapter\'s posterior mean, weighted by the blueprint (Epsilon, never answered, at the prior)',
     near(sc.mean, 0.3 * mean('Alpha') + 0.3 * mean('Beta') + 0.2 * mean('Gamma') + 0.1 * mean('Delta') + 0.1 * mean('Epsilon')), `${sc.mean} vs ${0.3 * mean('Alpha') + 0.3 * mean('Beta') + 0.2 * mean('Gamma') + 0.1 * mean('Delta') + 0.1 * mean('Epsilon')}`);
  const only = SP.examScore(pool, stats, { Gamma: 1 });
  const g = SP.readiness(Object.assign({}, base, { blueprint: null })).chapters.find(x => x.ch === 'Gamma');
  ok('a blueprint of one chapter is exactly that chapter\'s interval', Math.round(only.lo * 100) === g.lo && Math.round(only.hi * 100) === g.hi, `${only.lo} ${only.hi} vs ${g.lo} ${g.hi}`);
  const left = SP.examScore(pool, stats, { Alpha: 50, Gamma: 50 }), zero = SP.examScore(pool, stats, { Alpha: 50, Gamma: 50, Beta: 0 });
  ok('a chapter left out, or weighted zero, counts for nothing', near(left.mean, zero.mean) && near(left.lo, zero.lo));

  /* The interval of the weighted sum, against the thing it approximates: chapters drawn independently from their
     posteriors, many times, with a seeded generator, and the middle 80% of the weighted sums read off. */
  let seed = 12345;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const gamma = k => { if (k < 1) return gamma(k + 1) * Math.pow(rnd(), 1 / k); const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) { let x, v; do { x = normal(); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = rnd(); if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v; } };
  const draws = [];
  for (let i = 0; i < 40000; i++) {
    let t = 0;
    for (const ch of Object.keys(W)) { const s = stats[ch] || { correct: 0, total: 0 }; const x = gamma(pr.a + s.correct), y = gamma(pr.b + s.total - s.correct); t += W[ch] / 100 * x / (x + y); }
    draws.push(t);
  }
  draws.sort((x, y) => x - y);
  const q10 = draws[Math.floor(0.1 * draws.length)], q90 = draws[Math.floor(0.9 * draws.length)];
  ok('the exam interval is within a point of the one forty thousand independent draws give', Math.abs(q10 - sc.lo) < 0.01 && Math.abs(q90 - sc.hi) < 0.01,
     `drawn ${q10.toFixed(4)} to ${q90.toFixed(4)}, said ${sc.lo.toFixed(4)} to ${sc.hi.toFixed(4)}`);

  const rr = SP.readiness(Object.assign({}, base, { blueprint: W }));
  ok('and the sentence gives it as an interval, with its level', new RegExp(`Across the exam's blueprint, a score of ${Math.round(sc.lo * 100)} to ${Math.round(sc.hi * 100)}% is likely \\(80% interval\\)\\.`).test(rr.text), rr.text);
  const more = {}; Object.keys(stats).forEach(ch => { more[ch] = { correct: stats[ch].correct * 4, total: stats[ch].total * 4 }; });
  const sc4 = SP.examScore(pool, more, W);
  ok('four times the answers at the same rates narrow it', sc4.hi - sc4.lo < sc.hi - sc.lo, `${(sc4.hi - sc4.lo).toFixed(3)} < ${(sc.hi - sc.lo).toFixed(3)}`);
  const none = SP.examScore(pool, {}, W);
  ok('with nothing answered at all, the interval is wide and centred at a half', near(none.mean, 0.5) && none.hi - none.lo > 0.2, JSON.stringify(none));
}

head('S7: the page\'s blueprint is the owner\'s, and empty until filled in');
{
  const fs = require('fs'), path = require('path'), vm = require('vm');
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(read('src/core/blueprint.js'), ctx);
  ok('src/core/blueprint.js holds no weights and no source: none are estimated', ctx.Blueprint && ctx.Blueprint.weights === null && ctx.Blueprint.source === null, JSON.stringify(ctx.Blueprint));
  vm.runInContext(read('src/core/fsrs.js') + read('src/core/studyplan.js'), ctx);
  ctx.Blueprint.weights = { Alpha: 1 };
  const said = vm.runInContext('StudyPlan.readiness(' + JSON.stringify({ pool, srs: {}, chStats: { Alpha: { correct: 15, total: 20 } }, today: TODAY }) + ')', ctx);
  ok('readiness() asked with no blueprint reads the page\'s', said.score.state === 'ok', JSON.stringify(said.score));
  const page = read('app/systole.html');
  const at = s2 => page.indexOf(s2);
  ok('the page writes it in once, before studyplan.js', page.split('@@SLOT[src:src/core/blueprint.js]@@').length === 2 && at('@@SLOT[src:src/core/blueprint.js]@@') < at('@@SLOT[src:src/core/studyplan.js]@@'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
