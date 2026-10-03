/* ═══════════════════════════════════════════════════════════════════════════
   store.js — where your PDFs' clusters, your sessions and your cards live.

   IndexedDB, on this device only. Nothing here is ever uploaded. The PDF's
   bytes are kept too (from v2), so a section can show its figures, its
   tables as printed and its pages — the text clusters alone cannot.

   Four object stores, all keyed by `id`:
     docs      { id, name, addedAt, pages, scanned:[page…], clusters:[…] }
     sessions  { id: docId, state }        — the MemSession state, saved every step
     cards     { id, docId, …, srs }       — the review deck
     files     { id: docId, bytes }         — the PDF itself, for its pages and figures
   and, from v3, for whole books:
     books     { id, name, addedAt, pages, parts:[{ fileId, name, first, last }],
                 method, chapters:[{ n, title, pageStart, pageEnd, docId }] }
     bookpages { id: bookId + ':' + part, pages:[{ page, lines }] }
                                            — the book's text as read, so its
                                              chapters can be cut again without
                                              reading 1,500 pages a second time
     meta      { id, … }                    — small records: the days studied
   and, from v4:
     vectors   { id: docId, model, vecs:[[…] per section] }
                                            — each section's meaning, for search
                                              by meaning (vec.js); remade if the
                                              model changes
   and, from v5:
     packs     { id: docId, sections:{ index: … }, at }
                                            — the unit's lessons and questions
                                              written with Claude and checked
                                              against the book (pack.js)

   A chapter of a book is a doc like any other, with bookId and the book's
   parts (its figures and pages are drawn from whichever part holds them).

   When IndexedDB cannot be opened (some private-browsing modes refuse it),
   everything still works for this visit from memory, and `persistent` says
   so, so the UI can tell the user their work will not survive a reload
   rather than let them find out.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var DB_NAME = 'memorizer';
var DB_VERSION = 5;
/* v2 adds `files`: the PDF's own bytes, kept on this device so its pages and
   figures can be drawn while studying. v3 adds `books`, `bookpages` and
   `meta`; v4, `vectors`; v5, `packs`. Upgrading keeps every store already
   there. */
var STORES = ['docs', 'sessions', 'cards', 'files', 'books', 'bookpages', 'meta', 'vectors', 'packs'];

var mem = { docs: {}, sessions: {}, cards: {}, files: {}, books: {}, bookpages: {}, meta: {}, vectors: {}, packs: {} };
var dbp = null;
var api = { persistent: false };

function open() {
  if (dbp) return dbp;
  dbp = new Promise(function (resolve) {
    var req, settled = false;
    function fallback() { settled = true; resolve(null); }
    try { req = root.indexedDB.open(DB_NAME, DB_VERSION); } catch (_) { fallback(); return; }
    req.onupgradeneeded = function () {
      var db = req.result;
      STORES.forEach(function (s) { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); });
    };
    req.onsuccess = function () {
      if (settled) { req.result.close(); return; }
      settled = true;
      var db = req.result;
      db.onversionchange = function () { db.close(); api.persistent = false; };
      api.persistent = true; resolve(db);
    };
    req.onerror = fallback;
    req.onblocked = fallback;
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(function (db) {
    if (!db) return fn(null);
    return new Promise(function (resolve, reject) {
      var t = db.transaction(store, mode);
      var out = fn(t.objectStore(store));
      var isReq = typeof root.IDBRequest !== 'undefined' && out instanceof root.IDBRequest;
      t.oncomplete = function () { resolve(isReq ? out.result : out); };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error || new Error('transaction aborted')); };
    });
  });
}

/* Copy Memorizer's records, including PDF bytes, without requiring newer
   browser APIs on older WebKit. */
function clone(value) {
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) {
    var buffer = value.buffer.slice(0);
    return value instanceof DataView ? new DataView(buffer, value.byteOffset, value.byteLength) :
      new value.constructor(buffer, value.byteOffset, value.length);
  }
  var copy = Array.isArray(value) ? [] : {};
  Object.keys(value).forEach(function (k) { copy[k] = clone(value[k]); });
  return copy;
}

function put(store, value) {
  return tx(store, 'readwrite', function (os) {
    if (!os) { mem[store][value.id] = clone(value); return value; }
    os.put(value); return value;
  });
}
function get(store, id) {
  return tx(store, 'readonly', function (os) {
    if (!os) return mem[store][id] ? clone(mem[store][id]) : null;
    return os.get(id);
  }).then(function (v) { return v == null ? null : v; });
}
function all(store) {
  return tx(store, 'readonly', function (os) {
    if (!os) return Object.keys(mem[store]).map(function (k) { return clone(mem[store][k]); });
    return os.getAll();
  }).then(function (v) { return v || []; });
}
function del(store, id) {
  return tx(store, 'readwrite', function (os) {
    if (!os) { delete mem[store][id]; return true; }
    os.delete(id); return true;
  });
}

/* A bounded change across stores commits completely or not at all. */
function batch(ops) {
  var snapshot;
  try {
    snapshot = clone(ops);
    snapshot.forEach(function (o) {
      if (STORES.indexOf(o.store) < 0 || (!o.delete && (!o.value || typeof o.value.id !== 'string'))) throw new Error('invalid storage operation');
    });
  } catch (e) { return Promise.reject(e); }
  if (!snapshot.length) return Promise.resolve();
  return open().then(function (db) {
    if (!db) {
      var next = Object.assign({}, mem);
      snapshot.forEach(function (o) {
        if (next[o.store] === mem[o.store]) next[o.store] = Object.assign({}, mem[o.store]);
        if (o.delete) delete next[o.store][o.id]; else next[o.store][o.value.id] = o.value;
      });
      mem = next; return;
    }
    return new Promise(function (resolve, reject) {
      var t;
      try {
        t = db.transaction(snapshot.map(function (o) { return o.store; }).filter(function (s, i, a) { return a.indexOf(s) === i; }), 'readwrite');
        t.oncomplete = function () { resolve(); };
        t.onerror = t.onabort = function () { reject(t.error || new Error('transaction aborted')); };
        snapshot.forEach(function (o) { var os = t.objectStore(o.store); if (o.delete) os.delete(o.id); else os.put(o.value); });
      } catch (e) { if (t) try { t.abort(); } catch (_) {} reject(e); }
    });
  });
}

/* Removing a document removes everything that came from it. */
function deleteDoc(id) {
  return all('cards').then(function (cards) {
    return Promise.all(cards.filter(function (c) { return c.docId === id; }).map(function (c) { return del('cards', c.id); }));
  }).then(function () { return del('sessions', id); }).then(function () { return del('files', id); }).then(function () { return del('vectors', id); }).then(function () { return del('packs', id); }).then(function () { return del('docs', id); });
}

/* Removing a book removes its chapters (and everything from them), its
   parts' bytes, its stored text and itself. */
function deleteBook(id) {
  return get('books', id).then(function (b) {
    if (!b) return null;
    return b.chapters.reduce(function (p, c) { return p.then(function () { return c.docId ? deleteDoc(c.docId) : null; }); }, Promise.resolve())
      .then(function () { return Promise.all(b.parts.map(function (pt, i) { return Promise.all([del('files', pt.fileId), del('bookpages', id + ':' + i)]); })); })
      .then(function () { return del('books', id); });
  });
}

/* Merge learning metadata while keeping the deck’s review history. */
function mergeCards(cards) {
  return all('cards').then(function (have) {
    var ids = {};
    have.forEach(function (c) { ids[c.id] = true; });
    return Promise.all((cards || []).filter(function (c) { return !ids[c.id]; }).map(function (c) { return put('cards', c); }));
  });
}

/* One study step, stored as one thing: the session and the cards it made go
   in ONE transaction, so they cannot disagree. Written as two (put the
   session, then merge the cards) a failure between them left a session that
   had moved on and cards that had not — a miss filed in the session with no
   review card for it, and nothing on screen to say so. Now either both are
   stored or neither is, and the promise rejects, so the caller can say so.
   Resolves with every card in the deck, as mergeCards + all('cards') did. */
function saveStep(session, cards) {
  var fresh = function (have) {
    var byId = {};
    have.forEach(function (c) { byId[c.id] = c; });
    return (cards || []).map(function (c) {
      var old = byId[c.id], next = clone(c);
      if (old) { next = Object.assign({}, old, next); next.srs = old.srs; next.hazard = !!(old.hazard || c.hazard); }
      return next;
    });
  };
  return open().then(function (db) {
    if (!db) {
      mem.sessions[session.id] = JSON.parse(JSON.stringify(session));
      var have = Object.keys(mem.cards).map(function (k) { return mem.cards[k]; });
      fresh(have).forEach(function (c) { mem.cards[c.id] = c; });
      return Object.keys(mem.cards).map(function (k) { return JSON.parse(JSON.stringify(mem.cards[k])); });
    }
    return new Promise(function (resolve, reject) {
      var t, out = null;
      try { t = db.transaction(['sessions', 'cards'], 'readwrite'); } catch (e) { reject(e); return; }
      t.oncomplete = function () { resolve(out); };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error || new Error('transaction aborted')); };
      try {
        var cs = t.objectStore('cards');
        t.objectStore('sessions').put(session);
        var req = cs.getAll();
        req.onsuccess = function () {
          /* A throw here (a quota error, an uncloneable card) aborts the
             transaction, the session's write with it. */
          try {
            var add = fresh(req.result);
            add.forEach(function (c) { cs.put(c); });
            var byId = {};
            add.forEach(function (c) { byId[c.id] = c; });
            out = req.result.filter(function (c) { return !byId[c.id]; }).concat(add);
          } catch (e) { try { t.abort(); } catch (_) {} reject(e); }
        };
      } catch (e) { try { t.abort(); } catch (_) {} reject(e); }
    });
  });
}

/* Retain failed writes for this visit. Unrelated successful writes cannot
   acknowledge them, and refresh must not overwrite a pending note. */
var failures = {}, latest = {}, ticket = 0;
function tracked(key, run, meta) {
  var seq = ++ticket; latest[key] = seq;
  return Promise.resolve().then(run).then(function (v) {
    if (latest[key] === seq) delete failures[key];
    return v;
  }, function (e) {
    if (latest[key] === seq) failures[key] = { run: run, meta: meta, error: e };
    throw e;
  });
}
function failureMessage() {
  return Object.keys(failures).map(function (k) {
    var e = failures[k].error;
    return e && e.name === 'QuotaExceededError' ? 'this device is out of space for Memorizer' : (e && e.message) || 'write failed';
  }).join('; ');
}
function retryFailures() {
  return Promise.all(Object.keys(failures).map(function (k) { var f = failures[k]; return tracked(k, f.run, f.meta); }));
}
api.failureMessage = failureMessage; api.retryFailures = retryFailures;
api.batch = batch; api.open = open; api.put = function (store, value) {
  var v = clone(value);
  return tracked(store + ':' + v.id, function () { return put(store, v); }, store === 'meta' ? v : null);
}; api.get = function (store, id) {
  var f = failures[store + ':' + id];
  return store === 'meta' && f && f.meta ? Promise.resolve(clone(f.meta)) : get(store, id);
}; api.all = all; api.del = function (store, id) { return tracked(store + ':' + id, function () { return del(store, id); }); };
api.deleteDoc = deleteDoc; api.deleteBook = deleteBook; api.mergeCards = mergeCards; api.saveStep = function (session, cards) {
  var s = clone(session), cs = clone(cards);
  return tracked('sessions:' + s.id, function () { return saveStep(s, cs); });
};
root.MemStore = api;
})(typeof window !== 'undefined' ? window : this);
