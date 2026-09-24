#!/usr/bin/env node
/*
 * Figures made from the book: a study card and a comparison chart, drawn
 * as SVG from the lesson — every word and number the book's, escaped, and
 * wrapped to fit.
 *
 *   node tests/verify-memorizer-figure-pure.js
 */
'use strict';
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const F = require(path.join(__dirname, '..', 'memorizer', 'src', 'figure.js'));
const S = require(path.join(__dirname, '..', 'memorizer', 'src', 'sheet.js'));

/* The texts a figure draws, unescaped, in order. */
const texts = svg => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
const LESSON = { overview: 'Aortic stenosis is a narrowing of the aortic valve orifice that obstructs left ventricular outflow.', points: [
  { text: 'Calcific degeneration of a trileaflet valve is the most common cause in older adults.', page: 1 },
  { text: 'Angina, syncope and heart failure are the classic symptoms.', page: 1 }],
  numbers: [{ text: 'Severe stenosis is defined by a peak velocity of at least 4 m/s, a mean gradient of at least 40 mmHg or a valve area below 1.0 cm2.', page: 2 }],
  mnemonics: [{ title: 'Causes', letters: 'CBRR', words: ['Calcific degeneration', 'Bicuspid valve', 'Rheumatic disease', 'Radiation'] }] };

head('wrapping');
{
  const w = F.wrap('one two three four five six seven eight nine ten', 14);
  ok('lines are at most the width, words kept whole and in order', w.every(l => l.length <= 14) && w.join(' ') === 'one two three four five six seven eight nine ten', JSON.stringify(w));
  ok('a word longer than the width is a line of its own, not cut', JSON.stringify(F.wrap('a supercalifragilistic b', 6)) === '["a","supercalifragilistic","b"]');
  ok('nothing, no lines', F.wrap('', 10).length === 0);
}

head('the study card: the lesson, and nothing else');
{
  const sh = S.sheetOf(LESSON);
  const svg = F.studyCard('Aortic Stenosis', sh, LESSON.mnemonics, 'Valve disease · p. 1');
  const t = texts(svg), all = t.join(' ');
  ok('it is an SVG with a title', /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(svg) && /<title>Aortic Stenosis<\/title>/.test(svg));
  ok('the big idea, every word, in order', all.indexOf(LESSON.overview) !== -1, all.slice(0, 200));
  ok('every point, under its heading', ['CAUSES AND RISK FACTORS', 'PRESENTATION'].every(h => t.includes(h)) &&
     sh.groups.every(g => g.points.every(p => all.replace(/\s+/g, ' ').indexOf(p.text) !== -1)));
  ok('every number tile: its value and what it measures', ['≥ 4 m/s', '≥ 40 mmHg', '< 1.0 cm²', 'peak velocity', 'mean gradient', 'valve area'].every(x => t.includes(x)), JSON.stringify(t.filter(x => /[≥<]/.test(x))));
  ok('the mnemonic: each letter large, each word', ['C', 'B', 'R'].every(x => t.includes(x)) && LESSON.mnemonics[0].words.every(w => t.includes(w)));
  ok('and says where it came from', t.includes('VALVE DISEASE · P. 1') && /from your book’s own words/.test(all));
  const words = new Set(all.split(/\s+/));
  const src = [LESSON.overview, ...LESSON.points.map(p => p.text), ...LESSON.mnemonics[0].words, 'Aortic Stenosis', 'Valve disease · p. 1', 'Made by Memorizer from your book’s own words.',
    'Severe stenosis', 'CAUSES AND RISK FACTORS', 'PRESENTATION', 'VALVE DISEASE · P. 1', 'Causes', '• ', 'C B R R', '≥ 4 m/s ≥ 40 mmHg < 1.0 cm² peak velocity mean gradient valve area'].join(' ');
  const extra = [...words].filter(w => w && src.indexOf(w) === -1);
  ok('no word on it that is not the lesson’s (or the card’s own labels)', extra.length === 0, JSON.stringify(extra.slice(0, 5)));
  ok(`no line wider than the card: every text line fits ${F.W} px at its size`, [...svg.matchAll(/<text x="(\d+)"[^>]*font-size="(\d+)"[^>]*>([^<]*)</g)].every(m => +m[1] + m[3].length * +m[2] * 0.52 <= F.W + 1),
     [...svg.matchAll(/<text x="(\d+)"[^>]*font-size="(\d+)"[^>]*>([^<]*)</g)].filter(m => +m[1] + m[3].length * +m[2] * 0.52 > F.W + 1).map(m => m[3]).slice(0, 2).join(' | '));
  const evil = F.studyCard('<script>alert(1)</script> & "x"', { bigIdea: 'a < b > c', groups: [], numbers: [] }, [], 's');
  ok('text is escaped: a title with markup is drawn as text, not run', !/<script/i.test(evil) && /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;x&quot;/.test(evil) && /a &lt; b &gt; c/.test(evil));
  const longer = F.studyCard('T', S.sheetOf(Object.assign({}, LESSON, { points: LESSON.points.concat([{ text: 'Valve replacement is indicated once symptoms appear, surgically or by transcatheter implantation.', page: 2 }]) })), LESSON.mnemonics, 's');
  const hOf = s => +/height="(\d+)"/.exec(s)[1];
  ok('the card grows with its content, never cutting it', hOf(longer) > hOf(F.studyCard('T', sh, LESSON.mnemonics, 's')));
}

head('the comparison chart');
{
  const rows = [
    { title: 'Aortic stenosis', sheet: S.sheetOf(LESSON), mnemonic: LESSON.mnemonics[0] },
    { title: 'Mitral stenosis', sheet: S.sheetOf({ overview: 'Mitral stenosis obstructs left atrial emptying.', points: [], numbers: [{ text: 'Severe mitral stenosis is defined by a valve area of 1.5 cm2 or less.', page: 5 }] }) },
  ];
  const svg = F.compareChart('Valve disease', rows), t = texts(svg), all = t.join(' ');
  ok('one row per section, in order, each with its big idea', all.indexOf('Aortic stenosis') < all.indexOf('Mitral stenosis') &&
     /Aortic stenosis is a narrowing/.test(all) && /Mitral stenosis obstructs left atrial emptying\./.test(all));
  ok('its numbers, labelled', t.includes('valve area ≤ 1.5 cm²') && t.includes('peak velocity ≥ 4 m/s'), JSON.stringify(t.filter(x => /[≥≤<]/.test(x))));
  ok('its mnemonic letters', t.includes('C · B · R · R'));
  ok('columns headed', ['SECTION', 'THE BIG IDEA', 'NUMBERS'].every(x => t.includes(x)));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
