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
        points: [{ text: 'Preload — end-diastolic stretch ' + EVIL, page: 1 }, { text: 'Venous return sets preload', page: 2 }],
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

  head('the lesson: only this section leaves the device');
  await page.locator('#learn-unit').click();
  await page.locator('ol.points > li').first().waitFor(T);
  const les = stub.requests.filter(r => r.kind === 'lesson');
  ok('one lesson request was made', les.length === 1 && stub.requests.length === 1, stub.requests.map(r => r.kind).join(', '));
  ok('it carries section 1’s words, with their pages', new RegExp('s1w' + pdf.firstCode + '\\b').test(les[0].user) && new RegExp('s1w' + pdf.lastCode + '\\b').test(les[0].user) && /\[p\.1\]/.test(les[0].user));
  ok('and nothing of sections 2 or 3', !/s[23]w[a-z]/.test(les[0].user));
  ok('with the grounding prohibition as its system prompt, and the analogy fence in the task', /NOT_IN_PDF/.test(les[0].body.system) &&
     les[0].user.indexOf('The ONLY thing you may write that is not from the excerpt is an analogy') !== -1);
  ok('and the browser-access header Anthropic requires', les[0].headers['anthropic-dangerous-direct-browser-access'] === 'true');
  ok('the step says Learn', (await page.locator('.stepper li.now').textContent()) === 'Learn');
  ok('the big idea comes first', (await text(page, '#big-idea .big')) === 'Preload is how full the ventricle is before it squeezes.' &&
     await page.evaluate(() => document.querySelector('#big-idea').compareDocumentPosition(document.querySelector('#points')) & Node.DOCUMENT_POSITION_FOLLOWING));
  const pointText = await page.locator('ol.points > li').first().innerText();
  ok('the key points are numbered cards, a definition leading with its term',
     await page.locator('ol.points > li').count() === 2 && (await page.locator('ol.points > li .lead').first().innerText()) === 'Preload' &&
     (await page.locator('ol.points > li .point-n').first().innerText()) === '1', pointText.replace(/\s+/g, ' '));
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
  ok('the figure on page 1 is shown, cut from the page at its own shape', Math.abs(fig.w / fig.h - 2) < 0.1, `${fig.w}×${fig.h}`);
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
  await page.keyboard.press('Escape');
  ok('and Escape closes it', await page.locator('.lightbox').count() === 0);
  await page.locator('#glance .gl-path').waitFor(T);
  ok('at a glance: the cause-and-effect sentences as a pathway, the book\u2019s verbs on the arrows', /^Diuretics reduce → preload raises → venous pressure/.test(await text(page, '#glance .gl-path')) &&
     await page.locator('#flow').count() === 0, await text(page, '#glance .gl-path'));
  ok('the quick check comes after the lesson\u2019s cards, before its extras', await page.evaluate(() => {
    const q = document.querySelector('#quick'), h = document.querySelector('.hook'), n = document.querySelector('#numbers');
    return !!q && !!(h.compareDocumentPosition(q) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(n.compareDocumentPosition(q) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  await page.locator('#quick .option').first().click();
  ok('answered, it shows right or wrong and why — and is not recorded', await page.locator('#quick .why').count() === 1 &&
     await page.evaluate(() => Memorizer.ui.state.per[0].answers.length === 0 && Memorizer.ui.state.cards.length === 0 && Memorizer.ui.state.phase === 'teach'));

  head('the drill: multiple choice, and a miss comes back');
  await page.locator('#to-drill').click();
  await page.locator('#mcq .option').first().waitFor(T);
  const qz = stub.requests.filter(r => r.kind === 'quiz');
  ok('one drill request, carrying the lesson’s key points and section 1 only', qz.length === 1 && /1\. Preload — end-diastolic stretch/.test(qz[0].user) &&
     !/s[23]w[a-z]/.test(qz[0].user), qz.map(r => r.user.length).join());
  ok('the step says Drill, with Learn done', (await page.locator('.stepper li.now').textContent()) === 'Drill' && (await page.locator('.stepper li.done').textContent()) === 'Learn');
  ok('four options, lettered A to D, and nothing to type', JSON.stringify(await page.$$eval('#mcq .opt-letter', es => es.map(e => e.textContent))) === '["A","B","C","D"]' &&
     await page.locator('textarea, input[type="text"]').count() === 0);
  ok('the question counts where it is', /Question 1 of 2/.test(await meta(page)));
  await page.locator('.option[data-i="0"]').click();
  ok('a right choice turns green, with the book’s reason and page', await page.locator('.option.right[data-i="0"]').count() === 1 &&
     /Correct/.test(await page.locator('.why.good strong').innerText()) && /stretch at end-diastole/.test(await page.locator('.why').innerText()) &&
     await page.locator('.why .pg').count() === 1);
  ok('and every option is closed once one is chosen', await page.locator('.option:not([disabled])').count() === 0);
  ok('but nothing is recorded until Next', await page.evaluate(() => Memorizer.ui.state.per[0].answers.length === 0));
  await page.locator('#next').click();
  await page.waitForFunction(() => /Question 2 of 2/.test(document.querySelector('.mcq-meta').innerText), null, T);
  ok('a sentence from the book with a gap shows the gap', (await page.locator('blockquote.quote .gap').innerText()) === '_____');
  await page.locator('.option[data-i="0"]').click();
  ok('a wrong choice turns red, and the right one green', await page.locator('.option.wrong[data-i="0"]').count() === 1 && await page.locator('.option.right[data-i="1"]').count() === 1 &&
     await page.locator('.option.dim').count() === 2);
  ok('it names the answer, fills the gap and says it will come back', /The answer is B: preload/.test(await page.locator('.why.bad strong').innerText()) &&
     (await page.locator('blockquote.quote .gap').innerText()) === 'preload' && /comes back at the end of this drill/.test(await page.locator('.why').innerText()));
  await page.locator('#next').click();
  await page.waitForFunction(() => /Again/.test(document.querySelector('.mcq-meta').innerText), null, T);
  ok('the miss is asked again at the end', (await page.locator('#mcq h2.q').innerText()) === Q_GAP.question && /you missed this one/.test(await meta(page)));
  await page.locator('.option[data-i="1"]').click();
  await page.locator('#next').click();
  await page.locator('#result').waitFor(T);
  ok('the result counts first tries only: 1 of 2', /1 of 2 right first time/.test(await page.locator('#result h2').innerText()) &&
     (await page.locator('#result .ring-pct').innerText()) === '50%');
  ok('and lists what was missed, with its answer', /Which does a diuretic lower\?/.test(await page.locator('ul.missed').innerText()) &&
     /→ preload/.test(await page.locator('ul.missed').innerText()));
  const cards1 = await page.evaluate(() => MemStore.all('cards'));
  ok('the miss is one review card, carrying its options', cards1.length === 1 && cards1[0].source === 'drill' && cards1[0].front === Q_GAP.question &&
     cards1[0].options.length === 4 && cards1[0].answer === 1, cards1.map(c => c.source + ':' + c.front).join(' | '));
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
  const pearlText = (await page.locator('#pearl .pearl-steps').innerText()).replace(/\s+/g, ' ');
  ok('the pearl of the day is the PDF’s own sentence, broken into steps', /Pearl of the day/i.test(await page.locator('#pearl .eyebrow').innerText()) &&
     await page.locator('#pearl .pearl-steps li').count() >= 2 && /end-diastolic pressure greater than 18 mmHg/.test(pearlText) && /stiff ventricle/.test(pearlText), pearlText);
  ok('with its thresholds marked', JSON.stringify(await page.$$eval('#pearl mark', ms => ms.map(m => m.textContent.trim()))) === '["18 mmHg","8","12 mmHg"]',
     JSON.stringify(await page.$$eval('#pearl mark', ms => ms.map(m => m.textContent.trim()))));
  ok('credited to where it was printed', /Section One Preload/.test(await page.locator('#pearl .pearl-src').innerText()) &&
     /p\.1/.test(await page.locator('#pearl .pearl-src').innerText()), await page.locator('#pearl .pearl-src').innerText());
  /* The owner asked for no animation. Every element on the home screen, as
     the browser computes it — not as the stylesheet says. */
  const moving = await page.evaluate(() => [...document.querySelectorAll('main.home, main.home *, nav.dock, nav.dock *')].filter(el => {
    const cs = getComputedStyle(el);
    return cs.animationName !== 'none' || cs.transitionDuration.split(',').some(d => parseFloat(d) > 0);
  }).map(el => el.tagName + '.' + el.className));
  ok('nothing on the home screen animates or transitions', moving.length === 0, moving.slice(0, 5).join(', ') || 'still');
  const dock = await page.evaluate(() => { const r = document.querySelector('nav.dock').getBoundingClientRect(); return { pos: getComputedStyle(document.querySelector('nav.dock')).position, gap: innerHeight - r.bottom, w: r.width }; });
  ok('the tabs float at the foot of the screen', dock.pos === 'fixed' && dock.gap > 0 && dock.w < 820, JSON.stringify(dock));
  /* Section 1 scored 1 of 2 on its drill: 50%, and its one miss is its card. */
  const weakText = (await page.locator('#weak').innerText()).replace(/\s+/g, ' ');
  ok('needs work names the shaky section, with its score and its cards', /Section One Preload/.test(weakText) && /50% on the drill/.test(weakText) &&
     await page.locator('#weak li').count() === 1 && await page.locator('#weak button', { hasText: 'Drill · 1' }).count() === 1, weakText);
  /* The drill rates the card; the review checks below expect it unreviewed,
     so it is put back as it was before leaving. It is reviewed Easy first,
     so it is not due: plain review would offer nothing, the drill must
     still offer it. */
  const cardsBefore = await page.evaluate(() => MemStore.all('cards'));
  await page.evaluate(() => MemStore.all('cards').then(cs => { cs[0].srs = FSRS.update(null, 4, FSRS.todayISO()); return MemStore.put('cards', cs[0]); }));
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
  ok('the card survived the reload', (await page.evaluate(() => MemStore.all('cards'))).length === 1);

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
  const ex = stub.requests.filter(r => r.kind === 'exam');
  ok('one exam request, with the full text of the two weakest sections', ex.length === 1 && new RegExp('s1w' + pdf.lastCode + '\\b').test(ex[0].user) &&
     new RegExp('s2w' + pdf.lastCode + '\\b').test(ex[0].user) && /sections 0, 1\./.test(ex[0].user));
  ok('and nothing of section 3 but its key points', !/s3w[a-z]/.test(ex[0].user) && /"Section Three Contractility" \(key points\)/.test(ex[0].user));
  const examMeta = await meta(page);
  ok('the exam does not name the section a question is from, before it is answered', /^Question 1 of 2/.test(examMeta) && !pdf.titles.some(t => examMeta.indexOf(t) !== -1), examMeta);
  await page.locator('.option[data-i="2"]').click();
  ok('and does, once it is', /From “Section One Preload”/.test(await page.locator('.why').innerText()), await text(page, '.why'));
  await page.locator('#next').click();
  await page.waitForFunction(() => /Question 2 of 2/.test(document.querySelector('.mcq-meta').innerText), null, T);
  ok('an exam miss is not asked again: the exam moves on', (await page.locator('#mcq h2.q').innerText()) === 'In the exam: which does a diuretic lower?');
  await answer(page, 1);
  await page.locator('#result').waitFor(T);
  ok('the exam is scored, by section', /Final exam: 50%/.test(await page.locator('#result h2').innerText()) &&
     JSON.stringify(await page.$$eval('ul.by-section li', ls => ls.map(l => l.innerText.replace(/\s+/g, ' ').trim()))) === '["Section One Preload 0/1","Section Two Afterload 1/1"]',
     JSON.stringify(await page.$$eval('ul.by-section li', ls => ls.map(l => l.innerText.replace(/\s+/g, ' ').trim()))));
  const cards2 = await page.evaluate(() => MemStore.all('cards'));
  ok('its miss is a review card from the exam, filed under its section', cards2.length === 2 &&
     cards2.some(c => c.source === 'exam' && c.cluster === 0 && c.front === 'In the exam: what is preload?'), cards2.map(c => c.source + ':' + c.cluster).join(' | '));
  ok('and it can be retaken', await page.locator('#retake').count() === 1);
  await page.getByRole('button', { name: 'Back to sections' }).click();
  await page.locator('#sections').waitFor(T);
  ok('and Back to sections goes there, the exam card keeping its score', /Last score 50%/.test(await page.locator('#exam-card').innerText()) &&
     (await page.locator('#exam-card #to-exam').innerText()) === 'Retake');

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
  await page.locator('nav.dock').getByRole('button', { name: /Review/ }).click();
  await page.locator('#mcq .option').first().waitFor(T);
  ok('a review card is the question again, as multiple choice', /2 due/.test(await page.locator('.review-head').textContent()) && await page.locator('#mcq .option').count() === 4,
     await text(page, '.review-head') + ' · ' + await page.locator('#mcq .option').count() + ' options');
  const shown = await page.locator('#mcq h2.q').innerText();
  const card = cards2.find(c => c.front === shown);
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
       await p2.evaluate(() => MemStore.all('cards').then(c => c.length)) === 0);
    ok('and not one request went to an AI provider', stub.requests.length === aiBefore, `${stub.requests.length - aiBefore} requests`);
    await p2.locator('nav.dock').getByRole('button', { name: 'Settings' }).click();
    await p2.locator('#builtin-about').waitFor(T);
    ok('Settings explains the built-in coach, and asks for no key while it is chosen',
       await p2.locator('#builtin-about').isVisible() && !(await p2.locator('#key').isVisible()) &&
       /multiple-choice questions built from the book/.test(await p2.locator('#builtin-about').innerText()));
    ok('and offers only the built-in coach and Claude', JSON.stringify(await p2.$$eval('#provider option', os => os.map(o => o.value))) === '["builtin","anthropic"]');
    /* Appearance: a theme and a size, applied at once and kept. */
    await p2.locator('#appearance .swatch[data-theme-id="nocturne"]').click();
    const bg = await p2.evaluate(() => getComputedStyle(document.body).backgroundColor);
    ok('picking Nocturne recolours the page with Systole’s Nocturne ground', bg === 'rgb(14, 11, 26)', bg);
    /* Contrast and brightness: the page gets the colours appearance.js
       computes for that setting, read back from what the browser drew. */
    const rgbOf = hex => 'rgb(' + [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ') + ')';
    await p2.locator('#appearance .seg button[data-contrast="high"]').click();
    const hiWant = await p2.evaluate(() => MemLook.variant(MemLook.byId('nocturne'), 'high', 'standard'));
    const hiGot = await p2.evaluate(() => ({ ink: getComputedStyle(document.body).color, edge: getComputedStyle(document.querySelector('#appearance .seg button[data-contrast="high"]').closest('.card').querySelector('.swatch')).borderTopColor }));
    ok('High contrast draws the text and the control outlines in the fitted colours', hiGot.ink === rgbOf(hiWant.ink) && hiGot.edge === rgbOf(hiWant.edge) &&
       hiWant.ink !== MemLookNode.byId('nocturne').t.ink, JSON.stringify(hiGot) + ' want ' + rgbOf(hiWant.ink) + ' / ' + rgbOf(hiWant.edge));
    await p2.locator('#appearance .seg button[data-bright="dim"]').click();
    const dimWant = await p2.evaluate(() => MemLook.variant(MemLook.byId('nocturne'), 'high', 'dim').bg);
    ok('and Dim sinks the ground', await p2.evaluate(() => getComputedStyle(document.body).backgroundColor) === rgbOf(dimWant) && rgbOf(dimWant) !== 'rgb(14, 11, 26)', rgbOf(dimWant));
    await p2.locator('#appearance .seg button[data-size="xl"]').click();
    ok('Extra large text makes the body 20px', await p2.evaluate(() => getComputedStyle(document.body).fontSize) === '20px');
    await p2.locator('#appearance .seg button[data-font="serif"]').click();
    await p2.reload();
    await p2.locator('#door-add').waitFor(T);
    ok('and all of it survives a reload, applied before the page draws', await p2.evaluate(() =>
      document.documentElement.getAttribute('data-look') === 'nocturne' && getComputedStyle(document.body).fontSize === '20px' &&
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
    await p2.fill('#ask-q', 'What reduces preload?');
    await p2.locator('#ask-go').click();
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

    head('the on-device AI tutor: everything it writes checked against the book');
    await p2.locator('nav.dock').getByRole('button', { name: 'Settings' }).click();
    await p2.locator('#ai-card').waitFor(T);
    ok('Settings offers it, off, with two Qwen3 models, both Apache-2.0', (await p2.locator('#ai-toggle').innerText()) === 'Turn on' &&
       JSON.stringify(await p2.$$eval('#ai-model option', os => os.map(o => /^Qwen3 /.test(o.textContent) && /Apache-2\.0/.test(o.textContent)))) === '[true,true]');
    ok('the real AI engine downloads, passes its integrity check, and loads from a local file', await p2.evaluate(() => MemLLM.loadLib().then(m => typeof m.CreateMLCEngine, e => 'failed: ' + e.message)) === 'function');
    const known = await p2.evaluate(() => MemLLM.loadLib().then(m => MemLLM.MODELS.map(x => x.id).concat([MemLLM.EMBED.id]).filter(id => !m.prebuiltAppConfig.model_list.some(r => r.model_id === id))));
    ok('every model offered is one the pinned engine knows', known.length === 0, JSON.stringify(known));
    /* A stand-in for the model, answering each job with faithful sentences
       and made-up ones, the way a small model does. */
    await p2.evaluate(() => {
      window.__ai = [];
      MemLLM.saveConfig({ on: true, model: 'stub' });
      MemLLM.useEngine({ chat: { completions: { create: async req => {
        const u = req.messages[1].content; window.__ai.push(u);
        window.__thinkOn = window.__thinkOn || !(req.extra_body && req.extra_body.enable_thinking === false);
        let out = '';
        if (/Answer the question in 2 to 4/.test(u)) {
          const k = (u.split('\n').find(l => /Diuretics reduce preload/.test(l)) || '[1]').match(/^\[(\d+)\]/)[1];
          out = `<think>The passage says 99 mmHg, so I will say that [${k}].</think>Diuretics reduce preload by lowering circulating volume [${k}]. Diuretics reduce preload by 75 percent [${k}]. Nitrates reduce preload too [${k}]. It works well.`;
        } else if (/Explain this section/.test(u)) out = 'Preload is how much the ventricle is stretched before it contracts. Doctors give 40 mg of furosemide.';
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
    await p2.locator('#read-more li button').first().click();
    await p2.locator('#ai-lesson').waitFor(T);
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
    await p2.locator('#mcq .option').first().waitFor(T);
    const qz = await p2.evaluate(() => Memorizer.ui.state.per[0].quiz.questions);
    ok('its question whose answer the section states is asked, first, and marked', qz[0].by === 'ai' && qz[0].question === 'What do diuretics reduce by lowering circulating volume?' &&
       await p2.locator('.ai-tag').count() === 1, JSON.stringify(qz.map(q => q.by || 'built-in')));
    ok('its question whose answer the section does not state is not', !qz.some(q => /pulmonary edema/.test(q.question)) && qz.filter(q => q.by === 'ai').length === 1);
    await p2.locator('.option[data-i="' + qz[0].answer + '"]').click();
    ok('and the explanation shown is the book\u2019s sentence with its page, not the model\u2019s', /Why: Diuretics reduce preload by lowering circulating volume\./.test(await p2.locator('.why').innerText()) &&
       (await p2.locator('.why .pg').innerText()) === 'p.1');
    ok('and none of it went over the network', stub.requests.length === aiNet && await p2.evaluate(() => window.__ai.length) === 4);
    ok('every request asks Qwen3 not to reason aloud; its <think> is removed before checking', await p2.evaluate(() => window.__thinkOn) === false && !/99|think/i.test(sumText));
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
    await p2.locator('nav.dock').getByRole('button', { name: 'Settings' }).click();
    await p2.locator('#meaning-toggle').click();
    await p2.locator('nav.dock').getByRole('button', { name: 'Coach' }).click();
    await p2.fill('#ask-q', 'why do people pass out');
    await p2.locator('#ask-go').click();
    await p2.locator('#not-found').waitFor(T);
    ok('turned off, it is words again', await p2.locator('#answer').count() === 0);
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
  }

  ok('and nothing threw on the page throughout', errors.length === 0, errors.join(' | '));
  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(die);
