#!/usr/bin/env node
/*
 * How a text becomes the terms the search scores — src/core/terms.js.
 *
 *   node tests/verify-terms-pure.js
 *
 * Pure Node, over invented text. Each expected value is worked out here from the rules, not read back from the
 * module: the stems by the suffixes the stemmer folds, the terms by what the tokenizer drops and keeps.
 *
 * What is measured, rather than assumed:
 *   - a text is lower-cased and split on anything but letters, digits, subscript digits and - + /; a - + or / at
 *     either end of a token is trimmed;
 *   - the words every question says are left out, and so are numbers, and words under three letters unless they
 *     are a clinical abbreviation, which is kept as it is, unstemmed;
 *   - a hyphenated word is a term whole and again as each part of three letters or more (or an abbreviation) that
 *     is not a stopword;
 *   - the stemmer folds clinical morphology so the forms of a word meet (amyloidosis and amyloid, ischemia and
 *     ischemic, stenotic and stenosis), leaves a word of four letters or fewer and the words in KEEP alone, refuses
 *     a stem under five letters, and turns plurals singular;
 *   - stem() answers as stemWord() does, the first time and every time after (what the memo saves in time is not
 *     measured here: a memo that never hits answers the same);
 *   - the page's three names are the calls into this, written into the page once, above the index that uses them,
 *     and the page keeps no second copy.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');
const T = require('../src/core/terms.js').Terms;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);
const safely = fn => { try { return fn(); } catch (e) { return 'THREW ' + e.message; } };
const tok = s => safely(() => T.tok(s));
const stem = w => safely(() => T.stemWord(w));

head('a word\'s stem');
{
  ok('a word of four letters or fewer is its own stem, a plural of four letters too', ['lvh', 'vsds', 'mitr', 'beta', 'icds'].map(stem).join(' ') === 'lvh vsds mitr beta icds', ['lvh', 'vsds', 'mitr', 'beta', 'icds'].map(stem).join(' '));
  ok('so is each word in KEEP, which the -osis rule would otherwise cut', ['stenosis', 'thrombosis', 'diagnosis', 'prognosis', 'fibrosis'].every(w => stem(w) === w), ['stenosis', 'thrombosis', 'diagnosis'].map(stem).join(' '));
  /* amyloidosis: -osis off → amyloid. ischemia: -emia → -em → ischem; ischemic: -emic → -em → ischem. */
  ok('the forms of a word meet: amyloidosis and amyloid, ischemia and ischemic', stem('amyloidosis') === 'amyloid' && stem('amyloid') === 'amyloid' && stem('ischemia') === 'ischem' && stem('ischemic') === 'ischem',
     [stem('amyloidosis'), stem('ischemia'), stem('ischemic')].join(' '));
  ok('and any word that starts sten- is stenosis: stenotic, stenoses', stem('stenotic') === 'stenosis' && stem('stenoses') === 'stenosis', stem('stenotic') + ' ' + stem('stenoses'));
  /* cardiomyopathy: -pathy → -path. myocarditis: -itis → -it. calcification: -fication → -fi. regurgitation: -tion → -t. */
  ok('-pathy, -itis, -fication and -tion are folded', stem('cardiomyopathy') === 'cardiomyopath' && stem('cardiomyopathic') === 'cardiomyopath' && stem('myocarditis') === 'myocardit'
     && stem('calcification') === 'calcifi' && stem('regurgitation') === 'regurgitat', ['cardiomyopathy', 'myocarditis', 'calcification', 'regurgitation'].map(stem).join(' '));
  /* resistance: -ance → -an. dilated: -ed off. pacing: -ing off → pac, under five letters, refused: pacing. */
  ok('-ance and -ence, -ing and -ed, but never down to a stem under five letters', stem('resistance') === 'resistan' && stem('dilated') === 'dilat' && stem('pacing') === 'pacing' && stem('dosed') === 'dosed',
     ['resistance', 'dilated', 'pacing', 'dosed'].map(stem).join(' '));
  ok('a plural is made singular: -ies to -y, -ches and -xes and -ses lose -es, a plain -s goes', stem('therapies') === 'therapy' && stem('branches') === 'branch' && stem('vessels') === 'vessel' && stem('boxes') === 'box',
     ['therapies', 'branches', 'vessels', 'boxes'].map(stem).join(' '));
  ok('and a word ending -us, -ss, -is or -as is not a plural', ['thrombus', 'stress', 'pelvis', 'atlas', 'pancreas'].every(w => stem(w) === w), ['thrombus', 'stress', 'pelvis', 'pancreas'].map(stem).join(' '));
  const words = ['amyloidosis', 'ischemic', 'stenotic', 'therapies', 'pacing', 'valve'];
  ok('stem() answers as stemWord() does, the first time and again', words.every(w => safely(() => T.stem(w)) === stem(w)) && words.every(w => safely(() => T.stem(w)) === stem(w)));
}

head('a text\'s terms');
{
  ok('lower-cased, split on what is not a letter or a digit, each word stemmed', J(tok('Aortic STENOSIS, calcified; valves!')) === J(['aortic', 'stenosis', 'calcifi', 'valve']), J(tok('Aortic STENOSIS, calcified; valves!')));
  ok('the words every question says are left out: the patient, what is most likely, the best next step', J(tok('The patient presents with the most likely diagnosis; the best next step')) === J(['diagnosis', 'step']),
     J(tok('The patient presents with the most likely diagnosis; the best next step')));
  ok('and numbers, and words under three letters', J(tok('2 of 120 cm at ok ox')) === J([]), J(tok('2 of 120 cm at ok ox')));
  ok('but a short clinical abbreviation is kept, as it is: LV, MI, QT, AF-ib aside', J(tok('LV and RV after MI; QT long')) === J(['lv', 'rv', 'mi', 'qt', 'long']), J(tok('LV and RV after MI; QT long')));
  /* cabg, icd, copd are in the list; "icds" is not, and as a word of four letters it is its own stem. */
  ok('and an abbreviation is kept as it is, unstemmed', J(tok('CABG ICD ICDs copd')) === J(['cabg', 'icd', 'icds', 'copd']), J(tok('CABG ICD ICDs copd')));
  /* non-ST-elevation: whole, stemmed (-tion → -t), then its parts: non; st (an abbreviation? no: not in the list, and two
     letters) is left out; elevation → elevat. */
  ok('a hyphenated word is a term whole, and again as each part that counts', J(tok('non-ST-elevation')) === J(['non-st-elevat', 'non', 'elevat']), J(tok('non-ST-elevation')));
  /* "one-of" is a stopword whole, so its parts are never reached; "with-contrast" is not, and its part "with" is. */
  ok('a part that is a stopword, or too short, is not a term of its own; an abbreviation part is', J(tok('one-of LV-dilation with-contrast')) === J(['lv-dilat', 'lv', 'dilat', 'with-contrast', 'contrast']),
     J(tok('one-of LV-dilation with-contrast')));
  ok('a - + or / at either end of a token is trimmed', J(tok('-warfarin+ /heparin/')) === J(['warfarin', 'heparin']), J(tok('-warfarin+ /heparin/')));
  ok('subscript digits are part of a word', J(tok('CHA₂DS₂-VASc score')) === J(['cha₂ds₂-vasc', 'cha₂ds₂', 'vasc', 'score']), J(tok('CHA₂DS₂-VASc score')));
  ok('nothing, or what is not text, is no terms', J(tok('')) === '[]' && J(tok(null)) === '[]' && J(tok(undefined)) === '[]');
  ok('the stopwords and the short words are the module\'s', T.STOP.has('patient') && T.STOP.has('most-likely') && !T.STOP.has('stenosis') && T.SHORTOK.has('lv') && T.SHORTOK.has('cabg') && !T.SHORTOK.has('st'));
}

head('the page\'s three names are the calls into this');
{
  /* Read with its comments blanked: the shell explains itself, and quotes what is looked for. */
  const page = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
  const n = t => page.split(t).length - 1;
  const lines = ['function stem(w){ return Terms.stem(w); }', 'function stemWord(w){ return Terms.stemWord(w); }', 'function tok(s){ return Terms.tok(s); }'];
  const missing = lines.filter(l => n(l) !== 1).concat(['stem', 'stemWord', 'tok'].filter(x => n('function ' + x + '(') !== 1).map(x => x + '() defined more than once'));
  ok('each is one line handing over what it was given, and is defined once', missing.length === 0, missing.join(' | ') || 'all three');
  const slot = page.indexOf('@@SLOT[src:src/core/terms.js]@@');
  ok('the module is written into the page once, above the three and above the index that tokenizes', slot >= 0 && n('@@SLOT[src:src/core/terms.js]@@') === 1
     && ['function stem(', 'function tok(', 'function indexAdd('].every(t => page.indexOf(t) > slot), slot < 0 ? 'no slot' : 'slot at ' + slot);
  const kept = ['const STOP=', 'const SHORTOK=', 'const KEEP=', 'const STEMMED=', "'cabg','icd'", 'refuse aggressive truncation'].filter(t => n(t) > 0);
  ok('and the page keeps no second copy of the lists or the stemmer', kept.length === 0, kept.join(', ') || 'none left');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
