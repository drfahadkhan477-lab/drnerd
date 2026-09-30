#!/usr/bin/env node
'use strict';
/*
 * The shape of a question-bank PDF, without a word of it.
 *
 *   node tools/pdf-shape.js source/older/ACCSAP_old_part1.pdf [more.pdf …] [--pages 4] [--detail]
 *
 * WHY. Importing an older ACC question bank means parsing its layout — where
 * a stem starts, how options are lettered, where the answer and the
 * explanation sit, where the figures are. Those PDFs are licensed exactly as
 * the ACCSAP 12 export is: they are not read in a Claude session, and no
 * question text may be quoted into one. So the parser has to be designed from
 * the layout alone, and this is what reports it, on the owner's laptop.
 *
 * WHAT IT PRINTS, per PDF:
 *   · pages, and how many carry a text layer (a scanned page has none and
 *     would need recognition), characters per page, images per page;
 *   · how many lines of each KIND: NUM (starts like "12." or "Question 12"),
 *     OPT (starts like "A." or "(B)"), KW:<heading> for lines that open with
 *     one of a fixed list of generic headings (Answer, Explanation, …), and
 *     TEXT for everything else — with the font sizes each kind is set in;
 *   · a skeleton of the first pages: runs of kinds with character counts,
 *     e.g. NUM(180ch) OPT×5 KW:answer TEXT×12(2100ch) [IMG×1].
 *
 * --detail adds, still without words:
 *   · how lines START, as shapes: every letter becomes A or a, every digit 9,
 *     punctuation and spacing kept — "A.␣Aaa" or "(A)␣Aa" or "9.␣Aaa" — so an
 *     option format the patterns above missed shows itself. Four characters,
 *     and a lone letter or digit is not content;
 *   · the fonts each kind of line is set in, by the font's own name with its
 *     subset prefix removed (e.g. Arial-BoldMT) — bold or italic marking an
 *     answer shows up here;
 *   · the colour each line is inked in, sampled from the rendered page, per
 *     kind — a coloured correct answer shows up here;
 *   · the skeleton with each line's start-shape and font, for the first pages.
 *
 * WHAT IT NEVER PRINTS: any of the PDF's text. The kinds come from fixed
 * patterns and a fixed list of headings defined here; lengths are numbers.
 *
 * pdf.js is the version Memorizer pins (memorizer/src/pdf.js), checked
 * against the same integrity hashes, run in the browser the test suites use.
 */
const fs = require('fs');
const path = require('path');
const { launch } = require('../tests/_engine.js');

const args = process.argv.slice(2);
const pi = args.indexOf('--pages');
const DETAIL = args.includes('--detail');
const SKELETON_PAGES = pi > -1 ? Math.max(1, +args[pi + 1] || 4) : 4;
const files = args.filter((a, i) => !a.startsWith('--') && !(pi > -1 && i === pi + 1));
if (!files.length) { console.error('usage: node tools/pdf-shape.js <file.pdf> [more.pdf …] [--pages N]'); process.exit(1); }

const PDFSRC = fs.readFileSync(path.join(__dirname, '..', 'memorizer', 'src', 'pdf.js'), 'utf8');
const BASE = /var BASE = '([^']+)'/.exec(PDFSRC)[1];
const LIB = { url: BASE + 'pdf.min.js', sri: /var LIB = \{[^}]*sri: '([^']+)'/.exec(PDFSRC)[1] };
const WORKER = { url: BASE + 'pdf.worker.min.js', sri: /var WORKER = \{[^}]*sri: '([^']+)'/.exec(PDFSRC)[1] };

/* Runs in the page. Returns numbers and kind labels only. */
async function shape({ lib, worker, pages: skeletonPages, detail }) {
  await new Promise((ok, fail) => { const s = document.createElement('script'); s.src = lib.url; s.integrity = lib.sri;
    s.crossOrigin = 'anonymous'; s.onload = ok; s.onerror = () => fail(new Error('could not load pdf.js')); document.head.appendChild(s); });
  const w = await fetch(worker.url, { integrity: worker.sri, mode: 'cors' }).then(r => r.blob());
  pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(w);
  const doc = await pdfjsLib.getDocument({ url: '/doc.pdf' }).promise;
  const KW = ['correct answer', 'your answer', 'answer', 'explanation', 'rationale', 'discussion', 'references', 'reference',
              'learning objective', 'educational objective', 'key point', 'take home', 'question', 'figure', 'table', 'video', 'image'];
  const kindOf = t => {
    const s = t.trim();
    if (!s) return null;
    if (/^(question\s*)?\d{1,4}\s*[.):]/i.test(s)) return 'NUM';
    if (/^\(?[A-Ha-h][.)](\s|$)/.test(s)) return 'OPT';
    const low = s.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ');
    for (const k of KW) if (low.startsWith(k + ' ') || low === k) return 'KW:' + k.replace(/ /g, '_');
    return 'TEXT';
  };
  const OPS = pdfjsLib.OPS, IMG = [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintJpegXObject, OPS.paintImageXObjectRepeat].filter(x => x !== undefined);
  const counts = {}, sizes = {}, perPage = [], skeleton = [], starts = {}, fonts = {}, colours = {};
  /* Letters to A/a, digits to 9, spacing to ␣; punctuation kept. Four characters. */
  const shapeOf = t => t.trim().slice(0, 4).replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a').replace(/[0-9]/g, '9')
    .replace(/[^\x20-\x7e]/g, '·').replace(/ /g, '␣');
  const tally = (o, k, v) => { (o[k] = o[k] || {})[v] = (o[k][v] || 0) + 1; };
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const ops = await page.getOperatorList();
    /* The colour text is drawn in, read from the page as rendered: each line's
       box is sampled and its most common ink colour kept. Matching pdf.js's
       text items to its drawing operators by order was tried first and
       mismatched on a two-colour test page; pixels cannot. */
    let ink = null;
    if (detail) {
      const vp = page.getViewport({ scale: 1.5 });
      const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      const cx = cv.getContext('2d', { willReadFrequently: true });
      await page.render({ canvasContext: cx, viewport: vp }).promise;
      ink = (x0, y0, x1, y1) => {
        const [ax, ay] = vp.convertToViewportPoint(x0, y1), [bx, by] = vp.convertToViewportPoint(x1, y0);
        const X = Math.max(0, Math.floor(Math.min(ax, bx))), Y = Math.max(0, Math.floor(Math.min(ay, by)));
        const W = Math.min(cv.width - X, Math.ceil(Math.abs(bx - ax))), H = Math.min(cv.height - Y, Math.ceil(Math.abs(by - ay)));
        if (W < 1 || H < 1) return '?';
        /* The core of the strokes, not their anti-aliased fringe: the darkest
           30% of the line's ink pixels, averaged, then rounded to 32 steps. */
        const d = cx.getImageData(X, Y, W, H).data, px = [];
        for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) <= 200) px.push([d[i], d[i + 1], d[i + 2]]);
        if (!px.length) return 'none';
        px.sort((p, q) => (p[0] + p[1] + p[2]) - (q[0] + q[1] + q[2]));
        const core = px.slice(0, Math.max(1, Math.ceil(px.length * 0.3)));
        return 'rgb~' + [0, 1, 2].map(c => Math.round(core.reduce((n, p) => n + p[c], 0) / core.length / 32) * 32).join(',');
      };
    }
    const imgs = ops.fnArray.filter(f => IMG.includes(f)).length;
    const lines = [];
    for (const it of tc.items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]), x = it.transform[4], size = Math.round(Math.abs(it.transform[3]) * 2) / 2;
      let line = lines.find(l => Math.abs(l.y - y) <= 2);
      if (!line) { line = { y, parts: [], size, font: it.fontName }; lines.push(line); }
      line.parts.push({ x, s: it.str, font: it.fontName, w: it.width || 0 }); line.size = Math.max(line.size, size);
    }
    lines.sort((a, b) => b.y - a.y);
    let chars = 0; const kinds = [];
    for (const l of lines) {
      const text = l.parts.sort((a, b) => a.x - b.x).map(q => q.s).join(' ');
      const k = kindOf(text); if (!k) continue;
      chars += text.length; counts[k] = (counts[k] || 0) + 1;
      let fontName = '';
      if (detail) {
        const first = l.parts[0];
        try { const fo = page.commonObjs.get(first.font); fontName = String((fo && (fo.name || fo.loadedName)) || first.font).replace(/^[A-Z]{6}\+/, ''); }
        catch (_) { fontName = first.font; }
        const x0 = Math.min(...l.parts.map(q => q.x)), x1 = Math.max(...l.parts.map(q => q.x + q.w));
        l.ink = ink ? ink(x0, l.y - l.size * 0.2, x1, l.y + l.size * 0.8) : '?';
        tally(starts, k, shapeOf(text)); tally(fonts, k, fontName); tally(colours, k, l.ink);
      }
      (sizes[k] = sizes[k] || {})[l.size] = (sizes[k][l.size] || 0) + 1;
      kinds.push({ k, n: text.length, sh: detail ? shapeOf(text) : '', fo: fontName, ink: l.ink || '' });
    }
    perPage.push({ chars, imgs, lines: kinds.length });
    if (p <= skeletonPages) {
      const runs = [];
      for (const { k, n, sh, fo, ink: col } of kinds) {
        const last = runs[runs.length - 1];
        if (!detail && last && last.k === k && (k === 'TEXT' || k === 'OPT')) { last.c++; last.n += n; }
        else runs.push({ k, c: 1, n, sh, fo, col });
      }
      /* In detail each line is its own entry, with its start-shape and font,
         one per row so a page reads top to bottom. */
      skeleton.push(detail
        ? `p${p}:` + (imgs ? `  [IMG×${imgs}]` : '') + '\n' + runs.map(r => `      ${r.k.padEnd(18)} ${String(r.n).padStart(4)}ch  ${r.sh.padEnd(5)} ${(r.col || '').padEnd(14)} ${r.fo}`).join('\n')
        : `p${p}: ` + runs.map(r => r.k + (r.c > 1 ? '×' + r.c : '') + `(${r.n}ch)`).join(' ') + (imgs ? `  [IMG×${imgs}]` : ''));
    }
  }
  return { pages: doc.numPages, counts, sizes, perPage, skeleton, starts, fonts, colours };
}

(async () => {
  const browser = await launch();
  for (const f of files) {
    const bytes = fs.readFileSync(f);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.route('http://pdf.shape/**', r => r.request().url().endsWith('/doc.pdf')
      ? r.fulfill({ status: 200, body: bytes, headers: { 'content-type': 'application/pdf' } })
      : r.fulfill({ status: 200, body: '<!doctype html><title>shape</title>', headers: { 'content-type': 'text/html' } }));
    /* jsDelivr fetched from the Node side, as verify-memorizer does: a sandboxed
       browser may not trust a TLS-intercepting proxy that Node does. The page
       still checks every byte against the pinned integrity hashes. */
    await page.route('https://cdn.jsdelivr.net/**', async r => {
      const res = await fetch(r.request().url());
      r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()),
        headers: { 'content-type': res.headers.get('content-type') || 'application/javascript', 'access-control-allow-origin': '*' } });
    });
    await page.goto('http://pdf.shape/');
    let s;
    try { s = await page.evaluate(shape, { lib: LIB, worker: WORKER, pages: SKELETON_PAGES, detail: DETAIL }); }
    catch (e) { console.log(`\n${path.basename(f)}: could not be read — ${e.message.split('\n')[0]}`); await ctx.close(); continue; }
    const withText = s.perPage.filter(p => p.chars > 40).length;
    const imgPages = s.perPage.filter(p => p.imgs > 0).length;
    const med = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
    console.log(`\n${path.basename(f)}  (${(bytes.length / 1e6).toFixed(1)} MB)`);
    console.log(`  pages ${s.pages}   with a text layer ${withText}   with images ${imgPages} (${s.perPage.reduce((n, p) => n + p.imgs, 0)} images)`);
    console.log(`  characters per page, median ${med(s.perPage.map(p => p.chars))}   lines per page, median ${med(s.perPage.map(p => p.lines))}`);
    console.log('  lines by kind (font sizes in brackets):');
    for (const [k, n] of Object.entries(s.counts).sort((a, b) => b[1] - a[1])) {
      const sz = Object.entries(s.sizes[k]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([z, c]) => `${z}pt×${c}`).join(' ');
      console.log(`    ${k.padEnd(28)} ${String(n).padStart(6)}   [${sz}]`);
    }
    if (DETAIL) {
      const top = (o, n) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([v, c]) => `${v}×${c}`).join('  ');
      for (const k of Object.keys(s.counts).sort((a, b) => s.counts[b] - s.counts[a])) {
        console.log(`  ${k}`);
        console.log(`      starts   ${top(s.starts[k], 10)}`);
        console.log(`      fonts    ${top(s.fonts[k], 6)}`);
        console.log(`      colours  ${top(s.colours[k], 6)}`);
      }
    }
    console.log(`  skeleton of the first ${s.skeleton.length} pages:`);
    for (const line of s.skeleton) console.log('    ' + line);
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
