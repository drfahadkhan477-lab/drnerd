'use strict';
/* Real, integrity-checked reader libraries for browser tests. Downloads happen
   during preparation; a warm cache also works with dependency networking off. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { replaceWhole } = require('../scripts/atomic.js');
const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'systole-reader-assets');

function manifest() {
  const pdf = require('../memorizer/src/pdf.js');
  const ocr = require('../memorizer/src/ocr.js');
  const llm = require('../memorizer/src/llm.js');
  const ui = fs.readFileSync(path.join(ROOT, 'memorizer/src/ui.js'), 'utf8');
  const matches = [...ui.matchAll(/var MERMAID = \{ url: '([^']+)',\s*sri: '([^']+)' \};/g)];
  if (matches.length !== 1) throw new Error('Cannot read the pinned flowchart dependency.');
  return [pdf.LIB, pdf.WORKER, ...Object.values(ocr.TESS), llm.WEBLLM,
    { url: matches[0][1], sri: matches[0][2] }];
}

/* Playwright's Node HTTP client uses Node's trusted CAs and supports the
   environment proxy on Node 20 too. No browser or model is started here. */
async function download(asset, { signal, timeoutMs }) {
  const { request } = require('playwright');
  const options = {};
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (proxyUrl) {
    const proxy = new URL(proxyUrl);
    options.proxy = { server: proxy.origin };
    if (proxy.username) options.proxy.username = decodeURIComponent(proxy.username);
    if (proxy.password) options.proxy.password = decodeURIComponent(proxy.password);
  }
  const context = await request.newContext(options);
  const abort = () => { context.dispose().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw new Error('Reader download aborted.');
    const response = await context.get(asset.url, { timeout: timeoutMs });
    if (!response.ok()) throw new Error('Reader download returned HTTP ' + response.status());
    return { body: await response.body(), type: response.headers()['content-type'] || 'application/octet-stream' };
  } finally {
    signal.removeEventListener('abort', abort);
    await context.dispose();
  }
}

function createClient(opts = {}) {
  const assets = opts.assets || manifest(), pins = new Map();
  for (const asset of assets) {
    if (!/^https:\/\/cdn\.jsdelivr\.net\/npm\/[^?#]+@\d+\.\d+\.\d+\//.test(asset.url) ||
        !/^sha384-[A-Za-z0-9+/]{64}$/.test(asset.sri) || pins.has(asset.url))
      throw new Error('Invalid or duplicate reader dependency pin.');
    pins.set(asset.url, asset);
  }
  const cacheDir = opts.cacheDir || CACHE, pending = new Map();
  const fetchAsset = opts.download || download;
  const timeoutMs = opts.timeoutMs === undefined ? 20000 : opts.timeoutMs;
  const attempts = opts.attempts === undefined ? 3 : opts.attempts;
  if (!Number.isFinite(timeoutMs) || !(timeoutMs > 0) || !Number.isInteger(attempts) || attempts < 1)
    throw new Error('Reader downloads need a positive timeout and attempt count.');
  const offline = opts.offline === undefined ? process.env.SYSTOLE_TEST_READERS_OFFLINE === '1' : opts.offline;
  const fileOf = asset => path.join(cacheDir, crypto.createHash('sha256').update(asset.url + '\0' + asset.sri).digest('hex') + '.bin');
  function check(asset, body) {
    if (!Buffer.isBuffer(body) || body.length > 16 * 1024 * 1024 ||
        crypto.createHash('sha384').update(body).digest('base64') !== asset.sri.slice(7))
      throw new Error('Reader integrity mismatch: ' + asset.url);
    return body;
  }
  async function load(asset) {
    const file = fileOf(asset);
    try {
      const body = check(asset, fs.readFileSync(file));
      return { body, type: asset.url.endsWith('.js') ? 'application/javascript' : 'application/octet-stream' };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error; // a corrupt cache is a failure
      if (offline) throw new Error('Reader cache missing in offline test mode: ' + asset.url);
    }
    let last;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      let timer;
      try {
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Reader download timed out: ' + asset.url));
          }, timeoutMs);
        });
        const result = await Promise.race([Promise.resolve().then(() =>
          fetchAsset(asset, { signal: controller.signal, timeoutMs })), timeout]);
        const body = check(asset, result.body);
        fs.mkdirSync(cacheDir, { recursive: true });
        replaceWhole(file, body);
        return { body, type: result.type || (asset.url.endsWith('.js') ? 'application/javascript' : 'application/octet-stream') };
      } catch (error) { last = error; }
      finally { clearTimeout(timer); }
    }
    // Network-client errors can contain proxy credentials; report only the
    // safe pin and the failure class. Integrity/timeout reasons are ours.
    const reason = /^Reader download returned HTTP \d{3}$/.test(last.message) ? last.message :
      /^Reader (?:integrity mismatch|download timed out)/.test(last.message) ? last.message.split(':')[0] : last.name;
    throw new Error('Reader preparation failed: ' + asset.url + ' (' + reason + ')');
  }
  function get(url) {
    if (!pins.has(url)) return Promise.reject(new Error('Unpinned test reader URL.'));
    if (!pending.has(url)) {
      const job = load(pins.get(url));
      pending.set(url, job);
      job.catch(() => { if (pending.get(url) === job) pending.delete(url); });
    }
    return pending.get(url);
  }
  async function prepare() { for (const asset of assets) await get(asset.url); return assets.length; }
  return { get, prepare, fileOf };
}

module.exports = { manifest, createClient };
if (require.main === module) {
  createClient({ offline: process.argv.includes('--offline') }).prepare().then(n =>
    console.log('Prepared ' + n + ' pinned reader assets; integrity verified.'), error => {
    console.error(error.message); process.exitCode = 1;
  });
}
