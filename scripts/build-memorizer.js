#!/usr/bin/env node
/*
 * Build Memorizer — the standalone "upload a PDF, master the unit" app — into
 * one self-contained HTML file plus the three small files that make it
 * installable.
 *
 *   node scripts/build-memorizer.js [--out dist-memorizer]
 *
 *   dist-memorizer/index.html            the whole app; also works opened as a file
 *   dist-memorizer/manifest.webmanifest  install metadata (home-screen icon, name)
 *   dist-memorizer/sw.js                 offline shell + cached PDF reader
 *   dist-memorizer/icon.svg
 *
 * UNLIKE scripts/build.js, THIS NEEDS NO LICENSED SOURCE. Memorizer carries no
 * content of its own: the PDF is the user's, read in their browser, and never
 * stored anywhere but their device. So this builds anywhere — CI included —
 * and dist-memorizer/ is gitignored only because it is output, not because it
 * holds anything licensed.
 *
 * WHAT IT DOES. Every <script src> and <link rel=stylesheet> in
 * memorizer/index.html marked `data-inline` is replaced by the file's
 * contents. It refuses (exits 1) when a marked file is missing, and when any
 * marked tag survives — a half-inlined page that still points at
 * ../src/core/fsrs.js works from the repository and breaks the moment it is
 * copied anywhere else, which is the one place it is meant to go.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'memorizer');
const argOut = process.argv.indexOf('--out');
const OUT = path.resolve(argOut !== -1 ? process.argv[argOut + 1] : path.join(ROOT, 'dist-memorizer'));

function build(out) {
  out = out || OUT;
  let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  const inlined = [];

  html = html.replace(/<script src="([^"]+)" data-inline><\/script>/g, (_, rel) => {
    const file = path.resolve(SRC, rel);
    if (!fs.existsSync(file)) throw new Error(`data-inline script not found: ${rel} (→ ${file})`);
    inlined.push(rel);
    /* A literal "</script" inside the code would end the block early. */
    const code = fs.readFileSync(file, 'utf8').replace(/<\/script/gi, '<\\/script');
    return `<script>/* ${rel} */\n${code}\n</script>`;
  });
  html = html.replace(/<link rel="stylesheet" href="([^"]+)" data-inline>/g, (_, rel) => {
    const file = path.resolve(SRC, rel);
    if (!fs.existsSync(file)) throw new Error(`data-inline stylesheet not found: ${rel}`);
    inlined.push(rel);
    return `<style>\n${fs.readFileSync(file, 'utf8').replace(/<\/style/gi, '<\\/style')}\n</style>`;
  });
  if (/<(script|link)\b[^>]*\bdata-inline\b/i.test(html)) {
    throw new Error('a data-inline tag survived the build — its markup does not match the pattern this script inlines');
  }

  /* The service worker only registers over http(s): opened as a file, the
     page is already on the device and there is nothing to install. */
  const pwa = [
    '<link rel="manifest" href="manifest.webmanifest">',
    '<link rel="icon" href="icon.svg" type="image/svg+xml">',
    '<link rel="apple-touch-icon" href="icon.svg">',
    '<script>if(\'serviceWorker\' in navigator && /^https?:$/.test(location.protocol)){' +
      'navigator.serviceWorker.register(\'sw.js\').catch(function(){});}</script>',
  ].join('\n');
  if (html.split('<!-- @pwa -->').length !== 2) throw new Error('expected exactly one <!-- @pwa --> marker in memorizer/index.html');
  html = html.replace('<!-- @pwa -->', pwa);

  const stamp = crypto.createHash('sha256').update(html).digest('hex').slice(0, 12);
  html = html.replace('<html lang="en">', `<html lang="en" data-build="${stamp}">`);

  const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="112" fill="#2f5bd3"/>
<path d="M256 96l160 160-160 160L96 256z" fill="none" stroke="#fff" stroke-width="36" stroke-linejoin="round"/>
<circle cx="256" cy="256" r="46" fill="#fff"/></svg>
`;
  const manifest = JSON.stringify({
    name: 'Memorizer', short_name: 'Memorizer', start_url: './', scope: './', display: 'standalone',
    background_color: '#f6f4ef', theme_color: '#2f5bd3',
    description: 'Add a chapter and master it: split into sections, taught with mnemonics and analogies, drilled with multiple choice, a final exam and spaced review.',
    icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
  }, null, 2) + '\n';
  const sw = `/* Memorizer service worker, build ${stamp}.
   The shell is cached at install; the PDF reader, Mermaid and the text
   reader for scanned pages (pinned CDN versions) are cached the first time
   they are fetched. Nothing else is
   touched — AI calls are POSTs to the provider and pass straight through. */
var CACHE = 'memorizer-${stamp}';
var SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('memorizer-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var r = e.request;
  if (r.method !== 'GET') return;
  var u = new URL(r.url);
  var pinnedCdn = u.hostname === 'cdn.jsdelivr.net' && /\\/npm\\/(pdfjs-dist|mermaid|tesseract\\.js|tesseract\\.js-core|@tesseract\\.js-data\\/eng)@\\d/.test(u.pathname);
  if (u.origin !== location.origin && !pinnedCdn) return;
  e.respondWith(caches.match(r).then(function (hit) {
    return hit || fetch(r).then(function (res) {
      if (res.ok || res.type === 'opaque') { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(r, copy); }); }
      return res;
    });
  }));
});
`;

  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'index.html'), html);
  fs.writeFileSync(path.join(out, 'manifest.webmanifest'), manifest);
  fs.writeFileSync(path.join(out, 'sw.js'), sw);
  fs.writeFileSync(path.join(out, 'icon.svg'), icon);
  return { out, inlined, bytes: Buffer.byteLength(html), stamp };
}

if (require.main === module) {
  try {
    const r = build();
    console.log(`Memorizer built → ${path.relative(process.cwd(), r.out) || '.'}/index.html  ` +
                `(${(r.bytes / 1024).toFixed(0)} KB, ${r.inlined.length} files inlined, build ${r.stamp})`);
  } catch (e) {
    console.error('build-memorizer: ' + e.message);
    process.exit(1);
  }
}
module.exports = { build };
