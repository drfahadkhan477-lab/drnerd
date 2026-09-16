/*
 * A localStorage and an IndexedDB, in bare Node, so the persistence layer can
 * be tested without a browser.
 *
 * WHY THIS IS WORTH HAVING. store.js and refassets.js are where this app's
 * durability lives, and both were reachable only through a Playwright suite —
 * which needs a build, which needs the licensed export, which CI does not
 * have. So the two modules that can lose a fellow's work were the two with no
 * check that runs on a push. Neither module touches the DOM; both only need
 * these two globals.
 *
 * DELIBERATELY SMALL, AND NOT A SPEC. This implements the parts store.js uses
 * — open, one object store, get/put/delete, oncomplete/onerror/onabort — and
 * nothing else. It is not an IndexedDB, it is a stand-in good enough to drive
 * the failure paths that matter: a database that will not open, and a
 * transaction that aborts. Anything it cannot fake belongs in the browser
 * suite, which still runs.
 *
 * Everything resolves through setTimeout rather than immediately, because the
 * bug this file was written for lives in the gap between "the write was
 * queued" and "the write landed". A synchronous fake closes that gap and would
 * have reported the bug fixed while it was not.
 */
'use strict';

/* opts: { openFails, putFails, seed } — the two failure modes plus the
   database's starting contents. */
function makeWeb(opts) {
  const o = opts || {};
  const ls = new Map();
  const db = new Map(Object.entries(o.seed || {}));
  const later = fn => setTimeout(fn, 0);

  const localStorage = {
    getItem: k => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => { ls.set(k, String(v)); },
    removeItem: k => { ls.delete(k); },
  };

  const indexedDB = {
    open() {
      const req = {};
      later(() => {
        if (o.openFails) { req.onerror && req.onerror(); return; }
        req.result = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => {},
          transaction(_name, mode) {
            const tx = {};
            const writing = mode === 'readwrite';
            later(() => {
              if (writing && o.putFails) { tx.onabort && tx.onabort(); return; }
              tx.oncomplete && tx.oncomplete();
            });
            tx.objectStore = () => ({
              get(k) {
                const r = {};
                later(() => { r.result = db.get(k); r.onsuccess && r.onsuccess(); });
                return r;
              },
              put(v, k) { if (!o.putFails) db.set(k, v); return {}; },
              delete(k) { if (!o.putFails) db.delete(k); return {}; },
              openCursor() { const r = {}; later(() => { r.result = null; r.onsuccess && r.onsuccess(); }); return r; },
            });
            return tx;
          },
        };
        req.onsuccess && req.onsuccess();
      });
      return req;
    },
  };

  return { localStorage, indexedDB, ls, db };
}

/* Loads a module fresh against one fake web. Fresh matters: these modules hold
   their state in closure variables, so a second session has to be a second
   instantiation, the way a reload is. */
function loadModule(fs, path, relPath, web) {
  const src = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
  const root = {};
  const rewritten = src.replace("(typeof window !== 'undefined' ? window : this)", '(root)');
  new Function('root', 'localStorage', 'indexedDB', rewritten)(
    root, web.localStorage, web.indexedDB);
  return root;
}

const settle = () => new Promise(r => setTimeout(r, 25));

module.exports = { makeWeb, loadModule, settle };
