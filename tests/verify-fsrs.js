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
/* Pure string arithmetic, with no Date in it anywhere. That is the whole point:
   the previous version parsed `iso + 'T00:00:00'` as local midnight, added
   d * 86400000 milliseconds and formatted back through toISOString(), which is
   the UTC day — the EXACT bug it was being used to check fsrs.js for. The two
   agreed, so the suite passed in every timezone while the scheduler shipped
   due dates a day early everywhere east of Greenwich.
   Adding milliseconds is wrong a second way: across a spring-forward boundary
   a calendar day is 23 hours, so d * 86400000 lands on the wrong date even
   when the formatting is right. */
const addDaysISO = (iso, n) => {
  let [y, m, d] = iso.split('-').map(Number);
  const leap = yy => (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0;
  const len = (yy, mm) => [31, leap(yy) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1];
  for (let i = 0; i < n; i++) { d++; if (d > len(y, m)) { d = 1; m++; if (m > 12) { m = 1; y++; } } }
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
const plus = (iso, d) => addDaysISO(iso, d);
const card = (S, D, extra) => Object.assign({ stability: S, difficulty: D, last: DAY0, reps: 3, lapses: 0,
                                              ivl: Math.max(1, Math.ceil(S)) }, extra || {});
/* Every state the app can actually reach, not a happy path. */
const STATES = [];
for (const S of [0.2, 0.4072, 0.6, 1, 1.5, 2, 3, 5, 8, 21, 60, 180])
  for (const D of [1, 2, 3, 5, 7, 9, 10])
    for (const el of [0, 1, 2, 3, 5, 8, 13, 21, 34, 60, 120, 200]) STATES.push({ S, D, el });

head('a question\'s first answer makes its card, and only Again, Hard or Good');
{
  const r = (ok, cf) => F.firstRating(ok, cf);
  ok('a wrong first answer is Again, however sure it was', [null, 0, 1, 2, 3].every(c => r(false, c) === 1),
     [null, 0, 1, 2, 3].map(c => r(false, c)).join(','));
  ok('right but a Guess or Unsure is Hard: a lucky guess is not knowledge', r(true, 0) === 2 && r(true, 1) === 2);
  ok('right and Fairly sure or Certain is Good', r(true, 2) === 3 && r(true, 3) === 3);
  ok('right with no confidence given is Good, and an unknown band counts as none', r(true, null) === 3 && r(true, undefined) === 3 && r(true, 'x') === 3 && r(true, 7) === 3);
  ok('never Easy: one answer is one data point', [true, false].every(o => [null, 0, 1, 2, 3].every(c => r(o, c) !== 4)));
  const good = F.update(null, r(true, 3), DAY0), again = F.update(null, r(false, 3), DAY0), hard = F.update(null, r(true, 0), DAY0);
  ok('and the card it makes is the first-review card for that rating: Again tomorrow, Hard before Good',
     again.due === plus(DAY0, 1) && hard.ivl < good.ivl && good.due === plus(DAY0, good.ivl) && good.reps === 1 && again.lapses === 1,
     JSON.stringify({ again: again.due, hard: hard.ivl, good: good.ivl }));
}

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
  /* The same, for a card the app names (S4 fuzzes named cards, never on Again). */
  const pushedNamed = STATES.filter((st, k) => {
    const c = card(st.S, st.D);
    return F.update(c, 1, plus(DAY0, st.el), 'q' + k).ivl > c.ivl;
  });
  ok('nor does it for a named card, whose other ratings are fuzzed', pushedNamed.length === 0, `${pushedNamed.length} of ${STATES.length} states`);
  /* Nor from a card whose last interval was fuzzed DOWN: its day is then earlier than its stability rounded up, and an
     unfuzzed Again could land after it (Codex review on #358: a card at 3 days came back in 4). The states above are
     built with ivl = ceil(S), so they cannot show it; these are made by the scheduler itself. */
  let afterFuzz = 0, fuzzedDown = 0; const firstPushed = [];
  for (let i = 0; i < 300; i++) {
    let c = F.update(null, 3, DAY0, 'card' + i);
    for (let n = 0; n < 3; n++) {
      if (c.ivl < Math.ceil(c.stability)) fuzzedDown++;
      for (const late of [0, 1, 3 * c.ivl, 100]) {
        const a = F.update(c, 1, plus(c.last, c.ivl + late), 'card' + i);
        if (a.ivl > c.ivl) { afterFuzz++; if (firstPushed.length < 2) firstPushed.push({ id: 'card' + i, before: c.ivl, after: a.ivl, late }); }
      }
      c = F.update(c, 3, c.due, 'card' + i);
    }
  }
  ok('and the scheduler\'s own named cards include some fuzzed below their stability (precondition)', fuzzedDown > 50, `${fuzzedDown} of 900`);
  ok('nor from a named card whose last interval was fuzzed down: Again is never later than the day before it',
     afterFuzz === 0, afterFuzz ? `${afterFuzz} Again ratings pushed later, e.g. ${JSON.stringify(firstPushed)}` : '3600 Again ratings');
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

head('a card this module did not write cannot take the review screen down');
/* accsap12.v2 carries S.srs, and importMarkup() restores it wholesale from a
   file the fellow picks — so a truncated or hand-edited backup can hand the
   scheduler a card with no difficulty, or a stability of 0 or null. Untreated
   these produce a NaN interval, and new Date(NaN).toISOString() throws a
   RangeError out of fsrsPreview(), which buildQuiz() calls inside a template
   literal with no try/catch. The result is a review screen that will not
   render — reached through the feature you use when something has already
   gone wrong. */
const MALFORMED = [
  ['no difficulty at all',   { stability: 10, ivl: 10, reps: 2, lapses: 0, last: '2026-08-20' }],
  ['stability of zero',      { difficulty: 5, stability: 0, ivl: 1, reps: 0, lapses: 1, last: '2026-08-20' }],
  ['stability of null',      { difficulty: 5, stability: null, last: '2026-08-20' }],
  ['difficulty of null',     { difficulty: null, stability: 10, last: '2026-08-20' }],
  ['stability as a string',  { difficulty: 5, stability: '10', last: '2026-08-20' }],
  ['nothing but junk',       { difficulty: 'x', stability: 'y', ivl: 'z', last: 'not-a-date' }],
  ['an empty object',        {}],
];
for (const [label, bad] of MALFORMED) {
  let out = null, threw = null;
  try { out = F.update(bad, 3, '2026-08-30'); } catch (e) { threw = e.constructor.name + ': ' + e.message; }
  ok(`a card with ${label} still schedules instead of throwing`,
     !threw && out && isFinite(out.stability) && out.stability > 0
       && Number.isInteger(out.ivl) && out.ivl >= 1
       && /^\d{4}-\d{2}-\d{2}$/.test(out.due),
     threw || (out && `ivl=${out.ivl} due=${out.due}`));
}
/* And the hardening must not have blunted a well-formed card. */
const control = F.update({ difficulty: 5, stability: 10, ivl: 10, reps: 2, lapses: 0, last: '2026-08-20' }, 3, '2026-08-30');
ok('a well-formed card is still scheduled on its own merits, not the fallback',
   control.ivl > 10 && control.stability > 10, `ivl=${control.ivl}`);

head('generated histories, not hand-picked cards');
/* The checks above take one step from a grid of states. A fellow takes
   hundreds, in whatever order life allows: on the due day, early, months late,
   twice in one day, or after the device clock went backwards. So these walk
   seeded random histories through update() and assert, at EVERY step, what
   must hold for the stored card to be usable by the next one. Seeded, so a
   failure names a history that replays exactly. */
const rng = seed => () => {   /* mulberry32 */
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;
function history(seed, steps) {
  const R = rng(seed), out = [];
  let c = null, day = DAY0;
  for (let i = 0; i < steps; i++) {
    const rating = 1 + Math.floor(R() * 4);
    const prev = c;
    const u = F.update(prev, rating, day);
    out.push({ day, rating, prev, card: u });
    c = u;
    const t = R();
    day = t < 0.5 ? c.due                                                  /* on time */
        : t < 0.65 ? plus(c.last, Math.floor(R() * c.ivl))                /* early, or same day */
        : t < 0.9 ? plus(c.due, 1 + Math.floor(R() * 400))                 /* late, up to ~a year */
        : F.localDateToISO(new Date(2026, 0, 1 - Math.floor(R() * 30)));   /* clock went back */
  }
  return out;
}
{
  const SEEDS = 400, STEPS = 60;
  let bad = null, n = 0;
  for (let seed = 1; seed <= SEEDS && !bad; seed++) {
    let lapses = 0, streak = 0;
    for (const { day, rating, prev, card: c } of history(seed, STEPS)) {
      n++;
      lapses += rating === 1 ? 1 : 0;
      streak = rating === 1 ? 0 : streak + 1;
      const why =
          !(Number.isFinite(c.stability) && c.stability > 0) ? 'stability'
        : !(c.difficulty >= 1 && c.difficulty <= 10) ? 'difficulty'
        : !(Number.isInteger(c.ivl) && c.ivl >= 1 && c.ivl <= F.MAX_IVL) ? 'ivl out of [1, MAX_IVL]'
        : !(ISO.test(c.due) && ISO.test(c.last)) ? 'due or last is not a 4-digit-year date'
        : c.last !== day ? 'last is not the day it was rated'
        : F.daysBetween(c.last, c.due) !== c.ivl ? 'due is not ivl days after last'
        : !(c.due > c.last) ? 'due does not sort after last as a string'
        : c.lapses !== lapses ? `lapses ${c.lapses}, Agains ${lapses}`
        : c.reps !== streak ? `reps ${c.reps}, streak ${streak}`
        : null;
      if (why) { bad = { seed, step: n, why, day, rating, prev, c }; break; }
    }
  }
  ok('every step of every generated history leaves a card the next step can use',
     !bad, bad ? JSON.stringify(bad).slice(0, 300) : `${SEEDS} histories, ${n} reviews`);

  /* Upstream FSRS fuzzes intervals with a random draw; this module draws from a hash, and an unnamed card is not fuzzed
     at all (see its header), so a stored history is a function of its inputs alone. */
  const a = JSON.stringify(history(7, STEPS)), b = JSON.stringify(history(7, STEPS));
  ok('and replaying a history gives the identical schedule, day for day', a === b);
}

head('spreading the load (roadmap S4)');
/* Cards learned together came due together. A named card's interval now moves within the range upstream FSRS-5 draws
   from, by a hash of its id, review count and lapse count; an unnamed card is not moved. The ranges are ts-fsrs's own
   (tests/fixtures/fsrs-fuzz-oracle.json, from tools/gen-fsrs-fuzz-oracle.js), not a second reading of the same source. */
{
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fsrs-fuzz-oracle.json'), 'utf8'));
  ok('the fuzz fixture names its generator and covers short, middling and capped intervals (precondition)',
     fx.generator && fx.generator.name === 'ts-fsrs' && fx.generator.fn === 'get_fuzz_range' && fx.maximum_interval === F.MAX_IVL
       && fx.rows.length > 200 && fx.rows.some(r => r[0] === 3) && fx.rows.some(r => r[0] > 1000) && fx.rows.some(r => r[0] === F.MAX_IVL),
     `${fx.rows.length} rows`);
  /* Forty cards for each day the range is wide (at least 400, at most 100,000), so both ends are drawn: a wide range
     sampled by a few hundred cards would miss an end whatever the code did. */
  const keys = n => Array.from({ length: n }, (_, i) => `Q${i}:${i % 7}:${i % 3}`), KEYS = keys(400);
  let outside = null, narrow = null, drawn = 0;
  for (const [ivl, elapsed, lo, hi] of fx.rows) {
    const got = keys(Math.min(100000, Math.max(400, 40 * (hi - lo + 1)))).map(k => F.fuzz(ivl, elapsed, k));
    drawn += got.length;
    const bad = got.find(v => !(Number.isInteger(v) && v >= lo && v <= hi));
    if (bad !== undefined && !outside) outside = { ivl, elapsed, lo, hi, got: bad };
    if (!narrow && (!got.includes(lo) || !got.includes(hi))) narrow = { ivl, elapsed, lo, hi, min: Math.min(...got), max: Math.max(...got) };
  }
  ok('a named card\'s interval always falls within the range ts-fsrs draws from, for every interval and elapsed time in the fixture',
     !outside, outside ? JSON.stringify(outside) : `${fx.rows.length} rows, ${drawn} draws`);
  ok('and drawn often enough, it reaches both ends of that range, so the range is not narrower than upstream\'s',
     !narrow, narrow ? JSON.stringify(narrow) : 'every row');
  ok('under 2.5 days nothing moves, named or not, as upstream', [1, 2].every(ivl => KEYS.every(k => F.fuzz(ivl, 0, k) === ivl)));

  /* The same card, rating and day, twice: the same day. Unnamed: exactly the interval the oracle checks. */
  let drift = null, unnamedMoved = null, memoryMoved = null;
  for (const g of [1, 2, 3, 4]) for (let i = 0; i < 60 && !(drift && unnamedMoved && memoryMoved); i++) {
    let c = null, day = DAY0;
    for (let n = 0; n < 6; n++) {
      const named = F.update(c, g === 1 && n % 2 ? 3 : g, day, 'q' + i), again = F.update(c, g === 1 && n % 2 ? 3 : g, day, 'q' + i);
      const plain = F.update(c, g === 1 && n % 2 ? 3 : g, day);
      if (!drift && JSON.stringify(named) !== JSON.stringify(again)) drift = { g, i, n };
      if (!unnamedMoved && plain.ivl !== Math.min(F.MAX_IVL, Math.max(1, Math.ceil(plain.stability)))) unnamedMoved = { g, i, n, ivl: plain.ivl, s: plain.stability };
      if (!memoryMoved && (named.stability !== plain.stability || named.difficulty !== plain.difficulty)) memoryMoved = { g, i, n };
      c = named; day = named.due;
    }
  }
  ok('the same card, rating and day give the same due day every time', !drift, JSON.stringify(drift));
  ok('an unnamed card is not fuzzed: its interval is its stability rounded up, as the oracle checks', !unnamedMoved, JSON.stringify(unnamedMoved));
  ok('and naming a card moves its day, never what the model knows of it (stability, difficulty)', !memoryMoved, JSON.stringify(memoryMoved));

  /* What S4 is for: forty cards learned on one day, answered Good on the day each comes due, twice more. */
  const spread = named => {
    const due = [];
    for (let i = 0; i < 40; i++) {
      let c = F.update(null, 3, DAY0, named ? 'card' + i : undefined);
      c = F.update(c, 3, c.due, named ? 'card' + i : undefined);
      c = F.update(c, 3, c.due, named ? 'card' + i : undefined);
      due.push(c.due);
    }
    const n = {}; for (const d of due) n[d] = (n[d] || 0) + 1;
    return { days: Object.keys(n).length, most: Math.max(...Object.values(n)) };
  };
  const together = spread(false), apart = spread(true);
  ok('forty cards learned together, unnamed, all come due on one day (the load S4 spreads)', together.days === 1 && together.most === 40, JSON.stringify(together));
  ok('named, the same forty come due over at least five days, no day holding more than a third of them',
     apart.days >= 5 && apart.most <= 40 / 3, JSON.stringify(apart));
}

head('long horizons');
/* The interval has to stop somewhere. Uncapped, five Easy ratings in a row
   scheduled a card 107 years out and a few more pushed its due date past
   9999 — and every due check compares ISO strings, where '13442-…' sorts
   BEFORE '2026-…', so the best-known card in the deck came due on every visit. */
for (const [label, g] of [['Easy', 4], ['Good', 3]]) {
  let c = null, day = DAY0, bad = null, top = 0;
  for (let i = 0; i < 40; i++) {
    c = F.update(c, g, day);
    top = Math.max(top, c.ivl);
    if (!(ISO.test(c.due) && c.ivl <= F.MAX_IVL && c.due > c.last)) { bad = `review ${i + 1}: ivl ${c.ivl}, due ${c.due}`; break; }
    day = c.due;
  }
  ok(`${label} forty times, each on its due day, never leaves the calendar`, !bad, bad || `longest ${top} d`);
}
{
  /* The route a fellow could actually take: a backup carrying a card whose
     stability is absurd, by hand or by a wrong clock years ago. */
  const c = F.update({ difficulty: 1, stability: 1e9, ivl: 1e9, reps: 9, lapses: 0, last: '2026-08-20' }, 4, '2026-08-30');
  ok('a restored card with an absurd stability is still due inside a century',
     c.ivl === F.MAX_IVL && ISO.test(c.due) && c.due > '2026-08-30' && c.due < '2127-01-01',
     `ivl ${c.ivl}, due ${c.due}`);
}
{
  const c = F.update({ difficulty: 1, stability: 1e9, ivl: 1e9, reps: 9, lapses: 0, last: '2026-08-20' }, 4, '2026-08-30', 'q1');
  ok('and so is the same card when the app names it (fuzzed, at most the cap)',
     c.ivl <= F.MAX_IVL && c.ivl > F.MAX_IVL - 2000 && ISO.test(c.due) && c.due > '2026-08-30' && c.due < '2127-01-01', `ivl ${c.ivl}, due ${c.due}`);
}
ok('the cap is upstream FSRS\'s own default, one hundred years of days', F.MAX_IVL === 36500, String(F.MAX_IVL));

head('a deck, simulated for three years');
/* 600 cards, 20 new a day for 30 days, every due card reviewed every day for
   three years. The learner is the model's own: recalls with probability equal
   to the card's retrievability that day, and when recalling answers Good, with
   some Hard and Easy. Measured over seeds 1–3 when written: month-two load
   23–24 a day, year-three load ~1 a day, busiest day 51–55 during intake and
   24–27 after it, recall 0.894–0.901. */
function deck(seed) {
  const R = rng(seed), cards = [], load = [];
  let day = DAY0, recalled = 0, reviews = 0;
  for (let d = 0; d < 3 * 365; d++) {
    if (d < 30) for (let i = 0; i < 20; i++) cards.push(F.update(null, 3, day));
    let k = 0;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      if (!(c.due <= day && c.last !== day)) continue;
      const got = R() < F.retrievability(c.stability, F.daysBetween(c.last, day));
      k++; reviews++; recalled += got ? 1 : 0;
      cards[i] = F.update(c, got ? (R() < 0.1 ? 2 : R() < 0.9 ? 3 : 4) : 1, day);
    }
    load.push(k);
    day = plus(day, 1);
  }
  const mean = (a, b) => load.slice(a, b).reduce((x, y) => x + y, 0) / (b - a);
  return { intake: mean(30, 60), year3: mean(730, 1095), peakIn: Math.max(...load.slice(0, 60)),
           peakAfter: Math.max(...load.slice(60)), recall: recalled / reviews, reviews };
}
for (const seed of [1, 2, 3]) {
  const r = deck(seed);
  const at = `seed ${seed}`;
  /* Nothing new enters after day 30, and every success lengthens an interval:
     a deck that is not getting cheaper is a deck whose intervals are not
     growing. */
  ok(`${at}: the daily load in year three is under a fifth of month two's`,
     r.year3 < r.intake / 5, `${r.intake.toFixed(1)} → ${r.year3.toFixed(1)} a day`);
  /* With no new cards, a day busier than the busiest intake day is cards
     piling onto the same date — the review burst §3.4 asks about. Proven
     against due dates snapped to the 1st of a month (51 → 323 in a day). It
     does NOT see intervals quantised to a common length: cards that started
     on different days stay apart, and that defect passed it. */
  ok(`${at}: no day after intake is busier than the busiest day during it`,
     r.peakAfter <= r.peakIn, `${r.peakIn} during, ${r.peakAfter} after`);
  /* The schedule claims 90% recall on the due day, and ceil() only ever
     brings the review earlier, so recall lands at or a little under 0.9.
     ±0.03 is about six standard errors at ~4500 reviews. */
  ok(`${at}: the learner recalls about the 90% the schedule targets`,
     r.recall > 0.87 && r.recall < 0.93, `${r.recall.toFixed(3)} over ${r.reviews} reviews`);
}

head('exam retention and deadlines across a change of clocks');
{
  const day = '2026-03-07';
  const targets = [90, 60, 30, 14, 1].map(n => F.examWindow(day, plus(day, n)).retention);
  ok('retention is 90% until 60 days out and climbs to 95% on the eve',
    targets[0] === 0.9 && targets[1] === 0.9 && targets[1] < targets[2] && targets[2] < targets[3] &&
    targets[3] < targets[4] && targets[4] === 0.95);
  const far = F.update(null, 4, day);
  const close = F.update(null, 4, day, undefined, plus(day, 30));
  ok('the retention target shortens an uncapped interval without changing learned stability',
    close.stability === far.stability && close.ivl === F.ivl(far.stability, targets[2]) && close.ivl < far.ivl && far.ivl < 29);
  /* Every card a review can leave, against exams on either side of the DST
     change (US clocks moved on 2026-03-08; CI runs this file again under
     America/New_York). Unnamed, so no fuzz: the interval a card would have
     had without a deadline is then F.ivl at the exam's retention, and Again
     is held to the card's own interval before it. */
  const before = n => { let k = 0; while (plus('2026-01-01', k) !== day) k++; return plus('2026-01-01', k - n); };
  const results = [];
  for (const examDate of ['2026-03-10', '2026-03-20', '2026-04-06']) {
    const e = F.examWindow(day, examDate);
    for (const stability of [0.5, 2, 5, 12, 25, 40, 70, 150, 500])
      for (const elapsed of [1, 3, 10, 30]) for (const g of [1, 2, 3, 4]) {
        const card = { difficulty: 5, stability, ivl: Math.max(1, Math.round(stability)), reps: 3, last: before(elapsed) };
        const u = F.update(card, g, day, undefined, examDate);
        const own = g === 1 ? Math.min(F.ivl(u.stability, e.retention), card.ivl) : F.ivl(u.stability, e.retention);
        results.push({ e, u, own, holds: F.retrievability(u.stability, e.days) >= 0.95 });
      }
  }
  const pulled = results.filter(r => !r.holds && r.own >= r.e.days);
  const kept = results.filter(r => r.holds && r.own >= r.e.days);
  ok('no review leaves a card past the eve when its recall would fall under 95% by the exam',
    results.every(r => r.holds || r.u.due <= r.e.eve), String(results.filter(r => !r.holds && r.u.due > r.e.eve).length));
  ok('a card brought forward is due on the eve itself, across DST', pulled.length > 0 && pulled.every(r => r.u.due === r.e.eve),
    `${pulled.length} brought forward, ${pulled.filter(r => r.u.due !== r.e.eve).length} not on the eve`);
  ok('a card whose recall holds keeps the interval it would have had', kept.length > 0 && kept.every(r => r.u.ivl === r.own),
    `${kept.length} kept, ${kept.filter(r => r.u.ivl !== r.own).length} shortened`);
  const mature = { difficulty: 5, stability: 500, ivl: 500, due: '2027-07-01', last: '2026-03-01' };
  const weak = { difficulty: 5, stability: 15, ivl: 500, due: '2027-07-01', last: '2026-03-01' };
  const eveAgain = F.update({ difficulty: 5, stability: 1, ivl: 1, reps: 1, last: '2026-03-08' }, 1, '2026-03-09', 'A', '2026-03-10');
  const eveEasy = F.update(mature, 4, '2026-03-09', 'A', '2026-03-10');
  const examDay = F.update(eveEasy, 4, '2026-03-10', 'A', '2026-03-10');
  ok('a lapse on the eve lands on the exam, a held card does not, and a review on exam day leaves the queue',
    eveAgain.due === '2026-03-10' && eveEasy.due > '2026-03-10' && examDay.due > '2026-03-10');
  ok('a past or invalid date gives the ordinary schedule', ['2026-03-01','2026-02-30','oops'].every(d =>
    JSON.stringify(F.update(null, 4, day, undefined, d)) === JSON.stringify(far)));
  const e = F.examWindow(day, '2026-03-10');
  ok('old schedules follow a moved or cleared exam without any write to the card',
    F.scheduledDue(weak, e) === '2026-03-09' &&
    F.scheduledDue(weak, F.examWindow(day,'2026-03-15')) === '2026-03-14' &&
    F.scheduledDue(weak, null) === '2027-07-01' && weak.ivl === 500);
  ok('an old card whose recall holds to the exam is not brought forward',
    F.scheduledDue(mature, e) === '2027-07-01' && F.scheduledDue(mature, F.examWindow(day,'2026-03-15')) === '2027-07-01');
  ok('a card the deadline cannot judge keeps it', F.scheduledDue({ due: '2027-07-01', last: '2026-03-01' }, e) === '2026-03-09' &&
    F.scheduledDue({ due: '2027-07-01', stability: 500 }, e) === '2026-03-09' &&
    F.scheduledDue({ due: '2027-07-01', stability: 500, last: 'oops' }, e) === '2026-03-09');
  ok('the deadline never postpones an earlier review, invents a missing due day, or repeats an exam-day review',
    F.scheduledDue({due:day}, e) === day && F.scheduledDue({},e) === null &&
    F.scheduledDue(examDay,e) === examDay.due);
}

head('a deck studied to the exam');
{
  /* Ten new cards a day for sixty days, every due card reviewed, recalled with
     the chance the model gives it, and no study on exam day itself. The eve
     must not become the whole deck, the days after the exam must not inherit
     it, and the exam must find each card either reviewed since the eve or
     still at 95%. */
  const R = rng(7), start = '2026-01-01', eveDay = plus(start, 119), examDate = plus(start, 120), cards = {}, load = [];
  for (let n = 0; n < 135; n++) {
    const today = plus(start, n), exam = F.examWindow(today, examDate);
    const due = Object.keys(cards).filter(id => F.isDue(cards[id], today, exam));
    load.push(due.length);
    if (today === examDate) continue;
    for (const id of due) {
      const r = F.retrievability(cards[id].stability, F.daysBetween(cards[id].last, today));
      cards[id] = F.update(cards[id], R() < r ? 3 : 1, today, id, examDate);
    }
    if (n < 60) for (let k = 0; k < 10; k++) cards[`q${n}_${k}`] = F.update(null, R() < 0.7 ? 3 : 1, today, `q${n}_${k}`, examDate);
    if (today === eveDay) var atExam = Object.values(cards).map(c => ({ last: c.last,
      r: F.retrievability(c.stability, F.daysBetween(c.last, examDate)) }));
  }
  const deck = Object.keys(cards).length, eve = load[119], after = [load[120], load[121]];
  ok('the eve holds less than half the deck', eve < deck / 2, `${eve} of ${deck}`);
  ok('exam day and the day after each hold under a tenth of it', after.every(n => n < deck / 10), `${after.join(' and ')} of ${deck}`);
  ok('every card meets the exam reviewed on the eve or still at 95%',
    atExam.length === deck && atExam.every(c => c.last >= eveDay || c.r >= 0.95),
    String(atExam.filter(c => c.last < eveDay && c.r < 0.95).length));
}

head('the scheduler says which scheduler it is');
{
  /* THIS PIN IS LOAD-BEARING. It is the whole mechanism: change any FSRS
     weight or the decay and this check fails, which is the only moment anyone
     is guaranteed to be looking. Do not "fix" it by pasting the new hash —
     that discards the one signal the pin exists to give. Bump
     SCHEDULER_VERSION first, decide what happens to cards already scheduled
     under the old model, and only then update the value here. */
  const PINNED = 'e658b9af';
  ok('the FSRS parameters are exactly the ones this pin was taken over',
     F.paramsFingerprint() === PINNED,
     F.paramsFingerprint() === PINNED ? PINNED
       : `got ${F.paramsFingerprint()} — if you changed a weight on purpose, bump SCHEDULER_VERSION and repin`);
  ok('the fingerprint is stable across calls', F.paramsFingerprint() === F.paramsFingerprint());
  ok('and it is a function of the weights, not a constant',
     (() => {
       /* Recomputed here by hand over a deliberately different weight set: a
          fingerprint that ignored its input would pass the pin above forever
          and protect nothing. */
       const alt = F.W.slice(); alt[0] += 1;
       const str = alt.join(',') + '|' + F.DECAY;
       let h = 0x811c9dc5;
       for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193) >>> 0;
       return h.toString(16).padStart(8, '0') !== F.paramsFingerprint();
     })());

  ok('SCHEDULER_VERSION is a positive integer', Number.isInteger(F.SCHEDULER_VERSION) && F.SCHEDULER_VERSION > 0,
     String(F.SCHEDULER_VERSION));
  ok('a newly scheduled card records which scheduler scheduled it',
     F.update(null, 3, DAY0).sv === F.SCHEDULER_VERSION);
  ok('and so does a rescheduled one, not just a new one',
     F.update({ difficulty: 5, stability: 10, ivl: 10, reps: 2, lapses: 0, last: '2026-08-20' }, 3, '2026-08-30').sv
       === F.SCHEDULER_VERSION);
  /* A card restored from a backup written by an older build has no sv at all.
     That must stay readable — the field is a record of what happened, not a
     precondition — and the absence is left as an absence rather than
     backfilled with a version that did not schedule it. */
  ok('a legacy card with no sv still schedules',
     F.update({ ivl: 6, reps: 3, lapses: 0, last: '2026-08-20' }, 3, '2026-08-30').ivl > 0);
  ok('and the stamp does not disturb the schedule it is attached to',
     F.update(null, 3, DAY0).ivl === F.ivl(F.initStability(3)));
}


/* ── a calendar day is the fellow's calendar day, in any timezone ────────── */
/* THE DEFECT THIS EXISTS FOR. fsrsUpdate built its due date by parsing
   `now + 'T00:00:00'` — which ES parses as LOCAL midnight — and then reading
   the result back with `.toISOString().slice(0,10)`, which is the UTC day.
   East of Greenwich those are different days, so every card was scheduled one
   day EARLY: in Karachi (UTC+5) a one-day interval came due today.

   It survived because the only test helper that computed an expected date,
   `plus()`, derived it exactly the same wrong way — local parse, UTC format —
   so both sides agreed and the suite passed in every timezone on earth. That
   is the failure mode a shared helper produces, and it is why the checks below
   assert PROPERTIES rather than compare against a second derivation.

   Run in real child processes under real TZ values, because a timezone cannot
   be changed inside a running V8 once Date has cached it, and because CI's own
   zone must not decide whether this is tested. */
head('a due date means the same thing in every timezone');
{
  const { execFileSync } = require('child_process');
  const FSRS_PATH = path.join(__dirname, '..', 'src', 'core', 'fsrs.js');

  /* Deliberately spans both sides of Greenwich, the half-hour and
     three-quarter-hour offsets that break naive arithmetic, and a
     southern-hemisphere DST zone. Kathmandu is UTC+5:45. */
  const ZONES = ['UTC', 'Asia/Karachi', 'Asia/Kathmandu', 'Pacific/Kiritimati',
                 'America/New_York', 'Pacific/Auckland', 'Australia/Adelaide'];

  /* The probe returns facts, not judgements — the assertions stay in here. */
  const PROBE = `
    const fs=require('fs'), mod={};
    new Function('module','exports',fs.readFileSync(${JSON.stringify(FSRS_PATH)},'utf8'))
      .call(mod,{exports:mod},mod);
    const F=mod.FSRS;
    const out={};
    /* A one-day interval from a known day must land on the next day. ivl is
       whatever the scheduler says, so ask it and add that many days by hand
       using plain string arithmetic that has no Date in it at all. */
    const r=F.update(null,3,'2026-01-01');
    out.ivl=r.ivl; out.due=r.due; out.last=r.last;
    /* Identity: a zero-day round trip through the scheduler's own date path
       must give back the day it was handed. */
    out.dayIn='2026-06-15';
    out.daysBetweenSelf=F.daysBetween('2026-06-15','2026-06-15');
    out.daysBetweenOne=F.daysBetween('2026-06-15','2026-06-16');
    /* Across a spring-forward boundary, where a day is 23 hours long. */
    out.daysAcrossDst=F.daysBetween('2026-03-01','2026-04-01');
    /* And the default "today" the module picks when no day is passed. */
    out.defaultToday=F.update(null,3).last;
    /* A day n days from another, by the calendar: either side of New York's spring change (8 March 2026) and of
       Auckland's and Adelaide's autumn change (5 April 2026), a year's end, a leap day, and none at all. */
    out.stepClocks=[F.addDays('2026-03-07',1),F.addDays('2026-03-08',1),F.addDays('2026-03-09',-2),F.addDays('2026-04-04',1),F.addDays('2026-04-05',1),F.addDays('2026-04-06',-2)];
    out.stepYear=[F.addDays('2026-12-31',1),F.addDays('2028-02-28',1),F.addDays('2028-03-01',-1),F.addDays('2026-06-15',0),F.addDays('2026-01-01',365)];
    /* And it agrees with daysBetween, the scheduler's own count, wherever it lands. */
    out.stepRound=[];
    for(let n=-400;n<=400;n+=37) out.stepRound.push(F.daysBetween('2026-03-08',F.addDays('2026-03-08',n))===n);
    out.stepBad=[F.addDays('2026-3-8',1),F.addDays('',1),F.addDays(null,1),F.addDays('8 March 2026',1)];
    process.stdout.write(JSON.stringify(out));
  `;

  ok('the expected-date arithmetic is itself correct across a month end',
     addDaysISO('2026-01-31', 1) === '2026-02-01' && addDaysISO('2026-02-28', 1) === '2026-03-01'
     && addDaysISO('2026-12-31', 1) === '2027-01-01');

  for (const tz of ZONES) {
    let r;
    try {
      r = JSON.parse(execFileSync(process.execPath, ['-e', PROBE],
        { env: Object.assign({}, process.env, { TZ: tz }), encoding: 'utf8' }));
    } catch (e) {
      ok(`${tz}: the scheduler runs at all`, false, String(e.message).slice(0, 120));
      continue;
    }
    const want = addDaysISO('2026-01-01', r.ivl);
    ok(`${tz}: a ${r.ivl}-day interval from 2026-01-01 is due ${want}`,
       r.due === want, r.due === want ? '' : `got ${r.due}`);
    ok(`${tz}: the day it was handed is the day it records`,
       r.last === '2026-01-01', `got ${r.last}`);
    ok(`${tz}: a day is zero days from itself`, r.daysBetweenSelf === 0, String(r.daysBetweenSelf));
    ok(`${tz}: consecutive days are one day apart`, r.daysBetweenOne === 1, String(r.daysBetweenOne));
    ok(`${tz}: March has 31 days even where one of them is 23 hours long`,
       r.daysAcrossDst === 31, String(r.daysAcrossDst));
    ok(`${tz}: the default today is a well-formed calendar day`,
       /^\d{4}-\d{2}-\d{2}$/.test(r.defaultToday), String(r.defaultToday));
    ok(`${tz}: a day from a day is counted on the calendar, either side of a change of clocks`,
       JSON.stringify(r.stepClocks) === JSON.stringify(['2026-03-08', '2026-03-09', '2026-03-07', '2026-04-05', '2026-04-06', '2026-04-04']), JSON.stringify(r.stepClocks));
    ok(`${tz}: and across a year's end and a leap day, nought days being the day itself`,
       JSON.stringify(r.stepYear) === JSON.stringify(['2027-01-01', '2028-02-29', '2028-02-29', '2026-06-15', '2027-01-01']), JSON.stringify(r.stepYear));
    ok(`${tz}: and agrees with daysBetween wherever it lands, a year either way`,
       Array.isArray(r.stepRound) && r.stepRound.length === 22 && r.stepRound.every(Boolean), JSON.stringify(r.stepRound));
    ok(`${tz}: and what is not a day is no day`, JSON.stringify(r.stepBad) === JSON.stringify([null, null, null, null]), JSON.stringify(r.stepBad));
  }
}

head('the page counts days through this module');
{
  /* The page's isoLocal(), todayISO() and addDays() were copies of the functions above, and one of them once stepped
     back a day east of Greenwich. They are now one line each into this module. Read with comments blanked: the shell
     explains itself, and quotes what is looked for. */
  const { blankComments } = require('./_source.js');
  const page = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
  const n = t => page.split(t).length - 1;
  const lines = ['function isoLocal(d){ return FSRS.localDateToISO(d); }', 'function todayISO(){ return FSRS.todayISO(); }', 'function addDays(iso,n){ return FSRS.addDays(iso,n); }'];
  const missing = lines.filter(l => n(l) !== 1).concat(['isoLocal', 'todayISO', 'addDays'].filter(x => n('function ' + x + '(') !== 1).map(x => x + '() defined more than once'));
  ok('isoLocal(), todayISO() and addDays() are each one line into this module, defined once', missing.length === 0, missing.join(' | ') || 'all three');
  const slot = page.indexOf('@@SLOT[src:src/core/fsrs.js]@@');
  ok('and the module is written into the page above them', slot >= 0 && ['function isoLocal(', 'function todayISO(', 'function addDays('].every(t => page.indexOf(t) > slot), slot < 0 ? 'no slot' : 'slot at ' + slot);
  ok('and the page keeps no day arithmetic of its own there', n("+'-'+p(d.getMonth()+1)+'-'+") === 0 && n("new Date(iso+'T00:00:00')") === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
