/* ═════════════════════════════════════════════
   tracings.js — right atrial and wedge pressure tracings, normal and abnormal.

   physio.js already draws the atrial pressure as a baseline plus five named waves
   (a, c, v and the x and y descents), each with a position and a width. Every
   abnormal tracing here is the SAME five waves with the right one made giant,
   abolished, moved or deepened, and the baseline lifted:

     tricuspid regurgitation   the x descent is abolished and a giant systolic cv wave
                               takes its place: the atrium is ventricularised
     tricuspid stenosis        a giant a wave, a slow, shallow y descent
     atrial fibrillation       no a wave, a small x descent, a prominent v wave
     AV dissociation           a cannon a wave, in systole, against a closed valve
     constrictive pericarditis a high baseline with deep x AND y descents (M or W)
     tamponade                 a high baseline, a deep x descent, an absent y descent
     restrictive cardiomyopathy  deep descents, the y at least as deep as the x
     pulmonary hypertension    a giant a wave against a stiff, hypertrophied RV
     acute mitral regurgitation (wedge)  a giant v wave in systole
     mitral stenosis (wedge)   a high mean with a slow y descent

   The normal right atrial trace IS physio.raPressure, so editing the physiology
   moves it, and the tests compare the two.

   What is taught is the DIFFERENCE between traces that look alike. Constriction
   and tamponade are both "high venous pressure", and the one thing that separates
   them is the y descent: present and steep in constriction, absent in tamponade
   (the ventricle cannot fill rapidly in a tense pericardial sac). features()
   measures that from the finished curve, so a test can hold it.

   Pressures in mmHg; t is a fraction of one cardiac cycle.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

const Physio = root.Physio || (typeof require === 'function' ? require('../core/physio.js').Physio : null);

const bump = (t, c, w) => { let d = t - c; d -= Math.round(d); return Math.exp(-Math.pow(d / w, 2)); };
const wrap = t => Number.isFinite(t) ? ((t % 1) + 1) % 1 : 0;

/* Where each wave sits, as physio draws it. */
const RA = { a: [0.058, 0.048], c: [0.148, 0.032], v: [0.448, 0.080], x: [0.205, 0.048], y: [0.545, 0.058] };
const LA = { a: [0.050, 0.045], c: [0.135, 0.030], v: [0.462, 0.075], x: [0.190, 0.045], y: [0.560, 0.055] };

/* waves(shape, { base, a, c, v, x, y }) → f(t). An amplitude may be a number or
   [amplitude, centre, width] when the wave has moved or changed shape. x and y
   are depths (positive numbers) subtracted from the baseline. */
function waves(shape, p) {
  const term = (k, sign) => {
    const v = p[k];
    if (v === undefined || v === 0) return null;
    const [amp, at, w] = Array.isArray(v) ? [v[0], v[1] === undefined ? shape[k][0] : v[1], v[2] === undefined ? shape[k][1] : v[2]] : [v, shape[k][0], shape[k][1]];
    return t => sign * amp * bump(t, at, w);
  };
  const parts = [term('a', 1), term('c', 1), term('v', 1), term('x', -1), term('y', -1)].filter(Boolean);
  return t => { t = wrap(t); let s = p.base; for (const f of parts) s += f(t); return s; };
}

const ra = p => waves(RA, p), la = p => waves(LA, p);
const L = (id, site, name, blurb, points, fn, confusableWith) => ({ id, site, name, blurb, points, fn, confusableWith: confusableWith || [] });

const TRACINGS = [
  L('ra-normal', 'RA', 'Normal right atrium (JVP)',
    'A small a wave, a smaller c, a v wave, with an x descent after the a and a y descent after the v.',
    ['The a wave is atrial contraction, just after the P wave; the v wave is atrial filling against a closed tricuspid valve.',
     'The x descent is the atrium relaxing and the valve plane moving down; the y descent is the tricuspid valve opening.'],
    t => Physio.raPressure(t), ['ra-af', 'ra-ts']),

  L('ra-tr', 'RA', 'Tricuspid regurgitation',
    'The x descent is lost and a large systolic cv wave rises in its place; the y descent is then steep.',
    ['Regurgitant flow fills the atrium throughout systole, so the pressure rises where the x descent should be.',
     'In severe regurgitation the trace looks like a ventricular pressure: the atrium is "ventricularised".',
     'A pulsatile liver and a systolic neck pulsation go with it.'],
    ra({ base: 12, a: 3, v: [14, 0.30, 0.13], x: 0.2, y: 7 }), ['ra-constriction', 'ra-ts']),

  L('ra-ts', 'RA', 'Tricuspid stenosis',
    'A giant a wave, and a y descent that is slow and shallow because the atrium cannot empty across a narrowed valve.',
    ['The atrium contracts hard against the stenosis: the giant a wave.',
     'The slow y descent is the diastolic gradient across the valve.',
     'Needs sinus rhythm for the a wave; in atrial fibrillation there is none.'],
    ra({ base: 9, a: 11, v: 4, x: 1.2, y: 0.8 }), ['ra-pulmhtn', 'ra-normal']),

  L('ra-af', 'RA', 'Atrial fibrillation',
    'No a wave, a small x descent and a prominent v wave.',
    ['There is no organised atrial contraction, so there is no a wave.',
     'With the a wave gone, the x descent is small, and the v wave is what remains of the trace.'],
    ra({ base: 8, c: 1, v: 6, x: 0.3, y: 3 }), ['ra-normal', 'ra-tr']),

  L('ra-cannon', 'RA', 'AV dissociation (cannon a waves)',
    'A giant a wave that falls in systole, because the atrium is contracting against a closed tricuspid valve.',
    ['The atrium and ventricle are beating independently, so the atrium sometimes contracts when the valve is shut.',
     'Seen in complete heart block, ventricular tachycardia and some ventricular pacing.',
     'Irregular cannon waves point to AV dissociation; regular ones to a junctional rhythm.'],
    ra({ base: 8, a: [14, 0.22, 0.05], c: 1, v: 3, x: 1, y: 2 }), ['ra-ts', 'ra-pulmhtn']),

  L('ra-constriction', 'RA', 'Constrictive pericarditis',
    'A high baseline with deep x and y descents, an M or W shape; the y descent is steep.',
    ['The ventricle fills rapidly early in diastole, then stops abruptly against the rigid pericardium: a steep y descent.',
     'Kussmaul sign: the venous pressure rises, not falls, on inspiration.',
     'Compare tamponade, where the y descent is absent.'],
    ra({ base: 16, a: 6, c: 1, v: 5, x: 6, y: 9 }), ['ra-tamponade', 'ra-restrictive']),

  L('ra-tamponade', 'RA', 'Cardiac tamponade',
    'A high baseline with a prominent x descent and an absent y descent.',
    ['In a tense effusion the ventricle can only fill during systole, as the heart shrinks: the x descent survives.',
     'It cannot fill rapidly after the valve opens, so there is no y descent.',
     'Pulsus paradoxus and a falling blood pressure complete the picture.'],
    ra({ base: 15, a: 3, v: 3, x: 5, y: 0.4 }), ['ra-constriction', 'ra-restrictive']),

  L('ra-restrictive', 'RA', 'Restrictive cardiomyopathy',
    'A high baseline with deep descents, the y descent at least as deep as the x.',
    ['A stiff ventricle fills rapidly early, then stops: a prominent y descent, as in constriction.',
     'The trace alone does not separate it from constriction; the pattern of ventricular interdependence does.'],
    ra({ base: 16, a: 6, v: 4, x: 4, y: 8 }), ['ra-constriction', 'ra-tamponade']),

  L('ra-pulmhtn', 'RA', 'Pulmonary hypertension or RV hypertrophy',
    'A giant a wave against a stiff right ventricle, with otherwise unremarkable descents.',
    ['The right atrium contracts hard against a ventricle that fills poorly.',
     'Like tricuspid stenosis, but the y descent is not slowed by a valve gradient.'],
    ra({ base: 9, a: 10, v: 4, x: 2, y: 2 }), ['ra-ts', 'ra-cannon']),

  L('pcwp-normal', 'PCWP', 'Normal wedge pressure',
    'The left atrial waveform: a, c and v waves with x and y descents, mean about 8.',
    ['The wedge reflects left atrial pressure, delayed slightly and damped.',
     'The mean is what is measured, at end-expiration.'],
    t => Physio.laPressure(t), ['pcwp-ms']),

  L('pcwp-mr', 'PCWP', 'Acute severe mitral regurgitation',
    'A giant v wave rising through systole, with a steep y descent.',
    ['The regurgitant jet fills a small, non-compliant left atrium, so the pressure climbs in systole.',
     'A v wave does not by itself prove mitral regurgitation: it also appears in a ventricular septal defect and in a stiff left atrium.'],
    la({ base: 18, a: 4, v: [22, 0.38, 0.11], x: 1, y: 10 }), ['pcwp-ms', 'pcwp-normal']),

  L('pcwp-ms', 'PCWP', 'Mitral stenosis',
    'A high mean with a slow, shallow y descent: the left atrium empties slowly across a narrowed valve.',
    ['The diastolic gradient between the wedge and the left ventricle is the stenosis.',
     'A large a wave is present in sinus rhythm.'],
    la({ base: 18, a: 8, v: 6, x: 1, y: 1.5 }), ['pcwp-mr', 'pcwp-normal']),
];

/* ── measuring a finished curve ───────────────────────────────────────── */

function sample(fn, n) {
  const out = new Float64Array(n || 1000);
  for (let i = 0; i < out.length; i++) out[i] = fn(i / out.length);
  return out;
}
const at = (s, t) => s[Math.min(s.length - 1, Math.floor(t * s.length))];
function maxIn(s, a, b) { let m = -Infinity, tm = a; for (let i = Math.floor(a * s.length); i < Math.floor(b * s.length); i++) if (s[i] > m) { m = s[i]; tm = i / s.length; } return { v: m, t: tm }; }
function minIn(s, a, b) { let m = Infinity, tm = a; for (let i = Math.floor(a * s.length); i < Math.floor(b * s.length); i++) if (s[i] < m) { m = s[i]; tm = i / s.length; } return { v: m, t: tm }; }

/* features(fn) → what a reader would call the trace.
     mean      mean pressure over the cycle
     ref       the level in diastasis (the pressure the trace falls TO and rises FROM)
     aPeak     the a wave's height above ref: atrial systole, just before and after the cycle's start
     aAt       where it falls
     sysPeak   the height above ref of the largest wave in early systole (a cannon a wave; zero or small otherwise)
     vPeak, vAt  the largest wave in late systole, and where
     xDepth    how far the pressure falls below ref in early systole (0 if it never does)
     yDepth    how far it falls below ref in early diastole (0 if it never does)
   ref is the mean over the flat stretch just before atrial systole. */
function features(fn) {
  const s = sample(fn, 1000);
  let sum = 0; for (const v of s) sum += v;
  let ref = 0, n = 0;
  for (let i = Math.floor(0.76 * s.length); i < Math.floor(0.84 * s.length); i++) { ref += s[i]; n++; }
  ref /= n;
  /* the a wave is atrial systole, either side of the cycle's start; a wave that falls in
     systole instead is reported apart, as sysPeak (a cannon wave, or a regurgitant cv wave) */
  const aEarly = maxIn(s, 0, 0.12), aLate = maxIn(s, 0.88, 1);
  const a = aLate.v > aEarly.v ? aLate : aEarly;
  const sys = maxIn(s, 0.12, 0.30);
  const v = maxIn(s, 0.28, 0.52);
  const x = minIn(s, 0.15, 0.38), y = minIn(s, 0.50, 0.76);
  return {
    mean: sum / s.length, ref,
    aPeak: a.v - ref, aAt: a.t, sysPeak: sys.v - ref, sysAt: sys.t,
    vPeak: v.v - ref, vAt: v.t,
    xDepth: Math.max(0, ref - x.v), yDepth: Math.max(0, ref - y.v),
    xAt: x.t, yAt: y.t,
  };
}

function byId(id) {
  const t = TRACINGS.find(x => x.id === id);
  if (!t) throw new Error('tracings: no tracing "' + id + '"');
  return t;
}

root.Tracings = { TRACINGS, features, sample, byId, RA, LA };

})(typeof window !== 'undefined' ? window : this);
