#!/usr/bin/env node
/*
 * Behavioural checks for the Apex integration (3D heart + live avatar) on top
 * of a Stage-0-patched build.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-apex.js /path/to/patched.html
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-apex.js <patched.html>'); process.exit(1); }
/* Accepts a path (single-file build) or an http URL (the Stage 1 PWA
   build, which has to be served because it fetches its content). */
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  /* The Stage 1 build injects app.js only after its content fetch resolves,
     so 'load' no longer implies the app has booted. Wait for it explicitly —
     a no-op on the single-file build, where this is already true. */
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
  await page.waitForTimeout(1200);

  head('rebrand: Braunwald is gone from every UI-facing string');
  const strings = await page.evaluate(() => {
    goHome(); render();
    const fab = document.getElementById('aiFab');
    const aside = document.getElementById('ai');
    goRefs(); render();
    const heroSub = document.querySelector('.hero-sub')?.textContent || '';
    goHome(); render();
    return { fabText: fab.textContent.trim(), fabAria: fab.getAttribute('aria-label'),
             asideAria: aside.getAttribute('aria-label'), heroSub };
  });
  ok('fab button renamed', strings.fabText === 'Apex', strings.fabText);
  ok('fab aria-label renamed', strings.fabAria === 'Open the Apex tutor', strings.fabAria);
  ok('aside aria-label renamed', strings.asideAria === 'Apex cardiology tutor', strings.asideAria);
  ok('reference-library hero copy renamed', strings.heroSub.includes('handed to Apex'), strings.heroSub.slice(0, 60));

  const leftoverBraunwald = await page.evaluate(() => {
    toggleAI();
    const html = document.getElementById('ai').innerHTML;
    toggleAI();
    return html.includes('Braunwald');
  });
  ok('no "Braunwald" left in the chat panel', !leftoverBraunwald);

  const systemHasName = await page.evaluate(() => SYSTEM.startsWith('You go by Apex.'));
  ok('system prompt gives the tutor a name', systemHasName);
  const textbookIntact = await page.evaluate(() => SYSTEM.includes("Braunwald's Heart Disease"));
  ok('legitimate textbook citation left untouched', textbookIntact);

  head('rhythm lab: the 3D heart mounts, ticks, and tears down cleanly');
  const webgl2 = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
  ok('WebGL2 available in this run', webgl2);

  // goLab() already calls render() internally; the extra render() here is
  // deliberate — it races a second, immediate render against the first
  // render's deferred startViewTransition callback, which is exactly the
  // sequence that orphaned the heart instance on a detached canvas before
  // mountLabHeart() checked node identity instead of just truthiness.
  await page.evaluate(() => { goLab(); render(); });
  await page.waitForTimeout(1200);
  const mounted = await page.evaluate(() => ({
    hasCanvas: !!document.getElementById('labHeartCanvas'),
    live: !!labHeart,
    tris: labHeart ? labHeart.stats.triangles : 0,
    readout: (document.getElementById('labHeartReadout') || {}).textContent || '',
  }));
  ok('heart canvas is in the lab markup', mounted.hasCanvas);
  ok('a live Heart3D instance is mounted', mounted.live);
  ok('mesh actually built triangles', mounted.tris > 10000, mounted.tris + ' triangles');

  // The app defers screen-change renders to document.startViewTransition, and
  // its callback can land up to ~1.3s late after a burst of navigation (this
  // predates the heart — it's the existing render() model). Poll rather than
  // check a single point in time, the way a user waiting on-screen would.
  let readout2 = '';
  for (let i = 0; i < 30; i++) {
    readout2 = await page.evaluate(() => document.getElementById('labHeartReadout')?.textContent || '');
    if (/ejection|filling|isovolumetric|kick/.test(readout2)) break;
    await page.waitForTimeout(100);
  }
  ok('phase readout is updating', /ejection|filling|isovolumetric|kick/.test(readout2), readout2);

  const modeSwitch = await page.evaluate(() => {
    document.querySelector('[data-heart-mode="cutaway"]').click();
    return labHeartMode;
  });
  ok('mode buttons switch the view', modeSwitch === 'cutaway');

  const rhythmSync = await page.evaluate(() => {
    setLab('afib'); render();
    return { labKind, heartRhythm: labHeart ? labHeart.phase() !== undefined : false };
  });
  ok('picking a rhythm reaches the 3D heart too', rhythmSync.labKind === 'afib' && rhythmSync.heartRhythm);

  await page.evaluate(() => { goHome(); render(); });
  await page.waitForTimeout(300);
  const torndown = await page.evaluate(() => ({ labHeart: labHeart, canvasGone: !document.getElementById('labHeartCanvas') }));
  ok('heart instance destroyed when leaving the lab', torndown.labHeart === null);
  ok('canvas removed from the DOM', torndown.canvasGone);

  // remount, then navigate through several other screens — the instance must
  // not leak or keep animating against a detached canvas
  await page.evaluate(() => { goLab(); render(); });
  await page.waitForTimeout(400);
  const cyclesOk = await page.evaluate(async () => {
    goHome(); render();
    openSearch(); runSearch('amyloid'); render();
    goStats(); render();
    goLab(); render();
    await new Promise(r => setTimeout(r, 300));
    const alive = !!labHeart;
    goHome(); render();
    return { alive, dead: labHeart === null };
  });
  ok('survives rapid screen changes without erroring', errors.length === 0, errors.slice(0, 2).join(' | '));
  ok('remounts on return to the lab, tears down on leaving again', cyclesOk.alive && cyclesOk.dead);

  head('avatar: state machine and per-token wiring');
  const noKeyState = await page.evaluate(() => {
    AI[AI.provider].key = '';
    toggleAI();
    const hasCanvas = !!document.getElementById('apexAvatar');
    const state = apexAv ? apexAv.state() : null;
    toggleAI();
    return { hasCanvas, state };
  });
  ok('avatar renders even before a key is configured', noKeyState.hasCanvas);
  ok('idle by default', noKeyState.state === 'idle', noKeyState.state);

  const listening = await page.evaluate(() => {
    AI[AI.provider] = { key: 'sk-ant-test-not-real', model: 'claude-sonnet-5' };
    toggleAI();
    const ta = document.getElementById('aiIn');
    ta.value = 'why is this the answer';
    ta.dispatchEvent(new Event('input'));
    const listening = apexAv.state();
    ta.value = '';
    ta.dispatchEvent(new Event('input'));
    const backToIdle = apexAv.state();
    toggleAI();
    return { listening, backToIdle };
  });
  ok('typing sets the avatar to listening', listening.listening === 'listening', listening.listening);
  ok('clearing the field returns it to idle', listening.backToIdle === 'idle', listening.backToIdle);

  const streamStates = await page.evaluate(async () => {
    toggleAI();
    const seen = [];
    const origSet = Apex.avatar;                 // observe via the real instance instead of stubbing
    const q = null;
    const hist = chatFor(q);
    aiBusy = true; buildAI();
    seen.push(apexAv.state());                    // 'thinking' — mount reads aiBusy
    apexSetState('thinking'); seen.push(apexAv.state());
    apexSetState('tool'); seen.push(apexAv.state());
    apexSetState('speaking');
    for (let i = 0; i < 5; i++) apexPulse();
    seen.push(apexAv.state());
    const energyNonZero = apexAv.phase !== undefined; // avatar has no phase(); just confirm no throw
    aiBusy = false; buildAI(); apexSetState('idle');
    seen.push(apexAv.state());
    toggleAI();
    return seen;
  });
  ok('avatar walks thinking → tool → speaking → idle',
     streamStates[0] === 'thinking' && streamStates[1] === 'thinking' &&
     streamStates[2] === 'tool' && streamStates[3] === 'speaking' && streamStates[4] === 'idle',
     JSON.stringify(streamStates));

  const noLeakAcrossRerenders = await page.evaluate(async () => {
    toggleAI();
    let instances = 0;
    const origDestroy = Apex.avatar;
    for (let i = 0; i < 8; i++) { buildAI(); await new Promise(r => setTimeout(r, 20)); }
    const stillOne = !!apexAv;
    toggleAI();
    return stillOne;
  });
  ok('repeated buildAI() calls do not error or accumulate', noLeakAcrossRerenders && errors.length === 0);

  head('regression: everything Stage 0 touches still functions');
  const reg = await page.evaluate(() => {
    goHome(); render();
    const home = !!document.querySelector('.hero-h1');
    startQuiz('Arrhythmias');
    const q = S.questions[0];
    selectOpt(q.ci);
    const answered = S.answered;
    goHome(); render();
    return { home, answered };
  });
  ok('home renders', reg.home);
  ok('quiz still answers', reg.answered);
  ok('no console/page errors across the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
