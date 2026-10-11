#!/usr/bin/env node
/* Synthetic PDF bytes; no browser, build or licensed content required. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../memorizer/src/store.js'), 'utf8');

module.exports = (async () => {
  for (const nativeClone of [true, false]) {
    for (const failure of ['missing', 'throws', 'error', 'blocked']) {
      const root = { structuredClone: nativeClone ? structuredClone : undefined };
      if (failure === 'throws') root.indexedDB = { open() { throw new Error('refused'); } };
      if (failure === 'error' || failure === 'blocked') root.indexedDB = {
        open() {
          const req = {};
          queueMicrotask(() => req[failure === 'error' ? 'onerror' : 'onblocked']());
          return req;
        }
      };
      vm.runInNewContext(source, { window: root, ArrayBuffer, DataView });
      const store = root.MemStore;
      const expected = [37, 80, 68, 70, 45, 49, 46, 55, 10, 0, 255]; // %PDF-1.7 plus binary bytes
      const input = { id: 'synthetic-pdf', bytes: Uint8Array.from(expected).buffer,
        metadata: { tags: ['synthetic'] } };
      await store.put('files', input);
      assert.equal(store.persistent, false);
      new Uint8Array(input.bytes).fill(0);
      input.metadata.tags.push('mutated input');
      const read = await store.get('files', input.id);
      assert.ok(read.bytes instanceof ArrayBuffer);
      assert.deepEqual(Array.from(new Uint8Array(read.bytes)), expected);
      assert.deepEqual(Array.from(read.metadata.tags), ['synthetic']);
      new Uint8Array(read.bytes).fill(1);
      read.metadata.tags.push('mutated get');
      const listed = await store.all('files');
      assert.deepEqual(Array.from(new Uint8Array(listed[0].bytes)), expected);
      assert.deepEqual(Array.from(listed[0].metadata.tags), ['synthetic']);
      new Uint8Array(listed[0].bytes).fill(2);
      listed[0].metadata.tags.push('mutated all');
      const reread = await store.get('files', input.id);
      assert.deepEqual(Array.from(new Uint8Array(reread.bytes)), expected);
      assert.deepEqual(Array.from(reread.metadata.tags), ['synthetic']);

      // Views keep their type, range and bytes, without sharing the input buffer.
      for (const view of [new Uint8Array(Uint8Array.from(expected).buffer, 2, 5),
        new DataView(Uint8Array.from(expected).buffer, 2, 5)]) {
        await store.put('files', { id: 'view', bytes: view });
        new Uint8Array(view.buffer).fill(0);
        const result = (await store.get('files', 'view')).bytes;
        assert.equal(result.constructor, view.constructor);
        assert.equal(result.byteOffset, 2);
        assert.equal(result.byteLength, 5);
        assert.deepEqual(Array.from(new Uint8Array(result.buffer, 2, 5)), expected.slice(2, 7));
      }
      assert.equal(await store.get('files', 'missing'), null);
      await store.del('files', input.id);
      assert.equal(await store.get('files', input.id), null);
      console.log(`PASS fallback ${failure}, structuredClone ${nativeClone ? 'available' : 'unavailable'}: PDF bytes and copy isolation`);
    }
  }
  const root = {};
  vm.runInNewContext(source, { window: root, ArrayBuffer, DataView });
  await root.MemStore.batch([{ store: 'docs', value: { id: 'unit', name: 'Original' } }, { store: 'notes', value: { id: 'invalid' } }]).then(() => assert.fail('invalid batch accepted'), () => {});
  assert.equal(await root.MemStore.get('docs', 'unit'), null);
  const ops = [{ store: 'docs', value: { id: 'unit', name: 'Saved' } }, { store: 'meta', value: { id: 'notes', recs: { 'unit:0': 'Note' } } }];
  await root.MemStore.batch(ops);
  ops[0].value.name = 'Changed';
  assert.equal((await root.MemStore.get('docs', 'unit')).name, 'Saved');
  assert.equal((await root.MemStore.get('meta', 'notes')).recs['unit:0'], 'Note');
  console.log('PASS batch validation and copy isolation');

  let req, closed = false;
  const blockedRoot = { indexedDB: { open() { req = {}; queueMicrotask(() => req.onblocked()); return req; } } };
  vm.runInNewContext(source, { window: blockedRoot, ArrayBuffer, DataView });
  assert.equal(await blockedRoot.MemStore.open(), null);
  req.result = { close() { closed = true; } }; req.onsuccess();
  assert.equal(blockedRoot.MemStore.persistent, false);
  assert.equal(await blockedRoot.MemStore.open(), null);
  assert.equal(closed, true);
  console.log('PASS blocked then late-success stays honestly in fallback and closes the unused connection');

  /* An open that never answers (no success, error or blocked event, as Safari
     14.1's first open could do) must not leave every read and write waiting for
     ever: after its bound the visit goes on from memory, saying why. */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let hungReq, hungClosed = false;
  const hungRoot = { indexedDB: { open() { hungReq = {}; return hungReq; } }, setTimeout, clearTimeout };
  vm.runInNewContext(source, { window: hungRoot, ArrayBuffer, DataView });
  hungRoot.MemStore.OPEN_TIMEOUT_MS = 30;
  const hung = await Promise.race([hungRoot.MemStore.open(), sleep(2000).then(() => 'still waiting')]);
  assert.equal(hung, null, 'an open that never answers falls back to memory within its bound');
  assert.equal(hungRoot.MemStore.openTimedOut, true);
  assert.equal(hungRoot.MemStore.persistent, false);
  await hungRoot.MemStore.put('docs', { id: 'd', name: 'kept for this visit' });
  assert.equal((await hungRoot.MemStore.get('docs', 'd')).name, 'kept for this visit');
  hungReq.result = { close() { hungClosed = true; } }; hungReq.onsuccess();
  assert.equal(hungClosed, true, 'a connection that arrives after the bound is closed unused');
  assert.equal(hungRoot.MemStore.persistent, false);
  console.log('PASS an open that never answers falls back to memory after its bound, says why, and closes a late connection');

  /* cleared counts the bound being cancelled: the timer's own guard would
     hold openTimedOut false even with the clear removed */
  let cleared = 0;
  const okRoot = { indexedDB: { open() { const r = {}; queueMicrotask(() => { r.result = {}; r.onsuccess(); }); return r; } }, setTimeout, clearTimeout: t => { cleared++; clearTimeout(t); } };
  vm.runInNewContext(source, { window: okRoot, ArrayBuffer, DataView });
  okRoot.MemStore.OPEN_TIMEOUT_MS = 30;
  const db = await okRoot.MemStore.open();
  await sleep(80);
  assert.ok(db, 'an open that answers resolves with its connection');
  assert.equal(cleared, 1, 'its bound is cleared when the open answers');
  assert.equal(okRoot.MemStore.openTimedOut, false, 'and never fires');
  assert.equal(okRoot.MemStore.persistent, true);
  console.log('PASS an open that answers in time is used, and its bound never fires');

  const deck = root.MemStore;
  await deck.put('cards', { id: 'card', errorType: 'C', hazard: false, srs: { due: '2026-10-10', reps: 4 } });
  await deck.saveStep({ id: 'unit', state: {} }, [{ id: 'card', errorType: 'R', hazard: true, srs: null }]);
  const card = await deck.get('cards', 'card');
  assert.equal(card.errorType, 'R'); assert.equal(card.hazard, true);
  assert.equal(card.srs.due, '2026-10-10'); assert.equal(card.srs.reps, 4);
  assert.equal((await deck.all('cards')).length, 1);
  console.log('PASS existing card metadata updates without resetting its SRS history');

  await deck.batch([{ store: 'docs', value: { id: 'cleanup', revision: 2 } }, { store: 'meta', value: { id: 'notes', recs: { 'cleanup:0': 'Gone', 'keep:0': 'Keep' } } }, { store: 'cards', value: { id: 'gone-card', docId: 'cleanup' } }]);
  await deck.update('docs', 'cleanup', d => Object.assign(d, { figures: [1] }));
  assert.equal((await deck.get('docs', 'cleanup')).revision, 2);
  await deck.deleteDoc('cleanup');
  assert.equal(await deck.get('docs', 'cleanup'), null);
  assert.equal(await deck.get('cards', 'gone-card'), null);
  assert.equal((await deck.get('meta', 'notes')).recs['cleanup:0'], undefined);
  assert.equal((await deck.get('meta', 'notes')).recs['keep:0'], 'Keep');
  await deck.update('docs', 'cleanup', d => d && Object.assign(d, { figures: [2] }));
  assert.equal(await deck.get('docs', 'cleanup'), null);
  await deck.batch([{ store: 'meta', value: { id: 'import:test', kind: 'pending-import', files: ['orphan'], pages: ['orphan-pages'] } }, { store: 'files', value: { id: 'orphan', bytes: Uint8Array.from([1]).buffer } }, { store: 'bookpages', value: { id: 'orphan-pages', pages: [] } }]);
  await deck.cleanImports();
  assert.equal(await deck.get('files', 'orphan'), null);
  assert.equal(await deck.get('bookpages', 'orphan-pages'), null);
  console.log('PASS atomic cleanup, abandoned-import recovery and late figure updates');

})();
if (require.main === module) module.exports.catch(error => { console.error(error); process.exitCode = 1; });
