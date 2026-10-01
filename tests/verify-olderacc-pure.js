#!/usr/bin/env node
'use strict';
/*
 * tools/older-acc.js turns the lines of an older ACC question-bank PDF into
 * questions, drops the ones the bank already has, and writes the rest in the
 * bank's own shape: is each rule doing what it says, on lines built to test it?
 *
 *   node tests/verify-olderacc-pure.js
 *
 * The PDFs are licensed and never read here, so every line below is invented,
 * in the three layouts tools/pdf-shape.js reported — a "Question" heading over
 * a numbered stem with "Answer" and "Key point" lines; an OCR-like "9 . " stem
 * with "a . " options and a short answer line; a large "99. " stem with
 * "a.  " options — plus the ways a parse goes wrong: a numbered reference list
 * that is not a question, a dose that looks like a number, a heading with no
 * question under it, a page of option-like lines with no stem, a question
 * whose answer is nowhere. Every invented word that could leak carries a
 * marker, and the report the importer prints is checked for all of them.
 */
const A = require('../tools/older-acc.js');
const { check } = require('../scripts/content-checks.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

/* A line, and a page of them. Body text sits between y 90 and 700 on a
   792-point page; the running footer sits in the bottom tenth. */
const L = (y, text, o = {}) => ({ y, text, x0: 72, x1: 500, size: 11, font: 'Times-Roman', bold: false, ink: 'rgb~0,0,0', ...o });
const B = { font: 'Times-Bold', bold: true };
const FOOT = [L(40, 'ZQFOOTER'), L(28, '9/9/2014'), L(760, '12')];
const page = (p, lines, extra = {}) => extra.noText ? { p, w: 612, h: 792, y0: 0, ...extra }
  : { p, w: 612, h: 792, y0: 0, lines: [...lines, ...FOOT.map(l => ({ ...l, text: l.text === '12' ? String(p) : l.text }))], ...extra };

/* ── the heading layout (SECOND) ───────────────────────────────────────── */
const second = [
  page(1, [
    L(700, 'Question', { ...B, ink: 'rgb~224,0,0' }),
    L(686, '7. A zqstem patient with quimbly flarn and a vexing trellic murmur on day nine.', B),
    L(672, 'The wibbet shows plonk; which step is next?', B),
    L(650, 'A.  Glarb the zqfrob', B),
    L(636, 'B.  Snorkel the vint and then', B),
    L(624, 'continue with the zqtrask', { ...B, x0: 90 }),
    L(610, 'C.  Mimble', B),
    L(596, 'D.  Plitz', B),
    L(570, 'Answer'),
    L(556, 'C'),
    L(530, 'Key point'),
    L(516, 'Zqexplain: mimble is right because of the physiology.'),
  ]),
  page(2, [
    L(700, 'Question', { ...B, ink: 'rgb~224,0,0' }),
    L(686, '8. A second zqstem about a harrowing snib in the left plenth.', B),
    L(650, 'A.  Frizzle', B),
    L(636, 'B.  Quorp', B),
    L(622, 'C.  Dandle', B),
    L(560, 'Answer: B. Quorp'),
    L(540, 'Key point'),
    L(526, 'Zqexplain for the second one.'),
    L(500, 'Numbered references follow, and none is a question:'),
    L(486, '1. Smith J. A zqref paper about snibs. J Plenth. 2001;3:4.'),
    L(472, '2. Jones K. Another zqref paper. Plenth Rev. 2003;5:6.'),
    L(458, '2.5 mg of zqdose given twice daily was the dose studied.'),
  ]),
  page(3, [
    L(700, 'Question', { ...B, ink: 'rgb~224,0,0' }),
    L(686, '9. A third zqstem whose answer is written out in words.', B),
    L(650, 'A.  Zqtrombal', B),
    L(636, 'B.  Amiodarone zqword', B),
    L(622, 'C.  Zqflecker', B),
    L(600, 'Answer: Amiodarone zqword'),
    L(580, 'Key point'),
    L(566, 'The correct answer is a beta-blocker in most zqcases, the text says.'),
  ]),
  page(4, [
    L(700, 'Question', { ...B, ink: 'rgb~224,0,0' }),
    L(686, '10. A fourth zqstem that the page never answers anywhere.', B),
    L(650, 'A.  Zqone', B),
    L(636, 'B.  Zqtwo', B),
    L(622, 'C.  Zqthree', B),
    L(600, 'Some zqtrailing words that name no letter at all.'),
  ]),
  page(5, [
    L(700, 'Question', { ...B, ink: 'rgb~224,0,0' }),
    L(686, 'An unnumbered heading whose zqstem never reaches any options.'),
    L(660, 'More zqorphan text under it.'),
    L(600, 'Question', { ...B, ink: 'rgb~224,0,0' }),
    L(586, '11. A zqstem whose second line opens with the letters', B),
    L(572, 'A.V. block, which is part of the stem and not option A.', B),
    L(560, 'A.  Zqpace', B),
    L(546, 'B.  Zqwait', B),
    L(520, 'Answer'),
    L(506, 'So the correct answer is B, as the zqkey says.'),
  ]),
  page(6, [], { noText: true }),
];
/* The page-5 orphan heading is followed at once by the next heading, whose
   stem does parse. */

head('the kind of each line');
{
  const k = t => A.lineKind(t).k;
  ok('a "Question" heading, alone or numbered, is a heading', k('Question') === 'HEAD' && k('QUESTION 12') === 'HEAD');
  ok('"9. A …" and "9 . A …" and "12) …" are stems', k('9. A man') === 'NUM' && k('9 . A man') === 'NUM' && k('12) A man') === 'NUM');
  ok('"2.5 mg …" is not a stem', k('2.5 mg of it') !== 'NUM', k('2.5 mg of it'));
  ok('"A.", "a . " and "(b)" are options, lettered from zero', A.lineKind('A.  x').L === 0 && A.lineKind('a . x').L === 0 && A.lineKind('(b) x').L === 1);
  ok('"A.V. block …" is not option A', k('A.V. block at rest') !== 'OPT', k('A.V. block at rest'));
  ok('"Answer", "Answer: B" and "Correct answer is C" are answer lines',
     k('Answer') === 'ANS' && A.lineKind('Answer: B').rest === 'B' && A.lineKind('Correct answer is C').rest === 'C');
  ok('"Answers to …" is not an answer line', k('Answers to the quiz') !== 'ANS');
  ok('"Key point" and "Explanation:" are explanation headings', k('Key point') === 'KEY' && k('Explanation: x') === 'KEY');
}

head('where an answer is stated');
{
  ok('a bare or dressed letter is a short answer', A.shortAnswer('c', 4) === 2 && A.shortAnswer('(c)', 4) === 2 && A.shortAnswer('Ans: b', 4) === 1 && A.shortAnswer('D.', 4) === 3);
  ok('but not past the last option, and not a sentence', A.shortAnswer('e', 4) === -1 && A.shortAnswer('a zqlong line of words', 4) === -1);
  ok('after "Answer": "B", "B. text", "(c)", "Option D"', A.letterFrom('B', 4) === 1 && A.letterFrom('B. Quorp', 4) === 1 && A.letterFrom('(c)', 4) === 2 && A.letterFrom('Option D', 4) === 3);
  ok('"a beta-blocker" after "Answer" is the article, not option A', A.letterFrom('a beta-blocker', 4) === -1);
  ok('"The correct answer is B" and "(d)" are read; "is a beta-blocker" is not',
     A.sentenceAnswer('The correct answer is B.', 4) === 1 && A.sentenceAnswer('the correct answer is (d) here', 4) === 3 &&
     A.sentenceAnswer('The correct answer is a beta-blocker.', 4) === -1);
  ok('the option\'s own words, when exactly one option matches', A.answerByText('Quorp', [{ t: 'Frizzle' }, { t: 'Quorp' }]) === 1 &&
     A.answerByText('Quorp', [{ t: 'Quorp' }, { t: 'Quorp' }]) === -1);
  ok('one option inked apart from the rest is the ink answer', A.inkAnswer(['rgb~0,0,0', 'rgb~0,128,0', 'rgb~0,0,0', 'rgb~0,0,0']) === 1);
  ok('but not when two differ, or when ink was not sampled', A.inkAnswer(['rgb~0,0,0', 'rgb~0,128,0', 'rgb~0,128,0', 'rgb~0,0,0']) === -1 &&
     A.inkAnswer(['', 'rgb~0,128,0', '', '']) === -1);
}

head('running headers and footers');
{
  const { pages, dropped } = A.stripRunning(second);
  const left = pages.flatMap(pg => (pg.lines || []).map(l => l.text));
  ok('a footer on every page is dropped, and so is the page number', !left.includes('ZQFOOTER') && !left.includes('9/9/2014') && !left.includes('3'),
     `${dropped} dropped`);
  ok('and it dropped exactly those three per text page', dropped === 3 * 5, String(dropped));
  ok('body lines are kept', left.includes('Answer') && left.filter(t => t === 'Question').length === 6);
}

const S = A.parseDocument(second);
const byN = n => S.questions.find(q => q.n === n);
head('the heading layout, parsed');
{
  ok('five questions, numbered 7 to 11', S.questions.map(q => q.n).join(',') === '7,8,9,10,11', S.questions.map(q => q.n).join(','));
  ok('every one is filed under the heading layout', S.questions.every(q => q.layout === 'heading'), S.questions.map(q => q.layout).join(','));
  const q7 = byN(7);
  ok('a stem is its numbered line and the lines under it, without the number',
     !!q7 && q7.stem.startsWith('A zqstem patient') && q7.stem.endsWith('which step is next?'), q7 && q7.stem.slice(0, 20));
  ok('four options, and a wrapped option keeps its second line', !!q7 && q7.options.length === 4 && q7.options[1].t === 'Snorkel the vint and then continue with the zqtrask',
     q7 && q7.options.map(o => o.t.length).join(','));
  ok('"Answer" then a letter on the next line keys it', !!q7 && q7.ci === 2 && q7.answerBy === 'answer-line', q7 && `${q7.ci} ${q7.answerBy}`);
  ok('the explanation is what follows, from the answer on', !!q7 && q7.ex.some(p => p.includes('Zqexplain')) && q7.ex.length >= 2, q7 && String(q7.ex.length));
  const q8 = byN(8);
  ok('"Answer: B. text" keys B', !!q8 && q8.ci === 1, q8 && String(q8.ci));
  ok('an answer line, and a heading standing alone, are paragraphs of their own',
     !!q8 && q8.ex[0] === 'Answer: B. Quorp' && q8.ex[1] === 'Key point' && String(q8.ex[2]).startsWith('Zqexplain'), q8 && JSON.stringify(q8.ex.map(p => p.length)));
  const ex8 = q8 ? q8.ex.join(' ') : '';
  ok('a numbered reference list and a dose stay in the explanation they sit in, and start no question',
     ex8.includes('zqref paper about') && ex8.includes('Another zqref') && ex8.includes('zqdose') && !S.questions.some(q => /zqref|zqdose/.test(q.stem)),
     q8 && JSON.stringify(q8.ex.map(p => p.length)));
  const q9 = byN(9);
  ok('an answer given as the option\'s words keys that option', !!q9 && q9.ci === 1 && q9.answerBy === 'answer-text', q9 && `${q9.ci} ${q9.answerBy}`);
  const q10 = byN(10);
  ok('a question the page never answers is kept as unanswered, not guessed', !!q10 && q10.ci === -1, q10 && String(q10.ci));
  ok('and the shape of the line after its options is recorded — as a shape',
     !!q10 && q10.noAnswerShapes.length === 1 && q10.noAnswerShapes[0].shape === 'Aaaa␣a', q10 && JSON.stringify(q10.noAnswerShapes));
  const q11 = byN(11);
  ok('a stem line opening "A.V." is part of the stem, not option A', !!q11 && q11.stem.includes('letters A.V. block') && q11.options.length === 2, q11 && q11.options.length);
  ok('"Answer" then "The correct answer is B" on the next line keys B, from the answer line', !!q11 && q11.ci === 1 && q11.answerBy === 'answer-line',
     q11 && `${q11.ci} ${q11.answerBy}`);
  ok('a heading with no question under it is counted, by page', S.stats.orphanHeadings.join(',') === '5', S.stats.orphanHeadings.join(','));
  ok('a page with no text layer is skipped and counted', S.stats.noTextPages.join(',') === '6' && S.stats.textPages === 5, `${S.stats.noTextPages} / ${S.stats.textPages}`);
}

/* ── the two FIRST layouts ─────────────────────────────────────────────── */
const C16 = { size: 16, font: 'Calibri' };
const first = [
  page(1, [
    L(700, '3 . A zqfrumious bandersnatch presents with galumphing gait.', { font: 'TimesNewRoman' }),
    L(680, 'a . zqopt one', { font: 'TimesNewRoman', ink: 'rgb~0,0,128' }),
    L(666, 'b . zqopt two', { font: 'TimesNewRoman', ink: 'rgb~0,0,128' }),
    L(652, 'c . zqopt three', { font: 'TimesNewRoman', ink: 'rgb~0,0,128' }),
    L(638, 'd . zqopt four', { font: 'TimesNewRoman', ink: 'rgb~0,0,128' }),
    L(620, 'c', { font: 'TimesNewRoman' }),
    L(600, 'A zqspaced explanation, black and plain.'),
  ]),
  page(2, [
    L(700, '12. A zqlarge stem set in a big face about the tulgey wood.', C16),
    L(676, 'a.  zqvorpal', C16),
    L(656, 'b.  zqsnicker', C16),
    L(636, 'c.  zqsnack', C16),
    L(610, 'Ans: b'),
    L(590, 'The zqlarge explanation.'),
    L(576, '1. Brown A. A zqref paper on the tulgey wood. 2004;7:8.'),
    L(560, '13. Another zqlarge stem, answered only in its explanation.', C16),
    L(536, 'a. 5   b. 10', C16),
    L(516, 'c. 15   d. 20', C16),
    L(490, 'Discussion of the zqdoses; the correct answer is (d) as shown.'),
  ]),
  page(3, [
    L(700, '14. A zqinked stem whose answer is only in the colour.', C16),
    L(676, 'a.  zqred', { ...C16, ink: 'rgb~0,0,0' }),
    L(656, 'b.  zqgreen', { ...C16, ink: 'rgb~0,128,0' }),
    L(636, 'c.  zqblue', { ...C16, ink: 'rgb~0,0,0' }),
    L(616, 'd.  zqgrey', { ...C16, ink: 'rgb~0,0,0' }),
    L(590, 'Nothing here names a letter, zqnone.'),
  ]),
  page(4, [
    L(700, 'Stray zqoptions with no stem above them:'),
    L(680, 'a . zqstray one'),
    L(666, 'b . zqstray two'),
  ]),
  page(5, [L(700, 'Zqbackmatter on the second page past the last options.')]),
  page(6, [L(700, 'Zqbackmatter on the third page past them.')]),
];
const F = A.parseDocument(first);
const fq = n => F.questions.find(q => q.n === n);
head('the spaced and large layouts, parsed');
{
  const q3 = fq(3);
  ok('a "3 . " stem with "a . " options is the spaced layout', !!q3 && q3.layout === 'spaced' && q3.options.length === 4, q3 && q3.layout);
  ok('its short line after the options keys it', !!q3 && q3.ci === 2 && q3.answerBy === 'short-line', q3 && `${q3.ci} ${q3.answerBy}`);
  ok('and the answer letter is not left in the explanation', !!q3 && q3.ex.length === 1 && q3.ex[0].startsWith('A zqspaced'), q3 && JSON.stringify(q3.ex.map(p => p.length)));
  const q12 = fq(12);
  ok('a large "12. " stem with "a.  " options is the large layout', !!q12 && q12.layout === 'large' && q12.options.length === 3, q12 && q12.layout);
  ok('a numbered reference straight before the next stem stays in this explanation', !!q12 && q12.ex.join(' ').includes('zqref paper on'),
     q12 && JSON.stringify(q12.ex.map(p => p.length)));
  ok('"Ans: b" keys it, and stays out of the paragraph after it', !!q12 && q12.ci === 1 && q12.ex[0] === 'Ans: b' && String(q12.ex[1]).includes('zqlarge'),
     q12 && `${q12.ci} ${JSON.stringify(q12.ex.map(p => p.length))}`);
  const q13 = fq(13);
  ok('two options set on one line are two options', !!q13 && q13.options.map(o => o.t).join('|') === '5|10|15|20', q13 && q13.options.map(o => o.t).join('|'));
  ok('an answer stated only in the explanation is found there', !!q13 && q13.ci === 3 && q13.answerBy === 'sentence', q13 && `${q13.ci} ${q13.answerBy}`);
  const q14 = fq(14);
  ok('an answer shown only by ink is found by ink, and said so', !!q14 && q14.ci === 1 && q14.answerBy === 'ink', q14 && `${q14.ci} ${q14.answerBy}`);
  const ex14 = q14 ? q14.ex.join(' ') : '';
  ok(`the last question's explanation stops ${A.TRAIL_PAGES} pages past its options, leaving the back matter`,
     ex14.includes('second page past') && !ex14.includes('third page past'), q14 && JSON.stringify(q14.ex.map(p => p.length)));
  ok('option-like lines with no stem are a page that did not parse', F.stats.unparsedPages.join(',') === '4', F.stats.unparsedPages.join(','));
  ok('the file yields exactly its four questions, and the stray options are in none of them',
     F.questions.map(q => q.n).join(',') === '3,12,13,14' && !F.questions.some(q => q.options.some(o => /zqstray/.test(o.t))), F.questions.map(q => q.n).join(','));
}

head('figures go to the question they sit under');
{
  const qs = A.parseDocument(second).questions;
  const r = A.attachImages(qs, [
    { page: 1, top: 720, id: 'above-first' },
    { page: 2, top: 600, id: 'under-8' },
    { page: 3, top: 740, id: 'top-of-3' },
    { page: 5, top: 570, id: 'under-11' },
  ]);
  const ids = n => ((qs.find(q => q.n === n) || {}).images || []).map(i => i.id).join(',');
  ok('a figure below a stem belongs to it', ids(8).startsWith('under-8') && ids(11) === 'under-11', `${ids(8)} / ${ids(11)}`);
  ok('a figure above the first question on its page belongs to the one carried over', ids(8) === 'under-8,top-of-3', ids(8));
  ok('a figure above the first question of all belongs to nobody, and is counted', r.unassigned === 1 && ids(7) === '', `${r.unassigned} / ${ids(7)}`);
}

/* ── already in the bank ──────────────────────────────────────────────── */
const words = (seed, n) => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(' ');
const OPENER = 'A 65-year-old man with a history of hypertension presents with';
const bank = [
  { id: 'VAL_1', ch: 'Valvular', n: 1, s: `${OPENER} ${words('bankone', 30)}.`, o: [{ t: 'x', p: 60 }, { t: 'y', p: 40 }], ci: 0, ex: '<p>because</p>' },
  { id: 'VAL_2', ch: 'Valvular', n: 2, s: `${OPENER} ${words('banktwo', 30)}.`, o: [{ t: 'x', p: 60 }, { t: 'y', p: 40 }], ci: 1, ex: '<p>because</p>' },
  { id: 'COR_1', ch: 'Coronary', n: 1, s: `${OPENER} ${words('bankthree', 30)}.`, o: [{ t: 'x', p: 60 }, { t: 'y', p: 40 }], ci: 0, ex: '<p>because</p>' },
  { id: 'OAB_prev', ch: A.CATEGORY, n: 1, s: `A stem merged by an earlier run ${words('earlier', 30)}.`, o: [{ t: 'x', p: 0 }, { t: 'y', p: 0 }], ci: 0, ex: '' },
];
const cand = (stem, tag) => ({ stem, tag, options: [{ t: 'Zqa' }, { t: 'Zqb' }], ci: 0, ex: ['zqex'], n: 1 });
const reworded = bank[1].s.replace('banktwo3', 'altered3').replace('banktwo9', 'altered9');
const candidates = [
  cand('9. ' + bank[0].s, 'exact'),                              // with its number still on
  cand(reworded, 'reworded'),
  cand(`${OPENER} ${words('fresh', 30)}.`, 'new'),               // shares only the opener
  cand(`${words('bankone', 14)} ${words('banktwo', 14)} ${words('bankthree', 14)}`, 'patchwork'),   // a third of each of three
  cand(`A stem merged by an earlier run ${words('earlier', 30)}.`, 'ours-before'),
  cand(`${OPENER} ${words('twice', 30)}.`, 'first-copy'),
  cand(`${OPENER.toUpperCase()}   ${words('twice', 30)}.`, 'second-copy'),
];
head('duplicates, by each stem\'s best single match');
{
  const { stems, key } = A.bankStems(bank);
  ok('the bank\'s stem field is read from the bank', key === 's', String(key));
  ok('stems this importer merged before are not compared against', stems.length === 3 && !stems.some(s => s.id === 'OAB_prev'), String(stems.length));
  const d = A.dedupe(candidates, stems);
  const kept = d.kept.map(c => c.tag).join(',');
  ok('an exact copy of a bank stem, number and all, is a duplicate', !d.kept.some(c => c.tag === 'exact'), kept);
  ok('a lightly reworded copy is a duplicate', !d.kept.some(c => c.tag === 'reworded'), kept);
  ok('a stem sharing only a common clinical opener is new', d.kept.some(c => c.tag === 'new'), kept);
  ok('a stem stitched from three bank stems, a third of each, is new — each is measured against one stem, not the pool',
     d.kept.some(c => c.tag === 'patchwork'), kept);
  ok('a stem only an earlier merge put in the bank is new again', d.kept.some(c => c.tag === 'ours-before'), kept);
  ok('the same question twice in the PDFs is kept once, the first', d.kept.some(c => c.tag === 'first-copy') && !d.kept.some(c => c.tag === 'second-copy'), kept);
  ok('and the counts say which was which', d.dupBank === 2 && d.dupSelf === 1 && d.kept.length === 4, `bank ${d.dupBank}, self ${d.dupSelf}, kept ${d.kept.length}`);
  ok('every candidate is in the bank histogram once', d.hist.bank.reduce((a, b) => a + b, 0) === candidates.length, d.hist.bank.join(' '));
  const strict = A.dedupe(candidates, stems, { threshold: 0.95 });
  ok('the threshold is the one used: at 0.95 the reworded copy is kept', strict.kept.some(c => c.tag === 'reworded') && !strict.kept.some(c => c.tag === 'exact'),
     strict.kept.map(c => c.tag).join(','));
  let threw = false;
  try { A.bankStems([{ id: 'X_1', ch: 'X', o: [], ci: 0 }]); } catch (_) { threw = true; }
  ok('a bank with no readable stem field is refused, not treated as empty', threw);
}

head('in the bank\'s own shape');
{
  const shape = A.inferShape(bank);
  ok('options as objects, the words under t, the percentage numeric', shape.optObjects && shape.optTextKey === 't' && shape.optNumeric.p === true,
     JSON.stringify({ o: shape.optObjects, t: shape.optTextKey, p: shape.optNumeric.p }));
  ok('commentary as HTML, stems as plain text', shape.exHtml && !shape.stemHtml);
  const q = { stem: 'A zqstem with <b> in it', options: [{ t: 'Zq one' }, { t: 'Zq two' }], ci: 1, ex: ['Para zqone', 'Para <two>'], n: 7 };
  const out = A.toBankQuestion(q, shape, { from: 'SECOND p3', figs: ['f_1.jpg', 'f_2.jpg'] });
  ok('filed under the Older ACC bank, with our id prefix', out.ch === 'Older ACC bank' && out.id.startsWith('OAB_'), `${out.ch} ${out.id}`);
  ok('options carry the words and a zero percentage', JSON.stringify(out.o) === JSON.stringify([{ t: 'Zq one', p: 0 }, { t: 'Zq two', p: 0 }]), JSON.stringify(out.o));
  ok('the commentary is escaped HTML paragraphs', out.ex === '<p>Para zqone</p><p>Para &lt;two&gt;</p>', out.ex);
  ok('the stem is under the bank\'s stem field, as plain text', out.s === q.stem && out.n === 7 && out.ci === 1);
  ok('img counts the figures it lists', out.img === 2 && out.figs.length === 2);
  const plain = A.inferShape([
    { id: 'A_1', ch: 'A', s: words('plainstem', 12), o: ['one', 'two'], ci: 0, ex: 'plain words' },
    { id: 'A_2', ch: 'A', s: words('plainstemb', 12), o: ['one', 'two'], ci: 0, ex: 'plain words' },
  ]);
  /* verify-content's own rule: a question with empty commentary must carry
     a bad/flag notice. The owner's first merged build shipped one without. */
  const silentPlain = A.toBankQuestion({ ...q, ex: [] }, plain, {});
  const silentHtml = A.toBankQuestion({ ...q, ex: [] }, shape, {});
  const rule = x => !(x.ex === '' && !x.bad && !x.flag);
  ok('a question with no explanation is told to the fellow, not shipped silent', rule(silentPlain) && silentPlain.flag === A.NO_EXPLANATION && silentHtml.flag === A.NO_EXPLANATION,
     JSON.stringify({ plain: silentPlain.flag ? 'flagged' : 'SILENT', html: silentHtml.flag ? 'flagged' : 'SILENT' }));
  ok('and one with an explanation carries no such notice', !A.toBankQuestion(q, plain, {}).flag && !out.flag);
  const blankParas = A.toBankQuestion({ ...q, ex: ['  '] }, shape, {});
  ok('nor does an explanation of empty paragraphs pass for one', blankParas.flag === A.NO_EXPLANATION, blankParas.ex);
  const po = A.toBankQuestion(q, plain, {});
  ok('a bank of string options and plain commentary gets the same', JSON.stringify(po.o) === '["Zq one","Zq two"]' && po.ex === 'Para zqone\n\nPara <two>', JSON.stringify(po.o));
  const named = A.inferShape([
    { id: 'A_1', ch: 'A', s: words('namedstem', 12), o: [{ label: 'A', text: 'a longer option text' }], ci: 0, ex: 'x' },
    { id: 'A_2', ch: 'A', s: words('namedstemb', 12), o: [{ label: 'B', text: 'another longer option' }], ci: 0, ex: 'x' },
  ]);
  ok('the option\'s words go under whichever key the bank keeps them in', named.optTextKey === 'text' && A.toBankQuestion(q, named, {}).o[0].text === 'Zq one',
     String(named.optTextKey));
  ok('an id is stable across spacing, case and a leading number, and differs between stems',
     A.idFor('9. A  Stem here') === A.idFor('a stem here') && A.idFor('a stem here') !== A.idFor('a stem there'));
}

head('merged into a single-file build');
{
  const shape = A.inferShape(bank);
  const staged = [
    A.toBankQuestion({ stem: `new zqone ${words('m1', 20)}`, options: [{ t: 'Zq a' }, { t: 'Zq b' }], ci: 1, ex: ['x'], n: 1 }, shape, { figs: ['a_1.jpg'] }),
    A.toBankQuestion({ stem: `new zqtwo ${words('m2', 20)}`, options: [{ t: 'Zq a' }, { t: 'Zq b' }, { t: 'Zq c' }], ci: 2, ex: ['y'], n: 2 }, shape, {}),
  ];
  const exportBank = bank.filter(q => q.ch !== A.CATEGORY);
  const imgs = { VAL_1: ['data:image/webp;base64,AAAA'], OAB_prev: ['data:image/jpeg;base64,BBBB'] };
  const fig = { [staged[0].id]: ['data:image/jpeg;base64,CCCC'], [staged[1].id]: [] };
  /* Each merge is caught rather than left to throw: a merge that refuses what
     it should take must read as a FAIL here, not as a suite that died. */
  const tryMerge = (...a) => { try { return A.mergeBank(...a); } catch (e) { return { bank: [], imgs: {}, removed: -1, error: e.message }; } };
  const r1 = tryMerge(bank, imgs, staged, fig);
  ok('the staged questions are appended, and what an earlier merge put there is replaced',
     r1.bank.length === exportBank.length + 2 && r1.removed === 1 && !r1.bank.some(q => q.id === 'OAB_prev'), r1.error || `${r1.bank.length} ${r1.removed}`);
  ok('figures go to IMGS under the question\'s id, and the old merge\'s are gone',
     (r1.imgs[staged[0].id] || []).length === 1 && !(staged[1].id in r1.imgs) && !('OAB_prev' in r1.imgs) && (r1.imgs.VAL_1 || []).length === 1);
  const m0 = r1.bank.find(q => q.id === staged[0].id) || {};
  ok('the single-file bank carries img, not figs', m0.img === 1 && !('figs' in m0));
  /* A rerun from a new staging, in which one question is gone: what the first
     merge put there goes, not only the ids being staged again. */
  const r2 = tryMerge(r1.bank, r1.imgs, [staged[1]], fig);
  ok('merging again replaces all of the last merge, not just the ids staged again',
     r2.bank.length === exportBank.length + 1 && r2.removed === 2 && !r2.bank.some(q => q.id === staged[0].id) && !(staged[0].id in r2.imgs),
     r2.error || `${r2.bank.length} ${r2.removed}`);
  const throws = f => { try { f(); return false; } catch (_) { return true; } };
  ok('a staged id appearing twice is refused', throws(() => A.mergeBank(exportBank, {}, [staged[0], staged[0]], fig)));
  ok('a staged question keyed past its options is refused', throws(() => A.mergeBank(exportBank, {}, [{ ...staged[1], ci: 3 }], fig)));
  ok('a staged question whose figures are missing is refused', throws(() => A.mergeBank(exportBank, {}, [staged[0]], {})));
  ok('a staged question without our prefix, or filed elsewhere, is refused', throws(() => A.mergeBank(exportBank, {}, [{ ...staged[1], id: 'VAL_9' }], fig)) &&
     throws(() => A.mergeBank(exportBank, {}, [{ ...staged[1], ch: 'Valvular' }], fig)));
  const lookalike = { id: staged[1].id, ch: 'Valvular', s: 'an export item whose id merely shares the prefix', o: ['a', 'b'], ci: 0 };
  ok('an export question whose id merely shares our prefix is kept, and a staged id colliding with it is refused',
     tryMerge([...exportBank, lookalike], {}, [staged[0]], fig).bank.some(q => q === lookalike) &&
     throws(() => A.mergeBank([...exportBank, lookalike], {}, [staged[1]], fig)));
  const findings = check(r1.bank).filter(f => String(f.id).startsWith('OAB_'));
  ok('the merged questions pass the build\'s own structural checks', findings.length === 0, findings.map(f => f.rule).join(',') || 'none');
}

/* ── answer keys (FIRST.pdf, the owner's second run) ───────────────────────
   The first real run showed ~400 lines shaped "99.␣a." straight after
   questions' options, and black all-caps headings: answer-key sections.
   Here: a key page after each question page, numbers restarting per chapter,
   a key whose rationale discusses each option on its own lettered line, an
   entry for a question the key follows but that has fewer options, one for a
   number no question has, a key that disagrees and one that agrees with the
   page's own answer, two questions sharing a number, and one key at the end
   answering two chapters. */
const Q16 = (y, n, tag, nOpts = 3, o = {}) => [
  L(y, `${n}. A ${tag} stem for the key to answer.`, C16),
  ...Array.from({ length: nOpts }, (_, i) => L(y - 24 - 20 * i, `${'abcd'[i]}.  ${tag}opt${i}`, { ...C16, ...(o.bf ? { bf: o.bf[i] } : {}) })),
];
const keyed = [
  page(1, [...Q16(700, 1, 'zqkone'), ...Q16(600, 2, 'zqktwo')]),
  page(2, [L(700, 'ANSWERS', B), L(680, '1. b. Zqrationale one begins here'), L(666, 'and carries on zqwrapped.'),
           L(640, '2. c. Zqrationale two.'), L(626, 'a. Incorrect, zqwhy one.'), L(612, 'b. Incorrect, zqwhy two.')]),
  page(3, [...Q16(700, 1, 'zqctwoone'), ...Q16(600, 2, 'zqctwotwo'), ...Q16(500, 3, 'zqctwothree')]),
  page(4, [L(700, 'ANSWERS', B), L(680, '1. a. Zqr.'), L(666, '2. b. Zqr.'), L(652, '3. d. Zqr past.'), L(638, '4. a. Zqr nobody.')]),
  page(5, [...Q16(700, 5, 'zqpagea'), L(616, 'Answer: A'), ...Q16(580, 6, 'zqpageb'), L(496, 'Answer: B')]),
  page(6, [L(700, 'ANSWERS', B), L(680, '5. b. Zqr.'), L(666, '6. b. Zqr.')]),
  page(7, [...Q16(700, 7, 'zqtwinone'), ...Q16(600, 7, 'zqtwintwo')]),
  page(8, [L(700, 'Answers and explanations', B), L(680, '7. a. Zqr twin.')]),
  page(9, [...Q16(700, 1, 'zqendaone'), ...Q16(600, 2, 'zqendatwo')]),
  page(10, [...Q16(700, 1, 'zqendbone'), ...Q16(600, 2, 'zqendbtwo')]),
  page(11, [L(700, 'ANSWER KEY', B), L(680, '1. a.'), L(666, '2. b.'), L(652, '1. c.'), L(638, '2. a.')]),
  page(12, [...Q16(700, 8, 'zqsaid'), L(616, 'Explanation: option C is correct, zqsays.'),
            ...Q16(580, 9, 'zqbold', 4, { bf: [0, 1, 0.1, 0] })]),
];
const K = A.parseDocument(keyed);
const kq = tag => K.questions.find(q => q.stem.includes(tag + ' stem'));
head('the kind of an answer-key line');
{
  const k = t => A.lineKind(t);
  ok('"12. a. Because …", "12) (c)" and "7. Ans: b" are key entries, lettered from zero',
     k('12. a. Because').k === 'KEYENTRY' && k('12. a. Because').n === 12 && k('12. a. Because').L === 0 &&
     k('12) (c)').L === 2 && k('7. Ans: b').L === 1, JSON.stringify(k('7. Ans: b')));
  ok('"12. A 45-year-old man" is a stem, not a key entry', k('12. A 45-year-old man').k === 'NUM', k('12. A 45-year-old man').k);
  ok('"ANSWERS", "Answer key", "Answers and explanations", "EXPLANATIONS" head a key section',
     ['ANSWERS', 'Answer key', 'Answers and explanations', 'EXPLANATIONS'].every(t => k(t).k === 'KEYHEAD'),
     ['ANSWERS', 'Answer key', 'Answers and explanations', 'EXPLANATIONS'].map(t => k(t).k).join(','));
  ok('but a single "Explanation" heads one question\'s explanation', k('Explanation').k === 'KEY', k('Explanation').k);
  ok('"Question 9: …" is a stem, "10:30" is not', k('Question 9: A man').k === 'NUM' && k('10:30 in the clinic').k !== 'NUM');
}
head('answer keys, mapped back to their questions');
{
  ok('no key entry is taken for a question, even one whose rationale letters each option',
     K.questions.length === 15 && !K.questions.some(q => /Zqr|zqwhy/.test(q.stem + q.options.map(o => o.t).join(' '))),
     `${K.questions.length} questions`);
  ok('and none is even considered as a stem: no anchor was turned down anywhere in the file',
     Object.keys(K.stats.rejectsByReason).length === 0, JSON.stringify(K.stats.rejectsByReason));
  const q1 = kq('zqkone'), q2 = kq('zqktwo');
  ok('a key page after a question page keys each question by its number', !!q1 && q1.ci === 1 && q1.answerBy === 'key' && !!q2 && q2.ci === 2,
     `${q1 && q1.ci} ${q1 && q1.answerBy} ${q2 && q2.ci}`);
  ok('the entry\'s rationale, wrapped lines and lettered lines too, becomes the commentary',
     !!q1 && q1.ex.join(' ').includes('begins here and carries on zqwrapped') && !!q2 && q2.ex.join(' ').includes('Incorrect, zqwhy two'),
     q1 && JSON.stringify(q1.ex.map(p => p.length)));
  ok('the key is not left in the explanation of the question above it', !!q2 && q2.ex.length === 1 && q2.ex[0].startsWith('Zqrationale two'),
     q2 && JSON.stringify(q2.ex.map(p => p.length)));
  ok('lettered lines inside a key section are not a page that failed to parse', K.stats.unparsedPages.length === 0, A.ranges(K.stats.unparsedPages));
  const c1 = kq('zqctwoone'), c2 = kq('zqctwotwo'), c3 = kq('zqctwothree');
  ok('numbers that restart go to the questions the key follows, not to earlier ones', !!c1 && c1.ci === 0 && !!c2 && c2.ci === 1 && q1.ci === 1,
     `${c1 && c1.ci} ${c2 && c2.ci}`);
  ok('an entry lettered past its question\'s options keys nothing, and is counted', !!c3 && c3.ci === -1 && K.stats.key.pastOptions === 1,
     `${c3 && c3.ci} ${K.stats.key.pastOptions}`);
  ok('an entry no question in scope carries is counted as unmatched, by page', K.stats.key.unmatched === 1 && K.stats.key.unmatchedPages.join(',') === '4',
     `${K.stats.key.unmatched} ${K.stats.key.unmatchedPages}`);
  const pa = kq('zqpagea'), pb = kq('zqpageb');
  ok('a key never overrides the answer the page states — it is compared and counted',
     !!pa && pa.ci === 0 && pa.answerBy === 'answer-line' && !!pb && pb.ci === 1 && K.stats.key.disagree === 1 && K.stats.key.agree === 1,
     `${pa && pa.ci} ${K.stats.key.disagree}/${K.stats.key.agree}`);
  const t1 = kq('zqtwinone'), t2 = kq('zqtwintwo');
  ok('two questions sharing a number for one entry: ambiguous, neither keyed', !!t1 && t1.ci === -1 && !!t2 && t2.ci === -1 && K.stats.key.ambiguous === 1,
     `${t1 && t1.ci} ${t2 && t2.ci} ${K.stats.key.ambiguous}`);
  const e = ['zqendaone', 'zqendatwo', 'zqendbone', 'zqendbtwo'].map(t => (kq(t) || {}).ci);
  ok('one key after two chapters answers each chapter in order', e.join(',') === '0,1,2,0', e.join(','));
  ok('and the counts add up: 13 entries in 5 runs, 8 keyed',
     K.stats.key.entries === 13 && K.stats.key.runs === 5 && K.stats.key.keyed === 8, JSON.stringify({ e: K.stats.key.entries, r: K.stats.key.runs, k: K.stats.key.keyed }));
}

head('more ways a page states its answer');
{
  const h = t => A.sentenceHit(t, 4);
  ok('"The best answer is (c)" and "(C) is the best answer"', h('The best answer is (c).').i === 2 && h('(C) is the best answer.').i === 2);
  ok('"Option B is correct" and a sentence opening "D is correct", named for how they were found',
     h('Option B is correct.').i === 1 && h('Option B is correct.').how === 'sentence-is-correct' && h('It fits. D is correct.').i === 3 &&
     h('The correct answer is B.').how === 'sentence');
  ok('but "Vitamin B is the correct answer" and "hepatitis a is correct" are not options',
     h('Vitamin B is the correct answer here.').i === -1 && h('hepatitis a is correct in this case').i === -1);
  const s8 = kq('zqsaid');
  ok('found in a question\'s explanation, and reported as such', !!s8 && s8.ci === 2 && s8.answerBy === 'sentence-is-correct', s8 && `${s8.ci} ${s8.answerBy}`);
  ok('one option mostly bold, the rest not, is the bold answer', A.boldAnswer([0, 0.9, 0.1, 0]) === 1);
  ok('but not two bold, one half-bold beside it, or bold not measured',
     A.boldAnswer([0.9, 0.9, 0, 0]) === -1 && A.boldAnswer([0, 0.9, 0.5, 0]) === -1 && A.boldAnswer([undefined, 1, 0, 0]) === -1);
  const b9 = kq('zqbold');
  ok('a question answered only by a bold option is found by bold', !!b9 && b9.ci === 1 && b9.answerBy === 'bold', b9 && `${b9.ci} ${b9.answerBy}`);
  const q10 = S.questions.find(q => q.n === 10);
  ok('an unanswered question records how its options differ, as a pattern', !!q10 && q10.emphasis === 'ink 3, bold 0/3', q10 && q10.emphasis);
}

/* ── why a page did not parse ──────────────────────────────────────────── */
const HB = { ...B, ink: 'rgb~224,0,0' };
const rej = [
  page(1, [L(690, '5. A zqlonely stem that the next stem interrupts.'), L(670, '6. A zqreal stem.'), L(650, 'A. Zqx'), L(636, 'B. Zqy'), L(610, 'Answer: A')]),
  page(2, [L(690, 'Question', HB), L(670, 'A zqstem whose options start at B.'), L(650, 'B. Zqx'), L(636, 'C. Zqy')]),
  page(3, [L(690, 'Question', HB), L(670, '9. A zqstem with one option.'), L(650, 'A. Zqonly'), L(620, 'Answer: A')]),
  page(4, [L(690, 'Question', HB), L(670, 'A zqstem that runs into a key.'), L(650, 'ANSWERS')]),
  page(5, [L(690, 'Stem without a number zqorph', { font: 'Helvetica' }), L(670, 'a. Zqorphan one'), L(650, 'b. Zqorphan two')]),
  page(6, [L(740, 'Question', HB), L(670, 'A zqstem with nothing after it at all.'), L(650, 'Zqmore words.')]),
];
const RJ = A.parseDocument(rej);
head('why a page did not parse, by rule');
{
  const by = RJ.stats.unparsedByReason;
  const pages = r => (by[r] || []).join(',');
  ok('options starting at B: not-A-first, on its page', pages('not-A-first') === '2', JSON.stringify(by));
  ok('an option A with no B: A-without-B, on its page', pages('A-without-B') === '3', pages('A-without-B'));
  ok('a key section before any option: key-before-A', pages('key-before-A') === '4', pages('key-before-A'));
  ok('no option at all: no-option', pages('no-option') === '6', pages('no-option'));
  ok('options no stem reached: A-without-anchor, with the shape and font of the line above',
     pages('A-without-anchor') === '5' && RJ.stats.aboveOrphanA['Aaaa␣a Helvetica'] === 1, JSON.stringify(RJ.stats.aboveOrphanA));
  ok('a stem interrupted by the next is counted though its page parsed', RJ.stats.rejectsByReason['anchor-before-A'] === 1 && !RJ.stats.unparsedPages.includes(1),
     JSON.stringify(RJ.stats.rejectsByReason));
  ok('a heading and the numbered stem under it are turned down once, not twice', RJ.stats.rejectsByReason['A-without-B'] === 1,
     String(RJ.stats.rejectsByReason['A-without-B']));
  ok('a "Question" heading in the top eighth of a page is counted', RJ.stats.headingsAtTop === 1, String(RJ.stats.headingsAtTop));
}

/* ── the bold-heading layout (SECOND pp. 226-377, from --shapes) ──────── */
/* As the owner's shapes showed it: a short bold Calibri line naming no
   "Question", the stem in plain Calibri (here across a page break), options,
   the explanation, then "Answer" after it and a "Key Point". */
const CAL = { font: 'Calibri', bf: 0 }, CALB = { font: 'Calibri-Bold', bold: true, bf: 1, ink: 'none' }, HEL = { font: 'Helvetica', size: 10.5, bf: 0 };
const boldDoc = [
  page(1, [
    L(700, 'Question', { ...B, ink: 'rgb~224,0,0' }),
    L(686, '7. A zqheadstem in the red-heading layout, before the others.', B),
    L(660, 'A.  Zqha', B), L(646, 'B.  Zqhb', B), L(632, 'C.  Zqhc', B),
    L(610, 'Answer: A'),
    L(590, 'Zqheadexplain words for the heading question.', HEL),
    L(540, 'Zqbhead one of 9', CALB),
    L(518, 'A zqbstem1 patient in the bold layout whose stem runs', CAL),
    L(504, 'on down the page and over the break to the next one', CAL),
  ]),
  page(2, [
    L(700, 'where zqbcont finishes the vignette in the same font.', CAL),
    L(678, 'Which zqbask is best?', CAL),
    L(656, 'A. Zqb1a', CAL), L(634, 'B. Zqb1b', CAL), L(612, 'C. Zqb1c', CAL), L(590, 'D. Zqb1d', CAL),
    L(546, 'Zqb1explain in Calibri, a paragraph of it.', CAL),
    L(524, 'Answer: B', CAL),
    L(502, 'Key Point', HEL),
    L(489, 'Zqb1key point words.', HEL),
    L(446, 'Zqbhead two of 9', CALB),
    L(424, 'A second zqbstem2 vignette, all on one page.', CAL),
    L(402, 'A. Zqb2a', CAL), L(380, 'B. Zqb2b', CAL), L(358, 'C. Zqb2c', CAL),
    L(336, 'Zqb2explain in Helvetica this time.', HEL),
  ]),
  page(3, [
    L(700, 'Answer: C', CAL),
    L(678, 'Key Point', HEL),
    L(665, 'Zqb2key words.', HEL),
  ]),
  /* Not this layout: the bold line is too long to be a heading. */
  page(4, [
    L(700, 'A zqlongbold line that runs well past any heading length at all', CALB),
    L(678, 'Zqlongstem in plain Calibri.', CAL),
    L(656, 'A. Zql1', CAL), L(634, 'B. Zql2', CAL),
  ]),
  /* Nor this: the stem changes font on the way up, before any heading. */
  page(5, [
    L(700, 'Zqbhead three of 9', CALB),
    L(678, 'Zqfontbreak in Helvetica between the heading and the stem.', HEL),
    L(656, 'Zqbstem5 in plain Calibri.', CAL),
    L(634, 'A. Zqf1', CAL), L(612, 'B. Zqf2', CAL),
  ]),
  /* And a red-heading question after them all: bold starts are found after
     the others and must still be put in reading order among them. */
  page(6, [
    L(700, 'Question', { ...B, ink: 'rgb~224,0,0' }),
    L(686, '8. A zqlaststem after the bold ones.', B),
    L(660, 'A.  Zqla', B), L(646, 'B.  Zqlb', B),
    L(620, 'Answer: B'),
  ]),
];
const BD = A.parseDocument(boldDoc);
head('the bold-heading layout: a heading that names no "Question"');
{
  const bq = t => BD.questions.find(q => q.stem.includes(t));
  const q1 = bq('zqbstem1'), q2 = bq('zqbstem2'), qh = bq('zqheadstem');
  ok('a short bold line, then prose in one font, then A and B, starts a question — two of them here',
     !!q1 && !!q2 && q1.layout === 'bold-heading' && q2.layout === 'bold-heading', BD.questions.map(q => q.layout).join(','));
  ok('its stem is the prose under the heading, across the page break, without the heading',
     !!q1 && q1.stem.includes('zqbcont') && q1.stem.includes('zqbask') && !/zqbhead/i.test(q1.stem) && q1.options.length === 4, q1 && `${q1.options.length} options`);
  ok('its answer is the "Answer" line after the explanation, on its page or the next',
     !!q1 && !!q2 && q1.ci === 1 && q1.answerBy === 'answer-line' && q2.ci === 2, q1 && q2 && `${q1.ci} ${q2.ci}`);
  ok('and the question before it no longer takes its stem as explanation',
     !!qh && qh.ci === 0 && !qh.ex.join(' ').includes('zqbstem1') && /zqheadexplain/i.test(qh.ex.join(' ')), qh && qh.ex.length + ' paragraphs');
  const orph = (BD.stats.unparsedByReason['A-without-anchor'] || []).join(',');
  ok('a bold line longer than a heading is not one; the option stays A-without-anchor', /(^|,)4(,|$)/.test(orph) && !bq('zqlongstem'), orph);
  ok('nor is a heading the stem\'s font does not reach unbroken', /(^|,)5(,|$)/.test(orph) && !bq('zqbstem5'), orph);
  const lay = A.tallyFile('BOLD.pdf', BD).layouts;
  ok('and the layout is counted as its own', (lay['bold-heading'] || {}).parsed === 2, JSON.stringify(Object.keys(lay)));
  const ql = bq('zqlaststem');
  ok('in reading order among the others: each question keeps its own answer and explanation',
     BD.questions.map(q => q.page).join(',') === '1,1,2,6' && !!ql && ql.ci === 1 && !!q2 && /zqb2key/i.test(q2.ex.join(' ')),
     BD.questions.map(q => q.page).join(','));
}

head('what an unanswered question\'s explanation holds, counted');
{
  const probeDoc = [
    page(1, [
      L(700, 'Question', { ...B, ink: 'rgb~224,0,0' }),
      L(686, '3. A zqprobestem one.', B),
      L(660, 'A.  Zqamiodarone drip', B), L(646, 'B.  Zqdigoxin load', B), L(632, 'C.  Zqwait', B),
      L(600, 'The zqamiodarone drip settles it, and option (c) would be the wrong call; the best reasoning follows.'),
    ]),
    page(2, [
      L(700, 'Question', { ...B, ink: 'rgb~224,0,0' }),
      L(686, '4. A zqprobestem two.', B),
      L(660, 'A.  Zqone', B), L(646, 'B.  Zqtwo', B),
      L(600, 'Zqsilent words naming nothing.'),
    ]),
    /* Says "correct" and letters nothing: the counts differ, so a report
       printing one in the other's place is caught. */
    page(3, [
      L(700, 'Question', { ...B, ink: 'rgb~224,0,0' }),
      L(686, '5. A zqprobestem three.', B),
      L(660, 'A.  Zqred', B), L(646, 'B.  Zqblue', B),
      L(600, 'Zqprose on what is correct practice, naming no choice.'),
    ]),
  ];
  const PD = A.parseDocument(probeDoc);
  const [p1, p2] = PD.questions;
  ok('both are unanswered — nothing here states a key', PD.questions.length === 3 && PD.questions.every(q => q.ci < 0), PD.questions.map(q => q.ci).join(','));
  ok('one explanation says "best", letters an option and names one option in full',
     !!p1.probe && p1.probe.says === true && p1.probe.lettered === true && p1.probe.named === 1, JSON.stringify(p1.probe));
  ok('the other, none of the three', !!p2.probe && p2.probe.says === false && p2.probe.lettered === false && p2.probe.named === 0, JSON.stringify(p2.probe));
  ok('an answered question carries no probe', S.questions.filter(q => q.ci >= 0).every(q => q.probe === null));
  const rep = A.formatReport([A.tallyFile('PROBE.pdf', PD)], null);
  const line = rep.split('\n').find(l => /their explanations:/.test(l)) || '';
  ok('the report counts them, and quotes nothing', /saying answer\/correct\/best 2\s+naming a letter as "\(c\)" or "option c" 1\s+options named in full 0×2  1×1  2×0  3\+×0/.test(line) &&
     !/zq/i.test(rep), line.trim() || 'no such line');
}

head('--probe: how an unanswered explanation treats each option letter');
{
  const st = (t, n = 4) => A.letterStances([t], n);
  const all = st('Zqa. Option (C) is correct because zqb. (A) is incorrect since zqc. Choice B is not indicated, and (d) is wrong for zqd.');
  ok('one option called correct and every other called incorrect is told apart', all.one === 2 && all.rest === true && all.pos === 1 && all.neg === 3, JSON.stringify({ ...all, shapes: undefined }));
  const partial = st('The correct answer is (b). Zqe (a) is discussed but never judged.');
  ok('"the correct answer is (b)" counts as correct; an unjudged mention is neither', partial.one === 1 && partial.rest === false && partial.neg === 0, JSON.stringify({ ...partial, shapes: undefined }));
  const argue = st('Zqf. (A) is incorrect. (B) is not the best. (C) is wrong. (D) is contraindicated.');
  ok('an explanation arguing only against distractors names no answer', argue.one === -1 && argue.pos === 0 && argue.neg === 4);
  const two = st('(A) is correct in one sense; (B) is the best in zqg another.');
  ok('two called correct is not one answer', two.one === -1 && two.pos === 2);
  ok('a letter past the options is not an option', st('Zqh (e) is correct.', 4).pos === 0);
  const probeDoc = [
    page(1, [L(700, 'Question', HB), L(686, '3. A zqpstem one.', B), L(660, 'A.  Zqp1', B), L(646, 'B.  Zqp2', B), L(632, 'C.  Zqp3', B),
      L(600, 'Zqexp (b) would be the most appropriate; (a) is incorrect and (c) is wrong.')]),
    page(2, [L(700, 'Question', HB), L(686, '4. A zqpstem two.', B), L(660, 'A.  Zqq1', B), L(646, 'B.  Zqq2', B),
      L(600, 'Zqsilent words with no letter in them.')]),
    page(3, [L(700, 'Question', HB), L(686, '5. A zqpstem three.', B), L(660, 'A.  Zqr1', B), L(646, 'B.  Zqr2', B), L(632, 'C.  Zqr3', B),
      L(600, 'Zqarg (a) is incorrect; (b) is not indicated.')]),
  ];
  const PR = A.parseDocument(probeDoc);
  const unanswered = PR.questions.filter(q => q.ci < 0).length;
  const rows = A.probeReport('PROBE.pdf', PR.questions), txt = rows.join('\n');
  ok('the fixture\'s three questions are all unanswered — nothing here is a stated key the parser reads', PR.questions.length === 3 && unanswered === 3,
     PR.questions.map(q => q.answerBy || '-').join(','));
  ok('the report counts each kind', /unanswered 3 — pages 1-3/.test(txt) && /every other called incorrect\s+1$/m.test(txt) &&
     /letters mentioned, none called correct\s+1$/m.test(txt) && /no lettered mention at all\s+1$/m.test(txt) && /two or more called correct\s+0$/m.test(txt), txt.split('\n').slice(0, 6).join(' | '));
  ok('with the wording as shapes, and not one word', /called correct, as shapes: \(a\)␣aaaaa␣aa␣aaa×1/.test(txt) && !/zq/i.test(txt), (txt.match(/called correct, as shapes: .*/) || [''])[0]);
}

head('--shapes: how a page is laid out, one row per line, as shapes');
{
  const rows = A.shapeRows(second, new Set([1, 5]));
  const onPage = p => rows.filter(r => r.startsWith(`p${p} `));
  ok('only the pages asked about, every line of them but the running footer',
     onPage(1).length === 12 && onPage(5).length === 10 && rows.length === 22 && !onPage(2).length, `${onPage(1).length} + ${onPage(5).length} of ${rows.length}`);
  /* Page 5's first line follows page 4's last in the stream: a gap measured
     across the page break would be a number, and meaningless. */
  ok('the gap to the line above: "top" for a page\'s first line, then points',
     /gap\s+top/.test(onPage(1)[0]) && /gap\s+top/.test(onPage(5)[0]) && /gap\s+14\.0\s/.test(onPage(1)[1]) && /gap\s+22\.0\s/.test(onPage(1)[3]), onPage(1).slice(0, 2).join(' | '));
  ok('each line\'s kind, option letter included, and its font and ink',
     /\sHEAD\s/.test(onPage(1)[0]) && /\sOPT:A\s/.test(onPage(1)[3]) && /Times-Bold/.test(onPage(1)[1]) && /ink rgb~224,0,0/.test(onPage(1)[0]));
  ok('where segment() began a question, and where its option A is',
     /<start$/.test(onPage(1)[0]) && /<stem$/.test(onPage(1)[1]) && /<optA$/.test(onPage(1)[3]) && onPage(5).filter(r => /<start$/.test(r)).length === 1,
     onPage(5).filter(r => /</.test(r)).length + ' marked on page 5');
  const leaked = rows.join('\n').match(/zq[a-z]+|quimbly|mimble|frizzle/gi) || [];
  ok('and not one word of any line', leaked.length === 0 && rows.join('').length > 1000, leaked.slice(0, 5).join(', ') || 'none');
  /* The page-134 question: a key drawn on top of the page, not in its text. */
  const marked = second.map(pg => pg.p !== 1 ? pg : { ...pg, annots: [
    { subtype: 'Highlight', rect: [60, 604, 400, 620], contents: 'zqsecret answer note' },
    { subtype: 'Square', rect: [60, 200, 120, 240] },
  ] });
  const ar = A.shapeRows(marked, new Set([1, 5])).filter(r => / annot /.test(r));
  ok('an annotation on an option is reported with the option it covers', ar.length === 2 && /^p1\s+annot Highlight\s+x 60-400\s+y 604-620\s+over OPT:C$/.test(ar[0]), ar[0] || 'none');
  ok('one over no line says so', /annot Square .* over no line$/.test(ar[1] || ''), ar[1] || 'none');
  ok('its text is never printed', !/zqsecret|answer note/.test(ar.join('\n')));
  ok('and pages without annotations add no rows', A.shapeRows(second, new Set([1, 5])).length === rows.length);
  /* An image-only page: no text layer, and its mark the only key there is. */
  const scan = second.concat([{ p: 9, noText: true, w: 612, h: 792, y0: 0, annots: [{ subtype: 'Ink', rect: [70, 400, 90, 420] }] }]);
  const sr = A.shapeRows(scan, new Set([9]));
  ok('an annotation on a page with no text layer is still reported', sr.length === 1 && /^p9\s+annot Ink\s+.*over no line$/.test(sr[0]), sr.join(' | ') || 'none');
  /* And the importer collects them before it gives up on such a page. Read
     from its source (blanked): readPage runs in a browser on a real PDF,
     which this suite has neither of. Narrow on purpose — it holds the order
     of two statements, nothing more. */
  const imp = require('./_source.js').blankComments(require('fs').readFileSync(require('path').join(__dirname, '..', 'tools', 'older-acc-import.js'), 'utf8'));
  const at = imp.indexOf('page.getAnnotations()'), early = imp.indexOf('if (chars <= 40)');
  ok('the importer reads a page\'s annotations before returning early for a page with no text layer',
     at > 0 && early > at && /if \(chars <= 40\)[^\n]*annots \}/.test(imp), `annotations at ${at}, early return at ${early}`);
}

head('every figure type the split build writes is served as an image');
{
  /* The owner's run with 727 older questions: the split build's offline
     download finished short, and a reload found the same gap. The older
     bank's figures are the only JPEGs in the bank; extract-content.js named
     them .jpg and scripts/serve.js had no type for .jpg, so they went out as
     application/octet-stream and offlineIsImage() refused every one. Read
     blanked, per CLAUDE.md, from both files' own tables. */
  const fs = require('fs'), path = require('path');
  const { blankComments } = require('./_source.js');
  const src = f => blankComments(fs.readFileSync(path.join(__dirname, '..', 'scripts', f), 'utf8'));
  const ext = src('extract-content.js'), srv = src('serve.js');
  const written = [...(/const EXT = \{([^}]*)\}/.exec(ext) || [, ''])[1].matchAll(/'([a-z0-9]+)'\s*(?=[,}\s]*(?:'|$))/g)]
    .map(m => m[1]).filter(e => !e.includes('/'));
  const types = {};
  for (const m of ((/const TYPES = \{([^}]*)\}/.exec(srv) || [, ''])[1]).matchAll(/'\.([a-z0-9]+)':\s*'([^']+)'/g)) types[m[1]] = m[2];
  const bad = written.filter(e => !/^image\//.test(types[e] || ''));
  ok('extract-content.js writes the figure types it says (webp, png, jpg)', written.sort().join(',') === 'jpg,png,webp', written.join(','));
  ok('and scripts/serve.js serves each of them as image/*', written.length === 3 && bad.length === 0,
     bad.length ? bad.map(e => `.${e} → ${types[e] || 'no type (octet-stream)'}`).join(', ') : written.map(e => `.${e} ${types[e]}`).join(', '));
}

head('what the importer prints');
{
  const t1 = A.tallyFile('SECOND.pdf', S), t2 = A.tallyFile('FIRST.pdf', F);
  t1.figures = 2; t2.figures = 0;
  const d = A.dedupe(S.questions.concat(F.questions).filter(q => q.ci >= 0), A.bankStems(bank).stems);
  const text = A.formatReport([t1, t2], { parsed: 9, noAnswer: 1, dupBank: d.dupBank, dupSelf: d.dupSelf, added: d.kept.length, figures: 2,
    hist: d.hist, threshold: 0.5, bankStems: 3, stemKey: 's' });
  ok('per-layout counts for each file', /layout heading\s+parsed\s+5\s+missing an answer 1/.test(text) && /layout spaced\s+parsed\s+1/.test(text) && /layout large\s+parsed\s+3/.test(text));
  ok('the pages of questions missing an answer, and of pages that did not parse', /missing an answer 1 — pages 4/.test(text) && /did not parse: 4/.test(text));
  ok('how each answer was found', /answer-line×3/.test(text) && /short-line×1/.test(text) && /ink×1/.test(text));
  ok('each layout names the fonts its stems are set in', /layout heading\s+parsed\s+5\s+missing an answer 1\s+stem fonts Times-Bold×5/.test(text));
  const t3 = A.tallyFile('KEYED.pdf', K), t4 = A.tallyFile('REJECTS.pdf', RJ);
  const text2 = A.formatReport([t3, t4], null);
  ok('the answer key\'s counts are printed', /answer key: entries 13 in 5 runs\s+keyed 8\s+agreeing with the page 1\s+disagreeing 1\s+unmatched 1\s+ambiguous 1\s+letter past the options 1/.test(text2) &&
     /unmatched entries on pages 4/.test(text2), (text2.match(/answer key:.*/) || [''])[0]);
  ok('and every rule with the pages it turned down', /not-A-first\s+1 pages — 2/.test(text2) && /A-without-anchor\s+1 pages — 5/.test(text2) &&
     /anchors turned down, by rule: .*no-option×1/.test(text2) && /the line above an option A no stem reached, as shape and font: Aaaa␣a Helvetica×1/.test(text2));
  ok('and how the options of an unanswered question differ', /how their options differ: ink 3, bold 0\/3×1/.test(text));
  const leaked = (text + text2).match(/zq[a-z]+/gi) || [];
  ok('and not one word of any question, option, explanation or key', leaked.length === 0 && text.length > 400 && text2.length > 400,
     leaked.slice(0, 5).join(', ') || `${text.length + text2.length} chars, none`);
  ok('page lists are ranges', A.ranges([1, 2, 3, 7, 9, 10]) === '1-3, 7, 9-10' && A.ranges([]) === 'none');
}

head('the built bank, split: the export part exact, the older part exactly its staging');
{
  /* tests/_olderbank.js — what verify-pwa and verify-chapters hold a merged
     build to. Invented banks: two export questions (one with a figure) and,
     when merged, two older ones (three figures). */
  const OB = require('./_olderbank.js');
  const fs = require('fs'), os = require('os'), path = require('path');
  const figsOf = q => (q.figs || []).length;
  const exp = [{ id: 'VAL_1', ch: 'Valves', figs: ['a'] }, { id: 'COR_2', ch: 'Coronary' }];
  const older = [{ id: 'OAB_1', ch: OB.CATEGORY, figs: ['x', 'y'] }, { id: 'OAB_2', ch: OB.CATEGORY, figs: ['z'] }];
  const staged = { count: 2, figs: 3 };
  const none = OB.splitBank(exp, figsOf, staged);
  ok('an unmerged build passes, the export counted whole', none.ok && none.exportCount === 2 && none.exportFigs === 1 && none.olderCount === 0, none.why);
  const whole = OB.splitBank(exp.concat(older), figsOf, staged);
  ok('a build carrying exactly the staging passes, and the export part is unchanged by it', whole.ok && whole.exportCount === 2 && whole.exportFigs === 1, whole.why);
  const part = OB.splitBank(exp.concat(older.slice(0, 1)), figsOf, staged);
  ok('a partial merge fails', !part.ok, part.why);
  const extraFig = OB.splitBank(exp.concat([older[0], { ...older[1], figs: ['z', 'w'] }]), figsOf, staged);
  ok('so does one whose figures differ from the staging', !extraFig.ok, extraFig.why);
  const blind = OB.splitBank(exp.concat(older), figsOf, null);
  ok('and an older bank with no staging here to compare is refused, not passed', !blind.ok, blind.why);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'olderbank-'));
  const f = path.join(dir, 'questions.json');
  ok('no staging reads as none', OB.readStaging(f) === null);
  fs.writeFileSync(f, JSON.stringify([{ figs: ['a', 'b'] }, { figs: [] }, {}]));
  const rs = OB.readStaging(f);
  ok('and a staging is counted, question for question and figure for figure', !!rs && rs.count === 3 && rs.figs === 2, JSON.stringify(rs));
}

head('a key its own commentary contradicts is not staged');
{
  /* tools/key-prose.js, the matcher tests/verify-keys.js runs on the built
     bank. The owner's first merged build failed there on one imported
     question whose commentary named a different option from its key. */
  const { keyVsProse } = require('../tools/key-prose.js');
  const o = ['Beta blocker therapy.', 'Coronary angiography.', 'Exercise stress test.', 'Reassurance only.'].map(t => ({ t }));
  const agree = keyVsProse({ o, ci: 1, ex: 'Background. The correct answer is coronary angiography. More.' });
  const clash = keyVsProse({ o, ci: 0, ex: 'Background. The correct answer is coronary angiography. More.' });
  const negated = keyVsProse({ o, ci: 0, ex: 'Coronary angiography is not the correct answer choice here.' });
  const silent = keyVsProse({ o, ci: 0, ex: 'Nothing here names an answer.' });
  ok('a commentary naming the keyed option agrees', agree.checkable && !agree.disagrees);
  ok('a commentary naming another option is caught', clash.checkable && clash.disagrees);
  ok('an argument against a distractor is not read as a claim', !negated.checkable && !negated.disagrees);
  ok('and a commentary naming nothing is not judged at all', !silent.checkable && !silent.disagrees);
  const rep = A.formatReport([], { parsed: 5, noAnswer: 1, dupBank: 1, dupSelf: 0, added: 2, figures: 0, proseDisagrees: ['SECOND p12'],
    hist: { bank: Array(10).fill(0), self: Array(10).fill(0) }, threshold: 0.5, bankStems: 9, stemKey: 's' });
  ok('the report counts them and names their pages', /key disagrees with its own commentary \(not staged\) 1/.test(rep) && /disagreeing: SECOND p12/.test(rep),
     rep.split('\n').find(l => /commentary/.test(l)) || 'no such line');
  /* Read blanked, per CLAUDE.md: a comment quoting the pattern must not pass for the code. */
  const { blankComments } = require('./_source.js');
  const src = blankComments(require('fs').readFileSync(require('path').join(__dirname, '..', 'tools', 'older-acc-import.js'), 'utf8'));
  ok('and the importer checks every question before staging it', /if \(keyVsProse\(bq\)\.disagrees\)\s*\{[\s\S]{0,160}?continue;/.test(src));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
