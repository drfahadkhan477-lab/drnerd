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

  /* ── the mirror ─────────────────────────────────────────────────────────
     accsap12.v2 — the FSRS cards, the chapter statistics, the streak — stays
     in localStorage because load() reads it synchronously at boot. That makes
     it the one irreplaceable key with no protection against iOS evicting a
     site's localStorage after seven days. The mirror keeps a copy in the
     database without touching the synchronous path.

     An eviction is modelled as what it actually is: the database survives and
     localStorage does not. reload() copies both, so these build the second
     session by hand. */
  const V2 = 'accsap12.v2';
  const PROGRESS = { schemaVersion: 1, srs: { COR_1: { d: 4.2, s: 91 } }, reviewStreak: 63 };
  const EMPTY = { schemaVersion: 1, srs: {}, reviewStreak: 0 };
  /* What a session that has been through ready() leaves in the database. */
  const afterASession = async (value) => {
    const web = makeWeb({});
    web.ls.set(V2, JSON.stringify(value));
    const S = loadStore(web);
    await S.ready();
    await settle();
    S.mirror(V2);
    await settle();
    return web;
  };
  /* An eviction: the database as it was, localStorage wiped. */
  const evict = prev => makeWeb({ seed: Object.fromEntries(prev.db) });

  head('the mirrored key is not a managed key');
  {
    const S = loadStore(makeWeb({}));
    ok('accsap12.v2 is mirrored', S.MIRRORED.indexOf(V2) > -1, S.MIRRORED.join(', '));
    ok('and is NOT managed — the synchronous boot read is untouched',
       S.MANAGED.indexOf(V2) < 0);
    ok('the copy is namespaced away from the managed keys',
       S.MIRROR_PREFIX.length > 0 && S.MANAGED.every(k => k !== S.MIRROR_PREFIX + V2));
  }

  head('a copy is kept, and localStorage is never taken over');
  {
    const web = await afterASession(PROGRESS);
    ok('the database holds a copy', JSON.stringify(web.db.get('mirror:' + V2)) === JSON.stringify(PROGRESS),
       JSON.stringify(web.db.get('mirror:' + V2)));
    ok('and localStorage still holds the original, untouched',
       web.ls.get(V2) === JSON.stringify(PROGRESS));
    ok('the key did not move into the managed store',
       web.db.get(V2) === undefined);
  }

  head('an eviction is survived — the whole point');
  {
    const first = await afterASession(PROGRESS);
    const web = evict(first);
    ok('localStorage really is empty at the start of the session',
       web.ls.get(V2) === undefined);
    const S = loadStore(web);
    const r = await S.ready();
    await settle();
    ok('ready() reports what it put back', !!r && (r.restored || []).indexOf(V2) > -1,
       JSON.stringify(r && r.restored));
    ok('and the streak is back in localStorage, where load() will find it',
       JSON.parse(web.ls.get(V2) || '{}').reviewStreak === 63,
       String(JSON.parse(web.ls.get(V2) || '{}').reviewStreak));
    ok('with the cards intact, which is the part nobody can rebuild',
       JSON.stringify(JSON.parse(web.ls.get(V2)).srs) === JSON.stringify(PROGRESS.srs));
  }

  head('a save during the evicted boot does not destroy the copy');
  {
    /* THE FAILURE THIS WHOLE DESIGN IS SHAPED AROUND. The app boots on an
       empty store and calls save() long before the database answers. If the
       mirror were live at that moment it would copy a blob of empty defaults
       over the only surviving progress — destroyed by the boot that was about
       to rescue it, and looking exactly like success. */
    const first = await afterASession(PROGRESS);
    const web = evict(first);
    const S = loadStore(web);
    const booting = S.ready();
    /* The app, mid-boot: empty S, and a save. */
    web.ls.set(V2, JSON.stringify(EMPTY));
    ok('the mirror refuses to write before the restore pass has run',
       S.mirror(V2) === false);
    ok('and says so in health(), rather than looking protected',
       S.health().mirroring === false);
    await booting;
    await settle();
    ok('the copy in the database is still the real progress',
       JSON.parse(JSON.stringify(web.db.get('mirror:' + V2))).reviewStreak === 63,
       JSON.stringify(web.db.get('mirror:' + V2)));
    ok('and the empty blob the boot wrote has been replaced by it',
       JSON.parse(web.ls.get(V2)).reviewStreak === 63,
       String(JSON.parse(web.ls.get(V2)).reviewStreak));
    ok('the mirror is armed once the pass is done', S.health().mirroring === true);
  }

  head('a live localStorage is always the authority');
  {
    /* The reverse direction, which must never happen: a stale copy must not
       come back over a store that has something in it. */
    const first = await afterASession(PROGRESS);
    const web = makeWeb({ seed: Object.fromEntries(first.db) });
    const NEWER = { schemaVersion: 1, srs: { COR_1: { d: 9.9, s: 400 } }, reviewStreak: 64 };
    web.ls.set(V2, JSON.stringify(NEWER));
    const S = loadStore(web);
    const r = await S.ready();
    await settle();
    ok('nothing is restored over a store that has a value',
       (r.restored || []).length === 0, JSON.stringify(r.restored));
    ok('localStorage still holds the newer value',
       JSON.parse(web.ls.get(V2)).reviewStreak === 64);
    ok('and the copy was refreshed from it, not the other way round',
       JSON.parse(JSON.stringify(web.db.get('mirror:' + V2))).reviewStreak === 64,
       JSON.stringify(web.db.get('mirror:' + V2)));
  }

  head('a first run is not mistaken for an eviction');
  {
    const web = makeWeb({});
    const S = loadStore(web);
    const r = await S.ready();
    await settle();
    ok('nothing is restored when there was never anything',
       (r.restored || []).length === 0, JSON.stringify(r.restored));
    ok('and localStorage is left empty rather than stamped with a default',
       web.ls.get(V2) === undefined);
  }

  head('no database means no false sense of safety');
  {
    const web = makeWeb({ openFails: true });
    web.ls.set(V2, JSON.stringify(PROGRESS));
    const S = loadStore(web);
    await S.ready();
    await settle();
    ok('health() says the mirror is not running', S.health().mirroring === false);
    ok('mirror() is a no-op rather than a thrown error', S.mirror(V2) === false);
    ok('and the data is exactly where the app left it',
       web.ls.get(V2) === JSON.stringify(PROGRESS));
  }

  head('a database that will not accept the copy loses nothing');
  {
    const web = makeWeb({ putFails: true });
    web.ls.set(V2, JSON.stringify(PROGRESS));
    const S = loadStore(web);
    await S.ready();
    await settle();
    S.mirror(V2);
    await settle();
    ok('localStorage is untouched by a refused copy',
       web.ls.get(V2) === JSON.stringify(PROGRESS));
    ok('and no copy was recorded', web.db.get('mirror:' + V2) === undefined);
  }

  head('mirroring is cheap enough to call on a timer');
  {
    /* The caller is a visibility handler and an interval, not save() — save()'s
       last line is the anchor scripts/resume-patch.js matches on. So mirror()
       has to be free when nothing changed. */
    const web = makeWeb({});
    web.ls.set(V2, JSON.stringify(PROGRESS));
    const S = loadStore(web);
    await S.ready();
    await settle();
    let writes = 0;
    const put = web.db.set.bind(web.db);
    web.db.set = (k, v) => { if (String(k).indexOf('mirror:') === 0) writes++; return put(k, v); };

    ok('the first call after a change copies', S.mirror(V2) === true);
    await settle();
    /* Counted as a DELTA around each phase. The first version of this asserted
       an absolute total and was simply wrong about when counting began — the
       code was right and the check was not. */
    const before = writes;
    ok('an unchanged blob is skipped', S.mirror(V2) === false);
    await settle();
    ok('and cost no transaction', writes - before === 0, `${writes - before} write(s)`);

    web.ls.set(V2, JSON.stringify({ ...PROGRESS, reviewStreak: 64 }));
    const beforeChange = writes;
    ok('a changed blob is copied again', S.mirror(V2) === true);
    await settle();
    ok('which did write exactly once', writes - beforeChange === 1, `${writes - beforeChange} write(s)`);
    ok('and the copy is the new value',
       JSON.parse(JSON.stringify(web.db.get('mirror:' + V2))).reviewStreak === 64);
  }

  head('a refused copy is retried rather than remembered as done');
  {
    /* The skip above must not make a failure permanent: if the write was
       refused, the next call has to try again. */
    const web = makeWeb({ putFails: true });
    web.ls.set(V2, JSON.stringify(PROGRESS));
    const S = loadStore(web);
    await S.ready();
    await settle();
    S.mirror(V2);
    await settle();
    ok('nothing was stored', web.db.get('mirror:' + V2) === undefined);
    ok('and the same unchanged blob is attempted again, not skipped',
       S.mirror(V2) === true);
  }

  head('an unmirrored key is refused by name');
  {
    const web = makeWeb({});
    web.ls.set(KEY, JSON.stringify({ a: 1 }));
    const S = loadStore(web);
    await S.ready();
    await settle();
    ok('mirror() only takes the keys it was told about', S.mirror(KEY) === false);
    ok('and wrote no copy of one it was not', web.db.get('mirror:' + KEY) === undefined);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
