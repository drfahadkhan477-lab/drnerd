/* ═══════════════════════════════════════════════════════════════════════════
   calib.js — what the review log says beyond right-or-wrong.

   Three readings over the same rows logReview() already writes:

     · CALIBRATION — accuracy inside each confidence band. The number worth
       having is not "how accurate are you" but "how often were you certain
       and wrong", because that is the gap you cannot feel from the inside.
     · SPEED — median time for correct against incorrect answers. A signal,
       never a score: fast-and-right is mastery, slow-and-right is retrieval
       that is still fragile, and both are worth knowing. Not a leaderboard.
     · ERROR MIX — the distribution of miss reasons, so "you are not short of
       knowledge, you are misreading stems" can be seen rather than guessed.

   EVERY READING DEGRADES HONESTLY. Rows written before these fields existed
   carry nulls, and so do answers where the learner skipped the prompt — which
   is the common path by design. A band with too few samples reports that it
   has too few samples. Drawing a confident percentage over four answers would
   be worse than drawing nothing, because it would be believed.

   Pure arithmetic over an array. No DOM, so it is testable in bare Node —
   which is what lets CI check it without the licensed export.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

/* Below this a band says so instead of quoting a percentage. Twelve is not a
   statistical threshold, it is a readability one: enough that one lucky guess
   does not move the number by eight points. */
const MIN_SAMPLES = 12;

const BANDS = [
  { id: 0, label: 'Guess' },
  { id: 1, label: 'Unsure' },
  { id: 2, label: 'Fairly sure' },
  { id: 3, label: 'Certain' },
];

const REASONS = [
  { id: 'gap',     label: "Didn't know it" },
  { id: 'misread', label: 'Misread the stem' },
  { id: 'mixed',   label: 'Confused two things' },
  { id: 'slip',    label: 'Knew it, picked wrong' },
  { id: 'guess',   label: 'Guessed' },
];

const answered = log => (log || []).filter(r => r && (r.m === 'practice' || r.m === 'review-answer'));

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/* Accuracy per confidence band, plus the one headline figure. */
function calibration(log) {
  const rows = answered(log).filter(r => r.cf != null);
  const bands = BANDS.map(b => {
    const inBand = rows.filter(r => r.cf === b.id);
    const correct = inBand.filter(r => r.ok).length;
    return {
      ...b,
      n: inBand.length,
      accuracy: inBand.length >= MIN_SAMPLES ? correct / inBand.length : null,
      sparse: inBand.length < MIN_SAMPLES,
    };
  });
  const certain = bands[3];
  return {
    bands,
    rated: rows.length,
    /* The number this whole feature exists to produce. Null, not zero, when
       there is not enough to say — zero would read as "never wrong". */
    certainButWrong: certain.accuracy == null ? null : 1 - certain.accuracy,
    enough: rows.length >= MIN_SAMPLES,
  };
}

/* Median time correct vs incorrect. Rows with a null ms — skipped, or written
   before the field existed, or answered after a walk away — are absent, not
   zero. A zero would drag the median toward instant. */
function speed(log) {
  const rows = answered(log).filter(r => typeof r.ms === 'number');
  const right = rows.filter(r => r.ok).map(r => r.ms);
  const wrong = rows.filter(r => !r.ok).map(r => r.ms);
  return {
    n: rows.length,
    correctMs: median(right),
    wrongMs: median(wrong),
    enough: rows.length >= MIN_SAMPLES,
    /* Right, but slower than the typical wrong answer: the concept is there
       and the retrieval is not yet. Worth surfacing precisely because the
       score alone calls it mastery. */
    fragile: (right.length >= MIN_SAMPLES && wrong.length >= MIN_SAMPLES &&
              median(right) > median(wrong)),
  };
}

function reasons(log) {
  const rows = answered(log).filter(r => !r.ok);
  const tagged = rows.filter(r => r.why);
  const counts = REASONS.map(x => ({
    ...x,
    n: tagged.filter(r => r.why === x.id).length,
  }));
  const total = tagged.length;
  return {
    counts: counts.map(c => ({ ...c, share: total ? c.n / total : null })),
    tagged: total,
    misses: rows.length,
    enough: total >= MIN_SAMPLES,
    top: total >= MIN_SAMPLES
      ? counts.slice().sort((a, b) => b.n - a.n)[0]
      : null,
  };
}

root.Calib = { calibration, speed, reasons, median, BANDS, REASONS, MIN_SAMPLES };

})(typeof window !== 'undefined' ? window : this);
