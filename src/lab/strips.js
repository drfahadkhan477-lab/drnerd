/* ═════════════════════════════════════════════
   strips.js — single-lead ECG strips as drill items.

   The rhythm generators already exist (src/core/rhythms-extra.js, the ones the
   Rhythm Lab plays). What a drill needs on top of a generator is the part a
   generator has no reason to know: which strip it is most often mistaken for,
   what to look at to tell them apart, and a way to hold the finished waveform to
   what it is supposed to show.

     STRIPS          the drill items: id, name, what it is, what to look at, look-alikes
     trace(id, s)    s seconds of the strip, in millivolts
     features(...)   what a reader would call it: the rate, whether it is regular, the
                     longest pause against the usual beat, how wide the QRS is

   features() works on the finished waveform and knows nothing about the generator
   that drew it, which is what lets a test hold the strip to its teaching point:
   a bundle-branch block that is not wider than a sinus beat is not one.

   Depends on rhythms-extra.js.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

const RX = root.RhythmsExtra || (typeof require === 'function' ? require('../core/rhythms-extra.js').RhythmsExtra : null);

const RATE = 250;   // samples per second: a clinical monitor's rate, and plenty for a QRS

const S = (id, points, confusableWith) => ({
  id, site: 'ECG', name: RX.EXTRA[id].name, blurb: RX.EXTRA[id].desc, points, confusableWith,
});

/* Teaching points and look-alikes are the app author's, not the rhythm module's. */
const STRIPS = [
  S('sinus_arrhythmia',
    ['The rate speeds up with inspiration and slows with expiration: the R-R interval changes in a cycle.', 'Every P is followed by a QRS and the P waves look the same. Normal, especially in the young.'],
    ['pac']),
  S('avb1',
    ['One P before every QRS, but the PR interval is long (over 200 ms, five small squares) and does not change.', 'Nothing is dropped: it is a delay, not a block of any beat.'],
    ['mobitz1', 'mobitz2']),
  S('mobitz1',
    ['The PR interval gets longer with each beat until a P wave is not followed by a QRS. Then the cycle starts again: longer, longer, longer, drop.', 'The block is in the AV node; usually benign.'],
    ['mobitz2', 'avb1', 'pac']),
  S('mobitz2',
    ['The PR interval is the same before every conducted beat, then a P wave suddenly fails to conduct.', 'The block is below the AV node. It can progress to complete heart block, so it is the one that needs a pacemaker.'],
    ['mobitz1', 'avb1']),
  S('pac',
    ['An early P wave with a different shape, a narrow QRS, and a pause after it that is not fully compensatory.'],
    ['bigeminy', 'sinus_arrhythmia']),
  S('bigeminy',
    ['A sinus beat then a premature ventricular beat, repeating: the PVC is wide, has no P wave before it, and its T wave points the other way.', 'The PVC comes early and a pause follows it, so the intervals alternate short, long, short, long.'],
    ['pac', 'idioventricular']),
  S('svt',
    ['Fast (around 150 to 250), regular and narrow, with no P waves you can see.', 'Terminates with a vagal manoeuvre or adenosine.'],
    ['junctional', 'wpw']),
  S('junctional',
    ['Narrow QRS at 40 to 60 with no P wave before it (or an inverted one right after): the AV node is setting the pace.'],
    ['idioventricular', 'svt']),
  S('idioventricular',
    ['Slow (under 40), wide, and no P waves: the ventricle has taken over because everything above it has failed.'],
    ['junctional', 'lbbb']),
  S('wpw',
    ['A short PR and a delta wave: the QRS begins with a slur and is slightly widened.', 'The pre-excitation runs down an accessory pathway that bypasses the AV node.'],
    ['lbbb', 'avb1']),
  S('lbbb',
    ['A wide QRS (over 120 ms) that is broad and notched, with a T wave that points the other way.', 'It hides the ordinary ECG signs of a heart attack.'],
    ['rbbb', 'idioventricular']),
  S('rbbb',
    ['A wide QRS (over 120 ms) with a second peak, R prime (rSR′): the "rabbit ears" in V1.'],
    ['lbbb', 'wpw']),
  S('hyperk',
    ['Tall, narrow, peaked T waves, then a flat P wave and a wide QRS as the potassium rises.'],
    ['longqt', 'pericarditis']),
  S('longqt',
    ['A long QT interval: the T wave ends late after the QRS. The set-up for torsades de pointes.'],
    ['hyperk']),
  S('pericarditis',
    ['ST elevation across many leads that is concave upward, with depression of the PR segment: it does not follow one coronary artery.'],
    ['hyperk', 'wpw']),
];

function byId(id) {
  const s = STRIPS.find(x => x.id === id);
  if (!s) throw new Error('strips: no strip "' + id + '"');
  return s;
}

/* trace(id, seconds, rate) → { samples: Float32Array (mV), rate, seconds }.
   The generator keeps its place between calls in a state object; one is made here. */
function trace(id, seconds, rate) {
  byId(id);
  rate = rate || RATE;
  seconds = seconds || 6;
  const n = Math.round(seconds * rate), state = {}, out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = RX.extraRhythmMV(id, i * 1000 / rate, state);
  return { samples: out, rate, seconds };
}

/* ── measuring a finished strip ──────────────────────────────────────────
   A QRS is the steepest thing on a strip by a wide margin, even when a T wave is
   taller than the R (hyperkalaemia), so beats are found by slope, not by height.

   Two things that are not a QRS are steep for a moment and are refused:
   a jump of one sample (the generator cuts a premature beat's T wave off where the next
   beat starts, which leaves a small step), and anything under 0.4 mV peak to trough. */
const QRS_SLOPE = 0.02;      // mV per ms; a T wave on these strips tops out near a sixth of this
const REFRACTORY_MS = 200;
const WINDOW_MS = 100;
const MIN_QRS_MV = 0.4;

function qrsAt(s, rate) {
  const msPer = 1000 / rate, d = new Float64Array(Math.max(0, s.length - 1));
  for (let i = 0; i < d.length; i++) d[i] = Math.abs(s[i + 1] - s[i]) / msPer;
  const steep = i => d[i] >= QRS_SLOPE && ((i + 1 < d.length && d[i + 1] >= QRS_SLOPE) || (i > 0 && d[i - 1] >= QRS_SLOPE));
  const span = Math.round(60 / msPer);
  const beats = [];
  let last = -Infinity;
  for (let i = 0; i < d.length; i++) {
    if (!steep(i) || i * msPer - last < REFRACTORY_MS) continue;
    /* the steepest point in the next 60 ms is the beat: the first crossing is only its edge */
    let k = i;
    for (let j = i; j < d.length && j - i < span; j++) if (d[j] > d[k]) k = j;
    let hi = -Infinity, lo = Infinity;
    for (let j = Math.max(0, k - span); j <= Math.min(s.length - 1, k + span); j++) { hi = Math.max(hi, s[j]); lo = Math.min(lo, s[j]); }
    if (hi - lo < MIN_QRS_MV) continue;
    beats.push({ i: k, ms: k * msPer, slope: d[k], r: hi });
    last = k * msPer;
  }
  return { beats, d, msPer };
}

const median = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };

/* features(samples, rate) →
     beats        how many QRS complexes
     rate         beats per minute over the strip
     rrMin, rrMax the shortest and longest interval between beats (ms)
     pause        rrMax / rrMin: 1 for a metronome, 2 where a beat is dropped
     regularity   spread of the intervals as a fraction of their mean (0 = a metronome)
     qrsMs        median QRS width: how long the steep part of each beat lasts
     tOverR       the tallest point after the QRS, over the QRS's own peak
     tPeakMs      how long after the QRS that tallest point is (long in long QT)
     stMv         the level a little after the QRS above the strip's own baseline (raised in pericarditis) */
function features(samples, rate) {
  rate = rate || RATE;
  const { beats, d, msPer } = qrsAt(samples, rate);
  const rr = [];
  for (let i = 1; i < beats.length; i++) rr.push(beats[i].ms - beats[i - 1].ms);
  const mean = rr.length ? rr.reduce((a, b) => a + b, 0) / rr.length : 0;
  const sd = rr.length ? Math.sqrt(rr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / rr.length) : 0;
  const rrMin = rr.length ? Math.min(...rr) : 0, rrMax = rr.length ? Math.max(...rr) : 0;

  /* width: the samples within ±WINDOW_MS of the steepest point whose slope is at least a fifth
     of that beat's own steepest, ignoring any that stand alone */
  const widths = [];
  const win = Math.round(WINDOW_MS / msPer);
  for (const b of beats) {
    const lo = Math.max(0, b.i - win), hi = Math.min(d.length - 1, b.i + win);
    const on = i => d[i] >= b.slope * 0.2;
    let a = -1, z = -1;
    for (let i = lo; i <= hi; i++) if (on(i) && ((i > lo && on(i - 1)) || (i < hi && on(i + 1)))) { if (a < 0) a = i; z = i; }
    if (a >= 0) widths.push((z - a + 1) * msPer);
  }

  const base = median(Array.from(samples));
  const ratios = [], tAt = [], st = [];
  for (let n = 0; n < beats.length; n++) {
    const b = beats[n];
    const next = n + 1 < beats.length ? beats[n + 1].i : Infinity;
    const t0 = b.i + Math.round(120 / msPer), t1 = Math.min(samples.length - 1, b.i + Math.round(480 / msPer), next - Math.round(80 / msPer));
    if (t1 <= t0 || b.r <= 0) continue;
    let t = -Infinity, ta = t0;
    for (let i = t0; i <= t1; i++) if (samples[i] > t) { t = samples[i]; ta = i; }
    ratios.push(t / b.r); tAt.push((ta - b.i) * msPer);
    const s0 = b.i + Math.round(80 / msPer), s1 = Math.min(t1, b.i + Math.round(120 / msPer));
    if (s1 > s0) { let m = 0; for (let i = s0; i <= s1; i++) m += samples[i]; st.push(m / (s1 - s0 + 1) - base); }
  }
  return {
    beats: beats.length,
    rate: beats.length > 1 ? (beats.length - 1) / ((beats[beats.length - 1].ms - beats[0].ms) / 60000) : 0,
    rr, rrMin, rrMax, pause: rrMin ? rrMax / rrMin : 0,
    regularity: mean ? sd / mean : 0,
    qrsMs: median(widths), tOverR: median(ratios), tPeakMs: median(tAt), stMv: median(st),
    seconds: samples.length / rate,
  };
}

root.Strips = { STRIPS, RATE, byId, trace, features };

})(typeof window !== 'undefined' ? window : this);
