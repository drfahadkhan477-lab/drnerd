/* ═══════════════════════════════════════════════════════════════════════════
   bankstore.js — the question bank kept on the device, for the code-only
   deploy.

   A build made with scripts/build-pwa.js --no-content ships no bank: the host
   serves code, and the licensed questions and figures live only here, in
   this browser's IndexedDB, imported from a package the owner made on their
   own laptop (tools/pack-content.js). The loader in that build asks load()
   first; with nothing imported it shows the import screen instead of the
   "could not load" splash.

   ITS OWN DATABASE, NOT store.js's. Progress, ink, notes and chats are the
   fellow's; the bank is replaceable. Keeping them apart means a new import
   can never touch a single review or stroke — progress is keyed by question
   id, so it carries over to a re-imported bank of the same questions.

   ONE TRANSACTION PER IMPORT. The new generation's bank and every figure are
   written, the active pointer is moved to it and the old generation deleted,
   all inside one IndexedDB readwrite transaction — which commits whole or not
   at all. A failed import (quota, a tab closed mid-way) leaves the previous
   bank active and untouched; there is no moment with half of each.

   FIGURES ARE BLOBS, SERVED AS blob: URLS. Held by the browser, not the tab's
   heap, which is the whole reason the split build exists; IMGS gets the same
   id → [url] shape it always had, so buildFigures() is untouched. The tutor's
   figure path fetches those URLs to send them — scripts/csp.js lists blob: in
   connect-src for exactly that.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

const DB = 'systole-bank', VERSION = 1;

function open(idb) {
  return new Promise((resolve, reject) => {
    const r = (idb || root.indexedDB).open(DB, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of ['meta', 'bank', 'figs']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('could not open the bank database'));
  });
}
const req = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const done = t => new Promise((resolve, reject) => {
  t.oncomplete = () => resolve();
  t.onerror = () => reject(t.error || new Error('the import did not commit'));
  t.onabort = () => reject(t.error || new Error('the import was aborted'));
});
const range = gen => root.IDBKeyRange.bound(gen + '/', gen + '/￿');

/* verdict: what BankPack.validate() returned, ok. */
async function save(verdict, opts) {
  if (!verdict || !verdict.ok) throw new Error('refusing to store a package that did not validate');
  const o = opts || {};
  const db = await open(o.idb);
  try {
    const gen = 'g' + (o.now || Date.now());
    const t = db.transaction(['meta', 'bank', 'figs'], 'readwrite');
    const finished = done(t);
    finished.catch(() => {});                  // observed here; awaited below, so a failure is thrown, never unhandled
    const meta = t.objectStore('meta'), bank = t.objectStore('bank'), figs = t.objectStore('figs');
    const old = await req(meta.get('active'));
    bank.put({ questions: verdict.questions, manifest: verdict.manifest }, gen);
    for (const f of verdict.figures) figs.put(new root.Blob([f.bytes], { type: f.type }), gen + '/' + f.name);
    /* The notes' seed and figure files, beside the figures and in the same
       generation, so they commit, replace and roll back with the bank. */
    for (const x of (verdict.extras || [])) figs.put(new root.Blob([x.bytes], { type: x.type }), gen + '/extra/' + x.name);
    if (o.failAfterWrites) { t.abort(); await finished; }   // for the suite: an interrupted import changes nothing
    meta.put({ gen, questions: verdict.questions.length, figures: verdict.figures.length, extras: (verdict.extras || []).length }, 'active');
    if (old && old.gen && old.gen !== gen) { bank.delete(old.gen); figs.delete(range(old.gen)); }
    await finished;
    return { gen, questions: verdict.questions.length, figures: verdict.figures.length, extras: (verdict.extras || []).length };
  } finally { db.close(); }
}

/* → null when nothing is imported; else { questions, imgs, figures }. */
async function load(opts) {
  const o = opts || {};
  const db = await open(o.idb);
  try {
    const t = db.transaction(['meta', 'bank', 'figs'], 'readonly');
    const active = await req(t.objectStore('meta').get('active'));
    if (!active || !active.gen) return null;
    const rec = await req(t.objectStore('bank').get(active.gen));
    if (!rec || !Array.isArray(rec.questions)) return null;
    const fs = t.objectStore('figs');
    const keys = await req(fs.getAllKeys(range(active.gen)));
    const blobs = await req(fs.getAll(range(active.gen)));
    const makeURL = o.makeURL || (b => root.URL.createObjectURL(b));
    const url = {}, extras = {};
    keys.forEach((k, i) => {
      const name = String(k).slice(active.gen.length + 1);
      if (name.indexOf('extra/') === 0) extras[name.slice(6)] = blobs[i];   // kept as Blobs: served by the loader, not as <img>
      else url[name] = makeURL(blobs[i]);
    });
    const imgs = {};
    for (const q of rec.questions) if (q.figs && q.figs.length) imgs[q.id] = q.figs.map(f => url[f]).filter(Boolean);
    return { questions: rec.questions, imgs, figures: Object.keys(url).length, extras, manifest: rec.manifest || null };
  } finally { db.close(); }
}

async function clear(opts) {
  const db = await open((opts || {}).idb);
  try {
    const t = db.transaction(['meta', 'bank', 'figs'], 'readwrite');
    const finished = done(t);
    for (const s of ['meta', 'bank', 'figs']) t.objectStore(s).clear();
    await finished;
  } finally { db.close(); }
}

root.BankStore = { save, load, clear, DB };

})(typeof window !== 'undefined' ? window : this);
