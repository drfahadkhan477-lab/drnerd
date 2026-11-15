#!/usr/bin/env node
/*
 * What a review session holds, and how the next interval is said — src/core/reviewqueue.js.
 *
 *   node tests/verify-reviewqueue-pure.js
 *
 * Pure Node, over an invented bank. The module has no DOM, no clock and no storage: it is given the
 * questions, the cards and today's date, so every expected list is worked out here from the fixture,
 * never read back from the module.
 *
 * What is measured, rather than assumed:
 *   - a question is due when its card's day is today or earlier, and only then; a question with no card,
 *     a card with no day, and a card whose question the bank no longer has are not due;
 *   - new questions are the ones with no card, taken a round at a time across the chapters, so a short
 *     session reaches every chapter before it takes a second question from any;
 *   - a session is EVERY due question, however many, then new ones up to the size asked for: due cards
 *     are never dropped to make a round number, and never crowded out by new ones;
 *   - nothing handed in is changed, and what comes back is the bank's own question objects;
 *   - the words on a rating button for a day, days, weeks and months;
 *   - the page's four functions are the calls into this, with the bank, the cards and today.
 *
 * Dates are written as ISO days and stepped by the calendar (setDate), never by a count of
 * milliseconds; nothing here reads the clock or the time zone, so the run is the same in any zone.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');
const R = require('../src/core/reviewqueue.js').ReviewQueue;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ids = list => { try { return list.map(q => q.id); } catch (_) { return ['NOT A LIST']; } };
/* A module that throws says FAIL where it was asked, and the run goes on. */
const safely = fn => { try { return fn(); } catch (e) { return ['THREW ' + e.message]; } };

/* The reader's day and its neighbours, stepped by the calendar. */
const TODAY = '2026-03-08';
const day = n => { const d = new Date(2026, 2, 8); d.setDate(d.getDate() + n); const p = x => String(x).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };

/* An invented bank, in the bank's order: chapter A has four questions, B one, C three. BANK() makes it afresh.
   The copy most checks share is frozen, questions and all: a module that wrote on what it was given would throw
   there, and each check that asked would say FAIL. The first version of this file shared one unfrozen bank, and
   the check that nothing is changed passed on a module that marked every question it dealt: the marks were
   already on the questions, left by the checks before it, when it took its "before". */
const q = (id, ch) => ({ id, ch });
const BANK = () => [q('A1', 'Alpha'), q('A2', 'Alpha'), q('B1', 'Beta'), q('A3', 'Alpha'), q('C1', 'Gamma'), q('C2', 'Gamma'), q('A4', 'Alpha'), q('C3', 'Gamma')];
const POOL = Object.freeze(BANK().map(Object.freeze));
const card = n => ({ due: day(n), ivl: 3, reps: 1 });

head('the fixture\'s days are calendar days');
{
  ok('today is today, and its neighbours are the days beside it', day(0) === TODAY && day(-1) === '2026-03-07' && day(1) === '2026-03-09', [day(-1), day(0), day(1)].join(' '));
  ok('and a step across a month end lands on the right day', day(-8) === '2026-02-28' && day(24) === '2026-04-01', [day(-8), day(24)].join(' '));
}

head('what is due');
{
  const srs = { A1: card(-5), A2: card(0), B1: card(1), C1: card(-1), C2: card(30) };
  ok('a card due today or earlier is due, in the bank\'s order', same(safely(() => ids(R.due(POOL, srs, TODAY))), ['A1', 'A2', 'C1']), String(safely(() => ids(R.due(POOL, srs, TODAY)))));
  ok('a card due tomorrow is not', !safely(() => ids(R.due(POOL, srs, TODAY))).includes('B1'));
  ok('and is, tomorrow', safely(() => ids(R.due(POOL, srs, day(1)))).includes('B1'));
  ok('a question with no card is not due', !safely(() => ids(R.due(POOL, srs, TODAY))).includes('A3'));
  ok('a card with no day is not due', same(safely(() => ids(R.due(POOL, { A1: {}, A2: { due: null }, A3: { due: undefined } }, TODAY))), []), String(safely(() => ids(R.due(POOL, { A1: {}, A2: { due: null } }, TODAY)))));
  ok('a card whose question the bank no longer has is not dealt', same(safely(() => ids(R.due(POOL, { GONE: card(-9), A1: card(-1) }, TODAY))), ['A1']));
  ok('days compare as days across a month and a year', same(safely(() => ids(R.due(POOL, { A1: { due: '2025-12-31' }, A2: { due: '2026-02-28' }, A3: { due: '2026-03-10' }, A4: { due: '2026-10-01' } }, TODAY))), ['A1', 'A2']));
  ok('with no cards nothing is due, and with no bank nothing is', same(safely(() => ids(R.due(POOL, {}, TODAY))), []) && same(safely(() => ids(R.due([], srs, TODAY))), []));
}

head('new questions, a round at a time across the chapters');
{
  ok('one from each chapter before a second from any', same(safely(() => ids(R.fresh(POOL, {}, 3))), ['A1', 'B1', 'C1']), String(safely(() => ids(R.fresh(POOL, {}, 3)))));
  ok('then round again, skipping a chapter that has run out', same(safely(() => ids(R.fresh(POOL, {}, 6))), ['A1', 'B1', 'C1', 'A2', 'C2', 'A3']), String(safely(() => ids(R.fresh(POOL, {}, 6)))));
  ok('a round stops at the size asked for, part-way through', same(safely(() => ids(R.fresh(POOL, {}, 4))), ['A1', 'B1', 'C1', 'A2']) && same(safely(() => ids(R.fresh(POOL, {}, 1))), ['A1']));
  ok('asked for more than there are, it gives every one, once', same(safely(() => ids(R.fresh(POOL, {}, 99)).slice().sort()), ids(POOL).sort()) && safely(() => R.fresh(POOL, {}, 99).length) === POOL.length);
  ok('a question with a card is not new, due or not', same(safely(() => ids(R.fresh(POOL, { A1: card(-3), B1: card(40), C1: {} }, 4))), ['A2', 'C2', 'A3', 'C3']), String(safely(() => ids(R.fresh(POOL, { A1: card(-3), B1: card(40), C1: {} }, 4)))));
  ok('none is asked for with a size of zero or less', same(safely(() => ids(R.fresh(POOL, {}, 0))), []) && same(safely(() => ids(R.fresh(POOL, {}, -4))), []));
  ok('with every question carded there is none', same(safely(() => ids(R.fresh(POOL, Object.fromEntries(POOL.map(x => [x.id, card(5)])), 5))), []));
  /* A chapter is a key in an object; with a prototype, "constructor" and "__proto__" would be found on it. */
  const odd = [q('K1', 'constructor'), q('P1', '__proto__'), q('K2', 'constructor'), q('T1', 'toString')];
  ok('chapters named constructor, __proto__ and toString are chapters', same(safely(() => ids(R.fresh(odd, {}, 9))), ['K1', 'P1', 'T1', 'K2']), String(safely(() => ids(R.fresh(odd, {}, 9)))));
}

head('a session is every due card, then new ones up to its size');
{
  const srs = { A1: card(-2), C1: card(0), B1: card(9) };
  ok('the due first, then new, a round at a time', same(safely(() => ids(R.queue(POOL, srs, TODAY, 5))), ['A1', 'C1', 'A2', 'C2', 'A3']), String(safely(() => ids(R.queue(POOL, srs, TODAY, 5)))));
  ok('new ones only make up the difference', safely(() => R.queue(POOL, srs, TODAY, 3).length) === 3 && same(safely(() => ids(R.queue(POOL, srs, TODAY, 2))), ['A1', 'C1']));
  /* The rule the function exists for. Seventy due against a session of twenty. */
  const big = Array.from({ length: 90 }, (_, i) => q('Z' + i, 'Ch' + (i % 5)));
  const bigSrs = Object.fromEntries(big.slice(0, 70).map(x => [x.id, card(-1)]));
  const got = safely(() => ids(R.queue(big, bigSrs, TODAY, 20)));
  ok('seventy due against a session of twenty: all seventy come back', got.length === 70 && same(got, ids(big.slice(0, 70))), `${got.length} of 70`);
  ok('and no new question is added to a session already over its size', !got.some(id => !bigSrs[id]));
  ok('a size of zero is still every due card', same(safely(() => ids(R.queue(POOL, srs, TODAY, 0))), ['A1', 'C1']));
  ok('a card due later is neither due nor new, so it is not in the session', !safely(() => ids(R.queue(POOL, srs, TODAY, 99))).includes('B1') && safely(() => R.queue(POOL, srs, TODAY, 99).length) === POOL.length - 1);
  ok('nothing due and nothing new is an empty session', same(safely(() => ids(R.queue(POOL, Object.fromEntries(POOL.map(x => [x.id, card(5)])), TODAY, 20))), []) && same(safely(() => ids(R.queue([], {}, TODAY, 20))), []));
  ok('no question is dealt twice', (() => { const s = safely(() => ids(R.queue(POOL, srs, TODAY, 99))); return new Set(s).size === s.length; })());
}

head('nothing handed in is changed');
{
  /* A bank of its own, not frozen and touched by nothing before this: a change shows as a change. */
  const pool = BANK(), srs = { A1: card(-2), C1: card(0) };
  const before = JSON.stringify([pool, srs]);
  const out = safely(() => [R.due(pool, srs, TODAY), R.fresh(pool, srs, 4), R.queue(pool, srs, TODAY, 6)]);
  ok('the bank and the cards are as they were', JSON.stringify([pool, srs]) === before);
  ok('and what comes back is the bank\'s own questions, not copies', Array.isArray(out[0]) && out.every(list => Array.isArray(list) && list.every(x => pool.includes(x))));
  ok('each call returns a list of its own', out.length === 3 && out[2] !== out[0] && safely(() => R.due(pool, srs, TODAY)) !== safely(() => R.due(pool, srs, TODAY)));
}

head('the words on a rating button');
{
  const f = d => safely(() => R.fmtInterval(d));
  ok('under a day is later today', f(0) === 'later today' && f(0.5) === 'later today', [f(0), f(0.5)].join(' | '));
  ok('one day is tomorrow', f(1) === 'tomorrow', f(1));
  ok('two to thirteen days are days', f(2) === 'in 2 days' && f(13) === 'in 13 days', [f(2), f(13)].join(' | '));
  ok('a fortnight is weeks, not fourteen days', f(14) === 'in 2 weeks', f(14));
  ok('weeks are rounded to the nearest', f(17) === 'in 2 weeks' && f(18) === 'in 3 weeks' && f(59) === 'in 8 weeks', [f(17), f(18), f(59)].join(' | '));
  ok('sixty days and over are months', f(60) === 'in 2 months' && f(74) === 'in 2 months' && f(75) === 'in 3 months' && f(365) === 'in 12 months', [f(60), f(74), f(75), f(365)].join(' | '));
  ok('no interval is ever said as one week or one month', Array.from({ length: 400 }, (_, i) => f(i)).every(t => !/in 1 (weeks|months)|in 0 /.test(t)));
  ok('and every whole day from 0 to 400 gets words', Array.from({ length: 401 }, (_, i) => f(i)).every(t => /^(later today|tomorrow|in \d+ (days|weeks|months))$/.test(t)));
}

head('the page\'s four functions are the calls into this');
{
  /* The module is given the bank, the cards and today; the page is what hands them over. Read with its
     comments blanked: the shell explains itself, and quotes what is looked for. */
  const page = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
  const once = text => page.split(text).length - 1 === 1;
  ok('dueQuestions() hands over POOL, S.srs and today', once('function dueQuestions(){ return ReviewQueue.due(POOL,S.srs,todayISO()); }') && once('function dueQuestions('));
  ok('newQuestionsForReview() hands over POOL, S.srs and the size', once('function newQuestionsForReview(limit){ return ReviewQueue.fresh(POOL,S.srs,limit); }') && once('function newQuestionsForReview('));
  ok('reviewQueue() hands over POOL, S.srs, today and the size', once('function reviewQueue(target){ return ReviewQueue.queue(POOL,S.srs,todayISO(),target); }') && once('function reviewQueue('));
  ok('fmtInterval() hands over the days', once('function fmtInterval(days){ return ReviewQueue.fmtInterval(days); }') && once('function fmtInterval('));
  const slot = page.indexOf('@@SLOT[src:src/core/reviewqueue.js]@@');
  ok('and the module is written into the page once, above all four', slot >= 0 && page.indexOf('@@SLOT[src:src/core/reviewqueue.js]@@', slot + 1) < 0
     && ['function dueQuestions(', 'function newQuestionsForReview(', 'function reviewQueue(', 'function fmtInterval('].every(t => page.indexOf(t) > slot), slot < 0 ? 'no slot' : 'slot at ' + slot);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
