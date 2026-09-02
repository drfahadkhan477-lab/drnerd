#!/usr/bin/env node
/*
 * The cardiac cycle's physics, in bare Node — no browser, no build.
 *
 *   node tests/verify-physio-pure.js
 *
 * WHY THIS EXISTS SEPARATELY FROM verify-physio.js. src/core/physio.js is
 * pure arithmetic over a normalised cycle: it takes a time and returns
 * pressures, volumes and flows. Nothing in it needs a DOM. But its existing
 * suite drives the rendered cardiac-cycle screen through Playwright, so it
 * needs the built file — and the built file needs the licensed ACCSAP export,
 * which CI deliberately does not have. The result is that the most
 * mathematically load-bearing module in the project is one of the ones CI
 * cannot check at all.
 *
 * docs/BUILD.md already states the design that makes this fixable: "Modules
 * are plain IIFEs that export onto window, so they can be required and tested
 * in bare Node without a bundler or a browser. That is not an accident of
 * style; it is what makes the numeric verification above possible."
 * verify-fsrs.js and verify-worker.js already take that route. This does too.
 *
 * PROPERTIES, NOT REMEMBERED NUMBERS. Every check here is a statement about
 * how a heart must behave — a valve opens when the pressure gradient reverses,
 * an isovolumetric phase does not change volume — rather than a snapshot of
 * what the curve happened to return on the day it was written. A snapshot test
 * fails when a constant is retuned; a property test fails when the physiology
 * is wrong, which is the only failure worth waking up for.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const mod = {};
new Function('module', 'exports', fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'physio.js'), 'utf8'))
  .call(mod, { exports: mod }, mod);
const P = mod.Physio;

const N = 2000;
const at = i => P.sample(i / N);
const series = Array.from({ length: N }, (_, i) => at(i));

head('the module loads and answers without a DOM');
ok('Physio is exported from a bare require', !!P && typeof P.sample === 'function');
ok('a sample carries every trace the screen draws',
   ['lvP', 'aoP', 'laP', 'lvV', 'rvP', 'paP', 'raP', 'qAo', 'qMi'].every(k => k in series[0]));
ok('every sample across the cycle is finite — no NaN anywhere in the curve',
   series.every(s => Object.values(s).every(v => typeof v !== 'number' || Number.isFinite(v))));

head('valve events are real pressure crossings, not decorations on a timeline');
/* The claim: at each valve event the gradient that drives that valve has just
   reversed. This is what makes the diagram teachable — if the label and the
   curve disagree, the picture teaches the wrong thing. */
const near = (t, d) => P.sample((t + d + 1) % 1);
const crossing = (id, hi, lo) => {
  const ev = P.EVENTS.find(e => e.id === id);
  if (!ev) return null;
  const before = near(ev.at, -0.012), after = near(ev.at, +0.012);
  return { before: before[hi] - before[lo], after: after[hi] - after[lo] };
};
/* The aortic pair is asserted as >= 0 on the open side, not > 0, and that is
   the physiology rather than a loosened bound: across an open, unstenosed
   aortic valve the ventricle and the aorta are one chamber, so the gradient
   during ejection is zero. A model that showed LV pressure exceeding aortic
   while the valve was open would be drawing aortic stenosis. Measured: the
   difference is exactly 0.000 through ejection, which is the model getting
   this right. */
const ao = crossing('ao', 'lvP', 'aoP');
ok('aortic valve opens as LV pressure stops trailing aortic',
   ao && ao.before < 0 && ao.after >= 0, JSON.stringify(ao));
const ac = crossing('ac', 'lvP', 'aoP');
ok('and closes as it falls back below', ac && ac.before >= 0 && ac.after < 0, JSON.stringify(ac));
ok('no gradient across the open aortic valve — this heart has no stenosis',
   Math.abs(P.sample((P.T.ao + P.T.ac) / 2).lvP - P.sample((P.T.ao + P.T.ac) / 2).aoP) < 0.001,
   `${(P.sample((P.T.ao + P.T.ac) / 2).lvP - P.sample((P.T.ao + P.T.ac) / 2).aoP).toFixed(4)} mmHg`);
const mc = crossing('mc', 'lvP', 'laP');
ok('mitral valve closes as LV pressure crosses above the atrium',
   mc && mc.before < 0 && mc.after > 0, JSON.stringify(mc));
const mo = crossing('mo', 'laP', 'lvP');
ok('and opens as the atrium regains the gradient', mo && mo.before < 0 && mo.after > 0, JSON.stringify(mo));

head('the isovolumetric phases actually are isovolumetric');
/* The one property the whole diagram is named for. Both valves shut, so
   volume must not move — a curve that drifts here is drawing a leak. */
const spread = (from, to) => {
  const vs = [];
  for (let t = from; t < to; t += 0.002) vs.push(P.sample(t).lvV);
  return Math.max(...vs) - Math.min(...vs);
};
const ivc = spread(P.T.mc + 0.004, P.T.ao - 0.004);
const ivr = spread(P.T.ac + 0.004, P.T.mo - 0.004);
ok('isovolumetric contraction moves no meaningful volume', ivc < 1.0, `${ivc.toFixed(3)} mL`);
ok('isovolumetric relaxation moves no meaningful volume', ivr < 1.0, `${ivr.toFixed(3)} mL`);

head('ejection and filling move volume in the directions they must');
const lvV = series.map(s => s.lvV);
const edv = Math.max(...lvV), esv = Math.min(...lvV);
ok('end-diastolic volume exceeds end-systolic', edv > esv, `${edv.toFixed(1)} vs ${esv.toFixed(1)} mL`);
ok('stroke volume is physiological for a normal heart', edv - esv > 40 && edv - esv < 120, `${(edv - esv).toFixed(1)} mL`);
const ef = (edv - esv) / edv;
ok('and so is ejection fraction', ef > 0.45 && ef < 0.8, `${(ef * 100).toFixed(1)}%`);
ok('the ventricle empties during ejection',
   P.sample(P.T.peak).lvV < P.sample(P.T.ao).lvV,
   `${P.sample(P.T.peak).lvV.toFixed(1)} < ${P.sample(P.T.ao).lvV.toFixed(1)}`);
ok('and fills during diastole',
   P.sample(P.T.dias).lvV > P.sample(P.T.mo).lvV,
   `${P.sample(P.T.dias).lvV.toFixed(1)} > ${P.sample(P.T.mo).lvV.toFixed(1)}`);

head('the left heart runs at higher pressure than the right, throughout');
const lvPeak = Math.max(...series.map(s => s.lvP));
const rvPeak = Math.max(...series.map(s => s.rvP));
ok('peak LV pressure far exceeds peak RV', lvPeak > rvPeak * 3, `${lvPeak.toFixed(0)} vs ${rvPeak.toFixed(0)} mmHg`);
ok('systemic pressure exceeds pulmonary at every instant of the cycle',
   series.every(s => s.aoP > s.paP), 'aoP > paP');
ok('aortic pressure never falls to zero — the diastolic runoff is bounded',
   Math.min(...series.map(s => s.aoP)) > 40, `${Math.min(...series.map(s => s.aoP)).toFixed(0)} mmHg`);

head('the cycle is a cycle');
ok('phaseAt covers every instant with a named phase',
   Array.from({ length: 200 }, (_, i) => P.phaseAt(i / 200)).every(p => p && p.id));
ok('the phases tile the cycle without a gap or an overlap',
   P.PHASES.every((ph, i) => i === 0 ? ph.from === 0 : Math.abs(ph.from - P.PHASES[i - 1].to) < 1e-9) &&
   Math.abs(P.PHASES[P.PHASES.length - 1].to - 1) < 1e-9);
ok('sampling wraps continuously past t=1',
   Math.abs(P.sample(0).lvP - P.sample(1).lvP) < 0.5,
   `${P.sample(0).lvP.toFixed(3)} vs ${P.sample(1).lvP.toFixed(3)}`);
ok('every event sits inside the cycle', P.EVENTS.every(e => e.at >= 0 && e.at <= 1));
ok('and the events are in chronological order',
   P.EVENTS.every((e, i) => i === 0 || e.at >= P.EVENTS[i - 1].at));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
