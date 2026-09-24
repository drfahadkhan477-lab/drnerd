/* ═══════════════════════════════════════════════════════════════════════════
   session.js — the protocol as a state machine.

   PURE. A reducer: next(state, event) → new state, or a thrown Error naming
   the event and the phase it arrived in. The UI dispatches; it never writes
   the state itself. That is what makes the protocol's promises checkable in
   bare Node (tests/verify-memorizer-session-pure.js):

     · TEACH, THEN DRILL. A section's drill cannot start until its lesson has
       been given; an event that would jump ahead is refused, not absorbed.
     · A MISS COMES BACK. A question answered wrong on the first pass is asked
       again at the end of the same drill — once — the way a teacher returns
       to the thing you got wrong before letting you go. Only the first pass
       counts toward the score.
     · EVERY MISS BECOMES EXACTLY ONE REVIEW CARD, with an id from its
       question, so retaking a drill or re-dispatching cannot double it.
     · THE EXAM COMES LAST. Only after every section's drill.

   Grading is here, not in a coach: a multiple-choice answer is right when
   the option chosen is the option marked right. Nothing to interpret.

   The state is plain JSON so it can be saved after every step and resumed.
   Version 2; a version-1 session (the old recall and teach-back protocol)
   is not resumed — openDoc starts a fresh one, and its cards are kept.

   Phases: unit → teach → drill → result → (unit | another section) … → exam → done → unit
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var VERSION = 2;

function clone(x) { return JSON.parse(JSON.stringify(x)); }

function freshSection() {
  return { lesson: null, quiz: null, order: [], pos: 0, answers: [], score: null, best: null, done: false, attempts: 0 };
}

function init(docId, titles) {
  if (!titles || !titles.length) throw new Error('a session needs at least one section');
  var per = {};
  titles.forEach(function (t, i) { per[i] = freshSection(); });
  return {
    v: VERSION, docId: docId, titles: titles.slice(), section: 0, phase: 'unit',
    per: per, exam: { questions: null, order: [], pos: 0, results: [], score: null }, cards: [],
  };
}

function refuse(state, event, why) {
  throw new Error('event "' + (event && event.type) + '" is not valid in phase "' + state.phase +
                  '" (section ' + state.section + '): ' + why);
}

function hash(str) {
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}

function addCard(s, source, section, q) {
  var id = s.docId + ':' + source + ':' + section + ':' + hash(q.question + '|' + (q.quote || ''));
  for (var i = 0; i < s.cards.length; i++) if (s.cards[i].id === id) return;
  s.cards.push({ id: id, docId: s.docId, source: source, cluster: section, title: s.titles[section] || '',
                 front: q.question, quote: q.quote || '', options: q.options.slice(), answer: q.answer,
                 back: q.options[q.answer], explain: q.explain || '', page: q.page, srs: null });
}

function validQuestions(v) {
  return v && Array.isArray(v.questions) && v.questions.length && v.questions.every(function (q) {
    return q && Array.isArray(q.options) && q.options.length >= 2 && typeof q.answer === 'number' &&
           q.answer >= 0 && q.answer < q.options.length && Math.floor(q.answer) === q.answer;
  });
}

/* One answer in a drill or the exam: `run` is { order, pos, … } over
   `questions`. Returns whether it was right and whether it was a first try. */
function answer(run, questions, choice) {
  var qi = run.order[run.pos];
  var q = questions[qi];
  var first = run.order.indexOf(qi) === run.pos;
  var correct = choice === q.answer;
  return { qi: qi, q: q, first: first, correct: correct };
}

function allDone(s) {
  return s.titles.every(function (_, i) { return s.per[i].done; });
}

function next(state, event) {
  var s = clone(state);
  var v = event && event.value;
  var c = s.per[s.section];
  switch (event && event.type) {
    case 'open': {
      var i = event.section;
      if (s.phase === 'exam') refuse(s, event, 'finish or leave the exam first');
      if (typeof i !== 'number' || !s.per[i]) refuse(s, event, 'no section ' + i);
      s.section = i; s.phase = 'teach';
      return s;
    }

    /* Back to the unit's page from anywhere, the exam's result included —
       a finished unit is one whose exam has a score, not a phase to be
       stuck in (the first version kept 'done' here, and "Back to sections"
       redrew the result). An exam left part-way resumes where it stopped:
       toExam keeps its questions until it is finished. */
    case 'toUnit':
      s.phase = 'unit';
      return s;

    case 'taught':
      if (s.phase !== 'teach') refuse(s, event, 'teach is not the current phase');
      if (!v || !Array.isArray(v.points) || !v.points.length) refuse(s, event, 'the lesson has no points');
      c.lesson = v;
      return s;

    /* MEMORIZE, between the lesson and the drill, at the owner's request:
       "make sure I have learnt and memorised it before the drill". The
       section's recall cards (coach.js recallCards: each point with its
       key term hidden, each number, each mnemonic, the chain) are gone
       through with the answer hidden; the reader says whether they knew
       it, and one not known comes back at the end, until every card has
       been known once. Only then does the drill open. A section memorised
       once is not gated again. `value.cards` is how many there are; none
       means there is nothing to hold back. */
    case 'toMemorize':
      if (s.phase !== 'teach') refuse(s, event, 'memorising follows the lesson');
      if (!c.lesson) refuse(s, event, 'this section has not been taught yet');
      var n = v && typeof v.cards === 'number' && v.cards >= 0 ? Math.floor(v.cards) : -1;
      if (n < 0) refuse(s, event, 'how many cards there are to memorise');
      if (!n) { c.memorized = true; return s; }
      s.phase = 'memorize';
      c.memo = { order: Array.apply(null, Array(n)).map(function (_, k) { return k; }), pos: 0, misses: 0 };
      return s;

    case 'recalled':
      if (s.phase !== 'memorize') refuse(s, event, 'a card is recalled while memorising');
      if (typeof event.knew !== 'boolean') refuse(s, event, 'knew it, or not yet');
      if (!event.knew) { c.memo.order.push(c.memo.order[c.memo.pos]); c.memo.misses++; }
      c.memo.pos++;
      if (c.memo.pos >= c.memo.order.length) { c.memorized = true; s.phase = 'teach'; return next(s, { type: 'toDrill' }); }
      return s;

    case 'toDrill':
      if (s.phase !== 'teach') refuse(s, event, 'the drill follows the lesson');
      if (!c.lesson) refuse(s, event, 'this section has not been taught yet');
      if (!c.memorized) refuse(s, event, 'memorise the section before its drill');
      s.phase = 'drill';
      c.order = c.quiz ? c.quiz.questions.map(function (_, k) { return k; }) : [];
      c.pos = 0; c.answers = [];
      return s;

    case 'quizReady':
      if (s.phase !== 'drill') refuse(s, event, 'questions belong to the drill');
      if (c.quiz) refuse(s, event, 'this section already has its questions');
      /* A section too short to ask anything of (the built-in coach found
         nothing): taught, and done, with no score — it does not hold the
         unit's exam hostage. */
      if (v && Array.isArray(v.questions) && !v.questions.length) {
        c.quiz = { questions: [] }; c.order = []; c.pos = 0; c.answers = [];
        c.score = null; c.done = true; c.attempts++;
        s.phase = 'result';
        return s;
      }
      if (!validQuestions(v)) refuse(s, event, 'the drill has no usable questions');
      c.quiz = { questions: v.questions };
      c.order = v.questions.map(function (_, k) { return k; });
      c.pos = 0; c.answers = [];
      return s;

    case 'answered': {
      if (s.phase !== 'drill') refuse(s, event, 'an answer needs the drill');
      if (!c.quiz) refuse(s, event, 'no questions to answer');
      if (typeof event.choice !== 'number') refuse(s, event, 'an answer is the index of an option');
      var a = answer(c, c.quiz.questions, event.choice);
      c.answers.push({ q: a.qi, choice: event.choice, correct: a.correct, first: a.first });
      if (!a.correct && a.first) {
        addCard(s, 'drill', s.section, a.q);
        c.order.push(a.qi);                        /* asked again, once, at the end */
      }
      c.pos++;
      if (c.pos >= c.order.length) {
        var firsts = c.answers.filter(function (x) { return x.first; });
        c.score = firsts.length ? firsts.filter(function (x) { return x.correct; }).length / firsts.length : 0;
        c.best = c.best == null ? c.score : Math.max(c.best, c.score);
        c.done = true; c.attempts++;
        s.phase = 'result';
      }
      return s;
    }

    case 'redrill':
      if (s.phase !== 'result') refuse(s, event, 'a drill is retaken from its result');
      if (!c.quiz.questions.length) refuse(s, event, 'this section has nothing to drill');
      s.phase = 'drill';
      c.order = c.quiz.questions.map(function (_, k) { return k; });
      c.pos = 0; c.answers = [];
      return s;

    case 'toExam':
      if (s.phase === 'drill' || s.phase === 'exam') refuse(s, event, 'finish the drill first');
      if (!allDone(s)) refuse(s, event, 'the exam comes after every section’s drill');
      s.phase = 'exam';
      if (s.exam.score != null) s.exam = { questions: null, order: [], pos: 0, results: [], score: null };
      return s;

    case 'examReady':
      if (s.phase !== 'exam') refuse(s, event, 'the exam comes after every section');
      if (s.exam.questions) refuse(s, event, 'the exam already has its questions');
      if (!validQuestions(v)) refuse(s, event, 'the exam has no usable questions');
      var n = s.titles.length;
      s.exam.questions = v.questions.map(function (q) {
        var ok = typeof q.cluster === 'number' && q.cluster >= 0 && q.cluster < n && Math.floor(q.cluster) === q.cluster;
        var o = clone(q); o.cluster = ok ? q.cluster : null;
        return o;
      });
      s.exam.order = v.questions.map(function (_, k) { return k; });
      s.exam.pos = 0; s.exam.results = [];
      return s;

    case 'examAnswered': {
      if (s.phase !== 'exam') refuse(s, event, 'an exam answer needs the exam');
      if (!s.exam.questions) refuse(s, event, 'no exam questions yet');
      if (typeof event.choice !== 'number') refuse(s, event, 'an answer is the index of an option');
      var e = answer(s.exam, s.exam.questions, event.choice);
      s.exam.results.push({ q: e.qi, choice: event.choice, correct: e.correct });
      var sec = e.q.cluster == null ? weakest(s, 1)[0] : e.q.cluster;
      if (!e.correct) addCard(s, 'exam', sec, e.q);
      s.exam.pos++;
      if (s.exam.pos >= s.exam.order.length) {
        s.exam.score = s.exam.results.filter(function (r) { return r.correct; }).length / s.exam.results.length;
        s.phase = 'done';
      }
      return s;
    }

    default:
      refuse(s, event, 'unknown event');
  }
}

/* 0..1 per section: its latest drill's first-pass score; null before it has
   been drilled, which is different from zero. */
function mastery(state, i) {
  var c = state.per[i];
  return c && c.done ? c.score : null;
}

/* The sections the exam leans on: lowest mastery first, not-yet-drilled
   counting as zero, a section with nothing to drill as full marks, ties to
   the earlier section. */
function weakest(state, n) {
  var idx = state.titles.map(function (_, i) { return i; });
  idx.sort(function (a, b) {
    var ma = mastery(state, a), mb = mastery(state, b);
    ma = ma == null ? (state.per[a].done ? 1 : 0) : ma; mb = mb == null ? (state.per[b].done ? 1 : 0) : mb;
    return ma - mb || a - b;
  });
  return idx.slice(0, Math.max(1, Math.min(n || 2, idx.length)));
}

function examSize(state) { return Math.min(12, Math.max(6, state.titles.length * 2)); }

/* The question strings every drill asked, so the exam can avoid them. */
function asked(state) {
  var out = [];
  state.titles.forEach(function (_, i) {
    var q = state.per[i].quiz;
    (q ? q.questions : []).forEach(function (x) { out.push(x.question + (x.quote || '')); });
  });
  return out;
}

/* The next section to learn: the first not drilled after the current one,
   else the first not drilled at all, else null (time for the exam). */
function nextSection(state) {
  var n = state.titles.length;
  for (var k = 1; k <= n; k++) {
    var i = (state.section + k) % n;
    if (!state.per[i].done) return i;
  }
  return null;
}

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
  VERSION: VERSION, init: init, next: next, mastery: mastery, weakest: weakest, examSize: examSize, asked: asked,
  nextSection: nextSection, allDone: allDone, isDue: isDue, dueCards: dueCards, review: review,
};
root.MemSession = MemSession;
if (typeof module !== 'undefined' && module.exports) module.exports = MemSession;
})(typeof window !== 'undefined' ? window : this);
