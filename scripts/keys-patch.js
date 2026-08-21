#!/usr/bin/env node
/*
 * Six answer keys the export gets wrong.
 *
 *   node scripts/keys-patch.js <in.html> <out.html>
 *
 * HOW THEY GOT WRONG. In the export, `ci` — the index of the correct option —
 * is the most-chosen option in 638 of the 638 questions that carry a response
 * distribution. Not 637. Every single one. A real answer key cannot look like
 * that: a hard question is precisely one where most candidates pick the wrong
 * option, and 28 of these questions were answered correctly by under half the
 * cohort. `ci` was evidently derived from the statistics rather than from the
 * key, which lands on the right answer whenever the majority happened to be
 * right, and on the popular wrong answer whenever they were not.
 *
 * HOW THEY WERE FOUND. Half the ACCSAP commentaries name their answer in prose
 * — "The correct answer choice is antihypertensive therapy", or the reverse,
 * "Measurement of troponin is the correct answer choice". That sentence is
 * written by the author; `ci` is a number in a data file. Two independent
 * records of the same fact, so where they disagree, one is wrong. Matching the
 * prose against the option texts over 320 checkable questions produced nine
 * candidates; reading all nine, six are genuine and three are the matcher
 * tripping over an acronym. Every one of the six is confirmed below by a
 * sentence in which the commentary either names the option it does mark, or
 * calls the option the data marks a distractor.
 *
 * The remaining 319 questions state no answer in prose and cannot be checked
 * this way. The 38 of those in the hardest band — under 60% choosing the keyed
 * option, where a majority-derived key is most likely to have gone wrong —
 * were read by hand and all 38 agreed with their commentary.
 *
 * WHY IT IS A PATCH AND NOT AN EDIT. content/ is the licensed export and is
 * gitignored; it never gets hand-edited, and a fresh extraction would silently
 * undo any edit made there. Correcting it here means the fix lives in the build
 * and survives re-extraction, and the assertion below means a differently keyed
 * export fails loudly rather than being quietly "corrected" to the wrong thing.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/keys-patch.js <in.html> <out.html>'); process.exit(1); }

/* id, the key the export records, the key the commentary states, and the words
   that settle it. `was` is asserted: if the export ever ships a different value
   this build stops rather than overwriting a key nobody checked. */
const CORRECTIONS = [
  { id: 'CON_16', was: 'A', now: 'C',
    why: '"The correct answer choice is antihypertensive therapy" — and the commentary states this repaired tetralogy does not meet criteria for pulmonary valve replacement, the option the data marks.' },
  { id: 'MIS_25', was: 'E', now: 'D',
    why: '"Genetic testing … is the correct answer in this question" for suspected Fabry disease; of the marked option it says "a technetium pyrophosphate scan is used to diagnose transthyretin cardiac amyloidosis".' },
  { id: 'PER_9',  was: 'D', now: 'A',
    why: '"The correct answer choice is malignancy" — a normal CRP points away from an inflammatory effusion, and the commentary discusses tuberculosis only to set it aside.' },
  { id: 'SYS_9',  was: 'B', now: 'A',
    why: '"The correct answer choice is referral to an endocrinologist", named as a Class 1 indication once primary aldosteronism screens positive.' },
  { id: 'SYS_26', was: 'A', now: 'C',
    why: '"The correct answer choice is lower incidence of hip and pelvic fractures" with thiazides; nephrolithiasis is lower on a thiazide, not higher.' },
  { id: 'SYS_44', was: 'A', now: 'E',
    why: '"The correct answer choice is older age." Sodium sensitivity tracks with Black race and older age, and the stem\'s patient is Asian, which is what makes age the answer here.' },
];

let html = fs.readFileSync(SRC, 'utf8');

/* Same anchor the extractor uses, so the two agree about where the bank is. */
const RE = /\nconst ALL_Q=(\[[\s\S]*?\]);\n/;
const m = RE.exec(html);
if (!m) throw new Error('could not find "const ALL_Q=" — has stage0 run?');
const bank = JSON.parse(m[1]);

const byId = new Map(bank.map(q => [q.id, q]));
const applied = [];
for (const c of CORRECTIONS) {
  const q = byId.get(c.id);
  if (!q) throw new Error(`[${c.id}] not in the bank`);
  const cur = 'ABCDEFGH'[q.ci];
  if (cur !== c.was) {
    throw new Error(`[${c.id}] the export now keys ${cur}, not ${c.was} as recorded here.\n` +
                    `  This correction was written against a different export. Recheck the question before changing it.`);
  }
  const to = 'ABCDEFGH'.indexOf(c.now);
  if (to < 0 || to >= q.o.length) throw new Error(`[${c.id}] no option ${c.now}`);
  q.ci = to;
  applied.push(`${c.id}  ${c.was} → ${c.now}   ${q.o[to].t}`);
}

html = html.slice(0, m.index) + '\nconst ALL_Q=' + JSON.stringify(bank) + ';\n' + html.slice(m.index + m[0].length);
fs.writeFileSync(OUT, html);

console.log(`Answer keys corrected — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
