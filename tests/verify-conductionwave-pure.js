#!/usr/bin/env node
/*
 * The conduction pathway's firing order, held against real activation times.
 *
 *   node tests/verify-conductionwave-pure.js
 *
 * No browser, no build, no mesh. src/ui/conductionWave.js is deliberately
 * NOT a rewrite of heart3d.js's activationAt — it takes activation times as
 * data. This suite grounds every case in numbers actually read off that
 * real function moments before this file was written (see the header
 * comment in conductionWave.js for how and why), rather than invented
 * labels with invented times.
 *
 * REAL VALUES, FROM heart3d.js's Heart3D.activationAt(), AT ITS OWN ANATOMY
 * REFERENCE POINTS:
 *
 *   LA center    6.00ms     RA center    6.00ms
 *   RV base     32.34ms     LV apex    155.55ms
 *   RV apex    162.36ms     LV base    207.70ms
 *
 * RV base landing inside the atrial range rather than after LV apex is not
 * a typo — it is activationAt's own behaviour (that point sits within its
 * 2.4-unit atrial-adjacency threshold of the right atrium), and exactly why
 * this suite uses captured real numbers instead of a tidy invented ladder:
 * a made-up schedule would have "fixed" that surprise into something wrong.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const root = {};
/* eslint-disable-next-line no-new-func */
new Function(read('src/ui/conductionWave.js')).call(root);
const C = root.ConductionWave;

/* The real numbers, captured from Heart3D.activationAt(...anatomy point) —
   declared out of ms order on purpose. Listing them already sorted was
   this suite's own first draft, and it hid a real gap: filter() preserves
   input order on its own, so an already-ascending array passes the "order
   returned is firing order, not list order" check whether or not firedBy
   actually sorts anything. Shuffled here so that check can only pass by
   the function doing the ordering itself. */
const REAL_POINTS = [
  { label: 'LV base',  ms: 207.7 },
  { label: 'RA',       ms: 6 },
  { label: 'RV apex',  ms: 162.36 },
  { label: 'LA',       ms: 6 },
  { label: 'LV apex',  ms: 155.55 },
  { label: 'RV base',  ms: 32.34 },
];

head('the module loaded and exposes what the app will call');
{
  ok('ConductionWave is on the global it was given', !!C);
  const want = ['firedBy', 'nextToFire', 'sweepPosition'];
  const missing = want.filter(k => !(C && k in C));
  ok('and exports every name this suite exercises', missing.length === 0, missing.join(', '));
}

head('firedBy: builds up across the real beat, one arrival at a time');
{
  ok('before anything fires, nothing has', C.firedBy(REAL_POINTS, 0).length === 0);
  ok('right at 6ms, both atrial points have fired and nothing else',
     JSON.stringify(C.firedBy(REAL_POINTS, 6).sort()) === JSON.stringify(['LA', 'RA']));
  ok('by 100ms, RV base has joined them — the atrial-adjacency surprise, included on purpose',
     JSON.stringify(C.firedBy(REAL_POINTS, 100).sort()) === JSON.stringify(['LA', 'RA', 'RV base']));
  ok('by 160ms, LV apex has fired but RV apex (162.36) has not yet',
     C.firedBy(REAL_POINTS, 160).includes('LV apex') && !C.firedBy(REAL_POINTS, 160).includes('RV apex'));
  ok('past the last real activation time, everything has fired',
     C.firedBy(REAL_POINTS, 300).length === REAL_POINTS.length);
}

head('firedBy: the order returned is firing order, not list order');
{
  /* REAL_POINTS is declared out of ms order (see its own comment above) —
     LV base (207.7ms) is listed FIRST despite firing LAST. */
  const at40 = C.firedBy(REAL_POINTS, 40);
  ok('RV base (32.34ms) already fired by t=40', at40.includes('RV base'));
  const order = C.firedBy(REAL_POINTS, 300);
  const times = order.map(l => REAL_POINTS.find(p => p.label === l).ms);
  ok('the full firing order is non-decreasing in ms, regardless of input order',
     times.every((t, i) => i === 0 || t >= times[i - 1]), times.join(', '));
}

head('nextToFire: the earliest point still ahead, and null once none is');
{
  ok('at t=0, LA or RA is next (both tied at 6ms — a stable choice, not a crash)',
     ['LA', 'RA'].includes(C.nextToFire(REAL_POINTS, 0)));
  ok('at t=6, the tied atrial points do not count as "next" — RV base (32.34) is',
     C.nextToFire(REAL_POINTS, 6) === 'RV base');
  ok('at t=32.34 exactly, RV base has just fired and does not count as next either',
     C.nextToFire(REAL_POINTS, 32.34) === 'LV apex');
  ok('once every real point has fired, there is nothing left to be next',
     C.nextToFire(REAL_POINTS, 300) === null);
  ok('an empty point list has nothing next, from t=0', C.nextToFire([], 0) === null);
}

head('nextToFire: a genuine tie resolves to the one listed first, not arbitrarily');
{
  const tied = [{ label: 'b', ms: 50 }, { label: 'a', ms: 50 }];
  ok('with two points tied at the same ms, the FIRST in the array wins',
     C.nextToFire(tied, 0) === 'b');
  const tiedOtherOrder = [{ label: 'a', ms: 50 }, { label: 'b', ms: 50 }];
  ok('and reordering the input changes which one wins — this is list-order, not label-order',
     C.nextToFire(tiedOtherOrder, 0) === 'a');
}

head('sweepPosition: a beat that restarts, not a stopwatch that runs once');
{
  ok('the start of a beat is position 0', C.sweepPosition(0, 800) === 0);
  ok('exactly one full beat wraps back to 0, not to 800',
     C.sweepPosition(800, 800) === 0);
  ok('exactly two full beats also wraps to 0', C.sweepPosition(1600, 800) === 0);
  ok('partway through a beat lands partway through, not clamped or wrapped early',
     C.sweepPosition(300, 800) === 300);
  ok('partway into the SECOND beat reads the same as the same offset in the first',
     C.sweepPosition(1100, 800) === C.sweepPosition(300, 800));
  /* NEGATIVE ELAPSED TIME. Not a state the real clock produces, but a
     caller's own arithmetic could hand this in (elapsedMs - somethingLater
     by mistake), and % alone in JS returns a NEGATIVE remainder for a
     negative dividend — silently producing a position "before the beat
     started" that nothing downstream expects a beat position to be. */
  ok('a negative elapsed time still wraps into [0, beatMs), never negative',
     C.sweepPosition(-100, 800) === 700, String(C.sweepPosition(-100, 800)));
  ok('and every position for a wide sweep of elapsed times stays in range',
     [-5000, -800, -1, 0, 1, 799, 800, 801, 5000, 123456].every(e => {
       const p = C.sweepPosition(e, 800);
       return p >= 0 && p < 800;
     }));
}

head('sweepPosition: a beat duration that is not a real duration');
{
  ok('zero beatMs returns 0 rather than dividing by it', C.sweepPosition(500, 0) === 0);
  ok('negative beatMs returns 0 rather than producing a position in a negative-length beat',
     C.sweepPosition(500, -800) === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
