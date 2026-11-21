#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const {isDeepStrictEqual} = require('node:util');
const fixtures = require('../tests/fixtures/apex-grounding/cases.json');

function requireValid(condition, message) {
  if (!condition) throw new Error(message);
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function reviewTemplate(capture) {
  requireValid(capture?.version === 1 && capture.mode === 'offline-request-capture' &&
    capture.liveModelCalled === false && Array.isArray(capture.cases),
    'Expected a report from prepare-apex-eval.js.');
  const entries = new Map(capture.cases.map(entry => [entry.id, entry]));
  requireValid(capture.cases.length === fixtures.cases.length && entries.size === fixtures.cases.length,
    'Capture must contain each fixture exactly once.');
  const cases = fixtures.cases.map(({id, question, notes, rubric}) => {
    const entry = entries.get(id);
    requireValid(entry?.question === question && isDeepStrictEqual(entry.notes, notes) &&
      isDeepStrictEqual(entry.rubric, rubric), `${id}: capture differs from the current fixture.`);
    return {id, question, answer: null, criteria: rubric.map(criterion =>
      ({criterion, verdict: 'unmeasured', reason: null}))};
  });
  return {fixtureVersion: fixtures.version, answerSource: null, model: null, date: null, cases};
}

function scoreReview(review) {
  requireValid(review && review.fixtureVersion === fixtures.version && Array.isArray(review.cases),
    'Expected the current fixtureVersion and a cases array.');
  requireValid(['synthetic', 'live'].includes(review.answerSource) &&
    hasText(review.model) && validDate(review.date),
    'Provide answerSource (synthetic or live), model, and a valid YYYY-MM-DD date.');

  const fixtureById = new Map(fixtures.cases.map(fixture => [fixture.id, fixture]));
  const saved = new Map();
  for (const entry of review.cases) {
    requireValid(fixtureById.has(entry?.id), 'Unknown case ID in review.');
    requireValid(entry.question === undefined || entry.question === fixtureById.get(entry.id).question,
      `${entry.id}: saved question differs from the current fixture.`);
    requireValid(!saved.has(entry.id), `Duplicate case: ${entry.id}`);
    requireValid((entry.answer === null || hasText(entry.answer)) && Array.isArray(entry.criteria),
      `${entry.id}: provide an answer or null, and a criteria array.`);
    saved.set(entry.id, entry);
  }

  const cases = fixtures.cases.map(({id, question, rubric}) => {
    const entry = saved.get(id);
    const decisions = new Map();
    for (const decision of entry?.criteria ?? []) {
      const criterion = decision?.criterion;
      requireValid(rubric.includes(criterion), `${id}: criterion must match the fixture rubric verbatim.`);
      requireValid(!decisions.has(criterion), `${id}: duplicate criterion.`);
      if (decision.verdict === 'unmeasured') {
        requireValid(decision.reason === null, `${id}: finish the verdict or clear its reason.`);
      } else {
        requireValid(hasText(entry.answer), `${id}: a reviewed criterion needs an answer.`);
        requireValid(['supported', 'unsupported'].includes(decision.verdict) && hasText(decision.reason),
          `${id}: each reviewed criterion needs a supported or unsupported verdict and a reason.`);
      }
      decisions.set(criterion, {criterion, verdict: decision.verdict, reason: decision.reason});
    }
    const criteria = rubric.map(criterion => decisions.get(criterion) ??
      {criterion, verdict: 'unmeasured', reason: null});
    let verdict = 'unmeasured';
    if (criteria.some(decision => decision.verdict === 'unsupported')) verdict = 'fail';
    else if (criteria.every(decision => decision.verdict === 'supported')) verdict = 'pass';
    return {id, question, answer: entry?.answer ?? null, criteria, verdict};
  });

  const totals = {pass: 0, fail: 0, unmeasured: 0};
  for (const {verdict} of cases) totals[verdict]++;
  return {
    fixtureVersion: fixtures.version,
    answerSource: review.answerSource,
    model: review.model,
    date: review.date,
    totals,
    cases
  };
}

function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/score-apex-eval.js [--template] <input.json> <new-output.json>');
    return;
  }
  const template = args[0] === '--template';
  const paths = template ? args.slice(1) : args;
  requireValid(paths.length === 2, 'Provide input and new output paths. See --help.');
  const [input, output] = paths;
  const data = JSON.parse(fs.readFileSync(input, 'utf8'));
  const result = template ? reviewTemplate(data) : scoreReview(data);
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
  if (template) return;
  const {pass, fail, unmeasured} = result.totals;
  console.log(`Apex cases: ${pass} passed, ${fail} failed, ${unmeasured} unmeasured.`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
