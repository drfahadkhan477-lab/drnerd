#!/usr/bin/env node
/*
 * The home hero is a photograph that beats on the rhythm, and spends no WebGL.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-heroart.js <patched.html>
 *   NODE_PATH=$(npm root -g) node tests/verify-heroart.js http://localhost:8137
 *
 * WHAT THIS DEFENDS. The hero used to stack a flat SVG heart under a WebGL
 * canvas running the Heart3D renderer. heroart-patch.js replaces both with the
 * same photograph the splash uses. Two things could silently go wrong with
 * that, and neither would look like a failure in a screenshot:
 *
 *   1. THE BEAT COMES UNCOUPLED. setHeroBeatRate() writes animationDuration
 *      onto '#heroHeart .h-beat' — the selector the flat SVG used and which
 *      the new markup deliberately preserves. If a future edit renames that
 *      element or moves the animation onto the plate instead of the inner
 *      div, the picture keeps beating at the CSS default and simply stops
 *      tracking the rhythm. It would look completely fine. So the check below
 *      drives the rhythm and asserts the duration follows it, rather than
 *      asserting an animation merely exists.
 *
 *   2. THE CANVAS COMES BACK. The point of this step is that the app's
 *      most-visited screen no longer holds a WebGL2 context. A later patch
 *      re-adding a hero canvas would cost that again without anyone noticing.
 *
 * NOT ASSERTED HERE: that Rhythm Lab still has its 3D heart. That is the apex
 * and polish suites' ground, and this one deliberately does not restate it.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-heroart.js <patched.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });

  /* Count getContext('webgl2') calls from before the page's own scripts run,
     so a hero canvas re-appearing is caught at the source rather than inferred
     from the DOM. Heart3D's own contexts on other screens are not the subject;
     the home screen is never left during this run. */
  await page.addInitScript(() => {
    window.__webgl2 = 0;
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (String(type).indexOf('webgl') === 0) window.__webgl2++;
      return orig.call(this, type, ...rest);
    };
  });

  await page.goto(URL, { waitUntil: 'commit', timeout: 250000 });
  await page.waitForFunction(() => !!document.getElementById('heroHeart'), null, { timeout: 60000 });
  /* The hero mounts its strip and label on the same tick; give the beat rate
     one frame to be written before reading it. */
  await page.waitForTimeout(120);

  head('the hero wears the photograph');
  const hero = await page.evaluate(() => {
    const plate = document.getElementById('heroHeart');
    const im = plate && plate.querySelector('img');
    const beat = plate && plate.querySelector('.h-beat');
    const r = plate ? plate.getBoundingClientRect() : null;
    const cs = plate ? getComputedStyle(plate) : null;
    return {
      plate: !!plate,
      isPlate: !!plate && plate.classList.contains('hero-heart-plate'),
      img: !!im,
      natural: im ? im.naturalWidth : 0,
      beat: !!beat,
      w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0,
      clipped: cs ? cs.overflow === 'hidden' : false,
      canvas3d: !!document.getElementById('heroHeart3d'),
      svg: !!(plate && plate.querySelector('svg')),
    };
  });
  ok('#heroHeart is the medallion plate', hero.plate && hero.isPlate);
  ok('it holds a decoded image, not an empty element', hero.img && hero.natural > 0,
     `naturalWidth ${hero.natural}`);
  ok('and no flat SVG heart is left stacked under it', hero.plate && !hero.svg);
  ok('it lays out at a real size', hero.w >= 80 && hero.h >= 80, `${hero.w}×${hero.h} css px`);
  ok('the plate clips the picture', hero.clipped);

  head('the home screen spends no WebGL context');
  ok('there is no #heroHeart3d canvas in the document', !hero.canvas3d);
  const gl = await page.evaluate(() => window.__webgl2);
  ok('and nothing asked a canvas for a WebGL context on this screen', gl === 0,
     `${gl} getContext('webgl*') call(s)`);

  head('the beat still tracks the rhythm');
  /* The rotation itself is on an 11-second timer — far too slow to wait on,
     and waiting on a timer is how a suite becomes flaky. setHeroBeatRate is
     the function the rotation calls, so calling it directly tests the same
     coupling without the wait. */
  const beat = await page.evaluate(() => {
    const el = document.querySelector('#heroHeart .h-beat');
    if (!el || typeof setHeroBeatRate !== 'function' || typeof RHYTHMS === 'undefined') return null;
    const read = () => getComputedStyle(el).animationDuration;
    const before = read();
    /* Two rhythms with genuinely different rates, chosen from the table rather
       than hardcoded, so this does not go stale if the library is retuned. */
    const kinds = Object.keys(RHYTHMS).filter(k => RHYTHMS[k] && RHYTHMS[k].hr);
    const slow = kinds.reduce((a, b) => (RHYTHMS[a].hr <= RHYTHMS[b].hr ? a : b));
    const fast = kinds.reduce((a, b) => (RHYTHMS[a].hr >= RHYTHMS[b].hr ? a : b));
    setHeroBeatRate(slow); const atSlow = read();
    setHeroBeatRate(fast); const atFast = read();
    return { before, atSlow, atFast, slow, fast,
             slowHr: RHYTHMS[slow].hr, fastHr: RHYTHMS[fast].hr };
  });
  ok('the beat element is reachable at the selector setHeroBeatRate writes to', !!beat);
  if (beat) {
    ok('a slow rhythm gives a longer beat than a fast one',
       parseFloat(beat.atSlow) > parseFloat(beat.atFast),
       `${beat.slow} @${beat.slowHr} → ${beat.atSlow}, ${beat.fast} @${beat.fastHr} → ${beat.atFast}`);
    ok('and the duration actually changed from what the CSS set',
       beat.atSlow !== beat.before || beat.atFast !== beat.before,
       `css ${beat.before}`);
  }

  head('and it moves');
  const t1 = await page.evaluate(() => getComputedStyle(document.querySelector('#heroHeart .h-beat')).transform);
  await page.waitForTimeout(140);
  const t2 = await page.evaluate(() => getComputedStyle(document.querySelector('#heroHeart .h-beat')).transform);
  ok('the transform changes from one moment to the next', t1 !== t2, `${t1} → ${t2}`);

  head('reduced motion holds it still');
  const rm = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await rm.goto(URL, { waitUntil: 'commit', timeout: 250000 });
  await rm.waitForFunction(() => !!document.querySelector('#heroHeart .h-beat'), null, { timeout: 60000 });
  const r1 = await rm.evaluate(() => getComputedStyle(document.querySelector('#heroHeart .h-beat')).transform);
  await rm.waitForTimeout(140);
  const r2 = await rm.evaluate(() => getComputedStyle(document.querySelector('#heroHeart .h-beat')).transform);
  ok('the transform holds', r1 === r2, r1 === r2 ? 'held' : `${r1} → ${r2}`);
  await rm.close();

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
