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
    return { str: it.str, x: t[4], w: +it.width || 0, y: pageHeight - t[5], size: size, eol: !!it.hasEOL };
  });
  var lines = [];
  runs.forEach(function (r) {
    var l = lines[lines.length - 1];
    if (l && Math.abs(l.y - r.y) < Math.max(l.size, r.size) * 0.5) {
      var sep = /\s$/.test(l.text) || /^\s/.test(r.str) ? '' : ' ';
      l.text += sep + r.str; l.size = Math.max(l.size, r.size);
      /* A wide gap between runs on one line starts a new CELL. chunk.js
         reads cells to find tables; prose lines end up with one cell. */
      var c = l.cells[l.cells.length - 1];
      if (r.x - c.end > Math.max(l.size, r.size) * 1.5) l.cells.push({ x: r.x, text: r.str, end: r.x + r.w });
      else { c.text += sep + r.str; c.end = Math.max(c.end, r.x + r.w); }
    } else {
      lines.push({ text: r.str, y: r.y, size: r.size, cells: [{ x: r.x, text: r.str, end: r.x + r.w }] });
    }
  });
  return lines.map(function (l) {
    return { text: l.text.replace(/\s+/g, ' ').trim(), y: l.y, size: Math.round(l.size * 10) / 10,
             cells: l.cells.map(function (c) { return { x: Math.round(c.x), text: c.text.replace(/\s+/g, ' ').trim() }; })
                           .filter(function (c) { return c.text; }) };
  });
}

/* ── figures ────────────────────────────────────────────────────────────────
   Where on a page each embedded picture is drawn. A picture is painted into
   the unit square under the current transform, so tracking the transform
   through save/restore gives its box in PDF units. Tiny images (bullets,
   logos, rules) are dropped. Vector drawings — charts made of lines rather
   than a picture — are NOT found this way; the page viewer shows those. */
function mul(m, n) {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3],
          m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
function figureBoxes(opList, OPS, view) {
  var ctm = [1, 0, 0, 1, 0, 0], stack = [], boxes = [];
  var paint = {};
  [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat, OPS.paintJpegXObject]
    .forEach(function (o) { if (o != null) paint[o] = true; });
  for (var i = 0; i < opList.fnArray.length; i++) {
    var fn = opList.fnArray[i], args = opList.argsArray[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (paint[fn]) {
      var xs = [], ys = [];
      [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(function (p) {
        xs.push(ctm[0] * p[0] + ctm[2] * p[1] + ctm[4]); ys.push(ctm[1] * p[0] + ctm[3] * p[1] + ctm[5]);
      });
      var b = [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)];
      var w = b[2] - b[0], h = b[3] - b[1];
      if (w >= 60 && h >= 40 && w * h >= 0.02 * view[2] * view[3]) boxes.push(b.map(function (v) { return Math.round(v); }));
    }
  }
  return boxes;
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
              figureBoxes(ops, Lib.OPS, page.view).forEach(function (b) { figures.push({ page: n, box: b }); });
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

root.MemPdf = { read: read, linesOf: linesOf, figureBoxes: figureBoxes, renderBox: renderBox, LIB: LIB, WORKER: WORKER };
if (typeof module !== 'undefined' && module.exports) module.exports = root.MemPdf;
})(typeof window !== 'undefined' ? window : this);
