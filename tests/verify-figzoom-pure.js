#!/usr/bin/env node
/*
 * The figure viewer's zoom row: + and −, Fit, and the readout between them — src/ui/figzoom.js.
 *
 *   node tests/verify-figzoom-pure.js
 *
 * Pure Node, over a viewer of the test's own: a slide that records every zoomTo it is asked for and takes the level it
 * is given, and an element whose readout and class list are plain objects. Its fitted level is 1 or 2, so every
 * expected level and readout below is worked out by hand.
 *
 * What is measured, rather than assumed:
 *   - one press is 1.4 times;
 *   - the readout is the zoom in times the fitted size, rounded, and 100 with no viewer, no slide or no fitted level;
 *   - + and − zoom about the middle of the viewport, never under fitted and never over the most allowed, and do
 *     nothing to a slide that cannot zoom; Fit goes back to fitted;
 *   - after each, the bar says the new readout and the viewer is marked zoomed exactly while it is over 100;
 *   - no viewer, a viewer with no slide, or no element is nothing to do, never a throw;
 *   - the page's five names are the calls into this, written into the page once, above them, and the page keeps no copy.
 *
 * verify-figzoom is the browser half: it drives the real PhotoSwipe viewer through these.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');
const Z = require('../src/ui/figzoom.js').FigZoom;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);
const safely = fn => { try { return fn(); } catch (e) { return 'THREW ' + e.message; } };

/* A viewer 900 by 1000, its slide fitted at `initial`, allowing up to `max`, now at `cur`. */
function viewer({ initial = 1, max = 3, cur = initial, zoomable = true, readout = true, element = true } = {}) {
  const calls = [];
  const pctEl = readout ? { textContent: '100%' } : null;
  const classes = new Set();
  const slide = { zoomLevels: { initial, max }, currZoomLevel: cur, isZoomable: () => zoomable,
    zoomTo(lv, pt, ms) { calls.push([lv, pt, ms]); this.currZoomLevel = lv; } };
  const el = element ? { querySelector: sel => (sel === '.pswp__figv-pct' ? pctEl : null),
    classList: { toggle: (c, on) => { on ? classes.add(c) : classes.delete(c); return on; }, contains: c => classes.has(c) } } : null;
  return { ps: { currSlide: slide, viewportSize: { x: 900, y: 1000 }, element: el }, slide, calls, pctEl, classes };
}

head('one press, and the readout');
{
  ok('one press of + or − is 1.4 times', Z.STEP === 1.4, String(Z.STEP));
  /* 1.4 of fitted 1 is 140; 2 of fitted 2 is 100; 1 of fitted 3 is 33.3, and 2 of it 66.7: rounded, not cut. */
  const at = (initial, cur) => safely(() => Z.pct(viewer({ initial, cur }).ps));
  ok('the zoom in times the fitted size', at(1, 1.4) === 140 && at(2, 2) === 100 && at(2, 5) === 250, [at(1, 1.4), at(2, 2), at(2, 5)].join(' '));
  ok('rounded to the nearest', at(3, 1) === 33 && at(3, 2) === 67, [at(3, 1), at(3, 2)].join(' '));
  const noSlide = viewer().ps; noSlide.currSlide = null;
  ok('and 100 with no viewer, no slide, or no fitted level', safely(() => Z.pct(null)) === 100 && safely(() => Z.pct(undefined)) === 100 && safely(() => Z.pct(noSlide)) === 100 && at(0, 2) === 100,
     [safely(() => Z.pct(null)), safely(() => Z.pct(noSlide)), at(0, 2)].join(' '));
}

head('+ and −');
{
  const v = viewer({ initial: 1, max: 3, cur: 1 });
  safely(() => Z.by(v.ps, Z.STEP));
  ok('+ zooms 1.4 times about the middle of the viewport, over 220 ms', J(v.calls) === J([[1.4, { x: 450, y: 500 }, 220]]), J(v.calls));
  ok('and the bar says 140%, the viewer marked zoomed', v.pctEl.textContent === '140%' && v.classes.has('figv-zoomed'), v.pctEl.textContent + ' ' + [...v.classes]);
  const top = viewer({ initial: 1, max: 3, cur: 2.5 });
  safely(() => Z.by(top.ps, Z.STEP));
  ok('never past the most allowed: 2.5 times 1.4 is held at 3', top.calls.length === 1 && top.calls[0][0] === 3 && top.pctEl.textContent === '300%', J(top.calls));
  const low = viewer({ initial: 1, max: 3, cur: 1.2 });
  safely(() => Z.by(low.ps, 1 / Z.STEP));
  ok('never under fitted: 1.2 divided by 1.4 is held at 1, and the viewer is no longer zoomed', low.calls.length === 1 && low.calls[0][0] === 1 && low.pctEl.textContent === '100%' && !low.classes.has('figv-zoomed'), J(low.calls));
  const flat = viewer({ cur: 1, zoomable: false });
  flat.pctEl.textContent = 'untouched';
  safely(() => Z.by(flat.ps, Z.STEP));
  ok('a slide that cannot zoom is not asked to, and the bar is left alone', flat.calls.length === 0 && flat.pctEl.textContent === 'untouched', J(flat.calls));
}

head('Fit');
{
  const v = viewer({ initial: 2, max: 6, cur: 5 });
  v.classes.add('figv-zoomed');
  safely(() => Z.fit(v.ps));
  ok('goes back to fitted, about no point, over 220 ms', J(v.calls) === J([[2, null, 220]]) && v.calls[0][1] === undefined, J(v.calls));
  ok('and the bar says 100%, the viewer no longer zoomed', v.pctEl.textContent === '100%' && !v.classes.has('figv-zoomed'), v.pctEl.textContent + ' ' + [...v.classes]);
}

head('the bar is kept with the level');
{
  const just = viewer({ initial: 1, cur: 1.004 }), over = viewer({ initial: 1, cur: 1.006 });
  safely(() => Z.sync(just.ps)); safely(() => Z.sync(over.ps));
  /* 100.4 reads 100 and is not zoomed; 100.6 reads 101 and is. */
  ok('zoomed exactly while the readout is over 100', just.pctEl.textContent === '100%' && !just.classes.has('figv-zoomed') && over.pctEl.textContent === '101%' && over.classes.has('figv-zoomed'),
     just.pctEl.textContent + ' / ' + over.pctEl.textContent);
  const bare = viewer({ cur: 2, readout: false });
  ok('a bar with no readout still marks the viewer', safely(() => Z.sync(bare.ps)) === undefined && bare.classes.has('figv-zoomed'));
}

head('nothing to zoom is nothing to do');
{
  const noSlide = viewer(); noSlide.ps.currSlide = null;
  const noEl = viewer({ element: false, cur: 2 });
  const quiet = [() => Z.by(null, 2), () => Z.fit(null), () => Z.sync(null), () => Z.by(noSlide.ps, 2), () => Z.fit(noSlide.ps), () => Z.sync(noEl.ps), () => Z.by(noEl.ps, 1.4)];
  const r = quiet.map(f => safely(f));
  ok('no viewer, no slide, or no element: never a throw', r.every(x => x === undefined), J(r));
  ok('and a viewer with no element still zooms', noEl.calls.length === 1 && Math.abs(noEl.calls[0][0] - 2.8) < 1e-12, J(noEl.calls));
}

head('the page\'s five names are the calls into this');
{
  /* Read with its comments blanked: the shell explains itself, and quotes what is looked for. */
  const page = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
  const n = t => page.split(t).length - 1;
  const lines = ['const FIG_STEP=FigZoom.STEP;', 'function figZoomBy(ps,k){ FigZoom.by(ps,k); }', 'function figFit(ps){ FigZoom.fit(ps); }',
    'function figPct(ps){ return FigZoom.pct(ps); }', 'function figSyncZoom(ps){ FigZoom.sync(ps); }'];
  const missing = lines.filter(l => n(l) !== 1).concat(['figZoomBy', 'figFit', 'figPct', 'figSyncZoom'].filter(x => n('function ' + x + '(') !== 1).map(x => x + '() defined more than once'));
  ok('each is one line handing over what it was given, and is defined once', missing.length === 0, missing.join(' | ') || 'all five');
  const slot = page.indexOf('@@SLOT[src:src/ui/figzoom.js]@@');
  ok('the module is written into the page once, above the five', slot >= 0 && n('@@SLOT[src:src/ui/figzoom.js]@@') === 1 && slot < page.indexOf('const FIG_STEP='), slot < 0 ? 'no slot' : 'slot at ' + slot);
  ok('and the page keeps no copy of the rules', n('zoomLevels.max') === 0 && n("'figv-zoomed'") === 0 && n('.pswp__figv-pct') === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
