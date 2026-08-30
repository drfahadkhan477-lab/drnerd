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

/* How to fold an early write into the value that was already stored. The two
   shapes this app uses are a map keyed by question and an append-only array. */
function merge(key, stored, written) {
  if (Array.isArray(stored) || Array.isArray(written)) {
    const a = Array.isArray(stored) ? stored : [];
    const b = Array.isArray(written) ? written : [];
    return a.concat(b);
  }
  if (stored && written && typeof stored === 'object' && typeof written === 'object') {
    return Object.assign({}, stored, written);      // what was just made wins
  }
  return written === undefined ? stored : written;
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
function lsGet(key) {
  try { const raw = localStorage.getItem(key); return raw == null ? undefined : JSON.parse(raw); }
  catch (_) { return undefined; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; }
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
      /* Both copies exist — an earlier migration wrote the database and was
         interrupted before it cleared localStorage. The database is the newer
         of the two by definition, so keep it and finish the job. */
      try { localStorage.removeItem(key); } catch (_) {}
      continue;
    }
    if (!(await idbPut(d, key, local))) continue;      // try again next launch
    if ((await idbGet(d, key)) === undefined) continue; // wrote nothing; leave the original
    try { localStorage.removeItem(key); } catch (_) {}
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
      return { available: false, migrated: [] };
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
    return { available: true, migrated };
  }).catch(() => { hydrated = true; usable = false; return { available: false, migrated: [] }; });
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
   not landed yet and is reported as true; that is the same promise
   localStorage made, since it could be evicted a second later either way. */
function set(key, value) {
  if (MANAGED.indexOf(key) < 0) return lsSet(key, value);
  mem[key] = value;
  if (usable === false) return lsSet(key, value);      // no database: as before
  if (!hydrated) dirty[key] = 1;
  open().then(d => {
    if (!d) { lsSet(key, value); return; }
    if (!hydrated) return;               // ready() will flush it against the merge
    idbPut(d, key, mem[key]);
  });
  return true;
}

function available() { return usable === true; }
function isHydrated() { return hydrated; }

/* Diagnostics, for the storage card and for tests. */
function bytes() {
  let n = 0;
  for (const k of MANAGED) { try { n += JSON.stringify(mem[k] == null ? '' : mem[k]).length; } catch (_) {} }
  return n;
}

root.Store = { ready, get, set, available, isHydrated, bytes, merge, MANAGED, DB_NAME, STORE };

})(typeof window !== 'undefined' ? window : this);
