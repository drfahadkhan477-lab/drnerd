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

/* Enough of a reply to overflow any panel, so "does it scroll" is a real
   question rather than one the fixture answers for us. */
const sse = text => [
  'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }),
  'data: [DONE]', '',
].join('\n\n');

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1194, height: 834 } });
  await page.route('**/v1/chat/completions', route => route.fulfill({
    status: 200, headers: { 'content-type': 'text/event-stream' },
    body: sse('Long answer. '.repeat(80)),
  }));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 150000 });

  /* WAIT FOR THE BOX TO STOP MOVING, NOT FOR A CLOCK. #ai transitions its
     flex-basis over .28s, so a measurement taken on a fixed timer catches the
     panel mid-open on a loaded machine — this suite reported the panel as 1px
     wide and its input off-screen on one full run and passed the next, which
     is not a bug in the app and not a flake to shrug at either. Polling until
     two consecutive frames agree removes the timing from the question. */
  await page.addInitScript(() => {
    window.__settle = async (sel, tries) => {
      let last = -1;
      for (let i = 0; i < (tries || 60); i++) {
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const el = document.querySelector(sel);
        const w = el ? Math.round(el.getBoundingClientRect().width) : -1;
        if (w === last && w > 0) return w;
        last = w;
      }
      return last;
    };
  });
  await page.reload({ waitUntil: 'load', timeout: 250000 });
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
      buildAI();
      await window.__settle('#ai');
      await wait(80);
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

  head('the Apex answer keeps room, with the figures open, at every frame');
  {
    /* REPORTED FROM AN IPAD, WITH A PHOTOGRAPH: the figures "cover the
       explanation". Chain step 68 made the strip foldable but left the answer
       with no floor, so opening it took .ai-body to 43px on an iPad held
       portrait — one line. This suite did not catch it because it only ever
       looked at the panel as a side rail at desktop width, where the crush is
       mild, and never with the figures open. Both were the fixture being
       kinder than the device, for the third time this week. */
    const FLOOR = 100;
    const rows = [];
    for (const [name, w, h] of FRAMES) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(240);
      const r = await page.evaluate(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        AI.provider = 'mistral';
        AI.mistral = { key: 'layout-check', model: 'pixtral-large-latest' };
        const note = REF.find(x => /refimg:\/\//.test(x.body || ''));
        const sh = document.getElementById('shell');
        if (!sh.classList.contains('ai-open')) toggleAI();
        buildAI();
        await window.__settle('#ai');
        fire('explain this'); await wait(1700);
        lastHits = note ? [{ kind: 'r', id: note.id, title: note.title }] : [];
        lastHitsKey = '_general';
        buildAI(); await window.__settle('#ai'); await wait(120);
        /* Only if it is not already open. apexFigsOpen is module-level and
           survives the panel's re-render — deliberately, so a fellow who opens
           the figures keeps them open — which means a blind click on the
           second frame CLOSES them. That alternated true/false/true across the
           sweep and made the floor numbers a mixture of both states. */
        const t = document.getElementById('aiFigs');
        if (t && !document.querySelector('.fig-strip.open')) t.click();
        await wait(400);
        const body = document.querySelector('.ai-body');
        const input = document.getElementById('aiIn');
        const ir = input ? input.getBoundingClientRect() : null;
        if (!body) return null;
        body.scrollTop = 99999; await wait(60);
        const out = {
          open: !!document.querySelector('.fig-strip.open'),
          bodyH: body.clientHeight,
          scrolls: body.scrollHeight - body.clientHeight > 0 ? body.scrollTop > 0 : true,
          inputVisible: !!ir && ir.width > 40 && ir.bottom <= innerHeight + 2,
        };
        if (sh.classList.contains('ai-open')) toggleAI();
        await wait(150);
        return out;
      });
      rows.push([name, r]);
    }
    const opened = rows.filter(([, r]) => r && r.open);
    ok('the figures could be opened at every frame', opened.length === rows.length,
       `${opened.length} of ${rows.length}`);
    const crushed = rows.filter(([, r]) => !r || r.bodyH < FLOOR)
                        .map(([n, r]) => `${n}: ${r ? r.bodyH + 'px' : 'no panel'}`);
    ok(`the answer keeps at least ${FLOOR}px with the figures open`, crushed.length === 0,
       crushed.join('; ') || rows.map(([n, r]) => `${n.split(' ')[0]} ${r.bodyH}px`).join(', '));
    const stuck = rows.filter(([, r]) => !r || !r.scrolls).map(([n]) => n);
    ok('and still scrolls when the answer is longer than the room', stuck.length === 0,
       stuck.join('; ') || 'every frame scrolls');
    const hidden = rows.filter(([, r]) => !r || !r.inputVisible).map(([n]) => n);
    ok('and the question box is never pushed off the bottom', hidden.length === 0,
       hidden.join('; ') || 'visible at every frame');
  }

  head('regression');
  ok('no console or page errors across the sweep', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
