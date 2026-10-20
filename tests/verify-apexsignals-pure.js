#!/usr/bin/env node
/*
 * What Apex is told about how the fellow answers — src/core/apexsignals.js.
 *
 *   node tests/verify-apexsignals-pure.js
 *
 * Pure Node, over invented rows. The module has no DOM, no clock and no storage, so every expected value
 * is worked out here from the fixture, not read back from the module.
 *
 * What is measured, rather than assumed:
 *   - a reading with too few answers behind it is left out, on both sides of the bar (calib.js's twelve);
 *   - the lines about calibration, miss reasons, pace, the last mock block, the exam and the flags are what the
 *     rows say, in a fixed order, and a reading that cannot be made costs that line and no other;
 *   - the line about the question in front of Apex says what was chosen, how sure and how long, and in
 *     grounded mode never names the option or says whether it was right or why it was missed (each is the key by another name);
 *   - the list of recent misses is one row per question, newest first, only questions whose latest answer is
 *     a miss that the app still calls one, with the option chosen, the key, stems and wording only outside grounded mode;
 *   - a row from before a field existed, or with a field that cannot be true, says so or says nothing;
 *   - nothing throws, whatever the log holds, and nothing it was given is changed.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('../src/core/apexsignals.js').ApexSignals;
const { blankComments } = require('./_source.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const safely = (fn, otherwise) => { try { return fn(); } catch (_) { return otherwise; } };
const has = (s, part) => typeof s === 'string' && s.indexOf(part) >= 0;

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0), DAY = 86400000;
const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const R = over => Object.assign({ t: NOW - DAY, q: 'Q1', ch: 'Alpha', g: null, ok: 1, m: 'practice', ms: null, cf: null, why: null }, over || {});
const lines = o => safely(() => A.standing(o), ['THREW']);          // a throw is a line that is wrong, so every check that wants nothing or something else fails
/* The module's functions as the checks below call them directly: one that throws, or is missing, is a failed check and not a dead suite. */
const G = {};
['standing', 'answerLine', 'digest', 'clip', 'ago', 'letterOf'].forEach(k => { G[k] = (...a) => safely(() => A[k](...a), 'THREW'); });
const row0 = x => (x && x.rows && x.rows[0]) || {};
const digText = o => { const x = G.digest(o); return (x && typeof x.text === 'string') ? x.text : ''; };
const deepFreeze = v => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v).forEach(deepFreeze); } return v; };

head('calibration: certain and wrong, and its mirror, only with the samples to say');
{
  const certain = (n, right) => many(n, i => R({ cf: 3, ok: i < right ? 1 : 0 }));
  const guess = (n, right) => many(n, i => R({ cf: 0, ok: i < right ? 1 : 0 }));
  const one = log => (lines({ log }) || [])[0] || '';
  ok('fourteen Certain answers, five wrong: it says so, with the share',
    one(certain(14, 9)) === 'Marked Certain on 14 answers and was wrong on 5 of them (36%).', String(one(certain(14, 9))));
  ok('eleven Certain answers are too few to say anything', lines({ log: certain(11, 6) }).length === 0, JSON.stringify(lines({ log: certain(11, 6) })));
  ok('twelve are enough, and a flawless band is reported too: zero wrong is not silence',
    one(certain(12, 12)) === 'Marked Certain on 12 answers and was wrong on 0 of them (0%).', String(one(certain(12, 12))));
  ok('twelve Guess answers, nine right: the mirror reading',
    one(guess(12, 9)) === 'Marked Guess on 12 and was right on 75%.', String(one(guess(12, 9))));
  ok('eleven Guess answers are too few, and do not hold back the Certain reading',
    lines({ log: guess(11, 8) }).length === 0 && one(certain(14, 9).concat(guess(11, 8))) === 'Marked Certain on 14 answers and was wrong on 5 of them (36%).');
  ok('both bands: one line, Certain first', one(certain(14, 9).concat(guess(12, 9))) ===
    'Marked Certain on 14 answers and was wrong on 5 of them (36%). Marked Guess on 12 and was right on 75%.');
  ok('the answers with no confidence given are not counted', lines({ log: many(30, () => R({ cf: null })) }).length === 0);
  ok('a block\'s answers are not counted: no confidence was asked in one', lines({ log: many(14, i => R({ cf: 3, m: 'exam', ok: i < 9 ? 1 : 0 })) }).length === 0);
  ok('nor a self-rating', lines({ log: many(14, i => R({ cf: 3, m: 'review', ok: i < 9 ? 1 : 0 })) }).length === 0);
  ok('a review answer is counted', one(many(14, i => R({ cf: 3, m: 'review-answer', ok: i < 9 ? 1 : 0 }))) === 'Marked Certain on 14 answers and was wrong on 5 of them (36%).');
}

head('miss reasons: the commonest three, once twelve misses are tagged');
{
  const why = (counts, m) => { const out = []; Object.keys(counts).forEach(k => many(counts[k], () => out.push(R({ ok: 0, why: k, m: m || 'practice' })))); return out; };
  const one = log => (lines({ log }) || [])[0] || '';
  ok('twelve tagged misses: counts, commonest first, in the words the chips use',
    one(why({ gap: 6, misread: 4, mixed: 2 })) === 'Why they say they miss (12 misses tagged): Didn\'t know it 6, Misread the stem 4, Confused two things 2.', String(one(why({ gap: 6, misread: 4, mixed: 2 }))));
  ok('eleven tagged are too few', lines({ log: why({ gap: 6, misread: 5 }) }).length === 0);
  ok('only three reasons are named, and a tie keeps the order the chips are in',
    one(why({ gap: 4, misread: 3, mixed: 2, slip: 2, guess: 1 })) === 'Why they say they miss (12 misses tagged): Didn\'t know it 4, Misread the stem 3, Confused two things 2.');
  ok('misses with no reason given are not counted among the tagged',
    one(why({ gap: 7, misread: 5 }).concat(many(20, () => R({ ok: 0 })))) === 'Why they say they miss (12 misses tagged): Didn\'t know it 7, Misread the stem 5.');
  ok('a miss in a mock block counts: its reason is asked in the review', has(one(why({ gap: 7, misread: 5 }, 'exam')), '12 misses tagged'));
  ok('a right answer carrying a reason is not a miss', lines({ log: many(14, () => R({ ok: 1, why: 'gap' })) }).length === 0);
  ok('a reason that is not one of the five is not counted', lines({ log: many(14, () => R({ ok: 0, why: 'laziness' })) }).length === 0);
}

head('pace: how long right and wrong answers take, each side needing its own twelve');
{
  const timed = (n, base, right, m) => many(n, i => R({ ok: right ? 1 : 0, ms: base + 1000 * i, m: m || 'practice' }));
  const one = log => (lines({ log }) || [])[0] || '';
  const fast = timed(12, 30000, true), slow = timed(12, 60000, false);
  ok('right answers in 30–41 s, wrong in 60–71 s: the medians, to the second',
    one(fast.concat(slow)) === 'Median time per question: 36 s when right, 66 s when wrong.', String(one(fast.concat(slow))));
  ok('right slower than wrong says the recall is there and effortful',
    one(timed(12, 60000, true).concat(timed(12, 30000, false))) === 'Median time per question: 66 s when right, 36 s when wrong; right answers take longer than wrong ones, so the recall is there but still effortful.');
  ok('equal medians are not "slower"', one(timed(12, 30000, true).concat(timed(12, 30000, false))) === 'Median time per question: 36 s when right, 36 s when wrong.');
  ok('eleven wrong answers are too few for a median of wrong', lines({ log: fast.concat(timed(11, 60000, false)) }).length === 0);
  ok('eleven right answers are too few for a median of right', lines({ log: timed(11, 30000, true).concat(slow) }).length === 0);
  const noise = [R({ ok: 1, ms: NaN }), R({ ok: 1, ms: -5 }), R({ ok: 1, ms: 30 * 60000 + 1 }), R({ ok: 0, ms: null }), R({ ok: 0, ms: '40000' }), R({ ok: 0, ms: Infinity })];
  ok('a time that is missing, negative, absurd or not a number is left out, not averaged in',
    one(fast.concat(slow, noise)) === 'Median time per question: 36 s when right, 66 s when wrong.');
  ok('a review answer\'s time counts, as a practice answer\'s does', one(timed(12, 30000, true, 'review-answer').concat(timed(12, 60000, false, 'review-answer'))) === 'Median time per question: 36 s when right, 66 s when wrong.');
  ok('a block\'s times are not a practice answer\'s: a question can be left and come back to',
    one(fast.concat(slow, timed(12, 1000, true, 'exam'))) === 'Median time per question: 36 s when right, 66 s when wrong.');
  ok('thirty minutes exactly is a time; one millisecond more is a walk away',
    one(timed(11, 30000, true).concat([R({ ok: 1, ms: 30 * 60000 })], slow)) === 'Median time per question: 36 s when right, 66 s when wrong.' && lines({ log: timed(11, 30000, true).concat([R({ ok: 1, ms: 30 * 60000 + 1 })], slow) }).length === 0);
}

head('the last mock block, the one before, and the chapter it went worst in');
{
  const blk = (over) => Object.assign({ ts: NOW - 2 * DAY, n: 40, answered: 38, correct: 29, ms: 3300000, limit: 3600000, ch: null,
    by: { 'Valvular Disease': [10, 20], 'Arrhythmias': [19, 20] } }, over || {});
  const prev = blk({ ts: NOW - 9 * DAY, n: 20, answered: 20, correct: 12, ms: 1500000, limit: 1800000, by: { 'Valvular Disease': [2, 5], 'Arrhythmias': [10, 15] } });
  const mock = (mocks, now) => (lines({ mocks, now: now === undefined ? NOW : now }) || [])[0] || '';
  ok('a block: score, answered, time used against the limit, and its weakest chapter',
    mock([blk()]) === 'Last mock block (2 days ago): 29 of 40 right (73%), 38 answered, 55 min of 60. Weakest in it: Valvular Disease 10 of 20.', String(mock([blk()])));
  ok('with an earlier block, how that one went', mock([prev, blk()]) ===
    'Last mock block (2 days ago): 29 of 40 right (73%), 38 answered, 55 min of 60. Weakest in it: Valvular Disease 10 of 20. The block before: 60%.');
  ok('the latest block is the last in the history', has(mock([blk(), prev]), '12 of 20 right (60%)') && has(mock([blk(), prev]), 'The block before: 73%.'));
  ok('an untimed block says so and gives no limit',
    mock([blk({ ts: NOW - 1000, n: 20, answered: 20, correct: 15, ms: 600000, limit: null, by: { A: [8, 10], B: [7, 10] } })]) ===
    'Last mock block (today): 15 of 20 right (75%), 20 answered, 10 min (untimed). Weakest in it: B 7 of 10.');
  ok('a block on one chapter names it and has no weakest chapter to compare',
    mock([blk({ ts: NOW - 3 * DAY, n: 20, answered: 20, correct: 14, ms: 1500000, limit: 1800000, ch: 'Valvular Disease', by: { 'Valvular Disease': [14, 20] } })]) ===
    'Last mock block (3 days ago): 14 of 20 right (70%), 20 answered, 25 min of 30; Valvular Disease only.');
  ok('a chapter with fewer than three questions is not compared', !has(mock([blk({ n: 20, answered: 20, correct: 19, ms: 600000, by: { A: [1, 2], B: [18, 18] } })]), 'Weakest'));
  ok('equal chapters: the first by name', has(mock([blk({ n: 20, answered: 20, correct: 10, by: { B: [5, 10], A: [5, 10] } })]), 'Weakest in it: A 5 of 10.'));
  ok('a block under a minute is a minute, not zero', has(mock([blk({ n: 20, answered: 20, correct: 10, ms: 20000, limit: null, by: { A: [5, 10], B: [5, 10] } })]), '1 min (untimed)'));
  ok('minutes are rounded, not cut: 55 min 50 s is 56', has(mock([blk({ ms: 3350000 })]), '56 min of 60'));
  ok('the block before is the one just before the last, not the first', (() => {
    const b1 = blk({ ts: NOW - 20 * DAY, n: 10, answered: 10, correct: 2, ms: 600000, limit: null, by: { A: [1, 5], B: [1, 5] } });
    const b2 = blk({ ts: NOW - 10 * DAY, n: 10, answered: 10, correct: 6, ms: 600000, limit: null, by: { A: [3, 5], B: [3, 5] } });
    const b3 = blk({ ts: NOW - 1 * DAY, n: 10, answered: 10, correct: 9, ms: 600000, limit: null, by: { A: [4, 5], B: [5, 5] } });
    return has(mock([b1, b2, b3]), '9 of 10 right (90%)') && has(mock([b1, b2, b3]), 'The block before: 60%.');
  })());
  ok('a chapter of exactly three questions is compared', has(mock([blk({ n: 10, answered: 10, correct: 8, ms: 600000, limit: null, by: { A: [1, 3], B: [7, 7] } })]), 'Weakest in it: A 1 of 3.'));
  ok('the weakest chapter\'s name is cut as well', has(mock([blk({ n: 20, answered: 20, correct: 10, ms: 600000, limit: null, by: { ['W'.repeat(100)]: [3, 10], Z: [7, 10] } })]), 'Weakest in it: ' + 'W'.repeat(59) + '… 3 of 10.'));
  ok('an entry the mock module would refuse is not described: the last valid block is',
    has(mock([blk(), blk({ correct: 50 })]), '29 of 40 right'));
  ok('only refused entries: no line', lines({ mocks: [blk({ correct: 50 }), { ts: 'x' }, null, 5] }).length === 0);
  ok('no clock given: the block is described without "ago"', mock([blk()], null).indexOf('Last mock block: 29 of 40') === 0, String(mock([blk()], null)));
  ok('a block dated in the future is "recently"', has(mock([blk({ ts: NOW + 5 * DAY })]), 'Last mock block (recently)'));
  ok('a history that is not a list is no history', lines({ mocks: 'abc' }).length === 0 && lines({ mocks: { length: 3 } }).length === 0);
  ok('a long chapter name, one the history accepts, is cut before it reaches the prompt',
    has(mock([blk({ ch: 'X'.repeat(100), by: { ['X'.repeat(100)]: [29, 40] } })]), '; ' + 'X'.repeat(59) + '… only.'));
  ok('and one the history refuses (over 120 characters) is no block at all', lines({ mocks: [blk({ ch: 'X'.repeat(121), by: { ['X'.repeat(100)]: [29, 40] } })] }).length === 0);
}

head('the exam, and what they flagged');
{
  const one = o => (lines(o) || [])[0] || '';
  ok('forty-one days', one({ daysLeft: 41 }) === 'The exam is in 41 days.');
  ok('one day is singular', one({ daysLeft: 1 }) === 'The exam is in 1 day.');
  ok('today', one({ daysLeft: 0 }) === 'The exam is today.');
  ok('a date that has passed says nothing', lines({ daysLeft: -1 }).length === 0);
  ok('730 days is a countdown and 731 is not', one({ daysLeft: 730 }) === 'The exam is in 730 days.' && lines({ daysLeft: 731 }).length === 0);
  ok('what is not a number of days says nothing', [null, undefined, NaN, Infinity, '41', {}].every(v => lines({ daysLeft: v }).length === 0));
  ok('a part of a day is a whole day fewer', one({ daysLeft: 41.9 }) === 'The exam is in 41 days.');
  ok('three flagged', one({ flagged: 3 }) === '3 questions flagged to come back to.');
  ok('one flagged is singular', one({ flagged: 1 }) === '1 question flagged to come back to.');
  ok('none flagged says nothing', lines({ flagged: 0 }).length === 0);
  ok('what is not a count says nothing', [-1, 2.5, '3', null, NaN, {}].every(v => lines({ flagged: v }).length === 0));
}

head('standing: every reading, in a fixed order, each on its own');
{
  const log = many(14, i => R({ cf: 3, ok: i < 9 ? 1 : 0, why: i < 9 ? null : 'gap', ms: 30000 + 1000 * i }))
    .concat(many(12, i => R({ ok: 0, why: 'misread', ms: 60000 + 1000 * i })), many(10, i => R({ ok: 1, ms: 30000 + 1000 * i })));
  const mocks = [{ ts: NOW - 2 * DAY, n: 20, answered: 20, correct: 15, ms: 600000, limit: null, ch: null, by: { A: [8, 10], B: [7, 10] } }];
  const all = lines({ log, mocks, flagged: 2, daysLeft: 30, now: NOW }) || [];
  const at = s => all.findIndex(l => has(l, s));
  ok('all six readings are made', all.length === 6, String(all.length));
  ok('and they come in the order: certain and wrong, reasons, pace, mock, exam, flags',
    at('Marked Certain') === 0 && at('Why they say') === 1 && at('Median time') === 2 && at('Last mock block') === 3 && at('The exam is') === 4 && at('flagged to come') === 5, JSON.stringify(all.map(l => l.slice(0, 14))));
  ok('nothing given is nothing said', same(lines({}), []) && same(lines(), []) && same(lines(null), []) && same(lines('abc'), []) && same(lines(7), []));
  ok('a log that is not a list costs the readings from it and none other',
    same(lines({ log: 'abc', flagged: 2, daysLeft: 3 }), ['The exam is in 3 days.', '2 questions flagged to come back to.']) && same(lines({ log: { length: 4 }, flagged: 2 }), ['2 questions flagged to come back to.']));
  ok('rows that are null, numbers, strings or lists are skipped', safely(() => lines({ log: [null, 5, 'x', [], undefined, true, R({ cf: 3 })] }).length === 0, false));
  const poison = [{ get ts() { throw new Error('torn'); } }];
  const torn = safely(() => lines({ log, mocks: poison, flagged: 2, daysLeft: 30, now: NOW }), null);
  ok('a reading that throws costs its own line: the mock history is torn, the rest is told',
    torn && torn.length === 5 && !torn.some(l => has(l, 'mock')) && has(torn[0], 'Marked Certain') && has(torn[4], 'flagged'), String(torn && torn.length));
  const frozen = deepFreeze({ log: JSON.parse(JSON.stringify(log)), mocks: JSON.parse(JSON.stringify(mocks)), flagged: 2, daysLeft: 30, now: NOW });
  ok('what it was given is left as it was', safely(() => A.standing(frozen).length === 6, false));
}

head('answerLine: what they did on the question in front of Apex');
{
  const base = { pick: 1, ok: false, cf: 3, why: 'misread', ms: 94000, flagged: true, letters: ['A', 'B', 'C', 'D'] };
  const line = o => safely(() => A.answerLine(o), 'THREW');
  ok('a miss: what was chosen, that it was not the answer, how sure, how long, the reason, the flag',
    line(base) === 'The fellow chose B, which was not the answer. Before answering they marked themselves "Certain". They took 94 s. They say they missed it because: Misread the stem. They flagged it to come back to.', String(line(base)));
  ok('a right answer says so and gives no reason, even with a stale one',
    line(Object.assign({}, base, { ok: true })) === 'The fellow chose B, which was right. Before answering they marked themselves "Certain". They took 94 s. They flagged it to come back to.');
  ok('right or wrong unknown: no verdict', line({ pick: 2, letters: ['A', 'B', 'C'] }) === 'The fellow chose C.' && line({ pick: 2, ok: null, letters: ['A', 'B', 'C'] }) === 'The fellow chose C.');
  ok('grounded: that they answered, how sure, how long, and never which option, right, wrong or why',
    line(Object.assign({}, base, { grounded: true })) === 'They have answered; the option they chose is withheld in grounded mode. Before answering they marked themselves "Certain". They took 94 s. They flagged it to come back to.');
  ok('grounded never names an option: a different choice reads the same, and the letters are not told at all',
    line(Object.assign({}, base, { grounded: true, pick: 3 })) === line(Object.assign({}, base, { grounded: true })) && !/\b[A-D]\b\.?(?!\w)/.test(line(Object.assign({}, base, { grounded: true })).replace('They have answered', '')));
  ok('grounded and right is the same sentence as grounded and wrong: nothing leaks by which one it is',
    line(Object.assign({}, base, { grounded: true, ok: true, why: null })) === line(Object.assign({}, base, { grounded: true })));
  ok('grounded never carries a reason or a verdict in any form', !/right|wrong|not the answer|missed|because|fellow chose/.test(line(Object.assign({}, base, { grounded: true, flagged: false }))));
  ok('option A is a choice: 0 is a pick', line({ pick: 0 }) === 'The fellow chose A.');
  ok('and the last letter, Z, is a pick too', line({ pick: 25 }) === 'The fellow chose Z.');
  ok('a flag is told only when it is true', !has(line({ pick: 0, flagged: 'yes' }), 'flagged') && !has(line({ pick: 0, flagged: 1 }), 'flagged') && has(line({ pick: 0, flagged: true }), 'flagged'));
  ok('no choice recorded: nothing is said, not option A', [undefined, null, -1, 1.5, '1', 26, NaN, Infinity].every(v => line({ pick: v, ok: false, cf: 3 }) === ''));
  ok('the bank\'s own letters are used, tidied', line({ pick: 1, letters: ['A', '<b>', 'C'] }) === 'The fellow chose b.' && line({ pick: 1, letters: ['A', '', 'C'] }) === 'The fellow chose B.');
  ok('"Guess" is a confidence: 0 is a band', has(line({ pick: 0, cf: 0 }), 'marked themselves "Guess"'));
  ok('all four bands are named', [0, 1, 2, 3].map(c => (line({ pick: 0, cf: c }).match(/"([^"]+)"/) || [])[1]).join('|') === 'Guess|Unsure|Fairly sure|Certain');
  ok('a confidence that is not a band is not told', [4, -1, '3', null, 1.5, undefined].every(v => !has(line({ pick: 0, cf: v }), 'marked')));
  ok('a time is told to the second and only when it can be true',
    has(line({ pick: 0, ms: 0 }), 'They took 0 s.') && has(line({ pick: 0, ms: 30 * 60000 }), 'They took 1800 s.') &&
    [30 * 60000 + 1, -1, NaN, Infinity, '9000', null, undefined].every(v => !has(line({ pick: 0, ms: v }), 'They took')));
  ok('a reason that is not one of the five is not told', !has(line({ pick: 0, ok: false, why: 'laziness' }), 'because') && !has(line({ pick: 0, ok: false, why: null }), 'because'));
  ok('garbage in, empty out, no throw', [null, undefined, 'x', 7, [], { get pick() { throw new Error('torn'); } }].every(v => line(v) === ''));
}

head('digest: recent misses, one per question');
{
  const opt = (l, t) => ({ l, t });
  const mk = (id, ch, n, s, ci, extra) => Object.assign({ id, ch, n, s, ci, o: [opt('A', 'Alpha drug'), opt('B', 'Beta drug'), opt('C', 'Gamma drug'), opt('D', 'Delta drug')] }, extra || {});
  const byId = {
    Q1: mk('Q1', 'Valvular Disease', 7, 'A 54-year-old with exertional dyspnea.', 2),
    Q2: mk('Q2', 'Arrhythmias', 3, 'A runner with a slow pulse.', 0),
    Q3: mk('Q3', 'Coronary Artery Disease', 11, 'Chest pain after a long flight.', 1),
    Q4: mk('Q4', 'Pericardial Disease', 2, 'Kussmaul sign on examination.', 3),
    Q5: mk('Q5', 'Heart Failure & Cardiomyopathies', 9, 'An athlete with a thick septum.', 0),
    BAD: mk('BAD', 'Arrhythmias', 4, 'Quarantined.', 0, { bad: true }),
  };
  const log = [
    R({ q: 'Q1', ok: 0, pick: 1, cf: 3, why: 'misread', ms: 94000, t: NOW - 5 * DAY }),
    R({ q: 'Q2', ok: 0, pick: 2, cf: 1, ms: 20000, t: NOW - 4 * DAY }),
    R({ q: 'Q3', ok: 0, pick: 3, t: NOW - 3 * DAY, m: 'review-answer' }),
    R({ q: 'Q4', ok: 0, pick: 1, t: NOW - 2 * DAY, m: 'exam', why: 'gap' }),
    R({ q: 'Q5', ok: 0, pick: null, t: NOW - DAY }),
  ];
  const dig = o => safely(() => A.digest(Object.assign({ log, byId, now: NOW, missed: new Set(['Q1', 'Q2', 'Q3', 'Q4', 'Q5']) }, o || {})), null) || { rows: [], text: '', more: false, total: -1 };
  const d = dig();
  ok('five misses, newest first', same(d.rows.map(r => r.id), ['Q5', 'Q4', 'Q3', 'Q2', 'Q1']), JSON.stringify(d.rows.map(r => r.id)));
  ok('a row says what each was', same(d.rows.find(r => r.id === 'Q1'), { id: 'Q1', ch: 'Valvular Disease', n: 7, t: NOW - 5 * DAY, m: 'practice', pick: 1, cf: 3, why: 'misread', ms: 94000, key: 2 }), JSON.stringify(d.rows.find(r => r.id === 'Q1')));
  ok('the first row, as the tutor reads it', has(d.text, '[Q1] Valvular Disease, item 7 — 5 days ago\n  Chose B; the key is C. Marked "Certain". Reason given: Misread the stem. 94 s.\n  Stem: A 54-year-old with exertional dyspnea.\n  B: Beta drug\n  C: Gamma drug'), d.text);
  ok('a row with nothing to add: no confidence, no reason, time only',
    has(d.text, '[Q2] Arrhythmias, item 3 — 4 days ago\n  Chose C; the key is A. Marked "Unsure". 20 s.\n  Stem: A runner with a slow pulse.\n  C: Gamma drug\n  A: Alpha drug'));
  ok('a review answer and a block answer are named as such', has(d.text, '[Q3] Coronary Artery Disease, item 11 — 3 days ago, in a review') && has(d.text, '[Q4] Pericardial Disease, item 2 — 2 days ago, in a mock block'));
  ok('a choice that was not recorded says so, and does not invent option A', has(d.text, '[Q5] Heart Failure & Cardiomyopathies, item 9 — yesterday\n  Choice not recorded; the key is A.'));
  ok('the headline counts the rows and names the keyed option', has(d.text, 'Recent misses, newest first (5).') && has(d.text, 'the keyed option') && d.total === 5 && d.more === false);
  ok('the rows are separated by a blank line', d.text.split('\n\n').length === 6);
  ok('a question missed twice is one row, with the later attempt',
    same(dig({ log: [R({ q: 'Q1', ok: 0, pick: 0, t: NOW - 9 * DAY }), R({ q: 'Q1', ok: 0, pick: 1, cf: 2, t: NOW - 2 * DAY })] }).rows.map(r => [r.id, r.pick, r.cf]), [['Q1', 1, 2]]));
  ok('a question answered right since is not a miss, though an earlier row was',
    dig({ log: [R({ q: 'Q1', ok: 0, pick: 1, t: NOW - 9 * DAY }), R({ q: 'Q1', ok: 1, pick: 2, t: NOW - 2 * DAY })] }).rows.length === 0);
  ok('a question right before and wrong since is a miss',
    same(dig({ log: [R({ q: 'Q1', ok: 1, pick: 2, t: NOW - 9 * DAY }), R({ q: 'Q1', ok: 0, pick: 1, t: NOW - 2 * DAY })] }).rows.map(r => r.id), ['Q1']));
  ok('a question the app no longer calls missed is not listed', same(dig({ missed: new Set(['Q2', 'Q4']) }).rows.map(r => r.id), ['Q4', 'Q2']) && dig({ missed: new Set() }).rows.length === 0);
  ok('the missed list may be an array, or not given at all', same(dig({ missed: ['Q1'] }).rows.map(r => r.id), ['Q1']) && dig({ missed: null }).rows.length === 5);
  ok('questions the bank does not have, or has quarantined, are not listed, whatever the id',
    dig({ log: [R({ q: 'NOPE', ok: 0, pick: 1 }), R({ q: 'BAD', ok: 0, pick: 1 }), R({ q: 'constructor', ok: 0, pick: 1 }), R({ q: '__proto__', ok: 0, pick: 1 }), R({ q: 'toString', ok: 0, pick: 1 })], missed: null }).rows.length === 0);
  ok('a self-rating and a row of an unknown kind are not answers', dig({ log: [R({ q: 'Q1', ok: 0, m: 'review', pick: 1 }), R({ q: 'Q2', ok: 0, m: 'weird' }), R({ q: 'Q3', ok: 0, m: undefined })] }).rows.length === 0);
  ok('limit 3: three rows, and it says there are more', (() => { const x = dig({ limit: 3 }); return x.rows.length === 3 && x.more === true && x.total === 5 && has(x.text, '(3 of 5)'); })());
  ok('the default limit is eight and the largest is fifteen', (() => {
    const lots = many(30, i => R({ q: 'L' + i, ok: 0, pick: 1, t: NOW - i * 1000 }));
    const big = {}; lots.forEach(r => { big[r.q] = mk(r.q, 'Alpha', 1, 'Short.', 0); });
    const go = o => safely(() => A.digest(Object.assign({ log: lots, byId: big, now: NOW, missed: null }, o)).rows.length, -1);
    return go({}) === 8 && go({ limit: 100 }) === 15 && go({ limit: 15 }) === 15 && go({ limit: 0 }) === 1 && go({ limit: 2.5 }) === 8 && go({ limit: '4' }) === 8;
  })());
  ok('the rows are cut between rows before a result would be cut in the middle of one', (() => {
    const lots = many(15, i => R({ q: 'L' + i, ok: 0, pick: 1, cf: 3, why: 'misread', ms: 94000, t: NOW - (15 - i) * 1000 }));
    const big = {}; lots.forEach(r => { big[r.q] = mk(r.q, 'Alpha', 1, 'S'.repeat(400), 0); big[r.q].o[0].t = 'a'.repeat(300); big[r.q].o[1].t = 'b'.repeat(300); });
    const x = safely(() => A.digest({ log: lots, byId: big, now: NOW, missed: null, limit: 15 }), { rows: [], text: '', more: false, total: 0 });
    const rowsText = x.text.split('\n\n').slice(1);
    return x.more === true && x.total === 15 && x.rows.length < 15 && x.rows.length >= 10 && x.text.length < 9000 && x.text.length > 7000 &&
      rowsText.length === x.rows.length && rowsText.every(t => /^\[L\d+\] Alpha, item 1/.test(t) && /\n  B: b+…$|\n  B: b+…\n/.test(t) && /\n  A: a+…$/.test(t)) && has(x.text, '(' + x.rows.length + ' of 15)');
  })());
  ok('a lone row longer than the budget is still given', (() => {
    const big = { L0: mk('L0', 'Alpha', 1, 'S'.repeat(5000), 0) };
    const x = safely(() => A.digest({ log: [R({ q: 'L0', ok: 0, pick: 1 })], byId: big, now: NOW, missed: null }), { rows: [], text: '' });
    return x.rows.length === 1 && x.text.length < 1200;
  })());
  ok('a stem is cut at 200 characters and an option at 110, each with an ellipsis',
    (() => { const b = { Z: mk('Z', 'Alpha', 1, 'S'.repeat(300), 0) }; b.Z.o[1].t = 'o'.repeat(300);
      const t = digText({ log: [R({ q: 'Z', ok: 0, pick: 1 })], byId: b, now: NOW, missed: null });
      const stem = t.split('\n').find(l => l.indexOf('  Stem: ') === 0), opt = t.split('\n').find(l => l.indexOf('  B: ') === 0);
      return stem === '  Stem: ' + 'S'.repeat(199) + '…' && opt === '  B: ' + 'o'.repeat(109) + '…'; })());
  ok('a stem and an option of exactly those lengths are not cut',
    (() => { const b = { Z: mk('Z', 'Alpha', 1, 'S'.repeat(200), 0) }; b.Z.o[1].t = 'o'.repeat(110);
      const t = digText({ log: [R({ q: 'Z', ok: 0, pick: 1 })], byId: b, now: NOW, missed: null });
      return has(t, '  Stem: ' + 'S'.repeat(200) + '\n') && has(t, '  B: ' + 'o'.repeat(110) + '\n'); })());
  ok('whitespace in a stem is one space, a line break included',
    (() => { const b = { Z: mk('Z', 'Alpha', 1, 'a  \n\t b', 0) };
      return has(digText({ log: [R({ q: 'Z', ok: 0, pick: 1 })], byId: b, now: NOW, missed: null }), '  Stem: a b\n'); })());
  ok('a long chapter name is cut in a row as it is in the mock line',
    (() => { const b = { Z: mk('Z', 'C'.repeat(200), 1, 'Stem.', 0) };
      return has(digText({ log: [R({ q: 'Z', ok: 0, pick: 1 })], byId: b, now: NOW, missed: null }), '[Z] ' + 'C'.repeat(59) + '…, item 1'); })());
  ok('the cap on the rows is kept, between rows: the rows given fit it, and the next one would not', (() => {
    const cap = 700, x = dig({ cap });
    const len = x.text.split('\n\n').slice(1).map(r => r.length + 1);                 // a row and the separator after it
    const all = dig({ limit: 15 }).text.split('\n\n').slice(1).map(r => r.length + 1);   // every row, uncut
    const used = len.reduce((a, c) => a + c, 0);
    return x.more === true && x.rows.length >= 1 && x.rows.length < 5 && all.length === 5 && used <= cap + 1 && used + all[x.rows.length] > cap;
  })());
  ok('a row longer than the cap is still given: there is always one', (() => { const x = dig({ cap: 50 }); return x.rows.length === 1 && x.more === true && x.total === 5; })());
  ok('a cap that is not a count is the default', dig({ cap: 0 }).rows.length === 5 && dig({ cap: -5 }).rows.length === 5 && dig({ cap: 'x' }).rows.length === 5 && dig({ cap: 1.5 }).rows.length === 5);
  ok('a choice written as text is not a choice', row0(dig({ log: [R({ q: 'Q1', ok: 0, pick: '1' })] })).pick === null && has(dig({ log: [R({ q: 'Q1', ok: 0, pick: '1' })] }).text, 'Choice not recorded'));
  ok('a row with no date has no time in it', row0(dig({ log: [R({ q: 'Q1', ok: 0, pick: 1, t: undefined })] })).t === null && row0(dig({ log: [R({ q: 'Q1', ok: 0, pick: 1, t: 'yesterday' })] })).t === null);
  ok('a choice outside the options is not recorded', has(dig({ log: [R({ q: 'Q1', ok: 0, pick: 9 })] }).text, 'Choice not recorded') && row0(dig({ log: [R({ q: 'Q1', ok: 0, pick: 9 })] })).pick === null);
  ok('a miss whose choice is the keyed option contradicts itself: the choice is not told',
    (() => { const x = dig({ log: [R({ q: 'Q1', ok: 0, pick: 2 })] }); return row0(x).pick === null && has(x.text, 'Choice not recorded; the key is C.') && !has(x.text, 'Chose'); })());
  ok('a question with no usable key says nothing of one', (() => { const b = { Q1: mk('Q1', 'Valvular Disease', 7, 'A stem.', 9) };
    const x = G.digest({ log: [R({ q: 'Q1', ok: 0, pick: 1 })], byId: b, now: NOW, missed: null }); return row0(x).key === null && !has(x.text, 'the key is') && has(x.text, 'Chose B.'); })());
  ok('a confidence or a reason that is not one of the set is not printed, nor a time that cannot be true',
    (() => { const x = dig({ log: [R({ q: 'Q1', ok: 0, pick: 1, cf: 7, why: '<script>alert(1)</script>', ms: -4 })] });
      return row0(x).cf === null && row0(x).why === null && row0(x).ms === null && !/Marked|Reason|alert\(1\)| s\.$/.test(x.text.split('\n')[3] || ''); })());
  ok('a row with no date has no dash, and a block row with no date has only the kind',
    (() => { const x = dig({ log: [R({ q: 'Q1', ok: 0, pick: 1, t: undefined }), R({ q: 'Q4', ok: 0, pick: 1, t: undefined, m: 'exam' })] });
      return has(x.text, '[Q4] Pericardial Disease, item 2 — in a mock block\n') && has(x.text, '[Q1] Valvular Disease, item 7\n') && !has(x.text, '— ,') && !has(x.text, ' — \n'); })());
  const g = dig({ grounded: true });
  ok('grounded: ids, chapter, item, confidence, reason, time — and no choice, no key, no stem, no wording',
    has(g.text, '[Q1] Valvular Disease, item 7 — 5 days ago\n  Marked "Certain". Reason given: Misread the stem. 94 s.') &&
    !/Chose|Choice|the key|Stem:|drug|keyed/.test(g.text.split('\n\n').slice(1).join('\n\n')) && !has(g.text.split('\n\n')[0], 'keyed option') && !has(g.text.split('\n\n')[0], 'what the fellow chose') &&
    g.rows.every(r => !('key' in r) && r.pick === null), g.text.slice(0, 300));
  ok('grounded: a row with nothing recorded beyond the question is that one line, with no empty line under it',
    (() => { const x = dig({ grounded: true, log: [R({ q: 'Q1', ok: 0, pick: 1, t: NOW - 5 * DAY })] }); return x.rows.length === 1 && x.text.split('\n\n')[1] === '[Q1] Valvular Disease, item 7 — 5 days ago'; })());
  ok('grounded says it withholds them, the choice included', has(g.text, 'Grounded mode: the key, the stems, the options\' wording and the option the fellow chose are withheld.') && !has(d.text, 'Grounded mode'));
  ok('grounded is the same rows in the same order', same(g.rows.map(r => r.id), d.rows.map(r => r.id)));
  ok('no misses: an empty result of the same shape', same(dig({ missed: new Set() }), { rows: [], text: '', more: false, total: 0 }));
  ok('a log that is not a list, rows that are not rows, a bank that is not an object: empty, no throw',
    [dig({ log: 'abc' }), dig({ log: null }), dig({ log: [null, 5, 'x', [], {}, { q: 5 }] }), dig({ byId: null }), dig({ byId: 'x' })].every(x => same(x, { rows: [], text: '', more: false, total: 0 })));
  ok('a throwing row is an empty result, not a throw', same(safely(() => A.digest({ log: [{ get q() { throw new Error('torn'); } }], byId }), 'threw'), { rows: [], text: '', more: false, total: 0 }));
  const frozen = deepFreeze({ log: JSON.parse(JSON.stringify(log)), byId: JSON.parse(JSON.stringify(byId)), missed: ['Q1', 'Q2'], now: NOW });
  ok('what it was given is left as it was', safely(() => A.digest(frozen).rows.length === 2, false));
}

head('the small helpers');
{
  ok('clip: one line, cut with an ellipsis, trailing space trimmed first', G.clip('abcdef', 4) === 'abc…' && G.clip('abcd', 4) === 'abcd' && G.clip('ab cdef', 4) === 'ab…' && G.clip('a\n  b\tc', 20) === 'a b c');
  ok('clip: nothing and null are the empty line', G.clip(null, 5) === '' && G.clip(undefined, 5) === '' && G.clip('   ', 5) === '');
  ok('ago: today, yesterday, days, weeks, months', G.ago(NOW - 1000, NOW) === 'today' && G.ago(NOW - DAY, NOW) === 'yesterday' && G.ago(NOW - 5 * DAY, NOW) === '5 days ago' &&
    G.ago(NOW - 13 * DAY, NOW) === '13 days ago' && G.ago(NOW - 14 * DAY, NOW) === '2 weeks ago' && G.ago(NOW - 59 * DAY, NOW) === '8 weeks ago' && G.ago(NOW - 60 * DAY, NOW) === '2 months ago');
  ok('ago: weeks and months are rounded, not cut', G.ago(NOW - 20 * DAY, NOW) === '3 weeks ago' && G.ago(NOW - 105 * DAY, NOW) === '4 months ago');
  ok('letterOf: a letter is three characters at most, and only letters and digits', G.letterOf([{ l: 'ABCDE' }], 0) === 'ABC' && G.letterOf([{ l: '<b>' }], 0) === 'b');
  ok('ago: a future date is recently, and what is not a time is nothing', G.ago(NOW + DAY, NOW) === 'recently' && G.ago(null, NOW) === '' && G.ago(NOW, undefined) === '' && G.ago(NaN, NOW) === '');
  ok('letterOf: the bank\'s letter, else the alphabet', G.letterOf([{ l: 'C' }, { l: 'D' }], 1) === 'D' && G.letterOf([], 2) === 'C' && G.letterOf(null, 0) === 'A' && G.letterOf([{ l: '' }], 0) === 'A');
}

head('the module is what it says it is');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'apexsignals.js'), 'utf8');
  const code = blankComments(src);
  ok('no clock, no storage, no DOM: it reads what it is given', !/\b(Date\.now|new Date|Math\.random|localStorage|sessionStorage|document|window\.|navigator|fetch)\b/.test(code.replace(/typeof window/g, '')), (code.match(/\b(Date\.now|new Date|Math\.random|localStorage|sessionStorage|document|navigator|fetch)\b/) || [''])[0]);
  ok('it stays inside what Safari 13.4 reads: no ?. ?? or lookbehind', !/\?\.[A-Za-z_$(\[]|\?\?|\(\?<[=!]/.test(code));
  ok('it throws nowhere on its own account', !/\bthrow\b/.test(code));
  ok('it asks calib.js and mockexam.js for the arithmetic and the validator, and keeps no copy', /Calib\.calibration/.test(code) && /Calib\.reasons/.test(code) && /MockExam\.cleanHistory/.test(code) && !/function median|function validEntry/.test(code));
  ok('it exposes the three readings and the helpers', ['standing', 'answerLine', 'digest', 'clip', 'ago', 'letterOf'].every(k => typeof A[k] === 'function'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
