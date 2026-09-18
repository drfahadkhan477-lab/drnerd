#!/usr/bin/env node
/*
 * Which viewport change kills WebKit, isolated one at a time.
 *
 *   $env:SYSTOLE_ENGINE="webkit"
 *   node tools\resize-crash.js http://localhost:8080
 *
 * WHAT IS ALREADY KNOWN, from tools/home-death.js against the served split
 * build on WebKit:
 *
 *   · the suite's whole prelude survives — a full reload, three measured
 *     viewport changes at 1366×1024, 1194×834 and 1024×1366, a jump into a
 *     question and back, and the first-run hint gates
 *   · and then the first resize of the sweep, to 390×844, crashes the page in
 *     TWENTY MILLISECONDS, with `crash event: true` and nothing logged
 *   · yet a probe that did ONLY that sweep survived six full cycles of it
 *
 * So it is not the sweep and it is not the prelude; it is something the
 * prelude leaves behind that the next resize then trips over. The obvious
 * candidate is the size itself — every prelude step puts the page at a LARGE
 * viewport, and the sweep's first move is to a small one — but "obvious" is
 * what the last three hypotheses were.
 *
 * SO THIS CHANGES ONE THING AT A TIME. Each case gets its own browser, its own
 * page and its own boot, does exactly one thing, then resizes to 390×844 and
 * asks whether the page is still there. A case that crashes and a case beside
 * it that does not is the difference that matters; anything both cases do is
 * ruled out rather than argued about.
 *
 * Reports a table. Asserts nothing — it is a tool, like tools/boot-probe.js.
 */
'use strict';
const path = require('path');
const { launch, engineName } = require('../tests/_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tools/resize-crash.js <url-or-path>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);
const SMALL = { width: 390, height: 844 };

/* Playwright's wording for a target that no longer exists. Anything else is a
   bug in this file and is reported as one — see tools/home-death.js. */
const GONE = /Target (crashed|closed)|Target page, context or browser has been closed|Browser has been closed/i;

const resize = async (page, w, h) => { await page.setViewportSize({ width: w, height: h }); };
const rebuild = page => page.evaluate(async () => {
  if (typeof goHome === 'function') { goHome(); render(); }
  await new Promise(r => setTimeout(r, 250));
});

/* Each case: what it does BEFORE the resize that is under suspicion. */
const CASES = [
  ['nothing at all', async () => {}],
  ['one resize to 1366×1024', async p => { await resize(p, 1366, 1024); }],
  ['1366×1024 and a rebuild', async p => { await resize(p, 1366, 1024); await rebuild(p); }],
  ['1194×834 and a rebuild', async p => { await resize(p, 1194, 834); await rebuild(p); }],
  ['1024×1366 and a rebuild', async p => { await resize(p, 1024, 1366); await rebuild(p); }],
  ['a rebuild at the boot size', async p => { await rebuild(p); }],
  ['a full page reload', async p => {
    await p.reload({ waitUntil: 'load', timeout: 200000 });
    await p.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.home-wrap'),
      null, { timeout: 60000 }).catch(() => {});
  }],
  ['a jump into a question and back', async p => {
    await p.evaluate(() => {
      if (typeof ALL_Q === 'undefined' || typeof jumpTo !== 'function') return;
      const q = ALL_Q.find(x => !x.bad); if (q) { jumpTo(q.id); render(); }
    });
    await p.waitForTimeout(300);
    await p.evaluate(() => { if (typeof goHome === 'function') { goHome(); render(); } });
    await p.waitForTimeout(250);
  }],
  ['the whole prelude', async p => {
    await resize(p, 1366, 1024); await rebuild(p);
    await resize(p, 1194, 834); await rebuild(p);
    await resize(p, 1024, 1366); await rebuild(p);
  }],
];

(async () => {
  console.log(`engine ${engineName()}   target ${URL}`);
  console.log('each case is a fresh browser; the resize under test is always → 390×844\n');
  const rows = [];
  for (const dpr of [2, 1]) {
    for (const [name, before] of CASES) {
      const browser = await launch();
      let crashed = false, verdict = '?', note = '';
      try {
        const page = await browser.newPage({ viewport: { width: 460, height: 1000 }, deviceScaleFactor: dpr });
        page.on('crash', () => { crashed = true; });
        await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
        const { booted } = require('../tests/_render.js');
        await booted(page, { timeout: 150000 });
        await before(page);
        /* The move under suspicion. */
        await resize(page, SMALL.width, SMALL.height);
        await page.evaluate(() => document.getElementsByTagName('*').length);
        verdict = 'survived';
      } catch (e) {
        const msg = String(e.message).split('\n')[0];
        verdict = GONE.test(msg) ? (crashed ? 'CRASHED' : 'page gone') : 'probe error';
        note = msg.slice(0, 70);
      }
      try { await browser.close(); } catch (_) {}
      rows.push({ dpr, name, verdict, note });
      console.log(`  dpr ${dpr}  ${verdict.padEnd(11)} after ${name}${note ? '  — ' + note : ''}`);
    }
    console.log('');
  }
  const died = rows.filter(r => r.verdict === 'CRASHED' || r.verdict === 'page gone');
  console.log(`${died.length} of ${rows.length} cases lost the page.`);
  if (died.length && died.length < rows.length) {
    console.log('the smallest thing that killed it:');
    for (const r of died) console.log(`   dpr ${r.dpr}  ${r.name}`);
  }
  process.exit(0);
})();
