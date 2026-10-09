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
ok('every entry is 0 or four integers', Object.values(table).every(v => v === 0 || (Array.isArray(v) && v.length === 4 && v.every(Number.isInteger))));

head('it is consulted, and an entry that does not fit is refused');
/* Point note b's entry at its OTHER candidate — a real pearl, with its real
   score — and harvest must show that one. A table that was never read could
   not change the answer. */
const kb = P.bodyKey(NOTES[1].body);
const bParas = P.paragraphs(NOTES[1].body);
const firstPara = P.sentences(bParas[0]);
const altRun = firstPara.slice(0, 1).join(' ');
const swapped = Object.assign({}, table, { [kb]: [0, 0, 1, P.score(altRun)] });
const usesTable = P.harvest(NOTES, swapped).find(x => x.id === 'b');
ok('an entry pointing at another real pearl changes what is shown', P.isPearl(altRun) && !!usesTable &&
   usesTable.text === P.clean(altRun) && usesTable.text !== plainOut.find(x => x.id === 'b').text, usesTable && usesTable.text.slice(0, 50));
const bad = (entry) => J(P.harvest(NOTES, Object.assign({}, table, { [kb]: entry }))) === J(plainOut);
ok('positions past the end of the note are searched afresh', bad([9, 0, 1, 7]) && bad([0, 7, 2, 7]));
ok('a score that is not the run\'s own is searched afresh', bad([table[kb][0], table[kb][1], table[kb][2], table[kb][3] + 1]));
ok('a malformed entry is searched afresh', bad('x') && bad([1, 2]) && bad(null));
const edited = NOTES.map(n => n.id === 'd' ? Object.assign({}, n, { body: n.body.replace('140 mmHg', '150 mmHg') }) : n);
ok('an edited note is not in the table and is searched as it now reads',
   J(P.harvest(edited, table)) === J(P.harvest(edited)) && P.harvest(edited, table).find(x => x.id === 'd').text.includes('150 mmHg'));

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
