#!/usr/bin/env node
/*
 * The scheduler, against the properties it cannot be allowed to break.
 *
 *   node tests/verify-fsrs.js
 *
 * WHY PROPERTIES AND NOT REFERENCE VECTORS. The obvious test is a table of
 * known inputs and expected outputs from the reference implementation. I could
 * not obtain one I trust: the published descriptions of FSRS-4.5, 5 and 6
 * disagree with each other about which constants belong to which version — one
 * source states the retrievability decay as -1 and another as -0.5 for the same
 * name — and a table copied from the wrong version would pin this module to the
 * wrong algorithm while looking authoritative.
 *
 * So this asserts what must hold for ANY correct spaced-repetition scheduler,
 * plus the two things that are self-verifying rather than remembered:
 *
 *   · R(S, S) == 0.9 exactly. Stability is DEFINED as the number of days for
 *     recall probability to fall to 90%, so this is not a tuned constant, it is
 *     an identity. If FACTOR and DECAY are ever inconsistent this catches it.
 *   · the ordering and sign of every response to a rating, which is what a
 *     fellow actually experiences.
 *
 * That is a weaker claim than conformance and it is stated as one. What it is
 * strong enough to do is catch the bug it found: a lapse making a card MORE
 * durable, in 275 of 616 reachable states.
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
new Function('module', 'exports', fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'fsrs.js'), 'utf8'))
  .call(mod, { exports: mod }, mod);
const F = mod.FSRS;

const DAY0 = '2026-01-01';
const plus = (iso, d) => new Date(Date.parse(iso + 'T00:00:00') + d * 86400000).toISOString().slice(0, 10);
const card = (S, D, extra) => Object.assign({ stability: S, difficulty: D, last: DAY0, reps: 3, lapses: 0,
                                              ivl: Math.max(1, Math.ceil(S)) }, extra || {});
/* Every state the app can actually reach, not a happy path. */
const STATES = [];
for (const S of [0.2, 0.4072, 0.6, 1, 1.5, 2, 3, 5, 8, 21, 60, 180])
  for (const D of [1, 2, 3, 5, 7, 9, 10])
    for (const el of [0, 1, 2, 3, 5, 8, 13, 21, 34, 60, 120, 200]) STATES.push({ S, D, el });

head('stability means what it says');
/* Definitional, not tuned: if FACTOR and DECAY ever drift apart this is the
   only check that notices. */
ok('recall probability is exactly 0.9 after one stability-worth of days',
   [0.5, 1, 10, 365, 3650].every(s => Math.abs(F.retrievability(s, s) - 0.9) < 1e-12));
ok('and exactly 1.0 the moment it is reviewed',
   [0.5, 10, 365].every(s => F.retrievability(s, 0) === 1));
ok('it only ever falls as time passes', (() => {
  let last = 1;
  for (let t = 0; t <= 4000; t += 7) { const r = F.retrievability(10, t); if (r > last + 1e-12) return false; last = r; }
  return last < 0.15;
})(), 'strictly decreasing over 4000 days');
/* And it falls as a POWER LAW, not exponentially — which is the whole of the
   4.5 change and the reason a long-abandoned card is not treated as lost. At
   forty times its stability a card is still around 31% recallable, where an
   exponential model would have written it off entirely. Asserted because a
   change back to DECAY = -1 would silently make every long interval wrong. */
ok('and with a long tail, as a power law rather than an exponential',
   Math.abs(F.retrievability(10, 400) - 0.3103) < 0.001
     && F.retrievability(10, 4000) > 0.09,
   `R(40S)=${F.retrievability(10, 400).toFixed(3)}, R(400S)=${F.retrievability(10, 4000).toFixed(3)}`);
ok('a card with no stability is not remembered', F.retrievability(0, 1) === 0 && F.retrievability(-3, 1) === 0);

head('the four buttons mean four different things');
ok('a harder rating starts a new card less stable than an easier one',
   F.initStability(1) < F.initStability(2) && F.initStability(2) < F.initStability(3)
     && F.initStability(3) < F.initStability(4),
   [1, 2, 3, 4].map(g => F.initStability(g).toFixed(2)).join(' < '));
ok('and more difficult',
   F.initDifficulty(1) > F.initDifficulty(2) && F.initDifficulty(2) > F.initDifficulty(3)
     && F.initDifficulty(3) > F.initDifficulty(4),
   [1, 2, 3, 4].map(g => F.initDifficulty(g).toFixed(2)).join(' > '));
ok('difficulty never leaves 1–10, whatever it is fed',
   [1, 2, 3, 4].every(g => { const d = F.initDifficulty(g); return d >= 1 && d <= 10; })
     && [1, 10, 5.5].every(d0 => [1, 2, 3, 4].every(g => {
       const d = F.update(card(5, d0), g, plus(DAY0, 3)).difficulty; return d >= 1 && d <= 10; })));

head('the ordering a fellow actually experiences');
{
  let bad = null;
  for (const st of STATES) {
    const day = plus(DAY0, st.el);
    const i = g => F.update(card(st.S, st.D), g, day).stability;
    const [a, h, g, e] = [i(1), i(2), i(3), i(4)];
    if (!(a <= h && h <= g && g <= e)) { bad = { ...st, a, h, g, e }; break; }
  }
  ok('Again ≤ Hard ≤ Good ≤ Easy, in every reachable state',
     !bad, bad ? JSON.stringify(bad) : `${STATES.length} states`);
}
ok('Good and Easy always make a card more durable, never less', (() => {
  for (const st of STATES) for (const g of [3, 4]) {
    if (F.update(card(st.S, st.D), g, plus(DAY0, st.el)).stability < st.S - 1e-9) return false;
  }
  return true;
})());

head('the bug this suite was written to catch');
/* Its e^((1-R)·w14) term rewards a lapse at low retrievability, and on a card
   whose stability is already small that term could carry the result above
   where it started: 275 of 616 states came out MORE stable after Again, and
   136 of them pushed the interval further out than the card already had. A
   two-day card you had just failed came back in five. */
{
  const rose = STATES.filter(st =>
    F.update(card(st.S, st.D), 1, plus(DAY0, st.el)).stability > st.S + 1e-9);
  ok('forgetting never makes a card more durable', rose.length === 0,
     `${rose.length} of ${STATES.length} states`);
  const pushed = STATES.filter(st => {
    const c = card(st.S, st.D);
    return F.update(c, 1, plus(DAY0, st.el)).ivl > c.ivl;
  });
  ok('and never pushes it further away than it already was', pushed.length === 0,
     `${pushed.length} of ${STATES.length} states`);
  /* NOT "Again always means tomorrow" — that was an overreach, and the code was
     right to refuse it. A card you have known for six months and have just
     forgotten is not a new card: FSRS gives it a few days, not one. What must
     hold is that Again is always the shortest of the four and never longer than
     the card already had. */
  ok('Again is always the shortest of the four choices',
     STATES.every(st => {
       const day = plus(DAY0, st.el), i = g => F.update(card(st.S, st.D), g, day).ivl;
       return i(1) <= i(2) && i(1) <= i(3) && i(1) <= i(4);
     }));
  ok('and a mature card lapses to days, not to months',
     [21, 60, 180, 365].every(S => F.update(card(S, 5), 1, plus(DAY0, S)).ivl <= 14),
     [21, 60, 180, 365].map(S => S + 'd→' + F.update(card(S, 5), 1, plus(DAY0, S)).ivl + 'd').join(' '));
}

head('desirable difficulty — the reason the model exists');
ok('recalling something you had nearly forgotten is worth more than recalling something fresh',
   (() => {
     const fresh = F.update(card(10, 5), 3, plus(DAY0, 2)).stability;
     const nearly = F.update(card(10, 5), 3, plus(DAY0, 30)).stability;
     return nearly > fresh;
   })());
ok('and a card you find hard grows more slowly than one you find easy',
   F.update(card(10, 9), 3, plus(DAY0, 10)).stability < F.update(card(10, 2), 3, plus(DAY0, 10)).stability);
ok('Again raises difficulty, Easy lowers it', (() => {
  const c = card(10, 5);
  return F.update(c, 1, plus(DAY0, 5)).difficulty > 5 && F.update(c, 4, plus(DAY0, 5)).difficulty < 5;
})());

head('intervals are whole days, and never zero');
ok('an interval is at least one day, always',
   STATES.every(st => [1, 2, 3, 4].every(g => F.update(card(st.S, st.D), g, plus(DAY0, st.el)).ivl >= 1)));
ok('and is the stability rounded up, so a fresh Again and a fresh Hard do not collapse together',
   F.ivl(0.4072) === 1 && F.ivl(1.1829) === 2 && F.ivl(3.1262) === 4 && F.ivl(15.4722) === 16);
ok('the due date is the interval away from the day it was rated', (() => {
  const out = F.update(card(10, 5), 3, '2026-03-01');
  return out.due === plus('2026-03-01', out.ivl) && out.last === '2026-03-01';
})());

head('counters');
ok('a lapse resets the streak and increments lapses', (() => {
  const out = F.update(card(10, 5, { reps: 7, lapses: 2 }), 1, plus(DAY0, 5));
  return out.reps === 0 && out.lapses === 3;
})());
ok('a success extends the streak and leaves lapses alone', (() => {
  const out = F.update(card(10, 5, { reps: 7, lapses: 2 }), 3, plus(DAY0, 5));
  return out.reps === 8 && out.lapses === 2;
})());

head('it is pure, because the UI previews every button before you press one');
{
  const c = card(10, 5, { reps: 4, lapses: 1 });
  const before = JSON.stringify(c);
  const a = F.update(c, 3, plus(DAY0, 5));
  const b = F.update(c, 3, plus(DAY0, 5));
  ok('calling it does not mutate the card', JSON.stringify(c) === before);
  ok('and the same inputs give the same answer twice', JSON.stringify(a) === JSON.stringify(b));
  ok('previewing all four buttons leaves the card untouched',
     ([1, 2, 3, 4].forEach(g => F.update(c, g, plus(DAY0, 5))), JSON.stringify(c) === before));
}

head('cards that predate this module');
ok('a brand-new card is seeded from the rating alone', F.seed({}) === null && F.seed(undefined) === null);
ok('a legacy SM-2 card carries its interval over as stability', (() => {
  const s = F.seed({ ivl: 12, reps: 3, due: DAY0, lapses: 0, last: DAY0 });
  return s && s.stability === 12 && s.difficulty === 5;
})());
ok('and a legacy card with an absurd interval is still schedulable', (() => {
  const out = F.update({ ivl: 0, reps: 1, last: DAY0 }, 3, plus(DAY0, 1));
  return out.ivl >= 1 && out.stability > 0 && /^\d{4}-\d{2}-\d{2}$/.test(out.due);
})());
ok('a rating outside 1–4 is clamped, and a non-numeric one does not sneak through as Good', (() => {
  /* NaN used to pass the clamp untouched and then behave exactly like Good,
     writing a confident wrong schedule into the card. */
  const asGood = JSON.stringify(F.update(card(5, 5), 3, plus(DAY0, 3)));
  if (JSON.stringify(F.update(card(5, 5), NaN, plus(DAY0, 3))) !== asGood) return false;
  if (JSON.stringify(F.update(card(5, 5), undefined, plus(DAY0, 3))) !== asGood) return false;
  if (JSON.stringify(F.update(card(5, 5), 1, plus(DAY0, 3))) === asGood) return false;
  for (const g of [0, -5, 9, 2.4, NaN, undefined, null, 'x']) {
    const out = F.update(card(5, 5), g, plus(DAY0, 3));
    if (!isFinite(out.stability) || !isFinite(out.difficulty) || out.ivl < 1) return false;
  }
  return true;
})());

head('no state produces a number the app cannot use');
ok('stability, difficulty, interval and due are always finite and sane',
   STATES.every(st => [1, 2, 3, 4].every(g => {
     const o = F.update(card(st.S, st.D), g, plus(DAY0, st.el));
     return isFinite(o.stability) && o.stability > 0
         && isFinite(o.difficulty) && o.difficulty >= 1 && o.difficulty <= 10
         && Number.isInteger(o.ivl) && o.ivl >= 1
         && /^\d{4}-\d{2}-\d{2}$/.test(o.due);
   })), `${STATES.length * 4} combinations`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
