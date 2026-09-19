/* ═══════════════════════════════════════════════════════════════════════════
   store.js — the four stores that outgrew localStorage.

   Everything this app keeps used to live in localStorage, which is a ~5 MB
   cliff shared by every key. Five of those keys have no ceiling at all:

     accsap12.ink    Pencil strokes, per question and per figure slot. The
                     biggest by far, and the one someone would actually mourn.
     accsap12.chat   every Apex exchange, across all 639 questions
     accsap12.log    the review log — 20 000 rows, ~2 MB at its cap
     accsap12.notes  sticky notes

   The cliff is not a theoretical one. When it arrives, setItem throws, the app
   toasts once, and from then on every write fails silently — annotations made
   after that point simply do not exist the next morning.

   THIS FOLLOWS refassets.js ON PURPOSE. That file already solved this exact
   problem for imported figures: IndexedDB for the bytes, a plain in-memory
   mirror for the reads, because the code that needs the data is synchronous
   and cannot await a database. Two different answers to one question in one
   codebase is how a codebase becomes hard to hold in your head, so this is the
   same answer, in the same shape, with the same failure behaviour.

   WHAT STAYS IN localStorage, and why. accsap12.v2 — statistics and the 639
   FSRS cards — is bounded and small, and it is read synchronously at boot to
   build S before anything renders. Moving the scheduler onto a store that can
   only answer asynchronously would mean either gating the whole app on a
   database opening, or a first paint that shows the wrong due count. Neither
   is worth it for a store that cannot grow. The handful of preference flags
   stay for the same reason.

   AND IT IS COPIED HERE ANYWAY. That paragraph settles the QUOTA question and
   says nothing about the other one: localStorage and IndexedDB do not have the
   same lifetime, and iOS evicts the first after seven days without a visit. So
   accsap12.v2 keeps its synchronous home and gets a copy in the database,
   restored if the original is ever found missing. See MIRRORED below; it is a
   backup, not a second store, and it changes nothing about boot.

   THE ORDER OF EVENTS AT BOOT, which is the only genuinely tricky part:

     1. The app evaluates `let INK = loadJSON(INK_KEY, {})`. Nothing is
        hydrated yet, so it gets whatever localStorage still holds — the real
        data before the first migration, and {} after it. The app renders.
     2. ready() opens the database, reads the four keys into the mirror, and
        the app re-reads them and re-renders. This lands inside the splash on
        every device I can measure, so nothing visibly changes.
     3. Writes from then on go to the mirror immediately and to the database
        shortly after.

   Boot is NOT gated on the database. A gate would mean that a browser with
   IndexedDB disabled — private mode, some MDM profiles, file:// on certain
   builds — shows a blank app instead of a working one. The cost of not gating
   is step 2, which is one re-render.

   A WRITE THAT ARRIVES BEFORE HYDRATION IS MERGED, NOT OVERWRITTEN. The window
   is about a hundred milliseconds and it is nearly always empty, but "nearly
   always" is not a thing to say about someone's ink. If a stroke is drawn in
   that window, hydration folds the stored value in underneath it rather than
   replacing what was just made.

   MIGRATION COPIES, VERIFIES, AND ONLY THEN DELETES. An interrupted migration
   — the tab closed, the database evicted mid-write — leaves the localStorage
   copy exactly where it was, so the next launch simply tries again. There is
   no point at which the data is in neither place.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

const DB_NAME = 'accsap12.store';
const STORE = 'kv';
const VERSION = 1;

/* The four that move. Anything not named here keeps using localStorage
   exactly as before — this module is not a general storage layer and should
   not become one. */
const MANAGED = ['accsap12.ink', 'accsap12.notes', 'accsap12.chat', 'accsap12.log'];

/* ── the key that does NOT move, and gets a copy kept anyway ────────────────
   accsap12.v2 holds the FSRS cards, the chapter statistics and the review
   streak. The header above explains why it cannot join MANAGED, and that
   reasoning still stands: load() is `JSON.parse(localStorage.getItem(KEY))`,
   called synchronously at boot to build S before the first paint, and no
   database answers synchronously. Moving it would mean gating the app on a
   database or painting the wrong due count.

   BUT THAT ARGUMENT IS ABOUT SIZE, AND THE RISK HERE IS NOT SIZE. The header
   says the blob "cannot grow", which is true and settles the quota question
   completely. It does not touch the other one: localStorage and IndexedDB do
   not have the same LIFETIME. iOS and iPadOS evict a site's localStorage after
   seven days without a visit, and this app is opened in Safari over http as
   well as from the Home Screen — docs/IPAD.md exists because the iPad cannot
   open a local file at all. So the four keys that moved are protected from
   eviction and the one that stayed is not, and it is the only one a fellow
   cannot rebuild: notes can be rewritten and figures re-imported, a year of
   spaced repetition cannot.

   So the key stays exactly where it is and a COPY is kept in the database.
   Nothing on the synchronous boot path changes — the app still reads and
   writes localStorage and still awaits nothing — and if localStorage is ever
   emptied underneath it, the copy is put back.

   ONE WAY ONLY. localStorage is authoritative whenever it holds anything at
   all, and the copy is read in exactly one circumstance: when there is nothing
   to be authoritative. That is what keeps this from reproducing the bug
   migrate() had, where two live copies meant guessing which was newer. Here
   there is never a second live copy to weigh. */
const MIRRORED = ['accsap12.v2'];

/* Namespaced, so a mirrored key and a MANAGED key can never collide in the one
   object store. They hold different kinds of thing — a MANAGED key IS the
   data, a mirrored key is a copy of something that lives elsewhere — and one
   name space for both would let a key added to both lists overwrite itself. */
const MIRROR_PREFIX = 'mirror:';

/* How to fold an early write into the value that was already stored. The two
   shapes this app uses are a map keyed by question and an append-only array. */
function merge(key, stored, written) {
  if (Array.isArray(stored) || Array.isArray(written)) {
    const a = Array.isArray(stored) ? stored : [];
    const b = Array.isArray(written) ? written : [];
    /* NOT a.concat(b). saveJSON writes the WHOLE array, never a delta — the
       review log is saved as `saveJSON(LOG_KEY, LOG)` after LOG.push(row) — so
       `written` normally already contains every row of `stored`, and
       concatenating produced each of them twice. The visible symptom was the
       review count on the notes screen climbing by the size of the log.
       Keep only the rows of `stored` that `written` has not already got, and
       keep `written` whole: genuinely repeated rows inside `written` survive,
       because it is never the side that gets filtered. */
    const seen = new Set(b.map(x => { try { return JSON.stringify(x); } catch (_) { return x; } }));
    const extras = a.filter(x => {
      let k; try { k = JSON.stringify(x); } catch (_) { k = x; }
      return !seen.has(k);
    });
    return extras.concat(b);
  }
  if (stored && written && typeof stored === 'object' && typeof written === 'object') {
    return Object.assign({}, stored, written);      // what was just made wins
  }
  return written === undefined ? stored : written;
}

/* WHICH KEYS WERE WRITTEN TO localStorage AFTER THE DATABASE STOPPED TAKING
   THEM. This exists to answer one question that migrate() cannot otherwise
   answer, and used to guess wrong.

   Once a key has migrated, localStorage no longer holds it — so finding a
   value there again means one of exactly two things, and they want opposite
   treatment:

     · an earlier migration wrote the database and was interrupted before it
       cleared localStorage. The two copies are identical; the database is
       authoritative and the local copy is litter.
     · set() could not reach the database and fell back to localStorage. The
       LOCAL copy is the newer one, and the database is holding whatever it
       had before that session.

   migrate() assumed the first, always, in a comment that said the database
   was newer "by definition". It is not: the second case is reachable straight
   from set()'s own fallback, and taking the database there silently reverts
   however long the fellow spent with the database unavailable. Annotations,
   notes, chat and the review log are the four keys this can lose.

   So the fallback stamps what it wrote, and migrate() reads the stamp instead
   of guessing. An absent stamp means the old behaviour, which is right for the
   first case and is also what every existing install looks like. */
const FALLBACK_KEY = 'accsap12.store.fellback';

function fellBack() {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a.filter(k => typeof k === 'string') : [];
  } catch (_) { return []; }
}
function markFellBack(key) {
  const a = fellBack();
  if (a.indexOf(key) > -1) return;
  a.push(key);
  try { localStorage.setItem(FALLBACK_KEY, JSON.stringify(a)); } catch (_) {}
}
function clearFellBack(key) {
  const a = fellBack().filter(k => k !== key);
  try {
    if (a.length) localStorage.setItem(FALLBACK_KEY, JSON.stringify(a));
    else localStorage.removeItem(FALLBACK_KEY);
  } catch (_) {}
}

let mem = Object.create(null);      // key -> parsed value
let hydrated = false;
let dirty = Object.create(null);    // keys written before hydration finished
let db = null;
let opened = null;
let usable = null;                  // null = unknown, false = fall back to localStorage

function open() {
  if (opened) return opened;
  opened = new Promise(resolve => {
    let req;
    try { req = indexedDB.open(DB_NAME, VERSION); }
    catch (_) { return resolve(null); }             // private mode, file://, disabled
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  }).then(d => { db = d; usable = !!d; return d; });
  return opened;
}

function idbGet(d, key) {
  return new Promise(resolve => {
    let tx;
    try { tx = d.transaction(STORE, 'readonly'); } catch (_) { return resolve(undefined); }
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(undefined);
  });
}

function idbPut(d, key, value) {
  return new Promise(resolve => {
    let tx;
    try { tx = d.transaction(STORE, 'readwrite'); } catch (_) { return resolve(false); }
    try { tx.objectStore(STORE).put(value, key); } catch (_) { return resolve(false); }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

/* localStorage, read and written exactly the way the app always did — this is
   both the pre-migration source and the fallback when there is no database. */
/* The stored TEXT, not the parsed value: mirror() compares against what it
   last copied, and comparing strings avoids re-serialising the blob on every
   check. */
function lsRaw(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}
function lsGet(key) {
  try { const raw = localStorage.getItem(key); return raw == null ? undefined : JSON.parse(raw); }
  catch (_) { return undefined; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; }
}

/* ── the mirror ─────────────────────────────────────────────────────────────

   WHAT EACH MIRRORED KEY HELD WHEN THIS FILE WAS EVALUATED, captured before
   any application code has had a chance to run. This is the most important
   line in the mirror and it is not an optimisation.

   Without it the restore pass would read localStorage when the database
   answers, a hundred milliseconds later — by which time the app has booted on
   an empty store and may already have called save(), which writes a COMPLETE
   blob of empty defaults. The pass would find a value, conclude localStorage
   was authoritative, and copy that empty blob over the only surviving copy.
   The backup would be destroyed by the very boot it exists to rescue, and the
   failure would look exactly like success.

   Reading at load time removes the window instead of narrowing it: `absent`
   here means absent before the app existed, which is the only question the
   restore pass actually wants answered. */
const atLoad = Object.create(null);
for (const key of MIRRORED) atLoad[key] = lsGet(key);

/* Nothing is copied until the restore pass has decided what to do — the same
   hazard from the other side. An app booting on an evicted store calls save()
   long before ready() resolves, and an unarmed mirror is what stops that save
   from overwriting the copy it is about to be rescued by. */
let mirrorArmed = false;
let mirrorBusy = Object.create(null);
let mirrorAgain = Object.create(null);
/* The exact text last copied, so an unchanged blob costs nothing. Cleared on a
   failed write, never set from a value that was not stored. */
let mirrorLast = Object.create(null);

/* Called by the app straight after it writes localStorage. Never awaited: the
   caller's write has already succeeded synchronously and the copy is allowed
   to land late.

   COALESCED, NOT DEBOUNCED. save() can fire several times in a second, and a
   trailing timer would make the last write of a session the one most likely to
   be dropped — which is the write most worth keeping. A write already in
   flight sets a flag instead, and exactly one more follows it with whatever
   localStorage holds by then. */
function mirror(key) {
  if (!mirrorArmed || MIRRORED.indexOf(key) < 0) return false;
  if (mirrorBusy[key]) { mirrorAgain[key] = 1; return true; }
  const raw = lsRaw(key);
  if (raw == null) return false;                    // nothing to copy
  /* CHEAP TO CALL, so the caller does not have to know when the value changed.
     The alternative was hooking save() itself, and save()'s last line is the
     anchor scripts/resume-patch.js matches on — editing it would have broken
     the build with `expected exactly 1 match, found 0`. A caller that mirrors
     on a timer and on page-hide is worth more than one that is exactly timely,
     and this is what makes that caller free: an unchanged blob costs one
     string comparison and no transaction. */
  if (raw === mirrorLast[key]) return false;
  const value = lsGet(key);
  if (value === undefined) return false;
  mirrorBusy[key] = 1;
  mirrorLast[key] = raw;
  open().then(d => (d ? idbPut(d, MIRROR_PREFIX + key, value) : false))
    .catch(() => false)
    .then(wrote => {
      /* A refused write must not be remembered as copied, or the skip above
         would make the failure permanent for the rest of the session. */
      if (!wrote) delete mirrorLast[key];
      delete mirrorBusy[key];
      if (mirrorAgain[key]) { delete mirrorAgain[key]; mirror(key); }
    });
  return true;
}

/* Refresh the copy, or put it back. Runs once per session, inside ready().

   Three cases, exhaustive, none of them a judgement call:
     · localStorage held something at load    → it is authoritative; refresh
                                                the copy from what it holds now
     · it did not, and there is no copy       → a first run; nothing to do
     · it did not, and there is a copy        → restore it

   THE ONE THING THIS CAN COST is a question answered in the window between an
   evicted boot and this pass: written to the empty store, then overwritten by
   the restore. That is a few seconds of work against however many months the
   copy holds, and it is the right way round. Said out loud rather than left
   for someone to discover. */
async function remirror(d) {
  const restored = [];
  for (const key of MIRRORED) {
    if (atLoad[key] !== undefined) {
      const now = lsGet(key);
      await idbPut(d, MIRROR_PREFIX + key, now === undefined ? atLoad[key] : now);
      continue;
    }
    const kept = await idbGet(d, MIRROR_PREFIX + key);
    if (kept === undefined) continue;
    if (!lsSet(key, kept)) continue;                // quota: leave the copy be
    restored.push(key);
  }
  return restored;
}

/* Copy → verify → delete. Never delete → copy, and never delete without
   reading back what was written: a quota failure inside IndexedDB is silent
   from here, and deleting on the strength of a write that did not land is how
   you lose a year of annotations in one line. */
async function migrate(d) {
  const moved = [];
  for (const key of MANAGED) {
    const local = lsGet(key);
    if (local === undefined) continue;                 // nothing here to move
    const already = await idbGet(d, key);
    if (already !== undefined) {
      if (fellBack().indexOf(key) < 0) {
        /* Both copies exist and nothing stamped this one, so an earlier
           migration wrote the database and was interrupted before it cleared
           localStorage. The two are identical; finish the job. */
        try { localStorage.removeItem(key); } catch (_) {}
        continue;
      }
      /* Stamped: set() wrote this to localStorage because the database would
         not take it, so the LOCAL copy is the newer one. Folded rather than
         chosen — merge() is the same function hydration already uses for a
         write that landed before the store was ready, and it exists precisely
         so that neither side is thrown away: arrays union without duplicating
         rows, and for the two map-shaped keys the newer side wins per entry.
         Choosing would be a guess about which session mattered. */
      const folded = merge(key, already, local);
      if (!(await idbPut(d, key, folded))) continue;     // try again next launch
      if ((await idbGet(d, key)) === undefined) continue;
      try { localStorage.removeItem(key); } catch (_) {}
      clearFellBack(key);
      moved.push(key);
      continue;
    }
    if (!(await idbPut(d, key, local))) continue;      // try again next launch
    if ((await idbGet(d, key)) === undefined) continue; // wrote nothing; leave the original
    try { localStorage.removeItem(key); } catch (_) {}
    clearFellBack(key);
    moved.push(key);
  }
  return moved;
}

let readyPromise = null;
function ready() {
  if (readyPromise) return readyPromise;
  readyPromise = open().then(async d => {
    if (!d) {                       // no database: localStorage, as before
      hydrated = true;
      /* mirrorArmed stays false. With no database there is nowhere to keep a
         copy, and arming would turn every save() into a promise chain that
         resolves to nothing. health() reports this rather than leaving the app
         to look protected when it is not. */
      return { available: false, migrated: [], restored: [] };
    }
    const migrated = await migrate(d);
    for (const key of MANAGED) {
      const stored = await idbGet(d, key);
      if (stored === undefined) continue;
      mem[key] = (key in dirty) ? merge(key, stored, mem[key]) : stored;
    }
    hydrated = true;
    /* Anything written during hydration is now flushed against the merged
       value rather than the one it was written against. */
    const pending = Object.keys(dirty);
    dirty = Object.create(null);
    for (const key of pending) await idbPut(d, key, mem[key]);
    /* LAST, and only then armed. Everything above is about the four keys the
       database owns; this is about the one it only keeps a copy of, and the
       copy must not be writable until it has been read. */
    const restored = await remirror(d);
    mirrorArmed = true;
    return { available: true, migrated, restored };
  }).catch(() => {
    hydrated = true; usable = false;
    return { available: false, migrated: [], restored: [] };
  });
  return readyPromise;
}

/* Synchronous, always. Before hydration this answers from localStorage, which
   is where the data still is on a first run; after it, from the mirror. */
function get(key, fallback) {
  /* null falls back as well as undefined, because the loadJSON this replaces
     was `JSON.parse(...) || d` — a stored null returned the default there, and
     a store that quietly changed that would change behaviour nobody asked to
     change. */
  if (MANAGED.indexOf(key) < 0) {
    const v = lsGet(key);
    return v == null ? fallback : v;
  }
  if (key in mem && mem[key] != null) return mem[key];
  const v = lsGet(key);
  return v == null ? fallback : v;
}

/* Returns false when the value could not be persisted at all, so the caller
   can say so — the old saveJSON contract, kept. A queued IndexedDB write has
   not landed yet and is still reported as true, because get() is synchronous
   and the app is built on that; what changed is what happens when the queued
   write FAILS.

   IT USED TO BE DISCARDED. idbPut resolves false on a transaction that aborts
   — quota, a database closed underneath us, a version change — and the result
   was thrown away. The value stayed correct in memory for the rest of the
   session and was simply not there on the next launch. The comment here
   defended that by saying it was "the same promise localStorage made", which
   was wrong in the way that mattered: lsSet is synchronous and returns false
   when it fails, so a caller told `true` by localStorage had its bytes
   written. A queued IndexedDB write reported as true might never be written
   at all.

   So a failed write now falls back to localStorage and stamps the key, which
   both keeps the data and tells the next migrate() which copy is newer. */
function set(key, value) {
  if (MANAGED.indexOf(key) < 0) return lsSet(key, value);
  mem[key] = value;
  if (usable === false) return lsFallback(key, value);  // no database: as before
  if (!hydrated) dirty[key] = 1;
  open().then(d => {
    if (!d) { lsFallback(key, value); return; }
    if (!hydrated) return;               // ready() will flush it against the merge
    return idbPut(d, key, mem[key]).then(stored => {
      if (!stored) lsFallback(key, mem[key]);
    });
  }).catch(() => { lsFallback(key, mem[key]); });
  return true;
}

/* localStorage as the fallback rather than as the store: the same write, plus
   the stamp that stops migrate() from preferring a stale database copy over
   it. Unstamped on success is not an option — an unstamped local copy is
   exactly what migrate() is entitled to delete. */
function lsFallback(key, value) {
  const wrote = lsSet(key, value);
  if (wrote) markFellBack(key);
  return wrote;
}

function available() { return usable === true; }
function isHydrated() { return hydrated; }

/* Diagnostics, for the storage card and for tests. */
function bytes() {
  let n = 0;
  for (const k of MANAGED) { try { n += JSON.stringify(mem[k] == null ? '' : mem[k]).length; } catch (_) {} }
  return n;
}

/* OBSERVABLE, not just recovered. The storage card can say "four keys are on
   localStorage because the database refused them" instead of the app looking
   perfectly healthy while running on the fallback. Named as what it is: keys
   that FELL BACK, which is a fact about where the bytes are, not a diagnosis. */
function health() {
  return { usable: usable === true, hydrated, fellBack: fellBack(), mirroring: mirrorArmed };
}

root.Store = { ready, get, set, available, isHydrated, bytes, merge, health, mirror,
               MANAGED, MIRRORED, MIRROR_PREFIX, DB_NAME, STORE, FALLBACK_KEY };

})(typeof window !== 'undefined' ? window : this);
