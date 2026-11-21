'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-cache-'));
const script = path.resolve(__dirname, '../scripts/apex-cache-usage.js');
const run = (...files) => spawnSync(process.execPath, [script, ...files], {encoding: 'utf8'});
const response = usageMetadata => ({response: {usageMetadata}});
function write(name, exchanges, answerSource = 'live') {
  const file = path.join(directory, name);
  fs.writeFileSync(file, JSON.stringify({answerSource, exchanges}));
  return file;
}
function read(...files) {
  const result = run(...files);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

try {
  const measured = write('measured', [
    response({promptTokenCount: 100, cachedContentTokenCount: 24}),
    response({promptTokenCount: 16, cachedContentTokenCount: 0})
  ]);
  const missing = write('missing', [response({promptTokenCount: 15}), {error: {status: 503}}]);
  assert.equal(read(measured).totalCachedTokens, 24);
  assert.equal(read(missing).reportedCachedTokens, null, 'absent cache counts must stay unmeasured');
  assert.deepEqual(read(measured, missing), {
    exchanges: 4, providerErrors: 1, promptCountsReported: 3, cacheCountsReported: 2,
    reportedPromptTokens: 131, reportedCachedTokens: 24, totalCachedTokens: null
  });
  const zero = write('zero', [response({cachedContentTokenCount: 0})]);
  assert.equal(read(zero).totalCachedTokens, 0);
  assert.equal(read(zero).reportedPromptTokens, null);
  assert.equal(read(write('empty', [])).totalCachedTokens, null);
  assert.match(run(measured, measured).stderr, /supplied twice/);
  assert.match(run(write('mock', [], 'synthetic')).stderr, /raw live review/);
  for (const invalid of [-1, 2.5, '5']) {
    assert.match(run(write('invalid', [response({cachedContentTokenCount: invalid})])).stderr, /Invalid Gemini/);
  }
  assert.match(run(write('impossible', [response({promptTokenCount: 1, cachedContentTokenCount: 2})])).stderr,
    /exceed prompt tokens/);
  for (const field of ['promptTokenCount', 'cachedContentTokenCount']) {
    const large = write('large-' + field, [
      response({[field]: Number.MAX_SAFE_INTEGER}),
      response({[field]: 2})
    ]);
    const result = run(large);
    assert.equal(result.status, 1, 'a total outside the safe integer range must fail for ' + field);
    assert.match(result.stderr, /total exceeds the safe integer range/);
  }
  console.log('PASS Gemini cache coverage, missing and zero counts, retries, and invalid inputs');
} catch (error) {
  console.error('FAIL  ' + error.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(directory, {recursive: true, force: true});
}
