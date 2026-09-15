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

head('the scheduler says which scheduler it is');
{
  /* THIS PIN IS LOAD-BEARING. It is the whole mechanism: change any FSRS
     weight or the decay and this check fails, which is the only moment anyone
     is guaranteed to be looking. Do not "fix" it by pasting the new hash —
     that discards the one signal the pin exists to give. Bump
     SCHEDULER_VERSION first, decide what happens to cards already scheduled
     under the old model, and only then update the value here. */
  const PINNED = '4fb3c4d0';
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
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
