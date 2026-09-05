#!/usr/bin/env node
/*
 * The 12-lead's geometry, in bare Node — no browser, no build.
 *
 *   node tests/verify-leads-pure.js
 *
 * Companion to verify-physio-pure.js, for the same reason: src/core/leads12.js
 * derives all twelve leads by projecting one moving electrical dipole onto
 * twelve fixed axes. That is linear algebra and needs no DOM, but its existing
 * suite renders the strip through Playwright and so cannot run where CI runs.
 *
 * These are Einthoven's and Goldberger's relations, which are not conventions
 * this project chose — they follow from the electrode positions, and any
 * implementation that violates them is drawing an ECG that could not exist.
 * That makes them exactly the right thing to assert without a browser: they
 * cannot drift with a retuned waveform, only with a broken derivation.
 *
 * WHAT THE SECOND HALF ADDS, AND WHY NOT AN ORACLE. The adoption plan proposed
 * checking this module against NeuroKit2's ecg_simulate the way the scheduler
 * is checked against ts-fsrs. It should not be. NeuroKit2's multileads method
 * is itself a synthetic dipole model, so comparing the two would establish
 * that two modelling choices differ — which they would, and neither would be
 * wrong. An oracle is only an oracle when one side is authoritative.
 *
 * What IS authoritative about a 12-lead is the clinical picture: aVR looks
 * into the cavity and is negative, V1 is rS and V6 its mirror, the R/S ratio
 * climbs across the precordium, inferior infarcts show in II/III/aVF WITH
 * reciprocal depression in I and aVL. Those are facts about hearts, not about
 * anybody's simulator, and they are what the second half of this file asserts.
 * They were written after measuring the module, not before: every threshold is
 * what leads12.js actually produces, and the assertions are the clinical facts
 * those measurements turned out to satisfy.
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
new Function('module', 'exports', fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'leads12.js'), 'utf8'))
  .call(mod, { exports: mod }, mod);
const L = mod.Leads12;

const TS = Array.from({ length: 400 }, (_, i) => i / 400);
const byId = Object.fromEntries(L.LEADS.map(l => [l.id, l]));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const maxAbs = xs => Math.max(...xs.map(Math.abs));

head('the module loads and describes a whole 12-lead');
ok('Leads12 is exported from a bare require', !!L && typeof L.sample === 'function');
ok('there are exactly twelve leads',
   L.LEADS.length === 12, `${L.LEADS.length}`);
ok('six limb and six precordial',
   L.LEADS.filter(l => l.group === 'limb').length === 6 &&
   L.LEADS.filter(l => l.group !== 'limb').length === 6);
ok('every lead has a unit axis',
   L.LEADS.every(l => Math.abs(Math.hypot(...l.axis) - 1) < 1e-9));
ok('every supported rhythm samples finite everywhere',
   L.SUPPORTED.every(r => TS.every(t => Number.isFinite(L.sample('II', t, r)))),
   L.SUPPORTED.join(','));

head("Einthoven's triangle: the limb leads are not independent");
/* II = I + III, exactly, at every instant. It is the defining constraint of
   the limb leads, and the one an implementation breaks first if a sign or an
   angle is wrong. */
const einthoven = TS.map(t => L.sample('II', t) - (L.sample('I', t) + L.sample('III', t)));
ok('II = I + III at every sample', maxAbs(einthoven) < 1e-9, `max |error| ${maxAbs(einthoven).toExponential(2)}`);

/* THE AUGMENTED LEADS, AND THE ONE CONSTANT THAT SITS IN FRONT OF THEM.
   Goldberger's relations are aVR = −(I+II)/2, aVL = (I−III)/2,
   aVF = (II+III)/2. Here each holds exactly — but scaled by 2/√3, measured
   as 1.154700538 with a range of zero across every sample of all three
   leads. That is not drift and not an error: this module normalises every
   lead axis to unit length (asserted above), where Goldberger's arithmetic
   implies augmented axes of magnitude √3/2. The consequence, worth knowing
   rather than hiding behind a loose tolerance, is that the augmented leads
   are drawn about 15.5% larger relative to the limb leads than a clinical
   ECG would show them — a deliberate display choice in a strip whose own
   header calls it schematic and meant for pattern recognition, not
   measurement.

   Asserting the exact constant is a stronger check than the textbook form:
   it fails if an axis stops being unit length, if a sign flips, or if the
   scaling ever becomes inconsistent between the three. */
const AUG = 2 / Math.sqrt(3);
const augErr = (id, fn) => TS.map(t => L.sample(id, t) - AUG * fn(t));
const avrErr = augErr('aVR', t => -(L.sample('I', t) + L.sample('II', t)) / 2);
ok('aVR = −(I + II)/2, scaled by the unit-axis constant, at every sample',
   maxAbs(avrErr) < 1e-9, `max |error| ${maxAbs(avrErr).toExponential(2)}`);
const avlErr = augErr('aVL', t => (L.sample('I', t) - L.sample('III', t)) / 2);
ok('aVL = (I − III)/2, same constant, at every sample',
   maxAbs(avlErr) < 1e-9, `max |error| ${maxAbs(avlErr).toExponential(2)}`);
const avfErr = augErr('aVF', t => (L.sample('II', t) + L.sample('III', t)) / 2);
ok('aVF = (II + III)/2, same constant, at every sample',
   maxAbs(avfErr) < 1e-9, `max |error| ${maxAbs(avfErr).toExponential(2)}`);
ok('and the constant is the same for all three — one normalisation, not three fudges',
   [avrErr, avlErr, avfErr].every(e => maxAbs(e) < 1e-9));

/* The three augmented axes sum to zero — the other half of Goldberger. */
const sumAug = ['aVR', 'aVL', 'aVF'].reduce((acc, id) =>
  acc.map((v, i) => v + byId[id].axis[i]), [0, 0, 0]);
ok('the three augmented axes sum to the zero vector',
   maxAbs(sumAug) < 1e-9, `[${sumAug.map(v => v.toExponential(1)).join(', ')}]`);

head('aVR looks the other way, which is why it is the odd one out');
ok('aVR points opposite the mean of I and II',
   dot(byId.aVR.axis, [1, 0, 0]) < 0 && dot(byId.aVR.axis, byId.II.axis) < 0,
   `I·aVR ${dot(byId.aVR.axis, [1, 0, 0]).toFixed(3)}, II·aVR ${dot(byId.aVR.axis, byId.II.axis).toFixed(3)}`);
const rNet = TS.reduce((n, t) => n + L.sample('aVR', t), 0);
const iiNet = TS.reduce((n, t) => n + L.sample('II', t), 0);
ok('so its net deflection is inverted relative to II in normal sinus',
   Math.sign(rNet) === -Math.sign(iiNet), `aVR ${rNet.toFixed(2)} vs II ${iiNet.toFixed(2)}`);

head('every lead really is a projection of the one dipole');
/* This is the claim the whole module rests on: there is a single moving
   vector, and a lead is that vector dotted with a fixed direction. If any
   lead were computed some other way, this identity would not hold. */
for (const id of ['I', 'II', 'III', 'aVF']) {
  const err = TS.map(t => L.sample(id, t) - dot(L.dipoleAt(t, 'sinus'), byId[id].axis));
  ok(`${id} equals dipole · axis at every sample`, maxAbs(err) < 1e-9,
     `max |error| ${maxAbs(err).toExponential(2)}`);
}

head('the limb axes sit where the electrodes put them');
const deg = ax => Math.round(Math.atan2(ax[1], ax[0]) * 180 / Math.PI);
ok('I at 0°', deg(byId.I.axis) === 0, `${deg(byId.I.axis)}°`);
ok('II at 60°', deg(byId.II.axis) === 60, `${deg(byId.II.axis)}°`);
ok('III at 120°', deg(byId.III.axis) === 120, `${deg(byId.III.axis)}°`);
ok('aVF at 90°', deg(byId.aVF.axis) === 90, `${deg(byId.aVF.axis)}°`);
ok('aVL at −30°', deg(byId.aVL.axis) === -30, `${deg(byId.aVL.axis)}°`);
ok('aVR at −150°', deg(byId.aVR.axis) === -150, `${deg(byId.aVR.axis)}°`);

head('the strip is a strip');
const strip = L.strip('II', 'sinus');
ok('strip returns samples for a supported rhythm', !!strip && strip.length > 0, `${strip && strip.length}`);
ok('and every one of them is finite', strip.every(v => Number.isFinite(typeof v === 'number' ? v : v.y)));

/* ═══════════════════════════════════════════════════════════════════════════
   WHAT THE MODULE CLAIMS, CHECKED

   Everything above is algebra: Einthoven and Goldberger follow from electrode
   positions and would hold for any dipole whatsoever, including a nonsense
   one. They prove the derivation is consistent. They cannot prove it produces
   an ECG a cardiologist would recognise.

   What follows does. It was written after measuring the module rather than
   before — every number below is what leads12.js actually produces, and the
   assertions are the clinical facts those numbers turned out to satisfy.
   ═══════════════════════════════════════════════════════════════════════════ */

const dot3 = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];

/* MEASURED OFF strip(), NOT sample(), AND THE DIFFERENCE MATTERS.
   dipoleAt()/sample() render one beat on a timeline where the QRS straddles
   the origin: the R peak is at about +3ms and the SEPTAL r sits at NEGATIVE
   time. A window of 0..55ms therefore catches half a QRS and reports V1 as
   having no r wave at all, which is what the first draft of this file did.

   strip() is the repeating rhythm, and it is what the app draws. So the beat
   is located inside a strip and every window is taken around it. Slower work,
   truer answer. */
const SR = 1;                                   // ms per sample
const stripOf = (id, r) => L.strip(id, r, { ms: 3000, step: SR });
/* Locate the second QRS in the strip — the second, so a full beat of baseline
   exists on either side of it. Found on the vector magnitude rather than on
   any one lead, since a lead can be isoelectric. */
const beatIndex = (() => {
  const cache = {};
  return r => {
    if (cache[r]) return cache[r];
    const xs = ['I','aVF','V2'].map(id => stripOf(id, r));
    const mag = xs[0].map((_, i) => Math.hypot(xs[0][i], xs[1][i], xs[2][i]));
    const gmax = Math.max(...mag);
    const found = [];
    for (let i = 1; i < mag.length - 1; i++)
      if (mag[i] >= mag[i - 1] && mag[i] > mag[i + 1] && mag[i] > gmax * 0.6) found.push(i);
    return (cache[r] = found[1] !== undefined ? found[1] : found[0]);
  };
})();
const window = (id, r, from, to) => {
  const c = beatIndex(r), st = stripOf(id, r);
  const out = [];
  for (let i = c + from; i <= c + to; i++) if (st[i] !== undefined) out.push(st[i]);
  return out;
};
/* A QRS is about 90ms wide and centred a little after its own R peak. */
const netQRS = (id, r) => window(id, r, -45, 45).reduce((a, b) => a + b, 0);
const peaks = (id, r) => {
  const w = window(id, r, -45, 45);
  const R = Math.max(...w), S = Math.min(...w);
  return { R, S, rs: R / Math.abs(S || 1e-9) };
};
/* ST level against the diastolic baseline, which is flat well before the next P. */
const stShift = (id, r) => {
  const mean = w => w.reduce((a, b) => a + b, 0) / w.length;
  return mean(window(id, r, 60, 110)) - mean(window(id, r, 300, 380));
};

head('the morphology is derived, not drawn — for the rhythms where it is');
{
  /* THE MODULE'S OWN THESIS: "Get the vectors right and the morphology is not
     drawn, it is derived." Measured, that is true of the conduction rhythms
     and NOT of the pathologies — afib's fibrillatory baseline, flutter waves,
     LVH voltage, and every ST shift are painted onto individual leads rather
     than carried by an injury vector the projection would distribute.

     That is a defensible shortcut and it produces clinically right pictures
     (asserted below). But it means dipoleAt() is not the whole truth for those
     rhythms — an axis computed from the dipole disagrees with one measured off
     the leads, by 14.9° in inferior STEMI. So the boundary is PINNED rather
     than left to be discovered: a rhythm that silently moves from one side of
     it to the other is a change worth noticing. */
  const PURE = ['sinus', 'brady', 'tachy', 'rbbb', 'hyperk'];
  const PAINTED = ['afib', 'flutter', 'lbbb', 'lvh', 'stemi_ant', 'stemi_inf',
                   'pericarditis', 'longqt'];

  /* THE WINDOW, AND WHY IT IS ASSERTED RATHER THAN CHOSEN. sample() renders the
     repeating rhythm; dipoleAt() renders ONE beat and is flat afterwards. So
     past a certain point every rhythm "deviates" for a reason that says nothing
     about projection: sample() has moved on to the next beat's P wave and
     dipoleAt() has not.

     The first draft hardcoded 600ms. The conduction rhythms first deviate at
     589ms. It passed by eleven milliseconds of luck, and would have started
     failing the day anyone shortened a cycle. So the comparison runs over one
     beat's own span, and the margin between that span and the next beat is
     CHECKED — a window whose validity is assumed is not a window, it is a
     coincidence waiting to be discovered. */
  const SPAN = 500;
  const firstDeviation = r => {
    for (let t = 0; t < 2000; t++)
      for (const l of L.LEADS)
        if (Math.abs(L.sample(l.id, t, r) - dot3(L.dipoleAt(t, r), l.axis)) > 1e-9) return t;
    return Infinity;
  };
  const worstFor = r => {
    let w = 0;
    for (const l of L.LEADS) for (let t = 0; t < SPAN; t++)
      w = Math.max(w, Math.abs(L.sample(l.id, t, r) - dot3(L.dipoleAt(t, r), l.axis)));
    return w;
  };

  const unclassified = L.SUPPORTED.filter(r => !PURE.includes(r) && !PAINTED.includes(r));
  ok('every supported rhythm is on one side of the line — no exceptions',
     unclassified.length === 0, unclassified.join(', ') || `${L.SUPPORTED.length} rhythms, all placed`);

  const margins = PURE.map(r => ({ r, at: firstDeviation(r) }));
  const tooTight = margins.filter(m => m.at < SPAN + 50);
  ok(`the ${SPAN}ms window really is inside one beat, with room to spare`,
     tooTight.length === 0,
     tooTight.map(m => `${m.r} deviates at ${m.at}ms`).join(', ') ||
       `earliest next-beat contamination at ${Math.min(...margins.map(m => m.at))}ms`);

  const impure = PURE.filter(r => worstFor(r) > 1e-6);
  ok('the conduction rhythms ARE the projection, to floating point', impure.length === 0,
     impure.map(r => `${r} off by ${worstFor(r).toExponential(1)}`).join(', ') || PURE.join(', '));
  const notPainted = PAINTED.filter(r => worstFor(r) <= 1e-6);
  ok('and the pathologies deliberately are not — they carry per-lead features',
     notPainted.length === 0,
     notPainted.length ? `${notPainted.join(', ')} became pure projections` : PAINTED.join(', '));
}

head('the electrical axis measured off the leads is the axis of the dipole');
{
  /* A clinician reads the axis from leads I and aVF. If the projection is
     faithful, that must equal the frontal angle of the dipole itself — not
     approximately, exactly, because it is the same linear map read twice. */
  /* BOTH SIDES ON dipoleAt()'s OWN TIMELINE, deliberately. strip() repeats the
     beat at its own phase, so a strip index is not a dipoleAt() timestamp —
     mapping one onto the other naively reports a 6° disagreement that is
     entirely the offset. Here the same t values feed both sides, which is what
     makes the comparison mean "the projection is faithful" rather than "the
     two clocks agree".

     The window spans the QRS on that timeline, which STRADDLES the origin: the
     septal phase is at negative t and the R peak just after it. */
  const QC = 3, HALF = 45;
  const netOnDipoleClock = id => {
    let s = 0;
    for (let t = QC - HALF; t <= QC + HALF; t++) s += L.sample(id, t, 'sinus');
    return s;
  };
  const axisFromLeads = r => {
    let x = 0, y = 0;
    for (let t = QC - HALF; t <= QC + HALF; t++) { x += L.sample('I', t, r); y += L.sample('aVF', t, r); }
    return Math.atan2(y, x) * 180 / Math.PI;
  };
  const axisFromDipole = r => {
    const cx = L.LEADS.find(l => l.id === 'I').axis, cy = L.LEADS.find(l => l.id === 'aVF').axis;
    let x = 0, y = 0;
    for (let t = QC - HALF; t <= QC + HALF; t++) {
      const v = L.dipoleAt(t, r);
      x += dot3(v, cx); y += dot3(v, cy);
    }
    return Math.atan2(y, x) * 180 / Math.PI;
  };
  for (const r of ['sinus', 'brady', 'tachy']) {
    const d = Math.abs(axisFromLeads(r) - axisFromDipole(r));
    ok(`${r}: the two agree`, d < 1e-6, `${axisFromLeads(r).toFixed(1)}° vs ${axisFromDipole(r).toFixed(1)}°`);
  }
  const ax = axisFromLeads('sinus');
  ok('and it is a normal axis, between −30° and +90°', ax > -30 && ax < 90, `${ax.toFixed(1)}°`);
}

head('a normal sinus 12-lead looks like a normal sinus 12-lead');
{
  ok('aVR is negative — the one lead that looks into the cavity',
     netQRS('aVR', 'sinus') < 0 && peaks('aVR', 'sinus').rs < 0.5,
     `net ${netQRS('aVR', 'sinus').toFixed(1)}, R/S ${peaks('aVR', 'sinus').rs.toFixed(2)}`);
  ok('V1 is rS — a small r then a deep S', peaks('V1', 'sinus').rs < 0.5,
     `R/S ${peaks('V1', 'sinus').rs.toFixed(2)}`);
  ok('V6 is the reverse, a dominant R', peaks('V6', 'sinus').rs > 2,
     `R/S ${peaks('V6', 'sinus').rs.toFixed(2)}`);

  /* R-WAVE PROGRESSION, STATED THE WAY IT IS ACTUALLY TRUE. The naive form —
     "R amplitude grows from V1 to V6" — is false here and in life: what grows
     across the precordium is the R/S RATIO. In V1-V4 the tallest positive
     deflection is the septal r at about −26ms, not the main R at all, so
     comparing peak heights compares two different waves. */
  const chest = ['V1','V2','V3','V4','V5','V6'].map(id => peaks(id, 'sinus').rs);
  const rising = chest.every((v, i) => i === 0 || v > chest[i-1]);
  ok('the R/S ratio rises across every precordial lead', rising,
     chest.map(v => v.toFixed(2)).join(' → '));
  const transition = ['V1','V2','V3','V4','V5','V6'].findIndex(id => peaks(id, 'sinus').rs >= 1);
  ok('and the transition sits between V2 and V5', transition >= 1 && transition <= 4,
     `V${transition + 1}`);

  const limb = ['I','II','III','aVR','aVL','aVF'].map(id => ({ id, R: peaks(id, 'sinus').R }));
  const tallest = limb.reduce((a, b) => b.R > a.R ? b : a);
  ok('II is the tallest limb lead — the dipole points nearly down its axis',
     tallest.id === 'II', `${tallest.id} at ${tallest.R.toFixed(2)} mV`);
}

head('the pathologies show where the module says they show');
{
  const inf = ['II','III','aVF'], high = ['I','aVL'], ant = ['V1','V2','V3','V4'];
  ok('inferior STEMI elevates II, III and aVF',
     inf.every(id => stShift(id, 'stemi_inf') > 0.1),
     inf.map(id => `${id} ${stShift(id,'stemi_inf').toFixed(2)}`).join(', '));
  ok('with reciprocal depression in I and aVL — the half a picture without it misses',
     high.every(id => stShift(id, 'stemi_inf') < -0.1),
     high.map(id => `${id} ${stShift(id,'stemi_inf').toFixed(2)}`).join(', '));
  ok('anterior STEMI elevates V1 through V4',
     ant.every(id => stShift(id, 'stemi_ant') > 0.1),
     ant.map(id => `${id} ${stShift(id,'stemi_ant').toFixed(2)}`).join(', '));
  ok('and depresses the inferior leads reciprocally',
     stShift('II', 'stemi_ant') < -0.1 && stShift('aVF', 'stemi_ant') < -0.1,
     `II ${stShift('II','stemi_ant').toFixed(2)}, aVF ${stShift('aVF','stemi_ant').toFixed(2)}`);
  ok('pericarditis is widespread rather than territorial',
     ['I','II','aVL','aVF','V2','V3','V4','V5','V6'].every(id => stShift(id, 'pericarditis') > 0.02),
     'elevated in both territories at once');
  ok('and aVR is its exception, as it is in life',
     stShift('aVR', 'pericarditis') < stShift('II', 'pericarditis'),
     `aVR ${stShift('aVR','pericarditis').toFixed(2)} vs II ${stShift('II','pericarditis').toFixed(2)}`);
}

head('one thing this model does that a real chest wall does not');
{
  /* V6 and lead I come out IDENTICAL — both are "straight left", and in a
     three-vector model straight left is one direction. On a patient they are
     not the same lead: V6 sits on the chest at the fifth interspace and lead I
     spans the arms, so they see the same wall from measurably different
     distances and angles.

     Recorded, not hidden. It is a consequence of the coordinate system the
     module chose on purpose, and changing it would move every V6 waveform in
     the app — a clinical-fidelity decision, not a bug fix. This assertion
     exists so the choice is visible and so it cannot change by accident. */
  const byIdAll = Object.fromEntries(L.LEADS.map(l => [l.id, l]));
  ok('V6 and I share an axis exactly, so they render the same trace',
     JSON.stringify(byIdAll.V6.axis) === JSON.stringify(byIdAll.I.axis),
     JSON.stringify(byIdAll.V6.axis));
  ok('and the strips confirm it, sample for sample',
     L.strip('V6','sinus',{ms:900,step:3}).every((v,i) => v === L.strip('I','sinus',{ms:900,step:3})[i]));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
