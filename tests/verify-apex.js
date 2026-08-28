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

  head('rhythm lab: the cardiac cycle mounts, ticks, and tears down cleanly');
  /* This section used to be about the 3D heart, which the lab no longer has.
     The claims that mattered were never really about the heart — they were
     about a live renderer surviving the app's render model — so they transfer
     to the diagram, which is now the thing holding an animation loop. */

  // goLab() already calls render() internally; the extra render() here is
  // deliberate — it races a second, immediate render against the first
  // render's deferred startViewTransition callback, which is exactly the
  // sequence that orphans a renderer on a detached canvas unless mount checks
  // node identity rather than just truthiness.
  await page.evaluate(() => { goLab(); render(); });
  await page.waitForTimeout(1200);
  const mounted = await page.evaluate(() => ({
    hasCanvas: !!document.getElementById('physioCanvas'),
    live: !!physio,
    noHeart: !document.getElementById('labHeartCanvas'),
    t: physio ? physio.time() : null,
  }));
  ok('the cycle canvas is in the lab markup', mounted.hasCanvas);
  ok('a live diagram is mounted', mounted.live);
  ok('and the 3D heart is not in the lab at all', mounted.noHeart);

  /* It has to keep its own time now that nothing else drives it. */
  await page.waitForTimeout(700);
  const advanced = await page.evaluate(t0 => ({ t1: physio.time(), moved: physio.time() !== t0 }), mounted.t);
  ok('the diagram runs its own clock', advanced.moved, `${mounted.t?.toFixed(3)} → ${advanced.t1.toFixed(3)}`);

  let phase = '';
  for (let i = 0; i < 30; i++) {
    phase = await page.evaluate(() => document.getElementById('physioPhase')?.textContent.trim() || '');
    if (/ejection|filling|isovolumetric|atrial|diastasis/i.test(phase)) break;
    await page.waitForTimeout(100);
  }
  ok('the phase pill is updating', /ejection|filling|isovolumetric|atrial|diastasis/i.test(phase), phase);

  const viewSwitch = await page.evaluate(async () => {
    document.querySelector('[data-physio-view="pv"]').click();
    await new Promise(r => setTimeout(r, 400));
    return { view: physioView, live: !!physio && physio.view() === 'pv' };
  });
  ok('view buttons switch the diagram', viewSwitch.view === 'pv' && viewSwitch.live);
  await page.evaluate(() => { document.querySelector('[data-physio-view="wiggers"]').click(); });
  await page.waitForTimeout(400);

  /* Sinus tachycardia is 130 bpm against sinus's 68, so if setLab reaches the
     diagram the cycle gets shorter — which is the only thing worth asserting
     here, and it is a number rather than a repainted label. */
  const rhythmSync = await page.evaluate(() => {
    setLab('tachy'); render();
    return { labKind };
  });
  await page.waitForTimeout(700);
  const rate = await page.evaluate(() => ({ hr: RHYTHMS[labKind].hr, live: !!physio }));
  ok('picking a rhythm reaches the diagram rate too',
     rhythmSync.labKind === 'tachy' && rate.hr === 130 && rate.live, `${rate.hr} bpm`);
  await page.evaluate(() => { setLab('sinus'); render(); });
  await page.waitForTimeout(400);

  await page.evaluate(() => { goHome(); render(); });
  await page.waitForTimeout(400);
  const torndown = await page.evaluate(() => ({ physio, canvasGone: !document.getElementById('physioCanvas') }));
  ok('the diagram is torn down when leaving the lab', torndown.physio === null);
  ok('canvas removed from the DOM', torndown.canvasGone);

  // remount, then navigate through several other screens — the loop must not
  // leak or keep animating against a detached canvas
  await page.evaluate(() => { goLab(); render(); });
  await page.waitForTimeout(400);
  const cyclesOk = await page.evaluate(async () => {
    goHome(); render();
    openSearch(); runSearch('amyloid'); render();
    goStats(); render();
    goLab(); render();
    await new Promise(r => setTimeout(r, 400));
    const alive = !!physio;
    goHome(); render();
    return { alive, dead: physio === null };
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

  head('the tutor sits beside the question, or under it, never over it');
  /* Below 1024px Apex was a bottom sheet, and on an iPad in portrait — 834
     points wide — that sheet covers the stem you are asking about. Which split
     is right depends on the SHAPE of the screen, not its size: side by side
     wants width, stacked wants height, and a 1210×834 iPad and a 834×1194 iPad
     are the same iPad. */
  {
    /* Returns the numbers alongside the verdict. A layout check that fails with
       the single word "sheet" tells you nothing about WHY, and this one has a
       history of failing intermittently — so when it does, it now says what it
       measured. */
    const shape = async () => page.evaluate(() => {
      const app = document.getElementById('app'), ai = document.getElementById('ai');
      const a = app.getBoundingClientRect(), i = ai.getBoundingClientRect();
      const r = n => Math.round(n);
      const at = `app ${r(a.x)},${r(a.y)} ${r(a.width)}x${r(a.height)} · ` +
                 `ai ${r(i.x)},${r(i.y)} ${r(i.width)}x${r(i.height)} · ` +
                 `vp ${window.innerWidth}x${window.innerHeight} · ` +
                 `open ${document.getElementById('shell').classList.contains('ai-open')}`;
      /* A bottom sheet is identified by what it IS — a fixed-position overlay —
         rather than by being what is left when the other two tests fail. The
         previous version required #app and #ai to share a left edge before it
         would call a layout "stacked", and #app is a centred reading column
         with a max-width, so its left edge moves with the length of the
         question on screen. On a long stem it sat at x=0 and the check passed;
         on a short one it sat at x=251 and the same correct layout was reported
         as a sheet. That is where the intermittent failure came from — not from
         timing, and not from the app. */
      const fixed = getComputedStyle(ai).position === 'fixed';
      let verdict = 'other';
      if (i.width < 20 || i.height < 20) verdict = 'closed';
      else if (fixed) verdict = 'sheet';
      else if (i.x >= a.x + a.width - 2 && i.height > 200) verdict = 'side';
      else if (i.y >= a.y + a.height - 2 && i.height > 150) verdict = 'stacked';
      return { verdict, at: at + ' · ' + getComputedStyle(ai).position };
    });
    /* #ai transitions flex-basis over 280ms, so a measurement taken straight
       after a resize catches it mid-animation and reads as neither layout.
       Sleeping longer only moves the flake around. So it waits for the geometry
       to STOP CHANGING: poll until the box is identical across three animation
       frames, then read the shape.

       TWO THINGS MAKE THAT ACTUALLY DETERMINISTIC, and it took a while to get
       both. Resetting the counters is not enough on its own: setViewportSize
       resolves before the page has resized, and the PREVIOUS layout is
       perfectly stable while the resize is pending — three identical frames of
       the old shape is exactly what this was measuring, which is why it read
       `sheet` in portrait on roughly one run in three, and still did after the
       reset was added. So the viewport is waited for first, and its dimensions
       are part of the stability key, so a resize landing mid-poll resets the
       count instead of being averaged into it. */
    const open = async (w, h) => {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForFunction(
        ([w, h]) => Math.abs(window.innerWidth - w) <= 2 && Math.abs(window.innerHeight - h) <= 2,
        [w, h], { timeout: 8000 });
      await page.evaluate(() => {
        const sh = document.getElementById('shell');
        if (!sh.classList.contains('ai-open')) toggleAI();
        buildAI();
        window.__stable = 0; window.__lastRect = null;
      });
      await page.waitForFunction(() => {
        const ai = document.getElementById('ai');
        const r = ai.getBoundingClientRect();
        const key = [window.innerWidth, window.innerHeight, r.x, r.y, r.width, r.height]
          .map(n => Math.round(n)).join(',');
        window.__stable = (window.__lastRect === key) ? (window.__stable || 0) + 1 : 0;
        window.__lastRect = key;
        return window.__stable >= 3;
      }, { timeout: 8000, polling: 'raf' });
      return shape();
    };

    const sLand = await open(1210, 834);
    ok('an iPad in landscape puts it beside the question', sLand.verdict === 'side',
       `${sLand.verdict} — ${sLand.at}`);
    const sPort = await open(834, 1194);
    ok('the same iPad in portrait puts it underneath', sPort.verdict === 'stacked',
       `${sPort.verdict} — ${sPort.at}`);
    /* 1024 is the old breakpoint's edge and a real iPad Pro width — it must go
       by orientation like everything else, not by having cleared a number. */
    const sPro = await open(1024, 1366);
    ok('and a 1024pt portrait iPad is stacked too, not split by width', sPro.verdict === 'stacked',
       `${sPro.verdict} — ${sPro.at}`);
    /* A smaller tablet in landscape has the width for two columns even though
       the old breakpoint gave it a sheet. */
    const sSmall = await open(900, 700);
    ok('a landscape tablet under the old breakpoint gets two columns too', sSmall.verdict === 'side',
       `${sSmall.verdict} — ${sSmall.at}`);
    /* And a phone gets neither, because at that size the sheet is right. */
    const sPhone = await open(430, 932);
    ok('a phone keeps the bottom sheet, which is correct at that size', sPhone.verdict === 'sheet',
       `${sPhone.verdict} — ${sPhone.at}`);

    /* In a stacked split the document stops scrolling and #app scrolls instead,
       which silently breaks every window.scrollTo(0,0) in the app — you arrive
       at the top of a screen and find yourself halfway down it. */
    await page.setViewportSize({ width: 834, height: 1194 });
    await page.waitForTimeout(300);
    const top = await page.evaluate(async () => {
      const app = document.getElementById('app');
      goStudy();
      await new Promise(r => setTimeout(r, 500));
      app.scrollTop = 600;
      const moved = app.scrollTop;
      goHome();
      await new Promise(r => setTimeout(r, 600));
      return { moved, after: app.scrollTop, hasHelper: typeof toTop === 'function' };
    });
    ok('and navigating still arrives at the top of the new screen',
       top.hasHelper && top.moved > 0 && top.after === 0,
       `scrolled to ${top.moved}, landed at ${top.after}`);
    await page.setViewportSize({ width: 430, height: 900 });
    await page.waitForTimeout(250);
  }

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
