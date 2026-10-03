#!/usr/bin/env node
/*
 * What the misses say: the pairs a learner takes for one another, and each
 * missed item's attempts in order, with what their pattern means.
 *
 *   node tests/verify-memorizer-misses-pure.js
 *
 * Pure Node, through the real session (memorizer/src/session.js): a drill,
 * its retries, and two review rounds, answered as a learner would, then
 * Session.confusions and Session.history read off the state it left.
 */
'use strict';
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const S = require(path.join(__dirname, '..', 'memorizer', 'src', 'session.js'));
const lesson = { overview: 'o', points: [{ text: 'Preload stretches the sarcomere', page: 2 }], numbers: [], mnemonics: [], analogies: [], flowchart: '' };
const OPT = ['Preload', 'Afterload', 'Inotropy', 'Compliance'];
const Q = [
  { question: 'stretch?', quote: '', options: OPT, answer: 0, explain: 'e', page: 1 },
  { question: 'load?', quote: '', options: OPT, answer: 1, explain: 'e', page: 1 },
  { question: 'force?', quote: '', options: OPT, answer: 2, explain: 'e', page: 1 },
];
const go = (s, ...e) => e.reduce((st, x) => S.next(st, x), s);
const pick = (s, f) => { const c = s.per[s.section], q = c.quiz.questions[c.order[c.pos]]; return S.next(s, { type: 'answered', choice: f(q) }); };
const rev = (s, f) => { while (s.phase === 'review') { const w = S.reviewItem(s); s = S.next(s, { type: 'reviewAnswered', choice: f(w) }); } return s; };
const byLabel = (s, l) => Object.values(s.weak).find(w => w.label === l);

/* The drill: "stretch?" taken for Afterload, then wrong again on its retry;
   "load?" taken for Preload, then right on its retry; "force?" right. */
let s = go(S.init('d', ['Loading', 'Other']), { type: 'open', section: 0 }, { type: 'taught', value: lesson },
  { type: 'toMemorize', value: { cards: 0 } }, { type: 'toDrill' }, { type: 'quizReady', value: { questions: Q } });
for (let k = 0; k < 3; k++) s = pick(s, q => q.question === 'stretch?' ? 1 : q.question === 'load?' ? 0 : q.answer);
while (s.phase === 'drill') s = pick(s, q => q.question === 'stretch?' ? 3 : q.answer);

head('what you confuse');
const pairs = S.confusions(s);
ok('Preload for Afterload and Afterload for Preload are one pair, counted twice', pairs.length === 1 && pairs[0].times === 2 &&
   [pairs[0].a, pairs[0].b].sort().join('|') === 'Afterload|Preload', JSON.stringify(pairs));
ok('it names the section it happened in', pairs[0] && pairs[0].sections.join() === 'Loading');
ok('both items taken for each other are in the pair', pairs[0] && pairs[0].ids.length === 2);
ok('a wrong pick on a failed retry (an encoding miss) makes no pair', !pairs.some(p => /Compliance/.test(p.a + p.b)), JSON.stringify(pairs));

head('how each miss went');
const w0 = byLabel(s, 'Preload'), h0 = S.history(w0);
ok('a miss and its failed retry are two steps, a confusion then an encoding miss', JSON.stringify(h0.steps) === JSON.stringify([{ ok: false, t: 'C' }, { ok: false, t: 'E' }]), JSON.stringify(h0.steps));
ok('one of each is not called "mostly" anything', /^Mixed misses/.test(h0.says), h0.says);
const h1 = S.history(byLabel(s, 'Afterload'));
ok('a miss put right on its retry is retrieval, said as one miss', h1.steps.length === 1 && h1.steps[0].t === 'R' && /^The miss was pulling it back cold/.test(h1.says), h1.says);

/* Two review rounds: all right, then "stretch?" taken for Afterload again. */
let u = rev(go(s, { type: 'toUnit' }, { type: 'toReview' }), w => w.q.answer);
let once = false;
u = rev(go(u, { type: 'toReview' }), w => (w.q.question === 'stretch?' && !once) ? (once = true, 1) : w.q.answer);
const h2 = S.history(byLabel(u, 'Preload'));
ok('a right answer in a later round is a step of its own', h2.steps.map(x => x.ok ? 'ok' : x.t).join(' ') === 'C E ok C ok', h2.steps.map(x => x.ok ? 'ok' : x.t).join(' '));
ok('two confusions in three misses is "mostly" telling things apart', /^Mostly telling it apart/.test(h2.says), h2.says);
ok('right, then wrong again later, is said to be a lapse', h2.lapse && /a lapse/.test(h2.says), h2.says);
ok('and the pair is now counted three times', (S.confusions(u)[0] || {}).times === 3, JSON.stringify(S.confusions(u)));

head('a session saved before this was recorded');
const old = JSON.parse(JSON.stringify(s));
Object.values(old.weak).forEach(w => { delete w.log; delete w.confusions; });
ok('its latest confusion still makes a pair', S.confusions(old).length === 1 && S.confusions(old)[0].times === 2, JSON.stringify(S.confusions(old)));
ok('and its misses still make a history', S.history(byLabel(old, 'Preload')).steps.length === 2);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
