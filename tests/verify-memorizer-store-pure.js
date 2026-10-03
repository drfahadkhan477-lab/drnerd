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

  const deck = root.MemStore;
  await deck.put('cards', { id: 'card', errorType: 'C', hazard: false, srs: { due: '2026-10-10', reps: 4 } });
  await deck.saveStep({ id: 'unit', state: {} }, [{ id: 'card', errorType: 'R', hazard: true, srs: null }]);
  const card = await deck.get('cards', 'card');
  assert.equal(card.errorType, 'R'); assert.equal(card.hazard, true);
  assert.equal(card.srs.due, '2026-10-10'); assert.equal(card.srs.reps, 4);
  assert.equal((await deck.all('cards')).length, 1);
  console.log('PASS existing card metadata updates without resetting its SRS history');

})();
if (require.main === module) module.exports.catch(error => { console.error(error); process.exitCode = 1; });
