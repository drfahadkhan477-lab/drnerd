#!/usr/bin/env node
/*
 * Memorizer, end to end in a real browser: a real PDF goes in, real pdf.js
 * reads it, and one section goes through encode → recall → teach-back with
 * the model stubbed at the network.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-memorizer.js
 *
 * Takes no build argument: it builds memorizer/ itself, into a temporary
 * directory, with scripts/build-memorizer.js — so what is tested is the one
 * file a user would open. The PDF is generated here, from nothing, so no
 * document of anyone's is involved.
 *
 * NEEDS THE NETWORK for one thing: pdf.js, which the app fetches from
 * jsDelivr with a pinned version and an integrity hash. The suite fetches
 * those bytes from jsDelivr itself (see the route below for why) and the page
 * still verifies them against its hashes. Offline, the import step fails.
 *
 * WHAT IS PROVEN, beyond the pure suites, is the glue those cannot see:
 *   · pdf.js's output reaches the chunker in the shape it expects — the real
 *     PDF becomes the sections it was written as, running header dropped;
 *   · the request for section 1 carries section 1 and nothing of section 2;
 *   · model text reaches the page as text, never as markup;
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
const stub = {
  requests: [],
  breakNextEncode: false,
  reply(kind) {
    switch (kind) {
      case 'encode': return { points: [{ text: 'Preload is end-diastolic stretch ' + EVIL, page: 1 }, { text: 'Second point', page: 2 }],
                              mnemonic: 'PRELOAD = Pull Really Early', flowchart: '' };
      case 'recall': return { prompts: [{ question: 'What is preload?', answer: 'End-diastolic stretch.', page: 1 },
                                        { question: 'Why does it matter?', answer: 'It sets stroke volume.', page: 2 }] };
      case 'gradeRecall': return this.requests.filter(r => r.kind === 'gradeRecall').length === 1
        ? { correct: true, missing: [], misconception: '', feedback: 'Right.' }
        : { correct: false, missing: ['stroke volume'], misconception: '', feedback: 'Missed the consequence.' };
      case 'gradeExplain': return { score: 55, gaps: [{ point: 'Preload sets stroke volume through Starling', page: 2 }], misconceptions: [], feedback: 'Say why.' };
      default: return null;
    }
  },
};
function kindOf(user) {
  if (/TASK:\nENCODE\./.test(user)) return 'encode';
  if (/TASK:\nRECALL\./.test(user)) return 'recall';
  if (/TASK:\nGRADE a free-recall/.test(user)) return 'gradeRecall';
  if (/TASK:\nGRADE a teach-back/.test(user)) return 'gradeExplain';
  if (/GAUNTLET\./.test(user)) return 'gauntlet';
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
    if (kind === 'encode' && stub.breakNextEncode) {
      stub.breakNextEncode = false;
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

  head('the built file');
  ok('builds from memorizer/ with every module inlined', built.inlined.length >= 9, built.inlined.join(', '));
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  ok('and it is one file: no script or stylesheet it loads from the repository',
     !/<script src="(?!https:)/.test(html) && !/<link rel="stylesheet" href="(?!https:)/.test(html));
  await page.goto(URL);
  await page.locator('.drop').waitFor(T);
  ok('opens as a local file and shows the library', await page.locator('h1', { hasText: 'Master a whole unit' }).count() === 1);
  ok('with no errors on load', errors.length === 0, errors.join(' | '));

  head('a real PDF becomes the sections it was written as');
  await page.setInputFiles('#pdf-input', { name: 'unit.pdf', mimeType: 'application/pdf', buffer: pdf.buffer });
  await page.locator('li.doc').waitFor(T);
  const docText = await page.locator('li.doc').innerText();
  ok('the document is listed with its page count', docText.indexOf(pdf.pages + ' pages') !== -1, docText.replace(/\s+/g, ' ').slice(0, 80));
  ok('and three sections, one per heading', /\b3 sections\b/.test(docText), docText.replace(/\s+/g, ' ').slice(0, 80));
  const rec = await page.evaluate(() => MemStore.all('docs').then(d => d[0]));
  ok('each section is titled by its heading', JSON.stringify(rec.clusters.map(c => c.title)) === JSON.stringify(pdf.titles),
     rec.clusters.map(c => c.title).join(' | '));
  ok('each holds its own section\u2019s words and none of another\u2019s', rec.clusters.every((c, i) =>
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

  head('encode: only this section leaves the device');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.locator('ul.bullets > li').first().waitFor(T);
  const enc = stub.requests.filter(r => r.kind === 'encode');
  ok('one encode request was made', enc.length === 1, String(enc.length));
  ok('it carries section 1’s words, with their pages', new RegExp('s1w' + pdf.firstCode + '\\b').test(enc[0].user) && new RegExp('s1w' + pdf.lastCode + '\\b').test(enc[0].user) && /\[p\.1\]/.test(enc[0].user));
  ok('and nothing of sections 2 or 3', !/s[23]w[a-z]/.test(enc[0].user));
  ok('with the grounding prohibition as its system prompt', /NOT_IN_PDF/.test(enc[0].body.system));
  ok('and the browser-access header Anthropic requires', enc[0].headers['anthropic-dangerous-direct-browser-access'] === 'true');
  const pointText = await page.locator('ul.bullets > li').first().innerText();
  ok('the points are shown', /end-diastolic stretch/.test(pointText));
  ok('model text is shown as text — the tag is visible, not run', pointText.indexOf('<img') !== -1 &&
     await page.locator('ul.bullets img').count() === 0 && await page.evaluate(() => window.__pwned) === undefined);
  ok('the mnemonic is shown', await page.locator('#hook', { hasText: 'Pull Really Early' }).count() === 1);
  ok('the points are bullets, a definition leading with its term',
     await page.locator('ul.bullets > li').count() === 2 && (await page.locator('ul.bullets > li .lead').first().innerText()) === 'Preload');
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
  ok('and the step says it is Encode', (await page.locator('.stepper li.now').innerText()) === 'Encode');

  head('recall: graded, and a miss becomes a card');
  await page.locator('#to-recall').click();
  await page.locator('h2.q', { hasText: 'What is preload?' }).waitFor(T);
  ok('recall asks its first question', (await page.locator('.stepper li.now').innerText()) === 'Recall');
  await page.fill('textarea.answer', 'The stretch at end diastole');
  await page.locator('#submit-answer').click();
  await page.locator('.feedback.good').waitFor(T);
  ok('a correct answer is shown as correct', await page.locator('.feedback h2', { hasText: 'Correct' }).count() === 1);
  const g1 = stub.requests.filter(r => r.kind === 'gradeRecall')[0];
  ok('the student’s answer went out fenced as data', /<<<ANSWER\nThe stretch at end diastole\nANSWER>>>/.test(g1.user));
  await page.locator('#continue').click();
  await page.locator('h2.q', { hasText: 'Why does it matter?' }).waitFor(T);
  await page.fill('textarea.answer', 'no idea');
  await page.locator('#submit-answer').click();
  await page.locator('.feedback.bad').waitFor(T);
  ok('a wrong answer says it is now a review card', await page.locator('.feedback h2', { hasText: 'review card' }).count() === 1);
  /* Recorded on Continue, not before — so a grader's mistake can still be
     overruled from this screen. */
  ok('but the grade is not recorded until Continue', (await page.evaluate(() => MemStore.all('cards'))).length === 0);
  ok('and it can be overruled from here', await page.locator('#overrule').count() === 1);
  ok('and shows the model answer with its page', await page.locator('.feedback', { hasText: 'It sets stroke volume.' }).count() === 1);

  head('teach-back: scored, gaps become cards');
  await page.locator('#continue').click();
  await page.locator('h2', { hasText: 'Teach it back' }).waitFor(T);
  ok('the step is Teach back', (await page.locator('.stepper li.now').innerText()) === 'Teach back');
  await page.fill('textarea.answer', 'Preload is how full the ventricle is before it squeezes.');
  await page.locator('#submit-answer').click();
  await page.locator('.feedback .score').waitFor(T);
  ok('the score is shown', (await page.locator('.feedback .score strong').innerText()) === '55');
  ok('with the gap it found', await page.locator('.feedback li', { hasText: 'Starling' }).count() === 1);

  head('a failed step says so, and does not advance');
  stub.breakNextEncode = true;
  await page.locator('#continue').click();
  await page.locator('.card.error').waitFor(T);
  const cards = await page.evaluate(() => MemStore.all('cards'));
  ok('Continue recorded both misses as cards: the missed prompt and the gap', cards.length === 2 &&
     cards.some(c => c.source === 'recall' && c.front === 'Why does it matter?') && cards.some(c => c.source === 'explain'),
     cards.map(c => c.source + ':' + c.front).join(' | '));
  ok('the Review tab counts them as due', /Review · 2/.test(await page.locator('nav.top').innerText()));
  const errText = await page.locator('.card.error').innerText();
  ok('a garbled reply shows an error saying what was wrong', /not valid JSON|no JSON|did not match/.test(errText), errText.replace(/\s+/g, ' ').slice(0, 120));
  ok('it is on section 2, still at encode, with no points', await page.evaluate(() => {
    const s = Memorizer.ui.state; return s.cluster === 1 && s.phase === 'encode' && !s.per[1].points; }));
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.locator('ul.bullets > li').first().waitFor(T);
  ok('Try again re-asks and the section proceeds', await page.locator('.where .count', { hasText: 'Section 2 of 3' }).count() === 1);
  const enc2 = stub.requests.filter(r => r.kind === 'encode').slice(-1)[0];
  ok('section 2\u2019s table is drawn as a table', await page.locator('#tables table.data tbody tr').count() === 3 &&
     (await page.locator('#tables thead').innerText()).replace(/\s+/g, ' ').trim() === 'Measure Normal Unit');
  ok('the section-2 request sends the table to the model as rows', /TABLE:\n\| Measure \| Normal \| Unit \|/.test(stub.requests.filter(r => r.kind === 'encode').slice(-1)[0].user));
  ok('and the section-2 request carries section 2 only', new RegExp('s2w' + pdf.firstCode + '\\b').test(enc2.user) && !/s[13]w[a-z]/.test(enc2.user));

  head('a reload resumes where it stopped');
  await page.reload();
  await page.locator('li.doc').waitFor(T);
  ok('the library shows where the unit is', /Section 2 of 3/.test(await page.locator('li.doc').innerText()));

  head('home: Systole’s layout, drawn still');
  ok('the hero names the unit to carry on with', (await page.locator('.home-hero h1').innerText()) === 'unit');
  ok('its progress counts one section studied of three, and no card held yet — neither card has been reviewed',
     (await page.locator('#home-meter').getAttribute('aria-label')) === '1 of 3 sections studied; 0 of 2 review cards held',
     await page.locator('#home-meter').getAttribute('aria-label'));
  ok('the doors: Continue where you are, Review with what is due, Add a PDF, Settings',
     /^▶\s*Continue\s*unit · Section 2 of 3$/.test((await page.locator('#door-continue').innerText()).trim()) &&
     /Review · 2/.test(await page.locator('#door-review').innerText()) &&
     await page.locator('#door-add[for="pdf-input"]').count() === 1 && await page.locator('#door-settings').count() === 1,
     (await page.locator('.doors').innerText()).replace(/\s+/g, ' '));
  const pearlText = (await page.locator('#pearl .pearl-steps').innerText()).replace(/\s+/g, ' ');
  ok('today’s pearl is the PDF’s own sentence, broken into steps', /Today’s pearl/i.test(await page.locator('#pearl .eyebrow').innerText()) &&
     await page.locator('#pearl .pearl-steps li').count() >= 2 && /end-diastolic pressure greater than 18 mmHg/.test(pearlText) && /stiff ventricle/.test(pearlText), pearlText);
  ok('with its thresholds marked', JSON.stringify(await page.$$eval('#pearl mark', ms => ms.map(m => m.textContent.trim()))) === '["18 mmHg","8","12 mmHg"]',
     JSON.stringify(await page.$$eval('#pearl mark', ms => ms.map(m => m.textContent.trim()))));
  ok('credited to where it was printed', /Section One Preload/.test(await page.locator('#pearl .pearl-src').innerText()) &&
     /p\.1/.test(await page.locator('#pearl .pearl-src').innerText()), await page.locator('#pearl .pearl-src').innerText());
  /* The owner asked for no animation. Every element on the home screen, as
     the browser computes it — not as the stylesheet says. */
  const moving = await page.evaluate(() => [...document.querySelectorAll('main.home, main.home *')].filter(el => {
    const cs = getComputedStyle(el);
    return cs.animationName !== 'none' || cs.transitionDuration.split(',').some(d => parseFloat(d) > 0);
  }).map(el => el.tagName + '.' + el.className));
  ok('nothing on the home screen animates or transitions', moving.length === 0, moving.slice(0, 5).join(', ') || 'still');
  await page.setViewportSize({ width: 1180, height: 820 });   /* an iPad Air, landscape */
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.home-top')).gridTemplateColumns.split(' ').length);
  ok('landscape: the hero and the pearl side by side', cols === 2, String(cols));
  await page.setViewportSize({ width: 820, height: 1100 });
  ok('and stacked in portrait', await page.evaluate(() => getComputedStyle(document.querySelector('.home-top')).gridTemplateColumns.split(' ').length) === 1);
  /* Section 1 was taught with one recall answer of two right and a
     teach-back of 55: mastery 0.5 × ½ + 0.5 × 0.55 = 52.5%. Its two misses
     are its two cards. */
  const weakText = (await page.locator('#weak').innerText()).replace(/\s+/g, ' ');
  ok('weak spots name the shaky section, with its mastery and its cards', /Section One Preload/.test(weakText) && /53% mastered/.test(weakText) &&
     await page.locator('#weak li').count() === 1 && await page.locator('#weak button', { hasText: 'Drill · 2' }).count() === 1, weakText);
  /* The drill rates a card; the review checks below expect both cards
     unreviewed, so they are put back as they were before leaving. */
  const cardsBefore = await page.evaluate(() => MemStore.all('cards'));
  /* One of the two is reviewed Easy first, so it is not due: plain review
     would offer one card, the drill must offer both. */
  await page.evaluate(() => MemStore.all('cards').then(cs => { cs[1].srs = FSRS.update(null, 4, FSRS.todayISO()); return MemStore.put('cards', cs[1]); }));
  await page.locator('#weak button').click();
  await page.locator('.card.flash').waitFor(T);
  const drillHead = await page.locator('.review-head').textContent();
  const dueNow = await page.evaluate(() => MemSession.dueCards(Memorizer.ui.cards, FSRS.todayISO()).length);
  ok('a drill opens that section\u2019s cards, due or not', dueNow === 1 && /Drill · 2 left/.test(drillHead) && /Section One Preload/.test(drillHead),
     drillHead + ' · ' + dueNow + ' due');
  await page.locator('#show-answer').click();
  await page.getByRole('button', { name: 'Again' }).click();
  await page.waitForFunction(() => /Drill · 1 left/.test((document.querySelector('.review-head') || {}).textContent || ''), null, T);
  ok('each card once: rated, it leaves the drill', await page.evaluate(() => Object.keys(Memorizer.ui.drill.done).length === 1));
  await page.evaluate(cs => Promise.all(cs.map(c => MemStore.put('cards', c))), cardsBefore);
  await page.locator('nav.top').getByRole('button', { name: 'Library' }).click();
  await page.locator('#weak').waitFor(T);
  ok('leaving ends the drill', await page.evaluate(() => Memorizer.ui.drill === null));
  const before = stub.requests.length;
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.locator('ul.bullets > li').first().waitFor(T);
  ok('continuing opens section 2 with its points, without asking the model again', stub.requests.length === before,
     `${stub.requests.length - before} new requests`);
  ok('the two cards survived the reload', (await page.evaluate(() => MemStore.all('cards'))).length === 2);

  head('review');
  await page.locator('nav.top').getByRole('button', { name: /Review/ }).click();
  await page.locator('#show-answer').waitFor(T);
  await page.locator('#show-answer').click();
  await page.getByRole('button', { name: 'Good' }).click();
  await page.waitForFunction(() => /Review · 1/.test(document.querySelector('nav.top').innerText), null, T);
  const after = await page.evaluate(() => MemStore.all('cards'));
  const todayInPage = await page.evaluate(() => FSRS.todayISO());
  ok('a Good rating schedules the card into the future with FSRS', after.filter(c => c.srs && c.srs.due > todayInPage).length === 1,
     after.map(c => c.srs ? c.srs.due : 'new').join(', '));

  head('fits a phone');
  await page.setViewportSize({ width: 375, height: 800 });
  await page.locator('nav.top').getByRole('button', { name: 'Library' }).click();
  await page.locator('li.doc').waitFor(T);
  const over = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
  ok('no horizontal scroll at 375 px', over <= 0, `${over}px over`);
  ok('and the card just reviewed Good is now counted as held', /1 of 2 review cards held/.test(await page.locator('#home-meter').getAttribute('aria-label')),
     await page.locator('#home-meter').getAttribute('aria-label'));

  head('the built-in coach: no key, no AI, nothing sent');
  {
    /* A fresh browser profile with nothing saved — what a new user gets. */
    const p2 = watch(await (await browser.newContext({ viewport: { width: 820, height: 1100 }, serviceWorkers: 'block' })).newPage(), events, 'builtin', errors);
    await wire(p2);
    const aiBefore = stub.requests.length;
    await p2.goto(URL);
    await p2.locator('.drop').waitFor(T);
    ok('a new user is on the built-in coach, with no key asked for',
       /built-in coach/.test(await p2.locator('main').innerText()) && !/needs your API key/.test(await p2.locator('main').innerText()));
    await p2.setInputFiles('#pdf-input', { name: 'unit.pdf', mimeType: 'application/pdf', buffer: pdf.buffer });
    await p2.locator('li.doc').waitFor(T);
    await p2.getByRole('button', { name: 'Start', exact: true }).click();
    await p2.locator('ul.bullets > li').first().waitFor(T);
    const pts = await p2.evaluate(() => Memorizer.ui.state.per[0].points);
    const sec1 = (await p2.evaluate(() => MemStore.all('docs').then(d => d[0].clusters[0].text)));
    ok('encode shows key points taken verbatim from section 1', pts.length >= 1 && pts.every(x => sec1.indexOf(x.text) !== -1), `${pts.length} points`);
    await p2.locator('#flow').waitFor(T);
    const flowText = (await p2.locator('#flow').innerText()).replace(/\s+/g, ' ');
    ok('section 1 shows a flowchart built from its cause-and-effect sentences', /Diuretics/.test(flowText) && /reduce/.test(flowText) && /preload/.test(flowText) &&
       /oedema/i.test(flowText), flowText.slice(0, 140));
    ok('the hook is an acrostic of big letters', (await p2.locator('#hook .acrostic li').count()) >= 2);
    /* At a desktop width the hook sits beside the points. */
    await p2.setViewportSize({ width: 1280, height: 1100 });
    await p2.waitForFunction(() => !!document.querySelector('aside.study-aside #hook'), null, T);
    const cols = await p2.evaluate(() => { const m = document.querySelector('.study-main').getBoundingClientRect(), a = document.querySelector('.study-aside').getBoundingClientRect(); return { m: m.right, a: a.left, top: Math.abs(a.top - m.top) }; });
    ok('at desktop width the hook sits in a side panel, beside the points', cols.a > cols.m && cols.top < 40, JSON.stringify(cols));
    await p2.setViewportSize({ width: 820, height: 1100 });
    await p2.waitForFunction(() => !document.querySelector('aside.study-aside') && !!document.querySelector('#hook'), null, T);
    ok('and at tablet width it moves back under the points', await p2.evaluate(() => {
      const pts = document.querySelector('#points').getBoundingClientRect(), hk = document.querySelector('#hook').getBoundingClientRect(); return hk.top > pts.bottom - 1; }));
    await p2.locator('#to-recall').click();
    await p2.locator('h2.q').waitFor(T);
    const prompts = await p2.evaluate(() => Memorizer.ui.state.per[0].prompts);
    ok('recall asks fill-in-the-blank questions', prompts.length >= 1 && prompts.every(q => /_____/.test(q.question)), `${prompts.length} questions`);
    await p2.fill('textarea.answer', prompts[0].answer);
    await p2.locator('#submit-answer').click();
    await p2.locator('.feedback.good').waitFor(T);
    ok('the right word is marked correct', await p2.locator('.feedback h2', { hasText: 'Correct' }).count() === 1);
    await p2.locator('#continue').click();
    if (prompts.length > 1) {
      await p2.locator('h2.q', { hasText: prompts[1].question.slice(0, 40) }).waitFor(T);
      await p2.fill('textarea.answer', 'zzzz');
      await p2.locator('#submit-answer').click();
      await p2.locator('.feedback.bad').waitFor(T);
      ok('the feedback shows the whole sentence, the answer filled in', /\u00AB/.test(await p2.locator('#filled').innerText()) &&
         (await p2.locator('#filled').innerText()).indexOf(prompts[1].answer) !== -1);
      await p2.locator('#overrule').click();
      await p2.locator('.feedback.good').waitFor(T);
      ok('a wrong-looking answer can be counted as correct by the student', await p2.locator('.feedback h2', { hasText: 'Correct' }).count() === 1);
      await p2.locator('#continue').click();
      await p2.waitForFunction(() => Memorizer.ui.state.per[0].recall.length === 2, null, T);
      ok('and it is recorded as correct, with no card made', await p2.evaluate(() =>
        Memorizer.ui.state.per[0].recall[1].correct === true && Memorizer.ui.state.cards.length === 0));
    }
    for (let i = Math.min(2, prompts.length); i < prompts.length; i++) {
      await p2.locator('h2.q', { hasText: prompts[i].question.slice(0, 40) }).waitFor(T);
      await p2.fill('textarea.answer', prompts[i].answer);
      await p2.locator('#submit-answer').click();
      await p2.locator('#continue').waitFor(T);
      await p2.locator('#continue').click();
    }
    await p2.locator('h2', { hasText: 'Teach it back' }).waitFor(T);
    await p2.fill('textarea.answer', pts.map(x => x.text).join(' '));
    await p2.locator('#submit-answer').click();
    await p2.locator('.feedback .score').waitFor(T);
    ok('a teach-back that covers every point scores 100', (await p2.locator('.feedback .score strong').innerText()) === '100');
    ok('and not one request went to an AI provider', stub.requests.length === aiBefore, `${stub.requests.length - aiBefore} requests`);
    await p2.locator('nav.top').getByRole('button', { name: 'Settings' }).click();
    await p2.locator('#builtin-about').waitFor(T);
    ok('Settings explains the built-in coach, and asks for no key while it is chosen',
       await p2.locator('#builtin-about').isVisible() && !(await p2.locator('#key').isVisible()));
    ok('and offers only the built-in coach and Claude', JSON.stringify(await p2.$$eval('#provider option', os => os.map(o => o.value))) === '["builtin","anthropic"]');
    await p2.selectOption('#provider', 'anthropic');
    /* Appearance: a theme and a size, applied at once and kept. */
    await p2.locator('#appearance .swatch[data-theme-id="nocturne"]').click();
    const bg = await p2.evaluate(() => getComputedStyle(document.body).backgroundColor);
    ok('picking Nocturne recolours the page with Systole\u2019s Nocturne ground', bg === 'rgb(14, 11, 26)', bg);
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
    await p2.locator('.drop').waitFor(T);
    ok('and all of it survives a reload, applied before the page draws', await p2.evaluate(() =>
      document.documentElement.getAttribute('data-look') === 'nocturne' && getComputedStyle(document.body).fontSize === '20px' &&
      document.documentElement.getAttribute('data-contrast') === 'high' && document.documentElement.getAttribute('data-bright') === 'dim' &&
      /Iowan|Charter|Georgia/.test(getComputedStyle(document.body).fontFamily)));
    await p2.locator('nav.top').getByRole('button', { name: 'Settings' }).click();
    await p2.locator('#provider').waitFor(T);
    await p2.selectOption('#provider', 'anthropic');
    ok('choosing Claude shows the key field', await p2.locator('#key').isVisible() && !(await p2.locator('#builtin-about').isVisible()));
    /* The coach's output is held to the model's schema before the session
       sees it. The real coach never trips that, so a broken one is handed
       in here: a malformed step must be an error on screen, not a session
       stepping forward on garbage. */
    await p2.evaluate(() => { window.MemCoach.encode = () => ({ points: 'not a list', mnemonic: '', flowchart: '' }); });
    const docId = await p2.evaluate(() => MemStore.all('docs').then(d => d[0].id));
    await p2.evaluate(id => Memorizer.openDoc(id), docId);
    await p2.locator('.card.error').waitFor(T);
    ok('a malformed built-in step is an error on screen, and the session does not advance',
       /malformed encode/.test(await p2.locator('.card.error').innerText()) &&
       await p2.evaluate(() => !Memorizer.ui.state.per[Memorizer.ui.state.cluster].points));

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

    /* The gauntlet, reached by storing a session that has taught every
       section — graded right, from the built-in coach's own output — so
       only the gauntlet is left. Its header must not name the section: the
       gauntlet asks definitions backwards, and the section's title is often
       the answer. It is named in the feedback, once answered. */
    const titles = await p2.evaluate(async id => {
      MemProvider.saveConfig({ provider: 'builtin' });
      const d = await MemStore.get('docs', id);
      let s = MemSession.init(d.id, d.clusters.map(c => c.title));
      d.clusters.forEach((c, i) => {
        s = MemSession.next(s, { type: 'encoded', value: { points: MemCoach.sentences(c).slice(0, 2).map(x => ({ text: x.text, page: x.page })), mnemonic: '', flowchart: '' } });
        s = MemSession.next(s, { type: 'toRecall' });
        s = MemSession.next(s, { type: 'recallPrompts', value: { prompts: [{ question: 'q', answer: 'a', page: c.pageStart }] } });
        s = MemSession.next(s, { type: 'recallGraded', value: { correct: true } });
        s = MemSession.next(s, { type: 'explainGraded', value: { score: 100, gaps: [] } });
      });
      await MemStore.put('sessions', { id: d.id, state: s });
      await Memorizer.openDoc(d.id);
      return d.clusters.map(c => c.title);
    }, docId);
    await p2.locator('.card.gauntlet h2.q').waitFor(T);
    const gHead = await p2.locator('.card.gauntlet .count').textContent();
    ok('the gauntlet’s header does not name the section it is asking about', /^Gauntlet 1 of \d+$/.test(gHead) && !titles.some(t => gHead.indexOf(t) !== -1), gHead);
    await p2.fill('textarea.answer', 'zzzz');
    await p2.locator('#submit-answer').click();
    await p2.locator('.feedback.bad').waitFor(T);
    const gq = await p2.evaluate(() => Memorizer.ui.state.gauntlet.questions[0]);
    ok('the feedback does, once it is answered', (await p2.locator('#from').innerText()).indexOf(titles[gq.cluster]) !== -1,
       await p2.locator('#from').innerText());
  }

  head('scanned pages: read by text recognition, on the device');
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
      await p.locator('.drop').waitFor(T);
      return p;
    };
    const p3 = await fresh('ocr', false);
    const jpeg = Buffer.from(await p3.evaluate(makeScanJpeg, SCAN_LINES), 'base64');
    const scanPdf = makeScanPdf(jpeg, 1224, 1584);
    await p3.setInputFiles('#pdf-input', { name: 'scan.pdf', mimeType: 'application/pdf', buffer: scanPdf });
    await p3.locator('li.doc').waitFor({ timeout: 120000 });
    const srec = await p3.evaluate(() => MemStore.all('docs').then(d => d[0]));
    const stext = srec.clusters.map(c => c.text).join(' ');
    ok('the scanned page is read by text recognition, and named as such', JSON.stringify(srec.ocr) === '[2]' && srec.scanned.length === 0,
       JSON.stringify({ ocr: srec.ocr, scanned: srec.scanned, err: srec.ocrError }));
    ok('its words reach the sections, as sentences', /Venous return is the main determinant of preload in a healthy heart, and preload rises with volume\./.test(stext), stext.slice(0, 160));
    ok('its heading is found by its size, as a real one would be', srec.clusters.some(c => c.headings.indexOf('Scanned Page Heading') !== -1),
       JSON.stringify(srec.clusters.map(c => c.headings)));
    ok('and the page with a text layer is read as before', /This first page carries real text/.test(stext));
    ok('the library says which pages were recognised', /read by text recognition: 2\./.test(await p3.locator('li.doc').innerText()));

    const p4 = await fresh('ocr-offline', true);
    await p4.setInputFiles('#pdf-input', { name: 'scan.pdf', mimeType: 'application/pdf', buffer: scanPdf });
    await p4.locator('li.doc').waitFor({ timeout: 60000 });
    const orec = await p4.evaluate(() => MemStore.all('docs').then(d => d[0]));
    ok('when the text reader cannot load, the scanned page is still named, with the reason', JSON.stringify(orec.scanned) === '[2]' && orec.ocr.length === 0 &&
       /text reader could not run/.test(await p4.locator('li.doc').innerText()), JSON.stringify({ scanned: orec.scanned, err: orec.ocrError }));
    ok('and the rest of the PDF is imported all the same', orec.clusters.some(c => /This first page carries real text/.test(c.text)));
  }

  ok('and nothing threw on the page throughout', errors.length === 0, errors.join(' | '));
  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(die);
