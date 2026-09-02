#!/usr/bin/env node
/*
 * Layout invariants, on every screen, at every frame a real device produces.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-layout.js <patched.html>
 *
 * WHY THIS EXISTS. Every bug that has reached the fellow was a layout bug, and
 * before this suite exactly three of forty-six files asserted that anything
 * fits anything: verify-home, verify-chat, and verify-figzoom — one screen, one
 * panel, one viewer. The quiz screen, the notes, the stats, the Rhythm Lab and
 * the search had no such check at all, and the figure viewer's own bug lived
 * for a day in the gap between a portrait test viewport and a landscape iPad.
 *
 * So this is deliberately one suite rather than a check bolted onto forty: the
 * invariants are the same everywhere, and a screen added later should be caught
 * by adding one line to SCREENS rather than by remembering to write assertions.
 *
 * WHAT IT ASSERTS, AND WHY NOT MORE. Two candidate invariants were measured
 * first and thrown away, because a check that cries wolf gets ignored:
 *
 *   "no element extends past the viewport" fires on .fc-glow, which is inset
 *   -50% -20% on purpose, pointer-events:none, and clipped by its parent;
 *
 *   "scrollHeight must not exceed clientHeight" fires on .hero and .hero-live,
 *   whose ::before and .hero-ecg layers bleed by design. scrollHeight counts
 *   absolutely-positioned decoration, so it is simply the wrong instrument.
 *
 * What survived is precise: a MEDIA element clipped by an ancestor that cannot
 * scroll is content the fellow cannot reach by any gesture, which is exactly
 * the shape of the figure-viewer bug. Everything else here is cheap and
 * unambiguous.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-layout.js <patched.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

/* The frames that exist in the fellow's hands, plus a desktop for the split
   build. Landscape first: it is where the figure viewer broke and the only
   orientation no other suite here exercises. */
const FRAMES = [
  ['iPad 11" landscape', 1194, 834],
  ['iPad 11" portrait', 834, 1194],
  ['iPad 12.9" landscape', 1366, 1024],
  ['iPhone portrait', 390, 844],
  ['desktop', 1440, 900],
];
const SCREENS = ['home', 'stats', 'lab', 'refs', 'memory', 'study', 'search', 'quiz'];

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1194, height: 834 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 150000 });

  /* One pass per frame, aggregated: a line per invariant naming every screen
     that broke it, rather than forty near-identical PASS lines to scroll past. */
  const sweep = screens => page.evaluate(async screens => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const go = {
      home: () => goHome(), stats: () => goStats(), lab: () => goLab(), refs: () => goRefs(),
      memory: () => goMemory(), study: () => goStudy(), search: () => openSearch(),
      quiz: () => startQuiz(CHAPTERS[0], 'all'),
    };
    const sideways = [], clipped = [], offLeft = [];
    let media = 0;
    for (const s of screens) {
      try { go[s](); } catch (e) { sideways.push(s + ' (threw: ' + e.message.slice(0, 30) + ')'); continue; }
      await wait(380);

      const d = document.documentElement;
      const over = Math.round(d.scrollWidth - d.clientWidth);
      if (over > 1) sideways.push(s + ' +' + over + 'px');

      for (const m of document.querySelectorAll('#app img, #app canvas')) {
        const cs = getComputedStyle(m);
        if (cs.pointerEvents === 'none' || cs.display === 'none' || cs.visibility === 'hidden') continue;
        const mr = m.getBoundingClientRect();
        if (mr.width < 8 || mr.height < 8) continue;
        media++;
        /* The nearest ancestor that CLIPS. A scrolling ancestor is fine — the
           content is still reachable — so the walk stops at one. */
        let n = m.parentElement, clip = null;
        while (n && n !== document.documentElement) {
          const c = getComputedStyle(n);
          if (c.overflowY === 'hidden' || c.overflowY === 'clip' || c.overflowX === 'hidden' || c.overflowX === 'clip') { clip = n; break; }
          if (c.overflowY === 'auto' || c.overflowY === 'scroll' || c.overflowX === 'auto' || c.overflowX === 'scroll') break;
          n = n.parentElement;
        }
        if (!clip) continue;
        const cr = clip.getBoundingClientRect();
        const esc = Math.max(0, cr.top - mr.top, mr.bottom - cr.bottom, cr.left - mr.left, mr.right - cr.right);
        if (esc > 2) clipped.push(s + ': ' + m.tagName.toLowerCase() + ' escapes .' +
          String(clip.className || clip.tagName).split(' ')[0] + ' by ' + Math.round(esc) + 'px');
      }

      /* Content starting left of the viewport cannot be scrolled back to on a
         page that only scrolls down. */
      for (const el of document.querySelectorAll('#app > *, #app > * > *')) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        if (r.left < -2) offLeft.push(s + ': ' + String(el.className || el.tagName).split(' ')[0] + ' at x=' + Math.round(r.left));
      }
    }
    return { sideways, clipped, offLeft, media };
  }, screens);

  let totalMedia = 0;
  for (const [name, w, h] of FRAMES) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(240);
    head(`${name} — ${w}x${h}`);
    const r = await sweep(SCREENS);
    totalMedia += r.media;
    ok('no screen scrolls sideways', r.sideways.length === 0,
       r.sideways.join('; ') || `${SCREENS.length} screens clean`);
    ok('no figure is clipped by something that cannot scroll', r.clipped.length === 0,
       r.clipped.slice(0, 2).join('; ') || `${r.media} media elements checked`);
    ok('nothing sits off the left edge', r.offLeft.length === 0,
       r.offLeft.slice(0, 2).join('; ') || 'all content starts on screen');
  }
  ok('the sweep actually looked at media, rather than finding none to check',
     totalMedia >= 20, `${totalMedia} media elements across ${FRAMES.length} frames`);

  head('the overlays, which sit above every screen');
  {
    await page.setViewportSize({ width: 1194, height: 834 });
    await page.waitForTimeout(240);
    /* The figure viewer with a REAL figure: the exact case that shipped
       broken, held here at the exact frame it shipped broken in. */
    const fig = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      goHome(); await wait(200);
      let url = null;
      try { for (const id in IMGS) { const l = IMGS[id]; if (l && l.length && typeof l[0] === 'string') { url = l[0]; break; } } } catch (_) {}
      if (!url) return null;
      closePeek(); openFigure(url, 'Layout check', 'Bank');
      let img = null;
      for (let t = 0; t < 60 && !img; t++) { await wait(25); img = document.querySelector('.figv-scroll img'); }
      if (img && !(img.complete && img.naturalWidth)) {
        await new Promise(r => { let d = 0; const f = () => { if (!d++) r(); };
          img.addEventListener('load', f, { once: true }); setTimeout(f, 4000); });
      }
      await wait(80);
      const box = document.querySelector('.figv-scroll');
      const out = img && box
        ? { over: Math.max(0, img.offsetHeight - box.clientHeight, img.offsetWidth - box.clientWidth),
            nat: img.naturalWidth + 'x' + img.naturalHeight }
        : null;
      closePeek();
      return out;
    });
    ok('a real figure fits the viewer at Fit', !!fig && fig.over <= 1,
       fig ? `${fig.nat}, overflow ${Math.round(fig.over)}px` : 'no figure to open');

    /* The Apex panel takes width from the app beside it; if it can push the
       document sideways the whole layout is wrong at that width. */
    const apex = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      /* A provider has to be configured or the panel renders its setup screen,
         which has no textarea — the first version of this check asserted the
         input was on screen in a state where the input does not exist. No key
         is used: nothing here sends a request. */
      AI.provider = 'mistral';
      AI.mistral = { key: 'layout-check', model: 'pixtral-large-latest' };
      const sh = document.getElementById('shell');
      if (!sh.classList.contains('ai-open')) toggleAI();
      buildAI(); await wait(450);
      const d = document.documentElement;
      const panel = document.getElementById('ai');
      const input = document.getElementById('aiIn');
      const ir = input ? input.getBoundingClientRect() : null;
      const pr = panel ? panel.getBoundingClientRect() : null;
      const out = {
        sideways: Math.round(d.scrollWidth - d.clientWidth),
        panelOnScreen: !!pr && pr.left >= -2 && pr.right <= innerWidth + 2 && pr.width > 100,
        panel: pr ? Math.round(pr.left) + '→' + Math.round(pr.right) + ' of ' + innerWidth : 'no panel',
        hasInput: !!input,
        inputOnScreen: !!ir && ir.left >= -2 && ir.right <= innerWidth + 2 && ir.width > 40,
        input: ir ? Math.round(ir.left) + '→' + Math.round(ir.right) : 'none',
      };
      if (sh.classList.contains('ai-open')) toggleAI();
      await wait(200);
      return out;
    });
    ok('the Apex panel does not push the page sideways', apex.sideways <= 1, `+${apex.sideways}px`);
    ok('the panel itself sits inside the viewport', apex.panelOnScreen === true, apex.panel);
    ok('the question box is rendered once a provider is set', apex.hasInput === true);
    ok('and it stays on screen', apex.inputOnScreen === true, apex.input);
  }

  head('regression');
  ok('no console or page errors across the sweep', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
