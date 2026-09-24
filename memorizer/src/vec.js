/* ═══════════════════════════════════════════════════════════════════════════
   vec.js — search by meaning, merged with search by words.

   PURE. An embedding model (llm.js, snowflake-arctic-embed-s through WebLLM,
   on the device) turns text into a vector; texts that mean the same point
   the same way, whatever words they use — "fainting on exertion" and
   "exertional syncope". This file does the arithmetic: cosine similarity,
   the best sections for a question, the best sentences within them, and
   the merge with ask.js's word search by reciprocal-rank fusion, so each
   finds what the other misses and neither's scores need calibrating
   against the other's.

   One vector per SECTION is stored (a whole book's sentences would be tens
   of megabytes); at question time only the best sections' sentences are
   embedded. A sentence found by meaning alone is still the book's sentence,
   word for word, with its page — only how it was found differs.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

/* Arctic-embed asks for this before a question, and nothing before a
   passage. */
var QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
/* Sections whose sentences are looked at, per question. */
var TOP_SECTIONS = 4;
/* A sentence found by meaning alone must be at least this similar, and
   within MARGIN of the best one: below that, "not found" is the honest
   answer, not the least-bad sentence.
   MEASURED, on a small sample, with the real arctic-embed-s (fp32, CLS
   pooling, normalised) run in Node: the right passage scored 0.504-0.743
   for four medical questions; the best passage for two off-topic questions
   ("what is the capital of france", "how do I bake bread") 0.435-0.461. The
   first guess, 0.45, let the capital of France through. 0.48 sits in that
   gap — a narrow one, from seven passages and six questions, and to be
   re-measured on the owner's book. */
var MIN_COS = 0.48;
var MARGIN = 0.08;
/* Reciprocal-rank fusion's constant: the usual 60. */
var RRF_K = 60;

function dot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function norm(a) { return Math.sqrt(dot(a, a)); }
function cosine(a, b) { var n = norm(a) * norm(b); return n ? dot(a, b) / n : 0; }

/* The k best of `vecs` for `q`: [{ i, cos }], best first, ties to the
   earlier. */
function top(q, vecs, k) {
  return vecs.map(function (v, i) { return { i: i, cos: v ? cosine(q, v) : -1 }; })
    .sort(function (a, b) { return b.cos - a.cos || a.i - b.i; }).slice(0, k);
}

/* Sentences found by meaning: those at least MIN_COS similar and within
   MARGIN of the best. items: [{ key, cos }]. */
function keep(items) {
  if (!items.length) return [];
  var best = Math.max.apply(null, items.map(function (x) { return x.cos; }));
  return items.filter(function (x) { return x.cos >= MIN_COS && x.cos >= best - MARGIN; })
    .sort(function (a, b) { return b.cos - a.cos || (a.key < b.key ? -1 : 1); });
}

/* Two rankings of keys, merged: each key scores 1/(RRF_K + rank) in each
   list it appears in. Returns keys, best first. */
function fuse(lists) {
  var score = {}, first = {};
  lists.forEach(function (list, li) {
    list.forEach(function (key, r) {
      score[key] = (score[key] || 0) + 1 / (RRF_K + r + 1);
      if (!(key in first)) first[key] = li * 1e6 + r;
    });
  });
  return Object.keys(score).sort(function (a, b) { return score[b] - score[a] || first[a] - first[b]; });
}

var MemVec = { QUERY_PREFIX: QUERY_PREFIX, TOP_SECTIONS: TOP_SECTIONS, MIN_COS: MIN_COS, MARGIN: MARGIN, RRF_K: RRF_K,
               cosine: cosine, top: top, keep: keep, fuse: fuse };
root.MemVec = MemVec;
if (typeof module !== 'undefined' && module.exports) module.exports = MemVec;
})(typeof window !== 'undefined' ? window : this);
