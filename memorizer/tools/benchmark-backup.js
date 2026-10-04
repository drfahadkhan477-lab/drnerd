#!/usr/bin/env node
/* Synthetic backup measurements. Every CLI case gets a fresh Node process;
   no browser database, user files, network or provider keys are accessed. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { getHeapStatistics } = require('node:v8');

const MIB = 1048576;
const MAX_BYTES = 128 * MIB;
const CHECKSUMS = ['sha256', 'fnv1a64'];
const HARNESS_SHA256 = createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
const HELP = `Usage: node memorizer/tools/benchmark-backup.js [options]

  --sizes-mib <list>   Binary sizes in MiB (default: 8,32; maximum: 128 each)
  --checksums <list>   sha256,fnv1a64 (default: both)
  --repeat <count>     Fresh processes per size/checksum (default: 1; maximum: 10)
  --help              Show this help

Prints one JSON result per case. A mismatch or failed process exits nonzero.
Peak RSS includes fixture creation, export, preview, restore and verification.
No garbage collection is forced. Node memory fallback is measured, not
IndexedDB, Safari or an iPad. Binary fixtures are not parseable PDFs.
`;

function sizeBytes(value) {
  const bytes = Number(value) * MIB;
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(value)) || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_BYTES)
    throw new Error('Sizes must be positive MiB values yielding whole bytes, at most 128 MiB.');
  return bytes;
}

function options(argv) {
  const out = { sizes: [8 * MIB, 32 * MIB], checksums: CHECKSUMS.slice(), repeat: 1 };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' && argv.length === 1) return { help: true };
    if (!['--sizes-mib', '--checksums', '--repeat'].includes(flag) || seen.has(flag)) throw new Error('Unknown or repeated option: ' + flag);
    seen.add(flag);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error('Missing value for ' + flag);
    if (flag === '--sizes-mib') out.sizes = value.split(',').map(sizeBytes);
    if (flag === '--checksums') {
      out.checksums = value.split(',');
      if (out.checksums.some(v => !CHECKSUMS.includes(v)) || new Set(out.checksums).size !== out.checksums.length)
        throw new Error('Checksums must be sha256, fnv1a64, or sha256,fnv1a64.');
    }
    if (flag === '--repeat') {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 10) throw new Error('Repeat must be an integer from 1 to 10.');
      out.repeat = Number(value);
    }
  }
  return out;
}

function loadSources() {
  return ['store', 'provenance', 'backup'].map(name => ({ name, text: fs.readFileSync(path.join(__dirname, '../src/' + name + '.js'), 'utf8') }));
}

function runtime(checksum, sources) {
  const root = { btoa, atob, ArrayBuffer, DataView, Uint8Array, Uint16Array };
  const context = vm.createContext({ window: root, ArrayBuffer, DataView, Uint8Array, TextEncoder,
    crypto: checksum === 'sha256' ? webcrypto : undefined });
  for (const source of sources) vm.runInContext(source.text, context, { filename: source.name + '.js' });
  return root;
}

async function preview(backup, text) {
  // Keep only counts across the restore, as the confirmation dialog does.
  const result = await backup.inspect(text);
  assert.equal(result.docs, 1); assert.equal(result.books, 0); assert.equal(result.cards, 1);
  return { docs: result.docs, books: result.books, cards: result.cards };
}

async function runCase(config, sources = loadSources()) {
  assert.ok(Number.isInteger(config.bytes) && config.bytes > 0 && config.bytes <= MAX_BYTES, 'Invalid binary size');
  assert.ok(CHECKSUMS.includes(config.checksum), 'Invalid checksum');
  const root = runtime(config.checksum, sources), store = root.MemStore, backup = root.MemBackup;
  const rss = { baseline: process.memoryUsage().rss };
  const bytes = new Uint8Array(config.bytes);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + (i >>> 16)) & 255;
  const fixtureSha256 = createHash('sha256').update(bytes).digest('hex');
  const text = 'This synthetic source exists only for the backup benchmark.';
  const document = { id: 'benchmark', name: 'Synthetic backup benchmark', hasFile: true,
    clusters: [{ index: 0, title: 'Synthetic section', text, segments: [{ text, page: 1 }] }] };
  const note = { text: 'Synthetic note to rescue', page: 1 };
  const srs = { due: '2026-10-10', reps: 4 };
  await store.batch([
    { store: 'docs', value: document },
    { store: 'files', value: { id: document.id, bytes: bytes.buffer } },
    { store: 'sessions', value: { id: document.id, state: { docId: document.id, titles: ['Synthetic section'], per: { 0: { done: true } } } } },
    { store: 'cards', value: { id: 'benchmark-card', docId: document.id, cluster: 0, srs } },
    { store: 'meta', value: { id: 'notes', recs: { 'benchmark:0': note } } }
  ]);
  assert.equal(store.persistent, false);
  rss.seeded = process.memoryUsage().rss;
  const begin = performance.now();
  const exported = await backup.exportText();
  const afterExport = performance.now();
  rss.exported = process.memoryUsage().rss;
  const match = /"checksum":"(sha256:[a-f0-9]{64}|fnv1a64:[a-f0-9]{16})"/.exec(exported);
  assert.ok(match && match[1].startsWith(config.checksum + ':'), 'Requested checksum was not used');
  const counts = await preview(backup, exported);
  const afterPreview = performance.now();
  rss.previewed = process.memoryUsage().rss;
  await store.batch([
    { store: 'files', value: { id: document.id, bytes: new ArrayBuffer(0) } },
    { store: 'sessions', clear: true }, { store: 'cards', clear: true },
    { store: 'meta', value: { id: 'notes', recs: {} } }
  ]);
  const beforeRestore = performance.now();
  await backup.restore(exported);
  const afterRestore = performance.now();
  rss.restored = process.memoryUsage().rss;
  const saved = await store.get('files', document.id);
  assert.ok(saved && saved.bytes instanceof ArrayBuffer, 'Restored binary is missing');
  assert.equal(Buffer.compare(Buffer.from(saved.bytes), Buffer.from(bytes.buffer)), 0, 'Restored bytes differ');
  const session = await store.get('sessions', document.id);
  assert.equal(session?.state?.per?.[0]?.done, true, 'Restored progress differs');
  const restoredSrs = (await store.get('cards', 'benchmark-card'))?.srs;
  assert.equal(restoredSrs?.due, srs.due, 'Restored card due date differs');
  assert.equal(restoredSrs?.reps, srs.reps, 'Restored card review count differs');
  const restoredNote = (await store.get('meta', 'notes'))?.recs?.['benchmark:0'];
  assert.equal(restoredNote?.text, note.text, 'Restored note differs');
  assert.equal(restoredNote?.page, note.page, 'Restored note page differs');
  assert.equal((await store.get('docs', document.id))?.name, document.name, 'Restored document differs');
  rss.verified = process.memoryUsage().rss;
  rss.peak = process.resourceUsage().maxRSS * 1024;
  const sourceSha256 = createHash('sha256');
  for (const source of sources) sourceSha256.update(source.name + '\0' + source.text + '\0');
  return {
    format: 'memorizer-backup-benchmark', version: 1, measuredAt: new Date().toISOString(),
    node: process.version, platform: process.platform, arch: process.arch, pid: process.pid,
    heapLimitBytes: getHeapStatistics().heap_size_limit, storage: 'memory-fallback', forcedGc: false,
    harnessSha256: HARNESS_SHA256, sourceSha256: sourceSha256.digest('hex'), fixture: 'pattern-v1', fixtureSha256,
    binaryBytes: bytes.length, backupUtf8Bytes: Buffer.byteLength(exported), checksum: match[1],
    counts, verified: { everyByte: true, notes: true, progress: true, cards: true, document: true },
    milliseconds: { export: afterExport - begin, preview: afterPreview - afterExport, restore: afterRestore - beforeRestore },
    rssBytes: rss
  };
}

function main(argv) {
  const config = options(argv);
  if (config.help) { process.stdout.write(HELP); return; }
  const child = "require(process.argv[1]).runCase(JSON.parse(process.argv[2])).then(r => process.stdout.write(JSON.stringify(r) + '\\n')).catch(e => { console.error(e.message); process.exitCode = 1; });";
  for (const bytes of config.sizes) for (const checksum of config.checksums) for (let run = 1; run <= config.repeat; run++) {
    const result = spawnSync(process.execPath, [ '-e', child, __filename, JSON.stringify({ bytes, checksum }) ],
      { encoding: 'utf8', timeout: 180000, maxBuffer: 1048576 });
    if (result.error || result.status !== 0)
      throw new Error(`${bytes / MIB} MiB ${checksum} run ${run} failed: ${result.error?.message || result.signal || result.stderr.trim() || 'nonzero exit'}`);
    const measurement = JSON.parse(result.stdout);
    process.stdout.write(JSON.stringify({ ...measurement, run }) + '\n');
  }
}

module.exports = { options, loadSources, runCase, main };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error('Benchmark failed: ' + error.message); process.exitCode = 1; }
}
