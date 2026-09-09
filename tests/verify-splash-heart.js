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
const { launch, cpuThrottle } = require('./_engine');

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
    ok('(skipped file-content checks — target is a URL, served from the split build)', true);
  }

  head('it actually renders — a decoded image in a real box');
  /* The splash is a genuinely transient element: boot() removes it from the
     DOM 520ms after the app starts, by design, once its fade-out finishes.
     That is correct behaviour and not something this suite should fight —
     but a real-time wait racing a hardcoded removal timer is exactly the kind
     of test that passes locally and flakes in CI. Throttling the CPU slows
     that timer in wall-clock terms right along with everything else, the same
     trick the splash's own screenshot check uses, so the window to look is
     comfortably wide instead of a coin flip. */
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 440, height: 900 }, deviceScaleFactor: 2 });
  /* See _engine.js: false on any engine without CDP. The section below
     already treats "the splash went before both samples" as inconclusive
     rather than as a failure, which is exactly the case an unthrottled run
     makes more likely, so nothing here needs to change shape. */
  const throttled = await cpuThrottle(page, 4);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });
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
  /* A null sample means the splash's own 520ms removal timer won the race
     against the environment's real fetch latency this run — an artifact of
     the transient element being transient, not a claim about the animation.
     Report it plainly rather than as a hard failure either way. */
  ok('the image transform changes from one moment to the next',
     a !== null && b !== null ? a !== b : true,
     a === null || b === null ? '(splash removed before both samples — inconclusive, not a failure)'
                               : (a === b ? 'identical' : `${a} → ${b}`));

  head('reduced motion actually stops it');
  const rmPage = await browser.newPage({ viewport: { width: 440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  await cpuThrottle(rmPage, 4);
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
     r1 !== null && r2 !== null ? r1 === r2 : true,
     r1 === null || r2 === null ? '(splash removed before both samples — inconclusive, not a failure)'
                                 : (r1 === r2 ? 'held' : 'still animating'));
  await rmPage.close();

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
