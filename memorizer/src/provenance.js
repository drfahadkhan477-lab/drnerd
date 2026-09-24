/* ═══════════════════════════════════════════════════════════════════════════
   provenance.js — where a unit came from, and how well it was read.

   Everything Memorizer teaches is your document's own text, so the one
   question worth answering about any of it is: which document, which page,
   and was that page read cleanly? This module keeps that answer with the
   unit and says it plainly:

     · fingerprint(bytes|text) — a SHA-256 of exactly what was imported, so
       the same PDF added twice is recognised as the same PDF (and opened,
       with its progress, instead of starting a second copy from nothing),
       and a unit can be matched to its file later. When the browser has no
       Web Crypto (an old WebView, a non-secure origin), a 64-bit FNV-1a is
       used instead and labelled as such — an identity check, never a
       security one, and never passed off as SHA-256.
     · report(doc) — the import-quality report: how many pages had a text
       layer, which were read by text recognition, which could not be read
       at all and so are in no section, and what was found (sections,
       figures, tables). Counts, not a score: a percentage "quality" would
       claim a precision nothing here measured.
     · ocrPagesIn(doc, cluster) — the pages of one section that came from
       text recognition, so the lesson can say "check this against the page"
       where it applies, instead of only on the home screen.

   PURE, apart from fingerprint()'s use of crypto.subtle, which is handed in
   so the suite can drive both paths.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

function hex(buf) {
  var b = new Uint8Array(buf), s = '';
  for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
  return s;
}
function bytesOf(input) {
  if (typeof input === 'string') {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(input);
    var out = new Uint8Array(input.length);
    for (var i = 0; i < input.length; i++) out[i] = input.charCodeAt(i) & 255;
    return out;
  }
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(input);
}
/* 64-bit FNV-1a as two 32-bit halves (hi seeded differently), for when
   there is no SubtleCrypto. Math.imul keeps the multiply in 32 bits. */
function fnv(bytes) {
  var h1 = 0x811c9dc5, h2 = 0x050c5d1f;
  for (var i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ bytes[i], 0x01000193) >>> 0;
  }
  return ('0000000' + h1.toString(16)).slice(-8) + ('0000000' + h2.toString(16)).slice(-8);
}
/* → Promise<'sha256:<64 hex>'> or 'fnv1a64:<16 hex>'. */
function fingerprint(input, subtle) {
  var bytes = bytesOf(input);
  var G = typeof globalThis !== 'undefined' ? globalThis : root;
  var s = subtle === undefined ? (G.crypto && G.crypto.subtle) : subtle;
  if (s && s.digest) {
    return s.digest('SHA-256', bytes).then(function (d) { return 'sha256:' + hex(d); }, function () { return 'fnv1a64:' + fnv(bytes); });
  }
  return Promise.resolve('fnv1a64:' + fnv(bytes));
}
/* The short form shown to a person: the method and the first 12 digits. */
function shortPrint(fp) {
  var m = /^([a-z0-9]+):([0-9a-f]+)$/.exec(fp || '');
  return m ? m[1].replace('sha256', 'SHA-256').replace('fnv1a64', 'FNV-1a') + ' ' + m[2].slice(0, 12) : '';
}

/* A unit already on this device from the same bytes: a standalone unit
   only — a book's chapters share their book's parts and are matched by the
   book, not here. */
function duplicateOf(docs, fp) {
  if (!fp) return null;
  return (docs || []).filter(function (d) { return !d.bookId && d.fingerprint === fp; })[0] || null;
}

function inRange(list, a, b) { return (list || []).filter(function (n) { return n >= a && n <= b; }); }
function ocrPagesIn(doc, c) {
  if (!doc || !c) return [];
  return inRange(doc.ocr, c.pageStart, c.pageEnd);
}
function pageList(ns) {
  ns = ns || [];
  return ns.slice(0, 12).join(', ') + (ns.length > 12 ? '… (' + ns.length + ' in all)' : '');
}
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

/* The import-quality report. Photos and pasted text have no text layer to
   speak of: photos are all text recognition, pasted text is all typed. */
function report(doc) {
  var d = doc || {};
  var first = d.bookId ? d.pageStart : 1, last = d.bookId ? d.pageEnd : d.pages || 0;
  var pages = Math.max(0, last - first + 1);
  var noText = inRange(d.scanned, first, last), ocr = inRange(d.ocr, first, last);
  var clusters = d.clusters || [];
  var tables = 0;
  clusters.forEach(function (c) { (c.segments || []).forEach(function (s) { if (s.table && !s.tableHeader) tables++; }); });
  var figures = Array.isArray(d.figures) ? d.figures.length : null;
  var words = clusters.reduce(function (n, c) { return n + (c.words || 0); }, 0);
  /* A unit stored before `source` was recorded came from a PDF: photos and
     pasted text arrived with it. */
  var isPdf = !d.source || d.source === 'pdf';
  var textLayer = isPdf ? Math.max(0, pages - noText.length - ocr.length) : null;
  var lines = [];
  if (d.source === 'text') lines.push({ kind: 'ok', text: 'Typed or pasted text: nothing had to be recognised.' });
  else if (d.source === 'photo') lines.push({ kind: 'check', text: 'Every photo was read by text recognition. Check anything surprising against the page.' });
  else {
    lines.push({ kind: noText.length || ocr.length ? 'info' : 'ok', text: textLayer + ' of ' + plural(pages, 'page') + ' read from the PDF’s own text.' });
    if (ocr.length) lines.push({ kind: 'check', text: plural(ocr.length, 'page') + ' read by text recognition (' + pageList(ocr) + '). Check anything surprising against the page.' });
    if (noText.length) lines.push({ kind: 'bad', text: plural(noText.length, 'page') + ' with no readable text (' + pageList(noText) + '): not in any section' + (d.ocrError ? ' — the text reader could not run (' + d.ocrError + ').' : '.') });
  }
  lines.push({ kind: 'info', text: [plural(clusters.length, 'section'), plural(words, 'word'),
    figures == null ? 'figures found when first opened' : plural(figures, 'figure'), plural(tables, 'table')].join(' · ') });
  var verdict = noText.length ? (noText.length * 10 > pages ? 'poor' : 'check') : ocr.length || d.source === 'photo' ? 'check' : 'good';
  return {
    pages: pages, textLayer: textLayer, ocr: ocr, noText: noText, sections: clusters.length, words: words, figures: figures, tables: tables,
    verdict: verdict,
    label: { good: 'Read cleanly', check: 'Read, with pages to check', poor: 'Much of it could not be read' }[verdict],
    lines: lines,
  };
}

var api = { fingerprint: fingerprint, shortPrint: shortPrint, fnv: fnv, duplicateOf: duplicateOf, ocrPagesIn: ocrPagesIn, report: report, pageList: pageList };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.MemProvenance = api;
})(typeof window !== 'undefined' ? window : this);
