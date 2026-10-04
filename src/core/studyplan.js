/* ═════════════════════════════════════════════
   studyplan.js — what to study in the time you have, and whether you are on track.

   Two questions a tired fellow actually asks, answered from data the app already
   keeps (one spaced-repetition card per question, per-chapter right/total counts,
   the set of missed questions), with no screen of its own yet:

     plan({ minutes, pool, srs, chStats, missed })
        "I have 20 minutes."  → which questions, in what order, and why each one.
     readiness({ pool, srs, chStats, examDate, recentPerDay })
        "Am I on track?"      → coverage, retention, what is weakest, and a plain verdict.

   THE RULES, because a planner that cannot say why it chose something is a
   shuffle with a nice name:

     1. Cards that are DUE come first, most forgotten first: the lowest
        retrievability, not the oldest due date. A card due yesterday that you
        know cold is less urgent than one due today that you are about to lose.
     2. About a third of the time goes to the chapters where you are BELOW YOUR
        OWN AVERAGE (not merely lowest-ranked: with two chapters attempted, the
        stronger one is not weak), and within them to what you missed or have
        never seen.
     3. What is left goes to NEW questions, taken round-robin across chapters so
        a fresh start does not grind through the first chapter alphabetically.
     4. Never the same question twice, never more than the time allows.

   Like profile.js, this runs on data restored from a user-picked backup, so it
   does not throw: a plan that cannot be computed is an empty plan that says so.

   Depends on fsrs.js (retrievability, daysBetween, todayISO).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

const FSRS = root.FSRS || (typeof require === 'function' ? require('./fsrs.js').FSRS : null);

const obj = v => (v && typeof v === 'object') ? v : {};
const arr = v => Array.isArray(v) ? v : [];
const num = (v, d) => Number.isFinite(v) ? v : d;
const DEFAULT_SEC = 75;      // a board question and its explanation, read properly

/* How well a card is remembered today, in [0, 1]. A card with no usable
   stability or no usable last-review date is treated as forgotten (0), which
   puts it at the front of the due queue rather than throwing. */
function retrievability(card, today) {
  try {
    const c = obj(card);
    /* daysBetween answers 0 for a date it cannot read, which would make a card
       with no last-review date read as perfectly remembered. */
    if (typeof c.last !== 'string' || !FSRS.isoToLocalDate(c.last)) return 0;
    const days = FSRS.daysBetween(c.last, today);
    const r = FSRS.retrievability(c.stability, days);
    return Number.isFinite(r) ? Math.max(0, Math.min(1, r)) : 0;
  } catch (_) { return 0; }
}

function chapterRows(chStats, minAttempts) {
  const rows = [];
  const st = obj(chStats);
  let correct = 0, total = 0;
  for (const ch of Object.keys(st)) {
    const s = obj(st[ch]);
    if (!(s.total > 0) || !Number.isFinite(s.correct)) continue;
    correct += s.correct; total += s.total;
    if (s.total >= minAttempts) rows.push({ ch, pct: Math.round(s.correct / s.total * 100), correct: s.correct, total: s.total });
  }
  const mean = total ? correct / total * 100 : null;
  return { rows, mean };
}

/* Chapters below the fellow's own pooled accuracy, weakest first. */
function weakChapters(chStats, limit) {
  const { rows, mean } = chapterRows(chStats, 5);
  if (mean === null) return [];
  return rows.filter(r => r.pct < mean).sort((a, b) => a.pct - b.pct || (a.ch < b.ch ? -1 : 1)).slice(0, limit || 3);
}

/* One question at a time from each chapter's queue in turn. */
function roundRobin(byChapter, order, limit) {
  const out = [];
  for (let i = 0; out.length < limit; i++) {
    let added = false;
    for (const ch of order) {
      const q = (byChapter[ch] || [])[i];
      if (q) { out.push(q); added = true; if (out.length >= limit) break; }
    }
    if (!added) break;
  }
  return out;
}

function plan(o) {
  o = obj(o);
  const pool = arr(o.pool).filter(q => q && typeof q.id === 'string');
  const srs = obj(o.srs);
  const missed = new Set(o.missed instanceof Set ? [...o.missed] : arr(o.missed));
  const today = typeof o.today === 'string' ? o.today : FSRS.todayISO();
  const minutes = num(o.minutes, 20) > 0 ? num(o.minutes, 20) : 20;
  const secPerQuestion = num(o.secPerQuestion, DEFAULT_SEC) > 0 ? num(o.secPerQuestion, DEFAULT_SEC) : DEFAULT_SEC;
  const budget = Math.max(1, Math.min(200, Math.floor(minutes * 60 / secPerQuestion)));

  const used = new Set();
  const take = (q, reason) => { used.add(q.id); return { id: q.id, ch: q.ch, reason }; };

  /* 1. due, most forgotten first */
  const due = pool.filter(q => { const c = srs[q.id]; return c && typeof c.due === 'string' && c.due <= today; })
    .map(q => ({ q, r: retrievability(srs[q.id], today) }))
    .sort((a, b) => a.r - b.r || (a.q.id < b.q.id ? -1 : 1));
  const dueQuota = Math.min(due.length, Math.ceil(budget * 0.6));
  const dueItems = due.slice(0, dueQuota).map(x => take(x.q, 'due'));

  /* 2. weak chapters: missed first, then never seen */
  const weak = weakChapters(o.chStats, 3);
  const weakNames = weak.map(w => w.ch);
  const byWeak = {};
  for (const q of pool) {
    if (used.has(q.id) || !weakNames.includes(q.ch)) continue;
    const seen = !!srs[q.id];
    if (!missed.has(q.id) && seen) continue;
    (byWeak[q.ch] || (byWeak[q.ch] = [])).push(q);
  }
  /* missed first; everything else stays in the bank's own order (sort is stable) */
  for (const ch of Object.keys(byWeak)) byWeak[ch].sort((a, b) => missed.has(b.id) - missed.has(a.id));
  const weakQuota = Math.min(Math.ceil(budget * 0.3), Math.max(0, budget - dueItems.length));
  const weakItems = roundRobin(byWeak, weakNames, weakQuota).map(q => take(q, 'weak'));

  /* 3. new, round-robin across chapters */
  const byNew = {};
  const chOrder = [];
  for (const q of pool) {
    if (used.has(q.id) || srs[q.id]) continue;
    if (!byNew[q.ch]) { byNew[q.ch] = []; chOrder.push(q.ch); }
    byNew[q.ch].push(q);
  }
  chOrder.sort();
  const newItems = roundRobin(byNew, chOrder, Math.max(0, budget - dueItems.length - weakItems.length)).map(q => take(q, 'new'));

  /* what the time still allows: more of what is due, then stop */
  let items = dueItems.concat(weakItems, newItems);
  if (items.length < budget) {
    for (const x of due) {
      if (items.length >= budget) break;
      if (!used.has(x.q.id)) items.push(take(x.q, 'due'));
    }
  }

  /* interleave the three kinds so a session is not a block of each */
  const queues = { due: [], weak: [], new: [] };
  for (const it of items) queues[it.reason].push(it);
  items = [];
  for (let i = 0; ; i++) {
    let added = false;
    for (const k of ['due', 'weak', 'new']) if (queues[k][i]) { items.push(queues[k][i]); added = true; }
    if (!added) break;
  }

  const counts = { due: 0, weak: 0, new: 0 };
  for (const it of items) counts[it.reason]++;
  const parts = [];
  if (counts.due) parts.push(`${counts.due} due for review`);
  if (counts.weak) parts.push(`${counts.weak} from your weaker chapters (${weak.map(w => `${w.ch} ${w.pct}%`).join(', ')})`);
  if (counts.new) parts.push(`${counts.new} new`);
  const text = items.length
    ? `${Math.round(minutes)} min · ${items.length} question${items.length === 1 ? '' : 's'}: ${parts.join(', ')}.`
    : 'Nothing to plan: there are no questions to draw from.';
  return { items, budget, minutes, secPerQuestion, counts, weakChapters: weak, text };
}

/* ── readiness ────────────────────────────────────────────────────────── */

function readiness(o) {
  o = obj(o);
  const pool = arr(o.pool).filter(q => q && typeof q.id === 'string');
  const srs = obj(o.srs);
  const today = typeof o.today === 'string' ? o.today : FSRS.todayISO();
  const total = pool.length;
  const seenCards = pool.filter(q => srs[q.id]);
  const seen = seenCards.length;
  const unseen = total - seen;

  const retention = seen ? seenCards.reduce((s, q) => s + retrievability(srs[q.id], today), 0) / seen : null;
  const dueNow = seenCards.filter(q => typeof srs[q.id].due === 'string' && srs[q.id].due <= today).length;
  const { rows, mean } = chapterRows(o.chStats, 1);
  const weak = weakChapters(o.chStats, 3);

  let daysLeft = null;
  if (typeof o.examDate === 'string') {
    try { const d = FSRS.daysBetween(today, o.examDate); if (Number.isFinite(d)) daysLeft = d; } catch (_) { /* no date, no countdown */ }
  }
  const pace = num(o.recentPerDay, null);
  let status, needPerDay = null, daysToFinish = null;
  if (seen < 20) status = 'no-data';
  else if (daysLeft === null) status = 'no-exam-date';
  else if (daysLeft <= 0) status = 'exam-day';
  else {
    needPerDay = Math.ceil((unseen + dueNow) / daysLeft);
    if (pace === null || pace <= 0) status = 'pace-unknown';
    else {
      daysToFinish = Math.ceil((unseen + dueNow) / pace);
      status = daysToFinish <= daysLeft ? (daysToFinish <= daysLeft * 0.75 ? 'ahead' : 'on-track') : 'behind';
    }
  }

  const pct = v => v === null ? null : Math.round(v * 100);
  const lines = [];
  if (status === 'no-data') lines.push('Too early to forecast: answer a few more questions first.');
  else {
    lines.push(`You have seen ${seen} of ${total} questions (${pct(seen / (total || 1))}%) and remember about ${pct(retention)}% of them today.`);
    if (status === 'no-exam-date') lines.push('Set your exam date for a countdown.');
    else if (status === 'exam-day') lines.push('Your exam date is today or has passed.');
    else if (status === 'pace-unknown') lines.push(`${daysLeft} days left. About ${needPerDay} questions a day covers the rest and your reviews.`);
    else if (status === 'behind') lines.push(`${daysLeft} days left. At ${Math.round(pace)} a day you need ${daysToFinish} days: about ${needPerDay} a day would finish in time.`);
    else lines.push(`${daysLeft} days left. At ${Math.round(pace)} a day you finish in ${daysToFinish}: ${status === 'ahead' ? 'comfortably ahead' : 'on track'}.`);
    if (weak.length) lines.push(`Weakest: ${weak.map(w => `${w.ch} (${w.pct}%)`).join(', ')}.`);
  }
  return {
    status, total, seen, unseen, coverage: total ? seen / total : 0,
    retention, dueNow, accuracy: mean === null ? null : mean / 100,
    chapters: rows.sort((a, b) => a.pct - b.pct), weakChapters: weak,
    daysLeft, needPerDay, daysToFinish, text: lines.join(' '),
  };
}

root.StudyPlan = { plan, readiness, weakChapters, retrievability, DEFAULT_SEC };

})(typeof window !== 'undefined' ? window : this);
