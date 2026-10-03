#!/usr/bin/env node
/*
 * Prepare for offline, in a real browser with the app's own service worker.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-memorizer-offline.js
 *
 * Builds memorizer/ with scripts/build-memorizer.js and serves it over HTTP
 * from this process, because a service worker never runs on file://.
 *
 * NEEDS THE NETWORK, like verify-memorizer: the pinned readers (pdf.js,
 * Tesseract and its English data, Mermaid) are fetched from jsDelivr by this
 * suite and handed to the browser, which checks them against the app's
 * integrity hashes as it would in use.
 *
 * WHAT IS PROVEN:
 *   · opened as a file, the card says why it cannot help, and keeps nothing;
 *   · from a web address, before preparing, nothing is called ready;
 *   · Prepare fetches every pinned file, and a group is ready only when all
 *     of its files are in the cache;
 *   · with the network cut, every one of those files is still served.
 */
'use strict';
/* The service worker's own fetches are what fill the cache, and Playwright
   routes them (so the suite can hand over jsDelivr's bytes) only with this
   set before the browser starts. Without it they go to the network, which
   the sandboxed browser cannot reach, and every group reads "0 of n". */
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
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
onDeath(() => ({ section, checks: passed + failed, errors, events }));

const ROOT = path.join(__dirname, '..');
const { build } = require(path.join(ROOT, 'scripts', 'build-memorizer.js'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memorizer-offline-'));
  build(dir);
  const server = http.createServer((q, r) => {
    const name = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(dir, path.normalize(name));
    if (!file.startsWith(dir)) { r.statusCode = 403; return r.end(); }
    fs.readFile(file, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream'); r.end(b); });
  });
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  const HTTP = 'http://127.0.0.1:' + server.address().port + '/';
  const T = { timeout: 60000 };
  const browser = await launch();
  const bytes = new Map();
  const cdn = async route => {
    const url = route.request().url();
    if (!bytes.has(url)) { const res = await fetch(url); bytes.set(url, { status: res.status, type: res.headers.get('content-type'), body: Buffer.from(await res.arrayBuffer()) }); }
    const b = bytes.get(url);
    return route.fulfill({ status: b.status, body: b.body, headers: { 'content-type': b.type || 'application/octet-stream', 'access-control-allow-origin': '*' } });
  };
  const toSettings = async p => {
    await p.waitForSelector('#chip-import-study', T);
    await p.evaluate(() => { const b = [...document.querySelectorAll('nav button, .nav-btn')].find(x => /Settings/.test(x.textContent)); b.click(); });
    await p.waitForSelector('#offline-card', T);
  };
  try {
    head('opened as a file');
    let ctx = await browser.newContext({ serviceWorkers: 'block' });
    let p = watch(await ctx.newPage(), events, 'file', errors);
    await p.goto('file://' + path.join(dir, 'index.html'));
    await toSettings(p);
    await p.click('#prep-offline');
    await p.waitForSelector('#offline-status', T);
    ok('it says it needs the web address, and why', /web address/.test(await p.$eval('#offline-status', e => e.textContent)) && /nothing can be kept/.test(await p.$eval('#offline-status', e => e.textContent)));
    await ctx.close();

    head('from a web address, with the service worker');
    ctx = await browser.newContext({ serviceWorkers: 'allow' });
    await ctx.route('https://cdn.jsdelivr.net/**', cdn);
    await ctx.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    p = watch(await ctx.newPage(), events, 'http', errors);
    await p.goto(HTTP);
    await p.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await p.reload();
    await p.waitForFunction(() => !!navigator.serviceWorker.controller, null, T);
    await toSettings(p);
    await p.waitForSelector('#offline-status li', T);
    const before = await p.$$eval('#offline-status li', li => li.map(x => [x.dataset.ready, x.textContent]));
    ok('before preparing, no group is called ready', before.length === 3 && before.every(x => x[0] === 'false'), JSON.stringify(before));
    await p.click('#prep-offline');
    await p.waitForFunction(() => { const li = [...document.querySelectorAll('#offline-status li')]; return li.length === 3 && !document.querySelector('#prep-offline[disabled]'); }, null, { timeout: 180000 });
    const after = await p.$$eval('#offline-status li', li => li.map(x => [x.dataset.ready, x.textContent]));
    ok('after preparing, all three are ready offline', after.every(x => x[0] === 'true' && /ready offline/.test(x[1])), JSON.stringify(after));
    const urls = await p.evaluate(() => [MemPdf.LIB, MemPdf.WORKER, MemOcr.TESS.lib, MemOcr.TESS.worker, MemOcr.TESS.coreSimd, MemOcr.TESS.core, MemOcr.TESS.eng].map(f => f.url));
    const kept = await p.evaluate(us => Promise.all(us.map(u => caches.match(u).then(r => !!r))), urls);
    ok('every pinned reader file is in the cache', kept.every(Boolean), JSON.stringify(urls.filter((_, i) => !kept[i])));

    head('with the network cut');
    /* The network is cut by setOffline alone. A route that aborts would be
       consulted before the service worker on WebKit, refusing what the
       worker serves from its cache, so it would measure Playwright rather
       than the app. Proven cut by a file that was never kept. */
    await ctx.unroute('https://cdn.jsdelivr.net/**');
    await ctx.setOffline(true);
    const never = await p.evaluate(() => fetch('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/package.json', { mode: 'cors' }).then(r => r.ok, () => false));
    ok('the network really is cut: a file never kept is not served', never === false);
    const served = await p.evaluate(us => Promise.all(us.map(u => fetch(u, { mode: 'cors' }).then(r => r.ok, () => false))), urls);
    ok('every one of them is still served, from the cache', served.every(Boolean), JSON.stringify(urls.filter((_, i) => !served[i])));
    const flow = await p.evaluate(() => fetch('https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js', { mode: 'cors' }).then(r => r.ok, () => false));
    ok('and so is the flowchart drawer', flow);
    await ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  ok('no page errors', !errors.length, errors.join(' | '));
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
