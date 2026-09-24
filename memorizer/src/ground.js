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

var MemGround = { SUMMARY_SHARE: SUMMARY_SHARE, numbersIn: numbersIn, claimError: claimError, sentencesOf: sentencesOf,
                  summary: summary, plain: plain, analogyError: analogyError, question: question };
root.MemGround = MemGround;
if (typeof module !== 'undefined' && module.exports) module.exports = MemGround;
})(typeof window !== 'undefined' ? window : this);
