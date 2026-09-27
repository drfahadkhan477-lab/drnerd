/* Memorizer service worker, build 4dbcfa086ab3.
   The shell is cached at install; the PDF reader, Mermaid and the text
   reader for scanned pages (pinned CDN versions) are cached the first time
   they are fetched. Nothing else is
   touched — AI calls are POSTs to the provider and pass straight through. */
var CACHE = 'memorizer-4dbcfa086ab3';
var SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg'];
var NET_WAIT_MS = 4000;
function shell(r) {
  return caches.match(r).then(function (hit) { return hit || caches.match('./'); }).then(function (hit) { return hit || caches.match('index.html'); });
}
function fresh(r) {
  var net = fetch(r.url, { cache: 'no-cache', credentials: 'same-origin' }).then(function (res) {
    if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(r, copy); }); }
    return res;
  });
  var late = new Promise(function (resolve) { setTimeout(function () { shell(r).then(function (hit) { if (hit) resolve(hit); }); }, NET_WAIT_MS); });
  return Promise.race([net.then(null, function () { return shell(r).then(function (hit) { return hit || Promise.reject(new Error('offline, and nothing cached')); }); }), late]);
}
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
  var pinnedCdn = u.hostname === 'cdn.jsdelivr.net' && /\/npm\/(pdfjs-dist|mermaid|tesseract\.js|tesseract\.js-core|@tesseract\.js-data\/eng|@mlc-ai\/web-llm)@\d/.test(u.pathname);
  if (u.origin !== location.origin && !pinnedCdn) return;
  /* The page itself comes from the network first, and from the cache only
     when the network fails or is slower than NET_WAIT_MS. Cache-first, an
     update reached the page only on the second opening after it installed,
     and an app kept open on an iPad showed a build two releases old. */
  if (r.mode === 'navigate' || (u.origin === location.origin && /\/(?:index\.html)?$/.test(u.pathname))) {
    e.respondWith(fresh(r));
    return;
  }
  e.respondWith(caches.match(r).then(function (hit) {
    return hit || fetch(r).then(function (res) {
      if (res.ok || res.type === 'opaque') { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(r, copy); }); }
      return res;
    });
  }));
});
