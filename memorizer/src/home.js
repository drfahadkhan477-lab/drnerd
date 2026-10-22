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

/* The brain (the mastery map as a mind that lights up: its geometry, the
   layout of neurons in lobes and its live activity) is src/core/brain.js,
   shared with Systole's Brain page; its names are re-exported unchanged. */
var BrainMap = root.BrainMap || (typeof require === 'function' ? require('../../src/core/brain.js') : null);
var BRAIN = BrainMap.BRAIN, brainLayout = BrainMap.brainLayout, LIVE = BrainMap.LIVE, axonCtrl = BrainMap.axonCtrl, brainNet = BrainMap.brainNet,
  liveInit = BrainMap.liveInit, liveFire = BrainMap.liveFire, liveStep = BrainMap.liveStep, sparkAt = BrainMap.sparkAt,
  smoothPath = BrainMap.smoothPath, inPoly = BrainMap.inPoly, edgeDist = BrainMap.edgeDist;

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

/* What to do now, on a unit's page (the owner's review): one next step and
   why. Items missed and not yet put right come first once there are
   REVIEW_FIRST of them, because a miss left alone is the one forgotten;
   then the next section to learn; then, with every section drilled, the
   exam. weakN: items pending review (session.js pending). */
/* A backup reminder on the home screen: due when there is anything to lose
   and no backup yet, or the last is BACKUP_EVERY days old; "Later" puts it
   off for the day. days(a, b): whole days from ISO date a to b. */
var BACKUP_EVERY = 7;
function backupDue(unitsN, lastDay, snoozeDay, today, days) {
  if (!unitsN || snoozeDay === today) return { due: false };
  if (!lastDay) return { due: true, why: 'You have not backed up yet. Everything you have studied lives only on this device.' };
  var d = days(lastDay, today);
  return d >= BACKUP_EVERY ? { due: true, why: 'Your last backup was ' + d + ' days ago.' } : { due: false };
}

var REVIEW_FIRST = 3;
function nextStep(n, doneN, weakN, nextTitle, examScore) {
  if (weakN >= REVIEW_FIRST) return { kind: 'review', why: count(weakN, 'item') + ' you missed ' + (weakN === 1 ? 'is' : 'are') + ' waiting to be put right. A short review round first, while they are fresh.' };
  if (doneN >= n) return { kind: 'exam', why: examScore == null ? 'Every section is drilled. The final exam mixes the whole unit, weighted to your weakest sections.' : 'Every section is drilled. Retake the exam to see what has held.' };
  return { kind: doneN ? 'continue' : 'start', why: (doneN ? 'Next in order: ' : 'Start with ') + '\u201C' + nextTitle + '\u201D \u2014 learn it, memorise it, then drill it.' };
}

var MemHome = { BRAIN: BRAIN, brainLayout: brainLayout, LIVE: LIVE, axonCtrl: axonCtrl, brainNet: brainNet, liveInit: liveInit, liveFire: liveFire, liveStep: liveStep, sparkAt: sparkAt, smoothPath: smoothPath, inPoly: inPoly, edgeDist: edgeDist, pearlVisual: pearlVisual, recallParts: recallParts, recallStreak: recallStreak, PEARL_ROWS: PEARL_ROWS, unitPct: unitPct, sectionPct: sectionPct, started: started, recent: recent, nextTitle: nextTitle, streak: streak,
  HELD: HELD, WEAK: WEAK, weakSpots: weakSpots, greeting: greeting, studiedOf: studiedOf, isHeld: isHeld, progress: progress, current: current,
  notesOf: notesOf, harvest: harvest, readout: readout, leans: leans, seeded: seeded, pearlOf: pearlOf, pageOf: pageOf, headingOf: headingOf, marks: marks, count: count, tracePath: tracePath, unglue: unglue, outline: outline, topicOf: topicOf, shortName: shortName, TOPICS: TOPICS, REVIEW_FIRST: REVIEW_FIRST, nextStep: nextStep, BACKUP_EVERY: BACKUP_EVERY, backupDue: backupDue };
root.MemHome = MemHome;
if (typeof module !== 'undefined' && module.exports) module.exports = MemHome;
})(typeof window !== 'undefined' ? window : this);
