#!/usr/bin/env node
/*
 * Navigating the app does not spend WebGL contexts.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-heartreuse.js <patched.html>
 *
 * WHY THIS IS A COUNT AND NOT A CODE READING. The defect was invisible in
 * every existing check: the heart looked right, rendered right, and released
 * every context it was asked to release. It was simply asked for a new one on
 * every visit to the home screen — twenty round trips, forty contexts — and on
 * Chromium, which returns a released slot, nothing ever went wrong. WebKit does
 * not return the slot, so the same code hits the sixteen-context cap after
 * about eight visits and starts evicting a LIVE context.
 *
 * So getContext is counted directly, before the page loads, and the assertion
 * is about growth: navigation must be free.
 *
 * THE CHECK THAT STOPS THIS BEING "FIXED" BY BREAKING IT. A heart that never
 * builds a context at all would score a perfect zero. So the count is only half
 * of it; the other half is that after all that navigating there is still a live
 * instance, with a mesh, drawing into a canvas that is in the document and the
 * right size. A suite that only counted would be satisfied by deleting the
 * feature.
 */
'use strict';
const path = require('path');
const { launch, isEngineNoise } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-heartreuse.js <patched.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
  const errors = [];
  let capWarnings = 0;
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (/too many active webgl/i.test(m.text())) capWarnings++;
    if (m.type() === 'error' && !isEngineNoise(m.text())) errors.push(m.text());
  });

  /* Counted at the source, before any application code runs. Marking the
     canvas means a second getContext on the same element — which the app does
     do — is not miscounted as a second context. */
  await page.addInitScript(() => {
    window.__ctx = 0;
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      const g = orig.call(this, type, ...rest);
      if (/webgl/i.test(type) && g && !this.__counted) { this.__counted = true; window.__ctx++; }
      return g;
    };
  });

  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
  const settle = ms => page.evaluate(m => new Promise(r => setTimeout(r, m)), ms);
  await settle(800);

  head('the markup hands over a place, not a canvas');
  const shape = await page.evaluate(() => ({
    slot: !!document.getElementById('heroHeart3dSlot'),
    canvasInSlot: !!document.querySelector('#heroHeart3dSlot > canvas'),
    keepsId: !!document.getElementById('heroHeart3d'),
  }));
  ok('the hero carries a slot for the heart', shape.slot);
  ok('and the canvas that was put in it is there', shape.canvasInSlot);
  /* #heroHeart3d moved from the template into script. It is still the name the
     rest of the app and verify-heroart use to find the canvas. */
  ok('which still answers to the name the markup used to give it', shape.keepsId);

  head('navigating twenty times');
  const before = await page.evaluate(() => window.__ctx);
  const firstNode = await page.evaluate(() => {
    const c = document.getElementById('heroHeart3d');
    if (c) c.__mark = 'the-one';
    return !!c;
  });
  ok('there is a canvas to mark before we start', firstNode);

  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => { startQuiz(CHAPTERS[0]); });
    await settle(110);
    await page.evaluate(() => { goHome(); });
    await settle(210);
  }

  const after = await page.evaluate(() => window.__ctx);
  ok('no context is spent going home and back, twenty times over',
     after === before, `${before} before, ${after} after`);
  ok('and the browser never warned about the cap', capWarnings === 0, `${capWarnings} warning(s)`);

  /* Identity, not just arithmetic: the same element, not a fresh one that
     happens to have reused a slot. */
  const sameNode = await page.evaluate(() => {
    const c = document.getElementById('heroHeart3d');
    return { present: !!c, marked: !!(c && c.__mark === 'the-one'),
             inSlot: !!(c && c.parentElement && c.parentElement.id === 'heroHeart3dSlot') };
  });
  ok('the canvas on screen is the very same element', sameNode.marked);
  ok('and it was moved back into the slot', sameNode.inSlot);

  head('and the heart is still a heart');
  /* The half that stops a deletion passing. */
  const live = await page.evaluate(() => {
    const c = document.getElementById('heroHeart3d');
    const r = c ? c.getBoundingClientRect() : { width: 0, height: 0 };
    return {
      instance: typeof heroHeart3d !== 'undefined' && !!heroHeart3d,
      tris: (typeof heroHeart3d !== 'undefined' && heroHeart3d && heroHeart3d.stats)
        ? heroHeart3d.stats.triangles : 0,
      lost: (typeof heroHeart3d !== 'undefined' && heroHeart3d) ? heroHeart3d.lost : true,
      w: Math.round(r.width), h: Math.round(r.height),
      active: !!document.querySelector('#heroHeart.heart-3d-active'),
    };
  });
  ok('a live instance survived all that navigation', live.instance && !live.lost);
  ok('with its mesh intact', live.tris > 5000, `${live.tris} triangles`);
  ok('drawing into a canvas that has a real box', live.w > 40 && live.h > 40, `${live.w}×${live.h} css px`);
  ok('and the photograph is still handed over to it', live.active);

  /* Pixels, because "an instance exists" is not "something is on screen". */
  const painted = await page.evaluate(async () => {
    const cv = document.getElementById('heroHeart3d');
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const off = document.createElement('canvas');
    off.width = cv.width; off.height = cv.height;
    off.getContext('2d').drawImage(cv, 0, 0);
    const d = off.getContext('2d').getImageData(0, 0, off.width, off.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 8 && (d[i] + d[i + 1] + d[i + 2]) > 42) lit++;
    return { lit, total: (d.length / 4) };
  });
  ok('and it is actually drawing after the twentieth visit',
     painted.lit > 500, `${painted.lit} lit pixels of ${painted.total}`);

  head('leaving costs nothing but the frames');
  const paused = await page.evaluate(async () => {
    startQuiz(CHAPTERS[0]);
    /* Wait for the QUIZ to be on screen, not for a stopwatch. render() goes
       through startViewTransition: at 100ms the home markup — slot included —
       is still in the document and at 300ms it is gone, so a fixed delay near
       that boundary asserts whichever side of the race it happened to land on.
       The quiz card appearing is the event this section is actually waiting
       for. */
    const t0 = Date.now();
    while (Date.now() - t0 < 10000 && !document.querySelector('.q-card')) {
      await new Promise(r => setTimeout(r, 60));
    }
    const cv = document.getElementById('heroHeart3d');
    return { slotGone: !document.getElementById('heroHeart3dSlot'),
             stillAlive: !!heroHeart3d && !heroHeart3d.lost,
             detached: !!(cv && !document.body.contains(cv)) || !cv,
             ctx: window.__ctx };
  });
  ok('the slot goes with the home markup', paused.slotGone);
  ok('but the instance and its context live on', paused.stillAlive);
  ok('and leaving spent nothing', paused.ctx === after, `${after} → ${paused.ctx}`);

  const resumedHome = await page.evaluate(async () => {
    goHome();
    await new Promise(r => setTimeout(r, 300));
    const c = document.getElementById('heroHeart3d');
    return { marked: !!(c && c.__mark === 'the-one'), ctx: window.__ctx,
             active: !!document.querySelector('#heroHeart.heart-3d-active') };
  });
  ok('coming back brings the same canvas out again', resumedHome.marked);
  ok('still without spending a context', resumedHome.ctx === after, `${after} → ${resumedHome.ctx}`);
  ok('and the medallion is handed back to it', resumedHome.active);

  head('a genuinely lost context is still recoverable');
  /* The one path that is allowed to allocate, and it has to still work — this
     is what a GPU reset or an iPadOS memory reclaim looks like. */
  const lostRun = await page.evaluate(async () => {
    const cv = document.getElementById('heroHeart3d');
    const gl = cv && cv.getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_lose_context');
    if (!ext || gl.isContextLost()) return { skipped: true };
    const beforeCtx = window.__ctx;
    ext.loseContext();
    for (let i = 0; i < 60 && heroHeart3d; i++) await new Promise(r => setTimeout(r, 50));
    const clearedInstance = !heroHeart3d;
    const fellBack = !document.querySelector('#heroHeart.heart-3d-active');
    /* A fresh mount is what the app does on the next render. Guarded because a
       build that re-mounts onto the SAME dead canvas throws out of
       Heart3D.create ("shader: null") — which is a finding about that build,
       not a reason for this suite to take the process down with it. */
    let threw = null;
    try { mountHeroHeart3d(); } catch (e) { threw = String(e && e.message || e); }
    await new Promise(r => setTimeout(r, 400));
    return { skipped: false, clearedInstance, fellBack, beforeCtx, threw,
             rebuilt: !!heroHeart3d, afterCtx: window.__ctx };
  });
  if (lostRun.skipped) {
    ok('WEBGL_lose_context was available to drive this', false, 'extension unavailable or already lost');
  } else {
    ok('losing the context clears the stale instance', lostRun.clearedInstance);
    ok('and hands the medallion back to the photograph', lostRun.fellBack);
    ok('a re-mount does not throw on the dead canvas', !lostRun.threw, lostRun.threw || '');
    ok('a re-mount builds a working heart again', lostRun.rebuilt);
    ok('and that — only that — is allowed to spend a context',
       lostRun.afterCtx === lostRun.beforeCtx + 1,
       `${lostRun.beforeCtx} → ${lostRun.afterCtx}`);
  }

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
