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
    var req;
    try { req = root.indexedDB.open(DB_NAME, DB_VERSION); } catch (_) { resolve(null); return; }
    req.onupgradeneeded = function () {
      var db = req.result;
      STORES.forEach(function (s) { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); });
    };
    req.onsuccess = function () { api.persistent = true; resolve(req.result); };
    req.onerror = function () { resolve(null); };
    req.onblocked = function () { resolve(null); };
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

function put(store, value) {
  return tx(store, 'readwrite', function (os) {
    if (!os) { mem[store][value.id] = JSON.parse(JSON.stringify(value)); return value; }
    os.put(value); return value;
  });
}
function get(store, id) {
  return tx(store, 'readonly', function (os) {
    if (!os) return mem[store][id] ? JSON.parse(JSON.stringify(mem[store][id])) : null;
    return os.get(id);
  }).then(function (v) { return v == null ? null : v; });
}
function all(store) {
  return tx(store, 'readonly', function (os) {
    if (!os) return Object.keys(mem[store]).map(function (k) { return mem[store][k]; });
    return os.getAll();
  }).then(function (v) { return v || []; });
}
function del(store, id) {
  return tx(store, 'readwrite', function (os) {
    if (!os) { delete mem[store][id]; return true; }
    os.delete(id); return true;
  });
}

/* Several records in one transaction: all of them stored, or none. writes:
   [{ store, value }]. A value that cannot be stored (a DataCloneError) aborts
   the whole transaction, so what was put before it in the same call is
   undone by the browser, not by us. */
function putAll(writes) {
  var names = writes.map(function (w) { return w.store; }).filter(function (n, i, a) { return a.indexOf(n) === i; });
  return open().then(function (db) {
    if (!db) { writes.forEach(function (w) { mem[w.store][w.value.id] = JSON.parse(JSON.stringify(w.value)); }); return writes.length; }
    return new Promise(function (resolve, reject) {
      var t = db.transaction(names, 'readwrite');
      t.oncomplete = function () { resolve(writes.length); };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error || new Error('transaction aborted')); };
      try { writes.forEach(function (w) { t.objectStore(w.store).put(w.value); }); }
      catch (e) { try { t.abort(); } catch (_) {} reject(e); }
    });
  });
}

/* What no unit owns any more — a pack, a session, search vectors or review
   cards whose unit is gone (an import or a delete cut short in an older
   build, say) — is removed when the app opens. Only records keyed by a
   unit's id are looked at; books, their pages and PDF bytes are not. */
function sweep() {
  return all('docs').then(function (docs) {
    var have = {};
    docs.forEach(function (d) { have[d.id] = true; });
    var gone = [];
    return Promise.all(['packs', 'sessions', 'vectors'].map(function (st) {
      return all(st).then(function (rows) { rows.forEach(function (r) { if (!have[r.id]) gone.push(del(st, r.id).then(function () { return st; })); }); });
    })).then(function () {
      return all('cards').then(function (cards) { cards.forEach(function (c) { if (c.docId && !have[c.docId]) gone.push(del('cards', c.id).then(function () { return 'cards'; })); }); });
    }).then(function () { return Promise.all(gone); });
  });
}

/* ── a backup of everything studied ─────────────────────────────────────
   Units, books and their text, sessions, cards, packs and the app's own
   notes (meta), as one JSON file. Left out: the PDFs' bytes (large, and
   the owner has them) and search vectors (worked out again on demand).
   A restore is checked first and written in one transaction; a unit whose
   PDF is not on this device is marked so, and shows its text without its
   pages. */
var BACKUP = 'memorizer-backup', BACKUP_V = 1;
var BACKUP_STORES = ['docs', 'sessions', 'cards', 'books', 'bookpages', 'meta', 'packs'];
function dump() {
  return Promise.all(BACKUP_STORES.map(function (s) { return all(s); })).then(function (rows) {
    var stores = {};
    BACKUP_STORES.forEach(function (s, i) { stores[s] = rows[i]; });
    return { format: BACKUP, version: BACKUP_V, at: new Date().toISOString(), stores: stores };
  });
}
/* → '' when it is a backup this build can restore, else why not. */
function checkBackup(b) {
  if (!b || typeof b !== 'object' || b.format !== BACKUP) return 'this is not a Memorizer backup';
  if (typeof b.version !== 'number' || b.version > BACKUP_V) return 'it was made by a newer Memorizer (version ' + b.version + ')';
  if (!b.stores || typeof b.stores !== 'object') return 'it holds no data';
  for (var k in b.stores) {
    if (BACKUP_STORES.indexOf(k) === -1) return 'it holds an unknown kind of record (' + k + ')';
    if (!Array.isArray(b.stores[k])) return 'its ' + k + ' are not a list';
    for (var i = 0; i < b.stores[k].length; i++) {
      var r = b.stores[k][i];
      if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) return 'a record in its ' + k + ' has no id';
    }
  }
  return '';
}
function restore(b) {
  var why = checkBackup(b);
  if (why) return Promise.reject(new Error(why));
  return all('files').then(function (files) {
    var have = {};
    files.forEach(function (f) { have[f.id] = true; });
    var pdfHere = function (d) {
      if (d.parts && d.parts.length) return d.parts.every(function (pt) { return have[pt.fileId]; });
      return !!have[d.id];
    };
    var writes = [];
    Object.keys(b.stores).forEach(function (s) {
      b.stores[s].forEach(function (r) {
        if (s === 'docs' && r.hasFile && !pdfHere(r)) r = Object.assign({}, r, { hasFile: false });
        writes.push({ store: s, value: r });
      });
    });
    return putAll(writes).then(function () { return Object.keys(b.stores).reduce(function (o, s) { o[s] = b.stores[s].length; return o; }, {}); });
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

/* Cards from a session are merged in, never overwritten: a card already in
   the deck keeps its review history. */
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
    var ids = {};
    have.forEach(function (c) { ids[c.id] = true; });
    return (cards || []).filter(function (c) { return !ids[c.id]; }).map(function (c) { return JSON.parse(JSON.stringify(c)); });
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
            out = req.result.concat(add);
          } catch (e) { try { t.abort(); } catch (_) {} reject(e); }
        };
      } catch (e) { try { t.abort(); } catch (_) {} reject(e); }
    });
  });
}

api.open = open; api.put = put; api.putAll = putAll; api.sweep = sweep; api.get = get; api.all = all; api.del = del;
api.dump = dump; api.restore = restore; api.checkBackup = checkBackup; api.BACKUP_STORES = BACKUP_STORES;
api.deleteDoc = deleteDoc; api.deleteBook = deleteBook; api.mergeCards = mergeCards; api.saveStep = saveStep;
root.MemStore = api;
})(typeof window !== 'undefined' ? window : this);
