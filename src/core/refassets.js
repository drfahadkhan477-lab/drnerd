/* ═══════════════════════════════════════════════════════════════════════════
   refassets.js — images that arrived with an imported note.

   The build already ships figures: content/refs-images/ is baked into REF_IMGS
   at build time, and a note cites one as ![caption](refimg://hf/054_FIG…jpg).
   That covers the corpus this app ships. It does nothing for a chapter you
   import yourself, and until now importing one silently dropped every figure
   in it — the Markdown came in, the images did not, and the citation rendered
   as nothing.

   This is the other half of that store: same refimg:// namespace, same lookup,
   but written at import time instead of build time, under the key prefix "u/".

   WHY INDEXEDDB AND NOT localStorage. Everything else this app persists is a
   few hundred KB of JSON and lives in localStorage. Figures are not: one
   chapter of Braunwald is twenty images and a megabyte or two even after
   compression, and localStorage is a ~5 MB cliff that the app can only respond
   to by toasting "storage is full". IndexedDB is the store meant for blobs and
   gives room for a shelf of chapters rather than one.

   WHY A MEMORY MIRROR. md() is synchronous — it is called from render(), in a
   template literal, forty times a page. It cannot await a database. So the
   whole store is read into memory once at boot, and reads are plain object
   lookups from then on. That is the same shape REF_IMGS already has, and the
   same cost: these images are in memory either way.

   CONTENT-ADDRESSED. The key is a hash of the bytes, so importing the same
   chapter twice stores one copy, and re-importing after an edit does not
   orphan the old figures under a new name.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

const DB_NAME = 'accsap12.assets';
const STORE = 'refimg';
const PREFIX = 'u/';

let mem = Object.create(null);      // key -> data: URL
let db = null;                      // null once we know there is no IndexedDB
let opened = null;                  // the open() promise, so boot only opens once

function open() {
  if (opened) return opened;
  opened = new Promise(resolve => {
    let req;
    try { req = indexedDB.open(DB_NAME, 1); }
    catch (_) { return resolve(null); }        // private mode, file://, disabled
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  }).then(d => { db = d; return d; });
  return opened;
}

/* Read everything into memory. Failure is not fatal anywhere: an import in
   this session still works, it just will not survive a reload. */
function ready() {
  return open().then(d => {
    if (!d) return 0;
    return new Promise(resolve => {
      let tx;
      try { tx = d.transaction(STORE, 'readonly'); } catch (_) { return resolve(0); }
      const req = tx.objectStore(STORE).openCursor();
      let n = 0;
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve(n);
        if (typeof c.value === 'string') { mem[c.key] = c.value; n++; }
        c.continue();
      };
      req.onerror = () => resolve(n);
    });
  }).catch(() => 0);
}

/* Writes still on their way to IndexedDB. add() does not wait for its write, so an
   importer that reported success at once could be reloaded or closed with a figure
   still in flight, and that figure was gone on the next launch (found on a slow
   machine: one of two figures missing after a reload). flush() is what an importer
   awaits before it says it is done. */
const inflight = new Set();
function track(p) {
  inflight.add(p);
  p.then(() => inflight.delete(p), () => inflight.delete(p));
  return p;
}
function pending() { return inflight.size; }
/* true when every write in flight was stored, false when any was not (quota, a
   disabled or private store): the caller then knows its figures will not survive
   a reload, and can say so. */
function flush() {
  return Promise.all([...inflight]).then(rs => rs.every(r => r !== false));
}

function write(key, dataUrl) {
  mem[key] = dataUrl;                          // memory first: import works regardless
  return track(open().then(d => {
    if (!d) return false;
    return new Promise(resolve => {
      let tx;
      try { tx = d.transaction(STORE, 'readwrite'); } catch (_) { return resolve(false); }
      tx.objectStore(STORE).put(dataUrl, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);       // quota, most likely
    });
  }).catch(() => false));
}

function drop(key) {
  delete mem[key];
  return open().then(d => {
    if (!d) return false;
    return new Promise(resolve => {
      let tx;
      try { tx = d.transaction(STORE, 'readwrite'); } catch (_) { return resolve(false); }
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }).catch(() => false);
}

/* FNV-1a over the bytes. Only ever compared against itself — this is identity,
   not security. */
function hashBytes(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + '-' + bytes.length.toString(36);
}

/* btoa on a whole file blows the argument limit around a hundred KB, and these
   are bigger than that. */
function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
               webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
function mimeFor(name) {
  return MIME[String(name || '').split('.').pop().toLowerCase()] || '';
}
function isImageName(name) { return !!mimeFor(name); }

/* Store one image and return the refimg:// key it now answers to. */
function add(bytes, filename) {
  const mime = mimeFor(filename);
  if (!mime) return null;
  const ext = filename.split('.').pop().toLowerCase();
  const key = PREFIX + hashBytes(bytes) + '.' + ext;
  if (mem[key]) return key;                    // same bytes already here
  write(key, 'data:' + mime + ';base64,' + toBase64(bytes));
  return key;
}

function get(key) { return mem[key] || ''; }
function has(key) { return !!mem[key]; }
function keys() { return Object.keys(mem); }
/* Backups carry only cited user assets, never the build's bundled corpus.
   A cited image that is not here (a version 5 backup restored on a new device,
   or an image the store refused and a relaunch then lost) is left out and
   listed in `missing`, never a reason to refuse: refusing withheld the ink,
   notes and progress too, on every export after, with no way to recover. */
async function backup(bodies) {
  await ready();
  const assets = Object.create(null), missing = [], re = /refimg:\/\/(u\/[a-z0-9]+-[a-z0-9]+\.[a-z]+)/g;
  for (const body of bodies || []) {
    let m; re.lastIndex = 0;
    while ((m = re.exec(String(body || '')))) {
      if (has(m[1])) assets[m[1]] = get(m[1]);
      else if (!missing.includes(m[1])) missing.push(m[1]);
    }
  }
  return { assets, missing };
}
function validateBackup(assets) {
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) throw new Error('Invalid image backup.');
  return Object.keys(assets).map(key => {
    if (!/^u\/[a-z0-9]+-[a-z0-9]+\.(jpg|jpeg|png|webp|gif|avif)$/.test(key)) throw new Error('Invalid image key.');
    const value = assets[key];
    const head = 'data:' + mimeFor(key) + ';base64,';
    if (typeof value !== 'string' || !value.startsWith(head)) throw new Error('Invalid image data.');
    const encoded = value.slice(head.length);
    if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Invalid image encoding.');
    const raw = atob(encoded), bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
    if (PREFIX + hashBytes(bytes) + '.' + key.split('.').pop() !== key) throw new Error('Image checksum does not match.');
    return [key, value];
  });
}
async function restoreBackup(assets) {
  const entries = validateBackup(assets); // validate every asset before any write
  await ready();
  const stored = await Promise.all(entries.map(([key, value]) => write(key, value)));
  return stored.every(ok => ok !== false);
}
function count() { return keys().length; }
function bytes() {
  let n = 0;
  for (const k in mem) n += mem[k].length;
  return Math.round(n * 0.75);                 // base64 is 4 chars per 3 bytes
}

/* Anything no surviving note cites any more. Import is content-addressed and
   deletion is not, so without this an imported chapter that gets deleted would
   leave its figures behind for ever. */
function sweep(bodies, opts) {
  /* NOTHING TO SWEEP AGAINST IS NOT THE SAME AS NOTHING BEING CITED, and the
     difference is irreversible in one direction. An empty list means either
     "every note has been deleted" or "the notes have not loaded yet" — during
     a restore, or when the note store failed while the asset store did not.
     Treating the second as the first deletes every figure the fellow ever
     imported, and unlike the shipped corpus those cannot be rebuilt.

     THE FIRST VERSION OF THIS REFUSED EVERY EMPTY LIST, and that was wrong in
     a way only a real browser could show. Deleting the LAST note that cites a
     figure produces a legitimately empty list, so the guard meant the final
     figure was never reclaimed — verify-assets caught it three runs running
     with "and when the last citation goes, so does the figure → 1". The guard
     was written to protect a case its only caller cannot produce: sweep runs
     from refDelete, which the fellow reaches by deleting a note they can see,
     which means the notes had loaded.

     So the CALLER vouches rather than this function guessing. It is the only
     one that can: refDelete has just rebuilt REF from the live array and knows
     it is the whole set, and a future boot-time sweep would know it is not.
     Absent the assurance the old refusal stands, which keeps the safe default
     for anything added later that forgets to think about it. */
  if (!Array.isArray(bodies)) return 0;
  if (!bodies.length && !(opts && opts.authoritative === true)) return 0;
  const live = Object.create(null);
  const re = /!\[[^\]]*\]\(refimg:\/\/([^)\s]+)\)/g;
  for (const b of bodies || []) {
    let m; re.lastIndex = 0;
    while ((m = re.exec(String(b || '')))) live[m[1]] = 1;
  }
  const gone = keys().filter(k => k.indexOf(PREFIX) === 0 && !live[k]);
  gone.forEach(drop);
  return gone.length;
}

root.RefAssets = { ready, add, get, has, keys, count, bytes, drop, sweep, flush, pending,
                   backup, validateBackup, restoreBackup,
                   isImageName, mimeFor, hashBytes, PREFIX,
                   _mem: () => mem };

})(typeof window !== 'undefined' ? window : this);
