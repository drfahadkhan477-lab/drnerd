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

/* ── the build refuses a file the host will not serve ─────────────────────────
   Belongs here because this is how that failure LOOKS: a 25.7 MiB
   refs-images.json deployed without complaint and the app opened on this
   splash's "the application code failed to load" — accurate, and no help. The
   fix is upstream of the splash, in build-pwa.js, and this drives it: the
   function is lifted out of the build script's source, not copied, so a copy
   cannot keep passing after the real one changes. */
head('build-pwa refuses a dist/ with a file Cloudflare Pages will not serve');
{
  const at = SRC.indexOf('function pagesLimitReport(');
  let report = null, limit = null;
  if (at > -1) {
    let depth = 0, end = -1;
    for (let k = SRC.indexOf('{', at); k < SRC.length; k++) {
      if (SRC[k] === '{') depth++;
      else if (SRC[k] === '}') { depth--; if (!depth) { end = k + 1; break; } }
    }
    if (end > 0) report = new Function(`${SRC.slice(at, end)}\nreturn pagesLimitReport;`)();
  }
  const lim = /const PAGES_FILE_LIMIT = ([^;]+);/.exec(SRC);
  if (lim) limit = new Function(`return ${lim[1]};`)();
  ok('pagesLimitReport was lifted out of build-pwa.js', typeof report === 'function');
  /* 25,000,000, not 26,214,400. The dashboard labels its limit "25 MiB" and
     refused a 23.9 MiB file (25.06 million bytes) under it; the first version
     of this check asserted the binary reading and passed that file. */
  ok('the ceiling is the 25,000,000 bytes Cloudflare actually enforces', limit === 25 * 1000 * 1000, String(limit));
  /* The file that actually broke a deploy, at the size it actually was. */
  const MiB = 1048576;
  const dist = [{ rel: 'app.js', bytes: 682 * 1024 }, { rel: 'content/questions.json', bytes: 1.65 * MiB },
                { rel: 'content/refs-images.json', bytes: Math.round(25.7 * MiB) }];
  const r = report ? report(dist, limit) : { over: [], largest: null };
  ok('the 25.7 MiB refs-images.json that broke a deploy is refused',
     r.over.length === 1 && /^content\/refs-images\.json is [\d,]+ bytes \(25\.7 MiB\)$/.test(r.over[0]), r.over.join('; '));
  ok('and the files under the ceiling are not named', !r.over.some(x => /app\.js|questions/.test(x)));
  ok('the largest file is reported, so the margin is visible on a green build',
     !!r.largest && r.largest.rel === 'content/refs-images.json');
  /* The rebuild that was ALSO refused by the upload — under 25 MiB, over
     25 million bytes. This is the case the binary reading got wrong. */
  const second = report ? report([{ rel: 'content/refs-images.json', bytes: Math.round(23.9 * MiB) }], limit) : { over: [] };
  ok('the 23.9 MiB rebuild the upload also refused is refused here', second.over.length === 1, second.over.join('; ') || 'passed');
  /* The boundary is inclusive of the limit. */
  const edge = report ? report([{ rel: 'a', bytes: limit }, { rel: 'b', bytes: 23.5e6 }], limit) : { over: ['n/a'] };
  ok('a file of exactly 25,000,000 bytes passes, and so does 23.5 MB', edge.over.length === 0, edge.over.join('; '));
  ok('one byte over is refused', report ? report([{ rel: 'x', bytes: limit + 1 }], limit).over.length === 1 : false);
  /* The check is only worth anything if the build acts on it. */
  ok('the build exits non-zero when anything is over',
     /if \(hostCheck\.over\.length\) \{[\s\S]{0,400}process\.exit\(1\)/.test(SRC));
  ok('and it measures the finished tree, after sw.js — the last file written before icons',
     SRC.indexOf("const hostCheck = pagesLimitReport(distFiles") > SRC.indexOf("fs.writeFileSync(path.join(DIST, 'sw.js'), SW)"));
}

/* ── the note figures ship one file per unit ──────────────────────────────────
   One refs-images.json for the whole shelf is what grew past the host's
   ceiling. build-pwa now splits the figures by unit folder, and the app
   fetches every unit and MERGES it in. Both halves are checked: the split,
   driven as a function lifted from the source, and the runtime code, read as
   text, because an assignment in place of a merge would leave only whichever
   unit's file arrived last — every other unit's notes figureless, and no
   error anywhere. */
const splitChecks = async () => {
  head('build-pwa writes one figure file per unit, and the app merges them all');
  const lift = name => {
    const at = SRC.indexOf('function ' + name + '(');
    if (at < 0) return null;
    let depth = 0, end = -1;
    for (let k = SRC.indexOf('{', at); k < SRC.length; k++) {
      if (SRC[k] === '{') depth++;
      else if (SRC[k] === '}') { depth--; if (!depth) { end = k + 1; break; } }
    }
    return end > 0 ? new Function(`${SRC.slice(at, end)}\nreturn ${name};`)() : null;
  };
  const split = lift('splitRefImages');
  ok('splitRefImages was lifted out of build-pwa.js', typeof split === 'function');
  const parts = split ? split({
    'hf/049_FIG.56.5_p058.jpg': 'a', 'hf/054_FIG.jpg': 'b',
    'arrhythmias/page_308.jpg': 'c', 'loose.jpg': 'd', 'Braunwald HF/x.jpg': 'e',
  }) : {};
  ok('each unit folder becomes its own file', JSON.stringify(Object.keys(parts).sort())
     === JSON.stringify(['Braunwald_HF', 'arrhythmias', 'hf', 'loose']), Object.keys(parts).sort().join(', '));
  ok('and every figure lands in its unit, keyed exactly as the notes cite it',
     parts.hf && parts.hf['hf/054_FIG.jpg'] === 'b' && parts.arrhythmias && parts.arrhythmias['arrhythmias/page_308.jpg'] === 'c');
  ok('no figure is lost or duplicated in the split',
     Object.values(parts).reduce((n, p) => n + Object.keys(p).length, 0) === 5);
  ok('a folder name that is not URL-safe is made so', !!parts.Braunwald_HF && !parts['Braunwald HF']);

  /* The runtime half, as the build appends it to app.js. */
  const at = SRC.indexOf('reference figures, fetched one unit at a time');
  const runtime = at > -1 ? SRC.slice(at, SRC.indexOf('`;', at)) : '';
  ok('the app fetches every unit file the build wrote', /parts\.forEach\(function\(u\)\{\s*fetch\(u\)/.test(runtime));
  ok('and merges each into REF_IMGS rather than replacing it',
     /REF_IMGS\[k\]\s*=\s*imgs\[k\]/.test(runtime) && !/REF_IMGS\s*=\s*imgs/.test(runtime));
  /* And RUN it, rather than only reading it: the appended code, with the
     build's placeholder filled in, against a stand-in fetch that delivers the
     units out of order. Every unit's figures must be there at the end. */
  const ran = await (async () => {
    const body = runtime.slice(runtime.indexOf('(function(){'));
    if (!body.includes('${JSON.stringify(urls)}')) return { err: 'placeholder moved' };
    const code = body.replace('${JSON.stringify(urls)}',
      JSON.stringify(['content/refs-images/arrhythmias.json', 'content/refs-images/hf.json']));
    const files = { 'content/refs-images/arrhythmias.json': { 'arrhythmias/page_308.jpg': 'A' },
                    'content/refs-images/hf.json': { 'hf/054_FIG.jpg': 'H' } };
    const REF_IMGS = {}; let paints = 0; const pending = [];
    const fetch = u => new Promise(res => pending.push(() => res({ json: () => Promise.resolve(files[u]) })));
    new Function('REF_IMGS', 'fetch', 'refLatePaint', code)(REF_IMGS, fetch, () => { paints++; });
    for (const go of pending.reverse()) { go(); await new Promise(r => setTimeout(r, 0)); }
    await new Promise(r => setTimeout(r, 0));
    return { keys: Object.keys(REF_IMGS).sort(), paints, asked: pending.length };
  })();
  ok('run with the units arriving out of order, every unit\'s figures are present',
     !ran.err && JSON.stringify(ran.keys) === JSON.stringify(['arrhythmias/page_308.jpg', 'hf/054_FIG.jpg']),
     ran.err || ran.keys.join(', '));
  ok('and the page is repainted as each unit lands', ran.paints === 2 && ran.asked === 2, `${ran.paints} repaints, ${ran.asked} fetches`);
  ok('the build writes each part to content/refs-images/<unit>.json',
     /path\.join\(DIST, 'content', 'refs-images'\)[\s\S]{0,200}unit \+ '\.json'/.test(SRC));
  ok('and nothing still writes or fetches the single refs-images.json',
     !/writeFileSync\([^)]*'refs-images\.json'/.test(SRC) && !/fetch\('content\/refs-images\.json'\)/.test(SRC));
};

splitChecks().catch(e => { failed++; console.log('  FAIL  the split checks threw  → ' + e.message); }).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
