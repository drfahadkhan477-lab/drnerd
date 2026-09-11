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

/* ── 2. the two places that genuinely needed data URLs ───────────────────── */
/* Figures now live at URLs, which <img src> takes happily but neither
   provider's chat API does — both want base64. So the AI path resolves them
   at send time. Only there: fetching and encoding 18 MB up front is exactly
   what we are getting away from, and an API call is rare next to a render.
   ONE call site now, not two. Each provider built its own wire shape around
   the same withFigures/withImages pair and so carried its own copy of this
   fragment; with the second provider gone there is one copy, and this guard
   moved with it rather than being loosened to "one or more" — the count is
   the point, because a silently-missed call site ships an 18 MB fetch. */
const AI_CALL = `(typeof IMGS!=='undefined'?IMGS[q&&q.id]:null)`;
step('AI path resolves figure URLs to base64 at send time', () => {
  const n = appCode.split(AI_CALL).length - 1;
  if (n !== 1) throw new Error(`vision call site expected in exactly 1 place, found ${n}`);
  appCode = appCode.split(AI_CALL).join('await figuresAsDataUrls(q)');
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
   figures on every iteration of the agent loop.

   BOUNDED, BECAUSE BASE64 IS THE EXPENSIVE SHAPE. This held every figure of
   every question ever asked about, for the life of the tab, as base64 — which
   is a third larger again than the bytes on the wire. A fellow working through
   a chapter with Apex open touches dozens of questions in a sitting, and an
   iPad reclaims memory by killing the tab rather than by asking. The URLs cost
   nothing to re-resolve: the service worker has the figure, so a miss is a
   cache read, not a download. So the cache is small on purpose — an agent loop
   sends the same figures several times in a row, which is all it has to cover.

   Least-recently-used, which a Map gives almost for free: it iterates in
   insertion order, so re-inserting on a hit moves an entry to the back and the
   front is always the coldest. */
const FIG_CACHE_MAX_ENTRIES = 24;
const FIG_CACHE_MAX_BYTES   = 24 * 1024 * 1024;
/* A figure that never answers must not hold a turn open, and one that answers
   with something enormous must not be base64ed into memory to find out. The
   cap is well above the largest figure in the bank (the widest is under 400 KB)
   and well below anything that would hurt. */
const FIG_FETCH_TIMEOUT_MS  = 15000;
const FIG_MAX_BYTES         = 8 * 1024 * 1024;
const _figDataCache = new Map();
let _figCacheBytes = 0;
const _figBytes = v => v.reduce((n,s)=>n+(s?s.length:0),0);
function _figTrim(){
  while(_figDataCache.size > FIG_CACHE_MAX_ENTRIES || _figCacheBytes > FIG_CACHE_MAX_BYTES){
    const k = _figDataCache.keys().next().value;
    if(k===undefined) break;
    _figCacheBytes -= _figBytes(_figDataCache.get(k)||[]);
    _figDataCache.delete(k);
  }
  if(_figCacheBytes < 0) _figCacheBytes = 0;
}
async function figuresAsDataUrls(q){
  if(!q || !q.img) return null;
  const urls = (typeof IMGS!=='undefined' && IMGS[q.id]) || null;
  if(!urls || !urls.length) return null;
  if(_figDataCache.has(q.id)){
    const hit = _figDataCache.get(q.id);
    _figDataCache.delete(q.id); _figDataCache.set(q.id, hit);   // now the newest
    return hit;
  }
  const ctl = typeof AbortController!=='undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(()=>{ try{ ctl.abort(); }catch(_){} }, FIG_FETCH_TIMEOUT_MS) : null;
  try{
    const out = await Promise.all(urls.map(async u=>{
      const r = await fetch(u, ctl ? {signal:ctl.signal} : undefined);
      if(!r.ok) throw new Error('figure '+r.status);
      /* Refused on the header where there is one, so an oversized figure is
         never read into memory at all; checked again on the blob, because
         content-length is absent on a chunked or service-worker response. */
      const len = +(r.headers.get('content-length')||0);
      if(len && len > FIG_MAX_BYTES) throw new Error('figure too large: '+len);
      const blob = await r.blob();
      if(blob.size > FIG_MAX_BYTES) throw new Error('figure too large: '+blob.size);
      return await new Promise((res,rej)=>{
        const fr = new FileReader();
        fr.onload = ()=>res(fr.result); fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
    }));
    const bytes = _figBytes(out);
    /* One question whose figures exceed the whole budget is returned and not
       kept, rather than evicting everything else to store it and then being
       evicted itself on the next insert. */
    if(bytes <= FIG_CACHE_MAX_BYTES){
      _figDataCache.set(q.id, out);
      _figCacheBytes += bytes;
      _figTrim();
    }
    return out;
  }catch(_){
    return null;      // a figure that will not load must not take the chat down
  }finally{
    if(timer) clearTimeout(timer);
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
  /* Replaced at build time; see BUILD_ID in scripts/build-pwa.js. */
  var SHELL_BUILD_ID = '__BUILD_ID__';
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
    /* Which build this is, stated rather than inferred. The offline downloader
       is only meaningful here — in the single file every figure is a data: URI
       already in memory, and a button offering to fetch them would be a lie. */
    window.SPLIT_BUILD = true;
  }catch(err){
    return fail('Open this over http, not as a file — it needs to fetch its content.', err);
  }
  /* STOPS HERE WHEN app.js DOES NOT LOAD. It used to be a trailing
     .catch(function(err){ fail(...) }) with nothing else, so the splash showed
     the error and execution carried straight on into the service-worker
     registration below — installing a worker whose whole job is to cache a
     shell that never ran. The first attempt at this put a return inside that
     callback, which reads like the content-fetch path above but is not the
     same thing at all: it returns from the CALLBACK, the awaited promise then
     resolves normally, and the registration runs exactly as before.
     tests/verify-pwa.js caught it by blocking app.js at the network and
     counting registrations, which is the only reason this is a try/catch and
     not a plausible-looking one-liner. */
  try{
    await new Promise(function(resolve, reject){
      var s = document.createElement('script');
      s.src = 'app.js'; s.onload = resolve; s.onerror = reject;
      document.body.appendChild(s);
    });
  }catch(err){
    return fail('The application code failed to load.', err);
  }

  /* THE SHELL AND THE CODE HAVE TO BE FROM THE SAME BUILD, and until this ran
     nothing checked. sw.js serves the shell cache-first and refreshes it in the
     background, per request — so a deploy landing between the request for
     index.html and the request for app.js leaves a launch running one build's
     HTML against the other build's code, and the mixed pair persists in the
     cache until something replaces it. Nothing crashes; the app just behaves
     like neither version.

     Both files carry the same stamp, generated over the shell digest and the
     content digest together, so any change to either moves it. A disagreement
     means the pair is mixed, and one reload is enough: the worker has since
     settled on one build and will serve both halves of it.

     GUARDED, because a reload that does not fix it must not become a loop.
     sessionStorage rather than a variable, for the same reason the update
     reload below uses it — the reload discards variables. Second time through,
     the fellow is told rather than spun. */
  try{
    if(typeof APP_BUILD_ID !== 'undefined' && APP_BUILD_ID !== SHELL_BUILD_ID){
      if(sessionStorage.getItem('accsap-mixed-build')){
        return fail('This app updated while it was opening. Close it completely and open it again.',
                    new Error('build mismatch: shell ' + SHELL_BUILD_ID + ', app ' + APP_BUILD_ID));
      }
      sessionStorage.setItem('accsap-mixed-build','1');
      location.reload();
      return;
    }
    sessionStorage.removeItem('accsap-mixed-build');
  }catch(_){ /* private mode: the check is a safety net, not a requirement */ }

  if('serviceWorker' in navigator){
    /* THE UPDATE THAT ARRIVES UNDER A RUNNING APP. sw.js calls skipWaiting on
       install and clients.claim on activate, so a new worker takes control of
       THIS page — which is still running the app.js it parsed at launch. From
       that moment the worker serves new content to old code: a renamed figure
       path 404s, a changed questions.json shape is read by a parser that
       predates it. On an iPad a home-screen app is rarely killed, so that
       state can persist for weeks.

       Before the shell and figure caches were versioned separately, sw.js was
       byte-identical across code changes and the browser never saw an update
       at all — so this was unreachable. Fixing the versioning is what made it
       reachable, which is the honest reason it is being fixed now.

       One reload, guarded by a flag that lives for this tab only: if the new
       code somehow triggers another controllerchange, the flag is already set
       and the page will not loop. sessionStorage rather than a variable
       because the reload itself discards variables. */
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function(){
      /* controllerchange ALSO fires on the very first install, when there was
         no controller to be stale — reloading there would be a pointless
         flash on first launch, and worse, it would spend the one-shot guard
         below so a genuine update later in the same tab would be ignored. */
      if(!hadController) { hadController = true; return; }
      try{
        if(sessionStorage.getItem('accsap12.swreloaded')) return;
        sessionStorage.setItem('accsap12.swreloaded','1');
      }catch(_){ return; }   // no sessionStorage means no loop guard, so do not reload
      location.reload();
    });
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

/* ── 3.5. the splash heart's image, pulled the same way ──────────────────── */
/* The single-file build inlines the heart photograph as a data: URI directly
   in the splash markup, because paint-before-parse is the whole reason the
   splash exists and nothing should make it wait. That is fine at 27 MB; it is
   not fine against the shell budget. Base64 of an already-compressed WebP does
   not gzip, so inlining puts its full ~57 KB onto the transferred shell — a
   fifth of the 280 KB budget for one decorative image. So here it comes back
   out, the same move extract-content.js makes for the question bank — except
   this lives in index.html itself (the splash predates the <script>ALL_Q=…
   split entirely), so it is extracted from `html`, not `appCode`.

   The static parts of the splash — ground, wordmark, ECG sweep — still paint
   instantly either way. Only the heart itself arrives a beat later here, which
   is exactly the trade the Lottie pair made before it. */
const splashAssets = [];
step('pull the heart image out of the splash', () => {
  const re = /(<img class="sp-heart-img" data-splash-heart="img" alt="" decoding="sync" src=")data:image\/webp;base64,([A-Za-z0-9+/=]+)(">)/;
  const m = re.exec(html);
  if (!m) throw new Error('splash heart <img> with an inline data: URI not found');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.slice(0, 4).toString('ascii') !== 'RIFF' || bytes.slice(8, 12).toString('ascii') !== 'WEBP') {
    throw new Error('the splash heart data: URI did not decode to a WebP');
  }
  splashAssets.push(['heart.webp', bytes]);
  html = html.replace(m[0], m[1] + 'content/splash-heart/heart.webp' + m[3]);

  /* AND THE HERO'S COPY, WHICH IS THE ONE THAT IS EASY TO MISS. heroart-patch
     reads the picture out of the splash markup so the two hearts can never be
     different images — but at that point in the chain the splash still holds
     the inline data: URI, so buildHome() ends up with a second 57 KB base64
     string baked into it. That one lives in appCode, not html, and pulling
     only the splash copy left the split build shipping the image twice: the
     shell went from 229 KB gzipped to 276 KB against a 280 KB budget, which
     is how this was noticed. Both copies point at the one file. */
  const heroRe = /(<img data-hero-heart="img" src=")data:image\/webp;base64,[A-Za-z0-9+/=]+(")/;
  if (!heroRe.test(appCode)) throw new Error('the hero heart <img> with an inline data: URI was not found in the app code');
  appCode = appCode.replace(heroRe, (mm, a, b) => a + 'content/splash-heart/heart.webp' + b);

  /* Neither copy may survive as base64. Checked rather than assumed: this is
     a size regression that no test screen would show and no feature would
     break — it would just be slower, forever. */
  const leftover = (html + appCode).match(/data:image\/webp;base64,/g);
  if (leftover) throw new Error(`${leftover.length} inline WebP data: URI(s) survived into the split build`);
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
/* ── the library arrives after the first paint ─────────────────────────────
   In the single-file build REF is inline, so the home screen is painted with
   the library already in hand. Here it is fetched, and the first paint happens
   without it — which silently cost the home screen its centrepiece: no notes
   means no pearl, so the card simply was not there, and nothing ever asked for
   it again. Filling the binding is not enough; something has to repaint.

   Not a blanket repaint. render() remounts the hero, which restarts an ECG
   canvas and a WebGL heart, and doing that for nothing is worse than the bug.
   So it repaints only when the library actually changed what is on screen, and
   never while a question is up. */
function refLatePaint(){
  if(typeof render !== 'function' || typeof S === 'undefined') return;
  if(S.screen === 'refs'){ render(); return; }
  if(S.screen !== 'home') return;
  var card = document.getElementById('pearlCard');
  var wantPearl = typeof pearlAll === 'function' && pearlAll().length > 0;
  /* Two ways the library can have changed home: there is no pearl and there
     should be one, or a pearl is showing whose figure had not downloaded when
     it was painted. */
  var missingFig = !!card && typeof pearlCurrent !== 'undefined' && pearlCurrent &&
                   pearlCurrent.figKey && !document.getElementById('pearlFig');
  if((!card && wantPearl) || missingFig) render();
}
/* ── reference seed, fetched (see build-pwa.js) ───────────────────────────── */
(function(){
  if(typeof REF === 'undefined' || typeof refSeedApply !== 'function') return;
  fetch('content/refs-seed.json').then(function(r){ return r.json(); }).then(function(seed){
    REF = refSeedApply(REF, seed);
    if(typeof invalidateIndex === 'function') invalidateIndex();
    refLatePaint();
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
    /* The pearl may already be on screen quoting a note whose figure only
       just landed. */
    if(typeof refLatePaint === 'function') refLatePaint();
  }).catch(function(){ /* notes still render — just without their figures */ });
})();
`;
});

/* ── 3.8. the fonts ───────────────────────────────────────────────────────
   Four woff2 faces are inlined as base64 in the single-file build — 250 KB of
   the 802 KB shell, and correctly so there: one file that works offline cannot
   reference a sibling. In the split build that reasoning inverts. A font is a
   static, immutable, separately-cacheable asset; leaving it as base64 makes
   the browser parse a quarter-megabyte of text before it can apply a single
   rule, and re-download all four whenever one byte of CSS changes.

   Out they come. The shell drops to ~560 KB, the CSS parses sooner, and the
   service worker precaches them best-effort — best-effort rather than
   required, because every face has a real fallback stack behind it and a font
   that failed to cache should cost the fellow a typeface, not an install. */
const fontAssets = [];
step('lift the base64 fonts out of the stylesheet', () => {
  const FACE = /@font-face\{([^}]*?)src:url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\)([^}]*)\}/g;
  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let found = 0;
  html = html.replace(FACE, (whole, head, b64, tail) => {
    const fam = (/font-family:\s*'([^']+)'/.exec(head) || [, 'font'])[1];
    const ital = /font-style:\s*italic/.test(head);
    const name = slug(fam) + (ital ? '-italic' : '') + '.woff2';
    fontAssets.push([name, Buffer.from(b64, 'base64')]);
    found++;
    return `@font-face{${head}src:url(fonts/${name})${tail}}`;
  });
  /* The Lottie player carries an @font-face template of its own, in a JS
     string. It has no data: URL, so it is not matched — and if this ever
     stops finding the four real faces, that is a silently unstyled app. */
  if (found !== 4) throw new Error(`expected 4 inlined font faces, found ${found}`);
});

/* ── 3.9. the head, told the truth about itself ───────────────────────────
   Two lines in the head are written for the single-file build and are wrong
   the moment it is split. The comment claims the typefaces are embedded and
   that the file requests nothing from the network; neither is true here. And
   `apple-mobile-web-app-capable` is the vendor-prefixed spelling — iOS still
   honours it, but the standard name is what every other browser reads, and
   this build's whole purpose is to be installed from Safari. */
step('correct the head for a build that has a network', () => {
  const note = /<!-- Typefaces are embedded[\s\S]*?-->/;
  if (!note.test(html)) throw new Error('the typeface note was not found in the head');
  html = html.replace(note,
`<!-- The typefaces (DM Sans, DM Serif Display, JetBrains Mono — SIL Open Font
     License) are in fonts/, and the question bank and figures are in content/.
     The service worker caches all of it on first visit, so after one load this
     opens identically on a plane or a hospital wifi. -->`);

  const cap = '<meta name="apple-mobile-web-app-capable" content="yes">';
  if (html.split(cap).length - 1 !== 1) throw new Error('the iOS capability meta was not found exactly once');
  html = html.replace(cap, '<meta name="mobile-web-app-capable" content="yes">\n' + cap);
});

/* ── 4. write it all out ─────────────────────────────────────────────────── */
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'icons'), { recursive: true });
/* Read here rather than beside the service worker, because the build stamp
   below needs the content digest and is computed before either file is
   written. */
const contentManifest = JSON.parse(fs.readFileSync(path.join(CONTENT, 'manifest.json'), 'utf8'));

/* ── the build stamp ─────────────────────────────────────────────────────────
   Computed over the shell and the content TOGETHER, so it moves when either
   does — that is the whole point: it answers "are these two files from the same
   deploy?", which neither digest answers alone. Taken over the UNSTAMPED bytes,
   because stamping changes them; deterministic either way, since the
   placeholder is a constant. */
const shellDigest = require('crypto').createHash('sha256')
  .update(html).update(appCode).digest('hex').slice(0, 16);
const BUILD_ID = require('crypto').createHash('sha256')
  .update(shellDigest).update(String(contentManifest.sourceDigest)).digest('hex').slice(0, 16);

if (html.indexOf('__BUILD_ID__') < 0) throw new Error('the loader lost its build-stamp placeholder');
html = html.replace('__BUILD_ID__', BUILD_ID);
if (html.indexOf('__BUILD_ID__') >= 0) throw new Error('more than one build-stamp placeholder in the loader');
/* A var at the top level of a classic script is a global, which is what the
   loader's typeof check reads. */
appCode = `var APP_BUILD_ID='${BUILD_ID}';\n` + appCode;

fs.writeFileSync(path.join(DIST, 'index.html'), html);
fs.writeFileSync(path.join(DIST, 'app.js'), appCode);

/* content/ is the build's INPUT directory as well as the deployed one, and a
   blind recursive copy shipped 18 MB the app never asks for: the per-figure
   visual atlas the reference figures were cut from (14 MB), the markdown the
   seed was baked from, and the loose figure files that were base64'd into
   refs-images.json. Dead weight anywhere; worse on the iPad route, where this
   folder is uploaded to a host and synced to a tablet.

   So only what the shipped code actually fetches is copied. The list is short
   and checked against the built code below, because a folder silently dropped
   here is a feature that 404s at runtime rather than a build that fails. */
const SHIPPED = ['questions.json', 'manifest.json', 'figures'];
step('copy only the content the app asks for', () => {
  fs.mkdirSync(path.join(DIST, 'content'), { recursive: true });
  for (const name of SHIPPED) {
    const from = path.join(CONTENT, name);
    if (!fs.existsSync(from)) throw new Error(`content/${name} is missing`);
    fs.cpSync(from, path.join(DIST, 'content', name), { recursive: true });
  }
});

/* THE BANK IS NOT SHIPPABLE AS THE EXPORT WROTE IT. content/questions.json is
   the licensed export, and the export keys six questions wrong — scripts/
   keys-patch.js says which, why, and on what evidence. That step rewrites the
   ALL_Q embedded in the HTML, which is the entire bank for the single-file
   build; this build does not read that copy, it serves the JSON. So a plain
   cpSync above shipped the uncorrected export to the iPad while the single-file
   build had it right, and a wrong key is silent: it marks a correct answer
   wrong and teaches the distractor as the fact.

   The SAME list is applied here, from the same module, with the same `was`
   assertion — not a second copy of it. */
const { applyKeyCorrections } = require('./keys-patch.js');
const { applyContentFlags } = require('./flags-patch.js');
step('apply the bank corrections the chain makes to the single-file build', () => {
  const p = path.join(DIST, 'content', 'questions.json');
  const bank = JSON.parse(fs.readFileSync(p, 'utf8'));
  const applied = applyKeyCorrections(bank).concat(applyContentFlags(bank));
  fs.writeFileSync(p, JSON.stringify(bank));
  applied.forEach(a => console.log('      ✓ ' + a));
});

/* And the check that makes the class of bug impossible rather than this one
   instance of it: every answer key the split build ships must equal the key the
   single-file build carries. Any future step that corrects the bank in one
   build and not the other fails here instead of on a ward round. */
step('every answer key matches the single-file build', () => {
  const shipped = JSON.parse(fs.readFileSync(path.join(DIST, 'content', 'questions.json'), 'utf8'));
  /* Re-read SRC rather than use `html`: by this point the split has already
     lifted ALL_Q out of the working copy, which is the entire point of it. */
  const m = /\nconst ALL_Q=(\[[\s\S]*?\]);\n/.exec(fs.readFileSync(SRC, 'utf8'));
  if (!m) throw new Error('could not find "const ALL_Q=" in the single-file build');
  const embedded = new Map(JSON.parse(m[1]).map(q => [q.id, q.ci]));
  const drift = shipped.filter(q => embedded.has(q.id) && embedded.get(q.id) !== q.ci);
  if (drift.length) {
    throw new Error(`${drift.length} answer key(s) differ between the two builds: ` +
      drift.map(q => `${q.id} (split ${'ABCDEFGH'[q.ci]}, single-file ${'ABCDEFGH'[embedded.get(q.id)]})`).join(', '));
  }
  console.log(`      ✓ ${shipped.length} keys agree across both builds`);
});

const splashDir = path.join(DIST, 'content', 'splash-heart');
fs.mkdirSync(splashDir, { recursive: true });
for (const [name, body] of splashAssets) fs.writeFileSync(path.join(splashDir, name), body);

/* THE WORKER. Pages ignores a functions/ directory on dashboard direct upload —
   which is how this is deployed, as a zip dragged from an iPad — but it does
   honour a _worker.js at the root of the upload. So the Worker ships as a file
   in dist/ like everything else, and the same drag-and-drop that publishes the
   site publishes the API with it. In advanced mode it owns every request, so it
   is also what serves all of the above; see src/worker/apex.js. */
const WORKER_SRC = path.join(ROOT, 'src', 'worker', 'apex.js');
step('ship the Worker that holds the Gemini key', () => {
  if (!fs.existsSync(WORKER_SRC)) throw new Error('src/worker/apex.js is missing');
  const src = fs.readFileSync(WORKER_SRC, 'utf8');
  if (!/env\.ASSETS\.fetch/.test(src)) {
    throw new Error('the Worker has no ASSETS passthrough — that would 404 the whole site');
  }
  fs.writeFileSync(path.join(DIST, '_worker.js'), src);
});

const fontDir = path.join(DIST, 'fonts');
fs.mkdirSync(fontDir, { recursive: true });
for (const [name, body] of fontAssets) fs.writeFileSync(path.join(fontDir, name), body);

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

/* Every content path the shipped code names must exist on disk. This is the
   safety net under the selective copy above: add a fetch without adding the
   file it wants and the build stops here, rather than the app 404ing on a
   tablet with no console to read. */
step('every content path the code names is on disk', () => {
  const code = html + appCode;
  const wanted = new Set();
  for (const m of code.matchAll(/['"`](content\/[A-Za-z0-9_.-]+)/g)) wanted.add(m[1]);
  const missing = [...wanted].filter(rel => !fs.existsSync(path.join(DIST, rel)));
  if (missing.length) throw new Error(`the code fetches ${missing.join(', ')}, which was not copied`);
});

/* Cache version is derived from the content digest, so publishing a new
   export invalidates the old caches instead of serving a stale bank. */
/* THE SHELL NEEDS A VERSION OF ITS OWN. Both cache names were keyed on the
   content digest, which is a hash of the ACCSAP export — so every change to
   the app's own code produced a byte-identical sw.js. The browser saw no new
   worker, never ran install, never re-primed the shell cache, and an installed
   app went on serving the old code; the only route to an update was the
   background refresh in the fetch handler, which lands on the launch AFTER
   next. Two relaunches to see a fix is indistinguishable from a fix that did
   not ship.

   Keyed separately, not both on one version. Rekeying the FIGURE cache on a
   code change would throw away the 408 figures the fellow pressed a button to
   download — 19 MB re-fetched because a stylesheet moved. Figures change when
   the content changes; the shell changes when the shell changes. */
const SW = `/* ACCSAP 12 service worker.
   Shell is precached so a cold launch is instant and works offline. Figures
   are cache-first at runtime rather than precached: there are 408 of them and
   18 MB, and precaching that on install would stall the first launch for the
   sake of questions you may never open. iOS can still evict this cache under
   pressure, so every miss falls through to the network rather than assuming
   what was cached once is cached forever. */
const CONTENT_V = '${contentManifest.sourceDigest}';
const SHELL_V   = '${shellDigest}';
/* The same stamp index.html and app.js carry, so the three can be compared
   from the outside — by a test, or by anyone reading a deployed directory. */
const BUILD_ID  = '${BUILD_ID}';
const SHELL   = 'accsap-shell-'   + SHELL_V;
/* EVERYTHING UNDER /content/ LIVES HERE, not just the figures, and the name
   changed with the scope. It used to be FIGS and only /content/figures/ was
   routed into it; refs-images.json (14.4 MB) and refs-seed.json (0.7 MB) are
   fetched at runtime like any other same-origin URL and so fell through to the
   SHELL bucket. activate() deletes every cache that is not the CURRENT shell,
   and SHELL_V is a digest of the shell code — so a CSS tweak with no content
   change at all evicted 15.1 MB, and the next launch had to pull it down again
   before reference figures worked offline. Keyed by CONTENT_V, these now
   survive any number of code deploys and are evicted only when the content
   they were built from actually changes. */
const CONTENT = 'accsap-content-' + CONTENT_V;
/* Split deliberately. cache.addAll() is all-or-nothing: one 404 rejects the
   whole call, the install event fails, the worker never activates, and the app
   silently loses offline support entirely. That is exactly what happened when
   the icons were generated by a separate script that had not been run — a
   missing decoration disabled the headline feature.

   So: the files the app genuinely cannot start without are precached
   atomically and any failure is a real failure. Everything else is cached
   best-effort, one request at a time, and a miss is shrugged off. */
const PRECACHE  = ['.', 'index.html', 'app.js', 'manifest.webmanifest', 'content/questions.json'];
/* Which bucket a precached URL belongs in. questions.json is precached because
   the app cannot start without it, and content-versioned because that is what
   it is — so install writes it to CONTENT while the shell files go to SHELL.
   Without this it would land in SHELL, be evicted by the next code deploy, and
   be re-fetched into CONTENT on first use: self-healing, but a 1.7 MB download
   nobody asked for. */
const isContent = u => u.indexOf('content/') === 0 || u.indexOf('/content/') > -1;
const NICE_TO_HAVE = ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
                      ${JSON.stringify(fontAssets.map(([n]) => 'fonts/' + n)).slice(1, -1)}];

/* INSTALL CHECKS WHAT IT IS STORING, because addAll does not. The note further
   down about authenticating proxies — Access answering 200 OK with a sign-in
   page for any URL — was acted on in the fetch handler and nowhere else, and
   install was the path that actually mattered. cache.addAll() keeps whatever
   comes back: one lapsed session during install and the sign-in page IS app.js
   in the precache, permanently, and the device launches offline into a blank
   screen. That is not hypothetical; it is what this worker was doing.

   So every critical URL is fetched and passed through the same keepable() the
   fetch handler uses. If any one of them fails the check the install REJECTS —
   no partial shell, nothing poisoned — and the browser tries again on the next
   launch, by which time the session is usually back. */
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    const cc = await caches.open(CONTENT);
    const fresh = await Promise.all(PRECACHE.map(async u => {
      const req = new Request(u, { cache: 'reload' });
      let res; try { res = await fetch(req); } catch (_) { return [u, null]; }
      return [u, keepable(req, res) ? res : null];
    }));
    const bad = fresh.filter(([, res]) => !res).map(([u]) => u);
    if (bad.length) throw new Error('precache refused: ' + bad.join(', '));
    await Promise.all(fresh.map(([u, res]) => (isContent(u) ? cc : c).put(new Request(u), res)));
    await Promise.all(NICE_TO_HAVE.map(u => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== CONTENT).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  /* The API is never cached and never intercepted. Non-GET already falls
     through above, but the model list is a GET, and a cached model list would
     outlive the key that produced it. */
  if (url.pathname.startsWith('/api/apex/')) return;

  /* Was /content/figures/ only. Widened to all of /content/ so the two large
     JSON files stop being shell. keepable() already tells the two kinds apart:
     a figure must come back as an image, and anything else must not come back
     as text/html — which is what an expired Cloudflare Access session looks
     like when it answers 200 OK with a sign-in page. */
  if (url.pathname.includes('/content/')) {
    e.respondWith(caches.open(CONTENT).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      /* A figure is an image or it is not kept. See keepable() below.
         waitUntil, not a bare call: respondWith's promise resolves the
         instant this function returns res, and once it does the browser is
         free to terminate the worker — iOS Safari especially aggressively —
         with nothing else telling it work is still in flight. c.put() is a
         promise that keeps running after res is returned; without waitUntil
         wrapping it, the fellow sees the figure once, the worker is killed
         before the write lands, and it is never actually offline. */
      if (keepable(req, res)) e.waitUntil(c.put(req, res.clone()));
      return res;
    }));
    return;
  }
  // shell: cache first, but refresh in the background so an update lands
  e.respondWith(caches.open(SHELL).then(async c => {
    /* ignoreSearch, because the cached key is a bare path and the URL that
       comes back from an Access redirect is not — it carries the parameters
       Access appended. Without this a launch after re-authenticating misses
       every shell entry it actually has. */
    const hit = await c.match(req, { ignoreSearch: true });
    /* Same waitUntil reasoning as the figure handler above: this write must
       outlive respondWith's own promise, which resolves as soon as the
       response (fresh or cached) is handed back — often before c.put() has
       actually finished. */
    const net = fetch(req).then(res => { if (keepable(req, res)) e.waitUntil(c.put(req, res.clone())); return res; }).catch(() => hit);
    /* A NAVIGATION MUST NEVER RESOLVE TO undefined. Returning hit || net looks
       safe and is not: offline, net's catch resolves to the same missing hit,
       so respondWith gets undefined and Safari shows its cannot-connect page —
       the app "not opening" rather than opening from cache. Any navigation
       that misses falls back to the cached shell, which is what a single-page
       app wants for every route anyway. */
    if (hit) return hit;
    const res = await net;
    if (res) return res;
    if (req.mode === 'navigate') {
      const shell = await c.match('index.html', { ignoreSearch: true }) || await c.match('.', { ignoreSearch: true });
      if (shell) return shell;
    }
    return Response.error();
  }));
});

/* AN AUTHENTICATING PROXY DOES NOT ANSWER WITH AN ERROR. Cloudflare Access with
   a lapsed session, a corporate SSO gateway, a hotel captive portal: every one
   of them replies 200 OK with an HTML sign-in page, for whatever URL you asked
   for. res.ok was therefore never enough to decide something was worth keeping.

   The app's own figure downloader already knew this — it content-type checks
   before it stores anything. The service worker did not, and the service worker
   is the worse place to get it wrong: it caches app.js. One lapsed session while
   the shell was being refreshed and the sign-in page becomes app.js in the
   precache, permanently, on a device that then launches offline into a blank
   screen with no way to ask for help.

   So an HTML answer is only kept for something that asked for HTML, and a
   figure is only kept if it is actually an image. The response is still
   RETURNED either way — that is the network's business, and the app has its own
   error handling — it is just never written down. */
function keepable(req, res) {
  if (!res || !res.ok || res.type === 'opaque') return false;
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const p = new URL(req.url).pathname;
  if (p.includes('/content/figures/')) return ct.indexOf('image/') === 0;
  if (ct.indexOf('text/html') !== 0) return true;
  return p.endsWith('/') || p.endsWith('.html');
}
`;
fs.writeFileSync(path.join(DIST, 'sw.js'), SW);

const mb = b => (b / 1048576).toFixed(2) + ' MB';
const kb = b => (b / 1024).toFixed(0) + ' KB';
const shellBytes = fs.statSync(path.join(DIST, 'index.html')).size
                 + fs.statSync(path.join(DIST, 'app.js')).size;
/* The shell budget is denominated in transferred bytes, so the build prints
   the transferred figure rather than leaving it to be discovered by the check
   that enforces it. Gzip at a pinned level: deterministic, and an upper bound
   on what a device gets — Cloudflare serves brotli to anything that accepts
   it, which is smaller again. See the budget note in tests/verify-pwa.js. */
const gzipOf = f => require('zlib')
  .gzipSync(fs.readFileSync(path.join(DIST, f)), { level: 6 }).length;
const shellWire = gzipOf('index.html') + gzipOf('app.js');
console.log('Stage 1 PWA build\n');
steps.forEach(s => console.log('  ✓ ' + s));
console.log('');
console.log(`  index.html           ${kb(fs.statSync(path.join(DIST, 'index.html')).size)}`);
console.log(`  app.js               ${kb(fs.statSync(path.join(DIST, 'app.js')).size)}`);
console.log(`  shell total          ${kb(shellBytes)}   (was ${mb(fs.statSync(SRC).size)} in one file)`);
console.log(`  shell transferred    ${kb(shellWire)} gzipped   (the budget: 280 KB)`);
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
