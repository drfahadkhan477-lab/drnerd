#!/usr/bin/env node
/*
 * A code deploy does not evict the content.
 *
 *   node tests/verify-cachebuckets.js [dist]     # defaults to ./dist
 *
 * WHAT THIS IS ABOUT. The service worker keys two caches: the shell by a digest
 * of the shell code, the content by a digest of the content. activate() deletes
 * every cache that is not one of the two current ones. That arrangement is only
 * correct if each file is in the bucket that matches what actually invalidates
 * it — and refs-images.json (14.4 MB) and refs-seed.json (0.7 MB) were in
 * neither, because only /content/figures/ was routed to the content bucket and
 * everything else same-origin fell through to the shell. A CSS tweak therefore
 * evicted 15.1 MB that had not changed.
 *
 * WHY THIS READS sw.js RATHER THAN DRIVING A BROWSER. The failure is not
 * something a page can be made to show: it needs two deploys with different
 * shell digests and the same content digest, an install between them, and an
 * eviction pass. Reconstructing that in Playwright would be a test of the
 * reconstruction. What is actually being asserted is a routing rule and a
 * whitelist, both of which are decidable from the worker's own source — so the
 * source is what is read, and the sizes are measured from the files on disk so
 * the number in the failure message is the real cost, not a remembered one.
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* scripts/verify.js hands every suite the single-file build's path, which this
   one has no use for — its subject is the split build's worker. A directory is
   taken as the dist to read; anything else (that path, or nothing) falls back
   to the one build-pwa.js writes. */
const arg = process.argv[2];
const DIST = (arg && fs.existsSync(arg) && fs.statSync(arg).isDirectory())
  ? arg : path.join(__dirname, '..', 'dist');
const SW = path.join(DIST, 'sw.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

if (!fs.existsSync(SW)) {
  console.error(`no service worker at ${SW} — run scripts/build-pwa.js first`);
  process.exit(1);
}
const sw = fs.readFileSync(SW, 'utf8');

head('the two buckets, and what keys them');
const shellDecl = /const SHELL\s*=\s*'accsap-shell-'\s*\+\s*SHELL_V/.test(sw);
const contentDecl = /const CONTENT\s*=\s*'accsap-content-'\s*\+\s*CONTENT_V/.test(sw);
ok('the shell cache is keyed by the shell digest', shellDecl);
ok('the content cache is keyed by the content digest', contentDecl);
/* The bug in one line: a bucket named for figures could only ever hold
   figures, so everything else under /content/ had nowhere to go but the shell. */
ok('nothing is still keyed as a figures-only bucket',
   !/const FIGS\s*=/.test(sw) && !/caches\.open\(FIGS\)/.test(sw));

head('what the fetch handler routes where');
ok('every /content/ URL goes to the content cache',
   /url\.pathname\.includes\('\/content\/'\)/.test(sw)
   && /caches\.open\(CONTENT\)/.test(sw));
ok('and the routing is not narrowed back to figures alone',
   !/url\.pathname\.includes\('\/content\/figures\/'\)\s*\)\s*\{[\s\S]{0,80}caches\.open\(/.test(sw));

head('what survives an eviction pass');
const act = /ks\.filter\(k => k !== SHELL && k !== CONTENT\)/.test(sw);
ok('activate keeps the current shell AND the current content', act,
   act ? '' : 'the whitelist does not name CONTENT');

head('install puts each precached file in the bucket that matches it');
ok('install opens both caches', /caches\.open\(SHELL\)/.test(sw) && /caches\.open\(CONTENT\)/.test(sw));
/* questions.json is precached because the app cannot start without it, and
   content-versioned because that is what it is. Landing it in the shell would
   mean a 1.7 MB re-download after every unrelated code change. */
ok('and routes a precached content file to the content cache',
   /isContent\(u\)\s*\?\s*cc\s*:\s*c/.test(sw) && /const isContent\s*=/.test(sw));

head('what it is actually worth, measured');
const sizes = {};
for (const f of ['refs-images.json', 'refs-seed.json', 'questions.json']) {
  const p = path.join(DIST, 'content', f);
  sizes[f] = fs.existsSync(p) ? fs.statSync(p).size : 0;
}
const atRisk = sizes['refs-images.json'] + sizes['refs-seed.json'];
ok('the two runtime-fetched content files are on disk to be protected',
   atRisk > 1e6, `${(atRisk / 1048576).toFixed(1)} MB across refs-images.json + refs-seed.json`);
ok('and they are not named in PRECACHE, so they are fetched at runtime',
   !/PRECACHE[^\]]*refs-images\.json/.test(sw),
   'they reach the cache through the fetch handler, which is why its routing decides their bucket');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
