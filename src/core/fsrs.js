/* ═══════════════════════════════════════════════════════════════════════════
   fsrs.js — FSRS-5 spaced-repetition scheduling.

   Replaces SM-2. The concrete bug this fixes: under SM-2, every rating on a
   card's first review set the same interval (ivl=1, "tomorrow") regardless of
   whether you tapped Again or Easy — reps===1 forced ivl=1 unconditionally,
   so the four buttons on a brand-new card were never actually different from
   each other. FSRS assigns each rating its own initial stability from the
   very first review (w[0..3] below), so Again/Hard/Good/Easy diverge
   immediately instead of only after the card has been seen twice.

   FSRS-5 default parameters, as published by the open-spaced-repetition
   project (MIT-licensed algorithm; these are the documented population
   defaults used before a deck has enough history to fit its own).

   Card shape, day granularity throughout (matches the app's existing
   todayISO()-based due dates — there is no sub-day "learning step" queue
   here, which is why intervals are rounded up to whole days, not minutes):
     { difficulty, stability, ivl, reps, lapses, due, last }
   difficulty: 1-10, how inherently hard the card is to retain.
   stability:  days for retrievability to fall to 90% — the model's memory
               of how well-learned the card is.
   ivl:        the scheduled interval in days, derived from stability at the
               default 90% target retention (see fsrsIvl for why that makes
               ivl and stability numerically the same thing at this target).

   WHERE THIS DEPARTS FROM UPSTREAM FSRS-5, on purpose (the scheduler
   contract; tests/verify-oracle.js compares the arithmetic against ts-fsrs):
     · whole local calendar days only: no sub-day learning or relearning
       steps, and no same-day short-term stability update;
     · round the interval at the requested retention UP before fuzz and the deadline;
     · interval capped at 36500 days, the same as upstream's default;
     · interval fuzz (S4) only when the caller names the card, never on Again,
       and drawn from a hash of its id, review count and lapse count rather
       than at random, so the same card, rating and day always give the same
       due day; unnamed, there is no fuzz at all (fsrsFuzz);
     · Again never raises stability above what the card had
       (fsrsNextStabilityFail) — upstream's formula can;
     · a legacy SM-2 card is seeded from its old interval at difficulty 5
       (fsrsSeed); malformed stored fields fall back to first-review values;
     · a non-numeric rating counts as Good; out-of-range ones are clamped;
     · target retention defaults to 90% and rises toward a scheduled exam, and the weights are the population
       defaults, never fitted to a deck.

   Usage:
     const next = fsrsUpdate(S.srs[q.id], grade);   // grade: 1 Again .. 4 Easy
     S.srs[q.id] = next;
     const r = fsrsRetrievability(card.stability, daysSince(card.last));
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

const FSRS_W = [0.4072,1.1829,3.1262,15.4722,7.2102,0.5316,1.0651,0.0234,1.616,
                0.1544,1.0824,1.9813,0.0953,0.2975,2.2042,0.2407,2.9466,0.5034,0.6567];
const FSRS_DECAY = -0.5;
const FSRS_FACTOR = Math.pow(0.9, 1 / FSRS_DECAY) - 1;   // ≈0.234568, tuned so R(t=S)=0.9

/* WHICH SCHEDULER WROTE A SCHEDULE.
   A card stores `stability` and `ivl` — numbers, with no record of the model
   that produced them. That is fine while the model never changes, and these
   are the published FSRS-5 population defaults precisely because no deck here
   has enough history to fit its own yet. The day one does, the weights change,
   and every card already on disk was scheduled by a model that no longer
   exists. Nothing today could tell those cards apart from fresh ones, so there
   would be no way to decide whether to leave them, re-derive them, or let them
   correct themselves over the next few reviews.

   Stamped per card rather than once per store, because that is the truthful
   granularity: a store accumulates cards over months and can easily span two
   models, so a single stamp on the blob would be a lie about most of it. The
   cost is ~5 bytes x 639 cards in a store that is bounded and small. */
/* 2: the interval is capped at FSRS_MAX_IVL (36500 days). Cards stamped 1 were
   scheduled without the cap; they are left as they are, because no realistic
   card has reached it, and the next review reschedules any that did. */
/* 3: exam-aware retention and deadlines. Older cards keep their stored state;
   readers apply the deadline until the next real review writes a schedule. */
/* 4: the deadline only for a card that needs it (see `needsDeadline`). A card
   stamped 3 may have been saved due on the eve although its recall would have
   held; it comes up once, early, and its next review writes an ordinary
   schedule, so it is left as it is. */
const SCHEDULER_VERSION = 4;
const BASE_RETENTION = 0.90, EXAM_RETENTION = 0.95, RAMP_DAYS = 60;

/* And the forcing function, because a version somebody has to remember to
   bump is a version that will be wrong. This hashes the numbers that actually
   determine the model and exam retention curve (the weights, decay, interval
   cap, retention endpoints and ramp length); verify-fsrs.js pins the
   result. Change a weight without bumping SCHEDULER_VERSION and the pin fails
   and says so — the same bargain SHELL_V makes by deriving itself from
   content.

   FNV-1a: this module runs in a browser with no crypto import, and the job is
   to notice a change, not to resist an adversary. */
function fsrsParamsFingerprint() {
  const src = FSRS_W.join(',') + '|' + FSRS_DECAY + '|' + [FSRS_MAX_IVL, BASE_RETENTION, EXAM_RETENTION, RAMP_DAYS].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) { h = Math.imul(h ^ src.charCodeAt(i), 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/* ── calendar days, in the fellow's own timezone ──────────────────────────
   A DAY HERE IS A LOCAL CALENDAR DAY, never a UTC one, and these three are the
   only place that convention is expressed.

   The bug they replace: due dates were built by parsing `iso + 'T00:00:00'`,
   which ES parses as LOCAL midnight, and then read back with
   `.toISOString().slice(0,10)`, which is the UTC day. Anywhere east of
   Greenwich those are different days, so every card was scheduled one day
   EARLY — in Karachi at UTC+5, a one-day interval came due today. It went
   unnoticed for as long as it did because the suite's own expected-date helper
   derived its answer the same wrong way, so the two agreed and the tests
   passed in every timezone.

   The property that makes this correct is that a date string never touches UTC
   at all: it is split into its parts, rebuilt as a local Date, and formatted
   back from local parts. '2026-06-15' in, '2026-06-15' out, at any offset —
   including the 45-minute one Kathmandu uses, which defeats arithmetic that
   assumes whole-hour zones. */
function isoToLocalDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);   /* local midnight */
  return isNaN(d.getTime()) ? null : d;
}
function localDateToISO(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function todayISO() { return localDateToISO(new Date()); }
/* A day n days from a 'YYYY-MM-DD', counted on the calendar: the date is moved with setDate and read back as the local
   day, so a day the clocks change is still one day. Not a day at all gives null. */
function addDays(iso, n) {
  const d = isoToLocalDate(iso);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return localDateToISO(d);
}

/* Both ends parsed the same way, so the difference is whole days even across a
   spring-forward boundary where one of them is only 23 hours long — Math.round
   absorbs the hour that DST adds or removes. A malformed date yields 0 rather
   than NaN, because this feeds retrievability, which feeds stability, and a
   NaN there reaches `new Date(NaN).toISOString()` and throws from inside
   render() — the failure mode the rest of this module is already written
   against. */
function daysBetween(fromISO, toISO) {
  const a = isoToLocalDate(fromISO), b = isoToLocalDate(toISO);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/* Probability of recall after `elapsedDays` since a card with the given
   stability was last reviewed. This is the number the rest of the app calls
   "mastery": literally "how likely are you to get this right today". */
function fsrsRetrievability(stability, elapsedDays) {
  if (!(stability > 0)) return 0;
  const t = Math.max(0, elapsedDays);
  return Math.pow(1 + FSRS_FACTOR * t / stability, FSRS_DECAY);
}

function fsrsInitStability(rating) {
  return Math.max(0.1, FSRS_W[Math.max(1, Math.min(4, rating)) - 1]);
}
function fsrsInitDifficulty(rating) {
  const d = FSRS_W[4] - Math.exp(FSRS_W[5] * (rating - 1)) + 1;
  return Math.min(10, Math.max(1, d));
}
/* Difficulty drifts toward the rating just given, damped more gently near the
   1/10 boundaries (FSRS-5's refinement over 4.5), then reverts a little
   toward the difficulty an Easy first-review would have produced — otherwise
   difficulty is a random walk with no anchor. */
function fsrsNextDifficulty(prevDifficulty, rating) {
  const deltaD = -FSRS_W[6] * (rating - 3);
  const damped = prevDifficulty + deltaD * (10 - prevDifficulty) / 9;
  const target = fsrsInitDifficulty(4);
  const reverted = FSRS_W[7] * target + (1 - FSRS_W[7]) * damped;
  return Math.min(10, Math.max(1, reverted));
}
/* Stability after a successful recall (rating 2 Hard, 3 Good, or 4 Easy):
   the harder the card (higher D), the lower the retrievability was when you
   saw it, and the longer it's already held up (higher S) — the bigger the
   stability jump. Hard applies a penalty, Easy a bonus, on top of that. */
function fsrsNextStabilitySuccess(difficulty, stability, retrievability, rating) {
  const hardPenalty = rating === 2 ? FSRS_W[15] : 1;
  const easyBonus = rating === 4 ? FSRS_W[16] : 1;
  const growth = Math.exp(FSRS_W[8])
    * (11 - difficulty)
    * Math.pow(stability, -FSRS_W[9])
    * (Math.exp((1 - retrievability) * FSRS_W[10]) - 1)
    * hardPenalty * easyBonus;
  return stability * (growth + 1);
}
/* Stability after a lapse (rating 1, Again): forgetting resets it, not to
   zero, but to a fraction of what it was — harder cards and cards forgotten
   at higher retrievability (a "surprise" lapse) lose more ground. */
function fsrsNextStabilityFail(difficulty, stability, retrievability) {
  const s = FSRS_W[11]
    * Math.pow(difficulty, -FSRS_W[12])
    * (Math.pow(stability + 1, FSRS_W[13]) - 1)
    * Math.exp((1 - retrievability) * FSRS_W[14]);
  /* FORGETTING MUST NEVER MAKE A CARD MORE DURABLE. The formula alone does not
     guarantee that. Its e^((1-R)·w14) term rewards a lapse at low
     retrievability — the reasoning being that failing something you had
     genuinely forgotten says less about the card than failing something you
     should have known — and on a card whose stability is already small that
     term can carry the result above where it started. Measured on the
     reachable state space: 275 of 616 combinations of stability, difficulty
     and elapsed days came out higher after Again than before it, by up to
     4.2x, and 136 of them pushed the interval FURTHER OUT than the card
     already had. A two-day card you had just failed came back in five.

     That is not a tuning question, it is the wrong sign. Whatever the weights
     say, pressing Again cannot be a way to see a card less often, so the
     result is capped at the stability it started from. */
  return Math.min(s, stability);
}

/* Interval, in whole days, for a given stability at the default 90% target
   retention. At exactly 90% retention the interval-from-retrievability
   formula collapses algebraically to ivl == stability (both are "the number
   of days for recall probability to reach 90%", by definition) — so this is
   not an approximation, it is what stability already means at this target.
   Rounded UP rather than to nearest: a day-granularity due date is a "don't
   resurface before this many full days" commitment, and rounding up is what
   keeps a fresh Again (stability ≈0.4d) and a fresh Hard (≈1.2d) from both
   collapsing onto the same "tomorrow" — the exact failure mode this module
   replaces. */
/* CAPPED AT A CENTURY, as upstream FSRS is (ts-fsrs: maximum_interval =
   36500). Without it the interval has no ceiling at all: five Easy ratings in
   a row schedule a card 107 years out, and a few more carry its due date past
   the year 9999. Every due check in both apps compares ISO strings
   (`due <= today`), and '13442-02-25' sorts BEFORE '2026-10-09' — so the most
   thoroughly learned card in the deck would come due on every visit. Kept on
   its own schedule that takes millennia, so the realistic routes are a wrong
   device clock or an edited backup; the cap closes all of them. Only the
   interval is capped: stability is the model's state, and stays the model's. */
const FSRS_MAX_IVL = 36500;
function intervalModifier(retention) {
  return (Math.pow(retention, 1 / FSRS_DECAY) - 1) / FSRS_FACTOR;
}
function fsrsIvl(stability, retention = BASE_RETENTION) {
  return Math.min(FSRS_MAX_IVL, Math.max(1, Math.ceil(stability * intervalModifier(retention))));
}

/* An active exam has a last full study day. On that day a review can only be
   scheduled for the exam itself. Once exam day arrives new ratings use the
   ordinary schedule, so completing a review never puts it back in today's queue. */
function examWindow(today, examDate) {
  if (!examDate || examDate < today) return null;
  const eve = isoToLocalDate(examDate);
  if (!eve || localDateToISO(eve) !== examDate) return null;
  const days = daysBetween(today, examDate);
  eve.setDate(eve.getDate() - 1);
  const fraction = Math.max(0, Math.min(1, (RAMP_DAYS - days) / (RAMP_DAYS - 1)));
  return { days, examDate, eve: localDateToISO(eve), finalFortnight: days > 0 && days <= 14,
    retention: BASE_RETENTION + fraction * (EXAM_RETENTION - BASE_RETENTION) };
}

/* THE DEADLINE IS FOR A CARD THAT NEEDS IT. A card whose own schedule ends past
   the exam, but whose recall on exam day stays at or above EXAM_RETENTION, is
   left on that schedule: seeing it on the eve buys almost nothing. Applied to
   every card, the deadline put the whole deck in the eve's queue, again on exam
   day, and again the day after from the saved dates (verify-fsrs simulates a
   deck to the exam and reads all three). A card with no usable stability or day
   of last review cannot be judged, so it keeps the deadline (retrievability is
   0 for a stability that is not a positive number). */
function needsDeadline(stability, last, examDate) {
  if (typeof last !== 'string' || !isoToLocalDate(last)) return true;
  return fsrsRetrievability(stability, daysBetween(last, examDate)) < EXAM_RETENTION;
}

/* A date can be set, moved or cleared long after the card was scheduled.
   Apply its deadline on read, without changing the card or its model state. */
function scheduledDue(card, exam) {
  if (!card || typeof card.due !== 'string') return null;
  /* A last day that is not a date ('oops' sorts after every digit) says
     nothing about when the card was reviewed, so it cannot excuse the card. */
  const last = typeof card.last === 'string' && isoToLocalDate(card.last) ? card.last : null;
  if (!exam || (last && last >= exam.examDate)) return card.due;
  const deadline = last && last >= exam.eve ? exam.examDate : exam.eve;
  if (card.due < deadline || !needsDeadline(card.stability, card.last, exam.examDate)) return card.due;
  return deadline;
}

function isDue(card, today, exam) {
  const day = scheduledDue(card, exam);
  return day !== null && day <= today;
}

/* Seed a "previous state" for a card FSRS has never scheduled before —
   either genuinely new, or a legacy SM-2 card ({ivl,reps,due,lapses,last},
   no stability/difficulty fields) carried over from before this module
   existed. A legacy card's old interval is a reasonable proxy for what its
   stability already was; difficulty starts at the neutral midpoint and
   corrects itself within a review or two. Returns null for a genuinely new
   card, since there is no prior state to decay from at all. */
/* EVERY FIELD READ HERE IS CHECKED, because a card is not always a card this
   module wrote. accsap12.v2 — which carries S.srs — is restored wholesale from
   a user-picked file by the backup importer, and a truncated or hand-edited
   backup can supply a card with no difficulty, or a stability of 0 or null.
   Untreated, those produce a NaN stability, which becomes a NaN interval,
   which becomes `new Date(NaN).toISOString()` — a RangeError thrown from
   inside render(), on the review screen, which is the screen the fellow was
   trying to reach when they restored the backup in the first place. */
function fsrsSeed(card) {
  if (!card) return null;
  const s = Number(card.stability);
  if (Number.isFinite(s) && s > 0) {
    const d = Number(card.difficulty);
    return { difficulty: Number.isFinite(d) ? Math.min(10, Math.max(1, d)) : 5, stability: s };
  }
  const ivl = Number(card.ivl);
  if (Number.isFinite(ivl) && card.last) return { difficulty: 5, stability: Math.max(0.5, ivl) };
  return null;
}

/* SPREAD THE LOAD (roadmap S4). Without fuzz, cards learned on one day with one
   rating come due on one day, and keep coming due together: a fortnight's new
   cards turn into a single heavy morning. Upstream FSRS-5 (ts-fsrs) moves an
   interval of 2.5 days or more to a random day within a range that widens with
   it: one day, plus 15% of the part between 2.5 and 7 days, 10% between 7 and
   20, and 5% beyond 20; never under 2 days, never past the cap, and never back
   to or before the day of the review that set it. This takes the same range.
   The draw is not random: it is a hash of the card's id, its review count and
   its lapse count (FNV-1a), so a stored history is still a function of its
   inputs, a preview shows the day the rating will give, and a test can replay
   it. With no id there is no fuzz, which is what the oracle compares. */
const FSRS_FUZZ_RANGES = [[2.5, 7, 0.15], [7, 20, 0.1], [20, Infinity, 0.05]];
function fsrsFuzzFactor(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h / 4294967296;
}
function fsrsFuzz(ivl, elapsed, key) {
  if (typeof key !== 'string' || !key || ivl < 2.5) return ivl;
  let delta = 1;
  for (const [start, end, factor] of FSRS_FUZZ_RANGES) delta += factor * Math.max(Math.min(ivl, end) - start, 0);
  let lo = Math.max(2, Math.round(ivl - delta));
  const hi = Math.min(Math.round(ivl + delta), FSRS_MAX_IVL);
  if (ivl > elapsed) lo = Math.max(lo, elapsed + 1);
  lo = Math.min(lo, hi);
  return Math.min(Math.floor(fsrsFuzzFactor(key) * (hi - lo + 1) + lo), FSRS_MAX_IVL);
}

/* Pure — safe to call repeatedly (e.g. once per rating button, every render,
   to preview each button's resulting interval) without mutating the card.
   `id`, when given, names the card and turns on the deterministic fuzz above;
   a preview and the rating it previews must pass the same one. */
function fsrsUpdate(card, rating, today, id, examDate) {
  /* Math.round(NaN) is NaN, and Math.max(1, Math.min(4, NaN)) is NaN too — the
     clamp does not clamp. A NaN rating then failed the `rating === 1` test,
     skipped the hard and easy multipliers, and came out the far side looking
     exactly like Good: a confident wrong answer written into the card's stored
     schedule, which is worse than a visible NaN. Non-finite is treated as Good
     deliberately and on purpose, because a scheduler called during render must
     not throw, and the neutral rating is the only defensible guess. */
  rating = Number(rating);
  rating = isFinite(rating) ? Math.max(1, Math.min(4, Math.round(rating))) : 3;
  /* A caller that passes a day decides what day it is; the app always does,
     via its own todayISO(). The fallback must agree with the parse convention
     above, which the old `new Date().toISOString().slice(0,10)` did not — it
     is the UTC day, so between local midnight and 05:00 in Karachi this module
     thought today was yesterday. */
  const now = (today && isoToLocalDate(today)) ? today : todayISO();
  const prev = fsrsSeed(card);
  let difficulty, stability, elapsed = 0;
  if (!prev) {
    difficulty = fsrsInitDifficulty(rating);
    stability = fsrsInitStability(rating);
  } else {
    const lastDay = (card && card.last) ? card.last : now;
    elapsed = daysBetween(lastDay, now);
    const r = elapsed > 0 ? fsrsRetrievability(prev.stability, elapsed) : 1;
    difficulty = fsrsNextDifficulty(prev.difficulty, rating);
    stability = rating === 1
      ? fsrsNextStabilityFail(prev.difficulty, prev.stability, r)
      : fsrsNextStabilitySuccess(prev.difficulty, prev.stability, r, rating);
  }
  /* The floor under all of the above. fsrsSeed now refuses to hand out a
     malformed prior, but the arithmetic has several routes to a non-finite
     result and only one of them needs to be open for the scheduler to throw
     from inside a render. Falling back to the first-review values for this
     rating is the same answer the card would have got had it never been seen —
     defensible, and above all finite. */
  if (!Number.isFinite(stability) || stability <= 0) stability = fsrsInitStability(rating);
  if (!Number.isFinite(difficulty)) difficulty = fsrsInitDifficulty(rating);
  const reps = rating === 1 ? 0 : (card && card.reps || 0) + 1;
  const lapses = (card && card.lapses || 0) + (rating === 1 ? 1 : 0);
  /* Again is not fuzzed: Again never makes a card more durable, and its day must not come later than the card's day
     before it either (verify-fsrs reads both, named and unnamed); a lapse is not where the load piles up. A day the
     fuzz set earlier than the card's stability rounded up would let an unfuzzed Again land after it (3 days, then 4),
     so Again is also held to the card's own interval before it. */
  const exam = examWindow(now, examDate);
  let ivl = fsrsFuzz(fsrsIvl(stability, exam && exam.days > 0 ? exam.retention : BASE_RETENTION), Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0,
    rating === 1 || id === undefined || id === null || id === '' ? null : `${id}:${reps}:${lapses}`);
  if (rating === 1 && prev && card && Number.isInteger(card.ivl) && card.ivl >= 1) ivl = Math.min(ivl, card.ivl);
  if (exam && exam.days > 0 && ivl >= exam.days && needsDeadline(stability, now, examDate)) ivl = Math.min(ivl, Math.max(1, exam.days - 1));
  /* setDate() rolls months and years for us and steps whole calendar days, so
     a DST boundary inside the interval does not shift the due date — which
     adding ivl * 86400000 milliseconds would. */
  const dueDate = isoToLocalDate(now); dueDate.setDate(dueDate.getDate() + ivl);
  return { difficulty, stability, ivl, reps, lapses, due: localDateToISO(dueDate), last: now, sv: SCHEDULER_VERSION };
}

/* THE FIRST ANSWER TO A QUESTION IS A RETRIEVAL, and it makes the question's card.
   A question answered in a quiz that has never been scheduled gets its first
   card from that answer: wrong is Again; right but Guess or Unsure is Hard
   (a lucky guess is not knowledge); right and Fairly sure or Certain is Good;
   right with no confidence given (the prompt is optional) is Good. Never Easy:
   one answer is one data point, and Easy's first interval is about two weeks.
   Only the FIRST answer does this. A card that exists is moved by the review
   queue alone, so drilling a chapter cannot rewrite schedules (recordAnswer in
   the shell). cf is calib.js's band id: 0 Guess, 1 Unsure, 2 Fairly sure,
   3 Certain; anything else counts as not given. */
function fsrsFirstRating(ok, cf) {
  if (!ok) return 1;
  return cf === 0 || cf === 1 ? 2 : 3;
}

root.FSRS = {
  update: fsrsUpdate, firstRating: fsrsFirstRating, retrievability: fsrsRetrievability, seed: fsrsSeed,
  initStability: fsrsInitStability, initDifficulty: fsrsInitDifficulty,
  examWindow, needsDeadline, scheduledDue, isDue, intervalModifier, ivl: fsrsIvl, fuzz: fsrsFuzz, FUZZ_RANGES: FSRS_FUZZ_RANGES, daysBetween, todayISO, isoToLocalDate, localDateToISO, addDays,
  W: FSRS_W, DECAY: FSRS_DECAY, FACTOR: FSRS_FACTOR, MAX_IVL: FSRS_MAX_IVL,
  SCHEDULER_VERSION, paramsFingerprint: fsrsParamsFingerprint,
};

})(typeof window !== 'undefined' ? window : this);
