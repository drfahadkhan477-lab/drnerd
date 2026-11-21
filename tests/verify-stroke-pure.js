#!/usr/bin/env node
/*
 * A pen stroke made small enough to keep, and its outline drawn — src/core/stroke.js.
 *
 *   node tests/verify-stroke-pure.js
 *
 * Pure Node, over invented points. Each expected value is worked out here from the fixture: the rounding by hand, the
 * simplification by the geometry of a line and a corner, and the drawing as the list of calls a canvas would receive.
 *
 * What is measured, rather than assumed:
 *   - a point keeps x and y to four decimals and pressure and tilt to two, and a point without tilt gets none;
 *   - points on the line between their neighbours are dropped, a corner further off it than eps is kept, and the
 *     first and last are always kept; fewer than three points come back as they were; a stroke that ends where it
 *     began keeps its shape;
 *   - a stroke is simplified in place at 0.0012 only from three points, and is returned;
 *   - an outline is filled as one closed path, moving to its first corner and curving through each side's midpoint
 *     with the corner as control point; an outline under three points draws nothing;
 *   - the page's four names are the calls into this, and the module is written into the page above them.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');
const K = require('../src/core/stroke.js').Stroke;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const safely = fn => { try { return fn(); } catch (e) { return 'THREW ' + e.message; } };

head('a point is rounded to what a screen can show');
{
  ok('x and y to four decimals, pressure and tilt to two', same(safely(() => K.round([0.123456, 0.987654, 0.456, 0.333])), [0.1235, 0.9877, 0.46, 0.33]));
  ok('a point without tilt gets none', same(safely(() => K.round([0.5, 0.25, 1])), [0.5, 0.25, 1]));
  ok('halves round up, as Math.round does', same(safely(() => K.round([0.00005, 0.00004, 0.005])), [0.0001, 0, 0.01]));
}

head('points a line already describes are dropped');
{
  const line = [[0, 0, 1], [0.1, 0.1, 1], [0.2, 0.2, 1], [0.3, 0.3, 1]];
  ok('a straight run keeps only its ends', same(safely(() => K.rdp(line, 0.0012)), [[0, 0, 1], [0.3, 0.3, 1]]));
  /* A corner at (0.5, 0) between (0,0) and (0.5,0.5): 0.354 off the chord, far over eps; each leg straight. */
  const corner = [[0, 0, 1], [0.25, 0, 1], [0.5, 0, 1], [0.5, 0.25, 1], [0.5, 0.5, 1]];
  ok('a corner is kept, and each straight leg reduced to its ends', same(safely(() => K.rdp(corner, 0.0012)), [[0, 0, 1], [0.5, 0, 1], [0.5, 0.5, 1]]));
  /* A bump 0.001 off a chord of length 1 is within 0.0012, and is dropped; at 0.002 it is kept. */
  ok('a deviation within eps is dropped, one beyond it kept', same(safely(() => K.rdp([[0, 0, 1], [0.5, 0.001, 1], [1, 0, 1]], 0.0012)), [[0, 0, 1], [1, 0, 1]])
     && same(safely(() => K.rdp([[0, 0, 1], [0.5, 0.002, 1], [1, 0, 1]], 0.0012)), [[0, 0, 1], [0.5, 0.002, 1], [1, 0, 1]]));
  ok('fewer than three points come back as they were', same(safely(() => K.rdp([[0, 0, 1], [1, 1, 1]], 0.0012)), [[0, 0, 1], [1, 1, 1]]));
  /* A stroke that ends exactly where it began (a circle closed on its first point, likely once points are rounded to
     four decimals) has a chord of no length. Every point then measured 0 off it and the stroke was stored as two
     points: a ring round an answer came back a dot. The distance from a chord of no length is the distance from its
     point. A square closed on its start keeps its corners, each leg already straight. */
  const square = [[0, 0, 1], [0.5, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]];
  ok('a stroke that ends where it began keeps its shape: a closed square keeps its four corners', same(safely(() => K.rdp(square, 0.0012)),
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]]), JSON.stringify(safely(() => K.rdp(square, 0.0012))));
  ok('and a closed stroke all within eps of its start is still one dot', same(safely(() => K.rdp([[0, 0, 1], [0.0005, 0.0005, 1], [0, 0, 1]], 0.0012)), [[0, 0, 1], [0, 0, 1]]));
}

head('a stroke is simplified in place, from three points');
{
  const s = { t: 'pen', c: '#000', p: [[0, 0, 1], [0.1, 0.1, 1], [0.2, 0.2, 1]] };
  const back = safely(() => K.simplify(s));
  ok('the same stroke comes back, its points simplified at 0.0012', back === s && same(s.p, [[0, 0, 1], [0.2, 0.2, 1]]) && s.t === 'pen' && s.c === '#000', JSON.stringify(s));
  const two = { p: [[0, 0, 1], [1, 1, 1]] }, pts = two.p;
  ok('two points are left as they were, the same list', safely(() => K.simplify(two)) === two && two.p === pts);
  ok('a stroke with no points, or none at all, is handed back', same(safely(() => K.simplify({})), {}) && safely(() => K.simplify(null)) === null);
}

head('an outline is filled as one curved path');
{
  const calls = [];
  const ctx = new Proxy({}, { get: (_, k) => (...a) => calls.push([k, ...a]) });
  safely(() => K.fill(ctx, [[0, 0], [4, 0], [4, 2]]));
  ok('begin, move to the first corner, a curve per side after it through its midpoint, close, fill', same(calls, [
    ['beginPath'], ['moveTo', 0, 0], ['quadraticCurveTo', 4, 0, 4, 1], ['quadraticCurveTo', 4, 2, 2, 1], ['closePath'], ['fill']]), JSON.stringify(calls));
  const none = [];
  safely(() => K.fill(new Proxy({}, { get: (_, k) => (...a) => none.push(k) }), [[0, 0], [1, 1]]));
  ok('an outline under three points draws nothing', none.length === 0, none.join(','));
}

head('the page\'s four names are the calls into this');
{
  /* Read with its comments blanked: the shell explains itself, and quotes what is looked for. */
  const page = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
  const once = text => page.split(text).length - 1 === 1;
  const lines = ['function roundPt(p){ return Stroke.round(p); }', 'function rdp(pts,eps){ return Stroke.rdp(pts,eps); }',
    'function simplifyStroke(s){ return Stroke.simplify(s); }', 'function fillOutline(ctx,o){ return Stroke.fill(ctx,o); }'];
  const names = ['roundPt', 'rdp', 'simplifyStroke', 'fillOutline'];
  const missing = lines.filter((l, i) => !once(l) || !once('function ' + names[i] + '('));
  ok('each old name is one line handing over what it was given, and is defined once', missing.length === 0, missing.join(' | ') || 'all four');
  const slot = page.indexOf('@@SLOT[src:src/core/stroke.js]@@');
  ok('and the module is written into the page once, above all four', slot >= 0 && page.indexOf('@@SLOT[src:src/core/stroke.js]@@', slot + 1) < 0
     && names.every(n => page.indexOf('function ' + n + '(') > slot), slot < 0 ? 'no slot' : 'slot at ' + slot);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
