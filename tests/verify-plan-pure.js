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
const day = n => FSRS.localDateToISO(new Date(FSRS.isoToLocalDate(TODAY).getTime() + n * 86400000));
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
  ok('too little data gives no forecast at all', SP.readiness({ pool, srs: {}, chStats: {}, today: TODAY }).status === 'no-data');
  ok('an exam date in the past says so', SP.readiness(Object.assign({}, base, { examDate: day(-2) })).status === 'exam-day');
  ok('the verdict reads as a sentence with the real numbers', /60 of 120/.test(r0.text) && /60 days left/.test(r0.text), r0.text);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
