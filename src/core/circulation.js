/* ═════════════════════════════════════════════
   circulation.js — one closed circulation that the lesions are made in (docs/ROADMAP.md, S8).

   src/core/physio.js draws the resting cycle as written curves, measured where they cross. It cannot be
   made to have aortic stenosis: a drawn curve has no valve area to narrow. This file is the other way
   round. It writes no curve. It writes four chambers, two vascular beds and four valves, and the curves
   are what they do, beat after beat, until each beat is like the last:

     · each chamber is a time-varying elastance: its pressure is a blend, by its own activation e(t), of
       an end-systolic line Ees·(V − Vd) and an exponential passive curve P0·(e^{λ(V − V0)} − 1);
     · each valve passes 50·A·√ΔP mL/s for a gradient ΔP in mmHg across an area A in cm²: Bernoulli,
       ΔP = 4v², with v in m/s. Forward through the valve's area, backward through its regurgitant
       orifice. There is no inertance, so blood moves only down a gradient, and every valve event is the
       instant two pressure curves cross: the rule physio.js keeps, kept here by construction;
     · the systemic and pulmonary beds are each a root impedance, an arterial compliance and a resistance
       (a three-element Windkessel) into a venous compliance;
     · the pericardium holds the four chambers and any fluid in it, its pressure rising exponentially
       with what it holds, and every chamber's pressure is its own plus the pericardium's. A chamber that
       fills raises the pressure around the others: that is ventricular interdependence through the
       pericardium. A septal term adds a fraction of each ventricle's passive pressure to the other's;
     · breathing changes the pressure in the chest. The pulmonary vessels feel it; the chambers feel it
       through a pericardium that transmits it, and not through a rigid one (constriction).

   NOT YET REPRODUCED: constriction's breathing signs. The rigid pericardium is modelled, but the run gives
   the mitral E wave about a 4% fall on inspiration where the textbook gives 25% or more, and the wedge
   does not fall apart from the LV; the pulmonary veins refill from the PA within a fraction of a breath.
   VALIDATION holds constriction to its catheter signs alone, and nothing checks what rigidity does to
   breathing until a model reproduces it (docs/ROADMAP.md, S8).

   Units: mmHg, mL, seconds, mL/s.

     Circulation.simulate(preset, opts)   run to a steady state and return the last window, sampled
     Circulation.measure(run)             what a catheter and an echo would report from it
     Circulation.PRESETS                  normal, and each lesion, as parameter changes from normal
     Circulation.VALIDATION               for each preset, the textbook range each measure must fall in

   The tests (tests/verify-circulation-pure.js) run every preset and hold every row of VALIDATION. The
   ranges are the teaching figures a cardiology fellow is examined on, not fits to one patient; where a
   row is loose, it is loose because the textbook is.

   Pure: no DOM, no clock, no randomness. ES2015; Safari 13.4 is the floor (README).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

const obj = v => (v && typeof v === 'object') ? v : {};

/* ── the normal heart and circulation ──────────────────────────────────────────────────────────────── */
const NORMAL = {
  hr: 75,                 // beats a minute
  pr: 0.16,               // s from atrial to ventricular activation
  /* ees, vd: the end-systolic line; p0, lam, v0: the passive curve; tr, td: seconds the activation takes to
     rise to its peak and to fall back. */
  lv: { ees: 2.8, vd: 5, p0: 0.6, lam: 0.033, v0: 35, tr: 0.30, td: 0.15 },
  rv: { ees: 0.60, vd: 20, p0: 0.5, lam: 0.030, v0: 40, tr: 0.30, td: 0.15 },
  la: { ees: 0.15, vd: 10, p0: 0.30, lam: 0.040, v0: 15, tr: 0.09, td: 0.09 },
  ra: { ees: 0.15, vd: 10, p0: 0.30, lam: 0.035, v0: 15, tr: 0.09, td: 0.09 },
  septum: 0.05,           // share of each ventricle's passive pressure felt by the other
  /* zc: the root's characteristic impedance; ca, r: the arterial compliance and resistance; cv, rv: the
     venous compliance and the resistance to return. */
  sys: { zc: 0.03, ca: 1.5, r: 0.90, cv: 60, rv: 0.08 },
  pul: { zc: 0.02, ca: 4.0, r: 0.07, cv: 12, rv: 0.03 },
  valves: { mitral: [5.0, 0], aortic: [4.0, 0], tricuspid: [7.0, 0], pulmonic: [4.0, 0] },   // [area, regurgitant orifice], cm²
  peri: { v0: 640, s: 40, k: 0.5, fluid: 0, rigid: false },
  stressed: 1350,         // mL of stressed blood volume in the whole loop
  resp: { period: 4, depth: 5, mean: -3 },             // chest pressure: its mean, and how far it falls at full inspiration
};

/* Each lesion is a change from normal, nothing else. */
const PRESETS = {
  normal: {},
  /* The same heart breathing as hard as the tamponade below: the control for its pulsus. */
  dyspnoea: { resp: { depth: 10 } },
  as: { valves: { aortic: [0.7, 0] } },
  ar: { valves: { aortic: [4.0, 0.5] }, lv: { v0: 60, lam: 0.022 }, stressed: 1550 },
  ms: { valves: { mitral: [0.7, 0] }, stressed: 1800 },
  mr: { valves: { mitral: [5.0, 0.65] }, la: { p0: 0.8, lam: 0.05 }, stressed: 1550 },
  hfref: { lv: { ees: 0.6, vd: 50, v0: 90, lam: 0.02 }, stressed: 1750 },
  hfpef: { lv: { lam: 0.060, p0: 0.30 }, stressed: 1650 },
  /* Fluid in the sac, a breathless patient, and the veins tightened to keep the pressure up. */
  tamponade: { peri: { fluid: 600, s: 25 }, stressed: 1800, resp: { depth: 10 } },
  /* A small, stiff sac that does not pass the chest's pressure on, and the fluid the kidneys keep. */
  constriction: { peri: { v0: 340, s: 25, k: 1.0, rigid: true }, stressed: 2450 },
};

function merge(base, over) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const k of Object.keys(obj(over))) {
    const v = over[k];
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') ? merge(base[k], v) : v;
  }
  return out;
}
function params(preset) {
  const over = typeof preset === 'string' ? PRESETS[preset] : preset;
  if (typeof preset === 'string' && !over) throw new Error('No such preset: ' + preset);
  return merge(NORMAL, over || {});
}

/* ── activation ───────────────────────────────────────────────────────────────────────────────────────
   A smooth rise over tr seconds after the chamber is excited and a smooth fall over td more: each half a
   cosine. A ventricle contracts slowly and relaxes quickly, as a heart does. The atria are excited at the
   start of each beat, the ventricles pr seconds later. */
function act(tIn, c) {
  if (tIn < 0 || tIn > c.tr + c.td) return 0;
  return tIn < c.tr ? 0.5 * (1 - Math.cos(Math.PI * tIn / c.tr)) : 0.5 * (1 + Math.cos(Math.PI * (tIn - c.tr) / c.td));
}

function chamberP(c, v, e) {
  const passive = c.p0 * (Math.exp(c.lam * (v - c.v0)) - 1);
  return { p: e * c.ees * (v - c.vd) + (1 - e) * passive, passive: (1 - e) * passive };
}

/* Flow through a valve for a gradient dp (upstream minus downstream): forward through `area`, backward
   through `ero`. √|dp| is softened below 0.1 mmHg so the step can pass a crossing without dividing by zero. */
function valveQ(av, dp) {
  const a = dp >= 0 ? av[0] : av[1];
  if (!a) return 0;
  return 50 * a * dp / Math.sqrt(Math.abs(dp) + 0.1);
}

/* Flow out through a valve into an artery whose root adds zc·Q to the pressure beyond: dp is the ventricle's
   pressure less the arterial compliance's, so the valve sees dp − zc·Q and Q solves
   (Q / 50A)² + zc·Q = dp, taken in its stable form. Q is zero exactly where the ventricle's pressure crosses
   the root's, so the valve still moves at a crossing. */
function outQ(av, zc, dp) {
  if (!zc) return valveQ(av, dp);
  const a = dp >= 0 ? av[0] : av[1];
  if (!a) return 0;
  const k = 1 / (50 * a * 50 * a), x = Math.abs(dp);
  return Math.sign(dp) * 2 * x / (zc + Math.sqrt(zc * zc + 4 * k * x));
}

/* The state: [V_lv, V_la, V_rv, V_ra, V_sa, V_sv, V_pa, V_pv]. Stressed volumes in the beds. */
function evaluate(p, y, t) {
  const beat = 60 / p.hr;
  const tb = t % beat;
  const eA = act(tb, p.la);
  const eV = act(tb - p.pr, p.lv);
  const eVr = act(tb - p.pr, p.rv);
  const ph = (t % p.resp.period) / p.resp.period;
  const insp = 0.5 * (1 - Math.cos(2 * Math.PI * ph));            // 0 at end-expiration, 1 at full inspiration
  const pth = p.resp.mean - p.resp.depth * insp;

  const lv = chamberP(p.lv, y[0], eV), la = chamberP(p.la, y[1], eA), rv = chamberP(p.rv, y[2], eVr), ra = chamberP(p.ra, y[3], eA);
  const heart = y[0] + y[1] + y[2] + y[3] + p.peri.fluid;
  const ppTm = p.peri.k * (Math.exp((heart - p.peri.v0) / p.peri.s) - 1);
  /* Around the heart: the pericardium's own pressure, on the chest's when it passes the chest's on. */
  const around = Math.max(ppTm, 0) + (p.peri.rigid ? p.resp.mean : pth);
  const plv = lv.p + p.septum * rv.passive + around;
  const prv = rv.p + p.septum * lv.passive + around;
  const pla = la.p + around, pra = ra.p + around;
  const psa = y[4] / p.sys.ca, psv = y[5] / p.sys.cv;
  const ppa = y[6] / p.pul.ca + pth, ppv = y[7] / p.pul.cv + pth;

  const qmv = valveQ(p.valves.mitral, pla - plv);
  const qav = outQ(p.valves.aortic, p.sys.zc, plv - psa);
  const qtv = valveQ(p.valves.tricuspid, pra - prv);
  const qpv = outQ(p.valves.pulmonic, p.pul.zc, prv - ppa);
  const qs = (psa - psv) / p.sys.r, qsv = (psv - pra) / p.sys.rv;
  const qp = (ppa - ppv) / p.pul.r, qpvn = (ppv - pla) / p.pul.rv;

  return {
    dy: [qmv - qav, qpvn - qmv, qtv - qpv, qsv - qtv, qav - qs, qs - qsv, qpv - qp, qp - qpvn],
    s: { plv, pla, prv, pra, pao: psa + p.sys.zc * qav, psv, ppa: ppa + p.pul.zc * qpv, ppv, pperi: around, pth, insp, qmv, qav, qtv, qpv, qs, eV, eA },
  };
}

/* The starting volumes: a guess the run forgets. The beds get what the chambers leave of the stressed volume. */
function start(p) {
  const ch = [100, 50, 110, 50];
  const rest = Math.max(100, p.stressed - (ch[0] - p.lv.v0) - (ch[2] - p.rv.v0));
  return ch.concat([rest * 0.13, rest * 0.62, rest * 0.08, rest * 0.17]);
}

/* simulate(preset, { seconds, dt, every, keep })
   RK4 over `seconds` (40) at `dt` (0.5 ms), and the last `keep` seconds (two breaths, 8) sampled every
   `every` steps (4: every 2 ms). */
function simulate(preset, o) {
  const p = params(preset);
  const opt = obj(o);
  const dt = opt.dt || 0.0005, secs = opt.seconds || 40, keep = opt.keep || 2 * p.resp.period, every = opt.every || 4;
  let y = start(p);
  /* The kept window starts on a beat, as atria are excited: measure() cuts it into beats from there. */
  const beat = 60 / p.hr;
  const n = Math.round(secs / dt), from = Math.round(Math.floor((secs - keep) / beat) * beat / dt);
  const out = { t: [], v: { lv: [], la: [], rv: [], ra: [] }, p };
  const total0 = y.reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    if (i >= from && (i - from) % every === 0) {
      const s = evaluate(p, y, t).s;
      out.t.push(t);
      for (const k of Object.keys(s)) (out[k] || (out[k] = [])).push(s[k]);
      out.v.lv.push(y[0]); out.v.la.push(y[1]); out.v.rv.push(y[2]); out.v.ra.push(y[3]);
    }
    const k1 = evaluate(p, y, t).dy;
    const y2 = y.map((v, j) => v + dt / 2 * k1[j]);
    const k2 = evaluate(p, y2, t + dt / 2).dy;
    const y3 = y.map((v, j) => v + dt / 2 * k2[j]);
    const k3 = evaluate(p, y3, t + dt / 2).dy;
    const y4 = y.map((v, j) => v + dt * k3[j]);
    const k4 = evaluate(p, y4, t + dt).dy;
    y = y.map((v, j) => v + dt / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
  }
  out.conserved = { start: total0, end: y.reduce((a, b) => a + b, 0) };
  out.beat = 60 / p.hr;
  out.dt = dt * every;
  return out;
}

/* ── what a catheter and an echo report ───────────────────────────────────────────────────────────────
   Beats are cut at atrial excitation. End-diastolic volume is the LV's largest in a beat, end-systolic
   its smallest; end-diastolic PRESSURE is read where a catheter reads it, as the ventricles are excited
   (the R wave), which in mitral stenosis is not where the volume peaks. Forward stroke volume is what left through the aortic valve minus what came back through it;
   the regurgitant fraction is the volume that went the wrong way through the leaking valve over the LV's
   total stroke. Pulsus paradoxus is the fall in aortic systolic pressure from expiration to inspiration:
   the highest beat's peak less the lowest's. */
function measure(run) {
  const n = run.t.length, dt = run.dt, beat = run.beat;
  const per = Math.round(beat / dt);
  const beats = [];
  for (let i0 = 0; i0 + per <= n; i0 += per) beats.push([i0, i0 + per]);
  const mean = (a, i0, i1) => { let s = 0; for (let i = i0; i < i1; i++) s += a[i]; return s / (i1 - i0); };
  const max = (a, i0, i1) => { let m = -Infinity; for (let i = i0; i < i1; i++) m = Math.max(m, a[i]); return m; };
  const min = (a, i0, i1) => { let m = Infinity; for (let i = i0; i < i1; i++) m = Math.min(m, a[i]); return m; };
  const at = (a, i) => a[i];
  const avg = xs => xs.reduce((s, x) => s + x, 0) / xs.length;

  const per1 = beats.map(([i0, i1]) => {
    let iEd = i0, iEs = i0, iR = -1;
    for (let i = i0; i < i1; i++) {
      if (run.v.lv[i] > run.v.lv[iEd]) iEd = i;
      if (run.v.lv[i] < run.v.lv[iEs]) iEs = i;
      if (iR < 0 && run.eV[i] > 0) iR = i;
    }
    if (iR < 0) iR = iEd;
    let fwdA = 0, backA = 0, fwdM = 0, backM = 0, avGrad = 0, avN = 0, mvGrad = 0, mvN = 0;
    for (let i = i0; i < i1; i++) {
      const qa = run.qav[i], qm = run.qmv[i];
      if (qa > 0) { fwdA += qa * dt; avGrad += run.plv[i] - run.pao[i]; avN++; } else backA -= qa * dt;
      if (qm > 0) { fwdM += qm * dt; mvGrad += run.pla[i] - run.plv[i]; mvN++; } else backM -= qm * dt;
    }
    const edv = run.v.lv[iEd], esv = run.v.lv[iEs];
    return {
      edv, esv, sv: edv - esv, fwd: fwdA - backA, backA, backM,
      lvSys: max(run.plv, i0, i1), lvEdp: at(run.plv, iR),
      aoSys: max(run.pao, i0, i1), aoDia: min(run.pao, i0, i1),
      laMean: mean(run.pla, i0, i1), laV: max(run.pla, i0, i1),
      eWave: max(run.qmv, iEs, i1),
      raMean: mean(run.pra, i0, i1), rvSys: max(run.prv, i0, i1),
      rvEdp: at(run.prv, iR), paSys: max(run.ppa, i0, i1), paDia: min(run.ppa, i0, i1),
      avGrad: avN ? avGrad / avN : 0, mvGrad: mvN ? mvGrad / mvN : 0,
      peakAvGrad: max(run.plv.map((x, i) => x - run.pao[i]), i0, i1),
      insp: mean(run.insp, i0, i1),
      lvDiaMin: (() => { let m = Infinity; for (let i = iEs; i < i1; i++) m = Math.min(m, run.plv[i]); return m; })(),
      /* Of the LV's filling from the mitral valve's opening to the end of the beat (before the next atrial
         kick), the share done in the first third of that time: the square-root sign is filling that is
         nearly all early. */
      earlyFill: (() => { let io = iEs; while (io < i1 - 1 && !(run.qmv[io] > 0)) io++;
        const span = i1 - 1 - io; if (span < 3) return 0; const third = io + Math.round(span / 3);
        const tot = run.v.lv[i1 - 1] - run.v.lv[io]; return tot > 0 ? (run.v.lv[third] - run.v.lv[io]) / tot : 0; })(),
    };
  });
  const m = {};
  for (const k of Object.keys(per1[0])) m[k] = avg(per1.map(b => b[k]));
  m.ef = m.sv / m.edv;
  m.co = m.fwd * (60 / beat) / 1000;
  m.rf = m.sv > 0 ? Math.max(m.backA, m.backM) / m.sv : 0;
  /* Breath against breath: the beats nearest full inspiration and nearest end-expiration. */
  const byInsp = per1.slice().sort((a, b) => a.insp - b.insp);
  const ex = byInsp.slice(0, 2), ins = byInsp.slice(-2);
  m.pulsus = avg(ex.map(b => b.aoSys)) - avg(ins.map(b => b.aoSys));
  m.raInspMinusExp = avg(ins.map(b => b.raMean)) - avg(ex.map(b => b.raMean));
  m.lvSysInspMinusExp = avg(ins.map(b => b.lvSys)) - avg(ex.map(b => b.lvSys));
  m.rvSysInspMinusExp = avg(ins.map(b => b.rvSys)) - avg(ex.map(b => b.rvSys));
  /* The mitral E wave's respiratory variation, as an echo reads it: its fall from expiration to inspiration
     over its expiratory height. The E wave is the peak early filling flow, after end-systole. */
  const eEx = avg(ex.map(b => b.eWave)), eIn = avg(ins.map(b => b.eWave));
  m.eVariation = eEx > 0 ? (eEx - eIn) / eEx : 0;

  /* Equalisation: RA mean, RV end-diastolic, LA mean (the wedge) and LV end-diastolic, highest less lowest. */
  const eq = [m.raMean, m.rvEdp, m.laMean, m.lvEdp];
  m.diastolicSpread = Math.max.apply(null, eq) - Math.min.apply(null, eq);
  /* Constriction's catheter criteria: LV and RV end-diastolic pressures within 5 mmHg, and the RV's
     end-diastolic pressure over a third of its systolic. */
  m.lvRvEdpGap = Math.abs(m.lvEdp - m.rvEdp);
  m.rvEdpOverSys = m.rvEdp / m.rvSys;
  /* Dip and plateau: how far the LV falls in early diastole below where it ends diastole. */
  m.dip = m.lvEdp - m.lvDiaMin;
  m.beats = per1.length;
  return m;
}

/* ── the textbook, as ranges ──────────────────────────────────────────────────────────────────────────
   [preset, measure, low, high, what the textbook says]. A range open at one end uses ±Infinity. */
const I = Infinity;
const VALIDATION = [
  ['normal', 'lvSys', 105, 135, 'LV systolic about 120'],
  ['normal', 'lvEdp', 4, 12, 'LV end-diastolic under 12'],
  ['normal', 'aoSys', 105, 135, 'aortic 120 over 80'],
  ['normal', 'aoDia', 65, 90, 'aortic 120 over 80'],
  ['normal', 'laMean', 4, 12, 'wedge 6 to 12'],
  ['normal', 'raMean', 0, 8, 'right atrial 2 to 6'],
  ['normal', 'rvSys', 18, 32, 'RV 25 over 4'],
  ['normal', 'paSys', 15, 30, 'PA 25 over 10'],
  ['normal', 'paDia', 4, 15, 'PA 25 over 10'],
  ['normal', 'ef', 0.52, 0.72, 'ejection fraction 55 to 70%'],
  ['normal', 'sv', 55, 100, 'stroke volume 60 to 100 mL'],
  ['normal', 'co', 4.0, 7.0, 'cardiac output 4 to 7 L/min'],
  ['normal', 'avGrad', 0, 5, 'no gradient across a normal aortic valve'],
  ['normal', 'pulsus', 0, 10, 'systolic falls under 10 mmHg on inspiration'],
  ['normal', 'raInspMinusExp', -I, 0, 'right atrial pressure falls on inspiration'],
  ['normal', 'earlyFill', 0, 0.75, 'filling spread through diastole, not all early'],
  ['dyspnoea', 'pulsus', 0, 10, 'breathing hard is not pulsus paradoxus: the normal heart stays under 10'],

  ['as', 'avGrad', 40, I, 'severe aortic stenosis: mean gradient 40 or more'],
  ['as', 'lvSys', 160, I, 'the LV generates the gradient above the aortic pressure'],
  ['as', 'ef', 0.5, I, 'ejection fraction preserved'],
  ['as', 'co', 3.0, 7.0, 'output held, at rest'],

  ['ar', 'aoDia', 0, 55, 'severe aortic regurgitation: diastolic pressure low'],
  ['ar', 'rf', 0.5, I, 'regurgitant fraction 50% or more'],
  ['ar', 'edv', 170, I, 'the LV dilates'],
  ['ar', 'co', 3.0, 7.0, 'forward output held, at rest'],

  ['ms', 'mvGrad', 5, I, 'severe mitral stenosis: mean gradient over 5 to 10'],
  ['ms', 'laMean', 18, I, 'left atrial pressure high'],
  ['ms', 'lvEdp', 0, 12, 'the LV itself is spared: end-diastolic pressure normal'],
  ['ms', 'paSys', 35, I, 'pulmonary hypertension follows'],

  ['mr', 'rf', 0.5, I, 'severe mitral regurgitation: regurgitant fraction 50% or more'],
  ['mr', 'ef', 0.6, I, 'ejection fraction high: the LV empties into the atrium too'],
  ['mr', 'laV', 30, I, 'a tall v wave on the wedge'],
  ['mr', 'co', 2.5, 6.5, 'forward output kept up by a larger total stroke'],

  ['hfref', 'ef', 0, 0.4, 'reduced ejection fraction: 40% or less'],
  ['hfref', 'lvEdp', 16, I, 'filling pressure raised'],
  ['hfref', 'edv', 160, I, 'the LV dilates'],
  ['hfref', 'co', 2.0, 5.0, 'output low to low-normal'],

  ['hfpef', 'ef', 0.5, I, 'preserved ejection fraction: 50% or more'],
  ['hfpef', 'lvEdp', 16, I, 'filling pressure raised: the stiff ventricle'],
  ['hfpef', 'laMean', 15, I, 'wedge raised'],

  ['tamponade', 'diastolicSpread', 0, 5, 'diastolic pressures equalise within 5 mmHg'],
  ['tamponade', 'raMean', 12, I, 'right atrial pressure high'],
  ['tamponade', 'pulsus', 10, I, 'pulsus paradoxus: systolic falls 10 mmHg or more on inspiration'],
  ['tamponade', 'raInspMinusExp', -I, 0, 'right atrial pressure still falls on inspiration'],
  ['tamponade', 'co', 1.5, 4.5, 'output falls'],
  ['tamponade', 'aoSys', 0, 100, "Beck's triad: hypotension"],
  ['tamponade', 'eVariation', 0.25, I, 'the mitral E wave falls by a quarter or more on inspiration'],

  ['constriction', 'lvRvEdpGap', 0, 5, 'LV and RV end-diastolic pressures within 5 mmHg'],
  ['constriction', 'rvEdpOverSys', 1 / 3, I, 'RV end-diastolic pressure over a third of RV systolic'],
  ['constriction', 'raMean', 12, I, 'right atrial pressure high'],
  ['constriction', 'earlyFill', 0.75, I, 'dip and plateau: nearly all filling in early diastole'],
];

root.Circulation = { simulate, measure, params, PRESETS, NORMAL, VALIDATION };

})(typeof window !== 'undefined' ? window : this);
