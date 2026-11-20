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

head('one beat for the views: its events are crossings, its phases tile the beat');
{
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  for (const name of Object.keys(C.PRESETS)) {
    const y = C.cycle(name), T = y.T;
    /* Each event, read where it was measured: the two pressures are equal there, to half a mmHg. */
    const pairs = [['mc', y.lvPressure, y.laPressure], ['mo', y.lvPressure, y.laPressure], ['ao', y.lvPressure, y.aoPressure], ['ac', y.lvPressure, y.aoPressure]];
    const off = pairs.map(([k, a, b]) => [k, Math.abs(a(T[k]) - b(T[k]))]);
    const tiles = y.PHASES.every((ph, i) => ph.from <= ph.to && (i === 0 ? ph.from === 0 : ph.from === y.PHASES[i - 1].to)) && y.PHASES[y.PHASES.length - 1].to === 1;
    ok(`${name}: the left heart's four events are where its pressures cross, in the order mitral shuts, aortic opens, aortic shuts, mitral opens, and the seven phases tile the beat`,
       y.ok && off.every(([, d]) => d < 0.5) && T.mc < T.ao && T.ao < T.ac && T.ac < T.mo && tiles, off.map(([k, d]) => k + ' ' + d.toFixed(2)).join(' ') + (tiles ? '' : ' · phases do not tile'));
  }
  const n = C.cycle('normal');
  const flat = (a, b) => { let most = 0; for (let i = 1; i <= 40; i++) { const t0 = a + (b - a) * (i - 1) / 40, t1 = a + (b - a) * i / 40; most = Math.max(most, Math.abs(n.lvVolume(t1) - n.lvVolume(t0))); } return most; };
  ok('between the valves, the LV\'s volume holds: isovolumetric contraction and relaxation are flat', flat(n.T.mc + 0.002, n.T.ao - 0.002) < 0.05 && flat(n.T.ac + 0.002, n.T.mo - 0.002) < 0.05,
     flat(n.T.mc + 0.002, n.T.ao - 0.002).toFixed(3) + ' and ' + flat(n.T.ac + 0.002, n.T.mo - 0.002).toFixed(3) + ' mL a step');
  const ms = C.cycle('ms');
  ok('in mitral stenosis the mitral valve stays open to the end of the beat: there is no diastasis', ms.T.dias === 1 && ms.phaseAt(0.99).id === 'rapid_fil', ms.T.dias + ' · ' + ms.phaseAt(0.99).id);
  ok('in aortic stenosis the LV peaks far above the aorta', C.cycle('as').max.p > 180 && C.cycle('as').lvPressure(C.cycle('as').T.peak) - C.cycle('as').aoPressure(C.cycle('as').T.peak) > 40);
  ok('a beat\'s stroke volume and ejection fraction are its run\'s', near(n.SV, n.EDV - n.ESV, 1e-9) && near(n.EF, n.SV / n.EDV, 1e-9) && n.SV > 60);
  ok('sample() gives the four readouts at a moment', (() => { const x = n.sample(0.5); return ['lvP', 'aoP', 'laP', 'lvV'].every(k => Number.isFinite(x[k])) && x.lvV === n.lvVolume(0.5); })());
  ok('the same lesion asked again is the same beat, not a second run', C.cycle('ar') === C.cycle('ar'));
}

head('the PV loop of each beat: its corners on its own lines, and each lesion where the textbook draws it');
{
  const L = name => C.cycle(name).loop;
  const off = Object.keys(C.PRESETS).map(name => { const l = L(name); return [name, Math.abs(l.esp - l.espvrAt(l.esv)), Math.abs(l.edp - l.edpvrAt(l.edv))]; });
  ok('in every preset, end-systole lies on the ESPVR and end-diastole on the EDPVR, to a mmHg', off.every(([, a, b]) => a < 1 && b < 1), off.map(([n, a, b]) => `${n} ${a.toFixed(2)}/${b.toFixed(2)}`).join(', '));
  ok('its SV and EF are the run\'s, as an echo would read them', Object.keys(C.PRESETS).every(name => { const y = C.cycle(name); return y.loop.sv === y.SV && y.loop.ef === y.EF; }));
  ok('the loop closes on itself and encloses the stroke work', Object.keys(C.PRESETS).every(name => { const l = L(name), a = l.points[0], b = l.points[l.points.length - 1]; return Math.abs(a.v - b.v) < 0.5 && Math.abs(a.p - b.p) < 0.5 && l.strokeWork > 500; }));
  const n = L('normal');
  ok('aortic stenosis: the loop is pushed up, end-systolic pressure far above normal', L('as').esp > n.esp + 40, `${L('as').esp.toFixed(0)} against ${n.esp.toFixed(0)}`);
  ok('aortic regurgitation: a wide loop, a large end-diastolic volume and stroke', L('ar').edv > n.edv + 60 && L('ar').sv > n.sv * 1.6, `EDV ${L('ar').edv.toFixed(0)}, SV ${L('ar').sv.toFixed(0)}`);
  ok('HFrEF: shifted right, a dilated ventricle with a small stroke and a shallow ESPVR', L('hfref').esv > n.esv * 3 && L('hfref').ees < n.ees / 2 && L('hfref').ef < 0.4, `ESV ${L('hfref').esv.toFixed(0)}, EF ${(L('hfref').ef * 100).toFixed(0)}%`);
  ok('HFpEF: an ESPVR at least normal (the hypertensive ventricle is stiff in systole too), filled up a steeper EDPVR to a higher pressure', L('hfpef').ees >= n.ees && L('hfpef').edpvrAt(120) > n.edpvrAt(120) * 2 && L('hfpef').edp > n.edp + 5, `EDPVR at 120 mL ${L('hfpef').edpvrAt(120).toFixed(1)} against ${n.edpvrAt(120).toFixed(1)}`);
  ok('tamponade: a small loop on a raised floor', L('tamponade').edv < n.edv * 0.6 && L('tamponade').strokeWork < n.strokeWork / 3 && L('tamponade').edp > n.edp + 8, `EDV ${L('tamponade').edv.toFixed(0)}, EDP ${L('tamponade').edp.toFixed(0)}`);
}

head('flow for the views: leaks run backward, and the coronaries follow their pressure');
{
  const scan = (y, f) => { const xs = []; for (let i = 0; i < 800; i++) xs.push([i / 800, f(i / 800)]); return xs; };
  const ar = C.cycle('ar'), mr = C.cycle('mr'), n = C.cycle('normal');
  const arBack = scan(ar, ar.aorticFlow).filter(([, q]) => q < -1);
  ok('aortic regurgitation: aortic flow runs backward, and only while the LV is below the aortic root, in diastole',
     arBack.length > 100 && arBack.every(([t]) => ar.lvPressure(t) < ar.aoPressure(t) && (t < ar.T.ao || t >= ar.T.ac)), `${arBack.length} samples back, least ${Math.min.apply(null, arBack.map(x => x[1])).toFixed(0)} mL/s`);
  const mrBack = scan(mr, mr.mitralFlow).filter(([, q]) => q < -1);
  ok('mitral regurgitation: mitral flow runs backward through systole, while the LV is above the LA', mrBack.length > 100 && mrBack.every(([t]) => mr.lvPressure(t) > mr.laPressure(t)) && mrBack.some(([t]) => t > mr.T.ao && t < mr.T.ac),
     `${mrBack.length} samples back`);
  ok('a normal valve runs no flow backward', scan(n, n.aorticFlow).every(([, q]) => q >= 0) && scan(n, n.mitralFlow).every(([, q]) => q >= 0));
  const cor = y => { let all = 0, dia = 0; for (const [t, q] of scan(y, t => y.coronaryFlow(t, 'left'))) { all += q; if (t < y.T.mc || t >= y.T.ac) dia += q; } return { mean: all / 800, dia: dia / all }; };
  const cn = cor(n), car = cor(ar), cas = cor(C.cycle('as'));
  ok('the left coronary fills mostly in diastole', cn.dia > 0.7, (cn.dia * 100).toFixed(0) + '%');
  ok('aortic regurgitation starves it, by the low diastolic pressure that drives it', car.mean < cn.mean * 0.8, `${car.mean.toFixed(3)} against ${cn.mean.toFixed(3)} mL/s`);
  ok('and aortic stenosis, by the wall that squeezes harder in systole', cas.mean < cn.mean * 0.9, `${cas.mean.toFixed(3)} against ${cn.mean.toFixed(3)} mL/s`);
  ok('the coronary rule is physio.js\'s: root pressure less 0.86 of the LV\'s, through 0.011 mL/s per mmHg, never below zero',
     [0.05, 0.3, 0.45, 0.8].every(t => Math.abs(n.coronaryFlow(t, 'left') - Math.max(0, (n.aoPressure(t) - 0.86 * n.lvPressure(t)) * 0.011)) < 1e-12));
}

head('the right heart for the views: the second sound splits as the textbook says');
{
  const split = name => { const y = C.cycle(name); return (y.T.pc - y.T.ac) * 1000 * y.beat; };
  ok('normal: A2 before P2, split by 10 to 60 ms', split('normal') >= 10 && split('normal') <= 60, split('normal').toFixed(0) + ' ms');
  ok('severe aortic stenosis: the split reversed, P2 before A2 (paradoxical), as the LV takes longer to empty', split('as') < 0, split('as').toFixed(0) + ' ms');
  ok('severe mitral regurgitation: the split wide, as A2 comes early with the LV emptying both ways', split('mr') > split('normal') + 30, split('mr').toFixed(0) + ' ms');
  const ms = C.cycle('ms'), n = C.cycle('normal');
  const peak = (y, f) => { let m = -Infinity; for (let i = 0; i < 600; i++) m = Math.max(m, f(i / 600)); return m; };
  ok('mitral stenosis loads the right heart: PA systolic well above normal', peak(ms, ms.paPressure) > peak(n, n.paPressure) + 8, `${peak(ms, ms.paPressure).toFixed(0)} against ${peak(n, n.paPressure).toFixed(0)}`);
}

head('the lesion as the 3D heart shows it: read off the engine\'s beat');
{
  const H = C.heartSpec;
  const n = H('normal');
  ok('the normal heart is all ones and no leak', JSON.stringify([n.wall, n.dil, n.vAmp, n.aAmp, n.open, n.leak]) === JSON.stringify([1, [1, 1, 1, 1], 1, 1, [1, 1, 1, 1], [0, 0, 0, 0]]));
  ok('chronic remodelling: AS\'s wall thickened, and HFpEF\'s less so; MS\'s atrium dilated', H('as').wall === 1.35 && H('hfpef').wall > 1 && H('hfpef').wall < H('as').wall && H('ms').dil[2] > 1.15 && H('hfref').wall === 1,
     `AS wall ${H('as').wall}, HFpEF ${H('hfpef').wall}, MS LA ${H('ms').dil[2].toFixed(2)}`);
  ok('HFrEF: a dilated LV that squeezes about a third as deeply', H('hfref').dil[0] > 1.2 && H('hfref').vAmp < 0.5, `LV ${H('hfref').dil[0].toFixed(2)}, squeeze ${H('hfref').vAmp.toFixed(2)}`);
  ok('aortic regurgitation: a dilated LV, and an aortic valve that never quite shuts', H('ar').dil[0] > 1.15 && H('ar').leak[2] > 0.15 && H('ar').leak[0] === 0, `LV ${H('ar').dil[0].toFixed(2)}, leak ${H('ar').leak[2].toFixed(2)}`);
  ok('aortic stenosis: an aortic valve that opens less than half way, the others whole', H('as').open[2] < 0.5 && H('as').open[0] === 1 && H('as').open[3] === 1, H('as').open.map(x => x.toFixed(2)).join(','));
  ok('mitral stenosis: a mitral valve that opens about a third, and a weaker atrial kick against it', H('ms').open[0] < 0.45 && H('ms').aAmp < 1, `${H('ms').open[0].toFixed(2)}, kick ${H('ms').aAmp}`);
  ok('mitral regurgitation: a mitral valve that never quite shuts', H('mr').leak[0] > 0.15, H('mr').leak[0].toFixed(2));
  ok('tamponade: every chamber squeezed smaller', H('tamponade').dil.every(d => d < 0.85), H('tamponade').dil.map(x => x.toFixed(2)).join(','));
  ok('every size within 0.6 to 1.6, every squeeze within 0.2 to 1.3, every opening and leak a fraction', Object.keys(C.PRESETS).every(p => { const h = H(p);
    return h.dil.every(d => d >= 0.6 && d <= 1.6) && h.vAmp >= 0.2 && h.vAmp <= 1.3 && h.open.every(x => x > 0 && x <= 1) && h.leak.every(x => x >= 0 && x < 0.5); }));
}

head('the 3D heart takes the lesion (src/core/heart3d.js)');
{
  const hsrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'heart3d.js'), 'utf8');
  const hx = {}; vm.createContext(hx); vm.runInContext(hsrc, hx);
  const H3 = hx.Heart3D, W = H3.withLesion;
  /* A moment of a sinus beat in mid-systole, and one in diastole, from the heart's own clock. */
  const sys = H3.cycle(400, 'sinus', {}), st = {}; for (let t = 0; t <= 400; t += 10) H3.cycle(t, 'sinus', st);
  const mid = H3.cycle(400, 'sinus', st), st2 = {}; for (let t = 0; t <= 800; t += 10) H3.cycle(t, 'sinus', st2);
  const dia = H3.cycle(800, 'sinus', st2);
  ok('with no lesion the moment is the heart\'s own, unchanged', W(sys, null) === sys);
  const hf = W(mid, C.heartSpec('hfref'));
  ok('HFrEF squeezes the ventricles as deeply as its spec says, and changes nothing else of the moment', Math.abs(hf.v - mid.v * C.heartSpec('hfref').vAmp) < 1e-12 && hf.cyc === mid.cyc && hf.a === mid.a && mid.v > 0.3,
     `${mid.v.toFixed(2)} -> ${hf.v.toFixed(2)}`);
  const as = W(mid, C.heartSpec('as')), ar = W(dia, C.heartSpec('ar'));
  ok('aortic stenosis: in systole, with the aortic valve open, it opens no further than its spec', mid.valves[2] > 0.9 && Math.abs(as.valves[2] - C.heartSpec('as').open[2]) < 1e-12, `${mid.valves[2].toFixed(2)} -> ${as.valves[2].toFixed(2)}`);
  ok('aortic regurgitation: in diastole, with the aortic valve shut, it stays open by its leak', dia.valves[2] < 0.1 && Math.abs(ar.valves[2] - C.heartSpec('ar').leak[2]) < 1e-12, `${dia.valves[2].toFixed(2)} -> ${ar.valves[2].toFixed(2)}`);
  ok('and the moment handed in is left as it was', mid.valves[2] > 0.9 && dia.valves[2] < 0.1 && mid.v === H3.cycle(400, 'sinus', (() => { const q = {}; for (let t = 0; t <= 400; t += 10) H3.cycle(t, 'sinus', q); return q; })()).v);
  const blanked = require('./_source.js').blankComments(hsrc);
  ok('the beat\'s shader sizes each chamber by uDil, and thickens the LV\'s wall by uWall (the outer surface out, the cavity in, the valves not), in the heart\'s mesh and the scanned one, and the page sets them in both',
     (blanked.match(/uniform vec4 uDil;/g) || []).length === 2 && /p \+= \(p - uLvApex\) \* \(\(uDil\.x - 1\.0\) \* aW\.x\);/.test(hsrc)
     && (blanked.match(/uniform float uWall, uSurf;/g) || []).length === 2 && /p \+= n \* \(uSurf \* \(uWall - 1\.0\) \* 0\.55 \* aW\.x\);/.test(hsrc)
     && /gl\.uniform1f\(u\.surf, m === mCav \? -1 : 1\);/.test(blanked) && /gl\.uniform1f\(uv\.surf, 0\);/.test(blanked)
     && /'laC','raC','dil','wall','surf'\];/.test(blanked) && /'laC','raC','dil','wall','surf','base'/.test(blanked) && /gl\.uniform4fv\(loc\.dil,/.test(blanked) && /gl\.uniform4fv\(uScan\.dil,/.test(blanked));
}

head('the presets are changes from normal, and nothing else');
{
  const before = JSON.stringify(C.NORMAL);
  C.params('tamponade'); C.simulate('as', { seconds: 4 });
  ok('making a preset changes nothing in the normal heart', JSON.stringify(C.NORMAL) === before);
  ok('a preset that does not exist is refused, not run as normal', (() => { try { C.params('nope'); return false; } catch (e) { return /No such preset/.test(e.message); } })());
  const p = C.params('as');
  ok('aortic stenosis is the normal heart with a narrower aortic valve and the LV its hypertrophy makes, and nothing else',
     p.valves.aortic[0] === 0.7 && p.valves.mitral[0] === C.NORMAL.valves.mitral[0] && p.lv.ees === 3.6 && p.lv.lam === 0.036 && p.lv.v0 === C.NORMAL.lv.v0 && p.la.v0 === C.NORMAL.la.v0 && p.rv.ees === C.NORMAL.rv.ees);
}

head('what the app says of a lesion is the lesion the engine runs');
{
  /* The Physiology panel's notes (PHYSIO_LESION_NOTE in app/systole.html) name a valve's area; the presets above set
     it. A preset refitted without its note says one thing and draws another, as MS's did when its valve went from
     0.7 to 0.85 cm². Read with the shell's comments blanked (tests/_source.js). */
  const { blankComments } = require('./_source.js');
  const shell = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
  const block = (shell.match(/const PHYSIO_LESION_NOTE=\{([\s\S]*?)\};/) || [])[1] || '';
  const areas = [];
  for (const m of block.matchAll(/(\w+):'((?:[^'\\]|\\.)*)'/g)) {
    for (const a of m[2].matchAll(/(\d+(?:\.\d+)?) cm(?:\\u00b2|²) (aortic|mitral|tricuspid|pulmonic) valve/g))
      areas.push({ id: m[1], said: +a[1], valve: a[2], runs: C.PRESETS[m[1]] ? C.params(m[1]).valves[a[2]][0] : null });
  }
  /* Not a scan of nothing: today's notes name AS's valve and MS's. */
  ok('the notes name a valve area for AS and for MS, and each is the area its preset runs',
     ['as', 'ms'].every(id => areas.some(x => x.id === id)) && areas.every(x => x.runs === x.said),
     areas.map(x => `${x.id} ${x.valve}: says ${x.said}, runs ${x.runs}`).join('; ') || 'no area found');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
