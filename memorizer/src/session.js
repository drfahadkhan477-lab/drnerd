/* ═══════════════════════════════════════════════════════════════════════════
   session.js — the protocol as a state machine.

   PURE. A reducer: next(state, event) → new state, or a thrown Error naming
   the event and the phase it arrived in. The UI dispatches; it never writes
   the state itself. That is what makes the protocol's promises checkable in
   bare Node (tests/verify-memorizer-session-pure.js):

     · NO PHASE IS SKIPPED. Each cluster goes encode → recall (every prompt
       graded) → explain (graded), in that order, and an event that would
       jump ahead is refused rather than absorbed.
     · EVERY MISS BECOMES EXACTLY ONE CARD. A missed recall prompt, each gap
       in a teach-back, a missed gauntlet question — one card each, with a
       stable id, so re-dispatching cannot double it.
     · THE GAUNTLET COMES LAST. Only after every cluster's teach-back.

   The state is plain JSON so it can be saved after every step and a session
   resumed where it stopped.

   Phases: encode → recall → explain → (next cluster: encode …) → gauntlet → done
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var VERSION = 1;

function clone(x) { return JSON.parse(JSON.stringify(x)); }

function init(docId, titles) {
  if (!titles || !titles.length) throw new Error('a session needs at least one cluster');
  var per = {};
  titles.forEach(function (t, i) {
    per[i] = { points: null, mnemonic: '', flowchart: '', prompts: null, recallIdx: 0, recall: [], explain: null };
  });
  return {
    v: VERSION, docId: docId, titles: titles.slice(), cluster: 0, phase: 'encode',
    per: per, gauntlet: { questions: null, idx: 0, results: [] }, cards: [],
  };
}

function refuse(state, event, why) {
  throw new Error('event "' + (event && event.type) + '" is not valid in phase "' + state.phase +
                  '" (cluster ' + state.cluster + '): ' + why);
}

/* A cloze for a teach-back gap: the longest word past the first is hidden.
   Deterministic, so the same gap always makes the same card. */
function cloze(text) {
  var ws = String(text).split(/\s+/);
  var best = -1;
  for (var i = 1; i < ws.length; i++) {
    var bare = ws[i].replace(/[^A-Za-z0-9\-]/g, '');
    if (bare.length >= 5 && (best === -1 || bare.length > ws[best].replace(/[^A-Za-z0-9\-]/g, '').length)) best = i;
  }
  if (best === -1) return 'Complete from memory: ' + ws.slice(0, Math.ceil(ws.length / 2)).join(' ') + ' …';
  var out = ws.slice();
  out[best] = out[best].replace(/[A-Za-z0-9\-]+/, '_____');
  return out.join(' ');
}

function addCard(s, source, cluster, n, front, back, page) {
  var id = s.docId + ':' + source + ':' + cluster + ':' + n;
  for (var i = 0; i < s.cards.length; i++) if (s.cards[i].id === id) return;
  s.cards.push({ id: id, docId: s.docId, source: source, cluster: cluster, title: s.titles[cluster] || '',
                 front: front, back: back, page: page, srs: null });
}

function next(state, event) {
  var s = clone(state);
  var c = s.per[s.cluster];
  var v = event && event.value;
  switch (event && event.type) {
    case 'encoded':
      if (s.phase !== 'encode') refuse(s, event, 'encode is not the current phase');
      if (!v || !Array.isArray(v.points) || !v.points.length) refuse(s, event, 'encode returned no points');
      c.points = v.points; c.mnemonic = v.mnemonic || ''; c.flowchart = v.flowchart || '';
      return s;

    case 'toRecall':
      if (s.phase !== 'encode') refuse(s, event, 'recall follows encode');
      if (!c.points) refuse(s, event, 'this cluster has not been encoded yet');
      s.phase = 'recall';
      return s;

    case 'recallPrompts':
      if (s.phase !== 'recall') refuse(s, event, 'prompts belong to recall');
      if (c.prompts) refuse(s, event, 'this cluster already has its prompts');
      if (!v || !Array.isArray(v.prompts) || !v.prompts.length) refuse(s, event, 'recall returned no prompts');
      c.prompts = v.prompts; c.recallIdx = 0; c.recall = [];
      return s;

    case 'recallGraded': {
      if (s.phase !== 'recall') refuse(s, event, 'a recall grade needs the recall phase');
      if (!c.prompts) refuse(s, event, 'no prompts to grade against');
      if (!v || typeof v.correct !== 'boolean') refuse(s, event, 'a grade must say correct true or false');
      var p = c.prompts[c.recallIdx];
      c.recall.push({ correct: v.correct, answer: event.answer || '', missing: v.missing || [],
                      misconception: v.misconception || '', feedback: v.feedback || '' });
      if (!v.correct) addCard(s, 'recall', s.cluster, c.recallIdx, p.question, p.answer, p.page);
      c.recallIdx++;
      if (c.recallIdx >= c.prompts.length) s.phase = 'explain';
      return s;
    }

    case 'explainGraded':
      if (s.phase !== 'explain') refuse(s, event, 'a teach-back grade needs the explain phase');
      if (!v || typeof v.score !== 'number') refuse(s, event, 'a teach-back grade needs a score');
      c.explain = { score: v.score, gaps: v.gaps || [], misconceptions: v.misconceptions || [],
                    feedback: v.feedback || '', said: event.explanation || '' };
      (v.gaps || []).forEach(function (g, i) {
        addCard(s, 'explain', s.cluster, i, cloze(g.point), g.point, g.page);
      });
      if (s.cluster + 1 < s.titles.length) { s.cluster++; s.phase = 'encode'; }
      else s.phase = 'gauntlet';
      return s;

    case 'gauntletReady': {
      if (s.phase !== 'gauntlet') refuse(s, event, 'the gauntlet comes after every cluster');
      if (s.gauntlet.questions) refuse(s, event, 'the gauntlet already has its questions');
      if (!v || !Array.isArray(v.questions) || !v.questions.length) refuse(s, event, 'the gauntlet returned no questions');
      var n = s.titles.length;
      /* A question that names a cluster that does not exist is kept, and
         graded against the weakest cluster instead — see gauntletCluster(). */
      s.gauntlet.questions = v.questions.map(function (q) {
        var ok = typeof q.cluster === 'number' && q.cluster >= 0 && q.cluster < n && Math.floor(q.cluster) === q.cluster;
        return { question: q.question, answer: q.answer, page: q.page, cluster: ok ? q.cluster : null };
      });
      s.gauntlet.idx = 0; s.gauntlet.results = [];
      return s;
    }

    case 'gauntletGraded': {
      if (s.phase !== 'gauntlet') refuse(s, event, 'a gauntlet grade needs the gauntlet phase');
      if (!s.gauntlet.questions) refuse(s, event, 'no gauntlet questions yet');
      if (!v || typeof v.correct !== 'boolean') refuse(s, event, 'a grade must say correct true or false');
      var g = s.gauntlet, q = g.questions[g.idx];
      g.results.push({ correct: v.correct, answer: event.answer || '', missing: v.missing || [],
                       misconception: v.misconception || '', feedback: v.feedback || '' });
      var qc = q.cluster == null ? gauntletCluster(s, g.idx) : q.cluster;
      if (!v.correct) addCard(s, 'gauntlet', qc, g.idx, q.question, q.answer, q.page);
      g.idx++;
      if (g.idx >= g.questions.length) s.phase = 'done';
      return s;
    }

    default:
      refuse(s, event, 'unknown event');
  }
}

/* 0..1 per cluster: half recall accuracy, half teach-back score. A cluster
   not yet reached has no mastery (null), which is different from zero. */
function mastery(state, i) {
  var c = state.per[i];
  if (!c || !c.explain) return null;
  var rec = c.recall.length ? c.recall.filter(function (r) { return r.correct; }).length / c.recall.length : 0;
  return 0.5 * rec + 0.5 * Math.max(0, Math.min(100, c.explain.score)) / 100;
}

/* The clusters the gauntlet leans on: lowest mastery first, ties to the
   earlier cluster. */
function weakest(state, n) {
  var idx = state.titles.map(function (_, i) { return i; });
  idx.sort(function (a, b) {
    var ma = mastery(state, a), mb = mastery(state, b);
    ma = ma == null ? 0 : ma; mb = mb == null ? 0 : mb;
    return ma - mb || a - b;
  });
  return idx.slice(0, Math.max(1, Math.min(n || 2, idx.length)));
}

function gauntletCluster(state, qi) {
  var w = weakest(state, 2);
  return w[qi % w.length];
}

function gauntletSize(state) { return Math.min(10, Math.max(5, state.titles.length * 2)); }

/* ── review ──────────────────────────────────────────────────────────────── */
function isDue(card, today) { return !card.srs || !card.srs.due || card.srs.due <= today; }
function dueCards(cards, today) { return (cards || []).filter(function (c) { return isDue(c, today); }); }
/* FSRS is passed in (src/core/fsrs.js, shared with Systole) rather than
   reached for, so this stays pure and the test can hand it the real one. */
function review(card, rating, today, FSRS) {
  var out = clone(card);
  out.srs = FSRS.update(card.srs, rating, today);
  return out;
}

var MemSession = {
  VERSION: VERSION, init: init, next: next, cloze: cloze, mastery: mastery, weakest: weakest,
  gauntletCluster: gauntletCluster, gauntletSize: gauntletSize, isDue: isDue, dueCards: dueCards, review: review,
};
root.MemSession = MemSession;
if (typeof module !== 'undefined' && module.exports) module.exports = MemSession;
})(typeof window !== 'undefined' ? window : this);
