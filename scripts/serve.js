#!/usr/bin/env node
/*
 * A static server for dist/, so the PWA build can be opened and tested.
 *
 *   node scripts/serve.js [port] [dir]
 *
 * No dependency, because the whole project has managed without a package.json
 * so far and one static file server is not the reason to start. Sets the
 * handful of headers that actually matter: correct types (a service worker
 * served as text/plain will not register), and no-cache on the shell so a
 * rebuild is picked up rather than served from the browser's own cache while
 * you are trying to test the service worker's.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]) || 8123;
const DIR = path.resolve(process.argv[3] || path.join(__dirname, '..', 'dist'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(DIR, p);
  /* Never serve outside the root, however creative the path.
     THE TRAILING SEPARATOR IS THE WHOLE GUARD. A bare startsWith(DIR) also
     accepts any SIBLING whose name merely begins with the root's — serving
     /dist-old or /dist.bak to anyone who asks for "/../dist-old/x". path.join
     has already collapsed the "..", so the only thing standing between the
     tailnet and the directory next door is comparing against DIR + sep. */
  if (file !== DIR && !file.startsWith(DIR + path.sep)) { res.writeHead(403).end('forbidden'); return; }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('not found'); return; }
    const ext = path.extname(file).toLowerCase();
    const headers = { 'content-type': TYPES[ext] || 'application/octet-stream', 'content-length': st.size };
    /* Figures are immutable once written; everything else should revalidate so
       a rebuild is visible without clearing the browser cache by hand. */
    headers['cache-control'] = p.includes('/content/figures/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`serving ${DIR}\n  http://localhost:${PORT}/`);
});
