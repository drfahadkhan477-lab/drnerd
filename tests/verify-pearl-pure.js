#!/usr/bin/env node
/*
 * What the home screen's card makes of a pearl — src/core/pearl.js's mark() and chapterOf().
 *
 *   node tests/verify-pearl-pure.js
 *
 * Pure Node, over invented sentences. Each expected value is worked out here: the marks by the unit words the rule
 * names, the chapters by which name a note's chapter holds.
 *
 * What is measured, rather than assumed:
 *   - a measurement is marked: a number with a unit word after it, a percent, a range, a decimal, a number with a
 *     thousands comma; a number with no unit, or a unit with no number, is not;
 *   - the marking runs on escaped text and never reaches into an entity the escaper wrote, so the markup that comes
 *     back has every entity whole and no tag but the mark;
 *   - a pearl's chapter is the bank's chapter whose name its note's chapter holds, or holds the first word of, in
 *     any case; the first such chapter in the bank's order; none for a pearl with no chapter, or none at all;
 *   - the page's two names are the calls into this, written into the page above them, and the page keeps no copy of
 *     the rule.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');
const P = require('../src/core/pearl.js').Pearl;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const safely = fn => { try { return fn(); } catch (e) { return 'THREW ' + e.message; } };
const mark = s => safely(() => P.mark(s));
const b = m => '<b class="pearl-num">' + m + '</b>';
/* The page's escaper, as the page declares it (verify-md-pure holds the page's to this). */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);

head('a measurement is marked');
{
  ok('a number with a unit word after it', mark('Give 5 mg within 12 hours of onset.') === 'Give ' + b('5 mg') + ' within ' + b('12 hours') + ' of onset.', mark('Give 5 mg within 12 hours of onset.'));
  ok('a percent, with or without a space', mark('An EF of 40% or 35 %') === 'An EF of ' + b('40%') + ' or ' + b('35 %'), mark('An EF of 40% or 35 %'));
  ok('a range, with a hyphen or a dash', mark('2-3 days, then 5–10 mg') === b('2-3 days') + ', then ' + b('5–10 mg'), mark('2-3 days, then 5–10 mg'));
  ok('a decimal and a number with a thousands comma', mark('2.5 mg in 1,000 mL') === b('2.5 mg') + ' in ' + b('1,000 mL'), mark('2.5 mg in 1,000 mL'));
  ok('the clinical units: mmHg, bpm, msec, mmol, mEq, months as mo', ['30 mmHg', '110 bpm', '450 msec', '4 mmol', '20 mEq', '6 mo'].every(m => mark(m) === b(m)), ['30 mmHg', '6 mo'].map(mark).join(' '));
  ok('a number with no unit after it is not a measurement', mark('class 3 in 5 patients over 2 trials') === 'class 3 in 5 patients over 2 trials', mark('class 3 in 5 patients over 2 trials'));
  ok('and a unit word with no number is not either', mark('the mg dose in hours') === 'the mg dose in hours');
  /* "ms" is a unit; "msec" a longer one; "msecs" neither, ending past a word boundary the rule needs. */
  /* A number has to start a word: lead V2 and a QT of 450 msec, not "V" and "2 mm". */
  ok('a number glued to a word is not a measurement: lead V2 mm', mark('ST elevation in V2 mm, 2 mm in V3') === 'ST elevation in V2 mm, ' + b('2 mm') + ' in V3', mark('ST elevation in V2 mm, 2 mm in V3'));
  ok('a unit is a whole word: 3 msecs and 4 kgs are not marked', mark('3 msecs and 4 kgs') === '3 msecs and 4 kgs', mark('3 msecs and 4 kgs'));
}

head('the marking never reaches into what the escaper wrote');
{
  const raw = '<b>5 mg</b> & "3 cm" isn\'t <10 mmHg>';
  const out = mark(esc(raw));
  ok('every entity comes back whole', typeof out === 'string' && ['&lt;b&gt;', '&lt;/b&gt;', '&amp;', '&quot;', '&#39;', '&lt;', '&gt;'].every(t => out.includes(t)), out);
  ok('the only tags are the marks, around the measurements', typeof out === 'string' && out.replace(/<b class="pearl-num">[^<]*<\/b>/g, '').indexOf('<') < 0
     && out.includes(b('5 mg')) && out.includes(b('3 cm')) && out.includes(b('10 mmHg')), out);
  /* &#39; has digits, and no unit after them: it is never read as a number. */
  ok('the digits of a numeric entity are never a measurement', mark('it&#39;s 39 mg') === 'it&#39;s ' + b('39 mg'), mark('it&#39;s 39 mg'));
}

head('the bank\'s chapter a pearl is from');
{
  const CH = ['Valves & more', 'Rhythm', 'Heart failure'];
  const of = (chapter, chapters) => safely(() => P.chapterOf({ chapter }, chapters || CH));
  ok('the chapter whose name the note\'s chapter holds, in any case', of('RHYTHM notes') === 'Rhythm' && of('My heart failure deck') === 'Heart failure', of('RHYTHM notes') + ' / ' + of('My heart failure deck'));
  ok('or whose first word it holds', of('Valves, week 2') === 'Valves & more', of('Valves, week 2'));
  ok('the first such chapter in the bank\'s order', of('heart rhythm', ['Heart failure', 'Rhythm']) === 'Heart failure' && of('heart rhythm', ['Rhythm', 'Heart failure']) === 'Rhythm');
  ok('none for a chapter no name matches, a pearl with none, or no pearl', of('Pharmacology') === null && of('') === null && of(undefined) === null && safely(() => P.chapterOf(null, CH)) === null);
}

head('the page\'s two names are the calls into this');
{
  /* Read with its comments blanked: the shell explains itself, and quotes what is looked for. */
  const page = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
  const n = t => page.split(t).length - 1;
  ok('pearlMark() and pearlChapter() are one line each, handing over the text and the page\'s chapters',
     n('function pearlMark(escaped){ return Pearl.mark(escaped); }') === 1 && n('function pearlChapter(p){ return Pearl.chapterOf(p,CHAPTERS); }') === 1 && n('function pearlMark(') === 1 && n('function pearlChapter(') === 1);
  const slot = page.indexOf('@@SLOT[src:src/core/pearl.js]@@');
  ok('the module is written into the page above them', slot >= 0 && slot < page.indexOf('function pearlMark(') && slot < page.indexOf('function pearlChapter('), slot < 0 ? 'no slot' : 'slot at ' + slot);
  ok('and the page keeps no copy of the rule', n('PEARL_NUM') === 0 && n('mmHg|mL') === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
