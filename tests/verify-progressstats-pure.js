#!/usr/bin/env node
/*
 * The numbers the Progress, Study and Brain screens lead with — src/core/progressstats.js.
 *
 *   node tests/verify-progressstats-pure.js
 *
 * Pure Node, over an invented bank, loaded beside the real FSRS as the page loads it. Every expected value is worked
 * out here: FSRS's recall for a card reviewed today is 1, for one never reviewed since the scheduler is its reviews
 * over three, and so on, so the module's arithmetic is checked against this file's, never against itself.
 *
 * What is measured, rather than assumed:
 *   - a chapter's mastery: a card FSRS scheduled counts its chance of recall today, a card from before FSRS its
 *     reviews over three (at most 1), a question only practised 0.22 for each right answer (at most 0.45), an
 *     untouched one 0, a chapter with no questions 0;
 *   - retention is the mean recall of the scheduled cards as a whole percent, null with none scheduled;
 *   - the forecast is seven days from today, each with the cards due that day, across a month's end and the day the
 *     clocks change;
 *   - started counts this bank's questions with a card or a practice record, and not another bank's, nor a name an
 *     object inherits;
 *   - last30 is the thirty days ending today, oldest first, a day with nothing at 0;
 *   - nothing given is changed;
 *   - the page's five names are the calls into this, and the module is written into the page after FSRS and above
 *     them.
 *
 * Run it in a zone whose clocks change (CI's logic job runs it again under TZ=America/New_York): the forecast and a
 * thirty days below cross 8 March 2026, when New York's do.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { blankComments } = require('./_source.js');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ctx = {}; vm.createContext(ctx);
for (const m of ['fsrs', 'progressstats']) vm.runInContext(read('src/core/' + m + '.js'), ctx);
const P = ctx.ProgressStats, F = ctx.FSRS;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);
const near = (a, b) => Math.abs(a - b) < 1e-9;
const safely = fn => { try { return fn(); } catch (e) { return 'THREW ' + e.message; } };

const TODAY = '2026-03-05';
const POOL = [{ id: 'a1', ch: 'Valves' }, { id: 'a2', ch: 'Valves' }, { id: 'a3', ch: 'Valves' }, { id: 'a4', ch: 'Valves' }, { id: 'b1', ch: 'Rhythm' }];
const SRS = {
  a1: { stability: 1e9, difficulty: 5, last: TODAY, due: '2026-03-09', reps: 3 },     // reviewed today: recall 1
  a2: { reps: 1, due: '2026-03-05' },                                                 // from before FSRS: 1/3
  b1: { stability: 1e9, difficulty: 5, last: TODAY, due: '2026-03-06', reps: 2 },
  zz: { stability: 1e9, difficulty: 5, last: TODAY, due: '2026-03-09', reps: 1 },     // another bank's question
};
const PRACTICE = { a3: { c: 1, n: 2 }, a4: { c: 5, n: 5 } };                          // 0.22, and 1.1 capped at 0.45
/* Taken before anything is asked, so a change made by any call below is seen. */
const BEFORE = JSON.stringify([POOL, SRS, PRACTICE]);

head('a chapter\'s mastery');
{
  /* Valves: a1 1, a2 1/3, a3 0.22, a4 0.45, over four. */
  const want = (1 + 1 / 3 + 0.22 + 0.45) / 4;
  const m = safely(() => P.mastery(POOL, SRS, PRACTICE, 'Valves', TODAY));
  ok('the mean of each question\'s share: FSRS\'s recall, a third per old review, 0.22 per right answer capped at 0.45', near(m, want), m + ' against ' + want);
  ok('a card FSRS has scheduled counts its chance of recall, which falls as days pass', near(F.retrievability(1e9, 0), 1)
     && safely(() => P.mastery([{ id: 'x', ch: 'C' }], { x: { stability: 2, difficulty: 5, last: '2026-02-01', reps: 1 } }, {}, 'C', TODAY)) < 0.5);
  ok('an old card with many reviews counts at most 1', safely(() => P.mastery([{ id: 'x', ch: 'C' }], { x: { reps: 9 } }, {}, 'C', TODAY)) === 1);
  ok('a chapter with no questions is 0', safely(() => P.mastery(POOL, SRS, PRACTICE, 'Nothing', TODAY)) === 0);
  ok('a chapter none of whose questions is touched is 0', safely(() => P.mastery([{ id: 'u', ch: 'C' }], {}, {}, 'C', TODAY)) === 0);
}

head('retention over the scheduled cards');
{
  ok('the mean recall of every card FSRS has scheduled, as a whole percent', safely(() => P.retention(SRS, TODAY)) === 100);
  const mixed = { p: { stability: 1e9, last: TODAY }, q: { stability: 2, last: '2026-02-01' } };
  const want = Math.round((1 + F.retrievability(2, F.daysBetween('2026-02-01', TODAY))) / 2 * 100);
  ok('rounded to a whole number', safely(() => P.retention(mixed, TODAY)) === want, safely(() => P.retention(mixed, TODAY)) + ' against ' + want);
  ok('null where no card has been scheduled, an old card not counting', safely(() => P.retention({ a2: { reps: 1 } }, TODAY)) === null && safely(() => P.retention({}, TODAY)) === null);
}

head('seven days of cards coming due');
{
  const fc = safely(() => P.forecast(SRS, TODAY));
  ok('seven days, today first, each with the cards due that day (another bank\'s counted, as the queue would)', J(fc) === J([
    { d: '2026-03-05', n: 1 }, { d: '2026-03-06', n: 1 }, { d: '2026-03-07', n: 0 }, { d: '2026-03-08', n: 0 }, { d: '2026-03-09', n: 2 }, { d: '2026-03-10', n: 0 }, { d: '2026-03-11', n: 0 }]), J(fc));
  ok('across a month\'s end, by the calendar', J(safely(() => P.forecast({}, '2026-02-26')).map(x => x.d)) === J(['2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04']));
}

head('questions started in this bank');
{
  ok('a card or a practice record makes a question started; another bank\'s is not counted', safely(() => P.started(POOL, SRS, PRACTICE)) === 5);
  ok('nor is a name every object inherits', safely(() => P.started([{ id: 'constructor', ch: 'C' }, { id: 'toString', ch: 'C' }], {}, {})) === 0);
  ok('none started is 0', safely(() => P.started(POOL, {}, {})) === 0);
}

head('the last thirty days');
{
  const days = safely(() => P.last30({ '2026-03-05': { a: 4, c: 3 }, '2026-02-04': { a: 9, c: 9 }, '2026-02-03': { a: 1, c: 1 } }, TODAY));
  ok('thirty days ending today, oldest first', Array.isArray(days) && days.length === 30 && days[0].d === '2026-02-04' && days[29].d === '2026-03-05', Array.isArray(days) ? days[0].d + ' … ' + days[29].d : String(days));
  ok('each day\'s answered and right, 0 for a day with nothing, a day before the thirty left out', days[29].a === 4 && days[29].c === 3 && days[0].a === 9 && days[1].a === 0 && days[1].c === 0
     && !days.some(x => x.d === '2026-02-03'));
  /* Thirty days ending 20 March step back across 8 March, the day New York's clocks go forward: counted in
     milliseconds from a local midnight, one day comes out twice and one is lost. */
  const across = safely(() => P.last30({}, '2026-03-20')).map(x => x.d);
  const steps = across.slice(1).every((d, i) => F.daysBetween(across[i], d) === 1);
  ok('thirty different days, each the day after the one before, across the day the clocks change', across.length === 30 && new Set(across).size === 30 && steps && across[0] === '2026-02-19' && across[29] === '2026-03-20',
     across.slice(15, 19).join(' '));
}

head('nothing given is changed');
{
  P.mastery(POOL, SRS, PRACTICE, 'Valves', TODAY); P.retention(SRS, TODAY); P.forecast(SRS, TODAY); P.started(POOL, SRS, PRACTICE); P.last30({}, TODAY);
  ok('the bank, the cards and the practice record are as they were before anything here was asked', J([POOL, SRS, PRACTICE]) === BEFORE);
}

head('the page\'s five names are the calls into this');
{
  /* Read with its comments blanked: the shell explains itself, and quotes what is looked for. */
  const page = blankComments(read('app/systole.html'));
  const once = text => page.split(text).length - 1 === 1;
  const lines = [
    'function masteryFor(ch){ return ProgressStats.mastery(POOL,S.srs,S.practice,ch,todayISO()); }',
    'function avgRetention(){ return ProgressStats.retention(S.srs,todayISO()); }',
    'function forecast7(){ return ProgressStats.forecast(S.srs,todayISO(),S.examDate); }',
    'function startedCount(){ return ProgressStats.started(POOL,S.srs,S.practice); }',
    'function last30(){ return ProgressStats.last30(S.daily,todayISO()); }',
  ];
  const missing = lines.filter(l => !once(l));
  ok('each old name is one line handing over the bank, the record and today', missing.length === 0, missing.join(' | ') || 'all five');
  const slot = page.indexOf('@@SLOT[src:src/core/progressstats.js]@@'), fsrs = page.indexOf('@@SLOT[src:src/core/fsrs.js]@@');
  ok('the module is written into the page once, after FSRS and above all five', slot >= 0 && page.indexOf('@@SLOT[src:src/core/progressstats.js]@@', slot + 1) < 0 && fsrs >= 0 && fsrs < slot
     && ['function masteryFor(', 'function avgRetention(', 'function forecast7(', 'function startedCount(', 'function last30('].every(t => page.indexOf(t) > slot), slot < 0 ? 'no slot' : 'slot at ' + slot);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
