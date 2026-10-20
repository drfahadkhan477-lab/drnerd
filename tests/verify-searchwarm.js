#!/usr/bin/env node
/*
 * The search index is built while the search screen opens, in slices, and not under the first letter typed.
 *
 *   node tests/verify-searchwarm.js build/synthetic/systole.html
 *
 * The first search used to build the whole index in the one call it made, which on a library the size of the real one is
 * about a second of a frozen screen (and an iPad takes longer). openSearch() now has warmIndex() build it in slices of a few
 * milliseconds, and a search that arrives first finishes what is left. tests/verify-indexwarm-pure.js holds the slicing
 * itself, on the page's own code and a clock it controls; this holds it in the page, with its own scheduling:
 *   · the index is not built at boot, which is what makes the rest worth saying;
 *   · opening the search screen builds it with no query asked, and in many slices, not in one;
 *   · a query typed before it is done gets the answers a fresh whole build gives;
 *   · a note written while it is being built is not lost to it;
 *   · nothing throws, and nothing is left running.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, onScreen, quiet } = require('./_render.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-searchwarm.js <build.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

(async () => {
  const browser = await launch();
  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));
  const page = watch(await browser.newPage({ viewport: { width: 1194, height: 834 } }), events, 'main');
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);
  await quiet(page);

  head('at boot');
  const boot = await page.evaluate(() => ({ built: IDX !== null, job: IDXJOB !== null }));
  ok('the index is not built at boot: it is built when the search screen is opened, and not for a reader who never searches', boot.built === false && boot.job === false, JSON.stringify(boot));

  /* A library big enough that building it takes many slices, whatever the machine: the invented notes are real text to the
     index, a couple of hundred words each. How far the job has got is watched from a timer of the suite's own, and the
     places it was seen at are the slices there were: a build in one piece is seen at one place. */
  const library = await page.evaluate(() => {
    const VOC = Array.from({ length: 400 }, (_, i) => 'warmword' + i);
    let s = 12345; const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 600; i++) REF.push({ id: 'warm' + i, title: 'Warm-up note ' + i, tags: '', body: Array.from({ length: 220 }, () => VOC[Math.floor(r() * VOC.length)]).join(' ') });
    invalidateIndex();
    window.__seen = new Set(); window.__watch = true;
    (function look() { if (IDXJOB) window.__seen.add(IDXJOB.i); if (window.__watch) setTimeout(look, 0); })();
    return { docs: ALL_Q.length + REF.length };
  });

  head('opening the search screen');
  await page.evaluate(() => openSearch());
  await onScreen(page, 'search', { marker: '#sQ' });
  const built = await (async () => {
    const end = Date.now() + 15000;
    for (;;) { const r = await page.evaluate(() => ({ built: IDX !== null, slices: window.__seen.size, docs: IDX ? IDX.docs.length : 0 })); if (r.built || Date.now() > end) return r; await page.waitForTimeout(50); }
  })();
  ok('the index is built with no query asked', built.built === true && built.docs === library.docs, `${built.docs} of ${library.docs} documents`);
  ok('and it was built in many slices, not in one', built.slices >= 5, `${built.slices} places the job was seen at`);
  await page.evaluate(() => { window.__watch = false; });

  head('a query that comes first');
  {
    const r = await page.evaluate(() => {
      invalidateIndex();
      openSearch();
      const during = { built: IDX !== null, job: IDXJOB !== null };
      const fromJob = JSON.stringify(search('warmword7 warmword8 aortic', { limit: 40 }));
      const finished = { built: IDX !== null, job: IDXJOB === null };
      invalidateIndex();
      const whole = JSON.stringify(search('warmword7 warmword8 aortic', { limit: 40 }));
      return { during, finished, same: fromJob === whole, found: JSON.parse(whole).length };
    });
    ok('opened and not yet built, the screen has a job under way and no index', r.during.built === false && r.during.job === true, JSON.stringify(r.during));
    ok('a search at that moment gets the answers a whole fresh build gives, from the same job, and leaves the index built', r.same && r.found > 0 && r.finished.built && r.finished.job, `${r.found} hits; same ${r.same}`);
    await page.waitForTimeout(300);
    const left = await page.evaluate(() => ({ built: IDX !== null, job: IDXJOB !== null }));
    ok('the slice that was waiting does nothing to the index the search built', left.built === true && left.job === false, JSON.stringify(left));
  }

  head('a note written while it is built');
  {
    const r = await page.evaluate(async () => {
      invalidateIndex(); openSearch();
      await new Promise(res => setTimeout(res, 20));
      const mid = { done: IDXJOB ? IDXJOB.i : -1, of: ALL_Q.length + REF.length, built: IDX !== null };
      refAdd('A note written mid-build', 'zzwarmmarker is the only place this word is written', '', '');
      const dead = { built: IDX !== null, job: IDXJOB !== null };
      await new Promise(res => setTimeout(res, 400));
      const after = { built: IDX !== null, job: IDXJOB !== null };
      const hits = search('zzwarmmarker', { limit: 5 });
      return { mid, dead, after, top: hits.length ? hits[0].meta.title : null };
    });
    ok('the note is written with the build part done and not finished, or this section measures nothing', r.mid.done > 0 && r.mid.done < r.mid.of && r.mid.built === false, `${r.mid.done} of ${r.mid.of} documents were in`);
    ok('adding a note mid-build drops the job, and the slice that was waiting builds nothing from it', r.dead.built === false && r.dead.job === false && r.after.built === false && r.after.job === false, JSON.stringify([r.dead, r.after]));
    ok('and the next search builds from the library as it is, so the note is found', r.top === 'A note written mid-build', String(r.top));
  }

  head('nothing throws');
  ok('no page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
