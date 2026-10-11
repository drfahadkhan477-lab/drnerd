/*
 * An IndexedDB for the Memorizer's store (memorizer/src/store.js), in bare
 * Node, whose transactions can be held, hung or made to fail.
 *
 * WHY. The store's memory fallback, which the pure suites otherwise run on,
 * cannot fail a write, hold one or leave one hanging. So every path that keeps
 * a failed write for retry, orders writes in the queue, or bounds a write that
 * never finishes was reachable only in a browser, and there only by patching
 * the browser's own IDBObjectStore. The browser suites still run against the
 * real thing; this lets a pure suite drive those paths, in order, on demand.
 *
 * NOT A SPEC. It does what store.js uses: open with an upgrade; a transaction
 * over one store or several; put, get, getAll, delete, clear; oncomplete,
 * onerror, onabort; abort(). Values are copied with structuredClone on the
 * way in and out, as IndexedDB copies them. A transaction's writes land only
 * when it completes, and one that is aborted lands nothing. Events fire from
 * a later task, never inside the call that asked, because the defects this
 * exists for live in the gap between a write being asked for and its landing.
 * It does not order transactions against one another, as a browser does for
 * overlapping writes: the store's own queue is what is under test.
 *
 * makeIDB({ onTransaction, onRequest })
 *   onTransaction({ stores, mode, n }) may return
 *     'hang'    it never finishes by itself; abort() ends it and onabort fires;
 *     'wedge'   it never finishes, and abort() is never answered either: no
 *               event fires at all, as from a backend that has stopped;
 *     a Promise it starts once that settles: a slow write, held by the test.
 *   onRequest({ store, kind, value, id, mode, n }) may return an Error: that
 *     request fails, and its transaction aborts with that error.
 * Returns { indexedDB, IDBRequest, data, transactions }: `data` is what has
 * landed (store name -> Map of id -> value) and `transactions` every one
 * made ({ n, stores, mode, state, aborted, abortCalls }), so a check can read
 * below the store's own account of what happened.
 */
'use strict';

function makeIDB(opts) {
  const o = opts || {};
  const data = new Map(), transactions = [];
  const later = fn => setTimeout(fn, 0);
  const copy = v => (v === undefined ? undefined : structuredClone(v));
  const domError = (name, message) => { const e = new Error(message || name); e.name = name; return e; };
  class FakeRequest { constructor() { this.result = undefined; this.error = null; this.onsuccess = null; this.onerror = null; } }
  const storeOf = name => { if (!data.has(name)) throw domError('NotFoundError', 'no object store ' + name); return data.get(name); };

  function transaction(names, mode) {
    names = [].concat(names); names.forEach(storeOf);
    const t = { n: transactions.length, stores: names.slice(), mode: mode || 'readonly', state: 'active', aborted: false, abortCalls: 0,
      error: null, oncomplete: null, onerror: null, onabort: null };
    transactions.push(t);
    const plan = o.onTransaction ? o.onTransaction({ stores: names.slice(), mode: t.mode, n: t.n }) : undefined;
    const work = new Map(), pending = [];
    const view = name => { if (!work.has(name)) work.set(name, new Map(storeOf(name))); return work.get(name); };
    const finish = (how, err) => {
      if (t.state === 'finished') return;
      t.state = 'finished';
      if (how === 'complete') { work.forEach((m, name) => data.set(name, m)); if (t.oncomplete) t.oncomplete(); return; }
      t.aborted = true; t.error = err || null;
      if (err && t.onerror) t.onerror();
      if (t.onabort) t.onabort();
    };
    const run = () => {
      if (t.state !== 'active') return;
      while (pending.length) {
        const r = pending.shift();
        const err = o.onRequest ? o.onRequest({ store: r.store, kind: r.kind, value: r.value, id: r.id, mode: t.mode, n: t.n }) : null;
        if (err) { r.req.error = err; if (r.req.onerror) r.req.onerror(); finish('abort', err); return; }
        const m = view(r.store);
        if (r.kind === 'put') { m.set(r.value.id, r.value); r.req.result = r.value.id; }
        else if (r.kind === 'get') r.req.result = copy(m.get(r.id));
        else if (r.kind === 'getAll') r.req.result = Array.from(m.values(), copy);
        else if (r.kind === 'delete') m.delete(r.id);
        else if (r.kind === 'clear') m.clear();
        if (r.req.onsuccess) r.req.onsuccess();
        if (t.state !== 'active') return;
      }
      finish('complete');
    };
    t.objectStore = name => {
      if (names.indexOf(name) < 0) throw domError('NotFoundError', 'store not in this transaction: ' + name);
      const ask = (kind, extra, writes) => {
        if (t.state !== 'active') throw domError('TransactionInactiveError');
        if (writes && t.mode !== 'readwrite') throw domError('ReadOnlyError');
        const req = new FakeRequest();
        pending.push(Object.assign({ store: name, kind, req }, extra));
        return req;
      };
      return {
        name,
        put: v => ask('put', { value: copy(v) }, true),
        get: id => ask('get', { id }),
        getAll: () => ask('getAll', {}),
        delete: id => ask('delete', { id }, true),
        clear: () => ask('clear', {}, true),
      };
    };
    t.abort = () => {
      t.abortCalls++;
      if (t.state !== 'active') throw domError('InvalidStateError');
      t.state = 'aborting'; t.aborted = true;
      if (plan === 'wedge') return;
      later(() => finish('abort', null));
    };
    if (plan === 'hang' || plan === 'wedge') return t;
    if (plan && typeof plan.then === 'function') plan.then(() => later(run), () => later(run));
    else later(run);
    return t;
  }

  let version = 0;
  const indexedDB = {
    open(name, v) {
      const req = new FakeRequest();
      later(() => {
        const db = {
          objectStoreNames: { contains: s => data.has(s) },
          createObjectStore: s => { if (!data.has(s)) data.set(s, new Map()); return {}; },
          transaction, close() {}, onversionchange: null,
        };
        req.result = db;
        if ((v || 1) > version) { version = v || 1; if (req.onupgradeneeded) req.onupgradeneeded(); }
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
  };
  return { indexedDB, IDBRequest: FakeRequest, data, transactions };
}

module.exports = { makeIDB };
