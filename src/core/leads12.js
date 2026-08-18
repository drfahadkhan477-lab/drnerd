/* ═══════════════════════════════════════════════════════════════════════════
   leads12.js — a real 12-lead, from one rotating dipole.

   The single-lead engine in this app synthesises a waveform directly: shape a
   P, shape a QRS, shape a T. That cannot produce a 12-lead, because the twelve
   leads are not twelve waveforms. They are ONE electrical event viewed from
   twelve directions, and every difference between them — why aVR is upside
   down, why V1 has a small r and a deep S while V6 has the reverse, why the
   septal q exists at all — falls out of that geometry and nothing else.

   So this models the thing itself. At each instant the myocardium's summed
   electrical activity is a vector (the dipole). A lead measures the projection
   of that vector onto its own axis:

       deflection in lead L  =  dipole(t) · unit vector of L

   Get the vectors right and the morphology is not drawn, it is derived.

   Coordinates: +x patient's left, +y inferior, +z posterior.

   The QRS is three sequential vectors, which is the whole reason the precordial
   leads look the way they do:
     1. septum, depolarised LEFT to RIGHT and anteriorly  → small r in V1,
        septal q in I/aVL/V5/V6
     2. free walls, the LV overwhelming the RV, so the sum points left,
        inferior and posterior → deep S in V1, tall R in V6, dominant R in II
     3. basal segments last, pointing back up and to the right → terminal s

   Usage:
     Leads12.LEADS                       // the twelve, with axis and teaching
     Leads12.sample('V1', tms, 'sinus')  // millivolts at a moment
     Leads12.strip('V1','sinus',{ms:2500,step:4})

   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

const RAD = Math.PI / 180;
function unit(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; }
function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }

/* Frontal-plane leads: the hexaxial reference, angle measured from the
   patient's left (+x) toward inferior (+y). These are textbook values. */
function frontal(deg) { return [Math.cos(deg*RAD), Math.sin(deg*RAD), 0]; }
/* Horizontal-plane leads: angle from the patient's left, swinging anteriorly.
   V6 looks straight left; V2 straight ahead; V1 ahead and slightly rightward. */
function horizontal(deg) { return [Math.cos(deg*RAD), 0, -Math.sin(deg*RAD)]; }

const LEADS = [
  { id:'I',   axis:frontal(0),     group:'limb', territory:'Lateral (high)',
    artery:'LCx / first diagonal',
    sees:'The left ventricular free wall, viewed side-on from the left.',
    look:'Q waves and ST changes here pair with aVL. A negative QRS in I with a positive aVF means right axis deviation.' },
  { id:'II',  axis:frontal(60),    group:'limb', territory:'Inferior',
    artery:'RCA (or LCx if left-dominant)',
    sees:'Down the long axis of the heart, almost parallel to the main QRS vector — which is why it is usually the tallest limb lead.',
    look:'The rhythm strip lead by convention: P waves are most reliably seen here. Inferior STEMI shows here with III and aVF.' },
  { id:'III', axis:frontal(120),   group:'limb', territory:'Inferior',
    artery:'RCA (or LCx if left-dominant)',
    sees:'The inferior wall from the right, so it is the most variable limb lead.',
    look:'An isolated Q in III alone is often positional — check it disappears on inspiration before calling it old infarct.' },
  { id:'aVR', axis:frontal(-150),  group:'limb', territory:'Right upper / cavity',
    artery:'—',
    sees:'The heart from the right shoulder, looking into the cavity — the opposite direction to almost every other lead.',
    look:'Normally everything is negative here. ST ELEVATION in aVR with widespread depression suggests left main or triple-vessel disease.' },
  { id:'aVL', axis:frontal(-30),   group:'limb', territory:'Lateral (high)',
    artery:'First diagonal / LCx',
    sees:'The high lateral wall from the left shoulder.',
    look:'ST elevation in aVL with reciprocal depression inferiorly is the classic first-diagonal occlusion.' },
  { id:'aVF', axis:frontal(90),    group:'limb', territory:'Inferior',
    artery:'RCA (or LCx if left-dominant)',
    sees:'Straight up from the feet at the diaphragmatic surface.',
    look:'With I, this is the axis pair: both positive is normal axis.' },

  { id:'V1',  axis:horizontal(115), group:'chest', territory:'Septal',
    artery:'LAD (septal branches)',
    sees:'The septum and the right ventricle, from the front and slightly right — the only lead that faces the RV squarely.',
    look:'Normal is a small r then a deep S, because the septum comes toward it and then the far bigger LV vector goes away. rSR′ here is right bundle branch block. A biphasic P with a deep terminal component is left atrial enlargement.' },
  { id:'V2',  axis:horizontal(90),  group:'chest', territory:'Septal',
    artery:'LAD (septal branches)',
    sees:'Straight through the anterior septum.',
    look:'Where anterior STEMI declares itself earliest, and where poor R-wave progression begins to be judged.' },
  { id:'V3',  axis:horizontal(75),  group:'chest', territory:'Anterior',
    artery:'LAD',
    sees:'The anterior wall, at the point where the QRS usually flips from mostly negative to mostly positive.',
    look:'The transition zone normally sits at V3–V4. Earlier suggests counter-clockwise rotation or a posterior infarct; later, clockwise rotation.' },
  { id:'V4',  axis:horizontal(60),  group:'chest', territory:'Anterior',
    artery:'LAD',
    sees:'The apex.',
    look:'The tallest R of the precordial leads is usually here or V5.' },
  { id:'V5',  axis:horizontal(30),  group:'chest', territory:'Lateral',
    artery:'LAD / LCx',
    sees:'The lateral wall, low.',
    look:'With V6, where LVH voltage criteria are measured (S in V1 + R in V5 or V6 > 35 mm).' },
  { id:'V6',  axis:horizontal(0),   group:'chest', territory:'Lateral',
    artery:'LCx',
    sees:'Straight at the lateral LV wall from the left, almost along the main QRS vector.',
    look:'Tall R with a small septal q. Loss of that q, with a broad notched R, is left bundle branch block.' },
].map(L => ({ ...L, axis: unit(L.axis) }));

/* ── the dipole ─────────────────────────────────────────────────────────────
   Each component is a direction with a Gaussian envelope in time, positioned
   relative to the R peak at t = 0. Amplitudes are in arbitrary units scaled so
   a normal lead II R comes out near 1.2 mV, which is life-like. */
function gauss(t, mu, sigma) {
  const d = (t - mu) / sigma;
  return Math.exp(-0.5 * d * d);
}

const BASE = {
  /* atrial depolarisation: right atrium first and anterior, left atrium after
     and posterior — the pair is what makes the P biphasic in V1 */
  pRight: { dir: unit([0.35, 0.78, -0.52]), mu: -160, sd: 22, amp: 0.115 },
  pLeft:  { dir: unit([0.52, 0.70,  0.50]), mu: -142, sd: 24, amp: 0.105 },
  /* ventricular depolarisation, in its three real steps */
  /* Separated in time more than instinct suggests: overlapped, the free-wall
     vector swamps the septal one and the q disappears from I/V6 entirely. */
  septal: { dir: unit([-0.55, -0.14, -0.82]), mu: -23, sd: 5.2, amp: 0.30 },
  /* The posterior component sets where the precordial transition falls: more
     posterior pushes it later. 0.56 put it at V5 (clockwise rotation), 0.44 at
     V4-V5; 0.34 lands it between V3 and V4, which is where normal sits. */
  free:   { dir: unit([ 0.64,  0.56,  0.34]), mu:   3, sd: 9.5, amp: 1.55 },
  /* Terminal basal forces go up and to the RIGHT, and only mildly posterior.
     At 0.76 posterior this vector put its deepest S squarely on V4 and dragged
     the transition zone a whole lead late, which is a clockwise-rotation
     tracing wearing a normal label. */
  basal:  { dir: unit([-0.34, -0.72,  0.30]), mu:  22, sd: 8.0, amp: 0.27 },
  /* repolarisation: broadly with the main vector but less posterior, which is
     what leaves V1 with a flat-to-inverted T while V4-V6 stay upright */
  tWave:  { dir: unit([ 0.60,  0.60,  0.28]), mu: 250, sd: 62, amp: 0.40 },
};

/* Rhythm-specific surgery on that model. Each entry says what is genuinely
   different about the vector sequence — which is the only honest way to make
   a 12-lead look like the diagnosis rather than merely be labelled with it. */
const MODS = {
  sinus: {},
  brady: {},
  tachy: {},
  afib:     { noP: true, fib: 0.045, irregular: 0.28 },
  flutter:  { noP: true, flutter: true },
  rbbb: {   /* RV depolarises late and unopposed → terminal forces go right and
               anterior, which IS the rSR′ in V1 and the slurred S in I/V6 */
    extra: [{ dir: unit([-0.62, -0.10, -0.72]), mu: 62, sd: 13, amp: 0.62 }],
    widen: 1.55 },
  lbbb: {   /* septum is depolarised right-to-left instead, so the septal q is
               abolished, and the whole LV is late → broad notched R laterally */
    drop: ['septal'],
    extra: [{ dir: unit([0.68, 0.42, 0.36]), mu: 46, sd: 16, amp: 0.72 }],
    widen: 1.7, discordantT: true },
  lvh: { scale: { free: 1.5 }, discordantT: true },
  stemi_ant: { st: { leads: ['V1','V2','V3','V4'], mm: 0.34 },
               recip: { leads: ['II','III','aVF'], mm: -0.12 } },
  stemi_inf: { st: { leads: ['II','III','aVF'], mm: 0.30 },
               recip: { leads: ['I','aVL'], mm: -0.14 } },
  hyperk: { tallT: 2.1, widen: 1.35, pAmp: 0.25 },
  /* Pericarditis is the one that catches people: the ST elevation is DIFFUSE
     and does not respect a territory, and it is accompanied by PR depression
     — with both reversed in aVR, which is the tell that it is not a STEMI. */
  pericarditis: { st: { leads: ['I','II','III','aVL','aVF','V2','V3','V4','V5','V6'], mm: 0.15 },
                  recip: { leads: ['aVR'], mm: -0.13 }, prDep: 0.075 },
  longqt: { tShift: 1.7 },
};

function componentsFor(kind) {
  const m = MODS[kind] || {};
  const out = [];
  const push = (k) => {
    if (m.drop && m.drop.indexOf(k) >= 0) return;
    if ((k === 'pRight' || k === 'pLeft') && m.noP) return;
    const c = BASE[k];
    let amp = c.amp;
    if (m.scale && m.scale[k]) amp *= m.scale[k];
    if ((k === 'pRight' || k === 'pLeft') && m.pAmp != null) amp *= m.pAmp;
    if (k === 'tWave' && m.tallT) amp *= m.tallT;
    let sd = c.sd, mu = c.mu;
    if (m.widen && (k === 'septal' || k === 'free' || k === 'basal')) { sd *= m.widen; mu *= m.widen; }
    if (k === 'tWave' && m.tShift) { mu *= m.tShift; sd *= m.tShift; }
    out.push({ dir: c.dir, mu, sd, amp });
  };
  ['pRight','pLeft','septal','free','basal','tWave'].forEach(push);
  if (m.extra) m.extra.forEach(e => out.push(e));
  return out;
}

/* The dipole at one instant within a beat, phase measured from the R peak. */
function dipoleAt(phaseMs, kind) {
  const comps = componentsFor(kind);
  let x = 0, y = 0, z = 0;
  for (const c of comps) {
    const a = c.amp * gauss(phaseMs, c.mu, c.sd);
    x += c.dir[0] * a; y += c.dir[1] * a; z += c.dir[2] * a;
  }
  return [x, y, z];
}

/* ── beat timing ───────────────────────────────────────────────────────────
   Deterministic irregularity: seeded from the beat index so the same rhythm
   always draws the same strip, which matters when the same tracing is on
   screen next to an explanation of it. */
function rrFor(kind, hr, beat) {
  const m = MODS[kind] || {};
  const base = 60000 / (hr || 68);
  if (!m.irregular) return base;
  const n = Math.sin(beat * 12.9898) * 43758.5453;
  return base * (1 + (n - Math.floor(n) - 0.5) * 2 * m.irregular);
}

/* Millivolts in one lead at absolute time tms. */
function sample(leadId, tms, kind, hr) {
  const L = LEADS.find(l => l.id === leadId);
  if (!L) return 0;
  const m = MODS[kind] || {};
  hr = hr || 68;

  /* Walk beats until the one containing tms is found. Cheap: a strip is a few
     seconds and beats are ~1s, so this is a handful of iterations. */
  let t0 = 0, beat = 0;
  for (;;) {
    const rr = rrFor(kind, hr, beat);
    if (t0 + rr > tms || beat > 400) break;
    t0 += rr; beat++;
  }
  const phase = tms - t0;
  /* Look at the previous and next beats too, so a T wave that runs past the
     next R (fast rates, long QT) still contributes rather than being cut. */
  let mv = 0;
  for (let k = -1; k <= 1; k++) {
    const off = k === 0 ? 0 : k * rrFor(kind, hr, beat + k);
    mv += dot(dipoleAt(phase - off, kind), L.axis);
  }

  if (m.fib) {   /* fibrillatory baseline: fine, irregular, no organised P */
    mv += m.fib * (Math.sin(tms * 0.061) * Math.sin(tms * 0.0233 + 1.1) + Math.sin(tms * 0.101));
  }
  if (m.flutter) {  /* sawtooth at ~300/min, most visible in the inferior leads */
    const f = ((tms % 200) / 200);
    const saw = (f < 0.7 ? f / 0.7 : 1 - (f - 0.7) / 0.3) - 0.5;
    mv += saw * 0.34 * dot([0.2, 0.9, 0.1], L.axis);
  }
  /* Phase is measured from THIS beat's R, so anything belonging to the next
     beat — the P wave and the PR segment ahead of it — shows up as a large
     positive phase rather than a negative one. Segment effects are placed
     against the nearest R instead, or PR depression lands on nothing. */
  const rrCur = rrFor(kind, hr, beat);
  const near = phase > rrCur * 0.55 ? phase - rrCur : phase;

  if (m.st) {   /* ST shift lives between J point and T, not across the beat */
    const inST = near > 40 && near < 260;
    if (inST && m.st.leads.indexOf(leadId) >= 0) mv += m.st.mm;
    if (inST && m.recip && m.recip.leads.indexOf(leadId) >= 0) mv += m.recip.mm;
  }
  if (m.prDep) {
    /* The PR segment sits between the end of the P and the QRS. Depressed
       everywhere the ST is elevated, and elevated in aVR alongside its ST
       depression — the reciprocal pair is the diagnosis. */
    const inPR = near > -118 && near < -32;
    if (inPR) mv += (leadId === 'aVR' ? m.prDep : -m.prDep);
  }
  if (m.discordantT) {
    /* In LBBB and LVH the T opposes the main QRS deflection in that lead —
       "appropriate discordance", and the reason you cannot read ischaemia off
       a lateral lead in LBBB without Sgarbossa. */
    const qrsDir = dot(BASE.free.dir, L.axis);
    mv -= Math.sign(qrsDir) * 0.30 * gauss(near, BASE.tWave.mu, BASE.tWave.sd);
  }
  return mv;
}

/* A strip of samples, for drawing. */
function strip(leadId, kind, opts) {
  opts = opts || {};
  const ms = opts.ms || 2500, step = opts.step || 4, hr = opts.hr || 68;
  const out = [];
  for (let t = 0; t < ms; t += step) out.push(sample(leadId, t, kind, hr));
  return out;
}

/* Which rhythms this module can draw as a distinct 12-lead. Anything else
   falls back to the sinus vector sequence at that rhythm's rate, which is
   honest: the rate changes, the morphology does not pretend to. */
const SUPPORTED = Object.keys(MODS);

root.Leads12 = { LEADS, sample, strip, dipoleAt, SUPPORTED, MODS };

})(typeof window !== 'undefined' ? window : this);
