#!/usr/bin/env node
/*
 * Checks for the scanned heart and the crystal style.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-scan.js <patched.html|url>
 *
 * The claim worth testing is not "a mesh loads". Any renderer can show a mesh.
 * It is that the scan is baked into THIS app's anatomy and therefore beats on
 * the same cardiac clock — which means its chamber weights must be real, its
 * activation times must sweep apex to base, and the geometry must actually move
 * between systole and diastole rather than sitting still under a texture.
 *
 * The licence check is not decoration either. The asset is CC-BY: displaying
 * the credit is the condition of using it, so a build that quietly drops it is
 * a licensing failure, not a cosmetic one.
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-scan.js <patched.html|url>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 940, height: 1150 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 150000 });
  await page.evaluate(() => { goLab(); render(); });
  await page.waitForTimeout(1800);

  head('the asset, and its anatomy');
  const asset = await page.evaluate(() => {
    const m = JSON.parse(HEART_SCAN.manifest);
    return { verts: m.vertexCount, tris: m.indexCount / 3, credit: m.credit, fit: m.fit };
  });
  ok('the scan is present and a sane size', asset.verts > 5000 && asset.tris > 8000,
     `${asset.verts} verts, ${asset.tris} triangles`);
  ok('it carries a licence', /CC-BY/i.test(asset.credit.license || ''), asset.credit.license);
  ok('and an author to attribute', !!asset.credit.author, asset.credit.author);

  /* Chamber weights and activation are baked from this app's own SDFs. If the
     bake were wrong — a bad transform, a mis-set scale — the weights would be
     uniform or empty, and the mesh would deform as one lump or not at all. */
  const bake = await page.evaluate(async () => {
    const bin = await (await fetch(HEART_SCAN.bin)).arrayBuffer();
    const man = JSON.parse(HEART_SCAN.manifest), L = man.layout;
    const pos = new Float32Array(bin, L.pos.byteOffset, L.pos.byteLength / 4);
    const w = new Uint8Array(bin, L.w.byteOffset, L.w.byteLength);
    const act = new Uint16Array(bin, L.act.byteOffset, L.act.byteLength / 2);
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) {
      if (pos[i + k] < lo[k]) lo[k] = pos[i + k];
      if (pos[i + k] > hi[k]) hi[k] = pos[i + k];
    }
    const n = act.length;
    let anyLV = 0, anyRV = 0, anyLA = 0, anyRA = 0, dead = 0;
    for (let i = 0; i < n; i++) {
      const a = w[i*4], b = w[i*4+1], c = w[i*4+2], d = w[i*4+3];
      if (a > 128) anyLV++; if (b > 128) anyRV++; if (c > 128) anyLA++; if (d > 128) anyRA++;
      if (a + b + c + d < 8) dead++;
    }
    /* Activation should rise from apex toward base — but only across the
       VENTRICLES. The atria depolarise at 6-40ms, far earlier than any
       ventricular vertex, so including them in a "base" band by height alone
       drags its mean below the apex and inverts the comparison. */
    let apexAct = 0, apexN = 0, baseAct = 0, baseN = 0;
    for (let i = 0; i < n; i++) {
      const ventricular = (w[i*4] + w[i*4+1]) > (w[i*4+2] + w[i*4+3]);
      if (!ventricular) continue;
      const y = pos[i * 3 + 1];
      if (y < lo[1] + 1.5) { apexAct += act[i]; apexN++; }
      if (y > 1.0 && y < 3.0) { baseAct += act[i]; baseN++; }
    }
    return { lo, hi, anyLV, anyRV, anyLA, anyRA, dead, n,
             apex: apexN ? apexAct / apexN : 0, base: baseN ? baseAct / baseN : 0 };
  });
  ok('it was fitted into the app\'s coordinate frame',
     bake.lo[1] < -4 && bake.hi[1] > 5 && (bake.hi[0] - bake.lo[0]) > 6,
     `y ${bake.lo[1].toFixed(1)}..${bake.hi[1].toFixed(1)}, width ${(bake.hi[0]-bake.lo[0]).toFixed(1)}`);
  ok('every chamber claims part of the mesh',
     bake.anyLV > 200 && bake.anyRV > 200 && bake.anyLA > 100 && bake.anyRA > 100,
     `LV ${bake.anyLV}  RV ${bake.anyRV}  LA ${bake.anyLA}  RA ${bake.anyRA}`);
  ok('almost no vertex is left unassigned', bake.dead / bake.n < 0.05,
     `${((bake.dead / bake.n) * 100).toFixed(1)}% unweighted`);
  ok('activation sweeps apex before base, as it does in life',
     bake.apex > 0 && bake.base > bake.apex,
     `apex ${bake.apex.toFixed(0)}ms → base ${bake.base.toFixed(0)}ms`);

  head('it beats');
  await page.evaluate(() => setHeartModel('scan'));
  await page.waitForFunction(() => labHeart && labHeart.hasScan(), { timeout: 90000 });
  await page.waitForTimeout(1500);
  const live = await page.evaluate(() => ({ model: labHeart.model(), hasScan: labHeart.hasScan() }));
  ok('the scan is the live model', live.model === 'scan' && live.hasScan);

  /* A mesh that is merely textured and static gives an identical frame every
     time; one deforming on the cardiac cycle does not.

     Sampled from SCREENSHOTS, not from the canvas in the page: a WebGL drawing
     buffer without preserveDrawingBuffer is cleared once composited, so an
     in-page drawImage of it reads back empty and every frame would look
     identical — which would fail this check for the one reason that has nothing
     to do with whether the mesh moves. */
  await page.evaluate(() => { labHeart.setRhythm('sinus'); labHeart.setAutoRotate && labHeart.setAutoRotate(false); });
  const shots = [];
  for (let i = 0; i < 7; i++) {
    shots.push(await page.locator('#labHeartCanvas').screenshot());
    await page.waitForTimeout(115);
  }
  const motion = await page.evaluate(async urls => {
    const load = async u => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = u; });
      const off = document.createElement('canvas');
      off.width = 140; off.height = 140;
      const g = off.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, 140, 140);
      return g.getImageData(0, 0, 140, 140).data;
    };
    const frames = [];
    for (const u of urls) frames.push(await load(u));
    const diff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]); return d / (a.length / 4); };
    let maxD = 0;
    for (let i = 1; i < frames.length; i++) maxD = Math.max(maxD, diff(frames[0], frames[i]));
    return { maxD };
  }, shots.map(b => 'data:image/png;base64,' + b.toString('base64')));
  ok('the geometry moves across the cardiac cycle', motion.maxD > 0.5,
     `peak per-pixel change ${motion.maxD.toFixed(2)}`);

  head('attribution is on screen, because the licence requires it');
  const credit = await page.evaluate(() => {
    const el = document.getElementById('scanCredit');
    return { text: el ? el.textContent.trim() : '', shown: el ? el.classList.contains('on') : false,
             link: el ? !!el.querySelector('a') : false };
  });
  ok('the credit is displayed while the scan is showing', credit.shown && credit.text.length > 10, credit.text.slice(0, 70));
  ok('it names the author', /neshallads/i.test(credit.text));
  ok('it names the licence', /CC-BY/i.test(credit.text));
  ok('and links to the source', credit.link);

  const hidden = await page.evaluate(() => {
    setHeartModel('procedural');
    const el = document.getElementById('scanCredit');
    return { model: labHeart.model(), shown: el.classList.contains('on') };
  });
  ok('switching back returns to the procedural model', hidden.model === 'procedural');
  ok('and the credit is withdrawn with it', hidden.shown === false);

  head('the crystal style');
  const styles = await page.evaluate(async () => {
    const seen = [];
    for (let i = 0; i < 3; i++) {
      document.querySelector('[data-heart-style]').click();
      await new Promise(r => setTimeout(r, 250));
      seen.push(labHeartStyle);
    }
    return seen;
  });
  ok('the style switch cycles anatomic → engraved → crystal → anatomic',
     styles.join(',') === 'ink,crystal,anatomic', styles.join(' → '));

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 2).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
