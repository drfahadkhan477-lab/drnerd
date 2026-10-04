#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
module.exports = (async () => {
  const root = { btoa, atob, ArrayBuffer, DataView, Uint8Array, Uint16Array, localStorage: { key: 'sk-ant-synthetic-never-export' } };
  const context = vm.createContext({ window: root, ArrayBuffer, DataView, Uint8Array, TextEncoder });
  for (const file of ['store', 'provenance', 'backup']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../memorizer/src/' + file + '.js'), 'utf8'), context);
  const store = root.MemStore, backup = root.MemBackup;
  const bytes = [37, 80, 68, 70, 0, 255];
  const document = { id: 'unit', name: 'Synthetic PDF', hasFile: true, clusters: [{ index: 0, title: 'One', text: 'Synthetic source.', segments: [{ text: 'Synthetic source.', page: 1 }] }] };
  await store.batch([{ store: 'docs', value: document }, { store: 'files', value: { id: 'unit', bytes: Uint8Array.from(bytes).buffer } },
    { store: 'sessions', value: { id: 'unit', state: { docId: 'unit', titles: ['One'], per: { 0: { done: true } } } } },
    { store: 'cards', value: { id: 'card', docId: 'unit', cluster: 0, srs: { due: '2026-10-10', reps: 4 } } },
    { store: 'meta', value: { id: 'binary-view', bytes: new Uint16Array(Uint8Array.from([0, 0, 2, 0, 3, 0]).buffer, 2, 2) } },
    { store: 'meta', value: { id: 'notes', recs: { 'unit:0': { text: 'My note' } } } }]);
  const text = await backup.exportText(), preview = await backup.inspect(text);
  assert.deepEqual(Array.from(preview.stores.meta.find(v => v.id === 'binary-view').bytes), [2, 3]);
  assert.equal(preview.docs, 1); assert.equal(preview.cards, 1);
  assert.deepEqual(Array.from(new Uint8Array(preview.stores.files[0].bytes)), bytes);
  assert.equal(text.includes('sk-ant-synthetic-never-export'), false);
  await store.put('docs', { ...document, id: 'extra' });
  await store.put('meta', { id: 'notes', recs: {} });
  await backup.restore(text);
  assert.equal((await store.all('docs')).length, 1);
  assert.deepEqual(Array.from(new Uint8Array((await store.get('files', 'unit')).bytes)), bytes);
  assert.equal((await store.get('sessions', 'unit')).state.per[0].done, true);
  assert.equal((await store.get('cards', 'card')).srs.reps, 4);
  assert.equal((await store.get('meta', 'notes')).recs['unit:0'].text, 'My note');
  const corrupted = JSON.parse(text); corrupted.payload = corrupted.payload.replace('Synthetic PDF', 'Changed PDF');
  await assert.rejects(backup.restore(JSON.stringify(corrupted)), /checksum/);
  assert.equal((await store.get('docs', 'unit')).name, 'Synthetic PDF');
  await assert.rejects(backup.inspect(JSON.stringify({ ...JSON.parse(text), version: 2 })), /version/);
  const invalid = JSON.parse(JSON.parse(text).payload); invalid.files = [];
  const payload = JSON.stringify(invalid), checksum = await root.MemProvenance.fingerprint(payload);
  await assert.rejects(backup.restore(JSON.stringify({ ...JSON.parse(text), payload, checksum })), /missing its PDF/);
  // Correct checksums must not allow malformed binary syntax through.
  for (const data of ['A', 'A===', 'AA=A', '====', 'AA A', 'AA-_']) {
    const records = JSON.parse(JSON.parse(text).payload);
    records.files[0].bytes.data = data;
    const payload = JSON.stringify(records), checksum = await root.MemProvenance.fingerprint(payload);
    await assert.rejects(backup.restore(JSON.stringify({ ...JSON.parse(text), payload, checksum })), /Invalid binary payload/);
    assert.deepEqual(Array.from(new Uint8Array((await store.get('files', 'unit')).bytes)), bytes);
  }
  // Keep the version 1 format compatible with an independent encoder,
  // including padding on either side of a binary conversion boundary.
  for (const length of [0, 1, 2, 3, 8189, 8190, 8191, 16379, 16380, 16381]) {
    const binary = Uint8Array.from({ length }, (_, i) => (i * 31 + (i >>> 8)) & 255);
    await store.put('files', { id: 'unit', bytes: binary.buffer });
    const envelope = JSON.parse(await backup.exportText());
    const records = JSON.parse(envelope.payload);
    assert.equal(envelope.version, 1);
    assert.equal(records.files[0].bytes.data, Buffer.from(binary).toString('base64'));
    // Restore version 1 data encoded outside Memorizer, not just data
    // produced by its own matching encoder/decoder.
    records.files[0].bytes.data = Buffer.from(binary).toString('base64');
    const payload = JSON.stringify(records), checksum = await root.MemProvenance.fingerprint(payload);
    await backup.restore(JSON.stringify({ ...envelope, payload, checksum }));
    assert.equal(Buffer.compare(Buffer.from((await store.get('files', 'unit')).bytes), Buffer.from(binary)), 0);
  }
  // An actual export/restore, including byte comparison, protects against
  // regex stack overflow and whole-PDF conversion strings that tiny
  // fixtures cannot expose. Enforce a 64 KiB temporary conversion budget.
  root.btoa = raw => { assert.ok(raw.length <= 64 * 1024, 'export conversion exceeds the temporary string budget'); return btoa(raw); };
  root.atob = encoded => { assert.ok(encoded.length <= 64 * 1024, 'restore conversion exceeds the temporary string budget'); return atob(encoded); };
  const large = new Uint8Array(8 * 1024 * 1024);
  for (let i = 0; i < large.length; i++) large[i] = (i * 31 + (i >>> 16)) & 255;
  await store.put('files', { id: 'unit', bytes: large.buffer });
  const largeBackup = await backup.exportText();
  await store.put('files', { id: 'unit', bytes: new ArrayBuffer(0) });
  await backup.restore(largeBackup);
  assert.equal(Buffer.compare(Buffer.from((await store.get('files', 'unit')).bytes), Buffer.from(large)), 0);
  console.log('PASS version 1 base64 matches an independent encoder across padding/chunk boundaries');
  console.log('PASS 8 MiB backup preserves every byte within the conversion budget; malformed base64 is rejected without writes');
  console.log('PASS backup restores PDF bytes, notes, progress and SRS; excludes keys and refuses corruption/incomplete records');
})();
if (require.main === module) module.exports.catch(error => { console.error(error); process.exitCode = 1; });
