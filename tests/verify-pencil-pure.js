#!/usr/bin/env node
/*
 * The Pencil width curve, without a canvas or a real Pencil in the room.
 *
 *   node tests/verify-pencil-pure.js
 *
 * src/ui/pencil.js says this itself, in its own header: the width curve is
 * "kept separate from the DOM wiring... so the width curve — the part with
 * actual room to get subtly wrong — can be unit-tested without a canvas or a
 * real Pencil in the room." Nobody then wrote that test. The only suite that
 * touches this file is verify-polish, which drives a real build in a real
 * browser — CI can never run it, and it is the one place this project's own
 * comment says a browser should not be required at all.
 *
 * WHAT IT DEFENDS. Three functions, none of which know about a canvas:
 *   widthFor      pressure + tilt + a named size -> a line width in px
 *   tiltFactor    raw PointerEvent tiltX/tiltY -> a 0..1 broadening amount
 *   armAutoMinimize   a countdown that knows nothing about the app's state
 *
 * The properties that matter are the ones a plausible edit could break
 * without anything on screen visibly changing until someone presses hard on
 * a real iPad: monotonicity (harder press or flatter Pencil never produces a
 * THINNER line), clamping (a stray pressure of 1.4 from a flaky digitizer
 * does not blow the stroke out), and the defaults a mouse or a finger falls
 * back to when pressure/tilt do not exist for them at all.
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

/* Executed against a stand-in global, same as verify-herorhythm-pure and
   verify-rhythms-pure — what is tested is the file that ships, not a copy
   of its logic kept here. */
const root = {};
/* eslint-disable-next-line no-new-func */
new Function(read('src/ui/pencil.js')).call(root);
const P = root.PencilFX;

head('the module loaded and exposes what the app calls');
{
  ok('PencilFX is on the global it was given', !!P);
  const want = ['SIZES', 'SIZE_ORDER', 'widthFor', 'tiltFactor', 'armAutoMinimize'];
  const missing = want.filter(k => !(P && k in P));
  ok('and exports every name this suite exercises', missing.length === 0, missing.join(', '));
}

head('the size presets are a small, ordered, internally consistent set');
{
  ok('SIZE_ORDER lists exactly the keys SIZES has, in the order S, M, L',
     JSON.stringify(P.SIZE_ORDER) === JSON.stringify(['S', 'M', 'L']));
  ok('every key in SIZE_ORDER resolves in SIZES',
     P.SIZE_ORDER.every(k => typeof P.SIZES[k] === 'number'));
  /* Medium is the neutral preset — the header calls it the one that
     "reproduces the original fixed width exactly", i.e. a 1.0 multiplier. */
  ok('Medium is the 1.0 multiplier — the neutral preset', P.SIZES.M === 1);
  ok('Small is narrower than Medium and Large is wider — a real ladder, not a nudge',
     P.SIZES.S < P.SIZES.M && P.SIZES.M < P.SIZES.L,
     `S ${P.SIZES.S} / M ${P.SIZES.M} / L ${P.SIZES.L}`);
}

head('widthFor: pressure and tilt each broaden the line, and never thin it');
{
  const base = 10;
  ok('zero pressure, zero tilt is the thinnest a size can draw',
     P.widthFor(base, 0, 0, 'M') < P.widthFor(base, 0.5, 0, 'M') &&
     P.widthFor(base, 0.5, 0, 'M') < P.widthFor(base, 1, 0, 'M'));
  ok('more tilt at fixed pressure never narrows the line',
     P.widthFor(base, 0.5, 1, 'M') > P.widthFor(base, 0.5, 0, 'M'));
  /* Exhaustive over a fine grid rather than a handful of points — the
     hazard is a curve that is monotonic almost everywhere and dips once. */
  let badP = 0, badT = 0;
  for (let t = 0; t <= 1; t += 0.1) {
    let prev = -Infinity;
    for (let p = 0; p <= 1; p += 0.05) {
      const w = P.widthFor(base, p, t, 'M');
      if (w < prev) badP++;
      prev = w;
    }
  }
  for (let p = 0; p <= 1; p += 0.1) {
    let prev = -Infinity;
    for (let t = 0; t <= 1; t += 0.05) {
      const w = P.widthFor(base, p, t, 'M');
      if (w < prev) badT++;
      prev = w;
    }
  }
  ok('monotonic in pressure across the whole grid, tilt held fixed', badP === 0, `${badP} dips`);
  ok('monotonic in tilt across the whole grid, pressure held fixed', badT === 0, `${badT} dips`);
}

head('widthFor: a size preset scales the whole curve, not just one end of it');
{
  const base = 10;
  for (const p of [0, 0.3, 0.7, 1]) {
    for (const t of [0, 0.5, 1]) {
      const s = P.widthFor(base, p, t, 'S'), m = P.widthFor(base, p, t, 'M'), l = P.widthFor(base, p, t, 'L');
      ok(`S < M < L holds at pressure ${p}, tilt ${t}`, s < m && m < l, `${s.toFixed(2)} / ${m.toFixed(2)} / ${l.toFixed(2)}`);
    }
  }
}

head('widthFor: inputs a real digitizer should never produce are still handled');
{
  const base = 10;
  ok('pressure above 1 is clamped, not extrapolated',
     P.widthFor(base, 5, 0, 'M') === P.widthFor(base, 1, 0, 'M'));
  ok('negative pressure is clamped to 0, not treated as more negative than none',
     P.widthFor(base, -5, 0, 'M') === P.widthFor(base, 0, 0, 'M'));
  ok('tilt above 1 is clamped the same way',
     P.widthFor(base, 0, 5, 'M') === P.widthFor(base, 0, 1, 'M'));
  ok('an unrecognised size key falls back to the neutral 1.0 multiplier, same as Medium',
     P.widthFor(base, 0.5, 0, 'nonsense') === P.widthFor(base, 0.5, 0, 'M'));
  ok('a base width of 0 draws nothing, at any pressure or tilt',
     P.widthFor(0, 1, 1, 'L') === 0);
}

head('widthFor: undefined pressure and tilt are a mouse or a finger, not a bug');
{
  const base = 10;
  /* A mouse/finger PointerEvent carries no pressure or tilt at all — this is
     the ordinary path, not an edge case, and it must equal a named point on
     the curve rather than silently drawing at 0 width or NaN. */
  ok('undefined pressure behaves as the documented 0.5 default',
     P.widthFor(base, undefined, 0, 'M') === P.widthFor(base, 0.5, 0, 'M'));
  ok('undefined tilt behaves as the documented 0 default',
     P.widthFor(base, 0.5, undefined, 'M') === P.widthFor(base, 0.5, 0, 'M'));
  ok('both undefined together is a real, finite width — the mouse/finger case',
     Number.isFinite(P.widthFor(base, undefined, undefined, 'M')));
}

head('tiltFactor: upright is 0, and only tilt magnitude matters, not its sign');
{
  ok('no tilt at all is 0 — a real Pencil held upright', P.tiltFactor(0, 0) === 0);
  ok('undefined in both axes is the same as 0, 0 — a mouse has no tilt axis at all',
     P.tiltFactor(undefined, undefined) === P.tiltFactor(0, 0));
  /* tiltX/tiltY are signed degrees from vertical in the PointerEvent spec;
     the combined magnitude is what should matter, not which side it leans. */
  const combos = [[65, 0], [-65, 0], [0, 65], [0, -65], [46, 46], [-46, -46], [-46, 46]];
  const values = combos.map(([x, y]) => P.tiltFactor(x, y));
  ok('the same combined tilt magnitude reads the same regardless of sign',
     values.every(v => Math.abs(v - values[0]) < 1e-9), values.join(', '));
}

head('tiltFactor: the result is a fraction, never something a canvas cannot use');
{
  const samples = [];
  for (let x = -120; x <= 120; x += 15) for (let y = -120; y <= 120; y += 15) samples.push([x, y]);
  const bad = samples.filter(([x, y]) => { const v = P.tiltFactor(x, y); return !(v >= 0 && v <= 1) || !Number.isFinite(v); });
  ok('every sampled tiltX/tiltY pair — including well past a real Pencil\'s range — stays in [0, 1]',
     bad.length === 0, bad.length ? `${bad.length} out of range, e.g. ${bad[0]}` : '');
  /* NON-VACUITY. A function that always returned 0 would also pass every
     check above it. Some real input must actually reach the ceiling. */
  ok('and the ceiling is actually reachable, not just an unused clamp',
     samples.some(([x, y]) => P.tiltFactor(x, y) === 1));
}

/* Async, so the two real-time assertions below can watch a timer actually
   not fire and actually fire — not just that arming and cancelling one
   doesn't throw, which a literal `true` would have "proven" just as well.
   That was this suite's own first draft, and tests/verify-stats.js caught
   it: `ok(label, true)` is the exact failure mode CLAUDE.md opens with. */
(async () => {
head('armAutoMinimize: a plain, cancellable countdown, nothing more');
{
  const id = P.armAutoMinimize(10000, () => {});
  ok('it returns something clearTimeout can take', id !== undefined && id !== null);
  clearTimeout(id);

  /* THE REAL CLAIM: clearing it actually prevents the callback, not merely
     "the call didn't throw". Armed for longer than this suite will wait,
     cleared immediately, then the suite outlives the original duration. */
  let firedAfterClear = false;
  const cleared = P.armAutoMinimize(60, () => { firedAfterClear = true; });
  clearTimeout(cleared);
  await new Promise(r => setTimeout(r, 90));
  ok('clearing it before it fires means it never fires', firedAfterClear === false);

  /* And the un-cleared case is checked for real too, not assumed from the
     clear case alone — a clearTimeout that is secretly a no-op would pass
     the check above by accident if arm() itself were also broken. */
  let firedNormally = false;
  P.armAutoMinimize(20, () => { firedNormally = true; });
  await new Promise(r => setTimeout(r, 60));
  ok('and one left alone does fire — the clear above is not hiding a dead timer',
     firedNormally === true);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
})();
