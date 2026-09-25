#!/usr/bin/env node
/*
 * A unit's pack, written with Claude in the owner's own chat: the prompt
 * carries the chapter and asks for the right shape, and what comes back is
 * held to the book before any of it is used.
 *
 *   node tests/verify-memorizer-pack-pure.js
 *
 * Pure Node. The "Claude replies" here are written by hand, each wrong in
 * one way a chat's reply is wrong: a number the book does not have, a page
 * outside the section, a condition the chapter never names, a quoted
 * sentence that is not the book's, a section from another chapter, a
 * question with three options, an analogy carrying a fact, an item Claude
 * itself marked NOT_IN_PDF.
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
const P = require(path.join(ROOT, 'memorizer', 'src', 'pack.js'));
const Prompts = require(path.join(ROOT, 'memorizer', 'src', 'prompts.js'));
const clone = v => JSON.parse(JSON.stringify(v));

const DOC = {
  id: 'd1', name: 'Aortic stenosis',
  clusters: [
    { title: 'Definition and grading', pageStart: 10, pageEnd: 10, segments: [
      { text: 'Aortic stenosis is a narrowing of the aortic valve opening that obstructs left ventricular outflow.', page: 10 },
      { text: 'A mean gradient above 40 mmHg marks severe stenosis.', page: 10 },
    ] },
    { title: 'Treatment', pageStart: 11, pageEnd: 12, segments: [
      { text: 'Valve replacement is indicated once symptoms appear, surgically or by TAVR.', page: 11 },
      { text: 'Syncope and angina on exertion are the classic symptoms.', page: 11 },
      { table: [['Peak velocity', '4 m/s']], tableHeader: ['Measure', 'Severe'], page: 12 },
    ] },
    { title: 'Mitral regurgitation', pageStart: 13, pageEnd: 13, segments: [
      { text: 'Mitral regurgitation causes a holosystolic murmur at the apex, and 25 percent progress within 5 years.', page: 13 },
    ] },
    /* begins part-way down p. 13, where the section before it ends */
    { title: 'Follow-up', pageStart: 13, pageEnd: 14, segments: [
      { text: 'Patients are seen again every year.', page: 14 },
    ] },
  ],
};

/* A section as an honest reply writes it: every number, page, name and
   quote in the book. */
function honest() {
  return {
    section: 1, title: 'Definition and grading',
    lesson: {
      overview: 'Aortic stenosis narrows the aortic valve opening and obstructs outflow.',
      mechanism: 'A narrowed valve obstructs left ventricular outflow.',
      points: [{ text: 'Aortic stenosis — a narrowing of the aortic valve opening', page: 10 },
               { text: 'Severe stenosis — a mean gradient above 40 mmHg (p. 10)', page: 10 }],
      numbers: [{ text: 'Severe: mean gradient above 40 mmHg', page: 10 }],
      distinctions: [{ a: 'Aortic stenosis', b: 'mitral regurgitation', how: 'Stenosis obstructs outflow; the other leaks.', page: 10 }],
      pearls: [{ text: 'A mean gradient above 40 mmHg marks severe stenosis.', page: 10 }],
      mnemonics: [{ title: 'Grading', letters: 'MG', words: ['Mean', 'Gradient'] }],
      analogies: [{ title: 'A narrow door', text: 'Like a crowd pushing through a door that is half shut.', source: 'Claude' }],
      flowchart: 'flowchart TD\n  A["narrow valve"] --> B["obstructs outflow"]',
    },
    quiz: { questions: [{
      question: 'Which mean gradient marks severe aortic stenosis?',
      quote: 'A mean gradient above _____ marks severe stenosis.',
      options: ['20 mmHg', '40 mmHg', '60 mmHg', '80 mmHg'], answer: 1,
      explain: 'A mean gradient above 40 mmHg marks severe stenosis.', page: 10,
      why: ['Too low.', '', 'Higher than the threshold.', 'Far higher than the threshold.'], trap: 'threshold values',
    }] },
  };
}
const pack = (...sections) => ({ format: P.FORMAT, version: P.VERSION, unit: 'Aortic stenosis', sections });
const run = (...sections) => P.check([pack(...sections)], DOC);
const withLesson = (f) => { const s = honest(); f(s.lesson, s); return s; };
const withQ = (f) => { const s = honest(); f(s.quiz.questions[0], s); return s; };

head('the prompt carries the chapter and asks for the shape the importer reads');
{
  const pr = P.prompt(DOC);
  ok('every section is listed by number, with its title and pages',
     /1\. "Definition and grading" — p\. 10/.test(pr) && /2\. "Treatment" — pp\. 11–12/.test(pr) && /3\. "Mitral regurgitation" — p\. 13/.test(pr));
  ok('and its text goes with it, page-marked, as the API path sends it',
     pr.indexOf(Prompts.excerpt(DOC.clusters[1])) !== -1 && pr.indexOf('[p.13] Mitral regurgitation causes') !== -1);
  ok('a table goes as its rows', pr.indexOf('| Peak velocity | 4 m/s |') !== -1);
  ok('the book-only rule and its escape hatch are in it', /Work ONLY from the chapter text/.test(pr) && pr.indexOf(Prompts.NOT_IN_PDF) !== -1);
  ok('so are the question and analogy fences prompts.js holds every prompt to',
     pr.indexOf(Prompts.MCQ_RULE) !== -1 && pr.indexOf(Prompts.ANALOGY_RULE) !== -1);
  ok('and what it asks for beyond a lesson: why each option is wrong, the trap, the pairs confused',
     /"why": 4 strings, one per\s+option/.test(pr) && /"trap"/.test(pr) && /lesson\.distinctions/.test(pr));
  const ex = pr.slice(pr.indexOf('where each section is like this one:\n') + 37, pr.indexOf('\n\nREPLIES'));
  let parsed = null;
  try { parsed = JSON.parse(ex); } catch (_) {}
  ok('the example in the prompt is the importer’s own example', JSON.stringify(parsed) === JSON.stringify(P.EXAMPLE));
  ok('and that example is a lesson the importer accepts', Prompts.check(P.LESSON, P.EXAMPLE.lesson) === '', Prompts.check(P.LESSON, P.EXAMPLE.lesson));
  const q = P.EXAMPLE.quiz.questions[0];
  ok('and a question it accepts', Prompts.check(P.QUESTION, q) === '' && Prompts.mcqError(q, 'q') === '' && q.why.length === q.options.length);
  const bad = clone(P.EXAMPLE.lesson); delete bad.points;
  ok('(the schema refuses a lesson without points, so the check above measures something)', /points is missing/.test(Prompts.check(P.LESSON, bad)));
  const book = Object.assign({}, DOC, { bookName: 'Braunwald', chapter: 7 });
  ok('a book’s chapter is named with its book and number', P.unitName(book) === 'Braunwald · chapter 7 · Aortic stenosis' && P.prompt(book).indexOf('"unit": "Braunwald · chapter 7 · Aortic stenosis"') !== -1);
}

head('a long chapter is asked for in replies that are not cut off');
{
  ok('nine sections, four to a reply', JSON.stringify(P.replies(9)) === JSON.stringify([[1, 4], [5, 8], [9, 9]]));
  ok('four sections, one reply', JSON.stringify(P.replies(4)) === JSON.stringify([[1, 4]]));
  const nine = { id: 'd9', name: 'Long', clusters: Array.from({ length: 9 }, (_, i) => ({ title: 'S' + i, pageStart: i + 1, pageEnd: i + 1, segments: [{ text: 'Text ' + i + '.', page: i + 1 }] })) };
  const pr = P.prompt(nine);
  ok('and the prompt says which sections go in which reply', /reply 1: sections 1–4\n  reply 2: sections 5–8\n  reply 3: section 9\n/.test(pr));
  ok('one reply is asked for as one', /Write them in one reply:/.test(P.prompt(DOC)) && !/reply 2/.test(P.prompt(DOC)));
}

head('a reply is read however it was pasted');
{
  const one = JSON.stringify(pack(honest()));
  const r = P.parse('Here is reply 1.\n```json\n' + one + '\n```\nSay "next" for more.');
  ok('a pack in a code fence, with a sentence either side', r.ok && r.packs.length === 1 && r.packs[0].sections[0].title === 'Definition and grading', r.error);
  const two = P.parse(one + '\n\nand then\n\n' + JSON.stringify(pack(Object.assign(honest(), { section: 2, title: 'Treatment' }))));
  ok('two replies pasted at once are two packs', two.ok && two.packs.length === 2);
  ok('other JSON in the text is not taken for a pack', P.parse('{"a": 1} ' + one).packs.length === 1);
  const none = P.parse('Sorry, I cannot help with that.');
  ok('no pack at all is said, not imported as nothing', !none.ok && /no Memorizer pack/.test(none.error));
  const broken = P.parse('{"format": "' + P.FORMAT + '", "sections": [,]}');
  ok('a pack whose JSON is broken is said as that', !broken.ok && /could not be read/.test(broken.error), broken.error);
  const later = P.parse(JSON.stringify(Object.assign(pack(honest()), { version: P.VERSION + 1 })));
  ok('a pack from a later Memorizer is refused, by version', !later.ok && /version/.test(later.error));
  const nosec = P.parse(JSON.stringify({ format: P.FORMAT, version: 1, unit: 'x' }));
  ok('a pack with no sections is refused', !nosec.ok && /no list of sections/.test(nosec.error));
}

head('an honest reply goes in as written, labelled as Claude’s');
{
  const c = run(honest());
  const s = c.sections[0];
  ok('the section is imported, nothing flagged, refused or dropped', c.sections.length === 1 && !c.refused.length && !c.dropped.length && s.flags.length === 0,
     JSON.stringify([c.refused, c.dropped, s && s.flags]));
  ok('as the unit’s section, by its index', s.index === 0 && s.title === 'Definition and grading');
  ok('the lesson and every question are marked as the pack’s', s.lesson.by === 'pack' && s.quiz.questions.every(q => q.by === 'pack'));
  ok('with what a pack adds kept: the mechanism, the pair confused, why each option is wrong, the trap',
     s.lesson.mechanism && s.lesson.distinctions.length === 1 && s.quiz.questions[0].why.length === 4 && s.quiz.questions[0].trap === 'threshold values');
  ok('and a lesson the session will take (it needs points)', s.lesson.points.length === 2);
  ok('the reply itself is not changed by the check', JSON.stringify(honest()) === JSON.stringify(pack(honest()).sections[0]));
}

head('what is not in the book is flagged where it is shown');
{
  let s = run(withLesson(L => { L.points[1].text = 'Severe stenosis — a mean gradient above 50 mmHg'; })).sections[0];
  ok('a number the section does not have', s.lesson.points[1].flag === 'a number not in your book: 50' && s.flags.length === 1 && s.flags[0].where === 'point 2', JSON.stringify(s.flags));
  s = run(withLesson(L => { L.numbers[0] = { text: 'Severe: peak velocity 4 m/s', page: 12 }; })).sections[0];
  ok('a number on the page it cites, in another section, is the book’s — but the page is not this section’s',
     s.lesson.numbers[0].flag === 'p. 12 is not in this section (p. 10)', s.lesson.numbers[0].flag);
  const t = { section: 2, title: 'Treatment', lesson: { points: [{ text: 'Severe \u2014 a peak velocity of 4 m/s', page: 12 }] } };
  s = run(t).sections[0];
  ok('a number in a table is the book\u2019s', s && !s.lesson.points[0].flag, s && s.lesson.points[0].flag);
  const f = { section: 4, title: 'Follow-up', lesson: { points: [{ text: 'Progression \u2014 25 percent within 5 years', page: 13 }] } };
  s = run(f).sections[0];
  ok('a number on the page it cites, where the section before ends, is the book\u2019s', s && !s.lesson.points[0].flag, s && s.lesson.points[0].flag);
  f.lesson.points[0].page = 14;
  s = run(f).sections[0];
  ok('(the same number, citing the section\u2019s other page, is not)', s && s.lesson.points[0].flag === 'a number not in your book: 25', s && s.lesson.points[0].flag);
  s = run(withLesson(L => { L.points[0].page = 13; })).sections[0];
  ok('a page outside the section', s.lesson.points[0].flag === 'p. 13 is not in this section (p. 10)', s.lesson.points[0].flag);
  s = run(withLesson(L => { L.pearls[0].text = 'Beta-blockers relieve atrial fibrillation in aortic stenosis.'; })).sections[0];
  ok('a condition the chapter never names', s.lesson.pearls[0].flag === 'names what your chapter does not: Atrial fibrillation', s.lesson.pearls[0].flag);
  s = run(withLesson(L => { L.distinctions[0].how = 'Mitral regurgitation gives a holosystolic murmur; stenosis does not.'; })).sections[0];
  ok('a condition named elsewhere in the chapter is the chapter’s', !s.lesson.distinctions[0].flag, s.lesson.distinctions[0].flag);
  s = run(withLesson(L => { L.points[1].text = 'Severe stenosis — a mean gradient above 40 mmHg (see p. 99, pp. 10–11)'; })).sections[0];
  ok('a page citation’s number is not a claim', !s.lesson.points[1].flag, s.lesson.points[1].flag);
  s = run(withLesson(L => { L.overview = 'Aortic stenosis kills 50 percent within two years of symptoms.'; })).sections[0];
  ok('the overview too, kept and flagged', s.lesson.overview && s.lesson.flags.overview === 'a number not in your book: 50' && s.flags.some(f => f.where === 'overview'));
}

head('a question is held to the book by its answer, not by its wrong options');
{
  let s = run(withQ(q => { q.quote = 'A mean gradient above _____ defines critical stenosis.'; })).sections[0];
  ok('a quoted sentence that is not the book’s', s.quiz.questions[0].flag === 'the quoted sentence is not your book’s words', s.quiz.questions[0].flag);
  s = run(withQ(q => { q.quote = 'a MEAN gradient above _____ marks  severe stenosis'; })).sections[0];
  ok('the book’s sentence, however cased and spaced, is found', !s.quiz.questions[0].flag, s.quiz.questions[0].flag);
  s = run(withQ(q => { q.answer = 2; q.why = ['a', 'b', '', 'd']; })).sections[0];
  ok('the gap filled with a wrong answer is not the book’s sentence', /not your book/.test(s.quiz.questions[0].flag || ''), s.quiz.questions[0].flag);
  s = run(withQ(q => { q.explain = 'Above 45 mmHg is severe.'; })).sections[0];
  ok('an explanation with a number the book does not have', s.quiz.questions[0].flag === 'a number not in your book: 45', s.quiz.questions[0].flag);
  s = run(withQ(q => { q.quote = ''; q.question = 'A 78-year-old with a heart rate of 110 faints on exertion. Which mean gradient marks severe aortic stenosis?'; })).sections[0];
  ok('a vignette\u2019s own numbers are its scenario, not a claim about the book', !s.quiz.questions[0].flag, s.quiz.questions[0].flag);
  s = run(withQ(q => { q.quote = ''; q.options[1] = '45 mmHg'; q.explain = 'A mean gradient above 40 mmHg marks severe stenosis.'; })).sections[0];
  ok('while a right answer with a number the book does not have is flagged', s.quiz.questions[0].flag === 'a number not in your book: 45', s.quiz.questions[0].flag);
  s = run(withQ(q => { q.quote = ''; q.options = ['20 mmHg', '40 mmHg', '65 mmHg', '90 mmHg']; })).sections[0];
  ok('a wrong option may hold a value the book does not — that is what makes it wrong', !s.quiz.questions[0].flag, s.quiz.questions[0].flag);
  s = run(withQ(q => { q.page = 11; })).sections[0];
  ok('a question citing a page outside its section', /p\. 11 is not in this section/.test(s.quiz.questions[0].flag || ''));
}

head('what cannot be used is refused, and says why');
{
  let c = run(Object.assign(honest(), { title: 'Heart failure' }));
  ok('a section whose title is not this unit’s', !c.sections.length && c.refused.length === 1 && /section 1 here is "Definition and grading"/.test(c.refused[0].why), JSON.stringify(c.refused));
  c = run(Object.assign(honest(), { title: 'definition  AND grading.' }));
  ok('the same title, cased and punctuated differently, is the same section', c.sections.length === 1);
  c = run(Object.assign(honest(), { section: 9 }));
  ok('a section number the unit does not have', !c.sections.length && /no section 9/.test(c.refused[0].why));
  c = run(withLesson(L => { delete L.points; }));
  ok('a lesson with no points', !c.sections.length && /points is missing/.test(c.refused[0].why), JSON.stringify(c.refused));
  c = run(withLesson(L => { L.points = [{ text: 'NOT_IN_PDF', page: 10 }]; }));
  ok('a lesson whose every point Claude marked NOT_IN_PDF', !c.sections.length && /no points left/.test(c.refused[0].why));
  c = run({ section: 'one', title: 'Definition and grading' });
  ok('a section with no number', !c.sections.length && /no section number/.test(c.refused[0].why));
  c = run(honest(), Object.assign(honest(), { section: 2, title: 'Nope' }));
  ok('one bad section does not stop the good one', c.sections.length === 1 && c.refused.length === 1);
}

head('an item Claude could not ground, or that is not fit to use, is left out');
{
  let c = run(withLesson(L => { L.points.push({ text: 'Survival — NOT_IN_PDF', page: 10 }); }));
  ok('an item Claude marked NOT_IN_PDF', c.sections[0].lesson.points.length === 2 && c.dropped.some(d => d.where === 'point 3' && /NOT_IN_PDF/.test(d.why)));
  c = run(withLesson(L => { L.mechanism = 'NOT_IN_PDF'; }));
  ok('a mechanism marked NOT_IN_PDF is emptied, not shown', c.sections[0].lesson.mechanism === '' && c.dropped.some(d => d.where === 'mechanism'));
  c = run(withQ(q => { q.options = q.options.slice(0, 3); q.why = q.why.slice(0, 3); }));
  ok('a question with three options', !c.sections[0].quiz.questions.length && /has 3 options/.test(c.dropped[0].why), JSON.stringify(c.dropped));
  c = run(withQ(q => { q.answer = 4; }));
  ok('an answer that is not one of the options', !c.sections[0].quiz.questions.length && /not one of the options/.test(c.dropped[0].why));
  c = run(withQ(q => { q.why = ['a', '', 'c']; }));
  ok('reasons that do not line up with the options', !c.sections[0].quiz.questions.length && /3 reasons for 4 options/.test(c.dropped[0].why));
  c = run(withQ(q => { delete q.answer; }));
  ok('a question with no answer', !c.sections[0].quiz.questions.length && /answer is missing/.test(c.dropped[0].why), JSON.stringify(c.dropped));
  c = run(withQ(q => { q.explain = 'NOT_IN_PDF'; }));
  ok('a question whose explanation Claude could not ground', !c.sections[0].quiz.questions.length && /NOT_IN_PDF/.test(c.dropped[0].why));
  c = run(withLesson(L => { L.analogies[0].text = 'Like a door that lets through 40 people a minute.'; }));
  ok('an analogy carrying a number', !c.sections[0].lesson.analogies.length && /may not carry a number/.test(c.dropped[0].why));
  c = run(withLesson(L => { L.analogies[0].text = 'Like a blocked pipe, as in heart failure.'; }));
  ok('an analogy naming what the chapter does not', !c.sections[0].lesson.analogies.length && /Heart failure/.test(c.dropped[0].why), JSON.stringify(c.dropped));
  c = run(withLesson(L => { L.mnemonics[0].letters = 'MGX'; }));
  ok('a mnemonic whose letters are not one to a word', !c.sections[0].lesson.mnemonics.length && /one for each word/.test(c.dropped[0].why));
  c = run(withLesson(L => { L.flowchart = 'flowchart TD\n  A["gradient 70 mmHg"] --> B["surgery"]'; }));
  ok('a flowchart with a number the book does not have', c.sections[0].lesson.flowchart === '' && c.dropped.some(d => d.where === 'flowchart'));
}

head('a reply that leaves out what may be empty is not refused for it');
{
  let c = run(withLesson(L => { delete L.pearls; delete L.distinctions; delete L.mechanism; delete L.flowchart; }));
  const L = c.sections[0] && c.sections[0].lesson;
  ok('no pearls, pairs, mechanism or flowchart reads as none', L && Array.isArray(L.pearls) && !L.pearls.length && Array.isArray(L.distinctions) && L.mechanism === '' && L.flowchart === '');
  c = run(withQ(q => { delete q.why; delete q.trap; delete q.quote; }));
  const q = c.sections[0].quiz.questions[0];
  ok('a question with no reasons, trap or quote is kept, with none', q && Array.isArray(q.why) && !q.why.length && q.trap === '' && q.quote === '');
  c = run(Object.assign(honest(), { quiz: undefined }));
  ok('a section with a lesson and no questions is a lesson', c.sections.length === 1 && c.sections[0].quiz.questions.length === 0);
  c = run(withQ(q => { q.difficulty = 'hard'; }));
  ok('a key the shape does not have is left out, not a refusal', c.sections[0].quiz.questions.length === 1 && !('difficulty' in c.sections[0].quiz.questions[0]));
}

head('kept on the device, section by section');
{
  const a = run(honest());
  const t2 = Object.assign(honest(), { section: 2, title: 'Treatment' });
  t2.lesson.points = [{ text: 'Valve replacement — indicated once symptoms appear', page: 11 }];
  t2.lesson.numbers = []; t2.lesson.pearls = []; t2.lesson.distinctions = []; t2.quiz.questions[0].page = 11; t2.quiz.questions[0].quote = '';
  const b = run(t2);
  const rec1 = P.merge(null, a, DOC, 1);
  ok('a first import makes the unit’s pack', rec1.id === 'd1' && P.sectionOf(rec1, 0) && !P.sectionOf(rec1, 1));
  const rec2 = P.merge(rec1, b, DOC, 2);
  ok('a later reply adds its sections and keeps the others', P.sectionOf(rec2, 0) && P.sectionOf(rec2, 1) && rec2.at === 2);
  ok('without changing the pack it was merged into', !P.sectionOf(rec1, 1));
  const again = run(withLesson(L => { L.overview = 'Aortic stenosis obstructs left ventricular outflow.'; }));
  const rec3 = P.merge(rec2, again, DOC, 3);
  ok('a section imported again is replaced', P.sectionOf(rec3, 0).lesson.overview === 'Aortic stenosis obstructs left ventricular outflow.' && P.sectionOf(rec3, 0).at === 3);
  const two = P.check([pack(honest()), pack(Object.assign(honest(), { quiz: { questions: [] } }))], DOC);
  ok('the same section twice in one paste: the later one', two.sections.length === 1 && two.sections[0].quiz.questions.length === 0);
  const cov = P.coverage(rec2, DOC);
  /* section 2's question still asks about 40 mmHg, which section 2 does not have */
  ok('coverage counts the sections the pack has, and what is flagged in them', cov.have === 2 && cov.of === 4 && cov.flagged === 1, JSON.stringify(cov));
  ok('and names the first reply still to import', JSON.stringify(cov.next) === JSON.stringify([1, 4]));
  const nine = { id: 'n', clusters: Array.from({ length: 9 }, () => ({})) };
  ok('which is the first reply with a section missing', JSON.stringify(P.coverage({ sections: { 0: {}, 1: {}, 2: {}, 3: {} } }, nine).next) === JSON.stringify([5, 8]) &&
     P.coverage({ sections: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i, {}])) }, nine).next === null);
}

head('the import report counts what the check found');
{
  const c = run(withLesson(L => { L.points[1].text = 'Severe stenosis — above 50 mmHg'; }), Object.assign(honest(), { section: 3, title: 'Nope' }));
  const r = P.report(c);
  ok('sections, questions, flagged, refused', r.imported === 1 && r.questions === 1 && r.flagged === 1 && r.refused === 1, JSON.stringify(r));
  ok('and says so in a line', r.line === 'Imported section 1: 1 lesson, 1 question. 1 item not found in your book, flagged where it is shown.', r.line);
  ok('a clean import says everything checked was found', /Everything checked was found in your book\./.test(P.report(run(honest())).line));
  ok('nothing imported is said as nothing', P.report(run(Object.assign(honest(), { title: 'Nope' }))).line === 'Nothing was imported.');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
