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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
