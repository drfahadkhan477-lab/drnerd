#!/usr/bin/env node
/*
 * A lesson laid out to be remembered: points under clinical headings,
 * numbers as value tiles, nothing said twice.
 *
 *   node tests/verify-memorizer-sheet-pure.js
 *
 * Pure Node, on sentences written here in the shape a cardiology text uses.
 */
'use strict';
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const S = require(path.join(__dirname, '..', 'memorizer', 'src', 'sheet.js'));
const tiles = t => S.numberTiles(t).tiles.map(x => x.label + ' = ' + x.value).join(' | ');

head('numbers as tiles: the value large, what it measures under it');
{
  const t = S.numberTiles('Severe stenosis is defined by a peak velocity of at least 4 m/s, a mean gradient of at least 40 mmHg or a valve area below 1.0 cm2.');
  ok('each value with what it measures, the comparison as a symbol', tiles('Severe stenosis is defined by a peak velocity of at least 4 m/s, a mean gradient of at least 40 mmHg or a valve area below 1.0 cm2.') ===
     'peak velocity = ≥ 4 m/s | mean gradient = ≥ 40 mmHg | valve area = < 1.0 cm²', tiles('Severe stenosis is defined by a peak velocity of at least 4 m/s, a mean gradient of at least 40 mmHg or a valve area below 1.0 cm2.'));
  ok('titled by what the sentence defines', t.subject === 'Severe stenosis', t.subject);
  ok('a verb before the comparison is not part of the label; "percent" is %', tiles('Surgery is advised when the ejection fraction falls below 55 percent, or when the end-systolic dimension exceeds 50 mm.') ===
     'ejection fraction = < 55% | end-systolic dimension = > 50 mm');
  ok('"or less" after a value is ≤', tiles('Severe mitral stenosis is defined by a valve area of 1.5 cm2 or less.') === 'valve area = ≤ 1.5 cm²');
  ok('a range is one tile', tiles('A normal pressure of 8 to 12 mmHg does not exclude a stiff ventricle.') === 'normal pressure = 8–12 mmHg', tiles('A normal pressure of 8 to 12 mmHg does not exclude a stiff ventricle.'));
  ok('a number with no unit and no comparison is not a value to learn', S.numberTiles('Section 1 of 3 covers class 2 disease.').tiles.length === 0);
  /* "mmol" is not "mm" with "ol" left over: a unit ends where the word does. */
  ok('a unit is a whole word: "5.5 mmol" is not 5.5 mm', tiles('Potassium above 5.5 mmol per litre is dangerous.') === 'Potassium = > 5.5', tiles('Potassium above 5.5 mmol per litre is dangerous.'));
  ok('a number inside a word or code is not either: "P2Y12", "2x"', S.numberTiles('P2Y12 inhibitors are given 2x daily.').tiles.length === 0, tiles('P2Y12 inhibitors are given 2x daily.'));
  ok(`a label is at most ${S.MAX_LABEL_WORDS} words, the ones nearest the value`,
     tiles('The pressure measured in the pulmonary capillary wedge position at end expiration exceeds 18 mmHg.') === 'capillary wedge position at end expiration = > 18 mmHg',
     tiles('The pressure measured in the pulmonary capillary wedge position at end expiration exceeds 18 mmHg.'));
}

head('the sheet');
{
  const L = { overview: 'Aortic stenosis is a narrowing of the aortic valve orifice.', points: [
    { text: 'Aortic stenosis is a narrowing of the aortic valve orifice.', page: 1 },
    { text: 'Angina, syncope and heart failure are the classic symptoms.', page: 1 },
    { text: 'Calcific degeneration is the most common cause in older adults.', page: 1 },
    { text: 'Valve replacement is indicated once symptoms appear.', page: 2 },
    { text: 'Echocardiography confirms the diagnosis.', page: 2 },
  ], numbers: [{ text: 'Severe stenosis is defined by a mean gradient of at least 40 mmHg.', page: 2 }, { text: 'It was described in 1904 in Section 3.', page: 3 }] };
  const sh = S.sheetOf(L);
  ok('the big idea is not repeated as a point', sh.bigIdea === L.overview && !sh.groups.some(g => g.points.some(p => p.text === L.overview)));
  ok('points under clinical headings, in teaching order', JSON.stringify(sh.groups.map(g => g.heading)) === '["Causes and risk factors","Presentation","Diagnosis","Treatment"]',
     JSON.stringify(sh.groups.map(g => g.heading)));
  ok('every other point is kept, once', sh.groups.reduce((n, g) => n + g.points.length, 0) === 4);
  const dup = S.sheetOf({ overview: 'x', points: [{ text: 'Severe stenosis is defined by a mean gradient of at least 40 mmHg.', page: 2 }, { text: 'Surgery helps.', page: 2 }],
    numbers: [{ text: 'Severe stenosis is defined by a mean gradient of at least 40 mmHg.', page: 2 }] });
  ok('a point shown as number tiles is not shown again as a sentence', dup.numbers.length === 1 && dup.groups.reduce((n, g) => n + g.points.length, 0) === 1 &&
     dup.groups[0].points[0].text === 'Surgery helps.');
  ok('numbers become tiles with their page; a fact with no value to learn is dropped', sh.numbers.length === 1 && sh.numbers[0].page === 2 && sh.numbers[0].tiles[0].value === '≥ 40 mmHg');
  const noOv = S.sheetOf({ overview: '', points: [{ text: 'First point here.', page: 1 }, { text: 'Treatment is surgery.', page: 1 }], numbers: [] });
  ok('with no overview, the first point is the big idea, and not repeated', noOv.bigIdea === 'First point here.' && noOv.groups.reduce((n, g) => n + g.points.length, 0) === 1);
  ok('a point under no heading is under "Also know"', S.sheetOf({ overview: 'x', points: [{ text: 'Blue skies are nice.', page: 1 }], numbers: [] }).groups[0].heading === 'Also know');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
