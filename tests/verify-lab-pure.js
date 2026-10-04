#!/usr/bin/env node
/*
 * The Lab's building blocks, held by measurement.
 *
 *   node tests/verify-lab-pure.js
 *
 * Pure Node. The Lab (heart sounds, tracings, drills) is built on src/core/physio.js
 * and carries no licensed content. These checks do not read a lesion's spec back
 * to itself: they RENDER the audio and measure it, because a spec that says
 * "holosystolic" proves nothing about a signal that is not.
 *
 *   - a render is deterministic, and finite;
 *   - S1 and S2 sit on the valve events, and moving an event in physio moves the
 *     sound (the module's one claim: sounds are valve events, not constants);
 *   - each lesion is loud where it should be and quiet where it should not be,
 *     measured as RMS in windows between valve events;
 *   - the SHAPES differ as the lesions do (aortic stenosis peaks late, mitral
 *     regurgitation is a plateau, aortic regurgitation decays);
 *   - the PITCHES differ (an aortic regurgitation murmur is high and blowing, a
 *     mitral stenosis rumble is low), measured as a spectral centroid.
 */
'use strict';
const Physio = require('../src/core/physio.js').Physio;
const H = require('../src/lab/heartsounds.js').HeartSounds;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ev = id => Physio.EVENTS.find(e => e.id === id).at;
const BEATS = 4, BPM = 72;
const cache = new Map();
const R = (id, o) => {
  const k = id + JSON.stringify(o || {});
  if (!cache.has(k)) cache.set(k, H.render(id, Object.assign({ beats: BEATS, bpm: BPM, seed: 1 }, o)));
  return cache.get(k);
};

/* RMS over [from, to] fractions of the cycle, averaged over the beats except the
   first (a presystolic murmur wraps onto the beat before it). */
function rms(r, from, to) {
  const per = Math.round(r.cycleSec * r.rate);
  let sum = 0, n = 0;
  for (let b = 1; b < r.beats; b++) {
    const a = b * per + Math.round(from * per), z = b * per + Math.round(to * per);
    for (let i = a; i < z; i++) { sum += r.samples[i] * r.samples[i]; n++; }
  }
  return Math.sqrt(sum / Math.max(1, n));
}
/* Where the loudest 25 ms falls inside [from, to], as a position 0..1 across it. */
function peakAt(r, from, to) {
  const step = 0.01, w = 0.03;
  let best = -1, at = 0;
  for (let f = from; f + w <= to; f += step) {
    const v = rms(r, f, f + w);
    if (v > best) { best = v; at = f + w / 2; }
  }
  return (at - from) / (to - from);
}
/* Spectral centroid (Hz) of the first beat's window, 20 to 700 Hz, by a direct DFT. */
function centroid(r, from, to) {
  const per = Math.round(r.cycleSec * r.rate), b = 1;
  const a = b * per + Math.round(from * per);
  const n = Math.min(1024, b * per + Math.round(to * per) - a);
  let num = 0, den = 0;
  for (let hz = 20; hz <= 700; hz += 5) {
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));   // Hann
      const ang = 2 * Math.PI * hz * i / r.rate;
      re += r.samples[a + i] * w * Math.cos(ang); im -= r.samples[a + i] * w * Math.sin(ang);
    }
    const p = re * re + im * im; num += hz * p; den += p;
  }
  return num / Math.max(1e-12, den);
}

const SYS = [ev('ao') + 0.06, ev('ac') - 0.05];          // the ejection window
const QUIET = [0.72, 0.92];                               // diastasis: nothing in a normal heart
const DIA = [ev('mo') + 0.05, 0.84];

head('a render is deterministic and finite');
{
  const a = H.render('as', { beats: 2, bpm: 72, seed: 7 }), b = H.render('as', { beats: 2, bpm: 72, seed: 7 });
  ok('the same lesion and seed give the same samples', a.samples.length === b.samples.length && a.samples.every((v, i) => v === b.samples[i]));
  const c = H.render('as', { beats: 2, bpm: 72, seed: 8 });
  ok('and another seed gives another murmur', c.samples.some((v, i) => v !== a.samples[i]));
  const bad = H.LESIONS.filter(l => H.render(l.id, { beats: 2 }).samples.some(v => !Number.isFinite(v) || Math.abs(v) > 0.9001));
  ok('every lesion renders finite samples within range', bad.length === 0, bad.map(l => l.id).join(', ') || H.LESIONS.length + ' lesions');
  ok('lesion ids are unique and each has a name, a blurb and teaching points',
     new Set(H.LESIONS.map(l => l.id)).size === H.LESIONS.length &&
     H.LESIONS.every(l => l.name && l.blurb.length > 30 && l.points.length >= 2), String(H.LESIONS.length));
  const slow = H.render('normal', { beats: 2, bpm: 60 }), fast = H.render('normal', { beats: 2, bpm: 120 });
  ok('the cycle is set by the heart rate', slow.samples.length === 2 * fast.samples.length, `${slow.samples.length} vs ${fast.samples.length}`);
}

head('S1 and S2 sit on the valve events');
{
  const n = R('normal');
  const s1 = rms(n, ev('mc') - 0.01, ev('tc') + 0.07), s2 = rms(n, ev('ac') - 0.01, ev('pc') + 0.07), q = rms(n, ...QUIET);
  ok('S1 is loud at mitral and tricuspid closure and the heart is quiet in diastasis', s1 > 8 * q, `S1 ${s1.toFixed(3)} vs quiet ${q.toFixed(4)}`);
  ok('S2 is loud at aortic and pulmonic closure', s2 > 8 * q, `S2 ${s2.toFixed(3)} vs quiet ${q.toFixed(4)}`);
  ok('systole between S1 and S2 is silent in a normal heart', rms(n, ...SYS) < 0.15 * s1, rms(n, ...SYS).toFixed(4));
  /* The claim of the module: move a valve event in physio and the sound moves. */
  const e = Physio.EVENTS.find(x => x.id === 'ac'), was = e.at;
  e.at = was + 0.06;
  let moved;
  try { moved = H.render('normal', { beats: BEATS, bpm: BPM }); } finally { e.at = was; }
  const late = rms(moved, was + 0.07, was + 0.12), early = rms(moved, was - 0.01, was + 0.03);
  ok('moving aortic closure in physio moves S2 with it', late > 2 * early, `new place ${late.toFixed(3)} vs old ${early.toFixed(3)}`);
}

head('each murmur is loud where the lesion says, and quiet where it does not');
{
  const q = rms(R('normal'), ...SYS);               // the quiet that systole is in a normal heart
  const as = R('as'), mr = R('mr'), vsd = R('vsd'), hocm = R('hocm');
  ok('aortic stenosis fills the ejection window', rms(as, ...SYS) > 5 * Math.max(q, 0.005), rms(as, ...SYS).toFixed(3));
  ok('and stops before A2: diastole after it is quiet', rms(as, ev('ac') + 0.12, ev('ac') + 0.30) < 0.2 * rms(as, ...SYS), rms(as, ev('ac') + 0.12, ev('ac') + 0.30).toFixed(4));
  ok('mitral regurgitation is loud in systole and quiet in diastole', rms(mr, ...SYS) > 5 * Math.max(q, 0.005) && rms(mr, ...QUIET) < 0.2 * rms(mr, ...SYS));
  ok('mitral regurgitation starts at S1: loud just after mitral closure', rms(mr, ev('mc') + 0.04, ev('mc') + 0.09) > 3 * Math.max(q, 0.005));
  ok('and runs through A2: still loud just before aortic closure', rms(mr, ev('ac') - 0.04, ev('ac') - 0.01) > 3 * Math.max(q, 0.005));
  ok('a ventricular septal defect is holosystolic and quiet in diastole', rms(vsd, ...SYS) > 5 * Math.max(q, 0.005) && rms(vsd, ...QUIET) < 0.2 * rms(vsd, ...SYS));
  /* The window starts after P2 and its decay: in a normal heart P2 is still sounding for
     about 0.1 of a cycle after A2, so that stretch is not a quiet baseline. */
  const EARLY = [ev('ac') + 0.13, ev('ac') + 0.20];
  ok('aortic regurgitation fills early diastole, after the second heart sound', rms(R('ar'), ...EARLY) > 4 * Math.max(rms(R('normal'), ...EARLY), 0.004), rms(R('ar'), ...EARLY).toFixed(3));
  ok('and has ended by late diastole', rms(R('ar'), ...QUIET) < 0.25 * rms(R('ar'), ...EARLY));
  ok('mitral stenosis has a diastolic rumble and a quiet systole', rms(R('ms'), ...DIA) > 3 * Math.max(rms(R('normal'), ...DIA), 0.004) && rms(R('ms'), ...SYS) < 0.3 * rms(R('ms'), ...DIA));
  const rumble = rms(R('ms'), 0.93, 0.99), gap = rms(R('ms'), 0.865, 0.895);
  ok('and the rumble re-accentuates before S1 (atrial systole)', rumble > 2 * gap, `${rumble.toFixed(3)} vs ${gap.toFixed(4)}`);
  ok('a continuous (ductus) murmur is present in both systole and diastole',
     rms(R('pda'), ...SYS) > 4 * Math.max(q, 0.005) && rms(R('pda'), 0.62, 0.80) > 4 * Math.max(rms(R('normal'), 0.62, 0.80), 0.004));
  ok('hypertrophic cardiomyopathy fills the ejection window', rms(hocm, ...SYS) > 4 * Math.max(q, 0.005));
}

head('the extra heart sounds are where they are defined');
{
  const nrm = R('normal'), floor = 0.003;
  const s3 = rms(R('s3'), ev('mo') + 0.06, ev('mo') + 0.13), s3n = rms(nrm, ev('mo') + 0.06, ev('mo') + 0.13);
  ok('an S3 is loud in early diastole, after mitral opening, where a normal heart is quiet', s3 > 5 * Math.max(s3n, floor), `${s3.toFixed(3)} vs ${s3n.toFixed(4)}`);
  const s4 = rms(R('s4'), ev('mc') - 0.1, ev('mc') - 0.05), s4n = rms(nrm, ev('mc') - 0.1, ev('mc') - 0.05);
  ok('an S4 is loud just before S1', s4 > 5 * Math.max(s4n, floor), `${s4.toFixed(3)} vs ${s4n.toFixed(4)}`);
  const ck = rms(R('mvp'), ev('mc') + 0.165, ev('mc') + 0.215), ckn = rms(nrm, ev('mc') + 0.165, ev('mc') + 0.215);
  ok('a prolapse click is loud in midsystole', ck > 5 * Math.max(ckn, floor), `${ck.toFixed(3)} vs ${ckn.toFixed(4)}`);
  const late = rms(R('mvp'), ev('ac') - 0.12, ev('ac') - 0.02), early = rms(R('mvp'), ev('mc') + 0.12, ev('mc') + 0.165);   // after S1's tail, before the click
  ok('and the murmur comes after it, in late systole', late > 2.5 * early, `late ${late.toFixed(3)} vs early ${early.toFixed(4)}`);
  const sp = rms(R('wide'), ev('pc') + 0.04, ev('pc') + 0.07), spn = rms(nrm, ev('pc') + 0.04, ev('pc') + 0.07);
  ok('a fixed-split S2 has its second component late', sp > 2 * Math.max(spn, floor), `${sp.toFixed(3)} vs ${spn.toFixed(4)}`);
  /* Mitral opening falls inside the tail of P2, so a normal heart is not silent here; the
     claim is only that the snap is clearly louder than the same instant without it. */
  const op = rms(R('ms'), ev('mo') - 0.005, ev('mo') + 0.03), opn = rms(nrm, ev('mo') - 0.005, ev('mo') + 0.03);
  ok('an opening snap is louder at mitral opening than the same instant in a normal heart', op > 1.3 * Math.max(opn, floor), `${op.toFixed(3)} vs ${opn.toFixed(4)}`);
}

head('the shapes differ as the lesions do');
{
  const span = SYS;
  const asPeak = peakAt(R('as'), ...span), hoPeak = peakAt(R('hocm'), ...span);
  ok('aortic stenosis peaks in the later part of systole', asPeak > 0.5 && asPeak < 0.82, asPeak.toFixed(2));
  ok('hypertrophic cardiomyopathy peaks late too', hoPeak > 0.55 && hoPeak < 0.9, hoPeak.toFixed(2));
  const third = (r, a, b, i) => rms(r, a + (b - a) * i / 3, a + (b - a) * (i + 1) / 3);
  const a1 = ev('mc') + 0.05, a2 = ev('ac') - 0.02;
  const mrPlateau = third(R('mr'), a1, a2, 0) / third(R('mr'), a1, a2, 2);
  ok('mitral regurgitation is a plateau: as loud late as early', mrPlateau > 0.6 && mrPlateau < 1.7, mrPlateau.toFixed(2));
  const vsdPlateau = third(R('vsd'), a1, a2, 0) / third(R('vsd'), a1, a2, 2);
  ok('so is a ventricular septal defect', vsdPlateau > 0.6 && vsdPlateau < 1.7, vsdPlateau.toFixed(2));
  const b1 = ev('ac') + 0.02, b2 = ev('mo') + 0.17;
  const arDecay = third(R('ar'), b1, b2, 0) / third(R('ar'), b1, b2, 2);
  ok('aortic regurgitation decays: loud at A2, faint by the end', arDecay > 1.8, arDecay.toFixed(2));
  const asRatio = third(R('as'), ...span, 1) / third(R('as'), ...span, 0);
  ok('and aortic stenosis is not a plateau: its middle is louder than its start', asRatio > 1.3, asRatio.toFixed(2));
}

head('the pitches differ as the lesions do');
{
  const ar = centroid(R('ar'), ev('ac') + 0.02, ev('mo') + 0.1);
  const ms = centroid(R('ms'), ...DIA);
  const mr = centroid(R('mr'), ev('mc') + 0.04, ev('ac') - 0.02);
  ok('an aortic regurgitation murmur is high-pitched and a mitral stenosis rumble is low', ar > 1.8 * ms, `${ar.toFixed(0)} Hz vs ${ms.toFixed(0)} Hz`);
  ok('the rumble is under 110 Hz', ms < 110, ms.toFixed(0) + ' Hz');
  ok('and a mitral regurgitation murmur is higher than the rumble', mr > 1.6 * ms, `${mr.toFixed(0)} Hz vs ${ms.toFixed(0)} Hz`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
