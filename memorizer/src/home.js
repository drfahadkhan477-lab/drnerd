/* ═══════════════════════════════════════════════════════════════════════════
   home.js — what the home screen says: a greeting, where you are, how much
   has stuck, and one fact from your own PDF.

   Systole's home, without its motion. Systole opens on a hero band with a
   greeting and a live ECG, a progress ring, and a pearl — one sentence worth
   knowing, taken from the notes and broken into steps. Memorizer keeps the
   band, the progress and the pearl, and draws all of them still: nothing
   here animates, and the pearl changes once a day, not while you look at it.

   THE PEARL IS SYSTOLE'S OWN CODE. src/core/pearl.js is passed in, not
   copied: it finds the sentence that carries a fact (a threshold, a rule, a
   distinction) and refuses the one that only makes sense beside its
   paragraph. Here its "notes" are your PDF's sections, their prose only —
   headings, list items and table rows are not sentences, and pearl.js drops
   them in its own notes for the same reason.

   WHAT "HELD" MEANS. A card is held when FSRS puts today's chance of
   recalling it at 90% or more, from its own stability and the days since it
   was last seen. A card never reviewed is not held — it has no history to
   predict from, and counting it would be the progress bar claiming what the
   scheduler cannot.

   PURE. Pearl and FSRS are handed in, the date is handed in, so the suite
   drives it with the real modules on a fixed day.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var HELD = 0.9;

function greeting(hour) {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 22) return 'Good evening';
  return 'Studying late';
}

/* Sections finished in one unit: the whole unit once it reaches the
   gauntlet, otherwise the section it is on (which is not finished yet). */
function studiedOf(doc, state) {
  var n = (doc.clusters || []).length;
  if (!state) return 0;
  if (state.phase === 'done' || state.phase === 'gauntlet') return n;
  return Math.max(0, Math.min(n, state.cluster || 0));
}

function isHeld(card, today, FSRS) {
  var s = card && card.srs;
  if (!s || !(s.stability > 0) || !s.last) return false;
  var days = Math.max(0, FSRS.daysBetween(s.last, today));
  return FSRS.retrievability(s.stability, days) >= HELD;
}

/* sessions: { docId: state } */
function progress(docs, sessions, cards, today, FSRS) {
  var out = { sections: 0, studied: 0, cards: (cards || []).length, held: 0, units: (docs || []).length };
  (docs || []).forEach(function (d) {
    out.sections += (d.clusters || []).length;
    out.studied += studiedOf(d, sessions[d.id]);
  });
  (cards || []).forEach(function (c) { if (isHeld(c, today, FSRS)) out.held++; });
  out.studiedPct = out.sections ? Math.round(100 * out.studied / out.sections) : 0;
  out.heldPct = out.cards ? Math.round(100 * out.held / out.cards) : 0;
  return out;
}

/* The unit to carry on with: one under way, else one not begun, newest
   first in both cases; never one already mastered while another is open. */
function current(docs, sessions) {
  var list = (docs || []).slice().sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); });
  var open = list.filter(function (d) { var s = sessions[d.id]; return s && s.phase !== 'done'; })[0];
  if (open) return { doc: open, state: sessions[open.id], started: true };
  var fresh = list.filter(function (d) { return !sessions[d.id]; })[0];
  if (fresh) return { doc: fresh, state: null, started: false };
  return list.length ? { doc: list[0], state: sessions[list[0].id], started: true } : null;
}

/* A section as one of pearl.js's notes: its prose, a paragraph per block. */
function notesOf(doc) {
  return (doc.clusters || []).map(function (c) {
    var body = (c.segments || []).filter(function (s) { return !s.heading && !s.item && !s.table && !s.tableHeader; })
      .map(function (s) { return s.text; }).join('\n\n');
    return { id: doc.id + ':' + c.index, title: c.title, body: body };
  });
}

/* A number from a string, the same all day and different tomorrow. */
function seed(str) {
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
function seeded(str) {
  var s = seed(str) || 1;
  return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/* Today's pearl from the given units; `skip` counts presses of "Another". */
function pearlOf(docs, Pearl, today, skip) {
  var pool = [];
  (docs || []).forEach(function (d) {
    Pearl.harvest(notesOf(d)).forEach(function (p) {
      var idx = Number(String(p.id).split(':').pop());
      var c = d.clusters.filter(function (x) { return x.index === idx; })[0];
      pool.push({ id: p.id, text: p.text, score: p.score, title: p.title, docId: d.id, docName: d.name, cluster: idx,
                  page: c ? pageOf(c, p.text) : null, heading: c ? headingOf(c, p.text) : p.title });
    });
  });
  if (!pool.length) return null;
  var rand = seeded(today + '|' + pool.length);
  var prev = null, p = null;
  for (var i = 0; i <= (skip || 0); i++) { p = Pearl.pick(pool, prev ? prev.id : null, rand); prev = p; }
  return { pearl: p, steps: Pearl.steps(p.text), of: pool.length };
}

/* The page a pearl's sentence was printed on: the segment holding its start. */
function pageOf(cluster, text) {
  var head = String(text).slice(0, 40);
  var seg = (cluster.segments || []).filter(function (s) { return String(s.text).indexOf(head) !== -1; })[0];
  return seg ? seg.page : cluster.pageStart;
}

/* The heading a pearl's sentence was printed under — a section can span
   several headings, and its title is only the first. */
function headingOf(cluster, text) {
  var head = String(text).slice(0, 40), last = cluster.title;
  var segs = cluster.segments || [];
  for (var i = 0; i < segs.length; i++) {
    if (segs[i].heading) last = segs[i].text;
    else if (String(segs[i].text).indexOf(head) !== -1) return last;
  }
  return cluster.title;
}

/* WEAK SPOTS. The sections taught and held least well, across every unit:
   mastery is the session's own measure (session.js — half recall accuracy,
   half the teach-back score), and a section not yet taught has none, so it
   is never called weak. Under WEAK is weak. Weakest first; between two
   equally weak, the one with more review cards waiting, since that is where
   a drill has the most to work on. `mastery` is MemSession.mastery, passed
   in so this stays pure. */
var WEAK = 0.8;
function weakSpots(docs, sessions, cards, mastery, n) {
  var out = [];
  (docs || []).forEach(function (d, di) {
    var st = sessions[d.id];
    if (!st) return;
    (d.clusters || []).forEach(function (c, i) {
      var m = mastery(st, i);
      if (m == null || m >= WEAK) return;
      var k = (cards || []).filter(function (x) { return x.docId === d.id && x.cluster === i; }).length;
      out.push({ docId: d.id, docName: d.name, cluster: i, title: c.title, mastery: m, pct: Math.round(100 * m), cards: k, order: di });
    });
  });
  out.sort(function (a, b) { return a.mastery - b.mastery || b.cards - a.cards || a.order - b.order || a.cluster - b.cluster; });
  return out.slice(0, n || 3);
}

/* "1 section", "3 sections". */
function count(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

/* A still ECG trace for the hero band, as SVG path data: a flat line with
   PQRST complexes at even spacing. Drawn once; nothing moves it. */
function tracePath(width, beats) {
  var w = width || 600, n = beats || 4, step = w / n, base = 30, d = 'M0 ' + base;
  for (var i = 0; i < n; i++) {
    var x = i * step + step * 0.3;
    d += ' L' + x.toFixed(1) + ' ' + base +
      ' q6 -7 12 0' +                     /* P */
      ' l8 0 l3 4 l5 -30 l5 38 l4 -12' +  /* Q R S */
      ' l12 0 q10 -12 20 0';              /* T */
  }
  return d + ' L' + w + ' ' + base;
}

/* A pearl's text in runs, with the numbers that carry units marked, so the
   threshold is what the eye lands on. */
var FIGURE = /(\d+(?:[.,]\d+)?(?:\s?[–-]\s?\d+(?:[.,]\d+)?)?\s?(?:%|mmHg|mg|mcg|g|mL|ml|L\/min|cm|mm|ms|bpm|hours?|days?|weeks?|months?|years?)?)/;
function marks(text) {
  var out = [];
  String(text).split(FIGURE).forEach(function (part, i) {
    if (!part) return;
    out.push({ text: part, num: i % 2 === 1 && /\d/.test(part) });
  });
  return out;
}

var MemHome = { HELD: HELD, WEAK: WEAK, weakSpots: weakSpots, greeting: greeting, studiedOf: studiedOf, isHeld: isHeld, progress: progress, current: current,
  notesOf: notesOf, seeded: seeded, pearlOf: pearlOf, pageOf: pageOf, headingOf: headingOf, marks: marks, count: count, tracePath: tracePath };
root.MemHome = MemHome;
if (typeof module !== 'undefined' && module.exports) module.exports = MemHome;
})(typeof window !== 'undefined' ? window : this);
