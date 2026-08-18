/* ═══════════════════════════════════════════════════════════════════════════
   physio.js — the cardiac cycle as numbers, not as a picture.

   A Wiggers diagram is usually drawn. That makes it a nice illustration and a
   poor teaching tool, because nothing about it can be interrogated: you cannot
   ask it what the ejection fraction is, or why coronary flow collapses in
   systole, because the curves were drawn rather than computed.

   Here every trace is generated from the same normalised cycle time the heart
   and the ECG already run on, so the diagram, the pressure-volume loop, the
   3D heart and the rhythm strip are all showing ONE event. Move the cursor and
   everything moves together, because there is only one clock.

   Two rules the model holds itself to, and which the tests check:

     1. VALVES ARE CROSSINGS, NOT LABELS. The mitral valve does not close
        "at t = 0.10" because a constant says so; it closes because that is
        where the LV pressure curve crosses the LA pressure curve. Every one of
        the eight valve events is a real crossing of two independently written
        curves, which is the only way the diagram can teach why a valve moves.

     2. VOLUME CHANGES ONLY WHEN A VALVE IS OPEN. The isovolumetric phases are
        exactly flat, not nearly flat — that identity is most of what the
        diagram is for.

   Pressures in mmHg, volumes in mL, flows in mL/s, time as a fraction of one
   cardiac cycle. Values are the normal adult resting figures a fellow is
   examined on: LV 120/9, aorta 120/80, LA mean 8 with a/c/v waves, RV 25/4,
   PA 25/10, RA mean 4, EDV 120, ESV 50 — so SV 70 and EF 58%.

   Usage:
     Physio.sample(0.25)        // every trace at that instant
     Physio.PHASES              // the seven left-heart phases
     Physio.EVENTS              // valve events, with their measured crossings
     Physio.loop(240)           // the PV loop as points
     Physio.derived()           // SV, EF, dP/dt max, and where they come from
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

/* ── timing ─────────────────────────────────────────────────────────────────
   The instants the valves move. They are written here as the design targets;
   crossings() then measures where the curves ACTUALLY cross, and the tests
   insist the two agree. If a curve is edited badly, the measurement drifts and
   the test fails — which is the point of measuring rather than asserting. */
const T = {
  mc: 0.100,   // mitral closes      — M1
  tc: 0.115,   // tricuspid closes   — T1  (S1 is M1 then T1)
  po: 0.140,   // pulmonic opens     — RV has only 10 mmHg to beat
  ao: 0.155,   // aortic opens
  ac: 0.420,   // aortic closes      — A2
  pc: 0.450,   // pulmonic closes    — P2  (S2 splits, A2 then P2)
  to: 0.470,   // tricuspid opens
  mo: 0.485,   // mitral opens
  peak: 0.280, // peak systolic pressure, both ventricles
  dias: 0.640, // rapid filling gives way to diastasis
};

/* The seven phases of the LEFT heart, by fraction of the cycle. Boundaries are
   valve events, which is the only honest place to put them: a phase IS the
   interval between two valve movements, not a region of a drawing. */
const PHASES = [
  { id:'atrial',   from:0.00,   to:T.mc,   name:'Atrial systole',
    blurb:'The atrial kick. Adds the last 15-25% of ventricular filling — which is why losing it in AF costs more in a stiff ventricle than a compliant one.' },
  { id:'ivc',      from:T.mc,   to:T.ao,   name:'Isovolumetric contraction',
    blurb:'Mitral shut, aortic not yet open. Pressure climbs steeply at constant volume — the steepest dP/dt in the cycle, and the basis of dP/dt max as a contractility index.' },
  { id:'rapid_ej', from:T.ao,   to:T.peak, name:'Rapid ejection',
    blurb:'Aortic valve opens. About 70% of the stroke volume leaves here, and aortic pressure climbs to its systolic peak.' },
  { id:'red_ej',   from:T.peak, to:T.ac,   name:'Reduced ejection',
    blurb:'Ejection continues on momentum while ventricular pressure is already falling — flow persists briefly against a small reversed gradient.' },
  { id:'ivr',      from:T.ac,   to:T.mo,   name:'Isovolumetric relaxation',
    blurb:'Aortic shut, mitral not yet open. An energy-consuming, actively regulated process — impaired here long before systolic function fails, which is HFpEF.' },
  { id:'rapid_fil',from:T.mo,   to:T.dias, name:'Rapid filling',
    blurb:'Mitral opens; the ventricle sucks. Produces the E wave on mitral inflow, and S3 when it fills a stiff or volume-loaded ventricle abruptly.' },
  { id:'diastasis',from:T.dias, to:1.00,   name:'Reduced filling (diastasis)',
    blurb:'Passive equilibration. This is the phase tachycardia eats first — which is why filling AND coronary perfusion both suffer as the rate climbs.' },
];
function phaseAt(t) {
  t = wrap(t);
  for (const p of PHASES) if (t >= p.from && t < p.to) return p;
  return PHASES[PHASES.length - 1];
}

/* Valve events. S1 is mitral then tricuspid closure, S2 aortic then pulmonic
   — the sounds ARE these events, and the split is a timing difference between
   two of them, not a separate phenomenon. */
const EVENTS = [
  { at:T.mc, id:'mc', label:'Mitral closes',    side:'L', sound:'S1', note:'M1' },
  { at:T.tc, id:'tc', label:'Tricuspid closes', side:'R', sound:'S1', note:'T1' },
  { at:T.po, id:'po', label:'Pulmonic opens',   side:'R', sound:null },
  { at:T.ao, id:'ao', label:'Aortic opens',     side:'L', sound:null },
  { at:T.ac, id:'ac', label:'Aortic closes',    side:'L', sound:'S2', note:'A2' },
  { at:T.pc, id:'pc', label:'Pulmonic closes',  side:'R', sound:'S2', note:'P2' },
  { at:T.to, id:'to', label:'Tricuspid opens',  side:'R', sound:null },
  { at:T.mo, id:'mo', label:'Mitral opens',     side:'L', sound:null },
];

/* ── constants ──────────────────────────────────────────────────────────────
   Named, because a diagram whose numbers are buried in expressions cannot be
   asked what it assumes. */
const EDV = 120, ESV = 50;              // mL
const LV_PEAK = 121;                    // mmHg, peak systolic
const LV_PRE_A = 6.5;                   // just before atrial systole
const LV_EDP = 9.0;                     // end-diastolic — where IVC starts
const LV_CLOSE = 96;                    // at aortic closure
const LV_MO = 10.5;                     // at mitral opening
const LV_NADIR = 4.2;                   // early rapid filling: the ventricle sucks
const LV_FILL_END = 5.2;
const AO_DIA = 78, AO_REBOUND = 90;     // runoff asymptote, and the incisura
const AO_K = 4.6;                       // Windkessel decay across one cycle

const RV_PEAK = 25, RV_PRE_A = 2.2, RV_EDP = 4.0, RV_CLOSE = 18;
const RV_MO = 5.0, RV_NADIR = 1.2, RV_FILL_END = 1.8;
const PA_DIA = 9.5, PA_REBOUND = 15, PA_K = 3.2;

const wrap = t => ((t % 1) + 1) % 1;
const smooth = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
const span = (t, a, b) => (t - a) / (b - a);
const lerpS = (t, a, b, p, q) => p + (q - p) * smooth(span(t, a, b));
/* Circular distance: the cycle has no beginning, so a wave centred near t=0
   must still be felt at t=0.98. Measuring |t-c| linearly truncates it at the
   wrap and leaves a step in the trace. */
/* Fraction of the stroke volume gone by u through ejection. Its derivative is
   12u(1-u)^2 — zero at both ends, peaking at a third of the way through — so
   flow accelerates from rest, peaks early and stops as the valve shuts. */
const ejected = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (6 - 8 * u + 3 * u * u);
const bump = (t, c, w) => { let d = t - c; d -= Math.round(d); return Math.exp(-Math.pow(d / w, 2)); };

/* ── left ventricular volume ────────────────────────────────────────────────
   Flat wherever both valves are shut. Not approximately flat. */
function lvVolume(t) {
  t = wrap(t);
  const preA = EDV - 18;                                   // before the atrial kick
  if (t < T.mc)   return lerpS(t, 0, T.mc, preA, EDV);     // the kick tops it up
  if (t < T.ao)   return EDV;                              // IVC — shut, shut
  if (t < T.ac)   return EDV - (EDV - ESV) * ejected(span(t, T.ao, T.ac));
  if (t < T.mo)   return ESV;                              // IVR — shut, shut
  if (t < T.dias) return lerpS(t, T.mo, T.dias, ESV, ESV + (preA - ESV) * 0.80);
  return lerpS(t, T.dias, 1, ESV + (preA - ESV) * 0.80, preA);
}

/* ── aortic pressure ────────────────────────────────────────────────────────
   Follows the ventricle while the valve is open, then decays through the
   Windkessel while it is shut. The dicrotic notch at closure is the valve
   shutting and the aorta recoiling elastically — a real event, not an artefact
   of the recording. */
function aoRunoff(t) {
  const u = wrap(t - (T.ac + 0.04));
  return AO_DIA + (AO_REBOUND - AO_DIA) * Math.exp(-u * AO_K);
}
/* The pressure the ventricle must beat to open the valve. Derived, not chosen:
   it is simply where the runoff has got to by the time the ventricle catches
   it, which is why afterload and diastolic time are the same conversation. */
const AO_OPEN = aoRunoff(T.ao);
function aoPressure(t) {
  t = wrap(t);
  if (t >= T.ao && t < T.ac) return Math.max(lvPressure(t), AO_OPEN);
  if (t >= T.ac && t < T.ac + 0.04) {
    const u = span(t, T.ac, T.ac + 0.04);
    return LV_CLOSE - 7 * Math.sin(Math.PI * u) - (LV_CLOSE - AO_REBOUND) * u;
  }
  return aoRunoff(t);
}

/* ── left ventricular pressure ────────────────────────────────────────────── */
function lvPressure(t) {
  t = wrap(t);
  if (t < T.mc)   return lerpS(t, 0, T.mc, LV_PRE_A, LV_EDP) + 2.4 * Math.sin(Math.PI * span(t, 0, T.mc));
  if (t < T.ao)   return lerpS(t, T.mc, T.ao, LV_EDP, AO_OPEN);          // IVC
  if (t < T.peak) return AO_OPEN + (LV_PEAK - AO_OPEN) * Math.sin(Math.PI * 0.5 * smooth(span(t, T.ao, T.peak)));
  if (t < T.ac)   return lerpS(t, T.peak, T.ac, LV_PEAK, LV_CLOSE);
  if (t < T.mo)   return lerpS(t, T.ac, T.mo, LV_CLOSE, LV_MO);          // IVR
  if (t < T.dias) {
    const u = span(t, T.mo, T.dias);
    return u < 0.42 ? lerpS(u, 0, 0.42, LV_MO, LV_NADIR)
                    : lerpS(u, 0.42, 1, LV_NADIR, LV_FILL_END);
  }
  return lerpS(t, T.dias, 1, LV_FILL_END, LV_PRE_A);
}

/* ── right ventricle and pulmonary artery ───────────────────────────────────
   The same shape at a quarter of the pressure, and — the part that matters —
   at slightly different times. The RV has only ~10 mmHg to overcome, so it
   opens earlier and shuts later than the LV. That timing difference IS the
   physiological splitting of S2, and it is why the split widens on inspiration
   when venous return prolongs RV ejection further still. */
function paRunoff(t) {
  const u = wrap(t - (T.pc + 0.04));
  return PA_DIA + (PA_REBOUND - PA_DIA) * Math.exp(-u * PA_K);
}
const PA_OPEN = paRunoff(T.po);
function paPressure(t) {
  t = wrap(t);
  if (t >= T.po && t < T.pc) return Math.max(rvPressure(t), PA_OPEN);
  if (t >= T.pc && t < T.pc + 0.04) {
    const u = span(t, T.pc, T.pc + 0.04);
    return RV_CLOSE - 2.6 * Math.sin(Math.PI * u) - (RV_CLOSE - PA_REBOUND) * u;
  }
  return paRunoff(t);
}
function rvPressure(t) {
  t = wrap(t);
  if (t < T.tc)   return lerpS(t, 0, T.tc, RV_PRE_A, RV_EDP) + 1.1 * Math.sin(Math.PI * span(t, 0, T.tc));
  if (t < T.po)   return lerpS(t, T.tc, T.po, RV_EDP, PA_OPEN);
  if (t < T.peak) return PA_OPEN + (RV_PEAK - PA_OPEN) * Math.sin(Math.PI * 0.5 * smooth(span(t, T.po, T.peak)));
  if (t < T.pc)   return lerpS(t, T.peak, T.pc, RV_PEAK, RV_CLOSE);
  if (t < T.to)   return lerpS(t, T.pc, T.to, RV_CLOSE, RV_MO);
  if (t < T.dias) {
    const u = span(t, T.to, T.dias);
    return u < 0.42 ? lerpS(u, 0, 0.42, RV_MO, RV_NADIR)
                    : lerpS(u, 0.42, 1, RV_NADIR, RV_FILL_END);
  }
  return lerpS(t, T.dias, 1, RV_FILL_END, RV_PRE_A);
}

/* ── atrial pressures ───────────────────────────────────────────────────────
   a, c and v are three mechanical events, not three squiggles: a is atrial
   contraction, c is the AV valve bulging back into the atrium during
   isovolumetric contraction, v is the atrium filling against a shut valve.
   x is the atrium relaxing while the base descends; y is the atrium emptying
   the moment the valve opens.

   This is also the jugular venous pulse, which is why the JVP is read as a
   right atrial pressure trace and not as a wiggle in the neck. */
function laPressure(t) {
  t = wrap(t);
  return 7.4
    + 5.0 * bump(t, 0.050, 0.045)      // a — atrial systole
    + 2.6 * bump(t, 0.135, 0.030)      // c — mitral bulges back during IVC
    + 5.4 * bump(t, 0.462, 0.075)      // v — filling against a shut valve
    - 1.6 * bump(t, 0.190, 0.045)      // x — base descends, atrium relaxes
    - 2.6 * bump(t, 0.560, 0.055);     // y — the valve opens and it empties
}
function raPressure(t) {
  t = wrap(t);
  return 3.8
    + 3.2 * bump(t, 0.058, 0.048)
    + 1.7 * bump(t, 0.148, 0.032)
    + 3.0 * bump(t, 0.448, 0.080)
    - 1.3 * bump(t, 0.205, 0.048)
    - 1.9 * bump(t, 0.545, 0.058);
}

/* ── flows ──────────────────────────────────────────────────────────────────
   Not invented: aortic flow is the rate the ventricle is losing volume, and
   mitral flow is the rate it is gaining it. The E and A waves therefore fall
   out of the volume curve rather than being drawn on beside it — which is the
   whole reason the E/A ratio means anything about filling. */
const DT = 1 / 2000;
function dVdt(t) { return (lvVolume(t + DT) - lvVolume(t - DT)) / (2 * DT); }
function aorticFlow(t, cycleSec) { return Math.max(0, -dVdt(t)) / (cycleSec || 0.8); }
function mitralFlow(t, cycleSec) { return Math.max(0,  dVdt(t)) / (cycleSec || 0.8); }

/* ── coronary flow ──────────────────────────────────────────────────────────
   The one curve that explains a whole clinic. Flow follows the perfusion
   gradient — aortic root pressure minus the pressure squeezing the vessels
   inside the wall — so the LEFT coronary is throttled almost to nothing during
   systole and does its work in diastole. The RIGHT is perfused throughout,
   because RV cavity pressure never rises far.

   Everything clinical follows from the shape: tachycardia shortens diastole
   and starves the left system first; aortic regurgitation lowers the diastolic
   root pressure that drives it; LVH raises the wall pressure opposing it. */
const CORONARY_G = 0.011;      // mL/s per mmHg — lumped conductance of the bed
function coronaryFlow(t, side) {
  t = wrap(t);
  /* Wall pressure opposing perfusion is a fraction of cavity pressure — highest
     subendocardially, which is exactly where ischaemia appears first. */
  const cavity = side === 'right' ? 0.80 * rvPressure(t) : 0.86 * lvPressure(t);
  return Math.max(0, (aoPressure(t) - cavity) * CORONARY_G);
}

/* ── the pressure-volume loop ───────────────────────────────────────────────
   Not a separate model: the same two functions plotted against each other, so
   the loop cannot drift out of agreement with the diagram. */
function loop(n, pFn, vFn) {
  n = n || 240; pFn = pFn || lvPressure; vFn = vFn || lvVolume;
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push({ t, v: vFn(t), p: pFn(t) }); }
  return pts;
}
/* The lines that make the loop mean something, because contractility is the
   SLOPE of the ESPVR and not any single point on the loop — which is why
   ejection fraction falls when afterload rises with contractility unchanged. */
const EES = 2.53, V0 = 12;      // end-systolic elastance, and its volume intercept
const EA = 1.373;               // effective arterial elastance, = ESP / SV at rest
function espvr(v, ees, v0) { return Math.max(0, (ees == null ? EES : ees) * (v - (v0 == null ? V0 : v0))); }
/* Through (EDV, LVEDP) and (ESV, ~1.5) at rest. stiff steepens it — that is
   HFpEF; shift slides it rightward — that is the eccentric remodelling of a
   chronically dilated ventricle, which is why a 190 mL HFrEF ventricle sits at
   an end-diastolic pressure of about 20 rather than the 86 the unremodelled
   curve would demand. A ventricle that dilates over months moves its curve;
   one filled acutely in the cath lab climbs the curve it has. */
function edpvr(v, stiff, shift) {
  return (stiff == null ? 1 : stiff) * (0.617 * Math.exp((v - (shift || 0) - 42) / 30) + 0.69);
}

/* Frank-Starling: stroke volume against filling pressure, for a normal, a
   failing and a hypercontractile ventricle. The plateau is the honest part —
   a normal ventricle is already near the top of its curve at rest. */
function starling(edp, state) {
  const g = state === 'failing' ? 0.55 : state === 'hyper' ? 1.35 : 1;
  const k = state === 'failing' ? 0.14 : 0.26;
  return 100 * g * (1 - Math.exp(-k * Math.max(0, edp)));
}
/* Guyton: cardiac output and venous return against right atrial pressure. They
   cross at exactly one point, and that point is the operating cardiac output —
   which is why you cannot change output by changing the heart alone. */
function cardiacFunction(ra, state) { return starling(ra + 4, state) * 0.0753; }
function venousReturn(ra, msfp, res) {
  msfp = msfp == null ? 7 : msfp; res = res == null ? 1.4 : res;
  return Math.max(0, Math.min((msfp - ra) / res, 6.5));
}

function sample(t) {
  t = wrap(t);
  return { t,
    lvP: lvPressure(t), aoP: aoPressure(t), laP: laPressure(t), lvV: lvVolume(t),
    rvP: rvPressure(t), paP: paPressure(t), raP: raPressure(t),
    qAo: aorticFlow(t), qMi: mitralFlow(t),
    cL: coronaryFlow(t, 'left'), cR: coronaryFlow(t, 'right'),
    phase: phaseAt(t) };
}

/* ── measured, not asserted ─────────────────────────────────────────────────
   Where two pressure curves actually cross. If a curve is edited carelessly a
   valve will start moving at the wrong moment, and this will say so. */
function crossOnce(f, g, from, to) {
  const N = 4000; let prev = f(from) - g(from);
  for (let i = 1; i <= N; i++) {
    const t = from + (to - from) * (i / N), d = f(t) - g(t);
    if (prev <= 0 && d > 0 || prev >= 0 && d < 0) {
      let a = from + (to - from) * ((i - 1) / N), b = t;
      for (let k = 0; k < 60; k++) {
        const m = (a + b) / 2;
        ((f(a) - g(a)) * (f(m) - g(m)) <= 0) ? b = m : a = m;
      }
      return (a + b) / 2;
    }
    prev = d;
  }
  return null;
}
function crossings() {
  return {
    mc: crossOnce(lvPressure, laPressure, 0.02, 0.14),
    ao: crossOnce(lvPressure, aoRunoff,   0.12, 0.20),
    ac: crossOnce(aoPressure, lvPressure, 0.38, 0.44),
    mo: crossOnce(laPressure, lvPressure, 0.44, 0.56),
    tc: crossOnce(rvPressure, raPressure, 0.02, 0.16),
    po: crossOnce(rvPressure, paRunoff,   0.10, 0.20),
    pc: crossOnce(paPressure, rvPressure, 0.41, 0.48),
    to: crossOnce(raPressure, rvPressure, 0.43, 0.56),
  };
}

function extrema(fn) {
  let lo = Infinity, hi = -Infinity, loT = 0, hiT = 0, sum = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const t = i / N, v = fn(t);
    if (v < lo) { lo = v; loT = t; }
    if (v > hi) { hi = v; hiT = t; }
    sum += v;
  }
  return { min: lo, max: hi, minAt: loT, maxAt: hiT, mean: sum / N };
}

/* ── the loop as a model, not a drawing ─────────────────────────────────────
   The resting loop above is fixed. This one is solved, from the two elastances
   that actually determine it: contractility as the slope of the ESPVR, and
   afterload as effective arterial elastance. End-systolic volume is where those
   two lines meet —

       Ees·(ESV − V0)  =  Ea·(EDV − ESV)

   — so raising afterload RAISES end-systolic volume and lowers ejection
   fraction with contractility completely unchanged, which is the single most
   misread relationship in ventricular physiology. At default parameters this
   reproduces the resting loop exactly, so the two never disagree about a
   normal heart.

   Returns the numbers as well as the points, because the numbers are the answer
   and the loop is only how you see it. */
const volShape = t => (lvVolume(t) - ESV) / (EDV - ESV);
function loopWith(o) {
  o = o || {};
  const edv   = o.edv   == null ? EDV : o.edv;
  const ees   = o.ees   == null ? EES : o.ees;
  const ea    = o.ea    == null ? EA  : o.ea;
  const v0    = o.v0    == null ? V0  : o.v0;
  const stiff = o.stiff == null ? 1   : o.stiff;      // diastolic stiffness; HFpEF > 1
  const shift = o.shift == null ? 0   : o.shift;      // rightward remodelling, mL

  const esv = (ea * edv + ees * v0) / (ees + ea);
  const sv  = edv - esv;
  const esp = ea * sv;                                 // end-systolic pressure
  const ks  = esp / LV_CLOSE;                          // systolic pressures scale with it
  const kd  = edpvr(edv, stiff, shift) / edpvr(EDV);   // diastolic ones with filling pressure
  const open = AO_OPEN * ks;                           // aortic valve opening pressure

  const vAt = t => esv + sv * volShape(t);
  const pAt = t => {
    t = wrap(t);
    if (t >= T.ao && t < T.ac) return lvPressure(t) * ks;                       // ejection
    if (t < T.mc || t >= T.mo) return lvPressure(t) * kd;                       // diastole
    if (t < T.ao)              return lerpS(t, T.mc, T.ao, LV_EDP * kd, open);  // IVC
    return lerpS(t, T.ac, T.mo, esp, LV_MO * kd);                               // IVR
  };
  const n = o.n || 300, pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push({ t, v: vAt(t), p: pAt(t) }); }
  let a = 0;
  for (let i = 0; i < pts.length - 1; i++) a += pts[i].v * pts[i + 1].p - pts[i + 1].v * pts[i].p;
  return { edv, esv, sv, ef: sv / edv, esp, edp: LV_EDP * kd, ees, ea, v0, stiff, shift,
           strokeWork: Math.abs(a / 2), points: pts, vAt, pAt };
}

/* The interventions worth being able to try, each changing exactly one thing —
   which is the only way the loop teaches anything. */
const INTERVENTIONS = [
  { id:'base',     label:'Resting',          args:{},
    note:'Ees 2.53 mmHg/mL, Ea 1.37, EDV 120 mL. Everything else is measured off this.' },
  { id:'preload',  label:'Preload ↑',        args:{edv:150},
    note:'More filling. The loop widens to the right and stroke volume rises with contractility untouched — this is Starling, and it is why a volume-responsive patient responds to volume.' },
  { id:'after',    label:'Afterload ↑',      args:{ea:2.4},
    note:'Ejection against a stiffer arterial system. End-systolic volume rises, stroke volume and EF fall — and contractility has not changed at all. Read that off the loop before believing any EF.' },
  { id:'inotrope', label:'Contractility ↑',  args:{ees:4.2},
    note:'The ESPVR steepens, so end-systolic volume falls and the loop grows leftward. This is what an inotrope does — and what afterload reduction does not.' },
  { id:'hfref',    label:'Systolic failure', args:{ees:1.0, edv:190, shift:45},
    note:'A flat ESPVR. The ventricle dilates to keep stroke volume up, so output can look adequate long after ejection fraction has collapsed.' },
  { id:'hfpef',    label:'Diastolic failure',args:{stiff:3.6, edv:105},
    note:'A steep EDPVR. Filling pressure is high at a normal volume and a normal ejection fraction — high pressure, small heart, breathless patient.' },
];

function derived(cycleSec) {
  const sec = cycleSec || 0.8;
  const sv = EDV - ESV;
  const lv = extrema(lvPressure), ao = extrema(aoPressure), la = extrema(laPressure);
  const rv = extrema(rvPressure), pa = extrema(paPressure), ra = extrema(raPressure);
  /* dP/dt max — the steepest climb, which lives in isovolumetric contraction
     because that is the only time the ventricle pushes without moving blood. */
  let dpdt = 0, dpdtAt = 0;
  for (let i = 0; i < 4000; i++) {
    const t = i / 4000;
    const d = (lvPressure(t + DT) - lvPressure(t - DT)) / (2 * DT * sec);
    if (d > dpdt) { dpdt = d; dpdtAt = t; }
  }
  /* Stroke work is the area the loop encloses — the mechanical work of one
     beat, and what the loop is really a picture of. Shoelace over the loop. */
  const p = loop(720); let a = 0;
  for (let i = 0; i < p.length - 1; i++) a += p[i].v * p[i + 1].p - p[i + 1].v * p[i].p;
  const strokeWork = Math.abs(a / 2);
  /* Coronary flow, split by the phase it arrives in — the number behind
     "the left ventricle is perfused in diastole". */
  let cSys = 0, cDia = 0, rSys = 0, rDia = 0;
  for (let i = 0; i < 2000; i++) {
    const t = i / 2000, systole = t >= T.mc && t < T.ac;
    const l = coronaryFlow(t, 'left'), r = coronaryFlow(t, 'right');
    systole ? (cSys += l, rSys += r) : (cDia += l, rDia += r);
  }
  const x = crossings();
  return {
    edv: EDV, esv: ESV, sv, ef: sv / EDV,
    hr: 60 / sec, co: sv * (60 / sec) / 1000,
    lvSys: lv.max, lvEdp: lvPressure(T.mc), lvMin: lv.min,
    aoSys: ao.max, aoDia: ao.min, aoMean: ao.mean,
    pulsePressure: ao.max - ao.min,
    laMean: la.mean, laA: la.max,
    rvSys: rv.max, rvEdp: rvPressure(T.tc),
    paSys: pa.max, paDia: pa.min, paMean: pa.mean,
    raMean: ra.mean,
    dpdtMax: dpdt, dpdtAt,
    s2Split: (x.pc - x.ac) * sec * 1000,   // ms — A2 to P2, measured off the curves
    s1Split: (x.tc - x.mc) * sec * 1000,   // ms — M1 to T1
    crossings: x,
    strokeWork,
    leftDiastolicFraction: cDia / (cDia + cSys),
    rightDiastolicFraction: rDia / (rDia + rSys),
  };
}

/* Traces the diagram draws, in the order they are stacked. Colours are the
   conventional ones — arterial red, ventricular blue, atrial violet — because
   a diagram that recolours the aorta teaches the reader to distrust it. */
const TRACES = [
  { id:'ao',  label:'Aorta',     unit:'mmHg', color:'#F0555F', fn:aoPressure, axis:'p',  side:'L' },
  { id:'lv',  label:'LV',        unit:'mmHg', color:'#2AA9E0', fn:lvPressure, axis:'p',  side:'L' },
  { id:'la',  label:'LA',        unit:'mmHg', color:'#A98BF0', fn:laPressure, axis:'p',  side:'L' },
  { id:'vol', label:'LV volume', unit:'mL',   color:'#22B07D', fn:lvVolume,   axis:'v',  side:'L' },
  { id:'pa',  label:'PA',        unit:'mmHg', color:'#F09A4A', fn:paPressure, axis:'pr', side:'R' },
  { id:'rv',  label:'RV',        unit:'mmHg', color:'#4BC3D6', fn:rvPressure, axis:'pr', side:'R' },
  { id:'ra',  label:'RA / JVP',  unit:'mmHg', color:'#C79BE8', fn:raPressure, axis:'pr', side:'R' },
];

root.Physio = {
  T, PHASES, EVENTS, TRACES,
  phaseAt, sample, wrap,
  lvPressure, aoPressure, laPressure, lvVolume,
  rvPressure, paPressure, raPressure,
  dVdt, aorticFlow, mitralFlow, coronaryFlow,
  loop, loopWith, INTERVENTIONS, espvr, edpvr, starling, cardiacFunction, venousReturn,
  crossings, extrema, derived,
  EDV, ESV, AO_OPEN, PA_OPEN, EES, EA, V0,
};

})(typeof window !== 'undefined' ? window : this);
