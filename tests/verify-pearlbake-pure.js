#!/usr/bin/env node
/*
 * The seeded notes' pearls, found at build time: is what the app shows from
 * the table exactly what it would have found by searching, and is a table that
 * does not fit the note refused?
 *
 *   node tests/verify-pearlbake-pure.js
 *
 * WHY. Pearl.harvest() searched every run of every paragraph of every note at
 * launch. On the owner's laptop at an iPad's CPU pace it was the largest cost
 * left after the heart was baked, blocking the page just after the home screen
 * appeared. scripts/pearl-bake.js now runs pearl.js's own bake() over the seed
 * at build time, assemble-app fills the REF_PEARLS slot, and pearlAll() hands
 * the table to harvest().
 *
 * WHAT IS CLAIMED, AND HELD HERE:
 *   · with the table, harvest() returns exactly what it returns without one;
 *   · the table carries no note text — positions and scores only;
 *   · it is consulted, not decoration, and an entry that does not fit the note
 *     (an edited note, out-of-range positions, a wrong score) is searched afresh;
 *   · the build bakes the seed it ships, and the app passes the table along.
 *
 * The notes below are written for this suite, in its own words. No reference
 * note, licensed or otherwise, is read.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const { bakePearls, loadPearl } = require('../scripts/pearl-bake.js');
const P = loadPearl();
const J = JSON.stringify;

/* Invented notes. Several have a pearl, one has two candidates in different
   paragraphs, and two have nothing quotable — so the table holds both kinds of
   entry. */
const NOTES = [
  { id: 'a', title: 'Unit · Dosing — Loading and maintenance', source: 's',
    body: 'A loading dose of 400 mg should be given before the maintenance dose, and the dose must be halved when clearance falls below 30 ml/min. The maintenance phase then follows the usual schedule for most adults.\n\nRenal function is checked within 48 hours of the first dose rather than at the end of the first week, because early accumulation is what causes harm.' },
  { id: 'b', title: 'Unit · Imaging — Telling two patterns apart', source: 's',
    body: 'The first pattern is distinguished from the second by its timing, whereas the second appears only after exertion and never at rest in the early stages. Both are common in older adults with long-standing disease.\n\nA follow-up scan is indicated within 6 months when the first study is equivocal, and it should use the same protocol so that the two can be compared directly.' },
  { id: 'c', title: 'Unit · Background — History', source: 's',
    body: 'Short note.\n\nAnother short line without much in it.' },
  { id: 'd', title: 'Unit · Thresholds — When to act', source: 's',
    body: 'Treatment is required when the measured value exceeds 140 mmHg on two occasions at least a week apart, and it should begin with a single agent instead of a combination. Most patients respond within 4 weeks of starting.' },
  { id: 'e', title: 'Unit · Lists — Things that are associated', source: 's',
    body: 'Associated findings include A, B, C, D, E and F.' },
  { id: 'f', title: 'Unit · Figures — With a diagram', source: 's',
    body: '![Fig. 1 — the loop](refimg://unit/fig1.jpg)\n\nThe loop must be closed before the second stage begins, and failure to close it within 10 minutes is what distinguishes the unstable course from the stable one.' },
];

head('the search is the one harvest makes');
ok('pearl.js exposes bake() and bodyKey()', typeof P.bake === 'function' && typeof P.bodyKey === 'function');
const plainOut = P.harvest(NOTES);
/* Vacuity guard: identical output proves nothing if there is no output. */
ok('the notes give real pearls, and some notes give none', plainOut.length >= 4 && plainOut.length < NOTES.length,
   `${plainOut.length} pearls from ${NOTES.length} notes`);
const table = P.bake(NOTES);
/* Identical output alone cannot see a bake whose entries are all refused:
   harvest() would search every note and still answer the same. That would
   be a table that saves nothing. Every entry baked must be one it uses. */
const unused = NOTES.filter(n => Array.isArray(table[P.bodyKey(n.body)]) && !P.entryFits(n.body, table[P.bodyKey(n.body)]));
ok('every pearl the build bakes is one harvest uses, not one it searches past', unused.length === 0 &&
   NOTES.some(n => Array.isArray(table[P.bodyKey(n.body)])), unused.map(n => n.id).join(', ') || 'all used');
ok('the table has one entry per note, both kinds present', Object.keys(table).length === NOTES.length &&
   Object.values(table).some(v => v === 0) && Object.values(table).some(Array.isArray), J(Object.values(table)));

head('with the table, harvest returns exactly what it finds without one');
ok('the same pearls, field for field', J(P.harvest(NOTES, table)) === J(plainOut));
ok('and with no table at all, harvest is unchanged', J(P.harvest(NOTES, null)) === J(plainOut) && J(P.harvest(NOTES, undefined)) === J(plainOut));

head('the table carries positions and scores, never the notes\' text');
const flat = J(table);
const leaked = NOTES.some(n => n.body.split(/(?<=\.)\s/).some(s => s.length >= 20 && flat.includes(s.slice(0, 20))));
ok('no run of note text appears in it', !leaked);
ok('every entry is 0 or three integers', Object.values(table).every(v => v === 0 || (Array.isArray(v) && v.length === 3 && v.every(Number.isInteger))));

head('it is consulted, and an entry that does not fit is refused');
/* Point note b's entry at its OTHER candidate — a real pearl, with its real
   score — and harvest must show that one. A table that was never read could
   not change the answer. */
const kb = P.bodyKey(NOTES[1].body);
const bParas = P.paragraphs(NOTES[1].body);
const firstPara = P.sentences(bParas[0]);
const altRun = firstPara.slice(0, 1).join(' ');
const altAt = NOTES[1].body.indexOf(altRun);
const swapped = Object.assign({}, table, { [kb]: [altAt, altAt + altRun.length, P.score(altRun)] });
const usesTable = P.harvest(NOTES, swapped).find(x => x.id === 'b');
ok('an entry pointing at another real pearl changes what is shown', P.isPearl(altRun) && !!usesTable &&
   usesTable.text === P.clean(altRun) && usesTable.text !== plainOut.find(x => x.id === 'b').text, usesTable && usesTable.text.slice(0, 50));
/* Refused, and searched afresh. Both halves: an entry that points at the same
   pearl in another way would leave the output unchanged while being used. */
const bad = (entry) => !P.entryFits(NOTES[1].body, entry) &&
  J(P.harvest(NOTES, Object.assign({}, table, { [kb]: entry }))) === J(plainOut);
/* Each bad entry is the baked one with one field broken, so the shape is
   right and only the broken field can be what refuses it. */
/* A bake with no entry for b fails the checks above; this one should report, not crash. */
const eb = Array.isArray(table[kb]) ? table[kb] : [0, 1, 0], with_ = (j, v) => eb.map((x, k) => k === j ? v : x);
ok('a span outside the note, or empty, is searched afresh',
   bad(with_(0, NOTES[1].body.length)) && bad(with_(1, NOTES[1].body.length + 1)) && bad(with_(1, eb[0])));
/* The one the range test alone stands between: slice() reads a negative start
   from the end of the note, so this names the very same run and would pass
   every check of the run itself. */
const fBody = NOTES[5].body, kf = P.bodyKey(fBody), ef = table[kf];
const neg = Array.isArray(ef) ? [ef[0] - fBody.length, ef[1], ef[2]] : null;
ok('a negative start that slice() would read as the same run is refused',
   !!neg && ef[0] > 0 && fBody.slice(neg[0], neg[1]) === fBody.slice(ef[0], ef[1]) && !P.entryFits(fBody, neg) &&
   J(P.harvest(NOTES, Object.assign({}, table, { [kf]: neg }))) === J(plainOut), J(ef));
ok('a score that is not the run\'s own is searched afresh', bad(with_(2, eb[2] + 1)));
ok('a malformed entry is searched afresh', bad('x') && bad([1, 2]) && bad(null) && bad(eb.slice(1)) && bad(eb.concat(0)) && bad(with_(0, eb[0] + 0.5)));
const edited = NOTES.map(n => n.id === 'd' ? Object.assign({}, n, { body: n.body.replace('140 mmHg', '150 mmHg') }) : n);
ok('an edited note is not in the table and is searched as it now reads',
   J(P.harvest(edited, table)) === J(P.harvest(edited)) && P.harvest(edited, table).find(x => x.id === 'd').text.includes('150 mmHg'));

head('a lookup reads the pearl\'s own span, not the whole note');
/* The point of the span. With the run named by paragraph and sentence index,
   reaching it still cleaned the whole note, and the owner's profile showed
   that walk costing most of what the search had. Measured, not timed:
   plain(), sentences(), clean() and the scoring do their text work through
   String.prototype.replace, so the longest string handed to replace during a
   lookup is the most of the note any step read. (Not the total: scoring a run
   takes about twenty passes over it, and that sum says nothing about the
   note.) The pearl sits between long runs of filler, so its span starts well
   inside the note. */
const filler = Array.from({ length: 120 }, (_, k) => `Filler line ${k} says very little at all.`).join('\n\n');
const big = { id: 'g', title: 'Unit · Long — Pearl in the middle', source: 's',
              body: filler + '\n\n' + NOTES[3].body + '\n\n' + filler };
const bigT = P.bake([big]);
const bigE = bigT[P.bodyKey(big.body)];
const span = Array.isArray(bigE) ? bigE[1] - bigE[0] : 0;
const nativeReplace = String.prototype.replace;
let longest = 0, bigOut;
String.prototype.replace = function (...a) { longest = Math.max(longest, this.length); return nativeReplace.apply(this, a); };
try { bigOut = P.harvest([big], bigT); } finally { String.prototype.replace = nativeReplace; }
ok('the long note\'s pearl is baked as a span well inside the note, and found from it',
   Array.isArray(bigE) && bigE[0] > filler.length && span < NOTES[3].body.length + 1 &&
   bigOut.length === 1 && J(bigOut) === J(P.harvest([big])), J(bigE));
ok('and no step of the lookup reads more than that span', longest > 0 && longest <= span,
   `longest string through replace ${longest}, span ${span}, note ${big.body.length}`);

/* A code span opened in one paragraph and closed in the next. plain() removes
   it, blank line and all, so the run the search finds joins words that are not
   side by side in the raw note, and no stretch of the note reads as that run.
   bake() must leave the note out and let the app search it. */
const split = { id: 's', title: 'Unit · Odd — A span across a blank line', source: 's',
                body: 'A short opener with a stray `tick in it.\n\nAnd the other` tick sits here. ' + NOTES[3].body };
const splitT = P.bake([split]);
ok('a note whose run is not a stretch of its text is left out of the table, and still gets its pearl',
   !Object.prototype.hasOwnProperty.call(splitT, P.bodyKey(split.body)) &&
   P.harvest([split]).length === 1 && J(P.harvest([split], splitT)) === J(P.harvest([split])), J(splitT));

head('the build bakes the seed it ships, and the app passes the table on');
const seed = J(NOTES.map(n => ({ title: n.title, body: n.body, source: n.source })));
ok('pearl-bake over the seed is pearl.js\'s own bake of it', bakePearls(seed) === J(P.bake(JSON.parse(seed))));
ok('an empty seed bakes to an empty table', bakePearls('[]') === '{}' && bakePearls('') === '{}');
const asm = blankComments(fs.readFileSync(path.join(ROOT, 'scripts', 'assemble-app.js'), 'utf8'));
ok('assemble-app fills REF_PEARLS from the REF_SEED it builds',
   /REF_PEARLS:\s*\(\)\s*=>\s*bakePearls\(once\('REF_SEED',\s*PAYLOAD\.REF_SEED\)\)/.test(asm));
const app = fs.readFileSync(path.join(ROOT, 'app', 'systole.html'), 'utf8');
ok('the page carries the slot exactly once',
   app.split('/*REF_PEARLS_START*/@@SLOT[payload:REF_PEARLS]@@/*REF_PEARLS_END*/').length === 2);
ok('and pearlAll() hands it to harvest()',
   /Pearl\.harvest\(REF,\s*typeof REF_PEARLS==='object'\?REF_PEARLS:null\)/.test(app));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
