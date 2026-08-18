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
    const shellBytes = Buffer.byteLength(shellHtml) + Buffer.byteLength(appJs);
    ok('shell is under 800 KB', shellBytes < 800 * 1024, kb(shellBytes));
    if (baseline) {
      const before = require('fs').statSync(baseline).size;
      ok('and is a large fraction smaller than the single file',
         shellBytes < before / 20, `${mb(before)} → ${kb(shellBytes)}`);
    }
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
