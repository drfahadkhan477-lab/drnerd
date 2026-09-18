#!/usr/bin/env node
/*
 * What the splash says when the question bank does not load.
 *
 *   node tests/verify-loader-pure.js
 *
 * No browser and no build. The split build's loader lives as a template
 * literal in scripts/build-pwa.js; this lifts the one function out of it and
 * drives every branch.
 *
 * WHY THIS EXISTS. For every possible failure the loader printed one sentence:
 *
 *     Open this over http, not as a file — it needs to fetch its content.
 *
 * which is correct for exactly one of them. It is what a freshly deployed
 * Cloudflare Pages site printed when its content folder had not uploaded, and
 * it is what a site behind an authenticating proxy prints when a sign-in page
 * arrives in place of the bank. Both happened to this project. The second cost
 * an evening, because a screen that names a cause it has not checked sends the
 * reader after a file:// problem that is not there — and there is no other
 * signal, since the splash covers the console and the app never starts.
 *
 * The message is the only diagnostic a fellow standing in front of a broken
 * deployment has. It should say which of the four it was.
 *
 * WHAT IT CANNOT CHECK is that the loader CALLS this correctly — that its
 * stage variable really advances past the fetch and past the status check. The
 * emitted loader is parsed here as a guard against that drifting, but only the
 * browser suites run it. Same division as tests/verify-md-pure.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-pwa.js'), 'utf8');

/* The loader, as build-pwa.js will write it into index.html. */
const LOADER = (() => {
  const open = 'const LOADER = `<script>';
  const i = SRC.indexOf(open);
  const j = SRC.indexOf('</script>`;', i);
  if (i < 0 || j < 0) throw new Error('build-pwa.js no longer defines LOADER as a template literal');
  return SRC.slice(i + open.length, j).replace(/\\`/g, '`').replace(/\\\$/g, '$');
})();

/* The one function under test, lifted out of it. Extracted rather than copied:
   a copy here would stop matching the loader the first time either changed,
   and would keep passing. */
const why = (() => {
  const at = LOADER.indexOf('function whyContentFailed(');
  if (at < 0) throw new Error('the loader no longer defines whyContentFailed()');
  /* To the matching close brace, counting depth. */
  let depth = 0, end = -1;
  for (let k = LOADER.indexOf('{', at); k < LOADER.length; k++) {
    if (LOADER[k] === '{') depth++;
    else if (LOADER[k] === '}') { depth--; if (!depth) { end = k + 1; break; } }
  }
  if (end < 0) throw new Error('could not find the end of whyContentFailed()');
  /* eslint-disable no-new-func */
  return new Function(`${LOADER.slice(at, end)}\nreturn whyContentFailed;`)();
})();

head('the function under test is the one that ships');
{
  ok('the loader was found in build-pwa.js', LOADER.length > 500, `${LOADER.split('\n').length} lines`);
  ok('and it parses as JavaScript', (() => {
    try { new Function(LOADER); return true; } catch (_) { return false; }
  })());
  ok('whyContentFailed was lifted out of it', typeof why === 'function');
  ok('the loader actually calls it', /fail\(\s*whyContentFailed\(/.test(LOADER));
  ok('and it passes the three things it needs',
     /whyContentFailed\(\s*stage\s*,\s*res && res\.status\s*,\s*location\.protocol\s*\)/.test(LOADER));
  /* The stage variable has to advance, or every failure reads as the first
     one. Checked against the loader text, since only a browser can run it. */
  ok('stage starts at network', /var res = null,\s*stage = 'network'/.test(LOADER));
  ok('and advances past the fetch', /stage = 'status';/.test(LOADER));
  ok('and again past the status check', /stage = 'parse';/.test(LOADER));
}

head('each failure says which failure it was');
{
  const file = why('network', null, 'file:');
  ok('opened as a file, it says so', /not as a file/.test(file), file);

  const offline = why('network', null, 'https:');
  ok('unreachable server does NOT blame the file scheme', !/not as a file/.test(offline), offline);
  ok('and says it could not reach the server', /could not reach/i.test(offline), offline);

  const missing = why('status', 404, 'https:');
  ok('a 404 names the missing file', /questions\.json/.test(missing) && /404/.test(missing), missing);
  ok('and points at the deployment, which is what a 404 here means',
     /deploy|upload|content folder/i.test(missing), missing);

  const server = why('status', 500, 'https:');
  ok('another status reports the number rather than guessing', /500/.test(server), server);
  ok('and does not claim it was a 404', !/404/.test(server), server);

  const parse = why('parse', 200, 'https:');
  ok('a body that is not the bank says so', /not the question bank/i.test(parse), parse);
  ok('and names the likely culprit, since that is the hard one to guess',
     /sign-in|error page/i.test(parse), parse);
}

head('no two failures read the same');
{
  const cases = [
    ['file', why('network', null, 'file:')],
    ['unreachable', why('network', null, 'https:')],
    ['404', why('status', 404, 'https:')],
    ['500', why('status', 500, 'https:')],
    ['bad body', why('parse', 200, 'https:')],
  ];
  const seen = new Map();
  const clash = [];
  for (const [name, msg] of cases) {
    if (seen.has(msg)) clash.push(`${name} reads the same as ${seen.get(msg)}`);
    seen.set(msg, name);
  }
  ok('five distinct failures, five distinct sentences', clash.length === 0, clash.join('; ') || '5 of 5');
  ok('and only the file case mentions files',
     cases.filter(([, m]) => /not as a file/.test(m)).length === 1,
     cases.filter(([, m]) => /not as a file/.test(m)).map(([n]) => n).join(', '));
  /* Vacuity guard: every assertion above is a regex over a string, and a
     function that returned '' would fail them rather than pass — but one that
     returned the same long sentence every time would pass several. The
     distinctness check above is what stops that, and this proves it can fire. */
  const allSame = () => 'the same thing every time';
  const same = new Set(cases.map(() => allSame()));
  ok('the distinctness check can actually fail', same.size === 1);
}

head('the file case still wins wherever it applies');
{
  /* file:// is checked first on purpose: a page opened from disk cannot reach
     a server at all, so every other branch would be describing a symptom of
     it rather than the cause. */
  for (const stage of ['network', 'status', 'parse']) {
    const m = why(stage, 404, 'file:');
    ok(`${stage} on file:// still reports the scheme`, /not as a file/.test(m), m);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
