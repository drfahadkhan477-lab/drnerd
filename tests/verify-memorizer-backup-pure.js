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
  // A rejected backup must leave every store exactly as it was, so compare the
  // whole database before and after, not only the record each case corrupts.
  const state = async () => JSON.parse(await backup.exportText()).payload;
  const resealed = async records => { const payload = JSON.stringify(records); return JSON.stringify({ ...JSON.parse(text), payload, checksum: await root.MemProvenance.fingerprint(payload) }); };
  // Start from a known, full database: "unchanged" proves nothing about an
  // empty one, which a defect upstream of this block could already have left.
  await backup.restore(text);
  const before = await state();
  assert.equal(JSON.parse(before).docs.length, 1, 'the unchanged-database cases need data to lose');
  const truncated = text.slice(0, Math.floor(text.length / 2));
  await assert.rejects(backup.restore(truncated));
  assert.equal(await state(), before, 'a truncated backup changed the database');
  const unsafe = JSON.parse(JSON.parse(text).payload);
  unsafe.cards[0].srs = JSON.parse('{"__proto__": {"polluted": true}, "due": "2026-10-10", "reps": 4}');
  await assert.rejects(backup.restore(await resealed(unsafe)), /Unsafe record key/);
  assert.equal(await state(), before, 'an unsafe record key changed the database');
  const badView = JSON.parse(JSON.parse(text).payload);
  badView.meta.find(r => r.id === 'binary-view').bytes.$binary = 'Function';
  await assert.rejects(backup.restore(await resealed(badView)), /Invalid binary view/);
  assert.equal(await state(), before, 'an unknown binary view type changed the database');
  // Text outside ASCII survives the round trip: accents, Greek, CJK, an emoji
  // outside the BMP, a combining mark, a right-to-left run and a NUL.
  const unicode = 'Δ β‑blocker — Müller é 心臓 🫀 שלום \u0000 end';
  await store.batch([{ store: 'docs', value: { ...document, name: unicode, clusters: [{ ...document.clusters[0], title: unicode, text: unicode, segments: [{ text: unicode, page: 1 }] }] } },
    { store: 'meta', value: { id: 'notes', recs: { 'unit:0': { text: unicode } } } }]);
  const unicodeBackup = await backup.exportText();
  await store.batch([{ store: 'docs', value: document }, { store: 'meta', value: { id: 'notes', recs: {} } }]);
  await backup.restore(unicodeBackup);
  const restoredDoc = await store.get('docs', 'unit');
  assert.equal(restoredDoc.name, unicode); assert.equal(restoredDoc.clusters[0].segments[0].text, unicode);
  assert.equal((await store.get('meta', 'notes')).recs['unit:0'].text, unicode);
  // An empty database exports, and restoring it empties every store: a
  // restore replaces, it does not merge.
  await store.batch(root.MemStore.STORES.map(s => ({ store: s, clear: true })));
  const emptyBackup = await backup.exportText();
  assert.equal((await backup.inspect(emptyBackup)).docs, 0);
  await backup.restore(unicodeBackup);
  assert.equal((await store.all('docs')).length, 1, 'the empty-restore case needs data to remove');
  await backup.restore(emptyBackup);
  for (const s of root.MemStore.STORES) assert.equal((await store.all(s)).length, 0, s + ' kept records after an empty restore');
  await backup.restore(text);
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
  console.log('PASS truncated, unsafe-key and unknown-view backups are refused with the whole database unchanged');
  console.log('PASS non-ASCII text round-trips exactly, and an empty backup restores to empty stores');
})();
if (require.main === module) module.exports.catch(error => { console.error(error); process.exitCode = 1; });
