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

function loadScript(src, sri, failure) {
  return new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = src; s.integrity = sri; s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = function () { reject(new Error(failure || 'could not load the PDF reader — are you offline?')); };
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
   a line, a bar, an axis, a curve that is stroked or filled. A clipping
   path is built exactly like a drawn one, so a path counts only when the
   next operator paints it.

   A path's box is worked out here from its own points (pathBounds), not
   taken from the bounds pdf.js 3.11 attaches: those ([minX, maxX, minY,
   maxY], evaluator.js buildPath) are updated only by moveTo, lineTo and
   rectangle, so a curve's extent is lost: a circle drawn as "m c c c c"
   came out as the single point it starts from, and a pie chart as a few
   lines from its centre. */
/* A path's bounds from its operators ([op…]) and their flat numbers. A
   curve contributes its end point and wherever it turns — the t in (0, 1)
   where its derivative is zero, per axis — so the box is the curve's own,
   not the hull of its control points (a wave's controls stand well above
   its crest). "v" curves take the current point as their first control,
   "y" curves their end point as their second, so the current point is
   tracked; closePath returns to the start of the subpath. */
function cubicRange(p0, p1, p2, p3) {
  var lo = Math.min(p0, p3), hi = Math.max(p0, p3);
  var a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
  var ts = [];
  if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) ts.push(-c / b); }
  else {
    var d = b * b - 4 * a * c;
    if (d >= 0) { var r = Math.sqrt(d); ts.push((-b + r) / (2 * a), (-b - r) / (2 * a)); }
  }
  ts.forEach(function (t) {
    if (t > 0 && t < 1) {
      var u = 1 - t, v = u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
  });
  return [lo, hi];
}
function pathBounds(ops, nums, OPS) {
  var arity = {};
  arity[OPS.moveTo] = 2; arity[OPS.lineTo] = 2; arity[OPS.curveTo] = 6;
  arity[OPS.curveTo2] = 4; arity[OPS.curveTo3] = 4; arity[OPS.closePath] = 0; arity[OPS.rectangle] = 4;
  var b = [Infinity, Infinity, -Infinity, -Infinity], at = 0, cx = 0, cy = 0, sx = 0, sy = 0;
  function pt(x, y) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
  function curve(x1, y1, x2, y2, x3, y3) {
    var rx = cubicRange(cx, x1, x2, x3), ry = cubicRange(cy, y1, y2, y3);
    pt(rx[0], ry[0]); pt(rx[1], ry[1]);
    cx = x3; cy = y3;
  }
  for (var i = 0; i < (ops || []).length; i++) {
    var op = ops[i], n = arity[op], q = nums.slice(at, at + (n || 0));
    if (n == null) return null;
    if (op === OPS.moveTo) { cx = sx = q[0]; cy = sy = q[1]; pt(cx, cy); }
    else if (op === OPS.lineTo) { cx = q[0]; cy = q[1]; pt(cx, cy); }
    else if (op === OPS.curveTo) curve(q[0], q[1], q[2], q[3], q[4], q[5]);
    else if (op === OPS.curveTo2) curve(cx, cy, q[0], q[1], q[2], q[3]);
    else if (op === OPS.curveTo3) curve(q[0], q[1], q[2], q[3], q[2], q[3]);
    else if (op === OPS.closePath) { cx = sx; cy = sy; }
    else if (op === OPS.rectangle) { pt(q[0], q[1]); pt(q[0] + q[2], q[1] + q[3]); cx = sx = q[0]; cy = sy = q[1]; }
    at += n;
  }
  return isFinite(b[0]) && isFinite(b[1]) && isFinite(b[2]) && isFinite(b[3]) ? b : null;
}
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
  /* ANNOTATIONS are not the page. pdf.js puts each one's appearance —
     a reader's highlight, underline or note — into the operator list
     between begin/endAnnotation, drawn under a matrix of its own that the
     transform tracking here does not follow. A highlighted textbook's
     marks came out as "figures" of prose cropped from the wrong place. A
     highlight is never a figure, so annotations are skipped whole. */
  var inAnnot = 0;
  for (var i = 0; i < opList.fnArray.length; i++) {
    var fn = opList.fnArray[i], args = opList.argsArray[i];
    if (OPS.beginAnnotation != null && fn === OPS.beginAnnotation) { inAnnot++; continue; }
    if (OPS.endAnnotation != null && fn === OPS.endAnnotation) { inAnnot = Math.max(0, inAnnot - 1); continue; }
    if (inAnnot) continue;
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (OPS.paintFormXObjectBegin != null && fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm.slice());
      if (args && args[0] && args[0].length === 6) ctm = mul(ctm, args[0]);
    } else if (OPS.paintFormXObjectEnd != null && fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (paint[fn]) images.push(place(0, 0, 1, 1));
    else if (OPS.constructPath != null && fn === OPS.constructPath && ink[opList.fnArray[i + 1]]) {
      var pb = args && pathBounds(args[0], args[1], OPS);
      if (pb) paths.push(place(pb[0], pb[1], pb[2], pb[3]));
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
   touches a picture is part of it — axes and labels drawn over a plot.

   A RULED TABLE is lines too, and one with little text in it passes the
   text-cover rule. What gives it away is its text: TABLE_ROWS or more lines
   inside the drawing each split into two or more cells (linesOf's wide
   gaps) is rows of columns — a table, which chunk.js already reads as one.
   A chart's tick labels are one such line, and its legend at most one more. */
var TABLE_ROWS = 3;
function tableInside(b, lines, view) {
  var H = view[3] - view[1];
  return (lines || []).filter(function (l) {
    var base = H - l.y, x = l.cells && l.cells[0] ? l.cells[0].x : -1;
    return l.cells && l.cells.length >= 2 && base >= b[1] && base <= b[3] && x >= b[0] - 4 && x <= b[2];
  }).length >= TABLE_ROWS;
}
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
function figureBoxes(opList, OPS, view, textBoxes, lines) {
  var d = drawn(opList, OPS);
  var pageArea = (view[2] - view[0]) * (view[3] - view[1]);
  var pics = merge(d.images.map(function (b) { return { box: b, n: 1 }; }), 6).map(function (m) { return m.box; });
  var drawings = merge(d.paths.filter(function (b) { return area(b) <= 0.8 * pageArea; })
    .map(function (b) { return { box: b, n: 1 }; }), 6)
    .filter(function (m) { return m.n >= VECTOR_MIN_PATHS && !tableInside(m.box, lines, view); }).map(function (m) { return m.box; });
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

/* ArrayBuffer → { pages: [{ page, lines }], wordCounts: [n per page], figures: [{ page, box }],
   ocr: [pages read by text recognition], ocrError, outline: [{ title, page, depth }] }.
   onProgress(n, total, 'ocr' for the scanned-page pass); onStatus(message).
   opts.figures === false skips looking for figures: a whole book looks for
   them one chapter at a time, when the chapter is opened (figuresOn). */
function wordsIn(lines) { return lines.reduce(function (s, l) { return s + l.text.split(/\s+/).filter(Boolean).length; }, 0); }
function read(buffer, onProgress, onStatus, opts) {
  var Lib, withFigures = !(opts && opts.figures === false);
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
            counts.push(wordsIn(lines));
            if (!withFigures) return null;
            return page.getOperatorList().then(function (ops) {
              figureBoxes(ops, Lib.OPS, page.view, textBoxesOf(tc.items), lines).forEach(function (b) {
                var f = { page: n, box: b }, cap = captionFor(b, lines, h);
                if (cap) { f.number = cap.number; f.label = cap.label; f.caption = cap.text; }
                figures.push(f);
              });
            }, function () { /* a page whose drawing cannot be listed still has its text */ });
          }).then(function () { if (onProgress) onProgress(n, doc.numPages); });
        });
      })(i);
    }
    /* Pages with (almost) no text layer are scans: each is drawn and read
       by text recognition (ocr.js), and its lines take the place of the
       empty ones. A page recognition cannot read either stays empty, and
       is still named to the user as scanned; if the reader cannot load at
       all (offline), every scanned page is named, as before. */
    var ocr = [], ocrError = '';
    /* Which pages are scans is known only once the text pass is done: the
       list is taken inside the chain, not while it is being built. (The
       first version took it outside, before any page had been read, found
       none, and recognised nothing.) */
    chain = chain.then(function () {
      var scanned = root.MemOcr ? root.MemChunk.scannedPages(counts) : [];
      var ocrChain = Promise.resolve();
      scanned.forEach(function (n, k) {
        ocrChain = ocrChain.then(function () { if (onProgress) onProgress(k + 1, scanned.length, 'ocr'); return doc.getPage(n); })
          .then(function (page) { return root.MemOcr.readPage(page, onStatus).then(function (items) { return linesOf(items, page.getViewport({ scale: 1 }).height); }); })
          .then(function (lines) {
            var wc = wordsIn(lines);
            if (!root.MemChunk.scannedPages([wc]).length) { pages[n - 1].lines = lines; counts[n - 1] = wc; ocr.push(n); }
          });
      });
      return ocrChain.catch(function (e) { ocrError = (e && e.message) || String(e); });
    });
    var outline = [];
    chain = chain.then(function () { return outlineOf(doc); }).then(function (o) { outline = o; });
    return chain.then(function () { return { pages: pages, wordCounts: counts, numPages: doc.numPages, figures: figures, ocr: ocr, ocrError: ocrError, outline: outline }; });
  });
}

/* The PDF's own bookmarks, flattened: [{ title, page, depth }], depth 0 at
   the top. An entry whose destination cannot be resolved to a page is left
   out; a PDF without bookmarks gives []. Never throws: a broken outline is
   no outline. */
function outlineOf(doc) {
  var out = [];
  function pageOf(dest) {
    var d = typeof dest === 'string' ? doc.getDestination(dest) : Promise.resolve(dest);
    return d.then(function (arr) {
      if (!arr || !arr[0]) return null;
      return typeof arr[0] === 'object' ? doc.getPageIndex(arr[0]).then(function (i) { return i + 1; }) : (typeof arr[0] === 'number' ? arr[0] + 1 : null);
    });
  }
  function walk(items, depth) {
    return (items || []).reduce(function (p, it) {
      return p.then(function () {
        return (it.dest ? pageOf(it.dest) : Promise.resolve(null)).catch(function () { return null; });
      }).then(function (pg) {
        var title = String(it.title || '').replace(/\s+/g, ' ').trim();
        if (pg && title) out.push({ title: title, page: pg, depth: depth });
        return walk(it.items, depth + 1);
      });
    }, Promise.resolve());
  }
  return doc.getOutline().then(function (items) { return walk(items, 0); }).then(function () { return out; }, function () { return out; });
}

/* Figures on some pages of a stored PDF, found as read() finds them —
   for a book, a chapter at a time. pageNos are this file's own page
   numbers; each figure found is returned with that page. */
function figuresOn(key, buffer, pageNos) {
  var figures = [];
  return Promise.all([lib(), openStored(key, buffer)]).then(function (r) {
    var L = r[0], doc = r[1];
    return pageNos.reduce(function (p, n) {
      return p.then(function () { return doc.getPage(n); }).then(function (page) {
        var h = page.getViewport({ scale: 1 }).height;
        return page.getTextContent().then(function (tc) {
          var lines = linesOf(tc.items, h);
          return page.getOperatorList().then(function (ops) {
            figureBoxes(ops, L.OPS, page.view, textBoxesOf(tc.items), lines).forEach(function (b) {
              var f = { page: n, box: b }, cap = captionFor(b, lines, h);
              if (cap) { f.number = cap.number; f.label = cap.label; f.caption = cap.text; }
              figures.push(f);
            });
          }, function () {});
        });
      });
    }, Promise.resolve());
  }).then(function () { return figures; });
}

/* Draw part of a page — a figure's box, or the whole page — to a PNG data
   URL, at `scale` device pixels per PDF unit. Opened afresh each time from
   the stored bytes; a study session draws a handful, so nothing is kept
   open between them. */
/* A figure's box with a margin round it, kept on the page: a crop cut
   exactly at the drawing's edge clips a title bar's letters and a frame's
   outer line. */
var CROP_MARGIN = 8;
/* The finder's version, stored with the figures it found. 2: annotations
   skipped. */
var FIGURES_V = 2;
function padBox(box, view, m) {
  m = m == null ? CROP_MARGIN : m;
  return [Math.max(view[0], box[0] - m), Math.max(view[1], box[1] - m), Math.min(view[2], box[2] + m), Math.min(view[3], box[3] + m)];
}
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
      var r = vp.convertToViewportRectangle(padBox(box, page.view));
      var x = Math.max(0, Math.floor(Math.min(r[0], r[2]))), y = Math.max(0, Math.floor(Math.min(r[1], r[3])));
      var w = Math.min(canvas.width - x, Math.ceil(Math.abs(r[2] - r[0]))), hh = Math.min(canvas.height - y, Math.ceil(Math.abs(r[3] - r[1])));
      var out = document.createElement('canvas');
      out.width = Math.max(1, w); out.height = Math.max(1, hh);
      out.getContext('2d').drawImage(canvas, x, y, w, hh, 0, 0, w, hh);
      return out.toDataURL('image/png');
    });
  });
}

root.MemPdf = { PDFJS_V: /pdfjs-dist@([\d.]+)/.exec(BASE)[1], FIGURES_V: FIGURES_V, CROP_MARGIN: CROP_MARGIN, padBox: padBox, outlineOf: outlineOf, figuresOn: figuresOn, loadScript: loadScript, VECTOR_MIN_PATHS: VECTOR_MIN_PATHS, TABLE_ROWS: TABLE_ROWS, pathBounds: pathBounds, read: read, linesOf: linesOf, captionFor: captionFor, figureBoxes: figureBoxes, imageBoxes: imageBoxes, textBoxesOf: textBoxesOf, renderBox: renderBox, LIB: LIB, WORKER: WORKER };
if (typeof module !== 'undefined' && module.exports) module.exports = root.MemPdf;
})(typeof window !== 'undefined' ? window : this);
