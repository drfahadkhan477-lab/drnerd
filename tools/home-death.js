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

  try {
    await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
    say('loaded');
    const { booted } = require('../tests/_render.js');
    await booted(page, { timeout: 150000 });
    say('booted');
    if (!await alive('boot')) throw new Error('dead on arrival');

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
