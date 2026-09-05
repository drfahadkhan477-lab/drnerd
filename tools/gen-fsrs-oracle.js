#!/usr/bin/env node
/*
 * Generate the FSRS oracle fixture from an independent implementation.
 *
 *   npm i ts-fsrs            # dev-only; nothing ships
 *   node tools/gen-fsrs-oracle.js
 *
 * WHY. src/core/fsrs.js has 46 checks and every one of them was written by the
 * same hand that wrote the code. That catches typos and regressions; it cannot
 * catch a formula transcribed wrongly from the paper, because the check would
 * be transcribed wrongly too. An independent implementation can.
 *
 * ts-fsrs is that implementation. It is fed OUR nineteen weights, so the
 * parameters are not the variable — only the arithmetic is. (ts-fsrs is on
 * FSRS-6 and pads 19 weights to 21 with [0.01, 0.5]; w20 = 0.5 is the decay
 * magnitude, which is exactly FSRS-5's fixed −0.5, and w19 drives a
 * same-day path neither implementation is asked for here.)
 *
 * The fixture is DATA. It is checked in, and tests/verify-oracle.js reads it
 * in bare Node with no dependency at all — which is what lets CI run it, since
 * CI has the repository but never the licensed export.
 *
 * Rows are [S, D, elapsedDays, grade, theirRetrievability, nextDifficulty,
 * nextStability] — compact on purpose; 700 rows of objects is four times the
 * bytes for the same information.
 *
 * Every value ts-fsrs returns is rounded to eight decimals, so the fixture is
 * exact to about 1e-8 absolute and the reader should compare no tighter.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const mod = {};
new Function('module', 'exports',
  fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'fsrs.js'), 'utf8'))
  .call(mod, { exports: mod }, mod);
const OURS = mod.FSRS;

let ts;
try { ts = require('ts-fsrs'); }
catch (e) {
  console.error('\n  ts-fsrs is not installed. It is a dev dependency of this\n' +
                '  generator only — nothing ships it:\n\n    npm i ts-fsrs\n');
  process.exit(1);
}

const oracle = ts.fsrs({ w: OURS.W, enable_fuzz: false, request_retention: 0.9 });
const P = Object.getPrototypeOf(Object.getPrototypeOf(oracle));

const S_GRID  = [0.5, 1, 3, 10, 40, 150, 400];
const D_GRID  = [1, 2.5, 5, 7.5, 10];
const EL_GRID = [1, 3, 10, 60, 300];
const GRADES  = [1, 2, 3, 4];

/* WHY THE SHARED RETRIEVABILITY IS OURS, AT FULL PRECISION.
   ts-fsrs rounds every public result to eight decimals, forgetting_curve
   included, and then feeds that rounded R into the stability formula. That
   formula contains exp((1-R)·w10) - 1, and near R = 1 the subtraction cancels
   the leading 1 and multiplies the error: at S=40, D=1, one day elapsed, a
   4.3e-9 difference in R became 1.6e-5 in the stability out the far side.

   Comparing our stability against a value computed from THEIR rounded R would
   therefore measure their serialisation, not our arithmetic — and it would
   report a disagreement that does not exist. Given the same R, the two agree
   to ts-fsrs's full output precision.

   So the stability columns are generated from the unrounded R, and the
   forgetting curve is checked separately against their rounded value on its
   own terms. Both properties get tested; neither comparison is fudged. */
const rows = [];
for (const S of S_GRID) for (const D of D_GRID) for (const el of EL_GRID) for (const g of GRADES) {
  const rExact  = OURS.retrievability(S, el);       // full double precision
  const rTheirs = oracle.forgetting_curve(el, S);   // theirs, rounded to 8dp
  const nextD = P.next_difficulty.call(oracle, D, g);
  const nextS = g === 1 ? P.next_forget_stability.call(oracle, D, S, rExact)
                        : P.next_recall_stability.call(oracle, D, S, rExact, g);
  rows.push([S, D, el, g, rTheirs, nextD, nextS]);
}

/* Initial states too — the path a card takes on its very first review, which
   the grid above never exercises because it always has a prior state. */
const init = GRADES.map(g => [g, P.init_difficulty.call(oracle, g), P.init_stability.call(oracle, g)]);

const out = {
  _generated: 'by tools/gen-fsrs-oracle.js — do not hand-edit',
  _why: 'An independent implementation of FSRS, fed our own weights, so the ' +
        'arithmetic is the only variable. See tests/verify-oracle.js.',
  /* ts-fsrs does not export ./package.json, so the version is read off disk
     rather than required. It is recorded because the fixture is only as
     meaningful as the implementation that produced it: a regenerated fixture
     from a different version is a different oracle, and the reader should be
     able to see which one. */
  generator: { name: 'ts-fsrs', version: JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'node_modules', 'ts-fsrs', 'package.json'), 'utf8')).version },
  ourWeights: OURS.W,
  ourDecay: OURS.DECAY,
  ourFingerprint: OURS.paramsFingerprint(),
  columns: ['stability', 'difficulty', 'elapsedDays', 'grade',
            'theirRetrievability', 'nextDifficulty', 'nextStability'],
  initColumns: ['grade', 'initDifficulty', 'initStability'],
  outputPrecision: 1e-8,   // ts-fsrs rounds every public result to 8 decimals
  init,
  rows,
};

const dest = path.join(__dirname, '..', 'tests', 'fixtures', 'fsrs-oracle.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${rows.length} rows + ${init.length} initial states`);
console.log(`  generator   ts-fsrs ${out.generator.version}`);
console.log(`  pinned to   ${out.ourFingerprint}  (our parameter fingerprint)`);
console.log(`  ${(fs.statSync(dest).size / 1024).toFixed(0)} KB -> ${path.relative(process.cwd(), dest)}`);
