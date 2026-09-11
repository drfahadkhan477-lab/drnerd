#!/usr/bin/env node
/*
 * Stage 1 checks — did splitting content from code actually buy what it was
 * supposed to buy?
 *
 *   node scripts/serve.js 8123 &
 *   NODE_PATH=$(npm root -g) node tests/verify-pwa.js http://localhost:8123/index.html [single-file.html]
 *
 * Pass the single-file build as a second argument to get the heap and shell
 * comparisons measured rather than asserted against a remembered number.
 *
 * The claims under test are the three Stage 1 was justified by: the shell is
 * small, figures are fetched on demand instead of all held in memory, and the
 * thing works offline once installed.
 */
'use strict';
const path = require('path');
const { launch, heapUsedBytes, engineName } = require('./_engine');

const target = process.argv[2];
const baseline = process.argv[3];
if (!target || !/^https?:\/\//.test(target)) {
  console.error('usage: node tests/verify-pwa.js <http url> [single-file.html]');
  process.exit(1);
}
const ORIGIN = new URL(target).origin;

let passed = 0, failed = 0, unmeasured = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
/* A THIRD OUTCOME, FOR CLAIMS THIS ENGINE CANNOT WEIGH. The heap section needs
   a heap profiler, which only Chromium has. Failing it on WebKit would call
   the app broken over a missing instrument; passing it would report a budget
   nobody checked. Both are lies, and the second is the worse one because it
   reads as coverage. So it is neither — printed, counted, and named in the
   summary, where a shrinking check count is visible rather than silent. */
const unmeasurable = (label, why) => {
  unmeasured++;
  console.log('  ----  ' + label + '  → not measurable here: ' + why);
};
const head = t => console.log('\n── ' + t + ' ──');
const kb = b => (b / 1024).toFixed(0) + ' KB';
const mb = b => (b / 1048576).toFixed(1) + ' MB';

async function heapAfterBoot(page, url) {
  await page.goto(url, { waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'),
                             { timeout: 120000 });
  await page.waitForTimeout(2500);
  /* null where the engine cannot measure a heap, NOT zero. Reading
     performance.memory directly gave `undefined` on WebKit, which became 0,
     which is under every budget — so the check reported green on the one
     engine where it had measured nothing at all. */
  return heapUsedBytes(page);
}

(async () => {
  const browser = await launch({ args: ['--enable-precise-memory-info'] });

  head('the shell no longer carries the content');
  {
    const shellHtml = await (await fetch(target)).text();
    const appJs = await (await fetch(ORIGIN + '/app.js')).text();
    ok('no inline question bank in the document', !shellHtml.includes('const ALL_Q=['));
    ok('no inline figure blob in the document', !shellHtml.includes('const IMGS={'));
    ok('no base64 image payload anywhere in the shell',
       !/data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]{500}/.test(shellHtml + appJs));
    /* The four woff2 faces are inlined in the single-file build, where one
       file that works offline cannot reference a sibling. Here they are their
       own immutable, separately-cacheable files: 250 KB of base64 the browser
       no longer parses before it can apply a rule. */
    ok('no base64 font payload in the shell either',
       !/data:font\/woff2;base64,/.test(shellHtml + appJs));
    const faces = [...shellHtml.matchAll(/@font-face\{[^}]*src:url\((fonts\/[^)]+)\)/g)].map(m => m[1]);
    ok('every face points at a file of its own', faces.length === 4, faces.join(', '));
    const served = await Promise.all(faces.map(async f => {
      const r = await fetch(new URL(f, target).href);
      return r.ok && +r.headers.get('content-length') > 5000;
    }));
    ok('and every one of those files is actually served', served.every(Boolean),
       `${served.filter(Boolean).length}/${faces.length}`);
    const shellBytes = Buffer.byteLength(shellHtml) + Buffer.byteLength(appJs);
    /* WHAT THIS BUDGET NOW MEASURES, AND WHY IT CHANGED.

       For most of this project the cap was on uncompressed bytes: 800 KB to
       catch a megabyte of inlined base64 heart scan, then 640 once the fonts
       came out, then 680, then 700. Each raise bought 3-6% of headroom, so
       each one bound again within a handful of changes — and the way changes
       kept paying their way was by deleting their own comments, twice down to
       a margin under a hundred bytes. That is not a budget working. That is a
       budget being satisfied by removing the documentation this codebase is
       largely made of, which is the wrong variable to optimise.

       The deeper problem is that nobody downloads uncompressed bytes. The
       last raise left 4.1 KB of margin on 700 KB — a tripwire, not a budget —
       while the figure a device actually fetches was 225 KB and had never
       been measured. Comments are close to free once compressed, so the cap
       was taxing the one thing it should not have.

       So it measures what is transferred. Gzip at a pinned level rather than
       whatever a server negotiates: it is deterministic, it does not move
       when a CDN changes its settings, and it is an honest UPPER BOUND —
       Cloudflare serves brotli to anything that will take it, which is
       186 KB against gzip's 225 KB here. A budget that binds on gzip has
       already been cleared for the compression the device really gets.

       The cap is 280 KB against today's real 225 KB. That is 24% of headroom,
       chosen against the history above rather than as a round number: 3-6%
       is what produced four raises in as many weeks. 55 KB of gzipped
       headroom is on the order of 165 KB of source — room for several real
       features, and far more than the whole adoption plan asks for.

       The uncompressed figure is still reported, because it is not
       meaningless — it drives parse and compile time on the device. It is
       simply not the thing a download budget should be denominated in. */
    const gzip = buf => require('zlib').gzipSync(buf, { level: 6 }).length;
    const wireBytes = gzip(Buffer.from(shellHtml)) + gzip(Buffer.from(appJs));
    ok('the shell transfers under 280 KB', wireBytes < 280 * 1024,
       `${kb(wireBytes)} gzipped, from ${kb(shellBytes)} on disk`);

    if (baseline) {
      const before = require('fs').statSync(baseline).size;
      ok('and is a large fraction smaller than the single file',
         shellBytes < before / 20, `${mb(before)} → ${kb(shellBytes)}`);
    }
  }

  head('the library arrives late, and the home screen notices');
  /* The single-file build has REF inline; here it is fetched, so the first
     paint happens without it. That silently cost the home screen its pearl —
     the card was absent, and nothing asked for it again. */
  {
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  await page.goto(target, { waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'),
                             { timeout: 120000 });
  const late = await page.evaluate(() => new Promise(r => setTimeout(() => r({
    refs: typeof REF !== 'undefined' ? REF.length : -1,
    pearls: typeof pearlAll === 'function' ? pearlAll().length : -1,
    card: !!document.getElementById('pearlCard'),
    rungsOrProse: document.querySelectorAll('.pearl-step').length ||
                  (document.querySelector('.pearl-body') ? 1 : 0),
    notesDoor: [...document.querySelectorAll('.door')]
      .map(d => d.textContent.replace(/\s+/g, ' ').trim())
      .find(t => /^Notes/.test(t)) || '',
  }), 2500)));
  ok('the reference seed is fetched and applied', late.refs > 100, String(late.refs));
  ok('and yields pearls', late.pearls > 40, String(late.pearls));
  ok('the pearl card is repainted onto the home screen', late.card);
  ok('with its sentence set', late.rungsOrProse > 0, String(late.rungsOrProse));
  ok('and the Notes door counts what arrived', /\d+ references/.test(late.notesDoor), late.notesDoor);
  await page.close();
  }

  head('the Worker ships with the site, and the site still serves');
  {
    const w = await (await fetch(new URL('_worker.js', target).href)).text();
    /* Pages ignores a functions/ directory on dashboard direct upload, which is
       how this is deployed. A _worker.js at the root IS honoured, so the Worker
       has to be a file in dist/ like everything else. */
    ok('_worker.js is in the upload', w.length > 500, `${w.length} bytes`);
    /* In advanced mode the Worker owns every request to the project. Without
       this line it does not break the API — it 404s the whole app. */
    ok('and it hands everything that is not the API back to the site',
       /env\.ASSETS\.fetch\(request\)/.test(w));
    ok('the API path is the only thing it intercepts',
       /pathname\.startsWith\('\/api\/apex\/'\)/.test(w));
    /* A secret in the bundle would defeat the entire exercise. */
    ok('no key is baked into it — it reads one from the environment',
       /env\.GEMINI_API_KEY/.test(w) && !/AIza[0-9A-Za-z_\-]{20}/.test(w) && !/AQ\.[0-9A-Za-z_\-]{20}/.test(w));
    const sw = await (await fetch(new URL('sw.js', target).href)).text();
    /* The model list is a GET, and a cached model list outlives the key that
       produced it. */
    ok('and the service worker never caches the API',
       /pathname\.startsWith\('\/api\/apex\/'\)\s*\)\s*return;/.test(sw.replace(/\s+/g, ' ')) ||
       /\/api\/apex\//.test(sw), 'bypass present');
  }

  head('a sign-in page is never written into a cache');
  {
    /* THE FAILURE THIS DEFENDS AGAINST. Cloudflare Access with a lapsed session
       answers 200 OK and an HTML sign-in page for any URL. res.ok is true. The
       service worker used to cache on res.ok alone, so one lapsed session while
       the shell was being refreshed in the background would write the login page
       into the precache AS app.js — permanently, on a device that then launches
       offline into a blank screen.

       The real sw.js is loaded and its keepable() run against fabricated
       responses. No browser: a service worker is a module with a fetch handler,
       the same shape verify-worker.js drives, and there is no way to make a
       local server return a Cloudflare login page anyway. */
    const swSrc = await (await fetch(new URL('sw.js', target).href)).text();
    const res = (ct, ok = true, type = 'basic') =>
      ({ ok, type, headers: { get: h => (h.toLowerCase() === 'content-type' ? ct : null) } });
    const req = u => ({ url: ORIGIN + u });
    let keepable;
    try {
      keepable = new Function('URL', swSrc.slice(swSrc.indexOf('function keepable')) + '\nreturn keepable;')(URL);
    } catch (err) { keepable = null; }
    ok('the worker has a keepable() gate at all', typeof keepable === 'function',
       typeof keepable);
    if (typeof keepable === 'function') {
      ok('a sign-in page is not cached as app.js',
         keepable(req('/app.js'), res('text/html; charset=utf-8')) === false);
      ok('nor as a figure',
         keepable(req('/content/figures/f001.webp'), res('text/html; charset=utf-8')) === false);
      ok('nor as questions.json',
         keepable(req('/content/questions.json'), res('text/html; charset=utf-8')) === false);
      ok('a figure that is not an image is not a figure',
         keepable(req('/content/figures/f001.webp'), res('application/json')) === false);
      ok('a real figure is kept',
         keepable(req('/content/figures/f001.webp'), res('image/webp')) === true);
      ok('real code is kept',
         keepable(req('/app.js'), res('text/javascript')) === true);
      ok('the document itself is still allowed to be HTML',
         keepable(req('/index.html'), res('text/html; charset=utf-8')) === true &&
         keepable(req('/'), res('text/html; charset=utf-8')) === true);
      ok('a font with no content-type at all is still kept — absence is not a login page',
         keepable(req('/fonts/dm-sans.woff2'), res(null)) === true);
      ok('an error is never cached', keepable(req('/app.js'), res('text/javascript', false)) === false);
      ok('and neither is an opaque cross-origin response',
         keepable(req('/app.js'), res('text/javascript', true, 'opaque')) === false);
    }
    /* Counting `if (keepable(...))` rather than every mention, because the
       function's own declaration matches the bare name too. */
    const calls = (swSrc.match(/if \(keepable\(req, res\)\)/g) || []).length;
    ok('both cache writes go through it, not through res.ok',
       !/if \(res\.ok\) c\.put/.test(swSrc) && calls === 2, calls + ' call sites');

    /* THE WRITE MUST OUTLIVE respondWith's OWN PROMISE. Once the function
       handling a fetch event returns its response, that promise settles, and
       nothing else is telling the browser this worker still has work
       in-flight — c.put() started but not yet finished is exactly the kind
       of work a terminated worker drops silently. iOS Safari evicts service
       workers more aggressively than desktop browsers, and this app is built
       for an iPad: a figure that renders once and is never actually
       persisted for offline use is a real, not theoretical, failure mode
       here. Both call sites — figures and the shell's background refresh —
       must wrap their cache write in e.waitUntil(), not call it bare. */
    const waitUntilWrites = (swSrc.match(/e\.waitUntil\(c\.put\(req, res\.clone\(\)\)\)/g) || []).length;
    ok('both cache writes are kept alive with e.waitUntil, not fired and forgotten',
       waitUntilWrites === 2, waitUntilWrites + ' of 2 wrapped');

    /* INSTALL IS THE PATH THAT MATTERED, and it was the one without the check.
       cache.addAll() stores whatever comes back, so a Cloudflare Access
       sign-in page — 200 OK, text/html, for any URL — became app.js in the
       precache permanently, and the device then launched offline into a blank
       screen. Exactly the failure the comment above it describes, on the one
       path it had not been applied to. */
    ok('install no longer trusts addAll with the critical shell',
       !/addAll\(PRECACHE\)/.test(swSrc));
    ok('and screens every precached response through keepable first',
       /keepable\(req, res\) \? res : null/.test(swSrc));
    ok('refusing the whole install rather than caching a sign-in page',
       /precache refused/.test(swSrc));

    /* Offline, a navigation that misses used to resolve to undefined —
       respondWith(undefined) is a dead page, which is "the app will not open"
       rather than "the app opens from cache". */
    ok('a shell lookup ignores the query string Access appends',
       (swSrc.match(/ignoreSearch: true/g) || []).length >= 2);
    ok('and a missed navigation falls back to the cached shell',
       /req\.mode === 'navigate'/.test(swSrc) && /c\.match\('index\.html'/.test(swSrc));
  }

  head('an update does not leave old code running against new content');
  {
    /* THE SKEW THIS DEFENDS AGAINST. sw.js calls skipWaiting on install and
       clients.claim on activate, so a new worker takes control of a page that
       is still running the app.js it parsed at launch — and then serves it new
       content. On an iPad a home-screen app is rarely killed, so that pairing
       can persist for weeks.

       It only became reachable when the shell and figure caches were versioned
       separately: before that sw.js was byte-identical across code changes and
       the browser never saw an update at all. */
    const shell = await (await fetch(target)).text();
    ok('the page listens for the worker taking over',
       /addEventListener\(\s*['"]controllerchange['"]/.test(shell), 'controllerchange handler');
    ok('and reloads when it does', /controllerchange[\s\S]{0,600}location\.reload\(\)/.test(shell));
    /* Two guards, and both matter. */
    ok('but not on the first install, when there was nothing stale to replace',
       /hadController/.test(shell) && /if\(!hadController\)/.test(shell.replace(/\s/g, '')),
       'first-install guard');
    ok('and never twice, so a reload cannot loop',
       /sessionStorage[\s\S]{0,200}swreloaded/.test(shell), 'one-shot guard');
    ok('the guard is per-tab storage, since a reload discards variables',
       /sessionStorage\.setItem\(\s*['"]accsap12\.swreloaded['"]/.test(shell));
  }

  head('an update reaches an installed app, without costing the figures');
  {
    const sw = await (await fetch(new URL('sw.js', target).href)).text();
    const contentV = (/const CONTENT_V\s*=\s*'([^']+)'/.exec(sw) || [])[1];
    const shellV = (/const SHELL_V\s*=\s*'([^']+)'/.exec(sw) || [])[1];
    /* Both cache names were keyed on the content digest — a hash of the ACCSAP
       export — so every change to the app's own code produced a byte-identical
       sw.js. The browser saw no new worker, never re-primed the shell cache,
       and an installed app went on serving old code. */
    ok('the shell is versioned by its own bytes', !!shellV && shellV !== contentV,
       `shell ${shellV}, content ${contentV}`);
    ok('the shell cache is keyed on the shell version',
       new RegExp(`SHELL\\s*=\\s*'accsap-shell-'\\s*\\+\\s*SHELL_V`).test(sw));
    /* And the content cache is NOT. Rekeying it on a code change would throw
       away the 408 figures the fellow pressed a button to download — 19 MB
       re-fetched because a stylesheet moved. It was called FIGS and held only
       /content/figures/; it is called CONTENT and holds all of /content/,
       because the two large JSON files were falling through to the shell.
       tests/verify-cachebuckets.js is where that routing is checked; here it
       is only the key that matters. */
    ok('but the content cache is keyed on the content, so a code change keeps them',
       new RegExp(`CONTENT\\s*=\\s*'accsap-content-'\\s*\\+\\s*CONTENT_V`).test(sw));
  }

  head('the split build evaluates no fetched code');
  {
    /* The splash animation used to be a Lottie player fetched as text and run
       with (0, eval) — the one place in the product where launching involved
       evaluating text pulled off the network. Beyond the injection surface,
       that is the construct that makes a meaningful Content-Security-Policy
       unadoptable later. The player is gone entirely now (the splash heart is
       a photograph), so the claim is simply that nothing brought eval back. */
    const idx = await (await fetch(ORIGIN + '/index.html')).text();
    ok('index.html contains no eval of fetched text', !/\(\s*0\s*,\s*eval\s*\)|\beval\s*\(/.test(idx),
       (idx.match(/.{0,40}eval.{0,40}/) || [''])[0]);
    const app = await (await fetch(ORIGIN + '/app.js')).text();
    ok('and app.js does not eval either', !/\(\s*0\s*,\s*eval\s*\)/.test(app));

    /* THE SPLASH HEART IS FETCHED, NOT INLINED — IN BOTH FILES. This replaces
       the old "the player is loaded as a script instead" check, and it guards
       a regression that already happened once: heroart-patch reads the picture
       out of the splash markup, where at that point in the chain it is still a
       data: URI, so a second 57 KB base64 copy was ending up in app.js. Base64
       of an already-compressed WebP does not gzip, and the shell went from
       229 KB transferred to 276 against a 280 KB budget. Nothing visible would
       have broken — it would just have been slower, permanently. */
    ok('the splash heart is referenced as a file, not inlined',
       /content\/splash-heart\/heart\.webp/.test(idx));
    const inlined = ((idx + app).match(/data:image\/webp;base64,/g) || []).length;
    ok('and neither the shell nor the app code carries a copy of it as base64',
       inlined === 0, `${inlined} inline WebP data: URI(s)`);
    const heart = await fetch(ORIGIN + '/content/splash-heart/heart.webp');
    ok('and that file is actually served', heart.status === 200, String(heart.status));
  }

  head('content is served intact');
  {
    const qs = await (await fetch(ORIGIN + '/content/questions.json')).json();
    ok('all 639 questions present', qs.length === 639, String(qs.length));
    const figs = qs.reduce((a, q) => a + (q.figs ? q.figs.length : 0), 0);
    ok('all 408 figures referenced', figs === 408, String(figs));
    const declared = qs.reduce((a, q) => a + (q.img || 0), 0);
    ok('q.img and the extracted figure lists agree', declared === figs, `${declared} vs ${figs}`);

    /* THE SIX KEYS THE EXPORT GETS WRONG MUST BE RIGHT IN *THIS* BUILD TOO.
       scripts/keys-patch.js corrects them into the ALL_Q embedded in the
       single-file build; this build serves content/questions.json instead, and
       for a long time build-pwa copied that from the licensed export
       byte-for-byte — so the iPad shipped the export's own wrong keys while the
       single-file build had them right. A wrong key fails silently in the worst
       possible way: it marks a correct answer wrong and teaches the distractor.
       Asserted here against the shipped JSON, on the ids and letters from
       keys-patch's own table. */
    const KEYS = [['CON_16', 'C'], ['MIS_25', 'D'], ['PER_9', 'A'],
                  ['SYS_9', 'A'], ['SYS_26', 'C'], ['SYS_44', 'E']];
    const byId = new Map(qs.map(q => [q.id, q]));
    const wrong = KEYS.filter(([id, want]) => {
      const q = byId.get(id);
      return !q || 'ABCDEFGH'[q.ci] !== want;
    });
    ok('the six corrected answer keys are corrected in the served bank too',
       wrong.length === 0,
       wrong.map(([id, want]) => `${id} wants ${want}, has ${'ABCDEFGH'[(byId.get(id) || {}).ci]}`).join('; '));

    /* THE RULE, not the instance. A question with `imgopt` is asking the fellow
       to choose between lettered panels; with no figure shipped, there are no
       panels to choose between and it cannot be answered at all. Such a
       question must carry `bad` (kept out of the pool) or `flag` (shown with a
       notice saying why). COR_108 had one; COR_89 had neither and sat live in
       the pool offering five patterns nobody could see. This is the check that
       would have caught it, and catches the next one. */
    const unanswerable = qs.filter(q => q.imgopt && !(q.figs || []).length && !q.bad && !q.flag);
    ok('no question asks about a figure it does not ship, untriaged',
       unanswerable.length === 0, unanswerable.map(q => q.id).join(', '));
    const man = await (await fetch(ORIGIN + '/manifest.webmanifest')).json();
    ok('web app manifest is installable-shaped',
       man.display === 'standalone' && Array.isArray(man.icons) && man.icons.length >= 2 && !!man.start_url,
       `${man.display}, ${man.icons.length} icons`);
  }

  head('figures load by URL, on demand — not all of them, up front');
  {
    const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
    const figReqs = [];
    page.on('request', r => { if (r.url().includes('/content/figures/')) figReqs.push(r.url()); });
    await page.goto(target, { waitUntil: 'load', timeout: 200000 });
    await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'),
                               { timeout: 120000 });
    await page.waitForTimeout(1200);
    ok('home screen fetches no figures at all', figReqs.length === 0, String(figReqs.length));

    /* Go to a question that actually has figures and confirm one renders. */
    const shown = await page.evaluate(async () => {
      const q = ALL_Q.find(x => x.img > 0 && !x.bad);
      startQuiz(q.ch);
      S.questions = [q]; S.qIdx = 0; render();
      await new Promise(r => setTimeout(r, 1200));
      const img = document.querySelector('.fig-img');
      return {
        id: q.id, want: q.img,
        src: img ? img.getAttribute('src') : null,
        complete: img ? (img.complete && img.naturalWidth > 0) : false,
        naturalWidth: img ? img.naturalWidth : 0,
      };
    });
    ok('the figure is referenced by URL, not a data: URI',
       !!shown.src && shown.src.startsWith('content/figures/'), shown.src);
    ok('and it actually decoded', shown.complete && shown.naturalWidth > 0,
       `${shown.id} ${shown.naturalWidth}px`);
    ok('only that question\'s figures were fetched',
       figReqs.length > 0 && figReqs.length <= 5, `${figReqs.length} request(s)`);
    await page.close();
  }

  head('the AI path still gets real base64, resolved at send time');
  {
    const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
    await page.goto(target, { waitUntil: 'load', timeout: 200000 });
    await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'),
                               { timeout: 120000 });
    const resolved = await page.evaluate(async () => {
      const q = ALL_Q.find(x => x.img > 0 && !x.bad);
      const urls = await figuresAsDataUrls(q);
      if (!urls) return { none: true };
      const blocks = Vision.figureBlocks(q, urls);
      const img = blocks.find(b => b.type === 'image');
      return {
        count: urls.length, want: q.img,
        isDataUrl: urls[0].startsWith('data:image/webp;base64,'),
        blockOk: !!img && img.source.type === 'base64' && img.source.media_type === 'image/webp'
                 && img.source.data.length > 1000 && !img.source.data.startsWith('data:'),
      };
    });
    ok('every figure resolves to a base64 data URL', resolved.isDataUrl && resolved.count === resolved.want,
       `${resolved.count}/${resolved.want}`);
    ok('and produces a wire-shaped image block', resolved.blockOk === true, JSON.stringify(resolved));
    await page.close();
  }

  head('offline, once installed');
  {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto(target, { waitUntil: 'load', timeout: 200000 });
    await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'),
                               { timeout: 120000 });
    const swReady = await page.evaluate(() =>
      navigator.serviceWorker.ready.then(r => !!r.active).catch(() => false));
    ok('service worker registers and activates', swReady === true);

    /* Open a question with figures so one lands in the runtime cache. */
    const figId = await page.evaluate(async () => {
      const q = ALL_Q.find(x => x.img > 0 && !x.bad);
      startQuiz(q.ch); S.questions = [q]; S.qIdx = 0; render();
      await new Promise(r => setTimeout(r, 1500));
      return q.id;
    });
    await page.waitForTimeout(800);

    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'load', timeout: 120000 });
    const offline = await page.evaluate(() =>
      new Promise(res => {
        const t0 = Date.now();
        (function tick() {
          if (typeof S !== 'undefined' && document.querySelector('.hero-h1')) return res({ booted: true });
          if (Date.now() - t0 > 60000) return res({ booted: false });
          requestAnimationFrame(tick);
        })();
      }));
    ok('the app boots with the network cut off', offline.booted === true, JSON.stringify(offline));

    const offlineFig = await page.evaluate(async id => {
      const q = ALL_Q.find(x => x.id === id);
      startQuiz(q.ch); S.questions = [q]; S.qIdx = 0; render();
      await new Promise(r => setTimeout(r, 1500));
      const img = document.querySelector('.fig-img');
      return { complete: !!img && img.complete && img.naturalWidth > 0 };
    }, figId);
    ok('a figure seen before is still there offline', offlineFig.complete === true, JSON.stringify(offlineFig));
    await ctx.setOffline(false);
    await ctx.close();
  }

  head('one press puts the whole bank on the device');
  /* The reason this exists: served from a laptop over Tailscale, opened on an
     iPad, then studied with the laptop shut. Under that pattern every figure
     not already met is a broken image, discovered at the worst moment. */
  {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const page = await ctx.newPage();
    let figReqs = 0;
    page.on('request', r => { if (r.url().includes('/content/figures/')) figReqs++; });
    await page.goto(target, { waitUntil: 'load', timeout: 200000 });
    await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'),
                               { timeout: 120000 });
    await page.evaluate(() => navigator.serviceWorker.ready);
    /* IT LIVES ON PROGRESS NOW, not on the home screen. The landscape home grid
       gives its whole one-screen budget to four named areas and appends
       everything else outside it, so this card was 114.5px of guaranteed
       overflow on an 11-inch iPad held sideways — see chain step 82. The
       survey moved with it, so nothing is counted until Progress is open. */
    const onHome = await page.evaluate(() => !!document.getElementById('offlineCard'));
    ok('the home screen no longer carries the card', onHome === false);
    await page.evaluate(() => goStats());
    await page.waitForFunction(() => typeof offlineJob !== 'undefined' && offlineJob.counted,
                               { timeout: 60000 });

    const before = await page.evaluate(() => {
      const c = document.getElementById('offlineCard');
      return c ? { total: offlineJob.total, have: offlineJob.have,
                   val: c.querySelector('.off-val').textContent,
                   btn: c.querySelector('.off-btn').textContent } : null;
    });
    ok('the card is on the Progress screen of the split build', !!before);
    ok('and knows how many figures the bank has', before && before.total > 400, String(before && before.total));
    /* Surveying must not BE a download: caches.match asks the question without
       fetching, and 408 fetches on every home screen would be the opposite of
       the feature. */
    ok('surveying what is here costs no requests', figReqs === 0, String(figReqs));

    const t0 = Date.now();
    await page.evaluate(() => offlineDownload());
    await page.waitForFunction(() => !offlineJob.busy, { timeout: 300000 });
    const after = await page.evaluate(() => {
      const c = document.getElementById('offlineCard');
      return { have: offlineJob.have, total: offlineJob.total,
               val: c.querySelector('.off-val').textContent,
               btn: c.querySelector('.off-btn').textContent,
               disabled: c.querySelector('.off-btn').disabled,
               allHere: c.classList.contains('all-here'),
               width: c.querySelector('.off-fill').style.width };
    });
    ok('the download fetches every figure', after.have === after.total,
       `${after.have}/${after.total} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    ok('and the card says so rather than still offering', /^all \d+ figures/.test(after.val) &&
       after.disabled && after.allHere && after.width === '100%', after.val + ' · ' + after.btn);

    /* It does not own a cache: it only requests, and the service worker's own
       fetch handler does the storing. So a reload must find them all through
       exactly the same lookup a figure met the ordinary way goes through. */
    figReqs = 0;
    await page.reload({ waitUntil: 'load', timeout: 200000 });
    /* A reload lands on home, and the survey now runs from Progress. */
    await page.waitForFunction(() => typeof goStats === 'function', { timeout: 120000 });
    await page.evaluate(() => goStats());
    await page.waitForFunction(() => typeof offlineJob !== 'undefined' && offlineJob.counted,
                               { timeout: 60000 });
    const reloaded = await page.evaluate(() => ({ have: offlineJob.have, total: offlineJob.total }));
    ok('a reload finds them all still there', reloaded.have === reloaded.total,
       `${reloaded.have}/${reloaded.total}`);
    ok('and re-fetches none of them', figReqs === 0, String(figReqs));

    /* AN AUTHENTICATING PROXY DOES NOT ANSWER WITH AN ERROR. Cloudflare Access
       with an expired session, an SSO gateway, a captive portal: all reply
       200 OK with a sign-in page. Without a content-type check the downloader
       counts four hundred login forms as four hundred figures and caches every
       one, leaving a bank of broken images under a progress bar reading 100%. */
    const gated = await page.evaluate(async () => {
      const url = offlineFigures()[0];
      const looksOk = offlineIsImage(new Response('<html>sign in</html>',
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }));
      /* Poison the cache the way a gated fetch would. The real figure has to
         go first: caches.match() returns the first hit across all caches, so
         with the good copy still present the survey would find that instead
         and the check would pass for the wrong reason. */
      const before = offlineJob.have;
      await offlinePurge(url);
      const c = await caches.open('accsap-test-poison');
      await c.put(url, new Response('<html>sign in</html>',
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }));
      await offlineSurvey();
      const counted = offlineJob.have;
      await offlinePurge(url);
      await caches.delete('accsap-test-poison');
      return { looksOk, before, counted };
    });
    ok('a 200 sign-in page is not mistaken for a figure', gated.looksOk === false);
    ok('and one already in the cache is not counted as present',
       gated.counted === gated.before - 1, `${gated.before} → ${gated.counted}`);

    /* Put the real one back so the offline check below has it. */
    await page.evaluate(() => offlineDownload());
    await page.waitForFunction(() => !offlineJob.busy, { timeout: 300000 });
    ok('and a retry restores it', await page.evaluate(() => offlineJob.have === offlineJob.total &&
       offlineJob.bad === 0));

    /* The claim, tested the only way that means anything: network off, and a
       question this session has never opened. */
    await ctx.setOffline(true);
    const cold = await page.evaluate(async () => {
      const q = ALL_Q.filter(x => x.figs && x.figs.length).slice(-1)[0];
      jumpTo(q.id);
      await new Promise(r => setTimeout(r, 2500));
      const img = document.querySelector('img[src*="content/figures/"]');
      return { id: q.id, found: !!img, complete: !!img && img.complete,
               px: img ? img.naturalWidth : 0 };
    });
    await ctx.setOffline(false);
    ok('offline, a figure never visited this session still draws',
       cold.found && cold.complete && cold.px > 500,
       `${cold.id} at ${cold.px}px`);
    await ctx.close();
  }

  head('memory: the whole bank is no longer resident');
  {
    const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
    const pwaHeap = await heapAfterBoot(page, target);
    await page.close();
    if (pwaHeap === null) {
      unmeasurable('the shell\'s heap after boot',
                   `${engineName()} has no heap profiler — run this section on chromium`);
    } else if (baseline) {
      const p2 = await browser.newPage({ viewport: { width: 900, height: 1000 } });
      const baseHeap = await heapAfterBoot(p2, 'file://' + path.resolve(baseline));
      await p2.close();
      ok('heap is materially lower than the single-file build',
         pwaHeap > 0 && baseHeap > 0 && pwaHeap < baseHeap * 0.6,
         `${mb(baseHeap)} → ${mb(pwaHeap)}`);
    } else {
      ok('heap after boot is under 40 MB', pwaHeap > 0 && pwaHeap < 40 * 1048576, mb(pwaHeap));
    }
  }

  head('a bootloader that could not start the app installs nothing');
  /* The two failure paths in the bootloader were written to the same shape and
     only one of them kept it: the content-fetch failure returns out of the
     async function, the app.js-load failure did not, so execution carried on
     into the service-worker registration below it and installed a worker for
     an application that had never started. Nothing visibly broke — which is
     why it survived — but the next launch is then served by a worker whose
     whole job is to cache a shell that could not run.

     Driven by refusing app.js at the network, which is what a half-deployed
     site or a truncated download actually looks like. A fresh context, because
     registrations are per-origin and every other section here installs one. */
  {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
    const page = await ctx.newPage();
    await page.route('**/app.js', r => r.abort());
    await page.goto(ORIGIN + '/index.html', { waitUntil: 'load', timeout: 120000 });
    const shown = await page.waitForFunction(
      () => /failed to load/i.test(document.body.textContent || ''), { timeout: 30000 })
      .then(() => true, () => false);
    ok('the failure reaches the splash instead of a blank screen', shown);
    /* Long enough for a registration to have happened if one were going to:
       register() is called synchronously on the line after, and the section
       below proves the same wait is enough to see one when it is there. */
    await page.waitForTimeout(2500);
    const supported = await page.evaluate(() => 'serviceWorker' in navigator);
    if (!supported) {
      unmeasurable('no worker is registered for an app that never started',
                   'this engine has no navigator.serviceWorker');
      unmeasurable('and a healthy load still registers one', 'the same');
    } else {
      const regs = await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(r => r.length));
      ok('no worker is registered for an app that never started', regs === 0,
         `${regs} registration(s)`);
      /* THE HALF THAT STOPS A BROKEN REGISTRATION PASSING. Zero is also what a
         build that never registers anything would score, so the same context
         loads the page without the block and has to reach one. */
      const healthy = await ctx.newPage();
      await healthy.goto(ORIGIN + '/index.html', { waitUntil: 'load', timeout: 120000 });
      await healthy.waitForFunction(() => typeof S !== 'undefined', { timeout: 120000 });
      const after = await healthy.evaluate(async () => {
        for (let i = 0; i < 50; i++) {
          const r = await navigator.serviceWorker.getRegistrations();
          if (r.length) return r.length;
          await new Promise(res => setTimeout(res, 100));
        }
        return 0;
      });
      ok('and a healthy load still registers one', after > 0, `${after} registration(s)`);
      await healthy.close();
    }
    await ctx.close();
  }

  head('the figure cache the AI path fills has a lid on it');
  /* WHAT THIS IS ABOUT. figuresAsDataUrls() base64s a question's figures for
     the Messages API, which cannot take a URL it has no access to, and cached
     the result per question id — for the life of the tab, with no bound. Base64
     is a third larger again than the bytes on the wire, and a fellow working
     through a chapter with Apex open touches dozens of questions in a sitting.
     An iPad reclaims memory by killing the tab rather than by asking.
     
     Re-resolving costs nothing worth saving: the service worker has the figure,
     so a miss is a cache read rather than a download. The cache only has to
     cover an agent loop sending the same figures several times in a row. */
  {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto(target, { waitUntil: 'load', timeout: 200000 });
    await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'),
                               { timeout: 120000 });
    await page.evaluate(() => navigator.serviceWorker.ready);

    const lid = await page.evaluate(async () => {
      const withFigs = ALL_Q.filter(q => q.img && IMGS[q.id] && IMGS[q.id].length).slice(0, 40);
      if (withFigs.length < 30) return { skipped: withFigs.length };
      for (const q of withFigs) await figuresAsDataUrls(q);
      /* Ask again for the one requested LAST of the first batch: under
         least-recently-used it is long gone, and under insertion-order-only it
         would also be gone — so the discriminating probe is the one below. */
      return { asked: withFigs.length, size: _figDataCache.size,
               cap: FIG_CACHE_MAX_ENTRIES, bytes: _figCacheBytes, byteCap: FIG_CACHE_MAX_BYTES,
               newestKept: _figDataCache.has(withFigs[withFigs.length - 1].id),
               oldestDropped: !_figDataCache.has(withFigs[0].id) };
    });
    if (lid.skipped !== undefined) {
      unmeasurable('the cache stops growing', `only ${lid.skipped} questions in this bank carry figures`);
      unmeasurable('and it keeps the newest rather than the first', 'the same');
      unmeasurable('it is least-recently-USED, not merely first-in-first-out', 'the same');
    } else {
      ok('the cache stops growing', lid.size <= lid.cap,
         `${lid.size} entries after ${lid.asked} questions, cap ${lid.cap}`);
      ok('and its bytes stay under the budget', lid.bytes <= lid.byteCap,
         `${(lid.bytes / 1048576).toFixed(1)} MB of ${(lid.byteCap / 1048576).toFixed(0)} MB`);
      ok('and it keeps the newest rather than the first',
         lid.newestKept === true && lid.oldestDropped === true,
         `newest kept ${lid.newestKept}, oldest dropped ${lid.oldestDropped}`);

      /* THE CHECK THAT TELLS LRU FROM FIFO, and the reason it matters: an agent
         loop asks for the SAME question's figures on every iteration. Under
         first-in-first-out a question asked about repeatedly is still evicted on
         schedule and re-resolved every time; under least-recently-used it stays.
         Re-touch one, fill past the cap, and see whether it survived. */
      const lru = await page.evaluate(async () => {
        const withFigs = ALL_Q.filter(q => q.img && IMGS[q.id] && IMGS[q.id].length);
        const keep = withFigs.find(q => _figDataCache.has(q.id));
        if (!keep) return { skipped: true };
        await figuresAsDataUrls(keep);                       // touched: now newest
        const fresh = withFigs.filter(q => !_figDataCache.has(q.id)).slice(0, FIG_CACHE_MAX_ENTRIES - 1);
        for (const q of fresh) await figuresAsDataUrls(q);   // fill to the cap around it
        return { skipped: false, survived: _figDataCache.has(keep.id), pushed: fresh.length };
      });
      ok('it is least-recently-USED, not merely first-in-first-out',
         lru.skipped ? false : lru.survived === true,
         lru.skipped ? 'nothing was in the cache to re-touch' : `${lru.pushed} newer entries pushed in after it`);
    }

    /* The limits exist as named numbers rather than as literals buried in the
       resolver, because the next person to tune them should not have to find
       them by reading the fetch. */
    const limits = await page.evaluate(() => ({
      timeout: typeof FIG_FETCH_TIMEOUT_MS === 'number' ? FIG_FETCH_TIMEOUT_MS : null,
      maxBytes: typeof FIG_MAX_BYTES === 'number' ? FIG_MAX_BYTES : null,
    }));
    ok('a figure fetch cannot hang a turn forever', limits.timeout > 0 && limits.timeout <= 60000,
       `${limits.timeout}ms`);
    /* Above the largest figure in the bank and far below anything that hurts. */
    ok('and an enormous one is refused rather than base64ed to find out',
       limits.maxBytes >= 1048576 && limits.maxBytes <= 32 * 1048576,
       `${(limits.maxBytes / 1048576).toFixed(0)} MB`);
    await ctx.close();
  }

  head('a shell and a code file from different builds do not run together');
  /* THE WINDOW THIS CLOSES. sw.js serves the shell cache-first and refreshes it
     in the background, one request at a time. A deploy that lands between the
     request for index.html and the request for app.js leaves a launch running
     one build's HTML against the other build's code — and because the refresh
     writes each file as it arrives, the mixed pair persists in the cache until
     something replaces it. Nothing crashes. The app behaves like neither
     version, which is worse, because there is nothing to report.
     
     Both files now carry a stamp taken over the shell digest and the content
     digest together, so any change to either moves it. Driven here by serving
     an app.js from a build that does not exist, which is exactly what the
     browser would have been handed. */
  {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
    const page = await ctx.newPage();
    let loads = 0;
    page.on('framenavigated', f => { if (f === page.mainFrame()) loads++; });
    /* One character different is a different build. */
    await page.route('**/app.js', async route => {
      const res = await route.fetch();
      const body = (await res.text()).replace(/var APP_BUILD_ID='[a-f0-9]+'/,
                                              "var APP_BUILD_ID='0000000000000000'");
      await route.fulfill({ response: res, body });
    });
    await page.goto(target, { waitUntil: 'load', timeout: 200000 });
    /* It reloads once, finds the same mismatch, and must then STOP and say so
       rather than spin. Waiting on the message, not on a stopwatch. */
    const told = await page.waitForFunction(
      () => /updated while it was opening/i.test(document.body.textContent || ''),
      null, { timeout: 30000 }).then(() => true, () => false);
    ok('a mixed pair is noticed rather than run', told);
    /* The loop guard, which is the half that makes this safe to ship: exactly
       one retry. A reload that does not fix it must never become a reload
       that never stops. */
    await page.waitForTimeout(2500);
    ok('and it retries once, not forever', loads <= 3, `${loads} navigations`);
    const flagged = await page.evaluate(() => {
      try { return sessionStorage.getItem('accsap-mixed-build'); } catch (_) { return 'unreadable'; }
    });
    ok('the retry is remembered per tab, so the reload cannot loop', flagged === '1', String(flagged));
    await ctx.close();
  }

  head('and the three files a deploy writes agree on which build they are');
  {
    /* Read off the served directory rather than the page: this is a property of
       the artifact, and it is the one a person can check by hand on a server. */
    const shell = await (await fetch(new URL('index.html', target).href)).text();
    const app = await (await fetch(new URL('app.js', target).href)).text();
    const sw = await (await fetch(new URL('sw.js', target).href)).text();
    const idOf = (src, re) => (re.exec(src) || [])[1] || null;
    const a = idOf(shell, /SHELL_BUILD_ID = '([a-f0-9]+)'/);
    const b = idOf(app, /var APP_BUILD_ID='([a-f0-9]+)'/);
    const c = idOf(sw, /const BUILD_ID\s*=\s*'([a-f0-9]+)'/);
    ok('index.html carries a build stamp', !!a, a || 'absent');
    ok('app.js carries one too', !!b, b || 'absent');
    ok('and so does the worker', !!c, c || 'absent');
    ok('all three are the same build', !!a && a === b && b === c, `${a} / ${b} / ${c}`);
    /* And it is derived from both digests, so a content-only change moves it —
       which is the whole reason it is not just the shell digest again. */
    const shellV = idOf(sw, /const SHELL_V\s*=\s*'([a-f0-9]+)'/);
    ok('the stamp is not merely the shell digest under another name',
       !!shellV && a !== shellV, `build ${a}, shell ${shellV}`);
  }

  head('the split build fits the screen it is held on');
  /* WHY THIS IS HERE AND NOT IN verify-home. verify-home tests whichever target
     the runner was given, and the screen that overflowed was the SPLIT build
     specifically — it is the only one with an offline-download card, because it
     is the only one whose figures are not already data: URIs in memory. --pwa is
     the only run that always has a served build, so this is where the claim can
     be made unconditionally.

     1194x834 is an 11-inch iPad in landscape: the widest and shortest shape the
     app is held in, and the one the landscape grid is written for. It measured
     97px over — the hero's axis (step 81) took 50 of that and moving the card to
     Progress (step 82) took the rest. */
  {
    const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 } });
    const page = await ctx.newPage();
    await page.goto(target, { waitUntil: 'load', timeout: 200000 });
    await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'),
                               { timeout: 120000 });
    await page.evaluate(() => { goHome(); render(); });
    /* verify-home's settle, for the same reason it has one: a box that has held
       still for five frames with no finite animation running is settled, and a
       fixed sleep is a guess that passes on a fast machine and lies on a slow
       one. */
    await page.waitForFunction(() => {
      const r = document.getElementById('app').getBoundingClientRect();
      const k = [innerWidth, innerHeight, Math.round(r.width), Math.round(r.height),
                 document.documentElement.scrollHeight].join(',');
      const busy = document.getAnimations().some(a => a.playState === 'running' &&
        Number.isFinite(a.effect && a.effect.getTiming().iterations));
      window.__s = (window.__l === k && !busy) ? (window.__s || 0) + 1 : 0;
      window.__l = k;
      return window.__s >= 5;
    }, null, { timeout: 15000, polling: 'raf' });
    /* FIRST RUN AND EVERY RUN AFTER IT ARE DIFFERENT SCREENS, and only one of
       them is a standing property. A brand-new install also carries the welcome
       card — "New here?", with a Got it button — which is 130px and goes away
       for good the moment it is tapped. The screen that has to fit is the one a
       fellow sees every day, so that is what is asserted; the first-run number
       is measured too and printed beside it, because a cost nobody prints is a
       cost nobody notices growing. */
    const firstRun = await page.evaluate(() => ({
      over: document.documentElement.scrollHeight - innerHeight,
      hello: !!document.querySelector('.hello'),
    }));
    await page.evaluate(() => { try { dismissHello(); } catch (_) {} goHome(); render(); });
    await page.waitForFunction(() => !document.querySelector('.hello'), null, { timeout: 15000 });
    await page.waitForFunction(() => {
      const r = document.getElementById('app').getBoundingClientRect();
      const k = [innerWidth, innerHeight, Math.round(r.width), Math.round(r.height),
                 document.documentElement.scrollHeight].join(',');
      const busy = document.getAnimations().some(a => a.playState === 'running' &&
        Number.isFinite(a.effect && a.effect.getTiming().iterations));
      window.__s2 = (window.__l2 === k && !busy) ? (window.__s2 || 0) + 1 : 0;
      window.__l2 = k;
      return window.__s2 >= 5;
    }, null, { timeout: 15000, polling: 'raf' });
    const m = await page.evaluate(() => ({
      over: document.documentElement.scrollHeight - innerHeight,
      card: !!document.getElementById('offlineCard'),
      appW: Math.round(document.getElementById('app').getBoundingClientRect().width),
      vw: innerWidth,
    }));
    ok('an 11-inch iPad in landscape needs no scrolling on the home screen',
       m.over <= 0, `${m.over}px over — first run, with the welcome card, was ${firstRun.over}px`);
    /* The half that stops this being satisfied by an empty screen: it must still
       be using the width, which is what the landscape layout is for. */
    ok('and it is still filling the width while it does',
       m.appW / m.vw > 0.9, `${m.appW} of ${m.vw}`);
    ok('the card that used to overflow it is on Progress instead', m.card === false);
    /* render() goes through startViewTransition, so the markup it produces lands
       in an async callback and is NOT in the document when goStats() returns. */
    const onStats = await page.evaluate(() => { goStats(); }).then(() =>
      page.waitForFunction(() => !!document.getElementById('offlineCard'), null, { timeout: 15000 })
        .then(() => true, () => false));
    ok('and it really is there, rather than merely gone', onStats === true);
    await ctx.close();
  }

  head('the server that hosts this cannot be walked out of');
  /* docs/IPAD.md offers scripts/serve.js as a hosting route over Tailscale, so
     its root guard is load-bearing rather than a development convenience. It
     was `file.startsWith(DIR)` with no trailing separator, which also accepts
     any SIBLING whose name merely begins with the root's — "/../dist-old/x"
     escaped a root of "dist". path.join has already collapsed the "..", so the
     separator is the entire check. Requested with the raw path, because a
     normalising client would resolve the traversal before it was ever sent. */
  {
    const raw = p => new Promise(resolve => {
      const http = require('http'), u = new URL(ORIGIN);
      const req = http.request({ host: u.hostname, port: u.port, path: p, method: 'GET' },
        r => { let b = ''; r.on('data', d => b += d); r.on('end', () => resolve({ status: r.statusCode, body: b })); });
      req.on('error', () => resolve({ status: 0, body: '' }));
      req.end();
    });
    const control = await raw('/index.html');
    ok('a file inside the root is still served', control.status === 200, String(control.status));
    const sibling = await raw('/../dist-old/secret.txt');
    ok('a sibling directory sharing the root\'s name prefix is refused',
       sibling.status === 403 || sibling.status === 404, String(sibling.status));
    const outside = await raw('/../../etc/hostname');
    ok('and so is a plain walk upwards', outside.status === 403 || outside.status === 404, String(outside.status));
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`
              + (unmeasured ? `, ${unmeasured} not measurable on ${engineName()}` : ''));
  process.exit(failed ? 1 : 0);
})();
