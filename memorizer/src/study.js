/* ═══════════════════════════════════════════════════════════════════════════
   study.js — ways of studying beyond the drill.

   PURE. The drill asks multiple-choice questions, which test RECOGNITION:
   the answer is on the screen. An exam, and a ward round, ask for RECALL.
   What is here makes the app ask for recall, and plan it:

     · CLOZE CARDS (clozeOf / clozeCards / checkTyped) — a sentence of the
       book with its number or key term blanked, answered by typing. A
       number must be the book's number; a word may be a letter out
       ("close", rated Hard) but not another word.
     · IMAGE OCCLUSION (occlusionOf) — a figure of the book with one of its
       own printed labels hidden, and the label asked for among the
       figure's other labels. Only figures with enough labels to choose
       from.
     · SECTION CHECKS (CHECK_DAYS / checkPlan / checksDue) — a drilled
       section comes back as a short check at 1, 3, 7 and 21 days, so
       forgetting is caught before it becomes a miss.
     · TIMED PRACTICE (timedSet / practiceTrend) — "I have 20 minutes": a
       mixed set of due cards, weak items and each unit's hardest
       questions, about one a minute, and the score across days.
     · CONFIDENCE (rateWith) — "I'm sure", said before answering. A
       confident wrong answer is the most dangerous kind of miss: it is
       Again, flagged, and asked again before the review ends. A right
       answer is Good either way — not saying is not doubt, and making it
       Hard would shorten every interval of someone who never taps it.
     · CASE VIGNETTES (vignettePrompt / parseVignette) — the on-device
       model writes a short case whose answer the section states; the app
       keeps it only if ground.js finds that answer in the book.

     · A STUDY PLAN TO AN EXAM DATE (parseExamDate / studyPlan) — the
       sections not yet learned spread over the days left, the last days
       kept for review, worked out again each day from where you are.
     · TEACH IT BACK (teachBack) — your explanation checked against the
       section's key points: which you covered, which you left out, and any
       number you gave that the section does not have.
     · WHERE AN ANSWER CAME FROM (claimSources) — each sentence the model
       kept, with the section and page of the step it cites.

     · CORRECTING WHAT TEXT RECOGNITION MISREAD (correctSegment /
       pageConfidence) — how sure it was of each scanned page, and your
       correction of a paragraph, recorded with what it said before.
     · YOUR NOTES AND HIGHLIGHTS (toggleMark / markCard) — kept as yours; a
       point you mark becomes a cloze card.
     · A TABLE, ROW BY ROW (tableRound) — every cell of it asked in turn.
     · THE MASTERY MAP (masteryMap) — each section new, weak, fading or
       solid, from its drill and its cards' recall today.
     · THE WEEK (logActivity / weekly) — time, answers, accuracy and the
       weakest topics, this week against last.
     · A STREAK THAT FORGIVES (streak) — one missed day a week is bridged.

   Nothing here decides what the book says: every card is made of the
   book's own sentence, figure or label.
   tests/verify-memorizer-study-pure.js holds it.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

function coachMod() { return root.MemCoach || (typeof require === 'function' ? require('./coach.js') : null); }

/* ── dates: ISO days, stepped in UTC so no clock change moves one ─────── */
function addDays(iso, n) {
  var p = String(iso).split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}
function daysFrom(a, b) {
  var p = String(a).split('-').map(Number), q = String(b).split('-').map(Number);
  return Math.round((Date.UTC(q[0], q[1] - 1, q[2]) - Date.UTC(p[0], p[1] - 1, p[2])) / 86400000);
}

/* ── cloze: the book's sentence with what matters blanked ─────────────── */
var BLANK = '_____';
/* A number as the book prints it, with its unit or range when it has one. */
var NUMBER = /\d+(?:[.,]\d+)?(?:\s?(?:[–-]|to)\s?\d+(?:[.,]\d+)?)?\s?(?:%|mmHg|mg\/dL|mg|mcg|µg|g\/dL|g|mmol\/L|mEq\/L|mL\/min|mL|ml|L\/min|L|cm²|cm2|cm|mm|ms|bpm|beats|hours?|days?|weeks?|months?|years?)?(?![\w])/;
var CLOZE_WORDS = [6, 45];
function words(t) { return String(t || '').split(/\s+/).filter(Boolean); }
/* sentence: { text, page }. freq: the section's frequencies (coach.js), so
   the term blanked is the one this section is about, not a common word.
   Returns { front, answer, sentence, page } or null. */
function clozeOf(sentence, freq) {
  var text = String(sentence && sentence.text || '').replace(/\s+/g, ' ').trim();
  var n = words(text).length;
  if (n < CLOZE_WORDS[0] || n > CLOZE_WORDS[1]) return null;
  var m = NUMBER.exec(text), answer = '';
  /* a number that is only a list marker or a year is not a fact to learn */
  if (m && !/^\d{4}$/.test(m[0].trim()) && !(m.index === 0 && /^\d+[.)]?$/.test(m[0].trim()))) answer = m[0].trim();
  if (!answer) {
    var C = coachMod();
    var ranked = C.rankedTerms(text, freq || {}, {}).filter(function (t) { return !t.num && t.word.length >= 5; });
    if (!ranked.length) return null;
    var re = new RegExp('(^|[^A-Za-z0-9])(' + ranked[0].word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![A-Za-z0-9])', 'i');
    var hit = re.exec(text);
    if (!hit) return null;
    answer = hit[2];
  }
  var at = text.indexOf(answer);
  if (at < 0) return null;
  return { front: text.slice(0, at) + BLANK + text.slice(at + answer.length), answer: answer, sentence: text, page: sentence.page || 0 };
}
/* Up to max cloze cards for one section: its key sentences first (those
   are what the lesson taught), those with numbers before the rest, never
   two from one sentence. */
var CLOZE_PER_SECTION = 2;
function clozeCards(doc, ci, max) {
  var C = coachMod(), c = doc.clusters[ci];
  if (!c) return [];
  var freq = C.frequencies(c);
  var pool = C.keySentences(c).concat(C.sentences(c));
  var seen = {}, out = [];
  var made = pool.map(function (s) { return clozeOf(s, freq); }).filter(function (x) {
    if (!x || seen[x.sentence]) return false;
    seen[x.sentence] = true; return true;
  });
  made.sort(function (a, b) { return (/\d/.test(b.answer) ? 1 : 0) - (/\d/.test(a.answer) ? 1 : 0); });
  made.slice(0, max == null ? CLOZE_PER_SECTION : max).forEach(function (x) {
    out.push({ id: doc.id + ':cloze:' + ci + ':' + hash(x.sentence), docId: doc.id, source: 'cloze', kind: 'cloze', cluster: ci, title: c.title,
      front: x.front, back: x.answer, explain: x.sentence, page: x.page, srs: null, errorType: '', confusedWith: '' });
  });
  return out;
}
function hash(str) {
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}
/* What was typed against the book's answer: 'right', 'close' (a letter
   out in a word, or the number right with its unit left off) or 'wrong'.
   A number is never close: 18 is not 19. */
function norm(s) {
  return String(s || '').toLowerCase().replace(/[‒-―−]/g, '-').replace(/\s*-\s*/g, '-')
    .replace(/\bto\b/g, '-').replace(/[^a-z0-9%./\-µ² ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function numbersOf(s) { return (norm(s).match(/\d+(?:[.,]\d+)?/g) || []).map(function (x) { return x.replace(',', '.'); }); }
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  var d = [];
  for (var i = 0; i <= a.length; i++) { d[i] = [i]; }
  for (var j = 1; j <= b.length; j++) d[0][j] = j;
  for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
function singular(w) { return w.replace(/(?:es|s)$/, ''); }
function checkTyped(typed, answer) {
  var t = norm(typed), a = norm(answer);
  if (!t) return 'wrong';
  if (t === a) return 'right';
  var an = numbersOf(a);
  if (an.length) {
    var tn = numbersOf(t);
    if (tn.join('|') !== an.join('|')) return 'wrong';
    /* the numbers are right: the unit decides right or close */
    var unitA = a.replace(/[\d.,\s-]+/g, ''), unitT = t.replace(/[\d.,\s-]+/g, '');
    return !unitA || unitT === unitA || singular(unitT) === singular(unitA) ? 'right' : 'close';
  }
  if (singular(t) === singular(a)) return 'right';
  return a.length >= 5 && lev(t, a) <= 1 ? 'close' : 'wrong';
}
var TYPED_RATING = { right: 3, close: 2, wrong: 1 };

/* ── image occlusion: a figure's own label, hidden ────────────────────── */
/* figure: pdf.js's { page, box, labels: [{ text, box }] } — the text the
   book printed inside the picture. A label is asked for when the figure
   has at least OCCLUDE_MIN of them, all different; the options are it and
   three others of the same figure. k picks which label, so a figure's
   cards differ. */
var OCCLUDE_MIN = 4;
function occlusionOf(figure, k) {
  var labels = (figure && figure.labels || []).filter(function (l) {
    var t = String(l.text || '').trim();
    return t.length >= 2 && t.length <= 40 && /[A-Za-z]/.test(t);
  });
  var seen = {};
  labels = labels.filter(function (l) { var key = l.text.trim().toLowerCase(); if (seen[key]) return false; seen[key] = true; return true; });
  if (labels.length < OCCLUDE_MIN) return null;
  var i = ((k || 0) % labels.length + labels.length) % labels.length;
  var hidden = labels[i];
  var others = labels.filter(function (_, j) { return j !== i; }).slice(0, 3);
  var options = [hidden.text.trim()].concat(others.map(function (l) { return l.text.trim(); }));
  /* the right option's place, from the label, so it is not always first */
  var at = hash(hidden.text).charCodeAt(0) % options.length;
  options.splice(0, 1); options.splice(at, 0, hidden.text.trim());
  return { hidden: hidden, options: options, answer: at, mask: maskOf(figure.box, hidden.box) };
}
/* Where the label sits within the figure, as fractions of its width and
   height from the top left — pdf.js boxes count up from the bottom. A
   little padding, so no letter shows at the edge. */
function maskOf(fig, lab) {
  var w = fig[2] - fig[0], hgt = fig[3] - fig[1], pad = 2;
  var clamp = function (v) { return Math.max(0, Math.min(1, v)); };
  var left = clamp((lab[0] - pad - fig[0]) / w), right = clamp((lab[2] + pad - fig[0]) / w);
  var top = clamp((fig[3] - (lab[3] + pad)) / hgt), bottom = clamp((fig[3] - (lab[1] - pad)) / hgt);
  return { left: left, top: top, width: right - left, height: bottom - top };
}
function occlusionCards(doc, ci, figures, max) {
  var c = doc.clusters[ci], out = [];
  (figures || []).forEach(function (f, fi) {
    if (out.length >= (max == null ? 1 : max)) return;
    var o = occlusionOf(f, fi);
    if (!o) return;
    out.push({ id: doc.id + ':occlude:' + ci + ':' + hash(f.page + ':' + f.box.join(',') + ':' + o.hidden.text), docId: doc.id, source: 'occlusion', kind: 'occlusion',
      cluster: ci, title: c ? c.title : '', front: 'Which label is hidden?', options: o.options, answer: o.answer, back: o.options[o.answer],
      explain: (f.caption || 'Figure') + ' — the hidden label reads “' + o.options[o.answer] + '”.', page: f.page, figure: { page: f.page, box: f.box }, mask: o.mask,
      srs: null, errorType: '', confusedWith: '' });
  });
  return out;
}

/* ── section checks at 1, 3, 7 and 21 days ─────────────────────────────── */
var CHECK_DAYS = [1, 3, 7, 21];
var CHECK_SIZE = 3;
/* rec: { start (the day the section was first drilled), done: [days] }.
   The next check is due CHECK_DAYS[done.length] days after start; after
   the last, none. */
function nextCheck(rec) {
  if (!rec || !rec.start) return null;
  var k = (rec.done || []).length;
  return k < CHECK_DAYS.length ? addDays(rec.start, CHECK_DAYS[k]) : null;
}
/* recs: { key: rec }. The keys whose check is due today or overdue,
   most overdue first. A check missed by days is still one check, not
   several. */
function checksDue(recs, today) {
  return Object.keys(recs || {}).map(function (k) { return { key: k, rec: recs[k], due: nextCheck(recs[k]) }; })
    .filter(function (x) { return x.due && x.due <= today; })
    .sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : (a.key < b.key ? -1 : 1); });
}
/* A check taken: its day and score kept. A score under half starts the
   ladder again from today, so a section that was forgotten is checked
   again tomorrow, not in two weeks. */
function checkTaken(rec, today, score) {
  var r = { start: rec.start, done: (rec.done || []).slice(), scores: (rec.scores || []).slice() };
  r.scores.push(score);
  if (score < 0.5) { r.start = today; r.done = []; }
  else r.done.push(today);
  return r;
}
/* The questions of a check: CHECK_SIZE of the section's own, a different
   few each time (the check's number picks where to start). */
function checkQuestions(questions, n) {
  var qs = questions || [];
  if (!qs.length) return [];
  var out = [], start = ((n || 0) * CHECK_SIZE) % qs.length;
  for (var i = 0; i < Math.min(CHECK_SIZE, qs.length); i++) out.push(qs[(start + i) % qs.length]);
  return out;
}

/* ── timed practice ─────────────────────────────────────────────────────── */
/* pool: { due: [q], weak: [q], hard: [q] } — each q a multiple-choice
   question with an id. About one question a minute: half due cards, a
   third weak items, the rest each unit's hardest; a kind that runs short
   gives its places to the others. No question twice. */
var PER_MINUTE = 1;
function timedSet(pool, minutes) {
  var n = Math.max(1, Math.round((minutes || 10) * PER_MINUTE));
  var want = { due: Math.round(n / 2), weak: Math.round(n / 3) };
  want.hard = n - want.due - want.weak;
  var seen = {}, out = [];
  var take = function (list, k) {
    var got = 0;
    (list || []).forEach(function (q) {
      if (got >= k || out.length >= n || !q || seen[q.id]) return;
      seen[q.id] = true; out.push(q); got++;
    });
    return got;
  };
  var short = 0;
  ['due', 'weak', 'hard'].forEach(function (k) { short += want[k] - take(pool && pool[k], want[k]); });
  if (short > 0) ['due', 'weak', 'hard'].forEach(function (k) { take(pool && pool[k], n); });
  /* interleaved, not in blocks: due, weak and hard one after another */
  return interleaveKinds(out);
}
function interleaveKinds(qs) {
  var by = { due: [], weak: [], hard: [] };
  qs.forEach(function (q) { (by[q.kind] || by.hard).push(q); });
  var out = [];
  while (by.due.length || by.weak.length || by.hard.length) ['due', 'weak', 'hard'].forEach(function (k) { if (by[k].length) out.push(by[k].shift()); });
  return out;
}
/* history: [{ day, right, asked }]. The last seven results, oldest first,
   and whether the latest is up, down or level on the one before. */
function practiceTrend(history) {
  var h = (history || []).filter(function (x) { return x && x.asked > 0; }).slice(-7);
  var pct = h.map(function (x) { return Math.round(100 * x.right / x.asked); });
  var dir = pct.length < 2 ? 'first' : pct[pct.length - 1] > pct[pct.length - 2] ? 'up' : pct[pct.length - 1] < pct[pct.length - 2] ? 'down' : 'level';
  return { pct: pct, days: h.map(function (x) { return x.day; }), dir: dir };
}

/* ── confidence ─────────────────────────────────────────────────────────── */
/* correct: the answer was right. sure: the student said so before
   answering. The FSRS rating, whether to ask it again before this review
   ends, and whether it is a confident miss. */
function rateWith(correct, sure) {
  if (correct) return { rating: 3, again: false, hazard: false };
  return { rating: 1, again: !!sure, hazard: !!sure };
}

/* ── case vignettes, by the on-device model ─────────────────────────────── */
function vignettePrompt(title, sentences) {
  return 'Section: ' + title + '\nTextbook sentences:\n' + sentences.slice(0, 14).map(function (s) { return '- ' + s.text; }).join('\n') +
    '\n\nWrite ONE short clinical case (2 or 3 sentences, a patient and what is found) and one multiple-choice question on it. ' +
    'The correct answer must be stated in one of the sentences above. Use only facts from the sentences. 4 short options. Reply as JSON.';
}
var VIGNETTE_SCHEMA = { type: 'object', properties: { case: { type: 'string' }, question: { type: 'string' },
  options: { type: 'array', items: { type: 'string' } }, answer: { type: 'integer' } }, required: ['case', 'question', 'options', 'answer'] };
/* The model's reply as a question ground.js can hold to the section:
   { question, quote (the case), options, answer }, or null. */
function parseVignette(text) {
  var v;
  try { v = JSON.parse(String(text)); } catch (_) { return null; }
  if (!v || typeof v.case !== 'string' || typeof v.question !== 'string' || !Array.isArray(v.options) || typeof v.answer !== 'number') return null;
  var cs = v.case.trim(), q = v.question.trim();
  if (!cs || !q || v.options.length !== 4 || v.answer < 0 || v.answer > 3) return null;
  return { question: q, quote: cs.slice(0, 600), options: v.options.map(function (o) { return String(o).trim(); }), answer: v.answer };
}


/* ── a study plan to an exam date ─────────────────────────────────────────
   "My exam is on 10 October": the date, read from what was typed, and a
   plan from today to it — the sections not yet learned spread over the
   days, the last days kept for review and timed practice. It is worked out
   again each day from where you actually are, so a day missed or a
   section learned early moves it, rather than leaving it stale. */
var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function iso(y, m, d) {
  var t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}
function monthOf(w) { var i = MONTHS.indexOf(String(w).slice(0, 3).toLowerCase()); return i === -1 ? 0 : i + 1; }
/* A day and month without a year is the next one to come: this year's if
   it is today or later, else next year's. */
function nextOf(today, m, d) {
  var y = +today.slice(0, 4), a = iso(y, m, d);
  return a && a >= today ? a : iso(y + 1, m, d);
}
function parseExamDate(text, today) {
  var t = String(text || '').toLowerCase().replace(/(\d)(?:st|nd|rd|th)\b/g, '$1');
  var m;
  if ((m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(t))) return iso(+m[1], +m[2], +m[3]);
  if ((m = /\bin (\d{1,3}) (day|week|month)s?\b/.exec(t))) {
    var n = +m[1];
    if (m[2] === 'day') return addDays(today, n);
    if (m[2] === 'week') return addDays(today, 7 * n);
    /* the same day of the month, or that month's last day when it is shorter */
    var y = +today.slice(0, 4), mo = +today.slice(5, 7) + n, d = +today.slice(8, 10);
    y += Math.floor((mo - 1) / 12); mo = (mo - 1) % 12 + 1;
    for (var dd = d; dd >= 28; dd--) { var got = iso(y, mo, dd); if (got) return got; }
    return iso(y, mo, d);
  }
  if (/\btomorrow\b/.test(t)) return addDays(today, 1);
  var MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  if ((m = new RegExp('\\b(\\d{1,2}) ' + MON + '(?:,? (\\d{4}))?\\b').exec(t))) return m[3] ? iso(+m[3], monthOf(m[2]), +m[1]) : nextOf(today, monthOf(m[2]), +m[1]);
  if ((m = new RegExp('\\b' + MON + ' (\\d{1,2})(?:,? (\\d{4}))?\\b').exec(t))) return m[3] ? iso(+m[3], monthOf(m[1]), +m[2]) : nextOf(today, monthOf(m[1]), +m[2]);
  /* day first, as written in most of the world: 10/10, 3/11/2026 */
  if ((m = /\b(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{4}))?\b/.exec(t))) return m[3] ? iso(+m[3], +m[2], +m[1]) : nextOf(today, +m[2], +m[1]);
  return null;
}
/* units: [{ docId, name, sections: [{ ci, title, done }] }] in study order.
   The plan: days left (today counts; the exam day does not), the learning
   days and the review days (about a fifth, at least one when there are
   two days or more), each learning day's sections, and whether it fits —
   more sections than days is said, not hidden. */
var REVIEW_SHARE = 0.2;
function studyPlan(units, today, examDate) {
  var left = daysFrom(today, examDate);
  var todo = [];
  (units || []).forEach(function (u) {
    (u.sections || []).forEach(function (s) { if (!s.done) todo.push({ docId: u.docId, unit: u.name, ci: s.ci, title: s.title }); });
  });
  if (!(left > 0)) return { examDate: examDate, daysLeft: Math.max(0, left || 0), past: left < 0, todo: todo.length, days: [], perDay: 0, fits: todo.length === 0 };
  var review = left >= 2 ? Math.max(1, Math.round(left * REVIEW_SHARE)) : 0;
  var learnDays = Math.max(1, left - review);
  if (!todo.length) { review = left; learnDays = 0; }
  var perDay = learnDays ? Math.ceil(todo.length / learnDays) : 0;
  var days = [], k = 0;
  for (var i = 0; i < left; i++) {
    var learn = i < learnDays ? todo.slice(k, k + perDay) : [];
    k += learn.length;
    days.push({ day: addDays(today, i), learn: learn, review: i >= learnDays || !learn.length });
  }
  return { examDate: examDate, daysLeft: left, past: false, todo: todo.length, perDay: perDay, learnDays: learnDays, reviewDays: left - learnDays,
           days: days, fits: k >= todo.length, today: days[0] };
}

/* ── teach it back (the protégé effect) ───────────────────────────────────
   You explain the section in your own words; each key point of its lesson
   counts as covered when most of its content words are in what you said,
   and any number you gave that the section does not have is named — a
   wrong number said with confidence is what an examiner remembers. */
var TEACH_SHARE = 0.5;
function contentWords(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9%]+/).filter(function (w) {
    return w.length >= 4 && !TEACH_STOP[w];
  }).map(function (w) { return w.replace(/(?:ies|es|s|ed|ing)$/, ''); });
}
var TEACH_STOP = {};
('that this with from have were which their there these those about into than then when what where while also more most such very over only other some each ' +
 'because being been does done make made many much must should would could will within without upon them they your ours after before during').split(' ').forEach(function (w) { TEACH_STOP[w] = true; });
function teachBack(said, points, sectionText) {
  var have = {};
  contentWords(said).forEach(function (w) { have[w] = true; });
  var covered = [], missed = [];
  (points || []).forEach(function (p, i) {
    var ws = contentWords(p).filter(function (w, j, all) { return all.indexOf(w) === j; });
    if (!ws.length) return;
    var hit = ws.filter(function (w) { return have[w]; }).length / ws.length;
    (hit >= TEACH_SHARE ? covered : missed).push(i);
  });
  var nums = function (t) { return (String(t || '').match(/\d+(?:[.,]\d+)?/g) || []).map(function (n) { return n.replace(',', '.'); }); };
  var book = nums(sectionText);
  var wrong = nums(said).filter(function (n, i, all) { return book.indexOf(n) === -1 && all.indexOf(n) === i; });
  var n = covered.length + missed.length;
  return { covered: covered, missed: missed, wrong: wrong, score: n ? covered.length / n : 0 };
}

/* ── where each sentence of the model's answer came from ──────────────────
   kept: ground.js's sentences, each with the step numbers it cites. steps:
   the loop's [{ plan, turn }]. For each cited step, the book's section and
   page it rests on — a search's best passage, or the section a tool used. */
function claimSources(kept, steps) {
  return (kept || []).map(function (k) {
    var src = [];
    (k.cites || []).forEach(function (n) {
      var st = steps && steps[n - 1], t = st && st.turn;
      if (!t) return;
      var s = null;
      if (t.r && t.r.found && t.r.groups && t.r.groups[0] && t.r.groups[0].items[0]) {
        var it = t.r.groups[0].items[0];
        s = { step: n, title: t.found || '', page: it.page || 0 };
      } else if (t.at && t.at.sec) s = { step: n, title: t.at.sec.title, page: t.at.sec.pageStart || 0 };
      if (s) src.push(s);
    });
    return { text: k.text, cites: k.cites, sources: src };
  });
}

/* ── correcting what text recognition misread ─────────────────────────────
   A scanned page is read by text recognition, and a misread number is the
   worst kind of misread: it is what an exam asks. The reader may correct a
   paragraph of a section; the corrected text replaces the book's there,
   the section's text is rebuilt from its paragraphs, and the correction is
   recorded (which section, which paragraph, when, and what it said
   before), so it can be seen and undone. Returns a new unit; the old is
   not changed. */
function correctSegment(doc, ci, si, text, at) {
  var d = JSON.parse(JSON.stringify(doc));
  var c = d.clusters[ci], seg = c && c.segments[si];
  var t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!seg || seg.heading || seg.table || !t || t === seg.text) return null;
  (d.corrections = d.corrections || []).push({ ci: ci, si: si, at: at || '', was: seg.text, now: t });
  seg.text = t; seg.corrected = true;
  c.text = c.segments.filter(function (s) { return !s.table; }).map(function (s) { return s.text; }).join(' ');
  return d;
}
/* How sure text recognition was of a page: the mean of its words'
   confidences (0–100), and how many it was too unsure of to keep. */
var LOW_CONFIDENCE = 75;
function pageConfidence(words, minKept) {
  var ws = (words || []).filter(function (w) { return w && isFinite(w.confidence); });
  if (!ws.length) return null;
  var sum = 0, dropped = 0;
  ws.forEach(function (w) { sum += w.confidence; if (w.confidence < minKept) dropped++; });
  return { mean: Math.round(sum / ws.length), words: ws.length, dropped: dropped };
}

/* ── your notes and highlights ────────────────────────────────────────────
   Kept per section, as yours: a note (your words, never mixed with the
   book's) and the key points you marked. A marked point also becomes a
   cloze card (clozeOf), so what you chose to remember is asked for. */
function noteKey(docId, ci) { return docId + ':' + ci; }
function toggleMark(rec, text) {
  var r = { text: rec && rec.text || '', marks: (rec && rec.marks || []).slice() };
  var i = r.marks.indexOf(text);
  if (i === -1) r.marks.push(text); else r.marks.splice(i, 1);
  return r;
}
function markCard(doc, ci, text) {
  var c = doc.clusters[ci], C = coachMod();
  var x = c ? clozeOf({ text: text, page: pageOfText(c, text) }, C.frequencies(c)) : null;
  if (!x) return null;
  return { id: doc.id + ':mark:' + ci + ':' + hash(x.sentence), docId: doc.id, source: 'mark', kind: 'cloze', cluster: ci, title: c.title,
    front: x.front, back: x.answer, explain: x.sentence, page: x.page, srs: null, errorType: '', confusedWith: '' };
}
function pageOfText(c, text) {
  var probe = String(text).slice(0, 40);
  var seg = (c.segments || []).filter(function (s) { return String(s.text || '').indexOf(probe) !== -1; })[0];
  return seg ? seg.page : c.pageStart || 0;
}

/* ── a table, row by row ──────────────────────────────────────────────────
   Every cell of a table asked for in turn (coach.js makes the questions:
   "In the table, what is the <column> for <row>?"), in the table's own
   order — row by row, column by column — up to TABLE_ROUND. */
var TABLE_ROUND = 8;
function tableRound(questions) {
  return (questions || []).filter(function (q) { return q && q.kind === 'table'; }).slice(0, TABLE_ROUND);
}

/* ── the mastery map ──────────────────────────────────────────────────────
   Every section of every unit in one state, from what happened:
     new     — not drilled yet
     weak    — drilled under 80%, or its cards' recall today under 70%
     fading  — its cards' recall today between 70% and 90%
     solid   — recall 90% or better, or drilled at 80% or better with no
               card reviewed yet (nothing says it is fading)
   Recall is FSRS's for today, averaged over the section's reviewed cards. */
var SOLID = 0.9, FADING = 0.7, DRILLED_WELL = 0.8;
function masteryMap(docs, sessions, cards, today, FSRS) {
  return (docs || []).map(function (d) {
    var st = sessions && sessions[d.id];
    return { docId: d.id, name: d.name, sections: (d.clusters || []).map(function (c, i) {
      var p = st && st.per && st.per[i];
      var cs = (cards || []).filter(function (x) { return x.docId === d.id && x.cluster === i && x.srs && x.srs.stability > 0 && x.srs.last; });
      var recall = cs.length ? cs.reduce(function (a, x) { return a + FSRS.retrievability(x.srs.stability, Math.max(0, FSRS.daysBetween(x.srs.last, today))); }, 0) / cs.length : null;
      var state;
      if (!p || !p.done) state = 'new';
      else if (recall != null) state = recall >= SOLID ? 'solid' : recall >= FADING ? 'fading' : 'weak';
      else state = p.score == null || p.score >= DRILLED_WELL ? 'solid' : 'weak';
      return { ci: i, title: c.title, state: state, recall: recall == null ? null : Math.round(100 * recall) };
    }) };
  });
}

/* ── the week in numbers ──────────────────────────────────────────────────
   An activity log, a day at a time: { day: { answers, right, reviews, ms,
   misses: { title: n } } }. logActivity adds one thing done; time counts the
   gap since the last thing done, but a gap longer than IDLE_MS is a break,
   and counts as one IDLE_MS at most. weekly() is this week (today and the
   six days before) against the seven before that. */
var IDLE_MS = 3 * 60000;
function logActivity(log, day, kind, info) {
  var l = JSON.parse(JSON.stringify(log || { days: {}, last: 0 }));
  var d = l.days[day] = l.days[day] || { answers: 0, right: 0, reviews: 0, ms: 0, misses: {} };
  var now = info && info.now || 0;
  if (now && l.last) d.ms += Math.min(IDLE_MS, Math.max(0, now - l.last));
  if (now) l.last = now;
  if (kind === 'answer') {
    d.answers++; if (info.correct) d.right++; else if (info.title) d.misses[info.title] = (d.misses[info.title] || 0) + 1;
    /* where the answer was given: drill, exam, check or practice */
    if (info.source) { d.by = d.by || {}; d.by[info.source] = (d.by[info.source] || 0) + 1; }
  }
  if (kind === 'review') d.reviews++;
  /* a log of the last eight weeks is enough to compare two */
  Object.keys(l.days).forEach(function (k) { if (daysFrom(k, day) > 56) delete l.days[k]; });
  return l;
}
function weekly(log, today) {
  var sum = function (from, to) {
    var o = { answers: 0, right: 0, reviews: 0, minutes: 0, days: 0, misses: {} };
    for (var i = from; i <= to; i++) {
      var d = log && log.days && log.days[addDays(today, -i)];
      if (!d) continue;
      o.answers += d.answers; o.right += d.right; o.reviews += d.reviews; o.minutes += d.ms / 60000;
      if (d.answers || d.reviews) o.days++;
      Object.keys(d.misses || {}).forEach(function (t) { o.misses[t] = (o.misses[t] || 0) + d.misses[t]; });
    }
    o.minutes = Math.round(o.minutes);
    o.accuracy = o.answers ? Math.round(100 * o.right / o.answers) : null;
    o.weakest = Object.keys(o.misses).sort(function (a, b) { return o.misses[b] - o.misses[a] || (a < b ? -1 : 1); }).slice(0, 3);
    return o;
  };
  return { week: sum(0, 6), before: sum(7, 13) };
}

/* ── a streak that forgives one day a week ────────────────────────────────
   days: the days studied. Counted back from today (or yesterday, if today
   is not studied yet); a single missed day is bridged by a freeze, one
   per calendar week (Monday to Sunday) of the day missed. Two missed days
   in a row end the streak. Returns the count and the days frozen. */
function weekOf(iso) {
  var p = String(iso).split('-').map(Number), t = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  var dow = (t.getUTCDay() + 6) % 7;                     /* Monday 0 */
  return addDays(iso, -dow);
}
function streak(days, today) {
  var set = {};
  (days || []).forEach(function (d) { set[d] = true; });
  var d = set[today] ? today : addDays(today, -1);
  var n = 0, frozen = [], used = {};
  while (true) {
    if (set[d]) { n++; d = addDays(d, -1); continue; }
    var prev = addDays(d, -1), wk = weekOf(d);
    /* a gap inside the streak, or yesterday missed while today is still open */
    if ((n > 0 || d === addDays(today, -1)) && set[prev] && !used[wk]) { used[wk] = true; frozen.push(d); d = prev; continue; }
    break;
  }
  return { n: n, frozen: frozen };
}

/* ── the owner's plan, phases 3 and 4 ─────────────────────────────────── */

/* SOCRATIC CHAINS: "why?" asked down the section's own chain of cause and
   effect, one link at a time, the answer hidden until asked for. From the
   book's pathway (sheet.js glance: [{label}, {verb, label}, …]) when it has
   one of three steps or more; else from a lesson's mechanism, a sentence a
   step. Nothing is asked that the chain does not answer. */
/* No lookbehind: Safari before 16.4 cannot parse one (ground.js). */
function sentencesIn(t) { return String(t || '').replace(/\s+/g, ' ').trim().replace(/([.;])\s+(?=[A-Z])/g, '$1\u0000').split('\u0000').filter(function (x) { return x.length > 12; }); }
function socratic(pathway, mechanism) {
  var p = pathway || [];
  if (p.length >= 3) {
    var steps = [];
    for (var i = 1; i < p.length; i++) {
      steps.push({ ask: p[i - 1].label + ' ' + (p[i].verb || 'leads to') + ' \u2026 what?', answer: p[i].label });
    }
    steps.push({ ask: 'So: why does ' + p[0].label + ' end in ' + p[p.length - 1].label + '?',
                 answer: p.map(function (x, k) { return (k ? (x.verb || '\u2192') + ' ' : '') + x.label; }).join(' ') });
    return { source: 'book', steps: steps };
  }
  var ms = sentencesIn(mechanism);
  if (ms.length >= 2) return { source: 'lesson', steps: ms.map(function (m, k) { return { ask: k ? 'And then \u2014 what follows, and why?' : 'Where does it start?', answer: m }; }) };
  return null;
}

/* TEACH-BACK FROM THE PACK'S RUBRIC: what an explanation is scored against.
   The lesson's key points, and — when the lesson has them (a pack's) — its
   pearls and its mechanism, sentence by sentence: an explanation that
   leaves out why it happens has left something out. Each once. */
function rubricOf(points, lesson) {
  var L = lesson || {}, out = [], seen = {};
  var add = function (x) { var k = String(x.text).toLowerCase().trim(); if (k && !seen[k]) { seen[k] = true; out.push({ text: x.text, page: x.page }); } };
  (points || []).forEach(add);
  (L.pearls || []).forEach(add);
  sentencesIn(L.mechanism).forEach(function (m) { add({ text: m, page: null }); });
  return out;
}

/* EXAM CONDITIONS: a board's pace, ninety seconds a question. The clock is
   shown, never enforced — running out of time is information, not a
   penalty. */
var EXAM_PACE_S = 90;
function mss(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2); }
function examClock(startMs, nowMs, n, done) {
  var el = Math.max(0, (nowMs - startMs) / 1000), total = n * EXAM_PACE_S;
  return { elapsed: mss(el), target: mss(total), left: mss(total - el), behind: el > (done + 1) * EXAM_PACE_S, over: el > total };
}

/* THE DOCK'S CONTEXT ACTION: the one next thing on this screen, beside
   Home, Coach, Review and Settings — none while answering (a question is
   answered on the card, not the dock). */
function contextAction(state, allDone) {
  if (!state) return null;
  var c = state.per && state.per[state.section];
  switch (state.phase) {
    case 'unit': return allDone ? { id: 'exam', label: 'Exam' } : { id: 'learn', label: 'Learn' };
    case 'teach': return c && c.lesson ? (c.memorized ? { id: 'drill', label: 'Drill' } : { id: 'memorise', label: 'Memorise' }) : null;
    case 'result': return { id: 'next', label: 'Next' };
    case 'done': return { id: 'sections', label: 'Sections' };
    default: return null;
  }
}

/* SMART REVIEW ORDER: which due card first. A confident miss first —
   the most dangerous kind (the skill); then by the kind of miss, the ones
   a hook has not held yet before the ones that only need retrieving
   (E encoding, V wrong value, C confusion, N never met, R retrieval, then
   a card never missed); then the one lapsed most; then the longest
   overdue. And interleaved: no two in a row from the same section while
   another section still has a card waiting — mixing is what makes a review
   a test rather than a reread. Pure; cards are not changed. */
var TYPE_RANK = { E: 0, V: 1, C: 2, N: 3, R: 4 };
function reviewOrder(cards, today) {
  var score = function (c) {
    var due = c.srs && c.srs.due || c.dueFrom || today;
    return [c.hazard ? 0 : 1, c.errorType in TYPE_RANK ? TYPE_RANK[c.errorType] : 5, -((c.srs && c.srs.lapses) || 0), due < today ? -daysFrom(due, today) : 0];
  };
  var ranked = (cards || []).map(function (c, i) { return { c: c, k: score(c), i: i }; }).sort(function (a, b) {
    for (var j = 0; j < a.k.length; j++) if (a.k[j] !== b.k[j]) return a.k[j] - b.k[j];
    return a.i - b.i;
  });
  var out = [], last = null;
  while (ranked.length) {
    var at = 0;
    for (var k = 0; k < ranked.length; k++) { if (sectionKey(ranked[k].c) !== last) { at = k; break; } }
    var pick = ranked.splice(at, 1)[0];
    out.push(pick.c); last = sectionKey(pick.c);
  }
  return out;
}
function sectionKey(c) { return c.docId + ':' + c.cluster; }

var MemStudy = {
  correctSegment: correctSegment, LOW_CONFIDENCE: LOW_CONFIDENCE, pageConfidence: pageConfidence,
  noteKey: noteKey, toggleMark: toggleMark, markCard: markCard, TABLE_ROUND: TABLE_ROUND, tableRound: tableRound,
  SOLID: SOLID, FADING: FADING, masteryMap: masteryMap, IDLE_MS: IDLE_MS, logActivity: logActivity, weekly: weekly, weekOf: weekOf, streak: streak,
  MONTHS: MONTHS, parseExamDate: parseExamDate, REVIEW_SHARE: REVIEW_SHARE, studyPlan: studyPlan,
  TEACH_SHARE: TEACH_SHARE, teachBack: teachBack, claimSources: claimSources,
  addDays: addDays, daysFrom: daysFrom,
  socratic: socratic, rubricOf: rubricOf, TYPE_RANK: TYPE_RANK, reviewOrder: reviewOrder, EXAM_PACE_S: EXAM_PACE_S, examClock: examClock, contextAction: contextAction,
  BLANK: BLANK, NUMBER: NUMBER, CLOZE_WORDS: CLOZE_WORDS, CLOZE_PER_SECTION: CLOZE_PER_SECTION, clozeOf: clozeOf, clozeCards: clozeCards,
  checkTyped: checkTyped, TYPED_RATING: TYPED_RATING,
  OCCLUDE_MIN: OCCLUDE_MIN, occlusionOf: occlusionOf, maskOf: maskOf, occlusionCards: occlusionCards,
  CHECK_DAYS: CHECK_DAYS, CHECK_SIZE: CHECK_SIZE, nextCheck: nextCheck, checksDue: checksDue, checkTaken: checkTaken, checkQuestions: checkQuestions,
  PER_MINUTE: PER_MINUTE, timedSet: timedSet, practiceTrend: practiceTrend,
  rateWith: rateWith,
  vignettePrompt: vignettePrompt, VIGNETTE_SCHEMA: VIGNETTE_SCHEMA, parseVignette: parseVignette,
};
root.MemStudy = MemStudy;
if (typeof module !== 'undefined' && module.exports) module.exports = MemStudy;
})(typeof window !== 'undefined' ? window : this);
