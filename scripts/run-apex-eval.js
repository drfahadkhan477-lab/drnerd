#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const {launch} = require('../tests/_engine');
const {isSyntheticBuild} = require('./synthetic-export');
const {askFixture} = require('./apex-eval-case');
const fixtures = require('../tests/fixtures/apex-grounding/cases.json');

const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/';
const usage = 'node scripts/run-apex-eval.js <synthetic-build.html> <case-id> <model-id> <max-requests:1-6> <new-review.json>';

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
        const response = await send(model, exchange.request);
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
    await askFixture(page, build, fixture, Number(limit) * 65000 + 30000);
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
  await runCase(args, async (model, body) => {
    // Only this Node request carries the real key. The browser gets the response as one stream event.
    const response = await fetch(endpoint + model + ':generateContent', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: {'x-goog-api-key': key, 'content-type': 'application/json'},
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error('Gemini returned HTTP ' + response.status);
    return response.json();
  }, 'live');
}

if (require.main === module) main(process.argv.slice(2)).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
module.exports = {runCase};
