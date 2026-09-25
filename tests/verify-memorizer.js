#!/usr/bin/env node
/*
 * Memorizer, end to end in a real browser: a real PDF goes in, real pdf.js
 * reads it into sections, and a unit goes through lesson → multiple-choice
 * drill → final exam → review, once with Claude stubbed at the network and
 * once with the built-in coach and nothing sent anywhere.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-memorizer.js
 *
 * Takes no build argument: it builds memorizer/ itself, into a temporary
 * directory, with scripts/build-memorizer.js — so what is tested is the one
 * file a user would open. The PDF is generated here, from nothing, so no
 * document of anyone's is involved.
 *
 * NEEDS THE NETWORK for one thing: pdf.js (and, for the scanned-page and
 * photo checks, the text reader), which the app fetches from jsDelivr with a
 * pinned version and an integrity hash. The suite fetches those bytes from
 * jsDelivr itself (see the route below for why) and the page still verifies
 * them against its hashes. Offline, the import step fails.
 *
 * WHAT IS PROVEN, beyond the pure suites, is the glue those cannot see:
 *   · pdf.js's output reaches the chunker in the shape it expects — the real
 *     PDF becomes the sections it was written as, running header dropped —
 *     and an import lands on those sections, not in a lesson;
 *   · the request for section 1 carries section 1 and nothing of section 2,
 *     and the exam's carries the full text of only the weakest sections;
 *   · model text reaches the page as text, never as markup;
 *   · a question is answered by choosing an option, never by typing; a miss
 *     comes back at the end of the drill and becomes one review card;
 *   · a failed step shows an error with a way out, and does not advance;
 *   · the session and its cards survive a reload.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };
const errors = [], events = [];
const die = onDeath(() => ({ section, checks: passed + failed, errors, events }));

const ROOT = path.join(__dirname, '..');
const { build } = require(path.join(ROOT, 'scripts', 'build-memorizer.js'));
const MemLookNode = require(path.join(ROOT, 'memorizer', 'src', 'appearance.js'));

/* ── a real PDF, written by hand ──────────────────────────────────────────
   Three sections, each a 20pt heading over ~650 words of 11pt body, a 9pt
   running header on every page and a page number at the foot. Every body
   word is unique to its section (s1w0001, s2w0001 …), so "section 1's
   request contains nothing of section 2" is an exact check. */
function makePdf() {
  const pages = [];
  let cur = [], y = 760;
  const newPage = () => { if (cur.length) pages.push(cur); cur = []; y = 760; };
  const line = (text, size, x) => {
    if (y < 70) newPage();
    cur.push({ text, size, y, x });
    y -= size + 5;
  };
  /* A table row: each cell its own text run, at its column's x — which is
     how a PDF lays a table out, and what pdf.js hands back. */
  const row = (cells) => {
    if (y < 70) newPage();
    cur.push({ cells, size: 11, y });
    y -= 16;
  };
  const titles = ['Section One Preload', 'Section Two Afterload', 'Section Three Contractility'];
  /* Cause-and-effect sentences for the flowchart, in section 1. */
  const causal = ['Diuretics reduce preload by lowering circulating volume.',
    'Excessive preload raises venous pressure and causes pulmonary congestion.',
    'Rising venous pressure leads to oedema of the lungs.'];
  /* One sentence worth a pearl — a threshold and a rule — printed over two
     lines, the way a paragraph wraps. The filler words cannot be one. It
     says "greater than", not "above": pearl.js refuses any sentence with
     "above" or "below" in it, as a pointer to text outside the pearl. */
  const pearlLines = ['A left ventricular end-diastolic pressure greater than 18 mmHg should prompt a search for volume',
    'overload, whereas a normal pressure of 8 to 12 mmHg does not exclude a stiff ventricle.'];
  const CAPTION = 'Figure 4 A test picture.';
  const table = [['Measure', 'Normal', 'Unit'], ['LVEDP', '12', 'mmHg'], ['Stroke volume', '70', 'mL'], ['Heart rate', '72', 'bpm']];
  /* Letter-coded (s1wab …), not numbered: a body line of numbered words
     normalises to the same text on every page, which is what a running
     header looks like. */
  const code = i => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(i / 26) % 26] + 'abcdefghijklmnopqrstuvwxyz'[i % 26];
  const PER = 320;
  let bodyWords = 0;
  let IMG_BOX = null, VEC = null, TBL = null;
  const VCAP = 'Figure 5 A drawn chart.';
  titles.forEach((t, si) => {
    if (si) y -= 20;
    line(t, 20); bodyWords += t.split(' ').length;
    if (si === 0) causal.forEach(c => { line(c, 11); bodyWords += c.split(' ').length; });
    if (si === 0) { y -= 8; pearlLines.forEach(c => { line(c, 11); bodyWords += c.split(' ').length; }); }
    if (si === 0) y -= 12;
    /* A gap in section 1 for the picture, the way a book leaves one. */
    if (si === 0) { IMG_BOX = [300, y - 105, 500, y - 5]; y -= 115; }
    /* Its caption, under it and set at its left edge, in small type. */
    if (si === 0) { line(CAPTION, 9, 300); bodyWords += CAPTION.split(' ').length; y -= 6; }
    const words = [];
    for (let i = 1; i <= PER; i++) words.push(`s${si + 1}w${code(i)}` + (i % 10 === 0 ? '.' : ''));
    for (let i = 0; i < words.length; i += 12) line(words.slice(i, i + 12).join(' '), 11);
    bodyWords += PER;
    /* Section 3 carries a chart drawn only with lines and filled
       rectangles — no picture in it — and its caption. */
    if (si === 2) {
      if (y < 70 + 150) newPage();
      VEC = { pageIndex: pages.length, box: [150, y - 125, 450, y - 5] };
      y -= 135; line(VCAP, 9, 150); bodyWords += VCAP.split(' ').length; y -= 6;
    }
    if (si === 1) {
      y -= 12;
      /* Ruled, as a book rules a table: a line over and under every row and
         between the columns. Lines and not a picture, so only its rows of
         cells can tell it from a chart. */
      if (y < 70 + 16 * table.length) newPage();
      const top = y + 13;
      table.forEach(r => { row(r.map((c, ci) => [72 + ci * 150, c])); bodyWords += r.join(' ').split(' ').length; });
      TBL = { pageIndex: pages.length, box: [66, y + 11, 520, top] };
      y -= 12;
    }
  });
  newPage();

  /* Two pictures on page 1, both a 2×2 RGB image: one 200×100 in the gap
     left for it, and one drawn UNDER a block of body text — a highlight
     band, which is what the first figure finder cropped as a "figure". */
  const UNDER_BOX = [100, 250, 400, 350];
  const objs = [];
  const add = s => { objs.push(s); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pixels = Buffer.from([200, 40, 40, 40, 200, 40, 40, 40, 200, 220, 220, 40]).toString('latin1');
  const image = add(`<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 12 >>\nstream\n${pixels}\nendstream`);
  const pagesId = objs.length + pages.length * 2 + 1; /* the object after every page and its content */
  const kids = [];
  const esc = t => String(t).replace(/([()\\])/g, '\\$1');
  pages.forEach((lines, pi) => {
    const ops = ['BT /F1 9 Tf 72 790 Td (Memorizer Test Unit) Tj ET'];
    lines.forEach(l => {
      if (l.cells) l.cells.forEach(([x, t]) => ops.push(`BT /F1 ${l.size} Tf ${x} ${l.y} Td (${esc(t)}) Tj ET`));
      else ops.push(`BT /F1 ${l.size} Tf ${l.x || 72} ${l.y} Td (${esc(l.text)}) Tj ET`);
    });
    ops.push(`BT /F1 9 Tf 300 30 Td (${pi + 1}) Tj ET`);
    if (pi === 0) [IMG_BOX, UNDER_BOX].forEach(B => ops.unshift(`q ${B[2] - B[0]} 0 0 ${B[3] - B[1]} ${B[0]} ${B[1]} cm /Im1 Do Q`));
    if (pi === TBL.pageIndex) {
      const [x0, y0, x1, y1] = TBL.box;
      ops.push('q 0.5 w');
      for (let k = 0; k <= table.length; k++) ops.push(`${x0} ${y1 - k * 16} m ${x1} ${y1 - k * 16} l S`);
      [x0, 216, 366, x1].forEach(x => ops.push(`${x} ${y0} m ${x} ${y1} l S`));
      ops.push('Q');
    }
    if (pi === VEC.pageIndex) {
      const [x0, y0, x1, y1] = VEC.box;
      ops.push(`q 1 w ${x0} ${y0} m ${x1} ${y0} l S ${x0} ${y0} m ${x0} ${y1} l S`);
      for (let i = 0; i < 8; i++) ops.push(`${x0 + 10 + i * 36} ${y0} 24 ${10 + i * 14} re f`);
      ops.push('Q');
    }
    const stream = ops.join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    const xo = pi === 0 ? ` /XObject << /Im1 ${image} 0 R >>` : '';
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${font} 0 R >>${xo} >> /Contents ${content} 0 R >>`));
  });
  const realPages = add(`<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`);
  if (realPages !== pagesId) throw new Error(`PDF object numbering: pages object is ${realPages}, expected ${pagesId}`);
  const catalog = add(`<< /Type /Catalog /Pages ${realPages} 0 R >>`);
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { buffer: Buffer.from(out, 'latin1'), pages: pages.length, titles, bodyWords, table, causal, IMG_BOX, CAPTION, VEC, VCAP, TBL, pearl: pearlLines.join(' '),
           firstCode: code(1), lastCode: code(PER) };
}

/* A one-page PDF of two columns of prose, written LINE BY LINE across both
   columns — left line, right line, next left, next right — which is how
   some PDF writers lay out a two-column page. pdf.js then hands back one
   line per height with both columns in it. */
function makeTwoColumnPdf() {
  const L = [], R = [];
  for (let i = 0; i < 12; i++) { L.push(`leftcol${i} alpha beta gamma delta.`); R.push(`rightcol${i} one two three four.`); }
  const ops = ['BT /F1 18 Tf 72 780 Td (Two Column Page) Tj ET'];
  for (let i = 0; i < 12; i++) {
    ops.push(`BT /F1 10 Tf 72 ${750 - i * 14} Td (${L[i]}) Tj ET`);
    ops.push(`BT /F1 10 Tf 320 ${750 - i * 14} Td (${R[i]}) Tj ET`);
  }
  const stream = ops.join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let out = '%PDF-1.4\n';
  const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return { buffer: Buffer.from(out, 'latin1'), left: L.join(' '), right: R.join(' ') };
}

/* A one-page PDF with a TABLE PRINTED IN A SHADED BOX, as textbooks do:
   a filled box, a filled header band and six rules — a drawing, to the
   figure finder — with its title "TABLE 9.1 …" on the box's own top row
   and single-column items. The owner's book had such tables labelled
   "Figure 1". */
function makeBoxedTablePdf() {
  const T = (t, size, x, y) => `BT /F1 ${size} Tf ${x} ${y} Td (${t}) Tj ET`;
  const text = [T('Exertional Fainting', 18, 72, 740),
    T('Exertional fainting is a classic symptom of severe outflow obstruction.', 11, 72, 700),
    T('Its causes are listed in the table below, and each calls for prompt assessment.', 11, 72, 684),
    T('TABLE 9.1 Causes of exertional fainting', 9, 78, 506),
    ...['Severe aortic stenosis', 'Hypertrophic cardiomyopathy', 'Pulmonary hypertension', 'Complete heart block'].map((t, i) => T(t, 9, 90, 470 - i * 20))];
  const draw = ['0.9 g 72 300 400 220 re f', '0.7 g 72 500 400 20 re f', '0 G 0.5 w',
    ...[480, 460, 440, 420, 400, 380].map(y => `72 ${y} m 472 ${y} l S`)];
  const stream = draw.concat(['0 g'], text).join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let out = '%PDF-1.4\n';
  const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/* A one-page PDF with a LABELLED DIAGRAM: a drawing (filled shapes and
   rules) with five short labels printed inside it and its caption under
   it, as an anatomy figure is printed. */
function makeDiagramPdf() {
  const T = (t, size, x, y) => `BT /F1 ${size} Tf ${x} ${y} Td (${t}) Tj ET`;
  const text = [T('The Four Chambers', 18, 72, 740),
    T('The heart has four chambers: two atria above and two ventricles below.', 11, 72, 700),
    T('The aorta leaves the left ventricle and carries blood to the body.', 11, 72, 684),
    T('Left atrium', 9, 120, 560), T('Right atrium', 9, 330, 560), T('Left ventricle', 9, 120, 420), T('Right ventricle', 9, 330, 420), T('Aorta', 9, 240, 610),
    T('Figure 2.1 The chambers of the heart.', 9, 100, 318)];
  const draw = ['0.85 g 100 330 400 300 re f', '0.6 g 110 470 180 120 re f 310 470 180 120 re f 110 340 180 120 re f 310 340 180 120 re f',
    '0 G 1 w 100 465 m 500 465 l S 300 330 m 300 630 l S'];
  const stream = draw.concat(['0 g'], text).join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let out = '%PDF-1.4\n';
  const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/* A two-page PDF: page 1 has a text layer, page 2 is a SCAN — one JPEG of
   a page of text, drawn by the browser (makeScanJpeg below), no text at
   all — so only text recognition can read it. */
function makeScanPdf(jpeg, w, h) {
  const text = ['BT /F1 18 Tf 72 740 Td (Text Layer Page) Tj ET',
    'BT /F1 11 Tf 72 700 Td (This first page carries real text that pdf.js reads directly.) Tj ET'].join('\n');
  const scan = 'q 612 0 0 792 0 0 cm /Im1 Do Q';
  const parts = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 7 0 R >> >> /Contents 8 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    null,
    `<< /Length ${scan.length} >>\nstream\n${scan}\nendstream`,
  ];
  let out = Buffer.from('%PDF-1.4\n', 'latin1');
  const off = [];
  parts.forEach((o, i) => {
    off.push(out.length);
    const body = o === null
      ? Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, 'latin1'), jpeg, Buffer.from('\nendstream', 'latin1')])
      : Buffer.from(o, 'latin1');
    out = Buffer.concat([out, Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
  });
  const x = out.length;
  const tail = `xref\n0 ${parts.length + 1}\n0000000000 65535 f \n` + off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') +
    `trailer\n<< /Size ${parts.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.concat([out, Buffer.from(tail, 'latin1')]);
}
/* A book in two PDFs, the way a long textbook is split: pages 1–4 and 5–8
   of one book, each file numbering its own pages from 1. Page 1 is front
   matter; chapters open with "Chapter N" and their title at 24pt, and every
   other page carries a running header "CHAPTER N Title". Chapter 2 opens on
   page 4 and runs on into the second file, where page 5 holds its picture
   and caption. Each file has bookmarks for its own chapters, titled
   "1. …" so the chapters they give can be told from the headings'. Every
   body word is its chapter's own (c1w…, c2w…). */
function writePdf(pageOps, outline, withImage) {
  const objs = [];
  const add = s => { objs.push(s); return objs.length; };
  const reserve = () => { objs.push(null); return objs.length; };
  const catalog = reserve(), pagesId = reserve();
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pixels = Buffer.from([200, 40, 40, 40, 200, 40, 40, 40, 200, 220, 220, 40]).toString('latin1');
  const image = add(`<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 12 >>\nstream\n${pixels}\nendstream`);
  const kids = pageOps.map((ops, i) => {
    const stream = ops.join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    const xo = withImage === i ? ` /XObject << /Im1 ${image} 0 R >>` : '';
    return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${font} 0 R >>${xo} >> /Contents ${content} 0 R >>`);
  });
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
  let outlines = '';
  if (outline.length) {
    const root = reserve();
    const items = outline.map(() => reserve());
    outline.forEach((o, i) => {
      objs[items[i] - 1] = `<< /Title (${o.title}) /Parent ${root} 0 R /Dest [${kids[o.pageIndex]} 0 R /XYZ 0 842 0]` +
        (i > 0 ? ` /Prev ${items[i - 1]} 0 R` : '') + (i < items.length - 1 ? ` /Next ${items[i + 1]} 0 R` : '') + ' >>';
    });
    objs[root - 1] = `<< /Type /Outlines /First ${items[0]} 0 R /Last ${items[items.length - 1]} 0 R /Count ${items.length} >>`;
    outlines = ` /Outlines ${root} 0 R`;
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R${outlines} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const BOOK_CHAPTERS = [{ n: 1, title: 'Heart Failure Basics', pages: [2, 3] }, { n: 2, title: 'Valve Disease', pages: [4, 5] }, { n: 3, title: 'Arrhythmias', pages: [6, 7, 8] }];
const BOOK_FIG = { page: 5, box: [300, 560, 500, 660], caption: 'Figure 2.1 A valve picture.' };
function makeBook() {
  const code = i => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(i / 26) % 26] + 'abcdefghijklmnopqrstuvwxyz'[i % 26];
  const T = (t, size, x, y) => `BT /F1 ${size} Tf ${x} ${y} Td (${t}) Tj ET`;
  const counters = {};
  const body = (n, y0, count) => {
    const ops = [];
    for (let l = 0; l < count; l++) {
      const ws = [];
      for (let k = 0; k < 10; k++) { counters[n] = (counters[n] || 0) + 1; ws.push(`c${n}w${code(counters[n])}` + (counters[n] % 10 === 0 ? '.' : '')); }
      ops.push(T(ws.join(' '), 11, 72, y0 - l * 16));
    }
    return ops;
  };
  const pages = [];
  for (let pg = 1; pg <= 8; pg++) {
    const ops = [];
    const ch = BOOK_CHAPTERS.find(c => c.pages.includes(pg));
    if (!ch) { ops.push(T('Contents', 20, 72, 760)); ops.push(T('This book was written for the test suite only.', 11, 72, 720)); }
    else if (ch.pages[0] === pg) { ops.push(T('Chapter ' + ch.n, 24, 72, 760)); ops.push(T(ch.title, 24, 72, 728)); ops.push(...body(ch.n, 690, 26)); }
    else {
      ops.push(T(`CHAPTER ${ch.n} ${ch.title}`, 9, 72, 800));
      if (pg === BOOK_FIG.page) {
        const [x0, y0, x1, y1] = BOOK_FIG.box;
        ops.push(`q ${x1 - x0} 0 0 ${y1 - y0} ${x0} ${y0} cm /Im1 Do Q`);
        ops.push(T(BOOK_FIG.caption, 9, 300, y0 - 12));
        ops.push(...body(ch.n, 520, 22));
      } else ops.push(...body(ch.n, 770, 30));
    }
    ops.push(T(String(pg <= 4 ? pg : pg - 4), 9, 300, 30));
    pages.push(ops);
  }
  const a = writePdf(pages.slice(0, 4), [{ title: '1. Heart Failure Basics', pageIndex: 1 }, { title: '2. Valve Disease', pageIndex: 3 }], -1);
  const b = writePdf(pages.slice(4), [{ title: '3. Arrhythmias', pageIndex: 1 }], BOOK_FIG.page - 5);
  return { a, b, words: counters };
}
const SCAN_LINES = ['Venous return is the main determinant of preload', 'in a healthy heart, and preload rises with volume.'];
/* In the page: a 1224 x 1584 canvas (twice 612 x 792) of black text on white, as JPEG. */
const makeScanJpeg = (lines) => {
  const c = document.createElement('canvas'); c.width = 1224; c.height = 1584;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#000';
  x.font = 'bold 44px Helvetica, Arial, sans-serif'; x.fillText('Scanned Page Heading', 144, 200);
  x.font = '26px Helvetica, Arial, sans-serif';
  lines.forEach((t, i) => x.fillText(t, 144, 300 + i * 40));
  return c.toDataURL('image/jpeg', 0.92).split(',')[1];
};


/* ── the model, stubbed at the network ────────────────────────────────── */
const EVIL = '<img src=x onerror="window.__pwned=1">';
const Q_WHAT = { question: 'What is preload?', quote: '', options: ['End-diastolic stretch', 'Wall stress in ejection', 'Heart rate', 'Contractility'],
                 answer: 0, explain: 'Preload is the stretch at end-diastole.', page: 1 };
const Q_GAP = { question: 'Which does a diuretic lower?', quote: 'Diuretics reduce _____ by lowering circulating volume.',
                options: ['afterload', 'preload', 'contractility', 'heart rate'], answer: 1, explain: 'Diuretics reduce preload.', page: 1 };
const stub = {
  requests: [],
  breakNext: null,
  reply(kind) {
    switch (kind) {
      case 'lesson': return {
        overview: 'Preload is how full the ventricle is before it squeezes.',
        points: [{ text: 'Preload — end-diastolic stretch ' + EVIL, page: 1 }, { text: 'Venous return is the most common thing that sets preload', page: 2 }],
        numbers: [{ text: 'An LVEDP greater than 18 mmHg prompts a search for overload', page: 1 }],
        mnemonics: [{ title: 'What sets preload', letters: 'VVC', words: ['Venous return', 'Volume', 'Compliance'] }],
        analogies: [{ title: 'A balloon', text: 'The more you fill a balloon, the harder it snaps back.', source: 'Claude' }],
        flowchart: '' };
      case 'quiz': return { questions: [Q_WHAT, Q_GAP] };
      case 'exam': return { questions: [Object.assign({ cluster: 0 }, Q_WHAT, { question: 'In the exam: what is preload?' }),
                                        Object.assign({ cluster: 1 }, Q_GAP, { question: 'In the exam: which does a diuretic lower?' })] };
      default: return null;
    }
  },
};
function kindOf(user) {
  if (/TASK:\nTEACH /.test(user)) return 'lesson';
  if (/TASK:\nDRILL\./.test(user)) return 'quiz';
  if (/TASK:\nFINAL EXAM\./.test(user)) return 'exam';
  return 'unknown';
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memorizer-'));
  const built = build(dir);
  const pdf = makePdf();
  const browser = await launch();
  /* routablePage()'s context — no service worker, so page.route() sees
     every request — written out so the page is created inside watch(), which
     verify-engine requires of every browser suite. */
  const page = watch(await (await browser.newContext({ viewport: { width: 820, height: 1100 }, serviceWorkers: 'block' })).newPage(), events, '', errors);
  await page.addInitScript(() => {
    try { localStorage.setItem('memorizer.ai.v1', JSON.stringify({ provider: 'anthropic', model: 'claude-opus-5', key: 'sk-ant-stub' })); } catch (_) {}
  });
  /* jsDelivr is fetched from the Node side and handed to the page. Not to
     change what is served — the bytes are jsDelivr's own, and the page still
     checks them against its pinned integrity hashes — but because a
     sandboxed browser may not trust a TLS-intercepting proxy that Node does
     (NODE_EXTRA_CA_CERTS). Measured: in this repository's cloud sandbox the
     browser failed pdf.min.js with ERR_CERT_AUTHORITY_INVALID. */
  let cdnHits = 0;
  const wire = async page => {
  await page.route('https://cdn.jsdelivr.net/**', async route => {
    cdnHits++;
    const res = await fetch(route.request().url());
    const body = Buffer.from(await res.arrayBuffer());
    return route.fulfill({ status: res.status, body, headers: {
      'content-type': res.headers.get('content-type') || 'application/javascript',
      'access-control-allow-origin': '*' } });
  });
  /* The hook's handwriting face comes from Google Fonts, which this sandbox's
     browser cannot reach; the app falls back to the device's own script
     face either way, so the request is answered empty rather than left to
     fail into the death note. */
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://api.anthropic.com/**', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    const user = (body.messages && body.messages[0] && body.messages[0].content) || '';
    const kind = kindOf(user);
    stub.requests.push({ kind, user, body, headers: route.request().headers() });
    if (kind === stub.breakNext) {
      stub.breakNext = null;
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"points": [ oops' }] }) });
    }
    const v = stub.reply(kind);
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(v) }] }) });
  });
  };
  await wire(page);
  const URL = 'file://' + path.join(dir, 'index.html');
  const T = { timeout: 60000 };
  const text = async (p, sel) => (await p.locator(sel).innerText()).replace(/\s+/g, ' ').trim();
  /* Go through the memorise cards, each known, until the drill opens. A
     precondition for the flows that test the drill, not a proposition. */
  const memorize = async p => {
    await p.locator('#recall').waitFor(T);
    while (await p.evaluate(() => Memorizer.ui.state.phase === 'memorize')) {
      const at = await p.evaluate(() => { const s = Memorizer.ui.state; return s.per[s.section].memo.pos; });
      await p.locator('#recall-show').click();
      await p.locator('#recall-knew').click();
      await p.waitForFunction(k => !document.querySelector('#recall') || new RegExp('^Card ' + (k + 2) + ' of').test(document.querySelector('#recall .mcq-meta').textContent), at, T);
    }
  };
  const meta = p => p.locator('.mcq-meta').innerText();
  /* Choose option i, then Next; waits for the next question (or the end)
     by the progress line changing, not by time. */
  const answer = async (p, i) => {
    const before = await meta(p);
    await p.locator(`.option[data-i="${i}"]`).click();
    await p.locator('#next').click();
    await p.waitForFunction(b => { const m = document.querySelector('.mcq-meta'); return !m || m.innerText !== b; }, before, T);
  };

  head('the built file');
  ok('builds from memorizer/ with every module inlined', built.inlined.length >= 10 && built.inlined.some(f => /analogies\.js$/.test(f)), built.inlined.join(', '));
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  ok('and it is one file: no script or stylesheet it loads from the repository',
     !/<script src="(?!https:)/.test(html) && !/<link rel="stylesheet" href="(?!https:)/.test(html));
  await page.goto(URL);
  await page.locator('#door-add').waitFor(T);
  ok('opens as a local file on the home screen: what shall we learn, and a box to add it', (await page.locator('h1.learn').innerText()) === 'Learn?' &&
     await page.locator('label.learn-box#door-add[for="pdf-input"]').count() === 1);
  ok('with chips to upload a PDF, add photos or paste notes',
     await page.locator('.chips label.chip[for="pdf-input"]').count() === 1 && await page.locator('.chips label.chip[for="photo-input"]').count() === 1 &&
     await page.locator('#chip-paste').count() === 1, await text(page, '.chips'));
  ok('with no errors on load', errors.length === 0, errors.join(' | '));

  head('a real PDF becomes the sections it was written as');
  await page.setInputFiles('#pdf-input', { name: 'unit.pdf', mimeType: 'application/pdf', buffer: pdf.buffer });
  await page.locator('#sections .section-card').first().waitFor(T);
  ok('the import lands on the unit’s sections, before any lesson', await page.evaluate(() => Memorizer.ui.state.phase === 'unit') && stub.requests.length === 0,
     `${stub.requests.length} requests`);
  ok('one card per section, numbered and titled by its heading',
     JSON.stringify(await page.$$eval('#sections .section-card .section-title', es => es.map(e => e.textContent))) === JSON.stringify(pdf.titles) &&
     JSON.stringify(await page.$$eval('#sections .band-n', es => es.map(e => e.textContent))) === '["1","2","3"]',
     JSON.stringify(await page.$$eval('#sections .section-card .section-title', es => es.map(e => e.textContent))));
  ok('each new, with no score yet', await page.locator('#sections .section-card[data-state="new"]').count() === 3 &&
     await page.locator('#sections .section-card .badge').count() === 0);
  ok('the final exam is locked until every section is drilled', await page.locator('#exam-card.locked').count() === 1 &&
     /0 of 3/.test(await page.locator('#exam-card').innerText()) && await page.locator('#exam-card #to-exam').count() === 0);
  ok('and the one button says Learn unit', (await page.locator('#learn-unit').innerText()) === 'Learn unit');
  /* The owner's screenshot: the button floated over the foot of the page and
     covered the last sections, and each card carried a block of colour. The
     button now sits above the sections, in the flow; the colour is a line. */
  const unitLook = await page.evaluate(() => { const b = document.querySelector('#learn-unit'), s = document.querySelector('#sections');
    const band = getComputedStyle(document.querySelector('#sections .band'));
    return { above: b.getBoundingClientRect().bottom <= s.getBoundingClientRect().top, pos: getComputedStyle(b.parentElement).position,
      fill: band.backgroundColor, line: parseFloat(band.borderTopWidth) }; });
  ok('the button sits above the sections, not over them; each card’s colour is a line along its top',
     unitLook.above && unitLook.pos === 'static' && /rgba\(0, 0, 0, 0\)|transparent/.test(unitLook.fill) && unitLook.line > 0 && unitLook.line <= 6, JSON.stringify(unitLook));
  const rec = await page.evaluate(() => MemStore.all('docs').then(d => d[0]));
  ok('the unit is stored with its page count', rec.pages === pdf.pages && rec.name === 'unit' && rec.source === 'pdf', `${rec.pages} pages`);
  ok('each section is titled by its heading', JSON.stringify(rec.clusters.map(c => c.title)) === JSON.stringify(pdf.titles),
     rec.clusters.map(c => c.title).join(' | '));
  ok('each holds its own section’s words and none of another’s', rec.clusters.every((c, i) =>
     new RegExp('s' + (i + 1) + 'w' + pdf.firstCode).test(c.text) && ![1, 2, 3].filter(n => n !== i + 1).some(n => new RegExp('s' + n + 'w[a-z]').test(c.text))));
  ok('and every word of the PDF’s body is in one', rec.clusters.reduce((n, c) => n + c.words, 0) === pdf.bodyWords,
     String(rec.clusters.reduce((n, c) => n + c.words, 0)));
  ok('the running header on every page is gone', !rec.clusters.some(c => /Memorizer Test Unit/.test(c.text)));
  ok('no page is reported as scanned', rec.scanned.length === 0, JSON.stringify(rec.scanned));
  const tbl = rec.clusters[1].segments.find(g => g.table);
  ok('the table in section 2 is found, cell for cell', !!tbl && JSON.stringify(tbl.table) === JSON.stringify(pdf.table), tbl && JSON.stringify(tbl.table));
  ok('the picture on page 1 is found where it was drawn, and the band under the text is not a figure', rec.figures.filter(f => f.page === 1).length === 1 && rec.figures[0].page === 1 &&
     rec.figures[0].box.every((v, i) => Math.abs(v - pdf.IMG_BOX[i]) <= 1), JSON.stringify(rec.figures) + ' want ' + JSON.stringify(pdf.IMG_BOX));
  const vf = rec.figures.find(f => f.page === pdf.VEC.pageIndex + 1);
  ok('a chart drawn only with lines and bars is found too, where it was drawn, by the real pdf.js',
     rec.figures.length === 2 && !!vf && vf.box.every((v, i) => Math.abs(v - pdf.VEC.box[i]) <= 2), JSON.stringify(rec.figures.slice(1)) + ' want ' + JSON.stringify(pdf.VEC.box));
  ok('with its own caption', vf && vf.number === '5' && vf.caption === pdf.VCAP, vf && vf.caption);
  const onTable = rec.figures.filter(f => f.page === pdf.TBL.pageIndex + 1 && f.box[0] < pdf.TBL.box[2] && pdf.TBL.box[0] < f.box[2] && f.box[1] < pdf.TBL.box[3] && pdf.TBL.box[1] < f.box[3]);
  ok('the ruled table in section 2 is not taken for a drawn figure', onTable.length === 0, JSON.stringify(onTable) + ' table at ' + JSON.stringify(pdf.TBL));
  ok('its caption is read with it, number and all', rec.figures[0] && rec.figures[0].number === '4' && rec.figures[0].caption === pdf.CAPTION,
     JSON.stringify(rec.figures[0]));
  ok('and the PDF itself is kept on the device, to draw them from', await page.evaluate(id => MemStore.get('files', id).then(f => !!f && f.bytes.byteLength > 1000), rec.id));
  ok('pdf.js and its worker came from the pinned CDN', cdnHits >= 2, `${cdnHits} requests`);
  /* Provenance: the unit knows exactly which bytes it came from, and what
     read them. The digest is computed here, in Node, from the PDF handed
     in — not read back from the page and compared with itself. */
  const sha = 'sha256:' + require('crypto').createHash('sha256').update(pdf.buffer).digest('hex');
  ok('the unit keeps a SHA-256 of the PDF it came from, and its file name', rec.fingerprint === sha && rec.fileName === 'unit.pdf', rec.fingerprint);
  ok('and what read it: this build, the pinned PDF reader, the figure finder', rec.processing && rec.processing.build === built.stamp &&
     rec.processing.pdfjs === '3.11.174' && rec.processing.figures === await page.evaluate(() => MemPdf.FIGURES_V), JSON.stringify(rec.processing));
  const srcCard = (await page.locator('#source-card').textContent()).replace(/\s+/g, ' ');
  ok('the unit page says where it came from and how it was read', new RegExp(pdf.pages + ' of ' + pdf.pages + ' pages read from the PDF').test(srcCard) &&
     /Read cleanly/.test(srcCard) && /unit\.pdf/.test(srcCard) && srcCard.indexOf('SHA-256 ' + sha.slice(7, 19)) !== -1 && /2 figures/.test(srcCard) && /1 table/.test(srcCard), srcCard.slice(0, 200));
  await page.locator('nav.dock').getByRole('button', { name: 'Home' }).click();
  await page.locator('#pdf-input').waitFor({ state: 'attached', timeout: 60000 });
  await page.setInputFiles('#pdf-input', { name: 'unit (copy).pdf', mimeType: 'application/pdf', buffer: pdf.buffer });
  /* Either way a unit is opened; that is the precondition, not the notice. */
  await page.waitForFunction(() => Memorizer.ui.view === 'session' && !Memorizer.ui.importing && document.querySelector('#sections'), null, T);
  ok('the same PDF added again opens the unit already here, and makes no copy', await page.evaluate(() => MemStore.all('docs').then(d => d.length)) === 1 &&
     await page.locator('#notice').count() === 1 && /already added this as \u201Cunit\u201D/.test(await page.locator('#notice').innerText()) && await page.evaluate(() => Memorizer.ui.state.phase === 'unit'));

  head('the lesson: only this section leaves the device');
  await page.locator('#learn-unit').click();
  await page.locator('ol.points > li').first().waitFor(T);
  const les = stub.requests.filter(r => r.kind === 'lesson');
  ok('one lesson request was made', les.length === 1 && stub.requests.length === 1, stub.requests.map(r => r.kind).join(', '));
  ok('it carries section 1’s words, with their pages', new RegExp('s1w' + pdf.firstCode + '\\b').test(les[0].user) && new RegExp('s1w' + pdf.lastCode + '\\b').test(les[0].user) && /\[p\.1\]/.test(les[0].user));
  ok('and nothing of sections 2 or 3', !/s[23]w[a-z]/.test(les[0].user));
  ok('with the grounding prohibition as its system prompt, and the analogy fence in the task', /NOT_IN_PDF/.test(JSON.stringify(les[0].body.system)) && /Supreme Memorizer/.test(JSON.stringify(les[0].body.system)) &&
     les[0].user.indexOf('The ONLY thing you may write that is not from the excerpt is an analogy') !== -1);
  ok('and the browser-access header Anthropic requires', les[0].headers['anthropic-dangerous-direct-browser-access'] === 'true');
  ok('the step says Learn', (await page.locator('.stepper li.now').textContent()) === 'Learn');
  ok('the big idea comes first', (await text(page, '#big-idea .big')) === 'Preload is how full the ventricle is before it squeezes.' &&
     await page.evaluate(() => document.querySelector('#big-idea').compareDocumentPosition(document.querySelector('#points')) & Node.DOCUMENT_POSITION_FOLLOWING));
  /* The glass's sheen is a background image; laid over every card it took
     the big idea's dark band away and left its light text on light glass. */
  const band = await page.evaluate(() => { const p = document.createElement('div'); p.style.backgroundImage = 'linear-gradient(145deg, var(--hero-a), var(--hero-b))';
    document.body.appendChild(p); const want = getComputedStyle(p).backgroundImage; p.remove();
    return { want: want, got: getComputedStyle(document.querySelector('#big-idea')).backgroundImage }; });
  ok('the big idea keeps its dark band, so its light text reads', /gradient/.test(band.want) && band.got === band.want, JSON.stringify(band));
  const pointText = await page.locator('ol.points > li').first().innerText();
  ok('the key points are numbered cards, a definition leading with its term',
     await page.locator('ol.points > li').count() === 2 && (await page.locator('ol.points > li .lead').first().innerText()) === 'Preload' &&
     (await page.locator('ol.points > li .point-n').first().innerText()) === '1', pointText.replace(/\s+/g, ' '));
  /* A point that says what an exam asks is marked high-yield, with why; a
     plain one is not. */
  const hyShown = await page.$$eval('ol.points > li', ls => ls.map(l => [...l.querySelectorAll('.hy-tags span')].map(x => x.textContent)));
  ok('a high-yield point says so, and why; a plain one is not marked', hyShown.length === 2 && hyShown[0].length === 0 &&
     JSON.stringify(hyShown[1]) === JSON.stringify(['High yield', 'Most common']), JSON.stringify(hyShown));
  /* The ☆ that marks a point made it a third item in a two-column grid, and
     the text fell into the 2.25rem number column, a word to a line. Widths
     as laid out: the text has the room, the star sits at the end, all on
     one row. */
  const pointBox = await page.evaluate(() => { const li = document.querySelector('ol.points > li'), w = q => li.querySelector(q).getBoundingClientRect();
    const n = w('.point-n'), b = w('.point-body'), m = li.querySelector('.mark-btn') ? w('.mark-btn') : null;
    return { n: Math.round(n.width), body: Math.round(b.width), star: !!m, row: !!m && Math.abs(m.top - b.top) < 12 && m.left >= b.right - 1 }; });
  ok('each point’s text has the width, with its star beside it on the same row', pointBox.star && pointBox.body > 6 * pointBox.n && pointBox.row, JSON.stringify(pointBox));
  ok('model text is shown as text — the tag is visible, not run', pointText.indexOf('<img') !== -1 &&
     await page.locator('ol.points img').count() === 0 && await page.evaluate(() => window.__pwned) === undefined);
  ok('an analogy from Claude is shown, and labelled as not from the book',
     /A balloon/.test(await page.locator('.analogy h3').innerText()) && /written by Claude — not from your book/.test(await page.locator('.analogy .label').innerText()),
     await text(page, '.analogy'));
  ok('the numbers to know are value tiles: the value large, what it measures under it', (await page.locator('#numbers .tile-value').first().textContent()) === '> 18 mmHg' &&
     (await page.locator('#numbers .tile-label').first().textContent()) === 'LVEDP', await text(page, '#numbers .tiles'));
  ok('the mnemonic is big letters, each named', (await text(page, '.hook .hook-script')) === 'V · V · C' &&
     JSON.stringify(await page.$$eval('.hook .acrostic .word', ws => ws.map(w => w.textContent))) === '["Venous return","Volume","Compliance"]');
  ok('and the whole section is one tap away', /s1wab/.test(await page.locator('details.source').textContent()));
  /* The owner's screenshots showed the drill button floating over the key
     points. It is the lesson's last thing now, in the flow of the page. */
  ok('the drill button comes last, in the page, covering nothing', await page.evaluate(() => {
    const b = document.querySelector('#to-drill'), wrap = b.parentElement;
    return getComputedStyle(wrap).position === 'static' && wrap === wrap.parentElement.lastElementChild; }));
  /* The picture found at import is drawn from the stored PDF, cropped. */
  await page.waitForFunction(() => { const i = document.querySelector('#visuals .figs img'); return i && /^data:image\/png/.test(i.src) && i.naturalWidth > 0; }, null, T);
  const fig = await page.evaluate(() => { const i = document.querySelector('#visuals .figs img'); return { w: i.naturalWidth, h: i.naturalHeight }; });
  const M = await page.evaluate(() => MemPdf.CROP_MARGIN), B = pdf.IMG_BOX, shape = (B[2] - B[0] + 2 * M) / (B[3] - B[1] + 2 * M);
  ok('the figure on page 1 is shown, cut from the page at its own shape, with its margin', M > 0 && Math.abs(fig.w / fig.h - shape) < 0.03, `${fig.w}×${fig.h}, expected ${shape.toFixed(3)}`);
  const figCap = await page.locator('#visuals .figs figcaption').first().innerText();
  ok('under its own caption, and named by it to a screen reader', figCap.indexOf(pdf.CAPTION) === 0 &&
     await page.locator('#visuals .figs button[aria-label="Enlarge Figure 4"]').count() === 1, figCap);
  await page.waitForFunction(() => [...document.querySelectorAll('#visuals .pages img')].every(i => /^data:image\/png/.test(i.src)) &&
    document.querySelectorAll('#visuals .pages img').length >= 1, null, T);
  ok('and every page of the section is there to open', (await page.locator('#visuals .pages img').count()) >= 1);
  await page.locator('#visuals .pages button').first().click();
  await page.locator('.lightbox img').waitFor(T);
  await page.waitForFunction(() => /^data:image/.test((document.querySelector('.lightbox img') || {}).src || ''), null, T);
  ok('a page opens large', await page.locator('.lightbox').count() === 1);
  ok('focus goes into it, the lesson behind it inert, and it says which page of which unit it is', await page.evaluate(() => document.activeElement && document.activeElement.id) === 'lb-close' &&
     await page.evaluate(() => document.getElementById('app').inert) && /page 1 of unit/.test(await page.locator('.lightbox .lb-where').innerText()),
     await page.locator('.lightbox .lb-where').innerText());
  await page.keyboard.press('Tab');
  ok('Tab stays inside it', await page.evaluate(() => !!document.activeElement.closest('.lightbox')));
  await page.keyboard.press('Escape');
  ok('and Escape closes it', await page.locator('.lightbox').count() === 0);
  ok('giving focus back to the page it was opened from', await page.evaluate(() => (document.activeElement.getAttribute('aria-label') || '') === 'Open page 1' && !document.getElementById('app').inert),
     await page.evaluate(() => document.activeElement.getAttribute('aria-label') || document.activeElement.tagName));
  await page.locator('#fold-pages > summary').click();
  const shut = await page.evaluate(() => !document.querySelector('#fold-pages').open && !document.querySelector('#visuals .pages').checkVisibility());
  /* precondition: the lesson has been drawn again — a new #fold-pages, not the old one */
  await page.evaluate(() => { document.querySelector('#fold-pages').__old = true; Memorizer.render(); });
  await page.waitForFunction(() => { const f = document.querySelector('#fold-pages'); return f && !f.__old; }, null, T);
  ok('the pages minimise with their button, and stay minimised when the lesson is drawn again', shut &&
     await page.evaluate(() => !document.querySelector('#fold-pages').open && document.querySelector('#fold-figures').open),
     JSON.stringify({ shut, now: await page.evaluate(() => ({ pages: document.querySelector('#fold-pages').open, figs: !!document.querySelector('#fold-figures') && document.querySelector('#fold-figures').open, folds: Memorizer.ui.folds })) }));
  await page.locator('#fold-pages > summary').click();
  ok('and open again', await page.evaluate(() => document.querySelector('#fold-pages').open && document.querySelector('#visuals .pages').checkVisibility()));
  await page.locator('#glance .gl-path').waitFor(T);
  ok('at a glance: the cause-and-effect sentences as a pathway, the book\u2019s verbs on the arrows', /^Diuretics reduce → preload raises → venous pressure/.test(await text(page, '#glance .gl-path')) &&
     await page.locator('#flow').count() === 0, await text(page, '#glance .gl-path'));
  ok('the quick check comes after the lesson\u2019s cards, before its extras', await page.evaluate(() => {
    const q = document.querySelector('#quick'), h = document.querySelector('.hook'), n = document.querySelector('#numbers');
    return !!q && !!(h.compareDocumentPosition(q) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(n.compareDocumentPosition(q) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  await page.locator('#quick .option').first().click();
  ok('answered, it shows right or wrong and why — and is not recorded', await page.locator('#quick .why').count() === 1 &&
     await page.evaluate(() => Memorizer.ui.state.per[0].answers.length === 0 && Memorizer.ui.state.cards.length === 0 && Memorizer.ui.state.phase === 'teach'));

  head('the robot coach, on the right');
  const rb = await page.evaluate(() => { const r = document.querySelector('#robot').getBoundingClientRect();
    return { cx: r.left + r.width / 2, right: innerWidth - r.right, w: innerWidth, pos: getComputedStyle(document.querySelector('#robot-dock')).position }; });
  ok('a robot waits at the right of the screen, fixed, during a lesson', rb.pos === 'fixed' && rb.cx > rb.w * 0.8 && rb.right >= 0 && rb.right < 40, JSON.stringify(rb));
  ok('with no window open until it is tapped', await page.locator('#robot-panel').count() === 0);
  await page.locator('#robot').click();
  await page.locator('#robot-panel').waitFor(T);
  const rp = await text(page, '#robot-panel');
  ok('tapped, it explains the section: in one line, and its cause and effect as one sentence', /In one line/i.test(rp) &&
     /Diuretics reduce preload, which raises venous pressure, which leads to oedema of the lungs\./.test(rp), rp.slice(0, 240));
  await page.locator('#robot-panel .rb-close').click();
  ok('and closes', await page.locator('#robot-panel').count() === 0);

  head('Play this section: slides, one card at a time, animated');
  await page.locator('#step-mode').click();
  await page.locator('#lesson-steps').waitFor(T);
  const N = +(/\/(\d+)/.exec(await text(page, '#lesson-steps .step-count')) || [])[1];
  const MARKS = ['#big-idea', '#clinical-map', '#pathway-play', '#socratic', '#glance', '#points', '#numbers', '.hook', '#quick', '#teach-back', '#visuals'];
  const MUST = ['#big-idea', '#pathway-play', '#socratic', '#points', '#numbers', '.hook', '#quick', '#teach-back', '#visuals'];
  /* THE STAGES (the owner's plan, phase 2): a strip of them over the slides,
     the first one current, and each a way straight to its first slide. */
  const stageStrip = await page.$$eval('#stages li', ls => ls.map(l => [l.getAttribute('data-stage'), l.getAttribute('data-state')]));
  ok('the lesson is staged: orient, mechanism, recognise, numbers, recall, the first one current',
     JSON.stringify(stageStrip.map(x => x[0])) === JSON.stringify(['orient', 'mechanism', 'recognise', 'numbers', 'recall']) && stageStrip[0][1] === 'now' && stageStrip.slice(1).every(x => x[1] === 'next'), JSON.stringify(stageStrip));
  await page.locator('#stages li[data-stage="numbers"] button').click();
  await page.waitForFunction(() => /Numbers to know/.test(document.querySelector('#lesson-steps .step-count').textContent), null, T);
  ok('a stage goes straight to its first slide, and the stages before it are done', await page.locator('main #numbers').count() === 1 &&
     JSON.stringify(await page.$$eval('#stages li', ls => ls.map(l => l.getAttribute('data-state')))) === '["done","done","done","now","next"]',
     JSON.stringify(await page.$$eval('#stages li', ls => ls.map(l => l.getAttribute('data-state')))));
  await page.locator('#stages li[data-stage="orient"] button').click();
  await page.waitForFunction(() => /^Slide 1\//.test(document.querySelector('#lesson-steps .step-count').textContent), null, T);
  /* what is showing, by opacity (and clip, for an unfolding word), with the composition held at time t */
  const at = (sel, t) => page.evaluate(([sel, t]) => {
    const comp = document.querySelector(sel); Memorizer.motion.seek(comp, t === 'end' ? Memorizer.motion.total(comp) : t);
    const vis = el => { const cs = getComputedStyle(el); return +cs.opacity > 0.95 && (cs.clipPath === 'none' || /^inset\((?:0(?:px|%)?\s*)+\)$/.test(cs.clipPath)) && !/matrix\(0|scale\(0/.test(cs.transform); };
    return [...comp.querySelectorAll('[data-start]')].map(el => ({ c: el.className, on: vis(el), t: el.textContent, tf: getComputedStyle(el).transform }));
  }, [sel, t]);
  const seen = [], motion = {};
  for (let i = 0; i < N; i++) {
    if (i) { await page.locator('#step-next').click(); await page.waitForFunction(k => new RegExp('^Slide ' + k + '/').test(document.querySelector('#lesson-steps .step-count').textContent), i + 1, T); }
    const here = await page.evaluate(ms => ms.filter(m => document.querySelector('main ' + m)), MARKS);
    seen.push(here);
    if (here[0] === '#pathway-play') motion.path = { start: await at('#pathway-play', 0.6), end: await at('#pathway-play', 'end'),
      running: await page.evaluate(() => document.querySelector('#pathway-play').getAnimations({ subtree: true }).length) };
    if (here[0] === '.hook') motion.hook = { letters: await at('.hook', 0.36 * (await page.locator('.hook .hs-letter').count())), end: await at('.hook', 'end') };
    if (here[0] === '#numbers') motion.nums = { early: await at('#numbers', 0.35), end: await at('#numbers', 'end'), text: await page.$$eval('#numbers .tile-value', ts => ts.map(t => t.textContent)) };
  }
  const order = seen.map(x => x[0]).filter((m, i, a) => a.indexOf(m) === i);
  ok('each slide shows one thing, in order — the idea, how it works, each heading’s points, the numbers, the mnemonic, a check, teaching it back, the figures — the drill at the end',
     N >= 7 && seen.every(x => x.length === 1) && MUST.every(m => order.includes(m)) && JSON.stringify(order) === JSON.stringify(MARKS.filter(m => order.includes(m))) &&
     await page.locator('#to-drill').count() === 1 && await page.locator('#step-next').count() === 0, JSON.stringify(seen));
  const P = motion.path || { start: [], end: [] }, steps = x => x.filter(p => /pp-step/.test(p.c));
  ok('the pathway: its steps appear in turn — at 0.6 s the first is there and the next is not', steps(P.start).length >= 3 && steps(P.start)[0].on && !steps(P.start)[1].on && P.running > 0,
     JSON.stringify(steps(P.start).map(p => p.on)));
  const line1 = (P.start || []).find(p => /pp-line/.test(p.c)), sc = line1 && /^matrix\(1, 0, 0, ([\d.]+)/.exec(line1.tf);
  ok('the arrow draws itself: just after it starts, it is part-way down', sc && +sc[1] > 0.05 && +sc[1] < 0.95, line1 && line1.tf);
  ok('and by the end every step is there, each arrow drawn, the book’s verbs on them in order', P.end.length > 0 && P.end.every(p => p.on) &&
     JSON.stringify(P.end.filter(p => /pp-verb/.test(p.c)).map(p => p.t)) === '["reduce","raises","leads to"]', JSON.stringify(P.end.map(p => p.t)));
  const Hk = motion.hook || { letters: [], end: [] };
  ok('the mnemonic: every letter out first, while each word is still folded', Hk.letters.filter(p => /hs-letter/.test(p.c)).every(p => p.on) &&
     Hk.letters.filter(p => /word/.test(p.c)).length === 3 && Hk.letters.filter(p => /word/.test(p.c)).every(p => !p.on), JSON.stringify(Hk.letters.map(p => p.on)));
  ok('then each word unfolds', Hk.end.length > 0 && Hk.end.every(p => p.on), JSON.stringify(Hk.end.map(p => p.on)));
  const Nm = motion.nums || { early: [], end: [], text: [] };
  ok('numbers build up: the sign before its value, the value before its label', Nm.early.length > 0 && Nm.early.find(p => /tv-sign/.test(p.c)) &&
     Nm.early.find(p => /tv-sign/.test(p.c)).t === '>' && Nm.early.find(p => /tv-sign/.test(p.c)).on && !Nm.early.find(p => /tv-num/.test(p.c)).on && !Nm.early.find(p => /tile-label/.test(p.c)).on, JSON.stringify(Nm.early.slice(0, 3)));
  ok('and end as the same tiles as the page shows', Nm.end.every(p => p.on) && Nm.text.includes('> 18 mmHg'), JSON.stringify(Nm.text));
  await page.locator('#step-back').click();
  ok('Back goes one slide back, and the drill button waits for the last', await page.locator('#to-drill').count() === 0 &&
     new RegExp('^Slide ' + (N - 1) + '/').test(await text(page, '#lesson-steps .step-count')));
  ok('the choice is remembered on this device', await page.evaluate(() => localStorage.getItem('memorizer.stepmode.v1')) === '1');
  /* a slide drawn again shows its animation finished, not replayed */
  while (!(await page.locator('main .hook').count())) await page.locator('#step-back').click();
  await page.evaluate(() => { document.querySelector('.hook').__old = true; Memorizer.render(); });
  await page.waitForFunction(() => { const x = document.querySelector('main .hook'); return x && !x.__old; }, null, T);
  ok('a slide drawn again is shown finished, not played over', await page.evaluate(() => { const c = document.querySelector('main .hook');
    return c.getAnimations({ subtree: true }).length > 0 && c.getAnimations({ subtree: true }).every(a => a.currentTime >= Memorizer.motion.total(c) * 1000 - 1); }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { document.querySelector('.hook').__old = true; Memorizer.render(); });
  await page.waitForFunction(() => { const x = document.querySelector('main .hook'); return x && !x.__old; }, null, T);
  ok('with reduced motion asked for, nothing moves and everything is there', await page.evaluate(() => { const c = document.querySelector('main .hook');
    return c.getAnimations({ subtree: true }).length === 0 && [...c.querySelectorAll('[data-start]')].every(el => getComputedStyle(el).opacity === '1'); }));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('#whole-page').click();
  await page.locator('#step-mode').waitFor(T);
  ok('and the whole lesson is one tap away again', await page.locator('main #points').count() === 1 && await page.locator('main #numbers').count() === 1 &&
     await page.locator('main .hook').count() >= 1 && await page.locator('#to-drill').count() === 1 && await page.locator('#lesson-steps').count() === 0);

  head('memorise it before the drill');
  await page.locator('#to-drill').click();
  await page.locator('#recall').waitFor(T);
  const nCards = await page.evaluate(() => Memorizer.ui.state.per[0].memo.order.length);
  ok('the lesson leads to memorising, not the drill: a card at a time, its answer hidden', nCards >= 3 && await page.locator('#mcq').count() === 0 &&
     await page.locator('#recall-answer').count() === 0 && (await page.locator('.stepper li.now').textContent()) === 'Memorize' &&
     await page.evaluate(() => Memorizer.ui.state.phase === 'memorize'), String(nCards));
  const firstPrompt = await text(page, '#recall .recall-prompt');
  await page.locator('#recall-show').click();
  ok('Show the answer, then say whether you knew it', await page.locator('#recall-answer').count() === 1 && await page.locator('#recall-knew').count() === 1 &&
     await page.locator('#recall-notyet').count() === 1);
  await page.locator('#recall-notyet').click();
  await page.waitForFunction(() => /^Card 2 of/.test(document.querySelector('#recall .mcq-meta').textContent), null, T);
  ok('a card not known comes back at the end', await page.evaluate(n => Memorizer.ui.state.per[0].memo.order.length === n + 1, nCards) &&
     /of \d+/.test(await meta(page)) && new RegExp('of ' + (nCards + 1)).test(await meta(page)),
     JSON.stringify({ nCards, memo: await page.evaluate(() => Memorizer.ui.state.per[0].memo), meta: await meta(page) }));
  ok('and the drill is still shut: going to it straight is refused', await page.evaluate(() => { try { MemSession.next(Object.assign({}, Memorizer.ui.state, { phase: 'teach' }), { type: 'toDrill' }); return false; } catch (e) { return /memorise/.test(e.message); } }));
  const prompts = [];
  while (await page.evaluate(() => Memorizer.ui.state.phase === 'memorize')) {
    prompts.push(await text(page, '#recall .recall-prompt'));
    const k = await page.evaluate(() => Memorizer.ui.state.per[0].memo.pos);
    await page.locator('#recall-show').click();
    await page.locator('#recall-knew').click();
    await page.waitForFunction(k => !document.querySelector('#recall') || new RegExp('^Card ' + (k + 2) + ' of').test(document.querySelector('#recall .mcq-meta').textContent), k, T);
  }
  ok('every card known once — the missed one again, last — and the drill opens by itself', prompts.length === nCards && prompts[prompts.length - 1] === firstPrompt &&
     await page.evaluate(() => Memorizer.ui.state.phase === 'drill' && Memorizer.ui.state.per[0].memorized === true), JSON.stringify(prompts.map(x => x.slice(0, 30))));

  head('the drill: multiple choice, and a miss comes back');
  await page.locator('#mcq .option').first().waitFor(T);
  const qz = stub.requests.filter(r => r.kind === 'quiz');
  ok('one drill request, carrying the lesson’s key points and section 1 only', qz.length === 1 && /1\. Preload — end-diastolic stretch/.test(qz[0].user) &&
     !/s[23]w[a-z]/.test(qz[0].user), qz.map(r => r.user.length).join());
  ok('the step says Drill, with Learn and Memorize done', (await page.locator('.stepper li.now').textContent()) === 'Drill' &&
     JSON.stringify(await page.$$eval('.stepper li.done', ls => ls.map(l => l.textContent))) === '["Learn","Memorize"]');
  ok('four options, lettered A to D, and nothing to type', JSON.stringify(await page.$$eval('#mcq .opt-letter', es => es.map(e => e.textContent))) === '["A","B","C","D"]' &&
     await page.locator('textarea, input[type="text"]').count() === 0);
  ok('the question counts where it is', /Question 1 of 2/.test(await meta(page)));
  await page.locator('#robot').click();
  await page.locator('#robot-panel').waitFor(T);
  const q1 = await page.evaluate(() => { const c = Memorizer.ui.state.per[0]; const q = c.quiz.questions[c.order[c.pos]]; return q.options[q.answer]; });
  const rq = await text(page, '#robot-panel');
  ok('the robot, before an answer: what the question asks — never the answer', /What it asks/i.test(rq) && !/\bWhy\b/i.test(rq) &&
     rq.toLowerCase().indexOf(q1.toLowerCase()) === -1 && await page.locator('#robot-panel .rb-options').count() === 0, rq.slice(0, 200));
  await page.locator('.option[data-i="0"]').click();
  ok('and once answered, why — every option explained, the answer marked', /\bWhy\b/i.test(await text(page, '#robot-panel')) &&
     await page.locator('#robot-panel .rb-options li').count() === 4 && await page.locator('#robot-panel .rb-options li.right').count() === 1 &&
     /stretch at end-diastole/.test(await text(page, '#robot-panel')));
  await page.locator('#robot-panel .rb-close').click();
  ok('a right choice turns green, with the book’s reason and page', await page.locator('.option.right[data-i="0"]').count() === 1 &&
     /Correct/.test(await page.locator('.why.good strong').innerText()) && /stretch at end-diastole/.test(await page.locator('.why').innerText()) &&
     await page.locator('.why .pg').count() === 1);
  ok('and every option is closed once one is chosen', await page.locator('.option:not([disabled])').count() === 0);
  ok('but nothing is recorded until Next', await page.evaluate(() => Memorizer.ui.state.per[0].answers.length === 0));
  await page.locator('#next').click();
  await page.waitForFunction(() => /Question 2 of 2/.test(document.querySelector('.mcq-meta').innerText), null, T);
  await page.locator('#prev-q').click();
  await page.locator('#fwd-q').waitFor(T);
  ok('Previous goes back to the question before, as it was answered — read-only, nothing recorded again', /Looking back · answer 1 of 1/.test(await meta(page)) &&
     await page.locator('.option.right[data-i="0"]').count() === 1 && await page.locator('.option:not([disabled])').count() === 0 &&
     await page.locator('#next').count() === 0 && await page.evaluate(() => Memorizer.ui.state.per[0].answers.length === 1 && Memorizer.ui.state.per[0].pos === 1));
  await page.locator('#fwd-q').click();
  await page.waitForFunction(() => /Question 2 of 2/.test(document.querySelector('.mcq-meta').innerText), null, T);
  ok('and forward again to the current question, still unanswered', await page.locator('.option:not([disabled])').count() === 4 && await page.locator('#prev-q').count() === 1);
  ok('a sentence from the book with a gap shows the gap', (await page.locator('blockquote.quote .gap').innerText()) === '_____');
  /* Said before answering (study.js): sure, and then wrong. */
  await page.locator('#sure').click();
  ok('"I’m sure" is said before answering, and shows it is on', (await page.locator('#sure').getAttribute('aria-pressed')) === 'true');
  await page.locator('.option[data-i="0"]').click();
  ok('sure and wrong: it says this is a confident miss, the most dangerous kind', /confident miss/.test(await text(page, '#hazard-note')));
  ok('a wrong choice turns red, and the right one green', await page.locator('.option.wrong[data-i="0"]').count() === 1 && await page.locator('.option.right[data-i="1"]').count() === 1 &&
     await page.locator('.option.dim').count() === 2);
  ok('it names the answer, fills the gap and says it will come back', /The answer is B: preload/.test(await page.locator('.why.bad strong').innerText()) &&
     (await page.locator('blockquote.quote .gap').innerText()) === 'preload' && /comes back at the end of this drill/.test(await page.locator('.why').innerText()));
  await page.locator('#next').click();
  await page.waitForFunction(() => /Again/.test(document.querySelector('.mcq-meta').innerText), null, T);
  ok('and the miss is filed as one: its weak item and its card are flagged', await page.evaluate(() => { const s = Memorizer.ui.state, w = Object.values(s.weak)[0];
    return !!w && w.hazard === true && s.cards.some(c => c.id === w.id && c.hazard === true) && s.per[0].answers[s.per[0].answers.length - 1].sure === true; }));
  ok('the miss is asked again at the end', (await page.locator('#mcq h2.q').innerText()) === Q_GAP.question && /you missed this one/.test(await meta(page)));
  await page.locator('.option[data-i="1"]').click();
  await page.locator('#next').click();
  await page.locator('#result').waitFor(T);
  ok('the week’s log has the drill’s three answers, as the drill’s, the one missed filed under its section', await page.evaluate(() => {
    const d = Memorizer.ui.activity && Memorizer.ui.activity.days[FSRS.todayISO()];
    return !!d && d.answers === 3 && d.right === 2 && d.by && d.by.drill === 3 && d.misses['Section One Preload'] === 1; }),
    JSON.stringify(await page.evaluate(() => Memorizer.ui.activity)));
  ok('the result counts first tries only: 1 of 2', /1 of 2 right first time/.test(await page.locator('#result h2').innerText()) &&
     (await page.locator('#result .ring-pct').innerText()) === '50%');
  ok('and lists what was missed, with its answer', /Which does a diuretic lower\?/.test(await page.locator('ul.missed').innerText()) &&
     /→ preload/.test(await page.locator('ul.missed').innerText()));
  /* Misses' cards carry no kind; the recall cards a drill makes (study.js
     cloze and occlusion) do, and are checked on their own below. */
  const allCards1 = await page.evaluate(() => MemStore.all('cards'));
  const cards1 = allCards1.filter(c => !c.kind);
  ok('the miss is one review card, carrying its options', cards1.length === 1 && cards1[0].source === 'drill' && cards1[0].front === Q_GAP.question &&
     cards1[0].options.length === 4 && cards1[0].answer === 1, cards1.map(c => c.source + ':' + c.front).join(' | '));
  const recall1 = allCards1.filter(c => c.kind === 'cloze');
  const tomorrow1 = await page.evaluate(() => MemStudy.addDays(FSRS.todayISO(), 1));
  ok('the drill also made the section’s recall cards: its own sentences with a number or term blanked, starting tomorrow',
     recall1.length === 2 && recall1.every(c => c.cluster === 0 && c.dueFrom === tomorrow1 && c.front.indexOf('_____') !== -1 && c.explain.replace('_____', '') !== c.explain.replace(c.back, '')) &&
     recall1.some(c => /\d/.test(c.back)), recall1.map(c => c.back + ' @' + c.dueFrom).join(' | '));
  ok('and they are not due today: the drill does not end in a second drill', await page.evaluate(() => MemStore.all('cards').then(cs => MemSession.dueCards(cs, FSRS.todayISO()).filter(c => c.kind).length)) === 0);
  ok('the next step offers section 2', /Section Two Afterload/.test(await page.locator('#next-section').innerText()));
  const daysNow = await page.evaluate(() => MemStore.get('meta', 'days').then(r => r && JSON.stringify(r.days)));
  ok('answering a drill records today as a study day, with the units and cards', daysNow === JSON.stringify([await page.evaluate(() => FSRS.todayISO())]), String(daysNow));

  head('a failed step says so, and does not advance');
  stub.breakNext = 'lesson';
  await page.locator('#next-section').click();
  await page.locator('.card.error').waitFor(T);
  const errText = await page.locator('.card.error').innerText();
  ok('a garbled reply shows an error saying what was wrong', /not valid JSON|no JSON|did not match/.test(errText), errText.replace(/\s+/g, ' ').slice(0, 120));
  ok('it is on section 2, still in its lesson, with nothing taught', await page.evaluate(() => {
    const s = Memorizer.ui.state; return s.section === 1 && s.phase === 'teach' && !s.per[1].lesson; }));
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.locator('ol.points > li').first().waitFor(T);
  ok('Try again re-asks and the section proceeds', /Section 2 of 3/.test(await page.locator('.unit-meta').innerText()));
  const les2 = stub.requests.filter(r => r.kind === 'lesson').slice(-1)[0];
  ok('section 2’s table is drawn as a table', await page.locator('#tables table.data tbody tr').count() === 3 &&
     (await page.locator('#tables thead').innerText()).replace(/\s+/g, ' ').trim() === 'Measure Normal Unit');
  ok('the section-2 request sends the table to the model as rows', /TABLE:\n\| Measure \| Normal \| Unit \|/.test(les2.user));
  ok('and carries section 2 only', new RegExp('s2w' + pdf.firstCode + '\\b').test(les2.user) && !/s[13]w[a-z]/.test(les2.user));

  head('a reload resumes where it stopped');
  await page.reload();
  await page.locator('.jump-card').first().waitFor(T);

  head('home: what shall we learn, and where to jump back in');
  ok('jump back in names the unit, the section up next and how far it has come',
     /unit/.test(await page.locator('.jump-card strong').first().innerText()) && /Section Two Afterload/.test(await page.locator('.jump-card').first().innerText()) &&
     (await page.locator('.jump-card .ring-pct').first().innerText()) === '33%', await text(page, '.jump-card'));
  /* The days were in localStorage, which this browser was measured to lose
     whole across a reload (1 run in 6); IndexedDB, never. */
  ok('the streak counts today, after a drill was answered, and survives the reload', /\b1$/.test(await text(page, '#streak')), await text(page, '#streak'));
  ok('the due pill and the Review tab both count the one card', /1 due/.test(await page.locator('#pill-due').innerText()) &&
     (await page.locator('nav.dock .nav-badge').innerText()) === '1');
  ok('my units: the unit, its sections and pages, and its progress', /3 sections · \d+ pages/.test(await page.locator('.unit-row').innerText()) &&
     (await page.locator('.unit-row .badge').innerText()) === '33%', await text(page, '.unit-row'));
  ok('with its colour bar and a menu', await page.evaluate(() => getComputedStyle(document.querySelector('.unit-row')).getPropertyValue('--hue').trim() !== '') &&
     await page.locator('.unit-row details.menu summary').count() === 1);
  /* The owner's screenshot: ⋮ opened a sliver — the row clipped its own
     menu, so Delete could not be reached. Each item, where it is drawn, is
     what a tap there lands on. */
  await page.locator('.unit-row details.menu summary').click();
  /* the page is scrolled to the row, never the item into view: a clipping
     row is a scroll container, and scrolling the item scrolled it into
     sight inside the row — the first version of this check did that, and
     passed with the clipping back */
  await page.evaluate(() => document.querySelector('.unit-row').scrollIntoView({ block: 'center' }));
  const menuHit = await page.evaluate(() => [...document.querySelectorAll('.unit-row details.menu[open] .menu-list button')].map(b => {
    const r = b.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { t: b.textContent, h: Math.round(r.height), hit: !!at && (at === b || b.contains(at)), rowTop: Math.round(document.querySelector('.unit-row .doc-name').getBoundingClientRect().top) }; }));
  await page.locator('.unit-row details.menu summary').click();
  ok('its menu opens whole: every item can be seen and tapped, not cut off by the row', menuHit.length === 2 && menuHit.every(m => m.hit && m.h > 20), JSON.stringify(menuHit));
  const pearlText = (await page.locator('#pearl .pearl-steps').innerText()).replace(/\s+/g, ' ');
  ok('the pearl of the day is the PDF’s own sentence, broken into steps', /Pearl of the day/i.test(await page.locator('#pearl .eyebrow').innerText()) &&
     await page.locator('#pearl .pearl-steps li').count() >= 2 && /end-diastolic pressure greater than 18 mmHg/.test(pearlText) && /stiff ventricle/.test(pearlText), pearlText);
  ok('with its thresholds marked', JSON.stringify(await page.$$eval('#pearl mark', ms => ms.map(m => m.textContent.trim()))) === '["18 mmHg","8","12 mmHg"]',
     JSON.stringify(await page.$$eval('#pearl mark', ms => ms.map(m => m.textContent.trim()))));
  ok('credited to where it was printed', /Section One Preload/.test(await page.locator('#pearl .pearl-src').innerText()) &&
     /p\.1/.test(await page.locator('#pearl .pearl-src').innerText()), await page.locator('#pearl .pearl-src').innerText());
  /* The owner first asked for a still home screen, then for animation.
     Every element on the home screen, as the browser computes it: it moves
     now — and with reduced motion asked for, nothing does. */
  const movingNow = () => page.evaluate(() => [...document.querySelectorAll('main.home, main.home *, nav.dock, nav.dock *')].filter(el => {
    const cs = getComputedStyle(el);
    return cs.animationName !== 'none' || cs.transitionDuration.split(',').some(d => parseFloat(d) > 0);
  }).map(el => el.tagName + '.' + el.className));
  const moving = await movingNow();
  ok('the home screen moves: its cards rise in and the pearl\u2019s rungs arrive', moving.some(m => /pearl/.test(m)) && moving.some(m => /^LI\./.test(m)), moving.slice(0, 5).join(', ') || 'still');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const stillNow = await movingNow();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  ok('and with reduced motion asked for, nothing on it animates or transitions', stillNow.length === 0, stillNow.slice(0, 5).join(', ') || 'still');
  /* Every tap redraws the screen. The owner saw the cards jump in again each
     time: entrance motion is for entering a screen, not for a redraw of it.
     (What loops — the aurora, the pearl's paper — is not an entrance.) */
  const replayed = await page.evaluate(() => { Memorizer.render();
    return document.querySelector('main').getAnimations({ subtree: true }).filter(a => a.effect && a.effect.getTiming().iterations !== Infinity)
      .map(a => (a.animationName || 'script') + ' on ' + a.effect.target.tagName + '.' + a.effect.target.className); });
  ok('a redraw of the same screen plays no entrance again', replayed.length === 0, replayed.slice(0, 5).join(', ') || 'still');
  const dock = await page.evaluate(() => { const r = document.querySelector('nav.dock').getBoundingClientRect(); return { pos: getComputedStyle(document.querySelector('nav.dock')).position, gap: innerHeight - r.bottom, w: r.width }; });
  ok('the tabs float at the foot of the screen', dock.pos === 'fixed' && dock.gap > 0 && dock.w < 820, JSON.stringify(dock));
  /* Section 1 scored 1 of 2 on its drill: 50%, and its one miss is its card. */
  const weakText = (await page.locator('#weak').innerText()).replace(/\s+/g, ' ');
  ok('needs work names the shaky section, with its score and its cards', /Section One Preload/.test(weakText) && /50% on the drill/.test(weakText) &&
     await page.locator('#weak li').count() === 1 && await page.locator('#weak button', { hasText: 'Drill · 1' }).count() === 1, weakText);

  head('home: the pearl as the feature, with its own figure, under glass');
  /* Section 1 carries the fixture's picture on page 1, the pearl's page, so
     the pearl is shown beside it — drawn from the stored PDF, not a
     placeholder. The wait is for the drawing to arrive; what it drew is
     the check. */
  await page.waitForFunction(() => { const i = document.querySelector('#pearl-visual img'); return i && i.naturalWidth > 0; }, null, T).catch(() => {});
  const pv = await page.evaluate(() => { const f = document.querySelector('#pearl-visual'); const i = f && f.querySelector('img');
    return f ? { kind: f.getAttribute('data-kind'), src: i ? i.src.slice(0, 15) : '', w: i ? i.naturalWidth : 0, cap: f.querySelector('figcaption').textContent.replace(/\s+/g, ' ').trim(),
      withVisual: document.querySelector('#pearl').classList.contains('with-visual') } : null; });
  ok('beside the pearl, its own section’s figure, drawn from the PDF with its caption and page',
     !!pv && pv.kind === 'figure' && /^data:image\/png/.test(pv.src) && pv.w > 0 && pv.cap.indexOf(pdf.CAPTION.replace(/\.$/, '')) === 0 && /p\.1$/.test(pv.cap) && pv.withVisual, JSON.stringify(pv));
  await page.locator('#pearl-visual .pearl-fig').click();
  await page.locator('.lightbox img').waitFor(T).catch(() => {});
  await page.waitForFunction(() => { const i = document.querySelector('.lightbox img'); return i && i.naturalWidth > 0; }, null, T).catch(() => {});
  ok('and it opens full size', await page.evaluate(() => { const i = document.querySelector('.lightbox img'); return !!i && i.naturalWidth > 0; }));
  await page.locator('.lightbox .btn').click();
  await page.locator('.lightbox').waitFor({ state: 'detached', timeout: 60000 });
  /* Surfaces are frosted glass over the aurora: translucent and blurred,
     as the browser computes them — and opaque, unblurred, at High
     contrast, where the tokens say alpha 1. */
  const glassOf = () => page.evaluate(() => ['.jump-card', '#pearl', 'nav.dock', '.unit-row'].map(q => { const cs = getComputedStyle(document.querySelector(q));
    const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/); const a = m ? m[1].split(',').map(Number) : [];
    return { q: q, alpha: a.length === 4 ? a[3] : 1, blur: (cs.backdropFilter || cs.webkitBackdropFilter || '') }; }));
  const glassNow = await glassOf();
  ok('the cards, the pearl and the dock are glass: translucent and blurred', glassNow.every(g => g.alpha < 1 && /blur\((?!0px)/.test(g.blur)), JSON.stringify(glassNow));
  const lookBefore = await page.evaluate(() => MemLook.load());
  await page.evaluate(() => MemLook.apply(Object.assign(MemLook.load(), { contrast: 'high' })));
  const glassHigh = await glassOf();
  await page.evaluate(l => MemLook.apply(l), lookBefore);
  ok('and at High contrast, solid: no translucency, no blur', glassHigh.every(g => g.alpha === 1 && !/blur\((?!0px)/.test(g.blur)), JSON.stringify(glassHigh));
  /* As an iPad's glass: clearer panes than the 0.72 they were, under a
     stronger blur, with a sheen — and the accent solid, where it used to
     run into a second colour. */
  const pane = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('.jump-card'));
    const a = (cs.backgroundColor.match(/rgba\(([^)]+)\)/) || ['', ''])[1].split(',').map(Number)[3];
    return { alpha: a, blur: parseFloat(((cs.backdropFilter || cs.webkitBackdropFilter || '').match(/blur\(([\d.]+)px/) || [])[1]), sheen: /linear-gradient/.test(cs.backgroundImage) }; });
  ok('and the glass is clear: most of the page shows through, under a heavy blur, with a sheen', pane.alpha <= 0.6 && pane.blur >= 24 && pane.sheen, JSON.stringify(pane));
  /* High contrast was just put back, and the tab fades its colour: the
     read waits for running transitions to end (a precondition — the colour
     they end on is the check). */
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a instanceof CSSTransition).map(a => a.finished.catch(() => {}))));
  const paper = await page.evaluate(() => getComputedStyle(document.querySelector('#pearl')).backgroundImage);
  ok('and the pearl keeps its ECG paper under it', (paper.match(/linear-gradient/g) || []).length === 4 && !/radial/.test(paper), paper.slice(0, 120));
  const calm = await page.evaluate(() => [...document.querySelectorAll('main .btn.primary, nav.dock .nav-btn[aria-current="page"], main .learn-plus')].map(e => {
    const cs = getComputedStyle(e); return { q: e.className, img: cs.backgroundImage, bg: cs.backgroundColor }; }));
  const accentNow = await page.evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--accent)'; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; });
  ok('the primary buttons, the current tab and the add button are the accent, solid — no gradient', calm.length >= 3 && calm.every(c => c.img === 'none' && c.bg === accentNow), JSON.stringify(calm.slice(0, 4)) + ' ' + accentNow);
  /* The light follows the pointer across a pane, and goes when it leaves;
     with reduced motion there is none. */
  await page.locator('.jump-card').first().scrollIntoViewIfNeeded();
  const jc = await page.locator('.jump-card').first().boundingBox();
  await page.mouse.move(jc.x + 30, jc.y + 12);
  const litOn = await page.evaluate(() => { const e = document.querySelector('.jump-card'); return { lit: e.hasAttribute('data-lit'), px: e.style.getPropertyValue('--px'), py: e.style.getPropertyValue('--py'),
    light: getComputedStyle(e).getPropertyValue('--lit').trim() }; });
  await page.mouse.move(jc.x + 90, jc.y + 20);
  const litMoved = await page.evaluate(() => document.querySelector('.jump-card').style.getPropertyValue('--px'));
  await page.mouse.move(2, 2);
  const litOff = await page.evaluate(() => document.querySelectorAll('[data-lit]').length);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.move(jc.x + 30, jc.y + 12);
  const litStill = await page.evaluate(() => document.querySelectorAll('[data-lit]').length);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.mouse.move(2, 2);
  ok('a light follows the pointer across the glass, and goes when it leaves', litOn.lit && litOn.px === '30px' && litOn.py === '12px' && /rgba\(255,\s*255,\s*255,\s*0?\.38\)/.test(litOn.light) && litMoved === '90px' && litOff === 0,
     JSON.stringify({ litOn, litMoved, litOff }));
  ok('and with reduced motion asked for, there is no light to follow', litStill === 0, String(litStill));
  const hero = await page.evaluate(() => { const e = document.querySelector('#home-hero'); const cs = getComputedStyle(e);
    return { bg: cs.backgroundImage.slice(0, 40), trace: !!e.querySelector('.hero-monitor canvas'), held: (document.querySelector('#stat-held') || {}).textContent || '',
      inHero: !!e.querySelector('#streak') && !!e.querySelector('#pill-due') }; });
  ok('the hero band carries the streak, what is due and how much is held, over its gradient and trace',
     /gradient/.test(hero.bg) && hero.trace && /\d+%\s*Likely recalled/.test(hero.held) && hero.inHero, JSON.stringify(hero));
  /* Systole's live strip (monitor.js): drawn, sweeping, a rhythm named in
     monitor type — the same canvas through a redraw, so a tap does not
     restart it — and still, but drawn, with reduced motion asked for. The
     waits are for frames to have been painted; what they painted is the
     check. */
  const strip = () => page.evaluate(() => { const m = document.querySelector('.hero-monitor'), c = m.querySelector('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let ink = 0; const cols = new Set();
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) { ink++; cols.add(((i - 3) / 4) % c.width); }
    return { x: m.getAttribute('data-x'), still: m.getAttribute('data-still'), ink, cols: cols.size, w: c.width, rhythm: m.getAttribute('data-rhythm'),
      label: m.querySelector('.hero-monitor-label').textContent, font: getComputedStyle(m.querySelector('.hero-monitor-label')).fontFamily }; });
  await page.waitForFunction(() => { const m = document.querySelector('.hero-monitor'); return m && +m.getAttribute('data-x') > 0; }, null, T).catch(() => {});
  const s1 = await strip();
  /* it moves by itself: no redraw between the two readings (a redraw
     nudges it one frame, and the first version of this check measured that) */
  await page.waitForFunction(x => { const m = document.querySelector('.hero-monitor'); return m && m.getAttribute('data-x') !== x; }, s1.x, T).catch(() => {});
  const s2 = await strip();
  const sameCanvas = await page.evaluate(() => { const c = document.querySelector('.hero-monitor canvas'); Memorizer.render(); return document.querySelector('.hero-monitor canvas') === c; });
  const playlist = await page.evaluate(() => MemMonitor.PLAYLIST);
  ok('Systole’s rhythm strip sweeps across the hero, a rhythm named in monitor type',
     s1.ink > 0 && s2.x !== s1.x && playlist.indexOf(s1.rhythm) !== -1 && /^II · .+ · \d+ bpm$/.test(s1.label) && /mono|Menlo|Consolas/i.test(s1.font), JSON.stringify({ s1, s2 }));
  ok('and a redraw keeps the same strip running, rather than starting another', sameCanvas, String(sameCanvas));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => Memorizer.render());
  /* The still strip is drawn on the next frame: wait for that drawing to
     have happened (data-drawn, set when it has run) — a precondition; what
     it drew is the check. CI read the canvas between the flag and the
     frame, and saw a quarter of a strip. */
  await page.waitForFunction(() => { const m = document.querySelector('.hero-monitor'); return m.getAttribute('data-still') === 'true' && m.getAttribute('data-drawn') === 'whole'; }, null, T).catch(() => {});
  const r1 = await strip();
  await page.waitForTimeout(400);
  const r2 = await strip();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => Memorizer.render());
  /* whole: ink in every column — a sweeping strip always has the eraser's
     blank gap ahead of its pen, and ink left over from the sweep would
     otherwise pass for a drawing */
  ok('with reduced motion asked for, the strip is drawn whole and holds still', r1.still === 'true' && r1.cols === r1.w && r2.x === r1.x && r2.ink === r1.ink, JSON.stringify({ r1, r2 }));
  /* Laid out as a dashboard on an iPad held landscape — the pearl, and
     beside it where to jump back in — and stacked in reading order on a
     phone, with nothing wider than the screen. */
  const placing = () => page.evaluate(() => { const a = document.querySelector('#pearl').getBoundingClientRect(), b = document.querySelector('#home-side').getBoundingClientRect();
    return { beside: b.left >= a.right - 1 && Math.abs(b.top - a.top) < 4, below: b.top >= a.bottom - 1, wide: document.documentElement.scrollWidth > innerWidth }; });
  await page.setViewportSize({ width: 1180, height: 820 });
  const land = await placing();
  await page.setViewportSize({ width: 375, height: 812 });
  const phone = await placing();
  await page.setViewportSize({ width: 820, height: 1100 });
  ok('landscape: the pearl with where to jump back in beside it', land.beside && !land.wide, JSON.stringify(land));
  ok('phone: stacked, pearl first, no sideways scroll', phone.below && !phone.wide, JSON.stringify(phone));
  await page.locator('#pearl-open').click();
  await page.locator('#big-idea').waitFor(T).catch(() => {});
  ok('“Open the section” opens the pearl’s own section', /Section One Preload/.test(await page.locator('main').innerText()) &&
     await page.evaluate(() => Memorizer.ui.view === 'session' && Memorizer.ui.state.phase === 'teach' && Memorizer.ui.state.section === 0), await page.evaluate(() => Memorizer.ui.view + ' ' + (Memorizer.ui.state && Memorizer.ui.state.phase + ' ' + Memorizer.ui.state.section)));
  await page.locator('nav.dock').getByRole('button', { name: 'Home' }).click();
  await page.locator('#weak').waitFor(T);
  /* A new screen settles in; a redraw of the same one does not. */
  const entered = await page.evaluate(() => { const a = document.querySelector('main').hasAttribute('data-enter') && getComputedStyle(document.querySelector('main')).animationName;
    Memorizer.render(); return { a: a, redraw: document.querySelector('main').hasAttribute('data-enter') }; });
  ok('a new screen settles in, and a redraw of the same screen does not', entered.a === 'screen-in' && entered.redraw === false, JSON.stringify(entered));
  /* The drill rates the card; the review checks below expect it unreviewed,
     so it is put back as it was before leaving. It is reviewed Easy first,
     so it is not due: plain review would offer nothing, the drill must
     still offer it. */
  const cardsBefore = await page.evaluate(() => MemStore.all('cards'));
  await page.evaluate(() => MemStore.all('cards').then(cs => { const m = cs.find(c => !c.kind); m.srs = FSRS.update(null, 4, FSRS.todayISO()); return MemStore.put('cards', m); }));
  await page.locator('#weak button', { hasText: 'Drill · 1' }).click();
  await page.locator('#mcq .option').first().waitFor(T);
  const drillHead = await page.locator('.review-head').textContent();
  const dueNow = await page.evaluate(() => MemSession.dueCards(Memorizer.ui.cards, FSRS.todayISO()).length);
  ok('a drill opens that section’s cards, due or not, as the same multiple choice', dueNow === 0 && /Drill · 1 left/.test(drillHead) && /Section One Preload/.test(drillHead) &&
     (await page.locator('#mcq h2.q').innerText()) === Q_GAP.question && await page.locator('#mcq .option').count() === 4,
     drillHead + ' · ' + dueNow + ' due');
  await page.locator('.option[data-i="1"]').click();
  await page.locator('#next').click();
  await page.locator('h1', { hasText: 'Drill done.' }).waitFor(T);
  ok('each card once: answered, it leaves the drill', await page.evaluate(() => Object.keys(Memorizer.ui.drill.done).length === 1));
  await page.evaluate(cs => Promise.all(cs.map(c => MemStore.put('cards', c))), cardsBefore);
  await page.locator('nav.dock').getByRole('button', { name: 'Home' }).click();
  await page.locator('#weak').waitFor(T);
  ok('leaving ends the drill', await page.evaluate(() => Memorizer.ui.drill === null));
  const before = stub.requests.length;
  await page.locator('.jump-card').first().click();
  await page.locator('#learn-unit').waitFor(T);
  ok('jumping back in opens the unit, and the button carries on to section 2', /^Continue: Section Two Afterload$/.test(await page.locator('#learn-unit').innerText()),
     await page.locator('#learn-unit').innerText());
  ok('its sections show where each stands', JSON.stringify(await page.$$eval('#sections .section-card', es => es.map(e => e.dataset.state))) === '["drilled","taught","new"]' &&
     (await page.locator('#sections .section-card').first().locator('.badge').innerText()) === '50%');
  await page.locator('#learn-unit').click();
  await page.locator('ol.points > li').first().waitFor(T);
  ok('section 2 opens with its lesson, without asking the model again', stub.requests.length === before && /Section 2 of 3/.test(await page.locator('.unit-meta').innerText()),
     `${stub.requests.length - before} new requests`);
  ok('the card survived the reload', (await page.evaluate(() => MemStore.all('cards'))).filter(c => !c.kind).length === 1);

  head('the final exam: after every section, weighted to the weakest');
  /* Sections 2 and 3 drilled right through the real reducer, so only the
     exam is left. Section 1, at 50%, and section 2 (first of the two at
     100%) are the weakest two: the exam's request carries their full text
     and nothing of section 3's but its key points. */
  await page.evaluate(async () => {
    let s = Memorizer.ui.state;
    const L = s.per[1].lesson;
    s = MemSession.next(s, { type: 'toUnit' });
    for (const i of [1, 2]) {
      s = MemSession.next(s, { type: 'open', section: i });
      if (!s.per[i].lesson) s = MemSession.next(s, { type: 'taught', value: Object.assign({}, L, { points: [{ text: 'Afterload is wall stress', page: 3 }] }) });
      s = MemSession.next(s, { type: 'toMemorize', value: { cards: 0 } });
      s = MemSession.next(s, { type: 'toDrill' });
      s = MemSession.next(s, { type: 'quizReady', value: { questions: [{ question: 'q' + i, quote: '', options: ['a', 'b', 'c', 'd'], answer: 0, explain: 'e', page: 1 }] } });
      s = MemSession.next(s, { type: 'answered', choice: 0 });
    }
    await MemStore.put('sessions', { id: s.docId, state: s, at: Date.now() });
    await Memorizer.openDoc(s.docId);
  });
  await page.locator('#exam-card #to-exam').waitFor(T);
  ok('with every section drilled, the exam unlocks and the button says so', await page.locator('#exam-card.locked').count() === 0 &&
     (await page.locator('#learn-unit').innerText()) === 'Take the final exam');
  await page.locator('#learn-unit').click();
  await page.locator('#mcq .option').first().waitFor(T);
  /* Section 1's misses are still on the weak list, so the skill's last
     cumulative round runs before the exam (Round C). Answered right here;
     its misses and re-teach are checked on their own below. */
  ok('the exam opens with a final review round of what is still weak', /^Before the exam · Review round · cold retest · 1 of \d/.test(await meta(page)), await meta(page));
  const weakBefore = await page.evaluate(() => MemSession.pending(Memorizer.ui.state).length);
  for (let k = 0; k < 10 && await page.evaluate(() => Memorizer.ui.state.phase === 'review'); k++) {
    const ans = await page.evaluate(() => MemSession.reviewItem(Memorizer.ui.state).q.answer);
    await page.locator('.option[data-i="' + ans + '"]').click();
    await page.locator('#next').click();
    await page.waitForFunction(() => document.querySelector('#mcq .option:not([disabled])') || document.querySelector('#result'), null, T);
  }
  ok('it asks each weak item once when all are right, then the exam', weakBefore >= 1 && await page.evaluate(() => Memorizer.ui.state.phase === 'exam') &&
     await page.evaluate(() => Memorizer.ui.state.reviews.slice(-1)[0].final && Memorizer.ui.state.reviews.slice(-1)[0].asked) === weakBefore);
  await page.waitForFunction(() => /^Question 1 of/.test((document.querySelector('.mcq-meta') || {}).innerText || ''), null, T);
  const ex = stub.requests.filter(r => r.kind === 'exam');
  ok('one exam request, with the full text of the two weakest sections', ex.length === 1 && new RegExp('s1w' + pdf.lastCode + '\\b').test(ex[0].user) &&
     new RegExp('s2w' + pdf.lastCode + '\\b').test(ex[0].user) && /sections 0, 1\./.test(ex[0].user));
  ok('and nothing of section 3 but its key points', !/s3w[a-z]/.test(ex[0].user) && /"Section Three Contractility" \(key points\)/.test(ex[0].user));
  const examMeta = await meta(page);
  ok('the exam does not name the section a question is from, before it is answered', /^Question 1 of 2/.test(examMeta) && !pdf.titles.some(t => examMeta.indexOf(t) !== -1), examMeta);
  await page.locator('#robot').click();
  await page.locator('#robot-panel').waitFor(T);
  const exLabels = await page.$$eval('#robot-panel .rb-label', ls => ls.map(l => l.textContent));
  ok('in the exam the robot gives no hint and no place to look before an answer', /no hints/.test(await text(page, '#robot-panel')) &&
     exLabels.length >= 1 && !exLabels.some(l => /Where to look|Your book says/.test(l)), JSON.stringify(exLabels));
  await page.locator('#robot-panel .rb-close').click();
  await page.locator('.option[data-i="2"]').click();
  ok('and does, once it is', /From “Section One Preload”/.test(await page.locator('.why').innerText()), await text(page, '.why'));
  await page.locator('#next').click();
  await page.locator('#prev-q').click();
  await page.locator('#fwd-q').waitFor(T);
  ok('the exam goes back too: the answered question, its section named, read-only', /From “Section One Preload”/.test(await text(page, '.why')) &&
     await page.locator('.option.wrong[data-i="2"], .option.right[data-i="2"]').count() === 1 && await page.locator('.option:not([disabled])').count() === 0 &&
     await page.evaluate(() => Memorizer.ui.state.exam.results.length === 1));
  await page.locator('#fwd-q').click();
  await page.waitForFunction(() => /^Question 2 of/.test(document.querySelector('.mcq-meta').innerText), null, T);
  await page.waitForFunction(() => /Question 2 of 2/.test(document.querySelector('.mcq-meta').innerText), null, T);
  ok('an exam miss is not asked again: the exam moves on', (await page.locator('#mcq h2.q').innerText()) === 'In the exam: which does a diuretic lower?');
  await answer(page, 1);
  await page.locator('#result').waitFor(T);
  ok('the exam is scored, by section', /Final exam: 50%/.test(await page.locator('#result h2').innerText()) &&
     JSON.stringify(await page.$$eval('ul.by-section li', ls => ls.map(l => l.innerText.replace(/\s+/g, ' ').trim()))) === '["Section One Preload 0/1","Section Two Afterload 1/1"]',
     JSON.stringify(await page.$$eval('ul.by-section li', ls => ls.map(l => l.innerText.replace(/\s+/g, ' ').trim()))));
  const cards2 = (await page.evaluate(() => MemStore.all('cards'))).filter(c => !c.kind);
  ok('its miss is a review card from the exam, filed under its section', cards2.length === 2 &&
     cards2.some(c => c.source === 'exam' && c.cluster === 0 && c.front === 'In the exam: what is preload?'), cards2.map(c => c.source + ':' + c.cluster).join(' | '));
  ok('and it can be retaken', await page.locator('#retake').count() === 1);
  ok('the exam’s answers are logged as the exam’s', await page.evaluate(() => { const d = Memorizer.ui.activity.days[FSRS.todayISO()];
    return d.by.exam === Memorizer.ui.state.exam.results.length && d.by.exam >= 2; }), JSON.stringify(await page.evaluate(() => Memorizer.ui.activity.days[FSRS.todayISO()].by)));
  /* The skill's closing deliverable: pillars, mnemonics, weak-area report. */
  const closing = await text(page, '#closing');
  const st = await page.evaluate(() => MemSession.closing(Memorizer.ui.state));
  ok('the exam result carries the sheet for the exam: three pillars from the lessons, and the weak-area report',
     /Three pillars/.test(closing) && /Weak-area report/.test(closing) && st.pillars.length >= 1 && closing.indexOf(st.pillars[0].text.slice(0, 20)) !== -1 &&
     await page.locator('ul.weak-report li').count() === st.weak.length && st.weak.length >= 1, closing.slice(0, 160));
  ok('the exam miss is in the report, typed', st.weak.some(w => w.source === 'exam' && w.types.length === 1 && /^[CN]$/.test(w.types[0])));
  await page.locator('#copy-sheet').click();
  await page.waitForFunction(() => /Copied|copy it/.test(document.querySelector('#copy-status').textContent), null, T);
  ok('and it can be copied', /Copied/.test(await text(page, '#copy-status')), await text(page, '#copy-status'));
  await page.getByRole('button', { name: 'Back to sections' }).click();
  await page.locator('#sections').waitFor(T);
  ok('and Back to sections goes there, the exam card keeping its score', /Last score 50%/.test(await page.locator('#exam-card').innerText()) &&
     (await page.locator('#exam-card #to-exam').innerText()) === 'Retake');

  head('the Supreme Memorizer rules on screen: error types, re-teach, a review round, the weak list');
  {
    /* Everything this block writes is put back after it: the checks below
       it read the unit as the exam left it. */
    const snap = await page.evaluate(() => { const id = Memorizer.ui.docId;
      return Promise.all([MemStore.get('sessions', id), MemStore.all('cards')]).then(r => ({ id, session: r[0], cards: r[1].map(c => c.id) })); });
    /* A fresh session for this unit: section 2 drilled, one miss fixed on its
       retry (so an earlier section has a weak item), section 1
       about to be drilled with two questions whose right answers are the
       book's own words (so the re-teach finds the book's sentences). */
    await page.evaluate(async () => {
      const d = Memorizer.ui.docRec;
      let s = MemSession.init(d.id, d.clusters.map(c => c.title));
      const L = { overview: 'The big idea.', points: [{ text: 'Diuretics reduce preload', page: 1 }], numbers: [], mnemonics: [], analogies: [], flowchart: '' };
      const Q = (k, right, wrong) => ({ question: 'Skill question ' + k, quote: '', options: [right, wrong, 'Inotropes ' + k, 'Vasopressors ' + k], answer: 0, explain: 'The book says so.', page: 1 });
      const step = e => { s = MemSession.next(s, e); };
      step({ type: 'open', section: 1 }); step({ type: 'taught', value: L }); step({ type: 'toMemorize', value: { cards: 0 } }); step({ type: 'toDrill' });
      step({ type: 'quizReady', value: { questions: [Q(9, 'Afterload', 'Preload')] } }); step({ type: 'answered', choice: 1 }); step({ type: 'answered', choice: 0 });
      step({ type: 'open', section: 0 }); step({ type: 'taught', value: L }); step({ type: 'toMemorize', value: { cards: 0 } }); step({ type: 'toDrill' });
      step({ type: 'quizReady', value: { questions: [Q(1, 'Diuretics', 'Nitrates'), Q(2, 'Excessive preload', 'Afterload')] } });
      Memorizer.ui.state = s; Memorizer.ui.choice = null; Memorizer.render();
    });
    await page.locator('#not-sure').waitFor(T);
    await page.locator('#not-sure').click();
    ok('"Not sure" is an answer: the right option shown, filed as never encountered, with its fix',
       /Not sure — the answer is A: Diuretics/.test(await text(page, '.why')) && (await page.locator('#type-chip').getAttribute('data-type')) === 'N' &&
       /Type N · Never encountered/.test(await text(page, '#type-chip')) && /re-teach from the page/.test(await text(page, '#type-chip')), await text(page, '#type-chip'));
    await page.locator('#next').click();
    await page.locator('.option[data-i="1"]').waitFor(T);
    await page.locator('.option[data-i="1"]').click();
    ok('a wrong option is a confusion, naming what was picked', (await page.locator('#type-chip').getAttribute('data-type')) === 'C' &&
       /You picked “Afterload”/.test(await text(page, '#type-chip')), await text(page, '#type-chip'));
    await page.locator('#next').click();
    await page.waitForFunction(() => /Again/.test(document.querySelector('.mcq-meta').innerText), null, T);
    await page.locator('.option[data-i="2"]').click();
    ok('missed again on the retry: encoding, and re-taught on the spot with a different kind of hook', (await page.locator('#type-chip').getAttribute('data-type')) === 'E' &&
       await page.locator('#reteach').count() === 1 && (await page.locator('#reteach').getAttribute('data-hook')) !== 'none' &&
       /Diuretics reduce preload/.test(await text(page, '#reteach')), await text(page, '#reteach'));
    await page.locator('#next').click();
    await page.waitForFunction(() => /Again/.test(document.querySelector('.mcq-meta').innerText), null, T);
    await page.locator('.option[data-i="0"]').click();
    ok('right on the retry: retrieval — the memory was there', (await page.locator('#type-chip').getAttribute('data-type')) === 'R');
    await page.locator('#next').click();
    await page.locator('#result').waitFor(T);
    ok('two sections drilled with items still weak: a review round is offered first', /Review round: 3 weak items, mixed/.test(await text(page, '#review-round')) &&
       (await page.locator('.result-actions button').first().getAttribute('id')) === 'review-round');
    await page.locator('#review-round').click();
    await page.waitForFunction(() => /Review round · cold retest · 1 of 3/.test((document.querySelector('.mcq-meta') || {}).innerText || ''), null, T);
    /* Miss the twice-missed item again: the re-teach; the other, right. */
    let reteachSeen = false, n = 0;
    const missedOnce = {};
    while (n++ < 6 && await page.evaluate(() => Memorizer.ui.state.phase === 'review')) {
      const it = await page.evaluate(() => { const w = MemSession.reviewItem(Memorizer.ui.state); return { id: w.id, a: w.q.answer, streak: w.streak }; });
      const wrong = it.streak >= 2 && !missedOnce[it.id];
      if (wrong) missedOnce[it.id] = true;
      await page.locator('.option[data-i="' + (wrong ? (it.a + 1) % 4 : it.a) + '"]').click();
      if (wrong) reteachSeen = reteachSeen || (await page.locator('#reteach').count() === 1 && (await page.locator('#type-chip').getAttribute('data-type')) === 'E');
      await page.locator('#next').click();
      await page.waitForFunction(() => document.querySelector('#mcq .option:not([disabled])') || document.querySelector('#result'), null, T);
    }
    ok('in the round, a second miss in a row is encoding and is re-taught', reteachSeen);
    ok('the missed item came back at the end of the round, and the round went back to the result', n === 5 &&
       await page.evaluate(() => Memorizer.ui.state.phase === 'result' && Memorizer.ui.state.reviews.slice(-1)[0].asked === 4), String(n));
    await page.locator('header.topbar').getByRole('button', { name: 'Back' }).click();
    await page.locator('#weak-line').waitFor(T);
    ok('the unit page shows the weak list in one line, with types and misses, and a review round', /Weak: .*Type E · 3 misses/.test(await text(page, '#weak-line')) &&
       await page.locator('#unit-review').count() === 1, await text(page, '#weak-line'));
    /* The Coach names the same items when asked where you are weak. */
    await page.locator('nav.dock').getByRole('button', { name: 'Coach' }).click();
    await page.locator('#ask-q').waitFor(T);
    await page.fill('#ask-q', 'where am I weakest?');
    await page.locator('#ask-go').click();
    await page.locator('#agent-weak-items').waitFor(T);
    ok('asked where you are weak, the Coach names the items still weak with their type and misses, and offers their round',
       /Weak: .*Type E · 3 misses/.test(await text(page, '#agent-weak-items')) && /Review round:/.test(await text(page, '#agent-weak-items')), await text(page, '#agent-weak-items'));
    /* The new tools, by the rules (no model here). */
    const sayP = async m => { const n = await page.locator('.turn').count(); await page.fill('#ask-q', m); await page.locator('#ask-go').click();
      await page.waitForFunction(k => document.querySelectorAll('.turn').length > k, n, T); };
    await sayP('why did I get that wrong?');
    const mist = await text(page, '#agent-latest');
    const want = await page.evaluate(() => MemAgent.mistakes(Memorizer.ui.docs, Memorizer.ui.sessions, 3));
    ok('"why did I get that wrong?": each miss still open, by its type, what the type means and its fix', await page.locator('.turn').last().getAttribute('data-tool') === 'mistake' &&
       want.length > 0 && await page.locator('#agent-mistakes li').count() === want.length &&
       want.every(m => mist.indexOf(m.label) !== -1 && mist.indexOf('Type ' + m.type + ' · ' + m.name) !== -1 && mist.indexOf(m.means) !== -1 && mist.indexOf('Fix: ' + m.fix) !== -1),
       mist.slice(0, 240));
    await sayP('what is due this week');
    const week = await page.$$eval('#agent-week li', ls => ls.map(l => l.getAttribute('data-n')));
    const dueToday = await page.evaluate(() => MemSession.dueCards(Memorizer.ui.cards, FSRS.todayISO()).length);
    ok('"what is due this week": seven days, today counting every card due now', week.length === 7 && +week[0] === dueToday && /Today/.test(await text(page, '#agent-week')),
       JSON.stringify(week) + ' today ' + dueToday);
    const roundN = await page.evaluate(() => MemAgent.weakItems(Memorizer.ui.docs, Memorizer.ui.sessions, 3).filter(w => w.review > 0)[0].review);
    await sayP('start a review round');
    await page.waitForFunction(() => Memorizer.ui.state && Memorizer.ui.state.review && Memorizer.ui.view === 'session', null, T).catch(() => {});
    ok('"start a review round": the unit opens, its round begun, every weak item a round can ask in it', await page.evaluate(n => Memorizer.ui.state.phase === 'review' &&
       Memorizer.ui.state.review.queue.length === n, roundN), await page.evaluate(() => Memorizer.ui.state && Memorizer.ui.state.phase));
    /* A returning user: their session was saved by the version before the
       weak list. It must carry on, not start again from nothing. */
    const kept = await page.evaluate(async snap => {
      const old = JSON.parse(JSON.stringify(snap.session)); old.state.v = 2;
      delete old.state.weak; delete old.state.round; delete old.state.review; delete old.state.reviews; delete old.state.reviewDue;
      await MemStore.put('sessions', old);
      await Memorizer.openDoc(snap.id);
      const st = Memorizer.ui.state;
      return { v: st.v, drilled: st.titles.filter((_, i) => st.per[i].done).length, was: snap.session.state.titles.filter((_, i) => snap.session.state.per[i].done).length, score: st.exam.score };
    }, snap);
    ok('a session saved before the weak list is carried on, its drills and exam score kept', kept.drilled === kept.was && kept.was >= 2 && kept.score != null, JSON.stringify(kept));
    await page.evaluate(async snap => {
      await MemStore.put('sessions', snap.session);
      const keep = {}; snap.cards.forEach(id => { keep[id] = true; });
      for (const c of await MemStore.all('cards')) if (!keep[c.id]) await MemStore.del('cards', c.id);
      await Memorizer.openDoc(snap.id);
    }, snap);
    await page.locator('#sections').waitFor(T);
  }

  head('figures made from the book: a comparison chart, saved as an image');
  await page.locator('#make-compare').click();
  await page.locator('.figure-view img').waitFor(T);
  const cmp = decodeURIComponent((await page.locator('.figure-view img').getAttribute('src')).replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
  const cmpText = cmp.replace(/<\/text><text[^>]*>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  ok('every taught section is a row, in order, with its big idea from its lesson', /^<svg /.test(cmp) &&
     pdf.titles.every((t, i) => cmpText.indexOf(t) !== -1 && (i === 0 || cmpText.indexOf(t) > cmpText.indexOf(pdf.titles[i - 1]))) &&
     /Preload is how full the ventricle is before it squeezes\./.test(cmpText), cmpText.slice(0, 200));
  ok('its buttons can both be pressed: neither covers the other', await page.evaluate(() => {
    const a = document.querySelector('#save-figure').getBoundingClientRect(), b = [...document.querySelectorAll('.figure-view .btn')].find(x => x.textContent === 'Close').getBoundingClientRect();
    return a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top; }));
  const [dl] = await Promise.all([page.waitForEvent('download', T), page.locator('#save-figure').click()]);
  const png = fs.readFileSync(await dl.path());
  ok('saved as a PNG image, named for the unit', dl.suggestedFilename() === 'unit-compared.png' && png.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && png.length > 5000,
     dl.suggestedFilename() + ' ' + png.length + ' bytes');
  await page.keyboard.press('Escape');
  ok('and Escape closes it', await page.locator('.figure-view').count() === 0);

  head('review');
  /* Precondition for the order check below: the card the plain due list
     puts second is made a confident miss, so the smart order and the
     plain one disagree about which comes first. */
  const flagged = await page.evaluate(() => { const due = MemSession.dueCards(Memorizer.ui.cards, FSRS.todayISO());
    due.forEach((c, i) => { c.hazard = i === due.length - 1; });
    return Promise.all(due.map(c => MemStore.put('cards', c))).then(() => due[due.length - 1].id); });
  await page.locator('nav.dock').getByRole('button', { name: /Review/ }).click();
  await page.locator('#mcq .option').first().waitFor(T);
  ok('a review card is the question again, as multiple choice', /2 due/.test(await page.locator('.review-head').textContent()) && await page.locator('#mcq .option').count() === 4,
     await text(page, '.review-head') + ' · ' + await page.locator('#mcq .option').count() + ' options');
  const shown = await page.locator('#mcq h2.q').innerText();
  const card = cards2.find(c => c.front === shown);
  /* the smart order (study.js reviewOrder): what is asked first is what it
     puts first — here the exam's miss or the drill's, by their kinds */
  const firstId = await page.evaluate(() => MemStudy.reviewOrder(MemSession.dueCards(Memorizer.ui.cards, FSRS.todayISO()), FSRS.todayISO())[0].id);
  ok('the review asks first the card the smart order puts first — the confident miss', card && card.id === firstId && firstId === flagged, JSON.stringify([card && card.id, firstId, flagged]));
  await page.locator(`.option[data-i="${card.answer}"]`).click();
  await page.locator('#next').click();
  await page.waitForFunction(() => /1 due/.test((document.querySelector('.review-head') || {}).textContent || ''), null, T);
  const after = await page.evaluate(() => MemStore.all('cards'));
  const todayInPage = await page.evaluate(() => FSRS.todayISO());
  /* Rated Good, exactly: FSRS schedules an Again into the future too, so
     "due after today" alone passed with every review rated Again. */
  const good = await page.evaluate(() => FSRS.update(null, 3, FSRS.todayISO()));
  const rated = after.find(c => c.srs);
  ok('a right answer is rated Good, and FSRS schedules the card from that', after.filter(c => c.srs).length === 1 && rated.id === card.id &&
     rated.srs.due === good.due && rated.srs.stability === good.stability && rated.srs.due > todayInPage,
     JSON.stringify(rated && rated.srs) + ' want ' + JSON.stringify(good));
  ok('and the Review tab counts one fewer', (await page.locator('nav.dock .nav-badge').innerText()) === '1');

  head('fits a phone');
  await page.setViewportSize({ width: 375, height: 800 });
  const overOf = () => page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
  await page.locator('nav.dock').getByRole('button', { name: 'Home' }).click();
  await page.locator('.jump-card').first().waitFor(T);
  const overHome = await overOf();
  await page.locator('.jump-card').first().click();
  await page.locator('#sections').waitFor(T);
  const overUnit = await overOf();
  await page.locator('#sections .section-card').nth(1).click();
  await page.locator('ol.points > li').first().waitFor(T);
  const overLesson = await overOf();
  ok('no horizontal scroll at 375 px: home, unit, lesson', overHome <= 0 && overUnit <= 0 && overLesson <= 0, `${overHome}/${overUnit}/${overLesson}px over`);
  await page.setViewportSize({ width: 820, height: 1100 });

  head('studying beyond the drill: recall cards, checks days apart, timed practice');
  {
    const today = await page.evaluate(() => FSRS.todayISO());
    const unitId = await page.evaluate(() => MemStore.all('docs').then(ds => ds.find(d => d.name === 'unit').id));
    /* section 1 was drilled through the app; sections 2 and 3 the test drove straight through the reducer, so the app's own drill never ran for them */
    ok('the drilled section’s checks began the day it was drilled, and a section never drilled has none', await page.evaluate(([id, t]) => { const c = Memorizer.ui.checks;
      return !!c[id + ':0'] && c[id + ':0'].start === t && c[id + ':0'].done.length === 0 && !c[id + ':2']; }, [unitId, today]),
      JSON.stringify(await page.evaluate(() => Memorizer.ui.checks)) + ' store ' + JSON.stringify(await page.evaluate(() => MemStore.get('meta', 'checks'))));
    /* A cloze card made due today, every other card put out of the way. */
    const cardsBack = await page.evaluate(() => MemStore.all('cards'));
    const cz = await page.evaluate(t => MemStore.all('cards').then(async cs => {
      const c = cs.find(x => x.kind === 'cloze' && /\d/.test(x.back));
      for (const x of cs) { if (x.id === c.id) { x.dueFrom = t; x.srs = null; } else x.srs = { due: '2099-01-01', stability: 100, difficulty: 5, reps: 1, lapses: 0, ivl: 100, last: t }; await MemStore.put('cards', x); }
      return c; }), today);
    await page.locator('nav.dock').getByRole('button', { name: 'Review' }).click();
    await page.locator('#cloze').waitFor(T);
    ok('a cloze card is the book’s own sentence with its number blanked, answered by typing', (await text(page, '#cloze .cloze-front')).replace('_____', cz.back) === cz.explain &&
       await page.locator('#cloze-input').count() === 1, await text(page, '#cloze .cloze-front'));
    await page.fill('#cloze-input', '999');
    await page.locator('#sure').click();
    await page.locator('#cloze-check').click();
    await page.locator('#cloze-verdict').waitFor(T);
    ok('a wrong number, said sure: marked wrong, with the book’s answer, flagged as a confident miss', (await page.locator('#cloze-verdict').getAttribute('data-verdict')) === 'wrong' &&
       (await text(page, '#cloze-verdict')).indexOf(cz.back) !== -1 && await page.locator('#cloze-verdict #hazard-note').count() === 1);
    await page.locator('#next').click();
    await page.locator('#cloze .again-tag').waitFor(T);
    const after1 = await page.evaluate(id => MemStore.get('cards', id), cz.id);
    const want1 = await page.evaluate(t => FSRS.update(null, 1, t), today);
    ok('rated Again, and flagged; then asked again before the review ends', JSON.stringify(after1.srs) === JSON.stringify(want1) && after1.hazard === true &&
       /asked again/i.test(await text(page, '#cloze .again-tag')), JSON.stringify(after1.srs) + ' want ' + JSON.stringify(want1) + ' hazard ' + after1.hazard + ' tag ' + await text(page, '#cloze .again-tag'));
    await page.fill('#cloze-input', cz.back.toLowerCase().replace(/\s+/g, ''));
    await page.locator('#cloze-check').click();
    await page.locator('#cloze-verdict').waitFor(T);
    ok('typed right the second time, as the book prints it or not', (await page.locator('#cloze-verdict').getAttribute('data-verdict')) === 'right');
    await page.locator('#next').click();
    await page.locator('h1', { hasText: 'Done for today.' }).waitFor(T);
    ok('and not rated twice: FSRS keeps the one miss', JSON.stringify((await page.evaluate(id => MemStore.get('cards', id), cz.id)).srs) === JSON.stringify(want1));

    /* A figure card: the fixture's picture with four labels set on it, one hidden. */
    const oc = await page.evaluate(([id, t]) => {
      const d = Memorizer.ui.docs.find(x => x.id === id), f = d.figures.find(x => x.page === 1);
      const b = f.box, lab = (text, i) => ({ text, box: [b[0] + 10 + i * 45, b[1] + 40, b[0] + 50 + i * 45, b[1] + 52] });
      const c = MemStudy.occlusionCards(d, 0, [Object.assign({}, f, { labels: ['Atrium', 'Ventricle', 'Valve', 'Septum'].map(lab) })])[0];
      c.dueFrom = t;
      return MemStore.put('cards', c).then(() => c);
    }, [unitId, today]);
    await page.locator('nav.dock').getByRole('button', { name: 'Home' }).click();
    await page.locator('nav.dock').getByRole('button', { name: 'Review' }).click();
    await page.locator('#occlusion').waitFor(T);
    await page.waitForFunction(() => { const i = document.querySelector('#occlusion img'); return i && i.naturalWidth > 0; }, null, T).catch(() => {});
    const mask = await page.evaluate(() => { const m = document.querySelector('#occlusion .occlusion-mask'), i = document.querySelector('#occlusion img');
      return { style: m.getAttribute('style'), drawn: !!i && /^data:image/.test(i.src) && i.naturalWidth > 0 }; });
    ok('a figure card: the book’s figure, drawn from the PDF, with a mask where its label was printed, and four labels to choose from', mask.drawn &&
       mask.style.indexOf('left:' + (100 * oc.mask.left).toFixed(2) + '%') !== -1 && mask.style.indexOf('top:' + (100 * oc.mask.top).toFixed(2) + '%') !== -1 &&
       await page.locator('#mcq .option').count() === 4, JSON.stringify(mask));
    await page.locator('.option[data-i="' + oc.answer + '"]').click();
    ok('answered, the mask lifts', await page.locator('#occlusion.revealed').count() === 1);
    await page.locator('#next').click();
    await page.evaluate(cs => Promise.all(cs.map(c => MemStore.put('cards', c))), cardsBack);
    await page.evaluate(id => MemStore.del('cards', id), oc.id);

    /* A section check, made due: drilled two days ago. */
    const key = unitId + ':0';
    await page.evaluate(([k, t]) => { Memorizer.ui.checks[k] = { start: MemStudy.addDays(t, -2), done: [], scores: [] };
      return MemStore.put('meta', { id: 'checks', recs: Memorizer.ui.checks }); }, [key, today]);
    await page.locator('nav.dock').getByRole('button', { name: 'Home' }).click();
    await page.locator('#checks').waitFor(T);
    ok('home lists the section check that has come due', await page.locator('#checks li button[data-key="' + key + '"]').count() === 1 &&
       /check 1 of 4/.test(await text(page, '#checks')), await text(page, '#checks'));
    await page.locator('#checks li button[data-key="' + key + '"]').click();
    for (let k = 0; k < 3; k++) {
      await page.locator('#mcq .option').first().waitFor(T);
      if (await page.locator('#check-result').count()) break;
      await page.locator('.option[data-i="' + await page.evaluate(() => Memorizer.ui.check.qs[Memorizer.ui.check.pos].answer) + '"]').click();
      await page.locator('#next').click();
      if (await page.evaluate(() => Memorizer.ui.check.done)) break;
    }
    await page.locator('#check-result').waitFor(T);
    const rec = await page.evaluate(k => MemStore.get('meta', 'checks').then(r => r.recs[k]), key);
    ok('a check of the section’s own questions, all right: the next falls 3 days after the drill, and it is kept', /Holding\. The next check is on/.test(await text(page, '#check-result')) &&
       rec.done.length === 1 && rec.done[0] === today && (await text(page, '#check-result')).indexOf(await page.evaluate(t => MemStudy.addDays(t, 1), today)) !== -1, JSON.stringify(rec));

    /* Timed practice. */
    await page.locator('nav.dock').getByRole('button', { name: 'Review' }).click();
    await page.locator('#practice-start').waitFor(T);
    await page.locator('#practice-10').click();
    await page.locator('#practice-clock').waitFor(T);
    const pr = await page.evaluate(() => { const p = Memorizer.ui.practice; return { n: p.qs.length, kinds: [...new Set(p.qs.map(q => q.kind))], ids: new Set(p.qs.map(q => q.id)).size }; });
    ok('ten minutes: at most ten questions, from due cards, weak items and the hardest, none twice, with a clock', pr.n > 0 && pr.n <= 10 && pr.ids === pr.n &&
       pr.kinds.every(k => ['due', 'weak', 'hard'].includes(k)) && /^(?:10:00|9:\d\d)$/.test(await text(page, '#practice-clock')), JSON.stringify(pr));
    await page.locator('.option[data-i="' + await page.evaluate(() => Memorizer.ui.practice.qs[0].q.answer) + '"]').click();
    await page.locator('#next').click();
    /* the clock run out, rather than waited for */
    await page.evaluate(() => { Memorizer.ui.practice.ends = Date.now() + 300; });
    await page.locator('#practice-result').waitFor(T).catch(() => {});
    const log1 = await page.evaluate(() => MemStore.get('meta', 'practice').then(r => r && r.history));
    ok('when time is up it stops, scores what was answered, and keeps the result', await page.locator('#practice-result').count() === 1 &&
       /1 of 1 in 10 minutes/.test(await text(page, '#practice-result')) && log1 && log1.length === 1 && log1[0].right === 1 && log1[0].asked === 1, JSON.stringify(log1));
    await page.locator('#practice-10').click();
    await page.locator('#practice-clock').waitFor(T);
    const wrongI = await page.evaluate(() => (Memorizer.ui.practice.qs[0].q.answer + 1) % Memorizer.ui.practice.qs[0].q.options.length);
    await page.locator('.option[data-i="' + wrongI + '"]').click();
    await page.locator('#next').click();
    await page.evaluate(() => { Memorizer.ui.practice.ends = Date.now() + 300; });
    await page.locator('#practice-result').waitFor(T).catch(() => {});
    ok('and the next is compared with it: down, with the scores across days', /Down on last time/.test(await text(page, '#practice-result')) &&
       await page.locator('#practice-start .trend i').count() === 2);
    await page.locator('#practice-10').click();
    await page.locator('#practice-clock').waitFor(T);
    const ticking = await page.evaluate(() => !!Memorizer.ui.practiceTimer);
    /* left by the dock, not the practice's own Back (which stops the clock itself) */
    await page.locator('nav.dock').getByRole('button', { name: 'Home' }).click();
    await page.locator('main.home').waitFor(T);
    ok('leaving a practice stops its clock', ticking && await page.evaluate(() => !Memorizer.ui.practiceTimer && Memorizer.ui.view === 'library'));
  }

  head('the Coach: a plan to the exam, teaching it back, speaking instead of typing');
  {
    const today = await page.evaluate(() => FSRS.todayISO());
    const unitId = await page.evaluate(() => MemStore.all('docs').then(ds => ds.find(d => d.name === 'unit').id));
    const plus = n => page.evaluate(([t, n]) => MemStudy.addDays(t, n), [today, n]);
    /* every section of the test unit is drilled by now: a second unit, not begun, to plan */
    const body = t => Array.from({ length: 12 }, (_, i) => `${t} note ${i} says what ${t.toLowerCase()} does to the heart.`).join('\n');
    await page.evaluate(b => Memorizer.importText('Plan notes', b), `Contractility\n\n${body('Contractility')}\n\nHeart Rate\n\n${body('Heart Rate')}`);
    await page.waitForFunction(() => MemStore.all('docs').then(ds => ds.some(d => d.name === 'Plan notes')), null, T);
    await page.locator('nav.dock').getByRole('button', { name: 'Home' }).click();
    await page.locator('#exam-plan').waitFor(T);
    await page.fill('#exam-date', await plus(10));
    await page.locator('#exam-set').click();
    await page.locator('#plan-line').waitFor(T).catch(() => {});
    const todo = await page.evaluate(() => Memorizer.ui.docs.reduce((n, d) => { const st = Memorizer.ui.sessions[d.id];
      return n + d.clusters.filter((_, i) => !(st && st.per[i] && st.per[i].done)).length; }, 0));
    ok('an exam date set on the home screen: the days left, what is left to learn, and today’s sections to open', (await page.locator('#exam-plan').getAttribute('data-days')) === '10' &&
       new RegExp('Exam in 10 days\\. ' + todo + ' sections? to learn').test(await text(page, '#plan-line')) &&
       await page.locator('#exam-plan button[data-plan]').count() >= 1 && (await page.evaluate(() => MemStore.get('meta', 'plan'))).examDate === await plus(10),
       await text(page, '#plan-line'));
    await page.locator('#exam-plan button[data-plan]').first().click();
    await page.locator('#big-idea').waitFor(T);
    ok('a section of today’s plan opens its lesson', await page.evaluate(() => Memorizer.ui.view === 'session' && Memorizer.ui.state.phase === 'teach'));

    /* teach it back */
    await page.evaluate(id => Memorizer.openDoc(id, 0), unitId);
    await page.locator('#teach-back').waitFor(T);
    const said = 'Preload is the stretch on the ventricle at the end of diastole, and 19 mmHg means overload.';
    await page.fill('#teach-text', said);
    await page.locator('#teach-check').click();
    await page.locator('#teach-result').waitFor(T);
    const want = await page.evaluate(said => { const s = Memorizer.ui.state, c = Memorizer.ui.docRec.clusters[s.section];
      const pts = MemSheet.sheetOf(s.per[s.section].lesson).groups.reduce((a, g) => a.concat(g.points), []).map(p => p.text);
      return MemStudy.teachBack(said, pts, c.text); }, said);
    ok('teaching it back: how many key points were covered, and the rest in the book’s words', new RegExp('You covered ' + want.covered.length + ' of ' + (want.covered.length + want.missed.length)).test(await text(page, '#teach-result')) &&
       want.missed.length > 0 && await page.locator('#teach-result .teach-missed li').count() === want.missed.length, await text(page, '#teach-result'));
    ok('a number given that the section does not have is named', /You gave 19/.test(await text(page, '#teach-wrong')));
    await page.locator('#teach-cards').click();
    await page.locator('#teach-made').waitFor(T);
    const made = await page.evaluate(() => MemStore.all('cards').then(cs => cs.filter(c => c.source === 'explain' && c.kind === 'cloze')));
    const tomorrowP = await plus(1);
    ok('what was left out becomes cards, from tomorrow', made.length > 0 && made.every(c => c.dueFrom === tomorrowP) &&
       new RegExp(made.length + ' cards? made').test(await text(page, '#teach-made')), JSON.stringify(made.map(c => c.back)));

    /* speaking instead of typing: the device's dictation, stood in for */
    /* Chromium has its own; defined over it, so the stand-in is what the app finds */
    await page.evaluate(() => { const SR = class { start() { setTimeout(() => { this.onresult({ results: [[{ transcript: window.__said || '' }]] }); this.onend(); }, 20); } stop() { this.onend(); } };
      for (const k of ['webkitSpeechRecognition', 'SpeechRecognition']) Object.defineProperty(window, k, { value: SR, configurable: true, writable: true });
      Memorizer.render(); });
    await page.evaluate(() => { window.__said = 'Preload is stretch'; });
    await page.locator('#teach-mic').click();
    await page.waitForFunction(() => /Preload is stretch/.test((document.querySelector('#teach-text') || {}).value || ''), null, T).catch(() => {});
    ok('speaking into teach-back adds what was said to the explanation', /Preload is stretch/.test(await page.locator('#teach-text').inputValue()));
    await page.locator('nav.dock').getByRole('button', { name: 'Coach' }).click();
    await page.locator('#ask-mic').waitFor(T);
    const n0 = await page.locator('.turn').count();
    await page.evaluate(() => { window.__said = 'what reduces preload'; });
    await page.locator('#ask-mic').click();
    await page.waitForFunction(k => document.querySelectorAll('.turn').length > k, n0, T).catch(() => {});
    ok('speaking to the Coach asks what was said', /what reduces preload/.test(await page.locator('.turn').last().locator('.bubble.mine').innerText()));
    await page.evaluate(() => { for (const k of ['webkitSpeechRecognition', 'SpeechRecognition']) Object.defineProperty(window, k, { value: undefined, configurable: true, writable: true }); Memorizer.render(); });
    ok('with no dictation in the browser there is no microphone button', await page.locator('#ask-mic').count() === 0);

    /* the Coach sets the date, and opens a teach-back */
    const sayP = async m => { const n = await page.locator('.turn').count(); await page.fill('#ask-q', m); await page.locator('#ask-go').click();
      await page.waitForFunction(k => document.querySelectorAll('.turn').length > k, n, T); };
    await sayP('my exam is in 3 weeks');
    ok('"my exam is in 3 weeks": the date is set, and the plan to it given', await page.locator('.turn').last().getAttribute('data-tool') === 'exam' &&
       /Exam in 21 days/.test(await text(page, '#agent-exam')) && (await page.evaluate(() => MemStore.get('meta', 'plan'))).examDate === await plus(21), await text(page, '#agent-latest'));
    await sayP('let me explain afterload');
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'teach-text', null, T).catch(() => {});
    ok('"let me explain afterload": its lesson opens at teaching it back, ready to type', await page.evaluate(() => document.activeElement && document.activeElement.id === 'teach-text' &&
       /Afterload/.test(Memorizer.ui.docRec.clusters[Memorizer.ui.state.section].title)));
    await page.locator('nav.dock').getByRole('button', { name: 'Home' }).click();
    await page.locator('#exam-clear').click();
    await page.waitForFunction(() => !Memorizer.ui.examDate, null, T).catch(() => {});
    ok('and the date can be cleared', await page.evaluate(() => MemStore.get('meta', 'plan')) == null);
  }

  head('your notes and marks, and a table row by row');
  {
    const unitId = await page.evaluate(() => MemStore.all('docs').then(ds => ds.find(d => d.name === 'unit').id));
    await page.evaluate(id => Memorizer.openDoc(id, 0), unitId);
    await page.locator('#notes').waitFor(T);
    await page.fill('#note-text', 'Think of a balloon filling.');
    await page.locator('#note-save').click();
    const nrec = await page.evaluate(id => MemStore.get('meta', 'notes').then(r => r && r.recs[id + ':0']), unitId);
    ok('a note is kept with its section, as yours', nrec && nrec.text === 'Think of a balloon filling.', JSON.stringify(nrec));
    await page.locator('#mark-0').click();
    await page.locator('#mark-0[aria-pressed="true"]').waitFor(T).catch(() => {});
    const mk = await page.evaluate(() => MemStore.all('cards').then(cs => cs.filter(c => c.source === 'mark')));
    ok('a key point marked is highlighted, kept, and made a cloze card of its sentence from tomorrow', await page.locator('li.point.marked').count() === 1 &&
       mk.length === 1 && mk[0].dueFrom === await page.evaluate(() => MemStudy.addDays(FSRS.todayISO(), 1)) && mk[0].front.indexOf('_____') !== -1, JSON.stringify(mk.map(c => c.front)));
    await page.locator('#mark-0').click();
    await page.locator('#mark-0[aria-pressed="false"]').waitFor(T).catch(() => {});
    ok('unmarked, its card goes (it was never reviewed)', await page.evaluate(() => MemStore.all('cards').then(cs => cs.filter(c => c.source === 'mark').length)) === 0 &&
       await page.locator('li.point.marked').count() === 0);
    /* the note, with the section's cards and in the Coach */
    const reviewBack = await page.evaluate(() => MemStore.all('cards'));
    await page.evaluate(t => MemStore.all('cards').then(async cs => { for (const c of cs) { if (!c.kind && c.cluster === 0 && c.options) { c.srs = null; c.dueFrom = t; } else c.srs = { due: '2099-01-01', stability: 100, difficulty: 5, reps: 1, lapses: 0, ivl: 100, last: t }; await MemStore.put('cards', c); } }),
      await page.evaluate(() => FSRS.todayISO()));
    await page.locator('nav.dock').getByRole('button', { name: 'Review' }).click();
    await page.locator('#mcq .option').first().waitFor(T);
    await page.locator('#mcq .option').first().click();
    await page.locator('#card-note').waitFor(T).catch(() => {});
    ok('answered, a card shows its section’s note, labelled as yours', /Your note, not the book’s: Think of a balloon filling\./.test(await page.locator('#card-note').count() ? await text(page, '#card-note') : ''));
    await page.evaluate(cs => Promise.all(cs.map(c => MemStore.put('cards', c))), reviewBack);
    await page.locator('nav.dock').getByRole('button', { name: 'Coach' }).click();
    await page.locator('#ask-q').waitFor(T);
    const sayP = async m => { const n = await page.locator('.turn').count(); await page.fill('#ask-q', m); await page.locator('#ask-go').click();
      await page.waitForFunction(k => document.querySelectorAll('.turn').length > k, n, T); };
    await sayP('explain section one preload');
    ok('and the Coach’s explanation of the section shows it too', /Your note, not the book’s: Think of a balloon filling\./.test(await page.locator('#agent-note').count() ? await text(page, '#agent-note') : ''));
    /* The test PDF's table has three rows, and a question needs four different values in its column: a fourth
       row, in the stored unit, whose unit repeats one already there — so its Normal column gives four questions
       and its Unit column none, and a round that took any question would show others. */
    await page.evaluate(id => MemStore.get('docs', id).then(d => { const seg = d.clusters[1].segments.find(g => g.table);
      seg.table.push(['Ejection fraction', '60', 'mmHg']); return MemStore.put('docs', d); }), unitId);
    await page.evaluate(() => { Memorizer.ui.docsStale = true; Memorizer.ui.askIdx = null; });
    /* Reading the units back is slowed, as on a slow device: CI twice asked
       before the edited unit was read back, the Coach indexed the old one
       (three rows, too few to ask from) and answered about the last topic
       instead. Slowed here, that race is run every time, not by chance. */
    await page.evaluate(() => { const all = MemStore.all; window.__storeAll = all;
      MemStore.all = n => n === 'docs' ? new Promise(r => setTimeout(r, 800)).then(() => all.call(MemStore, n)) : all.call(MemStore, n); });
    await page.locator('nav.dock').getByRole('button', { name: 'Home' }).click();
    await page.locator('nav.dock').getByRole('button', { name: 'Coach' }).click();
    await page.locator('#ask-q').waitFor(T);
    await sayP('quiz me on the table in section two afterload');
    await page.evaluate(() => { MemStore.all = window.__storeAll; });
    const tq = await page.$$eval('.turn:last-child .agent-q .q, #agent-latest .agent-q .q', qs => qs.map(q => q.textContent));
    ok('"quiz me on the table in …": every question read from the table, row by row', await page.locator('.turn').last().getAttribute('data-tool') === 'table' &&
       tq.length === 4 && tq.every(q => /^In the table, what is the Normal for /.test(q)), JSON.stringify(tq) + ' ' + (await text(page, '#agent-latest')).slice(0, 200));
    await page.evaluate(id => Memorizer.openDoc(id, 1), unitId);
    await page.locator('#tables').waitFor(T);
    ok('and the lesson’s table offers the same', await page.locator('#tables #table-round').count() === 1);
  }

  head('progress: the mastery map, the week, and a streak that forgives a day');
  {
    const unitId = await page.evaluate(() => MemStore.all('docs').then(ds => ds.find(d => d.name === 'unit').id));
    await page.locator('nav.dock').getByRole('button', { name: 'Home' }).click();
    await page.locator('#mastery').waitFor(T);
    const cells = await page.$$eval('#mastery .mm-cell[data-key]', cs => cs.map(c => c.getAttribute('data-key') + '=' + c.getAttribute('data-state')));
    const n = await page.evaluate(id => Memorizer.ui.docs.find(d => d.id === id).clusters.length, unitId);
    const planId = await page.evaluate(() => Memorizer.ui.docs.find(d => d.name === 'Plan notes').id);
    ok('the mastery map: every section of the unit, drilled ones not new, a unit not begun all new', cells.filter(c => c.startsWith(unitId + ':')).length === n &&
       cells.filter(c => c.startsWith(unitId + ':')).every(c => !/=new$/.test(c)) && cells.filter(c => c.startsWith(planId + ':')).length >= 2 &&
       cells.filter(c => c.startsWith(planId + ':')).every(c => /=new$/.test(c)), JSON.stringify(cells));
    const want = await page.evaluate(() => MemStudy.masteryMap(Memorizer.ui.docs, Memorizer.ui.sessions, Memorizer.ui.cards, FSRS.todayISO(), FSRS)
      .flatMap(u => u.sections.map(s => u.docId + ':' + s.ci + '=' + s.state)));
    ok('each cell is its section’s state, as study.js works it out from the drills and the cards', cells.every(c => want.includes(c)));
    await page.locator('#mastery .mm-cell[data-key="' + planId + ':1"]').click();
    await page.locator('#big-idea').waitFor(T).catch(() => {});
    ok('a cell opens its section', await page.evaluate(id => Memorizer.ui.view === 'session' && Memorizer.ui.docId === id && Memorizer.ui.state.section === 1, planId));
    await page.locator('nav.dock').getByRole('button', { name: 'Home' }).click();
    await page.locator('#weekly').waitFor(T);
    const wk = await page.evaluate(() => { const w = MemStudy.weekly(Memorizer.ui.activity, FSRS.todayISO()).week;
      const g = k => (document.querySelector('#weekly strong[data-k="' + k + '"]') || {}).textContent; return { w, answers: g('answers'), reviews: g('reviews'), days: g('days') }; });
    const by = await page.evaluate(() => { const d = Memorizer.ui.activity.days[FSRS.todayISO()]; return d && d.by; });
    ok('and the section checks and timed practice answered today are logged as theirs', by && by.check >= 1 && by.practice >= 1, JSON.stringify(by));
    ok('this week: the answers and reviews done today, counted as they were done, and the section missed most', wk.w.answers >= 5 && wk.answers === String(wk.w.answers) &&
       wk.w.reviews >= 1 && wk.reviews === String(wk.w.reviews) && wk.days === '1' && /Section One Preload/.test(await text(page, '#week-weakest')), JSON.stringify(wk));
    /* a day missed this week, forgiven */
    const t = await page.evaluate(() => FSRS.todayISO());
    const days = await page.evaluate(() => MemStore.get('meta', 'days'));
    await page.evaluate(t => MemStore.put('meta', { id: 'days', days: [MemStudy.addDays(t, -3), MemStudy.addDays(t, -2), t] }), t);
    await page.reload();
    await page.locator('#streak').waitFor(T);
    const frozenDay = await page.evaluate(t => MemStudy.addDays(t, -1), t);
    const sameWeek = await page.evaluate(([a, b]) => MemStudy.weekOf(a) === MemStudy.weekOf(b), [frozenDay, t]);
    ok('a single missed day this week is forgiven: the streak runs on, and says so', /\b3$/.test(await text(page, '#streak')) &&
       (await page.locator('#streak-freeze').count() === 1) === sameWeek, await text(page, '#streak') + ' same week ' + sameWeek);
    await page.evaluate(d => MemStore.put('meta', d), days);
  }

  head('the built-in coach: no key, no AI, nothing sent');
  {
    /* A fresh browser profile with nothing saved — what a new user gets. */
    const p2 = watch(await (await browser.newContext({ viewport: { width: 820, height: 1100 }, serviceWorkers: 'block' })).newPage(), events, 'builtin', errors);
    await wire(p2);
    const aiBefore = stub.requests.length;
    await p2.goto(URL);
    await p2.locator('#door-add').waitFor(T);
    ok('a new user is on the built-in coach, with no key asked for',
       await p2.evaluate(() => MemProvider.loadConfig().provider) === 'builtin' && !/needs your API key/.test(await p2.locator('main').innerText()));
    ok('and is told what the app does', /splits it into chapters and sections, teaches each one/.test(await p2.locator('.card.empty').innerText()));
    await p2.setInputFiles('#pdf-input', { name: 'unit.pdf', mimeType: 'application/pdf', buffer: pdf.buffer });
    await p2.locator('#sections .section-card').first().waitFor(T);
    ok('the PDF is split into its three sections', await p2.locator('#sections .section-card').count() === 3);
    await p2.locator('#learn-unit').click();
    await p2.locator('ol.points > li').first().waitFor(T);
    const L = await p2.evaluate(() => Memorizer.ui.state.per[0].lesson);
    const sec1 = (await p2.evaluate(() => MemStore.all('docs').then(d => d[0].clusters[0].text)));
    ok('the key points are section 1’s own sentences, verbatim', L.points.length >= 1 && L.points.every(x => sec1.indexOf(x.text) !== -1), `${L.points.length} points`);
    const big = await text(p2, '#big-idea .big');
    ok('and so is the big idea', big.length > 20 && sec1.replace(/\s+/g, ' ').indexOf(big) !== -1, big.slice(0, 90));
    ok('a section on preload gets the preload analogy, labelled as Memorizer’s and not the book’s',
       L.analogies.some(a => /preload/i.test(a.title) && a.source === 'Memorizer') &&
       /Memorizer’s, not your book’s/.test(await p2.locator('.analogy .label').first().innerText()), JSON.stringify(L.analogies.map(a => a.title)));
    const tv = await p2.$$eval('#numbers .tile-value', ts => ts.map(t => t.textContent));
    ok('the numbers to know are the section’s own, as tiles', L.numbers.some(n => /18 mmHg/.test(n.text)) && tv.indexOf('> 18 mmHg') !== -1 && tv.indexOf('8–12 mmHg') !== -1, JSON.stringify(tv));
    await p2.locator('#glance .gl-path').waitFor(T);
    const flowText = await text(p2, '#glance .gl-path');
    ok('section 1 shows its cause-and-effect sentences as a pathway at a glance', /Diuretics/.test(flowText) && /reduce/.test(flowText) && /preload/.test(flowText) &&
       /oedema/i.test(flowText), flowText.slice(0, 140));
    const keys = await p2.$$eval('ol.points .point-text strong.key', ks => ks.map(k => k.textContent));
    const changed = (await p2.$$eval('ol.points .point-text', ps => ps.map(p => p.textContent.replace(/\s*p\.\d+$/, '').trim()))).filter(t => {
      /* the whole sentence, to its end: tidy capitalises a point's first letter, so case aside */
      const src = sec1.replace(/\s+/g, ' ').toLowerCase(), at = src.indexOf(t.toLowerCase());
      return at === -1 || !(/[.!?]$/.test(t) || /^[.!?]/.test(src.slice(at + t.length)));
    });
    ok('each point sets its key term in bold, the sentence unchanged', keys.length >= 1 && keys.every(k => sec1.indexOf(k) !== -1) && changed.length === 0,
       JSON.stringify({ keys, changed }));
    await p2.locator('#to-drill').click();
    await memorize(p2);
    await p2.locator('#mcq .option').first().waitFor(T);
    const qs = await p2.evaluate(() => Memorizer.ui.state.per[0].quiz.questions);
    ok('the drill is multiple choice: four different options to every question', qs.length >= 3 &&
       qs.every(q => q.options.length === 4 && new Set(q.options.map(o => o.toLowerCase())).size === 4), `${qs.length} questions`);
    /* An explanation may add a line of its own ("The others each change
       one detail."); what it opens with is the book's sentence. */
    const flat = sec1.replace(/\s+/g, ' ');
    const notBook = qs.filter(q => flat.indexOf(q.explain.replace(/\s+/g, ' ').split(/(?<=\.) /)[0]) === -1);
    ok('every explanation opens with the book’s own sentence', notBook.length === 0, JSON.stringify(notBook.map(q => q.explain)));
    ok('and there is nothing to type', await p2.locator('textarea, input[type="text"]').count() === 0);
    for (let k = 0; k < qs.length; k++) {
      const s = await p2.evaluate(() => { const c = Memorizer.ui.state.per[0]; return c.quiz.questions[c.order[c.pos]].answer; });
      await p2.locator(`.option[data-i="${s}"]`).click();
      await p2.locator('#next').click();
      if (k < qs.length - 1) await p2.waitForFunction(n => new RegExp('Question ' + n + ' of').test(document.querySelector('.mcq-meta').innerText), k + 2, T);
    }
    await p2.locator('#result').waitFor(T);
    ok('every right answer: 100%, and no card made', (await p2.locator('#result .ring-pct').innerText()) === '100%' &&
       await p2.evaluate(() => MemStore.all('cards').then(c => c.filter(x => !x.kind).length)) === 0);
    ok('and not one request went to an AI provider', stub.requests.length === aiBefore, `${stub.requests.length - aiBefore} requests`);
    await p2.locator('nav.dock').getByRole('button', { name: 'Settings' }).click();
    await p2.locator('#builtin-about').waitFor(T);
    ok('Settings explains the built-in coach, and asks for no key while it is chosen',
       await p2.locator('#builtin-about').isVisible() && !(await p2.locator('#key').isVisible()) &&
       /multiple-choice questions built from the book/.test(await p2.locator('#builtin-about').innerText()));
    ok('and offers only the built-in coach and Claude', JSON.stringify(await p2.$$eval('#provider option', os => os.map(o => o.value))) === '["builtin","anthropic"]');
    /* Appearance: a theme and a size, applied at once and kept. */
    ok('the picker offers the owner’s two and Contrast, and Auto', JSON.stringify(await p2.$$eval('#appearance .swatch', ss => ss.map(s => s.getAttribute('data-theme-id')))) ===
       JSON.stringify(['auto', 'daylight', 'clinical', 'contrast']), JSON.stringify(await p2.$$eval('#appearance .swatch', ss => ss.map(s => s.getAttribute('data-theme-id')))));
    await p2.locator('#appearance .swatch[data-theme-id="clinical"]').click();
    const bg = await p2.evaluate(() => getComputedStyle(document.body).backgroundColor);
    ok('picking Clinical recolours the page with its near-black ground', bg === 'rgb(5, 6, 8)', bg);
    /* Contrast and brightness: the page gets the colours appearance.js
       computes for that setting, read back from what the browser drew. */
    const rgbOf = hex => 'rgb(' + [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ') + ')';
    await p2.locator('#appearance .seg button[data-contrast="high"]').click();
    const hiWant = await p2.evaluate(() => MemLook.variant(MemLook.byId('clinical'), 'high', 'standard'));
    const hiGot = await p2.evaluate(() => ({ ink: getComputedStyle(document.body).color, edge: getComputedStyle(document.querySelector('#appearance .seg button[data-contrast="high"]').closest('.card').querySelector('.swatch')).borderTopColor }));
    ok('High contrast draws the text and the control outlines in the fitted colours', hiGot.ink === rgbOf(hiWant.ink) && hiGot.edge === rgbOf(hiWant.edge) &&
       hiWant.ink !== MemLookNode.byId('clinical').t.ink, JSON.stringify(hiGot) + ' want ' + rgbOf(hiWant.ink) + ' / ' + rgbOf(hiWant.edge));
    await p2.locator('#appearance .seg button[data-bright="dim"]').click();
    const dimWant = await p2.evaluate(() => MemLook.variant(MemLook.byId('clinical'), 'high', 'dim').bg);
    ok('and Dim sinks the ground', await p2.evaluate(() => getComputedStyle(document.body).backgroundColor) === rgbOf(dimWant) && rgbOf(dimWant) !== 'rgb(5, 6, 8)', rgbOf(dimWant));
    await p2.locator('#appearance .seg button[data-size="xl"]').click();
    ok('Extra large text makes the body 20px', await p2.evaluate(() => getComputedStyle(document.body).fontSize) === '20px');
    await p2.locator('#appearance .seg button[data-font="serif"]').click();
    await p2.reload();
    await p2.locator('#door-add').waitFor(T);
    ok('and all of it survives a reload, applied before the page draws', await p2.evaluate(() =>
      document.documentElement.getAttribute('data-look') === 'clinical' && getComputedStyle(document.body).fontSize === '20px' &&
      document.documentElement.getAttribute('data-contrast') === 'high' && document.documentElement.getAttribute('data-bright') === 'dim' &&
      /Iowan|Charter|Georgia/.test(getComputedStyle(document.body).fontFamily)));
    await p2.locator('nav.dock').getByRole('button', { name: 'Settings' }).click();
    await p2.locator('#provider').waitFor(T);
    await p2.selectOption('#provider', 'anthropic');
    ok('choosing Claude shows the key field', await p2.locator('#key').isVisible() && !(await p2.locator('#builtin-about').isVisible()));
    /* The coach's output is held to the model's schema before the session
       sees it. The real coach never trips that, so a broken one is handed
       in here: a malformed step must be an error on screen, not a session
       stepping forward on garbage. */
    const realLesson = await p2.evaluate(() => { window.__lesson = window.MemCoach.lesson; window.MemCoach.lesson = () => ({ overview: '', points: 'not a list', numbers: [], mnemonics: [], analogies: [], flowchart: '' }); return true; });
    const docId = await p2.evaluate(() => MemStore.all('docs').then(d => d[0].id));
    await p2.evaluate(id => Memorizer.openDoc(id, 1), docId);
    await p2.locator('.card.error').waitFor(T);
    ok('a malformed built-in step is an error on screen, and the session does not advance', realLesson &&
       /malformed lesson/.test(await p2.locator('.card.error').innerText()) &&
       await p2.evaluate(() => Memorizer.ui.state.section === 1 && !Memorizer.ui.state.per[1].lesson));
    await p2.evaluate(() => { window.MemCoach.lesson = window.__lesson; });

    /* Two columns written line by line, through the real pdf.js and the
       real chunker: read column by column, not as a table. */
    const tc = makeTwoColumnPdf();
    const tcr = await p2.evaluate(async b64 => {
      const bin = atob(b64), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const r = await MemPdf.read(u.buffer);
      const paired = r.pages[0].lines.filter(l => l.cells.length === 2).length;
      const bl = MemChunk.blocksFromPages(r.pages).blocks;
      return { paired, tables: bl.filter(b => b.table).length, text: bl.filter(b => !b.heading).map(b => b.text).join(' ') };
    }, tc.buffer.toString('base64'));
    ok('a two-column page written line by line reaches the chunker as paired lines', tcr.paired >= 10, String(tcr.paired));
    ok('and is read column by column, not as a table', tcr.tables === 0 && tcr.text === tc.left + ' ' + tc.right,
       `${tcr.tables} tables; ${tcr.text.slice(0, 90)}`);

    /* The built-in exam, reached by storing a session in which every
       section was taught and drilled by the built-in coach itself, answered
       right — so only the exam is left. */
    const titles = await p2.evaluate(async id => {
      MemProvider.saveConfig({ provider: 'builtin' });
      const d = await MemStore.get('docs', id);
      let s = MemSession.init(d.id, d.clusters.map(c => c.title));
      d.clusters.forEach((c, i) => {
        s = MemSession.next(s, { type: 'open', section: i });
        s = MemSession.next(s, { type: 'taught', value: MemCoach.lesson(c) });
        s = MemSession.next(s, { type: 'toMemorize', value: { cards: 0 } });
        s = MemSession.next(s, { type: 'toDrill' });
        s = MemSession.next(s, { type: 'quizReady', value: MemCoach.quiz(c, s.per[i].lesson, d.clusters) });
        while (s.phase === 'drill') { const k = s.per[i]; s = MemSession.next(s, { type: 'answered', choice: k.quiz.questions[k.order[k.pos]].answer }); }
      });
      await MemStore.put('sessions', { id: d.id, state: s, at: Date.now() });
      await Memorizer.openDoc(d.id);
      return d.clusters.map(c => c.title);
    }, docId);
    await p2.locator('#exam-card #to-exam').click();
    await p2.locator('#mcq .option, .card.error').first().waitFor(T);
    ok('the built-in exam is set without an error', await p2.locator('.card.error').count() === 0,
       await p2.locator('.card.error').count() ? await text(p2, '.card.error') : '');
    const gMeta = await meta(p2);
    const gq = await p2.evaluate(() => { const g = Memorizer.ui.state.exam; return g.questions[g.order[g.pos]]; });
    ok('the built-in exam is multiple choice too, and does not name the section it is asking about', /^Question 1 of \d+/.test(gMeta) &&
       !titles.some(t => gMeta.indexOf(t) !== -1) && gq.options.length === 4, gMeta);
    await p2.locator(`.option[data-i="${(gq.answer + 1) % 4}"]`).click();
    ok('the feedback does, once it is answered', (await p2.locator('.why').innerText()).indexOf('From “' + titles[gq.cluster] + '”') !== -1,
       await text(p2, '.why'));

    head('pasted notes: split into sections the same way');
    await p2.locator('nav.dock').getByRole('button', { name: 'Home' }).click();
    await p2.locator('#chip-paste').click();
    /* One sentence a line, long enough to run past a page: Afterload's
       last notes are printed on page 2 of the pasted text. */
    const body = t => Array.from({ length: 25 }, (_, i) => `${t} note ${i} says what ${t.toLowerCase()} does to the heart.`).join('\n');
    await p2.fill('#paste-name', 'My notes');
    await p2.fill('#paste-text', `Preload\n\n${body('Preload')}\n\nAfterload\n\n${body('Afterload')}`);
    await p2.locator('#paste-go').click();
    await p2.locator('h1.bar-title', { hasText: 'My notes' }).waitFor(T);
    ok('each short line on its own becomes a section', JSON.stringify(await p2.$$eval('#sections .section-title', es => es.map(e => e.textContent))) === '["Preload","Afterload"]',
       JSON.stringify(await p2.$$eval('#sections .section-title', es => es.map(e => e.textContent))));
    const prec = await p2.evaluate(() => MemStore.all('docs').then(ds => ds.find(d => d.name === 'My notes')));
    ok('stored as text, every word kept, with no PDF to draw from', prec.source === 'text' && !prec.hasFile && prec.clusters.reduce((n, c) => n + c.words, 0) === 2 + 2 * 25 * 10,
       `${prec.source} ${prec.clusters.reduce((n, c) => n + c.words, 0)} words`);
    await p2.locator('#learn-unit').click();
    await p2.locator('ol.points > li').first().waitFor(T);
    ok('and it is taught like a PDF, without a pages card', await p2.locator('#visuals').count() === 0 && await p2.locator('#big-idea').count() === 1);

    head('ask your book: its own sentences, with their pages, on the device');
    const askBefore = stub.requests.length;
    await p2.locator('nav.dock').getByRole('button', { name: 'Coach' }).click();
    await p2.locator('#ask-q').waitFor(T);
    await p2.locator('#browse').waitFor(T);
    ok('the coach introduces itself and offers the next step', /I’m your coach/.test(await p2.locator('.coach-intro').innerText()) &&
       await p2.locator('.coach-intro #coach-continue').count() === 1, (await p2.locator('.coach-intro').innerText()).slice(0, 120));
    /* The screen redraws when the index is built; a question typed before
       that must survive it. Forced here, not left to timing. */
    await p2.fill('#ask-q', 'What reduces preload?');
    await p2.evaluate(() => Memorizer.render());
    ok('a question typed survives the screen being redrawn', (await p2.locator('#ask-q').inputValue()) === 'What reduces preload?');
    await p2.locator('#ask-go').click();
    await p2.locator('#answer, #not-found').first().waitFor(T);
    const quotes = await p2.$$eval('#answer ul.quotes li', ls => ls.map(l => ({ text: l.querySelector('.quote-text').textContent, src: l.querySelector('.src').textContent })));
    const allText = await p2.evaluate(() => MemStore.all('docs').then(ds => ds.map(d => d.clusters.map(c => c.text).join(' ')).join(' ')));
    ok('the answer is the book\u2019s own sentence, with where it was printed', quotes.some(q => q.text === pdf.causal[0] && q.src === 'unit · p. 1'), JSON.stringify(quotes.slice(0, 3)));
    ok('and every line of it is word for word in one of your units', quotes.length > 0 && quotes.every(q => allText.indexOf(q.text) !== -1),
       JSON.stringify(quotes.filter(q => allText.indexOf(q.text) === -1)));
    /* A sentence printed on the second page of its section: labelled with
       its own page, not its section's first. */
    await p2.fill('#ask-q', 'afterload note 24');
    await p2.locator('#ask-go').click();
    await p2.waitForFunction(() => /Afterload note 24/.test((document.querySelector('#answer') || {}).textContent || ''), null, T);
    const late = await p2.$$eval('#answer ul.quotes li', ls => ls.map(l => ({ text: l.querySelector('.quote-text').textContent, src: l.querySelector('.src').textContent })));
    const n24 = late.find(q => /^Afterload note 24 /.test(q.text));
    ok('each line is labelled with its own page, not its section\u2019s first', n24 && n24.src === 'My notes · p. 2' &&
       await p2.evaluate(() => MemStore.all('docs').then(ds => ds.find(d => d.name === 'My notes').clusters.find(c => /Afterload note 24/.test(c.text)).pageStart)) === 1,
       JSON.stringify(n24));
    await p2.fill('#ask-q', 'What reduces preload?');
    await p2.locator('#ask-go').click();
    await p2.waitForFunction(() => /Diuretics/.test((document.querySelector('#answer') || {}).textContent || ''), null, T);
    ok('under a heading marked as Memorizer\u2019s arrangement', await p2.locator('#answer h3.arranged').count() >= 1 && /arranged by Memorizer, not the book/.test(await p2.locator('#answer .legend').innerText()));
    ok('and nothing was sent anywhere to find it', stub.requests.length === askBefore, `${stub.requests.length - askBefore} requests`);
    await p2.fill('#ask-q', 'tax law for accountants');
    await p2.locator('#ask-go').click();
    await p2.locator('#not-found').waitFor(T);
    ok('a question the book cannot answer says so, and gives no lines', /Not found in your book/.test(await p2.locator('#not-found').innerText()) && await p2.locator('#answer').count() === 0);
    await p2.locator('#browse [data-kind="treatment"]').click();
    await p2.waitForFunction(() => /Diuretics/.test(document.querySelector('#browse').innerText), null, T);
    ok('the treatment index lists what the book names, with its sections', /Diuretics · 1 section/.test(await p2.locator('#browse').innerText()), (await p2.locator('#browse .index-list').innerText()).slice(0, 120));
    head('the coach as an agent: it picks a tool, uses it on your book, and remembers the topic');
    const agentBefore = stub.requests.length;
    const say = async m => { const n = await p2.locator('.turn').count(); await p2.fill('#ask-q', m); await p2.locator('#ask-go').click();
      await p2.waitForFunction(k => document.querySelectorAll('.turn').length > k, n, T); };
    const last = sel => p2.locator('.turn').last().locator(sel);
    await say('explain what reduces preload');
    const ex = await text(p2, '#agent-latest');
    ok('"explain what reduces preload": the section in one line, and its cause and effect as one sentence', await p2.locator('.turn').last().getAttribute('data-tool') === 'explain' &&
       /Section One Preload/.test(ex) && /In one line/.test(ex) && /Diuretics reduce preload, which raises venous pressure, which leads to oedema of the lungs\./.test(ex), ex.slice(0, 260));
    await say('explain afterload');
    const afterTitle = (await p2.locator('.turn').last().locator('.agent-steps').textContent()).replace(/^.*· /, '');
    await say('quiz me on that');
    ok('"quiz me on that": questions on the section just explained, not the one before, answered in the conversation', await p2.locator('.turn').last().getAttribute('data-tool') === 'quiz' &&
       /Afterload/.test(afterTitle) && (await p2.locator('.turn').last().locator('.agent-steps').textContent()).endsWith('· ' + afterTitle) &&
       await last('.agent-q').count() >= 1 && await last('.agent-q').count() <= 3, afterTitle);
    await last('.agent-q').first().locator('.option').first().click();
    ok('an answer there is marked, with the book’s reason', await last('.agent-q').first().locator('.why').count() === 1 && await last('.agent-q').first().locator('.option.right').count() === 1);
    await say('compare preload and afterload');
    const cols = await last('.agent-compare .cmp-col h3').allTextContents();
    ok('"compare preload and afterload": the two sections side by side', cols.length === 2 && /Preload/.test(cols[0]) && /Afterload/.test(cols[1]), JSON.stringify(cols));
    /* THE LOOP: one message, two steps; the second takes the section the first found */
    const before2 = await p2.locator('.turn').count();
    await p2.fill('#ask-q', 'explain what reduces preload and then quiz me on it');
    await p2.locator('#ask-go').click();
    await p2.waitForFunction(k => document.querySelectorAll('.turn').length >= k + 2, before2, T);
    const two = await p2.$$eval('.turn', (ts, k) => ts.slice(k).map(t => ({ tool: t.dataset.tool, you: !!t.querySelector('.you'), steps: t.querySelector('.agent-steps').textContent })), before2);
    ok('one message, two steps: it explains, then quizzes on the section it just explained — numbered, the message shown once', two.length === 2 &&
       two[0].tool === 'explain' && two[1].tool === 'quiz' && /^Step 1 · /.test(two[0].steps) && /^Step 2 · /.test(two[1].steps) &&
       two[0].you && !two[1].you && two[0].steps.replace(/^.*· /, '') === two[1].steps.replace(/^.*· /, ''), JSON.stringify(two));
    await say('where am I weakest?');
    ok('"where am I weakest?" is answered from the sessions', await p2.locator('.turn').last().getAttribute('data-tool') === 'weak');
    await say('explain zebra migration patterns');
    ok('a topic the book does not have is said to be missing, not made up', /couldn’t find “zebra migration patterns” in your book/.test(await text(p2, '#agent-latest')));
    await say('What reduces preload?');
    ok('and a question is still answered from the book, in the conversation', await p2.locator('.turn').last().getAttribute('data-tool') === 'search' && /Diuretics/.test(await text(p2, '#answer')) &&
       stub.requests.length === agentBefore, `${stub.requests.length - agentBefore} requests`);
    await p2.locator('#read-more li button').first().click();
    await p2.locator('#big-idea').waitFor(T);
    ok('read more opens that section\u2019s lesson', await p2.evaluate(() => Memorizer.ui.state.phase === 'teach' && Memorizer.ui.docRec.name === 'unit' && Memorizer.ui.state.section === 0));
    await p2.locator('#make-card').click();
    await p2.locator('.figure-view img').waitFor(T);
    const card = decodeURIComponent((await p2.locator('.figure-view img').getAttribute('src')).replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
    const cardText = card.replace(/<\/text><text[^>]*>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const Lb = await p2.evaluate(() => Memorizer.ui.state.per[0].lesson);
    ok('a study card of the section: its big idea, its number tiles, its source', cardText.indexOf((Lb.overview || Lb.points[0].text).replace(/\s+/g, ' ')) !== -1 &&
       /&gt; 18 mmHg/.test(card) && /^ Section One Preload UNIT · P\. 1 /.test(cardText), cardText.slice(0, 200));
    const [dl2] = await Promise.all([p2.waitForEvent('download', T), p2.locator('#save-figure').click()]);
    ok('saved as a PNG image', dl2.suggestedFilename() === 'Section-One-Preload-study-card.png' && fs.readFileSync(await dl2.path()).slice(0, 4).equals(Buffer.from([137, 80, 78, 71])),
       dl2.suggestedFilename());
    await p2.locator('.figure-view').getByRole('button', { name: 'Close' }).click();

    head('what the coach remembers: section titles and tools, on this iPad, until forgotten');
    await p2.locator('nav.dock').getByRole('button', { name: 'Coach' }).click();
    await p2.locator('#coach-memory').waitFor(T).catch(() => {});
    const memNow = await p2.locator('#coach-memory').count() ? await text(p2, '#coach-memory') : '';
    ok('it remembers the sections the tools landed on', memNow.indexOf(afterTitle) !== -1 && /Section One Preload/.test(memNow), memNow);
    const memRec = await p2.evaluate(() => MemStore.get('meta', 'coach-profile').then(r => JSON.stringify(r)));
    ok('and never what was typed: no message, no search, not the topic the book lacked', !/zebra|what reduces|quiz me|explain/i.test(memRec.replace(/"explain":\d+/g, '')) && /"quiz":\d/.test(memRec), memRec.slice(0, 200));
    await p2.reload();
    await p2.locator('nav.dock').getByRole('button', { name: 'Coach' }).click();
    await p2.locator('#coach-memory').waitFor(T).catch(() => {});
    ok('it is kept across a reload', await p2.locator('#coach-memory').count() === 1 && (await text(p2, '#coach-memory')).indexOf(afterTitle) !== -1);
    await p2.locator('#coach-forget').click();
    await p2.locator('#coach-memory').waitFor({ state: 'detached', timeout: 60000 }).catch(() => {});
    ok('and Forget forgets it, on screen and on the device', await p2.locator('#coach-memory').count() === 0 && await p2.evaluate(() => MemStore.get('meta', 'coach-profile')) == null);

    head('the on-device AI tutor: everything it writes checked against the book');
    await p2.locator('nav.dock').getByRole('button', { name: 'Settings' }).click();
    await p2.locator('#ai-card').waitFor(T);
    ok('Settings offers it, off, with three Qwen3 models — 0.6B, 1.7B and 4B — all Apache-2.0', (await p2.locator('#ai-toggle').innerText()) === 'Turn on' &&
       JSON.stringify(await p2.$$eval('#ai-model option', os => os.map(o => /^Qwen3 /.test(o.textContent) && /Apache-2\.0/.test(o.textContent)))) === '[true,true,true]' &&
       /^Qwen3 4B/.test(await p2.locator('#ai-model option').nth(2).innerText()));
    ok('the real AI engine downloads, passes its integrity check, and loads from a local file', await p2.evaluate(() => MemLLM.loadLib().then(m => typeof m.CreateMLCEngine, e => 'failed: ' + e.message)) === 'function');
    const known = await p2.evaluate(() => MemLLM.loadLib().then(m => MemLLM.MODELS.map(x => x.id).concat(MemLLM.MODELS.map(x => MemLLM.variantFor(x.id, false)), [MemLLM.EMBED.id])
      .filter(id => !m.prebuiltAppConfig.model_list.some(r => r.model_id === id))));
    ok('every model offered is one the pinned engine knows — and so is its 32-bit build, the fallback without 16-bit GPU maths', known.length === 0, JSON.stringify(known));
    ok('and it has what "Delete the downloaded model" calls, and a Cache API default the loader can switch from', await p2.evaluate(() => MemLLM.loadLib().then(m =>
       typeof m.deleteModelAllInfoInCache === 'function' && m.prebuiltAppConfig.cacheBackend === 'cache')));
    /* A stand-in for the model, answering each job with faithful sentences
       and made-up ones, the way a small model does. */
    await p2.evaluate(() => {
      window.__ai = [];
      MemLLM.saveConfig({ on: true, model: 'stub' });
      MemLLM.useEngine({ chat: { completions: { create: async req => {
        const u = req.messages[1].content; window.__ai.push(u);
        window.__thinkOn = window.__thinkOn || !(req.extra_body && req.extra_body.enable_thinking === false);
        let out = '';
        if (/You are the coach in a study app/.test(u)) {
          const tool = (t, topic) => JSON.stringify({ action: 'tool', tool: t, topic, topics: [] });
          if (/Message: help me get ready on preload/.test(u)) out = /Result \[1\]/.test(u) ? '{"action":"shout"}' : tool('quiz', 'preload');
          else if (/Message: what lowers preload, and a mnemonic for it/.test(u)) {
            if (!/Result \[1\]/.test(u)) out = tool('search', 'what reduces preload');
            else if (!/Result \[2\]/.test(u)) out = tool('explain', 'preload');
            else out = JSON.stringify({ action: 'answer', answer: 'Diuretics reduce preload by lowering circulating volume [1]. Furosemide 40 mg is the dose [1]. It works well.' });
          } else out = JSON.stringify({ action: 'tool', tool: 'prescribe', topic: 'x' });
        }
        else if (/Answer the question in 2 to 4/.test(u)) {
          const k = (u.split('\n').find(l => /Diuretics reduce preload/.test(l)) || '[1]').match(/^\[(\d+)\]/)[1];
          out = `<think>The passage says 99 mmHg, so I will say that [${k}].</think>Diuretics reduce preload by lowering circulating volume [${k}]. Diuretics reduce preload by 75 percent [${k}]. Nitrates reduce preload too [${k}]. It works well.`;
        } else if (/Explain this section/.test(u)) out = 'Preload is how much the ventricle is stretched before it contracts. Doctors give 40 mg of furosemide.';
        else if (/Write ONE short clinical case/.test(u)) out = window.__case || '';
        else if (/ONE everyday analogy/.test(u)) out = 'Like filling a water balloon: the more you fill it, the harder it pushes back.';
        else if (/multiple-choice/.test(u)) out = JSON.stringify({ questions: [
          { question: 'What do diuretics reduce by lowering circulating volume?', options: ['Preload', 'Afterload', 'Contractility', 'Heart rate'], answer: 0 },
          { question: 'Which drug is first-line for acute pulmonary edema?', options: ['Morphine', 'Digoxin', 'Aspirin', 'Heparin'], answer: 0 }] });
        return { choices: [{ message: { content: out } }] };
      } } } }, 'stub');
    });
    const aiNet = stub.requests.length;
    await p2.locator('nav.dock').getByRole('button', { name: 'Coach' }).click();
    await p2.fill('#ask-q', 'What reduces preload?');
    await p2.locator('#ask-go').click();
    await p2.locator('#ai-summarise').click();
    await p2.locator('#ai-answer .ai-label').waitFor(T);
    const sumText = (await p2.locator('#ai-answer').innerText()).replace(/\s+/g, ' ');
    ok('its summary keeps the sentence that says what the book says, with its citation', /Diuretics reduce preload by lowering circulating volume\. \[\d\]/.test(sumText), sumText.slice(0, 160));
    ok('and drops a made-up number, a drug the passage never names, and a sentence citing nothing — and says so', !/75|Nitrates|works well/.test(sumText) &&
       /3 sentences dropped/.test(sumText), sumText.slice(0, 200));
    /* With the AI on, the Coach is the model's loop: it names each next tool, sees what it found, and answers;
       a step is used only when it names a real tool, and its answer only as it holds to what the tools found. */
    const say2 = async m => { const n = await p2.locator('.turn').count(); await p2.fill('#ask-q', m); await p2.locator('#ask-go').click();
      await p2.waitForFunction(k => document.querySelectorAll('.turn').length > k, n, T); };
    await say2('help me get ready on preload');
    ok('with the AI on, it reads the message: a request the rules would search is understood as a quiz, and says so', await p2.locator('.turn').last().getAttribute('data-tool') === 'quiz' &&
       /^✨/.test(await text(p2, '#agent-latest .agent-steps')) && /Preload/i.test(await text(p2, '#agent-latest .agent-steps')) &&
       await p2.evaluate(() => MemAgent.plan('help me get ready on preload', {}).tool) === 'search');
    const turnsBefore = await p2.locator('.turn').count();
    await p2.fill('#ask-q', 'what lowers preload, and a mnemonic for it'); await p2.locator('#ask-go').click();
    await p2.locator('.turn[data-tool="answer"]').waitFor(T).catch(() => {});
    const loopTurns = await p2.$$eval('.turn', (ts, k) => ts.slice(k).map(t => t.getAttribute('data-tool') + ':' + (t.querySelector('.agent-steps') || {}).textContent), turnsBefore);
    ok('it uses two tools in turn — a search, then the section explained — each numbered as a step', loopTurns.length === 3 && /^search:Step 1 · ✨ Searched your book/.test(loopTurns[0]) &&
       /^explain:Step 2 · ✨ Used: explain · .*Preload$/.test(loopTurns[1]) && /^answer:/.test(loopTurns[2]), JSON.stringify(loopTurns));
    const loopAns = (await p2.locator('#agent-answer').count()) ? await text(p2, '#agent-latest') : '';
    ok('its answer keeps the sentence the search found, cited to its step, and drops a dose and a claim resting on nothing — and says so',
       /Diuretics reduce preload by lowering circulating volume\. \[1\]/.test(loopAns) && !/40|works well/.test(loopAns) && /2 sentences dropped/.test(loopAns), loopAns.slice(0, 220));
    const srcs = await p2.$$eval('.turn[data-tool="answer"]:last-of-type .claim-src, #agent-latest .claim-src', xs => xs.map(x => x.textContent));
    ok('each sentence it kept names the section and page of the step it rests on', srcs.length >= 1 && srcs.every(x => /Preload · p\.1$/.test(x)), JSON.stringify(srcs));
    ok('and only the first step shows the question: the rest continue the same turn', await p2.$$eval('.turn', (ts, k) => ts.slice(k).map(t => t.querySelectorAll('.bubble.mine').length).join(), turnsBefore) === '1,0,0');
    await say2('what causes pulmonary oedema');
    ok('and a tool it makes up is thrown away: the rules decide, and the book answers', await p2.locator('.turn').last().getAttribute('data-tool') === 'search' &&
       /^🧭/.test(await p2.locator('.turn').last().locator('.agent-steps').innerText()) && await p2.locator('#answer, #not-found').count() === 1,
       await p2.locator('.turn').last().locator('.agent-steps').innerText() + ' | ' + JSON.stringify(await p2.$$eval('.turn', ts => ts.slice(-5).map(t => t.getAttribute('data-tool')))));
    await p2.locator('#read-more li button').first().click();
    await p2.locator('#big-idea').waitFor(T);
    ok('the AI tutor is not in the lesson’s flow any more', await p2.locator('main #ai-lesson').count() === 0);
    await p2.locator('#robot').click();
    await p2.locator('#robot-panel #ai-lesson').waitFor(T);
    await p2.locator('#ai-plain').click();
    await p2.locator('#ai-plain-text').waitFor(T);
    ok('in plain words: its own words are kept when they add nothing the section lacks', (await p2.locator('#ai-plain-text').innerText()) === 'Preload is how much the ventricle is stretched before it contracts.' &&
       /1 sentence dropped/.test(await p2.locator('#ai-lesson').innerText()));
    await p2.locator('#ai-analogy').click();
    await p2.locator('#ai-analogy-text').waitFor(T);
    ok('an analogy is shown, labelled as the AI\u2019s and not the book\u2019s', /water balloon/.test(await p2.locator('#ai-analogy-text').innerText()) &&
       /Analogy by the on-device AI — not from your book/.test(await p2.locator('#ai-lesson').innerText()));
    /* A fresh drill of that section, so its questions are written now. */
    const unitId = await p2.evaluate(() => MemStore.all('docs').then(ds => ds.find(d => d.name === 'unit').id));
    await p2.evaluate(id => MemStore.del('sessions', id).then(() => Memorizer.openDoc(id, 0)), unitId);
    await p2.locator('#to-drill').click();
    await memorize(p2);
    await p2.locator('#mcq .option').first().waitFor(T);
    const qz = await p2.evaluate(() => Memorizer.ui.state.per[0].quiz.questions);
    ok('its question whose answer the section states is asked, first, and marked', qz[0].by === 'ai' && qz[0].question === 'What do diuretics reduce by lowering circulating volume?' &&
       await p2.locator('.ai-tag').count() === 1, JSON.stringify(qz.map(q => q.by || 'built-in')));
    ok('its question whose answer the section does not state is not', !qz.some(q => /pulmonary edema/.test(q.question)) && qz.filter(q => q.by === 'ai').length === 1);
    await p2.locator('.option[data-i="' + qz[0].answer + '"]').click();
    ok('and the explanation shown is the book\u2019s sentence with its page, not the model\u2019s', /Why: Diuretics reduce preload by lowering circulating volume\./.test(await p2.locator('.why').innerText()) &&
       (await p2.locator('.why .pg').innerText()) === 'p.1');
    ok('and none of it went over the network', stub.requests.length === aiNet && await p2.evaluate(() => window.__ai.filter(u => !/You are the coach in a study app/.test(u)).length) === 4,
       String(await p2.evaluate(() => window.__ai.length)));
    ok('every request asks Qwen3 not to reason aloud; its <think> is removed before checking', await p2.evaluate(() => window.__thinkOn) === false && !/99|think/i.test(sumText));

    /* A case by the model (study.js): kept only when the book states its answer and its story adds nothing. */
    const caseOf = c => p2.evaluate(([id, c]) => { window.__case = JSON.stringify(c); return MemStore.get('docs', id).then(d => Memorizer.aiCase(d, 0)); }, [unitId, c]);
    const Q = { question: 'What do diuretics reduce by lowering circulating volume?', options: ['Preload', 'Afterload', 'Contractility', 'Heart rate'], answer: 0 };
    const good = await caseOf(Object.assign({ case: 'A patient’s ventricle is overfilled, and the team lowers the circulating volume.' }, Q));
    ok('a case whose answer the section states is kept, the case as its opening, explained by the book’s sentence', !!good.q && good.q.by === 'ai' &&
       /overfilled/.test(good.q.quote) && /Diuretics reduce preload by lowering circulating volume\./.test(good.q.explain) && good.q.page === 1, JSON.stringify(good));
    const dose = await caseOf(Object.assign({ case: 'A patient is given 40 mg of a diuretic to lower the circulating volume.' }, Q));
    ok('a case that adds a number the section does not have is not shown, and says why', !dose.q && /number not in the book: 40/.test(dose.why), JSON.stringify(dose));
    const off = await caseOf({ case: 'A patient arrives breathless.', question: 'Which drug is first-line for acute pulmonary edema?', options: ['Morphine', 'Digoxin', 'Aspirin', 'Heparin'], answer: 0 });
    ok('a case whose answer the section does not state is not shown', !off.q && /answer is not in the section/.test(off.why), JSON.stringify(off));
    /* and on the section's result, as a question to answer */
    for (let k = 0; k < 30 && !(await p2.locator('#result').count()); k++) {
      await p2.locator('#mcq .option').first().waitFor(T);
      if (!(await p2.locator('#next').count())) await p2.locator('.option[data-i="' + await p2.evaluate(() => { const s = Memorizer.ui.state, c = s.per[s.section]; return c.quiz.questions[c.order[c.pos]].answer; }) + '"]').click();
      await p2.locator('#next').click();
      await p2.waitForFunction(() => document.querySelector('#result') || document.querySelector('#mcq .option:not([disabled])'), null, T);
    }
    await p2.evaluate(() => { window.__case = JSON.stringify({ case: 'A patient’s ventricle is overfilled, and the team lowers the circulating volume.',
      question: 'What do diuretics reduce by lowering circulating volume?', options: ['Preload', 'Afterload', 'Contractility', 'Heart rate'], answer: 0 }); });
    await p2.locator('#ai-case').click();
    await p2.locator('#case-card #mcq').waitFor(T).catch(() => {});
    ok('the section’s result offers a case, and shows it as a question with its story', await p2.locator('#case-card #mcq blockquote.quote').count() === 1 &&
       /overfilled/.test(await text(p2, '#case-card #mcq')) && /A case by the on-device AI/i.test(await text(p2, '#case-card')), await p2.locator('#case-card').count() ? await text(p2, '#case-card') : 'no case card');
    await p2.locator('nav.dock').getByRole('button', { name: 'Settings' }).click();
    await p2.locator('#ai-toggle').click();
    await p2.locator('nav.dock').getByRole('button', { name: 'Coach' }).click();
    await p2.locator('#ask-go').click();
    await p2.locator('#answer').waitFor(T);
    ok('turned off, it offers nothing', await p2.locator('#ai-answer').count() === 0);

    head('search by meaning: the right sentence with none of the question\u2019s words');
    /* A stand-in for the embedding model: a vector per concept. */
    await p2.evaluate(() => {
      const C = [/faint|syncope|pass out/i, /preload|stretch/i, /diuretic/i];
      window.__emb = 0; window.__batch = 0;
      MemLLM.useEmbedder(async texts => { window.__emb += texts.length; window.__batch = Math.max(window.__batch, texts.length); return texts.map(t => C.map(r => (r.test(t) ? 1 : 0)).concat([0.2])); });
    });
    await p2.evaluate(() => Memorizer.importText('Syncope notes', 'Syncope\n\nExertional syncope is a classic symptom of severe aortic stenosis.\nIt calls for prompt valve assessment.'));
    await p2.locator('h1.bar-title', { hasText: 'Syncope notes' }).waitFor(T);
    await p2.locator('nav.dock').getByRole('button', { name: 'Coach' }).click();
    /* precondition: the index rebuilt for the new unit — its redraw can
       otherwise swallow the click below (CI failed here intermittently) */
    await p2.waitForFunction(() => { const u = Memorizer.ui; return u.view === 'ask' && !u.askBusy && u.askIdx && u.askFor === u.docs; }, null, T);
    await p2.fill('#ask-q', 'why do people pass out');
    await p2.locator('#ask-go').click();
    await p2.locator('#not-found').waitFor(T);
    ok('by words alone, a question sharing no word with the book is not found', await p2.locator('#answer').count() === 0);
    await p2.locator('nav.dock').getByRole('button', { name: 'Settings' }).click();
    await p2.locator('#meaning-toggle').click();
    await p2.locator('nav.dock').getByRole('button', { name: 'Coach' }).click();
    await p2.fill('#ask-q', 'why do people pass out');
    await p2.locator('#ask-go').click();
    await p2.locator('#answer').waitFor(T);
    const mq = await p2.$$eval('#answer ul.quotes li', ls => ls.map(l => l.textContent));
    ok('by meaning, the book\u2019s sentence is found, with its page, marked as found by meaning', mq.length === 1 &&
       /^Exertional syncope is a classic symptom of severe aortic stenosis\.Syncope notes · p\. 1 found by meaning$/.test(mq[0]), JSON.stringify(mq));
    const vecs = await p2.evaluate(() => Promise.all([MemStore.all('vectors'), MemStore.all('docs')]).then(([v, d]) =>
      v.length === d.length && v.every(r => r.model === MemLLM.EMBED.id && r.vecs.length === d.find(x => x.id === r.id).clusters.length)));
    ok('each unit\u2019s sections are read for meaning once, and kept', vecs);
    ok('texts go to the model four at a time, the most its small build takes', await p2.evaluate(() => window.__batch) === 4, String(await p2.evaluate(() => window.__batch)));
    const before = await p2.evaluate(() => window.__emb);
    await p2.fill('#ask-q', 'what makes people pass out');
    await p2.locator('#ask-go').click();
    await p2.waitForFunction(b => window.__emb > b, before, T);
    await p2.locator('#answer').waitFor(T);
    ok('a second question embeds only itself', await p2.evaluate(b => window.__emb - b, before) === 1, String(await p2.evaluate(b => window.__emb - b, before)));
    /* THE LOOP'S RECOVERY BY MEANING: a topic no word of which is in the
       book is searched by meaning, then the same tool runs on what it found */
    const turns = async (m, n) => { const k0 = await p2.locator('.turn').count(); await p2.fill('#ask-q', m); await p2.locator('#ask-go').click();
      await p2.waitForFunction(([k, n]) => document.querySelectorAll('.turn').length >= k + n, [k0, n], T);
      return p2.$$eval('.turn', (ts, k) => ts.slice(k).map(t => ({ tool: t.dataset.tool, steps: t.querySelector('.agent-steps').textContent })), k0); };
    /* "who pass out": words the stand-in embedder knows. (Its vectors are one
       per concept; a phrase with none of them — "passing out" — matches every
       sentence with none equally, which a real model does not.) */
    const rec = await turns('explain people who pass out', 3);
    ok('a topic found by no word is searched by meaning, then explained on the section found — each step numbered, the reason given',
       JSON.stringify(rec.map(r => r.tool)) === '["explain","search","explain"]' && /by meaning/.test(rec[1].steps) &&
       /Syncope/.test(rec[2].steps) && /found by meaning/.test(rec[2].steps) && rec.every((r, i) => r.steps.indexOf('Step ' + (i + 1) + ' · ') === 0), JSON.stringify(rec));
    await p2.locator('nav.dock').getByRole('button', { name: 'Settings' }).click();
    await p2.locator('#meaning-toggle').click();
    await p2.locator('nav.dock').getByRole('button', { name: 'Coach' }).click();
    await p2.fill('#ask-q', 'why do people pass out');
    await p2.locator('#ask-go').click();
    await p2.locator('#not-found').waitFor(T);
    ok('turned off, it is words again', await p2.locator('#answer').count() === 0);
    /* THE LOOP'S RECOVERY FROM AN EMPTY STEP: a section with no numbers is
       explained instead, and the turn says why */
    const emp = await turns('numbers to know in syncope notes', 2);
    ok('numbers asked of a section that has none: it explains the section instead, and says why', JSON.stringify(emp.map(r => r.tool)) === '["numbers","explain"]' &&
       /Syncope/.test(emp[1].steps) && /no numbers in it/.test(emp[1].steps), JSON.stringify(emp));
    /* Figures stored by an older finder are found again when the unit is
       opened: the owner's highlighted PDF kept its wrong crops otherwise. */
    const stale = await p2.evaluate(() => MemStore.all('docs').then(ds => {
      const d = ds.find(x => x.hasFile && !x.bookId && x.figures && x.figures.length), was = JSON.stringify(d.figures);
      d.figuresV = 1; d.figures = [{ page: 1, box: [0, 0, 100, 100] }];
      return MemStore.put('docs', d).then(() => ({ id: d.id, was }));
    }));
    await p2.evaluate(id => Memorizer.openDoc(id), stale.id);
    await p2.waitForFunction(id => Memorizer.ui.docRec && Memorizer.ui.docRec.id === id && Memorizer.ui.docRec.figuresV === MemPdf.FIGURES_V, stale.id, T);
    const refound = await p2.evaluate(id => MemStore.get('docs', id).then(d => JSON.stringify(d.figures)), stale.id);
    ok('figures stored by an older finder are found again, and kept', refound === stale.was, refound.slice(0, 120));
  }

  head('a study pack written with Claude: the prompt out, the reply in, held to the book');
  {
    /* A fresh profile on the built-in coach, as the owner uses it: the pack
       is how Claude's work reaches the app without a key. The clipboard is
       granted so the copy can be read back. */
    const ctx = await browser.newContext({ viewport: { width: 820, height: 1100 }, serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] });
    const p4 = watch(await ctx.newPage(), events, 'pack', errors);
    await wire(p4);
    const aiBefore = stub.requests.length;
    await p4.goto(URL);
    await p4.locator('#door-add').waitFor(T);
    await p4.setInputFiles('#pdf-input', { name: 'unit.pdf', mimeType: 'application/pdf', buffer: pdf.buffer });
    await p4.locator('#sections .section-card').first().waitFor(T);
    ok('a unit with no pack says so, folded to one line', /none yet/.test(await text(p4, '#pack-card summary')) &&
       await p4.evaluate(() => !document.querySelector('#pack-card').open));
    await p4.locator('#pack-card summary').click();
    await p4.locator('#pack-copy').click();
    await p4.waitForFunction(() => /Copied|copy it/.test(document.querySelector('#pack-copy-status').textContent), null, T);
    const want = await p4.evaluate(() => MemPack.prompt(Memorizer.ui.docRec));
    const got = await p4.evaluate(() => navigator.clipboard.readText().catch(e => 'unreadable: ' + e.message));
    ok('the prompt is copied whole: the rules, the shape, every section and its text', got === want && /THE CHAPTER TEXT/.test(want) &&
       /1\. "Section One Preload"/.test(want) && /\[p\.1\] .*Diuretics reduce preload/.test(want), got.slice(0, 80));
    ok('and the card stays open while it is used', await p4.evaluate(() => document.querySelector('#pack-card').open));
    await p4.locator('#pack-show').click();
    ok('the prompt can be shown, to select by hand', (await p4.locator('#pack-prompt').inputValue()) === want);

    const d = await p4.evaluate(() => Memorizer.ui.docRec);
    const c0 = d.clusters[0], pg = c0.pageStart;
    const reply = { format: 'memorizer-pack', version: 1, unit: d.name, sections: [
      { section: 1, title: c0.title, lesson: {
        overview: 'Diuretics reduce preload by lowering circulating volume.',
        mechanism: 'Excessive preload raises venous pressure, which leads to oedema of the lungs.',
        points: [{ text: 'Diuretics — reduce preload by lowering circulating volume', page: pg },
                 { text: 'Volume overload — sought when LVEDP is greater than 18 mmHg', page: pg },
                 { text: 'Venous pressure — above 99 mmHg it causes oedema', page: pg }],
        numbers: [{ text: 'LVEDP: greater than 18 mmHg', page: pg }],
        distinctions: [{ a: 'Volume overload', b: 'a stiff ventricle', how: 'A normal pressure of 8 to 12 mmHg does not exclude a stiff ventricle.', page: pg }],
        pearls: [{ text: 'An LVEDP greater than 18 mmHg should prompt a search for volume overload.', page: pg }],
        cases: [{ stem: 'A breathless patient on the ward round.', asks: [{ q: 'Which LVEDP prompts a search for volume overload?', a: 'An LVEDP greater than 18 mmHg.' }], page: pg }],
        mnemonics: [], analogies: [], flowchart: '' },
        quiz: { questions: [
          { question: 'Which LVEDP should prompt a search for volume overload?', quote: '', options: ['8 mmHg', '12 mmHg', 'Greater than 18 mmHg', '4 mmHg'], answer: 2,
            explain: 'An LVEDP greater than 18 mmHg should prompt a search for volume overload.', page: pg,
            why: ['8 mmHg is inside the normal 8 to 12.', '12 mmHg is the top of normal.', '', '4 mmHg is below normal.'], trap: 'the normal range taken for the threshold' },
          { question: 'What do diuretics reduce?', quote: 'Diuretics reduce _____ by lowering circulating volume.', options: ['Afterload', 'Preload', 'Contractility', 'Heart rate'], answer: 1,
            explain: 'Diuretics reduce preload by lowering circulating volume.', page: pg, why: ['Not afterload.', '', 'Not contractility.', 'Not heart rate.'], trap: '' }] } },
      { section: 2, title: 'Not this unit’s section', lesson: { points: [{ text: 'x', page: pg }] } }] };
    await p4.fill('#pack-text', 'Here is reply 1.\n```json\n' + JSON.stringify(reply, null, 2) + '\n```');
    await p4.locator('#pack-import').click();
    await p4.locator('#pack-report').waitFor(T);
    const rep = await text(p4, '#pack-report');
    ok('the import says what it took, and what it flagged, in counts from the check',
       /Imported section 1: 1 lesson, 2 questions\. 1 item not found in your book, flagged where it is shown\./.test(rep), rep.slice(0, 160));
    ok('and what it refused, with why', /Section 2 “Not this unit’s section” was not imported: it is "Not this unit’s section", and section 2 here is "Section Two Afterload"/.test(rep), rep);
    const stored = await p4.evaluate(id => MemStore.get('packs', id), d.id);
    ok('the pack is kept on the device, by unit, section by section', stored && stored.sections[0] && !stored.sections[1] && stored.sections[0].quiz.questions.length === 2);
    ok('and section 1 is taught from it now', await p4.evaluate(() => Memorizer.ui.state.per[0].lesson.by === 'pack' && Memorizer.ui.state.per[0].quiz.questions.length === 2));
    ok('the card counts it', /1 of 3 sections · 1 flagged/.test(await text(p4, '#pack-status')), await text(p4, '#pack-status'));

    await p4.locator('#learn-unit').click();
    await p4.locator('#pack-label').waitFor(T);
    ok('the lesson says who wrote it', /Written with Claude · checked against your book · 1 not found in it, flagged/.test(await text(p4, '#pack-label')), await text(p4, '#pack-label'));
    /* innerText is the text as shown, and "vs" is set in capitals */
    const extra = [await text(p4, '#mechanism'), await text(p4, '#distinctions'), await text(p4, '#pearls')];
    ok('and shows what only a pack has: the mechanism, the pair confused, the pearl',
       /leads to oedema of the lungs/.test(extra[0]) && /Volume overload vs a stiff ventricle/i.test(extra[1]) && /greater than 18 mmHg should prompt/.test(extra[2]), JSON.stringify(extra).slice(0, 200));
    const flags = await p4.$$eval('ol.points .flag', fs => fs.map(f => f.textContent));
    ok('the point with a number the book does not have is flagged on the point', JSON.stringify(flags) === JSON.stringify(['⚠ A number not in your book: 99.']), JSON.stringify(flags));
    ok('and the page no longer says the points are the book’s', /written with Claude from your book/.test(await text(p4, '.arranged-note')));

    /* PHASE 2: page references open the page; the section on one screen;
       the clinical map; why, asked down the chain. */
    const pgN = +(await p4.locator('#points .pg-open').first().innerText()).replace('p.', '');
    await p4.locator('#points .pg-open').first().click();
    await p4.locator('#lb-where').waitFor(T);
    ok('a page reference opens that page as printed', new RegExp('^page ' + pgN + '\\b').test(await text(p4, '#lb-where')), await text(p4, '#lb-where'));
    await p4.locator('#lb-close').click();
    await p4.locator('#one-screen').click();
    await p4.locator('#review-sheet').waitFor(T);
    const rsText = await text(p4, '#review-sheet');
    ok('the section on one screen: its points, the pair confused, its pearl', /Key points/i.test(rsText) && /Volume overload vs a stiff ventricle/i.test(rsText) &&
       /greater than 18 mmHg should prompt/.test(rsText), rsText.slice(0, 200));
    await p4.locator('#review-close').click();
    const mapN = await p4.evaluate(() => MemSheet.clinicalMap(Memorizer.ui.docRec.clusters[0]).count);
    ok('the clinical map is shown when the section names two things or more', (await p4.locator('#clinical-map').count()) === (mapN >= 2 ? 1 : 0), 'names ' + mapN);
    ok('why is asked down the chain, each answer hidden', await p4.locator('#socratic .soc-answer').count() === 0 && await p4.locator('#soc-show').count() === 1);
    await p4.locator('#soc-show').click();
    await p4.waitForFunction(() => document.querySelectorAll('#socratic .soc-answer').length === 1, null, T);
    ok('and shown one link at a time', await p4.locator('#socratic .soc-answer').count() === 1);
    /* PHASE 3: a pack's teach-back is scored against its rubric — the
       points, and the pearls and mechanism too (study.js rubricOf). */
    await p4.fill('#teach-text', 'Diuretics reduce preload by lowering circulating volume.');
    await p4.locator('#teach-check').click();
    await p4.locator('#teach-result').waitFor(T);
    const rub = await p4.evaluate(() => { const L = Memorizer.ui.state.per[0].lesson, pts = MemSheet.sheetOf(L).groups.reduce((a, g) => a.concat(g.points), []);
      return { points: pts.length, rubric: MemStudy.rubricOf(pts, L).length }; });
    ok('a pack\u2019s teach-back is scored against its rubric, pearls and mechanism included', rub.rubric > rub.points &&
       new RegExp('You covered \\d+ of ' + rub.rubric + ' key points').test(await text(p4, '#teach-result')), JSON.stringify(rub) + ' ' + (await text(p4, '#teach-result')).slice(0, 60));

    /* PHASE 4: rounds from the pack's case; focus; the dock's next thing. */
    await p4.locator('#rounds-show').click();
    await p4.locator('#rounds-answer').waitFor(T);
    ok('rounds: the case, the examiner’s question, and its answer on request', /A breathless patient on the ward round/.test(await text(p4, '#rounds')) &&
       /greater than 18 mmHg/.test(await text(p4, '#rounds-answer')));
    await p4.locator('#rounds-had').click();
    await p4.locator('#rounds-done').waitFor(T);
    ok('and a score at the end of the round', /Rounds done: 1 of 1 answered/.test(await text(p4, '#rounds-done')));
    await p4.locator('#focus-toggle').click();
    await p4.waitForFunction(() => document.documentElement.getAttribute('data-focus') === 'on', null, T);
    ok('focus hides the dock and the robot while studying', await p4.evaluate(() => getComputedStyle(document.querySelector('nav.dock')).display === 'none' &&
       getComputedStyle(document.querySelector('#robot-dock')).display === 'none'));
    await p4.locator('#focus-toggle').click();
    await p4.waitForFunction(() => document.documentElement.getAttribute('data-focus') === 'off', null, T);
    ok('the dock’s next thing on the lesson is to memorise it', (await text(p4, '#dock-context .nav-label')) === 'Memorise' && await p4.locator('nav.dock .nav-btn').count() === 5,
       await text(p4, '#dock-context'));
    await p4.locator('#dock-context').click();
    await memorize(p4);
    await p4.locator('#mcq .option').first().waitFor(T);
    ok('the drill asks the pack’s questions, labelled', /Which LVEDP should prompt a search for volume overload\?/.test(await text(p4, '#mcq h2.q')) &&
       /Written with Claude · checked against your book/i.test(await text(p4, '.pack-tag')), await text(p4, '.pack-tag'));
    await p4.locator('.option[data-i="0"]').click();
    await p4.locator('#why-not').waitFor(T);
    ok('a wrong answer is told why that option is wrong, and the trap it fell into',
       /Why not A: 8 mmHg is inside the normal 8 to 12\./.test(await text(p4, '#why-not')) && /The trap: the normal range taken for the threshold/.test(await text(p4, '#trap')));
    ok('and every option’s reason is there to open', await p4.locator('#why-all li').count() === 4);
    ok('a wrong number for a number is a wrong value (phase 3), anchored at once among the section’s values',
       await p4.locator('#type-chip[data-type="V"]').count() === 1 && /Wrong value/.test(await text(p4, '#type-chip')) && await p4.locator('#reteach[data-hook="values"]').count() === 1,
       await text(p4, '#type-chip'));
    ok('and while a question is open the dock offers no shortcut past it', await p4.locator('#dock-context').count() === 0);
    ok('nothing went to an AI provider', stub.requests.length === aiBefore, `${stub.requests.length - aiBefore} requests`);

    /* A unit started over is taught from the pack again: pump() takes the
       section from it, with nothing to ask the built-in coach for. */
    await p4.evaluate(id => MemStore.del('sessions', id).then(() => Memorizer.openDoc(id, 0)), d.id);
    await p4.locator('#pack-label').waitFor(T);
    ok('a unit started over is taught from its pack, not rebuilt', await p4.evaluate(() => Memorizer.ui.state.per[0].lesson.by === 'pack' && !Memorizer.ui.state.per[1].lesson));
    await p4.locator('#to-drill').click();
    await memorize(p4);
    await p4.locator('#mcq .option').first().waitFor(T);
    ok('and drilled from it', /Which LVEDP should prompt/.test(await text(p4, '#mcq h2.q')) &&
       await p4.evaluate(() => Memorizer.ui.state.per[0].quiz.questions.every(q => q.by === 'pack')));
    /* EXAM CONDITIONS, from the pack. Precondition, not proposition: every
       section counted as drilled, so the exam opens. */
    p4.on('dialog', dl => dl.accept());
    await p4.evaluate(() => { const s = Memorizer.ui.state; Object.keys(s.per).forEach(k => { s.per[k].done = true; s.per[k].score = 1; if (!s.per[k].quiz) s.per[k].quiz = { questions: [] }; }); s.phase = 'unit'; Memorizer.render(); });
    await p4.locator('#exam-mode').click();
    await p4.waitForFunction(() => document.querySelector('#exam-mode').getAttribute('aria-pressed') === 'true', null, T);
    await p4.locator('#to-exam').click();
    await p4.waitForFunction(() => ['exam', 'review'].includes(Memorizer.ui.state.phase), null, T);
    for (let g = 0; g < 40 && await p4.evaluate(() => Memorizer.ui.state.phase === 'review'); g++) {
      const before = await p4.evaluate(() => Memorizer.ui.state.review && Memorizer.ui.state.review.idx);
      const a = await p4.evaluate(() => MemSession.reviewItem(Memorizer.ui.state).q.answer);
      await p4.locator('.option[data-i="' + a + '"]').click(); await p4.locator('#next').click();
      await p4.waitForFunction(b => Memorizer.ui.state.phase !== 'review' || (Memorizer.ui.state.review && Memorizer.ui.state.review.idx !== b), before, T);
    }
    await p4.locator('#exam-clock').waitFor(T);
    const exq = await p4.evaluate(() => Memorizer.ui.state.exam.questions);
    ok('the exam asks the pack’s questions for the section it covers, and the built-in coach’s for the rest', exq.filter(x => x.cluster === 0).length >= 1 &&
       exq.filter(x => x.cluster === 0).every(x => x.by === 'pack') && exq.filter(x => x.cluster !== 0).every(x => x.by !== 'pack'), JSON.stringify(exq.map(x => [x.cluster, x.by || 'coach'])));
    ok('under exam conditions the clock runs at a board’s pace', /^⏱ \d+:\d\d of \d+:\d\d$/.test(await text(p4, '#exam-clock')), await text(p4, '#exam-clock'));
    for (let k = 0; k < exq.length; k++) {
      const q = await p4.evaluate(() => { const g = Memorizer.ui.state.exam; return g.questions[g.order[g.pos]]; });
      await p4.locator('.option[data-i="' + (k === 0 ? (q.answer + 1) % 4 : q.answer) + '"]').click();
      if (k === 0) ok('an answer is held, not marked, until the end', await p4.locator('#blind-note').count() === 1 &&
        await p4.locator('.option.right, .option.wrong').count() === 0 && await p4.locator('.option.chosen').count() === 1);
      await p4.locator('#next').click();
      await p4.waitForFunction(n => Memorizer.ui.state.phase === 'done' || Memorizer.ui.state.exam.pos === n, k + 1, T);
    }
    await p4.locator('#exam-missed').waitFor(T);
    ok('at the end, what was missed: the question, the answer picked, the right one and why', /What you missed \(1\)/.test(await text(p4, '#exam-missed')) &&
       /You: /.test(await text(p4, '#exam-missed')) && /Why: /.test(await text(p4, '#exam-missed')), (await text(p4, '#exam-missed')).slice(0, 160));
    ok('and the dock’s next thing from the result is back to the sections', (await text(p4, '#dock-context .nav-label')) === 'Sections');
    await p4.locator('#dock-context').click();
    await p4.locator('#pack-card').waitFor(T);
    /* the pack removed: its sections go back to the built-in coach */
    await p4.locator('#pack-card summary').click();
    await p4.locator('#pack-remove').click();
    await p4.waitForFunction(() => !Memorizer.ui.pack, null, T);
    ok('removing the pack deletes it and sends its section back to the built-in coach', await p4.evaluate(id => MemStore.get('packs', id), d.id) === null &&
       await p4.evaluate(() => !Memorizer.ui.state.per[0].lesson) && /none yet/.test(await text(p4, '#pack-card summary')));

    /* THE PEARL AS THE DAY'S RECALL (phase 4) */
    await p4.locator('nav.dock').getByRole('button', { name: 'Home' }).click();
    await p4.locator('#pearl-recall').waitFor(T);
    await p4.locator('#pearl-recall').click();
    await p4.locator('#pearl-recalling').waitFor(T);
    const blanks = await p4.evaluate(() => MemHome.recallParts(Memorizer.ui.pearlCache.pk.steps).blanks);
    ok('the pearl is recalled first: its values hidden', blanks >= 1 && await p4.locator('#pearl-recalling .blank').count() === blanks && await p4.locator('#pearl-recalling mark').count() === 0, 'blanks ' + blanks);
    await p4.locator('#pearl-show').click();
    await p4.locator('#pearl-knew').click();
    await p4.waitForFunction(() => Memorizer.ui.pearlRecalls[FSRS.todayISO()] === true, null, T);
    await p4.locator('#pearl-recall').click();
    ok('and an honest "knew it" is kept for the day', /Recalled on 1 of the last 1 day you tried/.test(await text(p4, '#pearl-streak')) &&
       (await p4.evaluate(() => MemStore.get('meta', 'pearl-recall'))).recs[await p4.evaluate(() => FSRS.todayISO())] === true);
    ok('with no errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  head('a whole book: its PDFs as one, cut into chapters');
  {
    const bk = makeBook();
    const p5 = watch(await (await browser.newContext({ viewport: { width: 820, height: 1100 }, serviceWorkers: 'block' })).newPage(), events, 'book', errors);
    await wire(p5);
    p5.on('dialog', d => d.accept());
    await p5.goto(URL);
    await p5.locator('#door-add').waitFor(T);
    ok('home offers the whole book, taking several PDFs at once', await p5.locator('.chips label.chip[for="book-input"]').count() === 1 &&
       await p5.locator('#book-input[multiple]').count() === 1);
    /* Chosen in the wrong order: the second part first. */
    await p5.setInputFiles('#book-input', [{ name: 'Book_5-8.pdf', mimeType: 'application/pdf', buffer: bk.b }, { name: 'Book_1-4.pdf', mimeType: 'application/pdf', buffer: bk.a }]);
    await p5.locator('#chapters .chapter-row').first().waitFor(T);
    const b = await p5.evaluate(() => MemStore.all('books').then(x => x[0]));
    ok('the parts are put in order and their pages numbered straight through', b.name === 'Book' && b.pages === 8 &&
       JSON.stringify(b.parts.map(x => [x.name, x.first, x.last])) === '[["Book_1-4.pdf",1,4],["Book_5-8.pdf",5,8]]', JSON.stringify(b.parts.map(x => [x.name, x.first, x.last])));
    ok('each file’s bookmarks are read, at their book pages', JSON.stringify(b.outline.map(o => [o.title, o.page])) === '[["1. Heart Failure Basics",2],["2. Valve Disease",4],["3. Arrhythmias",6]]',
       JSON.stringify(b.outline));
    ok('the bookmarks cover the book, so they cut it', b.method === 'outline' && await p5.locator('#methods [data-method="outline"][aria-checked="true"]').count() === 1, b.method);
    const titles = () => p5.$$eval('#chapters .chapter-row .doc-name', es => es.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
    const ranges = () => p5.$$eval('#chapters .chapter-row .muted', es => es.map(e => e.textContent.split(' · ')[0]));
    ok('one row per chapter, the front matter kept apart', JSON.stringify(await titles()) === '["· Before chapter 1","1 1. Heart Failure Basics","2 2. Valve Disease","3 3. Arrhythmias"]',
       JSON.stringify(await titles()));
    ok('each with its book pages', JSON.stringify(await ranges()) === '["pp. 1–1","pp. 2–3","pp. 4–5","pp. 6–8"]', JSON.stringify(await ranges()));
    const docs = await p5.evaluate(() => MemStore.all('docs'));
    const ch2 = docs.find(d => d.pageStart === 4);
    const text2 = ch2.clusters.map(c => c.text).join(' ');
    ok('a chapter that runs on into the next PDF holds all of its words, and no other chapter’s', text2.split(/\s+/).filter(w => /^c2w/.test(w)).length === bk.words[2] &&
       !/c[13]w[a-z]/.test(text2), `${text2.split(/\s+/).filter(w => /^c2w/.test(w)).length} of ${bk.words[2]}`);
    ok('its running header is gone from its text', !/CHAPTER 2/.test(text2) && !docs.some(d => /CHAPTER \d/.test(d.clusters.map(c => c.text).join(' '))));

    head('a chapter of the book: taught, its figure found when opened');
    await p5.locator('#chapters .chapter-row').nth(2).locator('button.unit-open').click();
    await p5.locator('#sections .section-card').first().waitFor(T);
    ok('a chapter opens as a unit, naming its book and pages', /Book · chapter 2 · pp\. 4–5/.test(await p5.locator('.book-of').innerText()), await p5.locator('.book-of').innerText());
    await p5.waitForFunction(id => MemStore.get('docs', id).then(d => Array.isArray(d.figures)), ch2.id, T);
    const figs = await p5.evaluate(id => MemStore.get('docs', id).then(d => d.figures), ch2.id);
    ok('its figure is found the first time it is opened, at its book page, from the second PDF', figs.length === 1 && figs[0].page === BOOK_FIG.page &&
       figs[0].caption === BOOK_FIG.caption && figs[0].box.every((v, i) => Math.abs(v - BOOK_FIG.box[i]) <= 1), JSON.stringify(figs));
    await p5.locator('#learn-unit').click();
    await p5.locator('ol.points > li').first().waitFor(T);
    await p5.waitForFunction(() => { const i = document.querySelector('#visuals .figs img'); return i && /^data:image\/png/.test(i.src) && i.naturalWidth > 0; }, null, T);
    await p5.waitForFunction(() => [...document.querySelectorAll('#visuals .pages img')].length === 2 && [...document.querySelectorAll('#visuals .pages img')].every(i => /^data:image\/png/.test(i.src)), null, T);
    ok('and drawn, with both its pages — one from each PDF', (await p5.locator('#visuals .figs figcaption').first().innerText()).indexOf(BOOK_FIG.caption) === 0 &&
       JSON.stringify(await p5.$$eval('#visuals .pages figcaption', fs => fs.map(f => f.textContent))) === '["Page 4","Page 5"]');
    await p5.locator('header.topbar button[aria-label="Back"]').click();
    await p5.locator('#learn-unit').waitFor(T);
    await p5.locator('header.topbar button[aria-label="Back"]').click();
    await p5.locator('#chapters').waitFor(T);
    ok('back from a chapter is back to its book', await p5.locator('#found-by').count() === 1);

    head('cutting the book again');
    /* Chapter 1 opened, so it has a session to keep. */
    await p5.locator('#chapters .chapter-row').nth(1).locator('button.unit-open').click();
    await p5.locator('#sections').waitFor(T);
    await p5.waitForFunction(() => MemStore.all('docs').then(ds => Array.isArray(ds.find(d => d.pageStart === 2).figures)), null, T);
    await p5.locator('header.topbar button[aria-label="Back"]').click();
    await p5.locator('#chapters').waitFor(T);
    const keptId = (await p5.evaluate(() => MemStore.all('books').then(x => x[0].chapters))).find(c => c.pageStart === 2).docId;
    /* A chapter's row is short: its menu hangs below it, over the next row,
       and must be what a tap there lands on — with the finger still on the
       row, which is then :hover and lifted by a transform. Row 2 has a row
       after it. (A z-index for the open row was written against the next
       row covering the menu; with it removed this still passed in Chromium,
       so it was dropped rather than kept on a guess.) */
    await p5.locator('#chapters .chapter-row').nth(2).locator('details.menu summary').click();
    await p5.evaluate(() => document.querySelector('[data-join="2"]').closest('.chapter-row').scrollIntoView({ block: 'center' }));
    await p5.locator('#chapters .chapter-row').nth(2).locator('details.menu summary').hover();
    const joinHit = await p5.evaluate(() => { const b = document.querySelector('[data-join="2"]');
      const r = b.getBoundingClientRect(), row = b.closest('.chapter-row'), rr = row.getBoundingClientRect(), next = row.nextElementSibling.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { below: Math.round(r.bottom - rr.bottom), overNext: r.bottom > next.top, hover: row.matches(':hover'), lifted: getComputedStyle(row).transform !== 'none', hit: !!at && (at === b || b.contains(at)) }; });
    await p5.locator('#chapters .chapter-row').nth(2).locator('details.menu summary').click();
    ok('a chapter’s menu, hanging over the next row, can be seen and tapped — the row lifted under the finger too',
       joinHit.below > 0 && joinHit.overNext && joinHit.hover && joinHit.lifted && joinHit.hit, JSON.stringify(joinHit));
    await p5.locator('#chapters .chapter-row').nth(3).locator('details.menu summary').click();
    await p5.locator('[data-join="3"]').click();
    await p5.waitForFunction(() => document.querySelectorAll('#chapters .chapter-row').length === 3, null, T);
    ok('joining a chapter to the one before gives it that chapter’s pages', JSON.stringify(await ranges()) === '["pp. 1–1","pp. 2–3","pp. 4–8"]', JSON.stringify(await ranges()));
    const after = await p5.evaluate(() => Promise.all([MemStore.all('books'), MemStore.all('docs'), MemStore.all('sessions')]));
    ok('the chapter left as it was keeps its unit and its progress; the joined ones are rebuilt', after[0][0].chapters.find(c => c.pageStart === 2).docId === keptId &&
       after[2].some(s => s.id === keptId) && !after[1].some(d => d.id === ch2.id) && !after[2].some(s => s.id === ch2.id) && after[1].length === 3,
       after[1].map(d => d.id).join(' | '));
    await p5.evaluate(() => { window.__reads = 0; const r = MemPdf.read; MemPdf.read = function () { window.__reads++; return r.apply(this, arguments); }; });
    await p5.locator('#methods [data-method="numbered"]').click();
    await p5.waitForFunction(() => /Valve Disease/.test(document.querySelector('#chapters').innerText) && !/2\. Valve/.test(document.querySelector('#chapters').innerText), null, T);
    ok('cut by its “Chapter N” headings instead: titled by them, the same pages', JSON.stringify(await titles()) === '["· Before chapter 1","1 Heart Failure Basics","2 Valve Disease","3 Arrhythmias"]' &&
       JSON.stringify(await ranges()) === '["pp. 1–1","pp. 2–3","pp. 4–5","pp. 6–8"]', JSON.stringify(await titles()));
    ok('from the book’s stored text, without reading the PDFs again', await p5.evaluate(() => window.__reads) === 0);
    const again = await p5.evaluate(() => Promise.all([MemStore.all('books'), MemStore.all('sessions')]));
    /* Kept, not rebuilt on the same id: a rebuilt chapter forgets the
       figures it found and is split into sections again for nothing — on a
       real book, a hundred chapters of it at every re-cut. */
    ok('renamed chapters on the same pages keep their progress, and are not rebuilt', await p5.evaluate(id => MemStore.get('docs', id).then(d => Array.isArray(d.figures)), keptId) &&
       again[0][0].chapters.find(c => c.pageStart === 2).docId === keptId &&
       again[1].some(s => s.id === keptId) && await p5.evaluate(id => MemStore.get('docs', id).then(d => d.name), keptId) === 'Heart Failure Basics');

    head('the book on the home screen');
    await p5.locator('nav.dock').getByRole('button', { name: 'Home' }).click();
    await p5.locator('#books .book-row').waitFor(T);
    /* Counted where it is drawn: the first version of this check read
       ui.docs, which holds the chapters either way, and survived the list
       showing them. */
    ok('its chapters are not listed as units of their own', await p5.locator('#units .unit-row').count() === 0 && await p5.locator('#books .book-row').count() === 1,
       `${await p5.locator('#units .unit-row').count()} unit rows`);
    ok('my books: its name, chapters, pages and PDFs', /^Book\s*3 chapters · 8 pages · 2 PDFs/.test((await p5.locator('#books .book-row').innerText()).trim()),
       await text(p5, '#books .book-row'));
    ok('a chapter opened joins jump back in; the ones never opened do not', JSON.stringify(await p5.$$eval('.jump-card strong', es => es.map(e => e.textContent))) === '["Heart Failure Basics"]',
       JSON.stringify(await p5.$$eval('.jump-card strong', es => es.map(e => e.textContent))));
    await p5.locator('#books .book-row button.unit-open').click();
    await p5.locator('#delete-book').click();
    await p5.locator('#door-add').waitFor(T);
    const left = await p5.evaluate(() => Promise.all(['books', 'docs', 'files', 'bookpages'].map(s => MemStore.all(s).then(x => x.length))));
    ok('deleting the book deletes its chapters, its PDFs and its text', JSON.stringify(left) === '[0,0,0,0]', JSON.stringify(left));
  }

  head('scanned pages and photos: read by text recognition, on the device');
  {
    /* Fresh profiles again: one online, one where the text reader's
       download fails, as it would offline. */
    const fresh = async (tag, blockOcr) => {
      const p = watch(await (await browser.newContext({ viewport: { width: 820, height: 1100 }, serviceWorkers: 'block' })).newPage(), events, tag, errors);
      await wire(p);
      /* After wire(): Playwright tries the most recently added route first,
         so added before it, this block was shadowed by the CDN route and
         the "offline" run downloaded the reader and read the page. */
      if (blockOcr) await p.route(/tesseract/, route => route.abort());
      await p.goto(URL);
      await p.locator('#door-add').waitFor(T);
      return p;
    };
    const p3 = await fresh('ocr', false);
    const jpeg = Buffer.from(await p3.evaluate(makeScanJpeg, SCAN_LINES), 'base64');
    const scanPdf = makeScanPdf(jpeg, 1224, 1584);
    await p3.setInputFiles('#pdf-input', { name: 'scan.pdf', mimeType: 'application/pdf', buffer: scanPdf });
    await p3.locator('#sections .section-card').first().waitFor({ timeout: 120000 });
    const srec = await p3.evaluate(() => MemStore.all('docs').then(d => d[0]));
    const stext = srec.clusters.map(c => c.text).join(' ');
    ok('the scanned page is read by text recognition, and named as such', JSON.stringify(srec.ocr) === '[2]' && srec.scanned.length === 0,
       JSON.stringify({ ocr: srec.ocr, scanned: srec.scanned, err: srec.ocrError }));
    ok('its words reach the sections, as sentences', /Venous return is the main determinant of preload in a healthy heart, and preload rises with volume\./.test(stext), stext.slice(0, 160));
    ok('its heading is found by its size, as a real one would be', srec.clusters.some(c => c.headings.indexOf('Scanned Page Heading') !== -1),
       JSON.stringify(srec.clusters.map(c => c.headings)));
    ok('and the page with a text layer is read as before', /This first page carries real text/.test(stext));
    const scard = (await p3.locator('#source-card').textContent()).replace(/\s+/g, ' ');
    ok('the unit\u2019s source card flags the recognised page to check, and is open by itself', /Read, with pages to check/.test(scard) &&
       /1 page read by text recognition \(2\)/.test(scard) && await p3.evaluate(() => document.querySelector('#source-card').open), scard.slice(0, 160));
    const onScan = srec.clusters.findIndex(c => c.pageStart <= 2 && c.pageEnd >= 2);
    await p3.evaluate(([id, i]) => Memorizer.openDoc(id, i), [srec.id, onScan]);
    await p3.locator('#big-idea').waitFor(T);
    const ocrNote = await p3.locator('#ocr-note').count() ? await p3.locator('#ocr-note').innerText() : 'no note';
    ok('the lesson of the section on that page says it was recognised, and to check it', /scanned page by text recognition \(p\. 2\)/.test(ocrNote), ocrNote);
    const pc = srec.ocrConf && srec.ocrConf['2'];
    ok('how sure recognition was of the page is kept: the mean of its words, and how many it dropped', !!pc && pc.mean > 0 && pc.mean <= 100 && pc.words > 10 && pc.dropped >= 0, JSON.stringify(pc));
    await p3.locator('#fix-text summary').click();
    const fixSi = await p3.evaluate(() => [...document.querySelectorAll('#fix-text textarea')].find(a => /Venous return/.test(a.value)).getAttribute('data-si'));
    const was = await p3.locator('#fix-text textarea[data-si="' + fixSi + '"]').inputValue();
    await p3.fill('#fix-text textarea[data-si="' + fixSi + '"]', was.replace('preload rises with volume', 'preload rises with volume load'));
    await p3.locator('#fix-text button[data-fix="' + fixSi + '"]').click();
    await p3.waitForFunction(id => MemStore.get('docs', id).then(d => (d.corrections || []).length === 1), srec.id, T).catch(() => {});
    const fixed = await p3.evaluate(id => MemStore.get('docs', id), srec.id);
    ok('a paragraph recognition read can be corrected: the section keeps your text, and the correction with what it said before', fixed.corrections && fixed.corrections.length === 1 &&
       fixed.corrections[0].was === was && /volume load/.test(fixed.clusters[onScan].text) && fixed.clusters[onScan].segments[+fixSi].corrected === true, JSON.stringify(fixed.corrections));
    await p3.locator('#big-idea').waitFor(T);
    ok('and the lesson is taught again from it', /volume load/.test(await p3.evaluate(() => JSON.stringify(Memorizer.ui.state.per[Memorizer.ui.state.section].lesson))) &&
       /volume load/.test(await p3.locator('details.source').textContent()), await p3.evaluate(() => JSON.stringify(Memorizer.ui.state.per[Memorizer.ui.state.section].lesson.points.map(p => p.text))).then(t => t.slice(0, 300)));
    await p3.evaluate(id => MemStore.get('docs', id).then(d => { d.ocrConf['2'].mean = 50; return MemStore.put('docs', d); }), srec.id);
    await p3.evaluate(id => Memorizer.openDoc(id), srec.id);
    await p3.locator('#source-card').waitFor(T);
    ok('a page recognition was unsure of is named on the source card, with how sure, to check', /unsure of p\. 2 \(50%\)/.test(await p3.locator('#ocr-unsure').count() ? await text(p3, '#ocr-unsure') : ''));
    await p3.locator('nav.dock').getByRole('button', { name: 'Home' }).click();
    await p3.locator('.unit-row').first().waitFor(T);
    ok('my units says which pages were recognised', /Read by text recognition: pages 2\./.test(await p3.locator('.unit-row').first().innerText()));
    /* A photo of the same page, through the Photo chip. */
    await p3.setInputFiles('#photo-input', { name: 'page.jpg', mimeType: 'image/jpeg', buffer: jpeg });
    await p3.locator('h1.bar-title', { hasText: 'Photos' }).waitFor({ timeout: 120000 });
    const prec2 = await p3.evaluate(() => MemStore.all('docs').then(ds => ds.find(d => d.source === 'photo')));
    const ptext = prec2.clusters.map(c => c.text).join(' ');
    ok('a photo of a page is read the same way, heading and all', /Venous return is the main determinant of preload in a healthy heart, and preload rises with volume\./.test(ptext) &&
       prec2.clusters.some(c => c.headings.indexOf('Scanned Page Heading') !== -1) && JSON.stringify(prec2.ocr) === '[1]', ptext.slice(0, 160));

    const p4 = await fresh('ocr-offline', true);
    await p4.setInputFiles('#pdf-input', { name: 'scan.pdf', mimeType: 'application/pdf', buffer: scanPdf });
    await p4.locator('#sections .section-card').first().waitFor({ timeout: 60000 });
    const orec = await p4.evaluate(() => MemStore.all('docs').then(d => d[0]));
    await p4.locator('nav.dock').getByRole('button', { name: 'Home' }).click();
    await p4.locator('.unit-row').first().waitFor(T);
    ok('when the text reader cannot load, the scanned page is still named, with the reason', JSON.stringify(orec.scanned) === '[2]' && orec.ocr.length === 0 &&
       /text reader could not run/.test(await p4.locator('.unit-row').innerText()), JSON.stringify({ scanned: orec.scanned, err: orec.ocrError }));
    ok('and the rest of the PDF is imported all the same', orec.clusters.some(c => /This first page carries real text/.test(c.text)));

    /* A table in a shaded box, found as a drawing, is named by its own title */
    const p5t = await fresh('boxed-table', true);
    await p5t.setInputFiles('#pdf-input', { name: 'fainting.pdf', mimeType: 'application/pdf', buffer: makeBoxedTablePdf() });
    await p5t.locator('#sections .section-card').first().waitFor({ timeout: 60000 });
    const trec = await p5t.evaluate(() => MemStore.all('docs').then(d => d[0].figures));
    const tf = trec.find(f => f.kind === 'table');
    ok('a table printed in a shaded box is named "Table 9.1" by its own title, with no figure number', trec.length === 1 && tf && tf.label === 'Table 9.1' &&
       tf.number === undefined && /^TABLE 9\.1 Causes of exertional fainting/.test(tf.caption), JSON.stringify(trec));
    await p5t.locator('#sections .section-card').first().click();
    await p5t.locator('#visuals .figs figure').first().waitFor(T);
    ok('and the lesson shows it under that name', await p5t.locator('#visuals .figs button[aria-label="Enlarge Table 9.1"]').count() === 1 &&
       /TABLE 9\.1/.test(await p5t.locator('#visuals .figs figcaption').first().innerText()), await p5t.locator('#visuals .figs figcaption').first().innerText());

    /* A labelled diagram: the labels printed inside it are kept, and a figure card is made from them */
    const p5d = await fresh('diagram', true);
    await p5d.setInputFiles('#pdf-input', { name: 'chambers.pdf', mimeType: 'application/pdf', buffer: makeDiagramPdf() });
    await p5d.locator('#sections .section-card').first().waitFor({ timeout: 60000 });
    const drec = await p5d.evaluate(() => MemStore.all('docs').then(d => d[0]));
    const df = (drec.figures || [])[0];
    ok('a diagram’s printed labels are kept with it — its caption and the page’s prose are not', !!df && df.label === 'Figure 2.1' &&
       JSON.stringify((df.labels || []).map(l => l.text).sort()) === JSON.stringify(['Aorta', 'Left atrium', 'Left ventricle', 'Right atrium', 'Right ventricle']),
       JSON.stringify(df && { label: df.label, labels: (df.labels || []).map(l => l.text) }));
    const made = await p5d.evaluate(id => MemStore.get('docs', id).then(d => Memorizer.makeStudyCards(d, 0)), drec.id);
    const occ = made.find(c => c.kind === 'occlusion');
    ok('and a figure card hides one of them, asked among the others', !!occ && occ.options.length === 4 && occ.options.every(o => df.labels.some(l => l.text === o)) &&
       occ.figure.page === df.page && occ.mask.width > 0 && occ.mask.height > 0, JSON.stringify(occ && { opts: occ.options, mask: occ.mask }));
    /* found again the other way — when a unit's figures are re-read (a book's chapter, or a finder upgrade) */
    await p5d.evaluate(id => MemStore.get('docs', id).then(d => { d.figures = []; d.figuresV = 0; return MemStore.put('docs', d); }), drec.id);
    await p5d.evaluate(id => Memorizer.openDoc(id, 0), drec.id);
    await p5d.waitForFunction(v => Memorizer.ui.docRec && Memorizer.ui.docRec.figuresV === v, await p5d.evaluate(() => MemPdf.FIGURES_V), T).catch(() => {});
    const again = await p5d.evaluate(id => MemStore.get('docs', id).then(d => (d.figures[0] && d.figures[0].labels || []).map(l => l.text).sort()), drec.id);
    ok('and a unit whose figures are found again keeps its labels too', JSON.stringify(again) === JSON.stringify(['Aorta', 'Left atrium', 'Left ventricle', 'Right atrium', 'Right ventricle']), JSON.stringify(again));
  }

  head('opened as a data: URL, the way the iPad\u2019s Files app hands a file to Safari');
  {
    /* No origin, so no storage: reading localStorage itself throws. The
       owner's iPad showed a blank page here — an unguarded read stopped
       the script before anything was drawn. */
    const pd = await (await browser.newContext({ viewport: { width: 820, height: 1100 }, serviceWorkers: 'block' })).newPage();
    const derr = [];
    pd.on('pageerror', e => derr.push(e.message));
    await pd.goto('data:text/html;base64,' + Buffer.from(html).toString('base64'));
    await pd.locator('#store-banner').waitFor(T);
    ok('it opens: the home screen is drawn, and nothing throws', derr.length === 0 && await pd.locator('main.home').count() === 1, derr.join(' | '));
    await pd.locator('nav.dock').getByRole('button', { name: 'Settings' }).click();
    await pd.waitForFunction(() => Memorizer.ui.view === 'settings' && document.querySelector('[data-theme-id]'), null, T).catch(() => {});
    ok('Settings opens there too, its appearance choices drawn, nothing thrown', derr.length === 0 && await pd.locator('[data-theme-id]').count() > 0, derr.join(' | '));
    ok('and it says plainly that nothing will be kept, and what to do instead', /Nothing you add here will be kept/.test(await pd.locator('#store-banner').innerText()) &&
       /web address/.test(await pd.locator('#store-banner').innerText()), await pd.locator('#store-banner').innerText());
  }

  ok('and nothing threw on the page throughout', errors.length === 0, errors.join(' | '));
  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(die);
