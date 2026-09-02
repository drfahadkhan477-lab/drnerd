#!/usr/bin/env node
/*
 * Checks for the 12-lead.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-leads.js <patched.html|url>
 *
 * These assert the MORPHOLOGY, not the plumbing. The whole claim of the module
 * is that the twelve leads are derived from one dipole rather than drawn, so
 * the test of it is whether the patterns a fellow is examined on come out of
 * the geometry: aVR inverted, R-wave progression, the septal q, rSR' in V1 for
 * RBBB, a broad R with the q abolished in V6 for LBBB, reciprocal change in
 * both STEMIs, and diffuse elevation with PR depression in pericarditis.
 *
 * If someone later "improves" a vector and quietly breaks the transition zone,
 * this is what says so.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-leads.js <patched.html|url>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 1200 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });

  /* Measure inside the second beat, clear of the strip's leading edge. */
  const M = await page.evaluate(() => {
    const RR = hr => 60000 / hr;
    const win = (id, kind, hr, a, b, pick) => {
      let mx = -9, mn = 9, sum = 0, n = 0;
      for (let t = RR(hr) + a; t < RR(hr) + b; t += 1) {
        const v = Leads12.sample(id, t, kind, hr);
        if (v > mx) mx = v; if (v < mn) mn = v; sum += v; n++;
      }
      return pick === 'mean' ? sum / n : { max: mx, min: mn, net: mx + mn };
    };
    const qrs = (id, kind, hr) => win(id, kind, hr || 68, -70, 90);
    const stSeg = (id, kind, hr) => win(id, kind, hr || 68, 60, 200, 'mean');
    const prSeg = (id, kind, hr) => win(id, kind, hr || 68, -88, -45, 'mean');
    const turns = (id, kind) => {
      const pts = []; for (let t = RR(68) - 70; t < RR(68) + 140; t += 2) pts.push(Leads12.sample(id, t, kind, 68));
      const seq = []; let last = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i - 1], b = pts[i], c = pts[i + 1];
        if ((b > a && b >= c && b > 0.12) || (b < a && b <= c && b < -0.12)) {
          if (Math.sign(b) !== Math.sign(last) || Math.abs(b - last) > 0.25) { seq.push(+b.toFixed(2)); last = b; }
        }
      }
      return seq;
    };
    return {
      leadCount: Leads12.LEADS.length,
      limbNet: ['I', 'II', 'III', 'aVR', 'aVL', 'aVF'].map(id => [id, +qrs(id, 'sinus').net.toFixed(2)]),
      precordNet: ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'].map(id => [id, +qrs(id, 'sinus').net.toFixed(2)]),
      /* R/S ratio is the clinical definition of the transition zone, and the
         only one that is stable — "net deflection" flips on a hundredth of a
         millivolt at the very lead where R and S are by definition equal. */
      precordRS: ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'].map(id => {
        const w = qrs(id, 'sinus');
        return [id, +(w.max / Math.abs(w.min || 1e-6)).toFixed(2)];
      }),
      septalQ: ['I', 'aVL', 'V5', 'V6'].map(id => [id, +qrs(id, 'sinus').min.toFixed(2)]),
      v1Sinus: turns('V1', 'sinus'),
      v1Rbbb: turns('V1', 'rbbb'),
      v6Sinus: turns('V6', 'sinus'),
      v6Lbbb: turns('V6', 'lbbb'),
      v6LbbbQ: +qrs('V6', 'lbbb').min.toFixed(2),
      stAnt: ['V2', 'V3', 'V4'].map(id => [id, +stSeg(id, 'stemi_ant').toFixed(2)]),
      stAntRecip: ['II', 'III', 'aVF'].map(id => [id, +stSeg(id, 'stemi_ant').toFixed(2)]),
      stInf: ['II', 'III', 'aVF'].map(id => [id, +stSeg(id, 'stemi_inf').toFixed(2)]),
      stInfRecip: +stSeg('aVL', 'stemi_inf').toFixed(2),
      periST: ['I', 'II', 'V5', 'V6'].map(id => [id, +stSeg(id, 'pericarditis', 88).toFixed(2)]),
      periAvr: +stSeg('aVR', 'pericarditis', 88).toFixed(2),
      periPR: +prSeg('II', 'pericarditis', 88).toFixed(3),
      periPRavr: +prSeg('aVR', 'pericarditis', 88).toFixed(3),
    };
  });

  head('the geometry, on a normal tracing');
  ok('all twelve leads defined', M.leadCount === 12, String(M.leadCount));
  const byId = Object.fromEntries(M.limbNet);
  ok('II is the tallest limb lead — it lies closest to the mean QRS axis',
     byId.II >= byId.I && byId.II >= byId.III && byId.II >= byId.aVF,
     M.limbNet.map(([a, b]) => `${a} ${b}`).join('  '));
  ok('aVR is the only limb lead that is net negative',
     byId.aVR < 0 && M.limbNet.filter(([, v]) => v < 0).length === 1, `aVR ${byId.aVR}`);
  const pre = M.precordNet.map(([, v]) => v);
  ok('R-wave progression: V1 deeply negative, V6 strongly positive',
     pre[0] < -0.4 && pre[5] > 0.6, M.precordNet.map(([a, b]) => `${a} ${b}`).join('  '));
  ok('it progresses monotonically, no reversals',
     pre.every((v, i) => i === 0 || v >= pre[i - 1] - 0.02));
  const transition = M.precordRS.findIndex(([, r]) => r >= 1);
  /* Deliberately tight: V3 or V4. Allowing V5 too would let a clockwise-rotation
     tracing pass under a label that says normal. */
  ok('the transition zone falls at V3–V4', transition === 2 || transition === 3,
     `R/S reaches 1 at V${transition + 1} — ` + M.precordRS.map(([a, b]) => `${a} ${b}`).join('  '));
  ok('a septal q is present in I, aVL, V5 and V6',
     M.septalQ.every(([, v]) => v < -0.05), M.septalQ.map(([a, b]) => `${a} ${b}`).join('  '));

  head('conduction disease falls out of the vectors');
  ok('V1 is rS in sinus', M.v1Sinus.length === 2 && M.v1Sinus[0] > 0 && M.v1Sinus[1] < 0,
     JSON.stringify(M.v1Sinus));
  ok('V1 becomes rSR′ in RBBB — a third, terminal, positive deflection',
     M.v1Rbbb.length === 3 && M.v1Rbbb[2] > 0.2, JSON.stringify(M.v1Rbbb));
  ok('V6 is qR in sinus', M.v6Sinus.length === 2 && M.v6Sinus[0] < 0 && M.v6Sinus[1] > 0,
     JSON.stringify(M.v6Sinus));
  ok('LBBB abolishes the septal q in V6', M.v6LbbbQ > -0.05, `q = ${M.v6LbbbQ}`);
  ok('and leaves a single broad R there', M.v6Lbbb.length === 1 && M.v6Lbbb[0] > 0.6,
     JSON.stringify(M.v6Lbbb));

  head('injury patterns, with their reciprocals');
  ok('anterior STEMI elevates V2–V4', M.stAnt.every(([, v]) => v > 0.2),
     M.stAnt.map(([a, b]) => `${a} ${b}`).join('  '));
  ok('with reciprocal depression inferiorly', M.stAntRecip.every(([, v]) => v < 0.02),
     M.stAntRecip.map(([a, b]) => `${a} ${b}`).join('  '));
  ok('inferior STEMI elevates II, III and aVF', M.stInf.every(([, v]) => v > 0.2),
     M.stInf.map(([a, b]) => `${a} ${b}`).join('  '));
  ok('with reciprocal depression in aVL', M.stInfRecip < -0.05, String(M.stInfRecip));
  ok('pericarditis elevates diffusely, across territories',
     M.periST.every(([, v]) => v > 0.1), M.periST.map(([a, b]) => `${a} ${b}`).join('  '));
  ok('with aVR depressed instead — the pair that separates it from STEMI',
     M.periAvr < -0.1, String(M.periAvr));
  ok('and PR depression, reversed in aVR',
     M.periPR < -0.03 && M.periPRavr > 0.03, `II ${M.periPR}  aVR ${M.periPRavr}`);

  head('in the app');
  await page.evaluate(() => { goLab(); render(); });
  await page.waitForTimeout(1600);
  const ui = await page.evaluate(() => ({
    panel: !!document.querySelector('.twelve-panel'),
    canvas: !!document.getElementById('twelveCanvas'),
    live: !!twelve,
    layout: typeof ECG12 !== 'undefined' ? ECG12.LAYOUT.map(r => r.join(',')) : null,
  }));
  ok('the panel is mounted with a live renderer', ui.panel && ui.canvas && ui.live, JSON.stringify(ui));
  ok('it uses the standard printed layout',
     ui.layout && ui.layout.join(' | ') === 'I,aVR,V1,V4 | II,aVL,V2,V5 | III,aVF,V3,V6',
     (ui.layout || []).join(' | '));

  const tap = await page.evaluate(() => {
    twelve.select('V1');
    const card = leadCardHtml('V1');
    return { sel: twelve.selected(), hasArtery: /LAD/.test(card), hasTeaching: /rSR/.test(card) };
  });
  ok('tapping a lead selects it', tap.sel === 'V1');
  ok('and the card names the artery and what to look for',
     tap.hasArtery && tap.hasTeaching, JSON.stringify(tap));

  const unmodelled = await page.evaluate(() => {
    setLab('vt');
    const html = document.body.innerHTML;
    return { none: html.includes('twelve-none'), canvas: !!document.getElementById('twelveCanvas') };
  });
  ok('an unmodelled rhythm says so instead of drawing normal morphology under its name',
     unmodelled.none && !unmodelled.canvas, JSON.stringify(unmodelled));

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 2).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
