/* ═══════════════════════════════════════════════════════════════════════════
   notesearch.js — find a note by what is in it.

   WHY THIS EXISTS. The shelf holds hundreds of notes and, until this, nothing
   on the device could search them. The top-bar search answers from the
   question bank only; the Notes screen lists everything with no filter; Apex
   reaches the notes, but only by being asked a question. A fellow who wanted
   "the sotalol note" had no way to get to it. The owner found this on an iPad,
   typing "sotalol" into the question search and getting "0 matches".

   The question search could not simply learn to show notes: its code lives in
   the licensed export, which this repository does not read (CLAUDE.md), and no
   earlier step had ever anchored into it. So the notes get a search of their
   own — a screen built entirely from what the chain already provides: the
   app's own search() index, which already holds every note as kind 'r', and
   md(), which already renders a note's figures.

   WHAT THIS MODULE DOES. Everything that decides something, as plain
   functions of their inputs: which notes answer a query and in what order,
   which words to show around the match, and the markup. No DOM, no globals —
   the app's search(), escaper and md() are passed in — so all of it is held by
   tests/verify-notesearch-pure.js without a browser or a build.

   ONE RANKING CHANGE, AND WHY. search() ranks by BM25 over whole notes, so a
   note that MENTIONS sotalol four times can outrank the note whose section is
   ABOUT sotalol (tools/search-probe.js showed exactly that: "Drug choice for AF
   by heart substrate" first, "Sotalol: reverse use dependence…" second). For a
   search box, the note titled with every word typed is the one being looked
   for. So those move to the front, in search()'s own order; everything else
   keeps search()'s order behind them. Nothing is dropped and nothing is added.

   Safari 13.4 is the floor (README): no optional chaining, no nullish
   coalescing, no lookbehind. tests/verify-ipad-pure.js scans for them.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var MIN_QUERY = 2;        // one character matches everything and helps nobody
var MAX_RESULTS = 25;     // a result list longer than a screenful is a list nobody reads
var SNIPPET = 170;        // characters of context around the first match

/* "Arrhythmias · Therapy — Sotalol: reverse use dependence…" → chapter and
   section, split on the em dash the importer and refs-patch both put there. */
function splitTitle(title) {
  var t = String(title || '');
  var i = t.indexOf(' — ');
  return i < 0 ? { chapter: '', section: t } : { chapter: t.slice(0, i), section: t.slice(i + 3) };
}

/* The words of a query worth matching on: lower-cased, split on anything that
   is not a letter or digit, and at least three characters so "of" and "in" do
   not light up every line of every snippet. */
function words(query) {
  return String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length >= 3; });
}

/* A note body as the reader sees it, for quoting: figures and markup gone. */
function plain(body) {
  return String(body || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[*_`#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Which notes, in which order. hits come from the app's search() and are
   filtered to notes (kind 'r'); byId resolves them against the live shelf, so
   a note deleted since the index was built is skipped rather than shown. */
function results(query, notes, searchFn, max) {
  var q = String(query || '').trim();
  if (q.length < MIN_QUERY || typeof searchFn !== 'function') return [];
  var byId = {};
  (notes || []).forEach(function (n) { if (n && n.id != null) byId[n.id] = n; });
  var hits;
  try { hits = searchFn(q, { limit: 80 }) || []; } catch (_) { hits = []; }
  var seen = {}, ordered = [];
  hits.forEach(function (h) {
    var m = h && h.meta;
    if (!m || m.kind !== 'r' || seen[m.id] || !byId[m.id]) return;
    seen[m.id] = true;
    ordered.push(byId[m.id]);
  });
  var ws = words(q);
  var titled = [], rest = [];
  ordered.forEach(function (n) {
    var sec = splitTitle(n.title).section.toLowerCase();
    var all = ws.length > 0 && ws.every(function (w) { return sec.indexOf(w) > -1; });
    (all ? titled : rest).push(n);
  });
  return titled.concat(rest).slice(0, max || MAX_RESULTS);
}

/* Up to SNIPPET characters of the body around the first word of the query
   that appears in it — or the opening of the note when none does, which
   happens when a note matched on its title or tags alone. */
function snippet(body, query) {
  var text = plain(body);
  var low = text.toLowerCase();
  var ws = words(query), at = -1;
  for (var i = 0; i < ws.length; i++) {
    var k = low.indexOf(ws[i]);
    if (k > -1 && (at < 0 || k < at)) at = k;
  }
  if (at < 0 || text.length <= SNIPPET) return text.slice(0, SNIPPET) + (text.length > SNIPPET ? '…' : '');
  var start = Math.max(0, at - Math.floor(SNIPPET / 3));
  var cut = text.slice(start, start + SNIPPET);
  return (start > 0 ? '…' : '') + cut + (start + SNIPPET < text.length ? '…' : '');
}

/* Escape FIRST, then mark. The words are escaped the same way before they are
   searched for, so a query containing markup can only ever match escaped text
   and the <mark> tags are the only tags this adds. */
function highlight(text, query, esc) {
  /* Entities are left whole: a query of "amp" or "quot" would otherwise mark
     the inside of &amp; or &quot; and leave broken markup on screen. */
  var parts = esc(text).split(/(&[a-z0-9#]+;)/i);
  /* One pass for all the words, longest first, so a later word can never land
     inside a <mark> an earlier one inserted. */
  var ws = words(query).sort(function (a, b) { return b.length - a.length; })
    .map(function (w) { return esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
  if (!ws.length) return parts.join('');
  var re = new RegExp('(' + ws.join('|') + ')', 'gi');
  for (var i = 0; i < parts.length; i += 2) parts[i] = parts[i].replace(re, '<mark>$1</mark>');
  return parts.join('');
}

function resultsHtml(query, list, total, esc) {
  var q = String(query || '').trim();
  if (q.length < MIN_QUERY) {
    return '<p class="ns-hint">Type a drug, trial, sign or syndrome to search your ' +
      esc(String(total)) + ' notes.</p>';
  }
  if (!list.length) {
    return '<p class="ns-hint">No note matched <b>' + esc(q) + '</b>. ' +
      'The index matches words, not meaning — try a shorter or broader term.</p>';
  }
  return '<p class="ns-count">' + list.length + (list.length === 1 ? ' note' : ' notes') + '</p>' +
    '<ul class="ns-list">' + list.map(function (n) {
      var t = splitTitle(n.title);
      return '<li><button class="ns-hit" data-ns-open="' + esc(String(n.id)) + '">' +
        (t.chapter ? '<span class="ns-chapter">' + esc(t.chapter) + '</span>' : '') +
        '<span class="ns-title">' + highlight(t.section, q, esc) + '</span>' +
        '<span class="ns-snippet">' + highlight(snippet(n.body, q), q, esc) + '</span>' +
        '</button></li>';
    }).join('') + '</ul>';
}

/* One note, whole. The body goes through the app's own md(), which is what
   renders a refimg:// citation as its figure, and sits inside .ref-body so it
   takes the same figure styling it has on the Notes screen. */
function noteHtml(note, esc, md, icon) {
  var t = splitTitle(note.title);
  var ic = typeof icon === 'function' ? icon : function () { return ''; };
  return '<div class="ns-note">' +
    '<button class="ns-back" data-ns-back="1">' + ic('arrow-left') + ' Results</button>' +
    (t.chapter ? '<p class="ns-chapter">' + esc(t.chapter) + '</p>' : '') +
    '<h2 class="ns-note-title">' + esc(t.section) + '</h2>' +
    (note.source ? '<p class="ns-source">' + esc(note.source) + '</p>' : '') +
    '<div class="ref-body">' + md(String(note.body || '')) + '</div>' +
    '</div>';
}

function screenHtml(state, notes, searchFn, esc, md, icon) {
  var shelf = notes || [];
  var open = null;
  if (state.open != null) {
    for (var i = 0; i < shelf.length; i++) if (shelf[i] && String(shelf[i].id) === String(state.open)) { open = shelf[i]; break; }
  }
  var body = open ? noteHtml(open, esc, md, icon)
    : '<div class="ns-bar"><input class="ns-q" data-ns-q="1" type="search" autocomplete="off" ' +
        'autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" ' +
        'placeholder="Search your notes" aria-label="Search your notes" value="' + esc(state.q || '') + '"></div>' +
      '<div class="ns-out" aria-live="polite">' +
        resultsHtml(state.q, results(state.q, shelf, searchFn), shelf.length, esc) + '</div>';
  return '<section class="ns-screen" aria-label="Search your notes">' + body + '</section>';
}

root.NoteSearch = { splitTitle: splitTitle, words: words, plain: plain, results: results,
                    snippet: snippet, highlight: highlight, resultsHtml: resultsHtml,
                    noteHtml: noteHtml, screenHtml: screenHtml,
                    MIN_QUERY: MIN_QUERY, MAX_RESULTS: MAX_RESULTS };
})(typeof window !== 'undefined' ? window : this);
