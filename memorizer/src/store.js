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
var writeQueue = Promise.resolve(), removed = Object.create(null), removedDocs = Object.create(null);
function serialWrite(run) {
  var next = writeQueue.then(run); writeQueue = next.catch(function () {}); return next;
}
function revive(ops) {
  ops.forEach(function (o) {
    if (!o.value) return;
    delete removed[o.store + ':' + o.value.id];
    if (o.store === 'docs') {
      delete removedDocs[o.value.id];
      ['sessions', 'files', 'vectors', 'packs'].forEach(function (s) { delete removed[s + ':' + o.value.id]; });
      Object.keys(removed).forEach(function (key) { if (removed[key] === o.value.id) delete removed[key]; });
    }
  });
}
function wasRemoved(o) {
  if (!o.value || o.store === 'docs') return false;
  return (o.value.docId && removedDocs[o.value.docId]) || removed[o.store + ':' + o.value.id];
}

/* An open that never answers — no success, no error, no blocked — would leave
   every read and write waiting on it for ever, and the app with it: WebKit has
   shipped exactly that (Safari 14.1's first indexedDB.open could hang). After
   this long the visit goes on from memory, like a refused open, and
   `openTimedOut` says why, so the reader is told to reload rather than to
   leave private browsing. A connection that arrives later is closed unused,
   as a late success after `blocked` already is. Opening normally takes
   milliseconds; this is far past any real upgrade. */
api.OPEN_TIMEOUT_MS = 15000;
api.openTimedOut = false;
function open() {
  if (dbp) return dbp;
  dbp = new Promise(function (resolve) {
    var req, settled = false, timer = null;
    function fallback() {
      if (settled) return;
      settled = true; if (timer !== null && root.clearTimeout) root.clearTimeout(timer); resolve(null);
    }
    try { req = root.indexedDB.open(DB_NAME, DB_VERSION); } catch (_) { fallback(); return; }
    if (root.setTimeout) timer = root.setTimeout(function () { if (!settled) { api.openTimedOut = true; fallback(); } }, api.OPEN_TIMEOUT_MS);
    req.onupgradeneeded = function () {
      var db = req.result;
      STORES.forEach(function (s) { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); });
    };
    req.onsuccess = function () {
      if (settled) { req.result.close(); return; }
      settled = true; if (timer !== null && root.clearTimeout) root.clearTimeout(timer);
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
      if (STORES.indexOf(o.store) < 0 || (!o.delete && !o.clear && (!o.value || typeof o.value.id !== 'string'))) throw new Error('invalid storage operation');
    });
  } catch (e) { return Promise.reject(e); }
  if (!snapshot.length) return Promise.resolve();
  return open().then(function (db) {
    if (!db) {
      var next = Object.assign({}, mem);
      snapshot.forEach(function (o) {
        if (next[o.store] === mem[o.store]) next[o.store] = Object.assign({}, mem[o.store]);
        if (o.clear) next[o.store] = {}; else if (o.delete) delete next[o.store][o.id]; else next[o.store][o.value.id] = o.value;
      });
      mem = next; revive(snapshot); return;
    }
    return new Promise(function (resolve, reject) {
      var t;
      try {
        t = db.transaction(snapshot.map(function (o) { return o.store; }).filter(function (s, i, a) { return a.indexOf(s) === i; }), 'readwrite');
        t.oncomplete = function () { revive(snapshot); resolve(); };
        t.onerror = t.onabort = function () { reject(t.error || new Error('transaction aborted')); };
        snapshot.forEach(function (o) { var os = t.objectStore(o.store); if (o.clear) os.clear(); else if (o.delete) os.delete(o.id); else os.put(o.value); });
      } catch (e) { if (t) try { t.abort(); } catch (_) {} reject(e); }
    });
  });
}

/* Build cleanup with metadata so manifests and their content agree. */
function removalOps(ids) {
  ids = ids.filter(Boolean);
  return snapshotStores(['cards', 'meta']).then(function (data) {
    var r = [data.cards, data.meta.find(function (m) { return m.id === 'notes'; }), data.meta.find(function (m) { return m.id === 'checks'; })];
    var ops = [];
    ids.forEach(function (id) { ['docs', 'sessions', 'files', 'vectors', 'packs'].forEach(function (store) { ops.push({ store: store, id: id, delete: true }); }); });
    r[0].filter(function (c) { return ids.indexOf(c.docId) !== -1; }).forEach(function (c) { ops.push({ store: 'cards', id: c.id, docId: c.docId, delete: true }); });
    ['notes', 'checks'].forEach(function (id, i) {
      var rec = r[i + 1]; if (!rec) return;
      Object.keys(rec.recs || {}).forEach(function (key) { if (ids.some(function (d) { return key.indexOf(d + ':') === 0; })) delete rec.recs[key]; });
      ops.push({ store: 'meta', value: rec });
    });
    return ops;
  });
}
function finishDeletion(ids, ops) {
  return batch(ops).then(function () {
    ids.filter(Boolean).forEach(function (id) { removedDocs[id] = true; });
    ops.filter(function (o) { return o.delete; }).forEach(function (o) { removed[o.store + ':' + o.id] = o.docId || true; });
    Object.keys(failures).forEach(function (key) {
      var f = failures[key];
      if (f.ops.some(function (o) { return o.value && (removed[o.store + ':' + o.value.id] ||
        (o.value.docId && removedDocs[o.value.docId])); }) ||
        ops.some(function (o) { return o.value && key === o.store + ':' + o.value.id; })) delete failures[key];
    });
  });
}
function deleteDoc(id) { return serialWrite(function () { return removalOps([id]).then(function (ops) { return finishDeletion([id], ops); }); }); }
function deleteBook(id) {
  return serialWrite(function () { return get('books', id).then(function (b) {
    if (!b) return;
    return removalOps(b.chapters.map(function (c) { return c.docId; })).then(function (ops) {
      b.parts.forEach(function (p, i) { ops.push({ store: 'files', id: p.fileId, delete: true }, { store: 'bookpages', id: id + ':' + i, delete: true }); });
      ops.push({ store: 'books', id: id, delete: true }); return finishDeletion(b.chapters.map(function (c) { return c.docId; }), ops);
    });
  }); });
}
/* What no unit owns any more: a pack, a session, search vectors or review
   cards whose unit is gone, left by an import or a delete cut short in an
   older build (deletes are one transaction now). Removed when the app
   opens, in one batch: a backup refuses derived data with no document
   (backup.js validate), so one orphan would make every backup of this
   device unrestorable. Only records keyed by a unit are looked at. */
function sweep() {
  return Promise.all(['docs', 'packs', 'sessions', 'vectors', 'cards'].map(all)).then(function (r) {
    var have = {}, ops = [];
    r[0].forEach(function (d) { have[d.id] = true; });
    ['packs', 'sessions', 'vectors'].forEach(function (st, i) {
      r[i + 1].forEach(function (x) { if (!have[x.id]) ops.push({ store: st, id: x.id, delete: true }); });
    });
    r[4].forEach(function (c) { if (c.docId && !have[c.docId]) ops.push({ store: 'cards', id: c.id, delete: true }); });
    return batch(ops).then(function () { return ops.map(function (o) { return o.store; }); });
  });
}
/* Unfinished imports are invisible; their marker is removed with the book
   commit. A crash leaves the marker for startup cleanup. */
function cleanImports(bookId) {
  return all('meta').then(function (recs) {
    var ops = [];
    recs.filter(function (r) { return r.kind === 'pending-import' && (bookId ? r.id === 'import:' + bookId : Date.now() - (r.at || 0) > 86400000); }).forEach(function (r) {
      (r.files || []).forEach(function (id) { ops.push({ store: 'files', id: id, delete: true }); });
      (r.pages || []).forEach(function (id) { ops.push({ store: 'bookpages', id: id, delete: true }); });
      ops.push({ store: 'meta', id: r.id, delete: true });
    });
    return batch(ops);
  });
}
/* Read-modify-write inside one transaction prevents a late figure task
   from overwriting a corrected document or resurrecting a deleted one. */
function update(store, id, change) {
  return open().then(function (db) {
    if (!db) { var next = change(mem[store][id] ? clone(mem[store][id]) : null); if (next) mem[store][id] = clone(next); return clone(next); }
    return new Promise(function (resolve, reject) {
      var t = db.transaction(store, 'readwrite'), out;
      t.oncomplete = function () { resolve(out); };
      t.onerror = t.onabort = function () { reject(t.error || new Error('transaction aborted')); };
      var req = t.objectStore(store).get(id);
      req.onsuccess = function () { try { out = change(req.result || null); if (out) t.objectStore(store).put(out); } catch (e) { t.abort(); reject(e); } };
    });
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

/* A consistent snapshot for export, including writes still awaiting retry. */
function snapshotStores(stores) {
  return open().then(function (db) {
    if (!db) { var out = {}; stores.forEach(function (s) { out[s] = Object.keys(mem[s]).map(function (k) { return clone(mem[s][k]); }); }); return out; }
    return new Promise(function (resolve, reject) {
      var t = db.transaction(stores, 'readonly'), out = {};
      t.oncomplete = function () { resolve(out); }; t.onerror = t.onabort = function () { reject(t.error || new Error('snapshot failed')); };
      stores.forEach(function (s) { var req = t.objectStore(s).getAll(); req.onsuccess = function () { out[s] = req.result; }; });
    });
  }).then(function (out) {
    Object.keys(failures).sort(function (a, b) { return failures[a].seq - failures[b].seq; }).forEach(function (k) {
      (failures[k].ops || []).forEach(function (o) {
        var list = out[o.store]; if (!list) return;
        var at = list.findIndex(function (v) { return v.id === (o.value ? o.value.id : o.id); });
        if (o.delete) { if (at >= 0) list.splice(at, 1); return; }
        var v = clone(o.value);
        if (o.history && at >= 0) { v.srs = list[at].srs; v.hazard = !!(list[at].hazard || v.hazard); }
        if (at >= 0) list[at] = v; else list.push(v);
      });
    }); return out;
  });
}
function snapshot() { return snapshotStores(STORES); }
function health() {
  var st = root.navigator && root.navigator.storage;
  return Promise.all([Promise.resolve().then(function () { return st && st.estimate ? st.estimate() : {}; }), Promise.resolve().then(function () { return st && st.persisted ? st.persisted() : false; })]).then(function (r) { return { persistent: api.persistent, durable: !!r[1], usage: r[0].usage || 0, quota: r[0].quota || 0 }; });
}
function persist() { var st = root.navigator && root.navigator.storage; return st && st.persist ? st.persist() : Promise.resolve(false); }

/* Retain failed writes for this visit. Unrelated successful writes cannot
   acknowledge them, and refresh must not overwrite a pending note. */
var failures = {}, latest = {}, ticket = 0;
function tracked(key, run, meta, ops) {
  var seq = ++ticket; latest[key] = seq;
  return serialWrite(function () {
    if (ops.some(wasRemoved)) { var e = new Error('This unit was deleted.'); e.name = 'DeletedDocumentError'; throw e; }
    ops.forEach(function (o) {
      if (o.store === 'meta' && o.value && o.value.recs && (o.value.id === 'notes' || o.value.id === 'checks'))
        Object.keys(o.value.recs).forEach(function (k) { if (Object.keys(removedDocs).some(function (id) { return k.indexOf(id + ':') === 0; })) delete o.value.recs[k]; });
    });
    return Promise.resolve().then(run).then(function (v) { revive(ops); return v; });
  }).then(function (v) {
    if (latest[key] === seq) delete failures[key];
    return v;
  }, function (e) {
    if (latest[key] === seq && e.name !== 'DeletedDocumentError') failures[key] = { run: run, meta: meta, ops: ops, seq: seq, error: e };
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
  return Promise.all(Object.keys(failures).map(function (k) { var f = failures[k]; return tracked(k, f.run, f.meta, f.ops); }));
}
api.forgetFailures = function () { failures = {}; latest = {}; }; api.snapshot = snapshot; api.STORES = STORES.slice(); api.health = health; api.persist = persist; api.failureMessage = failureMessage; api.retryFailures = retryFailures;
api.update = update; api.removalOps = removalOps; api.cleanImports = cleanImports; api.sweep = sweep; api.batch = batch; api.open = open; api.put = function (store, value) {
  var v = clone(value);
  return tracked(store + ':' + v.id, function () { return put(store, v); }, store === 'meta' ? v : null, [{ store: store, value: v }]);
}; api.get = function (store, id) {
  var f = failures[store + ':' + id];
  return store === 'meta' && f && f.meta ? Promise.resolve(clone(f.meta)) : get(store, id);
}; api.all = all; api.del = function (store, id) { return tracked(store + ':' + id, function () { return del(store, id); }, null, [{ store: store, id: id, delete: true }]); };
api.deleteDoc = deleteDoc; api.deleteBook = deleteBook; api.mergeCards = mergeCards; api.saveStep = function (session, cards) {
  var s = clone(session), cs = clone(cards);
  return tracked('sessions:' + s.id, function () { return saveStep(s, cs); }, null, [{ store: 'sessions', value: s }].concat(cs.map(function (c) { return { store: 'cards', value: c, history: true }; })));
};
root.MemStore = api;
})(typeof window !== 'undefined' ? window : this);
