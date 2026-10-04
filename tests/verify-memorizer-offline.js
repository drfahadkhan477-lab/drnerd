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
 * suite and handed to the browser through a local test transport, which
 * checks them against the app's integrity hashes as it would in use.
 * The generated worker delegates only its CDN network fetch to that
 * transport; its production caching code and original URL keys are intact.
 * This works on engines without Playwright service-worker interception.
 *
 * WHAT IS PROVEN:
 *   · opened as a file, the card says why it cannot help, and keeps nothing;
 *   · from a web address, before preparing, nothing is called ready;
 *   · Prepare fetches every pinned file, and a group is ready only when all
 *     of its files are in the cache;
 *   · with the dependency transport cut, every file is still served with
 *     no upstream request; an uncached probe proves the cut took effect.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { launch, engineName } = require('./_engine');
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
async function expectedFetchErrors(page, since, url) {
  // WebKit also raises page errors for the two failures the test provokes.
  // Wait for both diagnostics, then remove only this exact pair. Any other
  // page error stays in errors and fails the final assertion.
  if (engineName() === 'webkit' && errors.length - since < 2) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { page.off('pageerror', arrived); reject(new Error('Expected rejected-fetch diagnostics did not arrive.')); }, 5000);
      function arrived() {
        if (errors.length - since < 2) return;
        clearTimeout(timer); page.off('pageerror', arrived); resolve();
      }
      page.on('pageerror', arrived); arrived();
    });
  }
  const got = errors.slice(since), parsed = new URL(url);
  const path = 'http: /' + parsed.hostname + parsed.pathname + parsed.search + '.';
  if (!got.length) return true;
  if (got.length !== 2 || got[0] !== 'http: TypeError: Load failed' || got[1] !== path) return false;
  errors.splice(since, 2);
  return true;
}

const ROOT = path.join(__dirname, '..');
const { build } = require(path.join(ROOT, 'scripts', 'build-memorizer.js'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memorizer-offline-'));
  build(dir);
  const bytes = new Map(), attempts = [];
  let transport = 'original';
  // Only the generated test worker's network boundary is replaced. Its
  // install, fetch handler, cache keys, pinned-host filter and writes are
  // unchanged. A real fetch still verifies the original Request.integrity.
  const bridge = `\nconst testFetch = self.fetch.bind(self);
self.fetch = function (input, init) {
  const request = new Request(input, init);
  if (new URL(request.url).hostname !== 'cdn.jsdelivr.net') return testFetch(input, init);
  return testFetch(new Request(self.location.origin + '/test-cdn?url=' + encodeURIComponent(request.url), request));
};\n`;
  fs.appendFileSync(path.join(dir, 'sw.js'), bridge);
  const server = http.createServer(async (q, r) => {
    if (q.url.startsWith('/test-cdn?')) {
      const url = new URL(q.url, 'http://localhost').searchParams.get('url');
      const target = new URL(url);
      if (target.hostname !== 'cdn.jsdelivr.net' || !/^\/npm\/(pdfjs-dist|mermaid|tesseract\.js|tesseract\.js-core|@tesseract\.js-data\/eng)@\d/.test(target.pathname)) { r.writeHead(403); return r.end(); }
      attempts.push({ url, transport });
      if (transport === 'offline') return r.destroy();
      r.setHeader('cache-control', 'no-store');
      r.setHeader('access-control-allow-origin', '*');
      if (transport === 'different' || transport === 'corrupt') { r.setHeader('content-type', 'text/plain'); return r.end('NOT FROM THE CACHE'); }
      /* THREE TRIES, as tests/verify-memorizer.js's cdnGet. One dropped Node
         fetch here was a 502 to the worker, which cached one reader file of
         two: "after preparing, all three are ready offline" failed on WebKit
         CI, and the next check died reading a cache entry that was not
         there. The network between the runner and jsDelivr is not what this
         suite measures; the bytes are still jsDelivr's and still checked
         against the pinned hashes. A file still missing after three tries is
         a logged 502, as before. */
      try {
        if (!bytes.has(url)) {
          let last = '';
          for (let attempt = 1; attempt <= 3 && !bytes.has(url); attempt++) {
            try {
              const res = await fetch(url);
              if (res.ok) bytes.set(url, { type: res.headers.get('content-type'), body: Buffer.from(await res.arrayBuffer()) });
              else last = 'CDN returned HTTP ' + res.status;
            } catch (e) { last = e.message; }
            if (!bytes.has(url)) await new Promise(res => setTimeout(res, 500 * attempt));
          }
          if (!bytes.has(url)) { console.log(`  [cdn] ${url} failed three times: ${last}`); throw new Error(last); }
        }
        const b = bytes.get(url);
        r.setHeader('content-type', b.type || 'application/octet-stream');
        return r.end(b.body);
      } catch (error) { r.writeHead(502); return r.end(error.message); }
    }
    const name = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(dir, path.normalize(name));
    if (!file.startsWith(dir)) { r.statusCode = 403; return r.end(); }
    fs.readFile(file, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream'); r.end(b); });
  });
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  const HTTP = 'http://127.0.0.1:' + server.address().port + '/';
  const T = { timeout: 60000 };
  const browser = await launch();
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
    transport = 'corrupt';
    const corruptErrors = errors.length;
    const refused = await p.evaluate(async () => {
      const f = MemPdf.LIB;
      const rejected = await fetch(f.url, { integrity: f.sri, mode: 'cors' }).then(() => false, () => true);
      return rejected && !await caches.match(f.url);
    });
    ok('incorrect bytes fail the original integrity check and never enter the cache',
      refused && await expectedFetchErrors(p, corruptErrors, 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js'));
    transport = 'original';
    await p.click('#prep-offline');
    await p.waitForFunction(() => { const li = [...document.querySelectorAll('#offline-status li')]; return li.length === 3 && !document.querySelector('#prep-offline[disabled]'); }, null, { timeout: 180000 });
    const after = await p.$$eval('#offline-status li', li => li.map(x => [x.dataset.ready, x.textContent]));
    ok('after preparing, all three are ready offline', after.every(x => x[0] === 'true' && /ready offline/.test(x[1])), JSON.stringify(after));
    const urls = await p.evaluate(() => [MemPdf.LIB, MemPdf.WORKER, MemOcr.TESS.lib, MemOcr.TESS.worker, MemOcr.TESS.coreSimd, MemOcr.TESS.core, MemOcr.TESS.eng].map(f => f.url));
    const kept = await p.evaluate(us => Promise.all(us.map(u => caches.match(u).then(r => !!r))), urls);
    ok('every pinned reader file is in the cache', kept.every(Boolean), JSON.stringify(urls.filter((_, i) => !kept[i])));

    head('with the network answering something else');
    transport = 'different';
    const neverUrl = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/package.json';
    const changed = await p.evaluate(u => fetch(u, { mode: 'cors' }).then(r => r.text()), neverUrl);
    ok('an uncached request proves the network now answers with different bytes', changed === 'NOT FROM THE CACHE');
    /* the kept bytes are read BEFORE the fetch: a worker that went to the
       network would also write the network's answer into its cache, and a
       comparison made after would agree with it */
    const same = await p.evaluate(us => Promise.all(us.map(async u => {
      const b = new Uint8Array(await (await caches.match(u)).arrayBuffer());
      const a = new Uint8Array(await (await fetch(u, { mode: 'cors' })).arrayBuffer());
      return new TextDecoder().decode(a) !== 'NOT FROM THE CACHE' && a.length === b.length && a.every((x, i) => x === b[i]);
    })), urls);
    const fromCache = same.every(Boolean);
    ok('every one is served from the cache, not the network, byte for byte', fromCache, JSON.stringify(urls.filter((_, i) => !same[i])));

    head('with the dependency transport cut');
    // Cut the worker's upstream sockets, so requests still reach the worker
    // on every engine. no-store prevents the browser HTTP cache masking this.
    transport = 'offline';
    const offlineErrors = errors.length;
    const never = await p.evaluate(u => fetch(u, { mode: 'cors' }).then(r => r.ok, () => false), neverUrl + '?not-kept');
    ok('the network really is cut: a file never kept is not served',
      never === false && await expectedFetchErrors(p, offlineErrors, neverUrl + '?not-kept'));
    const served = await p.evaluate(us => Promise.all(us.map(u => fetch(u, { mode: 'cors' }).then(r => r.ok, () => false))), urls);
    const flow = await p.evaluate(() => fetch('https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js', { mode: 'cors' }).then(r => r.ok, () => false));
    ok('every one of them is still served, from the cache', served.every(Boolean), JSON.stringify(urls.filter((_, i) => !served[i])));
    ok('and so is the flowchart drawer', flow);
    const probes = attempts.filter(a => a.transport === 'different' || a.transport === 'offline');
    ok('the worker made no upstream request for a cached dependency in either failure mode',
      new Set(probes.map(a => a.url)).size === 2 && probes.every(a => a.url === neverUrl || a.url === neverUrl + '?not-kept'),
      JSON.stringify([...new Set(probes.map(a => a.transport + ': ' + a.url))]));
    await ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  ok('no page errors', !errors.length, errors.join(' | '));
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
