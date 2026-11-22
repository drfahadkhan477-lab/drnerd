#!/usr/bin/env node
/*
 * A practice deck put down and taken up again where it was left — src/core/resume.js.
 *
 *   node tests/verify-resume-pure.js
 *
 * Pure Node, over an invented pool. Every expected deck is worked out here from the rules.
 *
 * What is measured, rather than assumed:
 *   - only an "all" deck is kept, under its chapter or the whole bank; review, missed and the rest never are;
 *   - a deck kept is written under its key, and past twelve the oldest touched goes, a record with no time first;
 *   - a kept deck comes back in its saved order, at the question it was on (question one included), with its
 *     answers and counts;
 *   - and does not when the bank has lost one of its questions, when the pool is not the deck's, when it sits on an
 *     answered last question, when its place is outside the deck, or when it is no record at all;
 *   - the page's names are the calls into this, written into the page once, above them, with no second copy.
 *
 * verify-resume is the browser half: it puts a deck down and takes it up in the built page, across a reload.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');
const R = require('../src/core/resume.js').Resume;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);
const safely = fn => { try { return fn(); } catch (e) { return 'THREW ' + e.message; } };

head('which decks are kept');
{
  ok('an "all" deck is kept under its chapter, or the whole bank\'s', R.key('Valves', 'all') === 'all|Valves' && R.key(null, 'all') === 'all|*' && R.key('', 'all') === 'all|*');
  ok('a review, missed, flagged or any other deck never is', ['due', 'missed', 'flagged', 'certain', 'exam', undefined].every(m => R.key('Valves', m) === null));
}

head('keeping one, and no more than twelve');
{
  const resume = {}, e = ts => ({ ids: ['a'], i: 0, ts });
  safely(() => R.keep(resume, 'all|Valves', e(5)));
  ok('a deck is written under its key', J(resume['all|Valves']) === J(e(5)) && R.MAX === 12);
  const many = {}; for (let k = 0; k < 12; k++) many['k' + k] = e(100 + k);
  many.noTime = { ids: ['x'], i: 0 };
  safely(() => R.keep(many, 'k12', e(500)));
  const left = Object.keys(many).sort();
  /* Twelve with a time, one without, and a fourteenth: two go, the one with no time (the oldest of all) and k0. */
  ok('past twelve the oldest touched go, a record with no time the oldest of all', left.length === 12 && !left.includes('noTime') && !left.includes('k0') && left.includes('k1') && left.includes('k12'), left.join(' '));
  safely(() => R.keep(many, 'k13', e(600)));
  ok('and the next, the oldest left', !('k1' in many) && Object.keys(many).length === 12 && 'k13' in many && 'k2' in many, Object.keys(many).sort().join(' '));
}

const POOL = ['q1', 'q2', 'q3', 'q4'].map(id => ({ id }));
const rec = over => Object.assign({ ids: ['q3', 'q1', 'q4', 'q2'], i: 2, answers: { 0: { selected: 1 }, 1: { selected: 0 } }, correct: 1, total: 2 }, over || {});

head('a kept deck comes back as it was');
{
  const r = safely(() => R.restore(rec(), POOL));
  ok('in its saved order, at its place, with its answers and counts', r && J(r.deck.map(q => q.id)) === J(['q3', 'q1', 'q4', 'q2']) && r.i === 2 && r.correct === 1 && r.total === 2 && J(r.answers) === J(rec().answers), J(r && { ids: r.deck.map(q => q.id), i: r.i }));
  ok('the questions are the pool\'s own', r && r.deck[0] === POOL[2]);
  const first = safely(() => R.restore(rec({ i: 0, answers: {} }), POOL));
  ok('question one is a place too: a deck put down there comes back there', first && first.i === 0, J(first && first.i));
  const last = safely(() => R.restore(rec({ i: 3, answers: {} }), POOL));
  ok('a deck on its last question, not yet answered, comes back', last && last.i === 3);
  const odd = safely(() => R.restore(rec({ answers: 'torn', correct: 'x', total: undefined }), POOL));
  ok('torn answers are none, and torn counts nought', odd && J(odd.answers) === '{}' && odd.correct === 0 && odd.total === 0, J(odd && [odd.answers, odd.correct, odd.total]));
}

head('and does not, when it is no longer that deck');
{
  ok('the bank has lost one of its questions', safely(() => R.restore(rec(), POOL.slice(0, 3))) === null);
  ok('the pool is not the deck\'s: more questions than it holds', safely(() => R.restore(rec(), POOL.concat([{ id: 'q5' }]))) === null);
  ok('it sits on its last question, answered: a finished deck nobody cleared', safely(() => R.restore(rec({ i: 3, answers: { 3: { selected: 2 } } }), POOL)) === null);
  ok('its place is outside the deck', safely(() => R.restore(rec({ i: 4 }), POOL)) === null && safely(() => R.restore(rec({ i: -1 }), POOL)) === null);
  /* A restored backup's deck is any list of strings, and the pool was read through a plain object: a saved "toString"
     or "constructor" found what every object inherits, and a function was dealt as a question. Four saved ids over a
     pool of four, one of them a name every object has: no deck. */
  const inherited = ['toString', 'constructor', '__proto__', 'valueOf'].map(id => safely(() => R.restore(rec({ ids: ['q3', 'q1', id, 'q2'] }), POOL)));
  ok('an id every object inherits is no question of the pool, and the deck is not dealt', inherited.every(r => r === null), inherited.map(r => r === null ? 'null' : (r && r.deck ? r.deck.map(q => typeof q === 'function' ? 'FUNCTION' : (q && q.id) || typeof q).join(',') : String(r))).join(' | '));
  ok('it is no record, or one without questions', [null, undefined, {}, { ids: [] }, { ids: 'q1' }].every(x => safely(() => R.restore(x, POOL)) === null));
}

head('the page\'s names are the calls into this');
{
  const page = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
  const n = t => page.split(t).length - 1;
  ok('resumeKey() and restoreDeck() are one line each, handing over the page\'s record', n('function resumeKey(ch,mode){ return Resume.key(ch,mode); }') === 1 && n('function restoreDeck(qs,key){ return Resume.restore(key&&S.resume[key],qs); }') === 1);
  ok('recordResume() keeps the deck through the module, with the time', n('  Resume.keep(S.resume,key,{ids:S.questions.map(q=>q.id), i:S.qIdx,') === 1 && n('answers:S.answers, correct:S.quizCorrect, total:S.quizTotal, ts:Date.now()});') === 1);
  const slot = page.indexOf('@@SLOT[src:src/core/resume.js]@@');
  ok('the module is written into the page once, above them', slot >= 0 && n('@@SLOT[src:src/core/resume.js]@@') === 1 && slot < page.indexOf('function resumeKey('), slot < 0 ? 'no slot' : 'slot at ' + slot);
  ok('and the page keeps no second copy of the rules', n('RESUME_MAX') === 0 && n("'all|'+") === 0 && n('answers[i].selected!=null') === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
