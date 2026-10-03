#!/usr/bin/env node
/* Synthetic runtime failures; no browser, model download or private data. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const pdfSource = fs.readFileSync(path.join(__dirname, '../memorizer/src/pdf.js'), 'utf8');
function pdfRuntime(fetchImpl, getDocument) {
  const document = { createElement: () => ({}), head: { appendChild: script => queueMicrotask(() => script.onload()) } };
  const root = { pdfjsLib: { GlobalWorkerOptions: {}, getDocument, OPS: {} } };
  vm.runInNewContext(pdfSource, { window: root, document, fetch: fetchImpl, URL, Blob, ArrayBuffer, Uint8Array });
  return root;
}
module.exports = (async () => {
  const failed = pdfRuntime(() => Promise.reject(new Error('integrity mismatch')), () => { throw new Error('must not parse'); });
  await assert.rejects(failed.MemPdf.read(new ArrayBuffer(0)), /could not be verified/);
  assert.equal(failed.pdfjsLib.GlobalWorkerOptions.workerSrc, undefined);
  let opened = 0, destroyed = 0;
  const verified = pdfRuntime(() => Promise.resolve({ ok: true, text: () => Promise.resolve('// verified synthetic worker') }), () => {
    opened++; return { promise: Promise.resolve({ numPages: 0, getOutline: () => Promise.resolve([]), destroy: () => { destroyed++; return Promise.resolve(); } }) };
  });
  await verified.MemPdf.read(new ArrayBuffer(0));
  assert.equal(destroyed, 1);
  await Promise.all([verified.MemPdf.figuresOn('a', new ArrayBuffer(0), []), verified.MemPdf.figuresOn('a', new ArrayBuffer(0), [])]);
  assert.equal(opened, 2);
  await verified.MemPdf.figuresOn('b', new ArrayBuffer(0), []);
  assert.equal(destroyed, 2);
  await verified.MemPdf.release(); assert.equal(destroyed, 3);
  console.log('PASS PDF integrity failure closes the path; completed and evicted documents are destroyed');
  const os = require('node:os'), { build } = require('../scripts/build-memorizer.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memorizer-runtime-'));
  try {
    build(dir);
    const listeners = {}, cacheData = new Map();
    const key = r => typeof r === 'string' ? r : r.url;
    const cache = name => {
      if (!cacheData.has(name)) cacheData.set(name, new Map());
      const data = cacheData.get(name);
      return { match: r => Promise.resolve(data.get(key(r))?.clone()), put: (r, v) => { data.set(key(r), v.clone()); return Promise.resolve(); }, keys: () => Promise.resolve([...data.keys()].map(url => ({ url }))), addAll: () => Promise.resolve() };
    };
    const cdn = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    await cache('memorizer-abcdef').put(cdn, new Response('verified worker'));
    await cache('memorizer-old').put('index.html', new Response('cached app'));
    const caches = { open: name => Promise.resolve(cache(name)), keys: () => Promise.resolve([...cacheData.keys()]), delete: name => Promise.resolve(cacheData.delete(name)), match: async r => {
      for (const name of cacheData.keys()) { const hit = await cache(name).match(r); if (hit) return hit; }
    } };
    const self = { addEventListener: (name, fn) => { listeners[name] = fn; }, clients: { claim: () => Promise.resolve() } };
    vm.runInNewContext(fs.readFileSync(path.join(dir, 'sw.js'), 'utf8'), { self, caches, location: { origin: 'https://memorizer.test' }, URL,
      fetch: () => Promise.resolve(new Response('server error', { status: 503 })), setTimeout: () => 0 });
    let response; const waits = [];
    listeners.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://memorizer.test/index.html' }, respondWith: p => { response = p; }, waitUntil: p => waits.push(p) });
    assert.equal(await (await response).text(), 'cached app'); await Promise.all(waits);
    listeners.activate({ waitUntil: p => waits.push(p) }); await Promise.all(waits);
    assert.equal(cacheData.has('memorizer-abcdef'), false);
    assert.equal(await (await cache('memorizer-deps-v1').match(cdn)).text(), 'verified worker');
    console.log('PASS offline shell recovers from HTTP 503 and updates preserve pinned dependencies');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  const llm = require('../memorizer/src/llm.js');
  let created = 0, unloaded = 0;
  llm.useGpu(() => ({ ok: true, f16: true }));
  llm.useLib({ CreateMLCEngine: async () => { created++; return { unload: async () => { unloaded++; } }; }, deleteModelAllInfoInCache: async () => { throw new Error('synthetic cache refusal'); } });
  await Promise.all([llm.start('first'), llm.start('first')]); assert.equal(created, 1);
  await llm.start('second'); assert.equal(created, 2); assert.equal(unloaded, 1);
  assert.equal(llm.ready('first'), false); assert.equal(llm.ready('second'), true);
  await assert.rejects(llm.clearModel('second'), /synthetic cache refusal/);
  assert.equal(unloaded, 2);
  await Promise.all([llm.startEmbed(), llm.startEmbed()]); assert.equal(created, 3);
  await llm.stopEmbed(); assert.equal(unloaded, 3);
  console.log('PASS model starts are deduplicated, switching releases GPU memory, and cache failures are reported');

})();
if (require.main === module) module.exports.catch(error => { console.error(error); process.exitCode = 1; });
