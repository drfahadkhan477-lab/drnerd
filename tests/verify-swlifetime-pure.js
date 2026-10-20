#!/usr/bin/env node
/**
 * The service worker's cache writes are held open by the event that started them, on every path that makes one.
 *
 *   node tests/verify-swlifetime-pure.js
 *
 * sw.js writes to the cache after the page has its answer: the shell is served from the cache and refreshed from the network
 * behind it, and a figure is fetched and kept as it is handed back. Each write is wrapped in event.waitUntil(), because once
 * respondWith()'s promise settles the browser is free to stop the worker (iOS Safari especially), and a write nothing is
 * holding the worker up for is a write that may never land.
 *
 * The wrapper was in the source and was not working on the path that matters most. On a cache hit the page is answered at
 * once, the network answers later, and waitUntil() was first called from inside the network's callback: by then the event
 * had nothing outstanding and was no longer being dispatched, so the browser throws InvalidStateError ("The event handler is
 * already finished and no extend lifetime promises are outstanding" in Chromium, "Event is no longer being dispatched and has
 * no pending promises" in WebKit, both measured on a worker that logged it). The catch on the fetch swallowed it. The write
 * was still started, because its argument is evaluated first, and nothing held the worker up for it. tests/verify-pwa.js counts
 * the waitUntil calls in the source and found both: a call that is written is not a call that is allowed.
 *
 * WHAT IT RUNS. The worker as build-pwa.js writes it (the template, evaluated, not a copy of it), in a sandbox with a
 * CacheStorage whose writes finish when this suite says so, a network that answers when this suite says so, and a fetch event
 * that keeps the one rule the browsers keep: waitUntil() is refused when nothing is outstanding and the handler has returned.
 * The suite first holds that event to the rule, because a fake that never refuses would make everything after it pass.
 *
 * WHAT IT CANNOT CHECK. That a real browser then keeps the worker alive for as long as it is asked to. That is the browser's
 * promise, not the worker's; this holds the worker to asking for it, and in time.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'build-pwa.js'), 'utf8');
const ORIGIN = 'https://app.test';

/* The worker as build-pwa.js writes it: the template evaluated with the names it interpolates. */
const open = 'const SW = `', at = SRC.indexOf(open), end = SRC.indexOf('\n`;', at);
if (at < 0 || end < 0) throw new Error('build-pwa.js no longer defines the worker as const SW = `...`');
const template = new Function('contentVersion', 'path', 'DIST', 'contentManifest', 'shellDigest',
  'BUILD_ID', 'COMMIT', 'NO_CONTENT', 'fontAssets', 'echoAssets', 'return `' + SRC.slice(at + open.length, end) + '\n`;');
const SW = template(() => '0123456789abcdef', path, '/dist', {}, 'aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'abc123def456', false, [], []);

const invalidState = message => Object.assign(new Error(message), { name: 'InvalidStateError' });

/* A fetch event with the lifetime rule of the service worker spec. respondWith() and waitUntil() each add a promise the
   event is alive for, until it settles; the handler is "dispatching" until it returns; and waitUntil() when neither holds is
   an InvalidStateError. `refused` is every call that was. */
function fetchEvent(request) {
  const ev = { request, dispatching: true, pending: 0, refused: [], settled: false, answer: null };
  const hold = p => {
    ev.pending++;
    const release = () => { ev.pending--; };
    Promise.resolve(p).then(release, release);
  };
  ev.respondWith = p => {
    if (!ev.dispatching) throw invalidState('respondWith() after the handler returned');
    ev.answer = p;
    Promise.resolve(p).then(() => { ev.settled = true; }, () => { ev.settled = true; });
    hold(p);
  };
  ev.waitUntil = p => {
    if (!ev.dispatching && ev.pending === 0) {
      const err = invalidState('The event handler is already finished and no extend lifetime promises are outstanding.');
      ev.refused.push(err.message);
      throw err;
    }
    hold(p);
  };
  return ev;
}

/* CacheStorage in memory. A put() returns a promise that settles when the suite releases that write. */
function storage(seed) {
  const buckets = new Map(), writes = [];
  const bucket = name => { if (!buckets.has(name)) buckets.set(name, new Map()); return buckets.get(name); };
  const key = r => new URL(typeof r === 'string' ? r : r.url, ORIGIN + '/').pathname;
  const cache = name => ({
    async match(req) {
      const e = bucket(name).get(key(req));
      return e ? new Response(e.body, { status: 200, headers: { 'content-type': e.type } }) : undefined;
    },
    put(req, res) {
      const w = { key: key(req), bucket: name, done: false };
      writes.push(w);
      return new Promise(resolve => {
        w.release = async () => {
          bucket(name).set(w.key, { body: await res.text(), type: res.headers.get('content-type') });
          w.done = true; resolve();
        };
      });
    },
    async keys() { return [...bucket(name).keys()]; },
    async add() {}, async addAll() {},
  });
  return {
    caches: { open: async name => cache(name), keys: async () => [...buckets.keys()], delete: async name => buckets.delete(name) },
    writes,
    seed(name, files) { for (const [p, [body, type]] of Object.entries(files)) bucket(name).set(p, { body, type }); },
    read: (name, p) => (bucket(name).get(p) || {}).body,
  };
}

/* A worker with the given files already cached, and a network that has not answered anyone. */
function worker(have = {}) {
  const handlers = {}, st = storage(), calls = [];
  const net = req => new Promise((resolve, reject) => calls.push({ url: req.url, answer: resolve, fail: reject }));
  const names = vm.runInNewContext(SW + '\n;({ SHELL, CONTENT });', {
    self: { addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    location: { origin: ORIGIN }, caches: st.caches, fetch: net, URL, Request, Response, console,
  });
  st.seed(names.SHELL, have.shell || {});
  st.seed(names.CONTENT, have.content || {});
  const get = p => {
    const ev = fetchEvent({ method: 'GET', url: ORIGIN + p, mode: 'no-cors' });
    handlers.fetch(ev);
    ev.dispatching = false;
    return ev;
  };
  return { get, st, calls, names };
}

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };
const text = async p => (await p).text();
const reply = (body, type) => new Response(body, { status: 200, headers: { 'content-type': type } });
const JS = 'text/javascript', IMG = 'image/webp', HTML = 'text/html; charset=utf-8';

(async () => {
  head('the event the suite uses keeps the rule the browsers keep');
  {
    const ev = fetchEvent({});
    let threw = null;
    try { ev.waitUntil(Promise.resolve()); } catch (e) { threw = e; }
    ok('waitUntil() is accepted while the handler is still running', !threw && ev.pending === 1);
    ev.dispatching = false; await settle();
    ok('and nothing is outstanding once what was handed over has settled', ev.pending === 0);
    try { ev.waitUntil(Promise.resolve()); } catch (e) { threw = e; }
    ok('but once the handler has returned and nothing is outstanding it is an InvalidStateError, and is recorded',
       !!threw && threw.name === 'InvalidStateError' && ev.refused.length === 1, threw && threw.name);
    const late = fetchEvent({});
    late.waitUntil(new Promise(() => {})); late.dispatching = false;
    let again = null; try { late.waitUntil(Promise.resolve()); } catch (e) { again = e; }
    ok('while something is outstanding it is accepted after the handler has returned', !again && late.refused.length === 0);
  }

  head('a cache hit is answered at once, and the network answers later');
  {
    const w = worker({ shell: { '/app.js': ['old app', JS] } });
    const ev = w.get('/app.js');
    await settle();
    ok('the page is answered from the cache while the network has not answered', ev.settled && w.calls.length === 1 && await text(ev.answer) === 'old app');
    w.calls[0].answer(reply('new app', JS));
    await settle();
    const write = w.st.writes[0];
    ok('what the network answers is written to the shell cache', !!write && write.key === '/app.js' && write.bucket === w.names.SHELL && !write.done,
       write ? `${write.bucket} ${write.key}` : 'no write');
    ok('no call to waitUntil() was refused', ev.refused.length === 0, ev.refused.join(' | '));
    ok('and while the write is in flight the event is alive for it', ev.pending > 0, `${ev.pending} outstanding`);
    await (write && write.release()); await settle();
    ok('the cache holds the new copy once it is written', w.st.read(w.names.SHELL, '/app.js') === 'new app');
    ok('and the event is over when the write is, not held for ever', ev.pending === 0, `${ev.pending} outstanding`);
  }

  head('a cache hit while offline');
  {
    const w = worker({ shell: { '/app.js': ['old app', JS] } });
    const ev = w.get('/app.js');
    await settle();
    w.calls[0].fail(new TypeError('Failed to fetch'));
    await settle();
    ok('the page has the cached copy, and nothing is written', await text(ev.answer) === 'old app' && w.st.writes.length === 0);
    ok('no call to waitUntil() was refused, and the event is over', ev.refused.length === 0 && ev.pending === 0, `${ev.refused.length} refused, ${ev.pending} outstanding`);
  }

  head('a cache hit, and the network answers with a sign-in page');
  {
    const w = worker({ shell: { '/app.js': ['old app', JS] } });
    const ev = w.get('/app.js');
    await settle();
    w.calls[0].answer(reply('<html>sign in</html>', HTML));
    await settle();
    ok('the sign-in page is not written over the shell', w.st.writes.length === 0 && w.st.read(w.names.SHELL, '/app.js') === 'old app');
    ok('and the event is over', ev.refused.length === 0 && ev.pending === 0, `${ev.refused.length} refused, ${ev.pending} outstanding`);
  }

  head('a shell file the cache does not have');
  {
    const w = worker();
    const ev = w.get('/app.js');
    await settle();
    ok('the network is asked, and the page waits for it', w.calls.length === 1 && !ev.settled);
    w.calls[0].answer(reply('fresh app', JS));
    await settle();
    const write = w.st.writes[0];
    ok('the page gets what the network answered', ev.settled && await text(ev.answer) === 'fresh app');
    ok('which is written to the shell cache', !!write && write.key === '/app.js' && write.bucket === w.names.SHELL && !write.done);
    ok('no call to waitUntil() was refused, and the event is alive while the write is in flight', ev.refused.length === 0 && ev.pending > 0,
       `${ev.refused.length} refused, ${ev.pending} outstanding`);
    await (write && write.release()); await settle();
    ok('the cache holds it once written, and the event is over', w.st.read(w.names.SHELL, '/app.js') === 'fresh app' && ev.pending === 0);
  }

  head('a figure');
  {
    const miss = worker();
    const ev = miss.get('/content/figures/f1.webp');
    await settle();
    miss.calls[0].answer(reply('picture', IMG));
    await settle();
    const write = miss.st.writes[0];
    ok('one the cache does not have is fetched, handed back and written to the content cache',
       await text(ev.answer) === 'picture' && !!write && write.bucket === miss.names.CONTENT && write.key === '/content/figures/f1.webp' && !write.done);
    ok('no call to waitUntil() was refused, and the event is alive while the write is in flight', ev.refused.length === 0 && ev.pending > 0,
       `${ev.refused.length} refused, ${ev.pending} outstanding`);
    await (write && write.release()); await settle();
    ok('the cache holds it once written, and the event is over', miss.st.read(miss.names.CONTENT, '/content/figures/f1.webp') === 'picture' && ev.pending === 0);
    const hit = worker({ content: { '/content/figures/f1.webp': ['picture', IMG] } });
    const again = hit.get('/content/figures/f1.webp');
    await settle();
    ok('one it has is answered from the cache without asking the network', await text(again.answer) === 'picture' && hit.calls.length === 0);
  }
})().catch(e => ok('the driven worker ran to the end', false, e && e.stack || String(e)))
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  });
