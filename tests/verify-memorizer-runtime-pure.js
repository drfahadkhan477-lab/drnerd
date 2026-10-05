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
  const storedBytes = new ArrayBuffer(0);
  await Promise.all([verified.MemPdf.figuresOn('a', storedBytes, []), verified.MemPdf.figuresOn('a', storedBytes, [])]);
  assert.equal(opened, 2);
  await verified.MemPdf.figuresOn('b', new ArrayBuffer(0), []);
  assert.equal(destroyed, 2);
  await verified.MemPdf.release(); assert.equal(destroyed, 3);
  let cancelled = false, pagesRead = 0, cancelledDestroyed = 0;
  const cancelPdf = pdfRuntime(() => Promise.resolve({ ok: true, text: async () => '// verified synthetic' }), () => ({ promise: Promise.resolve({
    numPages: 2, getPage: async () => { pagesRead++; return { getViewport: () => ({ height: 10 }), getTextContent: async () => { cancelled = true; return { items: [] }; } }; },
    destroy: async () => { cancelledDestroyed++; }, getOutline: async () => []
  }) }));
  await assert.rejects(cancelPdf.MemPdf.read(new ArrayBuffer(0), null, null, { figures: false, cancelled: () => cancelled }), /cancelled/);
  assert.equal(pagesRead, 1); assert.equal(cancelledDestroyed, 1);
  console.log('PASS PDF integrity failure closes the path; completed and evicted documents are destroyed');
  let rasterized = 0, renderDestroyed = 0;
  const renderCanvases = [];
  const renderDoc = { createElement: kind => {
    if (kind === 'script') return {};
    const c = { width: 0, height: 0, getContext: () => ({}), toDataURL: () => 'data:image/png;base64,synthetic' }; renderCanvases.push(c); return c;
  }, head: { appendChild: script => queueMicrotask(() => script.onload()) } };
  const renderRoot = { pdfjsLib: { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ destroy: async () => { renderDestroyed++; },
    getPage: async () => ({ getViewport: () => ({ width: 10, height: 10 }), render: () => { rasterized++; return { promise: Promise.resolve() }; } }) }) }) } };
  vm.runInNewContext(pdfSource, { window: renderRoot, document: renderDoc, fetch: async () => ({ ok: true, text: async () => '// verified' }), URL, Blob, ArrayBuffer, Uint8Array });
  const renderBytes = new ArrayBuffer(0), pdf = renderRoot.MemPdf;
  await Promise.all([pdf.renderBox('a', renderBytes, 1), pdf.renderBox('a', renderBytes, 1)]); assert.equal(rasterized, 1);
  await pdf.renderBox('a', renderBytes, 1); assert.equal(rasterized, 1);
  for (let i = 2; i <= 10; i++) await pdf.renderBox('a', renderBytes, i);
  await pdf.renderBox('a', renderBytes, 1); assert.equal(rasterized, 11);
  assert.equal(renderCanvases.every(c => c.width === 0 && c.height === 0), true);
  await pdf.renderBox('a', new ArrayBuffer(0), 1); assert.equal(renderDestroyed, 1);
  await pdf.release(); assert.equal(renderDestroyed, 2);
  console.log('PASS repeated renders share a promise; raster cache is bounded and byte replacement invalidates the PDF');
  let workerTerminated = 0, timerCleared = 0, revoked = 0;
  const canvases = [];
  const ocrRoot = { MemPdf: { loadScript: async () => {} }, Tesseract: { createWorker: async () => ({ recognize: async () => ({ data: { blocks: [] } }), terminate: async () => { workerTerminated++; } }) } };
  const ocrDoc = { createElement: () => { const c = { width: 0, height: 0, getContext: () => ({ fillRect() {} }) }; canvases.push(c); return c; } };
  class Reader { readAsArrayBuffer(blob) { blob.arrayBuffer().then(v => { this.result = v; this.onload(); }); } }
  const ocrSrc = fs.readFileSync(path.join(__dirname, '../memorizer/src/ocr.js'), 'utf8');
  const O = require('../memorizer/src/ocr.js');
  const workerText = O.WORKER_FIX.find + ';' + O.CORE_FIX.find;
  vm.runInNewContext(ocrSrc, { window: ocrRoot, document: ocrDoc, Blob, FileReader: Reader, TextDecoder, Uint8Array,
    fetch: async url => ({ ok: true, blob: async () => new Blob([/tesseract.js-core/.test(url) ? O.CORE_BINARY_FIX.find : workerText]) }), URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL: () => { revoked++; } },
    setTimeout: () => 1, clearTimeout: () => { timerCleared++; } });
  await ocrRoot.MemOcr.readPage({ getViewport: () => ({ width: 10, height: 10 }), render: () => ({ promise: Promise.resolve() }) });
  assert.equal(canvases[0].width, 0); assert.equal(canvases[0].height, 0); assert.equal(timerCleared, 1); assert.equal(revoked, 1);
  await ocrRoot.MemOcr.release(); assert.equal(workerTerminated, 1);
  console.log('PASS import cancellation stops between pages and OCR releases workers, canvases, timers and blob URLs');
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
  /* a stand-in engine downloads nothing, so the check of its files against
     models.js (llm.js verify) stands in too: this is about the lifecycle */
  llm.useVerify(async () => ({ ok: true, checked: 1, bad: [], unknown: [] }));
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
