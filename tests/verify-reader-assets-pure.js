#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createClient, manifest } = require('./_reader-assets.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-assets-'));
const body = Buffer.from('Synthetic public reader bytes.');
const asset = { url: 'https://cdn.jsdelivr.net/npm/synthetic-reader@1.0.0/index.js',
  sri: 'sha384-' + crypto.createHash('sha384').update(body).digest('base64') };
let passed = 0, failed = 0;
async function check(name, run) {
  try { await run(); passed++; console.log('  PASS  ' + name); }
  catch (error) { failed++; console.error('  FAIL  ' + name + ': ' + error.message); }
}
const options = name => ({ assets: [asset], cacheDir: path.join(tmp, name), offline: false });
(async () => {
  try {
    await check('pins come from current app readers, with no duplicate URLs', async () => {
      const pins = manifest();
      assert.ok(pins.length >= 7);
      assert.equal(new Set(pins.map(a => a.url)).size, pins.length);
      createClient({ assets: pins });
      assert.ok(pins.some(a => a.url.includes('pdf.worker')) && pins.some(a => a.url.includes('traineddata')));
    });
    await check('concurrent reads share one verified download and persist exact bytes', async () => {
      let calls = 0;
      const client = createClient({ ...options('shared'), download: async () => { calls++; return { body }; } });
      const got = await Promise.all([client.get(asset.url), client.get(asset.url)]);
      assert.equal(calls, 1);
      assert.deepEqual(got[0].body, body); assert.deepEqual(got[1].body, body);
      assert.deepEqual(fs.readFileSync(client.fileOf(asset)), body);
    });
    await check('a fresh offline client uses verified cache bytes without a network call', async () => {
      const client = createClient({ ...options('shared'), offline: true, download: () => { throw new Error('network used'); } });
      assert.deepEqual((await client.get(asset.url)).body, body);
      assert.equal(await client.prepare(), 1);
    });
    await check('a corrupt cache fails closed even when a download is available', async () => {
      let calls = 0;
      const client = createClient({ ...options('corrupt'), download: async () => { calls++; return { body }; } });
      fs.mkdirSync(options('corrupt').cacheDir); fs.writeFileSync(client.fileOf(asset), 'corrupted');
      await assert.rejects(client.get(asset.url), /integrity mismatch/);
      assert.equal(calls, 0); assert.equal(fs.readFileSync(client.fileOf(asset), 'utf8'), 'corrupted');
    });
    await check('unlisted URLs cannot reach the downloader', async () => {
      let calls = 0;
      const client = createClient({ ...options('unlisted'), download: async () => { calls++; return { body }; } });
      await assert.rejects(client.get('https://example.com/unlisted.js'), /Unpinned/);
      assert.equal(calls, 0);
    });
    await check('a mismatched download never becomes a cached asset', async () => {
      const client = createClient({ ...options('mismatch'), attempts: 1, download: async () => ({ body: Buffer.from('wrong') }) });
      await assert.rejects(client.get(asset.url), /integrity mismatch/);
      assert.equal(fs.existsSync(client.fileOf(asset)), false);
    });
    await check('an unanswered download is bounded and aborted on every attempt', async () => {
      const signals = [];
      const client = createClient({ ...options('hung'), timeoutMs: 20, attempts: 2,
        download: async (_, { signal }) => { signals.push(signal); return new Promise(() => {}); } });
      const start = Date.now();
      await assert.rejects(client.get(asset.url), /timed out/);
      assert.ok(Date.now() - start < 2000);
      assert.equal(signals.length, 2); assert.ok(signals.every(s => s.aborted));
      assert.equal(fs.existsSync(client.fileOf(asset)), false);
    });
    await check('a failed request can retry successfully instead of caching rejection', async () => {
      let calls = 0;
      const client = createClient({ ...options('retry'), attempts: 1, download: async () => {
        if (++calls === 1) throw new Error('synthetic refusal'); return { body };
      } });
      await assert.rejects(client.get(asset.url), /preparation failed/);
      assert.deepEqual((await client.get(asset.url)).body, body); assert.equal(calls, 2);
    });
    await check('a changed integrity pin cannot reuse an older cached file', async () => {
      const newer = { ...asset, sri: 'sha384-' + crypto.createHash('sha384').update('different').digest('base64') };
      const client = createClient({ ...options('shared'), assets: [newer], offline: true });
      await assert.rejects(client.get(asset.url), /cache missing/);
    });
    await check('a late response after timeout cannot populate the cache', async () => {
      const client = createClient({ ...options('late'), timeoutMs: 10, attempts: 1,
        download: () => new Promise(resolve => setTimeout(() => resolve({ body }), 70)) });
      await assert.rejects(client.get(asset.url), /timed out/);
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(fs.existsSync(client.fileOf(asset)), false);
    });
    await check('download diagnostics keep safe HTTP status and omit proxy credentials', async () => {
      const client = createClient({ ...options('secret'), attempts: 1, download: async () => {
        throw new Error('failed https://user:synthetic-proxy-password@proxy.invalid/');
      } });
      await assert.rejects(client.get(asset.url), error => error.message.includes(asset.url) && !error.message.includes('synthetic-proxy-password'));
      const status = createClient({ ...options('status'), attempts: 1, download: async () => { throw new Error('Reader download returned HTTP 503'); } });
      await assert.rejects(status.get(asset.url), /HTTP 503/);
    });
    await check('download ceilings must be finite and positive', async () => {
      for (const timeoutMs of [0, -1, Infinity, NaN])
        assert.throws(() => createClient({ ...options('invalid'), timeoutMs }), /positive timeout/);
      assert.throws(() => createClient({ ...options('invalid'), attempts: 0 }), /attempt count/);
    });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
