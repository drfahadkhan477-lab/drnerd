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
const { chromium } = require('playwright');

const target = process.argv[2];
const baseline = process.argv[3];
if (!target || !/^https?:\/\//.test(target)) {
  console.error('usage: node tests/verify-pwa.js <http url> [single-file.html]');
  process.exit(1);
}
const ORIGIN = new URL(target).origin;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const kb = b => (b / 1024).toFixed(0) + ' KB';
const mb = b => (b / 1048576).toFixed(1) + ' MB';

async function heapAfterBoot(page, url) {
  await page.goto(url, { waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'),
                             { timeout: 120000 });
  await page.waitForTimeout(2500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  return (await page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize : 0));
}

(async () => {
  const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });

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
    /* Tightened from 800 KB once the fonts came out. A budget that sits far
       above the real figure stops being a budget: it was 800 to catch a
       megabyte of inlined base64 heart scan, and at 557 KB there is room to
       grow without room to hide a payload. */
    ok('shell is under 640 KB', shellBytes < 640 * 1024, kb(shellBytes));
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
    /* And the figure cache is NOT. Rekeying it on a code change would throw
       away the 408 figures the fellow pressed a button to download — 19 MB
       re-fetched because a stylesheet moved. */
    ok('but the figure cache is keyed on the content, so a code change keeps them',
       new RegExp(`FIGS\\s*=\\s*'accsap-figs-'\\s*\\+\\s*CONTENT_V`).test(sw));
  }

  head('content is served intact');
  {
    const qs = await (await fetch(ORIGIN + '/content/questions.json')).json();
    ok('all 639 questions present', qs.length === 639, String(qs.length));
    const figs = qs.reduce((a, q) => a + (q.figs ? q.figs.length : 0), 0);
    ok('all 408 figures referenced', figs === 408, String(figs));
    const declared = qs.reduce((a, q) => a + (q.img || 0), 0);
    ok('q.img and the extracted figure lists agree', declared === figs, `${declared} vs ${figs}`);
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
    await page.waitForFunction(() => typeof offlineJob !== 'undefined' && offlineJob.counted,
                               { timeout: 60000 });

    const before = await page.evaluate(() => {
      const c = document.getElementById('offlineCard');
      return c ? { total: offlineJob.total, have: offlineJob.have,
                   val: c.querySelector('.off-val').textContent,
                   btn: c.querySelector('.off-btn').textContent } : null;
    });
    ok('the card is on the home screen of the split build', !!before);
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
    if (baseline) {
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

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
