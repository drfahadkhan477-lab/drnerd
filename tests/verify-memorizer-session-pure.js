#!/usr/bin/env node
/*
 * Memorizer's protocol: no phase is skipped, every miss becomes exactly one
 * review card, and the gauntlet comes last.
 *
 *   node tests/verify-memorizer-session-pure.js
 *
 * Pure Node. memorizer/src/session.js is a reducer — next(state, event) — so
 * the protocol can be driven here event by event, with no model and no page,
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
const encoded = { points: [{ text: 'Preload stretches the sarcomere', page: 2 }], mnemonic: 'PAC', flowchart: '' };
const prompts = n => ({ prompts: Array.from({ length: n }, (_, i) => ({ question: 'Q' + i, answer: 'A' + i, page: 2 + i })) });
const grade = correct => ({ correct, missing: correct ? [] : ['x'], misconception: '', feedback: '' });
const teach = (score, gaps) => ({ score, gaps: gaps.map((g, i) => ({ point: g, page: 5 + i })), misconceptions: [], feedback: '' });

/* Try an event; → [state, ''] or [original state, error message]. */
const tryNext = (s, e) => { try { return [S.next(s, e), '']; } catch (err) { return [s, err.message]; } };
const refused = (s, e) => tryNext(s, e)[1];

/* One cluster through its whole round, with the given recall results and
   teach-back gaps. */
function round(s, results, gaps, score) {
  s = S.next(s, { type: 'encoded', value: encoded });
  s = S.next(s, { type: 'toRecall' });
  s = S.next(s, { type: 'recallPrompts', value: prompts(results.length) });
  results.forEach(r => { s = S.next(s, { type: 'recallGraded', value: grade(r), answer: r ? 'right' : 'wrong' }); });
  return S.next(s, { type: 'explainGraded', value: teach(score == null ? 70 : score, gaps), explanation: 'I said things' });
}

head('a session starts where the protocol starts');
{
  const s = S.init('doc1', TITLES);
  ok('at the first cluster, in encode', s.cluster === 0 && s.phase === 'encode');
  ok('with no cards', s.cards.length === 0);
  ok('and is plain JSON, so it can be saved and resumed', JSON.stringify(JSON.parse(JSON.stringify(s))) === JSON.stringify(s));
  ok('a document with no clusters cannot start one', /at least one/.test((() => { try { S.init('d', []); return ''; } catch (e) { return e.message; } })()));
}

head('no phase is skipped');
{
  let s = S.init('doc1', TITLES);
  ok('recall cannot begin before encode has returned points', !!refused(s, { type: 'toRecall' }));
  ok('recall prompts cannot arrive during encode', !!refused(s, { type: 'recallPrompts', value: prompts(2) }));
  ok('a teach-back cannot be graded during encode', !!refused(s, { type: 'explainGraded', value: teach(90, []) }));
  ok('the gauntlet cannot start during encode', !!refused(s, { type: 'gauntletReady', value: { questions: [{ question: 'q', answer: 'a', cluster: 0, page: 1 }] } }));
  ok('an encode with no points is refused, not accepted as empty', !!refused(s, { type: 'encoded', value: { points: [], mnemonic: '', flowchart: '' } }));
  s = S.next(s, { type: 'encoded', value: encoded });
  ok('encoding does not by itself move on — the student says when they are ready', s.phase === 'encode');
  s = S.next(s, { type: 'toRecall' });
  ok('then recall', s.phase === 'recall');
  ok('a recall grade before the prompts exist is refused', !!refused(s, { type: 'recallGraded', value: grade(true) }));
  s = S.next(s, { type: 'recallPrompts', value: prompts(3) });
  ok('prompts cannot be replaced once set — that would silently re-ask', !!refused(s, { type: 'recallPrompts', value: prompts(1) }));
  ok('entering recall twice is refused', !!refused(s, { type: 'toRecall' }));
  ok('a teach-back cannot be graded until every recall prompt is', !!refused(s, { type: 'explainGraded', value: teach(90, []) }));
  s = S.next(s, { type: 'recallGraded', value: grade(true) });
  s = S.next(s, { type: 'recallGraded', value: grade(true) });
  ok('two of three graded: still recall', s.phase === 'recall' && s.per[0].recallIdx === 2);
  ok('a grade without a boolean "correct" is refused, never read as a pass',
     !!refused(s, { type: 'recallGraded', value: { missing: [], misconception: '', feedback: '' } }) &&
     !!refused(s, { type: 'recallGraded', value: { correct: 'true' } }));
  s = S.next(s, { type: 'recallGraded', value: grade(false) });
  ok('the third graded: explain', s.phase === 'explain');
  ok('recall is over — another recall grade is refused', !!refused(s, { type: 'recallGraded', value: grade(true) }));
  ok('and recall cannot be re-entered from the teach-back', !!refused(s, { type: 'toRecall' }));
  ok('a teach-back grade without a score is refused', !!refused(s, { type: 'explainGraded', value: { gaps: [] } }));
  s = S.next(s, { type: 'explainGraded', value: teach(80, []) });
  ok('after the teach-back: the next cluster, back at encode', s.cluster === 1 && s.phase === 'encode' && !s.per[1].points);
  ok('an unknown event is refused', !!refused(s, { type: 'skipToEnd' }));
  const msg = refused(s, { type: 'toRecall' });
  /* The phase as the phase field, not the word: the reason text for this
     refusal ("recall follows encode") contains "encode" too, and the first
     version of this check matched that instead. */
  ok('a refusal names the event and the phase, so a UI bug is diagnosable', /"toRecall"/.test(msg) && /phase "encode"/.test(msg), msg);
}

head('the gauntlet comes last');
{
  let s = S.init('doc1', TITLES);
  s = round(s, [true], []);
  s = round(s, [true], []);
  ok('with one cluster still to go, it is not the gauntlet', s.phase === 'encode' && s.cluster === 2);
  ok('and the gauntlet cannot be started early', !!refused(s, { type: 'gauntletReady', value: { questions: [{ question: 'q', answer: 'a', cluster: 0, page: 1 }] } }));
  s = round(s, [true], []);
  ok('after the last cluster’s teach-back: the gauntlet', s.phase === 'gauntlet' && s.cluster === 2);
  ok('a gauntlet grade before its questions is refused', !!refused(s, { type: 'gauntletGraded', value: grade(true) }));
  ok('a gauntlet with no questions is refused', !!refused(s, { type: 'gauntletReady', value: { questions: [] } }));
  s = S.next(s, { type: 'gauntletReady', value: { questions: [
    { question: 'G0', answer: 'a0', cluster: 1, page: 3 },
    { question: 'G1', answer: 'a1', cluster: 9, page: 4 },
    { question: 'G2', answer: 'a2', cluster: 0, page: 5 },
  ] } });
  ok('a question naming a cluster that does not exist is kept, with no cluster', s.gauntlet.questions[1].cluster === null);
  ok('the gauntlet’s questions cannot be replaced mid-way', !!refused(s, { type: 'gauntletReady', value: { questions: [{ question: 'x', answer: 'y', cluster: 0, page: 1 }] } }));
  s = S.next(s, { type: 'gauntletGraded', value: grade(true) });
  s = S.next(s, { type: 'gauntletGraded', value: grade(false) });
  ok('two of three: still the gauntlet', s.phase === 'gauntlet');
  s = S.next(s, { type: 'gauntletGraded', value: grade(false) });
  ok('three of three: done', s.phase === 'done');
  ok('and nothing is accepted after done', !!refused(s, { type: 'gauntletGraded', value: grade(true) }) && !!refused(s, { type: 'encoded', value: encoded }));
  const orphan = s.cards.find(c => c.source === 'gauntlet' && c.front === 'G1');
  ok('the orphan question’s miss is filed under a real cluster (the weakest)', orphan && orphan.cluster >= 0 && orphan.cluster < TITLES.length,
     orphan && String(orphan.cluster));
}

head('every miss becomes exactly one card');
{
  let s = S.init('doc1', TITLES);
  s = round(s, [true, false, false], ['gap one about contractility', 'gap two'], 40);
  s = round(s, [false], [], 90);
  s = round(s, [true, true], ['gap three'], 60);
  const bySource = src => s.cards.filter(c => c.source === src).length;
  ok('three missed recall prompts → three recall cards', bySource('recall') === 3, String(bySource('recall')));
  ok('three teach-back gaps → three explain cards', bySource('explain') === 3, String(bySource('explain')));
  ok('a correct answer makes no card', !s.cards.some(c => c.source === 'recall' && c.front === 'Q0' && c.cluster === 0));
  ok('each card has a unique id', new Set(s.cards.map(c => c.id)).size === s.cards.length);
  ok('each card knows its document, cluster, title and page',
     s.cards.every(c => c.docId === 'doc1' && TITLES[c.cluster] === c.title && typeof c.page === 'number'));
  const miss = s.cards.find(c => c.source === 'recall' && c.cluster === 0 && c.front === 'Q1');
  ok('a recall card asks the question and answers with the model answer', miss && miss.back === 'A1' && miss.page === 3);
  const gap = s.cards.find(c => c.source === 'explain' && c.back === 'gap one about contractility');
  ok('a teach-back card is a cloze of the gap, with the gap as its answer', gap && /_____/.test(gap.front) && gap.front !== gap.back, gap && gap.front);
  ok('new cards are due at once', S.dueCards(s.cards, '2026-01-01').length === s.cards.length);
  /* Replaying the same grade is what a double-tap or a resumed save does. The
     reducer refuses it (the phase has moved on), and even applied to a state
     that already has the card, the id is stable, so it cannot double. */
  const before = s.cards.length;
  let t = S.init('doc1', TITLES);
  t = S.next(t, { type: 'encoded', value: encoded });
  t = S.next(t, { type: 'toRecall' });
  t = S.next(t, { type: 'recallPrompts', value: prompts(2) });
  t = S.next(t, { type: 'recallGraded', value: grade(false) });
  const replay = Object.assign({}, t, { per: JSON.parse(JSON.stringify(t.per)) });
  replay.per[0].recallIdx = 0; replay.per[0].recall = [];
  const again = S.next(replay, { type: 'recallGraded', value: grade(false) });
  ok('grading the same prompt twice still leaves one card for it', again.cards.filter(c => c.front === 'Q0').length === 1,
     String(again.cards.filter(c => c.front === 'Q0').length));
  ok('(and the full session above still has its six)', before === 6, String(before));
}

head('mastery and the gauntlet’s focus');
{
  let s = S.init('doc1', TITLES);
  s = round(s, [true, true], [], 100);     // cluster 0: 1.0
  s = round(s, [false, false], [], 20);    // cluster 1: 0.1
  s = round(s, [true, false], [], 50);     // cluster 2: 0.5
  ok('mastery is half recall, half teach-back', Math.abs(S.mastery(s, 0) - 1) < 1e-9 && Math.abs(S.mastery(s, 1) - 0.1) < 1e-9 && Math.abs(S.mastery(s, 2) - 0.5) < 1e-9,
     [0, 1, 2].map(i => S.mastery(s, i)).join(', '));
  ok('a cluster not reached yet has no mastery — not zero', S.mastery(S.init('d', TITLES), 0) === null);
  ok('the gauntlet leans on the weakest clusters first', JSON.stringify(S.weakest(s, 2)) === '[1,2]', JSON.stringify(S.weakest(s, 2)));
  ok('gauntlet size: 5 for a tiny unit, 10 at most', S.gauntletSize(S.init('d', ['x'])) === 5 && S.gauntletSize(S.init('d', new Array(30).fill('x'))) === 10);
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
