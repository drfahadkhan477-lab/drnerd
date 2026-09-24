/* ═══════════════════════════════════════════════════════════════════════════
   pdf.js — the only file that talks to pdf.js (Mozilla's PDF reader).

   It turns a PDF into lines with a font size and a vertical position, and
   stops. Everything decided about those lines — headers, headings,
   paragraphs, clusters — is in chunk.js, where it can be tested without a
   browser.

   pdf.js is fetched from jsDelivr (the LEGACY build, which is the one that
   parses on older iPad Safari) with a pinned version and a subresource-
   integrity hash, and only when the first PDF is opened. The worker is
   fetched with the same integrity check and started from a blob: URL, which
   is what lets it run from a page opened as a local file.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/';
var LIB = { url: BASE + 'pdf.min.js', sri: 'sha384-OemFRmhjDZwhIKuUld0HJozkF2YErsgDaCL41trxGQZt4/WgnopJQqQl2DvDZ07Z' };
var WORKER = { url: BASE + 'pdf.worker.min.js', sri: 'sha384-sS8B4COeBqzQV9DaPpp5cbpF+xz2jPcFbN3L8FL3/dx0RMC6WLUwTUOFm0iFb1lw' };

var loading = null;

function loadScript(src, sri) {
  return new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = src; s.integrity = sri; s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = function () { reject(new Error('could not load the PDF reader — are you offline?')); };
    document.head.appendChild(s);
  });
}

function lib() {
  if (loading) return loading;
  loading = loadScript(LIB.url, LIB.sri).then(function () {
    var L = root.pdfjsLib;
    if (!L) throw new Error('the PDF reader loaded but did not start');
    return fetch(WORKER.url, { integrity: WORKER.sri, mode: 'cors' })
      .then(function (r) { if (!r.ok) throw new Error('worker ' + r.status); return r.text(); })
      .then(function (code) {
        L.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        return L;
      }, function () {
        /* No worker: pdf.js falls back to parsing on the main thread. Slower,
           still correct. */
        L.GlobalWorkerOptions.workerSrc = WORKER.url;
        return L;
      });
  });
  loading.catch(function () { loading = null; });
  return loading;
}

/* pdf.js text items → lines. An item's transform is [a, b, c, d, x, y];
   |d| (or the hypotenuse of b,d when rotated) is its font size, y is up
   from the bottom of the page. Items within half a font size of each other
   vertically are one line. */
function linesOf(items, pageHeight) {
  var runs = items.filter(function (it) { return it.str && it.str.trim(); }).map(function (it) {
    var t = it.transform;
    var size = Math.sqrt(t[2] * t[2] + t[3] * t[3]) || Math.abs(t[3]) || 10;
    return { str: it.str, x: t[4], w: +it.width || 0, y: pageHeight - t[5], size: size };
  });
  var groups = [];
  runs.forEach(function (r) {
    var g = groups[groups.length - 1];
    if (g && Math.abs(g.y - r.y) < Math.max(g.size, r.size) * 0.5) { g.runs.push(r); g.size = Math.max(g.size, r.size); }
    else groups.push({ y: r.y, size: r.size, runs: [r] });
  });
  return groups.map(function (g) {
    /* WHERE A SPACE GOES IS DECIDED BY THE GAP, not by there being two runs.
       PDFs often store a word in pieces — kerned "T" + "ricuspid", a justified
       "regur" + "gitation", a tracked heading one letter per run — and the
       first version put a space between every pair, which is how a real
       chapter came out as "C H A P T E R 1 7" and "regur gitation". A gap
       wider than a fraction of the font size is a space; tracked (letter-
       spaced) lines get a threshold scaled to their own letter gap. */
    var gaps = [];
    for (var i = 1; i < g.runs.length; i++) {
      var p = g.runs[i - 1];
      if (p.w > 0) gaps.push(g.runs[i].x - (p.x + p.w));
    }
    var small = gaps.filter(function (x) { return x >= 0 && x < g.size * 0.6; }).sort(function (a, b) { return a - b; });
    var tracked = small.length >= 4 && small[Math.floor(small.length / 2)] > g.size * 0.05;
    var thr = tracked ? Math.max(g.size * 0.15, small[Math.floor(small.length / 2)] * 1.8) : g.size * 0.15;
    var text = '', cells = [];
    g.runs.forEach(function (r, i) {
      var prev = g.runs[i - 1];
      var gap = prev && prev.w > 0 ? r.x - (prev.x + prev.w) : null;
      /* A doubled space (a run that ends in one, then a gap) is folded by the
         whitespace normalisation below, so no special case is needed here. */
      var sep = !prev ? '' : (gap == null || gap > thr) ? ' ' : '';
      text += sep + r.str;
      /* A wide gap starts a new CELL. chunk.js reads cells to find tables;
         prose lines end up with one cell. */
      var c = cells[cells.length - 1];
      if (!c || (gap != null && gap > g.size * 1.5)) cells.push({ x: r.x, text: r.str, end: r.x + r.w });
      else { c.text += sep + r.str; c.end = Math.max(c.end, r.x + r.w); }
    });
    return { text: text.replace(/\s+/g, ' ').trim(), y: g.y, size: Math.round(g.size * 10) / 10,
             cells: cells.map(function (c) { return { x: Math.round(c.x), text: c.text.replace(/\s+/g, ' ').trim() }; })
                         .filter(function (c) { return c.text; }) };
  });
}

/* ── figures ────────────────────────────────────────────────────────────────
   Where on a page each embedded picture is drawn. A picture is painted into
   the unit square under the current transform, so tracking the transform
   through save/restore gives its box in PDF units. Tiny images (bullets,
   logos, rules) are dropped. Charts drawn as lines rather than a picture
   are found from their painted paths (figureBoxes below). */
function mul(m, n) {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3],
          m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
/* What is drawn where, in PDF units, from the transform in force when it is
   painted. Form XObjects carry their own matrix — begin/end pairs in the
   operator list — and the first version ignored it, which is how figures on
   a real textbook page were cropped from the wrong place.

   `images`: each embedded picture's box. `paths`: each PAINTED path's box —
   a line, a bar, an axis, a curve that is stroked or filled. pdf.js 3.11
   gives a path's bounds as [minX, maxX, minY, maxY] in the path's own
   space (evaluator.js buildPath — not the [x0, y0, x1, y1] used for boxes
   here), and a clipping path is built exactly like a drawn one, so a path
   counts only when the next operator paints it. */
function drawn(opList, OPS) {
  var ctm = [1, 0, 0, 1, 0, 0], stack = [], images = [], paths = [];
  var paint = {}, ink = {};
  [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat, OPS.paintJpegXObject]
    .forEach(function (o) { if (o != null) paint[o] = true; });
  [OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]
    .forEach(function (o) { if (o != null) ink[o] = true; });
  function place(x0, y0, x1, y1) {
    var xs = [], ys = [];
    [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].forEach(function (p) {
      xs.push(ctm[0] * p[0] + ctm[2] * p[1] + ctm[4]); ys.push(ctm[1] * p[0] + ctm[3] * p[1] + ctm[5]);
    });
    return [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)];
  }
  for (var i = 0; i < opList.fnArray.length; i++) {
    var fn = opList.fnArray[i], args = opList.argsArray[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (OPS.paintFormXObjectBegin != null && fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm.slice());
      if (args && args[0] && args[0].length === 6) ctm = mul(ctm, args[0]);
    } else if (OPS.paintFormXObjectEnd != null && fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (paint[fn]) images.push(place(0, 0, 1, 1));
    else if (OPS.constructPath != null && fn === OPS.constructPath && ink[opList.fnArray[i + 1]]) {
      /* A path pdf.js could not bound (curves only: its bounds stay at
         ±Infinity) gets a NaN box, which the page-size filter drops. */
      var mm = args && args[2];
      if (mm) paths.push(place(mm[0], mm[2], mm[1], mm[3]));
    }
  }
  return { images: images, paths: paths };
}
function imageBoxes(opList, OPS) { return drawn(opList, OPS).images; }

function area(b) { return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]); }
function overlap(a, b) { return area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]); }
/* Touching, edges included. Not overlap() > 0: a straight line's box has no
   area, so an axis would never join the bars standing on it. */
function touches(a, b) { return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]; }

/* Which of those boxes are FIGURES. Rejected, each for a reason seen in a
   real PDF:
     · tiny — a logo, a bullet, a rule;
     · a strip — a highlight or a coloured bar (one side over 12× the other);
     · nearly the whole page — a scan or a page background;
     · mostly text — an image laid over or under prose: highlighter marks, a
       shaded box, a scanned column. A diagram has labels, not paragraphs;
       over a quarter of its area covered by text lines is not a figure.
   Overlapping or touching boxes are merged first, so a figure built from
   several tiles, or a multi-panel figure, is one figure.

   DRAWN FIGURES. A chart or diagram made of lines rather than a picture is
   found from its painted paths: paths that touch are one drawing, and a
   drawing of VECTOR_MIN_PATHS or more paths is held to the same rules as a
   picture. Fewer is a frame, a box round a callout, an underline. A path
   covering most of the page (a border, a background) is dropped before the
   merge, or everything inside it would become one "figure". A drawing that
   touches a picture is part of it — axes and labels drawn over a plot. */
var VECTOR_MIN_PATHS = 6;
function merge(boxes, pad) {
  var out = [];
  boxes.forEach(function (x) {
    var b = x.box, g = [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
    for (var i = 0; i < out.length; i++) {
      var m = out[i].box;
      if (touches(g, m)) {
        out[i] = { box: [Math.min(m[0], b[0]), Math.min(m[1], b[1]), Math.max(m[2], b[2]), Math.max(m[3], b[3])], n: out[i].n + x.n };
        return;
      }
    }
    out.push({ box: b.slice(), n: x.n });
  });
  /* A merge can bridge two earlier groups; repeat until nothing touches. */
  return out.length < boxes.length ? merge(out, pad) : out;
}
function figureBoxes(opList, OPS, view, textBoxes) {
  var d = drawn(opList, OPS);
  var pageArea = (view[2] - view[0]) * (view[3] - view[1]);
  var pics = merge(d.images.map(function (b) { return { box: b, n: 1 }; }), 6).map(function (m) { return m.box; });
  var drawings = merge(d.paths.filter(function (b) { return area(b) <= 0.8 * pageArea; })
    .map(function (b) { return { box: b, n: 1 }; }), 6)
    .filter(function (m) { return m.n >= VECTOR_MIN_PATHS; }).map(function (m) { return m.box; });
  drawings.forEach(function (b) {
    for (var i = 0; i < pics.length; i++) {
      if (touches(b, pics[i])) {
        var p = pics[i];
        pics[i] = [Math.min(p[0], b[0]), Math.min(p[1], b[1]), Math.max(p[2], b[2]), Math.max(p[3], b[3])];
        return;
      }
    }
    pics.push(b.slice());
  });
  return pics.filter(function (b) {
    var w = b[2] - b[0], h = b[3] - b[1];
    if (w < 60 || h < 40 || w * h < 0.02 * pageArea) return false;
    if (w / h > 12 || h / w > 12) return false;
    if (w * h > 0.8 * pageArea) return false;
    var covered = (textBoxes || []).reduce(function (s, t) { return s + overlap(b, t); }, 0);
    return covered / (w * h) <= 0.25;
  }).map(function (b) { return b.map(function (v) { return Math.round(v); }); });
}

/* ── captions ───────────────────────────────────────────────────────────────
   A figure's caption is the line that starts "Figure 17.3", "Fig. 2" or
   "FIGURE 4B" printed just under it — or, failing that, just over it —
   and overlapping it across the page, plus the lines that continue it at
   the same size and leading. Its number is what a section's "(see Fig.
   17.3)" names, which is how chunk.js's assignFigures puts a figure with
   the section that talks about it rather than every section sharing its
   page. The number is kept as printed ("17-3", "4B"); chunk.js alone
   decides when two numbers are the same one. The caption's words stay in
   the section's prose as well; this only reads them.

   `lines` are linesOf()'s, y down the page; `box` is in PDF units, y up. */
var CAPTION = /^(fig(?:ure)?s?\.?)\s*(\d+(?:[.\-\u2013]\d+)*[A-Za-z]?)\b/i;
var CAPTION_REACH = 60;
function captionFor(box, lines, pageHeight) {
  var top = pageHeight - box[3], bottom = pageHeight - box[1];
  var best = null;
  (lines || []).forEach(function (l, i) {
    var m = CAPTION.exec(String(l.text || ''));
    if (!m) return;
    var x = l.cells && l.cells[0] ? +l.cells[0].x : box[0];
    if (x < box[0] - 40 || x > box[2]) return;
    /* below: the caption's baseline is under the picture's bottom edge;
       above: its baseline is over the picture's top edge. Any caption below
       beats any above — below is where captions go, and in a stack of
       figures the caption just over one picture is the one under the
       picture before it. */
    var below = l.y - bottom, above = top - l.y;
    var d = below >= 0 && below <= CAPTION_REACH ? below : above >= 0 && above <= CAPTION_REACH ? above + CAPTION_REACH : null;
    if (d == null || (best && best.d <= d)) return;
    best = { d: d, i: i, m: m };
  });
  if (!best) return null;
  var first = lines[best.i], text = [first.text];
  for (var k = best.i + 1; k < lines.length && text.length < 5; k++) {
    var prev = lines[k - 1], l = lines[k];
    if (CAPTION.test(l.text) || Math.abs((+l.size || 0) - (+first.size || 0)) > 0.6) break;
    var gap = l.y - prev.y;
    if (gap <= 0 || gap > (+first.size || 10) * 1.8) break;
    text.push(l.text);
  }
  return { number: best.m[2], label: 'Figure ' + best.m[2], text: text.join(' ').replace(/\s+/g, ' ').trim() };
}

/* Text runs as boxes in PDF units, for the text-cover test above. */
function textBoxesOf(items) {
  return items.filter(function (it) { return it.str && it.str.trim() && it.width > 0; }).map(function (it) {
    var t = it.transform, size = Math.sqrt(t[2] * t[2] + t[3] * t[3]) || Math.abs(t[3]) || 10;
    return [t[4], t[5] - size * 0.25, t[4] + it.width, t[5] + size * 0.85];
  });
}

/* ArrayBuffer → { pages: [{ page, lines }], wordCounts: [n per page], figures: [{ page, box }] } */
function read(buffer, onProgress) {
  var Lib;
  return lib().then(function (L) {
    Lib = L;
    /* pdf.js may take ownership of the buffer it is given, so it gets a copy:
       the caller keeps the original to store. */
    return L.getDocument({ data: new Uint8Array(buffer.slice(0)), isEvalSupported: false }).promise;
  }).then(function (doc) {
    var pages = [], counts = [], figures = [];
    var chain = Promise.resolve();
    for (var i = 1; i <= doc.numPages; i++) {
      (function (n) {
        chain = chain.then(function () { return doc.getPage(n); }).then(function (page) {
          var h = page.getViewport({ scale: 1 }).height;
          return page.getTextContent().then(function (tc) {
            var lines = linesOf(tc.items, h);
            pages.push({ page: n, lines: lines });
            counts.push(lines.reduce(function (s, l) { return s + l.text.split(/\s+/).filter(Boolean).length; }, 0));
            return page.getOperatorList().then(function (ops) {
              figureBoxes(ops, Lib.OPS, page.view, textBoxesOf(tc.items)).forEach(function (b) {
                var f = { page: n, box: b }, cap = captionFor(b, lines, h);
                if (cap) { f.number = cap.number; f.label = cap.label; f.caption = cap.text; }
                figures.push(f);
              });
            }, function () { /* a page whose drawing cannot be listed still has its text */ });
          }).then(function () { if (onProgress) onProgress(n, doc.numPages); });
        });
      })(i);
    }
    return chain.then(function () { return { pages: pages, wordCounts: counts, numPages: doc.numPages, figures: figures }; });
  });
}

/* Draw part of a page — a figure's box, or the whole page — to a PNG data
   URL, at `scale` device pixels per PDF unit. Opened afresh each time from
   the stored bytes; a study session draws a handful, so nothing is kept
   open between them. */
var docCache = { key: null, doc: null };
function openStored(key, buffer) {
  if (docCache.key === key && docCache.doc) return Promise.resolve(docCache.doc);
  return lib().then(function (L) {
    return L.getDocument({ data: new Uint8Array(buffer.slice(0)), isEvalSupported: false }).promise;
  }).then(function (doc) { docCache = { key: key, doc: doc }; return doc; });
}
function renderBox(key, buffer, pageNo, box, scale) {
  scale = scale || 2;
  return openStored(key, buffer).then(function (doc) { return doc.getPage(pageNo); }).then(function (page) {
    var vp = page.getViewport({ scale: scale });
    var canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise.then(function () {
      if (!box) return canvas.toDataURL('image/png');
      var r = vp.convertToViewportRectangle(box);
      var x = Math.max(0, Math.floor(Math.min(r[0], r[2]))), y = Math.max(0, Math.floor(Math.min(r[1], r[3])));
      var w = Math.min(canvas.width - x, Math.ceil(Math.abs(r[2] - r[0]))), hh = Math.min(canvas.height - y, Math.ceil(Math.abs(r[3] - r[1])));
      var out = document.createElement('canvas');
      out.width = Math.max(1, w); out.height = Math.max(1, hh);
      out.getContext('2d').drawImage(canvas, x, y, w, hh, 0, 0, w, hh);
      return out.toDataURL('image/png');
    });
  });
}

root.MemPdf = { VECTOR_MIN_PATHS: VECTOR_MIN_PATHS, read: read, linesOf: linesOf, captionFor: captionFor, figureBoxes: figureBoxes, imageBoxes: imageBoxes, textBoxesOf: textBoxesOf, renderBox: renderBox, LIB: LIB, WORKER: WORKER };
if (typeof module !== 'undefined' && module.exports) module.exports = root.MemPdf;
})(typeof window !== 'undefined' ? window : this);
