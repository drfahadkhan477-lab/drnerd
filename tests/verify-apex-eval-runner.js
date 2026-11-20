'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {runCase, sendGemini} = require('../scripts/run-apex-eval');

async function main(build) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-runner-'));
  try {
    const answer = 'Lumen memo A and Lumen memo B disagree about the blue path.';
    const output = path.join(dir, 'review.json');
    const args = [build, 'conflicting-notes', 'mock-model', '2', output];
    let calls = 0;
    const send = async (model, body) => {
      assert.equal(model, 'mock-model');
      calls++;
      if (calls === 2) {
        const results = body.contents.flatMap(turn => turn.parts).filter(part => part.functionResponse);
        assert.match(JSON.stringify(results), /Lumen memo/);
      }
      const parts = calls === 1 ? [{functionCall: {name: 'search_question_bank', args: {query: 'Lumen'}}}] : [{text: answer}];
      return {modelVersion: model, candidates: [{content: {role: 'model', parts}, finishReason: 'STOP'}]};
    };
    await runCase(args, send, 'synthetic');
    const read = () => JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(calls, 2);
    assert.equal(read().cases[0].answer, answer);
    assert.equal(read().exchanges.length, 2);
    assert.equal(read().cases[0].criteria.every(row => row.verdict === 'unmeasured'), true);
    await assert.rejects(runCase(args, send, 'synthetic'), /EEXIST/);
    assert.equal(calls, 2);
    fs.unlinkSync(output);
    args[3] = '1';
    calls = 0;
    await assert.rejects(runCase(args, send, 'synthetic'), /Request limit reached/);
    assert.equal(calls, 1);
    assert.equal(read().cases[0].answer, null);
    assert.equal(read().exchanges.length, 1);

    fs.unlinkSync(output);
    const mockFetch = async () => new Response('Mock provider error containing a credential', {
      status: 503, headers: {'retry-after': '30'}
    });
    const unavailable = (model, body) => sendGemini(model, body, 'mock-key', mockFetch);
    await assert.rejects(runCase(args, unavailable, 'synthetic'), /Gemini returned HTTP 503/);
    const report = read();
    const {elapsedMs, ...details} = report.exchanges[0].error;
    assert.ok(Number.isInteger(elapsedMs) && elapsedMs >= 0);
    assert.deepEqual(details, {kind: 'http', status: 503, retryAfterSeconds: 30});
    assert.equal(report.exchanges.length, 1);
    assert.equal(report.cases[0].answer, null);
    assert.doesNotMatch(JSON.stringify(report), /mock-key|Mock provider error/);
    fs.unlinkSync(output);
    args[3] = '2';
    let attempts = 0;
    const transient = async () => {
      attempts++;
      if (attempts === 1) return new Response(null, {status: 503, headers: {'retry-after': '0'}});
      return Response.json({candidates: [{content: {parts: [{text: answer}]}, finishReason: 'STOP'}]});
    };
    const recover = (model, body) => sendGemini(model, body, 'mock-key', transient);
    await runCase(args, recover, 'synthetic');
    assert.equal(attempts, 2);
    assert.equal(read().cases[0].answer, answer);
    assert.equal(read().exchanges[0].error.status, 503);
    assert.equal(read().exchanges.length, 2);
    fs.unlinkSync(output);
    args[3] = '1';
    attempts = 0;
    await assert.rejects(runCase(args, recover, 'synthetic'), /Gemini returned HTTP 503/);
    assert.equal(attempts, 1);
    assert.equal(read().cases[0].answer, null);

    fs.unlinkSync(output);
    args[3] = '2';
    await assert.rejects(runCase(args, unavailable, 'synthetic'), /Gemini returned HTTP 503/);
    assert.equal(read().exchanges.length, 1, 'Apex respects a Retry-After beyond its retry window');
    console.log('PASS: Gemini tool exchange, 503 recovery, Retry-After, request cap and HTTP diagnostics.');
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

const build = process.argv[2];
main(build).catch(error => { console.error(error); process.exitCode = 1; });
