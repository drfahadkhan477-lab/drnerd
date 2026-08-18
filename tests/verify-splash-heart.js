#!/usr/bin/env node
/*
 * Checks for the crystal heart on the startup screen.
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
    ok('the splash contains the crystal heart SVG', /class="sp-heart"/.test(splashBlock));
    ok('the heart is placed above the rhythm strip',
       splashBlock.indexOf('class="sp-heart"') < splashBlock.indexOf('class="sp-strip"') &&
       splashBlock.indexOf('class="sp-heart"') > -1);
    ok('the whole splash ships before the app script', splashIdx > -1 && splashIdx < scriptIdx);
    ok('the heart is cut into eight facets', (splashBlock.match(/<polygon/g) || []).length === 8,
       `${(splashBlock.match(/<polygon/g) || []).length} facets`);
    ok('it has a bright rim, a specular glint, and a glow disc',
       /sp-heart-rim/.test(splashBlock) && /sp-heart-glint/.test(splashBlock) && /sp-heart-glow/.test(splashBlock));
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
    const glow = document.querySelector('.sp-heart-glow');
    return {
      name: cs.animationName,
      dur: cs.animationDuration,
      glowName: glow ? getComputedStyle(glow).animationName : '',
      facets: document.querySelectorAll('.sp-heart polygon').length,
    };
  }, splashHTML);
  ok('the heart is present after re-mount', !!anim);
  ok('it carries the beat animation', anim && /spBeat/.test(anim.name), anim && anim.name);
  ok('the beat runs at roughly one cardiac cycle', anim && parseFloat(anim.dur) > 0.6 && parseFloat(anim.dur) < 1.4, anim && anim.dur);
  ok('the glow pulses with it', anim && /spHeartGlow/.test(anim.glowName), anim && anim.glowName);

  head('it holds still when the viewer prefers reduced motion');
  const rmPage = await browser.newPage({ viewport: { width: 440, height: 760 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  await rmPage.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await rmPage.waitForFunction(() => typeof S !== 'undefined', { timeout: 150000 });
  const rm = await rmPage.evaluate(markup => {
    if (markup) { document.getElementById('splash')?.remove(); document.body.insertAdjacentHTML('afterbegin', markup); }
    const h = document.querySelector('.sp-heart');
    return h ? getComputedStyle(h).animationName : '';
  }, splashHTML);
  ok('the beat is suppressed under reduced motion', rm === 'none' || !/spBeat/.test(rm), rm);
  await rmPage.close();

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
