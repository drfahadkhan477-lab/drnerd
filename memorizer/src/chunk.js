/* ═══════════════════════════════════════════════════════════════════════════
   chunk.js — from the lines a PDF gave us to the clusters a session teaches.

   PURE. No DOM, no pdf.js, no timers. pdf.js turns a PDF into positioned text
   runs (memorizer/src/pdf.js does that part and nothing else); everything that
   DECIDES something about that text lives here, so every decision can be
   tested in bare Node with synthetic pages.

   Two stages:

   1. blocksFromPages(pages) — lines → blocks. Drops running headers/footers
      and bare page numbers, rejoins words hyphenated across a line break,
      groups lines into paragraphs, and marks headings by font size.

   2. clusterBlocks(blocks) — blocks → clusters of CLUSTER_MIN..CLUSTER_MAX
      words. A cluster is what one encode → recall → explain round covers, so
      its size is a teaching decision: small enough to hold in working memory,
      big enough to carry a whole idea. Three invariants, each held by
      tests/verify-memorizer-chunk-pure.js:

        · COVERAGE. Every input word lands in exactly one cluster, in order.
          A chunker that drops a sentence drops it from the exam too, and
          nothing downstream would ever notice it was gone.
        · BOUNDS. Every cluster but the last has MIN..MAX words.
        · HEADINGS STAY WITH THEIR BODY. A heading is never the last thing in
          a cluster when body text follows it — otherwise one round teaches a
          title with nothing under it and the next teaches a body with no
          title.

   Written to the same syntax floor as src/: no lookbehind, no optional
   chaining, nothing Safari on iPadOS 13.4 cannot parse.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

/* 250..450 words: about a page of a textbook, three to six key points. The
   first version used 600..900, and the owner found a section that size too
   much to take in at once — "change it to smaller chunks". */
var CLUSTER_MIN = 250;
var CLUSTER_MAX = 450;
/* A "heading" longer than this is a sentence set in a big font — a pull
   quote, a callout — and is taught as body text. */
var HEADING_MAX_WORDS = 20;

function words(s) {
  return String(s || '').split(/\s+/).filter(function (w) { return w.length > 0; });
}

function median(xs) {
  if (!xs.length) return 0;
  var s = xs.slice().sort(function (a, b) { return a - b; });
  var m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* ── stage 1: lines → blocks ─────────────────────────────────────────────── */

/* A line that recurs on most pages, at the same height on each, is a running
   header or footer. Digits are normalised so "Chapter 3 · 14" and
   "Chapter 3 · 15" count as one line — which is exactly why the height is part
   of the key too: without it, any body line made mostly of numbers (a table
   row, a dose schedule) normalises to the same text on every page and is
   thrown away as a header. The browser suite's first run did that to a whole
   document. */
function lineKey(l) {
  return String(l.text || '').trim().replace(/\d+/g, '#') + '@' + Math.round((+l.y || 0) / 4);
}
function runningLines(pages) {
  if (pages.length < 3) return {};
  var seen = {};
  pages.forEach(function (p) {
    var onThisPage = {};
    (p.lines || []).forEach(function (l) {
      var k = String(l.text || '').trim() ? lineKey(l) : '';
      if (k && !onThisPage[k]) { onThisPage[k] = true; seen[k] = (seen[k] || 0) + 1; }
    });
  });
  var out = {};
  Object.keys(seen).forEach(function (k) { if (seen[k] > pages.length / 2) out[k] = true; });
  return out;
}

/* pages: [{ page: 1-based number, lines: [{ text, size, y }] }], lines in
   reading order, y increasing DOWN the page.
   Returns { blocks: [{ text, page, heading }], bodySize }. */
function blocksFromPages(pages) {
  pages = pages || [];
  var running = runningLines(pages);
  var sizes = [];
  pages.forEach(function (p) {
    (p.lines || []).forEach(function (l) {
      var n = String(l.text || '').length;
      for (var i = 0; i < Math.min(n, 200); i++) sizes.push(+l.size || 0);
    });
  });
  var bodySize = median(sizes) || 1;
  var blocks = [];

  pages.forEach(function (p) {
    var lines = (p.lines || []).filter(function (l) {
      var t = String(l.text || '').trim();
      if (!t) return false;
      if (/^\d{1,4}$/.test(t)) return false;                     /* a bare page number */
      if (running[lineKey(l)]) return false;
      return true;
    });
    var gaps = [];
    for (var i = 1; i < lines.length; i++) {
      var g = (+lines[i].y || 0) - (+lines[i - 1].y || 0);
      if (g > 0) gaps.push(g);
    }
    var lineGap = median(gaps) || 0;
    var cur = null;

    function close() { if (cur && cur.text) blocks.push(cur); cur = null; }

    for (var j = 0; j < lines.length; j++) {
      var ls = listAt(lines, j, bodySize);
      if (ls) {
        close();
        var gid = 'L' + p.page + ':' + j;
        ls.items.forEach(function (it) { blocks.push({ text: it.text, page: p.page, heading: false, item: true, sub: it.sub, list: gid }); });
        j += ls.count - 1;
        continue;
      }
      var tb = tableAt(lines, j);
      if (tb) {
        close();
        blocks.push({ text: tb.rows.map(function (r) { return r.join(' '); }).join(' ').replace(/\s+/g, ' ').trim(),
                      page: p.page, heading: false, table: tb.rows });
        j += tb.count - 1;
        continue;
      }
      var l = lines[j];
      var t = String(l.text).replace(/\s+/g, ' ').trim();
      var w = words(t);
      /* A heading set at body size, marked by its outline number instead of
         its font: a line of its own ("B. Pathophysiology", "17.2 Tricuspid
         stenosis"), or run into its paragraph ("A. Etiology. Table 17.1
         lists …" — how the owner's first PDF set every sub-heading, which
         until now reached the coach as a two-word sentence and left the
         section titled by its first six words). A run-in heading opens a
         paragraph, so it is only looked for where the text before it ended
         a sentence. */
      var opens = !cur || cur.heading || /[.!?:]["'\u201D\u2019)\]]*$/.test(cur.text);
      var mk = opens && (+l.size || 0) < bodySize * 1.15 && (OUTLINE_LINE.test(t) ? { head: t, rest: '' } : runIn(t));
      if (mk) {
        close();
        blocks.push({ text: mk.head, page: p.page, heading: true, minor: true });
        if (mk.rest) cur = { text: mk.rest, page: p.page, heading: false };
        continue;
      }
      var isHeading = (+l.size || 0) >= bodySize * 1.15 && w.length <= HEADING_MAX_WORDS &&
                      !/[.,;:]$/.test(t);
      if (isHeading) {
        /* Consecutive heading lines at one size are one heading wrapped. */
        if (cur && cur.heading && j > 0 && Math.abs((+lines[j - 1].size || 0) - (+l.size || 0)) < 0.5 &&
            words(cur.text).length + w.length <= HEADING_MAX_WORDS) {
          cur.text += ' ' + t;
          continue;
        }
        close();
        cur = { text: t, page: p.page, heading: true };
        close();
        continue;
      }
      var gap = j > 0 ? (+l.y || 0) - (+lines[j - 1].y || 0) : 0;
      /* A change of font size is a change of block — a pull quote or a
         caption set between body lines is not part of the paragraph above. */
      var prevSize = j > 0 ? (+lines[j - 1].size || 0) : 0;
      var sizeJump = prevSize > 0 && Math.abs((+l.size || 0) - prevSize) > prevSize * 0.15;
      var newPara = !cur || cur.heading || sizeJump || (lineGap > 0 && gap > lineGap * 1.6);
      if (newPara) {
        close();
        cur = { text: t, page: p.page, heading: false };
      } else if (/[A-Za-z]-$/.test(cur.text) && /^[a-z]/.test(t)) {
        cur.text = cur.text.slice(0, -1) + t;                    /* exam-\nple → example */
      } else {
        cur.text += ' ' + t;
      }
    }
    close();
  });
  return { blocks: blocks, bodySize: bodySize };
}

/* ── outline headings ──────────────────────────────────────────────────────
   The markers: a capital letter A–H or a Roman numeral with a stop ("A.",
   "IV."), or a dotted section number ("17.2", "3.1.4"). A bare "1." is not
   one — that is how a numbered list or a numbered paragraph starts ("1.
   Rheumatic heart disease (RHD) is …"), and lists are chunk.js's too. The
   label is a capitalised phrase of at most OUTLINE_MAX_WORDS words with no
   sentence punctuation inside it. */
var OUTLINE_MAX_WORDS = 6;
var MARKER = '(?:[A-H]\\.|(?:I|II|III|IV|V|VI|VII|VIII|IX|X)\\.|\\d{1,2}(?:\\.\\d{1,2})+\\.?)';
var LABEL = '[A-Z][A-Za-z\\-\\u2019\']{2,}(?:\\s+(?:[A-Za-z][A-Za-z\\-\\u2019\']*|and|or|of|&)){0,' + (OUTLINE_MAX_WORDS - 1) + '}';
var OUTLINE_LINE = new RegExp('^' + MARKER + '\\s+' + LABEL + '$');
var RUN_IN = new RegExp('^(' + MARKER + '\\s+' + LABEL + '[.:])\\s+(\\S.*)$');
function runIn(t) {
  var m = RUN_IN.exec(t);
  return m ? { head: m[1], rest: m[2] } : null;
}

/* ── tables ────────────────────────────────────────────────────────────────
   pdf.js gives text runs with positions; memorizer/src/pdf.js groups a line's
   runs into CELLS wherever the gap between runs is wide. A table is three or
   more consecutive lines of two or more cells whose columns line up with the
   first line's — the header. Cells are placed in the header's column nearest
   them, so a row with an empty cell keeps its other cells in the right
   columns. Everything else about a table's words — which cluster, which
   page — is as for prose, so the coverage invariant holds for tables too:
   a table's text is its rows' cells, in order, exactly the words of its
   lines. */
var TABLE_MIN_ROWS = 3;
function cellsOf(l) { return (l && l.cells && l.cells.length >= 2) ? l.cells : null; }
function tableAt(lines, j) {
  var head = cellsOf(lines[j]);
  if (!head) return null;
  var tol = Math.max(8, (+lines[j].size || 10));
  var anchors = head.map(function (c) { return +c.x || 0; });
  var n = 1;
  while (j + n < lines.length) {
    var cs = cellsOf(lines[j + n]);
    if (!cs) break;
    var aligned = cs.filter(function (c) {
      return anchors.some(function (a) { return Math.abs((+c.x || 0) - a) <= tol; });
    }).length;
    if (aligned < 2) break;
    n++;
  }
  if (n < TABLE_MIN_ROWS) return null;
  var rows = [];
  for (var k = 0; k < n; k++) {
    var row = anchors.map(function () { return ''; });
    cellsOf(lines[j + k]).forEach(function (c) {
      var best = 0;
      anchors.forEach(function (a, ai) { if (Math.abs((+c.x || 0) - a) < Math.abs((+c.x || 0) - anchors[best])) best = ai; });
      var t = String(c.text || '').replace(/\s+/g, ' ').trim();
      row[best] = row[best] ? row[best] + ' ' + t : t;
    });
    rows.push(row);
  }
  return { rows: rows, count: n };
}

/* ── lists ─────────────────────────────────────────────────────────────────
   A list is a run of short lines, each a thing of its own: three or more
   lines of at most LIST_MAX_WORDS words that start with a bullet, a number
   or a capital and do not end mid-clause. That is what a textbook's "causes
   of", "features of" and "treatment of" look like, bullets or not — the
   owner's first PDF drew its bullets as graphics, so no glyph reached the
   text and the list could only be seen by its shape.
   Inside a list, a line set further left than the items is a sub-heading
   ("Congenital", "Acquired"), and a line starting in lower case is the
   previous item wrapped. The bullet glyph itself is dropped; every other
   word is kept, so coverage holds. */
var LIST_MAX_WORDS = 9;
var BULLET = /^(?:[\u2022\u25CF\u25AA\u25E6\u2023\u2219\u00B7\u25A0\u25A1\u2013\u2014*\-])\s+/;
var NUMBERED = /^(?:\(?\d{1,2}[.)]|\(?[a-h][.)])\s+/;
function listLine(l, bodySize) {
  var t = String(l.text || '').trim();
  if (!t || (+l.size || 0) >= bodySize * 1.15 || cellsOf(l)) return null;
  var bullet = BULLET.test(t) || NUMBERED.test(t);
  var body = t.replace(BULLET, '');
  var n = words(body).length;
  if (n > LIST_MAX_WORDS) return null;
  if (/[,;]$/.test(t)) return null;
  /* A full sentence is prose, not an item: two sentences on a line ("A.
     Etiology. Table 17.1 lists …"), or six or more words closed by a stop. */
  if (/[.!?]\s+\S/.test(body.replace(NUMBERED, '')) || (n >= 6 && /[.!?]$/.test(body))) return null;
  if (!bullet && !/^[A-Z0-9(]/.test(body)) return null;
  return { text: body, bullet: bullet, x: (l.cells && l.cells[0] ? +l.cells[0].x : 0) };
}
function listAt(lines, j, bodySize) {
  var first = listLine(lines[j], bodySize);
  if (!first) return null;
  var run = [first], n = 1;
  while (j + n < lines.length) {
    var l = lines[j + n], t = String(l.text || '').trim();
    var li = listLine(l, bodySize);
    var x = l.cells && l.cells[0] ? +l.cells[0].x : 0;
    /* a wrapped item: lower case, indented at least as far as an item */
    if (!li && /^[a-z(]/.test(t) && words(t).length <= 14 && run.length && x >= run[run.length - 1].x - 1) {
      run[run.length - 1] = { text: run[run.length - 1].text + ' ' + t, bullet: run[run.length - 1].bullet, x: run[run.length - 1].x, wrapped: true };
      n++;
      continue;
    }
    if (!li) break;
    run.push(li); n++;
  }
  var bullets = run.filter(function (r) { return r.bullet; }).length;
  if (run.length < 3 || (!bullets && run.length < 4)) return null;
  var xs = run.map(function (r) { return r.x; }).sort(function (a, b) { return a - b; });
  var itemX = bullets ? Math.min.apply(null, run.filter(function (r) { return r.bullet; }).map(function (r) { return r.x; }))
                      : xs[Math.floor(xs.length / 2)];
  var items = run.map(function (r) { return { text: r.text, sub: !r.bullet && r.x < itemX - 3 }; });
  if (items.filter(function (i) { return !i.sub; }).length < 3) return null;
  return { items: items, count: n };
}

/* Pages with almost no extractable text are scans: an image of a page with no
   text layer. pdf.js cannot read them and v1 does no OCR, so they are named
   to the user rather than silently skipped. */
function scannedPages(pageWordCounts, threshold) {
  var t = threshold == null ? 5 : threshold;
  var out = [];
  (pageWordCounts || []).forEach(function (n, i) { if (n < t) out.push(i + 1); });
  return out;
}

/* ── stage 2: blocks → clusters ──────────────────────────────────────────── */

var SENTENCE_END = /[.!?]["'”’)\]]*$/;

/* A block becomes units: a heading is one unit; a paragraph is one unit per
   sentence, and a sentence longer than CLUSTER_MAX is cut into pieces that
   fit. Each word remembers its page and its paragraph, so a cluster can cite
   the page and rebuild its paragraphs. */
function unitsFromBlocks(blocks, max) {
  var units = [];
  (blocks || []).forEach(function (b, bi) {
    var ws = words(b.text).map(function (w) { return { w: w, page: b.page, para: bi }; });
    if (!ws.length) return;
    if (b.heading && ws.length <= HEADING_MAX_WORDS) {
      units.push({ heading: true, minor: !!b.minor, words: ws });
      return;
    }
    if (b.table) {
      /* One unit per row, marked atomic: a row is never cut between two
         clusters (see clusterBlocks). Each word knows its row, so a cluster
         can rebuild the rows it holds. */
      var at = 0;
      b.table.forEach(function (row, ri) {
        var rw = words(row.join(' ')).map(function (w) { return { w: w, page: b.page, para: bi, row: ri }; });
        at += rw.length;
        if (rw.length) units.push({ heading: false, atomic: rw.length <= max, words: rw });
      });
      return;
    }
    var sent = [];
    ws.forEach(function (tok, i) {
      sent.push(tok);
      if (SENTENCE_END.test(tok.w) || i === ws.length - 1) {
        for (var k = 0; k < sent.length; k += max) units.push({ heading: false, words: sent.slice(k, k + max) });
        sent = [];
      }
    });
  });
  return units;
}

/* What a heading is called in a title. An outline heading ("A. Etiology.")
   loses its marker and its stop and is named under the last size-set
   heading before it — "Tricuspid Stenosis: Etiology" — because a unit on
   four valves has four sections called "Etiology", and a review card titled
   "A. Etiology." does not say which. `ctx` carries that heading from one
   cluster to the next. */
var MARKER_RE = new RegExp('^' + MARKER + '\\s+');
function titleOf(u, text, ctx) {
  if (!u.minor) { ctx.major = text; return text; }
  var label = text.replace(MARKER_RE, '').replace(/[.:]$/, '');
  return ctx.major ? ctx.major + ': ' + label : label;
}

function buildCluster(units, index, ctx, tables) {
  var toks = [];
  var headings = [];
  var titles = [];
  units.forEach(function (u) {
    if (u.heading) {
      var ht = u.words.map(function (t) { return t.w; }).join(' ');
      headings.push(ht);
      titles.push(titleOf(u, ht, ctx));
    }
    u.words.forEach(function (t) { toks.push({ w: t.w, page: t.page, para: t.para, heading: u.heading, row: t.row }); });
  });
  /* Segments: consecutive words from one paragraph on one page. These are
     what a prompt shows the model, each with its page, so every point it
     returns can cite a page the user can go and check. */
  var segments = [];
  toks.forEach(function (t) {
    var s = segments[segments.length - 1];
    if (s && s.para === t.para && s.page === t.page) { s.words.push(t.w); if (t.row != null && s.rows.indexOf(t.row) === -1) s.rows.push(t.row); }
    else segments.push({ para: t.para, page: t.page, heading: t.heading, words: [t.w], rows: t.row != null ? [t.row] : [] });
  });
  segments = segments.map(function (s) {
    var out = { page: s.page, heading: s.heading, text: s.words.join(' ') };
    var li = tables && tables['item' + s.para];
    if (li) { out.item = true; out.list = li.list; if (li.sub) out.sub = true; }
    var tb = tables && tables[s.para];
    if (tb && s.rows.length) {
      out.table = s.rows.map(function (r) { return tb[r]; });
      /* The header row again, for display only, when this part of a table
         does not start at it. Its words are not counted twice: it is not in
         `text`, which is what the coverage invariant reads. */
      if (s.rows[0] !== 0) out.tableHeader = tb[0];
    }
    return out;
  });
  var body = toks.filter(function (t) { return !t.heading; }).map(function (t) { return t.w; });
  var title = titles[0] ||
    (ctx.last ? ctx.last + ' (cont.)' : body.slice(0, 6).join(' ') + (body.length > 6 ? '…' : ''));
  if (titles.length) ctx.last = titles[titles.length - 1];
  var gistWords = [];
  for (var i = 0; i < body.length && gistWords.length < 25; i++) {
    gistWords.push(body[i]);
    if (SENTENCE_END.test(body[i])) break;
  }
  var pages = toks.map(function (t) { return t.page; });
  return {
    index: index,
    title: title,
    gist: gistWords.join(' '),
    headings: headings,
    segments: segments,
    text: segments.map(function (s) { return s.text; }).join('\n\n'),
    words: toks.length,
    pageStart: Math.min.apply(null, pages),
    pageEnd: Math.max.apply(null, pages),
  };
}

function clusterBlocks(blocks, opts) {
  opts = opts || {};
  var MIN = opts.min || CLUSTER_MIN;
  var MAX = opts.max || CLUSTER_MAX;
  var units = unitsFromBlocks(blocks, MAX);
  var tables = {};
  (blocks || []).forEach(function (b, bi) {
    if (b.table) tables[bi] = b.table;
    if (b.item) tables['item' + bi] = { list: b.list, sub: !!b.sub };
  });
  var groups = [];
  var cur = [];
  var curN = 0;

  function flush() { if (curN > 0) groups.push(cur); cur = []; curN = 0; }
  function endsWithHeading() { return cur.length > 0 && cur[cur.length - 1].heading; }

  var queue = units.slice();
  while (queue.length) {
    var u = queue.shift();
    var n = u.words.length;
    if (u.heading) {
      /* Start a new cluster at a heading when this one is already big enough,
         or when the heading plus one word of its body would not fit. */
      if (curN >= MIN || curN + n + 1 > MAX) flush();
      cur.push(u); curN += n;
      continue;
    }
    if (curN + n <= MAX) { cur.push(u); curN += n; continue; }
    if (u.atomic) {
      /* A table row does not fit. Rows are short, so the cluster is nearly
         full and well over MIN; close it — taking any heading it ends with
         along to the next cluster, so the heading stays with its table. */
      var carry = [];
      while (cur.length && cur[cur.length - 1].heading) { var hu = cur.pop(); curN -= hu.words.length; carry.unshift(hu); }
      flush();
      carry.forEach(function (hu) { cur.push(hu); curN += hu.words.length; });
      cur.push(u); curN += n;
      continue;
    }
    if (curN < MIN || endsWithHeading()) {
      /* Too small to close, or closing would strand a heading: fill to MAX
         with the front of this sentence and carry the rest over. */
      var take = MAX - curN;
      cur.push({ heading: false, words: u.words.slice(0, take) }); curN += take;
      flush();
      queue.unshift({ heading: false, words: u.words.slice(take) });
    } else {
      flush();
      cur.push(u); curN += n;
    }
  }
  flush();

  /* A short tail folds into the cluster before it when there is room. */
  if (groups.length > 1) {
    var last = groups[groups.length - 1];
    var prev = groups[groups.length - 2];
    var count = function (g) { return g.reduce(function (s, x) { return s + x.words.length; }, 0); };
    if (count(last) < MIN && count(prev) + count(last) <= MAX) {
      groups.splice(groups.length - 2, 2, prev.concat(last));
    }
  }

  var ctx = { major: '', last: '' };
  return groups.map(function (g, i) {
    var c = buildCluster(g, i, ctx, tables);
    return c;
  });
}

/* ── figures, to the sections that use them ────────────────────────────────
   Until captions were read, a section showed every figure printed within its
   pages — so two sections sharing a page both showed its figure, and a
   section that said "(Fig. 17.3)" of a figure printed two pages on showed
   nothing. Now a numbered figure goes to the sections whose text names it
   (its own caption, which is prose in the section it was printed in, counts
   as naming it). A figure with no number, or one no section names, falls
   back to the page rule. Named figures come first, in the order the section
   names them; FIGURES_PER_SECTION at most.

   clusters: clusterBlocks()'s; figures: [{ page, box, number? }] from
   memorizer/src/pdf.js. Returns one array of figures per cluster. */
var FIGURES_PER_SECTION = 6;
var FIG_REF = /\bfig(?:ure)?s?\.?\s*(\d+(?:[.\-\u2013]\d+)*[A-Za-z]?(?:\s*(?:,|and|&)\s*\d+(?:[.\-\u2013]\d+)*[A-Za-z]?)*)/gi;
function figNo(n) { return String(n).replace(/[\-\u2013]/g, '.').toLowerCase(); }
function figBase(n) { return n.replace(/[a-z]$/, ''); }
function figureRefs(text) {
  var out = [], m;
  FIG_REF.lastIndex = 0;
  while ((m = FIG_REF.exec(String(text || '')))) {
    m[1].split(/\s*(?:,|and|&)\s*/).forEach(function (n) { n = figNo(n); if (n && out.indexOf(n) === -1) out.push(n); });
  }
  return out;
}
function assignFigures(clusters, figures) {
  var named = {};
  var refs = (clusters || []).map(function (c) {
    var r = figureRefs(c.text);
    r.forEach(function (n) { named[n] = true; named[figBase(n)] = true; });
    return r;
  });
  return (clusters || []).map(function (c, ci) {
    var out = [];
    refs[ci].forEach(function (n) {
      (figures || []).forEach(function (f) {
        var fn = f.number ? figNo(f.number) : '';
        if (fn && (fn === n || figBase(fn) === figBase(n)) && out.indexOf(f) === -1) out.push(f);
      });
    });
    (figures || []).forEach(function (f) {
      var fn = f.number ? figNo(f.number) : '';
      var claimed = fn && (named[fn] || named[figBase(fn)]);
      if (!claimed && f.page >= c.pageStart && f.page <= c.pageEnd && out.indexOf(f) === -1) out.push(f);
    });
    return out.slice(0, FIGURES_PER_SECTION);
  });
}

var MemChunk = {
  FIGURES_PER_SECTION: FIGURES_PER_SECTION, figureRefs: figureRefs, assignFigures: assignFigures,
  OUTLINE_MAX_WORDS: OUTLINE_MAX_WORDS, runIn: runIn, CLUSTER_MIN: CLUSTER_MIN, CLUSTER_MAX: CLUSTER_MAX, HEADING_MAX_WORDS: HEADING_MAX_WORDS, TABLE_MIN_ROWS: TABLE_MIN_ROWS, tableAt: tableAt, LIST_MAX_WORDS: LIST_MAX_WORDS, listAt: listAt,
  words: words, blocksFromPages: blocksFromPages, scannedPages: scannedPages,
  unitsFromBlocks: unitsFromBlocks, clusterBlocks: clusterBlocks,
};
root.MemChunk = MemChunk;
if (typeof module !== 'undefined' && module.exports) module.exports = MemChunk;
})(typeof window !== 'undefined' ? window : this);
