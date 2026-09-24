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
    return { str: it.str, x: t[4], y: pageHeight - t[5], size: size, eol: !!it.hasEOL };
  });
  var lines = [];
  runs.forEach(function (r) {
    var l = lines[lines.length - 1];
    if (l && Math.abs(l.y - r.y) < Math.max(l.size, r.size) * 0.5) {
      var sep = /\s$/.test(l.text) || /^\s/.test(r.str) ? '' : ' ';
      l.text += sep + r.str; l.size = Math.max(l.size, r.size);
    } else {
      lines.push({ text: r.str, y: r.y, size: r.size });
    }
  });
  return lines.map(function (l) { return { text: l.text.replace(/\s+/g, ' ').trim(), y: l.y, size: Math.round(l.size * 10) / 10 }; });
}

/* ArrayBuffer → { pages: [{ page, lines }], wordCounts: [n per page] } */
function read(buffer, onProgress) {
  return lib().then(function (L) {
    return L.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
  }).then(function (doc) {
    var pages = [], counts = [];
    var chain = Promise.resolve();
    for (var i = 1; i <= doc.numPages; i++) {
      (function (n) {
        chain = chain.then(function () { return doc.getPage(n); }).then(function (page) {
          var h = page.getViewport({ scale: 1 }).height;
          return page.getTextContent().then(function (tc) {
            var lines = linesOf(tc.items, h);
            pages.push({ page: n, lines: lines });
            counts.push(lines.reduce(function (s, l) { return s + l.text.split(/\s+/).filter(Boolean).length; }, 0));
            if (onProgress) onProgress(n, doc.numPages);
          });
        });
      })(i);
    }
    return chain.then(function () { return { pages: pages, wordCounts: counts, numPages: doc.numPages }; });
  });
}

root.MemPdf = { read: read, linesOf: linesOf, LIB: LIB, WORKER: WORKER };
})(typeof window !== 'undefined' ? window : this);
