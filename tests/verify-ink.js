#!/usr/bin/env node
/*
 * Checks for the engraved drawing style.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-ink.js <patched.html|url>
 *
 * The interesting claim is not that a button exists — it is that switching
 * style re-shades the mesh already in memory rather than rebuilding the
 * anatomy, and that the picture on screen genuinely changes.
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-ink.js <patched.html|url>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

/* Proportion of pixels carrying real colour. The anatomic render is a
   continuous spread of reds; an engraving is ink on paper and has almost none.
   This separates the two without pinning either to exact values.

   Sampled from a SCREENSHOT rather than from the canvas in the page: a WebGL
   drawing buffer without preserveDrawingBuffer is cleared once composited, so
   an in-page drawImage of it reads back empty. The screenshot is the
   composited result, which is also what a person actually sees. */
async function colourFraction(page) {
  const shot = await page.locator('#labHeartCanvas').screenshot();
  const dataUrl = 'data:image/png;base64,' + shot.toString('base64');
  return page.evaluate(async u => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = u; });
    const off = document.createElement('canvas');
    off.width = 220; off.height = 220;
    const g = off.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 220, 220);
    const d = g.getImageData(0, 0, 220, 220).data;
    let coloured = 0, lit = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      lit++;
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      const sat = mx ? (mx - mn) / mx : 0;
      if (sat > 0.22 && mx > 40) coloured++;
    }
    return lit ? coloured / lit : -1;
  }, dataUrl);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
  await page.evaluate(() => { goLab(); render(); });
  await page.waitForTimeout(2000);

  head('the style switch');
  const start = await page.evaluate(() => ({
    style: labHeartStyle,
    label: document.querySelector('[data-heart-style]')?.textContent,
    live: !!labHeart,
  }));
  ok('anatomic is the default', start.style === 'anatomic', start.style);
  ok('the switch is present and labelled', start.label === 'Anatomic', start.label);
  ok('a heart is live to switch', start.live);

  const anatomicColour = await colourFraction(page);

  head('switching actually changes the drawing');
  /* Same mesh, re-shaded: if the toggle rebuilt the anatomy the instance would
     be a different object, and a rebuild is ~1s of surface nets we do not want
     to pay for a style change. */
  const sameInstance = await page.evaluate(() => {
    const before = labHeart;
    document.querySelector('[data-heart-style]').click();
    return labHeart === before;
  });
  await page.waitForTimeout(1600);
  const after = await page.evaluate(() => ({
    style: labHeartStyle,
    label: document.querySelector('[data-heart-style]')?.textContent,
    persisted: localStorage.getItem('accsap12.heartstyle'),
    paper: document.querySelector('.lab-heart-panel').classList.contains('ink-paper'),
  }));
  ok('the same instance is re-shaded, not rebuilt', sameInstance === true);
  ok('style flips to ink', after.style === 'ink', after.style);
  ok('the switch relabels itself', after.label === 'Engraved', after.label);
  ok('the choice is remembered', after.persisted === 'ink');
  ok('the panel takes on paper behind it', after.paper === true);

  const inkColour = await colourFraction(page);
  ok('the engraving is ink and paper, not a spread of colour',
     anatomicColour > 0.15 && inkColour >= 0 && inkColour < anatomicColour * 0.4,
     `coloured pixels: anatomic ${(anatomicColour * 100).toFixed(0)}% → ink ${(inkColour * 100).toFixed(0)}%`);

  head('it survives the things that re-render');
  await page.evaluate(() => { goHome(); render(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { goLab(); render(); });
  await page.waitForTimeout(1800);
  const back = await page.evaluate(() => ({
    style: labHeartStyle,
    label: document.querySelector('[data-heart-style]')?.textContent,
    paper: document.querySelector('.lab-heart-panel').classList.contains('ink-paper'),
    live: !!labHeart,
  }));
  ok('the style is still ink after leaving and returning', back.style === 'ink' && back.live, JSON.stringify(back));
  ok('and the panel is still papered', back.paper === true);

  const modes = await page.evaluate(async () => {
    const out = {};
    for (const m of ['cutaway', 'conduction', 'whole']) {
      document.querySelector(`[data-heart-mode="${m}"]`).click();
      await new Promise(r => setTimeout(r, 600));
      out[m] = labHeartMode;
    }
    return out;
  });
  ok('every mode still switches while engraved',
     modes.cutaway === 'cutaway' && modes.conduction === 'conduction' && modes.whole === 'whole',
     JSON.stringify(modes));

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 2).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
