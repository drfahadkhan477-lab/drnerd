/* ═══════════════════════════════════════════════════════════════════════════
   figure.js — figures made from the book, never invented.

   PURE. The owner asked for a figure or image generator. An image model
   draws a convincing valve or ECG and gets it wrong — anatomy invented,
   labels garbled — which is worse than no figure for someone memorising for
   an exam. So these figures are DRAWN FROM THE LESSON: every word and number
   on them is the book's (through sheet.js), laid out to be looked at and
   remembered, and saved as an image to keep or share:
     · a STUDY CARD for a section — big idea, key points under their
       clinical headings, number tiles, mnemonic;
     · a COMPARISON CHART across the sections learned — each one's big idea,
       numbers and mnemonic side by side, the way a student compares aortic
       stenosis with aortic regurgitation.
   Output is SVG text: every piece of text escaped, every line wrapped to
   the card's width. tests/verify-memorizer-figure-pure.js holds it.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var W = 1080;                 /* card width, px */
var PAD = 56;
var FONT = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
var C = { bg: '#FFFFFF', ink: '#0F172A', muted: '#475569', accent: '#0369A1', soft: '#E0F2FE', tile: '#F1F5F9', line: '#CBD5E1', hook: '#FEF3C7' };

function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/* Words into lines of at most `max` characters; a word longer than that is
   a line of its own, never cut. */
function wrap(text, max) {
  var out = [], cur = '';
  String(text || '').split(/\s+/).filter(Boolean).forEach(function (w) {
    if (cur && (cur + ' ' + w).length > max) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
  });
  if (cur) out.push(cur);
  return out;
}
/* ~0.52 of the font size per character is a fair average for these faces. */
function charsFor(width, size) { return Math.max(8, Math.floor(width / (size * 0.52))); }

function Doc() { this.parts = []; this.y = 0; }
Doc.prototype.text = function (x, size, weight, color, lines, lead) {
  var self = this;
  lines.forEach(function (l) {
    self.y += size * (lead || 1.35);
    self.parts.push('<text x="' + x + '" y="' + Math.round(self.y) + '" font-size="' + size + '" font-weight="' + weight + '" fill="' + color + '">' + esc(l) + '</text>');
  });
};
Doc.prototype.rect = function (x, y, w, h, fill, r) {
  this.parts.push('<rect x="' + x + '" y="' + Math.round(y) + '" width="' + w + '" height="' + Math.round(h) + '" rx="' + (r || 16) + '" fill="' + fill + '"/>');
};
Doc.prototype.svg = function (height, title) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + Math.round(height) + '" viewBox="0 0 ' + W + ' ' + Math.round(height) + '" font-family="' + esc(FONT) + '">' +
    '<title>' + esc(title) + '</title><rect width="100%" height="100%" fill="' + C.bg + '"/>' + this.parts.join('') + '</svg>';
};

/* A section's study card. sheet: sheet.js's sheetOf(); mnemonics: the
   lesson's; source: "Book · pp. 12–14". */
function studyCard(title, sheet, mnemonics, source) {
  var d = new Doc(), inner = W - 2 * PAD;
  d.y = PAD - 10;
  d.text(PAD, 20, 700, C.accent, [String(source || '').toUpperCase()]);
  d.text(PAD, 44, 800, C.ink, wrap(title, charsFor(inner, 44)), 1.2);
  d.y += 18;
  var ideaLines = wrap(sheet.bigIdea, charsFor(inner - 48, 28));
  var top = d.y;
  d.rect(PAD, top, inner, ideaLines.length * 28 * 1.4 + 48, C.soft);
  d.y = top + 12;
  d.text(PAD + 24, 28, 700, C.ink, ideaLines, 1.4);
  d.y = top + ideaLines.length * 28 * 1.4 + 48 + 12;
  (sheet.groups || []).forEach(function (g) {
    d.y += 14;
    d.text(PAD, 20, 800, C.accent, [g.heading.toUpperCase()]);
    g.points.forEach(function (p) {
      d.y += 4;
      d.text(PAD + 20, 24, 400, C.ink, wrap('• ' + p.text, charsFor(inner - 20, 24)), 1.35);
    });
  });
  (sheet.numbers || []).forEach(function (n) {
    d.y += 24;
    if (n.subject) d.text(PAD, 22, 800, C.ink, [n.subject]);
    d.y += 12;
    var cols = Math.min(3, n.tiles.length), tw = (inner - (cols - 1) * 16) / cols, row = 0;
    n.tiles.forEach(function (t, i) {
      var col = i % cols;
      if (col === 0 && i) row++;
      var x = PAD + col * (tw + 16), y = d.y + row * 116;
      d.rect(x, y, tw, 100, C.tile, 14);
      d.parts.push('<text x="' + Math.round(x + 18) + '" y="' + Math.round(y + 50) + '" font-size="34" font-weight="800" fill="' + C.ink + '">' + esc(t.value) + '</text>');
      d.parts.push('<text x="' + Math.round(x + 18) + '" y="' + Math.round(y + 82) + '" font-size="20" fill="' + C.muted + '">' + esc(wrap(t.label, charsFor(tw - 36, 20))[0] || '') + '</text>');
    });
    d.y += (row + 1) * 116 - 16;
  });
  (mnemonics || []).forEach(function (m) {
    d.y += 28;
    var h = 70 + m.words.length * 44;
    d.rect(PAD, d.y, inner, h, C.hook);
    var y0 = d.y;
    d.y += 8;
    d.text(PAD + 24, 22, 800, C.ink, [m.title]);
    m.words.forEach(function (w) {
      d.y += 10;
      d.y += 34;
      d.parts.push('<text x="' + (PAD + 24) + '" y="' + Math.round(d.y) + '" font-size="34" font-weight="800" fill="' + C.accent + '">' + esc(w.charAt(0).toUpperCase()) + '</text>' +
        '<text x="' + (PAD + 72) + '" y="' + Math.round(d.y) + '" font-size="28" fill="' + C.ink + '">' + esc(w) + '</text>');
    });
    d.y = y0 + h;
  });
  d.y += 36;
  d.text(PAD, 18, 400, C.muted, ['Made by Memorizer from your book’s own words.']);
  return d.svg(d.y + PAD, title);
}

/* A comparison across sections: rows [{ title, sheet, mnemonic }]. */
function compareChart(unitName, rows) {
  var d = new Doc(), inner = W - 2 * PAD;
  var colW = [260, inner - 260 - 300, 300];
  d.y = PAD - 10;
  d.text(PAD, 20, 700, C.accent, ['COMPARE']);
  d.text(PAD, 40, 800, C.ink, wrap(unitName, charsFor(inner, 40)), 1.2);
  d.y += 20;
  var heads = ['Section', 'The big idea', 'Numbers'];
  var x = PAD;
  heads.forEach(function (hd, i) { d.parts.push('<text x="' + x + '" y="' + Math.round(d.y + 20) + '" font-size="18" font-weight="800" fill="' + C.muted + '">' + esc(hd.toUpperCase()) + '</text>'); x += colW[i]; });
  d.y += 36;
  rows.forEach(function (r, k) {
    var cells = [
      wrap(r.title, charsFor(colW[0] - 20, 24)),
      wrap(r.sheet.bigIdea, charsFor(colW[1] - 24, 22)),
      [].concat.apply([], (r.sheet.numbers || []).map(function (n) { return n.tiles.map(function (t) { return t.label + ' ' + t.value; }); })).reduce(function (a, t) { return a.concat(wrap(t, charsFor(colW[2], 20))); }, []),
    ];
    if (r.mnemonic) cells[0] = cells[0].concat(['', r.mnemonic.letters.split('').join(' · ')]);
    var lines = Math.max(cells[0].length, cells[1].length, Math.max(1, cells[2].length));
    var h = lines * 32 + 28;
    if (k % 2 === 0) d.rect(PAD - 12, d.y, inner + 24, h, C.tile, 10);
    var cx = PAD;
    cells.forEach(function (cell, i) {
      cell.forEach(function (l, j) {
        d.parts.push('<text x="' + cx + '" y="' + Math.round(d.y + 36 + j * 32) + '" font-size="' + (i === 0 ? 24 : i === 1 ? 22 : 20) + '" font-weight="' + (i === 0 ? 800 : 400) + '" fill="' + (i === 2 ? C.accent : C.ink) + '">' + esc(l) + '</text>');
      });
      cx += colW[i];
    });
    d.y += h + 8;
  });
  d.y += 28;
  d.text(PAD, 18, 400, C.muted, ['Made by Memorizer from your book’s own words.']);
  return d.svg(d.y + PAD, 'Compare: ' + unitName);
}

var MemFigure = { W: W, esc: esc, wrap: wrap, charsFor: charsFor, studyCard: studyCard, compareChart: compareChart };
root.MemFigure = MemFigure;
if (typeof module !== 'undefined' && module.exports) module.exports = MemFigure;
})(typeof window !== 'undefined' ? window : this);
