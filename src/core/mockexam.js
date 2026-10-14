/* ═════════════════════════════════════════════
   mockexam.js — a timed block of questions with no feedback until it is handed in.

   The quiz tells you the answer the moment you pick one, which is how you learn and
   nothing like how the boards go: there you choose, move on, come back, and find out
   at the end. This is that, as plain data and arithmetic, so the screen only draws it:

     build({ pool, size, chapter, seen, rng })   which questions, in what order
     start / select / toggleFlag / go            the block, as the fellow works it
     tick / hold / resume / pause / unpause      the clock
     grade(rec, lookup)                          the score, by chapter, with the time
     summary / validEntry / cleanHistory         what is kept of a finished block
     serialize / restore                         what survives the page being closed

   THE RULES, because each is a way a mock exam quietly stops being one:

     1. The clock runs only while the app is on screen. An iPad drops a page from
        memory a minute after you switch away, and a glance at another app must not
        eat the block. So one tick never counts more than MAX_GAP_MS (a frozen page
        is time away, not time spent), and a page that was closed and comes back
        does so with the time it had, not the time that passed.
     2. Nothing is graded until the block ends. select() records a choice and can
        take it back; only grade() decides right or wrong, once, at the end.
     3. A question left unanswered is wrong for the score and its own line in the
        report ("skipped"), never silently dropped from it.
     4. Never the same question twice in a block; never a quarantined one; fresh
        questions before ones already seen, because a block of questions you have
        met measures memory of the quiz, not of the subject.
     5. restore() runs on whatever is in storage, so it does not throw: a record it
        cannot trust is no record, and a record with one bad answer keeps the rest.

   Like studyplan.js it has no DOM and no clock of its own: every function that
   needs the time is handed it, which is also what lets bare Node test it.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

const VERSION = 1;
const SIZES = [20, 40, 60];
const PACES = [60, 90, 120];             // seconds a question; 0 is "no limit"
const DEFAULT_PACE = 90;
const MAX_PACE = 600;
const MAX_IDS = 500;
const MAX_GAP_MS = 15000;
const MAX_QUESTION_MS = 3600000;         // an hour on one question is a walk away, not thinking
const LOW_MS = 5 * 60000, CRITICAL_MS = 60000;
const HISTORY_CAP = 30;
const MAX_NAME = 120;

const obj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const arr = v => Array.isArray(v) ? v : [];
const num = (v, d) => Number.isFinite(v) ? v : d;
const isInt = Number.isInteger;
const count = v => isInt(v) && v >= 0;
const text = v => typeof v === 'string' && v.length > 0 && v.length <= MAX_NAME;

/* Fisher–Yates over a copy. The rng is asked for a number in [0, 1); one that is not
   (NaN, 1, a function that throws nothing sensible) is pulled back inside the array
   rather than allowed to read past it. */
function shuffled(list, rng) {
  const b = list.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.max(0, Math.floor(rng() * (i + 1)) || 0));
    const t = b[i]; b[i] = b[j]; b[j] = t;
  }
  return b;
}

/* ── which questions ───────────────────────────────────────────────────────── */
function build(opts) {
  const o = obj(opts), rng = typeof o.rng === 'function' ? o.rng : Math.random;
  const isSeen = typeof o.seen === 'function' ? o.seen : () => false;
  const have = new Set(), cand = [];
  for (const q of arr(o.pool)) {
    if (!q || typeof q.id !== 'string' || q.bad || have.has(q.id)) continue;
    if (o.chapter && q.ch !== o.chapter) continue;
    have.add(q.id); cand.push(q);
  }
  const want = Math.floor(num(o.size, 0));
  const n = Math.min(Math.max(want, 0), cand.length, MAX_IDS);
  if (!n) return [];
  const fresh = shuffled(cand.filter(q => !isSeen(q.id)), rng);
  const known = shuffled(cand.filter(q => isSeen(q.id)), rng);
  /* Fresh first, then the block is shuffled again so what comes first on the screen
     does not say which questions are new. */
  return shuffled(fresh.concat(known).slice(0, n), rng).map(q => q.id);
}

/* ── the block ─────────────────────────────────────────────────────────────── */
function start(opts) {
  const o = obj(opts);
  const ids = arr(o.ids).filter(x => typeof x === 'string');
  const sec = isInt(o.secPerQ) && o.secPerQ >= 0 && o.secPerQ <= MAX_PACE ? o.secPerQ : DEFAULT_PACE;
  return {
    v: VERSION, ids, i: 0, far: 0, sel: {}, flag: {}, ms: {}, secPerQ: sec,
    chapter: text(o.chapter) ? o.chapter : null,
    startedAt: num(o.now, 0), elapsedMs: 0, paused: false, done: false,
    submittedAt: null, expired: false, last: null,
  };
}

/* Records a choice for the question on screen, or takes it back if it is the choice
   already there. Returns whether anything changed. */
function select(rec, idx, nOpts) {
  if (!rec || rec.done || rec.paused) return false;
  if (!(isInt(idx) && idx >= 0 && idx < num(nOpts, 0))) return false;
  if (rec.sel[rec.i] === idx) delete rec.sel[rec.i]; else rec.sel[rec.i] = idx;
  return true;
}

function toggleFlag(rec) {
  if (!rec || rec.done || rec.paused) return false;
  if (rec.flag[rec.i]) delete rec.flag[rec.i]; else rec.flag[rec.i] = 1;
  return true;
}

function go(rec, j) {
  if (!rec || rec.done || rec.paused || !isInt(j)) return false;
  const n = rec.ids.length;
  if (j < 0 || j >= n || j === rec.i) return false;
  rec.i = j;
  if (j > rec.far) rec.far = j;
  return true;
}

function states(rec) {
  const ids = rec ? arr(rec.ids) : [], sel = obj(rec && rec.sel), flag = obj(rec && rec.flag);
  const cells = ids.map((id, k) => ({
    n: k + 1, answered: sel[k] != null, flagged: !!flag[k], current: k === rec.i,
  }));
  const answered = cells.filter(c => c.answered).length;
  return { n: ids.length, cells, answered, unanswered: ids.length - answered, flagged: cells.filter(c => c.flagged).length };
}

/* ── the clock ─────────────────────────────────────────────────────────────── */
/* Adds the time since the last tick to the block and to the question on screen, if
   the clock is running: the app is on screen (`active`), the block is not paused or
   done, and there was a last tick to measure from. A tick that finds the clock not
   running forgets its start, so the first tick after it begins again from itself. */
function tick(rec, now, active) {
  if (!rec) return rec;
  const last = rec.last;
  rec.last = Number.isFinite(now) && active ? now : null;
  if (!active || rec.paused || rec.done || !Number.isFinite(last) || !Number.isFinite(now)) return rec;
  const dt = Math.min(Math.max(0, now - last), MAX_GAP_MS);
  rec.elapsedMs += dt;
  rec.ms[rec.i] = Math.min(MAX_QUESTION_MS, (rec.ms[rec.i] || 0) + dt);
  return rec;
}
function hold(rec) { if (rec) rec.last = null; return rec; }
function resume(rec, now) { if (rec) rec.last = Number.isFinite(now) ? now : null; return rec; }
function pause(rec) { if (rec && !rec.done) { rec.paused = true; rec.last = null; } return rec; }
function unpause(rec, now) { if (rec && !rec.done) { rec.paused = false; rec.last = Number.isFinite(now) ? now : null; } return rec; }

function limitMs(rec) {
  return rec && rec.secPerQ > 0 && arr(rec.ids).length ? rec.secPerQ * 1000 * rec.ids.length : null;
}
function remainingMs(rec) {
  const lim = limitMs(rec);
  return lim == null ? null : Math.max(0, lim - rec.elapsedMs);
}
function expired(rec) {
  const lim = limitMs(rec);
  return lim != null && rec.elapsedMs >= lim;
}
/* 'none' for an untimed block, then ok, low (five minutes left) and critical (one).
   A block shorter than five minutes is never "low": it would be low from the start. */
function urgency(rec) {
  const rem = remainingMs(rec), lim = limitMs(rec);
  if (rem == null) return 'none';
  if (rem <= CRITICAL_MS) return 'critical';
  if (rem <= LOW_MS && lim > LOW_MS) return 'low';
  return 'ok';
}
/* Where the fellow is against an even pace: the furthest question reached, against
   the one an even pace would be on by now. Within one is "on pace". Not the question on
   screen: going back to a flagged one near the start is not falling behind. */
function pace(rec) {
  const per = rec && rec.secPerQ > 0 ? rec.secPerQ * 1000 : 0;
  if (!per || !arr(rec.ids).length) return null;
  const expected = Math.min(rec.ids.length, Math.floor(rec.elapsedMs / per) + 1);
  const diff = (rec.far + 1) - expected;
  return { status: diff >= 2 ? 'ahead' : diff <= -2 ? 'behind' : 'on', diff, expected };
}

/* m:ss under an hour, h:mm:ss over; a countdown rounds up so it reads 0:01 until it is
   truly over, a stopwatch rounds down so it reads 0:00 until a second has passed. */
function fmtClock(ms, dir) {
  const v = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const s = dir === 'down' ? Math.ceil(v / 1000) : Math.floor(v / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = n => String(n).padStart(2, '0');
  return h ? h + ':' + p(m) + ':' + p(r) : p(m) + ':' + p(r);
}

/* Ends the block. A block that ran out of time is not charged for the seconds a late
   tick added after the limit. */
function finish(rec, now, ranOut) {
  if (!rec || rec.done) return rec;
  tick(rec, now, true);
  const lim = limitMs(rec);
  if (ranOut && lim != null) rec.elapsedMs = Math.min(rec.elapsedMs, lim);
  rec.done = true; rec.paused = false; rec.expired = !!ranOut;
  rec.submittedAt = num(now, null); rec.last = null;
  return rec;
}

/* ── the score ─────────────────────────────────────────────────────────────── */
/* lookup(id) → { ch, ci } for a question, or null for one the bank no longer has.
   Such a question is not graded: it is neither a right answer nor a wrong one. */
function grade(rec, lookup) {
  const ids = rec ? arr(rec.ids) : [];
  const look = typeof lookup === 'function' ? lookup : () => null;
  const sel = obj(rec && rec.sel), flag = obj(rec && rec.flag), ms = obj(rec && rec.ms);
  const items = [], by = new Map();
  let correct = 0, wrong = 0, skipped = 0, flagged = 0, flaggedWrong = 0;
  ids.forEach((id, k) => {
    const info = obj(look(id));
    const ch = typeof info.ch === 'string' && info.ch ? info.ch : 'Other';
    const ci = isInt(info.ci) ? info.ci : null;
    const picked = isInt(sel[k]) ? sel[k] : null;
    const fl = !!flag[k];
    const state = picked == null || ci == null ? 'skipped' : picked === ci ? 'correct' : 'wrong';
    if (state === 'correct') correct++; else if (state === 'wrong') wrong++; else skipped++;
    if (fl) { flagged++; if (state !== 'correct') flaggedWrong++; }
    const row = by.get(ch) || { ch, n: 0, correct: 0, wrong: 0, skipped: 0 };
    row.n++; row[state]++; by.set(ch, row);
    items.push({ i: k, id, ch, state, sel: picked, ci, flagged: fl, ms: Math.max(0, Math.round(num(ms[k], 0))) });
  });
  const n = ids.length, answered = correct + wrong;
  const used = Math.max(0, num(rec && rec.elapsedMs, 0));
  return {
    n, answered, correct, wrong, skipped, flagged, flaggedWrong,
    pct: n ? Math.round(100 * correct / n) : 0,
    pctAnswered: answered ? Math.round(100 * correct / answered) : null,
    usedMs: used, limitMs: limitMs(rec), expired: !!(rec && rec.expired),
    avgMs: n ? Math.round(used / n) : null,
    items, byCh: Array.from(by.values()),
    slowest: items.filter(x => x.ms > 0).sort((a, b) => b.ms - a.ms || a.i - b.i).slice(0, 3)
      .map(x => ({ i: x.i, id: x.id, ch: x.ch, ms: x.ms, state: x.state })),
  };
}

/* The questions worth another look, in block order: 'missed' is wrong, skipped or
   flagged (a flag is the fellow saying "I was not sure"), 'all' is every one. */
function reviewIds(result, which) {
  const items = arr(result && result.items);
  if (which === 'all') return items.map(x => x.id);
  if (which === 'missed') return items.filter(x => x.state !== 'correct' || x.flagged).map(x => x.id);
  return [];
}

/* ── what is kept of a finished block ──────────────────────────────────────── */
function summary(result, rec, now) {
  const by = {};
  for (const r of arr(result && result.byCh)) by[r.ch] = [r.correct, r.n];
  return {
    ts: num(now, 0), n: result.n, answered: result.answered, correct: result.correct,
    ms: Math.round(result.usedMs), limit: result.limitMs, ch: rec && text(rec.chapter) ? rec.chapter : null, by,
  };
}

/* One entry of the history, as read back from storage or a backup. The totals must
   agree with each other: a block cannot have more right than answered, or answers that
   are not among its questions, and the chapters must add up to the block. */
function validEntry(x) {
  const e = obj(x);
  if (!(Number.isFinite(e.ts) && e.ts > 0)) return false;
  if (!(count(e.n) && e.n >= 1 && e.n <= MAX_IDS && count(e.answered) && count(e.correct))) return false;
  if (!(e.correct <= e.answered && e.answered <= e.n)) return false;
  if (!(Number.isFinite(e.ms) && e.ms >= 0)) return false;
  if (!(e.limit === null || (Number.isFinite(e.limit) && e.limit > 0))) return false;
  if (!(e.ch === null || text(e.ch))) return false;
  if (!(x && typeof x === 'object' && x.by && typeof x.by === 'object' && !Array.isArray(x.by))) return false;
  let total = 0, right = 0;
  for (const k of Object.keys(x.by)) {
    const p = x.by[k];
    if (!text(k) || !Array.isArray(p) || p.length !== 2 || !count(p[0]) || !count(p[1]) || p[0] > p[1]) return false;
    right += p[0]; total += p[1];
  }
  return total === e.n && right === e.correct;
}
function cleanHistory(list) { return arr(list).filter(validEntry).slice(-HISTORY_CAP); }
function pushHistory(list, entry) {
  return cleanHistory(list).concat(validEntry(entry) ? [entry] : []).slice(-HISTORY_CAP);
}

/* ── surviving a closed page ───────────────────────────────────────────────── */
function serialize(rec) {
  if (!rec) return null;
  return {
    v: VERSION, ids: rec.ids.slice(), i: rec.i, far: rec.far, sel: Object.assign({}, rec.sel),
    flag: Object.assign({}, rec.flag), ms: Object.assign({}, rec.ms), secPerQ: rec.secPerQ,
    chapter: rec.chapter, startedAt: rec.startedAt, elapsedMs: rec.elapsedMs,
    paused: !!rec.paused, done: !!rec.done, submittedAt: rec.submittedAt, expired: !!rec.expired,
  };
}

/* env: { has(id), nOpts(id), lastStartedAt }. Returns a block ready to carry on, or null.
   Null when it is not a block of this version, is finished, names a question the bank no
   longer has (it could not be graded), or is the block already handed in (a page that
   closed between handing in and clearing the store). Anything else that is wrong with it
   is dropped and the rest is kept.

   restoreDone() reads the other kind of record: the block last handed in, kept so its
   report can be shown again after a reload. Same rules, but it must be finished, and
   it keeps when and how it ended. */
function restore(raw, env) { return readRecord(raw, env, false); }
function restoreDone(raw, env) { return readRecord(raw, env, true); }

function readRecord(raw, env, wantDone) {
  const r = obj(raw), e = obj(env);
  if (r.v !== VERSION || (r.done === true) !== wantDone) return null;
  const ids = r.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_IDS || !ids.every(x => typeof x === 'string')) return null;
  if (new Set(ids).size !== ids.length) return null;
  const has = typeof e.has === 'function' ? e.has : () => true;
  if (!ids.every(id => has(id))) return null;
  if (!wantDone && Number.isFinite(e.lastStartedAt) && r.startedAt === e.lastStartedAt) return null;
  const nOpts = typeof e.nOpts === 'function' ? e.nOpts : () => 5, n = ids.length;
  const pick = (src, ok) => {
    const out = {};
    for (const k of Object.keys(obj(src))) {
      const i = Number(k);
      /* A key must be a question number as the app writes one ("3"), not something
         Number() would also read as one: "", " 1 ", "0x1", "1e0". */
      if (isInt(i) && String(i) === k && i >= 0 && i < n && ok(src[k], i)) out[i] = src[k];
    }
    return out;
  };
  const sel = pick(r.sel, (v, i) => isInt(v) && v >= 0 && v < num(nOpts(ids[i]), 0));
  const flag = pick(r.flag, v => v === 1);
  const ms = pick(r.ms, v => Number.isFinite(v) && v >= 0 && v <= MAX_QUESTION_MS);
  const i = isInt(r.i) && r.i >= 0 && r.i < n ? r.i : 0;
  const sumMs = Object.keys(ms).reduce((a, k) => a + ms[k], 0);
  return {
    v: VERSION, ids: ids.slice(), i, far: isInt(r.far) && r.far >= i && r.far < n ? r.far : i,
    sel, flag, ms,
    secPerQ: isInt(r.secPerQ) && r.secPerQ >= 0 && r.secPerQ <= MAX_PACE ? r.secPerQ : DEFAULT_PACE,
    chapter: text(r.chapter) ? r.chapter : null, startedAt: num(r.startedAt, 0),
    elapsedMs: Number.isFinite(r.elapsedMs) && r.elapsedMs >= 0 ? r.elapsedMs : sumMs,
    paused: false, done: wantDone,
    submittedAt: wantDone && Number.isFinite(r.submittedAt) ? r.submittedAt : null,
    expired: wantDone && r.expired === true, last: null,
  };
}

root.MockExam = {
  VERSION, SIZES, PACES, DEFAULT_PACE, MAX_GAP_MS, HISTORY_CAP,
  build, start, select, toggleFlag, go, states,
  tick, hold, resume, pause, unpause, limitMs, remainingMs, expired, urgency, pace, fmtClock, finish,
  grade, reviewIds, summary, validEntry, cleanHistory, pushHistory, serialize, restore, restoreDone,
};

})(typeof window !== 'undefined' ? window : this);
