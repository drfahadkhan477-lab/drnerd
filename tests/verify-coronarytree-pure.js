#!/usr/bin/env node
/*
 * The coronary tree's branch geometry, and its flow-to-brightness curve.
 *
 *   node tests/verify-coronarytree-pure.js
 *
 * No browser, no build, no canvas. src/ui/coronaryTree.js draws nothing —
 * it generates a flat list of line segments and a 0..1 normaliser. Both are
 * checked here the way the rest of the Living Diagram family is: exhaustive
 * where exhaustive is cheap, and grounded in the real coronaryFlow() output
 * this feature exists to display rather than invented sample values.
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
new Function(read('src/ui/coronaryTree.js')).call(root);
const C = root.CoronaryTree;

/* NOT Math.max(...arr.map(fn)) — spreading a large array into a function
   call has an argument-count limit, and a defect that breaks recursion
   bounding (removing the minLength check, say) can make that array run
   into the millions. Found the hard way: an early draft of the minLength
   test below crashed the whole suite with "Maximum call stack size
   exceeded" instead of reporting a clean failure, when the exact defect
   it exists to catch was injected. A test proving a defect red must not
   itself become the thing that goes uncontrolled. */
const maxOf = (arr, fn) => arr.reduce((m, x) => Math.max(m, fn(x)), -Infinity);

head('the module loaded and exposes what the app will call');
{
  ok('CoronaryTree is on the global it was given', !!C);
  const want = ['DEFAULTS', 'tree', 'intensity'];
  const missing = want.filter(k => !(C && k in C));
  ok('and exports every name this suite exercises', missing.length === 0, missing.join(', '));
}

head('tree: the default shape terminates at exactly the depth it says it will');
{
  const t = C.tree({});
  /* Strict binary branching to a fixed depth has exactly 2^(d+1)-1
     segments — the trunk, its 2 children, their 4 children, and so on.
     This is only true because minLength never triggers first with the
     defaults; the case where it does is checked further down. */
  const expected = Math.pow(2, C.DEFAULTS.maxDepth + 1) - 1;
  ok(`the default tree has exactly ${expected} segments`, t.length === expected, `${t.length}`);
  ok('every segment reports a depth from 0 to maxDepth, nothing beyond it',
     t.every(s => s.depth >= 0 && s.depth <= C.DEFAULTS.maxDepth));
  ok('the maximum depth actually reached is maxDepth itself — not stopping early',
     maxOf(t, s => s.depth) === C.DEFAULTS.maxDepth);
}

head('tree: every coordinate is a real, finite number');
{
  const t = C.tree({});
  const bad = t.filter(s => ![s.x1, s.y1, s.x2, s.y2].every(Number.isFinite));
  ok('no segment has a NaN or Infinite coordinate, at any depth', bad.length === 0, `${bad.length} bad`);
}

head('tree: each generation is shorter than its parent — real vessels taper');
{
  const t = C.tree({});
  const lenOf = s => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  /* One representative segment per depth is enough here: DEFAULTS uses a
     single spread angle for both children, so every segment at a given
     depth is the same length by construction — checked separately below. */
  const byDepth = {};
  for (const s of t) (byDepth[s.depth] = byDepth[s.depth] || []).push(lenOf(s));
  ok('every segment at a given depth is the same length as its siblings',
     Object.values(byDepth).every(lens => lens.every(l => Math.abs(l - lens[0]) < 1e-9)));
  const repLen = d => byDepth[d][0];
  let shrank = true;
  for (let d = 1; d <= C.DEFAULTS.maxDepth; d++) if (repLen(d) >= repLen(d - 1)) shrank = false;
  ok('length strictly decreases from the trunk to the outermost generation', shrank,
     Object.keys(byDepth).sort((a, b) => a - b).map(d => repLen(+d).toFixed(1)).join(' > '));
  /* NON-VACUITY. Confirm the decay factor itself is what DEFAULTS says,
     not just "some shrinkage happened". */
  ok('the decay ratio between generations matches DEFAULTS.decay exactly',
     Math.abs(repLen(1) / repLen(0) - C.DEFAULTS.decay) < 1e-9,
     `${(repLen(1) / repLen(0)).toFixed(4)} vs ${C.DEFAULTS.decay}`);
}

head('tree: the two children of a branch point actually diverge');
{
  /* NOTHING ABOVE THIS CHECKS DIRECTION — only length, per depth. A defect
     that sends both children down the identical heading (dropping the +
     in "angle + opts.spread", say) would still pass every check so far:
     same length, same depth, same segment count. Caught by proving it: with
     the step-off removed in a scratch copy, this section is the only one
     that goes red. */
  const t = C.tree({ maxDepth: 1 });
  ok('a maxDepth of 1 is exactly the trunk plus its two children', t.length === 3, `${t.length}`);
  const [, left, right] = t;
  const apart = Math.hypot(left.x2 - right.x2, left.y2 - right.y2);
  /* Both children share a start point (the trunk's endpoint) and length —
     DEFAULTS.decay applies equally to both — so any distance between their
     ENDPOINTS is entirely down to them heading in different directions. */
  ok('the two children end up in different places, not stacked on each other',
     apart > 1, `${apart.toFixed(3)} apart`);
}

head('tree: the generator is deterministic — same opts, same tree, always');
{
  const a = C.tree({ maxDepth: 4 });
  const b = C.tree({ maxDepth: 4 });
  ok('two calls with identical opts produce byte-identical output',
     JSON.stringify(a) === JSON.stringify(b));
  const c = C.tree({ maxDepth: 4, spread: 0.9 });
  ok('and different opts produce a genuinely different tree — determinism is not a stub',
     JSON.stringify(a) !== JSON.stringify(c));
}

head('tree: minLength stops a branch before maxDepth does, when decay is aggressive');
{
  /* length=10, decay=0.3: depth 1 segments are length 3 (>= minLength 2,
     so they draw), depth 2 would be 0.9 (< 2, so grow() returns before
     appending anything) — three segments total: the trunk and its two
     depth-1 children, despite maxDepth being set absurdly high. */
  const t = C.tree({ length: 10, decay: 0.3, maxDepth: 20, minLength: 2 });
  /* Checked before anything else touches `t`: a maxDepth of 20 bounds a
     genuinely unstopped tree at 2^21-1 (~2 million) segments, so an
     explosion is caught here, cheaply and by name, rather than by
     whatever the next line that iterates `t` happens to do to a
     multi-million-element array. */
  ok('the tree did not explode toward maxDepth\'s full 2^21-1 segments',
     t.length < 1000, `${t.length} segments`);
  ok('a high maxDepth does not override a branch that has tapered below minLength',
     maxOf(t, s => s.depth) === 1, `reached depth ${maxOf(t, s => s.depth)}`);
  ok('exactly the trunk plus its two children, nothing further', t.length === 3, `${t.length}`);
}

head('tree: opts are additive over DEFAULTS, not a replacement for them');
{
  const t = C.tree({ maxDepth: 2 });
  ok('an unspecified opt (decay) still uses DEFAULTS.decay',
     Math.abs(Math.hypot(t[1].x2 - t[1].x1, t[1].y2 - t[1].y1) / C.DEFAULTS.length - C.DEFAULTS.decay) < 1e-9);
  ok('calling with no opts object at all does not throw', (() => { try { C.tree(); return true; } catch (_) { return false; } })());
}

head('intensity: the ordinary case, a value inside its own range');
{
  ok('the midpoint of a range maps to 0.5', C.intensity(0.5, 0, 1) === 0.5);
  ok('the low end of a range maps to 0', C.intensity(0, 0, 1) === 0);
  ok('the high end of a range maps to 1', C.intensity(1, 0, 1) === 1);
  /* GROUNDED IN THE REAL FLOW CURVE, sampled at 0.001-cycle resolution
     across a full beat before this suite was written: Physio.coronaryFlow
     ('left', t) actually ranges 0.1209..0.9065, not the right coronary's
     0.7657..1.1110 — an earlier draft of this suite quoted the right
     side's ceiling (1.10) as the left side's, caught by resampling both
     precisely rather than trusting a coarser 0.1-step eyeball read. */
  const LEFT_MIN = 0.1209, LEFT_MAX = 0.9065;
  ok('a systolic-low left-coronary reading (the observed floor) maps to 0',
     C.intensity(LEFT_MIN, LEFT_MIN, LEFT_MAX) === 0);
  ok('a diastolic-high left-coronary reading (the observed ceiling) maps to 1',
     C.intensity(LEFT_MAX, LEFT_MIN, LEFT_MAX) === 1);
  ok('a mid-diastolic reading, roughly the middle of the real left-coronary curve, lands mid-range',
     C.intensity(0.6, LEFT_MIN, LEFT_MAX) > 0.4 && C.intensity(0.6, LEFT_MIN, LEFT_MAX) < 0.85,
     C.intensity(0.6, LEFT_MIN, LEFT_MAX).toFixed(3));
}

head('intensity: values outside the observed range are clamped, not extrapolated');
{
  ok('below the floor clamps to 0, not a negative brightness', C.intensity(-1, 0, 1) === 0);
  ok('above the ceiling clamps to 1, not something a canvas cannot use', C.intensity(5, 0, 1) === 1);
  ok('a whole sweep past both ends stays inside [0, 1]',
     [-100, -1, -0.001, 1.001, 2, 100].every(v => { const i = C.intensity(v, 0, 1); return i >= 0 && i <= 1; }));
}

head('intensity: a degenerate or inverted range does not throw or divide by zero');
{
  ok('min === max returns 0 rather than NaN from a 0/0 division',
     C.intensity(0.5, 1, 1) === 0);
  ok('max < min (caller error, not a real range) also returns 0, not a negative-slope result',
     C.intensity(3, 5, 1) === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
