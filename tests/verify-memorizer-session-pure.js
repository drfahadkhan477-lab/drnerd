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
const refused = (s, e) => { try { S.next(s, e); return ''; } catch (err) { return err.message; } };
const go = (s, ...events) => events.reduce((st, e) => S.next(st, e), s);
/* Answer the current question right or wrong. */
const answer = (s, right) => {
  const c = s.per[s.section], q = c.quiz.questions[c.order[c.pos]];
  return S.next(s, { type: 'answered', choice: right ? q.answer : (q.answer + 1) % 4 });
};
/* Teach and drill section i, getting first-pass answers `pattern` (true =
   right), and any retries right. */
function drill(s, i, n, pattern) {
  s = go(s, { type: 'open', section: i }, { type: 'taught', value: lesson }, { type: 'toDrill' }, { type: 'quizReady', value: quiz(n, 'S' + i + 'Q') });
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
  const drilling = go(taught, { type: 'toDrill' });
  ok('after the lesson, the drill', drilling.phase === 'drill');
  ok('questions arrive once', /already has its questions/.test(refused(go(drilling, { type: 'quizReady', value: quiz(3) }), { type: 'quizReady', value: quiz(3) })));
  ok('a drill whose answers point at no option is refused', /no usable questions/.test(refused(drilling, { type: 'quizReady', value: { questions: [{ question: 'q', quote: '', options: ['a', 'b'], answer: 5, explain: '', page: 1 }] } })));
  ok('the state it was given is never changed', !S.init('doc1', TITLES).per[1].lesson && taught.phase === 'teach');
}

head('the drill: graded by the option chosen, and a miss comes back');
{
  let s = go(S.init('doc1', TITLES), { type: 'open', section: 0 }, { type: 'taught', value: lesson }, { type: 'toDrill' }, { type: 'quizReady', value: quiz(4) });
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
  const s = go(S.init('doc1', TITLES), { type: 'open', section: 2 }, { type: 'taught', value: lesson }, { type: 'toDrill' }, { type: 'quizReady', value: { questions: [] } });
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
  ok('every section drilled: the exam opens', S.allDone(s) && go(s, { type: 'toExam' }).phase === 'exam');
  ok('the weakest sections lead it: Afterload (50%), then Contractility (75%)', S.weakest(s, 2).join(',') === '1,2', S.weakest(s, 2).join(','));
  ok('the exam avoids what the drills asked', S.asked(s).length === 12 && S.asked(s).indexOf('S1Q2') !== -1);
  let e = go(s, { type: 'toExam' });
  ok('a section cannot be opened during the exam', /exam first/.test(refused(e, { type: 'open', section: 0 })));
  const exq = { questions: [0, 1, 2].map(k => ({ question: 'E' + k, quote: '', options: ['a', 'b', 'c', 'd'], answer: 0, explain: 'x', page: 1, cluster: k === 2 ? 99 : k })) };
  e = go(e, { type: 'examReady', value: exq });
  ok('an exam question that names no real section is kept, unassigned', e.exam.questions[2].cluster === null);
  const before = e.cards.length;
  e = go(e, { type: 'examAnswered', choice: 0 }, { type: 'examAnswered', choice: 3 });
  ok('a wrong exam answer is a card', e.cards.length === before + 1 && e.cards[e.cards.length - 1].source === 'exam');
  const left = go(e, { type: 'toUnit' });
  ok('leaving the exam part-way and coming back resumes it', go(left, { type: 'toExam' }).exam.pos === 2 && go(left, { type: 'toExam' }).exam.questions.length === 3);
  e = go(e, { type: 'examAnswered', choice: 3 });
  ok('an unassigned miss is filed under the weakest section', e.cards[e.cards.length - 1].cluster === 1, String(e.cards[e.cards.length - 1].cluster));
  ok('then done, with its score', e.phase === 'done' && Math.abs(e.exam.score - 1 / 3) < 1e-9);
  ok('and from its result, back to the sections, the score kept', go(e, { type: 'toUnit' }).phase === 'unit' && go(e, { type: 'toUnit' }).exam.score === e.exam.score);
  ok('the exam can be retaken, with new questions', go(e, { type: 'toExam' }).exam.questions === null && go(e, { type: 'toExam' }).phase === 'exam');
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
