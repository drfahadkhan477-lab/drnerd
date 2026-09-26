/* ═══════════════════════════════════════════════════════════════════════════
   ground.js — what an on-device model may say, held to the book.

   PURE. A small model on an iPad (llm.js) writes fluently and invents
   freely: a threshold that is not in the book, a drug the section never
   names, a "correct" option the text does not support. Nothing it writes
   reaches the student until it has passed these checks against the book's
   own text, and what fails is dropped, never shown:

     · NO NEW NUMBERS. Every number in a model's sentence must be in the
       passages it rests on — doses, thresholds and percentages are exactly
       what a small model makes up.
     · NO NEW NAMED THINGS. Every disease, scenario, test and treatment it
       names (ask.js's vocabulary) must be named in those passages too.
     · MOSTLY THE BOOK'S WORDS. A summary sentence must share most of its
       content words with the passages it cites; an explanation in plain
       words, fewer — but never a new number or name.
     · A QUESTION'S ANSWER IS IN THE BOOK. The correct option must be found,
       word for word in its content, in one sentence of the section that
       also speaks to the question; no wrong option may be supported by that
       same sentence; and the explanation shown is that sentence, verbatim,
       with its page — not the model's words.
     · WITH A STUDY PACK, ONLY WORDS. Claude's pack is the model's notes; it
       may ask a pack question in new words (its answer, options and
       reasons stay the pack's) and explain a mistake from the pack's
       reasons — each held to the notes and the book (variant, missExplain).

   tests/verify-memorizer-ground-pure.js holds every rule.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var Ask = root.MemAsk || (typeof require === 'function' ? require('./ask.js') : null);
var Prompts = root.MemPrompts || (typeof require === 'function' ? require('./prompts.js') : null);

/* Share of a summary sentence's content words that must be in its cited
   passages. A plain-words explanation has no share floor — new words are
   its point; a 35% floor, tried first, dropped every honest one ("think of
   the valve as a door that has become stiff") — but like every claim it
   must share at least one word with the book, and add no number or name. */
var SUMMARY_SHARE = 0.6;

function numbersIn(text) {
  return (String(text || '').match(/\d+(?:[.,]\d+)*/g) || []).map(function (n) { return n.replace(/,(?=\d{3}\b)/g, ''); });
}
function entryIds(text) { return Ask.entriesIn(text).map(function (e) { return e.kind + ':' + e.id; }); }
function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

/* One claim against its sources. Returns '' when it may be shown, else why
   not — the reason is kept for the tests and for a count on screen. */
function claimError(text, sources, share) {
  var src = [].concat(sources).join(' ');
  var have = numbersIn(src);
  var newNum = numbersIn(text).filter(function (n) { return have.indexOf(n) === -1; });
  if (newNum.length) return 'a number not in the book: ' + newNum[0];
  var named = entryIds(src);
  var newName = uniq(entryIds(text)).filter(function (id) { return named.indexOf(id) === -1; });
  if (newName.length) return 'names something the book passage does not: ' + newName[0].split(':')[1];
  var words = uniq(Ask.terms(text).filter(function (w) { return w.length >= 4; }));
  if (!words.length) return 'says nothing';
  var srcWords = {};
  Ask.terms(src).forEach(function (w) { srcWords[w] = true; });
  var inSrc = words.filter(function (w) { return srcWords[w]; }).length;
  if (!inSrc) return 'nothing in it is the book\u2019s';
  if (inSrc / words.length < share) return 'too little of it is the book’s: ' + Math.round(100 * inSrc / words.length) + '%';
  return '';
}

/* Split after . ! or ? before a capital, digit, quote or bracket. No
   lookbehind: Safari before 16.4 cannot parse one, and this app supports
   older iPads. */
function sentencesOf(text) {
  var s = String(text || '').replace(/\s+/g, ' ').trim(), out = [], re = /[.!?]\s+(?=[A-Z0-9"(])/g, last = 0, m;
  while ((m = re.exec(s))) { out.push(s.slice(last, m.index + 1)); last = re.lastIndex; }
  out.push(s.slice(last));
  return out.filter(Boolean);
}

/* A model's summary of numbered passages: each sentence must cite at least
   one of them ("[2]") and pass against what it cites. Returns the sentences
   kept, citations taken out and listed, and how many were dropped. */
function summary(text, passages) {
  var byN = {};
  (passages || []).forEach(function (p, i) { byN[i + 1] = p.text; });
  var kept = [], dropped = [];
  sentencesOf(text).forEach(function (s) {
    var cites = uniq((s.match(/\[(\d+)\]/g) || []).map(function (m) { return +m.slice(1, -1); }));
    var clean = s.replace(/\s*\[\d+\](?:\s*,?\s*\[\d+\])*/g, '').replace(/\s+([.,;:!?])/g, '$1').trim();
    if (!cites.length) { dropped.push({ text: clean, why: 'cites no passage' }); return; }
    if (cites.some(function (n) { return !byN[n]; })) { dropped.push({ text: clean, why: 'cites a passage that was not given' }); return; }
    var err = claimError(clean, cites.map(function (n) { return byN[n]; }), SUMMARY_SHARE);
    if (err) dropped.push({ text: clean, why: err }); else kept.push({ text: clean, cites: cites });
  });
  return { kept: kept, dropped: dropped };
}

/* Plain words, about a section: sentences that add no number and name
   nothing the section does not. */
function plain(text, sectionText) {
  var kept = [], dropped = [];
  sentencesOf(text).forEach(function (s) {
    var err = claimError(s, [sectionText], 0);
    if (err) dropped.push({ text: s, why: err }); else kept.push(s);
  });
  return { kept: kept, dropped: dropped };
}

/* An analogy compares a mechanism to everyday life: it may not carry a
   number at all, nor name any disease, test or drug the section does not. */
function analogyError(text, sectionText) {
  if (numbersIn(text).length) return 'an analogy may not carry a number';
  var named = entryIds(sectionText);
  var newName = uniq(entryIds(text)).filter(function (id) { return named.indexOf(id) === -1; });
  return newName.length ? 'names something the section does not: ' + newName[0].split(':')[1] : '';
}

/* ── a model's multiple-choice question, held to its section ───────────── */
function contentTerms(text) { return uniq(Ask.terms(text).filter(function (w) { return w.length >= 3; })); }
function supports(sentTerms, text) {
  var t = contentTerms(text);
  return t.length > 0 && t.every(function (w) { return sentTerms[w]; });
}
/* sentences: the section's [{ text, page }]. Returns { q, why }: q is the
   question with its explanation replaced by the book's sentence (and its
   page), or null with the reason. */
function question(q, sentences) {
  var err = Prompts.mcqError(q, 'q');
  if (err) return { q: null, why: err };
  var stemErr = claimError(q.question, sentences.map(function (s) { return s.text; }), 0);
  if (stemErr && !/too little|says nothing|nothing in it/.test(stemErr)) return { q: null, why: 'the question ' + stemErr };
  var right = q.options[q.answer];
  var qTerms = contentTerms(q.question);
  var best = null;
  sentences.forEach(function (s) {
    var st = {};
    Ask.terms(s.text).forEach(function (w) { st[w] = true; });
    if (!supports(st, right)) return;
    var about = qTerms.filter(function (w) { return st[w]; }).length;
    if (!about) return;
    if (!best || about > best.about) best = { s: s, st: st, about: about };
  });
  if (!best) return { q: null, why: 'the answer is not in the section' };
  var alsoTrue = q.options.filter(function (o, i) { return i !== q.answer && supports(best.st, o); });
  if (alsoTrue.length) return { q: null, why: 'a wrong option is supported by the same sentence: ' + alsoTrue[0] };
  return { q: { question: q.question, quote: q.quote || '', options: q.options.slice(), answer: q.answer, explain: best.s.text, page: best.s.page, by: 'ai' }, why: '' };
}

/* ── the study pack as the model's notes ────────────────────────────────────
   CLAUDE WRITES, THE DEVICE TUTORS. A pack (pack.js) is Claude's work on
   the whole chapter, checked against the book when it was imported. The
   small model on the iPad does not write facts; it is handed the pack's
   notes and asked only to put them another way — a question asked in new
   words, a mistake explained — and what it writes is held to those notes
   and to the book before it is shown. */

/* The section's pack as notes for the model: what passed the book check
   and nothing flagged, the most useful first, cut to `words`. */
var CONTEXT_WORDS = 180;
function packContext(sec, words) {
  if (!sec || !sec.lesson) return '';
  var L = sec.lesson, lines = [], clean = function (x) { return x && !x.flag; };
  if (L.overview && !(L.flags && L.flags.overview)) lines.push(L.overview);
  if (L.mechanism && !(L.flags && L.flags.mechanism)) lines.push(L.mechanism);
  (L.points || []).filter(clean).forEach(function (p) { lines.push(p.text); });
  (L.pearls || []).filter(clean).forEach(function (p) { lines.push(p.text); });
  (L.distinctions || []).filter(clean).forEach(function (d) { lines.push(d.a + ' vs ' + d.b + ': ' + d.how); });
  var out = [], n = 0, max = words || CONTEXT_WORDS;
  for (var i = 0; i < lines.length; i++) {
    var w = String(lines[i]).split(/\s+/).filter(Boolean);
    if (n + w.length > max) break;
    out.push('- ' + w.join(' ')); n += w.length;
  }
  return out.join('\n');
}

/* A negation turns what a question asks for inside out ("which is NOT"):
   read from the raw words, as Ask.terms drops "not" as a stop word. */
var NEGATION = /\b(?:not|except|least|false|incorrect|never|untrue)\b/i;
function wordsOf(text) { return uniq(Ask.terms(text).filter(function (w) { return w.length >= 3; })); }
/* Every option moves: a rotation by k in 1..n-1, from the new wording, so
   the same wording is always laid out the same way. */
function rotation(text, n) {
  var h = 0, s = String(text || '');
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return n > 1 ? 1 + h % (n - 1) : 0;
}

/* A pack question asked in new words. The model writes only the stem; the
   options, the answer, the explanation and every option's reason stay the
   pack's (the options turned so none keeps its place). The stem is held to:
     · the notes and the book — no new number, no new named thing;
     · the same question — at least half of the original's key terms (those
       it shares with its answer and explanation) still in it, and a "not"
       or "except" in it exactly when the original has one;
     · no giveaway — the answer's own words or numbers are not in it;
     · new words — not the original again.
   sources: the pack's notes and the section's text. Returns { q, why }. */
function variant(q, stem, sources) {
  var s = String(stem || '').replace(/\s+/g, ' ').trim();
  if (s.length < 12) return { q: null, why: 'too short to be a question' };
  if (s.length > 400) return { q: null, why: 'too long for a question' };
  var norm = function (t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); };
  if (norm(s) === norm(q.question)) return { q: null, why: 'the same words as the original' };
  var err = claimError(s, [q.question, q.explain].concat(sources || []), 0);
  if (err) return { q: null, why: 'the question ' + err };
  if (NEGATION.test(s) !== NEGATION.test(q.question)) return { q: null, why: NEGATION.test(q.question) ? 'it dropped the original’s "not"' : 'it added a "not" the original does not have' };
  var right = q.options[q.answer], stemW = wordsOf(q.question), newW = wordsOf(s);
  var tie = wordsOf(right + ' ' + q.explain), key = stemW.filter(function (w) { return tie.indexOf(w) !== -1; });
  if (!key.length) key = stemW;
  var kept = key.filter(function (w) { return newW.indexOf(w) !== -1; }).length;
  if (kept * 2 < key.length) return { q: null, why: 'it no longer asks the same thing (' + kept + ' of ' + key.length + ' key terms kept)' };
  var giveW = wordsOf(right).filter(function (w) { return stemW.indexOf(w) === -1; });
  var giveN = numbersIn(right).filter(function (n) { return numbersIn(q.question).indexOf(n) === -1; });
  if (giveN.some(function (n) { return numbersIn(s).indexOf(n) !== -1; }) ||
      (giveW.length && giveW.every(function (w) { return newW.indexOf(w) !== -1; }))) return { q: null, why: 'it gives the answer away' };
  var n = q.options.length, k = rotation(s, n), map = [], options = [], why = [];
  for (var i = 0; i < n; i++) { map[(i + k) % n] = i; }
  map.forEach(function (from, at) { options[at] = q.options[from]; why[at] = (q.why || [])[from] || ''; });
  return { q: { question: s, quote: '', options: options, answer: (q.answer + k) % n, explain: q.explain, page: q.page,
                why: q.why && q.why.length === n ? why : [], trap: q.trap || '', flag: q.flag || '', by: q.by, reworded: true, map: map }, why: '' };
}

/* A mistake explained in the model's words, from the pack's reasons. Each
   sentence is held as plain words are (no new number or name; at least one
   word the sources have), and one that calls the option chosen right is
   dropped; what is kept must say what the answer is. chosen: an option's
   index, or below 0 for "not sure". Returns { kept, dropped, why }. */
var ENDORSE = /\b(?:is|was|are)\s+(?:the\s+)?(?:correct|right|best)\b|\bcorrect answer\b|\byou were right\b/i;
function missExplain(text, q, chosen, sources) {
  var src = [q.question, q.explain, q.trap || '', (q.why || []).join(' '), q.options[q.answer]].concat(sources || []);
  /* an option is known by its words and its numbers: "8 mmHg" and
     "greater than 18 mmHg" share a word and differ by their number */
  var tokens = function (t) { return wordsOf(t).concat(numbersIn(t)); };
  var mine = chosen >= 0 ? q.options[chosen] : '', rightW = tokens(q.options[q.answer]), mineW = tokens(mine).filter(function (w) { return rightW.indexOf(w) === -1; });
  var hasAll = function (s, ws) { var t = tokens(s); return ws.length > 0 && ws.every(function (w) { return t.indexOf(w) !== -1; }); };
  var kept = [], dropped = [];
  sentencesOf(text).forEach(function (s) {
    var err = claimError(s, src, 0);
    if (!err && mine && hasAll(s, mineW) && !hasAll(s, rightW) && ENDORSE.test(s) && !NEGATION.test(s)) err = 'it calls the option chosen right';
    if (err) dropped.push({ text: s, why: err }); else kept.push(s);
  });
  var names = kept.some(function (s) { return hasAll(s, rightW); });
  if (kept.length && !names) return { kept: [], dropped: dropped.concat(kept.map(function (s) { return { text: s, why: 'it never says what the answer is' }; })), why: 'it never says what the answer is' };
  return { kept: kept, dropped: dropped, why: kept.length ? '' : (dropped[0] ? dropped[0].why : 'it said nothing') };
}

/* A follow-up asked from the pack's notes, Socratic: a "why" or "how"
   question and its answer. The answer is held as a summary sentence is —
   mostly the notes' own words, no number or named thing they lack — as it
   is shown as the answer; the question may name nothing the notes and the
   book lack, must be a question, must not hold its own answer, and must
   not be one already asked. Returns { q: { question, answer }, why }. */
function followUp(question, answer, notes, sources, asked) {
  var qs = String(question || '').replace(/\s+/g, ' ').trim(), an = String(answer || '').replace(/\s+/g, ' ').trim();
  if (qs.length < 10 || qs.length > 250 || !/\?$/.test(qs)) return { q: null, why: 'it is not a question' };
  if (an.length < 10) return { q: null, why: 'it has no answer' };
  var norm = function (t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); };
  if ((asked || []).some(function (a) { return norm(a) === norm(qs); })) return { q: null, why: 'it was asked already' };
  var err = claimError(qs, [notes].concat(sources || []), 0);
  if (err && !/too little|says nothing/.test(err)) return { q: null, why: 'the question ' + err };
  var aerr = claimError(an, [notes], SUMMARY_SHARE);
  /* held to the notes, and said so: a number the book has but the notes lack is still not the notes' */
  if (aerr) return { q: null, why: 'the answer ' + aerr.replace('the book passage does not', 'the notes do not').replace(/the book\u2019s|the book's/, 'the notes\u2019').replace('the book', 'the notes') };
  var qw = wordsOf(qs);
  if (!wordsOf(an).some(function (w) { return qw.indexOf(w) === -1; })) return { q: null, why: 'the question holds its own answer' };
  return { q: { question: qs, answer: an }, why: '' };
}

var MemGround = { SUMMARY_SHARE: SUMMARY_SHARE, numbersIn: numbersIn, claimError: claimError, sentencesOf: sentencesOf,
                  summary: summary, plain: plain, analogyError: analogyError, question: question,
                  CONTEXT_WORDS: CONTEXT_WORDS, packContext: packContext, variant: variant, missExplain: missExplain, followUp: followUp };
root.MemGround = MemGround;
if (typeof module !== 'undefined' && module.exports) module.exports = MemGround;
})(typeof window !== 'undefined' ? window : this);
