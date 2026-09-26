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
     · A MISS STAYS UNTIL IT GRADUATES — the owner's Supreme Memorizer skill,
       compiled in skill.js. Every first-try miss goes on the weak list with
       its error type, read from what happened: a wrong option is C (the
       option is what the fact was confused with), "not sure" is N, missed
       then right on the retry is R, missed on both is E. Weak items come
       back in review rounds — offered after every second section's drill,
       and run before the exam — interleaved, never two from one section in
       a row where that can be helped. An item leaves the list after two
       right answers in rounds at least two apart; a miss wipes the count and
       puts it back once at the end of that round.

   Grading is here, not in a coach: a multiple-choice answer is right when
   the option chosen is the option marked right. Nothing to interpret.

   The state is plain JSON so it can be saved after every step and resumed.
   Version 3. A version-2 session is read as having an empty weak list; a
   version-1 session (the old recall and teach-back protocol) is not resumed
   — openDoc starts a fresh one, and its cards are kept.

   Phases: unit → teach → drill → result → [review] → (unit | another section) … → [review] → exam → done → unit
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var VERSION = 3;
var Skill = root.MemSkill || (typeof require === 'function' ? require('./skill.js') : null);
/* "Not sure": an answer that is no option. */
var NOT_SURE = -1;

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
    round: 0, weak: {}, review: null, reviews: [], reviewDue: false,
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

function cardId(s, source, section, q) { return s.docId + ':' + source + ':' + section + ':' + hash(q.question + '|' + (q.quote || '')); }
function addCard(s, source, section, q) {
  var id = cardId(s, source, section, q);
  for (var i = 0; i < s.cards.length; i++) if (s.cards[i].id === id) return id;
  s.cards.push({ id: id, docId: s.docId, source: source, cluster: section, title: s.titles[section] || '',
                 front: q.question, quote: q.quote || '', options: q.options.slice(), answer: q.answer,
                 back: q.options[q.answer], explain: q.explain || '', page: q.page, srs: null, errorType: '', confusedWith: '' });
  return id;
}

/* ── the weak list (skill.js) ────────────────────────────────────────────── */
function setCardType(s, id, type, confusedWith) {
  for (var i = 0; i < s.cards.length; i++) if (s.cards[i].id === id) { s.cards[i].errorType = type; s.cards[i].confusedWith = confusedWith || ''; }
}
function label(text) {
  var w = String(text || '').split(/\s+/);
  return w.length > 6 ? w.slice(0, 6).join(' ') + '\u2026' : w.join(' ');
}
/* A miss: C with what was picked, or N for "not sure". */
/* The kind of miss, from the option picked: "not sure" is N; a wrong
   number where the answer is a number (the thing was known, its value was
   not) is V; any other wrong option is C, confused with what was picked. */
var COMPARE = /\b(?:greater|less|more|fewer|than|at|least|most|above|below|over|under|or|to|of|about|up)\b/gi;
function numeric(t) { return /\d/.test(String(t || '')) && String(t).replace(COMPARE, '').replace(/[\d.,\s%<>≥≤–\/-]/g, '').length <= 8; }
function missType(q, choice) {
  if (choice === NOT_SURE) return { t: 'N', w: '' };
  var picked = q.options[choice] || '';
  return { t: numeric(picked) && numeric(q.options[q.answer]) ? 'V' : 'C', w: picked };
}
function weakMiss(s, id, section, source, q, type, confusedWith) {
  var w = s.weak[id];
  if (!w) {
    w = s.weak[id] = { id: id, cluster: section, source: source, q: clone(q), label: label(q.options[q.answer]),
      misses: 0, streak: 0, hits: [], types: [], confusedWith: '', order: Object.keys(s.weak).length };
  }
  w.misses++; w.streak++; w.hits = [];
  w.types.push(type);
  if ((type === 'C' || type === 'V') && confusedWith) w.confusedWith = confusedWith;
  setCardType(s, id, type, type === 'C' || type === 'V' ? confusedWith : w.confusedWith);
  return w;
}
function weakHit(s, id) {
  var w = s.weak[id];
  if (w) { w.hits.push(s.round); w.streak = 0; }
}
function pending(s) {
  return Object.keys(s.weak || {}).map(function (k) { return s.weak[k]; })
    .filter(function (w) { return w.source !== 'exam' && !Skill.graduated(w); });
}
/* A fixed shuffle (the same state gives the same round), then no two items
   from one section side by side where that can be helped. Each step takes
   from the section with the most items left, other than the last one used;
   taking merely the first that differs ran out of separators (0,0,0,1,1,2
   came out 2,1,0,1,0,0). */
function interleave(items, round) {
  var pool = items.slice().sort(function (a, b) { var x = hash(a.id + '#' + round), y = hash(b.id + '#' + round); return x < y ? -1 : x > y ? 1 : 0; });
  var out = [];
  while (pool.length) {
    var prev = out.length ? out[out.length - 1].cluster : null;
    var left = {};
    pool.forEach(function (w) { left[w.cluster] = (left[w.cluster] || 0) + 1; });
    var best = -1;
    for (var k = 0; k < pool.length; k++) {
      if (pool[k].cluster === prev) continue;
      if (best === -1 || left[pool[k].cluster] > left[pool[best].cluster]) best = k;
    }
    out.push(pool.splice(best === -1 ? 0 : best, 1)[0]);
  }
  return out.map(function (w) { return w.id; });
}
function openReview(s, resume, final) {
  s.round++;
  s.review = { round: s.round, final: !!final, queue: interleave(pending(s), s.round), idx: 0, results: [], requeued: {}, resume: resume };
  s.reviewDue = false;
  s.phase = 'review';
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
  if (!s.weak) { s.weak = {}; s.round = s.round || 0; s.review = null; s.reviews = []; s.reviewDue = false; }
  s.v = VERSION;
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
      s.round++;
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
      var id = cardId(s, 'drill', s.section, a.q);
      var mt = a.correct ? null : missType(a.q, event.choice);
      /* sure: said before answering (study.js rateWith). A confident miss
         is the most dangerous kind: its card and weak item are flagged. */
      var sure = event.sure === true && event.choice !== NOT_SURE;
      c.answers.push({ q: a.qi, choice: event.choice, correct: a.correct, first: a.first, errorType: mt ? mt.t : '', sure: sure });
      if (a.first) {
        if (!a.correct) {
          addCard(s, 'drill', s.section, a.q);
          weakMiss(s, id, s.section, 'drill', a.q, mt.t, mt.w);
          if (sure) { s.weak[id].hazard = true; for (var hc = 0; hc < s.cards.length; hc++) if (s.cards[hc].id === id) s.cards[hc].hazard = true; }
          c.order.push(a.qi);                      /* asked again, once, at the end */
        } else weakHit(s, id);                     /* a retaken drill: a right answer in a new round */
      } else if (s.weak[id]) {
        /* The retry, in the same round as the miss: it does not count
           towards graduating. Right, the memory was there (R); wrong
           again, nothing stuck (E). */
        var w = s.weak[id];
        if (a.correct) { w.types[w.types.length - 1] = 'R'; w.streak = 0; setCardType(s, id, 'R', w.confusedWith); }
        else weakMiss(s, id, s.section, 'drill', a.q, 'E', '');
      }
      c.pos++;
      if (c.pos >= c.order.length) {
        var firsts = c.answers.filter(function (x) { return x.first; });
        c.score = firsts.length ? firsts.filter(function (x) { return x.correct; }).length / firsts.length : 0;
        c.best = c.best == null ? c.score : Math.max(c.best, c.score);
        c.done = true; c.attempts++;
        s.phase = 'result';
        var drilled = s.titles.filter(function (_, k) { return s.per[k].done; }).length;
        s.reviewDue = drilled % 2 === 0 && pending(s).some(function (x) { return x.cluster !== s.section; });
      }
      return s;
    }

    case 'redrill':
      if (s.phase !== 'result') refuse(s, event, 'a drill is retaken from its result');
      if (!c.quiz.questions.length) refuse(s, event, 'this section has nothing to drill');
      s.phase = 'drill';
      c.order = c.quiz.questions.map(function (_, k) { return k; });
      c.pos = 0; c.answers = [];
      s.round++; s.reviewDue = false;
      return s;

    /* A review round of the weak list, from a drill's result. */
    case 'toReview':
      if (s.phase !== 'result' && s.phase !== 'unit') refuse(s, event, 'a review round starts from a result or the unit page');
      if (!pending(s).length) refuse(s, event, 'nothing is on the weak list');
      openReview(s, s.phase, false);
      return s;

    case 'reviewAnswered': {
      if (s.phase !== 'review') refuse(s, event, 'a review answer needs a review round');
      if (typeof event.choice !== 'number') refuse(s, event, 'an answer is the index of an option');
      var r = s.review, rid = r.queue[r.idx], rw = s.weak[rid], rq = rw.q;
      var ok = event.choice === rq.answer, rmt = ok ? null : missType(rq, event.choice);
      r.results.push({ id: rid, choice: event.choice, correct: ok, errorType: rmt ? (rw.streak >= 1 ? 'E' : rmt.t) : '' });
      if (ok) weakHit(s, rid);
      else {
        /* A second miss in a row is encoding: the hook did not take. */
        weakMiss(s, rid, rw.cluster, rw.source, rq, rw.streak >= 1 ? 'E' : rmt.t, rmt.w);
        if (!r.requeued[rid]) { r.requeued[rid] = true; r.queue.push(rid); }
      }
      r.idx++;
      if (r.idx >= r.queue.length) {
        s.reviews.push({ round: r.round, final: r.final, asked: r.results.length,
                         correct: r.results.filter(function (x) { return x.correct; }).length });
        s.phase = r.resume; s.review = null;
      }
      return s;
    }

    /* A unit's pack (pack.js), imported: each section it covers is taught
       from it — its lesson now, its questions from the next drill on. The
       section open in the middle of memorising, a drill or its result keeps
       what it has until it is left: its cards and answers count against the
       lesson and questions on screen. What a section has already earned —
       its score, its review cards, its weak items — stays. */
    case 'packed': {
      if (s.phase === 'exam') refuse(s, event, 'finish or leave the exam first');
      if (!v || !Array.isArray(v.sections)) refuse(s, event, 'a pack is a list of sections');
      v.sections.forEach(function (p) {
        var k = p && p.index, cp = typeof k === 'number' ? s.per[k] : null;
        if (!cp || !p.lesson || !Array.isArray(p.lesson.points) || !p.lesson.points.length) return;
        if (k === s.section && /^(?:memorize|drill|result)$/.test(s.phase)) return;
        cp.lesson = clone(p.lesson);
        if (p.quiz && validQuestions(p.quiz)) { cp.quiz = { questions: clone(p.quiz.questions) }; cp.order = []; cp.pos = 0; cp.answers = []; }
      });
      return s;
    }

    /* The pack removed: every section taught from it goes back to the
       built-in coach, which teaches it afresh when it is next opened. Held
       to the same rule as importing — the section in the middle of being
       memorised, drilled or scored keeps what it has — and what was earned
       stays. */
    case 'unpacked':
      if (s.phase === 'exam') refuse(s, event, 'finish or leave the exam first');
      Object.keys(s.per).forEach(function (key) {
        var k = +key, cp = s.per[key];
        if (k === s.section && /^(?:memorize|drill|result)$/.test(s.phase)) return;
        if (cp.lesson && cp.lesson.by === 'pack') cp.lesson = null;
        if (cp.quiz && cp.quiz.questions.some(function (q) { return q.by === 'pack'; })) { cp.quiz = null; cp.order = []; cp.pos = 0; cp.answers = []; }
      });
      return s;

    case 'toExam':
      if (s.phase === 'drill' || s.phase === 'exam') refuse(s, event, 'finish the drill first');
      if (!allDone(s)) refuse(s, event, 'the exam comes after every section’s drill');
      s.phase = 'exam';
      if (s.exam.score != null) s.exam = { questions: null, order: [], pos: 0, results: [], score: null };
      /* The last cumulative round before the exam, when anything is still
         weak (skill §7, Round C) — once per exam, not on every retake. */
      if (pending(s).length && !s.exam.questions) openReview(s, 'exam', true);
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
      s.round++;
      return s;

    case 'examAnswered': {
      if (s.phase !== 'exam') refuse(s, event, 'an exam answer needs the exam');
      if (!s.exam.questions) refuse(s, event, 'no exam questions yet');
      if (typeof event.choice !== 'number') refuse(s, event, 'an answer is the index of an option');
      var e = answer(s.exam, s.exam.questions, event.choice);
      s.exam.results.push({ q: e.qi, choice: event.choice, correct: e.correct });
      var sec = e.q.cluster == null ? weakest(s, 1)[0] : e.q.cluster;
      if (!e.correct) {
        var emt = missType(e.q, event.choice);
        weakMiss(s, addCard(s, 'exam', sec, e.q), sec, 'exam', e.q, emt.t, emt.w);
      }
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

/* A saved session this version can carry on: version 2 (multiple choice,
   before the weak list) or 3. Version 1 was the old recall protocol. */
function resumable(st) { return !!st && (st.v === 2 || st.v === VERSION); }

/* The item a review round is on, and whether a wrong answer now would be
   the second miss in a row — the skill's trigger for a re-teach (§8). */
function reviewItem(state) {
  var r = state.review;
  return r && r.idx < r.queue.length ? state.weak[r.queue[r.idx]] : null;
}
function needsReteach(state) { var w = reviewItem(state); return !!w && w.streak >= 1; }

/* The skill's closing deliverable (§16): three pillars, the mnemonic sheet,
   the weak-area report. The pillars are the big ideas of one lesson from
   each third of the unit, so the three span it; the report lists every item
   that was ever weak, twice-missed first, with its types and whether it
   graduated. */
function closing(state) {
  var n = state.titles.length;
  var picks = n < 3 ? state.titles.map(function (_, i) { return i; }) : [0, Math.floor(n / 3), Math.floor(2 * n / 3)];
  var pillars = [];
  picks.forEach(function (i) {
    var L = state.per[i] && state.per[i].lesson;
    var text = L && (L.overview || (L.points && L.points[0] && L.points[0].text));
    if (text && pillars.length < 3) pillars.push({ title: state.titles[i], text: text, page: L.points && L.points[0] ? L.points[0].page : null });
  });
  var sheet = [];
  state.titles.forEach(function (t, i) {
    var L = state.per[i] && state.per[i].lesson;
    ((L && L.mnemonics) || []).forEach(function (m) { if (m && m.letters) sheet.push({ section: t, title: m.title, letters: m.letters, words: (m.words || []).slice() }); });
  });
  var weak = Object.keys(state.weak || {}).map(function (k) { return state.weak[k]; })
    .sort(function (a, b) { return (b.misses >= 2) - (a.misses >= 2) || b.misses - a.misses || a.order - b.order; })
    .map(function (w) {
      return { label: w.label, question: w.q.question, answer: w.q.options[w.q.answer], page: w.q.page, section: state.titles[w.cluster] || '',
               misses: w.misses, types: w.types.slice(), confusedWith: w.confusedWith, graduated: Skill.graduated(w), source: w.source };
    });
  return { pillars: pillars, sheet: sheet, weak: weak };
}
function closingText(state) {
  var c = closing(state), out = ['THREE PILLARS'];
  c.pillars.forEach(function (p, i) { out.push((i + 1) + '. ' + p.text + (p.page ? ' (p.' + p.page + ')' : '')); });
  out.push('', 'MNEMONIC SHEET');
  if (!c.sheet.length) out.push('- None this unit.');
  c.sheet.forEach(function (m) { out.push('- ' + m.title + ': ' + m.letters + ' \u2014 ' + m.words.join(', ')); });
  out.push('', 'WEAK AREA REPORT');
  if (!c.weak.length) out.push('- Nothing was missed.');
  c.weak.forEach(function (w) {
    out.push('- ' + w.answer + ' \u2014 ' + w.misses + (w.misses === 1 ? ' miss' : ' misses') + ', type ' + w.types.join('/') +
      (w.confusedWith ? ', confused with ' + w.confusedWith : '') + (w.graduated ? ', graduated' : ', still weak') + (w.page ? ' (p.' + w.page + ')' : ''));
  });
  return out.join('\n');
}

/* ── review ──────────────────────────────────────────────────────────────── */
/* A card never reviewed is due at once — unless it was made to start
   later (study.js's cloze and occlusion cards start tomorrow, so a drill
   does not end in a second drill of the same sentences). */
function isDue(card, today) {
  if (!card.srs) return !card.dueFrom || card.dueFrom <= today;
  return !card.srs.due || card.srs.due <= today;
}
function dueCards(cards, today) { return (cards || []).filter(function (c) { return isDue(c, today); }); }
/* FSRS is passed in (src/core/fsrs.js, shared with Systole) rather than
   reached for, so this stays pure and the test can hand it the real one. */
function review(card, rating, today, FSRS) {
  var out = clone(card);
  out.srs = FSRS.update(card.srs, rating, today);
  return out;
}

/* A section deleted by the owner: every place that names a section by its
   number is renumbered — its progress, the review cards and weak items the
   session holds, the exam's questions — and what belonged to the deleted
   one goes with it. Refused mid-exam and mid-review (their queues name
   sections), and for the last section a unit has. The exam is set again
   when it drew from the deleted section; its last score is kept. */
function dropSection(state, i) {
  var s = clone(state), n = s.titles.length;
  if (typeof i !== 'number' || Math.floor(i) !== i || i < 0 || i >= n) throw new Error('this unit has no section ' + i);
  if (n < 2) throw new Error('a unit keeps at least one section: delete the unit instead');
  if (s.phase === 'exam' || s.phase === 'review' || s.review) throw new Error('finish or leave the ' + (s.phase === 'exam' ? 'exam' : 'review') + ' first');
  var shift = function (k) { return k > i ? k - 1 : k; };
  s.titles.splice(i, 1);
  var per = {};
  Object.keys(s.per).forEach(function (key) { var k = +key; if (k !== i) per[shift(k)] = s.per[key]; });
  s.per = per;
  if (s.section === i) { s.section = Math.min(i, n - 2); if (s.phase !== 'done') s.phase = 'unit'; }
  else s.section = shift(s.section);
  s.cards = (s.cards || []).filter(function (c) { return c.cluster !== i; }).map(function (c) { c.cluster = shift(c.cluster); return c; });
  var weak = {};
  Object.keys(s.weak || {}).forEach(function (id) { var w = s.weak[id]; if (w.cluster === i) return; w.cluster = shift(w.cluster); weak[id] = w; });
  s.weak = weak;
  var qs = s.exam && s.exam.questions;
  if (qs && qs.some(function (q) { return q.cluster === i; })) s.exam = { questions: null, order: [], pos: 0, results: [], score: s.exam.score };
  else if (qs) qs.forEach(function (q) { if (typeof q.cluster === 'number') q.cluster = shift(q.cluster); });
  return s;
}
/* The review cards kept on the device, for the same deletion: those of the
   deleted section to remove, the later ones renumbered. */
function dropCards(cards, docId, i) {
  var drop = [], keep = [];
  (cards || []).forEach(function (c) {
    if (c.docId !== docId || typeof c.cluster !== 'number') return;
    if (c.cluster === i) drop.push(c.id);
    else if (c.cluster > i) { var o = clone(c); o.cluster = c.cluster - 1; keep.push(o); }
  });
  return { drop: drop, renumbered: keep };
}

var MemSession = {
  VERSION: VERSION, init: init, next: next, mastery: mastery, weakest: weakest, examSize: examSize, asked: asked,
  nextSection: nextSection, allDone: allDone, isDue: isDue, dueCards: dueCards, review: review,
  NOT_SURE: NOT_SURE, resumable: resumable, pending: pending, interleave: interleave, reviewItem: reviewItem, needsReteach: needsReteach,
  closing: closing, closingText: closingText, missType: missType, dropSection: dropSection, dropCards: dropCards,
};
root.MemSession = MemSession;
if (typeof module !== 'undefined' && module.exports) module.exports = MemSession;
})(typeof window !== 'undefined' ? window : this);
