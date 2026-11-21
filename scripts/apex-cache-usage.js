#!/usr/bin/env node
'use strict';

// Read the raw per-case reviews written by run-apex-eval.js. A tool follow-up
// or retry is a separate exchange and can have different usage metadata.
const fs = require('node:fs');

const usage = 'node scripts/apex-cache-usage.js <live-review.json> [more-live-reviews.json ...]';

function tokenCount(metadata, field) {
  const value = metadata?.[field];
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid Gemini ' + field);
  return value;
}

function addTokens(total, count, field) {
  const next = (total ?? 0) + count;
  if (!Number.isSafeInteger(next)) throw new Error('Gemini ' + field + ' total exceeds the safe integer range');
  return next;
}

function summarize(files) {
  const seen = new Set();
  const counts = {
    exchanges: 0, providerErrors: 0, promptCountsReported: 0, cacheCountsReported: 0,
    reportedPromptTokens: null, reportedCachedTokens: null, totalCachedTokens: null
  };
  for (const file of files) {
    const path = fs.realpathSync(file);
    if (seen.has(path)) throw new Error('Review supplied twice: ' + file);
    seen.add(path);
    const raw = fs.readFileSync(path, 'utf8');
    let review;
    try { review = JSON.parse(raw); }
    catch { throw new Error('Invalid JSON in ' + file); }
    if (review?.answerSource !== 'live' || !Array.isArray(review.exchanges)) {
      throw new Error('Expected a raw live review with exchanges in ' + file);
    }
    for (const exchange of review.exchanges) {
      if (!exchange || typeof exchange !== 'object') throw new Error('Invalid exchange in ' + file);
      counts.exchanges++;
      if (exchange.error) {
        counts.providerErrors++;
        continue;
      }
      if (!exchange.response || typeof exchange.response !== 'object' || Array.isArray(exchange.response)) {
        throw new Error('Missing Gemini response in ' + file);
      }
      const metadata = exchange.response.usageMetadata;
      const prompt = tokenCount(metadata, 'promptTokenCount');
      const cached = tokenCount(metadata, 'cachedContentTokenCount');
      if (prompt !== null && cached !== null && cached > prompt) {
        throw new Error('Cached tokens exceed prompt tokens in ' + file);
      }
      if (prompt !== null) {
        counts.promptCountsReported++;
        counts.reportedPromptTokens = addTokens(counts.reportedPromptTokens, prompt, 'promptTokenCount');
      }
      if (cached !== null) {
        counts.cacheCountsReported++;
        counts.reportedCachedTokens = addTokens(counts.reportedCachedTokens, cached, 'cachedContentTokenCount');
      }
    }
  }
  if (counts.cacheCountsReported === counts.exchanges) counts.totalCachedTokens = counts.reportedCachedTokens;
  return counts;
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log(usage + '\nSummarize Gemini usage offline. Reported token sums cover explicit counts only.\n' +
    'totalCachedTokens requires a cache count for every exchange. Missing counts are null.');
} else {
  try {
    if (!args.length) throw new Error(usage);
    console.log(JSON.stringify(summarize(args), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
