#!/usr/bin/env node
/*
 * Checks for the photographed heart on the startup screen.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-splash-heart.js <patched.html>
 *   NODE_PATH=$(npm root -g) node tests/verify-splash-heart.js http://localhost:8137
 *
 * Runs against either target. The single-file build carries the picture inline
 * as a data:image/webp URI, right in the splash markup; the split PWA build
 * (served over http, reached via a URL) has it pulled out to
 * content/splash-heart/heart.webp and fetches it, because base64 of an
 * already-compressed image does not gzip and the split shell has a transfer
 * budget that was hard-won earlier in this project. The file-content checks
 * below only make sense against the single-file source, so they are skipped
 * for a URL target; the runtime checks — does it decode, is it clipped by the
 * medallion, does it beat, does reduced motion stop it — exercise real
 * behaviour and apply to both.
 *
 * WHAT THIS SUITE IS FOR, NOW THAT IT IS A PICTURE. The Lottie version of this
 * splash could fail in a way that left the element tree intact and every path
 * empty, so the old checks counted paths and looked for a "d" attribute. An
 * <img> fails differently and more quietly: a broken src leaves a perfectly
 * valid element with naturalWidth 0, sitting inside a dark medallion, on a
 * dark splash, for the few hundred milliseconds anyone would see it. Nobody
 * would notice in review. So the load-bearing check here is naturalWidth, and
 * the one below it is that the box it renders into is actually a box.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { launch, isEngineNoise } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-splash-heart.js <patched.html>'); process.exit(1); }
const isFile = !/^https?:\/\//.test(target);
const URL = isFile ? 'file://' + path.resolve(target) : target;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

(async () => {
  head('the single-file build carries it inline, before the app script');
  if (isFile) {
    const src = fs.readFileSync(target, 'utf8');
    const splashIdx = src.indexOf('<div id="splash"');
    const shellIdx = src.indexOf('<div id="shell">');
    const scriptIdx = src.indexOf('ALL_Q=[');
    const splashBlock = src.slice(splashIdx, shellIdx);

    ok('the splash contains the medallion', /id="spHeartMount"/.test(splashBlock));
    const img = /<img class="sp-heart-img"[^>]*src="data:image\/webp;base64,([A-Za-z0-9+/=]+)"/.exec(splashBlock);
    ok('the picture is inlined as a WebP data: URI inside it', !!img);
    if (img) {
      const bytes = Buffer.from(img[1], 'base64');
      ok('and that URI decodes to a real WebP, not a truncated one',
         bytes.slice(0, 4).toString('ascii') === 'RIFF' && bytes.slice(8, 12).toString('ascii') === 'WEBP',
         `${(bytes.length / 1024).toFixed(1)} KB`);
      /* A guard on the trade this step made. The picture replaced 191 KB of
         Lottie; if a future re-export quietly ships a 400 KB image, the splash
         is slower than what it replaced and nobody would see it in a diff. */
      ok('and it is small enough to be worth inlining', bytes.length < 120 * 1024,
         `${(bytes.length / 1024).toFixed(1)} KB, ceiling 120 KB`);
    }
    ok('the whole splash ships before the app script', splashIdx > -1 && splashIdx < scriptIdx);
    ok('nothing on the splash asks for WebGL — no canvas, no Heart3D',
       !/<canvas/.test(splashBlock) && !/Heart3D/.test(splashBlock));
    /* The Lottie runtime was 168 KB of player that existed for this one
       animation. If it is still in the build, something re-added it or the
       swap was only half done. */
    ok('and the Lottie runtime is gone from the build entirely',
       !/lottie/i.test(src));
  } else {
    /* A NOTE, not a check. This was ok(..., true), which counts a skip as a
       pass: "14 passed" then meant 13 things verified and one thing declined.
       A number that includes things nobody measured is the exact dishonesty
       this repo's CI header exists to avoid, and the count is lower and true
       rather than higher and not. */
    console.log('  ----  file-content checks skipped — target is a URL, served from the split build');
  }

  head('it actually renders — a decoded image in a real box');
  /* The splash is a genuinely transient element: dismissSplash() adds .gone
     (opacity 0, visibility hidden) and removes it from the DOM 520 ms later.
     This suite used to race that timer, slowed by throttling the CPU — which
     only Chromium can do. In WebKit the splash was gone before the first read:
     four failures with a working image, and two animation checks "passed" on
     no samples at all.

     So the removal is held, by the test, for the splash alone: remove() on
     #splash records that the app asked and does nothing. The app's own code
     runs unchanged, .gone included — it hides the splash but keeps its box
     and its animation, which is what is measured. This is a precondition (the
     element is still there to read), never the claim: no check below asserts
     that the splash stays. */
  const HOLD = `(() => {
    const remove = Element.prototype.remove;
    Element.prototype.remove = function () {
      if (this.id === 'splash') { window.__splashRemoveAsked = true; return; }
      return remove.apply(this, arguments);
    };
  })()`;
  const browser = await launch();
  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors,
                   events: events.length ? events.join(', ') : 'none' }));
  const page = watch(await browser.newPage({ viewport: { width: 440, height: 900 }, deviceScaleFactor: 2 }), events, 'main');
  await page.addInitScript(HOLD);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !isEngineNoise(m.text())) errors.push(m.text()); });
  await page.goto(URL, { waitUntil: 'commit', timeout: 250000 });

  /* Wait for the decode, not the element — on the split build the <img> is in
     the static markup from first paint and points at a file that has not
     arrived yet, so "the element exists" proves nothing. */
  await page.waitForFunction(() => {
    const im = document.querySelector('#spHeartMount img');
    return im && im.naturalWidth > 0;
  }, null, { timeout: 20000 }).catch(() => {});

  const geo = await page.evaluate(() => {
    const mount = document.querySelector('#spHeartMount');
    const im = mount && mount.querySelector('img');
    if (!im) return { mounted: false };
    const r = im.getBoundingClientRect(), mr = mount.getBoundingClientRect();
    const cs = getComputedStyle(mount);
    return {
      mounted: true,
      natural: im.naturalWidth,
      w: Math.round(r.width), h: Math.round(r.height),
      imgs: mount.querySelectorAll('img').length,
      clipped: cs.overflow === 'hidden',
      rounded: parseFloat(cs.borderTopLeftRadius) > 0,
      plate: Math.round(mr.width),
    };
  });
  ok('the medallion holds exactly one image', geo.mounted && geo.imgs === 1, `${geo.imgs} img element(s)`);
  ok('and the browser decoded it — this is the check a broken src fails',
     geo.mounted && geo.natural > 0, geo.mounted ? `naturalWidth ${geo.natural}` : 'no image');
  ok('it is laid out at a real size, not collapsed',
     geo.mounted && geo.w >= 120 && geo.h >= 120, `${geo.w}×${geo.h} css px`);
  ok('the plate clips it and is rounded, so the dark ground reads as a frame',
     geo.mounted && geo.clipped && geo.rounded);

  head('the beat actually moves');
  const frame = () => page.evaluate(() => {
    const el = document.querySelector('#spHeartMount img');
    return el ? getComputedStyle(el).transform : null;
  });
  const a = await frame();
  await page.waitForTimeout(150);
  const b = await frame();
  /* Two real samples or a failure. This was `: true` when a sample was
     missing, so the check counted as a pass having measured nothing — what
     every WebKit run did. With the removal held a missing sample means the
     image is not there, which is a failure in its own right. */
  ok('the image transform changes from one moment to the next',
     a !== null && b !== null && a !== b,
     a === null || b === null ? 'no image to sample' : (a === b ? 'identical' : `${a} → ${b}`));

  head('reduced motion actually stops it');
  const rmPage = watch(await browser.newPage({ viewport: { width: 440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' }), events, 'reduced-motion');
  await rmPage.addInitScript(HOLD);
  await rmPage.goto(URL, { waitUntil: 'commit', timeout: 250000 });
  await rmPage.waitForFunction(() => {
    const im = document.querySelector('#spHeartMount img');
    return im && im.naturalWidth > 0;
  }, null, { timeout: 20000 }).catch(() => {});
  const rmFrame = () => rmPage.evaluate(() => {
    const el = document.querySelector('#spHeartMount img');
    return el ? getComputedStyle(el).transform : null;
  });
  const r1 = await rmFrame();
  await rmPage.waitForTimeout(150);
  const r2 = await rmFrame();
  ok('under prefers-reduced-motion the frame holds still',
     r1 !== null && r2 !== null && r1 === r2,
     r1 === null || r2 === null ? 'no image to sample' : (r1 === r2 ? 'held' : 'still animating'));
  await rmPage.close();

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
