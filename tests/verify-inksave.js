#!/usr/bin/env node
/*
 * The ink is saved when the pen has been still, and not at every pen-up.
 *
 *   node tests/verify-inksave.js build/synthetic/systole.html
 *
 * Saving the ink hands IndexedDB the whole store, which clones everything ever written on the main thread, inside the put. Measured with
 * nothing else running, headless, as the median of five puts: 24 ms on Chromium and 84 on WebKit at three thousand strokes, 88 and 316 at
 * twelve thousand, 273 and 764 at twenty-five thousand, every time the pen was lifted. That is when the next stroke begins, and its first points waited behind the
 * clone; and a sweep of the eraser over ten strokes did it ten times. The strokes are in INK, which the screen reads, from the moment they
 * are drawn, so only the copy in the database needs to wait.
 *
 * It waits until the pen has been still for 900 ms, and never longer than 10 s after the first stroke not yet saved; hiding the page,
 * closing it and exporting save it at once; and before the store has hydrated, when a save is the one the store merges under what it then
 * reads (src/core/store.js), it is made at once as well. This holds each of those, counting the puts of the ink key and reading the
 * database back, which is the thing that was slow and the thing that must not be lost:
 *   · a stroke lifted writes nothing yet, and is in the ink the screen reads; once the pen has been still it is written, once, and the
 *     database holds it; ten strokes a tenth of a second apart are one write, and the database holds all of them;
 *   · writing that never pauses for 900 ms still reaches the database, after about 10 s;
 *   · hiding the page and closing it write at once, what was drawn last included;
 *   · three undos in a row are one write, and the database holds what is left;
 *   · an eraser swept over five strokes is one write, and the database holds what is left;
 *   · an export holds a stroke not yet saved, and saves it;
 *   · before hydration a save is made at once.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, onScreen, quiet, watchTransitions } = require('./_render.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-inksave.js <build.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

/* Before the page's own scripts: the time of every put of the ink key. */
const INIT = () => {
  window.__puts = [];
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, key) {
    if (key === 'accsap12.ink') window.__puts.push(performance.now());
    return put.apply(this, arguments);
  };
};

/* In the page: how many strokes the database holds for the ink, read through a connection of its own. */
const STORED = `new Promise(resolve => {
  const open = indexedDB.open('accsap12.store');
  open.onerror = () => resolve(null);
  open.onsuccess = () => {
    const db = open.result; let get;
    try { get = db.transaction('kv', 'readonly').objectStore('kv').get('accsap12.ink'); } catch (_) { db.close(); return resolve(null); }
    get.onsuccess = () => { const v = get.result; db.close(); resolve(v ? Object.values(v).reduce((n, a) => n + a.length, 0) : 0); };
    get.onerror = () => { db.close(); resolve(null); };
  };
})`;

(async () => {
  const browser = await launch();
  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));
  const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 } });
  const page = watch(await ctx.newPage(), events, 'main');
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(INIT);
  await watchTransitions(page);   /* before goto: see _render.js */
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);
  await quiet(page);

  const puts = () => page.evaluate(() => window.__puts.length);
  const stored = () => page.evaluate(STORED);
  const live = () => page.evaluate(() => Object.values(INK).reduce((n, a) => n + a.length, 0));
  const settle = async () => { await page.evaluate(() => (window.__vtLive && window.__vtLive.finished ? window.__vtLive.finished.catch(() => {}) : null)); await quiet(page); };
  /* Waits for the n-th put, and says whether it came. A wait is a precondition: what is claimed is the count read afterwards. */
  const putBy = (n, ms) => page.waitForFunction(n => window.__puts.length >= n, n, { timeout: ms }).then(() => true, () => false);
  const storedBy = async (n, ms = 2500) => { const end = Date.now() + ms; let v; do { v = await stored(); if (v === n) return v; await page.waitForTimeout(50); } while (Date.now() < end); return v; };

  head('the store the writes go to');
  await page.evaluate(() => Store.ready());
  await page.evaluate(() => { startAdhocQuiz(POOL.filter(q => q.o.length >= 4 && !q.imgopt).slice(0, 4), null); });
  await onScreen(page, 'quiz', { marker: '.q-card' });
  await settle();
  await page.evaluate(() => railAction('pen'));
  await settle();
  await page.evaluate(() => { window.__puts.length = 0; });
  {
    const s = await page.evaluate(() => ({ hydrated: Store.isHydrated(), available: Store.available(), pen: T.active }));
    ok('the store is hydrated and is the database, and the pen is up, so what follows is about writes to the database', s.hydrated && s.available && s.pen, JSON.stringify(s));
  }
  const cv = page.locator('.q-card .ink-canvas');
  await cv.scrollIntoViewIfNeeded();
  await settle();
  const box = await cv.boundingBox();
  /* A stroke of the mouse across the card: pointerdown, three moves, pointerup. */
  const stroke = async y => {
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * y);
    await page.mouse.down();
    for (let i = 1; i <= 3; i++) await page.mouse.move(box.x + box.width * (0.2 + i * 0.12), box.y + box.height * (y + (i % 2 ? 0.04 : -0.02)));
    await page.mouse.up();
  };

  head('a stroke');
  {
    await stroke(0.3);
    await page.waitForTimeout(100);                                 // well inside the 900 ms: a write at pen-up would have been made by now
    const n = await puts(), l = await live();
    ok('lifting the pen writes nothing to the database yet, and the stroke is already in the ink the screen reads', n === 0 && l === 1, `${n} writes, ${l} strokes in INK`);
    const came = await putBy(1, 3000);
    await page.waitForTimeout(400);
    const after = await puts(), db = await storedBy(1);
    ok('once the pen has been still it is written, once, and the database holds the stroke', came && after === 1 && db === 1, `${after} writes, ${db} strokes in the database`);
  }

  head('writing');
  {
    for (let i = 0; i < 10; i++) { await stroke(0.2 + (i % 5) * 0.1); await page.waitForTimeout(100); }
    const during = await puts();
    const came = await putBy(2, 3000);
    await page.waitForTimeout(400);
    const after = await puts(), db = await storedBy(11);
    ok('ten strokes a tenth of a second apart are not written while the pen is moving, and are one write when it stops that holds all of them', during === 1 && came && after === 2 && db === 11, `${during} writes before the pause, ${after} after, ${db} strokes in the database`);
  }

  head('writing that never pauses');
  {
    /* A stroke added and the save asked for every 400 ms for 11.2 s: the pen is never still for 900 ms, so only the ceiling can write. */
    const times = await page.evaluate(async () => {
      const key = currentQ().id + ':q', base = window.__puts.length, t0 = performance.now();
      for (let i = 0; i < 28; i++) {
        (INK[key] || (INK[key] = [])).push({ t: 'pen', c: '#EF4444', sz: 'M', p: [[0.1, 0.1, 0.5, 0], [0.2, 0.2, 0.5, 0]] });
        saveInkSoon();
        await new Promise(r => setTimeout(r, 400));
      }
      return window.__puts.slice(base).map(t => Math.round(t - t0));
    });
    ok('the ceiling writes it, once, after about ten seconds and not before, though the pen was never still', times.length >= 1 && times.length <= 2 && times[0] >= 9000 && times[0] <= 11800, `writes at ${JSON.stringify(times)} ms`);
    await putBy(2 + times.length + 1, 3000);
    await page.waitForTimeout(300);
  }

  head('undoing');
  {
    /* Three undos in a row, as a hand does it: each takes the last stroke off, none writes, and once the pen has been still one write holds what is left. */
    const before = await puts(), l = await live();
    for (let i = 0; i < 3; i++) await page.evaluate(() => railAction('undo'));
    await page.waitForTimeout(100);
    const during = (await puts()) - before, now = await live();
    const came = await putBy(before + 1, 3000);
    await page.waitForTimeout(400);
    const total = (await puts()) - before, db = await storedBy(now);
    ok('three undos in a row are no write while they come and one when they stop, and the database holds what is left', now === l - 3 && during === 0 && came && total === 1 && db === now, `${l} strokes, ${now} after the undos; ${during} writes during them, ${total} after; ${db} in the database`);
  }

  /* AT ONCE IS READ FROM THE CLOCK. Without a flush the pen's own pause writes the stroke 900 ms after it was drawn, and a wait that is long enough
     for a write to come would take that one for the flush's; so the write is timed from the moment the event is sent, and has to come within
     LAG ms of it. The event is sent 50 ms after the stroke, so a write that is the pause's comes about 850 ms later, and LAG is a third of that. */
  const LAG = 300;
  const writeAfter = async (send, before) => {
    const came = await putBy(before + 1, 2500);
    const t = await page.evaluate(n => ({ put: window.__puts[n], sent: window.__sentAt }), before);
    return { came, ms: came ? Math.round(t.put - t.sent) : null };
  };

  head('leaving the page');
  {
    await stroke(0.6);
    await page.waitForTimeout(50);
    const before = await puts(), l = await live();
    await page.evaluate(() => { window.__sentAt = performance.now(); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    const w = await writeAfter(null, before);
    await page.evaluate(() => { delete document.visibilityState; });
    const db = await storedBy(l);
    ok('hiding the page writes at once, and what was drawn last is in the database', w.came && w.ms < LAG && db === l, `the write came ${w.ms} ms after the page was hidden (within ${LAG}); ${db} of ${l} strokes in the database`);
    await page.waitForTimeout(1000);                                  // the pause that follows is a write of nothing new: let it pass

    await stroke(0.7);
    await page.waitForTimeout(50);
    const before2 = await puts(), l2 = await live();
    await page.evaluate(() => { window.__sentAt = performance.now(); window.dispatchEvent(new Event('pagehide')); });
    const w2 = await writeAfter(null, before2);
    const db2 = await storedBy(l2);
    ok('and so does closing it', w2.came && w2.ms < LAG && db2 === l2, `the write came ${w2.ms} ms after the page was closed (within ${LAG}); ${db2} of ${l2} strokes in the database`);
    await page.waitForTimeout(1000);
  }

  head('erasing');
  {
    /* Five straight strokes, each beginning at x = 0.1, set down and written; then the eraser swept down that edge of the card. */
    await page.evaluate(() => {
      const key = currentQ().id + ':q';
      INK[key] = [0.2, 0.35, 0.5, 0.65, 0.8].map(y => ({ t: 'pen', c: '#EF4444', sz: 'M', p: [[0.1, y, 0.5, 0], [0.9, y, 0.5, 0]] }));
      INK = Object.assign({}, { [key]: INK[key] });
      saveInkNow(); repaintAll();
    });
    await storedBy(5);
    await page.evaluate(() => railAction('erase'));
    await settle();
    const before = await puts();
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.05);
    await page.mouse.down();
    for (let i = 0; i <= 80; i++) await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * (0.05 + i * 0.01));   // down to the last stroke, at 0.8
    await page.mouse.up();
    const during = (await puts()) - before, left = await live();
    const came = await putBy(before + 1, 3000);
    await page.waitForTimeout(400);
    const total = (await puts()) - before, db = await storedBy(left);
    ok('an eraser swept over five strokes is no write while it sweeps and one when it stops, and the database holds what is left', left < 5 && during === 0 && came && total === 1 && db === left, `${left} strokes left; ${during} writes during the sweep, ${total} after; ${db} in the database`);
    await page.evaluate(() => railAction('erase'));
  }

  head('exporting');
  {
    await page.evaluate(() => { if (!T.active || T.erase) railAction('pen'); });
    await settle();
    await stroke(0.4);
    await page.waitForTimeout(50);
    const before = await puts(), l = await live();
    const out = await page.evaluate(async () => {
      const create = URL.createObjectURL, click = HTMLAnchorElement.prototype.click; let blob = null;
      URL.createObjectURL = b => { blob = b; return 'blob:stub'; }; HTMLAnchorElement.prototype.click = () => {};
      window.__sentAt = performance.now();
      try { await exportMarkup(); } finally { URL.createObjectURL = create; HTMLAnchorElement.prototype.click = click; }
      const d = blob ? JSON.parse(await blob.text()) : null;
      return d ? Object.values(d.ink || {}).reduce((n, a) => n + a.length, 0) : null;
    });
    const w = await writeAfter(null, before);
    const db = await storedBy(l);
    ok('an export holds a stroke not yet saved, and saves it at once', out === l && w.came && w.ms < LAG && db === l, `${out} of ${l} strokes in the file; the save came ${w.ms} ms after the export began (within ${LAG}); ${db} in the database`);
  }

  head('before the store has hydrated');
  {
    const r = await page.evaluate(async () => {
      const real = Store.isHydrated, base = window.__puts.length, t0 = performance.now();
      Store.isHydrated = () => false;
      try {
        (INK[currentQ().id + ':q'] = INK[currentQ().id + ':q'] || []).push({ t: 'pen', c: '#EF4444', sz: 'M', p: [[0.3, 0.3, 0.5, 0], [0.4, 0.4, 0.5, 0]] });
        saveInkSoon();
        await new Promise(r => setTimeout(r, 400));
        return window.__puts.slice(base).map(t => Math.round(t - t0));
      } finally { Store.isHydrated = real; }
    });
    ok('a save asked for before the store has hydrated is made at once, and not after the pen has been still', r.length === 1 && r[0] < 350, `writes at ${JSON.stringify(r)} ms`);
  }

  head('nothing throws');
  ok('no page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
