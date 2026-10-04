/* Versioned local backups. Binary payloads and failed writes are included;
   provider keys and model caches are not part of the study database. */
(function (root) {
'use strict';
var Store = root.MemStore, Prov = root.MemProvenance;
var VERSION = 1, FORMAT = 'memorizer-backup';
var VIEWS = ['Uint8Array', 'Uint8ClampedArray', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array', 'DataView'];
function base64(buffer) {
  var bytes = new Uint8Array(buffer), parts = [];
  for (var i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)));
  return root.btoa(parts.join(''));
}
function bufferOf(text) {
  // Repeating four-character regex groups can exhaust the regex engine's
  // stack on ordinary book-sized payloads. Scan the alphabet and padding.
  if (typeof text !== 'string' || text.length % 4) throw new Error('Invalid binary payload.');
  var end = text.length;
  if (end && text.charAt(end - 1) === '=') end--;
  if (end && text.charAt(end - 1) === '=') end--;
  for (var i = 0; i < end; i++) {
    var c = text.charCodeAt(i);
    if (!(c >= 65 && c <= 90) && !(c >= 97 && c <= 122) && !(c >= 48 && c <= 57) && c !== 43 && c !== 47) throw new Error('Invalid binary payload.');
  }
  var raw = root.atob(text), out = new Uint8Array(raw.length);
  for (i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}
function map(value, decode) {
  if (!decode && value instanceof ArrayBuffer) return { $binary: 'ArrayBuffer', data: base64(value) };
  if (!decode && ArrayBuffer.isView(value)) return { $binary: value.constructor.name, data: base64(value.buffer), offset: value.byteOffset, length: value instanceof DataView ? value.byteLength : value.length };
  if (!value || typeof value !== 'object') return value;
  if (decode && value.$binary) {
    var buffer = bufferOf(value.data);
    if (value.$binary === 'ArrayBuffer') return buffer;
    if (VIEWS.indexOf(value.$binary) < 0 || !Number.isInteger(value.offset) || !Number.isInteger(value.length) || value.offset < 0 || value.length < 0) throw new Error('Invalid binary view.');
    return new root[value.$binary](buffer, value.offset, value.length);
  }
  var out = Array.isArray(value) ? [] : {};
  Object.keys(value).forEach(function (k) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') throw new Error('Unsafe record key.');
    out[k] = map(value[k], decode);
  }); return out;
}
function validate(stores) {
  if (!stores || typeof stores !== 'object' || Object.keys(stores).length !== Store.STORES.length) throw new Error('Incomplete backup stores.');
  Store.STORES.forEach(function (s) {
    if (!Array.isArray(stores[s])) throw new Error('Missing store: ' + s);
    var ids = Object.create(null);
    stores[s].forEach(function (r) {
      if (!r || typeof r.id !== 'string' || !r.id || ['__proto__', 'constructor', 'prototype'].indexOf(r.id) !== -1 || ids[r.id]) throw new Error('Invalid or duplicate record in ' + s);
      ids[r.id] = true;
    });
  });
  var docs = {}, files = {};
  stores.files.forEach(function (r) { if (!(r.bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(r.bytes)) throw new Error('PDF bytes are missing.'); files[r.id] = true; });
  stores.docs.forEach(function (d) { if (!Array.isArray(d.clusters) || !d.clusters.length || d.clusters.some(function (c) { return !c || typeof c.text !== 'string' || !Array.isArray(c.segments); })) throw new Error('Invalid document.'); docs[d.id] = d; });
  stores.docs.forEach(function (d) { if (d.hasFile && !(d.parts ? d.parts.every(function (p) { return files[p.fileId]; }) : files[d.id])) throw new Error('A document is missing its PDF.'); });
  stores.sessions.forEach(function (r) { if (!docs[r.id] || !r.state || r.state.docId !== r.id || !r.state.per || !Array.isArray(r.state.titles) || r.state.titles.length !== docs[r.id].clusters.length) throw new Error('Invalid session.'); });
  stores.cards.forEach(function (c) { if (!docs[c.docId] || !Number.isInteger(c.cluster) || !docs[c.docId].clusters[c.cluster]) throw new Error('A card has no source section.'); });
  stores.books.forEach(function (b) { if (!Array.isArray(b.parts) || !Array.isArray(b.chapters) || b.parts.some(function (p) { return !files[p.fileId]; }) || b.chapters.some(function (c) { return c.docId && !docs[c.docId]; })) throw new Error('Incomplete book.'); });
  ['packs', 'vectors'].forEach(function (s) { stores[s].forEach(function (r) { if (!docs[r.id]) throw new Error('Derived data has no document.'); }); });
  return stores;
}
function exportText() {
  return Store.snapshot().then(function (stores) {
    // Incomplete imports are temporary, not user-visible study data.
    var staged = stores.meta.filter(function (r) { return r.kind === 'pending-import'; });
    staged.forEach(function (r) {
      stores.files = stores.files.filter(function (f) { return (r.files || []).indexOf(f.id) === -1; });
      stores.bookpages = stores.bookpages.filter(function (p) { return (r.pages || []).indexOf(p.id) === -1; });
    });
    stores.meta = stores.meta.filter(function (r) { return r.kind !== 'pending-import'; });
    var payload = JSON.stringify(map(stores, false));
    return Prov.fingerprint(payload).then(function (checksum) { return JSON.stringify({ format: FORMAT, version: VERSION, created: new Date().toISOString(), checksum: checksum, payload: payload }); });
  });
}
function inspect(text) {
  return Promise.resolve().then(function () {
    var b = JSON.parse(text);
    if (b.format !== FORMAT || b.version !== VERSION || typeof b.payload !== 'string' || !/^(sha256|fnv1a64):[a-f0-9]+$/.test(b.checksum)) throw new Error('Unsupported backup format or version.');
    return Prov.fingerprint(b.payload, b.checksum.indexOf('fnv1a64:') === 0 ? null : undefined).then(function (sum) {
      if (sum !== b.checksum) throw new Error('Backup checksum does not match.');
      var stores = validate(map(JSON.parse(b.payload), true));
      return { stores: stores, docs: stores.docs.length, books: stores.books.length, cards: stores.cards.length, created: b.created };
    });
  });
}
function restore(text) {
  return inspect(text).then(function (r) {
    var ops = Store.STORES.map(function (s) { return { store: s, clear: true }; });
    Store.STORES.forEach(function (s) { r.stores[s].forEach(function (v) { ops.push({ store: s, value: v }); }); });
    return Store.batch(ops).then(function () { Store.forgetFailures(); return r; });
  });
}
root.MemBackup = { exportText: exportText, inspect: inspect, restore: restore, VERSION: VERSION };
})(typeof window !== 'undefined' ? window : this);
