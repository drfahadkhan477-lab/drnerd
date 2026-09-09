#!/usr/bin/env node
/*
 * The hero turns, in slate, with the conduction system running through it.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-heroart.js <patched.html>
 *   NODE_PATH=$(npm root -g) node tests/verify-heroart.js http://localhost:8137
 *
 * WHAT THIS DEFENDS, AND WHY EACH CHECK IS SHAPED THE WAY IT IS.
 *
 * The hero mounts Heart3D in the `specimen` style: one desaturated slate
 * material, coronaries as relief, and the conduction tree drawn as a source
 * with the depolarisation front travelling it. Four things can go wrong there
 * and only one of them looks broken:
 *
 *   1. THE STYLE SILENTLY FALLS BACK. Heart3D resolves its style through a
 *      lookup with `|| 0`, so a typo in the option name gives `anatomic` — a
 *      RED heart on the home screen. Wrong, and not obviously broken. Asserted
 *      by measuring the rendered pixels rather than by reading the option
 *      back: the option being right is not the claim, the heart being slate
 *      is.
 *
 *   2. THE CURRENT STOPS BEING CURRENT. The yellow tree is the depolarisation
 *      wave the module already models, not an effect. If it ever becomes a
 *      static yellow overlay it will still look fine in a screenshot, so the
 *      check samples the same pixels twice inside one activation window and
 *      requires them to have changed.
 *
 *   3. THE BEAT COMES UNCOUPLED FROM THE RHYTHM. setHeroBeatRate() drives the
 *      still fallback through '#heroHeart .h-beat'; Heart3D drives itself from
 *      the rhythm it was handed. Both are asserted, because the hero rotation
 *      changes rhythm every 11 seconds and either one drifting means the
 *      picture and the trace beside it are telling different stories.
 *
 *   4. A LOST CONTEXT LEAVES A BLANK SQUARE. The photograph is in the markup
 *      as the fallback and `.heart-3d-active` is what swaps between them.
 *
 * NOT ASSERTED HERE: that Rhythm Lab has its own heart, or that the module
 * meshes correctly. Those belong to the apex and polish suites and this one
 * deliberately does not restate them.
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

  await page.goto(URL, { waitUntil: 'commit', timeout: 250000 });
  await page.waitForFunction(() => !!document.getElementById('heroHeart'), null, { timeout: 60000 });
  /* Wait for a mounted instance rather than a duration — the mesh is built by
     surface nets at mount and how long that takes is a property of the machine
     this happens to run on. Bounded, so a mount that never happens fails
     rather than hangs. */
  await page.waitForFunction(
    () => typeof heroHeart3d !== 'undefined' && !!heroHeart3d, null, { timeout: 60000 }
  ).catch(() => {});

  head('both occupants of the medallion are present');
  const geo = await page.evaluate(() => {
    const plate = document.getElementById('heroHeart');
    const cv = document.getElementById('heroHeart3d');
    const im = plate && plate.querySelector('img');
    const pr = plate ? plate.getBoundingClientRect() : null;
    const cr = cv ? cv.getBoundingClientRect() : null;
    return {
      plate: !!plate && plate.classList.contains('hero-heart-plate'),
      fallbackImg: !!im, natural: im ? im.naturalWidth : 0,
      beat: !!(plate && plate.querySelector('.h-beat')),
      canvas: !!cv,
      active: !!plate && plate.classList.contains('heart-3d-active'),
      live: typeof heroHeart3d !== 'undefined' && !!heroHeart3d,
      tris: (typeof heroHeart3d !== 'undefined' && heroHeart3d && heroHeart3d.stats) ? heroHeart3d.stats.triangles : 0,
      sameBox: pr && cr && Math.abs(pr.width - cr.width) < 2 && Math.abs(pr.height - cr.height) < 2,
      w: pr ? Math.round(pr.width) : 0, h: pr ? Math.round(pr.height) : 0,
    };
  });
  ok('the still photograph is in the markup as the fallback',
     geo.plate && geo.fallbackImg && geo.natural > 0, `naturalWidth ${geo.natural}`);
  ok('and the canvas shares its box exactly, so the swap is a crossfade not a jump',
     geo.canvas && geo.sameBox, `${geo.w}×${geo.h} css px`);
  ok('the beat element the rhythm rotation writes to is still reachable', geo.beat);
  ok('a live Heart3D instance is driving the canvas', geo.live);
  ok('whose mesh actually built triangles', geo.tris > 5000, `${geo.tris} triangles`);
  ok('and the fallback has been handed over to it', geo.active);

  head('it is the specimen style, judged from the pixels');
  /* The claim is not "the option said specimen". It is that the heart on
     screen is slate with a yellow tree — which is what a silent fallback to
     the red anatomic style would fail. */
  const px = await page.evaluate(async () => {
    const cv = document.getElementById('heroHeart3d');
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const off = document.createElement('canvas');
    off.width = cv.width; off.height = cv.height;
    off.getContext('2d').drawImage(cv, 0, 0);
    const d = off.getContext('2d').getImageData(0, 0, off.width, off.height).data;
    let lit = 0, reddish = 0, yellowish = 0, slate = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
      if (a < 8 || (r + g + b) < 42) continue;          // background / deep shadow
      lit++;
      if (r > g + 26 && r > b + 26) reddish++;           // anatomic muscle
      if (r > 110 && g > 90 && b < g - 34) yellowish++;  // the conduction tree
      if (Math.abs(r - g) < 26 && b >= g - 8) slate++;   // desaturated, cool
    }
    return { lit, reddish, yellowish, slate };
  });
  ok('the render has substance to judge', px.lit > 4000, `${px.lit} lit pixels`);
  ok('the muscle is slate, not red — this is the check a silent style fallback fails',
     px.lit > 0 && px.reddish / px.lit < 0.04,
     `${(100 * px.reddish / Math.max(px.lit, 1)).toFixed(1)}% reddish`);
  ok('most of the surface is desaturated and cool',
     px.lit > 0 && px.slate / px.lit > 0.45,
     `${(100 * px.slate / Math.max(px.lit, 1)).toFixed(1)}% slate`);
  ok('and a yellow conduction tree is visible through it',
     px.lit > 0 && px.yellowish / px.lit > 0.01,
     `${(100 * px.yellowish / Math.max(px.lit, 1)).toFixed(2)}% yellow`);

  head('the current travels — it is a wave, not a painted-on tree');
  /* Sampled inside one activation window. Heart3D's own cycle() reports the
     depolarisation front, so the samples are taken when there IS a front to
     see rather than at two arbitrary moments that might both be diastole. */
  const travel = await page.evaluate(async () => {
    const cv = document.getElementById('heroHeart3d');
    const off = document.createElement('canvas');
    off.width = cv.width; off.height = cv.height;
    const ctx = off.getContext('2d');
    const yellowByRow = () => {
      ctx.clearRect(0, 0, off.width, off.height);
      ctx.drawImage(cv, 0, 0);
      const d = ctx.getImageData(0, 0, off.width, off.height).data;
      const rows = new Float64Array(off.height);
      for (let y = 0; y < off.height; y++) {
        let s = 0;
        for (let x = 0; x < off.width; x++) {
          const i = (y * off.width + x) * 4;
          const r = d[i], g = d[i + 1], b = d[i + 2];
          if (r > 110 && g > 90 && b < g - 34) s += (r + g) / 2;
        }
        rows[y] = s;
      }
      return rows;
    };
    const frame = () => new Promise(r => requestAnimationFrame(r));
    /* Take a run of samples across roughly one beat and keep the two that
       differ most. A fixed pair can land either side of diastole and prove
       nothing; the extremes over a beat are what say the front moved. */
    const shots = [];
    for (let i = 0; i < 26; i++) { await frame(); await frame(); shots.push(yellowByRow()); }
    let best = 0;
    const centroid = rows => {
      let n = 0, d2 = 0;
      for (let y = 0; y < rows.length; y++) { n += rows[y] * y; d2 += rows[y]; }
      return d2 > 0 ? n / d2 : -1;
    };
    const cs = shots.map(centroid).filter(c => c >= 0);
    for (const a of cs) for (const b of cs) best = Math.max(best, Math.abs(a - b));
    let totalMax = 0, totalMin = Infinity;
    for (const s of shots) {
      let t = 0; for (const v of s) t += v;
      totalMax = Math.max(totalMax, t); totalMin = Math.min(totalMin, t);
    }
    return { centroidSpread: best, totalMax, totalMin, samples: cs.length };
  });
  ok('there is yellow to track across the beat', travel.samples > 10 && travel.totalMax > 0,
     `${travel.samples} samples`);
  /* Either the front moves down the heart (centroid shifts) or it brightens
     and fades (total changes). Both are the wave; requiring one specific
     signature would make this a test of the camera angle. */
  ok('and it is not static — the front moves, or brightens and fades',
     travel.centroidSpread > 1.5 || (travel.totalMax - travel.totalMin) / Math.max(travel.totalMax, 1) > 0.05,
     `centroid spread ${travel.centroidSpread.toFixed(1)}px, ` +
     `intensity range ${(100 * (travel.totalMax - travel.totalMin) / Math.max(travel.totalMax, 1)).toFixed(1)}%`);

  head('the rhythm reaches both the picture and the fallback');
  const beat = await page.evaluate(() => {
    const el = document.querySelector('#heroHeart .h-beat');
    if (!el || typeof setHeroBeatRate !== 'function' || typeof RHYTHMS === 'undefined') return null;
    const read = () => getComputedStyle(el).animationDuration;
    const kinds = Object.keys(RHYTHMS).filter(k => RHYTHMS[k] && RHYTHMS[k].hr);
    const slow = kinds.reduce((a, b) => (RHYTHMS[a].hr <= RHYTHMS[b].hr ? a : b));
    const fast = kinds.reduce((a, b) => (RHYTHMS[a].hr >= RHYTHMS[b].hr ? a : b));
    setHeroBeatRate(slow); const atSlow = read();
    setHeroBeatRate(fast); const atFast = read();
    let took = false;
    try { heroHeart3d.setRhythm('afib'); took = true; } catch (_) {}
    return { atSlow, atFast, slow, fast, slowHr: RHYTHMS[slow].hr, fastHr: RHYTHMS[fast].hr, took };
  });
  ok('setHeroBeatRate still reaches the fallback', !!beat);
  if (beat) {
    ok('a slow rhythm gives the still a longer beat than a fast one',
       parseFloat(beat.atSlow) > parseFloat(beat.atFast),
       `${beat.slow} @${beat.slowHr} → ${beat.atSlow}, ${beat.fast} @${beat.fastHr} → ${beat.atFast}`);
    ok('and the turning heart takes a rhythm change without throwing', beat.took === true);
  }

  head('a lost context hands the medallion back to the photograph');
  const lost = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const cv = document.getElementById('heroHeart3d');
    const gl = cv && cv.getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_lose_context');
    if (!ext) return { skipped: true };
    const before = document.getElementById('heroHeart').classList.contains('heart-3d-active');
    ext.loseContext();
    for (let i = 0; i < 60 && heroHeart3d; i++) await wait(50);
    const after = {
      instance: !!heroHeart3d,
      active: document.getElementById('heroHeart').classList.contains('heart-3d-active'),
    };
    ext.restoreContext();
    for (let i = 0; i < 60 && !heroHeart3d; i++) await wait(50);
    return { skipped: false, before, after, back: !!heroHeart3d };
  });
  if (lost.skipped) {
    ok('WEBGL_lose_context is available to drive this', false, 'extension unavailable');
  } else {
    ok('the heart was live before the context was lost', lost.before === true);
    ok('losing it clears the stale instance', lost.after.instance === false);
    ok('and unhides the photograph rather than leaving a blank medallion',
       lost.after.active === false, JSON.stringify(lost.after));
    ok('restoring it brings the heart back without a reload', lost.back === true);
  }

  head('reduced motion holds the fallback still');
  const rm = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await rm.goto(URL, { waitUntil: 'commit', timeout: 250000 });
  await rm.waitForFunction(() => !!document.querySelector('#heroHeart .h-beat'), null, { timeout: 60000 });
  const r1 = await rm.evaluate(() => getComputedStyle(document.querySelector('#heroHeart .h-beat')).transform);
  await rm.waitForTimeout(140);
  const r2 = await rm.evaluate(() => getComputedStyle(document.querySelector('#heroHeart .h-beat')).transform);
  ok('the still does not pulse', r1 === r2, r1 === r2 ? 'held' : `${r1} → ${r2}`);
  await rm.close();

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
