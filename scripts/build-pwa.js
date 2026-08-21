#!/usr/bin/env node
/*
 * Stage 1, step 2 — assemble the installable app around the extracted content.
 *
 *   node scripts/extract-content.js <standalone.html>     # first
 *   node scripts/build-pwa.js       <standalone.html>     # then this
 *
 * Produces dist/:
 *
 *     index.html              the shell — CSS, fonts, icons, splash. No content.
 *     app.js                  the application code, unchanged apart from the
 *                             two content constants and the vision call
 *     content/questions.json  the bank
 *     content/figures/*.webp  408 figures, fetched on demand and cached
 *     manifest.webmanifest    so Add to Home Screen produces an app
 *     sw.js                   precache the shell, runtime-cache the figures
 *     icons/*.png
 *
 * WHY THE APP CODE STAYS A CLASSIC SCRIPT. The obvious move is
 * <script type="module"> with a top-level await on the content. It would
 * work, but module scope is not global scope: every top-level function and
 * binding would stop being reachable by name, which is how the six existing
 * test suites drive the app (page.evaluate(() => { goLab(); render(); })).
 * Rewriting all six to reach through an export object would be a lot of
 * churn for no user-visible gain. So instead the loader fetches the content,
 * puts it on window, and only then injects app.js as an ordinary script —
 * whose top-level declarations land in global scope exactly as they do today.
 *
 * WHAT THIS CHANGES ABOUT DELIVERY. A fetch() will not cross file:// origins,
 * so this build has to be served over http(s); it is not a thing you drop in
 * Files and open. That is inherent to splitting content out, not incidental
 * to how it is done here, and it is why scripts/polish-patch.js and the
 * single-file build stay exactly where they are — that remains the artifact
 * for the Files-app workflow.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
if (!SRC) {
  console.error('usage: node scripts/build-pwa.js <standalone.html>');
  process.exit(1);
}
const ROOT = path.join(__dirname, '..');
const CONTENT = path.join(ROOT, 'content');
const DIST = path.join(ROOT, 'dist');

if (!fs.existsSync(path.join(CONTENT, 'questions.json'))) {
  console.error('content/questions.json is missing — run scripts/extract-content.js first');
  process.exit(1);
}

let html = fs.readFileSync(SRC, 'utf8');
const steps = [];
function step(label, fn) { fn(); steps.push(label); }

/* ── 1. split the app code out of the document ───────────────────────────── */
const OPEN = '<script>\nconst ALL_Q=';
const openAt = html.indexOf(OPEN);
if (openAt < 0) throw new Error('could not find the main <script> (expected it to open with const ALL_Q=)');
const codeFrom = openAt + '<script>\n'.length;
const closeAt = html.lastIndexOf('</script>');
if (closeAt < codeFrom) throw new Error('could not find the closing </script>');

let appCode = html.slice(codeFrom, closeAt);

/* Drop the two content constants. They are each exactly one line, and the
   regex is anchored to line start + `;` at line end so it cannot swallow any
   of the ~4900 lines of code that follow. */
step('strip the inline question bank', () => {
  const before = appCode.length;
  appCode = appCode.replace(/^const ALL_Q=\[[\s\S]*?\];$/m, '');
  if (appCode.length === before) throw new Error('ALL_Q line not removed');
});
step('strip the inline figure blob', () => {
  const before = appCode.length;
  appCode = appCode.replace(/^const IMGS=\{[\s\S]*?\};$/m, '');
  if (appCode.length === before) throw new Error('IMGS line not removed');
});

/* ── 2. the one place that genuinely needed data URLs ────────────────────── */
/* Figures now live at URLs, which <img src> takes happily but the Messages
   API does not — it wants base64. So the AI path resolves them at send time.
   Only there: fetching and encoding 18 MB up front is exactly what we are
   getting away from, and an API call is rare next to a render. */
const AI_CALL = `messages:Vision.withFigures(wire, q, (typeof IMGS!=='undefined'?IMGS[q&&q.id]:null), AI.provider)})`;
step('AI path resolves figure URLs to base64 at send time', () => {
  if (appCode.split(AI_CALL).length - 1 !== 1) throw new Error('vision call site not found exactly once');
  appCode = appCode.replace(AI_CALL,
    `messages:Vision.withFigures(wire, q, await figuresAsDataUrls(q), AI.provider)})`);
});

step('add the figure resolver', () => {
  const anchor = `/* ── figures ── */`;
  if (appCode.split(anchor).length - 1 !== 1) throw new Error('figures section anchor not found exactly once');
  appCode = appCode.replace(anchor,
`/* ── figures ── */
/* Display uses the URLs directly — the browser and the service worker cache
   them, which is the whole point of taking them out of the document. The
   Messages API cannot take a URL it has no access to, so only the AI path
   pays to base64 them, and only for the question actually being asked.
   Cached per question id, because a tutor conversation sends the same
   figures on every iteration of the agent loop. */
const _figDataCache = new Map();
async function figuresAsDataUrls(q){
  if(!q || !q.img) return null;
  const urls = (typeof IMGS!=='undefined' && IMGS[q.id]) || null;
  if(!urls || !urls.length) return null;
  if(_figDataCache.has(q.id)) return _figDataCache.get(q.id);
  try{
    const out = await Promise.all(urls.map(async u=>{
      const blob = await (await fetch(u)).blob();
      return await new Promise((res,rej)=>{
        const fr = new FileReader();
        fr.onload = ()=>res(fr.result); fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
    }));
    _figDataCache.set(q.id, out);
    return out;
  }catch(_){
    return null;      // a figure that will not load must not take the chat down
  }
}
`);
});

/* ── 3. the loader that replaces the inline payloads ─────────────────────── */
const LOADER = `<script>
/* Stage 1: content lives beside the app instead of inside it. Fetch it, put
   it on window, and only then inject app.js — a classic script, so all of its
   top-level declarations land in global scope exactly as they did when this
   was one file. The splash is already on screen and covers all of this. */
(async function(){
  function fail(msg, err){
    console.error(msg, err||'');
    var sp = document.getElementById('splash');
    if(sp){
      var w = sp.querySelector('.sp-word'), s = sp.querySelector('.sp-sub');
      if(w) w.textContent = 'Could not load the question bank';
      if(s) s.textContent = msg;
    }
  }
  try{
    var res = await fetch('content/questions.json', {cache:'no-cache'});
    if(!res.ok) throw new Error('HTTP '+res.status);
    var qs = await res.json();
    window.ALL_Q = qs;
    /* id → array of figure URLs. Same shape the app already expected, so
       buildFigures() and everything downstream is untouched. */
    var imgs = {};
    for(var i=0;i<qs.length;i++){
      var q = qs[i];
      if(q.figs && q.figs.length) imgs[q.id] = q.figs.map(function(f){ return 'content/figures/'+f; });
    }
    window.IMGS = imgs;
  }catch(err){
    return fail('Open this over http, not as a file — it needs to fetch its content.', err);
  }
  await new Promise(function(resolve, reject){
    var s = document.createElement('script');
    s.src = 'app.js'; s.onload = resolve; s.onerror = reject;
    document.body.appendChild(s);
  }).catch(function(err){ fail('The application code failed to load.', err); });

  if('serviceWorker' in navigator){
    try{ await navigator.serviceWorker.register('sw.js'); }catch(_){}
  }
})();
</script>`;

step('swap the inline payloads for the content loader', () => {
  html = html.slice(0, openAt) + LOADER + html.slice(closeAt + '</script>'.length);
});

step('link the manifest and the iOS icon', () => {
  const anchor = '</head>';
  if (html.split(anchor).length - 1 !== 1) throw new Error('</head> not found exactly once');
  html = html.replace(anchor,
`<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/icon-192.png">
</head>`);
});

/* ── 4. write it all out ─────────────────────────────────────────────────── */
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'icons'), { recursive: true });
fs.writeFileSync(path.join(DIST, 'index.html'), html);
fs.writeFileSync(path.join(DIST, 'app.js'), appCode);

fs.cpSync(CONTENT, path.join(DIST, 'content'), { recursive: true });

const manifest = {
  name: 'Systole — Cardiology Board Review',
  short_name: 'Systole',
  description: 'Cardiology board review on the ACCSAP 12 bank: spaced repetition, a WebGL rhythm lab, and Apex, a grounded AI tutor.',
  start_url: '.',
  scope: '.',
  display: 'standalone',
  orientation: 'any',
  background_color: '#0A1628',
  theme_color: '#0A1628',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
fs.writeFileSync(path.join(DIST, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

/* Cache version is derived from the content digest, so publishing a new
   export invalidates the old caches instead of serving a stale bank. */
const contentManifest = JSON.parse(fs.readFileSync(path.join(CONTENT, 'manifest.json'), 'utf8'));
const SW = `/* ACCSAP 12 service worker.
   Shell is precached so a cold launch is instant and works offline. Figures
   are cache-first at runtime rather than precached: there are 408 of them and
   18 MB, and precaching that on install would stall the first launch for the
   sake of questions you may never open. iOS can still evict this cache under
   pressure, so every miss falls through to the network rather than assuming
   what was cached once is cached forever. */
const VERSION = '${contentManifest.sourceDigest}';
const SHELL = 'accsap-shell-' + VERSION;
const FIGS  = 'accsap-figs-'  + VERSION;
/* Split deliberately. cache.addAll() is all-or-nothing: one 404 rejects the
   whole call, the install event fails, the worker never activates, and the app
   silently loses offline support entirely. That is exactly what happened when
   the icons were generated by a separate script that had not been run — a
   missing decoration disabled the headline feature.

   So: the files the app genuinely cannot start without are precached
   atomically and any failure is a real failure. Everything else is cached
   best-effort, one request at a time, and a miss is shrugged off. */
const PRECACHE  = ['.', 'index.html', 'app.js', 'manifest.webmanifest', 'content/questions.json'];
const NICE_TO_HAVE = ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll(PRECACHE);
    await Promise.all(NICE_TO_HAVE.map(u => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== FIGS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.includes('/content/figures/')) {
    e.respondWith(caches.open(FIGS).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  // shell: cache first, but refresh in the background so an update lands
  e.respondWith(caches.open(SHELL).then(async c => {
    const hit = await c.match(req);
    const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
`;
fs.writeFileSync(path.join(DIST, 'sw.js'), SW);

const mb = b => (b / 1048576).toFixed(2) + ' MB';
const kb = b => (b / 1024).toFixed(0) + ' KB';
const shellBytes = fs.statSync(path.join(DIST, 'index.html')).size
                 + fs.statSync(path.join(DIST, 'app.js')).size;
console.log('Stage 1 PWA build\n');
steps.forEach(s => console.log('  ✓ ' + s));
console.log('');
console.log(`  index.html           ${kb(fs.statSync(path.join(DIST, 'index.html')).size)}`);
console.log(`  app.js               ${kb(fs.statSync(path.join(DIST, 'app.js')).size)}`);
console.log(`  shell total          ${kb(shellBytes)}   (was ${mb(fs.statSync(SRC).size)} in one file)`);
console.log(`  content/             ${mb(contentManifest.figureBytes)} of figures + questions.json`);
console.log(`\n  written to           ${DIST}`);
/* Icons are drawn by a headless browser, which lives in the global node_modules
   here. Resolving that ourselves means `node scripts/build-pwa.js` produces a
   complete, installable PWA rather than one that needs a second command nobody
   remembers — and whose absence used to break offline entirely. */
try {
  const globalRoot = require('child_process').execSync('npm root -g', { encoding: 'utf8' }).trim();
  const r = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'make-icons.js')], {
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: [process.env.NODE_PATH, globalRoot].filter(Boolean).join(path.delimiter) },
  });
  const made = fs.existsSync(path.join(DIST, 'icons', 'icon-192.png'));
  console.log(made ? '\n  icons                generated'
                   : '\n  icons                NOT generated — run: node scripts/make-icons.js\n' +
                     '                       (the app still works offline; the install icon will be missing)');
  if (!made && r.stderr) console.log('    ' + r.stderr.split('\n')[0]);
} catch (err) {
  console.log('\n  icons                skipped (' + err.message.split('\n')[0] + ')');
}
