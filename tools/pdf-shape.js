#!/usr/bin/env node
'use strict';
/*
 * The shape of a question-bank PDF, without a word of it.
 *
 *   node tools/pdf-shape.js source/older/ACCSAP_old_part1.pdf [more.pdf …] [--pages 4]
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
const SKELETON_PAGES = pi > -1 ? Math.max(1, +args[pi + 1] || 4) : 4;
const files = args.filter((a, i) => !a.startsWith('--') && !(pi > -1 && i === pi + 1));
if (!files.length) { console.error('usage: node tools/pdf-shape.js <file.pdf> [more.pdf …] [--pages N]'); process.exit(1); }

const PDFSRC = fs.readFileSync(path.join(__dirname, '..', 'memorizer', 'src', 'pdf.js'), 'utf8');
const BASE = /var BASE = '([^']+)'/.exec(PDFSRC)[1];
const LIB = { url: BASE + 'pdf.min.js', sri: /var LIB = \{[^}]*sri: '([^']+)'/.exec(PDFSRC)[1] };
const WORKER = { url: BASE + 'pdf.worker.min.js', sri: /var WORKER = \{[^}]*sri: '([^']+)'/.exec(PDFSRC)[1] };

/* Runs in the page. Returns numbers and kind labels only. */
async function shape({ lib, worker, pages: skeletonPages }) {
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
  const counts = {}, sizes = {}, perPage = [], skeleton = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const ops = await page.getOperatorList();
    const imgs = ops.fnArray.filter(f => IMG.includes(f)).length;
    const lines = [];
    for (const it of tc.items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]), x = it.transform[4], size = Math.round(Math.abs(it.transform[3]) * 2) / 2;
      let line = lines.find(l => Math.abs(l.y - y) <= 2);
      if (!line) { line = { y, parts: [], size }; lines.push(line); }
      line.parts.push({ x, s: it.str }); line.size = Math.max(line.size, size);
    }
    lines.sort((a, b) => b.y - a.y);
    let chars = 0; const kinds = [];
    for (const l of lines) {
      const text = l.parts.sort((a, b) => a.x - b.x).map(q => q.s).join(' ');
      const k = kindOf(text); if (!k) continue;
      chars += text.length; counts[k] = (counts[k] || 0) + 1;
      (sizes[k] = sizes[k] || {})[l.size] = (sizes[k][l.size] || 0) + 1;
      kinds.push({ k, n: text.length });
    }
    perPage.push({ chars, imgs, lines: kinds.length });
    if (p <= skeletonPages) {
      const runs = [];
      for (const { k, n } of kinds) {
        const last = runs[runs.length - 1];
        if (last && last.k === k && (k === 'TEXT' || k === 'OPT')) { last.c++; last.n += n; } else runs.push({ k, c: 1, n });
      }
      skeleton.push(`p${p}: ` + runs.map(r => r.k + (r.c > 1 ? '×' + r.c : '') + `(${r.n}ch)`).join(' ') + (imgs ? `  [IMG×${imgs}]` : ''));
    }
  }
  return { pages: doc.numPages, counts, sizes, perPage, skeleton };
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
    try { s = await page.evaluate(shape, { lib: LIB, worker: WORKER, pages: SKELETON_PAGES }); }
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
    console.log(`  skeleton of the first ${s.skeleton.length} pages:`);
    for (const line of s.skeleton) console.log('    ' + line);
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
