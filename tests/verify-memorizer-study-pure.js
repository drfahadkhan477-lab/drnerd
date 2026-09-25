#!/usr/bin/env node
/*
 * Studying beyond the drill: recall cards, checks days apart, timed
 * practice, confidence and cases — memorizer/src/study.js.
 *
 *   node tests/verify-memorizer-study-pure.js
 *
 * Pure Node, on sections written here from general cardiology — no page of
 * anyone's book. What is proven:
 *
 *   · A CLOZE CARD IS THE BOOK'S SENTENCE with its number (first) or key
 *     term blanked, and a typed answer is right, close or wrong by rules
 *     that never call a wrong number close.
 *   · IMAGE OCCLUSION hides one of the figure's own printed labels, offers
 *     it among the figure's others, and masks exactly where it was printed.
 *   · SECTION CHECKS fall at 1, 3, 7 and 21 days after the drill, one at a
 *     time however late, and a failed check starts the ladder again.
 *   · TIMED PRACTICE is about one question a minute, mixed from due cards,
 *     weak items and the hardest, never one twice, interleaved.
 *   · CONFIDENCE flags a sure-but-wrong answer, which is asked again; a
 *     right answer is Good whether or not "sure" was said.
 *   · A CASE from the model is taken only in the shape asked for.
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
global.MemCoach = require(path.join(ROOT, 'memorizer', 'src', 'coach.js'));
const S = require(path.join(ROOT, 'memorizer', 'src', 'study.js'));
const Pdf = (() => { const mod = { exports: {} }; const src = require('fs').readFileSync(path.join(ROOT, 'memorizer', 'src', 'pdf.js'), 'utf8');
  const root = {}; new Function('window', 'module', src)(root, mod); return root.MemPdf; })();

const cluster = (index, title, page, paras) => ({ index, title, pageStart: page, pageEnd: page, text: paras.join(' '),
  segments: paras.map(t => ({ text: t, page, heading: false })) });
const DOC = { id: 'u1', hasFile: true, clusters: [
  cluster(0, 'Preload', 1, ['Preload is the stretch on ventricular myocytes at the end of diastole.',
    'A left ventricular end-diastolic pressure greater than 18 mmHg suggests volume overload.',
    'Diuretics reduce preload by lowering circulating volume.']),
  cluster(1, 'Afterload', 2, ['Afterload is the wall stress the ventricle must overcome during ejection.',
    'Aortic stenosis raises afterload and the ventricle responds with concentric hypertrophy.']),
] };

head('cloze: the book’s sentence, its number or key term blanked');
{
  const n = S.clozeOf({ text: 'A left ventricular end-diastolic pressure greater than 18 mmHg suggests volume overload.', page: 1 });
  ok('a number is blanked first, with its unit, and the rest is the book’s sentence word for word', n && n.answer === '18 mmHg' &&
     n.front === 'A left ventricular end-diastolic pressure greater than _____ suggests volume overload.' && n.page === 1, JSON.stringify(n));
  const r = S.clozeOf({ text: 'Normal pulmonary capillary wedge pressure is 6 to 12 mmHg at rest.', page: 3 });
  ok('a range is one answer', r && r.answer === '6 to 12 mmHg', JSON.stringify(r && r.answer));
  const t = S.clozeOf({ text: 'Aortic stenosis raises afterload and the ventricle responds with concentric hypertrophy.', page: 2 }, global.MemCoach.frequencies(DOC.clusters[1]));
  ok('with no number, a key term of the section is blanked, as printed', t && /^[A-Za-z]+$/.test(t.answer) && t.answer.length >= 5 &&
     t.front.indexOf(S.BLANK) !== -1 && t.front.replace(S.BLANK, t.answer) === t.sentence, JSON.stringify(t));
  ok('a year or a list number is not a fact to learn', !S.clozeOf({ text: 'In 1998 the trial reported that aspirin reduced events in older adults.', page: 1 }) ||
     S.clozeOf({ text: 'In 1998 the trial reported that aspirin reduced events in older adults.', page: 1 }).answer !== '1998');
  ok('too short or too long a sentence makes no card', S.clozeOf({ text: 'Preload is 18 mmHg.' }) === null &&
     S.clozeOf({ text: ('word ').repeat(60) + '18 mmHg.' }) === null);
  const cards = S.clozeCards(DOC, 0);
  ok('a section gives at most ' + S.CLOZE_PER_SECTION + ' cards, the one with a number first, each its own sentence, filed under the section',
     cards.length === S.CLOZE_PER_SECTION && /\d/.test(cards[0].back) && cards[0].explain !== cards[1].explain &&
     cards.every(c => c.kind === 'cloze' && c.docId === 'u1' && c.cluster === 0 && c.title === 'Preload' && c.srs === null && c.front.indexOf(S.BLANK) !== -1),
     JSON.stringify(cards.map(c => c.back)));
  ok('the same section gives the same card ids, so a second drill does not duplicate them', JSON.stringify(S.clozeCards(DOC, 0).map(c => c.id)) === JSON.stringify(cards.map(c => c.id)));
  ok('no cards for a section that does not exist', S.clozeCards(DOC, 9).length === 0);
}

head('a typed answer: right, close, or wrong');
{
  const cases = [
    ['18 mmHg', '18 mmHg', 'right'], ['18mmhg', '18 mmHg', 'right'], ['18', '18 mmHg', 'close'], ['19 mmHg', '18 mmHg', 'wrong'], ['180 mmHg', '18 mmHg', 'wrong'],
    ['6-12 mmHg', '6 to 12 mmHg', 'right'], ['6 – 12 mmHg', '6 to 12 mmHg', 'right'], ['6-13 mmHg', '6 to 12 mmHg', 'wrong'],
    ['hypertrophy', 'hypertrophy', 'right'], ['Hypertrophy', 'hypertrophy', 'right'], ['hypertrophys', 'hypertrophy', 'right'],
    ['hypertrohpy', 'hypertrophy', 'wrong'], ['hypertrphy', 'hypertrophy', 'close'], ['dilation', 'hypertrophy', 'wrong'], ['', 'hypertrophy', 'wrong'],
    ['diuretics', 'Diuretics', 'right'], ['diuretic', 'Diuretics', 'right'],
  ];
  const bad = cases.filter(([t, a, want]) => S.checkTyped(t, a) !== want).map(([t, a, want]) => `"${t}" for "${a}" → ${S.checkTyped(t, a)} (not ${want})`);
  ok(`each of ${cases.length} typed answers is judged as it should be; a number is never "close"`, bad.length === 0, bad.join(' | '));
  ok('right is Good, close is Hard, wrong is Again', S.TYPED_RATING.right === 3 && S.TYPED_RATING.close === 2 && S.TYPED_RATING.wrong === 1);
}

head('image occlusion: the figure’s own label, hidden where it was printed');
{
  const fig = { page: 4, box: [100, 300, 500, 600], caption: 'Figure 2.1 The chambers of the heart', labels: [
    { text: 'Left atrium', box: [120, 540, 180, 552] }, { text: 'Right atrium', box: [320, 540, 390, 552] },
    { text: 'Left ventricle', box: [120, 380, 200, 392] }, { text: 'Right ventricle', box: [320, 380, 410, 392] }, { text: 'Aorta', box: [220, 570, 250, 582] }] };
  const o = S.occlusionOf(fig, 2);
  ok('the k-th label is hidden, and it is among four options with three of the figure’s others', o && o.hidden.text === 'Left ventricle' &&
     o.options.length === 4 && o.options[o.answer] === 'Left ventricle' && new Set(o.options).size === 4 &&
     o.options.every(t => fig.labels.some(l => l.text === t)), JSON.stringify(o && o.options));
  const m = S.maskOf(fig.box, [120, 380, 200, 392]);
  ok('the mask sits where the label was printed, as fractions from the top left (PDF boxes count up), padded',
     Math.abs(m.left - 18 / 400) < 1e-9 && Math.abs(m.width - 84 / 400) < 1e-9 && Math.abs(m.top - 206 / 300) < 1e-9 && Math.abs(m.height - 16 / 300) < 1e-9, JSON.stringify(m));
  ok('different k, different label; the right option is not always first', S.occlusionOf(fig, 0).hidden.text === 'Left atrium' &&
     new Set([0, 1, 2, 3, 4].map(k => S.occlusionOf(fig, k).answer)).size > 1);
  const few = Object.assign({}, fig, { labels: fig.labels.slice(0, 3) });
  ok('fewer than ' + S.OCCLUDE_MIN + ' labels: nothing to choose among, no card', S.occlusionOf(few, 0) === null);
  const dup = Object.assign({}, fig, { labels: fig.labels.slice(0, 3).concat([{ text: 'left atrium', box: [1, 1, 2, 2] }, { text: '12', box: [1, 1, 2, 2] }]) });
  ok('a repeated label or a bare number is not a fourth label', S.occlusionOf(dup, 0) === null);
  const cards = S.occlusionCards(DOC, 0, [few, fig]);
  ok('one card per section, from its first figure that has enough labels, with the figure and mask to draw it', cards.length === 1 &&
     cards[0].kind === 'occlusion' && cards[0].figure.page === 4 && cards[0].mask && cards[0].options.length === 4 && cards[0].back === cards[0].options[cards[0].answer],
     JSON.stringify(cards.map(c => c.back)));
}

head('the labels pdf.js keeps: short text printed inside the picture');
{
  const H = 792;
  const L = (text, y, cells) => ({ text, y, size: 9, cells: cells || [{ x: 120, text }] });
  const lines = [L('Left atrium', H - 545), L('Right ventricle', H - 385, [{ x: 330, text: 'Right ventricle' }]),
    L('Figure 2.1 Chambers', H - 320, [{ x: 110, text: 'Figure 2.1 Chambers' }]),   /* short, inside the box: only the caption rule keeps it out */ L('A long line of prose that is plainly a sentence and not a label at all.', H - 450),
    L('Outside the box', H - 700), L('Far right', H - 450, [{ x: 520, text: 'Far right' }])];
  const got = Pdf.labelsIn([100, 300, 500, 600], lines, H);
  ok('a short line inside the box is a label; the caption, a sentence, a line outside and a cell beyond its right edge are not',
     JSON.stringify(got.map(l => l.text)) === '["Left atrium","Right ventricle"]', JSON.stringify(got.map(l => l.text)));
  ok('each label’s box is in PDF units at its baseline, as wide as its letters', got[0].box[0] === 120 && Math.abs(got[0].box[1] - (545 - 9 * 0.25)) < 1e-9 &&
     got[0].box[2] > got[0].box[0] + 30 && got[0].box[3] > got[0].box[1], JSON.stringify(got[0].box));
}

head('section checks: 1, 3, 7 and 21 days after the drill');
{
  const rec = { start: '2026-09-01', done: [] };
  ok('the first check is the day after the drill', S.nextCheck(rec) === '2026-09-02');
  ok('then 3, 7 and 21 days after it, and none after the fourth', S.nextCheck({ start: '2026-09-01', done: ['a'] }) === '2026-09-04' &&
     S.nextCheck({ start: '2026-09-01', done: ['a', 'b'] }) === '2026-09-08' && S.nextCheck({ start: '2026-09-01', done: ['a', 'b', 'c'] }) === '2026-09-22' &&
     S.nextCheck({ start: '2026-09-01', done: ['a', 'b', 'c', 'd'] }) === null);
  const recs = { 'u1:0': { start: '2026-09-01', done: [] }, 'u1:1': { start: '2026-09-20', done: [] }, 'u2:0': { start: '2026-08-01', done: ['x'] }, 'u3:0': { start: '2026-09-22', done: [] } };
  const due = S.checksDue(recs, '2026-09-22');
  ok('due today or overdue, most overdue first; not yet due is not listed', JSON.stringify(due.map(d => d.key)) === '["u2:0","u1:0","u1:1"]', JSON.stringify(due.map(d => d.key + '@' + d.due)));
  const passedRec = S.checkTaken({ start: '2026-09-01', done: [] }, '2026-09-10', 2 / 3);
  ok('a check passed late is one check, not several: the ladder steps once', passedRec.done.length === 1 && passedRec.start === '2026-09-01' && S.nextCheck(passedRec) === '2026-09-04');
  const failedRec = S.checkTaken({ start: '2026-09-01', done: ['2026-09-02', '2026-09-04'] }, '2026-09-10', 1 / 3);
  ok('a failed check starts the ladder again from today', failedRec.start === '2026-09-10' && failedRec.done.length === 0 && S.nextCheck(failedRec) === '2026-09-11' &&
     JSON.stringify(failedRec.scores) === JSON.stringify([1 / 3]));
  const qs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  ok('each check asks ' + S.CHECK_SIZE + ' of the section’s own questions, different ones each time', JSON.stringify(S.checkQuestions(qs, 0)) === '["a","b","c"]' &&
     JSON.stringify(S.checkQuestions(qs, 1)) === '["d","e","f"]' && JSON.stringify(S.checkQuestions(qs, 2)) === '["g","a","b"]' &&
     S.checkQuestions(['a'], 0).length === 1 && S.checkQuestions([], 0).length === 0);
}

head('timed practice: about one a minute, mixed and interleaved');
{
  const mk = (kind, n) => Array.from({ length: n }, (_, i) => ({ id: kind + i, kind }));
  const set = S.timedSet({ due: mk('due', 20), weak: mk('weak', 20), hard: mk('hard', 20) }, 12);
  const count = k => set.filter(q => q.kind === k).length;
  ok('12 minutes, 12 questions: half due, a third weak, the rest hardest', set.length === 12 && count('due') === 6 && count('weak') === 4 && count('hard') === 2,
     `${count('due')}/${count('weak')}/${count('hard')}`);
  ok('interleaved: no two due cards side by side while other kinds are left', set.slice(0, 6).map(q => q.kind).join() === 'due,weak,hard,due,weak,hard', set.map(q => q.kind).join());
  const short = S.timedSet({ due: mk('due', 1), weak: mk('weak', 20), hard: [] }, 10);
  ok('a kind that runs short gives its places to the others', short.length === 10 && short.filter(q => q.kind === 'due').length === 1, short.map(q => q.kind).join());
  const same = S.timedSet({ due: [{ id: 'x', kind: 'due' }], weak: [{ id: 'x', kind: 'weak' }], hard: [] }, 5);
  ok('never the same question twice', same.length === 1);
  const tr = S.practiceTrend([{ day: 'a', right: 5, asked: 10 }, { day: 'b', right: 0, asked: 0 }, { day: 'c', right: 8, asked: 10 }]);
  ok('the trend: scores in order, an empty run left out, and up on the one before', JSON.stringify(tr.pct) === '[50,80]' && tr.dir === 'up' &&
     S.practiceTrend([{ day: 'a', right: 3, asked: 4 }]).dir === 'first' &&
     S.practiceTrend([{ day: 'a', right: 3, asked: 4 }, { day: 'b', right: 1, asked: 4 }]).dir === 'down');
  ok('only the last seven', S.practiceTrend(Array.from({ length: 10 }, (_, i) => ({ day: 'd' + i, right: i, asked: 10 }))).pct.length === 7);
}

head('confidence: said before answering, and it changes the rating');
{
  const a = S.rateWith(true, true), b = S.rateWith(true, false), c = S.rateWith(false, false), d = S.rateWith(false, true);
  ok('right is Good, sure or not — not saying is not doubt', a.rating === 3 && b.rating === 3 && !a.again && !b.again && !a.hazard && !b.hazard);
  ok('wrong is Again; sure and wrong is also flagged and asked again', c.rating === 1 && !c.again && !c.hazard && d.rating === 1 && d.again && d.hazard);
}

head('a case by the model, taken only in the shape asked for');
{
  const good = JSON.stringify({ case: 'A 70-year-old has exertional breathlessness.', question: 'What raises afterload here?', options: ['Aortic stenosis', 'Diuretics', 'Preload', 'Nitrates'], answer: 0 });
  const v = S.parseVignette(good);
  ok('a case and a question with four options, the case kept as the question’s quote', v && v.quote === 'A 70-year-old has exertional breathlessness.' && v.options.length === 4 && v.answer === 0);
  ok('anything else is thrown away', S.parseVignette('not json') === null && S.parseVignette(JSON.stringify({ case: 'x', question: 'y', options: ['a', 'b'], answer: 0 })) === null &&
     S.parseVignette(JSON.stringify({ case: 'x', question: 'y', options: ['a', 'b', 'c', 'd'], answer: 7 })) === null &&
     S.parseVignette(JSON.stringify({ question: 'y', options: ['a', 'b', 'c', 'd'], answer: 0 })) === null);
  const p = S.vignettePrompt('Afterload', [{ text: 'Aortic stenosis raises afterload.' }]);
  ok('the prompt gives the section’s own sentences and asks for an answer they state', /Aortic stenosis raises afterload\./.test(p) && /stated in one of the sentences above/.test(p));
}

head('an exam date, read from what was typed');
{
  const T = '2026-09-24';
  const cases = [
    ['2026-11-02', '2026-11-02'], ['my exam is on 10 October', '2026-10-10'], ['10th October', '2026-10-10'], ['October 10', '2026-10-10'], ['oct 10th, 2027', '2027-10-10'],
    ['exam on 3 March', '2027-03-03'], ['10/10', '2026-10-10'], ['3/11/2026', '2026-11-03'], ['in 10 days', '2026-10-04'], ['in 3 weeks', '2026-10-15'],
    ['in 2 months', '2026-11-24'], ['tomorrow', '2026-09-25'], ['24 September', '2026-09-24'], ['31 February', null], ['sometime soon', null],
  ];
  const bad = cases.filter(([t, want]) => S.parseExamDate(t, T) !== want).map(([t, want]) => `"${t}" → ${S.parseExamDate(t, T)} (not ${want})`);
  ok(`each of ${cases.length} ways of saying a date is read as it should be; a day and month already past means next year; day first`, bad.length === 0, bad.join(' | '));
  ok('a month without that day ends on its last day', S.parseExamDate('in 1 month', '2026-01-31') === '2026-02-28');
}

head('a plan to the exam, from where you are');
{
  const u = (docId, done) => ({ docId, name: docId, sections: done.map((d, i) => ({ ci: i, title: docId + i, done: d })) });
  const p = S.studyPlan([u('a', [true, false, false, false]), u('b', [false, false, false])], '2026-09-24', '2026-10-04');
  ok('ten days: two kept for review, the six sections left over the other eight, in order, the first today', p.daysLeft === 10 && p.reviewDays === 2 && p.learnDays === 8 &&
     p.perDay === 1 && p.days.length === 10 && p.days[0].day === '2026-09-24' && p.days[0].learn[0].title === 'a1' && p.days[5].learn[0].title === 'b2' &&
     p.days.slice(6).every(d => !d.learn.length && d.review) && p.fits && p.todo === 6, JSON.stringify(p.days.map(d => d.learn.map(x => x.title).join('+') || 'review')));
  const tight = S.studyPlan([u('a', [false, false, false, false, false, false, false])], '2026-09-24', '2026-09-27');
  ok('three days, seven sections: one day kept for review, the rest packed, and it says how many a day', tight.reviewDays === 1 && tight.perDay === 4 &&
     tight.days[0].learn.length === 4 && tight.days[1].learn.length === 3 && tight.days[2].review, JSON.stringify(tight.days.map(d => d.learn.length)));
  const one = S.studyPlan([u('a', [false, false])], '2026-09-24', '2026-09-25');
  ok('one day: no review day, everything today', one.reviewDays === 0 && one.days[0].learn.length === 2);
  const done = S.studyPlan([u('a', [true, true])], '2026-09-24', '2026-09-30');
  ok('everything learned: every day is review', done.todo === 0 && done.days.every(d => d.review && !d.learn.length));
  ok('the exam today, or past: no days to plan, and past is said', S.studyPlan([u('a', [false])], '2026-09-24', '2026-09-24').daysLeft === 0 &&
     S.studyPlan([u('a', [false])], '2026-09-24', '2026-09-20').past === true);
}

head('teach it back: what you covered, what you left out');
{
  const pts = ['Preload is the stretch on ventricular myocytes at the end of diastole.', 'Diuretics reduce preload by lowering circulating volume.',
    'A left ventricular end-diastolic pressure greater than 18 mmHg suggests volume overload.'];
  const r = S.teachBack('Preload is how much the ventricular myocytes stretch by the end of diastole; diuretics lower it by reducing circulating volume. Above 19 mmHg means overload.', pts, pts.join(' '));
  ok('points whose words are mostly in your explanation are covered; the rest are named', JSON.stringify(r.covered) === '[0,1]' && JSON.stringify(r.missed) === '[2]', JSON.stringify(r));
  ok('a number you gave that the section does not have is named', JSON.stringify(r.wrong) === '["19"]');
  ok('the right number is not', S.teachBack('greater than 18 mmHg', pts, pts.join(' ')).wrong.length === 0);
  ok('nothing said covers nothing', S.teachBack('', pts, pts.join(' ')).covered.length === 0 && S.teachBack('', pts, '').score === 0);
}

head('where each sentence of the model’s answer came from');
{
  const steps = [{ turn: { found: 'Preload', r: { found: true, groups: [{ items: [{ text: 'x', page: 3 }] }] } } }, { turn: { at: { sec: { title: 'Afterload', pageStart: 7 } } } }];
  const got = S.claimSources([{ text: 'A.', cites: [1] }, { text: 'B.', cites: [2, 1] }, { text: 'C.', cites: [9] }], steps);
  ok('a search step gives its passage’s page; a section step gives its section; a step that is not there gives nothing',
     JSON.stringify(got.map(k => k.sources.map(x => x.title + ':' + x.page))) === JSON.stringify([['Preload:3'], ['Afterload:7', 'Preload:3'], []]), JSON.stringify(got));
}

head('correcting what text recognition misread');
{
  const doc = JSON.parse(JSON.stringify(DOC));
  const fixed = S.correctSegment(doc, 0, 1, 'A left ventricular end-diastolic pressure greater than 18 mmHg suggests volume overload, corrected.', '2026-09-24');
  ok('the paragraph is replaced, the section’s text rebuilt from its paragraphs, and the correction kept with what it said before',
     fixed.clusters[0].segments[1].text.endsWith('corrected.') && fixed.clusters[0].segments[1].corrected === true &&
     fixed.clusters[0].text === fixed.clusters[0].segments.map(x => x.text).join(' ') && fixed.corrections.length === 1 &&
     fixed.corrections[0].was === DOC.clusters[0].segments[1].text && fixed.corrections[0].ci === 0 && fixed.corrections[0].si === 1 && fixed.corrections[0].at === '2026-09-24');
  ok('the unit it was given is not changed', doc.clusters[0].segments[1].text === DOC.clusters[0].segments[1].text && !doc.corrections);
  ok('nothing to correct: the same text, an empty one, a heading, or a paragraph that is not there', S.correctSegment(doc, 0, 1, DOC.clusters[0].segments[1].text) === null &&
     S.correctSegment(doc, 0, 1, '   ') === null && S.correctSegment(doc, 0, 9, 'x') === null &&
     S.correctSegment({ clusters: [{ segments: [{ text: 'H', heading: true }] }] }, 0, 0, 'y') === null);
  const conf = S.pageConfidence([{ confidence: 90 }, { confidence: 80 }, { confidence: 20 }, { confidence: NaN }, null], 30);
  ok('a page’s confidence: the mean of its words, and how many were too unsure to keep', conf.mean === 63 && conf.words === 3 && conf.dropped === 1, JSON.stringify(conf));
  ok('a page with no words has none', S.pageConfidence([], 30) === null);
}

head('your notes and highlights: kept as yours, and a marked point is asked for');
{
  let r = S.toggleMark(null, 'Diuretics reduce preload by lowering circulating volume.');
  ok('marking a point keeps it; marking it again unmarks it; the note is kept either way', r.marks.length === 1 &&
     S.toggleMark(Object.assign({}, r, { text: 'mine' }), r.marks[0]).marks.length === 0 && S.toggleMark({ text: 'mine', marks: [] }, 'x').text === 'mine');
  const c = S.markCard(DOC, 0, 'A left ventricular end-diastolic pressure greater than 18 mmHg suggests volume overload.');
  ok('a marked point becomes a cloze card of the book’s sentence, filed as yours, with its page', c && c.kind === 'cloze' && c.source === 'mark' && c.back === '18 mmHg' && c.page === 1 && c.cluster === 0);
  ok('a point that cannot be made a card makes none', S.markCard(DOC, 0, 'Too short.') === null);
  ok('notes are filed by unit and section', S.noteKey('u1', 3) === 'u1:3');
}

head('a table, row by row');
{
  const qs = [{ kind: 'table', question: 'a' }, { kind: 'term', question: 'b' }].concat(Array.from({ length: 10 }, (_, i) => ({ kind: 'table', question: 't' + i })));
  const r = S.tableRound(qs);
  ok('only the table’s questions, in its order, up to ' + S.TABLE_ROUND, r.length === S.TABLE_ROUND && r.every(q => q.kind === 'table') && r[0].question === 'a' && r[1].question === 't0');
}

head('the mastery map: each section new, weak, fading or solid');
{
  const fs = require('fs');
  const mod = {}; new Function('module', 'exports', fs.readFileSync(path.join(ROOT, 'src', 'core', 'fsrs.js'), 'utf8')).call(mod, { exports: mod }, mod);
  const FSRS = mod.FSRS, T = '2026-09-24';
  const docs = [{ id: 'u', name: 'U', clusters: [0, 1, 2, 3, 4].map(i => ({ title: 'S' + i })) }];
  const sessions = { u: { per: { 0: { done: false }, 1: { done: true, score: 0.5 }, 2: { done: true, score: 1 }, 3: { done: true, score: 1 }, 4: { done: true, score: 0.9 } } } };
  const card = (ci, stab, last) => ({ docId: 'u', cluster: ci, srs: { stability: stab, last } });
  const cards = [card(3, 100, T), card(4, 2, '2026-09-10')];
  const m = S.masteryMap(docs, sessions, cards, T, FSRS)[0].sections;
  ok('not drilled is new; drilled badly is weak; drilled well with no card reviewed is solid', m[0].state === 'new' && m[1].state === 'weak' && m[2].state === 'solid');
  ok('with reviewed cards, today’s recall decides: high is solid, a card left too long fades', m[3].state === 'solid' && m[3].recall >= 90 &&
     (m[4].state === 'fading' || m[4].state === 'weak') && m[4].recall < 90, JSON.stringify(m.map(x => x.state + ':' + x.recall)));
  const r4 = FSRS.retrievability(2, FSRS.daysBetween('2026-09-10', T));
  ok('its recall is FSRS’s own for today', m[4].recall === Math.round(100 * r4) && m[4].state === (r4 >= S.SOLID ? 'solid' : r4 >= S.FADING ? 'fading' : 'weak'));
}

head('the week in numbers');
{
  const base = Date.UTC(2026, 8, 24, 9, 0, 0);
  let log = null;
  log = S.logActivity(log, '2026-09-24', 'answer', { correct: true, now: base, source: 'drill' });
  log = S.logActivity(log, '2026-09-24', 'answer', { correct: false, title: 'Preload', now: base + 60000 });
  log = S.logActivity(log, '2026-09-24', 'review', { now: base + 2 * 60000 });
  log = S.logActivity(log, '2026-09-24', 'answer', { correct: false, title: 'Preload', now: base + 60 * 60000 });   /* after a break */
  log = S.logActivity(log, '2026-09-15', 'answer', { correct: true, now: base - 9 * 86400000 });
  const w = S.weekly(log, '2026-09-24');
  ok('time counts the gaps between things done, a long gap as a break', log.days['2026-09-24'].ms === 2 * 60000 + S.IDLE_MS, String(log.days['2026-09-24'].ms));
  ok('this week: answers, accuracy, reviews, days, and the weakest topics', w.week.answers === 3 && w.week.accuracy === 33 && w.week.reviews === 1 && w.week.days === 1 &&
     JSON.stringify(w.week.weakest) === '["Preload"]' && w.week.minutes === 5, JSON.stringify(w.week));
  ok('the week before, apart', w.before.answers === 1 && w.before.accuracy === 100 && w.before.days === 1);
  ok('each answer counted where it was given, when said', JSON.stringify(log.days['2026-09-24'].by) === '{"drill":1}');
  const old = S.logActivity(log, '2026-12-01', 'review', {});
  ok('a log keeps about eight weeks', !old.days['2026-09-24'] && !!old.days['2026-12-01']);
  ok('the log it was given is not changed', !log.days['2026-12-01']);
}

head('a streak that forgives one day a week');
{
  const T = '2026-09-24';   /* a Thursday */
  const st = (d) => S.streak(d, T);
  ok('days in a row, today included', st(['2026-09-22', '2026-09-23', T]).n === 3 && st(['2026-09-22', '2026-09-23', T]).frozen.length === 0);
  ok('today not studied yet: counted to yesterday', st(['2026-09-22', '2026-09-23']).n === 2);
  ok('one missed day is bridged by a freeze, and said', JSON.stringify(st(['2026-09-20', '2026-09-21', '2026-09-23', T])) === JSON.stringify({ n: 4, frozen: ['2026-09-22'] }));
  ok('two missed days in a row end it', st(['2026-09-20', '2026-09-23', T]).n === 2);
  ok('one freeze a week: a second gap in the same week ends it', st(['2026-09-21', '2026-09-23', T]).n === 3 && st(['2026-09-21', '2026-09-23', T]).frozen.length === 1 &&
     JSON.stringify(st(['2026-09-20', '2026-09-22', T])) === JSON.stringify({ n: 2, frozen: ['2026-09-23'] }));
  ok('a gap in each of two weeks: both bridged', st(['2026-09-17', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-23', T]).frozen.length === 2 &&
     st(['2026-09-17', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-23', T]).n === 6);
  ok('yesterday missed, today still open: the streak stands, with a freeze', JSON.stringify(st(['2026-09-21', '2026-09-22'])) === JSON.stringify({ n: 2, frozen: ['2026-09-23'] }));
  ok('nothing studied, no streak', st([]).n === 0 && S.weekOf('2026-09-24') === '2026-09-21' && S.weekOf('2026-09-27') === '2026-09-21' && S.weekOf('2026-09-28') === '2026-09-28');
}

head('days, stepped in UTC');
{
  ok('across a month and a year', S.addDays('2026-01-31', 1) === '2026-02-01' && S.addDays('2026-12-31', 1) === '2027-01-01' && S.daysFrom('2026-09-01', '2026-09-22') === 21);
}

head('Socratic chains, the pack’s rubric, exam conditions and the dock’s next thing (phases 3 and 4)');
{
  const path_ = [{ label: 'Calcific degeneration' }, { verb: 'causes', label: 'valve narrowing' }, { verb: 'raises', label: 'afterload' }];
  const sc = S.socratic(path_, '');
  ok('down the book’s chain, a link at a time: each answer is the next step', sc.source === 'book' && sc.steps.length === 3 &&
     sc.steps[0].ask === 'Calcific degeneration causes … what?' && sc.steps[0].answer === 'valve narrowing' && sc.steps[1].answer === 'afterload', JSON.stringify(sc.steps));
  ok('then the whole chain, in the book’s verbs', /Calcific degeneration causes valve narrowing raises afterload/.test(sc.steps[2].answer));
  ok('a chain of two is too short to ask down; a mechanism is used instead', S.socratic(path_.slice(0, 2), 'The valve narrows. Afterload rises and the wall thickens.').source === 'lesson');
  const ms = S.socratic([], 'The valve narrows. Afterload rises; the wall thickens. Then the ventricle stiffens and filling fails.');
  ok('a mechanism sentence by sentence, asked in order', ms.steps.length >= 3 && ms.steps[0].answer === 'The valve narrows.' && ms.steps[0].ask === 'Where does it start?', JSON.stringify(ms.steps.map(x => x.answer)));
  ok('nothing to ask down, nothing asked', S.socratic([], '') === null && S.socratic(null, 'One sentence only.') === null);
  const rb = S.rubricOf([{ text: 'Point A', page: 1 }], { pearls: [{ text: 'Pearl B', page: 2 }, { text: 'point a', page: 1 }], mechanism: 'It starts at the valve. Then the wall thickens.' });
  ok('a pack’s rubric: the points, the pearls, the mechanism sentence by sentence, each once', JSON.stringify(rb.map(x => x.text)) === JSON.stringify(['Point A', 'Pearl B', 'It starts at the valve.', 'Then the wall thickens.']), JSON.stringify(rb));
  ok('without a pack’s extras the rubric is the points', JSON.stringify(S.rubricOf([{ text: 'P', page: 1 }], {})) === JSON.stringify([{ text: 'P', page: 1 }]));
  const ck = S.examClock(0, 200000, 10, 1);
  ok('exam conditions: the time taken against a board’s ninety seconds a question', ck.elapsed === '3:20' && ck.target === '15:00' && ck.left === '11:40' && ck.behind && !ck.over, JSON.stringify(ck));
  ok('on pace is not behind; past the total is over', !S.examClock(0, 60000, 10, 0).behind && S.examClock(0, 901000, 10, 9).over && S.EXAM_PACE_S === 90);
  const st = (phase, per) => ({ phase, section: 0, per: [per || {}] });
  ok('the dock’s next thing follows the screen', S.contextAction(st('unit')).id === 'learn' && S.contextAction(st('unit'), true).id === 'exam' &&
     S.contextAction(st('teach', { lesson: {} })).id === 'memorise' && S.contextAction(st('teach', { lesson: {}, memorized: true })).id === 'drill' &&
     S.contextAction(st('result')).id === 'next' && S.contextAction(st('done')).id === 'sections');
  ok('and is nothing while a question is being answered, or before the lesson is there', S.contextAction(st('drill')) === null && S.contextAction(st('exam')) === null &&
     S.contextAction(st('memorize')) === null && S.contextAction(st('teach', {})) === null && S.contextAction(null) === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
