#!/usr/bin/env node
/*
 * Checks the crispness pass: every canvas backs itself with enough device
 * pixels to stay sharp on a high-DPI display.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-crisp.js <patched.html|url>
 *
 * Run on a simulated 3× display. A canvas that ignored device pixels would
 * back a 400 px box with a 400 px store and let the browser upscale it 3× —
 * every hairline soft. So the test is simply: does each canvas's backing store
 * actually scale with the display?  The 2D line-art canvases (the ECG strips,
 * the 12-lead, the physiology diagram) should reach 3×; the one 3D surface, the
 * heart, should reach 2.5× on this pointer:fine browser — high enough to be
 * crisp, capped low enough not to triple a phone's shading budget.
 *
 * The ceilings are ceilings, so this also confirms none of these canvases is
 * still stuck at the old 2× cap the pass was meant to lift.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-crisp.js <patched.html|url>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

/* backing-store pixels per CSS pixel, along the width */
const ratioOf = (page, sel) => page.evaluate(s => {
  const cv = document.querySelector(s);
  if (!cv) return null;
  const r = cv.getBoundingClientRect();
  return r.width ? cv.width / r.width : null;
}, sel);

(async () => {
  const browser = await launch();
  /* A 3× display. Desktop Chromium is pointer:fine, which is what the heart's
     device-aware ceiling keys on. */
  const page = await browser.newPage({ viewport: { width: 460, height: 1000 }, deviceScaleFactor: 3 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 150000 });

  const env = await page.evaluate(() => ({
    dpr: window.devicePixelRatio,
    fine: !!(window.matchMedia && window.matchMedia('(pointer:fine)').matches),
  }));
  ok('the test really is running on a 3× display', env.dpr === 3, `dpr ${env.dpr}`);

  head('the home ECG strip');
  await page.waitForFunction(() => { const c = document.getElementById('heroECG'); return c && c.width > 0; }, { timeout: 30000 });
  const hero = await ratioOf(page, '#heroECG');
  ok('the hero ECG strip backs itself at ~3×, not the old 2×', hero >= 2.8, `${hero ? hero.toFixed(2) : hero}×`);

  head('Rhythm Lab canvases');
  await page.evaluate(() => { goLab(); render(); });
  await page.waitForTimeout(500);
  await page.evaluate(() => { document.querySelector('[data-physio-view="pv"]') && null; });
  await page.waitForFunction(() => { const c = document.getElementById('physioCanvas'); return c && c.width > 0; }, { timeout: 30000 });

  const physio = await ratioOf(page, '#physioCanvas');
  ok('the cardiac-cycle diagram backs itself at ~3×', physio >= 2.8, `${physio ? physio.toFixed(2) : physio}×`);

  /* Require the canvas to BE there. `x == null || x >= 2.8` passed whether the
     element was crisp or simply gone, so a regression that stopped mounting it
     would have looked green. */
  const twelve = await ratioOf(page, '#twelveCanvas');
  ok('the 12-lead is mounted and backs itself at ~3× — its grid is measured on',
     twelve != null && twelve >= 2.8, twelve == null ? 'NOT MOUNTED' : `${twelve.toFixed(2)}×`);

  const labMon = await ratioOf(page, '#labCanvas');
  ok('the Rhythm Lab monitor strip is mounted and backs itself at ~3×',
     labMon != null && labMon >= 2.8, labMon == null ? 'NOT MOUNTED' : `${labMon.toFixed(2)}×`);

  /* The cardiac cycle is a flat 2D canvas like the others, and it is now the
     largest one on the screen — a diagram of pressure traces read for meaning
     rather than glanced at, so it gets the full ratio rather than the reduced
     one the 3D heart used to need for its shading budget. */
  const cycle = await ratioOf(page, '#physioCanvas');
  ok('the cardiac cycle is mounted and backs itself at ~3×',
     cycle != null && cycle >= 2.8, cycle == null ? 'NOT MOUNTED' : `${cycle.toFixed(2)}×`);

  const heartGone = await page.evaluate(() => !document.getElementById('labHeartCanvas'));
  ok('and there is no 3D heart canvas in the lab to cap', heartGone);

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
