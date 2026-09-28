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
  const leaked = (text.match(/zq[a-z]+/gi) || []);
  ok('and not one word of any question, option or explanation', leaked.length === 0 && text.length > 400, leaked.slice(0, 5).join(', ') || `${text.length} chars, none`);
  ok('page lists are ranges', A.ranges([1, 2, 3, 7, 9, 10]) === '1-3, 7, 9-10' && A.ranges([]) === 'none');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
