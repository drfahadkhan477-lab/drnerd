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
const SCHEDULER_VERSION = 1;

/* And the forcing function, because a version somebody has to remember to
   bump is a version that will be wrong. This hashes the numbers that actually
   determine every interval the module produces; verify-fsrs.js pins the
   result. Change a weight without bumping SCHEDULER_VERSION and the pin fails
   and says so — the same bargain scripts/build.js makes with its exact-match
   patches, and the same one SHELL_V makes by deriving itself from content.

   FNV-1a: this module runs in a browser with no crypto import, and the job is
   to notice a change, not to resist an adversary. */
function fsrsParamsFingerprint() {
  const src = FSRS_W.join(',') + '|' + FSRS_DECAY;
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) { h = Math.imul(h ^ src.charCodeAt(i), 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

function daysBetween(fromISO, toISO) {
  return Math.round((Date.parse(toISO + 'T00:00:00') - Date.parse(fromISO + 'T00:00:00')) / 86400000);
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
function fsrsIvl(stability) {
  return Math.max(1, Math.ceil(stability));
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

/* Pure — safe to call repeatedly (e.g. once per rating button, every render,
   to preview each button's resulting interval) without mutating the card. */
function fsrsUpdate(card, rating, today) {
  /* Math.round(NaN) is NaN, and Math.max(1, Math.min(4, NaN)) is NaN too — the
     clamp does not clamp. A NaN rating then failed the `rating === 1` test,
     skipped the hard and easy multipliers, and came out the far side looking
     exactly like Good: a confident wrong answer written into the card's stored
     schedule, which is worse than a visible NaN. Non-finite is treated as Good
     deliberately and on purpose, because a scheduler called during render must
     not throw, and the neutral rating is the only defensible guess. */
  rating = Number(rating);
  rating = isFinite(rating) ? Math.max(1, Math.min(4, Math.round(rating))) : 3;
  const now = today || (new Date().toISOString().slice(0, 10));
  const prev = fsrsSeed(card);
  let difficulty, stability;
  if (!prev) {
    difficulty = fsrsInitDifficulty(rating);
    stability = fsrsInitStability(rating);
  } else {
    const lastDay = (card && card.last) ? card.last : now;
    const elapsed = daysBetween(lastDay, now);
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
  const ivl = fsrsIvl(stability);
  const reps = rating === 1 ? 0 : (card && card.reps || 0) + 1;
  const lapses = (card && card.lapses || 0) + (rating === 1 ? 1 : 0);
  const dueDate = new Date(now + 'T00:00:00'); dueDate.setDate(dueDate.getDate() + ivl);
  return { difficulty, stability, ivl, reps, lapses, due: dueDate.toISOString().slice(0, 10), last: now, sv: SCHEDULER_VERSION };
}

root.FSRS = {
  update: fsrsUpdate, retrievability: fsrsRetrievability, seed: fsrsSeed,
  initStability: fsrsInitStability, initDifficulty: fsrsInitDifficulty,
  ivl: fsrsIvl, daysBetween, W: FSRS_W, DECAY: FSRS_DECAY, FACTOR: FSRS_FACTOR,
  SCHEDULER_VERSION, paramsFingerprint: fsrsParamsFingerprint,
};

})(typeof window !== 'undefined' ? window : this);
