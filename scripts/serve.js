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
  /* The older ACC bank's figures are JPEG (tools/older-acc-import.js), and
     extract-content.js names them .jpg. Without these they went out as
     application/octet-stream, which the offline downloader rightly refuses
     as not-an-image — so they never reached the device. */
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  /* ONE BAD REQUEST MUST NOT STOP THE SERVER. decodeURIComponent throws a
     URIError on a malformed escape, and "/%ZZ" from anything on the tailnet
     used to kill the process: an uncaught throw in the handler. */
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); }
  catch (_) { res.writeHead(400).end('bad request'); return; }
  if (p.includes('\0')) { res.writeHead(400).end('bad request'); return; }
  if (p.endsWith('/')) p += 'index.html';
  /* resolve, not join, and "./" in front so a path that starts with "/" stays
     under DIR rather than being read as absolute. Same result as join for
     every request; it is the form CodeQL's path-injection check recognises
     as normalised before the prefix test below. */
  const file = path.resolve(DIR, './' + p);
  /* Never serve outside the root, however creative the path.
     THE TRAILING SEPARATOR IS THE WHOLE GUARD. A bare startsWith(DIR) also
     accepts any SIBLING whose name merely begins with the root's — serving
     /dist-old or /dist.bak to anyone who asks for "/../dist-old/x". resolve
     has already collapsed the "..", so the only thing standing between the
     tailnet and the directory next door is comparing against DIR + sep. */
  /* No exception for DIR itself: it is a folder, so it was a 404 anyway, and
     the exception is the branch CodeQL could not see past (an unsanitised
     path reaching fs.stat whenever file === DIR). */
  if (!file.startsWith(DIR + path.sep)) { res.writeHead(403).end('forbidden'); return; }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('not found'); return; }
    const ext = path.extname(file).toLowerCase();
    const headers = { 'content-type': TYPES[ext] || 'application/octet-stream', 'content-length': st.size };
    /* Figures are immutable once written; everything else should revalidate so
       a rebuild is visible without clearing the browser cache by hand. */
    headers['cache-control'] = p.includes('/content/figures/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    /* Headers wait for the file to open, so a file that cannot be read gets a
       500 rather than a 200 with no body; an error after that ends the
       response. Either way it is this request that fails, not the server: an
       'error' on a stream with no listener used to be an uncaught exception. */
    const stream = fs.createReadStream(file);
    stream.on('open', () => { res.writeHead(200, headers); stream.pipe(res); });
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500).end('could not read');
      else res.destroy();
    });
  });
});

server.listen(PORT, () => {
  console.log(`serving ${DIR}\n  http://localhost:${PORT}/`);
});
