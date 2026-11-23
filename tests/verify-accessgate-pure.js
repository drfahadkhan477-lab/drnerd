#!/usr/bin/env node
/*
 * Telling a reply from the sign-in page an expired session gets instead — src/core/accessgate.js.
 *
 *   node tests/verify-accessgate-pure.js
 *
 * Pure Node, over real fetch Responses made here (Node's own Response), with the one reply no constructor can make,
 * the opaque redirect a redirect:'manual' fetch resolves to, written out as the browser gives it.
 *
 * What is measured, rather than assumed:
 *   - an HTML reply where data was asked for is a lapsed session, whatever the case of its type; JSON, a stream,
 *     plain text, XHTML, no type, no headers or no reply at all is not;
 *   - the sign-in probe says lapsed for an opaque redirect, any 3xx, or the sign-in page under any status, and not
 *     for the manifest it asked for or an error that is not HTML;
 *   - a figure is a reply that is ok and an image, whatever the case of its type; a 200 sign-in page, an image type
 *     on an error, an octet-stream (the older bank's JPEGs before serve.js knew .jpg), no type, or nothing cached is
 *     not;
 *   - the page's names are the calls into this, written into the page once, above them, and the page keeps no copy.
 *
 * verify-pwa is the browser half: it puts a gated reply in the cache and watches the survey refuse it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');
const G = require('../src/core/accessgate.js').AccessGate;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const safely = fn => { try { return fn(); } catch (e) { return 'THREW ' + e.message; } };

/* A string body gives a Response a text/plain type of its own, so a reply with no type has no body. */
const reply = (status, type, body = 'x') => new Response(type == null || (status >= 300 && status < 400) ? null : body,
  { status, headers: type == null ? {} : { 'content-type': type } });
const SIGNIN = '<!doctype html><title>Sign in</title>';
/* What fetch(…, {redirect:'manual'}) resolves to when the answer was a redirect. */
const OPAQUE = { type: 'opaqueredirect', status: 0, ok: false, headers: new Headers() };
const said = (f, rs) => rs.map(r => String(safely(() => f(r)))).join(' ');

head('a lapsed session, where data was asked for');
{
  const yes = [reply(200, 'text/html; charset=utf-8', SIGNIN), reply(200, 'TEXT/HTML', SIGNIN), reply(200, 'text/html', SIGNIN)];
  ok('an HTML reply is the sign-in page, whatever the case of its type', yes.every(r => safely(() => G.lapsed(r)) === true), said(G.lapsed, yes));
  const no = [reply(200, 'application/json', '{}'), reply(200, 'text/event-stream'), reply(200, 'text/plain'), reply(200, 'application/xhtml+xml')];
  ok('JSON, a stream, plain text and XHTML are not', no.every(r => safely(() => G.lapsed(r)) === false), said(G.lapsed, no));
  const none = [reply(200, null), null, undefined, {}];
  ok('nor is a reply with no type, a reply with no headers, or no reply', none.every(r => safely(() => G.lapsed(r)) === false), said(G.lapsed, none));
}

head('the sign-in probe');
{
  const yes = [OPAQUE, reply(302, null), reply(300, null), reply(399, null), reply(200, 'text/html', SIGNIN), reply(401, 'text/html', SIGNIN)];
  ok('lapsed: an opaque redirect, any 3xx, or the sign-in page under any status', yes.every(r => safely(() => G.probeLapsed(r)) === true), said(G.probeLapsed, yes));
  const no = [reply(200, 'application/manifest+json', '{}'), reply(299, 'application/json', '{}'), reply(400, 'application/json', '{}'), reply(404, 'text/plain')];
  ok('not lapsed: the manifest it asked for, or an answer that is neither a redirect nor HTML', no.every(r => safely(() => G.probeLapsed(r)) === false), said(G.probeLapsed, no));
}

head('a figure is an image');
{
  const yes = [reply(200, 'image/webp'), reply(200, 'image/png'), reply(200, 'IMAGE/JPEG'), reply(200, 'image/svg+xml')];
  ok('an ok reply with an image type, whatever its case', yes.every(r => safely(() => G.isImage(r)) === true), said(G.isImage, yes));
  ok('a 200 sign-in page is not a figure', safely(() => G.isImage(reply(200, 'text/html; charset=utf-8', SIGNIN))) === false);
  /* The owner's run with 727 older questions: their figures went out as application/octet-stream, and were refused
     (verify-olderacc-pure holds serve.js to an image type for every figure the split build writes). */
  const no = [reply(200, 'application/octet-stream'), reply(200, null), reply(404, 'image/png'), reply(500, 'image/webp')];
  ok('nor is an octet-stream, a reply with no type, or an image type on an error', no.every(r => safely(() => G.isImage(r)) === false), said(G.isImage, no));
  ok('and nothing cached is no figure', safely(() => G.isImage(undefined)) === false && safely(() => G.isImage(null)) === false);
}

head('the page\'s names are the calls into this');
{
  /* Read with its comments blanked: the shell explains itself, and quotes what is looked for. */
  const page = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
  const n = t => page.split(t).length - 1;
  const lines = ['function apexSessionLapsed(r){ return AccessGate.lapsed(r); }', 'function offlineIsImage(res){ return AccessGate.isImage(res); }',
    '.then(r=>{ const lapsed=AccessGate.probeLapsed(r);'];
  const missing = lines.filter(l => n(l) !== 1).concat(['apexSessionLapsed', 'offlineIsImage', 'signinLapsed'].filter(x => n('function ' + x + '(') !== 1).map(x => x + '() not defined once'));
  ok('each is one line handing over the reply, and is defined once', missing.length === 0, missing.join(' | ') || 'all three');
  const slot = page.indexOf('@@SLOT[src:src/core/accessgate.js]@@');
  ok('the module is written into the page once, above them', slot >= 0 && n('@@SLOT[src:src/core/accessgate.js]@@') === 1
     && ['function apexSessionLapsed(', 'function signinLapsed(', 'function offlineIsImage('].every(t => page.indexOf(t) > slot), slot < 0 ? 'no slot' : 'slot at ' + slot);
  ok('and the page keeps no copy of the rules', n('opaqueredirect') === 0 && n("indexOf('image/')") === 0 && n("indexOf('text/html')") === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
