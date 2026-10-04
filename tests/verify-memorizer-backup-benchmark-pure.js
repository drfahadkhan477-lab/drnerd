#!/usr/bin/env node
/* The benchmark must isolate measurements and reject damaged restores. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const benchmarkPath = path.join(__dirname, '../memorizer/tools/benchmark-backup.js');
const benchmark = require(benchmarkPath);
const invoke = (args, env = process.env) => spawnSync(process.execPath, [benchmarkPath, ...args],
  { cwd: os.tmpdir(), env, encoding: 'utf8', timeout: 30000 });

module.exports = (async () => {
  const help = invoke(['--help']);
  assert.equal(help.status, 0); assert.match(help.stdout, /not.*\nIndexedDB, Safari or an iPad/);
  for (const args of [['--sizes-mib', '0'], ['--sizes-mib', '129'], ['--sizes-mib', 'NaN'], ['--sizes-mib', '0.0000001'],
    ['--checksums', 'sha256,auto'], ['--repeat', '0'], ['--repeat', '1.5'], ['--repeat'], ['--input', 'private.json']]) {
    assert.throws(() => benchmark.options(args));
  }
  const invalid = invoke(['--sizes-mib', '129']);
  assert.notEqual(invalid.status, 0); assert.equal(invalid.stdout, ''); assert.match(invalid.stderr, /Benchmark failed/);

  const result = invoke(['--sizes-mib', '0.0625', '--checksums', 'sha256,fnv1a64', '--repeat', '2']);
  assert.equal(result.status, 0, result.stderr);
  const records = result.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(records.length, 4);
  assert.equal(new Set(records.map(r => r.pid)).size, 4);
  for (const record of records) {
    assert.notEqual(record.pid, process.pid);
    assert.equal(record.storage, 'memory-fallback'); assert.equal(record.forcedGc, false);
    assert.equal(record.node, process.version); assert.equal(record.binaryBytes, 65536);
    assert.equal(record.fixtureSha256, '58f414c587d599b6fa1678097a7459ce669c6e0fe894d81be9c7ed2879bd6bcb');
    assert.match(record.sourceSha256, /^[a-f0-9]{64}$/);
    assert.match(record.harnessSha256, /^[a-f0-9]{64}$/);
    assert.ok(record.backupUtf8Bytes > record.binaryBytes);
    assert.deepEqual(record.counts, { docs: 1, books: 0, cards: 1 });
    assert.ok(Object.values(record.verified).every(v => v === true));
    assert.ok(Object.values(record.rssBytes).every(v => Number.isSafeInteger(v) && v > 0));
    assert.ok(Object.values(record.milliseconds).every(v => Number.isFinite(v) && v >= 0));
  }
  assert.equal(new Set(records.map(r => r.sourceSha256)).size, 1);
  assert.equal(new Set(records.map(r => r.checksum)).size, 2);
  assert.deepEqual(records.map(r => r.run), [1, 2, 1, 2]);

  const sources = benchmark.loadSources();
  const faults = [
    { body: "const f = await window.MemStore.get('files', 'benchmark'); new Uint8Array(f.bytes)[f.bytes.byteLength - 1] ^= 1; await window.MemStore.put('files', f);", error: /Restored bytes differ/ },
    { body: "await window.MemStore.batch([{store: 'sessions', clear: true}]);", error: /Restored progress differs/ },
    { body: "await window.MemStore.batch([{store: 'cards', clear: true}]);", error: /Restored card due date differs/ },
    { body: "await window.MemStore.put('meta', {id: 'notes', recs: {}});", error: /Restored note differs/ }
  ];
  for (const fault of faults) {
    const altered = sources.map(source => source.name !== 'backup' ? source : { ...source, text: source.text + `
      const restore = window.MemBackup.restore;
      window.MemBackup.restore = text => restore(text).then(async result => { ${fault.body} return result; });` });
    await assert.rejects(benchmark.runCase({ bytes: 8192, checksum: 'sha256' }, altered), fault.error);
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'memorizer-benchmark-'));
  try {
    const stopWorker = path.join(directory, 'stop-worker.js');
    fs.writeFileSync(stopWorker, "if (process.execArgv.includes('-e')) { console.error('synthetic worker failure'); process.exit(9); }");
    const failed = invoke(['--sizes-mib', '0.0625', '--checksums', 'sha256'],
      { ...process.env, NODE_OPTIONS: '--require ' + JSON.stringify(stopWorker) });
    assert.notEqual(failed.status, 0); assert.equal(failed.stdout, ''); assert.match(failed.stderr, /synthetic worker failure/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  console.log('PASS backup benchmark isolates cases, identifies synthetic fixtures, and rejects damaged bytes/study records or failed workers');
})();
if (require.main === module) module.exports.catch(error => { console.error(error); process.exitCode = 1; });
