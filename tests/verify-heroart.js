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
const { launch, engineName, isEngineNoise } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-heroart.js <patched.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0, unmeasured = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
/* Neither a pass nor a failure: a claim this engine cannot weigh. Same device
   as verify-pwa's heap section — printed, counted, and named in the summary,
   so a WebKit run's smaller check count is visible rather than silent. */
const unmeasurable = (label, why) => {
  unmeasured++;
  console.log('  ----  ' + label + '  → not measurable here: ' + why);
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !isEngineNoise(m.text())) errors.push(m.text()); });
  /* Collected separately because it arrives as a WARNING, not an error, so the
     line above never sees it. Asserting against `errors` would have passed on
     a build that emits six of these — a check that cannot fail is worse than
     no check, because it reads as coverage. */
  const glWarnings = [];
  page.on('console', m => { if (/too many active webgl/i.test(m.text())) glWarnings.push(m.text()); });

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

  head('what the heart is allowed to cost');
  /* CEILINGS, NOT FLOORS. The mesh checks elsewhere in this file are floors —
     "it has a mesh", "it is drawing" — and a floor is satisfied by anything
     bigger, including a heart four times the size that stutters on the device
     it was built for. This mounts on the HOME SCREEN, on an iPad, on the
     main thread, and the numbers below are the ones it actually costs today
     with roughly twice that as the allowance:

       triangles       42,654   budget  90,000
       vertices        19,009   budget  40,000
       build           510ms chromium, 581ms webkit   budget 2,500ms

     Build time is main-thread work at mount, which is why it is bounded at all:
     a mesh that got expensive does not look slower, it delays the home screen.
     The allowance is generous on purpose — this is meant to catch a mesh that
     doubled, not to benchmark the machine, and it holds on both engines with
     four times over. */
  {
    const cost = await page.evaluate(() => {
      const h = typeof heroHeart3d !== 'undefined' ? heroHeart3d : null;
      const cv = document.getElementById('heroHeart3d');
      let buf = null;
      try {
        const gl = cv && (cv.getContext('webgl2') || cv.getContext('webgl'));
        if (gl && !gl.isContextLost()) buf = { w: gl.drawingBufferWidth, h: gl.drawingBufferHeight };
      } catch (_) {}
      return h && h.stats ? { tris: h.stats.triangles, verts: h.stats.vertices,
                              buildMs: h.stats.buildMs, buf, dpr: window.devicePixelRatio } : null;
    });
    if (!cost) {
      unmeasurable('the mesh stays inside its budget', 'no live heart to measure');
      unmeasurable('and it is built quickly enough not to hold up the home screen', 'the same');
      unmeasurable('and the drawing buffer is a medallion, not a viewport', 'the same');
    } else {
      ok('the mesh stays inside its budget',
         cost.tris <= 90000 && cost.verts <= 40000,
         `${cost.tris} triangles, ${cost.verts} vertices`);
      ok('and it is built quickly enough not to hold up the home screen',
         cost.buildMs <= 2500, `${cost.buildMs}ms`);
      /* A canvas accidentally sized to the viewport instead of to the medallion
         is the classic way a WebGL cost multiplies without the mesh changing at
         all: same triangles, twenty times the fragments. 4M covers a 3x iPad
         medallion many times over and is far under a full-screen buffer. */
      const px = cost.buf ? cost.buf.w * cost.buf.h : 0;
      ok('and the drawing buffer is a medallion, not a viewport',
         px > 0 && px <= 4000000,
         cost.buf ? `${cost.buf.w}x${cost.buf.h} = ${px} px at dpr ${cost.dpr}` : 'no buffer to read');
    }
  }

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
    /* GUARDED, BECAUSE THIS LINE WAS THE ERROR IT THEN FAILED ON. WebKit caps a
       page at sixteen WebGL contexts and does not return a slot when one is
       released, so by the time this section runs the hero's context may already
       have been evicted. Calling loseContext() on it emits
       "INVALID_OPERATION: loseContext: context already lost" — which the
       suite's own console-error check then reports as a failure of the app.
       Isolated on a blank page: removing the one unguarded call took the error
       count from 3 to 1, and all three guards tested (isContextLost alone,
       plus VERSION==null, plus getError) gave zero.

       "THE CHEAPEST IS ENOUGH" IS WHAT THIS USED TO SAY, AND IT WAS WRONG.
       isContextLost() alone still answers false for a context WebKit has
       already evicted under its sixteen-context cap, and the loseContext()
       below then emitted the very error the guard exists to prevent — three of
       them, every run, reported as a fault in the app. getParameter(VERSION)
       answers null on that same context, which is why the blank-page experiment
       found it sufficient and why it is now what is actually used. The app's
       own release in src/core/heart3d.js carries the same pair for the same
       reason. */
    if (gl.isContextLost() || gl.getParameter(gl.VERSION) == null) {
      return { skipped: true, reason: 'the context was already evicted' };
    }
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
  if (lost.skipped && lost.reason) {
    /* The context was gone before this section could take it — WebKit's cap,
       not a defect in the recovery path it was about to exercise. Failing here
       would report the app broken over the browser's bookkeeping; passing would
       claim a recovery path nobody drove. */
    unmeasurable('losing and restoring the hero\'s context', lost.reason);
  } else if (lost.skipped) {
    ok('WEBGL_lose_context is available to drive this', false, 'extension unavailable');
  } else {
    ok('the heart was live before the context was lost', lost.before === true);
    ok('losing it clears the stale instance', lost.after.instance === false);
    ok('and unhides the photograph rather than leaving a blank medallion',
       lost.after.active === false, JSON.stringify(lost.after));
    ok('restoring it brings the heart back without a reload', lost.back === true);
  }

head('a destroyed heart gives its context back');
{
  /* WHY THIS EXISTS. destroy() stopped the render loop and set a dead flag,
     and left the WebGL2 context attached to the canvas — alive until the
     canvas was collected, which no caller can schedule. Every screen change
     rebuilds the DOM, so the hero mounts onto a fresh <canvas> and the
     previous one's context outlives it. Twenty cycles left sixteen live
     contexts (the browser's cap) and six "too many active WebGL contexts on
     this page, the oldest context will be lost" warnings, which is the
     browser announcing it has begun evicting them for us.

     Chromium found this too, once it was looked for; WebKit was simply the
     browser that said so out loud, in verify-polish and verify-theme's
     console checks, on the fellow's own iPad-shaped target.

     The cycle count matters. Sixteen is the cap here, so a check that mounted
     ten would pass on a leak; twenty crosses it on every engine tried. */
  const cycles = await page.evaluate(async () => {
    const gls = [];
    let made = 0, firstLost = null, resurrected = 0;
    for (let i = 0; i < 20; i++) {
      const cv = document.createElement('canvas');
      cv.width = 64; cv.height = 64;
      document.body.appendChild(cv);
      /* onLost must NOT fire for a context we released ourselves: it exists to
         make a mount site re-create the heart, which for a destroyed instance
         resurrects exactly what the caller has just torn down. */
      const h = Heart3D.create(cv, { rhythm: 'sinus', mode: 'whole', dark: 1,
                                     resolution: [16, 20, 14], autoRotate: false,
                                     onLost: () => { resurrected++; } });
      if (!h) break;
      made++;
      gls.push(cv.getContext('webgl2'));
      h.destroy();
      cv.remove();
      if (i === 0) firstLost = gls[0].isContextLost();
      await new Promise(r => setTimeout(r, 30));
    }
    /* The event is queued, not synchronous — give the last ones a turn. */
    await new Promise(r => setTimeout(r, 200));
    return { made, firstLost, live: gls.filter(g => g && !g.isContextLost()).length, resurrected };
  });

  ok('twenty hearts could be built at all', cycles.made === 20, `${cycles.made} built`);
  ok('destroy() releases the context rather than waiting for collection',
     cycles.firstLost === true, `isContextLost() → ${cycles.firstLost}`);
  ok('and twenty mount/destroy cycles leave none of them alive',
     cycles.live === 0, `${cycles.live} still live`);
  /* CHROMIUM ONLY, AND NOT AS A CONCESSION. Measured on a BLANK PAGE with no
     Systole code at all, twenty contexts created and released one at a time:

                              WebKit      Chromium
       never released         4 warns     4 warns
       loseContext()          4 warns     0 warns
       loseContext() + 1x1    4 warns     0 warns

     Chromium returns the slot; WebKit does not. So on WebKit this warning is
     emitted no matter how diligently a page releases — no correct
     implementation can drive it to zero, and asserting it there would be
     asserting a property of the browser. The claim the APP owns is the line
     above: every context released, none left alive. That one holds on both
     engines and is where the regression would actually show. */
  if (engineName() === 'chromium') {
    ok('no "too many active WebGL contexts" warning across the cycles',
       glWarnings.length === 0, `${glWarnings.length} warning(s)`);
  } else {
    unmeasurable('the browser\'s own context-cap warning',
                 `${engineName()} emits it however the page releases — see the table above`);
  }
  /* The guard that stops the fix eating its own tail. */
  ok('a deliberate release is not reported as a lost context',
     cycles.resurrected === 0, `onLost fired ${cycles.resurrected} time(s)`);
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
  console.log(`\n${passed} passed, ${failed} failed`
            + (unmeasured ? `, ${unmeasured} not measurable on ${engineName()}` : ''));
  process.exit(failed ? 1 : 0);
})();
