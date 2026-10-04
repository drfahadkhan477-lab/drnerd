#!/usr/bin/env node
/*
 * A rhythm in the menu that nothing knows how to draw.
 *
 *   node tests/verify-rhythms-pure.js
 *
 * Pure Node, no browser, no build. rhythms-extra.js duplicates the beat model
 * rather than importing it precisely so it can be tested alone — its header has
 * said so since it was written, and until now nothing took it up on that.
 *
 * THE FAILURE THIS EXISTS FOR. The module holds two things that must agree and
 * are written hundreds of lines apart: EXTRA, the table of {name, hr, desc}
 * that the picker reads, and a switch that turns a key into millivolts.
 * polish-patch merges the first into the app's shared registry —
 *
 *     Object.assign(RHYTHMS, RhythmsExtra.EXTRA);
 *
 * — and wires the second in front of the base engine's own dispatcher:
 *
 *     const extra = RhythmsExtra.extraRhythmMV(kind, tms, st);
 *     if (extra !== null) return extra;
 *
 * So adding a rhythm to EXTRA and forgetting its case does not throw, does not
 * warn, and does not render an empty strip. extraRhythmMV returns null, the
 * host falls through to a switch that has no case for it either, and
 * `RHYTHMS[kind] || RHYTHMS.sinus` resolves to the merged EXTRA entry — so the
 * app shows the new rhythm's NAME, labels it with the new rhythm's RATE, and
 * draws a normal sinus beat underneath.
 *
 * A study aid that labels a normal tracing "Mobitz II" is worse than one that
 * draws nothing: the fellow learns a wrong pattern and is confident about it.
 * The whole point of these fifteen is single-lead recognition.
 *
 * WHAT IS DELIBERATELY NOT CHECKED HERE. Rate. Counting R peaks over a minute
 * and comparing to the declared `hr` looks like the obvious test and is a trap:
 * rbbb's RSR' is two peaks per QRS by definition, hyperkalemia's peaked T
 * clears any sane threshold, and mobitz drops beats on purpose, so the
 * ventricular rate is SUPPOSED to sit below the atrial rate it is labelled
 * with. A peak counter naive enough to run on all fifteen would be encoding
 * its own naivety as the specification, and the three "failures" it reported
 * would all be the module being right. Rate belongs to an eye on a strip.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const SRC = path.join(__dirname, '..', 'src', 'core', 'rhythms-extra.js');
const text = fs.readFileSync(SRC, 'utf8');
const root = {};
new Function(text).call(root);
const R = root.RhythmsExtra;

/* One full minute at 2 ms, which covers the slowest rhythm here
   (idioventricular at 34 bpm) many times over and every grouped-beating cycle
   mobitz I builds up to. */
const SWEEP = [];
for (let t = 0; t < 60000; t += 2) SWEEP.push(t);

head('the module loaded and exposes what the host patches in');
{
  ok('RhythmsExtra is exported', !!R);
  ok('extraRhythmMV is a function', typeof R.extraRhythmMV === 'function');
  ok('EXTRA is a non-empty table', R.EXTRA && Object.keys(R.EXTRA).length > 0,
     Object.keys(R.EXTRA || {}).length + ' rhythms');
}

head('every rhythm the picker offers can actually be drawn');
{
  /* The check the file exists for. A key is "dead" if it never produces a
     number anywhere in a full minute — not at one sampled instant, which any
     rhythm can legitimately spend on the baseline. */
  const dead = Object.keys(R.EXTRA).filter(k =>
    SWEEP.every(t => R.extraRhythmMV(k, t, {}) === null));
  ok('no key in EXTRA is missing its generator', dead.length === 0,
     dead.length ? dead.join(', ') + ' would render as sinus under a pathology label' : '');
}

head('and nothing draws a rhythm the picker never offers');
{
  /* The other direction. A `case` for a key absent from EXTRA is unreachable —
     the dispatcher returns null before the switch when EXTRA has no entry — so
     it is dead code, and the usual way it appears is a key renamed in one place
     only. The check above already fails in that situation; this one names the
     cause instead of the symptom.

     Read from the comment-BLANKED source: this file's own header quotes the
     dispatcher, and a scan that reads comments would find case labels in the
     prose explaining the scan. */
  const body = blankComments(text);
  const cases = [...body.matchAll(/case\s+'([a-z0-9_]+)'/g)].map(m => m[1]);
  const orphan = cases.filter(k => !(k in R.EXTRA));
  ok('every case label has an EXTRA entry', orphan.length === 0,
     orphan.length ? orphan.join(', ') + ' — renamed in EXTRA but not in the switch?' : '');
  ok('the scan found the switch at all', cases.length >= 10, cases.length + ' case labels');
}

head('the fall-through sentinel is exactly null');
{
  /* The host tests `extra !== null`. Any other falsy return — 0 for a moment on
     the baseline, undefined from a missing branch — would be taken as a real
     sample and short-circuit the base engine for every rhythm it owns. */
  const unknown = R.extraRhythmMV('no_such_rhythm', 0, {});
  ok('an unknown kind returns null', unknown === null, 'got ' + JSON.stringify(unknown));
  ok('not merely falsy', unknown !== 0 && unknown !== undefined && unknown !== false);
  ok('a missing kind is null too', R.extraRhythmMV(undefined, 0, {}) === null);
  ok('and a numeric kind is null', R.extraRhythmMV(0, 0, {}) === null);
}

head('every sample is a number the canvas can plot');
{
  /* NaN does not throw and does not show: a path command with NaN in it is
     dropped, so a generator that divides by zero once per cycle draws a strip
     with invisible gaps rather than an error. */
  const bad = [];
  for (const k of Object.keys(R.EXTRA)) {
    for (const t of SWEEP) {
      const v = R.extraRhythmMV(k, t, {});
      if (typeof v !== 'number' || !Number.isFinite(v)) { bad.push(`${k}@${t}ms=${v}`); break; }
    }
  }
  ok('no NaN, no Infinity, no undefined in a full minute', bad.length === 0, bad.join(', '));
}

head('and stays inside a plottable envelope');
{
  /* A backstop against a runaway gaussian, not a pin on today's numbers. The
     real traces peak near 1.3 mV; 5 is far enough above that a legitimate
     morphology change never trips it and a sign error always does. */
  const LIMIT = 5;
  const over = [];
  for (const k of Object.keys(R.EXTRA)) {
    let peak = 0;
    for (const t of SWEEP) peak = Math.max(peak, Math.abs(R.extraRhythmMV(k, t, {})));
    if (peak > LIMIT) over.push(`${k} ${peak.toFixed(1)}mV`);
  }
  ok(`no rhythm exceeds ${LIMIT} mV`, over.length === 0, over.join(', '));
}

head('arriving at an instant two different ways gives the same trace');
{
  /* Five of these carry state between calls — the RR accumulators behind
     Wenckebach's lengthening PR, the PAC's early beat, bigeminy's alternation.
     The app steps that state forward one animation frame at a time; a test, a
     resumed tab, or a frame the browser dropped arrives at the same instant
     cold, and the while-loops catch up from zero.

     Those two paths must agree, and nothing made them. The property is that
     st is a CATCH-UP CACHE and never an accumulator: everything in it must be
     rebuildable from zero by the while-loop, so that how many times the
     function has been called cannot change what it returns. A generator that
     instead advanced something per call — a counter, a phase, a nudge — looks
     perfect in a continuous run and changes shape after any dropped frame,
     which is the kind of bug that gets blamed on the canvas for a week.

     WHAT IT DOES NOT CATCH, checked rather than assumed: arithmetic drift. The
     first thing tried here was rounding each RR as it went into st.next, and
     this check passed — because the cold path replays the same while-loop with
     the same rounding from the same t=0, so both paths drift identically. Only
     call-count dependence diverges. The narrower claim is the true one. */
  const diverged = [];
  for (const k of Object.keys(R.EXTRA)) {
    const warm = {};
    for (let t = 0; t < 20000; t += 16) {          // 16ms ≈ one frame at 60fps
      const stepped = R.extraRhythmMV(k, t, warm);
      const sought = R.extraRhythmMV(k, t, {});
      if (Math.abs(stepped - sought) > 1e-9) { diverged.push(`${k}@${t}ms`); break; }
    }
  }
  ok('stepped frame by frame matches seeking straight there', diverged.length === 0,
     diverged.join(', '));
}

head('the AV-block strips show the interval they are named for');
{
  /* Each strip is read as a reader reads it: the gap from the top of the P wave to the top
     of the R that follows it. A first-degree block drawn with a normal-looking P-to-R gap, or a
     Wenckebach whose PR never lengthens, is a normal beat with the wrong name on it. This is
     also the one place the interval is measured at all: the suite above holds that these
     rhythms are drawn, not that they look like what they are called. */
  const MS = 1;
  function pToR(kind, seconds) {
    const st = {}, n = seconds * 1000 / MS, s = new Float64Array(n);
    for (let i = 0; i < n; i++) s[i] = R.extraRhythmMV(kind, i * MS, st);
    const beats = [];
    for (let i = 450; i < n - 5; i++) {
      if (s[i] > 0.7 && s[i] >= s[i - 1] && s[i] >= s[i + 1] && (!beats.length || i - beats[beats.length - 1].r > 300)) {
        let p = i - 60, best = -Infinity;
        for (let j = i - 340; j <= i - 60; j++) if (s[j] > best) { best = s[j]; p = j; }
        beats.push({ r: i, gap: i - p });
      }
    }
    return beats;
  }
  const sinus = pToR('sinus_arrhythmia', 12);
  const base = sinus[3].gap;
  ok('a normal beat has a P-to-R gap of about 140 ms (the yardstick the rest are held to)', base > 120 && base < 160, base + ' ms');
  ok('and it does not change from beat to beat in a rhythm with a normal PR, however the rate varies', sinus.length > 8 && sinus.every(b => Math.abs(b.gap - base) <= 3), sinus.length + ' beats');

  const first = pToR('avb1', 12);
  ok('first-degree block: the P-to-R gap is far longer than a normal beat\'s (PR over 200 ms)', first.length > 5 && first.every(b => b.gap >= base * 1.8), first.slice(0, 3).map(b => b.gap).join(',') + ' ms against ' + base);
  ok('and the same on every beat: it is a fixed delay', first.every(b => Math.abs(b.gap - first[0].gap) <= 3));

  const w = pToR('mobitz1', 40);
  /* runs of conducted beats are separated by a pause (the dropped one) */
  const between = []; for (let i = 1; i < w.length; i++) between.push(w[i].r - w[i - 1].r);
  const usual = between.slice().sort((a, b) => a - b)[Math.floor(between.length / 3)];   // a conducted-to-conducted gap
  const runs = [[w[0]]];
  for (let i = 1; i < w.length; i++) { if (w[i].r - w[i - 1].r > 1.3 * usual) runs.push([]); runs[runs.length - 1].push(w[i]); }
  const full = runs.filter(r => r.length === 3);
  /* the first group is cut by the start of the strip, and the last by its end */
  ok('Mobitz I: beats come in groups of three, each followed by a dropped beat', full.length >= 3 && runs.slice(1, -1).every(r => r.length === 3), runs.map(r => r.length).join(','));
  ok('and within each group the PR lengthens: longer, longer, then the drop', full.every(r => r[1].gap >= r[0].gap + 30 && r[2].gap >= r[1].gap + 30), full.slice(0, 2).map(r => r.map(b => b.gap).join('→')).join(' | '));
  ok('and the first beat after a pause has the shortest PR again', full.length > 1 && full.slice(1).every((r, k) => r[0].gap <= full[k][2].gap - 60), '');

  const m2 = pToR('mobitz2', 40);
  ok('Mobitz II: the PR does not change before the beats that do conduct', m2.length > 8 && m2.every(b => Math.abs(b.gap - m2[0].gap) <= 3), m2.slice(0, 4).map(b => b.gap).join(',') + ' ms');
  ok('and it is a normal PR (under 200 ms), not a long one: the block shows only in the dropped beats', m2[0].gap >= base && m2[0].gap <= base + 40, m2[0].gap + ' ms against ' + base);
  const gaps = []; for (let i = 1; i < m2.length; i++) gaps.push(m2[i].r - m2[i - 1].r);
  ok('which leave a pause twice the usual interval', gaps.some(g => g > 1.9 * Math.min(...gaps) && g < 2.1 * Math.min(...gaps)), Math.min(...gaps) + ' and ' + Math.max(...gaps) + ' ms');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
