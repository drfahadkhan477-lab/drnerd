#!/usr/bin/env node
/*
 * The zoom/pan arithmetic, in bare Node — no browser, no build.
 *
 *   node tests/verify-figzoom-pure.js
 *
 * The invariant worth protecting is one sentence: THE POINT UNDER YOUR
 * FINGERS DOES NOT MOVE. Get the sign or the order wrong and the figure
 * creeps away over successive pinches — which on a device reads as jitter,
 * or as "the zoom feels wrong", and is very hard to attribute by eye. It is
 * trivial to check numerically, so it is checked numerically, and repeatedly:
 * a single zoom hiding a small error still looks fine.
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

const mod = {};
new Function('module', 'exports', fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'figzoom.js'), 'utf8'))
  .call(mod, { exports: mod }, mod);
const F = mod.FigZoom;

/* Where a content point currently lands in the viewport. */
const project = (st, cx, cy) => ({ x: cx * st.scale + st.tx, y: cy * st.scale + st.ty });
const unproject = (st, px, py) => ({ x: (px - st.tx) / st.scale, y: (py - st.ty) / st.scale });

head('fitted is the floor, and it is a real state');
ok('fit() is scale 1 at the origin', F.fit().scale === 1 && F.fit().tx === 0 && F.fit().ty === 0);
ok('fit() reports as fitted', F.isFitted(F.fit()));
ok('the floor is never breached, however hard you pinch out',
   F.zoomAbout(F.fit(), 0.01, 50, 50).scale === F.MIN, String(F.zoomAbout(F.fit(), 0.01, 50, 50).scale));
ok('and the ceiling holds, however hard you pinch in',
   F.zoomAbout(F.fit(), 1000, 50, 50).scale === F.MAX, String(F.zoomAbout(F.fit(), 1000, 50, 50).scale));
ok('a zoom that changes nothing returns an equal state, not a drifted one',
   JSON.stringify(F.zoomAbout({ scale: F.MAX, tx: -7, ty: 3 }, 2, 10, 10)) ===
   JSON.stringify({ scale: F.MAX, tx: -7, ty: 3 }));

head('the point under your fingers does not move — once');
{
  const st = F.zoomAbout(F.fit(), 2.5, 210, 140);
  const back = project(st, unproject(F.fit(), 210, 140).x, unproject(F.fit(), 210, 140).y);
  ok('after one zoom the anchor projects to itself',
     Math.abs(back.x - 210) < 1e-9 && Math.abs(back.y - 140) < 1e-9,
     `(${back.x.toFixed(6)}, ${back.y.toFixed(6)})`);
}

head('and does not move over a long sequence — where drift would hide');
{
  /* A single zoom can hide a small error. Twenty, alternating direction and
     anchor, cannot: any sign or ordering mistake compounds visibly. */
  let st = F.fit();
  let worst = 0;
  for (let i = 0; i < 20; i++) {
    const px = 60 + (i * 37) % 300, py = 40 + (i * 53) % 200;
    const anchor = unproject(st, px, py);
    st = F.zoomAbout(st, i % 3 === 2 ? 0.7 : 1.35, px, py);
    const after = project(st, anchor.x, anchor.y);
    worst = Math.max(worst, Math.abs(after.x - px), Math.abs(after.y - py));
  }
  ok('the anchor holds across twenty alternating zooms', worst < 1e-9, `worst drift ${worst.toExponential(2)}`);
  ok('and the scale stayed inside its bounds', st.scale >= F.MIN && st.scale <= F.MAX, String(st.scale));
}

head('panning moves by exactly what it was given');
{
  const st = F.panBy({ scale: 3, tx: 10, ty: -5 }, -40, 25);
  ok('translation is additive and scale is untouched',
     st.tx === -30 && st.ty === 20 && st.scale === 3, JSON.stringify(st));
}

head('content smaller than the viewport is centred, not cornered');
{
  const st = F.constrain({ scale: 1, tx: 999, ty: -999 }, 400, 300, 200, 100);
  ok('a runaway translation is pulled back to centre',
     st.tx === 100 && st.ty === 100, JSON.stringify(st));
}

head('content larger than the viewport cannot be dragged off it');
{
  const view = 400, content = 200, scale = 4;         // 800px of content in 400px
  const dragged = F.constrain({ scale, tx: 500, ty: 0 }, view, view, content, content);
  ok('the left edge cannot be pulled inside the viewport', dragged.tx === 0, String(dragged.tx));
  const far = F.constrain({ scale, tx: -5000, ty: 0 }, view, view, content, content);
  ok('nor the right edge', far.tx === view - content * scale, `${far.tx} vs ${view - content * scale}`);
  const inside = F.constrain({ scale, tx: -120, ty: -30 }, view, view, content, content);
  ok('a legitimate pan in between is left exactly alone',
     inside.tx === -120 && inside.ty === -30, JSON.stringify(inside));
}

head('double tap is a two-state toggle, anchored where you tapped');
{
  const zoomed = F.toggle(F.fit(), 100, 100);
  ok('from fitted it magnifies', zoomed.scale > 1, String(zoomed.scale));
  ok('about the point tapped',
     Math.abs(project(zoomed, unproject(F.fit(), 100, 100).x, unproject(F.fit(), 100, 100).y).x - 100) < 1e-9);
  ok('and from anywhere magnified it returns to fitted, not to the previous step',
     F.isFitted(F.toggle({ scale: 6.2, tx: -300, ty: -80 }, 10, 10)));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
