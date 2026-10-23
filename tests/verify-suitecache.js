#!/usr/bin/env node
'use strict';
/*
 * What a browser asks the repository for, as the result cache has to know it.
 *
 *   node tests/verify-suitecache.js [ignored]
 *
 * scripts/trace-inputs.js watches what NODE reads. A page loaded from the
 * repository by a browser is read by the browser, which node never sees: the
 * suite that loaded it depends on that file, and without this the cache would
 * go on reusing a pass over a stylesheet that has since been edited.
 * tests/_engine.js launch() therefore records the file:// URL of every request
 * a context makes, while a run is being traced (SYSTOLE_TRACE_FILE).
 *
 * That works only if each engine REPORTS the request, so this is held in the
 * engine that runs it, and CI runs it in all three. A fixture page reaches for
 * files nine ways (tests/fixtures/suitecache/index.html); each is a check, and
 * so is the page's own document. What must NOT be recorded is held too, and
 * with proof that the browser did ask: a file outside the repository, an https
 * URL, and a file in the fixture directory that nothing loads.
 *
 * FIREFOX REPORTS NONE, measured at Firefox 155 under Playwright 1.63: not to
 * the context, and not to the page's own request event. So scripts/suite-cache.js
 * keeps the cache OFF for an engine it does not list (TRACED_ENGINES), and this
 * suite holds that decision to the engine's behaviour in both directions that
 * matter: an engine the cache traces must report what the fixture loads, and an
 * engine it does not trace must be one that reports nothing it could use. Where
 * the cache is off for the engine, the per-request checks cannot be made and
 * are printed as not measurable here, which is not a pass.
 *
 * The suite traces itself when the runner has not (run by hand), and uses the
 * runner's trace when it has (npm test), so the same checks read the same file
 * either way.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'suitecache');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'suitecache-browser-'));
/* Set before trace-inputs.js is first required (launch() does that), because it
   reads both variables once, when it loads: required first, it would hold no
   root and record nothing. */
if (!process.env.SYSTOLE_TRACE_FILE) {
  const roots = [ROOT]; try { const real = fs.realpathSync(ROOT); if (!roots.includes(real)) roots.push(real); } catch (_) { /* one spelling */ }
  process.env.SYSTOLE_TRACE_FILE = path.join(TMP, 'trace.jsonl');
  process.env.SYSTOLE_TRACE_ROOT = roots.join(path.delimiter);
}
const TRACE = process.env.SYSTOLE_TRACE_FILE;
const { launch, engineName } = require('./_engine.js');
const { onDeath } = require('./_deathnote.js');
const SC = require('../scripts/suite-cache.js');

/* A THIRD OUTCOME, as in tests/verify-physio.js: a claim this engine cannot weigh is
   neither passed nor failed. */
let unmeasured = 0;
const unmeasurable = (label, why) => { unmeasured++; console.log('  ----  ' + label + '  → not measurable here: ' + why); };

/* The files the trace says a browser asked for, relative to the fixture directory. */
const asked = () => {
  let text = ''; try { text = fs.readFileSync(TRACE, 'utf8'); } catch (_) { /* nothing written yet */ }
  const out = new Set();
  for (const line of text.split('\n')) {
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch (_) { continue; }
    if (r[0] === 'browser' && typeof r[1] === 'string') out.add(path.relative(FIX, r[1]).split(path.sep).join('/'));
  }
  return out;
};
const url = f => pathToFileURL(path.join(FIX, f)).href;

(async () => {
  const engine = engineName();
  head(`the fixture page, loaded in ${engine}`);
  const outside = path.join(TMP, 'outside.svg');
  fs.writeFileSync(outside, '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
  const requested = [];
  onDeath(() => ({ section, checks: passed + failed, requested: requested.length, recorded: [...asked()].join(', ') || 'nothing' }));
  let browser = await launch();
  try {
    const page = await browser.newPage();
    page.on('request', r => requested.push(r.url()));
    // Exercise an HTTPS request without depending on DNS for a deliberately invalid host.
    await page.route('https://example.invalid/x.png', route => route.fulfill({
      contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
    }));
    await page.goto(url('index.html'), { waitUntil: 'load' });
    await page.waitForFunction(() => window.__classic === true && document.readyState === 'complete', undefined, { timeout: 30000 });
    const state = await page.evaluate(() => ({ title: document.title, classic: window.__classic === true, module: window.__module === true,
      imported: getComputedStyle(document.documentElement).getPropertyValue('color') !== undefined, frames: window.frames.length }));
    ok('the page loaded: its title is read and its classic script ran', state.title === 'suitecache fixture' && state.classic, JSON.stringify(state));

    /* Then the page asks for two things the cache must not record. The browser's own
       request log is the proof that it asked. */
    // WebKit blocks a file subresource outside the document's directory before
    // emitting a request. A top-level navigation makes the exclusion measurable.
    const outsidePage = await browser.newPage();
    outsidePage.on('request', r => requested.push(r.url()));
    await outsidePage.goto(pathToFileURL(outside).href, { waitUntil: 'load' });
    await outsidePage.close();
    await page.evaluate(u => new Promise(res => { const i = new Image(); i.onload = i.onerror = () => res(); i.src = u; }),
      'https://example.invalid/x.png');
    const seen = asked();
    const traced = SC.TRACED_ENGINES.includes(engine);
    const kinds = [
      ['the page’s own document', 'index.html'],
      ['a stylesheet', 'style.css'],
      ['a stylesheet that an @import in that stylesheet names', 'imported.css'],
      ['an image that a stylesheet names (a CSS background)', 'bg.txt'],
      ['a classic script', 'classic.js'],
      ['a module script', 'module.mjs'],
      ['an image element', 'pic.txt'],
      ['an iframe’s document', 'frame.html'],
      ['a script that iframe loads', 'frame.js'],
    ];
    head(`the cache and ${engine}`);
    ok(traced ? `the cache traces ${engine}, so ${engine} must report what the fixture loads, and does` : `the cache does not trace ${engine}, and ${engine} reports nothing of what the fixture loads`,
       traced ? seen.has('index.html') && seen.has('style.css') : seen.size === 0,
       'recorded: ' + ([...seen].sort().join(', ') || 'nothing') + (!traced && seen.size ? ` — ${engine} now reports file:// requests: add it to TRACED_ENGINES in scripts/suite-cache.js, and this suite will hold it like the others` : ''));
    const cache = SC.fromEnv({ root: ROOT, engine, env: {} });
    ok(traced ? `the cache is on for ${engine}` : `the cache is off for ${engine}, and says it does not report what pages load`,
       traced ? !cache.off : /does not report the files a page loads/.test(cache.off || ''), String(cache.off || 'on'));
    if (!traced) {
      const why = `${engine} reports no file:// request, so the cache is off for it`;
      for (const [what] of kinds) unmeasurable(`${what} is recorded as asked for`, why);
      unmeasurable('the files the trace holds are exactly the files the browser says it asked the fixture directory for', why);
      unmeasurable('a file outside the repository, an https URL and a file nothing loads are not recorded', why);
      unmeasurable('a browser launched while nothing is being traced reports nothing, and one launched while it is being traced reports the page', why);
    } else {
    head(`what the trace holds, in ${engine}`);
    for (const [what, file] of kinds) ok(`${what} is recorded as asked for`, seen.has(file), seen.has(file) ? file : `${file} not among: ${[...seen].join(', ') || 'nothing'}`);
    /* The engine's own account of what it asked the fixture directory for, against the trace's: the same set. A module on a file:// page is refused by
       some engines (an origin of null), and then its import is never requested, so what is held is "recorded if and only if requested". */
    const fixDir = pathToFileURL(FIX + path.sep).href;
    const requestedHere = new Set(requested.filter(u => u.startsWith(fixDir)).map(u => decodeURIComponent(u.slice(fixDir.length)).split(/[?#]/)[0]));
    const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
    ok('the files the trace holds are exactly the files the browser says it asked the fixture directory for', requestedHere.size >= 9 && sameSet(requestedHere, seen), 'asked: ' + [...requestedHere].sort().join(', ') + ' | recorded: ' + [...seen].sort().join(', '));
    console.log('  note: ' + engine + (requestedHere.has('dep.mjs') ? ' fetched' : ' did not fetch') + ' the module that a file:// module script imports' + (state.module ? '' : ' (the module script itself did not run)'));
    ok('the browser really did ask for a file outside the repository and for an https URL, so the two checks below can fail',
       requested.some(u => u === pathToFileURL(outside).href) && requested.some(u => u === 'https://example.invalid/x.png'), requested.length + ' requests made');
    /* A negative is only worth something where the positives hold: "not recorded" is
       true of everything when nothing is recorded at all. */
    const recording = seen.has('index.html') && seen.has('style.css');
    ok('a file outside the repository is not recorded, while the fixture is', recording && ![...seen].some(f => f.endsWith('outside.svg')), [...seen].join(', '));
    ok('an https URL is not recorded, while the fixture is', recording && ![...seen].some(f => /example\.invalid/.test(f)), [...seen].join(', '));
    ok('a file in the same directory that nothing loads is not recorded, while the fixture is', recording && !seen.has('unused.txt') && !requested.some(u => u.endsWith('unused.txt')), [...seen].join(', '));
    ok('what is recorded is a path to the file, absolute, that exists',
       (() => { try { return fs.readFileSync(TRACE, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r[0] === 'browser').every(r => path.isAbsolute(r[1]) && fs.existsSync(r[1])); } catch (_) { return false; } })());
    await page.close();
    await browser.close(); browser = null;

    head('a browser launched while nothing is being traced reports nothing');
    const keep = process.env.SYSTOLE_TRACE_FILE;
    delete process.env.SYSTOLE_TRACE_FILE;
    let loaded = false;
    try {
      browser = await launch();
      const p = await browser.newPage();
      await p.goto(url('solo.html'), { waitUntil: 'load' });
      await p.waitForFunction(() => window.__solo === true, undefined, { timeout: 30000 });
      loaded = true;
      await browser.close(); browser = null;
    } finally { process.env.SYSTOLE_TRACE_FILE = keep; }
    ok('the page loaded, and the trace did not hear of it, though it heard of the others', loaded && asked().has('index.html') && !asked().has('solo.js') && !asked().has('solo.html'), [...asked()].join(', '));
    browser = await launch();
    const q = await browser.newPage();
    await q.goto(url('solo.html'), { waitUntil: 'load' });
    await q.waitForFunction(() => window.__solo === true, undefined, { timeout: 30000 });
    ok('and the same page, in a browser launched while it is being traced, is recorded', asked().has('solo.js') && asked().has('solo.html'), [...asked()].join(', '));
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  console.log(`\n${passed} passed, ${failed} failed` + (unmeasured ? `, ${unmeasured} not measurable on ${engine}` : ''));
  process.exit(failed ? 1 : 0);
})();
