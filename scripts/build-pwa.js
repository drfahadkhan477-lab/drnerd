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
const AI_CALL = `      messages:Vision.withImages(
        Vision.withFigures(wire, q, (typeof IMGS!=='undefined'?IMGS[q&&q.id]:null), AI.provider),
        refImagesForHits(lastHits), AI.provider)})`;
step('AI path resolves figure URLs to base64 at send time', () => {
  if (appCode.split(AI_CALL).length - 1 !== 1) throw new Error('vision call site not found exactly once');
  appCode = appCode.replace(AI_CALL,
    `      messages:Vision.withImages(
        Vision.withFigures(wire, q, await figuresAsDataUrls(q), AI.provider),
        refImagesForHits(lastHits), AI.provider)})`);
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

/* ── 3.5. the splash heart's own two assets, pulled the same way ─────────── */
/* The single-file build inlines the Lottie player (168 KB) and the animation
   JSON (23 KB) directly into the splash markup, because paint-before-parse is
   the whole reason the splash exists and nothing should make it wait. That is
   fine at 27 MB; it is not fine against an 800 KB shell budget. So here they
   come back out, the same move extract-content.js makes for the question bank
   — except this pair lives in index.html itself (the splash predates the
   <script>ALL_Q=… split entirely), so it is extracted from `html`, not
   `appCode`. */
const splashAssets = [];
step('pull the Lottie player out of the splash', () => {
  const re = /<script id="spHeartLib" data-splash-heart="lib">([\s\S]*?)<\/script>/;
  const m = re.exec(html);
  if (!m) throw new Error('spHeartLib script block not found');
  splashAssets.push(['lottie.min.js', m[1]]);
  html = html.replace(m[0], '');
});
step('pull the animation data out of the splash', () => {
  const re = /<script id="spHeartData" data-splash-heart="data" type="application\/json">([\s\S]*?)<\/script>/;
  const m = re.exec(html);
  if (!m) throw new Error('spHeartData script block not found');
  JSON.parse(m[1]);   // fail loudly here, not silently at runtime
  splashAssets.push(['heart.json', m[1]]);
  html = html.replace(m[0], '');
});
step('swap the inline mount script for a fetch-and-mount loader', () => {
  const re = /<script data-splash-heart="mount">[\s\S]*?<\/script>/;
  if (!re.test(html)) throw new Error('splash-heart mount script not found');
  const LOADER = `<script>
(function(){
  var el = document.getElementById('spHeartMount');
  if(!el) return;
  Promise.all([
    fetch('content/splash-heart/lottie.min.js').then(function(r){ return r.text(); }),
    fetch('content/splash-heart/heart.json').then(function(r){ return r.json(); }),
  ]).then(function(res){
    /* the player is plain code, not a module -- eval it into scope so the
       global 'lottie' it defines is the same one the inline version got */
    (0, eval)(res[0]);
    if(typeof lottie === 'undefined') return;
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var anim = lottie.loadAnimation({
      container: el, renderer: 'svg', loop: true, autoplay: !reduce, animationData: res[1],
    });
    if(reduce) anim.goToAndStop(0, true);
  }).catch(function(){ /* the splash's static parts already carried the load */ });
})();
</script>`;
  html = html.replace(re, LOADER);
});

/* ── 3.6 the reference seed ───────────────────────────────────────────────
   refs-patch bakes the Braunwald corpus in as a seed so the app opens with
   the library already populated. That is ~295 KB, which is nothing against a
   27 MB single file and fatal against an 800 KB shell. Out it comes, and a
   loader appended to app.js applies it once the code that owns REF exists.
   `let` at script top level lives in the global lexical scope, so the loader
   can see REF and refSeedApply directly without either being on window. */
let refSeed = null;
step('pull the reference seed out of the app code', () => {
  const re = /\/\*REF_SEED_START\*\/([\s\S]*?)\/\*REF_SEED_END\*\//;
  const m = re.exec(appCode);
  if (!m) throw new Error('REF_SEED markers not found — did refs-patch run?');
  JSON.parse(m[1]);   // fail loudly here, not silently at runtime
  refSeed = m[1];
  appCode = appCode.replace(re, '[]');
  appCode += `
/* ── reference seed, fetched (see build-pwa.js) ───────────────────────────── */
(function(){
  if(typeof REF === 'undefined' || typeof refSeedApply !== 'function') return;
  fetch('content/refs-seed.json').then(function(r){ return r.json(); }).then(function(seed){
    REF = refSeedApply(REF, seed);
    if(typeof invalidateIndex === 'function') invalidateIndex();
  }).catch(function(){ /* an unseeded library still works, and still imports */ });
})();
`;
});

/* ── 3.7 the reference figures ────────────────────────────────────────────
   ref-images-patch embeds every figure a reference note cites — a few
   megabytes raw, base64'd, which is nothing against 27 MB and fatal against
   800 KB. Same move as the reference seed: pull it out, fetch it, apply it
   once the binding it fills exists. */
let refImgs = null;
step('pull the reference figures out of the app code', () => {
  const re = /\/\*REF_IMGS_START\*\/([\s\S]*?)\/\*REF_IMGS_END\*\//;
  const m = re.exec(appCode);
  if (!m) return;   // no note cites a figure — nothing to pull out
  JSON.parse(m[1]);   // fail loudly here, not silently at runtime
  refImgs = m[1];
  appCode = appCode.replace(re, '{}');
  appCode += `
/* ── reference figures, fetched (see build-pwa.js) ────────────────────────── */
(function(){
  if(typeof REF_IMGS === 'undefined') return;
  fetch('content/refs-images.json').then(function(r){ return r.json(); }).then(function(imgs){
    REF_IMGS = imgs;
  }).catch(function(){ /* notes still render — just without their figures */ });
})();
`;
});

/* ── 4. write it all out ─────────────────────────────────────────────────── */
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'icons'), { recursive: true });
fs.writeFileSync(path.join(DIST, 'index.html'), html);
fs.writeFileSync(path.join(DIST, 'app.js'), appCode);

fs.cpSync(CONTENT, path.join(DIST, 'content'), { recursive: true });

const splashDir = path.join(DIST, 'content', 'splash-heart');
fs.mkdirSync(splashDir, { recursive: true });
for (const [name, body] of splashAssets) fs.writeFileSync(path.join(splashDir, name), body);

if (refSeed) fs.writeFileSync(path.join(DIST, 'content', 'refs-seed.json'), refSeed);
if (refImgs) fs.writeFileSync(path.join(DIST, 'content', 'refs-images.json'), refImgs);

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
console.log(`  content/splash-heart ${splashAssets.map(([n,b])=>`${n} ${(b.length/1024).toFixed(0)}KB`).join(', ')}`);
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
