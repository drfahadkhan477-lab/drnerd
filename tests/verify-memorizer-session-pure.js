#!/usr/bin/env node
/*
 * Memorizer's protocol: a section is taught before it is drilled, a miss
 * comes back once before the drill ends, every miss becomes exactly one
 * review card, and the final exam comes last.
 *
 *   node tests/verify-memorizer-session-pure.js
 *
 * Pure Node. memorizer/src/session.js is a reducer — next(state, event) — so
 * the protocol can be driven here event by event, with no coach and no page,
 * and every promise its header makes can be tested by trying to break it: by
 * dispatching the event that would skip ahead, and seeing it refused.
 *
 * The review half runs the scheduler this app shares with Systole —
 * src/core/fsrs.js, loaded exactly the way tests/verify-fsrs.js loads it — so
 * what is checked is the real scheduling, not a stand-in.
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

const ROOT = path.join(__dirname, '..');
const S = require(path.join(ROOT, 'memorizer', 'src', 'session.js'));
const mod = {};
new Function('module', 'exports', fs.readFileSync(path.join(ROOT, 'src', 'core', 'fsrs.js'), 'utf8'))
  .call(mod, { exports: mod }, mod);
const FSRS = mod.FSRS;

const TITLES = ['Preload', 'Afterload', 'Contractility'];
const lesson = { overview: 'o', points: [{ text: 'Preload stretches the sarcomere', page: 2 }], numbers: [], mnemonics: [], analogies: [], flowchart: '' };
/* n questions; question k's right answer is option k % 4 */
const quiz = (n, tag) => ({ questions: Array.from({ length: n }, (_, k) => ({ question: (tag || 'Q') + k, quote: '', options: ['a', 'b', 'c', 'd'], answer: k % 4, explain: 'e' + k, page: 2 + k })) });
const clone = v => JSON.parse(JSON.stringify(v));
const refused = (s, e) => { try { S.next(s, e); return ''; } catch (err) { return err.message; } };
const go = (s, ...events) => events.reduce((st, e) => S.next(st, e), s);
/* A review round, if one is open, answered right throughout; and toExam
   through the review round the skill runs before it. The checks written
   before review rounds existed are about the phases around them. */
const clearReview = s => { let g = 0; while (s.phase === 'review' && g++ < 100) { const w = S.reviewItem(s); s = S.next(s, { type: 'reviewAnswered', choice: w.q.answer }); } return s; };
const toExam = s => clearReview(go(s, { type: 'toExam' }));
/* Answer the current question right or wrong. */
const answer = (s, right) => {
  const c = s.per[s.section], q = c.quiz.questions[c.order[c.pos]];
  return S.next(s, { type: 'answered', choice: right ? q.answer : (q.answer + 1) % 4 });
};
/* Teach and drill section i, getting first-pass answers `pattern` (true =
   right), and any retries right. */
function drill(s, i, n, pattern) {
  s = go(s, { type: 'open', section: i }, { type: 'taught', value: lesson }, { type: 'toMemorize', value: { cards: 0 } }, { type: 'toDrill' }, { type: 'quizReady', value: quiz(n, 'S' + i + 'Q') });
  for (let k = 0; k < n; k++) s = answer(s, pattern[k]);
  while (s.phase === 'drill') s = answer(s, true);
  return s;
}

head('a new session');
{
  const s = S.init('doc1', TITLES);
  ok('starts on the unit page, section 0, nothing taught', s.phase === 'unit' && s.section === 0 && s.v === S.VERSION && !s.per[0].lesson);
  ok('refuses a unit with no sections', (() => { try { S.init('d', []); return false; } catch (_) { return true; } })());
  ok('is plain JSON, so it can be saved and resumed', JSON.stringify(JSON.parse(JSON.stringify(s))) === JSON.stringify(s));
}

head('teach, then drill');
{
  const s0 = S.init('doc1', TITLES);
  const opened = go(s0, { type: 'open', section: 1 });
  ok('opening a section goes to its lesson', opened.phase === 'teach' && opened.section === 1);
  ok('the drill cannot start before the lesson has been given', /not been taught/.test(refused(opened, { type: 'toDrill' })), refused(opened, { type: 'toDrill' }));
  ok('a lesson with no points is refused', /no points/.test(refused(opened, { type: 'taught', value: { points: [] } })));
  ok('answers are refused outside a drill', /needs the drill/.test(refused(opened, { type: 'answered', choice: 0 })));
  const taught = go(opened, { type: 'taught', value: lesson });
  const drilling = go(taught, { type: 'toMemorize', value: { cards: 0 } }, { type: 'toDrill' });
  ok('after the lesson, the drill', drilling.phase === 'drill');
  ok('questions arrive once', /already has its questions/.test(refused(go(drilling, { type: 'quizReady', value: quiz(3) }), { type: 'quizReady', value: quiz(3) })));
  ok('a drill whose answers point at no option is refused', /no usable questions/.test(refused(drilling, { type: 'quizReady', value: { questions: [{ question: 'q', quote: '', options: ['a', 'b'], answer: 5, explain: '', page: 1 }] } })));
  ok('the state it was given is never changed', !S.init('doc1', TITLES).per[1].lesson && taught.phase === 'teach');
}

head('memorise before the drill');
{
  const taught = go(S.init('doc1', TITLES), { type: 'open', section: 1 }, { type: 'taught', value: lesson });
  ok('the drill is refused until the section is memorised', /memorise the section before its drill/.test(refused(taught, { type: 'toDrill' })), refused(taught, { type: 'toDrill' }));
  ok('memorising needs to know how many cards there are', /how many cards/.test(refused(taught, { type: 'toMemorize' })));
  const m = go(taught, { type: 'toMemorize', value: { cards: 3 } });
  ok('memorising goes through the cards in order', m.phase === 'memorize' && JSON.stringify(m.per[1].memo.order) === '[0,1,2]' && m.per[1].memo.pos === 0);
  ok('a card is recalled only while memorising, and as known or not', /while memorising/.test(refused(taught, { type: 'recalled', knew: true })) &&
     /knew it, or not yet/.test(refused(m, { type: 'recalled' })));
  const missed = go(m, { type: 'recalled', knew: true }, { type: 'recalled', knew: false });
  ok('a card not known comes back at the end', JSON.stringify(missed.per[1].memo.order) === '[0,1,2,1]' && missed.per[1].memo.pos === 2 && missed.per[1].memo.misses === 1 && missed.phase === 'memorize');
  const almost = go(missed, { type: 'recalled', knew: true });
  ok('the drill waits until every card has been known once', almost.phase === 'memorize' && !almost.per[1].memorized);
  const done = go(almost, { type: 'recalled', knew: true });
  ok('then the drill opens by itself', done.phase === 'drill' && done.per[1].memorized === true && done.per[1].pos === 0);
  const again = go(done, { type: 'quizReady', value: quiz(2) }, { type: 'toUnit' }, { type: 'open', section: 1 });
  ok('a section memorised once goes straight to its drill next time', go(again, { type: 'toDrill' }).phase === 'drill');
  ok('a section with no cards has nothing to hold back', go(taught, { type: 'toMemorize', value: { cards: 0 } }, { type: 'toDrill' }).phase === 'drill' && go(taught, { type: 'toMemorize', value: { cards: 0 } }).phase === 'teach');
}

head('the drill: graded by the option chosen, and a miss comes back');
{
  let s = go(S.init('doc1', TITLES), { type: 'open', section: 0 }, { type: 'taught', value: lesson }, { type: 'toMemorize', value: { cards: 0 } }, { type: 'toDrill' }, { type: 'quizReady', value: quiz(4) });
  s = answer(s, true);            /* Q0 right */
  s = answer(s, false);           /* Q1 wrong */
  ok('a right answer is recorded right, a wrong one wrong', s.per[0].answers[0].correct === true && s.per[0].answers[1].correct === false);
  ok('a miss becomes a review card, with the question, its options and the right answer', s.cards.length === 1 &&
     s.cards[0].front === 'Q1' && s.cards[0].options.length === 4 && s.cards[0].answer === 1 && s.cards[0].back === 'b' && s.cards[0].explain === 'e1');
  ok('and is asked again at the end of the same drill', s.per[0].order.join(',') === '0,1,2,3,1', s.per[0].order.join(','));
  s = answer(s, true); s = answer(s, true);   /* Q2, Q3 */
  ok('the drill is not over until the missed question comes back', s.phase === 'drill' && s.per[0].order[s.per[0].pos] === 1);
  const again = answer(s, false);
  ok('missed again on the retry: no second card and no third ask', again.cards.length === 1 && again.phase === 'result' && again.per[0].order.length === 5);
  s = answer(s, true);
  ok('then the result', s.phase === 'result' && s.per[0].done === true);
  ok('the score counts first answers only: 3 of 4', s.per[0].score === 0.75, String(s.per[0].score));
  ok('a retry answered right does not change it', s.per[0].answers.filter(a => !a.first).length === 1 && s.per[0].score === 0.75);
  const re = go(s, { type: 'redrill' });
  ok('a drill can be taken again from its result', re.phase === 'drill' && re.per[0].pos === 0 && re.per[0].answers.length === 0 && re.per[0].order.join(',') === '0,1,2,3');
  let r2 = re; for (let k = 0; k < 4; k++) r2 = answer(r2, k !== 1 && k !== 2);
  while (r2.phase === 'drill') r2 = answer(r2, true);
  ok('missing the same question again makes no second card', r2.cards.filter(c => c.front === 'Q1').length === 1, String(r2.cards.length));
  ok('a worse retake is scored as it went, and the best score is kept', r2.per[0].score === 0.5 && r2.per[0].best === 0.75 && r2.per[0].attempts === 2,
     r2.per[0].score + ' / ' + r2.per[0].best);
  ok('an answer that is not an option index is refused', /index of an option/.test(refused(re, { type: 'answered', choice: 'b' })));
  ok('back to the lesson from the result starts the drill from the top next time', go(s, { type: 'open', section: 0 }, { type: 'toDrill' }).per[0].pos === 0);
}

head('a section with nothing to drill');
{
  const s = go(S.init('doc1', TITLES), { type: 'open', section: 2 }, { type: 'taught', value: lesson }, { type: 'toMemorize', value: { cards: 0 } }, { type: 'toDrill' }, { type: 'quizReady', value: { questions: [] } });
  ok('is done, with no score, and does not block the unit', s.phase === 'result' && s.per[2].done && s.per[2].score === null && S.mastery(s, 2) === null);
  ok('and cannot be drilled again', /nothing to drill/.test(refused(s, { type: 'redrill' })));
}

head('the final exam comes last');
{
  let s = S.init('doc1', TITLES);
  s = drill(s, 0, 4, [true, true, true, true]);
  ok('the exam is refused while a section is undrilled', /after every section/.test(refused(s, { type: 'toExam' })));
  s = drill(s, 1, 4, [false, false, true, true]);
  s = drill(s, 2, 4, [true, false, true, true]);
  ok('every section drilled: the exam opens', S.allDone(s) && toExam(s).phase === 'exam');
  ok('the weakest sections lead it: Afterload (50%), then Contractility (75%)', S.weakest(s, 2).join(',') === '1,2', S.weakest(s, 2).join(','));
  ok('the exam avoids what the drills asked', S.asked(s).length === 12 && S.asked(s).indexOf('S1Q2') !== -1);
  let e = toExam(s);
  ok('a section cannot be opened during the exam', /exam first/.test(refused(e, { type: 'open', section: 0 })));
  const exq = { questions: [0, 1, 2].map(k => ({ question: 'E' + k, quote: '', options: ['a', 'b', 'c', 'd'], answer: 0, explain: 'x', page: 1, cluster: k === 2 ? 99 : k })) };
  e = go(e, { type: 'examReady', value: exq });
  ok('an exam question that names no real section is kept, unassigned', e.exam.questions[2].cluster === null);
  const before = e.cards.length;
  e = go(e, { type: 'examAnswered', choice: 0 }, { type: 'examAnswered', choice: 3 });
  ok('a wrong exam answer is a card', e.cards.length === before + 1 && e.cards[e.cards.length - 1].source === 'exam');
  const left = go(e, { type: 'toUnit' });
  ok('leaving the exam part-way and coming back resumes it', toExam(left).exam.pos === 2 && toExam(left).exam.questions.length === 3);
  e = go(e, { type: 'examAnswered', choice: 3 });
  ok('an unassigned miss is filed under the weakest section', e.cards[e.cards.length - 1].cluster === 1, String(e.cards[e.cards.length - 1].cluster));
  ok('then done, with its score', e.phase === 'done' && Math.abs(e.exam.score - 1 / 3) < 1e-9);
  ok('and from its result, back to the sections, the score kept', go(e, { type: 'toUnit' }).phase === 'unit' && go(e, { type: 'toUnit' }).exam.score === e.exam.score);
  ok('the exam can be retaken, with new questions', toExam(e).exam.questions === null && toExam(e).phase === 'exam');
  ok('the exam is sized by the unit', S.examSize(s) === 6 && S.examSize(S.init('d', Array(9).fill('t'))) === 12 && S.examSize(S.init('d', ['a'])) === 6);
}

head('where to go next');
{
  let s = S.init('doc1', TITLES);
  s = drill(s, 0, 2, [true, true]);
  ok('after a section, the next undrilled one', S.nextSection(s) === 1);
  s = drill(s, 2, 2, [true, true]);
  ok('wrapping round to one skipped', S.nextSection(s) === 1);
  s = drill(s, 1, 2, [true, true]);
  ok('none when all are drilled — the exam is next', S.nextSection(s) === null);
  const open1 = go(S.init('d', TITLES), { type: 'open', section: 1 });
  ok('the next section is after the one open, not the one open', S.nextSection(open1) === 2, String(S.nextSection(open1)));
  ok('mastery is the drill’s first-pass score, null before it', S.mastery(s, 0) === 1 && S.mastery(S.init('d', TITLES), 0) === null);
}

head('the Supreme Memorizer rules: error types, the weak list, review rounds, graduation');
{
  const K = require(path.join(ROOT, 'memorizer', 'src', 'skill.js'));
  ok('graduated: two right answers in rounds at least two apart', K.graduated({ hits: [3, 5] }) && K.graduated({ hits: [1, 4, 5] }));
  ok('not graduated: one, two adjacent, two in one round, or none', !K.graduated({ hits: [3] }) && !K.graduated({ hits: [3, 4] }) &&
     !K.graduated({ hits: [6, 6] }) && !K.graduated({ hits: [] }) && !K.graduated({}));

  /* Answer the current drill question: 'r' right, 'w' the next option
     (wrong), 'n' not sure. */
  const cur = s => { const c = s.per[s.section]; return c.quiz.questions[c.order[c.pos]]; };
  const pick = (s, how) => { const q = cur(s); return S.next(s, { type: 'answered', choice: how === 'r' ? q.answer : how === 'n' ? S.NOT_SURE : (q.answer + 1) % 4 }); };
  const openDrill = (s, i, n) => go(s, { type: 'open', section: i }, { type: 'taught', value: lesson }, { type: 'toMemorize', value: { cards: 0 } }, { type: 'toDrill' }, { type: 'quizReady', value: quiz(n, 'S' + i + 'Q') });
  const T4 = ['A', 'B', 'C', 'D'];

  let s = openDrill(S.init('d4', T4), 0, 4);
  const q0 = cur(s);
  s = pick(s, 'w');                                   /* Q0 wrong: C, confused with the option picked */
  s = pick(s, 'n');                                   /* Q1 not sure: N */
  s = pick(s, 'r'); s = pick(s, 'r');
  const ws = () => Object.values(s.weak).sort((a, b) => a.order - b.order);
  ok('a wrong option is a confusion, with the option picked as what it was confused with',
     ws()[0].types.join() === 'C' && ws()[0].confusedWith === q0.options[(q0.answer + 1) % 4] && ws()[0].cluster === 0, JSON.stringify(ws()[0].types) + ' ' + ws()[0].confusedWith);
  ok('"not sure" is never-encountered, and is a miss', ws()[1].types.join() === 'N' && s.cards.length === 2 && s.per[0].answers[1].correct === false);
  ok('each card carries its type', s.cards[0].errorType === 'C' && s.cards[0].confusedWith === ws()[0].confusedWith && s.cards[1].errorType === 'N');
  s = pick(s, 'r');                                   /* retry of Q0: right → R */
  s = pick(s, 'w');                                   /* retry of Q1: wrong again → E */
  ok('missed, then right on the retry, is retrieval: the memory was there', ws()[0].types.join() === 'R' && ws()[0].streak === 0 && s.cards[0].errorType === 'R');
  ok('missed on both is encoding: nothing stuck', ws()[1].types.join() === 'N,E' && ws()[1].misses === 2 && ws()[1].streak === 2 && s.cards[1].errorType === 'E');
  ok('a right retry in the same round as the miss does not count towards graduating', ws()[0].hits.length === 0);
  ok('the drill still scores the first try only', s.phase === 'result' && s.per[0].score === 0.5);
  ok('no review round is offered after one section', !s.reviewDue);

  s = openDrill(s, 1, 2); s = pick(s, 'r'); s = pick(s, 'r');
  ok('after a second section, a review round is offered, for the weak items of the first', s.phase === 'result' && s.reviewDue);
  ok('it is refused with nothing weak', /weak list/.test(refused(drill(S.init('x', ['a', 'b']), 0, 2, [true, true]), { type: 'toReview' })));
  s = go(s, { type: 'toReview' });
  ok('the round holds every item still weak', s.phase === 'review' && s.review.queue.length === 2 && !s.review.final && !s.reviewDue);
  ok('a review round is a round of its own: drills were rounds 1 and 2, this is 3', s.review.round === 3 && s.round === 3, String(s.review.round));
  ok('the item that was missed twice in a row calls for a re-teach if missed again; the one fixed on the retry does not',
     S.needsReteach(s) === (S.reviewItem(s).streak >= 1) && ws()[1].streak === 2 && ws()[0].streak === 0);
  const rq = id => s.weak[id].q;
  let seen = [];
  while (s.phase === 'review') {
    const it = S.reviewItem(s); seen.push(it.id);
    /* Q1 (the E item) is missed once more in this round, then right. */
    const wrongNow = it.id === ws()[1].id && seen.filter(x => x === it.id).length === 1;
    s = S.next(s, { type: 'reviewAnswered', choice: wrongNow ? (rq(it.id).answer + 1) % 4 : rq(it.id).answer });
  }
  ok('a miss in a round comes back at the end of that round, once', seen.length === 3 && seen[2] === ws()[1].id, seen.length + '');
  ok('a miss on a streak is encoding again', ws()[1].types.slice(-1)[0] === 'E');
  ok('the round ends where it started', s.phase === 'result' && s.review === null && s.reviews.length === 1 && s.reviews[0].asked === 3);
  ok('one right answer since the last miss is not graduation', !K.graduated(ws()[0]) && ws()[0].hits.length === 1);

  s = openDrill(s, 2, 2); s = pick(s, 'r'); s = pick(s, 'r');
  s = openDrill(s, 3, 2); s = pick(s, 'r'); s = pick(s, 'r');
  s = go(s, { type: 'toExam' });
  ok('the exam opens with a final review round when anything is still weak', s.phase === 'review' && s.review.final && s.review.resume === 'exam');
  ok('holding items from different sections next to each other where it can', s.review.queue.every((id, i, a) => i === 0 || s.weak[id].cluster !== s.weak[a[i - 1]].cluster || new Set(a.map(x => s.weak[x].cluster)).size === 1));
  s = clearReview(s);
  ok('two right answers in rounds far enough apart graduate an item', K.graduated(ws()[0]), JSON.stringify(ws()[0].hits));
  ok('then the exam', s.phase === 'exam' && S.pending(s).every(w => !K.graduated(w)));
  s = go(s, { type: 'examReady', value: { questions: [{ question: 'E0', quote: '', options: ['a', 'b', 'c', 'd'], answer: 0, explain: 'x', page: 1, cluster: 3 }] } });
  s = go(s, { type: 'examAnswered', choice: S.NOT_SURE });
  const ex = Object.values(s.weak).find(w => w.source === 'exam');
  ok('an exam miss is on the weak list for the report, typed, but never in a review round', !!ex && ex.types.join() === 'N' && S.pending(s).every(w => w.source !== 'exam'));

  /* A miss wipes the count: right in round 3, wrong then right in the
     final round is one right answer since the miss, not two. */
  let u = openDrill(S.init('d8', ['A', 'B']), 0, 1); u = pick(u, 'w'); u = pick(u, 'r');
  u = openDrill(u, 1, 1); u = pick(u, 'r');
  u = go(u, { type: 'toReview' });
  u = S.next(u, { type: 'reviewAnswered', choice: S.reviewItem(u).q.answer });
  const uw = Object.values(u.weak)[0];
  u = go(u, { type: 'toExam' });
  u = S.next(u, { type: 'reviewAnswered', choice: (S.reviewItem(u).q.answer + 1) % 4 });
  u = S.next(u, { type: 'reviewAnswered', choice: S.reviewItem(u).q.answer });
  ok('a miss wipes the count: right, then wrong, then right is not graduation', !K.graduated(u.weak[uw.id]) && u.weak[uw.id].hits.length === 1 && u.phase === 'exam',
     JSON.stringify(u.weak[uw.id].hits));

  /* A round cannot loop on an item missed every time. */
  let t = openDrill(S.init('d5', ['A', 'B']), 0, 1); t = pick(t, 'w'); t = pick(t, 'w');
  t = openDrill(t, 1, 1); t = pick(t, 'r');
  t = go(t, { type: 'toReview' });
  let n = 0;
  while (t.phase === 'review' && n++ < 10) t = S.next(t, { type: 'reviewAnswered', choice: (S.reviewItem(t).q.answer + 1) % 4 });
  ok('an item missed every time is asked twice in a round, then the round ends', n === 2 && t.phase === 'result', String(n));

  const il = S.interleave([0, 0, 0, 1, 1, 2].map((c, i) => ({ id: 'i' + i, cluster: c })), 7);
  const cl = il.map(id => [0, 0, 0, 1, 1, 2][+id.slice(1)]);
  ok('interleaving: no two from one section side by side when they can be kept apart', cl.every((c, i) => i === 0 || c !== cl[i - 1]), cl.join(''));
  /* Every round, not one lucky order: a version without the "not the same
     section" rule passed the single order above. */
  const CL = [0, 0, 0, 1, 1, 2, 2, 3];
  const bad = [];
  for (let r = 1; r <= 40; r++) {
    const o = S.interleave(CL.map((c, i) => ({ id: 'j' + i, cluster: c })), r).map(id => CL[+id.slice(1)]);
    if (!o.every((c, i) => i === 0 || c !== o[i - 1])) bad.push(r + ':' + o.join(''));
  }
  ok('and in every round of forty, not just one', bad.length === 0, bad.slice(0, 3).join(' '));
  ok('and the same state always gives the same order', JSON.stringify(il) === JSON.stringify(S.interleave([0, 0, 0, 1, 1, 2].map((c, i) => ({ id: 'i' + i, cluster: c })), 7)));

  /* A session saved before this version has no weak list. */
  const old = openDrill(S.init('d6', ['A', 'B']), 0, 1);
  delete old.weak; delete old.round; delete old.review; delete old.reviews; delete old.reviewDue; old.v = 2;
  const o = pick(old, 'w');
  ok('a saved version-2 or version-3 session is resumed; the old recall protocol (version 1) is not',
     S.resumable({ v: 2 }) && S.resumable(S.init('r', ['a'])) && !S.resumable({ v: 1 }) && !S.resumable(null));
  ok('a version-2 session is read as having an empty weak list, and carries on', o.v === S.VERSION && Object.keys(o.weak).length === 1 && o.phase === 'drill');

  const cs = S.init('d7', ['One', 'Two', 'Three', 'Four', 'Five', 'Six']);
  [0, 1, 2, 3, 4, 5].forEach(i => { cs.per[i].lesson = { overview: 'Big idea ' + i, points: [{ text: 'P' + i, page: i + 1 }], numbers: [], mnemonics: i % 2 ? [] : [{ title: 'List ' + i, letters: 'AB', words: ['alpha', 'beta'] }], analogies: [], flowchart: '' }; });
  const Q = (a) => ({ question: 'q' + a, quote: '', options: [a, 'x', 'y', 'z'], answer: 0, explain: '', page: 2 });
  cs.weak = { a: { id: 'a', cluster: 0, source: 'drill', q: Q('aa'), label: 'aa', misses: 1, streak: 0, hits: [2, 4], types: ['R'], confusedWith: '', order: 0 },
              b: { id: 'b', cluster: 4, source: 'drill', q: Q('bb'), label: 'bb', misses: 2, streak: 1, hits: [], types: ['C', 'E'], confusedWith: 'x', order: 1 } };
  const c = S.closing(cs);
  ok('closing: three pillars, the big idea of one lesson from each third of the unit', c.pillars.map(p => p.text).join() === 'Big idea 0,Big idea 2,Big idea 4', c.pillars.map(p => p.text).join());
  ok('the mnemonic sheet has every lesson’s mnemonics', c.sheet.map(m => m.section + ':' + m.letters).join() === 'One:AB,Three:AB,Five:AB');
  ok('the weak-area report: twice-missed first, with types, confusion and whether it graduated',
     c.weak.map(w => w.answer).join() === 'bb,aa' && c.weak[0].types.join() === 'C,E' && c.weak[0].confusedWith === 'x' && !c.weak[0].graduated && c.weak[1].graduated);
  const txt = S.closingText(cs);
  ok('as text to copy, every part in it', /THREE PILLARS/.test(txt) && /MNEMONIC SHEET/.test(txt) && /AB — alpha, beta/.test(txt) && /WEAK AREA REPORT/.test(txt) &&
     /confused with x/.test(txt) && /still weak/.test(txt) && /graduated/.test(txt));
  ok('the weak line names the open items with type and misses', K.weakLine(Object.values(cs.weak)) === 'Weak: bb (Type E · 2 misses)', K.weakLine(Object.values(cs.weak)));
}

head('review runs on the real scheduler');
{
  const card = { id: 'c1', front: 'f', back: 'b', srs: null };
  const day0 = '2026-03-01';
  ok('the shared FSRS module loaded', FSRS && typeof FSRS.update === 'function');
  const again = S.review(card, 1, day0, FSRS), good = S.review(card, 3, day0, FSRS), easy = S.review(card, 4, day0, FSRS);
  ok('a reviewed card gets an FSRS schedule', good.srs && typeof good.srs.due === 'string' && good.srs.last === day0);
  ok('Again comes back sooner than Good, Good sooner than Easy', again.srs.due <= good.srs.due && good.srs.due < easy.srs.due,
     `${again.srs.due} / ${good.srs.due} / ${easy.srs.due}`);
  ok('a card scheduled into the future is not due today', !S.isDue(easy, day0) && S.isDue(easy, easy.srs.due));
  ok('reviewing does not mutate the card it was given', card.srs === null);
  let c = card, day = day0;
  const ivls = [];
  for (let i = 0; i < 4; i++) { c = S.review(c, 3, day, FSRS); ivls.push(c.srs.ivl); day = c.srs.due; }
  ok('repeated Good answers space the card further apart each time', ivls.every((v, i) => i === 0 || v > ivls[i - 1]), ivls.join(' → '));
}

head('a confident miss, and cards that start later (study.js)');
{
  const cur = s => { const c = s.per[s.section]; return c.quiz.questions[c.order[c.pos]]; };
  const openDrill = (s, i, n) => go(s, { type: 'open', section: i }, { type: 'taught', value: lesson }, { type: 'toMemorize', value: { cards: 0 } }, { type: 'toDrill' }, { type: 'quizReady', value: quiz(n, 'S' + i + 'Q') });
  let s = openDrill(S.init('dc', ['A', 'B']), 0, 3);
  const q0 = cur(s);
  s = S.next(s, { type: 'answered', choice: (q0.answer + 1) % 4, sure: true });      /* sure, and wrong */
  const q1 = cur(s);
  s = S.next(s, { type: 'answered', choice: S.NOT_SURE, sure: true });              /* "not sure" cannot be sure */
  s = S.next(s, { type: 'answered', choice: cur(s).answer, sure: true });           /* sure, and right */
  const w = Object.values(s.weak);
  ok('sure and wrong: its weak item and its card are flagged, and the answer says it was sure', w.filter(x => x.hazard).length === 1 &&
     s.cards.filter(c => c.hazard).length === 1 && s.cards.find(c => c.hazard).front === q0.question && s.per[0].answers[0].sure === true, JSON.stringify(w.map(x => x.hazard)));
  ok('"not sure" is never a confident miss, and a right answer is never flagged', s.per[0].answers[1].sure === false && !s.cards.some(c => c.hazard && c.front === q1.question) &&
     s.per[0].answers[2].sure === true && s.per[0].answers[2].correct);
  const plain = S.next(openDrill(S.init('dp', ['A']), 0, 2), { type: 'answered', choice: 1 });
  ok('an answer that says nothing about being sure is not sure', plain.per[0].answers[0].sure === false && !plain.cards.some(c => c.hazard));
  ok('a card never reviewed is due now — unless made to start later', S.isDue({ srs: null }, '2026-09-24') && S.isDue({ srs: null, dueFrom: '2026-09-24' }, '2026-09-24') &&
     !S.isDue({ srs: null, dueFrom: '2026-09-25' }, '2026-09-24') && S.dueCards([{ srs: null, dueFrom: '2026-09-25' }, { srs: null }], '2026-09-24').length === 1);
  ok('once reviewed, its schedule decides, not where it started', S.isDue({ srs: { due: '2026-09-20' }, dueFrom: '2026-09-30' }, '2026-09-24') &&
     !S.isDue({ srs: { due: '2026-09-30' } }, '2026-09-24'));
}

head('a pack imported (pack.js): its sections taught from it, what was earned kept');
{
  const packLesson = { overview: 'p', points: [{ text: 'Afterload is the load the ventricle ejects against', page: 3 }], numbers: [], mnemonics: [], analogies: [], flowchart: '', by: 'pack' };
  const packed = (index, n) => ({ index, lesson: packLesson, quiz: quiz(n, 'P' + index + 'Q') });
  let s = drill(S.init('dk', TITLES), 0, 2, [false, true]);
  s = go(s, { type: 'toUnit' });
  const cards = s.cards.length, weak = Object.keys(s.weak).length, score = s.per[0].score;
  const t = S.next(s, { type: 'packed', value: { sections: [packed(0, 3), packed(1, 2)] } });
  ok('each section it covers has the pack\u2019s lesson and questions', t.per[0].lesson.by === 'pack' && t.per[1].lesson.by === 'pack' &&
     t.per[0].quiz.questions.length === 3 && t.per[0].quiz.questions[0].question === 'P0Q0' && t.per[1].quiz.questions.length === 2);
  ok('a section it does not cover is left as it was', !t.per[2].lesson && !t.per[2].quiz);
  ok('what the drilled section earned stays: its score, its cards, its weak items', t.per[0].score === score && t.per[0].done && t.cards.length === cards && Object.keys(t.weak).length === weak);
  ok('the next drill of it asks the pack\u2019s questions', (() => {
    const d = go(t, { type: 'open', section: 0 }, { type: 'toDrill' });
    return d.phase === 'drill' && d.per[0].order.length === 3 && d.per[0].quiz.questions[d.per[0].order[0]].question === 'P0Q0';
  })());
  ok('a new section is taught from it, with nothing more to ask for', (() => {
    const o = S.next(t, { type: 'open', section: 1 });
    return o.phase === 'teach' && o.per[1].lesson.by === 'pack' && refused(o, { type: 'taught', value: lesson }) === '';
  })());
  const mid = go(S.init('dm', TITLES), { type: 'open', section: 0 }, { type: 'taught', value: lesson }, { type: 'toMemorize', value: { cards: 0 } }, { type: 'toDrill' }, { type: 'quizReady', value: quiz(2) });
  const m2 = S.next(mid, { type: 'packed', value: { sections: [packed(0, 3), packed(1, 2)] } });
  ok('the section being drilled keeps its lesson and questions until it is left', m2.per[0].quiz.questions[0].question === 'Q0' && m2.per[0].lesson.overview === 'o');
  ok('while the others take the pack\u2019s', m2.per[1].lesson.by === 'pack');
  const e = S.next(t, { type: 'packed', value: { sections: [{ index: 2, lesson: { points: [] }, quiz: quiz(2) }, { index: 9, lesson: packLesson, quiz: quiz(1) }, { index: 1, lesson: packLesson, quiz: { questions: [{ question: 'x', options: ['a'], answer: 3 }] } }] } });
  ok('a lesson with no points, a section the unit does not have, and unusable questions are passed over',
     !e.per[2].lesson && !e.per[9] && e.per[1].quiz.questions[0].question === 'P1Q0');
  ok('a pack that is not a list of sections is refused', /list of sections/.test(refused(s, { type: 'packed', value: {} })));
  ok('the stored lesson is the session\u2019s own copy', (() => {
    const src = { sections: [{ index: 2, lesson: clone(packLesson), quiz: quiz(1) }] };
    const u = S.next(s, { type: 'packed', value: src });
    src.sections[0].lesson.points.push({ text: 'x', page: 1 }); src.sections[0].quiz.questions.push(quiz(1).questions[0]);
    return u.per[2].lesson.points.length === 1 && u.per[2].quiz.questions.length === 1;
  })());
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
