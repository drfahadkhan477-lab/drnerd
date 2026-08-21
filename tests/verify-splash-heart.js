#!/usr/bin/env node
/*
 * Checks for the mechanistic heart on the startup screen.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-splash-heart.js <patched.html>
 *
 * Two things have to be true, and they pull in opposite directions:
 *
 *   · the heart must actually be THERE, drawn as inline SVG placed above the
 *     rhythm strip and shipped in the HTML before the app script — because the
 *     whole point is that it paints before the megabytes below it parse;
 *   · and it must ask nothing of that script: no <canvas>, no WebGL, no
 *     reference to Heart3D on the splash, since meshing the real heart is part
 *     of what the splash is covering for.
 *
 * So this reads the shipped HTML directly to prove the heart is inline SVG in
 * the right place and carries no canvas, then loads the page and re-mounts the
 * splash markup to prove the CSS actually animates it — and that a
 * reduced-motion preference stops it.
 *
 * The conduction check is the one worth reading. The nodes are not decoration:
 * they light in the order the heart depolarises, and the delays are the real
 * ones scaled to the beat. A set of dots blinking together would look almost
 * identical and mean nothing, so the suite measures that they are out of phase
 * and in the right order rather than merely that they animate.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-splash-heart.js <patched.html>'); process.exit(1); }
const isFile = !/^https?:\/\//.test(target);
const URL = isFile ? 'file://' + path.resolve(target) : target;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  head('the heart ships in the HTML, before the app');
  if (isFile) {
    const src = fs.readFileSync(target, 'utf8');
    const splashIdx = src.indexOf('<div id="splash"');
    const shellIdx = src.indexOf('<div id="shell">');
    const scriptIdx = src.indexOf('ALL_Q=[');   // the big data blob, deep in the app
    const splashBlock = src.slice(splashIdx, shellIdx);
    ok('the splash contains the heart SVG', /class="sp-heart"/.test(splashBlock));
    ok('the heart is placed above the rhythm strip',
       splashBlock.indexOf('class="sp-heart"') < splashBlock.indexOf('class="sp-strip"') &&
       splashBlock.indexOf('class="sp-heart"') > -1);
    ok('the whole splash ships before the app script', splashIdx > -1 && splashIdx < scriptIdx);
    ok('it carries its own dark plate, so it reads on a cream theme as well as a black one',
       /class="sp-plate"/.test(splashBlock) && /sp-bezel/.test(splashBlock));
    ok('nothing of it extends past that plate — every vessel ends inside the circle',
       (() => {
         /* Plate radius is 86 about (100,100). A stroke that finished outside
            it would be drawn straight onto the theme's own background, where
            under Parchment it would vanish. */
         const pts = [...splashBlock.matchAll(/class="sp-vessel"[\s\S]*?<\/g>/g)]
           .flatMap(m => [...m[0].matchAll(/([\d.]+),([\d.]+)/g)])
           .map(m => Math.hypot(+m[1] - 100, +m[2] - 100));
         /* Plate radius 86, less half the 2.6px vessel stroke. */
         return pts.length >= 6 && pts.every(d => d < 84.7);
       })(), 'every vessel point inside the plate');
    ok('the muscle, both grooves, both valves and the whole conduction system are drawn',
       /sp-rim/.test(splashBlock) && /sp-groove/.test(splashBlock) &&
       /sp-iris-a/.test(splashBlock) && /sp-iris-m/.test(splashBlock) &&
       (splashBlock.match(/class="sp-node"/g) || []).length === 6,
       `${(splashBlock.match(/class="sp-node"/g) || []).length} conduction nodes`);
    ok('the splash asks nothing of WebGL — no canvas, no Heart3D on it',
       !/<canvas/i.test(splashBlock) && !/Heart3D/.test(splashBlock));
  } else {
    ok('(skipped file-content checks — target is a URL, not a path)', true);
  }

  head('the CSS actually animates it');
  const browser = await chromium.launch();
  const src = isFile ? fs.readFileSync(target, 'utf8') : null;
  const splashHTML = src ? src.slice(src.indexOf('<div id="splash"'), src.indexOf('<div id="shell">')) : null;

  const page = await browser.newPage({ viewport: { width: 440, height: 760 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });
  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof S !== 'undefined', { timeout: 150000 });

  /* The app has already dismissed the real splash by now; re-mount its markup so
     we are testing the shipped CSS against the shipped markup. */
  const anim = await page.evaluate(markup => {
    if (markup) { document.getElementById('splash')?.remove(); document.body.insertAdjacentHTML('afterbegin', markup); }
    const h = document.querySelector('.sp-heart');
    if (!h) return null;
    const cs = getComputedStyle(h);
    const body = document.querySelector('.sp-body');
    const core = document.querySelector('.sp-core');
    return {
      name: body ? getComputedStyle(body).animationName : '',
      dur: body ? getComputedStyle(body).animationDuration : '',
      coreName: core ? getComputedStyle(core).animationName : '',
      nodes: document.querySelectorAll('.sp-heart .sp-node').length,
    };
  }, splashHTML);
  ok('the heart is present after re-mount', !!anim);
  ok('it carries the beat animation', anim && /spBeat/.test(anim.name), anim && anim.name);
  ok('the beat runs at roughly one cardiac cycle', anim && parseFloat(anim.dur) > 0.6 && parseFloat(anim.dur) < 1.4, anim && anim.dur);
  ok('the core pulses with it', anim && /spCore/.test(anim.coreName), anim && anim.coreName);
  ok('all six conduction nodes are on screen', anim && anim.nodes === 6, anim && String(anim.nodes));

  head('the conduction lights in the order it depolarises');
  /* Sample every frame for a full cycle and find when each node peaks. Blinking
     together would pass a test that only asked whether they animate. */
  const fire = await page.evaluate(() => new Promise(done => {
    const ns = [...document.querySelectorAll('.sp-heart .sp-node')];
    const rows = []; const t0 = performance.now();
    (function loop() {
      const t = performance.now() - t0;
      rows.push([t, ns.map(n => +getComputedStyle(n).opacity)]);
      if (t < 1000) requestAnimationFrame(loop); else done(rows);
    })();
  }));
  const peakAt = i => fire.reduce((b, r) => (r[1][i] > b[1] ? [r[0], r[1][i]] : b), [0, -1]);
  /* A positive animation-delay would leave a node at its static opacity — full
     brightness — until its animation began, which both looks wrong and makes
     the peak times meaningless. Negative delays are what put a node partway
     into a cycle that is already running. */
  const delays = await page.evaluate(() =>
    [...document.querySelectorAll('.sp-heart .sp-node')].map(n => parseFloat(getComputedStyle(n).animationDelay)));
  ok('every node is phase-shifted with a negative delay, so none starts out stuck lit',
     delays.every(d => d <= 0), delays.join(' '));
  const peaks = [0, 1, 2, 3, 4, 5].map(peakAt);
  /* The flash peaks for about 45ms and rAF samples every ~30ms, so the exact
     top is routinely missed. What is being claimed is that each node swings —
     a node that merely sat lit would show no range at all — so measure the
     range rather than trying to catch the peak. */
  const troughAt = i => fire.reduce((b, r) => Math.min(b, r[1][i]), 1);
  const swing = peaks.map((p, i) => p[1] - troughAt(i));
  ok('every node swings between dark and lit rather than sitting on', swing.every(v => v > 0.45),
     swing.map(v => v.toFixed(2)).join(' '));
  /* SA fires first, so within a one-second window its peak belongs to the
     PREVIOUS cycle — measure the rest against the AV node, which anchors the
     sequence, and check each step lands after the one before it. */
  const rel = peaks.map(p => p[0] - peaks[1][0]);
  /* Non-decreasing rather than strictly increasing: the bundle branches and the
     Purkinje peak 37ms apart and rAF samples every ~30ms, so those two tie as
     often as not. Ties are a limit of the ruler; an inversion would be a real
     fault, and so would a sequence that finished in one frame. */
  const ordered = rel[2] >= rel[1] && rel[3] >= rel[2] && rel[5] >= rel[3];
  ok('and they fire AV → His → bundles → Purkinje, in that order', ordered,
     `His +${rel[2].toFixed(0)}ms, bundles +${rel[3].toFixed(0)}ms, Purkinje +${rel[5].toFixed(0)}ms after AV`);
  ok('spread across the beat rather than all inside one frame',
     rel[5] > 45 && rel[5] < 320, `AV to Purkinje ${rel[5].toFixed(0)}ms`);

  head('it holds still when the viewer prefers reduced motion');
  const rmPage = await browser.newPage({ viewport: { width: 440, height: 760 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  await rmPage.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await rmPage.waitForFunction(() => typeof S !== 'undefined', { timeout: 150000 });
  const rm = await rmPage.evaluate(markup => {
    if (markup) { document.getElementById('splash')?.remove(); document.body.insertAdjacentHTML('afterbegin', markup); }
    const b = document.querySelector('.sp-body');
    return b ? getComputedStyle(b).animationName : '';
  }, splashHTML);
  ok('the beat is suppressed under reduced motion', rm === 'none' || !/spBeat/.test(rm), rm);
  await rmPage.close();

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
