#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const {launch} = require('../tests/_engine');
const {isSyntheticBuild} = require('./synthetic-export');
const {askFixture} = require('./apex-eval-case');
const fixtures = require('../tests/fixtures/apex-grounding/cases.json');

const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/';
const usage = 'node scripts/run-apex-eval.js <synthetic-build.html> <case-id> <model-id> <max-requests:1-6> <new-review.json>';
const requestTimeoutMs = 60000;

class GeminiRequestError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

async function sendGemini(model, body, key, request = fetch) {
  const signal = AbortSignal.timeout(requestTimeoutMs);
  let response;
  try {
    response = await request(endpoint + model + ':generateContent', {
      method: 'POST', redirect: 'error', signal,
      headers: {'x-goog-api-key': key, 'content-type': 'application/json'},
      body: JSON.stringify(body)
    });
    if (response.ok) return await response.json();
  } catch {
    if (signal.aborted) {
      throw new GeminiRequestError('Gemini request timed out.', {kind: 'timeout', timeoutMs: requestTimeoutMs});
    }
    if (response) {
      throw new GeminiRequestError('Could not read the Gemini response.', {kind: 'response', status: response.status});
    }
    throw new GeminiRequestError('Could not connect to Gemini.', {kind: 'network'});
  }

  const details = {kind: 'http', status: response.status};
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter && /^\d{1,9}$/.test(retryAfter)) details.retryAfterSeconds = Number(retryAfter);
  // Keep error text returned by the provider or proxy out of saved reviews.
  await response.body?.cancel().catch(() => {});
  throw new GeminiRequestError('Gemini returned HTTP ' + response.status, details);
}

async function runCase(args, send, answerSource) {
  const [build, caseId, model, limit, output] = args;
  const fixture = fixtures.cases.find(item => item.id === caseId);
  if (args.length !== 5 || !fixture || !/^[a-zA-Z0-9._-]+$/.test(model) || !/^[1-6]$/.test(limit)) {
    throw new Error(usage);
  }
  if (!isSyntheticBuild(build)) throw new Error('A marked synthetic build is required.');
  const entry = {id: caseId, question: fixture.question, answer: null,
    criteria: fixture.rubric.map(criterion => ({criterion, verdict: 'unmeasured', reason: null}))};
  const review = {fixtureVersion: fixtures.version, answerSource, model, date: new Date().toISOString().slice(0, 10),
    cases: [entry], exchanges: [], status: 'unfinished'};
  const fd = fs.openSync(output, 'wx', 0o600);
  let browser;
  let failure;
  let accepting = false;
  try {
    browser = await launch();
    const context = await browser.newContext({serviceWorkers: 'block'});
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.protocol === 'file:') return route.continue();
      if (!accepting || request.method() !== 'POST' ||
        url.href !== endpoint + 'evaluation-model:streamGenerateContent?alt=sse') return route.abort();
      try {
        if (failure) throw failure;
        if (review.exchanges.length >= Number(limit)) throw new Error('Request limit reached.');
        const exchange = {request: request.postDataJSON()};
        review.exchanges.push(exchange);
        const started = performance.now();
        let response;
        try {
          response = await send(model, exchange.request);
        } catch (error) {
          exchange.error = error instanceof GeminiRequestError ? error.details : {kind: 'request'};
          exchange.error.elapsedMs = Math.round(performance.now() - started);
          throw error;
        }
        exchange.response = response;
        await route.fulfill({status: 200, contentType: 'text/event-stream',
          body: 'data: ' + JSON.stringify(response) + '\n\n'});
      } catch (error) {
        failure = error;
        await route.fulfill({status: 400, body: 'Evaluation request stopped.'});
      }
    });
    const page = await context.newPage();
    accepting = true;
    await askFixture(page, build, fixture, Number(limit) * (requestTimeoutMs + 5000) + 30000);
    accepting = false;
    if (failure) throw failure;
    const response = review.exchanges.at(-1)?.response;
    const candidate = response?.candidates?.[0];
    const last = await page.evaluate(() => CHATS._general?.at(-1));
    if (!['STOP', 'MAX_TOKENS'].includes(candidate?.finishReason) ||
      candidate.content?.parts?.some(part => part.functionCall) ||
      !candidate.content?.parts?.some(part => part.text?.trim()) ||
      last?.role !== 'assistant' || last.err || !last.content?.trim()) {
      throw new Error('Provider returned no final answer. See the exchanges in the review.');
    }
    entry.answer = last.content;
    entry.finishReason = candidate.finishReason;
    review.status = 'answered';
  } catch (error) {
    review.status = 'failed';
    throw error;
  } finally {
    accepting = false;
    try {
      await browser?.close();
    } finally {
      try { fs.writeFileSync(fd, JSON.stringify(review, null, 2) + '\n'); }
      finally { fs.closeSync(fd); }
    }
  }
}

async function main(args) {
  if (args[0] === '--help') return console.log(usage);
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Set GEMINI_API_KEY for an approved run.');
  await runCase(args, (model, body) => sendGemini(model, body, key), 'live');
}

if (require.main === module) main(process.argv.slice(2)).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
module.exports = {runCase, sendGemini};
