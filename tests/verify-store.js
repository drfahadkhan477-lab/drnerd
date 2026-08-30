#!/usr/bin/env node
/*
 * Checks for the move off the localStorage cliff.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-store.js <patched.html|url>
 *
 * Four stores with no ceiling — the Pencil ink, the chat threads, the review
 * log and the sticky notes — shared a ~5 MB budget with everything else, and
 * the failure mode was silent: setItem throws, one toast, and every write after
 * that quietly does nothing.
 *
 * The claims worth defending are not "IndexedDB is used". They are:
 *
 *   · nothing is ever in neither place. The migration copies, reads back what
 *     it wrote, and only then removes the original — so an interrupted run
 *     leaves the data exactly where it was and simply tries again.
 *   · a write that lands before the database has answered is merged, not
 *     overwritten. A stroke drawn in that window is a real stroke.
 *   · with no database at all — private mode, a locked-down profile — the app
 *     behaves precisely as it did before, on localStorage.
 *
 * The database is manipulated directly where a test needs a specific starting
 * state, because a migration can only be checked from the state it starts in.
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-store.js <patched.html|url>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const boot = async page => {
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && typeof Store !== 'undefined', { timeout: 120000 });
  await page.evaluate(() => Store.ready());
  await page.waitForTimeout(250);
};

/* Read a key straight out of the database, so a test never has to trust the
   module it is testing to tell it what the module stored. */
const RAW = `key => new Promise(resolve => {
  const req = indexedDB.open('accsap12.store');
  req.onsuccess = () => {
    const d = req.result;
    const tx = d.transaction('kv', 'readonly');
    const r = tx.objectStore('kv').get(key);
    r.onsuccess = () => resolve(r.result === undefined ? null : r.result);
    r.onerror = () => resolve(null);
  };
  req.onerror = () => resolve(null);
})`;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text());
  });

  await boot(page);

  head('the database is there and in use');
  {
    const info = await page.evaluate(() => ({
      available: Store.available(), hydrated: Store.isHydrated(), managed: Store.MANAGED.slice(),
    }));
    ok('IndexedDB opened', info.available === true);
    ok('and the app is hydrated from it', info.hydrated === true);
    ok('the four large stores are the ones it manages',
       info.managed.join(',') === 'accsap12.ink,accsap12.notes,accsap12.chat,accsap12.log',
       info.managed.join(','));
    const bounded = await page.evaluate(() => Store.MANAGED.indexOf('accsap12.v2') < 0);
    ok('the scheduler is deliberately NOT one of them — it is bounded and read at boot', bounded);
  }

  head('what is written survives a launch');
  {
    await page.evaluate(() => {
      INK = { 'ARR_1:0': [{ p: [1, 2, 3], c: '#EF4444' }] };
      NOTES = { ARR_1: [{ id: 'n1', x: 10, y: 20, text: 'septal bounce' }] };
      LOG = [{ t: 1, q: 'ARR_1', g: 3, ok: 1 }];
      saveJSON(INK_KEY, INK); saveJSON(NOTE_KEY, NOTES); saveJSON(LOG_KEY, LOG);
      CHATS = { ARR_1: [{ role: 'user', content: 'why reverse use dependence?' }] };
      saveJSON(AI_CHAT, CHATS);
    });
    await page.waitForTimeout(400);
    const inDb = await page.evaluate(async raw => {
      const get = eval(raw);
      return {
        ink: await get('accsap12.ink'), notes: await get('accsap12.notes'),
        chat: await get('accsap12.chat'), log: await get('accsap12.log'),
        lsInk: localStorage.getItem('accsap12.ink'),
      };
    }, RAW);
    ok('the ink really is in the database', !!(inDb.ink && inDb.ink['ARR_1:0']));
    ok('and the notes', !!(inDb.notes && inDb.notes.ARR_1));
    ok('and the chat thread', !!(inDb.chat && inDb.chat.ARR_1));
    ok('and the review log', Array.isArray(inDb.log) && inDb.log.length === 1);
    ok('and none of it is duplicated back into localStorage', inDb.lsInk === null, String(inDb.lsInk));

    await boot(page);
    const back = await page.evaluate(() => ({
      ink: Object.keys(INK).length, notes: Object.keys(NOTES).length,
      chat: Object.keys(CHATS).length, log: LOG.length,
      note: (NOTES.ARR_1 || [])[0] && NOTES.ARR_1[0].text,
    }));
    ok('a relaunch finds the ink', back.ink === 1, String(back.ink));
    ok('and the notes, with their text', back.note === 'septal bounce', String(back.note));
    ok('and the chats', back.chat === 1, String(back.chat));
    ok('and the log', back.log === 1, String(back.log));
  }

  head('migrating what was already on the device');
  {
    /* Start from the world as it was: everything in localStorage, nothing in
       the database. */
    await page.evaluate(async raw => {
      const del = k => new Promise(res => {
        const req = indexedDB.open('accsap12.store');
        req.onsuccess = () => {
          const tx = req.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').delete(k);
          tx.oncomplete = () => res(); tx.onerror = () => res();
        };
        req.onerror = () => res();
      });
      for (const k of Store.MANAGED) await del(k);
      localStorage.setItem('accsap12.ink', JSON.stringify({ 'OLD_1:0': [{ p: [9] }] }));
      localStorage.setItem('accsap12.log', JSON.stringify([{ t: 7, q: 'OLD_1' }]));
    }, RAW);

    await boot(page);
    const after = await page.evaluate(async raw => {
      const get = eval(raw);
      return {
        dbInk: await get('accsap12.ink'), dbLog: await get('accsap12.log'),
        lsInk: localStorage.getItem('accsap12.ink'), lsLog: localStorage.getItem('accsap12.log'),
        liveInk: Object.keys(INK), liveLog: LOG.length,
      };
    }, RAW);
    ok('the old ink moved into the database', !!(after.dbInk && after.dbInk['OLD_1:0']));
    ok('the old log moved too', Array.isArray(after.dbLog) && after.dbLog.length === 1);
    ok('and only then was the localStorage copy removed',
       after.lsInk === null && after.lsLog === null);
    ok('the running app sees the migrated data, without a second reload',
       after.liveInk.indexOf('OLD_1:0') > -1 && after.liveLog === 1,
       after.liveInk.join(','));
  }

  head('a migration that was interrupted last time');
  {
    /* Both copies present: the database was written and the tab closed before
       localStorage was cleared. The database is the newer of the two by
       definition, and nothing may be lost. */
    await page.evaluate(() => {
      localStorage.setItem('accsap12.ink', JSON.stringify({ 'STALE:0': [{ p: [1] }] }));
    });
    await boot(page);
    const resolved = await page.evaluate(async raw => {
      const get = eval(raw);
      return { db: await get('accsap12.ink'), ls: localStorage.getItem('accsap12.ink'),
               live: Object.keys(INK) };
    }, RAW);
    ok('the database copy wins', !!(resolved.db && resolved.db['OLD_1:0']));
    ok('the stale localStorage copy does not overwrite it',
       !(resolved.db && resolved.db['STALE:0']));
    ok('and the leftover is finally cleared', resolved.ls === null);
    ok('the app is left holding the database copy',
       resolved.live.indexOf('OLD_1:0') > -1, resolved.live.join(','));
  }

  head('a write that beats the database');
  {
    /* The merge rule, exercised directly: a stroke made in the ~100 ms before
       hydration is real, and hydration must fold the stored value in
       underneath it rather than replacing it. */
    const merged = await page.evaluate(() => ({
      maps: Store.merge('accsap12.ink', { a: 1, b: 2 }, { b: 99, c: 3 }),
      arrays: Store.merge('accsap12.log', [1, 2], [3]),
      /* THE SHAPE THE APP ACTUALLY WRITES. saveJSON persists the WHOLE array —
         `LOG.push(row); saveJSON(LOG_KEY, LOG)` — so an early write arrives
         already containing every row that is in the store. The fixture above
         hands merge a delta, which the app never produces; against a plain
         concat the two agreed with each other and disagreed with the app,
         and every existing row came back twice. */
      whole: Store.merge('accsap12.log', [1, 2, 3], [1, 2, 3, 4]),
      /* A row the early write had no way of knowing about is still not lost. */
      divergent: Store.merge('accsap12.log', [1, 2, 9], [1, 2, 3]),
      /* A genuinely repeated row inside the write survives: `written` is never
         the side that gets filtered. */
      repeats: Store.merge('accsap12.log', [1], [1, 1]),
      empty: Store.merge('accsap12.ink', { a: 1 }, {}),
    }));
    ok('two maps are folded together, not replaced',
       merged.maps.a === 1 && merged.maps.c === 3, JSON.stringify(merged.maps));
    ok('and what was just made wins the collision', merged.maps.b === 99, String(merged.maps.b));
    ok('the log is appended to, never truncated',
       merged.arrays.join(',') === '1,2,3', merged.arrays.join(','));
    ok('a whole-array write is not duplicated back onto itself',
       merged.whole.join(',') === '1,2,3,4', merged.whole.join(','));
    ok('a row only the store knew about still survives the fold',
       merged.divergent.join(',') === '9,1,2,3', merged.divergent.join(','));
    ok('a legitimately repeated row in the write is kept',
       merged.repeats.join(',') === '1,1', merged.repeats.join(','));
    ok('an empty early write does not erase what was stored',
       merged.empty.a === 1, JSON.stringify(merged.empty));
  }

  head('the review log describes an FSRS card');
  {
    const row = await page.evaluate(() => {
      LOG.length = 0;
      const q = ALL_Q.find(x => !x.bad);
      S.srs[q.id] = FSRS.update(null, 3);
      logReview(q, 3, true, 'test');
      flushLog();
      return LOG[LOG.length - 1];
    });
    ok('a review was logged', !!row);
    ok('it records difficulty', row && typeof row.d === 'number' && isFinite(row.d), String(row && row.d));
    ok('and stability', row && typeof row.s === 'number' && isFinite(row.s), String(row && row.s));
    ok('and no longer pretends to have an SM-2 ease factor', row && row.ef === undefined,
       String(row && row.ef));
  }

  head('with no database at all');
  {
    const p2 = await ctx.newPage();
    const errs2 = [];
    p2.on('pageerror', e => errs2.push(e.message));
    /* Private mode, a locked-down profile, some file:// builds: the app has to
       behave exactly as it did before, on localStorage. */
    await p2.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { get() { throw new Error('IndexedDB is blocked'); } });
    });
    await p2.goto(URL, { waitUntil: 'load', timeout: 200000 });
    await p2.waitForFunction(() => typeof S !== 'undefined' && typeof Store !== 'undefined', { timeout: 120000 });
    await p2.evaluate(() => Store.ready());
    await p2.waitForTimeout(300);
    const fallback = await p2.evaluate(() => {
      INK = { 'NODB:0': [{ p: [4] }] };
      saveJSON(INK_KEY, INK);
      return { available: Store.available(), hydrated: Store.isHydrated(),
               ls: localStorage.getItem('accsap12.ink'), read: loadJSON('accsap12.ink', null) };
    });
    ok('the app still boots', fallback.hydrated === true);
    ok('and knows it has no database', fallback.available === false);
    ok('writes land in localStorage, as they always did', !!fallback.ls && /NODB/.test(fallback.ls));
    ok('and read back', !!(fallback.read && fallback.read['NODB:0']));
    ok('nothing threw', errs2.length === 0, errs2.slice(0, 2).join(' | '));
    await p2.close();
  }

  head('the store that used to fail without a word');
  {
    const warned = await page.evaluate(() => {
      /* accsap12.v2 is not managed by Store — it is written by save() straight
         to localStorage, and that catch used to be empty. */
      let toasted = '';
      const realToast = window.toast;
      window.toast = m => { toasted = m; };
      const realSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k) {
        if (k === 'accsap12.v2') throw new Error('QuotaExceededError');
        return realSet.apply(this, arguments);
      };
      storageWarned = false;
      save();
      Storage.prototype.setItem = realSet;
      window.toast = realToast;
      return toasted;
    });
    ok('a scheduling write that cannot land now says so',
       /storage is full|storage/i.test(warned), warned || '(silent)');
  }

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 2).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
