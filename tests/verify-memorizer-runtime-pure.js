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
})();
if (require.main === module) module.exports.catch(error => { console.error(error); process.exitCode = 1; });
