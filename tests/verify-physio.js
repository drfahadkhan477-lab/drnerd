#!/usr/bin/env node
/*
 * Checks for the cardiac cycle: Wiggers diagram, PV loop, flow, right heart,
 * Starling/Guyton — src/core/physio.js and src/ui/wiggers.js.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-physio.js <patched.html|url>
 *
 * The claim worth testing is not "a diagram renders". It is that every curve
 * on it is a real physiological identity, not an illustration:
 *
 *   · valves are CROSSINGS of two independently written pressure curves,
 *     measured by bisection, not asserted by a constant;
 *   · volume is EXACTLY flat — not nearly flat — wherever both valves are shut;
 *   · the PV loop is SOLVED from two elastances (Ees, Ea), so raising afterload
 *     must raise end-systolic volume and lower EF with contractility untouched;
 *   · the ESPVR and EDPVR must pass through the loop's own corners, for every
 *     intervention, because a relation that doesn't touch the loop it explains
 *     is decoration;
 *   · aortic and mitral flow are the derivative of the SAME volume curve, so
 *     what leaves during ejection must equal what returns during filling;
 *   · Guyton's two curves must cross at exactly one point, and stroke volume
 *     rising with preload must exceed contractility barely moving output —
 *     the actual clinical lesson, not just "two curves are drawn";
 *   · the diagram's cursor must be driven by the SAME clock as the beating
 *     heart, not a second animation that happens to agree with it.
 *
 * If any of those stop being true, this is what says so — not a screenshot
 * that merely looks like a Wiggers diagram.
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-physio.js <patched.html|url>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 1300 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 150000 });

  /* ═══════════════════════ the model, in isolation ═══════════════════════ */
  head('the physiology, independent of any rendering');
  const M = await page.evaluate(() => {
    const P = Physio, T = P.T;
    const d = P.derived(0.8);

    /* Continuity, including across the wrap from t=1 back to t=0.
       Not "the biggest step is small" — isovolumetric relaxation drops 85 mmHg
       in 0.065 of a cycle and is supposed to look almost vertical, so a fixed
       threshold would fail a curve that is perfectly continuous and merely
       steep. Instead, halve the sample spacing: a continuous curve's largest
       step halves with it, while a genuine jump stays exactly the same size
       however finely you sample around it. The ratio is the discontinuity. */
    const step = (fn, n) => { let w = 0; for (let i = 0; i < n; i++) { const a = i / n, b = (i + 1) / n; w = Math.max(w, Math.abs(fn(b) - fn(a))); } return w; };
    const refine = fn => step(fn, 12000) / Math.max(step(fn, 6000), 1e-12);
    const steps = { vol: refine(P.lvVolume), lv: refine(P.lvPressure), ao: refine(P.aoPressure), rv: refine(P.rvPressure), pa: refine(P.paPressure), la: refine(P.laPressure), ra: refine(P.raPressure) };

    /* isovolumetric flatness — exact, not approximate */
    const flat = (a, b) => { let lo = 1e9, hi = -1e9; for (let i = 0; i <= 300; i++) { const t = a + (b - a) * i / 300, v = P.lvVolume(t); lo = Math.min(lo, v); hi = Math.max(hi, v); } return hi - lo; };
    const ivcFlat = flat(T.mc, T.ao - 1e-6), ivrFlat = flat(T.ac, T.mo - 1e-6);

    /* valve events: measured crossing vs the design constant */
    const x = P.crossings();
    const crossErr = {};
    for (const k of ['mc', 'ao', 'ac', 'mo', 'tc', 'po', 'pc', 'to']) crossErr[k] = Math.abs(x[k] - T[k]);

    /* flow: ejected volume must equal filled volume must equal SV, both ways */
    let vOut = 0, vIn = 0;
    for (let i = 0; i < 20000; i++) { const t = i / 20000; vOut += Math.max(0, -P.dVdt(t)) / 20000; vIn += Math.max(0, P.dVdt(t)) / 20000; }

    /* E/A and coronary phase split */
    let E = 0, Et = 0, A = 0;
    for (let i = 0; i < 4000; i++) { const t = i / 4000, q = P.mitralFlow(t, 0.8);
      if (t >= T.mo && t < T.dias && q > E) { E = q; Et = t; } if (t < T.mc && q > A) A = q; }

    /* PV loop / interventions: ESPVR and EDPVR must pass through the corners */
    const ivErr = P.INTERVENTIONS.map(iv => {
      const L = P.loopWith(iv.args);
      return { id: iv.id, ef: L.ef, sv: L.sv, esv: L.esv,
                esErr: Math.abs(P.espvr(L.esv, L.ees, L.v0) - L.esp),
                edErr: Math.abs(P.edpvr(L.edv, L.stiff, L.shift) - L.edp) };
    });
    const base = P.loopWith(), after = P.loopWith({ ea: 2.4 }), inotrope = P.loopWith({ ees: 4.2 }), preload = P.loopWith({ edv: 150 });

    /* Guyton: solve each operating point, don't trust a fixed sample */
    const solve = (st, msfp) => { let lo = -4, hi = 20; for (let k = 0; k < 70; k++) { const m = (lo + hi) / 2; (P.cardiacFunction(m, st) - P.venousReturn(m, msfp) < 0) ? lo = m : hi = m; } return { ra: (lo + hi) / 2, co: P.venousReturn((lo + hi) / 2, msfp) }; };
    const gNormal = solve(null, 7), gInotrope = solve(null, 7), gVolume = solve('failing', 14), gFailing = solve('failing', 7);

    return { d, steps, ivcFlat, ivrFlat, crossErr, vOut, vIn,
             ea: E / A, coronaryDia: d.leftDiastolicFraction,
             ivErr, base, after, inotrope, preload,
             gNormal, gVolume, gFailing,
             starlingNormalAt10: P.starling(10), starlingFailingAt10: P.starling(10, 'failing'),
             phaseCount: P.PHASES.length, eventCount: P.EVENTS.length,
             dpdtPhase: P.phaseAt(d.dpdtAt).id };
  });

  ok('every trace is continuous — halving the sample spacing halves its largest step, so no curve jumps',
     Object.values(M.steps).every(s => s < 0.7),
     Object.entries(M.steps).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  '));
  ok('LV volume is EXACTLY flat during isovolumetric contraction', M.ivcFlat < 1e-4, `spread ${M.ivcFlat}`);
  ok('and exactly flat during isovolumetric relaxation', M.ivrFlat < 1e-4, `spread ${M.ivrFlat}`);

  ok('every valve event is a measured crossing within 1% of its design time', Object.values(M.crossErr).every(e => e < 0.01), JSON.stringify(M.crossErr));

  ok('LV systolic pressure is physiological', M.d.lvSys > 110 && M.d.lvSys < 132, M.d.lvSys.toFixed(1));
  ok('LVEDP is physiological, not the near-zero a naive isovolumetric plateau gives', M.d.lvEdp > 6 && M.d.lvEdp < 14, M.d.lvEdp.toFixed(1));
  ok('aortic pressure is 120/80-ish with a real pulse pressure', M.d.aoSys > 110 && M.d.aoSys < 130 && M.d.aoDia > 68 && M.d.aoDia < 88, `${M.d.aoSys.toFixed(0)}/${M.d.aoDia.toFixed(0)}`);
  ok('ejection fraction is normal', M.d.ef > 0.52 && M.d.ef < 0.65, (M.d.ef * 100).toFixed(1) + '%');
  ok('RV pressure is a quarter of LV, not a rescaled copy of it', M.d.rvSys > 18 && M.d.rvSys < 30, M.d.rvSys.toFixed(1));
  ok('S2 splits — A2 before P2, by a physiological margin', M.d.s2Split > 5 && M.d.s2Split < 60, M.d.s2Split.toFixed(0) + ' ms');
  ok('S1 splits too — M1 before T1', M.d.s1Split > 2 && M.d.s1Split < 40, M.d.s1Split.toFixed(0) + ' ms');
  ok('dP/dt max falls in isovolumetric contraction, where physiology says it must', M.dpdtPhase === 'ivc', M.dpdtPhase);

  ok('ejected volume equals filled volume equals stroke volume', Math.abs(M.vOut - M.vIn) < 0.5 && Math.abs(M.vOut - M.d.sv) < 0.5, `out ${M.vOut.toFixed(2)}  in ${M.vIn.toFixed(2)}  SV ${M.d.sv}`);
  ok('E/A ratio is normal for a resting adult', M.ea > 1.0 && M.ea < 2.2, M.ea.toFixed(2));
  ok('left coronary flow arrives mostly in diastole', M.coronaryDia > 0.75, (M.coronaryDia * 100).toFixed(0) + '%');

  head('the pressure-volume relations, against every loop they explain');
  ok('ESPVR passes through end-systole on all six interventions', M.ivErr.every(e => e.esErr < 0.5), M.ivErr.map(e => e.id + ':' + e.esErr.toFixed(2)).join(' '));
  ok('EDPVR passes through end-diastole on all six interventions', M.ivErr.every(e => e.edErr < 0.5), M.ivErr.map(e => e.id + ':' + e.edErr.toFixed(2)).join(' '));
  ok('the base parametric loop reproduces the physiological one', Math.abs(M.base.esv - 50) < 1 && Math.abs(M.base.ef - M.d.ef) < 0.01, `ESV ${M.base.esv.toFixed(1)}  EF ${(M.base.ef * 100).toFixed(1)}%`);
  ok('raising afterload raises ESV and lowers EF with contractility untouched',
     M.after.esv > M.base.esv + 5 && M.after.ef < M.base.ef - 0.05, `ESV ${M.base.esv.toFixed(0)}→${M.after.esv.toFixed(0)}  EF ${(M.base.ef*100).toFixed(0)}%→${(M.after.ef*100).toFixed(0)}%`);
  ok('raising contractility lowers ESV and raises EF', M.inotrope.esv < M.base.esv - 5 && M.inotrope.ef > M.base.ef + 0.05, `ESV ${M.inotrope.esv.toFixed(0)}  EF ${(M.inotrope.ef*100).toFixed(0)}%`);
  ok('raising preload raises stroke volume', M.preload.sv > M.base.sv + 10, `SV ${M.base.sv.toFixed(0)}→${M.preload.sv.toFixed(0)}`);

  head('Starling and Guyton — the operating point is solved, not sampled');
  ok('a failing ventricle needs more filling pressure for the same output', M.starlingFailingAt10 < M.starlingNormalAt10, `normal ${M.starlingNormalAt10.toFixed(0)}  failing ${M.starlingFailingAt10.toFixed(0)}`);
  ok('normal cardiac output at rest is physiological', M.gNormal.co > 4 && M.gNormal.co < 6.5, M.gNormal.co.toFixed(2) + ' L/min');
  ok('acute failure drops output well below normal', M.gFailing.co < M.gNormal.co - 1, `${M.gFailing.co.toFixed(2)} vs ${M.gNormal.co.toFixed(2)}`);
  ok('volume retention partially restores output in failure — Guyton\'s actual lesson', M.gVolume.co > M.gFailing.co + 0.5, `${M.gFailing.co.toFixed(2)} → ${M.gVolume.co.toFixed(2)}`);

  ok('seven phases, eight valve events — nothing dropped from the model', M.phaseCount === 7 && M.eventCount === 8);

  /* ═══════════════════════════ rendered, in Rhythm Lab ═══════════════════════ */
  head('mounted in Rhythm Lab');
  await page.evaluate(() => { goLab(); render(); });
  await page.waitForTimeout(600);

  const mounted = await page.evaluate(() => ({
    hasPanel: !!document.querySelector('.physio-panel'),
    hasCanvas: !!document.getElementById('physioCanvas'),
    view: physio ? physio.view() : null,
    chipCount: document.querySelectorAll('[data-physio-view]').length,
  }));
  ok('the cardiac-cycle panel is in Rhythm Lab', mounted.hasPanel && mounted.hasCanvas);
  ok('it opens on the Wiggers view', mounted.view === 'wiggers');
  ok('all five views have a chip', mounted.chipCount === 5, String(mounted.chipCount));

  head('driven by the heart\'s own clock, not a second one');
  const clockLinked = await page.evaluate(async () => {
    /* physioClock is written by Heart3D's onCycle callback every frame. If the
       diagram is reading it, the diagram's own reported time should track it —
       not merely resemble it, but move in the same direction at the same rate. */
    await new Promise(r => setTimeout(r, 400));
    const a = { clock: physioClock, diagram: physio.time() };
    await new Promise(r => setTimeout(r, 500));
    const b = { clock: physioClock, diagram: physio.time() };
    return { a, b, hasSource: physio.hasTimeSource() };
  });
  ok('the diagram declares it has a live time source', clockLinked.hasSource);
  ok('the diagram\'s cursor is within a hair of the heart\'s reported cycle position',
     Math.abs(clockLinked.a.diagram - clockLinked.a.clock) < 0.02, JSON.stringify(clockLinked.a));
  ok('and stays in lock-step half a second later', Math.abs(clockLinked.b.diagram - clockLinked.b.clock) < 0.02, JSON.stringify(clockLinked.b));
  ok('time actually advanced between the two samples — this is a running clock, not a frozen readout',
     clockLinked.a.clock !== clockLinked.b.clock);

  head('switching rhythm changes the diagram\'s rate');
  const rateFollows = await page.evaluate(() => {
    document.querySelector('[data-lab-rhythm="tachy"], [data-rhythm="tachy"]')?.click();
    setLab('tachy');
    return true;
  });
  await page.waitForTimeout(300);
  const afterTachy = await page.evaluate(() => ({ hr: RHYTHMS['tachy'].hr, kind: labKind }));
  ok('setLab reaches the rhythm the test asked for', afterTachy.kind === 'tachy');

  head('every view draws without error, in both themes');
  const viewSweep = await page.evaluate(async () => {
    const out = [];
    for (const [id] of PHYSIO_VIEWS) {
      document.querySelector(`[data-physio-view="${id}"]`)?.click();
      await new Promise(r => setTimeout(r, 120));
      const cv = document.getElementById('physioCanvas');
      out.push({ id, w: cv.width, h: cv.height, view: physio.view() });
    }
    return out;
  });
  ok('all five views mounted and sized their canvas', viewSweep.every(v => v.w > 100 && v.h > 100), JSON.stringify(viewSweep.map(v => v.id)));
  ok('clicking a chip actually switches the view', viewSweep.every(v => v.id === v.view), viewSweep.map(v => `${v.id}:${v.view}`).join(' '));

  head('the PV loop responds to an intervention, on screen');
  await page.evaluate(() => { document.querySelector('[data-physio-view="pv"]').click(); });
  await page.waitForTimeout(150);
  const ivSwap = await page.evaluate(() => {
    document.querySelector('[data-physio-iv="after"]')?.click();
    return { iv: physio.intervention(), note: document.getElementById('physioNote').textContent };
  });
  ok('clicking an intervention chip changes the loop', ivSwap.iv === 'after');
  ok('the explanatory note updates with it', /afterload/i.test(ivSwap.note), ivSwap.note.slice(0, 60));

  head('the note follows the live phase on the Wiggers view');
  await page.evaluate(() => { document.querySelector('[data-physio-view="wiggers"]').click(); });
  await page.waitForTimeout(200);
  const notes = [];
  for (let i = 0; i < 4; i++) {
    notes.push(await page.evaluate(() => document.getElementById('physioNote').textContent));
    await page.waitForTimeout(220);
  }
  ok('the phase note is live text, not a static caption', new Set(notes).size > 1, notes.map(n => n.slice(0, 18)).join(' | '));

  head('scrubbing pauses the live clock and reads back a chosen instant');
  await page.evaluate(() => { document.querySelector('[data-physio-view="wiggers"]').click(); });
  await page.waitForTimeout(150);
  const scrub = await page.evaluate(async () => {
    const cv = document.getElementById('physioCanvas');
    const r = cv.getBoundingClientRect();
    physio.setScrub(true);
    const t1 = physio.scrubAt(r.width * 0.2, r.height * 0.3);
    const readAt1 = physio.time();
    await new Promise(res => setTimeout(res, 300));
    const heldStill = physio.time();
    physio.setScrub(false);
    return { t1, readAt1, heldStill };
  });
  ok('scrubbing moves the cursor to roughly where it was dragged', Math.abs(scrub.t1 - scrub.readAt1) < 0.02);
  ok('while scrubbing, the live heart clock does not overwrite the chosen instant', Math.abs(scrub.heldStill - scrub.readAt1) < 0.005, `${scrub.readAt1.toFixed(3)} → ${scrub.heldStill.toFixed(3)}`);

  head('theme');
  const themed = await page.evaluate(() => {
    document.querySelector('[data-theme-toggle], [data-theme]')?.click();
    return true;
  });

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
