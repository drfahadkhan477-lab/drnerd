/* ═════════════════════════════════════════════
   studyplan.js — what to study in the time you have, and whether you are on track.

   Two questions a tired fellow actually asks, answered from data the app already
   keeps (one spaced-repetition card per question, per-chapter right/total counts,
   the set of missed questions), with no screen of its own yet:

     plan({ minutes, pool, srs, chStats, missed })
        "I have 20 minutes."  → which questions, in what order, and why each one.
     readiness({ pool, srs, chStats, examDate, recentPerDay })
        "Am I on track?"      → coverage, retention, what is weakest, and a plain verdict; each chapter's
                                 accuracy as an interval, and, once the owner gives the exam blueprint
                                 (src/core/blueprint.js), a likely score across the exam as one.

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

/* ── how sure: a beta-binomial posterior a chapter (docs/ROADMAP.md, S7) ──────────────────────────────

   A chapter's accuracy over a handful of answers is a guess, and a single percentage hides how much of one.
   Each chapter's chance of a right answer is given a Beta posterior: a prior worth PRIOR_N answers, centred
   on the fellow's own accuracy over every chapter (so a chapter with little data leans toward how they do
   in general rather than toward 50%), updated by that chapter's right and wrong. Its interval is the middle
   LEVEL of that posterior. The prior is Beta(1 + (PRIOR_N - 2)m, 1 + (PRIOR_N - 2)(1 - m)), m the pooled
   accuracy, which stays a proper Beta at m = 0 and m = 1; with nothing answered anywhere it is Beta(1, 1).

   The answers counted are chStats', every graded answer in practice, as readiness has always read them; a
   question answered again after a miss counts again. */
const PRIOR_N = 4;
const LEVEL = 0.8;

/* ln Γ(x), Lanczos (g = 7, nine terms), for x > 0. */
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
/* The continued fraction of the incomplete beta (modified Lentz). */
function betacf(x, a, b) {
  const TINY = 1e-300;
  let c = 1, d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}
/* The regularised incomplete beta I_x(a, b): the Beta(a, b) distribution's chance of a value at or below x. */
function betaCdf(x, a, b) {
  if (!(x > 0)) return 0;
  if (!(x < 1)) return 1;
  const front = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? front * betacf(x, a, b) / a : 1 - front * betacf(1 - x, b, a) / b;
}
/* The value below which Beta(a, b) falls with chance p, by halving: the cdf only rises, and sixty halvings is
   closer than a double can tell. */
function betaQuantile(p, a, b) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (betaCdf(mid, a, b) < p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
function betaOf(a, b) {
  const mean = a / (a + b);
  return { a, b, mean, sd: Math.sqrt(a * b / ((a + b) * (a + b) * (a + b + 1))),
           lo: betaQuantile((1 - LEVEL) / 2, a, b), hi: betaQuantile((1 + LEVEL) / 2, a, b) };
}
function prior(chStats) {
  const { rows } = chapterRows(chStats, 1);
  let c = 0, n = 0;
  for (const r of rows) { c += r.correct; n += r.total; }
  const m = n ? c / n : 0.5;
  return n ? { a: 1 + (PRIOR_N - 2) * m, b: 1 + (PRIOR_N - 2) * (1 - m) } : { a: 1, b: 1 };
}
/* A chapter's posterior, from its right and its total (nothing answered: the prior alone). */
function posterior(pr, correct, total) {
  const c = Number.isFinite(correct) && correct > 0 ? correct : 0;
  const n = Number.isFinite(total) && total > c ? total : c;
  return betaOf(pr.a + c, pr.b + (n - c));
}

/* The score across the exam: each chapter's posterior weighted by its share of the blueprint. The chapters
   are taken as independent, so the weighted sum has mean Σ w·mean and variance Σ w²·sd²; its interval is
   read from the Beta with that mean and variance. A blueprint that names a chapter the bank does not have is
   refused, with the names, rather than scaled over the rest. */
function examScore(pool, chStats, weights) {
  const w = obj(weights);
  const names = Object.keys(w).filter(k => Number.isFinite(w[k]) && w[k] > 0);
  if (!names.length) return { state: 'none' };
  const bank = new Set(pool.map(q => q.ch));
  const unknown = names.filter(n => !bank.has(n)).sort();
  if (unknown.length) return { state: 'refused', unknown };
  const sum = names.reduce((t, n) => t + w[n], 0);
  const pr = prior(chStats), st = obj(chStats);
  let mean = 0, v = 0;
  for (const n of names) {
    const s = obj(st[n]), p = posterior(pr, s.correct, s.total), k = w[n] / sum;
    mean += k * p.mean; v += k * k * p.sd * p.sd;
  }
  const kk = mean * (1 - mean) / v - 1;
  const fit = v > 0 && kk > 0 ? betaOf(mean * kk, (1 - mean) * kk) : { mean, lo: mean, hi: mean };
  return { state: 'ok', mean, lo: fit.lo, hi: fit.hi, level: LEVEL, chapters: names.length };
}

/* Chapters below the fellow's own pooled accuracy, weakest first. */
function weakChapters(chStats, limit) {
  const { rows, mean } = chapterRows(chStats, 5);
  if (mean === null) return [];
  // Compare the measured ratio; pct is rounded only for display.
  const pr = prior(chStats);
  return rows.filter(r => r.correct / r.total * 100 < mean).sort((a, b) => a.correct / a.total - b.correct / b.total || (a.ch < b.ch ? -1 : 1)).slice(0, limit || 3)
    .map(r => { const p = posterior(pr, r.correct, r.total); return Object.assign(r, { lo: Math.round(p.lo * 100), hi: Math.round(p.hi * 100) }); });
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

/* The final fortnight puts the largest expected loss first. Shares need no
   normalization to rank. Use equal shares if this bank has no matching
   blueprint. Every due card remains eligible, including unweighted chapters. */
function rankedDue(pool, srs, today, exam, weights) {
  const due = pool.filter(q => FSRS.isDue(srs[q.id], today, exam));
  const shares = exam && exam.finalFortnight && weights;
  const names = Object.keys(shares || {});
  const chapters = names.length ? new Set(pool.map(q => q.ch)) : null;
  const weighted = names.length && names.every(ch => chapters.has(ch) && Number.isFinite(shares[ch]) && shares[ch] >= 0)
    && names.some(ch => shares[ch] > 0);
  return due.map(q => {
    const r = retrievability(srs[q.id], today);
    const weight = weighted ? (Object.prototype.hasOwnProperty.call(shares, q.ch) ? shares[q.ch] : 0) : 1;
    return { q, r, risk: weight * (1 - r) };
  }).sort((a, b) => b.risk - a.risk || a.r - b.r || (a.q.id < b.q.id ? -1 : a.q.id > b.q.id ? 1 : 0)).map(x => x.q);
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
  const exam = FSRS.examWindow(today, o.examDate);
  const finalFortnight = exam && exam.finalFortnight;
  const weights = 'blueprint' in o ? o.blueprint : (root.Blueprint && root.Blueprint.weights);
  const due = rankedDue(pool, srs, today, exam, weights);
  const dueQuota = Math.min(due.length, finalFortnight ? budget : Math.ceil(budget * 0.6));
  const dueItems = due.slice(0, dueQuota).map(q => take(q, 'due'));

  /* 2. weak chapters: missed first, then never seen */
  const weak = weakChapters(o.chStats, 3);
  const weakNames = weak.map(w => w.ch);
  const byWeak = Object.create(null);
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
  const byNew = Object.create(null);
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
    for (const q of due) {
      if (items.length >= budget) break;
      if (!used.has(q.id)) items.push(take(q, 'due'));
    }
  }

  /* interleave the three kinds so a session is not a block of each */
  const queues = { due: [], weak: [], new: [] };
  for (const it of items) queues[it.reason].push(it);
  items = finalFortnight ? queues.due.splice(0) : [];
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
  const exam = FSRS.examWindow(today, o.examDate);
  const dueNow = seenCards.filter(q => FSRS.isDue(srs[q.id], today, exam)).length;
  const { rows, mean } = chapterRows(o.chStats, 1);
  const weak = weakChapters(o.chStats, 3);
  const pr = prior(o.chStats);
  rows.forEach(r => { const p = posterior(pr, r.correct, r.total); r.lo = Math.round(p.lo * 100); r.hi = Math.round(p.hi * 100); });
  /* The blueprint handed in, or else the page's (src/core/blueprint.js); null leaves the score unsaid. */
  const bp = 'blueprint' in o ? o.blueprint : (root.Blueprint ? root.Blueprint.weights : null);
  const score = examScore(pool, o.chStats, bp);

  let daysLeft = null;
  if (typeof o.examDate === 'string') {
    try {
      const date = FSRS.isoToLocalDate(o.examDate);
      if (date && FSRS.localDateToISO(date) === o.examDate) {
        const d = FSRS.daysBetween(today, o.examDate);
        if (Number.isFinite(d)) daysLeft = d;
      }
    } catch (_) { /* no date, no countdown */ }
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
    if (score.state === 'ok') lines.push(`Across the exam's blueprint, a score of ${pct(score.lo)} to ${pct(score.hi)}% is likely (${Math.round(LEVEL * 100)}% interval).`);
    else if (score.state === 'refused') lines.push(`The exam blueprint names chapters this bank does not have (${score.unknown.join(', ')}), so no exam score is given.`);
    else lines.push('A likely exam score waits for the exam blueprint.');
    if (weak.length) lines.push(`Weakest: ${weak.map(w => `${w.ch} (likely ${w.lo} to ${w.hi}%)`).join(', ')}.`);
  }
  return {
    status, total, seen, unseen, coverage: total ? seen / total : 0,
    retention, dueNow, accuracy: mean === null ? null : mean / 100,
    chapters: rows.sort((a, b) => a.pct - b.pct), weakChapters: weak,
    daysLeft, needPerDay, daysToFinish, score, text: lines.join(' '),
  };
}

root.StudyPlan = { rankedDue, plan, readiness, weakChapters, retrievability, examScore, betaCdf, betaQuantile, DEFAULT_SEC, PRIOR_N, LEVEL };

})(typeof window !== 'undefined' ? window : this);
