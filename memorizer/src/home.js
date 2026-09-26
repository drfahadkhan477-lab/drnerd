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

/* Sections finished in one unit: taught and drilled. A version-1 session
   (the old protocol) is not resumed, so it counts none. */
function studiedOf(doc, state) {
  var n = (doc.clusters || []).length;
  if (!drillState(state)) return 0;
  var k = 0;
  for (var i = 0; i < n; i++) if (state.per[i] && state.per[i].done) k++;
  return k;
}
/* A session on the drill protocol: version 2, or 3 (with the weak list). */
function drillState(st) { return !!st && (st.v === 2 || st.v === 3); }
function unitPct(doc, state) {
  var n = (doc.clusters || []).length;
  return n ? Math.round(100 * studiedOf(doc, state) / n) : 0;
}
/* A section's badge: its best drill score, or null before its first drill. */
function sectionPct(state, i) {
  var c = drillState(state) && state.per[i];
  return c && c.best != null ? Math.round(100 * c.best) : null;
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

/* Started: a version-2 session with any section taught. */
/* A unit whose final exam has been scored. */
function examined(state) {
  return !!(drillState(state) && state.exam && state.exam.score != null);
}
function started(state) {
  if (!drillState(state)) return false;
  return Object.keys(state.per).some(function (k) { return state.per[k].lesson || state.per[k].done; });
}
/* The unit to carry on with: one under way, else one not begun, newest
   first in both cases; never one whose exam is done while another is open. */
function current(docs, sessions) {
  var list = (docs || []).slice().sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); });
  var open = list.filter(function (d) { var s = sessions[d.id]; return started(s) && !examined(s); })[0];
  if (open) return { doc: open, state: sessions[open.id], started: true };
  var fresh = list.filter(function (d) { return !started(sessions[d.id]); })[0];
  if (fresh) return { doc: fresh, state: sessions[fresh.id] || null, started: false };
  return list.length ? { doc: list[0], state: sessions[list[0].id], started: true } : null;
}
/* "Jump back in": units studied, most recently first (`at`: docId → time of
   the last step), then units not begun, newest first; `n` at most. */
function recent(docs, sessions, at, n) {
  var list = (docs || []).slice();
  list.sort(function (a, b) {
    var ta = (at && at[a.id]) || 0, tb = (at && at[b.id]) || 0;
    return tb - ta || (b.addedAt || 0) - (a.addedAt || 0);
  });
  return list.slice(0, n || 3).map(function (d) {
    var st = sessions[d.id];
    return { doc: d, state: st || null, pct: unitPct(d, st), next: nextTitle(d, st) };
  });
}
/* What "continue" would open: the exam when every section is drilled, else
   the first section not yet drilled after the one last studied; once the
   exam is done, its score. */
function nextTitle(d, st) {
  var n = (d.clusters || []).length;
  if (!n) return '';
  if (!drillState(st)) return d.clusters[0].title;
  if (examined(st)) return 'Final exam · ' + Math.round(100 * st.exam.score) + '%';
  for (var k = 0; k <= n; k++) {
    var i = ((st.section || 0) + k) % n;
    if (!st.per[i].done) return d.clusters[i].title;
  }
  return 'Final exam';
}
/* Days in a row with study, ending today or yesterday. `days`: ISO dates. */
function streak(days, today, FSRS) {
  var set = {};
  (days || []).forEach(function (d) { set[d] = true; });
  var prev = function (iso) { var t = FSRS.isoToLocalDate(iso); t.setDate(t.getDate() - 1); return FSRS.localDateToISO(t); };
  var n = 0, d = today;
  if (!set[d]) d = prev(d);
  while (set[d]) { n++; d = prev(d); }
  return n;
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

/* WHAT A TEXTBOOK'S PEARL IS NOT. pearl.js was written for Systole's own
   notes, where every sentence was chosen to teach. A textbook's prose also
   reports trials and leans on the sentence before, and the owner's home
   screen showed both at once: a sentence opening "Utilizing similar end
   points as with …" — a comparison with a sentence the pearl does not
   carry — that was mostly a trial's read-out, an event rate, a hazard
   ratio and a P value. So pearl.js's harvest is run again here, over the
   same runs and with its own score, with two more refusals:

     · A READ-OUT: a hazard, odds or risk ratio, a confidence interval, a P
       value, events per patient-years. The trial's result is in the book
       for the record; what is learned from it is the sentence that says
       what to do, and that sentence is taken instead.
     · A LEANING OPENER: a first sentence whose opening clause points at
       something before it — similar, the same, as with, likewise, also,
       another, the latter. Later in a run it is fine: the run carries
       what it leans on. */
var READOUT = [/\b(?:HR|OR|RR|ARR|RRR|NNT|CI)\b\s*[:=,]?\s*\(?\d/, /\b[Pp]\s*[=<>\u2264\u2265]\s*0?\.\d/, /\d\s*%\s*CI\b/,
  /\b(?:hazard|odds|risk) ratios?\b/i, /\bconfidence intervals?\b/i, /\bpatient-years?\b/i, /\bper 1,?000 (?:patients?|participants?|person)/i];
var LEANS = /\b(?:similar(?:ly)?|same|as with|as in|as (?:noted|mentioned|described|discussed)|likewise|also|again|further(?:more)?|additional(?:ly)?|moreover|another|other|the (?:former|latter)|previous(?:ly)?|aforementioned|utili[sz]ing)\b/i;
function readout(t) { return READOUT.some(function (re) { return re.test(t); }); }
/* The opening clause: up to the first comma in the first 90 characters, or
   the first six words when there is none. */
function leans(t) {
  var s = String(t).trim(), comma = s.indexOf(',');
  var open = comma > 0 && comma < 90 ? s.slice(0, comma) : s.split(/\s+/).slice(0, 6).join(' ');
  return LEANS.test(open);
}
function harvest(notes, Pearl) {
  var out = [];
  (notes || []).forEach(function (r) {
    var best = null, bestScore = -1;
    Pearl.paragraphs(r.body).forEach(function (para) {
      Pearl.runs(Pearl.sentences(para)).forEach(function (run) {
        if (!Pearl.isPearl(run) || readout(run) || leans(Pearl.clean(run))) return;
        var sc = Pearl.score(run);
        if (sc > bestScore) { bestScore = sc; best = run; }
      });
    });
    if (best && bestScore >= 5) out.push({ id: r.id, title: r.title || '', text: Pearl.clean(best), score: bestScore });
  });
  return out;
}

/* Today's pearl from the given units; `skip` counts presses of "Another".
   `yieldOf` (Coach.yieldOf, passed in so this stays pure) makes a
   high-yield sentence likelier: each cue, up to three, adds 20 to its
   pearl.js score — about twice what a strong pearl scores on its own, so a
   pearl that is also high-yield is drawn roughly half again as often. */
function pearlOf(docs, Pearl, today, skip, yieldOf) {
  var pool = [];
  (docs || []).forEach(function (d) {
    harvest(notesOf(d), Pearl).forEach(function (p) {
      var idx = Number(String(p.id).split(':').pop());
      var c = d.clusters.filter(function (x) { return x.index === idx; })[0];
      pool.push({ id: p.id, text: p.text, score: p.score + (yieldOf ? 20 * Math.min(3, yieldOf(p.text).length) : 0), title: p.title, docId: d.id, docName: d.name, cluster: idx,
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
   mastery is the session's own measure (session.js — the section drill's
   first-pass score), and a section not yet drilled has none, so it
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
      /* its misses' cards: recall cards (study.js cloze and occlusion, which
         carry a kind) come through review when due, not through this drill */
      var k = (cards || []).filter(function (x) { return x.docId === d.id && x.cluster === i && !x.kind; }).length;
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
   threshold is what the eye lands on. A value written without its leading
   zero, ".02", is marked whole: the owner's screen showed the point left
   outside the mark and "02" inside it. */
var FIGURE = /((?:\d+(?:[.,]\d+)?|\.\d+)(?:\s?[–-]\s?\d+(?:[.,]\d+)?)?\s?(?:%|mmHg|mg|mcg|g|mL|ml|L\/min|cm|mm|ms|bpm|hours?|days?|weeks?|months?|years?)?)/;
/* A number that names a place in the book — "Table 1.4", "Fig. 2", "p. 52"
   — is not a value to learn, so it is not marked. */
var PLACE = /\b(?:tables?|fig(?:ure)?s?|chapters?|sections?|pages?|pp?|box|panel|eq)\.?\s*$/i;
function marks(text) {
  var out = [], prev = '';
  String(text).split(FIGURE).forEach(function (part, i) {
    if (!part) return;
    out.push({ text: part, num: i % 2 === 1 && /\d/.test(part) && !PLACE.test(prev) });
    prev = part;
  });
  return out;
}

/* What goes beside the pearl: its section's own figure — the one on the
   pearl's page if there is one, else the section's first (the chunker's
   assignFigures decides which figures are the section's) — or, with no
   figure, the section's first table, a few rows of it. Nothing from any
   other section, and nothing at all rather than a picture that is not the
   section's. Chunk is passed in, so this stays pure. */
var PEARL_ROWS = 5;
function pearlVisual(doc, pearl, Chunk) {
  if (!doc || !pearl) return null;
  var ci = -1;
  (doc.clusters || []).forEach(function (c, i) { if (ci === -1 && c.index === pearl.cluster) ci = i; });
  if (ci === -1) return null;
  var c = doc.clusters[ci];
  var figs = doc.hasFile !== false && doc.figures && doc.figures.length ? (Chunk.assignFigures(doc.clusters, doc.figures)[ci] || []) : [];
  if (figs.length) {
    var f = figs.filter(function (x) { return x.page === pearl.page; })[0] || figs[0];
    return { kind: 'figure', page: f.page, box: f.box, caption: f.caption || '', number: f.number || '' };
  }
  var t = (c.segments || []).filter(function (s) { return s.table && s.table.length; })[0];
  if (t) {
    return { kind: 'table', page: t.page, header: t.tableHeader || null, rows: t.table.slice(0, PEARL_ROWS), more: Math.max(0, t.table.length - PEARL_ROWS) };
  }
  return null;
}

/* ── the pearl as the day's recall (the owner's plan, phase 4) ───────────
   Its values are hidden until asked for — the numbers marks() finds, as
   the page marks them — so the pearl is recalled before it is read. A
   pearl with no value hides the lead of its first step instead, so there
   is always something to bring back. */
function recallParts(steps) {
  var blanks = 0;
  var out = (steps || []).map(function (st) {
    var parts = marks(st.text).map(function (m) { if (m.num) blanks++; return { text: m.text, blank: !!m.num }; });
    return { lead: st.lead || '', leadBlank: false, parts: parts };
  });
  if (!blanks && out.length && out[0].lead) { out[0].leadBlank = true; blanks = 1; }
  return { steps: out, blanks: blanks };
}
/* The days of the last `days` (7) the pearl was recalled: { day: true|false }. */
function recallStreak(recs, today, days, addDays) {
  var n = 0, of = 0;
  for (var i = 0; i < (days || 7); i++) {
    var d = addDays(today, -i);
    if (recs && d in recs) { of++; if (recs[d]) n++; }
  }
  return { knew: n, of: of };
}

/* ── THE BRAIN: the mastery map as a mind that lights up ─────────────────
   The owner's ask: "bring the map up … make it look like a realistic brain
   with neurons and spread and connected progress". The map was a grid of
   squares at the foot of the home screen. It is now a brain in side view,
   facing left — a cerebrum with its sulci, the cerebellum, the stem — and
   every section studied from is a neuron inside it: dark until drilled,
   then lit in the colour of how well it is held (study.js masteryMap:
   solid, fading, weak). Each unit is a lobe of neighbouring neurons wired
   into one network, its first section at the lobe's heart and the rest
   spreading outward in order, so progress through a unit is seen spreading
   out from the middle; the units' first neurons are wired to one another,
   so the whole brain is one connected net. A connection is lit when both
   of its neurons are, half-lit when one is.

   Everything here is geometry, worked out once from the sections and the
   same every time (Halton points, no randomness): the page draws it. */
var BRAIN_W = 1000, BRAIN_H = 700;
/* The cerebrum's outline, points a smooth closed curve is drawn through
   (smoothPath) and the neurons are placed inside (inPoly). */
var CEREBRUM = [[110, 362], [94, 300], [104, 236], [140, 176], [196, 126], [266, 88], [350, 64], [440, 54], [530, 55], [620, 66], [700, 90],
  [770, 125], [830, 172], [875, 228], [903, 290], [912, 345], [898, 396], [866, 430], [810, 446], [742, 453], [680, 470], [610, 492],
  [540, 505], [470, 508], [405, 498], [352, 478], [318, 450], [302, 420], [270, 404], [200, 400], [148, 390]];
var CEREBELLUM = [[662, 468], [732, 444], [812, 440], [872, 462], [897, 506], [874, 550], [812, 577], [732, 580], [674, 554], [650, 512]];
var STEM = [[560, 482], [640, 480], [656, 532], [650, 602], [640, 662], [600, 664], [592, 602], [574, 560], [556, 522]];
/* The folds: the lateral and central sulci where they lie on a real brain,
   and the gyri's smaller folds between them. Drawn, not measured. */
var SULCI = [
  'M318 424C388 398 462 382 552 362S648 330 708 296',
  'M528 56C512 130 476 190 488 252S446 350 458 404',
  'M462 58C448 140 418 198 428 258S396 344 404 392',
  'M600 64C588 130 558 178 568 236S540 318 552 350',
  'M372 474C446 452 540 440 622 420S724 380 768 348',
  'M420 494C492 480 570 470 640 450S718 426 752 418',
  'M170 206C222 192 274 212 326 202S398 172 430 150',
  'M132 282C196 272 250 292 312 282S376 252 414 242',
  'M148 350C198 344 250 360 300 350S348 332 376 322',
  'M624 124C666 142 702 132 742 162S786 200 810 196',
  'M604 204C654 214 694 236 744 244S814 262 856 256',
  'M810 298C840 316 860 344 884 356',
  'M760 330C804 358 826 390 858 402',
  'M240 118C262 150 296 150 318 128',
  'M360 96C372 132 406 144 432 124',
  'M650 84C666 106 698 108 716 92',
  'M314 326C348 304 374 326 406 314',
  'M600 286C634 262 662 288 694 272',
  'M208 250C234 234 262 244 282 230',
  'M690 402C714 380 746 390 772 372',
  'M500 150C520 176 548 170 566 150',
  'M520 300C548 320 580 312 600 330',
  'M780 250C800 268 830 270 850 290',
  'M232 330C260 318 286 326 306 314',
  'M396 196C420 214 446 208 466 222',
  'M676 330C700 346 726 340 744 356'];
var FOLIA = ['M676 488C732 474 810 470 876 488', 'M662 512C724 502 808 500 888 514', 'M666 534C730 528 806 530 878 538', 'M684 556C742 556 800 558 852 560', 'M712 574C756 576 796 576 826 574'];
var BRAIN_MAX = 240, BRAIN_C = [500, 300];

/* THE CORTEX'S FOLDS, drawn as a real brain's are: not a few strokes but a
   field of short meandering gyri, each turning back on itself, packed over
   the whole surface (the owner: "make the brain more realistic and good and
   stylish looking"). Worked out from Halton points like the neurons — the
   same every time — each a run of curved steps that swings left and right
   and stops at the brain's edge. */
function gyri() {
  var out = [], seeds = [], f = function (v) { return Math.round(v * 10) / 10; };
  for (var i = 1; i < 900 && out.length < 90; i++) {
    var x = 100 + halton(i, 5) * 800, y = 55 + halton(i, 7) * 455;
    if (!inPoly(x, y, CEREBRUM) || edgeDist(x, y, CEREBRUM) < 12) continue;
    if (seeds.some(function (q) { return Math.hypot(q[0] - x, q[1] - y) < 40; })) continue;
    seeds.push([x, y]);
    var a = halton(i, 11) * Math.PI * 2, d = 'M' + f(x) + ' ' + f(y), steps = 0;
    for (var k = 0; k < 6; k++) {
      var len = 20 + halton(i + k * 97, 13) * 14, turn = (k % 2 ? 1 : -1) * (0.5 + halton(i + k * 31, 3) * 0.7);
      var nx = x + Math.cos(a) * len, ny = y + Math.sin(a) * len;
      if (!inPoly(nx, ny, CEREBRUM) || edgeDist(nx, ny, CEREBRUM) < 8) break;
      var cx = (x + nx) / 2 - Math.sin(a) * len * 0.3 * (k % 2 ? 1 : -1), cy = (y + ny) / 2 + Math.cos(a) * len * 0.3 * (k % 2 ? 1 : -1);
      d += 'Q' + f(cx) + ' ' + f(cy) + ' ' + f(nx) + ' ' + f(ny);
      x = nx; y = ny; a += turn; steps++;
    }
    if (steps >= 2) out.push(d);
  }
  return out;
}
/* The finest folds: short arcs between the gyri, from their own Halton
   points (bases 3 and 11), each inside the cerebrum along its length. */
function fine() {
  var out = [], f = function (v) { return Math.round(v * 10) / 10; };
  for (var i = 1; i < 1600 && out.length < 150; i++) {
    var x = 100 + halton(i, 3) * 800, y = 55 + halton(i, 11) * 455, a = halton(i, 13) * Math.PI * 2, len = 9 + halton(i, 17) * 9;
    var x1 = x + Math.cos(a) * len, y1 = y + Math.sin(a) * len;
    if (!inPoly(x, y, CEREBRUM) || !inPoly(x1, y1, CEREBRUM) || edgeDist(x, y, CEREBRUM) < 8 || edgeDist(x1, y1, CEREBRUM) < 8) continue;
    var bend = (i % 2 ? 1 : -1) * len * 0.35, cx = (x + x1) / 2 - Math.sin(a) * bend, cy = (y + y1) / 2 + Math.cos(a) * bend;
    out.push('M' + f(x) + ' ' + f(y) + 'Q' + f(cx) + ' ' + f(cy) + ' ' + f(x1) + ' ' + f(y1));
  }
  return out;
}
/* The cerebellum's folia: fine arcs fanned round the point where it meets
   the stem, as it is drawn in an atlas (clipped to it where drawn), and a
   few long lines down the stem. */
function folia() {
  var out = [], ox = 640, oy = 512, f = function (v) { return Math.round(v * 10) / 10; };
  for (var r = 44; r <= 262; r += 12) {
    var a0 = -1.05, a1 = 1.05;
    out.push('M' + f(ox + Math.cos(a0) * r) + ' ' + f(oy + Math.sin(a0) * r * 0.8) + 'A' + r + ' ' + f(r * 0.8) + ' 0 0 1 ' + f(ox + Math.cos(a1) * r) + ' ' + f(oy + Math.sin(a1) * r * 0.8));
  }
  return out;
}
var STEM_LINES = ['M596 506C606 560 612 610 622 652', 'M622 500C628 560 634 610 640 652', 'M644 502C648 548 650 600 652 640'];

/* A smooth closed curve through the points (Catmull-Rom as cubic Béziers):
   the outline passes through every point it is given. */
function smoothPath(pts) {
  var n = pts.length, f = function (v) { return Math.round(v * 10) / 10; };
  var d = 'M' + f(pts[0][0]) + ' ' + f(pts[0][1]);
  for (var i = 0; i < n; i++) {
    var p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += 'C' + f(p1[0] + (p2[0] - p0[0]) / 6) + ' ' + f(p1[1] + (p2[1] - p0[1]) / 6) + ' ' +
      f(p2[0] - (p3[0] - p1[0]) / 6) + ' ' + f(p2[1] - (p3[1] - p1[1]) / 6) + ' ' + f(p2[0]) + ' ' + f(p2[1]);
  }
  return d + 'Z';
}
function inPoly(x, y, poly) {
  var inside = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function edgeDist(x, y, poly) {
  var best = Infinity;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var ax = poly[j][0], ay = poly[j][1], bx = poly[i][0], by = poly[i][1], dx = bx - ax, dy = by - ay;
    var t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}
function polyArea(poly) {
  var a = 0;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return Math.abs(a / 2);
}
function halton(i, b) { var f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }
/* n points inside the cerebrum, at least `gap` apart and half that from its
   edge; the gap narrows a tenth at a time until n fit. */
function place(n, gap) {
  var xs = CEREBRUM.map(function (p) { return p[0]; }), ys = CEREBRUM.map(function (p) { return p[1]; });
  var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
  for (var round = 0; round < 30; round++, gap *= 0.9) {
    var got = [], grid = {}, cell = function (a, b) { return Math.floor(a / gap) + ',' + Math.floor(b / gap); };
    for (var i = 1; i < 8000 && got.length < n; i++) {
      var x = x0 + halton(i, 2) * (x1 - x0), y = y0 + halton(i, 3) * (y1 - y0);
      if (!inPoly(x, y, CEREBRUM) || edgeDist(x, y, CEREBRUM) < gap * 0.5) continue;
      /* only the neighbouring cells of a gap-sized grid can hold a point too near */
      var clear = true, gx = Math.floor(x / gap), gy = Math.floor(y / gap);
      for (var ax = gx - 1; ax <= gx + 1 && clear; ax++) for (var ay = gy - 1; ay <= gy + 1 && clear; ay++) {
        (grid[ax + ',' + ay] || []).forEach(function (q) { if (Math.hypot(q[0] - x, q[1] - y) < gap) clear = false; });
      }
      if (clear) { got.push([x, y]); (grid[cell(x, y)] = grid[cell(x, y)] || []).push([x, y]); }
    }
    if (got.length >= n) return { pts: got, gap: gap };
  }
  return { pts: got, gap: gap };
}
var STATE_RANK = { weak: 0, fading: 1, solid: 2 };
/* The brain for the units (study.js masteryMap's shape): its neurons, its
   connections, and each unit's lobe. At most `max` neurons (BRAIN_MAX): a
   whole book opened chapter by chapter can pass that, and the rest is
   counted, not drawn. */
function brainLayout(units, max) {
  max = max || BRAIN_MAX;
  var list = [], shown = [], hidden = { units: 0, sections: 0 };
  (units || []).forEach(function (u) {
    var room = max - list.length, secs = u.sections || [];
    if (room <= 0 || !secs.length) { if (secs.length) { hidden.units++; hidden.sections += secs.length; } return; }
    var take = secs.slice(0, room);
    hidden.sections += secs.length - take.length;
    shown.push({ docId: u.docId, name: u.name, n: take.length });
    take.forEach(function (s) { list.push({ unit: shown.length - 1, docId: u.docId, s: s }); });
  });
  var n = list.length;
  if (!n) return { nodes: [], edges: [], units: [], gap: 0, hidden: hidden, counts: { total: 0, solid: 0, fading: 0, weak: 0, 'new': 0 } };
  var pl = place(n, Math.min(110, Math.sqrt(polyArea(CEREBRUM) / n) * 0.8)), gap = pl.gap;
  /* Lobes: the points in order round the brain from the frontal pole, over
     the top, and back underneath; each unit takes the next run of them. */
  var ang = function (p) { return Math.atan2(p[1] - BRAIN_C[1], p[0] - BRAIN_C[0]) + Math.PI; };
  var pts = pl.pts.slice(0, n).sort(function (a, b) { return ang(a) - ang(b); });
  var nodes = [], edges = [], lobes = [], at = 0, r = Math.max(5, Math.min(15, gap * 0.26));
  shown.forEach(function (u, k) {
    var mine = pts.slice(at, at + u.n); at += u.n;
    var cx = mine.reduce(function (a, p) { return a + p[0]; }, 0) / mine.length, cy = mine.reduce(function (a, p) { return a + p[1]; }, 0) / mine.length;
    /* its first section at the lobe's heart, the rest outward in order */
    mine.sort(function (a, b) { return Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy); });
    var first = nodes.length;
    list.filter(function (x) { return x.unit === k; }).forEach(function (x, j) {
      nodes.push({ x: Math.round(mine[j][0] * 10) / 10, y: Math.round(mine[j][1] * 10) / 10, r: r, key: x.docId + ':' + x.s.ci, docId: x.docId, ci: x.s.ci,
                   title: x.s.title, state: x.s.state, recall: x.s.recall == null ? null : x.s.recall, unit: k, order: j });
    });
    /* its wiring: the shortest tree joining its neurons (Prim), and a second
       nearest neighbour for each where it is close, so it reads as a net */
    var ids = []; for (var i = first; i < nodes.length; i++) ids.push(i);
    var dist = function (a, b) { return Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y); };
    var has = {}, add = function (a, b, kind) { var key = Math.min(a, b) + '-' + Math.max(a, b); if (has[key] || a === b) return; has[key] = true; edges.push({ a: a, b: b, kind: kind }); };
    var seen = {}, cost = {}, from = {}; seen[ids[0]] = true;
    ids.forEach(function (b) { cost[b] = dist(ids[0], b); from[b] = ids[0]; });
    for (var m = 1; m < ids.length; m++) {
      var next = null;
      ids.forEach(function (b) { if (!seen[b] && (next === null || cost[b] < cost[next])) next = b; });
      seen[next] = true; add(from[next], next, 'unit');
      ids.forEach(function (b) { if (!seen[b] && dist(next, b) < cost[b]) { cost[b] = dist(next, b); from[b] = next; } });
    }
    ids.forEach(function (a) {
      var near = ids.filter(function (b) { return b !== a; }).sort(function (b, c) { return dist(a, b) - dist(a, c); });
      if (near[1] != null && dist(a, near[1]) <= gap * 1.6) add(a, near[1], 'unit');
    });
    lobes.push({ docId: u.docId, name: u.name, x: Math.round(cx), y: Math.round(cy), n: u.n, first: first,
                 done: nodes.slice(first).filter(function (x) { return x.state !== 'new'; }).length });
  });
  /* the lobes wired to one another, first neuron to first neuron */
  for (var k = 1; k < lobes.length; k++) edges.push({ a: lobes[k - 1].first, b: lobes[k].first, kind: 'bridge' });
  edges.forEach(function (e) {
    var sa = nodes[e.a].state, sb = nodes[e.b].state;
    e.lit = (sa !== 'new' ? 1 : 0) + (sb !== 'new' ? 1 : 0);
    e.state = e.lit === 2 ? (STATE_RANK[sa] <= STATE_RANK[sb] ? sa : sb) : e.lit ? (sa !== 'new' ? sa : sb) : 'new';
  });
  var counts = { total: n, solid: 0, fading: 0, weak: 0, 'new': 0 };
  nodes.forEach(function (x) { counts[x.state] = (counts[x.state] || 0) + 1; });
  return { nodes: nodes, edges: edges, units: lobes, gap: Math.round(gap * 10) / 10, hidden: hidden, counts: counts };
}
/* The part of the drawing the brain fills: the viewBox the page uses. */
var BRAIN_VIEW = '70 34 862 640';
/* ── THE BRAIN, LIVE ───────────────────────────────────────────────────────
   The owner: "make the brain animated, live signals going on, glancing".
   The page runs this at the display's rate; everything here is the pure
   part, stepped with a clock and a random source handed in, so the suite can
   drive it for a simulated minute and count what happened.

   IMPULSES TRAVEL THE WIRING. A neuron fires; an impulse leaves it along its
   connections, at SPEED units a second, following the same curve the
   connection is drawn with (axonCtrl is shared with the page). Where one
   arrives, that neuron flashes, and may fire on in turn — never back the way
   the impulse came.

   WHAT IS KNOWN CARRIES A SIGNAL; WHAT IS NOT, BARELY. Whether a neuron
   passes an impulse on is its state's RELAY chance — high for a solid
   section, low for one not yet drilled — and each onward connection is taken
   at the PASS chance of the neuron at its far end. So a cascade runs through
   what you have learned and dies at the edge of what you have not. Neurons
   also fire on their own, every AMBIENT_MS or so, a lit one several times as
   often as a dark one (FIRE): a brain with nothing learned yet still flickers,
   faintly. MAX_SPARKS impulses at once at most. A tap fires a neuron down
   every connection it has. */
var LIVE = { SPEED: 240, MAX_SPARKS: 16, AMBIENT_MS: 420, FLASH_MS: 650,
  FIRE: { solid: 6, fading: 4, weak: 3, 'new': 1 },
  RELAY: { solid: 0.95, fading: 0.8, weak: 0.6, 'new': 0.15 },
  PASS: { solid: 0.7, fading: 0.55, weak: 0.45, 'new': 0.15 } };
/* A connection's bend: the control point of the curve it is drawn with. */
function axonCtrl(a, b, i) {
  var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y, bend = i % 2 ? 0.16 : -0.16;
  return { x: Math.round((mx - dy * bend) * 10) / 10, y: Math.round((my + dx * bend) * 10) / 10 };
}
function quad(a, c, b, t) {
  var u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}
/* Each neuron's connections, both ways, and each connection's length along
   its curve (twelve chords). */
function brainNet(L) {
  var adj = L.nodes.map(function () { return []; }), len = [], ctrl = [];
  L.edges.forEach(function (e, k) {
    var A = L.nodes[e.a], B = L.nodes[e.b], C = axonCtrl(A, B, k), n = 0, p = A;
    for (var i = 1; i <= 12; i++) { var q = quad(A, C, B, i / 12); n += Math.hypot(q.x - p.x, q.y - p.y); p = q; }
    ctrl.push(C); len.push(n);
    adj[e.a].push({ j: e.b, e: k }); adj[e.b].push({ j: e.a, e: k });
  });
  return { adj: adj, len: len, ctrl: ctrl };
}
function liveInit(L) {
  var tally = {};
  ['solid', 'fading', 'weak', 'new'].forEach(function (k) { tally[k] = { arrived: 0, relayed: 0, spont: 0 }; });
  return { net: brainNet(L), sparks: [], flash: {}, wait: LIVE.AMBIENT_MS * 0.3, fired: 0, tally: tally };
}
/* Neuron i fires. `from` is the neuron the impulse came from (-1 for none);
   `how` is 'arrive' (it relays at its state's chance), 'spont' (it fires on
   its own) or 'tap' (down every connection). */
function liveFire(st, L, i, rand, from, how) {
  var n = L.nodes[i];
  if (!n) return;
  st.flash[i] = LIVE.FLASH_MS; st.fired++;
  if (how === 'arrive') { st.tally[n.state].arrived++; if (rand() >= LIVE.RELAY[n.state]) return; st.tally[n.state].relayed++; }
  if (how === 'spont') st.tally[n.state].spont++;
  var sent = 0;
  st.net.adj[i].forEach(function (x) {
    if (x.j === from || st.sparks.length >= LIVE.MAX_SPARKS) return;
    if (how !== 'tap' && rand() >= LIVE.PASS[L.nodes[x.j].state]) return;
    st.sparks.push({ e: x.e, a: i, b: x.j, t: 0, len: st.net.len[x.e], state: n.state }); sent++;
  });
  if (how === 'tap') st.lastTap = { i: i, sent: sent };
}
function livePick(L, rand) {
  var total = 0, w = L.nodes.map(function (n) { return (total += LIVE.FIRE[n.state]); }), r = rand() * total;
  for (var i = 0; i < w.length; i++) if (r < w[i]) return i;
  return w.length - 1;
}
/* The brain `dt` seconds on: flashes fade, impulses move, those that arrive
   fire on, and now and then a neuron fires on its own. */
function liveStep(st, L, dt, rand) {
  if (!(dt > 0) || !L.nodes.length) return st;
  var ms = dt * 1000, arrived = [];
  Object.keys(st.flash).forEach(function (k) { st.flash[k] -= ms; if (st.flash[k] <= 0) delete st.flash[k]; });
  st.sparks = st.sparks.filter(function (s) { s.t += LIVE.SPEED * dt / Math.max(1, s.len); if (s.t >= 1) { arrived.push(s); return false; } return true; });
  arrived.forEach(function (s) { liveFire(st, L, s.b, rand, s.a, 'arrive'); });
  st.wait -= ms;
  if (st.wait <= 0) { st.wait = LIVE.AMBIENT_MS * (0.5 + rand()); liveFire(st, L, livePick(L, rand), rand, -1, 'spont'); }
  return st;
}
/* Where an impulse is, `back` of the way behind it (its tail), on the curve
   its connection is drawn with. */
function sparkAt(L, st, s, back) {
  var e = L.edges[s.e], t = Math.max(0, Math.min(1, s.t - (back || 0)));
  return quad(L.nodes[e.a], st.net.ctrl[s.e], L.nodes[e.b], s.a === e.a ? t : 1 - t);
}

var BRAIN = { W: BRAIN_W, H: BRAIN_H, VIEW: BRAIN_VIEW, CEREBRUM: CEREBRUM, CEREBELLUM: CEREBELLUM, STEM: STEM, SULCI: SULCI, FOLIA: folia(), GYRI: gyri(), FINE: fine(), STEM_LINES: STEM_LINES, MAX: BRAIN_MAX,
  cerebrum: smoothPath(CEREBRUM), cerebellum: smoothPath(CEREBELLUM), stem: smoothPath(STEM) };

/* ── A UNIT'S CONTENTS ─────────────────────────────────────────────────────
   Words a PDF's text layer ran together ("ValveDiseaseBasics"), set
   apart for display. Only a long run (16 letters or more) with at least two
   capitals inside is touched, so "McDonald" and "iPad" are left alone; a
   glued "and" between two names is set apart too. "CHAPTER1" is written
   "Chapter 1". What is stored is not changed. */
function unglue(t) {
  return String(t == null ? '' : t).replace(/[A-Za-z]{16,}/g, function (w) {
    if ((w.match(/[a-z][A-Z]/g) || []).length < 2) return w;
    return w.replace(/([a-z])and([A-Z])/g, '$1 and $2').replace(/([a-z])([A-Z])/g, '$1 $2');
  }).replace(/\b(CHAPTER|SECTION|PART)\s*(\d+|[IVXL]+)\b/g, function (_, k, n) { return k.charAt(0) + k.slice(1).toLowerCase() + ' ' + n; });
}
/* A unit's sections as its contents: a run of sections that share a
   heading ("heading: sub-heading", as chunk.js titles them) is one chapter,
   each named by what follows its heading; a section titled with the heading
   alone, just before them, is the chapter's opening. Any other section
   stands alone. Positions are kept (i), so a row opens its own section. */
function outline(titles) {
  var out = [];
  (titles || []).forEach(function (t, i) {
    t = String(t);
    var at = t.indexOf(': '), major = at > 0 ? t.slice(0, at) : '', last = out[out.length - 1];
    if (!major && i + 1 < titles.length && String(titles[i + 1]).indexOf(t + ': ') === 0) {
      out.push({ key: t, title: unglue(t), items: [{ i: i, label: 'Opening' }] });
      return;
    }
    if (major && last && last.key === major) { last.items.push({ i: i, label: unglue(t.slice(at + 2)) }); return; }
    out.push(major ? { key: major, title: unglue(major), items: [{ i: i, label: unglue(t.slice(at + 2)) }] }
                   : { key: null, title: null, items: [{ i: i, label: unglue(t) }] });
  });
  return out;
}

/* ── ICONS BY TOPIC, as Systole's chapters carry them ──────────────────────
   A unit or chapter gets the icon of the first topic its title names, in
   this order — the more particular first ("Systemic Hypertension" is blood
   pressure, not "systemic"; "Heart Failure" before plain "heart"). None
   named: the clipboard. The icons themselves are drawn by ui.js. */
var TOPICS = [
  ['pressure', /\b(?:hyper|hypo)tension|blood pressure/i],
  ['rhythm', /arrhythm|rhythm|electrophysiol|conduction|pac(?:ing|emaker)|tachy|brady|fibrillation|ecg|electrocardiog/i],
  ['congenital', /congenital|p(?:a)?ediatric|fetal|child/i],
  ['coronary', /coronary|isch(?:a)?emi|infarct|angina|atheroscl/i],
  ['heart', /heart failure|cardiomyopath|myocardi/i],
  ['pericardium', /pericardi/i],
  ['lungs', /pulmonar|lung|respirat/i],
  ['valves', /valv|stenosis|regurgitation|endocarditis/i],
  ['vessels', /vascular|aort|vessel|venous|thrombo|embol/i],
  ['drugs', /pharmac|drug|medication/i],
  ['imaging', /imaging|echocardiog|\bct\b|\bmri\b|nuclear/i],
  ['systemic', /systemic|general|physical exam/i],
];
function topicOf(title) {
  var t = String(title || '');
  for (var i = 0; i < TOPICS.length; i++) if (TOPICS[i][1].test(t)) return TOPICS[i][0];
  return 'misc';
}
/* A short name for a round icon's label: "Chapter 3 Valvular Heart
   Disease" → "Valvular Heart", at most two words and 16 letters. */
function shortName(title) {
  var w = unglue(title).replace(/^\s*(?:chapter|section|part|unit)\s+(?:\d+|[ivxl]+)\b[.:\s-]*/i, '').split(/\s+/).filter(Boolean)
    .filter(function (x, i) { return i === 0 || !/^(?:diseases?|disorders?|topics?|syndromes?)$/i.test(x); });
  var two = w.slice(0, 2).join(' ').replace(/[,:;&]+$/, '');
  if (!w[1] || /^(?:and|of|the|&|in|with)$/i.test(w[1]) || two.length > 14) two = w[0] || '';
  return two.length > 14 ? two.slice(0, 13) + '…' : two || String(title || '').slice(0, 14);
}

var MemHome = { BRAIN: BRAIN, brainLayout: brainLayout, LIVE: LIVE, axonCtrl: axonCtrl, brainNet: brainNet, liveInit: liveInit, liveFire: liveFire, liveStep: liveStep, sparkAt: sparkAt, smoothPath: smoothPath, inPoly: inPoly, edgeDist: edgeDist, pearlVisual: pearlVisual, recallParts: recallParts, recallStreak: recallStreak, PEARL_ROWS: PEARL_ROWS, unitPct: unitPct, sectionPct: sectionPct, started: started, recent: recent, nextTitle: nextTitle, streak: streak,
  HELD: HELD, WEAK: WEAK, weakSpots: weakSpots, greeting: greeting, studiedOf: studiedOf, isHeld: isHeld, progress: progress, current: current,
  notesOf: notesOf, harvest: harvest, readout: readout, leans: leans, seeded: seeded, pearlOf: pearlOf, pageOf: pageOf, headingOf: headingOf, marks: marks, count: count, tracePath: tracePath, unglue: unglue, outline: outline, topicOf: topicOf, shortName: shortName, TOPICS: TOPICS };
root.MemHome = MemHome;
if (typeof module !== 'undefined' && module.exports) module.exports = MemHome;
})(typeof window !== 'undefined' ? window : this);
