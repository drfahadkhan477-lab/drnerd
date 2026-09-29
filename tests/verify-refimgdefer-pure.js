#!/usr/bin/env node
'use strict';
/*
 * The note figures load after the home screen, one unit at a time.
 *
 *   node tests/verify-refimgdefer-pure.js
 *
 * scripts/ref-images-loader.js is the code build-pwa appends to app.js to
 * fetch content/refs-images/<unit>.json — about 19 MB, which used to start
 * the moment app.js ran and compete with the home screen. This runs that very
 * string against a stubbed page whose clock is stepped by hand: the seed, the
 * two animation frames, the idle callback and every fetch each move only when
 * this suite says so. That is what lets each wait be checked on its own — a
 * loader that skipped one would fetch at a step where this expects nothing.
 *
 * It also runs build-pwa's seed loader, lifted out of its source, to check
 * that REF_SEED_READY settles on every path: a seed that never settled would
 * strand the figures, and nothing on screen would say why.
 *
 * NOT HERE: the real page. The owner's boot-probe is what shows the figures
 * gone from "fetched before the hero"; verify-pwa is what shows the split
 * build still boots and serves.
 */
const fs = require('fs');
const path = require('path');
const { REF_IMG_LOADER } = require('../scripts/ref-images-loader.js');
const { blankComments } = require('./_source.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
/* A promise the loader leaves rejected with no handler is a defect of its
   own — and in Node it would end the run before any check could name it. */
const unhandled = [];
process.on('unhandledRejection', e => { unhandled.push(e && e.message || String(e)); });
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };

const UNITS = ['arrhythmias', 'hf', 'ischemia', 'valv'].map(u => `content/refs-images/${u}.json`);

/* A page whose every asynchronous step is a queue this suite drains. */
function page({ seed = 'pending', idleApi = true, pearl = null, failing = [], units = UNITS } = {}) {
  const frames = [], idles = [], timers = [], inflight = [], asked = [];
  let resolveSeed, rejectSeed, paints = 0;
  const REF_IMGS = {};
  const seedPromise = seed === 'absent' ? undefined
    : new Promise((res, rej) => { resolveSeed = res; rejectSeed = rej; });
  /* The harness's own listener, so a loader that ignores a failed seed shows
     up as a failed check below — not as an unhandled rejection that kills the
     run before it can say which. */
  if (seedPromise) seedPromise.catch(() => {});
  const fetch = u => { asked.push(u); return new Promise((res, rej) => inflight.push({ u, go: () =>
    failing.includes(u) ? rej(new Error('offline')) : res({ json: () => Promise.resolve({ [u.replace(/.*\//, '') + '/fig']: 'data:' + u }) }) })); };
  const names = ['REF_IMGS', 'fetch', 'refLatePaint', 'requestAnimationFrame', 'setTimeout', 'REF_SEED_READY', 'pearlCurrent']
    .concat(idleApi ? ['requestIdleCallback'] : []);
  const args = [REF_IMGS, fetch, () => { paints++; }, f => frames.push(f), (f, ms) => timers.push({ f, ms }), seedPromise, pearl]
    .concat(idleApi ? [(f, o) => idles.push({ f, o })] : []);
  new Function(...names, REF_IMG_LOADER.replace('__PARTS__', JSON.stringify(units)))(...args);
  const drain = q => { const fs = q.splice(0); fs.forEach(x => (x.f || x)()); return fs.length; };
  return {
    asked, REF_IMGS, get paints() { return paints; }, get inflight() { return inflight.length; }, timers, idles,
    seedOk: async () => { resolveSeed(); await settle(); },
    seedFails: async () => { rejectSeed(new Error('no seed')); await settle(); },
    frame: async () => { const n = drain(frames); await settle(); return n; },
    idle: async () => { const n = drain(idles) + drain(timers); await settle(); return n; },
    land: async () => { const x = inflight.shift(); if (!x) return null; x.go(); await settle(); return x.u; },
  };
}

(async () => {
  head('nothing is fetched until the home screen has had its turn');
  {
    const p = page();
    for (let i = 0; i < 4; i++) { await settle(); await p.frame(); await p.idle(); }
    ok('while the seed is still coming, nothing is fetched — however many frames and idle turns pass',
       p.asked.length === 0, `${p.asked.length} fetches`);
    await p.seedOk();
    ok('the seed applied, still nothing before a frame is drawn — not even the idle wait',
       p.asked.length === 0 && p.idles.length === 0 && p.timers.length === 0, `${p.asked.length} fetches, ${p.idles.length} idle waits`);
    await p.frame();
    ok('nor after one frame', p.asked.length === 0 && p.idles.length === 0 && p.timers.length === 0, `${p.asked.length} fetches, ${p.idles.length} idle waits`);
    await p.frame();
    ok('nor after two, until the browser is idle', p.asked.length === 0 && p.idles.length === 1, `${p.asked.length} fetches, ${p.idles.length} idle callback`);
    ok('the idle wait has a deadline, so a busy page still gets its figures', p.idles[0] && p.idles[0].o && p.idles[0].o.timeout === 3000,
       JSON.stringify(p.idles[0] && p.idles[0].o));
    await p.idle();
    ok('once idle, the first unit is asked for — and only one', p.asked.length === 1 && p.inflight === 1, p.asked.join(', '));

    head('one unit at a time, every unit once');
    const order = [];
    for (let i = 0; i < 4; i++) {
      const before = p.asked.length;
      order.push(await p.land());
      if (i < 3) ok(`unit ${i + 1} landed, and only then is unit ${i + 2} asked for`, p.asked.length === before + 1 && p.inflight === 1,
                   `${p.asked.length} asked, ${p.inflight} in flight`);
    }
    ok('all four were fetched, each once', JSON.stringify([...p.asked].sort()) === JSON.stringify(UNITS), p.asked.join(', '));
    ok('every unit\'s figures are merged in, none replacing another', Object.keys(p.REF_IMGS).length === 4, Object.keys(p.REF_IMGS).join(', '));
    ok('and the page is offered a repaint as each one lands', p.paints === 4, `${p.paints} repaints`);
    ok('with no pearl showing, the build\'s own order', JSON.stringify(order) === JSON.stringify(UNITS), order.join(', '));
  }

  head('what is on screen fills in first');
  {
    const p = page({ pearl: { figKey: 'valv/083_FIG_12.jpg' } });
    await p.seedOk(); await p.frame(); await p.frame(); await p.idle();
    ok('the unit holding the pearl\'s figure is fetched first', p.asked[0] === 'content/refs-images/valv.json', p.asked[0]);
    await p.land(); await p.land(); await p.land(); await p.land();
    ok('and the rest still follow, each once', JSON.stringify([...p.asked].sort()) === JSON.stringify(UNITS), p.asked.join(', '));
  }

  head('a unit split across files fills in first as a whole');
  {
    /* build-pwa continues a unit too big for one file in unit.2.json, …
       (splitRefImages). "hf-x" is a different unit whose name merely starts
       with "hf": it must not be taken for a continuation. */
    const units = ['arrhythmias', 'hf', 'hf-x', 'hf.2', 'valv'].map(u => `content/refs-images/${u}.json`);
    const p = page({ pearl: { figKey: 'hf/049_FIG.jpg' }, units });
    await p.seedOk(); await p.frame(); await p.frame(); await p.idle();
    for (let i = 0; i < units.length; i++) await p.land();
    ok('every file of the pearl\'s unit is fetched before any other unit',
       p.asked.slice(0, 2).join(',') === 'content/refs-images/hf.json,content/refs-images/hf.2.json', p.asked.join(', '));
    ok('a unit that only shares the prefix is not one of them, and everything is still fetched once',
       p.asked.indexOf('content/refs-images/hf-x.json') > 1 && JSON.stringify([...p.asked].sort()) === JSON.stringify([...units].sort()), p.asked.join(', '));
  }

  head('a failure costs only itself');
  {
    const p = page({ failing: ['content/refs-images/hf.json'] });
    await p.seedOk(); await p.frame(); await p.frame(); await p.idle();
    for (let i = 0; i < 4; i++) await p.land();
    ok('a unit that fails does not stop the next', p.asked.length === 4, p.asked.join(', '));
    ok('the others\' figures still arrive, and only they repaint', Object.keys(p.REF_IMGS).length === 3 && p.paints === 3,
       `${Object.keys(p.REF_IMGS).length} units, ${p.paints} repaints`);
  }
  {
    const p = page();
    await p.seedFails(); await p.frame(); await p.frame(); await p.idle();
    ok('a seed that failed does not strand the figures', p.asked.length === 1, `${p.asked.length} fetches`);
  }
  {
    const p = page({ seed: 'absent' });
    await settle(); await p.frame(); await p.frame(); await p.idle();
    ok('nor does a build with no seed promise at all', p.asked.length === 1, `${p.asked.length} fetches`);
  }

  head('Safari, which has no requestIdleCallback');
  {
    const p = page({ idleApi: false });
    await p.seedOk(); await p.frame(); await p.frame();
    ok('a timer stands in for the idle callback, and nothing is fetched before it fires',
       p.asked.length === 0 && p.timers.length === 1 && p.timers[0].ms === 1000, `${p.asked.length} fetches, timers ${JSON.stringify(p.timers.map(t => t.ms))}`);
    await p.idle();
    ok('and when it fires, the figures start', p.asked.length === 1, `${p.asked.length} fetches`);
  }

  head('build-pwa: the seed settles on every path, and the loader is what ships');
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-pwa.js'), 'utf8');
  const from = SRC.indexOf('var REF_SEED_READY = (function(){');
  const seedCode = from > -1 ? SRC.slice(from, SRC.indexOf('})();', from) + 5) : '';
  const runSeed = async ({ ref = true, fetchFails = false }) => {
    if (!seedCode) return 'seed loader not found';
    const fetch = () => fetchFails ? Promise.reject(new Error('offline')) : Promise.resolve({ json: () => Promise.resolve([]) });
    const ready = new Function('REF', 'refSeedApply', 'fetch', 'invalidateIndex', 'refLatePaint', seedCode + '\nreturn REF_SEED_READY;')(
      ref ? [] : undefined, ref ? (r => r) : undefined, fetch, () => {}, () => {});
    let state = 'pending';
    if (ready && typeof ready.then === 'function') ready.then(() => { state = 'resolved'; }, () => { state = 'rejected'; });
    else return 'not a promise';
    await settle();
    return state;
  };
  const okSeed = await runSeed({}), badSeed = await runSeed({ fetchFails: true }), noLib = await runSeed({ ref: false });
  ok('REF_SEED_READY resolves when the seed is applied', okSeed === 'resolved', okSeed);
  ok('and when the seed fails to arrive — resolved, not rejected, not left pending', badSeed === 'resolved', badSeed);
  ok('and when there is no library to seed', noLib === 'resolved', noLib);
  const blank = blankComments(SRC);
  ok('build-pwa appends scripts/ref-images-loader.js, with the unit list in place of __PARTS__',
     /appCode \+= require\('\.\/ref-images-loader\.js'\)\.REF_IMG_LOADER\.replace\('__PARTS__', \(\) => JSON\.stringify\(urls\)\);/.test(blank));
  ok('and nothing fetches the units the old way, all at once as app.js runs', !/parts\.forEach\(function\(u\)\{\s*fetch\(u\)/.test(blank));

  await settle();
  ok('and nothing the loader or the seed started was left rejected with no handler', unhandled.length === 0, unhandled.join('; ') || 'none');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log('  FAIL  the suite threw  → ' + e.message); console.log(`\n${passed} passed, ${failed + 1} failed`); process.exit(1); });
