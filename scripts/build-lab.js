#!/usr/bin/env node
/*
 * Build the Lab — heart sounds, pressure tracings, ECG strips and the heart map — into one
 * self-contained HTML file plus the small files that make it installable.
 *
 *   node scripts/build-lab.js [--out dist-lab]
 *   node scripts/build-lab.js --zip [lab-cloudflare.zip]
 *
 * Like Memorizer, and unlike scripts/build.js, THIS NEEDS NO LICENSED SOURCE. Nothing in the
 * Lab comes from the ACCSAP export: the heart sounds are synthesised, the tracings are
 * drawn from physio.js's own equations, the strips from the Rhythm Lab's generators. So it
 * builds anywhere, CI included, and dist-lab/ is gitignored only because it is output.
 *
 * It reuses the other builder's zip writer, so the zip is made the same way the one
 * Cloudflare Pages already accepted was: bare file names, forward slashes, at the root.
 *
 * Every <script src> and <link rel=stylesheet> in lab/index.html marked `data-inline` is
 * replaced by the file's contents. It refuses (exit 1) when a marked file is missing and when
 * any marked tag survives: a half-inlined page that still points at ../src/core/fsrs.js works
 * from the repository and breaks the moment it is copied anywhere else.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { zipOf } = require('./build-memorizer.js');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'lab');
const argOut = process.argv.indexOf('--out');
const OUT = path.resolve(argOut !== -1 ? process.argv[argOut + 1] : path.join(ROOT, 'dist-lab'));
const ZIP_FILES = ['index.html', 'sw.js', 'icon.svg', 'manifest.webmanifest', '_headers'];

/* No microphone, no camera, no location: the Lab only plays sound. */
const HEADERS = [
  '/*',
  "  Content-Security-Policy: frame-ancestors 'none'",
  '  X-Frame-Options: DENY',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: no-referrer',
  '  Permissions-Policy: camera=(), geolocation=(), microphone=()',
  '/',
  '  Cache-Control: no-cache',
  '/index.html',
  '  Cache-Control: no-cache',
  '/sw.js',
  '  Cache-Control: no-cache',
  ''].join('\n');

function build(out) {
  out = out || OUT;
  let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  const inlined = [];
  html = html.replace(/<script src="([^"]+)" data-inline><\/script>/g, (_, rel) => {
    const file = path.resolve(SRC, rel);
    if (!fs.existsSync(file)) throw new Error(`data-inline script not found: ${rel} (→ ${file})`);
    inlined.push(rel);
    /* A literal "</script" inside the code would end the block early. */
    return `<script>/* ${rel} */\n${fs.readFileSync(file, 'utf8').replace(/<\/script/gi, '<\\/script')}\n</script>`;
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

  /* The service worker only registers over http(s): opened as a file, the page is already on the device. */
  const pwa = [
    '<link rel="manifest" href="manifest.webmanifest">',
    '<link rel="icon" href="icon.svg" type="image/svg+xml">',
    '<link rel="apple-touch-icon" href="icon.svg">',
    '<script>if(\'serviceWorker\' in navigator && /^https?:$/.test(location.protocol)){navigator.serviceWorker.register(\'sw.js\').catch(function(){});}</script>',
  ].join('\n');
  if (html.split('<!-- @pwa -->').length !== 2) throw new Error('expected exactly one <!-- @pwa --> marker in lab/index.html');
  html = html.replace('<!-- @pwa -->', pwa);

  const stamp = crypto.createHash('sha256').update(html).digest('hex').slice(0, 12);
  html = html.replace('<html lang="en">', `<html lang="en" data-build="${stamp}">`);

  const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="112" fill="#b3321f"/>
<path d="M64 270h104l36-96 56 190 44-122 28 28h108" fill="none" stroke="#fff" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/></svg>
`;
  const manifest = JSON.stringify({
    name: 'Systole Lab', short_name: 'Lab', start_url: './', scope: './', display: 'standalone',
    background_color: '#f6f4ef', theme_color: '#b3321f',
    description: 'Practice recognising heart sounds, pressure tracings and ECG strips, and see where each one is in the heart.',
    icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
  }, null, 2) + '\n';
  /* The page from the network first (a stale shell is how an update goes unseen), anything else from the cache. */
  const sw = `/* Systole Lab service worker, build ${stamp}. The shell is cached at install; nothing else is touched. */
var CACHE = 'lab-shell-${stamp}';
var SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('lab-shell-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  var page = r.mode === 'navigate' || /\\/(?:index\\.html)?$/.test(new URL(r.url).pathname);
  e.respondWith(page
    ? fetch(r, { cache: 'no-cache' }).then(function (res) {
        if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(r, copy); }); }
        return res;
      }).catch(function () { return caches.match(r).then(function (hit) { return hit || caches.match('./'); }); })
    : caches.match(r).then(function (hit) { return hit || fetch(r); }));
});
`;

  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'index.html'), html);
  fs.writeFileSync(path.join(out, 'manifest.webmanifest'), manifest);
  fs.writeFileSync(path.join(out, 'sw.js'), sw);
  fs.writeFileSync(path.join(out, 'icon.svg'), icon);
  fs.writeFileSync(path.join(out, '_headers'), HEADERS);
  return { out, inlined, bytes: Buffer.byteLength(html), stamp };
}

if (require.main === module) {
  try {
    const r = build();
    console.log(`Lab built → ${path.relative(process.cwd(), r.out) || '.'}/index.html  (${(r.bytes / 1024).toFixed(0)} KB, ${r.inlined.length} files inlined, build ${r.stamp})`);
    const z = process.argv.indexOf('--zip');
    if (z !== -1) {
      const next = process.argv[z + 1];
      const file = path.resolve(next && !/^--/.test(next) ? next : path.join(ROOT, 'lab-cloudflare.zip'));
      fs.writeFileSync(file, zipOf(r.out, ZIP_FILES));
      console.log(`Cloudflare Pages upload → ${path.relative(process.cwd(), file)}  (${ZIP_FILES.join(', ')})`);
    }
  } catch (e) {
    console.error('build-lab: ' + e.message);
    process.exit(1);
  }
}
module.exports = { build, ZIP_FILES, HEADERS };
