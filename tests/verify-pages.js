#!/usr/bin/env node
/*
 * The Worker that Cloudflare Pages actually runs, driven the way Pages runs it.
 *
 *   node tests/verify-pages.js [dist]
 *
 * WHY THIS EXISTS. A deployment went out and the whole site stopped answering.
 * It turned out to be the shape of the upload rather than the code — but the
 * hour spent proving that revealed something worse: NOTHING tested the path
 * production uses. verify-pwa serves dist/ with scripts/serve.js, a plain
 * static file server, and never touches _worker.js at all.
 *
 * That matters because a _worker.js at the root of a Pages upload switches the
 * project into advanced mode, where the Worker owns EVERY request — not just
 * /api/apex/. The worker's own comment says what that means:
 *
 *     "forgetting this line does not break the API — it 404s the entire app."
 *
 * One line, one whole site, and no check. So this imports the built worker and
 * calls it exactly as the runtime does: fetch(request, env) with an env.ASSETS
 * that serves the built directory. It is not a mock of the worker — it is the
 * real worker, with a stand-in only for the platform binding around it.
 *
 * It runs from the --pwa block in scripts/verify.js, immediately after
 * build-pwa.js writes dist/, so it can never be measuring a stale build.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DIST = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.webp': 'image/webp',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};

/* Pages' own ASSETS binding, near enough: it resolves a request against the
   uploaded directory and 404s anything not there. Directory requests get
   index.html, which is what makes "/" work at all. */
const makeAssets = root => ({
  async fetch(req) {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root)) return new Response('forbidden', { status: 403 });
    try {
      if (!fs.statSync(file).isFile()) return new Response('not found', { status: 404 });
      return new Response(fs.readFileSync(file), {
        status: 200,
        headers: { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' },
      });
    } catch (_) { return new Response('not found', { status: 404 }); }
  },
});

(async () => {
  head('the upload has the shape Pages needs');
  const need = ['_worker.js', 'index.html', 'app.js'];
  const missing = need.filter(f => !fs.existsSync(path.join(DIST, f)));
  ok('every file Pages looks for is at the ROOT of the directory',
     missing.length === 0, missing.join(', ') || need.join(', '));
  /* The deployment that broke was a zip whose entries all sat under dist/, so
     Pages found no index.html at the root and 404'd every URL. Nothing in the
     repo can stop a person uploading the wrong folder — but this states, in a
     place that runs, exactly what the root has to contain. */
  ok('and nothing important is hiding one level down',
     !fs.existsSync(path.join(DIST, 'dist')), 'no nested dist/');

  if (missing.length) {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(1);
  }

  const mod = (await import('file://' + path.join(DIST, '_worker.js'))).default;
  const env = { ASSETS: makeAssets(DIST) };
  const get = async (p, init) =>
    mod.fetch(new Request('https://systole.pages.dev' + p, init), env);

  head('the Worker serves the site, which is most of what it does');
  {
    const root = await get('/');
    const body = await root.text();
    ok('/ answers 200', root.status === 200, String(root.status));
    ok('and it is the app, not a stray file',
       /<title>/i.test(body) && body.includes('Systole'), `${body.length} bytes`);
    ok('and it is served as HTML, so a browser renders rather than downloads it',
       /text\/html/.test(root.headers.get('content-type') || ''),
       root.headers.get('content-type'));

    const app = await get('/app.js');
    ok('/app.js answers 200', app.status === 200, String(app.status));
    ok('and is the real shell, not an error page',
       (await app.text()).length > 100000);

    for (const p of ['/sw.js', '/manifest.webmanifest']) {
      const r = await get(p);
      ok(`${p} is served`, r.status === 200, String(r.status));
    }
  }

  head('and it still knows which requests are its own');
  {
    /* No key is set here, so the handler should refuse rather than reach
       Google — the point is that the path is ROUTED to the handler at all and
       does not fall through to ASSETS as a 404. */
    const api = await get('/api/apex/models');
    ok('/api/apex/* reaches the handler rather than the file server',
       api.status !== 404, String(api.status));
    ok('and answers as the API, not as a page',
       /json/.test(api.headers.get('content-type') || ''),
       api.headers.get('content-type'));

    const missing404 = await get('/definitely-not-here.html');
    ok('an unknown path is a clean 404, not a crash', missing404.status === 404,
       String(missing404.status));
  }

  head('the two failures that would take the whole site down');
  {
    /* Both of these are one deleted line away, and neither is visible in a
       static-server test, which is why this file exists. */
    const src = fs.readFileSync(path.join(DIST, '_worker.js'), 'utf8');
    ok('the worker still falls through to ASSETS for everything else',
       /env\.ASSETS\.fetch\(request\)/.test(src));
    ok('and still has a default export for the runtime to call',
       typeof mod === 'object' && typeof mod.fetch === 'function');

    /* Prove the fall-through by removing it: an env with no ASSETS must throw
       rather than quietly return a 404, so a broken binding is loud. */
    let threw = false;
    try { await mod.fetch(new Request('https://systole.pages.dev/'), {}); }
    catch (_) { threw = true; }
    ok('a missing ASSETS binding fails loudly rather than serving nothing',
       threw === true);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
