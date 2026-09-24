#!/usr/bin/env node
/*
 * Memorizer's built-in coach: a lesson, then a drill of multiple-choice
 * questions — and nothing taught that the book does not say.
 *
 *   node tests/verify-memorizer-coach-pure.js
 *
 * Pure Node. memorizer/src/coach.js answers the three steps the model does,
 * from the same arguments. What is proven here:
 *
 *   · SAME SHAPE. Every lesson, drill and exam passes the schema and the
 *     multiple-choice rules the model's replies are held to
 *     (MemPrompts.validate), over many generated sections.
 *   · THE BOOK'S WORDS. The lesson's overview and points are sentences of the
 *     section, verbatim, with their pages; every question's right answer and
 *     explanation come from the book. Only the analogies are Memorizer's own,
 *     and they carry no numbers.
 *   · FAIR QUESTIONS. Four different options, one right; wrong options of the
 *     same kind as the right one and never sharing its root; nothing in the
 *     question that gives the answer away; list items never treated as
 *     sentences; a mixed drill, no kind more than twice, no sentence twice.
 *   · AN EXAM THAT IS NOT A REPEAT, weighted to the weakest sections.
 *
 * The section texts below are written for this test — plain physiology and
 * valve disease, no one's licensed material.
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
const K = require(path.join(ROOT, 'memorizer', 'src', 'coach.js'));
const P = require(path.join(ROOT, 'memorizer', 'src', 'prompts.js'));
const A = require(path.join(ROOT, 'memorizer', 'src', 'analogies.js'));
const Chunk = require(path.join(ROOT, 'memorizer', 'src', 'chunk.js'));

const PRELOAD = {
  index: 0, title: 'Preload', pageStart: 4, pageEnd: 5,
  segments: [
    { page: 4, heading: true, text: 'Preload' },
    { page: 4, heading: false, text:
      'Preload is the stretch on ventricular myocytes at the end of diastole. ' +
      'Greater preload stretches the sarcomere toward its optimal length and increases the force of contraction. ' +
      'This relationship between stretch and stroke volume is the Frank-Starling mechanism. ' +
      'Venous return is the main determinant of preload in a healthy heart. ' +
      'A normal left ventricular end-diastolic pressure is below 12 mmHg.' },
    { page: 5, heading: false, text:
      'Diuretics reduce preload by lowering circulating volume. ' +
      'Venodilators such as nitrates reduce preload by pooling blood in the veins. ' +
      'When preload falls too far, stroke volume and cardiac output fall with it. ' +
      'Excessive preload raises pulmonary venous pressure and causes pulmonary congestion. ' +
      'The stretch curve flattens at high filling pressures, so further volume adds little force.' },
  ],
};
const AFTERLOAD = {
  index: 1, title: 'Afterload', pageStart: 6, pageEnd: 6,
  segments: [
    { page: 6, heading: false, text:
      'Afterload is the wall stress the ventricle must overcome to eject blood. ' +
      'Aortic stenosis increases afterload because the ventricle pushes against a narrowed valve. ' +
      'Systemic hypertension raises afterload and leads to concentric hypertrophy over time. ' +
      'Vasodilators lower afterload and can increase stroke volume in a failing ventricle. ' +
      'By the Laplace relation, wall stress rises with cavity radius and falls with wall thickness.' },
  ],
};
const CONTRACT = {
  index: 2, title: 'Contractility', pageStart: 7, pageEnd: 7,
  segments: [
    { page: 7, heading: false, text:
      'Contractility is the intrinsic strength of contraction at a fixed preload and afterload. ' +
      'Sympathetic stimulation raises contractility through beta-1 receptors. ' +
      'Digoxin increases intracellular calcium and modestly improves contractility. ' +
      'Ischaemia depresses contractility within seconds of reduced coronary flow. ' +
      'The end-systolic pressure-volume relation steepens when contractility increases.' },
  ],
};
const text = c => c.segments.filter(s => !s.heading).map(s => s.text).join(' ');

const withText = c => Object.assign(c, { text: c.segments.map(s => s.text).join('\n\n') });
[PRELOAD, AFTERLOAD, CONTRACT].forEach(withText);
const norm = s => String(s).toLowerCase().replace(/\s+/g, ' ');

/* A unit of three valve lesions, shaped as chunk.js marks them: lists with
   sub-headings, definitions, "most common" facts and values with units. */
const seg = (page, text, extra) => Object.assign({ page, heading: false, text }, extra || {});
const TS = withText({ index: 0, title: 'Tricuspid stenosis', pageStart: 2, pageEnd: 2, segments: [
  seg(2, 'Table 17.1 lists the causes of TS.'),
  seg(2, 'Congenital', { item: true, sub: true, list: 'L1' }),
  seg(2, 'Tricuspid atresia', { item: true, list: 'L1' }),
  seg(2, 'Atypical Ebstein anomaly (more likely to cause TR)', { item: true, list: 'L1' }),
  seg(2, 'Acquired', { item: true, sub: true, list: 'L1' }),
  seg(2, 'Rheumatic', { item: true, list: 'L1' }),
  seg(2, 'Infective endocarditis', { item: true, list: 'L1' }),
  seg(2, 'Carcinoid syndrome', { item: true, list: 'L1' }),
  seg(2, 'Malignancy (eg, myxoma and metastases)', { item: true, list: 'L1' }),
  seg(2, 'Whipple disease', { item: true, list: 'L1' }),
  seg(2, 'Rheumatic heart disease (RHD) is the most common cause of TS, accounting for more than 90% of cases. ' +
    'Tricuspid stenosis (TS) is a narrowing of the tricuspid valve orifice that obstructs right atrial emptying. ' +
    'The mean gradient across the valve is usually above 5 mmHg in severe stenosis. ' +
    'Right atrial enlargement follows, and hepatic congestion causes abdominal discomfort.'),
] });
const TR = withText({ index: 1, title: 'Tricuspid regurgitation', pageStart: 3, pageEnd: 3, segments: [
  seg(3, 'Tricuspid regurgitation (TR) is a backward flow across the tricuspid valve during systole. ' +
    'Pulmonary hypertension is the most common cause of functional TR. ' +
    'Severe regurgitation raises right atrial pressure above 15 mmHg and causes hepatic congestion. ' +
    'Annular dilatation and right ventricular enlargement pull the leaflets apart.'),
  seg(3, 'Causes of primary TR', { item: true, sub: true, list: 'L2' }),
  seg(3, 'Infective endocarditis', { item: true, list: 'L2' }),
  seg(3, 'Carcinoid heart disease', { item: true, list: 'L2' }),
  seg(3, 'Pacemaker lead injury', { item: true, list: 'L2' }),
  seg(3, 'Chest trauma', { item: true, list: 'L2' }),
] });
const AS = withText({ index: 2, title: 'Aortic stenosis', pageStart: 4, pageEnd: 4, segments: [
  seg(4, 'Aortic stenosis is a narrowing of the aortic valve orifice that obstructs left ventricular outflow. ' +
    'Calcific degeneration is the most common cause of aortic stenosis in older adults. ' +
    'The narrowed valve raises afterload, and the ventricle responds with concentric hypertrophy. ' +
    'Severe stenosis is defined by a mean gradient of at least 40 mmHg or a valve area below 1.0 cm2. ' +
    'Angina, syncope and heart failure are the classic symptoms of severe aortic stenosis.'),
  seg(4, 'A bicuspid aortic valve is a congenital anomaly with two leaflets instead of three. ' +
    'Syncope is a transient loss of consciousness caused by cerebral hypoperfusion. ' +
    'The hypertrophied ventricle becomes stiff and depends on atrial contraction to fill. ' +
    'Without valve replacement, average survival after the onset of angina is about 5 years.'),
] });
const UNIT = [TS, TR, AS];
const unitText = norm(UNIT.map(c => c.text).join(' '));

head('the lesson: the book’s own words, in teaching order');
{
  const L = K.lesson(PRELOAD);
  ok('matches the schema and the rules', P.validate('lesson', L) === '', P.validate('lesson', L));
  ok('the big idea is the section’s own definition', L.overview === 'Preload is the stretch on ventricular myocytes at the end of diastole.', L.overview);
  /* …even when a key point comes before it: here a sentence with a number
     is picked first, and it is not the big idea. */
  const later = withText({ index: 0, title: 'Preload', pageStart: 1, pageEnd: 1, segments: [seg(1,
    'During exercise venous return and heart rate rise together by about 30 percent in healthy adults. ' +
    'Preload is the stretch on ventricular myocytes at the end of diastole. ' +
    'Diuretics reduce preload by lowering circulating volume.')] });
  const LL = K.lesson(later);
  ok('the definition is the big idea even when a key point comes before it', /^During exercise/.test(LL.points[0].text) && LL.overview === 'Preload is the stretch on ventricular myocytes at the end of diastole.',
     LL.points[0].text.slice(0, 30) + ' / ' + LL.overview.slice(0, 30));
  ok('every key point is a sentence of the section, verbatim, on its own page',
     L.points.length >= 3 && L.points.every(p => PRELOAD.segments.some(s => s.page === p.page && s.text.indexOf(p.text) !== -1)), L.points.map(p => p.text.slice(0, 30)).join(' | '));
  ok('in the book’s order', L.points.every((p, i) => i === 0 || PRELOAD.text.indexOf(p.text) > PRELOAD.text.indexOf(L.points[i - 1].text)));
  ok('the numbers to know are the section’s values', L.numbers.length >= 1 && L.numbers.every(n => /\d/.test(n.text)) && L.numbers.some(n => /12 mmHg/.test(n.text)),
     JSON.stringify(L.numbers));
  const T = K.lesson(TS);
  ok('a reference to a table or figure is not a number to know', !T.numbers.some(n => /Table 17\.1/.test(n.text)), JSON.stringify(T.numbers));
  const long = { index: 0, title: 'Severity', pageStart: 1, pageEnd: 1, segments: [seg(1,
    'In the echocardiographic assessment of aortic valve disease the peak transvalvular velocity of at least 4 m/s and a mean gradient of 40 mmHg together with a small valve area define the severe stage of the disease in most adults examined.')] };
  const two = K.numberFacts({ title: 't', segments: [{ page: 4, heading: false, text:
    'A left ventricular end-diastolic pressure greater than 18 mmHg should prompt a search for volume overload in the patient who is breathless, whereas a normal pressure of 8 to 12 mmHg does not exclude a stiff ventricle.' }] }, 8);
  ok('a number fact keeps its whole sentence, so every value in it becomes a tile', two.length === 1 && /18 mmHg/.test(two[0].text) && /8 to 12 mmHg/.test(two[0].text), JSON.stringify(two));
  ok('a value keeps its unit as the book wrote it ("m/s", not "m s")', K.lesson(long).numbers.some(n => /4 m\/s/.test(n.text)), JSON.stringify(K.lesson(long).numbers));
  const acq = T.mnemonics.find(m => /Acquired causes of TS/.test(m.title));
  ok('every list of three to nine gets a mnemonic, its letters the items’ first letters', acq && acq.letters === 'RICMW' &&
     acq.words.join('|') === 'Rheumatic|Infective endocarditis|Carcinoid syndrome|Malignancy|Whipple disease', JSON.stringify(T.mnemonics));
  ok('a section with lists gets their mnemonics, not one over its key points as well', !T.mnemonics.some(m => /key points/.test(m.title)), T.mnemonics.map(m => m.title).join(', '));
  ok('a section with no list gets one over its key points instead', L.mnemonics.length === 1 && L.mnemonics[0].letters.length === L.mnemonics[0].words.length &&
     L.mnemonics[0].words.every(w => norm(PRELOAD.text).indexOf(w.toLowerCase()) !== -1), JSON.stringify(L.mnemonics));
  ok('an analogy that fits is chosen, and marked as Memorizer’s', L.analogies.length >= 1 && L.analogies[0].title === 'Preload' && L.analogies.every(a => a.source === 'Memorizer'),
     L.analogies.map(a => a.title).join(', '));
  const kidney = withText({ index: 0, title: 'The nephron', pageStart: 1, pageEnd: 1, segments: [seg(1, 'The glomerulus filters plasma. The tubule reabsorbs sodium and water. The collecting duct concentrates urine.')] });
  ok('and none is forced on a section it does not fit', K.lesson(kidney).analogies.length === 0);
}

head('the analogy bank');
{
  ok('every analogy is free of numbers — values come from the book, not from here', A.BANK.every(e => !/\d/.test(e.text)),
     A.BANK.filter(e => /\d/.test(e.text)).map(e => e.id).join(', ') || A.BANK.length + ' analogies');
  ok('every entry has patterns to be found by', A.BANK.every(e => e.match.length >= 1 && e.text.length > 40));
  ok('the ids are unique', new Set(A.BANK.map(e => e.id)).size === A.BANK.length);
  const one = withText({ index: 0, title: 'x', segments: [seg(1, 'Afterload was mentioned once.')] });
  ok(`a single passing mention is not enough (under ${A.MIN_SCORE})`, A.forSection(one).length === 0);
  const titled = withText({ index: 0, title: 'Afterload', segments: [seg(1, 'Nothing else here.')] });
  ok('a section titled by the idea is enough on its own', A.forSection(titled).some(a => a.title === 'Afterload'));
  /* Afterload is later in the bank than Preload, so order by bank position
     would put Preload first; the stronger match must lead. */
  const both = withText({ index: 0, title: 'Loading', segments: [seg(1, 'Afterload and afterload and afterload. Preload and preload.')] });
  ok('the strongest match comes first, wherever it sits in the bank', A.forSection(both)[0].title === 'Afterload', A.forSection(both).map(a => a.title).join(', '));
}

head('the drill: multiple choice from the book');
{
  const quizzes = UNIT.map(c => K.quiz(c, K.lesson(c), UNIT));
  const all = quizzes.map((q, i) => q.questions.map(x => Object.assign({ ci: i }, x))).flat();
  ok('every drill matches the schema and the multiple-choice rules', quizzes.every(q => P.validate('quiz', q) === ''), quizzes.map(q => P.validate('quiz', q)).filter(Boolean).join(' | '));
  ok('every section of the unit gets a drill', quizzes.every(q => q.questions.length >= 4), quizzes.map(q => q.questions.length).join(', '));
  ok(`no drill is longer than ${K.QUIZ_SIZE}`, quizzes.every(q => q.questions.length <= K.QUIZ_SIZE));
  const rightText = q => q.options[q.answer];
  ok('every right answer is the book’s: its words are in the unit', all.every(q => unitText.indexOf(norm(rightText(q)).replace(/%$/, '')) !== -1 ||
     norm(q.quote).length && q.explain && unitText.indexOf(norm(q.explain).slice(0, 40)) !== -1),
     all.filter(q => unitText.indexOf(norm(rightText(q))) === -1).map(q => rightText(q)).join(' | '));
  ok('and so is every explanation', all.every(q => unitText.indexOf(norm(q.explain).slice(0, 40)) !== -1 || /^The .+: /.test(q.explain) || /—/.test(q.explain)),
     all.filter(q => unitText.indexOf(norm(q.explain).slice(0, 40)) === -1).map(q => q.explain.slice(0, 50)).join(' | '));
  ok('the right option is not always in the same place', new Set(all.map(q => q.answer)).size >= 3, all.map(q => q.answer).join(''));
  const find = re => all.find(q => re.test(q.question));
  const back = find(/^Which term is defined as “a narrowing of the tricuspid/);
  ok('a definition is asked backwards: the meaning given, the term wanted', back && rightText(back) === 'Tricuspid stenosis (TS)', back && back.options.join(' / '));
  const named = K.pools(UNIT);
  const namedSet = new Set(named.defs.map(d => norm(d.term)).concat(named.phrases.map(p => norm(p.text))));
  ok('its wrong options are terms the unit itself defines or names, not stray words', back && back.options.every(o => namedSet.has(norm(o))), back && back.options.join(' / '));
  ok('and none of them is already in the definition', back && back.options.every((o, i) => i === back.answer || norm(back.question).indexOf(norm(o)) === -1));
  const most = find(/^What is the most common cause of TS\?/);
  ok('"the most common…" asks for it, with the other causes as the wrong options', most && rightText(most) === 'Rheumatic heart disease (RHD)' &&
     most.options.filter((o, i) => i !== most.answer).every(o => /Infective|Carcinoid|Malignancy|Whipple|Tricuspid atresia|Ebstein|Pacemaker|Chest|Rheumatic$/.test(o)), most && most.options.join(' / '));
  const exc = find(/EXCEPT/);
  /* The odd one out may come from the same lesion's other list — "acquired
     causes EXCEPT Ebstein anomaly", which is congenital — the confusion an
     examiner reaches for. What it may not be is one of the list's own. */
  const acquired = ['Rheumatic', 'Infective endocarditis', 'Carcinoid syndrome', 'Malignancy', 'Whipple disease'];
  ok('"all of the following EXCEPT": three from the list, the odd one out not of it', exc && /acquired causes of TS/.test(exc.question) &&
     exc.options.filter((o, i) => i !== exc.answer).every(o => acquired.indexOf(o) !== -1) && acquired.indexOf(rightText(exc)) === -1,
     exc && exc.question + ' ' + exc.options.join(' / ') + ' → ' + rightText(exc));
  ok('a list title reads as part of the sentence', exc && /are acquired causes of TS EXCEPT|are congenital causes of TS EXCEPT|are causes of primary TR EXCEPT/.test(exc.question), exc && exc.question);
  const num = all.find(q => /Which value/.test(q.question) && /5 mmHg|15 mmHg|40 mmHg/.test(q.quote.replace('_____', rightText(q))));
  ok('a value question offers the unit’s other values with the same unit first', num && num.options.some((o, i) => i !== num.answer && ['5', '15', '40'].indexOf(o) !== -1),
     num && num.quote + ' — ' + num.options.join(' / '));
  /* From every question the unit could ask: the "more than 90%" question is
     not always chosen for a drill (its sentence also carries "the most
     common cause"), and near 100 is where a wrong value could overshoot. */
  const numsAll = UNIT.map(c => K.candidates(c, K.pools(UNIT))).flat().filter(q => q.kind === 'number');
  ok('a value question never offers the right value twice, nor a percentage over 100', numsAll.some(q => /%$/.test(q.options[q.answer])) &&
     numsAll.every(q => new Set(q.options).size === 4 && q.options.every(o => !/%$/.test(o) || parseFloat(o) <= 100)),
     numsAll.map(q => q.options.join('/')).join(' | '));
  const terms = all.filter(q => /Which term completes/.test(q.question));
  ok('a missing term is offered against terms of its own kind', terms.length >= 1 && terms.every(q => new Set(q.options.map(o => K.kindOf(o))).size === 1),
     terms.map(q => q.options.map(o => o + ':' + K.kindOf(o)).join('/')).join(' | '));
  ok('never against another form of the same word', terms.every(q => q.options.every((o, i) => i === q.answer || o.slice(0, 6).toLowerCase() !== rightText(q).slice(0, 6).toLowerCase())));
  const itemTexts = UNIT.map(c => c.segments.filter(s => s.item).map(s => s.text)).flat();
  ok('a list item is never treated as a sentence to complete', all.filter(q => q.quote).every(q => itemTexts.every(t => q.quote.replace('_____', rightText(q)) !== t)));
  const kindOfQ = q => /^Which term is defined/.test(q.question) ? 'define-back' : /most common/.test(q.question) ? 'most' : /EXCEPT/.test(q.question) ? 'except'
    : /is one of the/.test(q.question) ? 'member' : /Which value/.test(q.question) ? 'number' : /statement about/.test(q.question) ? 'true'
    : /Which term completes/.test(q.question) ? 'term' : /best describes/.test(q.question) ? 'define' : /statements is from/.test(q.question) ? 'source' : 'table';
  /* A literal 2, not K.PER_KIND: a check sized by the constant it tests
     passes whatever the constant says. */
  ok('a drill is mixed: no kind of question more than twice', quizzes.every(q => {
    const n = {}; q.questions.forEach(x => { n[kindOfQ(x)] = (n[kindOfQ(x)] || 0) + 1; });
    return Object.values(n).every(v => v <= 2);
  }), quizzes.map(q => q.questions.map(kindOfQ).join(',')).join(' | '));
  /* Not "no two explanations are equal": an explanation may add to its
     sentence, and equality let one sentence be asked twice — the browser
     suite caught it. One explanation containing another is the same
     sentence. */
  const twice = quizzes.map(q => q.questions.map(x => x.explain)).map(es => es.filter((e, i) => es.some((f, j) => j !== i && f.indexOf(e) !== -1))).flat();
  ok('and no two questions rest on one sentence of the book', twice.length === 0, twice.slice(0, 2).join(' | '));
  ok('the same section gives the same drill every time', JSON.stringify(K.quiz(TS, null, UNIT)) === JSON.stringify(quizzes[0]));
  /* The kinds a drill does not always pick: from every question each
     section could ask, so these are held whether or not a drill chose them. */
  const cands = UNIT.map(c => K.candidates(c, K.pools(UNIT))).flat();
  const trues = cands.filter(q => q.kind === 'true');
  ok('"which statement is true": the right one is the book’s sentence, the others each changed from one', trues.length >= 1 &&
     trues.every(q => unitText.indexOf(norm(rightText(q))) !== -1 && q.options.filter((o, i) => i !== q.answer).every(o => unitText.indexOf(norm(o)) === -1)),
     trues.length + ' — ' + (trues[0] ? trues[0].options.join(' / ') : 'none'));
  ok('and a changed statement swaps a real term or a value, never a plain word, a reference or a named abbreviation’s word', trues.every(q => q.options.every(o => !/^Table|^Fig/.test(o) &&
     !/\b\w+ \((?:TS|TR|RHD)\)/.test(o.replace(/Tricuspid stenosis \(TS\)|Tricuspid regurgitation \(TR\)|Rheumatic heart disease \(RHD\)/g, '')) && /^[A-Z]/.test(o))),
     trues.map(q => q.options.join(' / ')).join(' | '));
  const fwd = cands.filter(q => q.kind === 'define');
  ok('a definition asked forwards offers the unit’s other definitions as the wrong meanings', fwd.length >= 1 &&
     fwd.every(q => q.options.every(o => UNIT.some(c => c.text.indexOf(o) !== -1))), fwd.length + ' — ' + (fwd[0] ? fwd[0].question + ' ' + fwd[0].options.join(' / ') : 'none'));
  const allTerms = cands.filter(q => q.kind === 'term');
  ok('no missing-term question offers another form of the same word (hypertrophy, hypertrophied)', allTerms.length >= 3 &&
     allTerms.every(q => q.options.every((o, i) => i === q.answer || o.slice(0, 6).toLowerCase() !== rightText(q).slice(0, 6).toLowerCase())),
     allTerms.map(q => q.options.join('/')).join(' | '));
  /* Two sentences the same but for one term: changing one into the other
     gives a sentence of the book — true, so it may not be a wrong option. */
  const PAR = withText({ index: 0, title: 'Loading', pageStart: 1, pageEnd: 1, segments: [seg(1,
    'Aortic stenosis raises left ventricular afterload in most adults. Aortic regurgitation raises left ventricular afterload in most adults. ' +
    'Mitral regurgitation lowers left ventricular afterload in most adults. Endocarditis damages the valve leaflets in some adults.')] });
  const PT = PAR.segments[0].text;
  const parTrue = K.candidates(PAR, K.pools([PAR])).filter(q => q.kind === 'true');
  ok('a changed statement that happens to be another sentence of the book is never a wrong option', parTrue.length >= 1 &&
     parTrue.every(q => q.options.filter((o, i) => i !== q.answer).every(o => PT.indexOf(o) === -1)), parTrue.map(q => q.options.join(' / ')).join(' | ') || 'none');
  /* The rules for a wrong option, one by one. */
  /* Exactly three candidates, one forbidden: the rule must leave the
     question unfilled (null) rather than use it. With spare candidates a
     broken rule could pass by not happening to pick the forbidden one. */
  ok('a wrong option is never the answer itself', K.distractors('stenosis', ['Stenosis', 'atresia', 'failure'], 3, '', 's') === null);
  ok('nor a word the question already says', K.distractors('stenosis', ['valve', 'atresia', 'failure'], 3, 'the narrowed valve obstructs flow', 's') === null);
  ok('nor another form of the answer', K.distractors('hypertrophy', ['hypertrophied', 'atresia', 'failure'], 3, '', 's') === null);
  ok('and with three good ones, all three are used', (K.distractors('hypertrophy', ['dilatation', 'atresia', 'failure'], 3, '', 's') || []).length === 3);
  const ownItem = UNIT.map(c => K.candidates(c, K.pools(UNIT))).flat().filter(q => /EXCEPT/.test(q.question));
  ok('the odd one out in an EXCEPT question is never one of the list’s own items', ownItem.length >= 2 &&
    ownItem.every(q => q.explain.indexOf(q.options[q.answer] + ' ·') === -1 && q.explain.indexOf(' ' + q.options[q.answer] + '.') === -1),
    ownItem.map(q => q.options[q.answer] + ' vs ' + q.explain).join(' | '));
  /* One list in the whole unit: every item-based candidate is the list's own,
     so only the rule can keep them out — no shuffle can pass it by luck. */
  const ONE = withText({ index: 0, title: 'Mitral stenosis', pageStart: 1, pageEnd: 1, segments: [
    seg(1, 'Mitral stenosis (MS) is a narrowing of the mitral valve orifice. Left atrial pressure (LAP) rises as the orifice narrows.'),
    seg(1, 'Causes of mitral stenosis', { item: true, sub: true, list: 'L7' }),
    seg(1, 'Rheumatic fever', { item: true, list: 'L7' }), seg(1, 'Mitral annular calcification', { item: true, list: 'L7' }),
    seg(1, 'Congenital parachute valve', { item: true, list: 'L7' }), seg(1, 'Carcinoid disease', { item: true, list: 'L7' })] });
  const oneExc = K.candidates(ONE, K.pools([ONE])).filter(q => /EXCEPT/.test(q.question));
  const oneItems = ['Rheumatic fever', 'Mitral annular calcification', 'Congenital parachute valve', 'Carcinoid disease'];
  ok('with a single list in the unit, the odd one out still comes from outside it — and is not the list’s own subject', oneExc.length === 1 &&
     oneItems.indexOf(oneExc[0].options[oneExc[0].answer]) === -1 && !/mitral stenosis/i.test(oneExc[0].options[oneExc[0].answer]),
     oneExc.map(q => q.options.join(' / ') + ' → ' + q.options[q.answer]).join(' | ') || 'none');
  /* A section of many terms, each in its own sentence: plenty of one kind. */
  const MANY = withText({ index: 0, title: 'Lesions', pageStart: 1, pageEnd: 1, segments: [seg(1,
    ['stenosis', 'regurgitation', 'endocarditis', 'myocarditis', 'pericarditis', 'cardiomyopathy', 'atresia', 'thrombosis', 'sclerosis', 'dilatation']
      .map((t, i) => 'In adult patients the ' + t + ' is usually found on the left side of the heart ' + ['early', 'late', 'rarely', 'often', 'first', 'last', 'again', 'twice', 'once', 'seldom'][i] + '.').join(' '))] });
  const mq = K.quiz(MANY, null, [MANY]).questions;
  ok('a section full of one kind of question still gets at most two of it', mq.length >= 2 && mq.filter(q => /Which term completes/.test(q.question)).length <= 2,
     mq.map(q => q.question.slice(0, 20)).join(' | '));
  ok('a verb’s form is not a thing’s name', K.kindOf('hypertrophied') === 'plain' && K.kindOf('hypertrophy') === 'thing' && K.kindOf('aortic') === 'place' && K.kindOf('Whipple disease') === 'phrase');
  /* A definition that already says its whole term is not asked backwards. */
  const give = withText({ index: 0, title: 'Valves', pageStart: 1, pageEnd: 1, segments: [seg(1, 'Aortic stenosis is a stenosis of the aortic valve that obstructs left ventricular outflow in adults.')] });
  ok('a definition that already contains its whole term is not asked backwards', !K.candidates(give, K.pools(UNIT.concat([give]))).some(q => q.kind === 'define-back'));
  /* A table asks itself: the cell, against the column's other cells. */
  const TAB = withText({ index: 0, title: 'Values', pageStart: 3, pageEnd: 3, segments: [
    seg(3, 'Normal values are listed below.'),
    seg(3, 'Measure Normal Unit LVEDP < 12 mmHg Stroke volume 60-100 mL Ejection fraction 55 percent Heart rate 60-100 bpm',
      { table: [['Measure', 'Normal', 'Unit'], ['LVEDP', '< 12', 'mmHg'], ['Stroke volume', '60-100', 'mL'], ['Ejection fraction', '55', 'percent'], ['Heart rate', '60-100', 'bpm']] })] });
  const tq = K.quiz(TAB, null, [TAB]).questions.find(q => /In the table/.test(q.question));
  ok('a table cell is asked for by its row and column, against the column’s other cells', tq && /what is the (Normal|Unit) for (LVEDP|Stroke volume|Ejection fraction|Heart rate)\?/.test(tq.question) &&
     tq.options.every(o => ['< 12', '60-100', '55', 'mmHg', 'mL', 'percent', 'bpm'].indexOf(o) !== -1), tq && tq.question + ' ' + tq.options.join(' / '));
  /* A section too thin for anything else still gets asked which statement is its own. */
  const thin = withText({ index: 3, title: 'Pulmonic valve', pageStart: 5, pageEnd: 5, segments: [seg(5, 'It is rarely a problem in adults and it seldom needs any attention at all.')] });
  const tqz = K.quiz(thin, null, UNIT.concat([thin]));
  ok('a section with nothing else to ask is asked which statement is its own', tqz.questions.length >= 1 && /statements is from “Pulmonic valve”/.test(tqz.questions[0].question) &&
     P.validate('quiz', tqz) === '', JSON.stringify(tqz.questions.map(q => q.question)));
  ok('and a section with nothing at all to ask gives an empty drill, not a broken one', JSON.stringify(K.quiz(withText({ index: 0, title: 't', segments: [seg(1, 'It is here.')] }), null, [])) === '{"questions":[]}');
}

head('the final exam');
{
  const drills = UNIT.map(c => K.quiz(c, null, UNIT));
  const asked = drills.map(q => q.questions.map(x => x.question + x.quote)).flat();
  const ex = K.exam(UNIT, asked, [2], 6);
  ok('matches the schema and the rules', P.validate('exam', ex) === '', P.validate('exam', ex));
  ok('asks the number it was given', ex.questions.length === 6, String(ex.questions.length));
  ok('never repeats a drill question while it has new ones', !ex.questions.some(q => asked.indexOf(q.question + q.quote) !== -1));
  ok('at least half on the weakest section, while it has questions left', ex.questions.filter(q => q.cluster === 2).length >= 3 ||
     ex.questions.filter(q => q.cluster === 2).length === K.candidates(AS, K.pools(UNIT)).filter(q => asked.indexOf(q.question + q.quote) === -1).length,
     ex.questions.map(q => q.cluster).join(','));
  ok('every question names a real section', ex.questions.every(q => q.cluster >= 0 && q.cluster < UNIT.length));
  /* Every question the unit has, already asked: the exam asks them again
     rather than setting none. */
  const all = UNIT.map(c => K.candidates(c, K.pools(UNIT)).map(x => x.question + x.quote)).flat();
  const again = K.exam(UNIT, all, [2], 6);
  ok('when the drills asked everything, the exam asks them again, weakest first, rather than nothing', again.questions.length === 6 &&
     P.validate('exam', again) === '' && again.questions.filter(q => q.cluster === 2).length >= 3, again.questions.map(q => q.cluster).join(','));
  ok('and still across the unit', again.questions.some(q => q.cluster !== 2), again.questions.map(q => q.cluster).join(','));
  ok('and a question is never asked twice in one exam', new Set(again.questions.map(q => q.question + q.quote)).size === 6 &&
     new Set(K.exam(UNIT, asked, [2], 40).questions.map(q => q.question + q.quote)).size === K.exam(UNIT, asked, [2], 40).questions.length);
}

head('flowcharts from the section\u2019s own cause-and-effect');
{
  const CAUSAL = { index: 0, title: 'Congestion', pageStart: 9, pageEnd: 9, segments: [{ page: 9, heading: false, text:
    'Diuretics reduce preload by lowering circulating volume. ' +
    'Excessive preload raises pulmonary venous pressure and causes pulmonary congestion. ' +
    'Rising venous pressure leads to oedema of the lungs. ' +
    'Oedema impairs gas exchange, resulting in hypoxaemia. ' +
    'The patient is usually breathless at night.' }] };
  const f = K.flow(CAUSAL);
  const lab = id => (f.nodes.find(n => n.id === id) || {}).label;
  const has = (a, verb, b) => f.edges.some(e => new RegExp(a, 'i').test(lab(e.from)) && e.verb === verb && new RegExp(b, 'i').test(lab(e.to)));
  ok('"A reduce B" becomes an arrow', has('^Diuretics$', 'reduce', '^preload$'), JSON.stringify(f.edges.map(e => lab(e.from) + ' -' + e.verb + '-> ' + lab(e.to))));
  ok('"A raises B and causes C" gives A two arrows, not B→C', has('^Excessive preload$|^preload$', 'raises', 'venous pressure') &&
     has('preload', 'causes', 'congestion') && !has('venous pressure', 'causes', 'congestion'));
  ok('"…, resulting in D" hangs D off what came just before', has('gas exchange', 'resulting in', 'hypoxaemia'));
  ok('the same thing named twice is one box, which is what makes a chain',
     f.nodes.filter(n => /venous pressure/i.test(n.label)).length === 1 && has('venous pressure', 'leads to', 'oedema'));
  const src = text(CAUSAL).toLowerCase();
  ok('every word in every box is a word of the section', f.nodes.every(n => n.label.toLowerCase().split(/\s+/).every(w => src.indexOf(w) !== -1)),
     f.nodes.map(n => n.label).join(' | '));
  ok('a sentence with no cause-and-effect verb adds nothing', !f.nodes.some(n => /breathless|night|patient/i.test(n.label)));
  const ps = K.paths(f);
  ok('the paths start where nothing points in, and follow the arrows', ps.length >= 1 &&
     ps.some(p => /Diuretics/.test(lab(p[0].start)) && p.length >= 3), JSON.stringify(ps));
  const two = K.flow({ segments: [{ page: 1, heading: false, text: 'Diuretics reduce preload. Preload raises wall stress. Hypertension raises afterload. Afterload increases wall stress.' }] });
  const tp = K.paths(two);
  const tl = id => two.nodes.find(n => n.id === id).label;
  ok('every box nothing points into starts a path', ['Diuretics', 'Hypertension'].every(r => tp.some(p => tl(p[0].start) === r)),
     tp.map(p => tl(p[0].start)).join(', '));
  ok('and every arrow is on some path', two.edges.every(e => tp.some(p => p.some((st, i) => i > 0 && st.to === e.to && (p[i - 1].start === e.from || p[i - 1].to === e.from)))));
  /* Drawn as a tree, the shared start of two branches is one box. */
  const tr = K.tree(f);
  const count = {};
  (function walk(t) { count[t.id] = (count[t.id] || 0) + (t.again ? 0 : 1); t.next.forEach(b => walk(b.node)); })(tr[0]);
  ok('as a tree, every box is drawn once — the shared start is not repeated per branch', Object.values(count).every(n => n === 1) &&
     tr[0].next.length === 1 && tr[0].next[0].node.next.length === 2, JSON.stringify(count));
  const loop = K.tree({ nodes: [{ id: 0, label: 'a' }, { id: 1, label: 'b' }], edges: [{ from: 0, to: 1, verb: 'raises' }, { from: 1, to: 0, verb: 'lowers' }] });
  ok('a cycle ends at a reference back, not in an endless tree', loop.length === 1 && loop[0].next[0].node.next[0].node.again === true);
  /* Sentences that share words but state no cause: were any verb taken as a
     cause, they would chain, and the connection rule would keep them. */
  ok('sentences with no cause-and-effect verb make no flow, even when they share words',
     K.flow({ segments: [{ page: 1, heading: false, text: 'Preload is the stretch. The stretch is greatest in diastole. Diastole is ventricular filling.' }] }).edges.length === 0);
  ok('a section with no such sentences has no flow', K.flow({ segments: [{ page: 1, text: 'The heart has four chambers. It sits in the chest.' }] }).edges.length === 0);
}

head('flowcharts: clean boxes, connected pieces only');
{
  /* The owner's first real flowchart, sentence for sentence. */
  const USER = { segments: [{ page: 1, heading: false, text:
    'Both tricuspid stenosis (TS) and tricuspid regurgitation (TR) can produce typical symptoms of right-sided congestive heart failure in their advanced stages. ' +
    'Malignancy (eg, myxoma and metastases)\u2014Usually cause functional TS.' }] };
  ok('the owner\u2019s fragment boxes are gone', K.flow(USER).edges.length === 0, JSON.stringify(K.flow(USER).edges));
  /* Clean boxes, but two pairs with nothing between them — the connection
     rule on its own (above, the label cleaning already empties the owner's). */
  const pairs = K.flow({ segments: [{ page: 1, heading: false, text: 'Diuretics reduce preload. Hypertension raises afterload.' }] });
  ok('two unconnected pairs are not a flowchart', pairs.edges.length === 0, JSON.stringify(pairs.edges));
  const f = K.flow({ segments: [{ page: 1, heading: false, text: 'Rheumatic fever (RF) usually causes valve scarring. Valve scarring can lead to commissural fusion \u2014 the hallmark.' }] });
  const labels = f.nodes.map(n => n.label);
  ok('a chain of three is kept', f.edges.length === 2, labels.join(' | '));
  ok('boxes lose their brackets, dashes, modal verbs and adverbs',
     labels.every(l => !/[()\u2014]|\b(?:can|usually)$/i.test(l)) && labels.indexOf('Rheumatic fever') !== -1 && labels.indexOf('commissural fusion') !== -1, labels.join(' | '));
}

head('bullets: shorter, the key term first, nothing added');
{
  const F = require(path.join(ROOT, 'memorizer', 'src', 'format.js'));
  const b = F.bullet('Preload is the stretch on ventricular myocytes at the end of diastole.');
  ok('a definition leads with its term', b.lead === 'Preload' && b.body === 'the stretch on ventricular myocytes at the end of diastole', JSON.stringify(b));
  ok('filler and preamble go', F.bullet('However, it is important to note that diuretics reduce preload.').body === 'Diuretics reduce preload');
  ok('citations and figure references go', F.bullet('Diuretics reduce preload [12, 14] (see Figure 3).').body === 'Diuretics reduce preload');
  const semi = F.bullet('Afterload rises with hypertension; it falls with vasodilators; stenosis raises it.');
  ok('a long point splits at its semicolons into sub-bullets', semi.body === 'Afterload rises with hypertension' && semi.subs.length === 2, JSON.stringify(semi));
  ok('"This …" is not taken as a term to lead with', F.bullet('This relationship is the Frank-Starling mechanism.').lead === '');
  /* The lesson prompt asks Claude for "Term — explanation" points. */
  const dash = F.bullet('Preload \u2014 the stretch on myocytes at end-diastole.');
  ok('a point written "Term — …" leads with its term', dash.lead === 'Preload' && dash.body === 'the stretch on myocytes at end-diastole', JSON.stringify(dash));
  ok('so does "Term: …", and "…is…" later in it does not steal the lead', F.bullet('Causes of AS: calcific disease is the most common.').lead === 'Causes of AS');
  ok('a long run of words before a dash is not a term', F.bullet('The pressure in the left atrium rises steadily \u2014 and then the lungs congest.').lead === '');
  ok('the colon in a time is not a lead', F.bullet('Dose at 12:00 daily.').lead === '');
  ok('and a dash later than a definition does not steal its lead', F.bullet('Aortic stenosis is a narrowing \u2014 often calcific.').lead === 'Aortic stenosis');
  /* The rule the formatter lives by, over every sentence this suite has. */
  const all = [PRELOAD, AFTERLOAD, CONTRACT].map(c => K.sentences(c).map(x => x.text)).flat().concat([
    'However, it is important to note that diuretics reduce preload [12] (see Figure 3).', 'Afterload rises with hypertension; it falls with vasodilators.',
    'Preload \u2014 the stretch on myocytes at end-diastole.', 'Causes of AS: calcific disease is the most common.']);
  const norm = w => w.toLowerCase().replace(/[^a-z0-9\-]/g, '');
  const added = all.map(t => {
    const src = t.split(/\s+/).map(norm);
    const out = F.bullet(t);
    const got = [out.lead, out.body].concat(out.subs).join(' ').split(/\s+/).map(norm).filter(Boolean);
    return got.filter(w => src.indexOf(w) === -1);
  }).flat();
  ok('no word comes out that did not go in', added.length === 0, added.join(', ') || `${all.length} sentences`);
}

head('same shape over many generated sections');
{
  /* Random sections from the chunker's own pipeline: every coach output for
     each must pass its schema and rules, and every point must be verbatim. */
  let a = 7;
  const rnd = () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; };
  const VOCAB = ('pressure volume flow resistance cardiac output stroke heart rate ventricle atrium valve oxygen demand supply ' +
    'contraction relaxation filling ejection murmur pulse artery vein capillary tissue perfusion stenosis regurgitation hypertrophy 10 25 60 120 1.5').split(' ');
  const bad = [];
  let questions = 0;
  for (let n = 0; n < 60; n++) {
    const blocks = [{ text: 'Topic ' + n, page: 1, heading: true }];
    for (let b = 0; b < 3 + Math.floor(rnd() * 6); b++) {
      const sents = [];
      for (let k = 0; k < 2 + Math.floor(rnd() * 6); k++) {
        const len = 3 + Math.floor(rnd() * 20);
        sents.push(Array.from({ length: len }, () => VOCAB[Math.floor(rnd() * VOCAB.length)]).join(' ') + '.');
      }
      blocks.push({ text: sents.join(' '), page: 1 + b, heading: false });
    }
    const cs = Chunk.clusterBlocks(blocks, { min: 60, max: 200 });
    cs.forEach(c => {
      const l = K.lesson(c), q = K.quiz(c, l, cs), ex = K.exam(cs, [], [c.index], 5);
      questions += q.questions.length;
      const errs = [['lesson', l], ['exam', ex]].map(([k, v]) => { const m = P.validate(k, v); return m && k + ': ' + m; }).filter(Boolean);
      if (q.questions.length && P.validate('quiz', q)) errs.push('quiz: ' + P.validate('quiz', q));
      if (!l.points.every(p => c.text.indexOf(p.text) !== -1)) errs.push('lesson: a point is not verbatim');
      if (errs.length) bad.push(`doc ${n} cluster ${c.index}: ${errs[0]}`);
    });
  }
  ok('every lesson, drill and exam passes its schema and rules, points verbatim', bad.length === 0, bad[0] || '60 documents');
  ok('and the drills are not empty', questions > 100, questions + ' questions');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
