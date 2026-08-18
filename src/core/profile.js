/* ═══════════════════════════════════════════════════════════════════════════
   profile.js — the fellow's current standing, as a block of prose for Apex.

   Before this, Apex opened every conversation knowing nothing about who it
   was teaching: it could search the bank and read scores, but only if it
   thought to call a tool, and only after the fellow had already asked
   something. A tutor who has taught you for months should not need to look
   you up before answering.

   This builds a compact, always-present summary from data the app already
   has — chapter accuracy, missed items, FSRS retention and due load — and
   hands it to the model as part of the system prompt. It is deliberately
   short: this is background the model reasons *from*, not a report it should
   read back. Roughly 100-200 tokens.

   Depends on app globals (S, POOL, CHAPTERS, QBYID, FSRS, dueQuestions,
   todayISO) — it is embedded into the app, not standalone.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

/* Chapters ranked worst-first, but only those with enough attempts to mean
   anything — a 0/1 chapter is noise, not a weakness. */
function weakChapters(minAttempts, limit) {
  const rows = [];
  for (const ch in S.chStats) {
    const s = S.chStats[ch];
    if (!s || s.total < minAttempts) continue;
    rows.push({ ch, pct: Math.round(s.correct / s.total * 100), correct: s.correct, total: s.total });
  }
  rows.sort((a, b) => a.pct - b.pct);
  return rows.slice(0, limit);
}

/* The most recently missed items, newest first. S.missed is a Set with no
   ordering, so fall back to practice timestamps where we have them. */
function recentMisses(limit) {
  const ids = [...S.missed];
  ids.sort((a, b) => ((S.practice[b] || {}).t || 0) - ((S.practice[a] || {}).t || 0));
  return ids.slice(0, limit).map(id => {
    const q = QBYID[id];
    return q ? `${q.id} (${q.ch}, item ${q.n})` : null;
  }).filter(Boolean);
}

function retentionSummary() {
  if (typeof FSRS === 'undefined') return null;
  const t = todayISO();
  let sum = 0, n = 0;
  for (const id in S.srs) {
    const c = S.srs[id];
    if (!c || c.stability === undefined) continue;
    sum += FSRS.retrievability(c.stability, FSRS.daysBetween(c.last || t, t));
    n++;
  }
  return n ? { pct: Math.round(sum / n * 100), cards: n } : null;
}

/* Returns '' when there is genuinely nothing to say — a fresh install should
   not get a system prompt full of zeroes, which would just teach the model
   that this fellow knows nothing. */
function buildLearningProfile() {
  const lines = [];
  const answered = S.sessionTotal || 0;
  if (answered >= 5) {
    const pct = Math.round((S.sessionCorrect || 0) / answered * 100);
    lines.push(`Answered ${S.sessionCorrect}/${answered} overall (${pct}%).`);
  }

  const weak = weakChapters(6, 3);
  if (weak.length) {
    lines.push('Weakest chapters with a meaningful sample: ' +
      weak.map(w => `${w.ch} ${w.pct}% (${w.correct}/${w.total})`).join('; ') + '.');
  }

  const ret = retentionSummary();
  if (ret) lines.push(`Predicted retention ${ret.pct}% across ${ret.cards} scheduled card${ret.cards === 1 ? '' : 's'}.`);

  try {
    const due = dueQuestions().length;
    if (due > 0) lines.push(`${due} card${due === 1 ? '' : 's'} due for review right now.`);
  } catch (_) {}

  const missed = recentMisses(10);
  if (missed.length) lines.push(`Recently missed: ${missed.join(', ')}.`);

  if (!lines.length) return '';
  return `\n\nTHE FELLOW'S CURRENT STANDING (generated from their own history — use it to pitch the level and to choose what to press on; do not read it back to them as a report):\n${lines.join('\n')}`;
}

root.Profile = { build: buildLearningProfile, weakChapters, recentMisses, retentionSummary };

})(typeof window !== 'undefined' ? window : this);
