#!/usr/bin/env node
/*
 * Where the home suite's page dies, and what the browser said about it.
 *
 *   $env:SYSTOLE_ENGINE="webkit"
 *   node tools\home-death.js http://localhost:8080
 *
 * A TOOL, NOT A SUITE. It asserts nothing and is registered nowhere. It exists
 * because verify-home.js dies with
 *
 *     page.setViewportSize: Target page, context or browser has been closed
 *
 * after 51 checks, and that message is about the FIRST call made to a page
 * that was already gone — it names the survivor, not the cause. Everything the
 * page itself said on the way out is collected into verify-home's `errors[]`
 * and reported by its LAST check, which a death never reaches. So the one
 * source of evidence is discarded precisely when it is needed.
 *
 * This replays the narrowest slice of the suite that contains the death — the
 * viewport sweep at verify-home.js:472, three sizes, goHome() and render()
 * between each — and prints, per step:
 *
 *   - whether the page is still answering, checked immediately after the step
 *     rather than at the next one, so the failing step is named and not the one
 *     after it
 *   - console errors, page errors and failed requests, as they arrive
 *   - live <canvas> and running-animation counts, because the suspicion is
 *     something accumulating across render() calls
 *
 * IT PRINTS NO PAGE TEXT. Counts, sizes and the browser's own diagnostics
 * only — nothing from the bank.
 */
'use strict';
const path = require('path');
const { launch, engineName, isEngineNoise } = require('../tests/_engine');

const target = process.argv[2];
if (!target) {
  console.error('usage: node tools/home-death.js <url-or-path> [cycles]');
  process.exit(1);
}
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);
const CYCLES = Math.max(1, parseInt(process.argv[3], 10) || 6);
const SIZES = [[390, 844, 'phone'], [834, 1112, 'iPad portrait'], [1194, 834, 'iPad landscape']];

const stamp = () => String(Math.round(process.uptime() * 1000)).padStart(6) + 'ms';
const say = (...a) => console.log(stamp(), ...a);

(async () => {
  say(`engine ${engineName()}  target ${URL}`);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 460, height: 1000 }, deviceScaleFactor: 2 });

  let crashed = false, closed = false;
  const noted = [];
  const note = (kind, text) => {
    if (isEngineNoise(text)) return;
    noted.push(`${kind}: ${text}`);
    say(`  ${kind}  ${text.slice(0, 200)}`);
  };
  page.on('crash', () => { crashed = true; say('  *** CRASH  the browser killed the page'); });
  page.on('close', () => { closed = true; say('  *** CLOSE  the page object went away'); });
  page.on('pageerror', e => note('pageerror', e.message));
  page.on('console', m => { if (m.type() === 'error') note('console', m.text()); });
  page.on('requestfailed', r => note('requestfailed', `${r.url().slice(-70)} — ${(r.failure() || {}).errorText}`));

  /* THE ONLY WAY A PAGE IS GONE, spelled out rather than inferred from "the
     evaluate threw". Those are not the same thing: a typo in the snippet
     below, or a page-side exception, also throws — and a probe that reports
     DEAD when what it actually hit was its own bug is this project's oldest
     failure mode in a new hat. It would report hardest when nothing was wrong.

     This is Playwright's wording for a target that no longer exists; anything
     else is printed as a probe error and the loop carries on, so a broken
     probe looks broken instead of looking like a finding. */
  const GONE = /Target (crashed|closed)|Target page, context or browser has been closed|Browser has been closed/i;

  /* Answers, or says why it cannot. Called after every step so the step that
     killed the page is the one reported. */
  const alive = async where => {
    try {
      const s = await page.evaluate(() => {
        const app = document.getElementById('app');
        return {
          canvases: document.querySelectorAll('canvas').length,
          imgs: document.querySelectorAll('img').length,
          anims: document.getAnimations ? document.getAnimations().length : -1,
          nodes: document.getElementsByTagName('*').length,
          screen: (app && app.dataset && app.dataset.screen) || '?',
        };
      });
      say(`  ok ${where}  canvas ${s.canvases}  img ${s.imgs}  anim ${s.anims}  nodes ${s.nodes}  screen ${s.screen}`);
      return true;
    } catch (e) {
      const msg = String(e.message).split('\n')[0];
      if (!GONE.test(msg)) { say(`  probe error at ${where} — the PAGE is fine: ${msg}`); return true; }
      say(`  DEAD at ${where}  ${msg}`);
      return false;
    }
  };

  /* What the suite's at() does: resize, wait for the page to agree about its
     own size, rebuild, let it settle. */
  const at = async (w, h) => {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForFunction(([w2, h2]) =>
      Math.abs(innerWidth - w2) <= 2 && Math.abs(innerHeight - h2) <= 2, [w, h], { timeout: 8000 })
      .catch(() => {});
    await page.evaluate(() => { if (typeof goHome === 'function') { goHome(); render(); } });
    await page.waitForTimeout(350);
  };

  /* Declared above the list that uses it. The closures would not have minded —
     they run later — but a const below its call site is the shape that has cost
     this project a whole debugging session before. */
  /* THE SUITE'S OWN SEQUENCE, in order, named. The first version of this probe
     replayed only the viewport sweep the suite dies in, and the page survived
     six cycles of it — which proved the sweep innocent and nothing else. The
     death needs what the first 51 checks do first, and the expensive things
     among those are a full page.reload() at verify-home.js:312, three
     measured viewport changes at :356, and a jump into a question at :400.

     Kept as a list so the step that kills the page is named rather than
     inferred, and so a step can be commented out to bisect without editing
     control flow. */
  const steps = [
    ['reload the whole app (verify-home.js:312)', async () => {
      await page.reload({ waitUntil: 'load', timeout: 250000 });
      /* The suite allows 150s here because the single file can take that long
         to parse. A probe that waits that long on a page which is never going
         to answer reads as a hang, so this gives up in 60 and says so — the
         step is then reported as threw, not as a death, and the run carries
         on to the ones that matter. */
      await page.waitForFunction(
        () => typeof S !== 'undefined' && !!document.querySelector('.home-wrap'),
        null, { timeout: 60000 });
    }],
    ['measure at 1366x1024 (:356)', () => at(1366, 1024)],
    ['measure at 1194x834 (:356)', () => at(1194, 834)],
    ['measure at 1024x1366 (:356)', () => at(1024, 1366)],
    ['jump into a question at 1366x1024 (:400)', async () => {
      await page.setViewportSize({ width: 1366, height: 1024 });
      await page.evaluate(() => {
        if (typeof ALL_Q === 'undefined' || typeof jumpTo !== 'function') return;
        const q = ALL_Q.find(x => !x.bad);
        if (q) { jumpTo(q.id); render(); }
      });
      await page.waitForTimeout(400);
    }],
    ['back home (:405)', () => page.evaluate(() => {
      if (typeof goHome === 'function') { goHome(); render(); }
    })],
    ['the hint gates (:440)', () => page.evaluate(async () => {
      for (const v of ['1', null]) {
        try { v === null ? localStorage.removeItem('accsap12.welcomed')
                         : localStorage.setItem('accsap12.welcomed', v); } catch (_) {}
        if (typeof goHome === 'function') { goHome(); render(); }
        await new Promise(r => setTimeout(r, 150));
      }
    })],
  ];

  try {
    await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
    say('loaded');
    const { booted } = require('../tests/_render.js');
    await booted(page, { timeout: 150000 });
    say('booted');
    if (!await alive('boot')) throw new Error('dead on arrival');

    for (const [label, run] of steps) {
      say(label);
      try { await run(); }
      catch (e) {
        const msg = String(e.message).split('\n')[0];
        say(`  ${GONE.test(msg) ? 'DEAD' : 'threw'} during "${label}"  ${msg}`);
        if (GONE.test(msg)) throw e;
      }
      if (!await alive(label)) throw new Error('died at: ' + label);
    }

    say('--- the suite\'s prelude survived; now the sweep it dies in ---');
    outer:
    for (let c = 1; c <= CYCLES; c++) {
      for (const [w, h, label] of SIZES) {
        say(`cycle ${c}  ${label} ${w}x${h}`);
        try { await page.setViewportSize({ width: w, height: h }); }
        catch (e) {
          const msg = String(e.message).split('\n')[0];
          say(`  ${GONE.test(msg) ? 'DEAD' : 'threw'} at setViewportSize  ${msg}`);
          break outer;
        }
        if (!await alive('setViewportSize')) break outer;

        try {
          await page.evaluate(async () => {
            try { localStorage.removeItem('accsap12.welcomed'); } catch (_) {}
            if (typeof S !== 'undefined') S.srs = {};
            if (typeof LOG !== 'undefined') LOG.length = 0;
            if (typeof goHome === 'function') goHome();
            if (typeof render === 'function') render();
            await new Promise(res => setTimeout(res, 280));
          });
        } catch (e) {
          const msg = String(e.message).split('\n')[0];
          say(`  ${GONE.test(msg) ? 'DEAD' : 'threw'} at goHome/render  ${msg}`);
          break outer;
        }
        if (!await alive('render')) break outer;
      }
    }
  } catch (e) {
    say('threw:', String(e.message).split('\n')[0]);
  }

  say(`crash event: ${crashed}   close event: ${closed}   diagnostics collected: ${noted.length}`);
  for (const n of noted.slice(0, 40)) console.log('   ', n.slice(0, 220));
  try { await browser.close(); } catch (_) {}
  process.exit(0);
})();
