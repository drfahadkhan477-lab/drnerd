#!/usr/bin/env node
/*
 * Pressure tracings and the drill engine behind every Lab exercise.
 *
 *   node tests/verify-drills-pure.js
 *
 * Pure Node (src/lab/tracings.js, src/lab/drill.js). Tracings are held by what a
 * reader sees, measured from the FINISHED curve: how big the a wave is, whether an
 * x or a y descent exists, where a giant wave falls in the cycle, the mean. The
 * parameters they were built from are never read back. The one difference that
 * matters most (constriction versus tamponade) is a y descent, and is checked as one.
 *
 * ECG strips (src/lab/strips.js) are held the same way: by what a reader reads off the
 * finished waveform (the rate, whether it is regular, a dropped beat, how wide the QRS is,
 * how tall the T is next to the R, how late it falls, whether the ST is lifted), measured
 * by a detector that knows nothing about the generator. Rate and width are where a naive
 * peak counter lies (an rSR' is two peaks, a peaked T is taller than the R), so those are
 * checked on exactly those strips.
 *
 * The drill engine is held by what it chooses: what is due first and most forgotten
 * first, never the item just shown, never empty, and wrong answers that are the
 * look-alikes, with the right answer in a different place each time.
 */
'use strict';
const Physio = require('../src/core/physio.js').Physio;
const FSRS = require('../src/core/fsrs.js').FSRS;
const T = require('../src/lab/tracings.js').Tracings;
const D = require('../src/lab/drill.js').Drill;
const RX = require('../src/core/rhythms-extra.js').RhythmsExtra;
const Strips = require('../src/lab/strips.js').Strips;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const F = {};
T.TRACINGS.forEach(t => { F[t.id] = T.features(t.fn); });
const f = id => F[id];

head('every tracing is a well-formed cycle');
{
  const ids = T.TRACINGS.map(t => t.id);
  ok('ids are unique and each has a name, a blurb, teaching points and a site', new Set(ids).size === ids.length && T.TRACINGS.every(t => t.name && t.blurb.length > 30 && t.points.length >= 2 && (t.site === 'RA' || t.site === 'PCWP')), String(ids.length));
  const bad = T.TRACINGS.filter(t => { for (let i = 0; i <= 200; i++) { const v = t.fn(i / 200); if (!Number.isFinite(v) || v < -2 || v > 60) return true; } return false; });
  ok('every curve is finite and within a plausible pressure range', bad.length === 0, bad.map(t => t.id).join(', ') || 'all');
  const open = T.TRACINGS.filter(t => Math.abs(t.fn(0) - t.fn(1)) > 1e-6 || Math.abs(t.fn(0.3) - t.fn(1.3)) > 1e-6);
  ok('and each repeats exactly from one cycle to the next', open.length === 0, open.map(t => t.id).join(', ') || 'all');
  const confus = T.TRACINGS.filter(t => t.confusableWith.some(c => !ids.includes(c) || c === t.id));
  ok('the look-alikes each tracing names are other tracings', confus.length === 0, confus.map(t => t.id).join(', ') || 'all');
  const asym = T.TRACINGS.filter(t => t.confusableWith.length && !t.confusableWith.some(c => T.byId(c).site === t.site));
  ok('and at least one is from the same site, so the drill compares like with like', asym.length === 0, asym.map(t => t.id).join(', ') || 'all');
}

head('the normal traces are physio\'s own');
{
  let worst = 0;
  for (let i = 0; i < 200; i++) worst = Math.max(worst, Math.abs(T.byId('ra-normal').fn(i / 200) - Physio.raPressure(i / 200)), Math.abs(T.byId('pcwp-normal').fn(i / 200) - Physio.laPressure(i / 200)));
  ok('the normal right atrial and wedge traces equal physio\'s atrial curves', worst < 1e-9, worst.toExponential(1));
  ok('a normal right atrial mean is low, and the a wave is small', f('ra-normal').mean < 6 && f('ra-normal').aPeak > 1 && f('ra-normal').aPeak < 6, `mean ${f('ra-normal').mean.toFixed(1)}, a ${f('ra-normal').aPeak.toFixed(1)}`);
  const orig = Physio.raPressure; let moved;
  Physio.raPressure = t => orig(t) + 5;
  try { moved = T.byId('ra-normal').fn(0.3); } finally { Physio.raPressure = orig; }
  ok('and changing the physiology changes the normal trace with it', Math.abs(moved - (orig(0.3) + 5)) < 1e-9, `${moved.toFixed(2)} vs ${(orig(0.3) + 5).toFixed(2)}`);
}

head('each abnormal tracing shows what it is named for');
{
  const n = f('ra-normal');
  ok('tricuspid regurgitation: no x descent, a giant systolic wave, a steep y descent, a high mean',
     f('ra-tr').xDepth < 0.5 && f('ra-tr').sysPeak > 10 && f('ra-tr').sysAt > 0.2 && f('ra-tr').sysAt < 0.42 && f('ra-tr').yDepth > 4 && f('ra-tr').mean > 10, JSON.stringify({ x: f('ra-tr').xDepth.toFixed(1), sys: f('ra-tr').sysPeak.toFixed(1), y: f('ra-tr').yDepth.toFixed(1) }));
  ok('and the normal trace does have an x descent and no giant systolic wave', n.xDepth > 0.8 && n.sysPeak < 3);
  ok('tricuspid stenosis: a giant a wave and a slow, shallow y descent', f('ra-ts').aPeak > 8 && f('ra-ts').aPeak > 2.5 * n.aPeak && f('ra-ts').yDepth < 0.5 * n.yDepth, `a ${f('ra-ts').aPeak.toFixed(1)}, y ${f('ra-ts').yDepth.toFixed(1)} vs ${n.yDepth.toFixed(1)}`);
  ok('atrial fibrillation: no a wave, a prominent v wave', f('ra-af').aPeak < 1.5 && f('ra-af').vPeak > 4 && f('ra-af').xDepth < 0.5 * n.xDepth + 0.3, `a ${f('ra-af').aPeak.toFixed(1)}, v ${f('ra-af').vPeak.toFixed(1)}`);
  ok('AV dissociation: a giant a wave that falls in systole, not before it', f('ra-cannon').sysPeak > 10 && f('ra-cannon').sysAt > 0.15 && f('ra-cannon').sysAt < 0.35 && f('ra-cannon').aPeak < 3, `systolic ${f('ra-cannon').sysPeak.toFixed(1)} at ${f('ra-cannon').sysAt.toFixed(2)}, atrial-systole ${f('ra-cannon').aPeak.toFixed(1)}`);
  ok('pulmonary hypertension: a giant a wave in atrial systole', f('ra-pulmhtn').aPeak > 8 && (f('ra-pulmhtn').aAt < 0.12 || f('ra-pulmhtn').aAt > 0.88), `a ${f('ra-pulmhtn').aPeak.toFixed(1)}`);
  ok('constrictive pericarditis: a high mean, deep x AND y descents, the y deeper', f('ra-constriction').mean > 12 && f('ra-constriction').xDepth > 4 && f('ra-constriction').yDepth > 4 && f('ra-constriction').yDepth > 1.2 * f('ra-constriction').xDepth,
     `mean ${f('ra-constriction').mean.toFixed(1)}, x ${f('ra-constriction').xDepth.toFixed(1)}, y ${f('ra-constriction').yDepth.toFixed(1)}`);
  ok('tamponade: a high mean, a deep x descent, NO y descent', f('ra-tamponade').mean > 12 && f('ra-tamponade').xDepth > 4 && f('ra-tamponade').yDepth < 1, `x ${f('ra-tamponade').xDepth.toFixed(1)}, y ${f('ra-tamponade').yDepth.toFixed(2)}`);
  ok('restrictive cardiomyopathy: deep descents, the y at least as deep as the x', f('ra-restrictive').mean > 12 && f('ra-restrictive').yDepth >= f('ra-restrictive').xDepth && f('ra-restrictive').yDepth > 4);
  /* The point of the whole set: the one thing that separates constriction from tamponade. */
  ok('constriction and tamponade differ by the y descent, and by little else',
     f('ra-constriction').yDepth - f('ra-tamponade').yDepth > 5 && Math.abs(f('ra-constriction').mean - f('ra-tamponade').mean) < 3, `y ${f('ra-constriction').yDepth.toFixed(1)} vs ${f('ra-tamponade').yDepth.toFixed(1)}; means ${f('ra-constriction').mean.toFixed(1)} vs ${f('ra-tamponade').mean.toFixed(1)}`);
  const w = f('pcwp-normal');
  ok('acute mitral regurgitation (wedge): a giant v wave in systole, far larger than the a, and a high mean',
     f('pcwp-mr').vPeak > 15 && f('pcwp-mr').vPeak > 3 * f('pcwp-mr').aPeak && f('pcwp-mr').vAt > 0.3 && f('pcwp-mr').vAt < 0.5 && f('pcwp-mr').mean > 15, `v ${f('pcwp-mr').vPeak.toFixed(1)} at ${f('pcwp-mr').vAt.toFixed(2)}, a ${f('pcwp-mr').aPeak.toFixed(1)}`);
  ok('mitral stenosis (wedge): a high mean and a slow, shallow y descent', f('pcwp-ms').mean > 15 && f('pcwp-ms').yDepth < 0.5 * w.yDepth, `y ${f('pcwp-ms').yDepth.toFixed(1)} vs normal ${w.yDepth.toFixed(1)}`);
  ok('and a normal wedge has neither a giant v wave nor a raised mean', w.vPeak < 8 && w.mean < 12, `v ${w.vPeak.toFixed(1)}, mean ${w.mean.toFixed(1)}`);
}

/* ── the drill engine ─────────────────────────────────────────────── */
const TODAY = '2026-10-10';
const day = n => FSRS.localDateToISO(new Date(FSRS.isoToLocalDate(TODAY).getTime() + n * 86400000));
const items = T.TRACINGS.map(t => ({ id: t.id, site: t.site, confusableWith: t.confusableWith }));
const card = (ago, rating) => FSRS.update(FSRS.update(null, rating || 3, day(-ago - 20)), rating || 3, day(-ago));

head('every ECG strip is a drill item with a reason to be one');
const SF = {};
{
  const ids = Strips.STRIPS.map(t => t.id);
  ok('every rhythm the Rhythm Lab can draw has a strip, and every strip is a rhythm it can draw', JSON.stringify(ids.slice().sort()) === JSON.stringify(Object.keys(RX.EXTRA).sort()), ids.length + ' strips, ' + Object.keys(RX.EXTRA).length + ' rhythms');
  ok('ids are unique and each has a name (the rhythm\'s own), a description, teaching points and a site', new Set(ids).size === ids.length && Strips.STRIPS.every(t => t.name === RX.EXTRA[t.id].name && t.blurb.length > 30 && t.points.length >= 1 && t.points.every(p => p.length > 30) && t.site === 'ECG'));
  const confus = Strips.STRIPS.filter(t => !t.confusableWith.length || t.confusableWith.some(c => !ids.includes(c) || c === t.id));
  ok('every strip names at least one look-alike, and each is another strip', confus.length === 0, confus.map(t => t.id).join(', ') || 'all');
  Strips.STRIPS.forEach(t => { const tr = Strips.trace(t.id, 30); SF[t.id] = Strips.features(tr.samples, tr.rate); });
  const bad = Strips.STRIPS.filter(t => { const s = Strips.trace(t.id, 6).samples; let lo = Infinity, hi = -Infinity; for (const v of s) { if (!Number.isFinite(v)) return true; lo = Math.min(lo, v); hi = Math.max(hi, v); } return hi - lo < 0.8 || hi > 3 || lo < -3; });
  ok('every strip is finite, within 3 mV, and not flat', bad.length === 0, bad.map(t => t.id).join(', ') || 'all');
  const sig = Strips.STRIPS.map(t => Array.from(Strips.trace(t.id, 3).samples.slice(0, 500)).map(v => v.toFixed(3)).join());
  ok('no two strips are the same drawing', new Set(sig).size === sig.length);
  ok('the same strip is the same every time, and an unknown one is an error rather than a flat line', JSON.stringify(Array.from(Strips.trace('avb1', 2).samples)) === JSON.stringify(Array.from(Strips.trace('avb1', 2).samples)) && (() => { try { Strips.trace('nope', 2); return false; } catch (_) { return true; } })());
}

head('the strip reader counts beats, not peaks');
{
  const f = id => SF[id];
  /* the rate trap: where the number of peaks is not the number of beats */
  const declared = ['sinus_arrhythmia', 'avb1', 'svt', 'junctional', 'idioventricular', 'wpw', 'lbbb', 'rbbb', 'hyperk', 'longqt', 'pericarditis'];
  const off = declared.filter(id => Math.abs(f(id).rate - RX.EXTRA[id].hr) / RX.EXTRA[id].hr > 0.06);
  ok('the rate read off the strip matches the one the rhythm is labelled with, on every rhythm whose labelled rate is its ventricular rate', off.length === 0, off.map(id => `${id} ${f(id).rate.toFixed(0)} vs ${RX.EXTRA[id].hr}`).join(', ') || declared.length + ' rhythms');
  ok('an rSR\' counts as one beat, not two: right bundle branch block at 70, not 140', Math.abs(f('rbbb').rate - 70) < 3, f('rbbb').rate.toFixed(1));
  ok('a peaked T as tall as the R is not a beat: hyperkalaemia at 62, not 124', Math.abs(f('hyperk').rate - 62) < 3 && f('hyperk').tOverR > 0.8, `${f('hyperk').rate.toFixed(1)}, T/R ${f('hyperk').tOverR.toFixed(2)}`);
  ok('a premature beat\'s cut-off T wave is not a beat: bigeminy is about 83 a minute, not 124', f('bigeminy').rate > 70 && f('bigeminy').rate < 95, f('bigeminy').rate.toFixed(1));
  /* the same things, made up, so that the reader is held to its own rule and not to the generator's quirks */
  const rate = 250, step = new Float32Array(rate * 10); for (let i = 0; i < step.length; i++) step[i] = (Math.floor(i / rate) % 2) ? 0.6 : 0;
  ok('a jump of one sample is not a beat, however tall (a step of 0.6 mV every second, ten of them: steep and tall, so only its being one sample refuses it)', Strips.features(step, rate).beats === 0, String(Strips.features(step, rate).beats));
  const small = new Float32Array(rate * 10); for (let i = 0; i < small.length; i++) { const ph = (i % rate) / rate; small[i] = ph < 0.02 ? 0.3 * Math.sin(ph / 0.02 * Math.PI) : 0; }
  ok('and a hump that is steep for several samples but under 0.4 mV tall is not a beat either (so only its height refuses it)', Strips.features(small, rate).beats === 0, String(Strips.features(small, rate).beats));
  const empty = Strips.features(new Float32Array(0), rate), one = Strips.features(new Float32Array(100), rate);
  ok('an empty or flat strip reads as no beats and a rate of zero, not NaN', empty.beats === 0 && one.beats === 0 && empty.rate === 0 && Number.isFinite(one.regularity) && Number.isFinite(one.qrsMs), JSON.stringify([empty.rate, one.rate]));
}

head('each strip shows what it is named for');
{
  const f = id => SF[id];
  const base = f('avb1');
  ok('the yardstick is a regular, narrow beat', base.regularity < 0.01 && base.qrsMs >= 30 && base.qrsMs <= 60, `regularity ${base.regularity.toFixed(3)}, QRS ${base.qrsMs} ms`);
  ok('supraventricular tachycardia is fast, regular and narrow', f('svt').rate > 150 && f('svt').regularity < 0.03 && f('svt').qrsMs <= base.qrsMs * 1.3, `${f('svt').rate.toFixed(0)}/min, QRS ${f('svt').qrsMs} ms`);
  ok('an idioventricular escape is slow, regular and wide', f('idioventricular').rate < 40 && f('idioventricular').regularity < 0.03 && f('idioventricular').qrsMs >= base.qrsMs * 1.8, `${f('idioventricular').rate.toFixed(0)}/min, QRS ${f('idioventricular').qrsMs} ms`);
  ok('a junctional escape is 40 to 60, regular and narrow', f('junctional').rate >= 40 && f('junctional').rate <= 60 && f('junctional').regularity < 0.03 && f('junctional').qrsMs <= base.qrsMs * 1.3, `${f('junctional').rate.toFixed(0)}/min`);
  ok('both bundle branch blocks are at least twice as wide as a normal beat', f('lbbb').qrsMs >= base.qrsMs * 2 && f('rbbb').qrsMs >= base.qrsMs * 2, `L ${f('lbbb').qrsMs}, R ${f('rbbb').qrsMs}, normal ${base.qrsMs} ms`);
  ok('pre-excitation widens the QRS, but less than a bundle branch block does', f('wpw').qrsMs >= base.qrsMs * 1.3 && f('wpw').qrsMs < f('lbbb').qrsMs, `WPW ${f('wpw').qrsMs} ms`);
  const narrow = ['sinus_arrhythmia', 'avb1', 'mobitz1', 'mobitz2', 'pac', 'svt', 'junctional', 'longqt', 'pericarditis'];
  ok('hyperkalaemia\'s T wave is as tall as its R and no other narrow rhythm\'s is', f('hyperk').tOverR >= 0.8 && narrow.every(id => f(id).tOverR < 0.5), narrow.map(id => f(id).tOverR.toFixed(2)).join(' '));
  ok('a long QT puts the top of the T wave at least 1.6 times later after the QRS than a normal beat does', f('longqt').tPeakMs >= base.tPeakMs * 1.6, `${f('longqt').tPeakMs} against ${base.tPeakMs} ms`);
  ok('pericarditis lifts the ST segment, and a normal beat does not', f('pericarditis').stMv >= base.stMv + 0.07, `${f('pericarditis').stMv.toFixed(3)} against ${base.stMv.toFixed(3)} mV`);

  const near = (v, a, b) => Math.abs(v - a) <= 0.08 * a || Math.abs(v - b) <= 0.08 * b;
  const m2 = f('mobitz2');
  ok('Mobitz II: the intervals are one length or double it, and double it where a beat is dropped', m2.pause > 1.9 && m2.pause < 2.1 && m2.rr.every(v => near(v, m2.rrMin, m2.rrMax)), `pause ${m2.pause.toFixed(2)}`);
  const m1 = f('mobitz1');
  const longRR = m1.rr.filter(v => v > m1.rrMin * 1.3);
  ok('Mobitz I: one long interval in every three, shorter than double because the PR resets', m1.pause > 1.5 && m1.pause < 1.95 && longRR.length > 0 && Math.abs(m1.rr.length / longRR.length - 3) < 0.5, `pause ${m1.pause.toFixed(2)}, 1 long in ${(m1.rr.length / longRR.length).toFixed(1)}`);
  const bg = f('bigeminy').rr;
  const shortFirst = bg[0] < bg[1];
  const alt = bg.every((v, i) => i === bg.length - 1 || ((v < bg[i + 1]) === ((i % 2 === 0) === shortFirst)));
  ok('bigeminy alternates short and long: a premature beat, then a pause, every time', alt && f('bigeminy').pause > 1.8, `pause ${f('bigeminy').pause.toFixed(2)}`);
  const med = Strips.features(Strips.trace('pac', 30).samples, 250).rr.slice().sort((a, b) => a - b)[Math.floor(f('pac').rr.length / 2)];
  ok('premature atrial complexes come early: the shortest interval is under three quarters of the usual one', f('pac').rrMin < med * 0.75, `${f('pac').rrMin} against ${med} ms`);
  const sa = f('sinus_arrhythmia');
  ok('sinus arrhythmia varies gently: irregular, but never a pause or an early beat', sa.regularity > 0.05 && sa.regularity < 0.25 && sa.pause < 1.6, `regularity ${sa.regularity.toFixed(3)}, pause ${sa.pause.toFixed(2)}`);
  ok('and the regular rhythms are regular', ['avb1', 'svt', 'junctional', 'idioventricular', 'wpw', 'lbbb', 'rbbb', 'hyperk', 'longqt', 'pericarditis'].every(id => f(id).regularity < 0.04 && f(id).pause < 1.1), '');
}

head('which item next');
{
  ok('with no history it offers something new', (r => r && r.reason === 'new' && items.some(i => i.id === r.item.id))(D.next({ items, cards: {}, today: TODAY, seed: 1 })));
  const cards = {};
  items.forEach(i => { cards[i.id] = card(3, 3); cards[i.id].due = day(5); });
  cards['ra-tr'] = card(40, 3); cards['ra-tr'].due = day(-2);              // due, but remembered?
  cards['ra-ts'] = FSRS.update(null, 1, day(-60)); cards['ra-ts'].due = day(-1);   // due, and nearly forgotten
  const r = D.next({ items, cards, today: TODAY, seed: 1 });
  ok('what is due comes first, and the most forgotten of it first', r.reason === 'due' && r.item.id === 'ra-ts', `${r.reason} ${r.item.id}`);
  const rec = (id) => D.recall(cards[id], TODAY);
  ok('and that is because it is the less remembered of the two due', rec('ra-ts') < rec('ra-tr'), `${rec('ra-ts').toFixed(2)} vs ${rec('ra-tr').toFixed(2)}`);
  const none = {}; items.forEach(i => { none[i.id] = card(2, 3); none[i.id].due = day(7); });
  const ahead = D.next({ items, cards: none, today: TODAY, seed: 1 });
  ok('with nothing due and nothing new it still has something: the weakest thing you know', ahead.reason === 'review-ahead' && !!ahead.item);
  const again = D.next({ items, cards: {}, today: TODAY, seed: 1, recent: ['a', 'b', 'c'] });
  ok('the same seed gives the same choice', D.next({ items, cards: {}, today: TODAY, seed: 5 }).item.id === D.next({ items, cards: {}, today: TODAY, seed: 5 }).item.id && !!again);
  const picked = new Set(); for (let s = 1; s <= 30; s++) picked.add(D.next({ items, cards: {}, today: TODAY, seed: s }).item.id);
  ok('and different seeds give different new items, not always the first', picked.size > 3, String(picked.size));
  const recent = ['ra-tr', 'ra-ts', 'ra-af'];
  const streak = [...Array(40).keys()].map(s => D.next({ items, cards: {}, today: TODAY, seed: s + 1, recent }).item.id);
  ok('it never shows one of the last three again', streak.every(id => !recent.includes(id)), [...new Set(streak)].join(','));
  ok('unless there is nothing else', D.next({ items: items.slice(0, 1), cards: {}, today: TODAY, seed: 1, recent: [items[0].id] }).item.id === items[0].id);
  ok('an empty list gives nothing, not an error', D.next({ items: [], cards: {}, today: TODAY }) === null && D.next(null) === null);
}

head('the wrong answers are the look-alikes');
{
  const item = items.find(i => i.id === 'ra-constriction');
  const o = D.options({ item, items, n: 4, seed: 3 });
  ok('the answer is among the options once, and there are four distinct options', o.includes('ra-constriction') && o.filter(x => x === 'ra-constriction').length === 1 && new Set(o).size === 4 && o.length === 4, o.join(','));
  ok('the look-alikes are offered: tamponade and restrictive are against constriction', o.includes('ra-tamponade') && o.includes('ra-restrictive'), o.join(','));
  const sites = new Set(o.map(id => items.find(i => i.id === id).site));
  ok('and the rest are from the same site, not a wedge trace against a jugular one', sites.size === 1, [...sites].join(','));
  const slots = new Set(); for (let s = 1; s <= 40; s++) slots.add(D.options({ item, items, n: 4, seed: s }).indexOf('ra-constriction'));
  ok('the right answer is not always in the same place', slots.size === 4, [...slots].sort().join(','));
  ok('the same seed gives the same order', JSON.stringify(D.options({ item, items, n: 4, seed: 9 })) === JSON.stringify(D.options({ item, items, n: 4, seed: 9 })));
  const few = D.options({ item: items[0], items: [items[0], items[1]], n: 4, seed: 1 });
  ok('two items give two options', few.length === 2 && few.includes(items[0].id), few.join(','));
  ok('an item with nothing to confuse it with still gets options', D.options({ item: { id: 'x', site: 'RA' }, items: [{ id: 'x', site: 'RA' }, ...items], n: 4, seed: 1 }).length === 4);
  ok('nonsense in gives an empty list, not an error', D.options(null).length === 0 && D.options({ item: 5, items }).length === 0);
}

head('grading');
{
  const first = D.grade({ card: null, correct: true, today: TODAY });
  const wrong = D.grade({ card: null, correct: false, today: TODAY });
  ok('a right answer makes a card that is due later than a wrong one', first.due > wrong.due && first.stability > wrong.stability, `${first.due} vs ${wrong.due}`);
  const reviewed = D.grade({ card: first, correct: true, today: day(first.ivl) });
  ok('and a second right answer lengthens it', reviewed.stability > first.stability);
  const lapsed = D.grade({ card: reviewed, correct: false, today: day(first.ivl + reviewed.ivl) });
  ok('a wrong answer after that counts as a lapse and shortens it', lapsed.lapses > reviewed.lapses && lapsed.stability < reviewed.stability, `lapses ${reviewed.lapses}→${lapsed.lapses}`);
  ok('grading never throws on a damaged card', (() => { try { D.grade({ card: { stability: NaN, last: 5 }, correct: true, today: TODAY }); D.grade({}); D.grade(null); return true; } catch (_) { return false; } })());
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
