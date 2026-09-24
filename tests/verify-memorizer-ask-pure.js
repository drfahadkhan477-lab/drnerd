#!/usr/bin/env node
/*
 * Ask your book: the built-in coach answers with the book's own sentences,
 * each with its page, and says so when the book has nothing.
 *
 *   node tests/verify-memorizer-ask-pure.js
 *
 * Pure Node, on a small corpus written here from general cardiology — no
 * page of anyone's book. What is proven:
 *
 *   · THE VOCABULARY FINDS WHAT IS NAMED, by any of its names ("NT-proBNP",
 *     "TAVI", "heart attack", a drug by its suffix), and an abbreviation only
 *     in capitals: "AS" is aortic stenosis, "as" is a word.
 *   · FIVE INDEXES: chapters → sections, and diseases, scenarios, tests and
 *     treatments → the sections that name them, most first.
 *   · EVERY LINE OF AN ANSWER IS A SENTENCE OF THE BOOK, word for word, with
 *     its own page.
 *   · THE RIGHT SECTION ANSWERS, including its sentences that do not repeat
 *     the disease's name; another chapter's use of the same word does not.
 *   · ARRANGED, NOT REWRITTEN, under headings chosen by each sentence's own
 *     words; and NOTHING FOUND is said as such.
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
const A = require(path.join(ROOT, 'memorizer', 'src', 'ask.js'));

/* A unit per chapter, a cluster per section, a segment per paragraph. */
const cluster = (title, page, paras) => ({ title, pageStart: page, pageEnd: page + paras.length - 1,
  text: paras.join(' '), segments: paras.map((t, i) => ({ text: t, page: page + i, heading: false })) });
const DOCS = [
  { id: 'c1', name: 'Valvular Heart Disease', bookName: 'Test Book', clusters: [
    cluster('Aortic stenosis', 100, [
      'Aortic stenosis is a narrowing of the aortic valve opening that obstructs left ventricular outflow.',
      'The commonest cause in older adults is calcific degeneration of a trileaflet valve.',
      'Exertional syncope, angina and dyspnea are the classic symptoms.',
      'Echocardiography confirms the diagnosis and grades severity by gradient and valve area.',
      'Valve replacement is indicated once symptoms appear, surgically or by TAVR.',
      'Without replacement, survival falls sharply after symptoms begin.',
    ]),
    cluster('Mitral regurgitation', 106, [
      'Mitral regurgitation is backward flow across the mitral valve during systole.',
      'Chronic volume overload dilates the left atrium and ventricle.',
      'Severe mitral regurgitation eventually causes heart failure.',
      'The enlarged atrium is prone to fibrillation.',
    ]),
  ] },
  { id: 'c2', name: 'Heart Failure', bookName: 'Test Book', clusters: [
    cluster('Diagnosis of heart failure', 200, [
      'Heart failure is a syndrome in which the heart cannot meet the needs of the body at normal filling pressures.',
      'Natriuretic peptides are raised in most patients with heart failure.',
      'A normal NT-proBNP makes heart failure unlikely in a breathless patient.',
    ]),
    cluster('Treatment of heart failure', 203, [
      'Beta-blockers such as bisoprolol and carvedilol reduce mortality in reduced ejection fraction.',
      'Empagliflozin and dapagliflozin reduce hospital admission for heart failure.',
      'Loop diuretics relieve congestion but do not change survival.',
    ]),
  ] },
];
const ALL = DOCS.flatMap(d => d.clusters.flatMap(c => c.segments.map(s => ({ text: s.text, page: s.page }))));

head('the vocabulary: every name of a thing, abbreviations in capitals only');
{
  const ids = t => A.entriesIn(t).map(e => e.kind + ':' + e.id).sort().join(' ');
  ok('a disease by its abbreviation, a test and a procedure by their synonyms', ids('Is TAVI better than surgery for AS? What does NT-proBNP add?') ===
     'disease:as test:bnp treatment:surgery treatment:valve-rx', ids('Is TAVI better than surgery for AS? What does NT-proBNP add?'));
  ok('"as" in lower case is a word, not aortic stenosis', ids('as we saw, this was mild') === '', ids('as we saw, this was mild'));
  ok('drugs by their suffix: -olol, -pril, -gliflozin', ids('metoprolol ramipril empagliflozin') === 'treatment:acei treatment:bb treatment:sglt2', ids('metoprolol ramipril empagliflozin'));
  ok('a lay name: "heart attack" is acute coronary syndrome', ids('what causes a heart attack') === 'disease:acs', ids('what causes a heart attack'));
  ok('a scenario: "fainting" is syncope', ids('fainting on exertion') === 'scenario:syncope', ids('fainting on exertion'));
}

const idx = A.build(DOCS);

head('five indexes');
{
  ok('chapters → sections, in book order', JSON.stringify(idx.chapters.map(c => [c.title, c.sections.map(i => idx.sections[i].title)])) ===
     JSON.stringify([['Valvular Heart Disease', ['Aortic stenosis', 'Mitral regurgitation']], ['Heart Failure', ['Diagnosis of heart failure', 'Treatment of heart failure']]]));
  const hf = idx.index.disease.find(e => e.id === 'hf');
  /* Mitral regurgitation names heart failure once and comes first in the
     book: most first puts it after the section that names it three times. */
  ok('a disease → the sections that name it, most first', hf && hf.sections.map(s => idx.sections[s.sec].title + ':' + s.count).join() ===
     'Diagnosis of heart failure:3,Mitral regurgitation:1,Treatment of heart failure:1', hf && hf.sections.map(s => idx.sections[s.sec].title + ':' + s.count).join());
  ok('a scenario, a test and a treatment are indexed the same way', ['scenario:syncope', 'test:echo', 'treatment:bb'].every(k => {
    const [kind, id] = k.split(':'); const e = idx.index[kind].find(x => x.id === id); return e && e.sections.length === 1; }));
  ok('a term the book never uses indexes nothing', !idx.index.disease.some(e => e.id === 'myocarditis'));
  ok('every index names its kind', JSON.stringify(Object.keys(idx.index).sort()) === '["disease","scenario","test","treatment"]');
}

head('answers: the book’s own sentences, from the right section');
{
  const r = A.ask(idx, 'How is aortic stenosis treated?');
  const items = r.groups.flatMap(g => g.items);
  ok('found, and every line is a sentence of the book, word for word, with its page', r.found && items.length > 0 &&
     items.every(it => ALL.some(s => s.text === it.text && s.page === it.page)), items.map(i => i.page).join());
  ok('the treatment sentence, which never repeats "aortic stenosis", is found by its section', items.some(it => /^Valve replacement is indicated/.test(it.text)));
  const best = items.slice().sort((a, b) => b.score - a.score)[0];
  ok('asked how it is treated, the treatment sentence ranks first', /^Valve replacement is indicated/.test(best.text), best.text.slice(0, 50));
  ok('another chapter’s treatments are not an answer about aortic stenosis', !items.some(it => /Beta-blockers|Empagliflozin|diuretics/.test(it.text)),
     items.map(i => i.text.slice(0, 30)).join(' | '));
  ok('where to read more: the aortic stenosis section first', idx.sections[r.sections[0]].title === 'Aortic stenosis');
  const hfr = A.ask(idx, 'heart failure');
  ok('and for heart failure, its own section before the earlier one that mentions it', idx.sections[hfr.sections[0]].title === 'Diagnosis of heart failure',
     hfr.sections.map(i => idx.sections[i].title).join(' | '));
  const few = A.ask(idx, 'calcific trileaflet hospital').groups.flatMap(g => g.items).map(i => i.text);
  const two = A.ask(idx, 'what dilates the atrium').groups.flatMap(g => g.items).map(i => i.text);
  ok('a question of two words needs both: "dilates" and "atrium", not either', JSON.stringify(two) === '["Chronic volume overload dilates the left atrium and ventricle."]', JSON.stringify(two));
  ok('"reduces" in a question meets "reduce" in the book', A.terms('reduces')[0] === A.terms('reduce')[0] && A.terms('reduced')[0] === A.terms('reduce')[0]);
  ok('one word in common of three is not an answer; two is', few.length === 1 && /^The commonest cause/.test(few[0]), JSON.stringify(few));
  ok('and the question’s named things are reported', JSON.stringify(r.named) === '["Aortic stenosis"]', JSON.stringify(r.named));
  const bnp = A.ask(idx, 'What does NT-proBNP tell you?');
  ok('a synonym finds its sentences: NT-proBNP → "natriuretic peptides"', bnp.groups.flatMap(g => g.items).some(it => /^Natriuretic peptides are raised/.test(it.text)));
  const none = A.ask(idx, 'tax law for accountants');
  ok('nothing in the book: not found, and no lines', none.found === false && none.groups.length === 0 && none.sections.length === 0);
  ok('a question of nothing but little words is not an answer to everything', A.ask(idx, 'what is the').found === false);
}

head('what kind of answer is wanted');
{
  ok('"how is it treated" wants treatment; "what causes it" causes; "how is it diagnosed" diagnosis', JSON.stringify(A.intentsOf('How is aortic stenosis treated?')) === '["Treatment"]' &&
     JSON.stringify(A.intentsOf('What causes aortic stenosis?')) === '["Causes and risk factors"]' && JSON.stringify(A.intentsOf('How is heart failure diagnosed?')) === '["Diagnosis"]');
  const c = A.ask(idx, 'What causes aortic stenosis?').groups.flatMap(g => g.items);
  ok('asked what causes it, the cause ranks first', /^The commonest cause/.test(c.slice().sort((a, b) => b.score - a.score)[0].text));
  const sym = A.ask(idx, 'what are the symptoms');
  ok('a question with an intent and nothing named answers from what fits it', sym.found && sym.groups.flatMap(g => g.items).every(it => it.heading === 'Presentation'),
     sym.groups.map(g => g.heading).join());
}

head('merged with search by meaning');
{
  const syn = idx.sents.findIndex(s => /^Exertional syncope/.test(s.text));
  const q = 'why do people pass out';
  ok('a question sharing no word with the book finds nothing by words', A.ask(idx, q).found === false);
  const m = A.ask(idx, q, [{ i: syn, cos: 0.6 }]);
  const it = m.groups.flatMap(g => g.items);
  ok('found by meaning, it is the book\u2019s sentence with its page, marked as found by meaning', m.found && it.length === 1 && it[0].text === idx.sents[syn].text &&
     it[0].page === idx.sents[syn].page && it[0].by === 'meaning', JSON.stringify(it));
  const plain = A.ask(idx, 'How is aortic stenosis treated?');
  ok('with nothing found by meaning, the answer is exactly the word search\u2019s', JSON.stringify(A.ask(idx, 'How is aortic stenosis treated?', [])) === JSON.stringify(plain));
  const valve = idx.sents.findIndex(s => /^Valve replacement/.test(s.text));
  const both = A.ask(idx, 'How is aortic stenosis treated?', [{ i: syn, cos: 0.62 }, { i: valve, cos: 0.6 }]).groups.flatMap(g => g.items);
  ok('a sentence found both ways ranks first, and one found by meaning alone joins the answer', both.slice().sort((a, b) => b.score - a.score)[0].text === idx.sents[valve].text &&
     both.some(x => x.text === idx.sents[syn].text && x.by === 'meaning') && both.filter(x => x.by === 'words').length === plain.groups.flatMap(g => g.items).length,
     JSON.stringify(both.map(x => [x.text.slice(0, 20), x.by, x.score])));
}

head('arranged under headings, not rewritten');
{
  const h = t => A.headingOf(t);
  ok('a sentence that opens with its term and "is a" is a definition', h('Aortic stenosis is a narrowing of the aortic valve opening that obstructs left ventricular outflow.') === 'Definition');
  ok('"This is a …" is not', h('This is a common cause of syncope.') !== 'Definition', h('This is a common cause of syncope.'));
  ok('"X is defined by …" is', h('Severe stenosis is defined by a mean gradient of at least 40 mmHg.') === 'Definition');
  ok('causes, presentation, diagnosis and complications by their words', h('The commonest cause in older adults is calcific degeneration of a trileaflet valve.') === 'Causes and risk factors' &&
     h('Exertional syncope, angina and dyspnea are the classic symptoms.') === 'Presentation' &&
     h('Echocardiography confirms the diagnosis and grades severity by gradient and valve area.') === 'Diagnosis' &&
     h('Without replacement, survival falls sharply after symptoms begin.') !== 'Definition');
  /* Each cue is a stem: "diagnos" must reach "diagnosis", "complication"
     "complications". The first version ended every stem at a word boundary,
     and neither word could ever be filed by its own cue. */
  ok('a stem reaches its whole word: "diagnosis", "complications"', h('Delay in diagnosis is common in older adults.') === 'Diagnosis' &&
     h('Complications include embolism and arrhythmia.') === 'Complications and prognosis',
     h('Delay in diagnosis is common in older adults.') + ' / ' + h('Complications include embolism and arrhythmia.'));
  ok('a sentence naming a treatment is filed under Treatment, even with a mechanism’s verb', h('Beta-blockers such as bisoprolol and carvedilol reduce mortality in reduced ejection fraction.') === 'Treatment' &&
     h('Chronic volume overload dilates the left atrium and ventricle.') !== 'Treatment');
  const all = A.ask(idx, 'aortic stenosis');
  const order = all.groups.map(g => g.heading);
  ok('groups come in teaching order, the first found heading first', order[0] === 'Definition' &&
     order.every((x, i) => i === 0 || A.HEADINGS.map(y => y[0]).concat([A.OTHER]).indexOf(x) > A.HEADINGS.map(y => y[0]).concat([A.OTHER]).indexOf(order[i - 1])), order.join(' > '));
  const perSec = {};
  all.groups.flatMap(g => g.items).forEach(it => { perSec[it.sec] = (perSec[it.sec] || 0) + 1; });
  /* A literal 3, not A.PER_SECTION: sized by the constant, this check rose
     with it when the cap was mutated to 99, and passed. */
  ok('at most 3 lines from one section, so an answer is not one section retyped', Object.values(perSec).every(n => n <= 3), JSON.stringify(perSec));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
