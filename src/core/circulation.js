/* ═════════════════════════════════════════════
   circulation.js — one closed circulation that the lesions are made in (docs/ROADMAP.md, S8).

   src/core/physio.js draws the resting cycle as written curves, measured where they cross. It cannot be
   made to have aortic stenosis: a drawn curve has no valve area to narrow. This file is the other way
   round. It writes no curve. It writes four chambers, two vascular beds and four valves, and the curves
   are what they do, beat after beat, until each beat is like the last:

     · each chamber is a time-varying elastance: its pressure is a blend, by its own activation e(t), of
       an end-systolic line Ees·(V − Vd) and an exponential passive curve P0·(e^{λ(V − V0)} − 1);
     · each valve has leaflets, and the blood in it has mass (valveDyn, below, after Mynard et al., 2012).
       Its steady flow is Bernoulli's, 50·A·√ΔP mL/s for a gradient ΔP in mmHg across an area A in cm²
       (ΔP = 4v², v in m/s), forward through the open leaflets and backward through a regurgitant orifice;
       but the flow changes only as fast as the gradient can accelerate the blood, and the leaflets open
       while the gradient is forward and shut while it is reversed. So the blood runs on for a moment
       against a reversed gradient (the hangout), a valve seals a few milliseconds after its gradient turns,
       letting a little blood back as it does, and that backflow against the aortic root's impedance is the
       incisura. Every valve event is the moment leaflets open or seal, not the instant two pressure curves
       cross (physio.js's rule, and this file's until its valves had mass);
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
     Circulation.INTERVENTIONS            the PV loop's interventions on the normal heart, the same way
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
  /* ees, vd: the end-systolic line; p0, lam, v0: the passive curve; hill: the ventricles' activation, below;
     tr, td: seconds the atria's activation takes to rise to its peak and to fall back. */
  lv: { ees: 2.8, vd: 5, p0: 0.6, lam: 0.033, v0: 35, hill: [0.215, 0.362, 1.32, 27.4] },
  /* The RV's contraction outlasts the LV's by a little. The valves' mass makes a pulmonary hangout, but a short
     one: the leaflets shut on the reversed gradient inside it. This stands in for the rest of it, and puts P2
     after A2 by the 10 to 60 ms the tests hold a normal S2 to. */
  rv: { ees: 0.60, vd: 20, p0: 0.5, lam: 0.030, v0: 40, hill: [0.215, 0.38, 1.32, 27.4] },
  la: { ees: 0.15, vd: 10, p0: 0.30, lam: 0.040, v0: 15, tr: 0.15, td: 0.12 },
  ra: { ees: 0.15, vd: 10, p0: 0.30, lam: 0.035, v0: 15, tr: 0.15, td: 0.12 },
  septum: 0.05,           // share of each ventricle's passive pressure felt by the other
  /* zc: the root's characteristic impedance; ca, r: the arterial compliance and resistance; cv, rv: the
     venous compliance and the resistance to return. */
  sys: { zc: 0.03, ca: 1.5, r: 0.90, cv: 60, rv: 0.08 },
  pul: { zc: 0.02, ca: 4.0, r: 0.07, cv: 12, rv: 0.03 },
  valves: { mitral: [5.0, 0], aortic: [4.0, 0], tricuspid: [7.0, 0], pulmonic: [4.0, 0] },   // [area, regurgitant orifice], cm²
  peri: { v0: 640, s: 40, k: 0.5, fluid: 0, rigid: false },
  /* The valves' mass and leaflets (valveDyn): l, each valve's effective blood column in cm; k, the leaflets'
     opening and closing rates, per mmHg per second. Fitted, not measured: the aortic column and closing rate
     that give a visible incisura while every lesion keeps its rows and checks, and AV columns short enough
     that the atrial kick's flow does not run on and shut the tricuspid before systole (M1 comes before T1). */
  dyn: { l: { mitral: 1, aortic: 0.5, tricuspid: 0.5, pulmonic: 0.5 }, k: [27, 20] },
  stressed: 1350,         // mL of stressed blood volume in the whole loop
  resp: { period: 4, depth: 5, mean: -3 },             // chest pressure: its mean, and how far it falls at full inspiration
};

/* Each lesion is a change from normal, nothing else. */
const PRESETS = {
  normal: {},
  /* The same heart breathing as hard as the tamponade below: the control for its pulsus. */
  dyspnoea: { resp: { depth: 10 } },
  /* Chronic lesions carry the remodelling they cause: AS's concentric hypertrophy (a stronger, somewhat stiffer LV,
     and its wall, which only the 3D heart reads), AR's dilated, compliant LV, MS's dilated atrium, HFpEF's
     hypertensive LV. */
  /* The hypertrophied LV also contracts and relaxes slowly: its activation builds later and more steeply, lasts
     longer, and falls away gently (impaired relaxation), so it empties late and A2 follows P2. */
  as: { valves: { aortic: [0.7, 0] }, lv: { ees: 3.6, lam: 0.036, hill: [0.28, 0.40, 1.8, 16] }, wall: 1.35 },
  ar: { valves: { aortic: [4.0, 0.65] }, lv: { v0: 60, lam: 0.020 }, stressed: 1550 },
  ms: { valves: { mitral: [0.85, 0] }, la: { v0: 70 }, stressed: 2600 },
  mr: { valves: { mitral: [5.0, 0.65] }, la: { p0: 0.8, lam: 0.05 }, stressed: 1550 },
  hfref: { lv: { ees: 0.6, vd: 50, v0: 90, lam: 0.02 }, stressed: 1750 },
  hfpef: { lv: { lam: 0.060, p0: 0.30, ees: 3.2 }, wall: 1.2, stressed: 1650 },
  /* Fluid in the sac, a breathless patient, and the veins tightened to keep the pressure up. */
  tamponade: { peri: { fluid: 600, s: 25 }, stressed: 1800, resp: { depth: 10 } },
  /* A small, stiff sac that does not pass the chest's pressure on, and the fluid the kidneys keep. */
  constriction: { peri: { v0: 340, s: 25, k: 1.0, rigid: true }, stressed: 2450 },
};

/* The PV loop's interventions on the normal heart, each one change from it, under physio.js's ids (Physio.INTERVENTIONS
   names and explains them). Preload: a fluid load, the stressed volume raised until the LV fills to a raised end-
   diastolic pressure; this LV's EDPVR is steep, so its loop widens by less than physio.js draws. Afterload: the
   systemic resistance 1.75 times normal. Contractility: Ees 1.5 times normal. The two failures are the lesions. */
const INTERVENTIONS = {
  base: 'normal',
  preload: { stressed: 3000 },
  after: { sys: { r: NORMAL.sys.r * 1.75 } },
  inotrope: { lv: { ees: NORMAL.lv.ees * 1.5 } },
  hfref: 'hfref',
  hfpef: 'hfpef',
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
   The atria are excited at the start of each beat, the ventricles pr seconds later.
   An atrium: a smooth rise over tr seconds and a smooth fall over td more, each half a cosine.
   A ventricle: the double-Hill elastance curve (Stergiopulos, Meister and Westerhof, 1996), hill: [tau1, tau2,
   m1, m2], the taus in seconds: a slow rise with exponent m1 about tau1, cut off by a steep fall with exponent m2
   about tau2, scaled to a peak of 1 (the scale found once per curve). The half-cosine it replaced rose for 0.30 s and
   fell for 0.15 s, and gave isovolumic times near 100 ms and ejection near 220 ms; this curve's are those the
   VALIDATION rows on timing ask for. At 75 a minute it is spent well inside the beat. */
const hillPeak = new Map();
function hill(t, h) {
  const r = Math.pow(t / h[0], h[2]), f = Math.pow(t / h[1], h[3]);
  return (r / (1 + r)) * (1 / (1 + f));
}
function hillAct(tIn, h) {
  if (tIn <= 0) return 0;
  const key = h.join(',');
  if (!hillPeak.has(key)) { let m = 0; for (let t = 0.0005; t < 3 * h[1]; t += 0.0005) m = Math.max(m, hill(t, h)); hillPeak.set(key, m); }
  return hill(tIn, h) / hillPeak.get(key);
}
function act(tIn, c) {
  if (c.hill) return hillAct(tIn, c.hill);
  if (tIn < 0 || tIn > c.tr + c.td) return 0;
  return tIn < c.tr ? 0.5 * (1 - Math.cos(Math.PI * tIn / c.tr)) : 0.5 * (1 + Math.cos(Math.PI * (tIn - c.tr) / c.td));
}

function chamberP(c, v, e) {
  const passive = c.p0 * (Math.exp(c.lam * (v - c.v0)) - 1);
  return { p: e * c.ees * (v - c.vd) + (1 - e) * passive, passive: (1 - e) * passive };
}

/* Valves without mass, where p.dyn is unset (a preset may set dyn: null, to compare): flow is Bernoulli's at
   every instant, and a valve opens and shuts exactly where its gradient crosses zero.
   Flow through a valve for a gradient dp (upstream minus downstream): forward through `area`, backward
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

/* A valve with mass and leaflets (after Mynard, Davidson, Penny and Smolich, 2012), where p.dyn is set. Two states
   each: the flow q, which the blood's inertia makes change only as fast as the gradient across it drives it, and
   how open the leaflets are, z from 0 to 1, which opens while the gradient is forward, as (1 − z) times it, and
   closes while it is reversed, in proportion to it, reaching 0 in a finite time (Mynard's closes as z times the
   gradient, which never quite shuts, so a valve would have no moment of closing). The open area runs from the
   regurgitant orifice (0 for a competent valve) at z = 0 to the full area at 1:
     L dq/dt = dp − q|q| / (50 A)²        L = ρ l / A, the blood column of effective length l through the area
   so a steady flow is the Bernoulli flow above, 50 A √dp. A shutting valve lets a little blood back before it
   seals: that backflow, against the aortic root's impedance, is the incisura. A competent valve at z = 0 is
   shut, and its flow is nothing.
   As the leaflets meet, the area falls faster than the flow can follow and the equation turns stiffer than the
   0.5 ms step can integrate. Where the flow would settle on its Bernoulli value, q* = 50 A √dp, faster than
   RATE_MAX a second, it is taken to that value at RATE_MAX instead: a change quicker than the step is one the
   step cannot show, and the rest of the equation is integrated as written. */
const RHO = 1.06 / 1333.2;       // blood's density, in mmHg·s²·cm per mL: L = RHO · l / A in mmHg·s²/mL
const RATE_MAX = 2000;           // s⁻¹: a rate RK4 at 0.5 ms integrates stably
function valveDyn(av, l, k, dp, q, z) {
  const zz = Math.max(0, Math.min(1, z));
  const a = av[1] + (av[0] - av[1]) * zz;
  const dz = dp > 0 ? k[0] * (1 - zz) * dp : (zz > 0 ? k[1] * dp : 0);
  if (!(a > 0)) return { q: 0, dq: -q * RATE_MAX, dz };
  const qs = 50 * a * Math.sign(dp) * Math.sqrt(Math.abs(dp));
  const rate = (Math.abs(q) + Math.abs(qs)) / (2500 * a * RHO * l);
  if (rate > RATE_MAX) return { q, dq: (qs - q) * RATE_MAX, dz };
  return { q, dq: (a * dp - q * Math.abs(q) / (2500 * a)) / (RHO * l), dz };
}

/* The state: [V_lv, V_la, V_rv, V_ra, V_sa, V_sv, V_pa, V_pv], stressed volumes in the beds; with p.dyn, then each
   valve's flow and opening: [q_mv, q_av, q_tv, q_pv, z_mv, z_av, z_tv, z_pv]. */
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

  let qmv, qav, qtv, qpv, dyn = null;
  if (p.dyn) {
    const d = p.dyn, V = p.valves;
    const m = valveDyn(V.mitral, d.l.mitral, d.k, pla - plv, y[8], y[12]);
    const a = valveDyn(V.aortic, d.l.aortic, d.k, plv - psa - p.sys.zc * y[9], y[9], y[13]);
    const tr = valveDyn(V.tricuspid, d.l.tricuspid, d.k, pra - prv, y[10], y[14]);
    const pu = valveDyn(V.pulmonic, d.l.pulmonic, d.k, prv - ppa - p.pul.zc * y[11], y[11], y[15]);
    qmv = m.q; qav = a.q; qtv = tr.q; qpv = pu.q;
    dyn = [m.dq, a.dq, tr.dq, pu.dq, m.dz, a.dz, tr.dz, pu.dz];
  } else {
    qmv = valveQ(p.valves.mitral, pla - plv);
    qav = outQ(p.valves.aortic, p.sys.zc, plv - psa);
    qtv = valveQ(p.valves.tricuspid, pra - prv);
    qpv = outQ(p.valves.pulmonic, p.pul.zc, prv - ppa);
  }
  const qs = (psa - psv) / p.sys.r, qsv = (psv - pra) / p.sys.rv;
  const qp = (ppa - ppv) / p.pul.r, qpvn = (ppv - pla) / p.pul.rv;
  const dy = [qmv - qav, qpvn - qmv, qtv - qpv, qsv - qtv, qav - qs, qs - qsv, qpv - qp, qp - qpvn];
  const s = { plv, pla, prv, pra, pao: psa + p.sys.zc * qav, psv, ppa: ppa + p.pul.zc * qpv, ppv, pperi: around, pth, insp, qmv, qav, qtv, qpv, qs, eV, eA };
  if (dyn) { for (const x of dyn) dy.push(x); s.zmv = y[12]; s.zav = y[13]; s.ztv = y[14]; s.zpv = y[15]; }
  return { dy, s };
}

/* The starting volumes: a guess the run forgets. The beds get what the chambers leave of the stressed volume. */
function start(p) {
  const ch = [100, 50, 110, 50];
  const rest = Math.max(100, p.stressed - (ch[0] - p.lv.v0) - (ch[2] - p.rv.v0));
  const y = ch.concat([rest * 0.13, rest * 0.62, rest * 0.08, rest * 0.17]);
  return p.dyn ? y.concat([0, 0, 0, 0, 0, 0, 0, 0]) : y;
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
  const blood = y => y[0] + y[1] + y[2] + y[3] + y[4] + y[5] + y[6] + y[7];
  const total0 = blood(y);
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
    /* A leaflet is no more than open and no less than shut: a step that would carry it past either end (a
       large gradient moves it further in one step than there is to go) stops it there. */
    if (p.dyn) for (let j = 12; j < 16; j++) y[j] = Math.max(0, Math.min(1, y[j]));
  }
  out.conserved = { start: total0, end: blood(y) };
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
    /* The left heart's valve events: the aortic valve's opening after the R wave, the mitral valve's closing
       before it, the aortic valve's closing, and the mitral valve's next opening; read from the leaflets where
       the valves have them (p.dyn), else from the flows, a valve being open while blood runs forward through it. Between them, the isovolumic contraction, the ejection and the isovolumic
       relaxation, in ms. A beat in which one is not found gives NaN, which no range holds. */
    const avOpen = run.zav ? i => run.zav[i] > 0 : i => run.qav[i] > 0;
    const mvOpen = run.zmv ? i => run.zmv[i] > 0 : i => run.qmv[i] > 0;
    let iAo = -1, iMc = -1, iAc = -1, iMo = -1;
    for (let i = iR; i < i1; i++) if (avOpen(i)) { iAo = i; break; }
    if (iAo >= 0) for (let i = iAo - 1; i >= i0; i--) if (mvOpen(i)) { iMc = i + 1; break; }
    if (iAo >= 0) for (let i = iAo; i < i1; i++) if (!avOpen(i)) { iAc = i; break; }
    if (iAc >= 0) for (let i = iAc; i < i1; i++) if (mvOpen(i)) { iMo = i; break; }
    const span = (a, b) => (a >= 0 && b >= 0) ? (b - a) * dt * 1000 : NaN;
    /* The incisura: from the end of forward flow through the aortic valve (the backflow that shuts it starts
       there; the flow starts a little after the leaflets open, the blood having to be set moving), the root's lowest pressure in the next 40 ms, and how far it recovers in the 60 ms after that. A
       root that only falls recovers nothing. */
    let incisura = NaN, iQ0 = -1, iF = -1;
    if (iAo >= 0) for (let i = iAo; i < i1; i++) if (run.qav[i] > 0) { iF = i; break; }
    if (iF >= 0) for (let i = iF; i < i1; i++) if (!(run.qav[i] > 0)) { iQ0 = i; break; }
    if (iQ0 >= 0) {
      let lo = iQ0; for (let i = iQ0; i < Math.min(i1, iQ0 + Math.round(0.04 / dt)); i++) if (run.pao[i] < run.pao[lo]) lo = i;
      let hi = lo; for (let i = lo; i < Math.min(i1, lo + Math.round(0.06 / dt)); i++) if (run.pao[i] > run.pao[hi]) hi = i;
      incisura = run.pao[hi] - run.pao[lo];
    }
    return {
      ivc: span(iMc, iAo), lvet: span(iAo, iAc), ivr: span(iAc, iMo), incisura,
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
  /* At 75 a minute: isovolumic contraction about 50 ms, ejection about 290 ms (Weissler: 413 − 1.7 × rate),
     isovolumic relaxation 50 to 100 ms on echo. */
  ['normal', 'ivc', 20, 80, 'isovolumic contraction about 50 ms'],
  ['normal', 'lvet', 250, 330, 'ejection about 0.29 s at 75 a minute'],
  ['normal', 'ivr', 40, 100, 'isovolumic relaxation 50 to 100 ms'],
  ['normal', 'incisura', 2, 15, 'the dicrotic notch: the aortic pressure dips as the valve shuts, then recovers'],
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

/* ── one beat, for the views ──────────────────────────────────────────────────────────────────────────
   cycle(preset) runs the preset with the chest held still, to a steady state, and hands back one beat in the
   shape the views read physio.js in: each trace as a function of the cycle fraction t (0 is atrial
   excitation), the eight valve events, the seven left-heart phases between them, and a sample at any t.

   EVERY EVENT IS A VALVE'S LEAFLETS, measured on the run: a valve opens at the first sample its leaflets are
   off zero and shuts at the first they are back on it. That is a few milliseconds after its gradient turns
   (the leaflets take time to move, and the blood runs on: the hangout), not where two pressure curves cross,
   so a drawn A2 sits at the incisura. A valve that leaks still shuts: its leaflets meet, and the leak runs on
   through its orifice. Without p.dyn, each event is where the two pressures cross instead. Rapid filling gives way to diastasis where the mitral flow has fallen to a quarter of its peak; where
   it never does before the beat ends (mitral stenosis: the gradient runs all through diastole), diastasis
   has no width.
   The same preset asked again is the same object: a run is worth keeping. */
const PHASE_TEXT = {
  atrial:    ['Atrial systole', 'The atrial kick: the last of ventricular filling.'],
  ivc:       ['Isovolumetric contraction', 'Mitral shut, aortic not yet open: pressure climbs at constant volume.'],
  rapid_ej:  ['Rapid ejection', 'The aortic valve opens and most of the stroke leaves.'],
  red_ej:    ['Reduced ejection', 'Ejection continues while the ventricle’s pressure is already falling.'],
  ivr:       ['Isovolumetric relaxation', 'Aortic shut, mitral not yet open: pressure falls at constant volume.'],
  rapid_fil: ['Rapid filling', 'The mitral valve opens and the ventricle fills fast: the E wave.'],
  diastasis: ['Reduced filling (diastasis)', 'Filling slows as the pressures come together.'],
};
const cycles = new Map();
function cycle(preset) {
  const key = typeof preset === 'string' ? preset : JSON.stringify(preset);
  if (cycles.has(key)) return cycles.get(key);
  const p = merge(params(preset), { resp: { depth: 0 } });
  const beat = 60 / p.hr;
  const run = simulate(p, { seconds: 24 * beat, keep: beat, every: 1 });
  const n = run.t.length;
  const at = a => t => { const x = ((t % 1) + 1) % 1 * n, i = Math.floor(x) % n, f = x - Math.floor(x); return a[i] * (1 - f) + a[(i + 1) % n] * f; };
  const frac = i => i / n;
  /* A crossing of up − down from below to above (dir 1) or above to below (dir −1), searched from i in
     step direction s, at the sample where the sign turns, interpolated between the two. */
  const cross = (up, down, dir, i, s) => {
    for (let k = 0; k < n; k++) {
      const j = (i + s * k + n) % n, j2 = (j + 1) % n;
      const d0 = (up[j] - down[j]) * dir, d1 = (up[j2] - down[j2]) * dir;
      if (d0 <= 0 && d1 > 0) return (j + d0 / (d0 - d1)) / n % 1;
    }
    return null;
  };
  const argmax = a => a.reduce((b, x, i) => x > a[b] ? i : b, 0);
  const iA = argmax(run.qav), iP = argmax(run.qpv);
  const idx = t => Math.round(t * n) % n;
  const T = {};
  if (p.dyn) {
    /* Valves with leaflets open and shut when their leaflets do: the first sample a valve is open (z above 0)
       after it was shut, and the first it is shut again, searched from i in step direction s. */
    const leaf = (z, open, i, s) => {
      for (let k = 0; k < n; k++) {
        const j = (i + s * k + n) % n, j2 = (j + 1) % n;
        if (open ? (z[j] <= 0 && z[j2] > 0) : (z[j] > 0 && z[j2] <= 0)) return j2 / n;
      }
      return null;
    };
    T.ao = leaf(run.zav, true, iA, -1);
    T.ac = leaf(run.zav, false, iA, 1);
    T.mc = leaf(run.zmv, false, idx(T.ao), -1);
    T.mo = leaf(run.zmv, true, idx(T.ac), 1);
    T.po = leaf(run.zpv, true, iP, -1);
    T.pc = leaf(run.zpv, false, iP, 1);
    T.tc = leaf(run.ztv, false, idx(T.po), -1);
    T.to = leaf(run.ztv, true, idx(T.pc), 1);
  } else {
    T.ao = cross(run.plv, run.pao, 1, iA, -1);
    T.ac = cross(run.plv, run.pao, -1, iA, 1);
    T.mc = cross(run.plv, run.pla, 1, idx(T.ao), -1);
    T.mo = cross(run.plv, run.pla, -1, idx(T.ac), 1);
    T.po = cross(run.prv, run.ppa, 1, iP, -1);
    T.pc = cross(run.prv, run.ppa, -1, iP, 1);
    T.tc = cross(run.prv, run.pra, 1, idx(T.po), -1);
    T.to = cross(run.prv, run.pra, -1, idx(T.pc), 1);
  }
  T.peak = frac(argmax(run.plv));
  /* Diastasis: from the E wave's peak on, the first sample where the mitral flow is a quarter of it. */
  let iE = idx(T.mo); for (let k = 0, j = iE; k < n / 2; k++, j = (j + 1) % n) if (run.qmv[j] > run.qmv[iE]) iE = j;
  let iD = iE; while (iD < n && run.qmv[iD] > run.qmv[iE] / 4) iD++;
  /* Through to the end of the beat without slowing (mitral stenosis): no diastasis, a phase of no width. */
  T.dias = iD < n ? frac(iD) : 1;
  const order = ['mc', 'ao', 'peak', 'ac', 'mo', 'dias'];
  const ok = order.every(k => T[k] !== null) && order.every((k, i) => i === 0 || T[k] > T[order[i - 1]]);
  const bounds = [['atrial', 0, T.mc], ['ivc', T.mc, T.ao], ['rapid_ej', T.ao, T.peak], ['red_ej', T.peak, T.ac],
    ['ivr', T.ac, T.mo], ['rapid_fil', T.mo, T.dias], ['diastasis', T.dias, 1]];
  const PH = bounds.map(([id, from, to]) => ({ id, from, to, name: PHASE_TEXT[id][0], blurb: PHASE_TEXT[id][1] }));
  const EVENTS = [
    { at: T.mc, id: 'mc', label: 'Mitral closes', side: 'L', sound: 'S1', note: 'M1' },
    { at: T.tc, id: 'tc', label: 'Tricuspid closes', side: 'R', sound: 'S1', note: 'T1' },
    { at: T.po, id: 'po', label: 'Pulmonic opens', side: 'R', sound: null },
    { at: T.ao, id: 'ao', label: 'Aortic opens', side: 'L', sound: null },
    { at: T.ac, id: 'ac', label: 'Aortic closes', side: 'L', sound: 'S2', note: 'A2' },
    { at: T.pc, id: 'pc', label: 'Pulmonic closes', side: 'R', sound: 'S2', note: 'P2' },
    { at: T.to, id: 'to', label: 'Tricuspid opens', side: 'R', sound: null },
    { at: T.mo, id: 'mo', label: 'Mitral opens', side: 'L', sound: null },
  ].filter(e => e.at !== null).sort((a, b) => a.at - b.at);
  const m = measure(run);
  /* The PV loop, in the shape the view reads physio.js's loopWith() in. Its corners are where the
     physiologist puts them: end-diastole as the ventricle is excited (the R wave), and end-systole where its
     pressure over its volume above Vd is greatest, its moment of peak elastance. Neither is a valve's: in
     aortic stenosis or mitral regurgitation the aortic valve shuts well away from end-systole. Its ESPVR and
     EDPVR are this ventricle's own lines, raised by what surrounds it at that corner (the pericardium's
     pressure, and the chest's, and at end-diastole the full RV's, through the septum): in tamponade the whole
     loop sits on a pressure the ventricle did not make. */
  const lvP = at(run.plv), lvV = at(run.v.lv), around = at(run.pperi);
  const N = 300, pts = [];
  for (let i = 0; i <= N; i++) { const t = i / N; pts.push({ t, v: lvV(t), p: lvP(t) }); }
  let area = 0;
  for (let i = 0; i < N; i++) area += pts[i].v * pts[i + 1].p - pts[i + 1].v * pts[i].p;
  let iEs = 0;
  for (let i = 0; i < n; i++) if ((run.plv[i] - run.pperi[i]) / Math.max(1, run.v.lv[i] - p.lv.vd) > (run.plv[iEs] - run.pperi[iEs]) / Math.max(1, run.v.lv[iEs] - p.lv.vd)) iEs = i;
  const tEs = frac(iEs), tEd = p.pr / beat;
  const edv = lvV(tEd), edp = lvP(tEd), esv = lvV(tEs), esp = lvP(tEs);
  /* The RV is relaxed at the R wave: its passive pressure at that moment, a share of which the septum passes on. */
  const rvEd = at(run.v.rv)(tEd), septalEd = p.septum * p.rv.p0 * (Math.exp(p.rv.lam * (rvEd - p.rv.v0)) - 1);
  const aroundEs = around(tEs), aroundEd = around(tEd) + septalEd;
  const loop = {
    /* SV and EF as an echo reads them, from the largest and smallest volumes, which are not the corners
       where a valve's lesion keeps the ventricle moving past them. */
    tEd, tEs, edv, edp, esv, esp, sv: m.sv, ef: m.ef, ea: esp / Math.max(1e-9, edv - esv),
    ees: p.lv.ees, v0: p.lv.vd, strokeWork: Math.abs(area / 2), points: pts, vAt: lvV, pAt: lvP,
    espvrAt: v => Math.max(0, p.lv.ees * (v - p.lv.vd)) + aroundEs,
    edpvrAt: v => p.lv.p0 * (Math.exp(p.lv.lam * (v - p.lv.v0)) - 1) + aroundEd,
  };
  const c = {
    loop,
    preset: key, ok, beat, T, PHASES: PH, EVENTS,
    rAt: p.pr / beat,
    lvPressure: at(run.plv), aoPressure: at(run.pao), laPressure: at(run.pla), lvVolume: at(run.v.lv),
    rvPressure: at(run.prv), paPressure: at(run.ppa), raPressure: at(run.pra),
    aorticFlow: at(run.qav), mitralFlow: at(run.qmv),
    /* Coronary flow by physio.js's own rule, so the two compare: the aortic root's pressure less the pressure in
       the wall squeezing the vessels (0.86 of the LV's, 0.80 of the RV's), through a bed of 0.011 mL/s per mmHg.
       Aortic regurgitation lowers the diastolic root pressure that drives the left; aortic stenosis raises the
       wall pressure that throttles it in systole. */
    coronaryFlow: (t, side) => Math.max(0, (at(run.pao)(t) - (side === 'right' ? 0.80 * at(run.prv)(t) : 0.86 * at(run.plv)(t))) * 0.011),
    EDV: m.edv, ESV: m.esv, SV: m.sv, EF: m.ef,
    max: { p: Math.max.apply(null, run.plv.concat(run.pao, run.pla)), v: Math.max.apply(null, run.v.lv) },
    min: { v: Math.min.apply(null, run.v.lv) },
    phaseAt(t) { t = ((t % 1) + 1) % 1; for (const ph of PH) if (t >= ph.from && t < ph.to) return ph; return PH[PH.length - 1]; },
    sample(t) { return { lvP: c.lvPressure(t), aoP: c.aoPressure(t), laP: c.laPressure(t), lvV: c.lvVolume(t) }; },
    wrap: t => ((t % 1) + 1) % 1,
    run,
  };
  cycles.set(key, c);
  return c;
}

/* ── the lesion as the 3D heart shows it ──────────────────────────────────────────────────────────────
   heartSpec(preset) → what src/core/heart3d.js needs to show a lesion, all of it read off the engine's beat
   against the normal one, none of it drawn by hand:
     dil      each chamber's size against normal, LV RV LA RA: the cube root of its largest volume's ratio,
              since a chamber's span grows as the cube root of its volume (clamped to 0.6..1.6)
     vAmp     how deeply the ventricles squeeze against normal: the ratio of their ejection fractions
     aAmp     how hard the atria kick: 1, or 0.5 where the atrium pumps against a stenotic valve
     wall     how thick the LV's wall is against normal: the preset's own (a hypertrophy the beat's volumes do not
              show; the stiffness and strength it brings are in the preset's LV)
     open     how far each valve opens against normal, mitral tricuspid aortic pulmonic: the square root
              of its area's ratio (a leaflet's swing for an orifice of that area)
     leak     how far each stays open when it should be shut: its regurgitant orifice against its area
   Normal is all ones and no leak. */
function heartSpec(preset) {
  const n = cycle('normal'), y = cycle(preset);
  if (preset === 'normal') return { preset, wall: 1, dil: [1, 1, 1, 1], vAmp: 1, aAmp: 1, open: [1, 1, 1, 1], leak: [0, 0, 0, 0] };
  const big = (c, a) => Math.max.apply(null, c.run.v[a]);
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const r = (a) => clamp(Math.cbrt(big(y, a) / big(n, a)), 0.6, 1.6);
  const pv = params(preset), pn = NORMAL;
  const names = ['mitral', 'tricuspid', 'aortic', 'pulmonic'];
  const open = names.map(k => clamp(Math.sqrt(pv.valves[k][0] / pn.valves[k][0]), 0.15, 1));
  const leak = names.map(k => clamp(pv.valves[k][1] / pv.valves[k][0] * 2, 0, 0.45));
  return { preset, wall: clamp(pv.wall || 1, 1, 1.6), dil: [r('lv'), r('rv'), r('la'), r('ra')], vAmp: clamp(y.EF / n.EF, 0.2, 1.3),
           aAmp: pv.valves.mitral[0] < pn.valves.mitral[0] / 2 ? 0.5 : 1, open, leak };
}

root.Circulation = { simulate, measure, params, cycle, heartSpec, PRESETS, INTERVENTIONS, NORMAL, VALIDATION };

})(typeof window !== 'undefined' ? window : this);
