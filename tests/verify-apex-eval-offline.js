'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const fixtures = require('./fixtures/apex-grounding/cases.json');

const [supported, empty, unsupported] = fixtures.cases;
const review = {
  fixtureVersion: fixtures.version,
  answerSource: 'synthetic',
  model: 'hand-written-example',
  date: '2026-11-20',
  cases: [
    {
      id: supported.id,
      answer: 'Lumen selection rules: amber selects blue. Review every seven fictional cycles.',
      criteria: supported.rubric.map(criterion =>
        ({criterion, verdict: 'supported', reason: 'The answer follows and cites the selection rules.'}))
    },
    {id: empty.id, answer: 'The library has no notes on Lumen.', criteria: []},
    {
      id: unsupported.id,
      answer: 'A trial proved blue reduces mortality.',
      criteria: [{
        criterion: unsupported.rubric[2],
        verdict: 'unsupported',
        reason: 'The note only describes assignment. The answer invents a trial and benefit.'
      }]
    }
  ]
};

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-eval-'));
try {
  const input = path.join(directory, 'review.json');
  const output = path.join(directory, 'results.json');
  const cli = path.resolve(__dirname, '../scripts/score-apex-eval.js');
  const run = () => spawnSync(process.execPath, [cli, input, output], {encoding: 'utf8'});
  const captureFile = path.join(directory, 'capture.json');
  const capture = {version: 1, mode: 'offline-request-capture', liveModelCalled: false, cases: fixtures.cases};
  const template = () => spawnSync(process.execPath, [cli, '--template', captureFile, input], {encoding: 'utf8'});

  fs.writeFileSync(captureFile, JSON.stringify(capture));
  const generated = template();
  assert.equal(generated.status, 0, generated.stderr);
  const blank = JSON.parse(fs.readFileSync(input, 'utf8'));
  assert.equal(blank.model, null);
  Object.assign(blank, {answerSource: review.answerSource, model: review.model, date: review.date});
  blank.cases[0].answer = review.cases[0].answer;
  blank.cases[0].criteria[0] = review.cases[0].criteria[0];
  fs.writeFileSync(input, JSON.stringify(blank));
  assert.equal(run().status, 0);
  const partial = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.deepEqual(partial.totals, {pass: 0, fail: 0, unmeasured: fixtures.cases.length});
  assert.equal(partial.cases[0].criteria[0].verdict, 'supported');
  fs.unlinkSync(output);
  blank.cases[0].question += ' Edited.';
  fs.writeFileSync(input, JSON.stringify(blank));
  assert.match(run().stderr, /question differs/);
  blank.cases[0].question = supported.question;
  blank.cases[0].answer = null;
  fs.writeFileSync(input, JSON.stringify(blank));
  assert.match(run().stderr, /reviewed criterion needs an answer/);
  fs.unlinkSync(input);
  capture.cases = capture.cases.map(c => ({...c, question: 'Stale question'}));
  fs.writeFileSync(captureFile, JSON.stringify(capture));
  assert.match(template().stderr, /capture differs/);
  assert.equal(fs.existsSync(input), false);

  fs.writeFileSync(input, JSON.stringify(review));
  const scored = run();
  assert.equal(scored.status, 0, scored.stderr);
  const original = fs.readFileSync(output, 'utf8');
  const result = JSON.parse(original);
  assert.equal(result.answerSource, 'synthetic');
  assert.deepEqual(result.totals, {pass: 1, fail: 1, unmeasured: 3});
  assert.equal(result.cases[0].answer, review.cases[0].answer);
  assert.equal(result.cases[1].criteria[0].verdict, 'unmeasured');
  assert.equal(result.cases[2].criteria[2].verdict, 'unsupported');
  assert.equal(result.cases[3].answer, null);

  const existing = run();
  assert.equal(existing.status, 1);
  assert.match(existing.stderr, /EEXIST/);
  assert.equal(fs.readFileSync(output, 'utf8'), original);

  fs.unlinkSync(output);
  review.cases[0].criteria[0].criterion += ' Changed.';
  fs.writeFileSync(input, JSON.stringify(review));
  const stale = run();
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /must match the fixture rubric verbatim/);
  assert.equal(fs.existsSync(output), false);
  console.log('PASS: offline scoring, incomplete reviews, stale rubric rejection, and output protection.');
} finally {
  fs.rmSync(directory, {recursive: true, force: true});
}
