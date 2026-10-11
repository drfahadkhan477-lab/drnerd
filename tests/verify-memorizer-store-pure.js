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

  /* ── on an IndexedDB whose transactions can be held, hung or failed ──────
     (tests/_fakeidb.js). `idb.data` is what landed and `idb.transactions`
     what was asked of the database: read below the store's own account. */
  const { makeIDB } = require('./_fakeidb.js');
  const onFake = opts => {
    const idb = makeIDB(opts), r = { indexedDB: idb.indexedDB, IDBRequest: idb.IDBRequest, setTimeout, clearTimeout };
    vm.runInNewContext(source, { window: r, ArrayBuffer, DataView });
    assert.ok(r.MemStore, 'store.js did not load');
    return { store: r.MemStore, idb };
  };
  const within = (p, ms) => Promise.race([p.then(v => ({ v }), e => ({ e })), sleep(ms).then(() => ({ waiting: true }))]);

  /* A WRITE THAT NEVER FINISHES. Every read waits for the writes queued
     before it, so one hung transaction left openDoc and every refresh()
     waiting for ever. Past its bound a write is aborted and rejects, it is
     kept for retry, and the queue moves on. Each kind of write the queue
     runs (a tracked put, a study step, a batch) is hung in turn, the first
     two with an abort that is never answered. */
  for (const kind of ['put', 'saveStep', 'batch']) {
    let hangNext = false, hungN = -1;
    const { store, idb } = onFake({ onTransaction: t => {
      if (t.mode !== 'readwrite' || !hangNext) return undefined;
      hangNext = false; hungN = t.n; return kind === 'batch' ? 'hang' : 'wedge';
    } });
    store.TX_TIMEOUT_MS = 40;
    const cluster = { title: 'One', text: 'Synthetic.', segments: [] };
    await store.batch([{ store: 'docs', value: { id: 'u', clusters: [cluster] } }, { store: 'meta', value: { id: 'before', v: 1 } }]);
    hangNext = true;
    const hung = kind === 'put' ? store.put('meta', { id: 'notes', recs: { 'u:0': { text: 'Kept for retry' } } })
      : kind === 'saveStep' ? store.saveStep({ id: 'u', state: { docId: 'u', titles: ['One'], per: {} } }, [{ id: 'u:card', docId: 'u', cluster: 0 }])
      : store.deleteDoc('u');
    const behind = store.get('meta', 'before');
    const got = await within(hung, 2000), ht = idb.transactions[hungN];
    assert.ok(ht, kind + ': (the write was really hung)');
    assert.equal(got.waiting, undefined, kind + ': a write that never finishes still had not settled after 2 s');
    assert.equal(got.e && got.e.name, 'TimeoutError', kind + ': it rejects with a TimeoutError once its bound has passed');
    assert.ok(ht.aborted && ht.abortCalls === 1, kind + ': and its transaction is aborted, so it cannot land later');
    const read = await within(behind, 2000);
    assert.deepEqual(read.v, { id: 'before', v: 1 }, kind + ': a read queued behind the hung write settles');
    if (kind === 'batch') {
      assert.ok(idb.data.get('docs').has('u'), 'batch: nothing of the aborted deletion landed');
      await store.deleteDoc('u');
      assert.equal(idb.data.get('docs').has('u'), false, 'batch: the queue moved on: the deletion asked again lands');
    } else {
      assert.match(store.failureMessage(), /^storage did not answer within 0\.04 seconds$/, kind + ': the write is kept for "Try saving again", saying why');
      assert.equal(idb.data.get(kind === 'put' ? 'meta' : 'sessions').has(kind === 'put' ? 'notes' : 'u'), false, kind + ': nothing of it landed');
      await store.retryFailures();
      assert.equal(store.failureMessage(), '', kind + ': the retry lands');
      assert.ok(kind === 'put' ? idb.data.get('meta').get('notes').recs['u:0'].text === 'Kept for retry' : idb.data.get('cards').has('u:card'), kind + ': with what the hung write carried');
    }
  }
  console.log('PASS a write that never finishes (a put, a study step, a batch) is aborted past its bound and rejects; a read behind it settles; it is kept for retry');

  /* A write that lands in time is never aborted afterwards (its bound is
     let go), and a read is never bounded: one held past the write bound
     still answers. */
  {
    let holdReads = 0;
    const { store, idb } = onFake({ onTransaction: t => (t.mode === 'readonly' && holdReads ? sleep(holdReads) : undefined) });
    store.TX_TIMEOUT_MS = 40;
    await store.put('meta', { id: 'landed', v: 2 });
    await store.saveStep({ id: 's', state: {} }, []);
    await store.batch([{ store: 'meta', value: { id: 'batched' } }]);
    await sleep(160);
    assert.deepEqual(idb.transactions.filter(t => t.mode === 'readwrite').map(t => t.abortCalls), [0, 0, 0], 'a write that landed in time was aborted later');
    holdReads = 150;
    const slowRead = await within(store.get('meta', 'landed'), 2000);
    assert.deepEqual(slowRead.v, { id: 'landed', v: 2 }, 'a read held past the write bound was cut off: ' + (slowRead.e && slowRead.e.name));
  }
  console.log('PASS a write that lands in time is never aborted afterwards, and a slow read is not bounded');

  /* A large write is given longer, in proportion to what it carries: a
     restore or a PDF part must not be cut off for its size. Here the bound
     is 40 ms and a byte buys a millisecond; a write of ~400 bytes held for
     150 ms lands, and a write of a few bytes held as long does not. */
  {
    let hold = 0;
    const { store, idb } = onFake({ onTransaction: t => (t.mode === 'readwrite' && hold ? sleep(hold) : undefined) });
    store.TX_TIMEOUT_MS = 40; store.TX_BYTES_PER_MS = 1;
    hold = 150;
    const big = await within(store.put('files', { id: 'big', bytes: new Uint8Array(400).buffer }), 2000);
    assert.equal(big.e, undefined, 'a 400-byte write held 150 ms was cut off: ' + (big.e && big.e.name));
    assert.ok(idb.data.get('files').has('big'), 'and it landed');
    const small = await within(store.put('files', { id: 'small', bytes: new Uint8Array(4).buffer }), 2000);
    assert.equal(small.e && small.e.name, 'TimeoutError', 'a 4-byte write held 150 ms was not bounded at all');
  }
  console.log('PASS a write is given time in proportion to the bytes it carries');

})();
if (require.main === module) module.exports.catch(error => { console.error(error); process.exitCode = 1; });
