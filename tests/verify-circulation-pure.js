#!/usr/bin/env node
/*
 * One circulation, every lesion made in it — src/core/circulation.js (docs/ROADMAP.md, S8).
 *
 *   node tests/verify-circulation-pure.js
 *
 * Bare Node. Each preset is run to a steady state and measured, and the claims are:
 *   - every row of Circulation.VALIDATION holds: the textbook range of each measure, for each lesion;
 *   - each lesion's defining finding is ABSENT in the normal heart, so no row passes because its measure
 *     reads the same for everything;
 *   - blood is neither made nor lost, and the window measured is a steady state;
 *   - a valve passes blood only down a gradient: flow starts and stops where two pressure curves cross,
 *     and between the valves' movements the ventricle's volume does not change at all.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const fmt = x => (Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));

const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'circulation.js'), 'utf8'), ctx);
const C = ctx.Circulation;

const RUNS = {}, M = {};
for (const name of Object.keys(C.PRESETS)) { RUNS[name] = C.simulate(name); M[name] = C.measure(RUNS[name]); }

head('every lesion against the textbook');
{
  const presets = new Set(C.VALIDATION.map(r => r[0]));
  ok('every preset has rows, and every row names a preset and a measure there is', Object.keys(C.PRESETS).every(p => presets.has(p))
     && C.VALIDATION.every(r => C.PRESETS[r[0]] && typeof M[r[0]][r[1]] === 'number' && Number.isFinite(M[r[0]][r[1]])),
     Object.keys(C.PRESETS).filter(p => !presets.has(p)).join(' ') || 'all');
  for (const [p, k, lo, hi, why] of C.VALIDATION) {
    const x = M[p][k];
    ok(`${p}: ${why} (${k} ${fmt(x)}, in ${lo === -Infinity ? '−∞' : fmt(lo)} to ${hi === Infinity ? '∞' : fmt(hi)})`, x >= lo && x <= hi);
  }
}

head('each lesion\'s defining finding is not the normal heart\'s');
{
  /* The row that makes each lesion that lesion; the normal heart must fall outside it. */
  const DEFINING = [['as', 'avGrad'], ['ar', 'rf'], ['ar', 'aoDia'], ['ms', 'mvGrad'], ['mr', 'rf'], ['mr', 'laV'], ['hfref', 'ef'], ['hfpef', 'lvEdp'],
    ['tamponade', 'pulsus'], ['tamponade', 'raMean'], ['constriction', 'earlyFill'], ['constriction', 'rvEdpOverSys'], ['constriction', 'raMean'], ['tamponade', 'eVariation']];
  for (const [p, k] of DEFINING) {
    const row = C.VALIDATION.find(r => r[0] === p && r[1] === k), x = M.normal[k];
    ok(`normal is not ${p} by ${k} (${fmt(x)})`, !!row && !(x >= row[2] && x <= row[3]));
  }
  ok('and a normal heart breathing as hard as the tamponade has no pulsus paradoxus', M.dyspnoea.pulsus < 10 && M.tamponade.pulsus >= 10, `${fmt(M.dyspnoea.pulsus)} against ${fmt(M.tamponade.pulsus)}`);
}

head('blood is kept, and the run has settled');
{
  const lost = Object.keys(RUNS).map(p => [p, Math.abs(RUNS[p].conserved.end - RUNS[p].conserved.start)]);
  ok('in every preset the blood in the loop at the end is the blood at the start, to a thousandth of a millilitre', lost.every(([, d]) => d < 1e-3), lost.map(([p, d]) => p + ' ' + d.toExponential(1)).join(', '));
  /* Two breaths kept: the second measured on its own agrees with the first. */
  const half = (r, k) => { const n = r.t.length >> 1; const o = {}; for (const key of Object.keys(r)) o[key] = Array.isArray(r[key]) ? r[key].slice(k * n, (k + 1) * n) : r[key];
    o.v = {}; for (const key of Object.keys(r.v)) o.v[key] = r.v[key].slice(k * n, (k + 1) * n); return o; };
  const drift = Object.keys(RUNS).map(p => { const a = C.measure(half(RUNS[p], 0)), b = C.measure(half(RUNS[p], 1)); return [p, Math.max(Math.abs(a.sv - b.sv) / b.sv, Math.abs(a.aoSys - b.aoSys) / b.aoSys, Math.abs(a.raMean - b.raMean) / Math.max(1, Math.abs(b.raMean)))]; });
  ok('one breath measures the same as the next, within 1%, in every preset: a steady state', drift.every(([, d]) => d < 0.01), drift.map(([p, d]) => p + ' ' + (d * 100).toFixed(2) + '%').join(', '));
  ok('the same preset run twice gives the same numbers', JSON.stringify(C.measure(C.simulate('mr'))) === JSON.stringify(M.mr));
}

head('valves move where pressures cross, and only then');
{
  const r = RUNS.normal;
  const mismatch = (q, up, down) => { let n = 0; for (let i = 0; i < r.t.length; i++) { const d = up[i] - down[i]; if (Math.abs(d) > 0.05 && (q[i] > 0) !== (d > 0)) n++; } return n; };
  ok('aortic flow runs exactly while the LV is above the aortic root', mismatch(r.qav, r.plv, r.pao) === 0, mismatch(r.qav, r.plv, r.pao) + ' samples otherwise');
  ok('mitral flow runs exactly while the LA is above the LV', mismatch(r.qmv, r.pla, r.plv) === 0, mismatch(r.qmv, r.pla, r.plv) + ' samples otherwise');
  ok('and a normal valve leaks nothing: no flow ever runs backward', r.qav.every(q => q >= 0) && r.qmv.every(q => q >= 0));
  /* Both valves shut: the LV's volume holds from one sample to the next, to a hundredth of a microlitre. */
  let shut = 0, moved = 0;
  for (let i = 1; i < r.t.length; i++) if (r.qav[i] === 0 && r.qmv[i] === 0 && r.qav[i - 1] === 0 && r.qmv[i - 1] === 0) { shut++; if (Math.abs(r.v.lv[i] - r.v.lv[i - 1]) > 1e-5) moved++; }
  ok('with both valves shut the LV\'s volume does not change: the isovolumetric phases are flat', shut > 50 && moved === 0, `${shut} samples shut, ${moved} moved`);
  const ar = RUNS.ar;
  ok('a regurgitant valve runs backward, through its own orifice, while the gradient is reversed', ar.qav.some(q => q < -1) && ar.qav.every((q, i) => !(q < 0) || ar.plv[i] < ar.pao[i]), 'least ' + Math.min.apply(null, ar.qav).toFixed(0) + ' mL/s');
}

head('the presets are changes from normal, and nothing else');
{
  const before = JSON.stringify(C.NORMAL);
  C.params('tamponade'); C.simulate('as', { seconds: 4 });
  ok('making a preset changes nothing in the normal heart', JSON.stringify(C.NORMAL) === before);
  ok('a preset that does not exist is refused, not run as normal', (() => { try { C.params('nope'); return false; } catch (e) { return /No such preset/.test(e.message); } })());
  const p = C.params('as');
  ok('aortic stenosis is the normal heart with a narrower aortic valve', p.valves.aortic[0] === 0.7 && p.valves.mitral[0] === C.NORMAL.valves.mitral[0] && p.lv.ees === C.NORMAL.lv.ees);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
