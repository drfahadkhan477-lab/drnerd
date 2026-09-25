/* ═══════════════════════════════════════════════════════════════════════════
   book.js — a whole textbook, from its PDFs to its chapters.

   PURE. A book arrives as one PDF or several (a 1,500-page textbook is often
   split into parts: "…_1-500.pdf", "…_501-1000.pdf" …). The parts are put in
   order, their pages numbered straight through, and the book is cut into
   chapters; each chapter then becomes a unit of its own, split into sections
   by chunk.js as any PDF is, and taught, drilled and examined as one.

   Chapters are found three independent ways, because no one of them works on
   every PDF and this code never sees the owner's:
     · outline  — the PDF's own bookmarks, at the level that looks like
                  chapters;
     · numbered — lines that say "Chapter 12 …", on openers and on running
                  headers alike;
     · size     — the heading size that opens chapters: the one that gives the
                  most of them while they still average a few pages.
   Each is scored; the best is used and the others are offered, so the owner
   can switch when the first guess is wrong. A method that finds too few, or
   finds them only in part of the book, is not preferred.

   Chapters are found on the RAW pages, before chunk.js drops running headers:
   it drops a line repeated on more than half the pages it is given, which a
   chapter's running header is within its chapter and is not across a whole
   book. So each chapter's pages go to chunk.js on their own.

   tests/verify-memorizer-book-pure.js holds all of it.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var Chunk = root.MemChunk || (typeof require === 'function' ? require('./chunk.js') : null);

/* A method must find at least this many chapters to be preferred. */
var MIN_CHAPTERS = 3;
/* …and its chapters must reach this far into the book (first to last start,
   as a share of the pages): split PDFs often keep bookmarks for only one
   part, and one part's chapters are not the book's. */
var MIN_COVERAGE = 0.5;
/* Chapters that average fewer pages than this are sections, not chapters. */
var MIN_MEAN_PAGES = 4;
/* An outline level whose entries average more pages than this is parts,
   not chapters. */
var MAX_MEAN_PAGES = 60;
/* With nothing found, the book is cut every this many pages. */
var FALLBACK_PAGES = 20;
/* A "Chapter 12 …" line longer than this is running text ("Chapter 12
   describes …"), not a header or an opener. */
var NUMBERED_MAX_WORDS = 14;

var CHAPTER_LINE = /^(?:chapter|chap\.|ch\.)\s*(\d{1,3})\b\s*[.:—–-]?\s*(.*)$/i;

function words(t) { return String(t || '').split(/\s+/).filter(Boolean); }
function clean(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }

/* Parts in reading order: by the first number in each name ("Topol_1-500",
   "Topol_501-1000", "Topol_1001_-_1500", "Topol_1501"), then by name.
   Returns the indices of `names` in that order. */
function orderParts(names) {
  var idx = (names || []).map(function (_, i) { return i; });
  var num = function (s) { var m = /(\d+)/.exec(String(s)); return m ? +m[1] : Infinity; };
  idx.sort(function (a, b) { return num(names[a]) - num(names[b]) || String(names[a]).localeCompare(String(names[b])) || a - b; });
  return idx;
}

/* Where a book page lives: parts are [{ fileId, first, last }] in book
   pages. Returns { fileId, page } with the page number inside that file. */
function locate(parts, page) {
  for (var i = 0; i < (parts || []).length; i++) {
    var p = parts[i];
    if (page >= p.first && page <= p.last) return { fileId: p.fileId, page: page - p.first + 1 };
  }
  return null;
}

function bodySizeOf(pages) {
  var sizes = [];
  pages.forEach(function (p) {
    (p.lines || []).forEach(function (l) {
      var n = Math.min(String(l.text || '').length, 200);
      for (var i = 0; i < n; i++) sizes.push(+l.size || 0);
    });
  });
  if (!sizes.length) return 1;
  sizes.sort(function (a, b) { return a - b; });
  return sizes[Math.floor(sizes.length / 2)] || 1;
}

/* A chapter's title from its opening page: the given text if it reads as
   words (Chunk.wordy — not a line recognition garbled), else the biggest
   such line on the page that is not the "Chapter N" line. */
function titleOn(page, given, skip) {
  var t = clean(given).replace(/\s+\d{1,4}$/, '');
  if (Chunk.wordy(t)) return t;
  var best = null;
  (page.lines || []).forEach(function (l) {
    var s = clean(l.text);
    if (!s || s === skip || !Chunk.wordy(s) || words(s).length > 16) return;
    if (!best || (+l.size || 0) > (+best.size || 0)) best = l;
  });
  return best ? clean(best.text) : '';
}

/* A "Chapter N" line whose title runs on: it stops on a word that cannot
   end a title ("…, Pulmonary Valve Disease, and") and the next lines, at
   its size, finish it ("Drug-Induced Valve Disease"). The owner's first
   whole book: the continuation was left behind when the "Chapter 17" line
   was taken out, and titled the chapter's first section. Returns how many
   lines after line j continue it. */
var DANGLING = /(?:,|\b(?:and|or|of|the|in|for|with|to|on|from|&))\s*$/i;
function runsOn(lines, j) {
  var n = 0, prev = lines[j];
  while (DANGLING.test(clean(prev.text)) && lines[j + n + 1] && Math.abs((+lines[j + n + 1].size || 0) - (+prev.size || 0)) < 0.5) {
    n++; prev = lines[j + n];
  }
  return n;
}

/* ── numbered: "Chapter 12 …" lines ─────────────────────────────────────── */
function numbered(pages) {
  var hits = [];
  pages.forEach(function (p) {
    var seen = {};
    (p.lines || []).forEach(function (l, j, all) {
      var s = clean(l.text), m = CHAPTER_LINE.exec(s);
      if (!m || words(s).length > NUMBERED_MAX_WORDS || seen[m[1]]) return;
      seen[m[1]] = true;
      var more = runsOn(all, j);
      for (var k = 1; k <= more; k++) m[2] += ' ' + clean(all[j + k].text);
      hits.push({ n: +m[1], page: p.page, rest: m[2], line: s, p: p });
    });
  });
  if (!hits.length) return [];
  hits.sort(function (a, b) { return a.page - b.page || a.n - b.n; });
  /* The longest run in which the number and the page both go up: running
     headers repeat a number (only one of them can be in the run), and a
     cross-reference out of place breaks the run it would join. */
  var len = hits.map(function () { return 1; }), prev = hits.map(function () { return -1; });
  for (var i = 0; i < hits.length; i++) {
    for (var j = 0; j < i; j++) {
      if (hits[j].n < hits[i].n && hits[j].page < hits[i].page && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
    }
  }
  var end = 0;
  for (var k = 1; k < hits.length; k++) if (len[k] > len[end]) end = k;
  /* Ties go to the earliest hit, at the end of the run and at every link of
     it (the loops take the first of equals), so each chapter starts at the
     first page that says its number: its opener, not a later running
     header. */
  var chain = [];
  for (var c = end; c !== -1; c = prev[c]) chain.unshift(hits[c]);
  return chain.map(function (h) { return { title: titleOn(h.p, h.rest, h.line), start: h.page, n: h.n }; });
}

/* A chapter's pages without its "Chapter N …" lines: running headers, and
   the number above an opener's title (the title is a line of its own and
   stays). chunk.js drops a running header repeated on most of the pages it
   is given, but only from three pages up — and a two-page chapter's header
   reached its sections. A long line that starts "Chapter N" is prose and
   stays. */
function stripHeaders(pages) {
  return (pages || []).map(function (p) {
    var drop = {}, all = p.lines || [];
    all.forEach(function (l, j) {
      var s = clean(l.text);
      if (!(CHAPTER_LINE.test(s) && words(s).length <= NUMBERED_MAX_WORDS)) return;
      drop[j] = true;
      /* and the lines its title runs on to */
      for (var k = 1, more = runsOn(all, j); k <= more; k++) drop[j + k] = true;
    });
    return { page: p.page, lines: all.filter(function (l, j) { return !drop[j]; }) };
  });
}

/* ── size: the heading size that opens chapters ─────────────────────────── */
function bySize(pages) {
  var body = bodySizeOf(pages);
  var tops = [];                         /* per page, its big short lines */
  var sizes = {};
  pages.forEach(function (p) {
    var big = (p.lines || []).filter(function (l) {
      var s = clean(l.text);
      return (+l.size || 0) >= body * 1.5 && s && words(s).length <= 12 && Chunk.wordy(s);
    });
    big.forEach(function (l) { sizes[Math.round(+l.size)] = true; });
    tops.push({ p: p, big: big });
  });
  var best = null;
  Object.keys(sizes).map(Number).forEach(function (s) {
    var starts = [];
    tops.forEach(function (t) {
      var at = t.big.filter(function (l) { return Math.round(+l.size) >= s; });
      if (!at.length) return;
      if (starts.length && t.p.page - starts[starts.length - 1].start < 2) return;   /* a two-page opener */
      var top = Math.max.apply(null, at.map(function (l) { return Math.round(+l.size); }));
      var title = at.filter(function (l) { return Math.round(+l.size) === top; }).map(function (l) { return clean(l.text); }).join(' ');
      starts.push({ title: title, start: t.p.page });
    });
    if (starts.length < MIN_CHAPTERS) return;
    var gaps = starts.slice(1).map(function (x, i) { return x.start - starts[i].start; }).sort(function (a, b) { return a - b; });
    var median = gaps[Math.floor(gaps.length / 2)];
    if (median < MIN_MEAN_PAGES) return;
    if (!best || starts.length > best.length) best = starts;
  });
  return best || [];
}

/* ── outline: the bookmark level that looks like chapters ───────────────── */
function fromOutline(entries, total) {
  var byDepth = {};
  (entries || []).forEach(function (e) { (byDepth[e.depth] = byDepth[e.depth] || []).push(e); });
  var depths = Object.keys(byDepth).map(Number).sort(function (a, b) { return a - b; });
  var levels = depths.map(function (d) {
    var seen = {}, list = [];
    byDepth[d].slice().sort(function (a, b) { return a.page - b.page; }).forEach(function (e) {
      if (!seen[e.page]) { seen[e.page] = true; list.push({ title: clean(e.title), start: e.page }); }
    });
    var named = list.filter(function (x) { return /^(?:chapter|ch\.)\s*\d+|^\d{1,3}(?:[\s.:]|$)/i.test(x.title); }).length;
    return { depth: d, list: list, named: named, mean: total / Math.max(1, list.length) };
  }).filter(function (l) { return l.list.length >= MIN_CHAPTERS; });
  var pick = levels.filter(function (l) { return l.named * 2 >= l.list.length; })[0] ||
             levels.filter(function (l) { return l.mean <= MAX_MEAN_PAGES; })[0] ||
             levels[levels.length - 1];
  return pick ? pick.list : [];
}

/* Starts → chapters with their page ranges. Pages before the first start
   are the book's front matter, kept as a chapter of their own so that no
   page is lost. */
function chaptersOf(starts, total) {
  var list = (starts || []).filter(function (s) { return s.start >= 1 && s.start <= total; })
    .slice().sort(function (a, b) { return a.start - b.start; });
  var seen = {}, out = [];
  list.forEach(function (s) { if (!seen[s.start]) { seen[s.start] = true; out.push(s); } });
  if (!out.length) return [];
  if (out[0].start > 1) out.unshift({ title: 'Before chapter 1', start: 1, front: true });
  return out.map(function (s, i) {
    return { n: i + 1, title: s.title || 'Pages ' + s.start + '–' + (i + 1 < out.length ? out[i + 1].start - 1 : total),
             pageStart: s.start, pageEnd: i + 1 < out.length ? out[i + 1].start - 1 : total, front: !!s.front };
  });
}

function everyPages(total) {
  var out = [];
  for (var s = 1; s <= total; s += FALLBACK_PAGES) out.push({ title: 'Pages ' + s + '–' + Math.min(total, s + FALLBACK_PAGES - 1), start: s });
  return out;
}

/* Every method's chapters, and the one to use. pages: [{ page, lines }] in
   book pages; outline: [{ title, page, depth }] in book pages. */
var METHODS = ['outline', 'numbered', 'size', 'pages'];
var LABELS = { outline: 'PDF bookmarks', numbered: '“Chapter N” headings', size: 'Big headings', pages: 'Every ' + FALLBACK_PAGES + ' pages' };
function candidates(pages, outline, total) {
  total = total || (pages || []).length;
  var c = {
    outline: chaptersOf(fromOutline(outline, total), total),
    numbered: chaptersOf(numbered(pages || []), total),
    size: chaptersOf(bySize(pages || []), total),
    pages: chaptersOf(everyPages(total), total),
  };
  return c;
}
function usable(chapters, total) {
  var real = chapters.filter(function (c) { return !c.front; });
  if (real.length < MIN_CHAPTERS) return false;
  return (real[real.length - 1].pageStart - real[0].pageStart) >= MIN_COVERAGE * total - 1;
}
function pick(cands, total) {
  for (var i = 0; i < METHODS.length - 1; i++) if (usable(cands[METHODS[i]], total)) return METHODS[i];
  return 'pages';
}

/* Chapter i folded into the one before it. */
function merge(chapters, i) {
  if (i < 1 || i >= chapters.length) return chapters.slice();
  var out = chapters.map(function (c) { return Object.assign({}, c); });
  out[i - 1].pageEnd = out[i].pageEnd;
  out.splice(i, 1);
  out.forEach(function (c, k) { c.n = k + 1; });
  return out;
}

var MemBook = {
  MIN_CHAPTERS: MIN_CHAPTERS, MIN_COVERAGE: MIN_COVERAGE, MIN_MEAN_PAGES: MIN_MEAN_PAGES, MAX_MEAN_PAGES: MAX_MEAN_PAGES,
  FALLBACK_PAGES: FALLBACK_PAGES, NUMBERED_MAX_WORDS: NUMBERED_MAX_WORDS, METHODS: METHODS, LABELS: LABELS,
  orderParts: orderParts, locate: locate, stripHeaders: stripHeaders, numbered: numbered, bySize: bySize, fromOutline: fromOutline,
  chaptersOf: chaptersOf, candidates: candidates, usable: usable, pick: pick, merge: merge,
};
root.MemBook = MemBook;
if (typeof module !== 'undefined' && module.exports) module.exports = MemBook;
})(typeof window !== 'undefined' ? window : this);
