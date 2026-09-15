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

/* ── EVERY FIELD READ HERE IS CHECKED ─────────────────────────────────────
   This file runs on the path that assembles EVERY prompt, and its caller
   invokes it bare:

       + ((typeof Profile!=='undefined') ? Profile.build() : '')

   guarded against the module being absent and against nothing else. So a throw
   in here is not a missing profile line — it is the whole Apex turn failing,
   on the screen the fellow was trying to use.

   And it could throw. accsap12.v2 carries S and is restored wholesale from a
   user-picked file by the backup importer; a truncated or hand-edited backup
   can supply an S with no `missed`, no `practice`, no `chStats`. Measured:
   `for (const k in undefined)` is a harmless no-op, but `[...undefined]`
   throws, and so does `undefined['x']`. recentMisses() does both.

   fsrs.js already learned this lesson and says so at length — a NaN there
   became a RangeError thrown from inside render(), on the review screen, which
   is the screen the fellow was trying to reach when they restored the backup
   in the first place. The dueQuestions() call below was already wrapped in a
   try/catch, so the risk was understood for one line and never generalised.

   The contract is now simply: build() does not throw. A profile that cannot be
   computed is an absent profile, which the model handles — it is the ordinary
   state of a fresh install. */
const obj = v => (v && typeof v === 'object') ? v : {};
const iter = v => (v && typeof v[Symbol.iterator] === 'function') ? [...v] : [];

/* Chapters ranked worst-first, but only those with enough attempts to mean
   anything — a 0/1 chapter is noise, not a weakness. */
function weakChapters(minAttempts, limit) {
  const rows = [];
  const stats = obj(typeof S === 'undefined' ? null : S.chStats);
  for (const ch in stats) {
    const s = stats[ch];
    if (!s || !(s.total >= minAttempts)) continue;
    const pct = Math.round(s.correct / s.total * 100);
    /* A chapter with a total but no correct count yields NaN, which does not
       throw — it reaches the model as "Cardiomyopathy NaN%", a confident
       statement about a number nobody has. Dropped rather than rendered. */
    if (!Number.isFinite(pct)) continue;
    rows.push({ ch, pct, correct: s.correct, total: s.total });
  }
  rows.sort((a, b) => a.pct - b.pct);
  return rows.slice(0, limit);
}

/* The most recently missed items, newest first. S.missed is a Set with no
   ordering, so fall back to practice timestamps where we have them. */
function recentMisses(limit) {
  if (typeof S === 'undefined') return [];
  const ids = iter(S.missed);                 // a Set normally; [] if absent
  const practice = obj(S.practice);
  ids.sort((a, b) => ((practice[b] || {}).t || 0) - ((practice[a] || {}).t || 0));
  const byId = typeof QBYID === 'undefined' ? {} : obj(QBYID);
  return ids.slice(0, limit).map(id => {
    const q = byId[id];
    return q ? `${q.id} (${q.ch}, item ${q.n})` : null;
  }).filter(Boolean);
}

function retentionSummary() {
  if (typeof FSRS === 'undefined' || typeof todayISO !== 'function') return null;
  if (typeof S === 'undefined') return null;
  const t = todayISO();
  let sum = 0, n = 0;
  const srs = obj(S.srs);
  for (const id in srs) {
    const c = srs[id];
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
  try {
    return profileLines();
  } catch (_) {
    /* The last line of the contract above, and deliberately the outermost one
       rather than the only one: each reader is guarded so that a torn store
       costs at most the line it could not compute, and this exists so that
       something nobody anticipated costs the profile instead of the turn. An
       empty profile is the ordinary state of a fresh install; a failed turn is
       not a state the app has any answer for. */
    return '';
  }
}

function profileLines() {
  const lines = [];
  if (typeof S === 'undefined') return '';
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
