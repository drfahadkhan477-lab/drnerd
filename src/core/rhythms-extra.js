/* ═══════════════════════════════════════════════════════════════════════════
   rhythms-extra.js — more arrhythmias for the ECG engine.

   The app shipped with 12 rhythms. These add the ones a board candidate
   actually gets asked to recognise on a single-lead strip: the AV blocks,
   the ectopy, the pre-excitation and conduction patterns, and the two
   electrolyte/pericardial tracings that turn up every year.

   Each generator returns millivolts for a moment in time, using the same
   gaussian-component beat model as the built-in engine so the new rhythms
   look like they belong to it rather than like a bolt-on. The beat model is
   duplicated here rather than imported so the module can be unit-tested on
   its own, without the app around it.

   Wiring: extraRhythmMV(kind, tms, state) returns null for anything it does
   not handle, so the host engine can consult it first and fall through to
   its own rhythms unchanged.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

function gauss(t, centre, width, amp) {
  const x = (t - centre) / width;
  return amp * Math.exp(-0.5 * x * x);
}

/* One PQRST complex. t is ms from the start of the P wave (or from the QRS
   when pAmp is 0). Options mirror the built-in engine's, plus a few the new
   rhythms need: delta (pre-excitation slur), notch (bundle-branch M shape),
   qtScale (repolarisation stretched), prMs (PR interval), stShape. */
function xBeat(t, o) {
  o = o || {};
  const pAmp = o.pAmp === undefined ? 0.13 : o.pAmp;
  const pr = o.prMs === undefined ? 160 : o.prMs;
  const w = o.qrsW || 1;
  const qt = o.qtScale || 1;
  let v = 0;

  if (pAmp) v += gauss(t, pr - 115, 20, pAmp);          // P, sitting PR before the R
  if (o.prDepress) v -= gauss(t, pr - 70, 26, o.prDepress);

  const q0 = pr;
  if (o.delta) {
    // pre-excitation: the upstroke starts early and slurs into the R
    v += gauss(t, q0 + 2 * w, 16 * w, o.delta);
  }
  v += gauss(t, q0 + 8 * w, 5 * w, o.qAmp === undefined ? -0.10 : o.qAmp);
  v += gauss(t, q0 + 26 * w, 9 * w, 1.05 * (o.rAmp === undefined ? 1 : o.rAmp));
  if (o.notch) {
    // second peak — the R' of a bundle-branch pattern
    v += gauss(t, q0 + 26 * w + o.notch.gap, 8 * w, o.notch.amp);
  }
  v += gauss(t, q0 + 48 * w, 10 * w, o.sAmp === undefined ? -0.22 : o.sAmp);

  const stStart = q0 + 60 * w;
  if (o.stElev) {
    if (t > stStart && t < stStart + 130 * qt) {
      // concave ("saddle") vs the convex tombstone of infarction
      const frac = (t - stStart) / (130 * qt);
      v += o.concave ? o.stElev * (0.55 + 0.45 * Math.sin(frac * Math.PI)) : o.stElev;
    }
  }
  v += gauss(t, q0 + 230 * w * qt, 55 * w * qt,
             o.tAmp === undefined ? 0.28 : o.tAmp);
  return v;
}

/* Definitions. hr is the ventricular rate the readout should show. */
const EXTRA = {
  sinus_arrhythmia: { name: 'Sinus Arrhythmia', hr: 72,
    desc: 'Sinus with cyclical rate variation — quickens on inspiration, slows on expiration. Normal, especially in the young.' },
  avb1: { name: 'First-Degree AV Block', hr: 64,
    desc: 'Every P conducts, but PR is fixed and long (>200 ms).' },
  mobitz1: { name: 'Mobitz I (Wenckebach)', hr: 58,
    desc: 'PR lengthens beat to beat until a P wave drops. Grouped beating; usually nodal and benign.' },
  mobitz2: { name: 'Mobitz II', hr: 50,
    desc: 'PR constant, then a P suddenly fails to conduct. Infranodal — the one that needs a pacemaker.' },
  pac: { name: 'Premature Atrial Complexes', hr: 76,
    desc: 'Early P of different morphology, narrow QRS, incomplete compensatory pause.' },
  bigeminy: { name: 'Ventricular Bigeminy', hr: 78,
    desc: 'Every sinus beat followed by a PVC — wide, no preceding P, T opposite the QRS.' },
  svt: { name: 'Supraventricular Tachycardia', hr: 186,
    desc: 'Regular, narrow, fast, with no discernible P waves. Terminates with adenosine or vagal manoeuvres.' },
  junctional: { name: 'Junctional Escape', hr: 46,
    desc: 'Narrow QRS at 40–60 with absent or retrograde P waves — the AV node taking over.' },
  idioventricular: { name: 'Idioventricular Escape', hr: 34,
    desc: 'Wide, slow, no P waves. The ventricle escaping when everything above it has failed.' },
  wpw: { name: 'Wolff-Parkinson-White', hr: 74,
    desc: 'Short PR with a delta wave slurring into a widened QRS — pre-excitation down an accessory pathway.' },
  lbbb: { name: 'Left Bundle Branch Block', hr: 70,
    desc: 'QRS >120 ms, broad and notched. Obscures the usual infarct criteria.' },
  rbbb: { name: 'Right Bundle Branch Block', hr: 70,
    desc: 'QRS >120 ms with an RSR′ — the second peak of the classic "rabbit ears".' },
  hyperk: { name: 'Hyperkalemia', hr: 62,
    desc: 'Tall peaked T waves, flattening P, widening QRS — the progression toward a sine wave.' },
  longqt: { name: 'Long QT', hr: 66,
    desc: 'Markedly prolonged repolarisation — the substrate for torsades.' },
  pericarditis: { name: 'Acute Pericarditis', hr: 88,
    desc: 'Diffuse concave ST elevation with PR depression — not a coronary territory.' },
};

/* Deterministic pseudo-random from an integer, so a trace looks irregular but
   is stable frame to frame (the built-in AF generator uses the same trick). */
function hash01(n) { return Math.abs(Math.sin(n * 12.9898) * 43758.5453) % 1; }

function extraRhythmMV(kind, tms, state) {
  const st = state || {};
  const def = EXTRA[kind];
  if (!def) return null;
  const RR = 60000 / def.hr;

  switch (kind) {
    case 'sinus_arrhythmia': {
      // respiratory sinus arrhythmia: RR breathes on a ~4s cycle
      if (st.next === undefined) { st.next = 0; st.rr = RR; st.n = 0; }
      while (tms >= st.next + st.rr) {
        st.next += st.rr; st.n++;
        st.rr = RR * (1 + 0.17 * Math.sin(st.next / 4000 * Math.PI * 2));
      }
      return xBeat(tms - st.next, {});
    }
    case 'avb1':
      return xBeat(tms % RR, { prMs: 320 });

    case 'mobitz1': {
      // Wenckebach: PR 160 → 220 → 280 → dropped, then the cycle restarts
      if (st.next === undefined) { st.next = 0; st.i = 0; }
      const prs = [160, 220, 280, null];
      while (tms >= st.next + RR) { st.next += RR; st.i = (st.i + 1) % prs.length; }
      const pr = prs[st.i];
      const t = tms - st.next;
      if (pr === null) return gauss(t, 45, 20, 0.13);      // P alone, nothing follows
      return xBeat(t, { prMs: pr });
    }
    case 'mobitz2': {
      if (st.next === undefined) { st.next = 0; st.i = 0; }
      while (tms >= st.next + RR) { st.next += RR; st.i = (st.i + 1) % 3; }
      const t = tms - st.next;
      if (st.i === 2) return gauss(t, 45, 20, 0.13);       // dropped, PR never varied
      return xBeat(t, { prMs: 180 });
    }
    case 'pac': {
      if (st.rr0 === undefined) { st.rr0 = RR; st.next = 0; st.n = 0; }
      // every 4th beat arrives early, with a differently shaped P and a pause after
      while (tms >= st.next + st.rr0) {
        st.next += st.rr0; st.n++;
        st.rr0 = (st.n % 4 === 3) ? RR * 0.62 : (st.n % 4 === 0 ? RR * 1.18 : RR);
      }
      const early = st.n % 4 === 3;
      return xBeat(tms - st.next, early ? { pAmp: 0.09, prMs: 140 } : {});
    }
    case 'bigeminy': {
      if (st.next === undefined) { st.next = 0; st.n = 0; st.rr0 = RR; }
      while (tms >= st.next + st.rr0) { st.next += st.rr0; st.n++;
        st.rr0 = (st.n % 2 === 1) ? RR * 0.55 : RR * 1.35; }   // early PVC, then a pause
      const t = tms - st.next;
      return (st.n % 2 === 1)
        ? xBeat(t, { pAmp: 0, prMs: 40, qrsW: 2.3, rAmp: 1.2, tAmp: -0.36, sAmp: -0.3 })
        : xBeat(t, {});
    }
    case 'svt':
      return xBeat(tms % RR, { pAmp: 0, prMs: 40, tAmp: 0.20 });

    case 'junctional':
      return xBeat(tms % RR, { pAmp: 0, prMs: 60, tAmp: 0.26 });

    case 'idioventricular':
      return xBeat(tms % RR, { pAmp: 0, prMs: 60, qrsW: 2.6, rAmp: 1.1, tAmp: -0.34 });

    case 'wpw':
      return xBeat(tms % RR, { prMs: 105, delta: 0.30, qrsW: 1.45, tAmp: -0.18 });

    case 'lbbb':
      return xBeat(tms % RR, { qrsW: 2.0, rAmp: 1.15, notch: { gap: 34, amp: 0.55 },
                               tAmp: -0.30, sAmp: -0.16 });
    case 'rbbb':
      return xBeat(tms % RR, { qrsW: 1.85, rAmp: 0.85, notch: { gap: 40, amp: 0.95 },
                               sAmp: -0.30, tAmp: -0.20 });
    case 'hyperk':
      return xBeat(tms % RR, { pAmp: 0.03, qrsW: 1.55, tAmp: 0.95, qtScale: 0.82 });

    case 'longqt':
      return xBeat(tms % RR, { qtScale: 1.85, tAmp: 0.24 });

    case 'pericarditis':
      return xBeat(tms % RR, { stElev: 0.16, concave: true, prDepress: 0.07, tAmp: 0.30 });
  }
  return null;
}

root.RhythmsExtra = { EXTRA, extraRhythmMV, xBeat, hash01 };

})(typeof window !== 'undefined' ? window : this);
