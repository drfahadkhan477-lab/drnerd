#!/usr/bin/env node
'use strict';
/*
 * Import the questions of two older ACC question-bank PDFs into Systole,
 * skipping any the bank already has — on the owner's laptop, printing counts.
 *
 *   node tools/older-acc-import.js [SECOND.pdf FIRST.pdf …] [--bank content/questions.json]
 *                                  [--out source/older-staging] [--threshold 0.5]
 *   node tools/older-acc-import.js --merge [build/systole.html] [--out source/older-staging]
 *   node tools/older-acc-import.js SECOND.pdf --shapes 70,134-135,226-228
 *     (also lists each annotation on those pages — a highlight, box or pen
 *     tick — by type, box and the line it covers, never its text)
 *   node tools/older-acc-import.js --probe
 *
 * With no PDFs named it reads source/older/SECOND.pdf, then source/older/FIRST.pdf
 * — SECOND first because its text layer is clean, so where the two banks
 * share a question the clean copy is the one kept.
 *
 * WHY. The owner has two older ACC question banks as PDFs (with figures) and
 * asked for their questions to be added to the app, filed under "Older ACC
 * bank", leaving out what ACCSAP 12 already asks. Those PDFs are licensed
 * exactly as the ACCSAP export is: they are not read in a Claude session and
 * no question text is quoted into one. So the parser was designed from
 * tools/pdf-shape.js's report of their layout (shapes, fonts, colours, counts),
 * the rules live in tools/older-acc.js where a suite proves them on invented
 * lines, and this prints numbers, layout names, page numbers and line shapes.
 *
 * WHAT IT DOES
 *   1. Reads each PDF with pdf.js — the version Memorizer pins, checked
 *      against the same integrity hashes (as tools/pdf-shape.js does) — page
 *      by page: its text lines with position, size, font and ink, and each
 *      figure, cut from the rendered page at the rectangle the page's own
 *      drawing operators put it in. Pages without a text layer are skipped
 *      and counted; so are images too small to be a figure and images the
 *      size of the page (a scan behind OCR text, not a figure).
 *   2. Parses questions (tools/older-acc.js): stem, options, answer, the
 *      explanation after it, the layout it was set in; maps answer-key
 *      entries ("12. a. …") back to the questions they answer; attaches each
 *      figure to the question it sits under.
 *   3. Drops a question whose stem is mostly inside ONE existing stem (word
 *      5-gram containment, the house measure from tools/refs-merge.js) — or
 *      inside one already imported from these PDFs.
 *   4. Writes the rest to --out in the bank's own shape (content/questions.json's:
 *      the same stem field, option shape and commentary format, read from the
 *      bank rather than assumed), figures as JPEG under --out/figures/, and a
 *      report.json of the counts. A question whose answer could not be found
 *      is counted and listed by page, never staged: a question with a guessed
 *      key teaches the wrong answer as fact.
 *
 * --merge puts the staged questions into a single-file build, after
 * npm run build and before scripts/extract-content.js, so both builds get
 * them (the split build's bank is extracted from the single file):
 *
 *   npm run build -- <export.html>
 *   node tools/older-acc-import.js --merge
 *   node scripts/extract-content.js build/systole.html
 *
 * It replaces whatever it merged before, so it is safe to rerun, and a rebuild
 * without it is the export alone again.
 *
 * WHY --merge AND NOT A BUILD STEP. Deliberately the lighter path, for now.
 * The staging has not been seen on a real run yet — the layouts above are
 * heuristics — and a build step would put every staged question into every
 * build before anyone has checked the counts. Once the counts are right, the
 * durable form is scripts/assemble-app.js's ALL_Q and IMGS producers calling
 * tools/older-acc.js's mergeBank() after the content flags. EITHER WAY, suites that assert the export's own
 * totals will then see more: verify-pwa's question and figure totals and
 * verify-chapters' chapter count. They are right to fail until they are
 * taught the older bank's count from the staging — not by moving a number.
 *
 * --shapes PAGES stages nothing and needs no bank: for the pages named it
 * writes one row per line (tools/older-acc.js shapeRows — gap, indent, size,
 * font, bold share, ink, background, kind, length, a six-character shape,
 * never a word) to source/older-shapes.txt, in UTF-8 whatever the shell's
 * redirection would have written. It is how a page the report lists as
 * unparsed gets a rule: the owner uploads the shapes, not the page.
 *
 * --probe stages nothing and needs no bank either: it parses both PDFs and,
 * for every question left without an answer, counts how its explanation
 * treats each option letter — called correct, called incorrect, neither —
 * with the wording around each mention as a shape (older-acc.js
 * letterStances). To source/older-probe.txt, UTF-8. It is how a rule for
 * the unanswered could be earned from the page rather than guessed.
 *
 * source/ is gitignored and scripts/leak-guard.js refuses it: nothing staged
 * here is ever committed.
 */
const fs = require('fs');
const path = require('path');
const A = require('./older-acc.js');
const { keyVsProse } = require('./key-prose.js');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i > -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const VALUED = ['--bank', '--out', '--threshold', '--merge', '--shapes'];
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
const OUT = path.resolve(opt('--out', path.join(ROOT, 'source', 'older-staging')));
const MARKER = '.older-acc-import';

if (args.includes('--merge')) { merge(); process.exit(0); }
const SHAPES = args.includes('--shapes') ? pageSet(opt('--shapes', '')) : null;
const PROBE = args.includes('--probe');
if (SHAPES && !SHAPES.size) { console.error('--shapes needs pages: --shapes 70,134-135,226'); process.exit(1); }
function pageSet(spec) {
  const out = new Set();
  for (const part of String(spec).split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!m) continue;
    for (let p = +m[1]; p <= +(m[2] || m[1]) && p - +m[1] < 1000; p++) out.add(p);
  }
  return out;
}

const THRESHOLD = +opt('--threshold', A.DUP_THRESHOLD);
const FILES = positional.length ? positional : [path.join(ROOT, 'source', 'older', 'SECOND.pdf'), path.join(ROOT, 'source', 'older', 'FIRST.pdf')];
for (const f of FILES) if (!fs.existsSync(f)) { console.error(`${f}: not found`); process.exit(1); }
if (!(THRESHOLD > 0 && THRESHOLD <= 1)) { console.error('--threshold is a fraction between 0 and 1'); process.exit(1); }

/* ── the bank as it stands ─────────────────────────────────────────────── */
function readBank() {
  const want = opt('--bank', null);
  const tries = want ? [path.resolve(want)] : [path.join(ROOT, 'content', 'questions.json'), path.join(ROOT, 'build', 'systole.html')];
  for (const p of tries) {
    if (!fs.existsSync(p)) continue;
    const raw = fs.readFileSync(p, 'utf8');
    if (/\.json$/i.test(p)) return { from: p, bank: JSON.parse(raw) };
    const m = /\nconst ALL_Q=(\[[\s\S]*?\]);\n/.exec(raw);
    if (m) return { from: p, bank: JSON.parse(m[1]) };
  }
  console.error('no existing bank to compare against — looked for ' + tries.map(p => path.relative(process.cwd(), p)).join(' and ') +
    '.\n  Run scripts/extract-content.js first, or name one with --bank. Refusing to call every question new.');
  process.exit(1);
}

/* ── in the page: pdf.js, one page at a time ───────────────────────────── */
const PDFSRC = fs.readFileSync(path.join(ROOT, 'memorizer', 'src', 'pdf.js'), 'utf8');
const BASE = /var BASE = '([^']+)'/.exec(PDFSRC)[1];
const LIB = { url: BASE + 'pdf.min.js', sri: /var LIB = \{[^}]*sri: '([^']+)'/.exec(PDFSRC)[1] };
const WORKER = { url: BASE + 'pdf.worker.min.js', sri: /var WORKER = \{[^}]*sri: '([^']+)'/.exec(PDFSRC)[1] };

async function openDoc({ lib, worker }) {
  await new Promise((ok, fail) => { const s = document.createElement('script'); s.src = lib.url; s.integrity = lib.sri;
    s.crossOrigin = 'anonymous'; s.onload = ok; s.onerror = () => fail(new Error('could not load pdf.js')); document.head.appendChild(s); });
  const w = await fetch(worker.url, { integrity: worker.sri, mode: 'cors' }).then(r => r.blob());
  pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(w);
  window.__doc = await pdfjsLib.getDocument({ url: '/doc.pdf' }).promise;
  return window.__doc.numPages;
}

/* Returns one page's lines (with text — this goes to the Node side, into
   memory and the staging file, never to the console) and its figures. */
async function readPage({ p, scale, maxW, quality, noImages }) {
  const page = await window.__doc.getPage(p);
  const view = page.view, W = view[2] - view[0], H = view[3] - view[1];
  const tc = await page.getTextContent();
  const ops = await page.getOperatorList();
  const chars = tc.items.reduce((n, it) => n + (it.str ? it.str.trim().length : 0), 0);
  /* Annotations first: an image-only page — no text layer — is exactly
     where a highlight or pen mark might be the only key there is, and the
     early return below used to skip them (found by review). Type and box
     only; their contents stay in the PDF; links are navigation. */
  /* A page whose annotations cannot be read is still a page: an error here
     must never cost its text and figures (found by review). */
  const annots = (await page.getAnnotations().catch(() => [])).filter(a => a.subtype && a.subtype !== 'Link')
    .map(a => ({ subtype: a.subtype, rect: Array.isArray(a.rect) ? a.rect.map(Number) : null })).filter(a => a.rect);
  if (chars <= 40) { page.cleanup(); return { p, noText: true, w: W, h: H, y0: view[1], annots }; }

  /* Where each image is drawn: the unit square under the transform in force
     when it is painted, tracked through save/restore/transform and form
     XObjects. Image masks and inline-image groups are glyph-like marks, not
     figures, and are left out. */
  const OPS = pdfjsLib.OPS;
  const IMG = [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintJpegXObject].filter(x => x !== undefined);
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
                         m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  let ctm = [1, 0, 0, 1, 0, 0]; const st = []; let rects = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], a = ops.argsArray[i];
    if (fn === OPS.save) st.push(ctm);
    else if (fn === OPS.restore) ctm = st.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ctm, a);
    else if (fn === OPS.paintFormXObjectBegin) { st.push(ctm); if (a && Array.isArray(a[0]) && a[0].length === 6) ctm = mul(ctm, a[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = st.pop() || [1, 0, 0, 1, 0, 0];
    else if (IMG.includes(fn)) {
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
      rects.push([Math.max(view[0], Math.min(...xs)), Math.max(view[1], Math.min(...ys)), Math.min(view[2], Math.max(...xs)), Math.min(view[3], Math.max(...ys))]);
    }
  }
  let tiny = 0, pageSized = 0;
  rects = rects.filter(r => {
    const w = r[2] - r[0], h = r[3] - r[1];
    if (w < 36 || h < 36) { tiny++; return false; }
    if (w * h >= 0.7 * W * H) { pageSized++; return false; }
    return true;
  });
  /* A figure drawn as tiles is one figure: overlapping or touching rectangles merge. */
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < rects.length && !changed; i++) for (let j = i + 1; j < rects.length && !changed; j++) {
      const r = rects[i], s = rects[j];
      if (r[0] <= s[2] + 2 && s[0] <= r[2] + 2 && r[1] <= s[3] + 2 && s[1] <= r[3] + 2) {
        rects[i] = [Math.min(r[0], s[0]), Math.min(r[1], s[1]), Math.max(r[2], s[2]), Math.max(r[3], s[3])];
        rects.splice(j, 1); changed = true;
      }
    }
  }

  const vp = page.getViewport({ scale });
  const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  const cx = cv.getContext('2d', { willReadFrequently: true });
  await page.render({ canvasContext: cx, viewport: vp }).promise;
  const box = (x0, y0, x1, y1) => {
    const r = vp.convertToViewportRectangle([x0, y0, x1, y1]);
    const X = Math.max(0, Math.floor(Math.min(r[0], r[2]))), Y = Math.max(0, Math.floor(Math.min(r[1], r[3])));
    return [X, Y, Math.min(cv.width - X, Math.ceil(Math.abs(r[2] - r[0]))), Math.min(cv.height - Y, Math.ceil(Math.abs(r[3] - r[1])))];
  };
  /* tools/pdf-shape.js's ink: the darkest 30% of a line's ink pixels, rounded to 32 steps. */
  const ink = (x0, y0, x1, y1) => {
    const [X, Y, Wd, Ht] = box(x0, y0, x1, y1);
    if (Wd < 1 || Ht < 1) return '?';
    const d = cx.getImageData(X, Y, Wd, Ht).data, px = [];
    for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) <= 200) px.push([d[i], d[i + 1], d[i + 2]]);
    if (!px.length) return 'none';
    px.sort((u, v) => (u[0] + u[1] + u[2]) - (v[0] + v[1] + v[2]));
    const core = px.slice(0, Math.max(1, Math.ceil(px.length * 0.3)));
    return 'rgb~' + [0, 1, 2].map(c => Math.round(core.reduce((n, q) => n + q[c], 0) / core.length / 32) * 32).join(',');
  };
  /* The line's background: its commonest colour, in the same 32 steps. An
     answer shaded behind its option shows here and nowhere in the text. */
  const bgOf = (x0, y0, x1, y1) => {
    const [X, Y, Wd, Ht] = box(x0, y0, x1, y1);
    if (Wd < 1 || Ht < 1) return '?';
    const d = cx.getImageData(X, Y, Wd, Ht).data, n = {};
    for (let i = 0; i < d.length; i += 4) { const k = [d[i], d[i + 1], d[i + 2]].map(c => Math.round(c / 32) * 32).join(','); n[k] = (n[k] || 0) + 1; }
    return 'rgb~' + Object.keys(n).sort((a, b) => n[b] - n[a])[0];
  };

  const isBold = f => /bold|black|heavy|semibold|demi/i.test(f) || /,B/.test(f);
  const fontOf = id => {
    try { const fo = page.commonObjs.get(id); return String((fo && (fo.name || fo.loadedName)) || id).replace(/^[A-Z]{6}\+/, ''); }
    catch (_) { return String(id); }
  };
  const raw = [];
  for (const it of tc.items) {
    if (!it.str) continue;
    const size = Math.round(Math.abs(it.transform[3] || it.transform[0]) * 2) / 2 || 10;
    const y = it.transform[5], x = it.transform[4];
    let line = raw.find(l => Math.abs(l.y - y) <= Math.max(2, Math.min(l.size, size) * 0.3));
    if (!line) { line = { y, size, parts: [] }; raw.push(line); }
    line.parts.push({ x, w: it.width || 0, s: it.str, font: it.fontName, size });
    line.size = Math.max(line.size, size);
  }
  const lines = [];
  for (const l of raw) {
    l.parts.sort((a, b) => a.x - b.x);
    let text = '', end = -Infinity;
    for (const q of l.parts) {
      const gap = q.x - end;
      if (text && gap > q.size * 2) text += '   ';
      else if (text && gap > q.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(q.s)) text += ' ';
      text += q.s; end = Math.max(end, q.x + q.w);
    }
    text = text.replace(/[ \t]{4,}/g, '   ').replace(/(\S) {1,2}(?=\S)/g, '$1 ').trim();
    if (!text) continue;
    const firstFont = l.parts.find(q => q.s.trim()) || l.parts[0];
    const font = fontOf(firstFont.font);
    const x0 = l.parts[0].x, x1 = Math.max(...l.parts.map(q => q.x + q.w));
    /* bf: the share of the line's characters set in a bold face — an option
       emphasised as the answer shows up here, the letter alone does not. */
    let boldChars = 0, allChars = 0;
    for (const q of l.parts) { const n = q.s.replace(/\s/g, '').length; allChars += n; if (isBold(fontOf(q.font))) boldChars += n; }
    lines.push({ y: l.y, x0, x1, size: l.size, font, bold: isBold(font), bf: allChars ? Math.round(boldChars / allChars * 100) / 100 : 0,
                 ink: ink(x0, l.y - l.size * 0.2, x1, l.y + l.size * 0.8), bg: bgOf(x0, l.y - l.size * 0.3, x1, l.y + l.size), text });
  }
  lines.sort((a, b) => b.y - a.y || a.x0 - b.x0);

  const images = [];
  for (const r of noImages ? [] : rects) {
    const [X, Y, Wd, Ht] = box(r[0], r[1], r[2], r[3]);
    if (Wd < 8 || Ht < 8) continue;
    const k = Math.min(1, maxW / Wd);
    const out = document.createElement('canvas'); out.width = Math.round(Wd * k); out.height = Math.round(Ht * k);
    out.getContext('2d').drawImage(cv, X, Y, Wd, Ht, 0, 0, out.width, out.height);
    images.push({ top: r[3], bottom: r[1], jpg: out.toDataURL('image/jpeg', quality).split(',')[1] });
  }
  page.cleanup();
  return { p, w: W, h: H, y0: view[1], lines, images, tiny, pageSized, annots };
}

async function readPdf(browser, file) {
  const bytes = fs.readFileSync(file);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route('http://older.acc/**', r => r.request().url().endsWith('/doc.pdf')
    ? r.fulfill({ status: 200, body: bytes, headers: { 'content-type': 'application/pdf' } })
    : r.fulfill({ status: 200, body: '<!doctype html><title>import</title>', headers: { 'content-type': 'text/html' } }));
  /* jsDelivr fetched from the Node side, as tools/pdf-shape.js does; the page
     still checks every byte against the pinned integrity hashes. */
  await page.route('https://cdn.jsdelivr.net/**', async r => {
    const res = await fetch(r.request().url());
    r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()),
      headers: { 'content-type': res.headers.get('content-type') || 'application/javascript', 'access-control-allow-origin': '*' } });
  });
  await page.goto('http://older.acc/');
  const n = await page.evaluate(openDoc, { lib: LIB, worker: WORKER });
  const pages = [];
  for (let p = 1; p <= n; p++) {
    try { pages.push(await page.evaluate(readPage, { p, scale: 2, maxW: 1400, quality: 0.85, noImages: !!SHAPES || PROBE })); }
    catch (e) { pages.push({ p, noText: true, failed: true, w: 1, h: 1, y0: 0 }); }
    if (p % 50 === 0 || p === n) process.stderr.write(`  ${path.basename(file)}  page ${p}/${n}\r`);
  }
  process.stderr.write('\n');
  await ctx.close();
  return pages;
}

/* ── the command ───────────────────────────────────────────────────────── */
(async () => {
  if (SHAPES) return shapes();
  if (PROBE) return probe();
  const { from: bankFrom, bank } = readBank();
  const shape = A.inferShape(bank);
  const { key, stems } = A.bankStems(bank);
  console.log(`bank: ${stems.length} questions in ${path.relative(process.cwd(), bankFrom)}  (stem field "${key}", options as ${shape.optObjects ? 'objects {' + shape.optKeys.join(',') + '}' : 'strings'}, commentary as ${shape.exHtml ? 'HTML' : 'plain text'})`);

  const { launch } = require('../tests/_engine.js');
  const browser = await launch();
  const tallies = [], candidates = [];
  for (const f of FILES) {
    const name = path.basename(f);
    const pages = await readPdf(browser, f);
    const parsed = A.parseDocument(pages);
    const images = [];
    let tiny = 0, pageSized = 0;
    for (const pg of pages) {
      tiny += pg.tiny || 0; pageSized += pg.pageSized || 0;
      for (const im of (pg.images || [])) images.push({ page: pg.p, top: im.top, jpg: im.jpg });
    }
    const { unassigned } = A.attachImages(parsed.questions, images);
    const t = A.tallyFile(name, parsed);
    t.tiny = tiny; t.pageSized = pageSized; t.unassigned = unassigned; t.failedPages = pages.filter(pg => pg.failed).map(pg => pg.p);
    t.figures = parsed.questions.reduce((n, q) => n + q.images.length, 0);
    tallies.push(t);
    for (const q of parsed.questions) candidates.push({ ...q, file: name.replace(/\.pdf$/i, '') });
  }
  await browser.close();

  const answered = candidates.filter(q => q.ci >= 0);
  const d = A.dedupe(answered, stems, { threshold: THRESHOLD });

  /* Staging: this tool's folder, replaced whole, and only if it is this tool's. */
  if (fs.existsSync(OUT) && fs.readdirSync(OUT).length && !fs.existsSync(path.join(OUT, MARKER))) {
    console.error(`${OUT} exists and was not made by this tool — name another with --out`); process.exit(1);
  }
  if (/^content([\\/]|$)/.test(path.relative(ROOT, OUT))) { console.error('--out must not be under content/'); process.exit(1); }
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'figures'), { recursive: true });
  fs.writeFileSync(path.join(OUT, MARKER), 'written by tools/older-acc-import.js\n');
  const staged = [], proseDisagrees = [];
  let figures = 0;
  for (const q of d.kept) {
    const id = A.idFor(q.stem);
    const names = q.images.map((im, i) => `${id}_${i + 1}.jpg`);
    const bq = A.toBankQuestion(q, shape, { from: `${q.file} p${q.page}`, figs: names });
    /* Its key against its own commentary — the check tests/verify-keys.js
       runs on the built bank, from the same module. Two records of the answer
       that disagree cannot be settled here, so the question is not staged. */
    if (keyVsProse(bq).disagrees) { proseDisagrees.push(`${q.file.replace(/\.pdf$/i, '')} p${q.page}`); continue; }
    q.images.forEach((im, i) => fs.writeFileSync(path.join(OUT, 'figures', names[i]), Buffer.from(im.jpg, 'base64')));
    figures += names.length;
    staged.push(bq);
  }
  if (new Set(staged.map(q => q.id)).size !== staged.length) { console.error('two staged questions share an id — nothing usable was written'); process.exit(1); }
  fs.writeFileSync(path.join(OUT, 'questions.json'), JSON.stringify(staged));

  const totals = { parsed: candidates.length, noAnswer: candidates.length - answered.length, dupBank: d.dupBank, dupSelf: d.dupSelf,
    added: staged.length, proseDisagrees, figures, hist: d.hist, threshold: THRESHOLD, bankStems: stems.length, stemKey: key };
  const report = { files: tallies, totals };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(A.formatReport(tallies, totals));
  for (const t of tallies) if (t.failedPages.length) console.log(`  ${t.name}: pdf.js could not read pages ${A.ranges(t.failedPages)}`);
  const unfilled = shape.commonKeys.filter(k => !(k in (staged[0] || {})) && !['figs'].includes(k));
  if (staged.length && unfilled.length) console.log(`  bank fields the import does not fill: ${unfilled.join(', ')}`);
  const underSource = /^source([\\/]|$)/.test(path.relative(ROOT, OUT));
  console.log(`\nstaged in ${path.relative(process.cwd(), OUT)}${underSource ? ' (source/ is gitignored)' : ''}.  To put them in a build:`);
  console.log('  npm run build  then  node tools/older-acc-import.js --merge  then  node scripts/extract-content.js build/systole.html');
})().catch(e => { console.error(String(e && e.message || e).split('\n')[0]); process.exit(1); });

/* ── --shapes ─────────────────────────────────────────────────────────── */
async function shapes() {
  const { launch } = require('../tests/_engine.js');
  const browser = await launch();
  const rows = [];
  for (const f of FILES) {
    const pages = await readPdf(browser, f);
    const got = A.shapeRows(pages, SHAPES);
    const bare = pages.filter(pg => SHAPES.has(pg.p) && pg.noText).map(pg => pg.p);
    rows.push(`${path.basename(f)}  pages ${A.ranges([...SHAPES])}  rows ${got.length}` + (bare.length ? `  no text layer: ${A.ranges(bare)}` : ''));
    rows.push(...got, '');
  }
  await browser.close();
  const file = path.join(ROOT, 'source', 'older-shapes.txt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.join('\n'), 'utf8');
  console.log(rows.filter(r => /^\S+\.pdf /i.test(r)).join('\n'));
  console.log(`shapes written to ${path.relative(process.cwd(), file)} (source/ is gitignored) — upload that file`);
}

/* ── --probe ──────────────────────────────────────────────────────────── */
async function probe() {
  const { launch } = require('../tests/_engine.js');
  const browser = await launch();
  const rows = [];
  for (const f of FILES) {
    const parsed = A.parseDocument(await readPdf(browser, f));
    rows.push(...A.probeReport(path.basename(f), parsed.questions), '');
  }
  await browser.close();
  const file = path.join(ROOT, 'source', 'older-probe.txt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.join('\n'), 'utf8');
  console.log(rows.join('\n'));
  console.log(`probe written to ${path.relative(process.cwd(), file)} (source/ is gitignored) — upload that file`);
}

/* ── --merge ───────────────────────────────────────────────────────────── */
function merge() {
  const target = path.resolve(opt('--merge', path.join(ROOT, 'build', 'systole.html')));
  const qFile = path.join(OUT, 'questions.json');
  /* Read, not checked-then-read: a missing file is reported from the read
     itself, so nothing can change between a check and the use it guards. */
  const readOr = (f, why) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { if (e.code === 'ENOENT') { console.error(`${f}: ${why}`); process.exit(1); } throw e; } };
  let html = readOr(target, 'no build there — run npm run build first');
  const staged = JSON.parse(readOr(qFile, 'nothing staged — run the import first'));
  const figData = {};
  for (const q of staged) figData[q.id] = (q.figs || []).map(n => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(OUT, 'figures', n)).toString('base64'));
  const QRE = /\nconst ALL_Q=(\[[\s\S]*?\]);\n/, IRE = /\nconst IMGS=(\{[\s\S]*?\});\n/;
  const qm = QRE.exec(html), im = IRE.exec(html);
  if (!qm || !im) { console.error('could not find "const ALL_Q=" and "const IMGS=" in the build — is it a single-file build from npm run build (scripts/assemble-app.js)?'); process.exit(1); }
  const r = A.mergeBank(JSON.parse(qm[1]), JSON.parse(im[1]), staged, figData);
  html = html.replace(QRE, () => '\nconst ALL_Q=' + JSON.stringify(r.bank) + ';\n');
  html = html.replace(IRE, () => '\nconst IMGS=' + JSON.stringify(r.imgs) + ';\n');
  /* Written beside the build and renamed over it: a merge that fails part
     way leaves the build as it was, never half-written. */
  const tmp = target + '.merge-' + process.pid;
  fs.writeFileSync(tmp, html);
  fs.renameSync(tmp, target);
  console.log(`merged into ${path.relative(process.cwd(), target)}: ${r.added} questions under "${A.CATEGORY}" with ${r.figures} figures` +
              (r.removed ? `, replacing the ${r.removed} merged before` : '') + `; the bank is now ${r.bank.length}`);
  console.log('next: node scripts/extract-content.js build/systole.html');
}
