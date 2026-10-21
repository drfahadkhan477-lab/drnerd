/* ═════════════════════════════════════════════
   apexsignals.js — what Apex is told about HOW the fellow answers, not only whether they were right.

   Apex has always known the score, the weak chapters, what is due and what was missed (profile.js). A tutor
   sitting beside you would also have seen which option you chose, how sure you said you were, how long you
   took, why you think you missed it, how the last mock block went and how long is left to the exam. The app
   keeps nearly all of that (the review log, the mock history, the exam date) and showed it only on the
   Progress screen. This turns it into the few plain lines a tutor can use, and into the list of recent misses
   a tutor can explain. No DOM, no clock, no storage: bare Node can test it. ES2015.

     standing({ log, mocks, flagged, daysLeft, now })   lines about how they answer: certain and wrong, why they miss,
                                                        pace, the last mock block, the exam, what they flagged
     answerLine({ pick, ok, cf, why, ms, flagged, grounded, letters })
                                                        what they did on the question in front of Apex
     digest({ log, missed, byId, limit, now, grounded, cap })   their recent misses, one per question, with what each was
                                                        (cap: characters of rows to give; a row is never over the default)

   THE RULES, because each is a way the tutor is told something untrue:

     1. A reading with too few answers behind it is not told. calib.js says a band with fewer than MIN_SAMPLES
        answers has too few, and a confident percentage over four answers would be believed. The same bar holds
        for how long right and wrong answers take: each side needs its own twelve.
     2. Grounded mode never learns the key. The fellow can ask Apex to teach only from their own notes, and the
        answer key and the bank's wording are what that withholds. The model is already given the ids of recent
        misses (profile.js, get_performance), so it can tell whether the item in front of it was missed; and the
        option chosen, set beside that, is the key (chose D and it was not missed) or one option ruled out. So in
        grounded mode the line about the question in front of Apex says how sure and how long and that they
        answered, never which option, whether it was right or why it was missed (a reason exists only for a miss).
        The list of misses gives ids, chapter and item number, how sure, why and how long, never a stem, an
        option's wording, the keyed letter or the option they chose.
     3. An old row lacks fields, and a missing field is absent, never zero: no choice recorded is not option A,
        no time is not an instant answer, no confidence is not "Guess".
     4. A miss is the latest answer to a question, and it is still a miss. A question missed last month and
        answered right since is not listed, and neither is one the app no longer calls missed.
     5. Nothing here throws. This runs on the path that assembles every prompt; the log it reads is restored
        from a user-picked file. A reading that cannot be made is a line left out.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

const Calib = root.Calib || (typeof require === 'function' ? require('./calib.js').Calib : null);
const MockExam = root.MockExam || (typeof require === 'function' ? require('./mockexam.js').MockExam : null);

const ANSWER_MODES = ['practice', 'review-answer', 'exam'];
const PACE_MODES = ['practice', 'review-answer'];     // an exam answer's time is not a practice answer's (calib.js says why)
const MAX_PICK = 25;                  // option letters A to Z
const MAX_ANSWER_MS = 30 * 60000;     // half an hour on one question is a walk away, not thinking
const DAY_MS = 86400000;
const DEFAULT_LIMIT = 8, MAX_LIMIT = 15;
const CAP_CHARS = 7500;               // a tool result is cut at 9000 characters: stop between rows, before that
const STEM_CHARS = 200, OPTION_CHARS = 110, NAME_CHARS = 60;
const MAX_DAYS_LEFT = 730;

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const arr = v => Array.isArray(v) ? v : [];
const whole = v => Number.isInteger(v) && v >= 0;
const finite = v => typeof v === 'number' && Number.isFinite(v);
const secs = ms => Math.round(ms / 1000);
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/* One line of plain text, cut at n characters. */
function clip(s, n) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).replace(/\s+$/, '') + '…' : t;
}

/* How long ago, in the words a person says it. A time in the future (a clock set back) is "recently". */
function ago(t, now) {
  if (!finite(t) || !finite(now)) return '';
  const d = Math.floor((now - t) / DAY_MS);
  if (d < 0) return 'recently';
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 14) return d + ' days ago';
  if (d < 60) return Math.round(d / 7) + ' weeks ago';
  return Math.round(d / 30) + ' months ago';
}

/* The letter the bank gives option i, else the i-th letter of the alphabet. */
function letterOf(options, i) {
  const o = arr(options)[i];
  const l = o && typeof o.l === 'string' ? o.l.replace(/[^A-Za-z0-9]/g, '').slice(0, 3) : '';
  return l || String.fromCharCode(65 + i);
}

const bandLabel = cf => (Calib && whole(cf) && Calib.BANDS[cf]) ? Calib.BANDS[cf].label : '';
const reasonLabel = id => {
  if (!Calib || typeof id !== 'string') return '';
  const r = Calib.REASONS.filter(x => x.id === id)[0];
  return r ? r.label : '';
};
/* A time worth quoting: a number of milliseconds that is not a walk away. */
const answerMs = v => (finite(v) && v >= 0 && v <= MAX_ANSWER_MS) ? v : null;

/* ── how they answer ─────────────────────────────────────────────────────────── */

/* Overconfidence is the number calib.js exists to produce; underconfidence is its mirror. Each band speaks only
   when it has the samples to. */
function calibrationLine(log) {
  if (!Calib) return '';
  const bands = Calib.calibration(arr(log)).bands;
  const sure = bands[3], guess = bands[0], parts = [];
  if (sure && sure.accuracy != null) {
    const wrong = sure.n - Math.round(sure.accuracy * sure.n);
    parts.push('Marked Certain on ' + plural(sure.n, 'answer', 'answers') + ' and was wrong on ' + wrong +
      ' of them (' + Math.round((1 - sure.accuracy) * 100) + '%).');
  }
  if (guess && guess.accuracy != null) {
    parts.push('Marked Guess on ' + guess.n + ' and was right on ' + Math.round(guess.accuracy * 100) + '%.');
  }
  return parts.join(' ');
}

/* The three commonest reasons they give for a miss, once enough misses are tagged to say. */
function reasonsLine(log) {
  if (!Calib) return '';
  const r = Calib.reasons(arr(log));
  if (!r.enough) return '';
  const top = r.counts.filter(c => c.n > 0).sort((a, b) => b.n - a.n).slice(0, 3);
  if (!top.length) return '';
  return 'Why they say they miss (' + plural(r.tagged, 'miss', 'misses') + ' tagged): ' +
    top.map(c => c.label + ' ' + c.n).join(', ') + '.';
}

/* Right and wrong answers each need MIN_SAMPLES timed answers behind their median: with one wrong answer the
   "typical wrong answer" is that one. */
function paceLine(log) {
  if (!Calib) return '';
  const rows = arr(log).filter(r => r && PACE_MODES.indexOf(r.m) >= 0 && answerMs(r.ms) !== null);
  const right = rows.filter(r => r.ok).map(r => r.ms), wrong = rows.filter(r => !r.ok).map(r => r.ms);
  if (right.length < Calib.MIN_SAMPLES || wrong.length < Calib.MIN_SAMPLES) return '';
  const mr = Calib.median(right), mw = Calib.median(wrong);
  if (!finite(mr) || !finite(mw)) return '';
  return 'Median time per question: ' + secs(mr) + ' s when right, ' + secs(mw) + ' s when wrong' +
    (mr > mw ? '; right answers take longer than wrong ones, so the recall is there but still effortful.' : '.');
}

/* The last block, the one before it, and the chapter it went worst in. The history is cleaned by the mock
   module's own validator, so an entry that module would refuse is not described. */
function mockLine(mocks, now) {
  if (!MockExam) return '';
  const list = MockExam.cleanHistory(arr(mocks));
  if (!list.length) return '';
  const last = list[list.length - 1];
  const pct = e => Math.round(100 * e.correct / e.n);
  const mins = ms => Math.max(1, Math.round(ms / 60000));
  const when = ago(last.ts, now);
  let s = 'Last mock block' + (when ? ' (' + when + ')' : '') + ': ' + last.correct + ' of ' + last.n + ' right (' + pct(last) + '%), ' +
    last.answered + ' answered, ' + mins(last.ms) + ' min' + (last.limit ? ' of ' + mins(last.limit) : ' (untimed)') +
    (last.ch ? '; ' + clip(last.ch, NAME_CHARS) + ' only' : '') + '.';
  const by = Object.keys(last.by).map(k => ({ ch: k, c: last.by[k][0], n: last.by[k][1] }))
    .filter(x => x.n >= 3).sort((a, b) => (a.c / a.n) - (b.c / b.n) || (a.ch < b.ch ? -1 : 1));
  if (by.length >= 2) s += ' Weakest in it: ' + clip(by[0].ch, NAME_CHARS) + ' ' + by[0].c + ' of ' + by[0].n + '.';
  if (list.length >= 2) s += ' The block before: ' + pct(list[list.length - 2]) + '%.';
  return s;
}

function examLine(daysLeft) {
  if (!finite(daysLeft) || daysLeft < 0 || daysLeft > MAX_DAYS_LEFT) return '';
  const d = Math.floor(daysLeft);
  return d === 0 ? 'The exam is today.' : 'The exam is in ' + plural(d, 'day', 'days') + '.';
}

function flagLine(n) {
  return whole(n) && n > 0 ? plural(n, 'question', 'questions') + ' flagged to come back to.' : '';
}

/* Each reading is made on its own: a log torn in one place costs the line it feeds, not the others. */
function standing(o) {
  o = (o && typeof o === 'object') ? o : {};
  const out = [];
  [
    () => calibrationLine(o.log),
    () => reasonsLine(o.log),
    () => paceLine(o.log),
    () => mockLine(o.mocks, o.now),
    () => examLine(o.daysLeft),
    () => flagLine(o.flagged),
  ].forEach(f => { try { const s = f(); if (s) out.push(s); } catch (_) { /* a line not made */ } });
  return out;
}

/* ── the question in front of Apex ───────────────────────────────────────────── */

/* Nothing without a recorded choice. In grounded mode it stops at how sure and how long, and does not name the option
   (rule 2): whether it was right, a reason for missing it and the option itself are each the key by another name. */
function answerLine(o) {
  try {
    o = (o && typeof o === 'object') ? o : {};
    if (!whole(o.pick) || o.pick > MAX_PICK) return '';
    const grounded = !!o.grounded;
    const L = letterOf(arr(o.letters).map(l => ({ l: l })), o.pick);
    const parts = [grounded ? 'They have answered; the option they chose is withheld in grounded mode.'
      : 'The fellow chose ' + L + (o.ok === true ? ', which was right' : o.ok === false ? ', which was not the answer' : '') + '.'];
    const band = bandLabel(o.cf);
    if (band) parts.push('Before answering they marked themselves "' + band + '".');
    const ms = answerMs(o.ms);
    if (ms !== null) parts.push('They took ' + secs(ms) + ' s.');
    if (!grounded && o.ok === false) {
      const why = reasonLabel(o.why);
      if (why) parts.push('They say they missed it because: ' + why + '.');
    }
    if (o.flagged === true) parts.push('They flagged it to come back to.');
    return parts.join(' ');
  } catch (_) { return ''; }
}

/* ── recent misses ───────────────────────────────────────────────────────────── */

/* One row per question, newest first: the question's latest answer, if it was a miss and the app still calls it
   one (rules 3 and 4). rows say what each was; text is the same, as the tutor reads it, cut between rows so a
   tool's result is never cut in the middle of one. */
function digest(o) {
  const none = { rows: [], text: '', more: false, total: 0 };
  try {
    o = (o && typeof o === 'object') ? o : {};
    const byId = (o.byId && typeof o.byId === 'object') ? o.byId : {};
    const grounded = !!o.grounded;
    const limit = Math.max(1, Math.min(MAX_LIMIT, whole(o.limit) ? o.limit : DEFAULT_LIMIT));
    const cap = whole(o.cap) && o.cap > 0 ? o.cap : CAP_CHARS;     // a row is never over the default; the seam lets a test see the rule
    const missed = o.missed instanceof Set ? o.missed : Array.isArray(o.missed) ? new Set(o.missed) : null;
    const log = arr(o.log);
    const seen = new Set(), found = [];
    for (let i = log.length - 1; i >= 0; i--) {
      const r = log[i];
      if (!r || typeof r.q !== 'string' || ANSWER_MODES.indexOf(r.m) < 0 || seen.has(r.q)) continue;
      seen.add(r.q);
      if (r.ok) continue;
      if (!has(byId, r.q)) continue;
      const q = byId[r.q];
      if (!q || q.bad) continue;
      if (missed && !missed.has(r.q)) continue;
      found.push({ r: r, q: q });
    }
    if (!found.length) return none;

    const rows = [], lines = [];
    let used = 0, more = false;
    for (let k = 0; k < found.length; k++) {
      if (rows.length >= limit) { more = true; break; }
      const r = found[k].r, q = found[k].q;
      const opts = arr(q.o);
      const key = (whole(q.ci) && q.ci < opts.length) ? q.ci : null;
      /* A miss whose recorded choice is the keyed option contradicts itself (a bank corrected since the answer was
         logged, a log edited by hand): which was chosen is then not known, and is not told. */
      const pick = (whole(r.pick) && r.pick < opts.length && r.pick !== key) ? r.pick : null;
      /* Every row here is a miss, so the option chosen is one the key is not: told in grounded mode it would rule that
         option out for an item Apex may have open, which answerLine is careful never to do (rule 2). */
      const row = { id: q.id, ch: q.ch, n: q.n, t: finite(r.t) ? r.t : null, m: r.m, pick: grounded ? null : pick,
        cf: (whole(r.cf) && Calib && Calib.BANDS[r.cf]) ? r.cf : null,
        why: (typeof r.why === 'string' && reasonLabel(r.why)) ? r.why : null,
        ms: answerMs(r.ms) };
      if (!grounded) row.key = key;
      const bits = [];
      const when = ago(row.t, o.now);
      if (when) bits.push(when);
      if (row.m === 'exam') bits.push('in a mock block'); else if (row.m === 'review-answer') bits.push('in a review');
      const band = bandLabel(row.cf);
      const facts = [];
      if (!grounded) facts.push((pick !== null ? 'Chose ' + letterOf(opts, pick) : 'Choice not recorded') + (key !== null ? '; the key is ' + letterOf(opts, key) : '') + '.');
      if (band) facts.push('Marked "' + band + '".');
      if (row.why) facts.push('Reason given: ' + reasonLabel(row.why) + '.');
      if (row.ms !== null) facts.push(secs(row.ms) + ' s.');
      let line = '[' + q.id + '] ' + clip(q.ch, NAME_CHARS) + ', item ' + q.n + (bits.length ? ' — ' + bits.join(', ') : '') + (facts.length ? '\n  ' + facts.join(' ') : '');
      if (!grounded) {
        line += '\n  Stem: ' + clip(q.s, STEM_CHARS);
        if (pick !== null) line += '\n  ' + letterOf(opts, pick) + ': ' + clip(opts[pick] && opts[pick].t, OPTION_CHARS);
        if (key !== null && key !== pick) line += '\n  ' + letterOf(opts, key) + ': ' + clip(opts[key] && opts[key].t, OPTION_CHARS);
      }
      if (rows.length && used + line.length > cap) { more = true; break; }
      used += line.length + 1;
      rows.push(row); lines.push(line);
    }
    const headline = 'Recent misses, newest first (' + rows.length + (more ? ' of ' + found.length : '') + '). For each: ' +
      (grounded ? '' : 'what the fellow chose, the keyed option, ') + 'how sure they said they were, why they say they missed it, how long they took. ' +
      'A part that is missing was not recorded.' +
      (grounded ? ' Grounded mode: the key, the stems, the options\' wording and the option the fellow chose are withheld.' : '');
    return { rows: rows, text: headline + '\n\n' + lines.join('\n\n'), more: more, total: found.length };
  } catch (_) { return none; }
}

root.ApexSignals = { standing, answerLine, digest, clip, ago, letterOf, ANSWER_MODES, MAX_LIMIT, CAP_CHARS };

})(typeof window !== 'undefined' ? window : this);
