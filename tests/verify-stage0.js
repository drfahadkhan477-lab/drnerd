#!/usr/bin/env node
/*
 * Behavioural checks for a Stage 0 patched build.
 *
 *   node tests/verify-stage0.js /path/to/ACCSAP_12_v13.html
 *
 * Runs the app in a real browser with the network cut off and asserts the
 * things Stage 0 claims: no requests on launch, embedded fonts actually
 * resolving, observers released, ink simplified, practice separated from
 * review, and the log recording prior card state.
 *
 * Requires Playwright:  NODE_PATH=$(npm root -g) node tests/verify-stage0.js …
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const target = process.argv[2];
if (!target) {
  console.error('usage: node tests/verify-stage0.js <patched.html>');
  process.exit(1);
}
/* Accepts a path (single-file build) or an http URL (the Stage 1 PWA
   build, which has to be served because it fetches its content). */
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });

  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  /* The guarantee is that the app has no THIRD-PARTY network dependency — no
     Google Fonts, no CDN — so a hospital portal or a plane cannot stall it.
     For the single-file build that means nothing but file:// and data: may
     resolve. For the Stage 1 build the app legitimately fetches its own
     content, so the same guarantee is "nothing off-origin". */
  const ownOrigin = /^https?:\/\//.test(target) ? new global.URL(target).origin : null;
  const isOwn = u => u.startsWith('file://') || u.startsWith('data:') ||
                     (ownOrigin && u.startsWith(ownOrigin));
  page.on('request', r => { if (!isOwn(r.url())) external.push(r.url()); });

  await page.route('**', route => {
    isOwn(route.request().url()) ? route.continue() : route.abort();
  });

  // Instrument observers before any page script runs.
  await page.addInitScript(() => {
    window.__made = 0; window.__gone = 0;
    const R = window.ResizeObserver;
    window.ResizeObserver = class extends R {
      constructor(f) { super(f); window.__made++; }
      disconnect() { window.__gone++; return super.disconnect(); }
    };
  });

  head('launch, with the network cut off');
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  /* The Stage 1 build injects app.js only after its content fetch resolves,
     so 'load' no longer implies the app has booted. Wait for it explicitly —
     a no-op on the single-file build, where this is already true. */
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('.hero-h1'), { timeout: 60000 });
  const launchMs = Date.now() - t0;
  await page.waitForTimeout(1200);
  ok('boots with no JS errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  ok('makes zero third-party network requests', external.length === 0, external.slice(0, 2).join(' | '));
  ok('launches without stalling', launchMs < 5000, (launchMs / 1000).toFixed(1) + 's');

  head('embedded typefaces');
  const fonts = await page.evaluate(async () => {
    const out = {};
    for (const fam of ['DM Sans', 'DM Serif Display', 'JetBrains Mono']) {
      const loaded = await document.fonts.load('16px "' + fam + '"');
      out[fam] = loaded.length;
    }
    const mk = ff => {
      const s = document.createElement('span');
      s.style.cssText = 'position:absolute;font:400 40px ' + ff;
      s.textContent = 'Cardiology 123';
      document.body.appendChild(s);
      const w = Math.round(s.getBoundingClientRect().width);
      s.remove();
      return w;
    };
    out.widths = { sans: mk('"DM Sans"'), serif: mk('"DM Serif Display"'), mono: mk('"JetBrains Mono"') };
    return out;
  });
  ok('all three faces resolve offline',
    fonts['DM Sans'] > 0 && fonts['DM Serif Display'] > 0 && fonts['JetBrains Mono'] > 0);
  ok('faces render with distinct metrics (no silent fallback)',
    new Set(Object.values(fonts.widths)).size === 3, JSON.stringify(fonts.widths));

  head('ink is rounded and simplified');
  const ink = await page.evaluate(() => {
    const raw = [];
    for (let i = 0; i < 200; i++) raw.push([0.1 + i * 0.003, 0.5 + Math.sin(i / 9) * 0.02, 0.5123456]);
    const rounded = raw.map(roundPt);
    const s = simplifyStroke({ t: 'pen', c: '#000', p: rounded.slice() });
    return { pts: raw.length, kept: s.p.length, sample: s.p[1],
             rawLen: JSON.stringify(raw).length, after: JSON.stringify(s.p).length };
  });
  ok('coordinates rounded to 4dp', String(ink.sample[0]).length <= 7, JSON.stringify(ink.sample));
  ok('redundant points dropped', ink.kept < ink.pts, ink.pts + ' → ' + ink.kept + ' points');
  ok('stored ink shrinks materially', ink.after < ink.rawLen / 3,
    (ink.rawLen / ink.after).toFixed(1) + '× smaller');

  head('observers are released');
  const leak = await page.evaluate(async () => {
    startQuiz('Arrhythmias');
    await new Promise(r => setTimeout(r, 200));
    const m0 = window.__made, g0 = window.__gone;
    for (let i = 0; i < 40; i++) render();
    await new Promise(r => setTimeout(r, 400));
    render();
    await new Promise(r => setTimeout(r, 200));
    return { made: window.__made - m0, gone: window.__gone - g0, live: INK_HOSTS.size };
  });
  ok('every observer created is disconnected again', leak.made - leak.gone <= 4,
    leak.made + ' created, ' + leak.gone + ' disconnected, ' + leak.live + ' live hosts');

  head('practice records, review schedules');
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  /* The Stage 1 build injects app.js only after its content fetch resolves,
     so 'load' no longer implies the app has booted. Wait for it explicitly —
     a no-op on the single-file build, where this is already true. */
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
  await page.waitForTimeout(1200);
  const practice = await page.evaluate(() => {
    startQuiz('Pericardial Disease');
    const q = S.questions[0];
    selectOpt(q.ci);
    return { srs: Object.keys(S.srs).length, practiced: Object.keys(S.practice).length,
             logged: LOG.length, entry: LOG[LOG.length - 1],
             mastery: masteryFor('Pericardial Disease'), started: startedCount() };
  });
  ok('practice writes no SRS card', practice.srs === 0);
  ok('practice attempt recorded', practice.practiced === 1);
  ok('answer written to the review log',
    practice.logged === 1 && practice.entry.m === 'practice' && practice.entry.g === null);
  ok('mastery still moves on practice', practice.mastery > 0, practice.mastery.toFixed(3));
  ok('started count includes practice', practice.started === 1);

  const review = await page.evaluate(() => {
    startQuiz(null, 'due');
    const q = S.questions[0];
    selectOpt(q.ci);
    const before = LOG.length;
    rateReview(4);
    return { card: S.srs[q.id], entry: LOG[before], day: S.daily[todayISO()] };
  });
  ok('rating schedules the card', !!review.card && review.card.reps === 1);
  ok('card records its last-review date', !!(review.card && review.card.last), review.card.last);
  ok('log captures grade and prior state',
    review.entry.g === 4 && review.entry.m === 'review' && review.entry.reps === 0);
  ok('rated counter increments', review.day.r === 1);

  head('durable storage and backup state');
  const storage = await page.evaluate(() => {
    goStats(); render();
    const hint = document.querySelector('.ref-hint');
    return { persisted: PERSISTED, hint: hint ? hint.innerText.split('\n')[0] : '' };
  });
  ok('persistence requested at boot', storage.persisted !== undefined, 'granted=' + storage.persisted);
  ok('progress screen shows log size and backup age', /reviews logged/.test(storage.hint), storage.hint);

  head('export carries the log');
  const exported = await page.evaluate(() => {
    let blob = null;
    const create = URL.createObjectURL, click = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = b => { blob = b; return 'blob:stub'; };
    HTMLAnchorElement.prototype.click = function () {};
    exportMarkup();
    URL.createObjectURL = create; HTMLAnchorElement.prototype.click = click;
    return blob ? blob.text().then(t => {
      const d = JSON.parse(t);
      return { v: d.v, hasLog: Array.isArray(d.log), n: d.log.length, since: S.sinceBackup };
    }) : null;
  });
  ok('export includes the review log', exported && exported.hasLog && exported.n > 0,
    'v' + (exported && exported.v) + ', ' + (exported && exported.n) + ' entries');
  ok('backup counter resets on export', exported && exported.since === 0);

  head('regression: the rest of the app still works');
  await page.evaluate(() => { openSearch(); runSearch('amyloidosis'); render(); });
  await page.waitForTimeout(400);
  ok('search returns hits', (await page.locator('.hit').count()) > 0);
  await page.evaluate(() => { goLab(); render(); });
  await page.waitForTimeout(400);
  ok('rhythm lab mounts', (await page.locator('#labCanvas').count()) === 1);
  await page.evaluate(() => { const q = ALL_Q.find(x => x.img > 0); jumpTo(q.id); });
  await page.waitForTimeout(900);
  const figs = await page.evaluate(() => ({
    n: document.querySelectorAll('.fig-card').length,
    decoded: [...document.querySelectorAll('.fig-img')].every(i => i.complete && i.naturalWidth > 0),
  }));
  ok('figures render and decode', figs.n > 0 && figs.decoded, figs.n + ' figure(s)');
  const inkPersist = await page.evaluate(async () => {
    const q = currentQ();
    INK[q.id + ':q'] = [{ t: 'pen', c: '#EF4444', p: [[0.1, 0.1, 0.5], [0.5, 0.5, 0.5]] }];
    saveJSON(INK_KEY, INK);
    render(); await new Promise(r => setTimeout(r, 400));
    return { canvas: !!document.querySelector('.q-card .ink-canvas'), marked: hasMarkup(q.id) };
  });
  ok('ink re-attaches after a render', inkPersist.canvas && inkPersist.marked);
  ok('no errors across the whole run', errors.length === 0, errors.slice(0, 2).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
