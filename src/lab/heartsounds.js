/* ═════════════════════════════════════════════
   heartsounds.js — the cardiac cycle you can listen to.

   A phonocardiogram is not a recording here, it is a computation: every sound
   is placed on the valve events physio.js already measures (S1 is mitral then
   tricuspid closure, S2 is aortic then pulmonic closure), and every murmur is
   a span BETWEEN two of those events. Nothing is timed by a constant of its
   own, so a murmur cannot drift away from the physiology it belongs to.

   That is the whole teaching point of the module. Aortic stenosis is not "a
   crescendo-decrescendo sound", it is a sound that exists only while the
   aortic valve is open, and it stops at A2. Mitral regurgitation runs from
   M1 to A2 and does not care that the aortic valve is shut. The spec below says
   those things in the valves' own terms and render() turns them into samples.

   Everything is synthesised, from a seeded generator: the same lesion and seed
   give the same samples, so a test can hold it. No recorded audio, no licensed
   content, nothing leaves the device.

   Usage:
     HeartSounds.LESIONS            // the list, each with name, spec and teaching points
     HeartSounds.render('as', { beats: 3, bpm: 72, seed: 1 })
        → { samples: Float32Array, rate, cycleSec, beats, events }
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

/* In a page physio.js has put Physio on window; under Node it is on its module.exports. */
const Physio = root.Physio || (typeof require === 'function' ? require('../core/physio.js').Physio : null);

const RATE = 4000;   // Hz. Heart sounds and murmurs sit under ~600 Hz.

/* ── the spec ─────────────────────────────────────────────────────────────
   A position is { ev, add }: a valve event id from Physio.EVENTS plus a
   fraction of the cycle. add exists for sounds that are defined by their
   distance from an event (an S3 follows mitral opening; a click follows
   aortic opening). Spans are { from, to } positions; a span whose end falls
   before its start wraps through the end of the cycle (presystole). */
const at = (ev, add) => ({ ev, add: add || 0 });

/* kind → damped-sinusoid recipe: base frequencies (Hz), length (s), loudness. */
const SOUND = {
  S1:    { f: [50, 85],  len: 0.090, amp: 1.00 },
  S2:    { f: [70, 120], len: 0.075, amp: 0.85 },
  S3:    { f: [28, 40],  len: 0.085, amp: 0.38 },
  S4:    { f: [24, 34],  len: 0.080, amp: 0.34 },
  click: { f: [190, 260], len: 0.028, amp: 0.55 },
  snap:  { f: [110, 170], len: 0.045, amp: 0.70 },
};

/* shape → envelope over a span, and band → the murmur's pitch (Hz). */
const L = (id, name, blurb, points, sounds, murmurs) => ({ id, name, blurb, points, sounds, murmurs });

const S1 = (amp) => ({ kind: 'S1', at: at('mc'), amp: amp === undefined ? 1 : amp });
const T1 = () => ({ kind: 'S1', at: at('tc'), amp: 0.5 });
const A2 = (amp) => ({ kind: 'S2', at: at('ac'), amp: amp === undefined ? 1 : amp });
const P2 = (add, amp) => ({ kind: 'S2', at: at('pc', add || 0), amp: amp === undefined ? 0.7 : amp });

const LESIONS = [
  L('normal', 'Normal',
    'S1 then S2, silent systole and diastole. P2 trails A2 slightly, more on inspiration.',
    ['S1 is mitral then tricuspid closure; S2 is aortic then pulmonic closure.',
     'The split of S2 is a timing difference between two valve events, widest on inspiration.'],
    [S1(), T1(), A2(), P2()], []),

  L('as', 'Aortic stenosis',
    'Harsh crescendo-decrescendo murmur while the aortic valve is open; a soft, late-peaking murmur is mild, a late-peaking and soft S2 means severe.',
    ['Starts after the ejection click and ends before A2, because it exists only while the valve is open.',
     'Heard best at the right upper sternal border, radiating to the carotids.',
     'The later it peaks and the softer A2 is, the tighter the valve. A2 can vanish, or split paradoxically.'],
    [S1(), T1(), { kind: 'click', at: at('ao', 0.012), amp: 0.7 }, A2(0.35), P2()],
    [{ from: at('ao', 0.03), to: at('ac', -0.03), shape: 'cd', peak: 0.62, band: [90, 330], amp: 0.95 }]),

  L('mr', 'Mitral regurgitation',
    'Holosystolic, plateau-shaped, high-pitched; it begins at M1 and runs through A2 because the LV is leaking from the moment it pressurises.',
    ['Starts with S1 (S1 is often soft) and ends at or just after A2: it does not stop when the aortic valve shuts.',
     'Heard best at the apex, radiating to the axilla.',
     'It does not increase with inspiration; compare tricuspid regurgitation.'],
    [S1(0.55), T1(), A2(), P2()],
    [{ from: at('mc', 0.012), to: at('ac', 0.02), shape: 'holo', band: [140, 420], amp: 0.8 }]),

  L('ms', 'Mitral stenosis',
    'Loud S1, an opening snap after A2, then a low-pitched diastolic rumble that softens and re-accentuates before S1 if the rhythm is sinus.',
    ['The opening snap marks mitral opening; the shorter A2-to-snap interval, the tighter the valve.',
     'The rumble is low-pitched, so it needs the bell of the stethoscope, patient rolled to the left.',
     'Presystolic accentuation is atrial contraction pushing across a stenotic valve, so it disappears in atrial fibrillation.'],
    [S1(1.5), T1(), A2(), P2(), { kind: 'snap', at: at('mo', 0.004), amp: 0.9 }],
    [{ from: at('mo', 0.03), to: { ev: null, abs: 0.86 }, shape: 'dec', band: [30, 95], amp: 1.5 },
     { from: { ev: null, abs: 0.90 }, to: at('mc', 0.008), shape: 'cresc', band: [30, 95], amp: 1.4 }]),

  L('ar', 'Aortic regurgitation',
    'High-pitched, blowing, early diastolic decrescendo that begins at A2 and fades as the aortic and LV pressures equalise.',
    ['Begins right at A2 and is loudest then, because the gradient is largest then.',
     'Heard best at the left sternal border with the patient leaning forward, breath held out.',
     'Severe, acute regurgitation is short and quiet because pressures equalise fast, so a soft murmur does not mean a mild lesion.'],
    [S1(), T1(), A2(0.8), P2()],
    [{ from: at('ac', 0.008), to: at('mo', 0.17), shape: 'dec', band: [180, 520], amp: 1.7 }]),

  L('s3', 'S3 gallop',
    'A low-pitched sound in early diastole, shortly after mitral opening, when a volume-loaded or failing ventricle fills against high filling pressures.',
    ['Occurs about 120 to 180 ms after A2, at the end of rapid filling.',
     'Normal in the young and in pregnancy; in an older patient it means ventricular dysfunction or volume overload.',
     'Low-pitched: use the bell, patient on the left side.'],
    [S1(), T1(), A2(), P2(), { kind: 'S3', at: at('mo', 0.09), amp: 1 }], []),

  L('s4', 'S4 gallop',
    'A low-pitched sound just before S1: the atrium contracting against a stiff, hypertrophied ventricle.',
    ['Needs atrial contraction, so it cannot occur in atrial fibrillation.',
     'Seen with LVH, hypertension, aortic stenosis, acute ischaemia and a stiff, non-dilated ventricle.'],
    [S1(), T1(), A2(), P2(), { kind: 'S4', at: at('mc', -0.075), amp: 1 }], []),

  L('mvp', 'Mitral valve prolapse',
    'A midsystolic click, then a late systolic murmur that begins after the click.',
    ['The click is the chordae snapping taut as the leaflet prolapses.',
     'Standing or Valsalva reduces LV volume: the click moves earlier toward S1 and the murmur lengthens.',
     'Squatting and handgrip do the opposite.'],
    [S1(), T1(), { kind: 'click', at: at('mc', 0.18), amp: 0.9 }, A2(), P2()],
    [{ from: at('mc', 0.2), to: at('ac', 0.01), shape: 'cresc', band: [120, 380], amp: 0.6 }]),

  L('hocm', 'Hypertrophic cardiomyopathy',
    'A harsh crescendo-decrescendo systolic murmur that peaks late, louder with less LV volume (standing, Valsalva) and softer with more (squatting).',
    ['Dynamic outflow obstruction: it gets louder when the LV is smaller, which is the opposite of aortic stenosis.',
     'It does not radiate to the carotids as aortic stenosis does.',
     'An S4 is usual, because the hypertrophied ventricle is stiff.'],
    [S1(), T1(), A2(), P2(), { kind: 'S4', at: at('mc', -0.075), amp: 0.8 }],
    [{ from: at('ao', 0.04), to: at('ac', -0.04), shape: 'cd', peak: 0.7, band: [80, 300], amp: 0.85 }]),

  L('vsd', 'Ventricular septal defect',
    'A loud, harsh holosystolic murmur at the left lower sternal border; a small defect is louder than a large one.',
    ['Flow from left to right for as long as the LV pressure exceeds the RV pressure, which is nearly all of systole.',
     'A small restrictive defect makes a louder murmur than a large one, because the pressure gradient across it stays high.',
     'It does not increase with inspiration, and it does not radiate to the axilla.'],
    [S1(), T1(), A2(), P2()],
    [{ from: at('mc', 0.01), to: at('ac', 0.01), shape: 'holo', band: [110, 380], amp: 1 }]),

  L('pda', 'Patent ductus arteriosus',
    'A continuous machinery murmur that peaks around S2 and runs through to diastole.',
    ['Continuous because aortic pressure is higher than pulmonary pressure through the whole cycle, so flow never stops.',
     'Heard best at the left infraclavicular area.',
     'With pulmonary hypertension the pressures equalise, the diastolic component vanishes and the murmur may disappear.'],
    [S1(), T1(), A2(), P2()],
    [{ from: at('mc', 0.05), to: at('mc', 1.0), shape: 'cont', peakEv: 'ac', band: [100, 360], amp: 0.8 }]),

  L('wide', 'Fixed split S2',
    'P2 is late and the split does not change with breathing: the signature of an atrial septal defect.',
    ['Fixed because the right and left atria are in free communication, so respiration cannot alter relative venous return.',
     'A flow murmur across the pulmonary valve usually accompanies it, and a mid-diastolic tricuspid flow murmur if the shunt is large.'],
    [S1(), T1(), A2(), P2(0.052, 0.8)], []),
];

/* ── synthesis ────────────────────────────────────────────────────────── */

function rng32(seed) {   // mulberry32: fast, deterministic, no globals
  let a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* An RBJ band-pass over white noise, run twice (four poles) so the skirts fall
   away: murmurs are turbulence, band-limited noise whose pitch is the
   lesion's. One stage leaks enough energy above the band to make a low rumble
   read as mid-pitched, which the tests measure. The result is scaled to unit
   RMS, so a murmur's loudness is its own amp and not a side effect of how
   narrow its band is. */
function bandNoise(n, rate, lo, hi, rand) {
  const f0 = Math.sqrt(lo * hi), q = f0 / Math.max(1, hi - lo);
  const w = 2 * Math.PI * f0 / rate, alpha = Math.sin(w) / (2 * q), c = Math.cos(w);
  const b0 = alpha, b2 = -alpha, a0 = 1 + alpha, a1 = -2 * c, a2 = 1 - alpha;
  let sig = new Float32Array(n);
  for (let i = 0; i < n; i++) sig[i] = rand() * 2 - 1;
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(n);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) {
      const x = sig[i];
      const y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x; y2 = y1; y1 = y; out[i] = y;
    }
    sig = out;
  }
  let e = 0;
  for (let i = 0; i < n; i++) e += sig[i] * sig[i];
  const g = 1 / Math.sqrt(Math.max(1e-12, e / n));
  for (let i = 0; i < n; i++) sig[i] *= g;
  return sig;
}

/* position → fraction of the cycle. Events come from Physio, so a change to
   the physiology moves the sound with it. */
function frac(pos) {
  if (pos.abs !== undefined) return pos.abs;
  const ev = Physio.EVENTS.find(e => e.id === pos.ev);
  if (!ev) throw new Error('heartsounds: unknown valve event "' + pos.ev + '"');
  return ev.at + (pos.add || 0);
}

/* The envelope of a murmur over u in [0,1] across its span. */
function envelope(m, u, f) {
  switch (m.shape) {
    case 'cd': {   // crescendo-decrescendo, peaking where the spec says
      const p = Math.log(0.5) / Math.log(m.peak || 0.5);
      return Math.pow(Math.sin(Math.PI * Math.pow(u, p)), 1.4);
    }
    case 'holo': { // plateau with short ramps: it is as loud late as early
      return Math.min(1, u / 0.07, (1 - u) / 0.07);
    }
    case 'dec':    return Math.min(1, u / 0.04) * Math.pow(1 - u, 1.1);
    case 'cresc':  return Math.pow(u, 1.5) * Math.min(1, (1 - u) / 0.04);
    case 'cont': { // continuous: loudest at the named event, never silent
      const c = frac(at(m.peakEv));
      let d = (f - c) % 1; if (d > 0.5) d -= 1; if (d < -0.5) d += 1;
      return 0.3 + 0.7 * Math.exp(-Math.pow(d / 0.2, 2));
    }
    default: throw new Error('heartsounds: unknown murmur shape "' + m.shape + '"');
  }
}

function addSound(buf, startSample, spec, amp, rate) {
  const n = Math.round(spec.len * rate);
  for (let i = 0; i < n; i++) {
    const idx = startSample + i;
    if (idx < 0 || idx >= buf.length) continue;
    const t = i / rate;
    const attack = Math.min(1, t / 0.004);
    const decay = Math.exp(-t / (spec.len / 3.2));
    let v = 0;
    for (let k = 0; k < spec.f.length; k++) v += Math.sin(2 * Math.PI * spec.f[k] * t) / (k + 1);
    buf[idx] += amp * spec.amp * attack * decay * v;
  }
}

function lesionById(id) {
  const l = LESIONS.find(x => x.id === id);
  if (!l) throw new Error('heartsounds: no lesion "' + id + '"');
  return l;
}

/* render(id, { beats, bpm, seed, rate }) → samples in [-0.9, 0.9]. The cycle
   is bpm-scaled in seconds but fractions of the cycle stay where physio puts
   them, which is how a faster rate shortens diastole in the audio as it does
   in the heart. */
function render(id, o) {
  o = o || {};
  const lesion = lesionById(id);
  const rate = o.rate || RATE, beats = o.beats || 3, bpm = o.bpm || 72;
  const cycleSec = 60 / bpm, perCycle = Math.round(cycleSec * rate);
  const rand = rng32(o.seed === undefined ? 1 : o.seed);
  const buf = new Float32Array(perCycle * beats);

  for (let b = 0; b < beats; b++) {
    const base = b * perCycle;
    for (const s of lesion.sounds) {
      let f = frac(s.at);
      f = ((f % 1) + 1) % 1;
      addSound(buf, base + Math.round(f * perCycle), SOUND[s.kind], s.amp, rate);
    }
    for (const m of lesion.murmurs) {
      const f0 = frac(m.from);
      let f1 = frac(m.to);
      if (f1 <= f0) f1 += 1;
      const s0 = Math.round(f0 * perCycle), len = Math.round((f1 - f0) * perCycle);
      const noise = bandNoise(len, rate, m.band[0], m.band[1], rand);
      for (let i = 0; i < len; i++) {
        const u = i / (len - 1 || 1), idx = base + s0 + i;
        const w = idx >= buf.length ? idx - buf.length : idx;   // presystole wraps onto the next S1
        buf[w] += m.amp * 0.3 * envelope(m, u, f0 + u * (f1 - f0)) * noise[i];
      }
    }
  }
  let peak = 1e-9;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
  for (let i = 0; i < buf.length; i++) buf[i] = buf[i] / peak * 0.9;
  return { samples: buf, rate, cycleSec, beats, events: Physio.EVENTS.map(e => ({ id: e.id, at: e.at })) };
}

root.HeartSounds = { LESIONS, SOUND, RATE, render, frac, lesionById };

})(typeof window !== 'undefined' ? window : this);
