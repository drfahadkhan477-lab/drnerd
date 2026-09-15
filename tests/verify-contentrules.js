#!/usr/bin/env node
/*
 * The structural rules fire on a broken question and not on a sound one.
 *
 *   node tests/verify-contentrules.js
 *
 * Pure Node, no browser, no build, no licensed content — every bank below is
 * three invented cardiology-shaped questions written for this file. That is
 * the point: a checker for the licensed bank must be provable without the
 * licensed bank, or it only gets tested on the one laptop that has it.
 *
 * tests/verify-content.js applies the same rules to the REAL bank as a gate.
 * This file proves the rules themselves are worth applying.
 *
 * WHY THE QUIET HALF IS THE LOAD-BEARING HALF. A structural checker that flags
 * sound questions gets switched off, and then the one real defect it would
 * have caught ships. So every rule here is checked in both directions, and the
 * healthy bank at the end must produce exactly zero findings.
 */
'use strict';
const { check, undisclosed, stemKey } = require('../scripts/content-checks.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

/* A sound bank. Long stems, because the stem field is inferred by length. */
const stemFor = n => `A ${50 + n}-year-old presents with exertional dyspnoea and a murmur; ` +
                     `echocardiography shows a mean gradient of ${20 + n} mmHg. Number ${n}.`;
const sound = () => [
  { id: 'VAL_1', ch: 'Valvular Disease', text: stemFor(1), o: ['A', 'B', 'C', 'D'], ci: 2, ex: 'because' },
  { id: 'VAL_2', ch: 'Valvular Disease', text: stemFor(2), o: ['A', 'B', 'C', 'D'], ci: 0, ex: 'because' },
  { id: 'COR_1', ch: 'Coronary Disease', text: stemFor(3), o: ['A', 'B', 'C', 'D'], ci: 3, ex: 'because' },
];
const rulesOn = bank => [...new Set(check(bank).map(f => f.rule))];
const broken = (mutate) => { const b = sound(); mutate(b); return rulesOn(b); };

head('the stem field is inferred, not assumed');
{
  ok('it finds the field holding the question text', stemKey(sound()) === 'text', String(stemKey(sound())));
  /* The dangerous case: no stem field at all. A checker that shrugged would
     report a clean bank, which is silence dressed as evidence. */
  const noStem = sound().map(q => { const { text, ...rest } = q; return rest; });
  ok('and returns null when there is no such field — never a wrong guess',
     stemKey(noStem) === null, String(stemKey(noStem)));
  ok('and null on an empty bank', stemKey([]) === null);
}

head('each rule fires on the defect it is for');
{
  ok('an answer index past the end of the options',
     broken(b => { b[0].ci = 9; }).includes('ANSWER'));
  ok('an answer index that is not a number at all',
     broken(b => { b[0].ci = null; }).includes('ANSWER'));
  ok('a missing options array', broken(b => { delete b[0].o; }).includes('OPTIONS'));
  ok('too few options', broken(b => { b[0].o = ['only one']; }).includes('OPTIONS'));
  ok('a blank option among real ones', broken(b => { b[0].o[2] = '   '; }).includes('OPTIONS'));
  ok('two questions sharing an id', broken(b => { b[1].id = 'VAL_1'; }).includes('DUPLICATE_ID'));
  ok('a question with no id', broken(b => { delete b[0].id; }).includes('ID'));
  ok('a question with no chapter', broken(b => { delete b[0].ch; }).includes('CHAPTER'));
  ok('an id prefix filed under the wrong chapter',
     broken(b => { b[1].ch = 'Heart Failure'; }).includes('CHAPTER'));
  ok('a declared figure count that disagrees with the figures carried',
     broken(b => { b[0].img = 3; b[0].figs = ['one.webp']; }).includes('FIGURES'));
  ok('an empty stem', broken(b => { b[0].text = ''; }).includes('STEM'));
  ok('the same question twice under different ids',
     broken(b => { b[1].text = b[0].text; }).includes('DUPLICATE_STEM'));
  ok('a bank that is not a bank', rulesOn('nonsense').includes('BANK'));
  ok('an entry that is not a question', broken(b => { b.push(42); }).includes('SHAPE'));
}

head('and none of them fires on a sound bank');
{
  const findings = check(sound());
  ok('a healthy bank produces no findings at all', findings.length === 0,
     findings.map(f => `${f.id}:${f.rule}`).join(', ') || 'none');
  /* The fields the single-file build legitimately lacks must not be findings:
     figs only exists in the split build, and img is absent when there is no
     figure. A rule that demanded them would fail every single-file bank. */
  const singleFile = sound().map(q => { const { figs, ...rest } = q; return rest; });
  ok('a bank with no figs arrays is still clean — the single file has none',
     check(singleFile).length === 0, check(singleFile).map(f => f.rule).join(', ') || 'none');
  const withFigs = sound();
  withFigs[0].img = 2; withFigs[0].figs = ['a.webp', 'b.webp'];
  ok('and a figure count that agrees is clean', check(withFigs).length === 0);
}

head('a disclosed defect is a known limitation, not a regression');
{
  /* The COR_89 shape: the export really is broken, the app really does say so,
     and the build must not fail every time because of it. */
  const flagged = sound();
  flagged[0].ci = 9;
  ok('an undisclosed defect gates the build',
     undisclosed(flagged).some(f => f.rule === 'ANSWER'));
  flagged[0].flag = 'The lettered answer panels are not in the source PDF.';
  ok('the same defect, disclosed to the fellow, does not',
     !undisclosed(flagged).some(f => f.id === 'VAL_1'),
     undisclosed(flagged).map(f => f.id).join(', ') || 'none');
  ok('and `bad` discloses it just as `flag` does',
     (() => { const b = sound(); b[0].ci = 9; b[0].bad = 'answer key unconfirmed'; 
              return !undisclosed(b).some(f => f.id === 'VAL_1'); })());
  /* But disclosure is per-question, not a blanket amnesty. */
  const two = sound();
  two[0].ci = 9; two[0].flag = 'known';
  two[1].ci = 9;
  ok('flagging one question does not excuse another',
     undisclosed(two).some(f => f.id === 'VAL_2'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
