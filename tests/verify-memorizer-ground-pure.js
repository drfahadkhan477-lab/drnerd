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

head('the study pack as notes for the on-device model');
{
  const sec = { lesson: {
    overview: 'Diuretics reduce preload by lowering circulating volume.', mechanism: 'Excessive preload raises venous pressure, which leads to oedema of the lungs.',
    flags: { mechanism: 'a number not in your book: 1' },
    points: [{ text: 'Volume overload is sought when LVEDP is greater than 18 mmHg', page: 1 }, { text: 'Venous pressure above 99 mmHg causes oedema', page: 1, flag: 'a number not in your book: 99' }],
    pearls: [{ text: 'A normal LVEDP is 8 to 12 mmHg.', page: 1 }],
    distinctions: [{ a: 'Volume overload', b: 'a stiff ventricle', how: 'a normal pressure does not exclude a stiff ventricle', page: 1 }] } };
  const ctx = G.packContext(sec);
  ok('the notes are what passed the book check — the overview, the points, the pearls, the pairs', /Diuretics reduce preload/.test(ctx) && /greater than 18 mmHg/.test(ctx) &&
     /normal LVEDP is 8 to 12/.test(ctx) && /Volume overload vs a stiff ventricle/.test(ctx), ctx);
  ok('and nothing flagged: not the point with a number the book lacks, not a flagged mechanism', !/99/.test(ctx) && !/Excessive preload/.test(ctx), ctx);
  ok('cut to its word budget, whole lines only', G.packContext(sec, 12).split('\n').length === 1 && G.packContext(sec, 12).split(/\s+/).length <= 13, G.packContext(sec, 12));
  ok('no pack, no notes', G.packContext(null) === '');
}

head('a pack question asked in new words: only the stem is the model’s');
{
  const Q = { question: 'Which LVEDP should prompt a search for volume overload?', quote: '', options: ['8 mmHg', '12 mmHg', 'Greater than 18 mmHg', '4 mmHg'], answer: 2,
    explain: 'An LVEDP greater than 18 mmHg should prompt a search for volume overload.', page: 1,
    why: ['8 is inside the normal range.', '12 is the top of normal.', '', '4 is below normal.'], trap: 'the normal range taken for the threshold', by: 'pack' };
  const SRC = ['A normal LVEDP is 8 to 12 mmHg. An LVEDP greater than 18 mmHg should prompt a search for volume overload. Diuretics reduce preload.'];
  const good = G.variant(Q, 'A breathless patient has an LVEDP measured. At what LVEDP should you search for volume overload?', SRC);
  ok('a new wording of the same question is kept', !!good.q, good.why);
  const v = good.q || { options: [], why: [], map: [] };
  ok('its answer is the same option, moved: every option has a new place', v.options[v.answer] === 'Greater than 18 mmHg' && v.answer !== Q.answer &&
     v.options.every((o, i) => o !== Q.options[i]), JSON.stringify(v.options));
  ok('each option keeps its own reason, and the map leads back to the original', v.options.every((o, i) => v.why[i] === Q.why[Q.options.indexOf(o)] && Q.options[v.map[i]] === o), JSON.stringify(v.why));
  ok('the explanation, page and trap stay the pack’s; the quote goes; it says it was reworded', v.explain === Q.explain && v.page === 1 && v.trap === Q.trap && v.quote === '' && v.reworded === true && v.by === 'pack');
  ok('the same wording is laid out the same way every time', JSON.stringify(G.variant(Q, 'A breathless patient has an LVEDP measured. At what LVEDP should you search for volume overload?', SRC).q.options) === JSON.stringify(v.options));
  const why = stem => G.variant(Q, stem, SRC).why;
  ok('a number neither the notes nor the book have is dropped', /a number not in the book: 25/.test(why('After 25 minutes of breathlessness, which LVEDP should prompt a search for volume overload?')),
     why('After 25 minutes of breathlessness, which LVEDP should prompt a search for volume overload?'));
  ok('a drug the book never names is dropped', /names something/.test(why('On digoxin, which LVEDP should prompt a search for volume overload?')), why('On digoxin, which LVEDP should prompt a search for volume overload?'));
  ok('a question that asks something else is dropped', /no longer asks the same thing/.test(why('What do diuretics reduce in a breathless patient?')), why('What do diuretics reduce in a breathless patient?'));
  ok('a "not" the original lacks is dropped — it turns the question inside out', /added a "not"/.test(why('Which LVEDP should not prompt a search for volume overload?')));
  const NQ = Object.assign({}, Q, { question: 'Which LVEDP should NOT prompt a search for volume overload?', options: ['Greater than 18 mmHg', '8 mmHg', '12 mmHg', '4 mmHg'], answer: 1 });
  ok('and a "not" the original has must stay', /dropped the original’s "not"/.test(G.variant(NQ, 'At which LVEDP should you search for volume overload?', SRC).why));
  ok('a stem that gives the answer away is dropped', why('Is an LVEDP greater than 18 mmHg the one that should prompt a search for volume overload?') === 'it gives the answer away');
  ok('by its number alone', why('Past 18, which LVEDP reading should prompt a search for volume overload?') === 'it gives the answer away',
     why('Past 18, which LVEDP reading should prompt a search for volume overload?'));
  const Q2 = { question: 'What do diuretics reduce?', options: ['Afterload', 'Preload', 'Contractility', 'Heart rate'], answer: 1, explain: 'Diuretics reduce preload by lowering circulating volume.', why: [], trap: '' };
  ok('or by its words alone', G.variant(Q2, 'By lowering circulating volume, diuretics reduce which load, the preload?', SRC).why === 'it gives the answer away' &&
     !!G.variant(Q2, 'By lowering circulating volume, what do diuretics reduce?', SRC).q, G.variant(Q2, 'By lowering circulating volume, diuretics reduce which load, the preload?', SRC).why);
  ok('and so is the original again', why('Which LVEDP should prompt a search for volume overload?') === 'the same words as the original');
}

head('a mistake explained in the model’s words, from the pack’s reasons');
{
  const Q = { question: 'Which LVEDP should prompt a search for volume overload?', options: ['8 mmHg', '12 mmHg', 'Greater than 18 mmHg', '4 mmHg'], answer: 2,
    explain: 'An LVEDP greater than 18 mmHg should prompt a search for volume overload.', why: ['8 mmHg is inside the normal range of 8 to 12.', '', '', ''], trap: 'the normal range taken for the threshold' };
  const r = G.missExplain('You picked 8 mmHg, but that is still a normal pressure. Only an LVEDP greater than 18 mmHg should make you look for volume overload. ' +
    'Give 40 mg of furosemide. 8 mmHg is the correct answer here.', Q, 0, ['Diuretics reduce preload.']);
  ok('its sentences that say what the pack says, in its own words, are kept', r.kept.length === 2 && /still a normal pressure/.test(r.kept[0]) && /greater than 18 mmHg/.test(r.kept[1]), JSON.stringify(r.kept));
  const w = t => (r.dropped.find(d => d.text.indexOf(t) === 0) || {}).why || '';
  ok('a dose it made up is dropped', /a number not in the book: 40/.test(w('Give 40 mg')), w('Give 40 mg'));
  ok('a sentence that calls the option chosen right is dropped', w('8 mmHg is the correct') === 'it calls the option chosen right', w('8 mmHg is the correct'));
  ok('and "8 mmHg is not the correct answer" is not taken for one', G.missExplain('8 mmHg is not the correct answer. The answer is greater than 18 mmHg.', Q, 0, []).kept.length === 2);
  const none = G.missExplain('The normal range is the trap in this question.', Q, 0, []);
  ok('what never says what the answer is, is not shown at all', none.kept.length === 0 && none.why === 'it never says what the answer is', JSON.stringify(none));
  ok('"not sure" is explained too: the answer, with no option to set right', G.missExplain('An LVEDP greater than 18 mmHg should prompt a search for volume overload.', Q, -1, []).kept.length === 1);
}

head('the prompts for them: the notes in, words only out');
{
  const L = require(path.join(ROOT, 'memorizer', 'src', 'llm.js'));
  const Q = { question: 'Which LVEDP should prompt a search?', options: ['8 mmHg', '12 mmHg', 'Greater than 18 mmHg', '4 mmHg'], answer: 2, explain: 'Greater than 18 mmHg.', why: ['Normal.', '', '', ''], trap: 'the normal range' };
  const vp = L.variantPrompt(Q, '- NOTE ONE'), mp = L.missPrompt(Q, 0, '- NOTE ONE');
  ok('both carry the pack’s notes and the question', /NOTE ONE/.test(vp) && /NOTE ONE/.test(mp) && /Which LVEDP should prompt a search\?/.test(vp) && /Which LVEDP/.test(mp));
  ok('the explanation is asked with the answer, the choice, its reason and the trap', /The student chose: 8 mmHg/.test(mp) && /The answer is: Greater than 18 mmHg/.test(mp) &&
     /Why their choice is wrong: Normal\./.test(mp) && /The trap: the normal range/.test(mp));
  ok('the rewording is asked as JSON, and read back from a reply that wraps it', L.parseVariant('Sure! {"question": "At what LVEDP?"} Hope it helps') === 'At what LVEDP?' &&
     L.parseVariant('no json') === '' && L.VARIANT_SCHEMA.required[0] === 'question');
}

head('a Socratic follow-up from the pack’s notes');
{
  const notes = '- Diuretics reduce preload by lowering circulating volume.\n- Excessive preload raises venous pressure, which leads to oedema of the lungs.\n- A normal LVEDP is 8 to 12 mmHg.';
  const book = ['Diuretics reduce preload by lowering circulating volume. A normal LVEDP is 8 to 12 mmHg.'];
  const good = G.followUp('Why does too much preload end in oedema of the lungs?', 'Excessive preload raises venous pressure, which leads to oedema of the lungs.', notes, book, []);
  ok('a why-question the notes answer, with its answer in the notes’ words, is asked', !!good.q && good.q.answer === 'Excessive preload raises venous pressure, which leads to oedema of the lungs.', good.why);
  const why = (q, a, asked) => G.followUp(q, a, notes, book, asked || []).why;
  ok('an answer with a number the notes lack is dropped', why('What is a raised LVEDP?', 'A raised LVEDP is above 25 mmHg.') === 'the answer a number not in the notes: 25', why('What is a raised LVEDP?', 'A raised LVEDP is above 25 mmHg.'));
  ok('even one the book has: the answer is shown as the notes’', G.followUp('What is a raised LVEDP?', 'A raised LVEDP is above 15 mmHg.', notes, ['A normal LVEDP is 8 to 12 mmHg; a raised LVEDP is above 15 mmHg.'], []).why ===
     'the answer a number not in the notes: 15');
  ok('an answer mostly not the notes’ words is dropped', /the answer too little/.test(why('Why do diuretics help?', 'Diuretics make patients feel much better when walking upstairs.')),
     why('Why do diuretics help?', 'Diuretics make patients feel much better when walking upstairs.'));
  ok('a question naming a drug the notes and book lack is dropped', /the question names something/.test(why('Why is digoxin given with diuretics?', 'Diuretics reduce preload by lowering circulating volume.')));
  ok('a statement is not a question', why('Tell me about preload.', 'Diuretics reduce preload by lowering circulating volume.') === 'it is not a question');
  ok('a question that holds its own answer is dropped', why('Do diuretics reduce preload by lowering circulating volume?', 'Diuretics reduce preload by lowering circulating volume.') === 'the question holds its own answer');
  ok('and one already asked is not asked again', why('Why does too much preload end in oedema of the lungs?', 'Excessive preload raises venous pressure, which leads to oedema of the lungs.',
     ['why does too much preload end in oedema of the lungs']) === 'it was asked already');
  const L = require(path.join(ROOT, 'memorizer', 'src', 'llm.js'));
  const fp = L.followUpPrompt('- NOTE ONE', ['Why A?']);
  ok('its prompt carries the notes and what was asked already, and its reply is read back', /NOTE ONE/.test(fp) && /Already asked:\n- Why A\?/.test(fp) &&
     JSON.stringify(L.parseFollowUp('ok {"question": "Why?", "answer": "Because."}')) === '{"question":"Why?","answer":"Because."}' && L.parseFollowUp('nope').question === '');
  const tp = L.teachPrompt(['Point one', 'Point two'], ' Said  it. ');
  ok('the marking prompt numbers the points and quotes the explanation, and asks for the student’s own words', /1\. Point one\n2\. Point two/.test(tp) && /"Said it\."/.test(tp) && /copy the student’s own words/.test(tp) &&
     JSON.stringify(L.TEACH_SCHEMA.properties.points.items.properties.verdict.enum) === '["covered","wrong","missed"]');
}

head('sentences');
{
  ok('split at a full stop before a capital, not inside "e.g." or a decimal', JSON.stringify(G.sentencesOf('A dose of 2.5 mg, e.g. daily. Then stop. 3 days later, recheck.')) ===
     '["A dose of 2.5 mg, e.g. daily.","Then stop.","3 days later, recheck."]', JSON.stringify(G.sentencesOf('A dose of 2.5 mg, e.g. daily. Then stop. 3 days later, recheck.')));
  ok('numbers are read whole: 2.5 and 1,000', JSON.stringify(G.numbersIn('2.5 mg and 1,000 units')) === '["2.5","1000"]', JSON.stringify(G.numbersIn('2.5 mg and 1,000 units')));
}

head('contradictions and source-proof grading');
{
  const source = [{ text: 'Diuretics reduce preload by lowering circulating volume.', page: 1 }];
  ok('negating a source sentence is refused', G.summary('Diuretics do not reduce preload by lowering circulating volume. [1]', source).kept.length === 0);
  ok('reversing the threshold or changing its unit is refused', !!G.claimError('A gradient below 40 mmHg marks severity.', ['A gradient above 40 mmHg marks severity.'], 0) && !!G.claimError('A gradient above 40 mg marks severity.', ['A gradient above 40 mmHg marks severity.'], 0));
  const q = { question: 'What do diuretics reduce?', quote: '', options: ['Preload', 'Afterload', 'Heart rate', 'Contractility'], answer: 0, page: 1, explain: 'The model says so.' };
  const good = G.gradeQuestion(q, source).q;
  ok('a graded model answer has a mechanically verifiable source completion', good && good.sourceCompletion && good.quote === 'Diuretics reduce _____ by lowering circulating volume.' && good.explain === source[0].text);
  ok('invented pages and unsupported answers are not graded', !G.gradeQuestion({ ...q, page: 999 }, source).q && !G.gradeQuestion({ ...q, answer: 1 }, source).q);
  ok('another valid completion is ambiguous and refused', !G.gradeQuestion(q, source.concat({ text: 'Diuretics reduce afterload by lowering circulating volume.', page: 1 })).q);
}
{
  const c = { text: 'Diuretics reduce preload.', segments: [{ text: 'Diuretics reduce preload.', page: 1 }] };
  const fallback = { overview: c.text, points: [{ text: c.text, page: 1 }], numbers: [], mnemonics: [], analogies: [], flowchart: '' };
  const proposal = { ...fallback, points: [{ text: 'Diuretics increase preload.', page: 1 }] };
  ok('unsupported generated lesson facts are replaced with source facts', G.sourceLesson(proposal, c, fallback).points[0].text === c.text);
  let refused = false; try { G.sourceLesson({ ...proposal, points: [{ text: c.text, page: 999 }] }, c, fallback); } catch (_) { refused = true; }
  ok('a remote lesson cannot cite an invented page', refused);
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
