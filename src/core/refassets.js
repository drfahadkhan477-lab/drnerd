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

function write(key, dataUrl) {
  mem[key] = dataUrl;                          // memory first: import works regardless
  return open().then(d => {
    if (!d) return false;
    return new Promise(resolve => {
      let tx;
      try { tx = d.transaction(STORE, 'readwrite'); } catch (_) { return resolve(false); }
      tx.objectStore(STORE).put(dataUrl, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);       // quota, most likely
    });
  }).catch(() => false);
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
function count() { return keys().length; }
function bytes() {
  let n = 0;
  for (const k in mem) n += mem[k].length;
  return Math.round(n * 0.75);                 // base64 is 4 chars per 3 bytes
}

/* Anything no surviving note cites any more. Import is content-addressed and
   deletion is not, so without this an imported chapter that gets deleted would
   leave its figures behind for ever. */
function sweep(bodies) {
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

root.RefAssets = { ready, add, get, has, keys, count, bytes, drop, sweep,
                   isImageName, mimeFor, hashBytes, PREFIX,
                   _mem: () => mem };

})(typeof window !== 'undefined' ? window : this);
