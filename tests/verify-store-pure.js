#!/usr/bin/env node
/*
 * The two copies problem: which one is newer, and what happens when the
 * database refuses a write.
 *
 *   node tests/verify-store-pure.js
 *
 * Pure Node against tests/_fakeweb.js. store.js holds annotations, notes, chat
 * and the review log, and until this file existed the only thing exercising it
 * needed a build, a browser and the licensed export — so the module that can
 * lose a fellow's work had no check that ran on a push.
 *
 * THE BUG THIS WAS WRITTEN FOR. migrate() found a value in localStorage and a
 * value in IndexedDB for the same key, and resolved it with:
 *
 *     "The database is the newer of the two by definition"
 *
 * It is not. That holds for one of the two ways both copies can exist — an
 * interrupted migration — and set() reaches the other one by itself: when the
 * database will not open, set() writes to localStorage instead. Next launch,
 * the database opens, migration finds both, keeps the OLD database copy and
 * deletes the newer local one. Everything the fellow did while the database
 * was unavailable is gone, and nothing anywhere says so.
 *
 * Both halves are tested here because they are one bug: the write that lands
 * somewhere else, and the migration that then picks wrong.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { makeWeb, loadModule, settle } = require('./_fakeweb.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const KEY = 'accsap12.notes';          // a MANAGED key
const LOG = 'accsap12.log';            // the array-shaped one
const loadStore = web => loadModule(fs, path, 'src/core/store.js', web).Store;

/* A reload: everything localStorage held survives, the database survives, the
   module's closure state does not. */
function reload(prev, opts) {
  const web = makeWeb(Object.assign({ seed: Object.fromEntries(prev.db) }, opts || {}));
  for (const [k, v] of prev.ls) web.ls.set(k, v);
  return web;
}

(async () => {

  head('the harness drives the real module, not a stand-in');
  {
    const web = makeWeb({});
    const S = loadStore(web);
    ok('store.js loaded and exports set/get', typeof S.set === 'function' && typeof S.get === 'function');
    ok('and the managed keys are the four that move',
       S.MANAGED.length === 4 && S.MANAGED.indexOf(KEY) > -1, S.MANAGED.join(', '));
    await S.ready();
    S.set(KEY, { a: 1 });
    await settle();
    ok('a normal write reaches the database', JSON.stringify(web.db.get(KEY)) === '{"a":1}',
       JSON.stringify(web.db.get(KEY)));
    ok('and does NOT stay in localStorage', web.ls.get(KEY) === undefined);
  }

  head('a write the database refuses is not lost');
  {
    /* The failure that used to be discarded: idbPut resolves false on an
       aborted transaction and the result went nowhere. */
    const web = makeWeb({ putFails: true });
    const S = loadStore(web);
    await S.ready();
    S.set(KEY, { work: 'an hour of it' });
    await settle();
    ok('the value is somewhere durable', web.ls.get(KEY) !== undefined,
       web.ls.get(KEY) === undefined ? 'LOST — neither store has it' : 'localStorage');
    ok('and it is the value that was written',
       String(web.ls.get(KEY)).indexOf('an hour of it') > -1);
    ok('the key is stamped as having fallen back',
       JSON.parse(web.ls.get('accsap12.store.fellback') || '[]').indexOf(KEY) > -1);
    ok('and health() says so rather than looking well', S.health().fellBack.indexOf(KEY) > -1,
       JSON.stringify(S.health()));
  }

  head('a database that will not open at all');
  {
    const web = makeWeb({ openFails: true });
    const S = loadStore(web);
    await S.ready();
    S.set(KEY, { offline: true });
    await settle();
    ok('the write still lands in localStorage', web.ls.get(KEY) !== undefined);
    ok('and is stamped', JSON.parse(web.ls.get('accsap12.store.fellback') || '[]').indexOf(KEY) > -1);
    ok('get() reads it back within the session', JSON.stringify(S.get(KEY)) === '{"offline":true}',
       JSON.stringify(S.get(KEY)));
  }

  head('THE BUG: the newer copy is the local one, and it survives');
  {
    /* Session A: no database. The work goes to localStorage. */
    const a = makeWeb({ openFails: true, seed: { [KEY]: { note: 'OLD' } } });
    const A = loadStore(a);
    await A.ready();
    A.set(KEY, { note: 'NEW' });
    await settle();

    /* Session B: the database is back, still holding the old value. */
    const b = reload(a, {});
    b.db.set(KEY, { note: 'OLD' });      // the database never saw session A
    const B = loadStore(b);
    await B.ready();
    await settle();

    ok('the newer value is what the app reads', JSON.stringify(B.get(KEY)).indexOf('NEW') > -1,
       JSON.stringify(B.get(KEY)));
    ok('and it is what the database now holds', JSON.stringify(b.db.get(KEY)).indexOf('NEW') > -1,
       JSON.stringify(b.db.get(KEY)));
    ok('the local copy is cleared once it is safely across', b.ls.get(KEY) === undefined);
    ok('and the stamp is cleared with it',
       JSON.parse(b.ls.get('accsap12.store.fellback') || '[]').indexOf(KEY) < 0);
  }

  head('an interrupted migration still lets the database win');
  {
    /* The other way both copies exist, and the one the old comment described.
       Nothing stamped it, so the local copy is litter from a migration that
       did not get to its last line — the database is authoritative and this
       must not regress into preferring localStorage. */
    const web = makeWeb({ seed: { [KEY]: { note: 'copied across' } } });
    web.ls.set(KEY, JSON.stringify({ note: 'copied across' }));
    const S = loadStore(web);
    await S.ready();
    await settle();
    ok('the database copy is kept', JSON.stringify(S.get(KEY)).indexOf('copied across') > -1);
    ok('and the leftover local copy is cleared', web.ls.get(KEY) === undefined);
  }

  head('the review log is folded, not chosen');
  {
    /* The array-shaped key. Choosing either side would drop reviews; merge()
       unions them, and it is the same merge() hydration already uses. */
    const a = makeWeb({ openFails: true });
    const A = loadStore(a);
    await A.ready();
    A.set(LOG, [{ q: 1 }, { q: 2 }, { q: 3 }]);
    await settle();

    const b = reload(a, {});
    b.db.set(LOG, [{ q: 1 }, { q: 9 }]);     // a row the local copy never had
    const B = loadStore(b);
    await B.ready();
    await settle();

    const rows = B.get(LOG) || [];
    const ids = rows.map(r => r.q).sort((x, y) => x - y);
    ok('every row from both sides survives', ids.join(',') === '1,2,3,9', ids.join(','));
    ok('and none is duplicated', rows.length === 4, String(rows.length));
  }

  head('a stamped key whose re-write also fails keeps its local copy');
  {
    /* Fail-safe on the recovery path itself: if migration cannot write the
       folded value, it must not delete the only copy that has it. */
    const a = makeWeb({ openFails: true });
    const A = loadStore(a);
    await A.ready();
    A.set(KEY, { note: 'NEW' });
    await settle();

    const b = reload(a, { putFails: true });
    b.db.set(KEY, { note: 'OLD' });
    const B = loadStore(b);
    await B.ready();
    await settle();

    ok('the local copy is still there', b.ls.get(KEY) !== undefined,
       b.ls.get(KEY) === undefined ? 'DELETED — the only newer copy is gone' : 'kept');
    ok('and it still carries its stamp, so the next launch retries',
       JSON.parse(b.ls.get('accsap12.store.fellback') || '[]').indexOf(KEY) > -1);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
