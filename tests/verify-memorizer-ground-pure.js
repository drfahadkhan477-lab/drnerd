#!/usr/bin/env node
/*
 * What an on-device model may say is held to the book: no new numbers, no
 * new named things, mostly the book's words, and a question's answer found
 * in a sentence of the section — which is then shown in the model's place.
 *
 *   node tests/verify-memorizer-ground-pure.js
 *
 * Pure Node. The "model output" here is written by hand to be wrong in one
 * way each, the ways a small model is wrong: a made-up threshold, a drug the
 * passage never names, a sentence with no citation, a citation to a passage
 * that was not given, an answer the section does not support, a distractor
 * that is also true.
 */
'use strict';
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const G = require(path.join(ROOT, 'memorizer', 'src', 'ground.js'));

const P = [
  { text: 'Aortic stenosis is a narrowing of the aortic valve opening that obstructs left ventricular outflow.' },
  { text: 'Valve replacement is indicated once symptoms appear, surgically or by TAVR.' },
  { text: 'A mean gradient above 40 mmHg marks severe stenosis.' },
];

head('a summary: every sentence cites a passage and says only what it says');
{
  const r = G.summary('Aortic stenosis narrows the aortic valve opening and obstructs outflow [1]. Valve replacement is indicated once symptoms appear [2]. ' +
    'A mean gradient above 50 mmHg marks severe stenosis [3]. Beta-blockers should be started for aortic stenosis [1]. It is common in older people. ' +
    'Severe stenosis is marked by a mean gradient above 40 mmHg [7].', P);
  ok('faithful sentences are kept, their citations listed and taken out of the text', JSON.stringify(r.kept.map(k => [k.text, k.cites])) ===
     JSON.stringify([['Aortic stenosis narrows the aortic valve opening and obstructs outflow.', [1]], ['Valve replacement is indicated once symptoms appear.', [2]]]),
     JSON.stringify(r.kept));
  const why = t => (r.dropped.find(d => d.text.indexOf(t) === 0) || {}).why || '';
  ok('a changed number is dropped', /a number not in the book: 50/.test(why('A mean gradient above 50')), why('A mean gradient above 50'));
  ok('a drug the passage does not name is dropped', /names something the book passage does not: bb/.test(why('Beta-blockers')), why('Beta-blockers'));
  ok('a sentence citing nothing is dropped', why('It is common') === 'cites no passage');
  ok('a citation to a passage that was not given is dropped', why('Severe stenosis is marked') === 'cites a passage that was not given');
  const loose = G.summary('Outflow obstruction can make patients feel dizzy and tired when climbing stairs quickly [1].', P);
  ok(`a sentence mostly not the passage’s words is dropped (under ${Math.round(G.SUMMARY_SHARE * 100)}% shared)`, loose.kept.length === 0 && /too little/.test(loose.dropped[0].why),
     loose.dropped[0] && loose.dropped[0].why);
  ok('a number is matched as a number: "40" is not in "140"', G.claimError('The gradient is 40 mmHg.', ['A pressure of 140 mmHg.'], 0) === 'a number not in the book: 40');
  ok('two citations on one sentence are both honoured', G.summary('Valve replacement is indicated when stenosis is severe [2][3].', P).kept.length === 1 &&
     JSON.stringify(G.summary('Valve replacement is indicated when stenosis is severe [2][3].', P).kept[0].cites) === '[2,3]');
}

head('plain words, and analogies');
{
  const sec = P.map(p => p.text).join(' ');
  const r = G.plain('Think of the valve as a door that has become stiff and narrow. The heart must push harder to get blood through the aortic valve. ' +
    'Doctors give 5 mg of a drug daily. Exercise is good for everyone.', sec);
  ok('plain words about the section are kept, in words of their own', r.kept.length === 2 && /as a door/.test(r.kept[0]) && /push harder/.test(r.kept[1]), JSON.stringify(r.kept));
  ok('a sentence sharing no word with the section is not about it', r.dropped.some(d => /^Exercise/.test(d.text) && /nothing in it/.test(d.why)));
  ok('a number the section does not have is not', r.dropped.some(d => /Doctors give 5 mg/.test(d.text) && /number/.test(d.why)));
  ok('an analogy with no number and no new medical name passes', G.analogyError('Like a door that sticks, the valve lets less through.', sec) === '');
  ok('an analogy may not carry a number, even one the section has', /number/.test(G.analogyError('Like 40 people squeezing through one door.', sec)));
  ok('nor name a disease the section does not', /hcm/.test(G.analogyError('Like hypertrophic cardiomyopathy, the wall thickens.', sec)));
}

head('a question: its answer is in the book, and the book explains it');
{
  const S = [
    { text: 'The commonest cause of aortic stenosis in older adults is calcific degeneration of a trileaflet valve.', page: 101 },
    { text: 'In younger adults a bicuspid valve is the usual cause.', page: 101 },
    { text: 'Echocardiography confirms the diagnosis and grades severity.', page: 103 },
  ];
  const q = (options, answer, question = 'What is the commonest cause of aortic stenosis in older adults?') =>
    ({ question, quote: '', options, answer, explain: 'Because the model says so, as it always does.', page: 999 });
  const good = G.question(q(['Calcific degeneration', 'Rheumatic fever', 'Endocarditis', 'Radiation'], 0), S);
  ok('an answer supported by a sentence of the section is kept', !!good.q, good.why);
  ok('its explanation is that sentence, verbatim, with its page — not the model’s words', good.q && good.q.explain === S[0].text && good.q.page === 101 && good.q.by === 'ai');
  ok('an answer the section does not support is dropped', G.question(q(['Rheumatic fever', 'Calcific degeneration', 'Endocarditis', 'Radiation'], 0), S).why === 'the answer is not in the section');
  ok('a sentence that has the answer but not the question’s subject does not count', G.question(q(['Bicuspid valve', 'Radiation', 'Endocarditis', 'Syphilis'], 0,
     'Which test grades severity?'), S).why === 'the answer is not in the section');
  ok('a wrong option the same sentence supports makes the question ambiguous, and it is dropped', /also|same sentence/.test(G.question(q(['Calcific degeneration', 'Trileaflet valve', 'Endocarditis', 'Radiation'], 0), S).why),
     G.question(q(['Calcific degeneration', 'Trileaflet valve', 'Endocarditis', 'Radiation'], 0), S).why);
  ok('a malformed question is dropped by the schema rules first', /options, not 4/.test(G.question(q(['Calcific degeneration', 'Radiation'], 0), S).why));
  ok('a question stem with a number the section lacks is dropped', /number/.test(G.question(q(['Calcific degeneration', 'Rheumatic fever', 'Endocarditis', 'Radiation'], 0,
     'What is the commonest cause of aortic stenosis in adults over 65?'), S).why));
  ok('the model’s question is not changed, only its explanation', good.q.question === 'What is the commonest cause of aortic stenosis in older adults?' &&
     JSON.stringify(good.q.options) === '["Calcific degeneration","Rheumatic fever","Endocarditis","Radiation"]' && good.q.answer === 0);
}

head('sentences');
{
  ok('split at a full stop before a capital, not inside "e.g." or a decimal', JSON.stringify(G.sentencesOf('A dose of 2.5 mg, e.g. daily. Then stop. 3 days later, recheck.')) ===
     '["A dose of 2.5 mg, e.g. daily.","Then stop.","3 days later, recheck."]', JSON.stringify(G.sentencesOf('A dose of 2.5 mg, e.g. daily. Then stop. 3 days later, recheck.')));
  ok('numbers are read whole: 2.5 and 1,000', JSON.stringify(G.numbersIn('2.5 mg and 1,000 units')) === '["2.5","1000"]', JSON.stringify(G.numbersIn('2.5 mg and 1,000 units')));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
