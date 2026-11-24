#!/usr/bin/env node
/*
 * The glass budget: how many surfaces are blurred on each screen, and that nothing makes one of them cost a blur every frame.
 *
 *   node tests/verify-glassbudget.js build/synthetic/systole.html
 *
 * docs/UI-REVAMP.md, E and T5.2. A blurred surface (backdrop-filter) is drawn by sampling and blurring what is painted beneath
 * it, so it is cheap while that stands still and a full blur every frame while anything beneath it moves, and an iPad pays for
 * that in battery. What is measured, on every screen the capsule or a Labs door reaches (Home's three pages, Chapters, Search,
 * Progress, Notes, Memory, Annotations, the Rhythm Lab, Echo, the Practice lab, Sessions, the note search):
 *   - THE CEILING. No screen has more visible blurred surfaces than it had before the revamp, at each of the five sizes the
 *     T0.1 record measured them at (docs/validation/ui-revamp-baseline.json, written by tools/ui-baseline.js), counted the same
 *     way: every element whose computed backdrop-filter (or -webkit-backdrop-filter) is not none, with a box on screen. The
 *     record is read, not copied here, and is checked to hold every screen at every size first.
 *   - A BLUR IS NEVER ANIMATED. No @keyframes in any stylesheet the page holds sets backdrop-filter, no animation running on
 *     any screen does, and no blurred surface's computed transition-property names it.
 *   - NO BACKDROP ROOT ABOVE ONE. Above each blurred surface, no ancestor has opacity under 1, a filter, a mask, a clip-path, a
 *     blend mode, a backdrop-filter of its own (glass on glass) or will-change naming one of those: each limits what the blur
 *     can see to that ancestor's own painting (the backdrop root of Filter Effects 2). TRANSFORM IS NOT ASKED ABOUT: it is not
 *     in that list, and Home's pages carry one (scale(1) at rest, for the glide), which this suite does not claim to be free.
 *   - NOTHING MOVES BENEATH ONE. At rest (a screen's one-shot entrances over), with motion allowed and Home's own motion
 *     playing, nothing moves a blurred surface (an animation of its transform or position, or any animation on what holds it,
 *     which carries it over its backdrop; one on its own ::before or ::after is its content and is not counted), and
 *     no running animation and no canvas that
 *     draws in a 600 ms window is painted beneath a blurred surface. "Beneath" is what the page paints at that point: a grid
 *     of points across their overlap, each asked with elementsFromPoint with every element made hit-testable for the asking (a
 *     canvas or glow with pointer-events:none is otherwise invisible to it), so a thing drawn above the glass (the Apex button's
 *     avatar over a card) or clipped away before it reaches it (a card's own glow) does not count. Each screen is read at its
 *     top, at rest: a canvas scrolled under the header is not asked about here.
 * Not measured: WebKit's own cost, which only an iPad shows; screens a question is read on, which the capsule does not reach
 * and the revamp did not change; and the Apex panel and Settings, which are not opened here.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, settled, quiet, watchTransitions } = require('./_render.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-glassbudget.js <build.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);
const RECORD = require('../docs/validation/ui-revamp-baseline.json').visibleBackdropFilterCount;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + String(detail).replace(/\s+/g, ' ') : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };
const J = v => JSON.stringify(v);

/* How each screen is opened. Home's page is set before Home is drawn, as goLabs does, so a page is never the one last open. */
const SCREENS = {
  home: 'homePage=0;goHome();homeGo(0,false)', brain: 'homePage=1;goHome();homeGo(1,false)', labs: 'homePage=2;goHome();homeGo(2,false)',
  study: 'goStudy()', search: 'openSearch()', stats: 'goStats()', refs: 'goRefs()', memory: 'goMemory()', annotations: 'goAnnotations()',
  lab: 'goLab()', echo: 'goEcho()', practice: 'goPractice()', sessions: 'goSessions()', notesearch: 'goNoteSearch()',
};
const SIZES = [[1180, 820], [834, 1194], [1024, 768], [744, 1133], [390, 844]];

/* In the page: the visible blurred surfaces, named. */
const BLURRED = () => {
  const vis = el => { const b = el.getBoundingClientRect(), s = getComputedStyle(el);
    return b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth && s.visibility !== 'hidden' && s.display !== 'none'; };
  const tag = el => (el.id ? '#' + el.id : el.tagName.toLowerCase()) + (el.classList[0] ? '.' + el.classList[0] : '');
  return [...document.querySelectorAll('body *')].filter(el => { const s = getComputedStyle(el), bf = s.backdropFilter || s.webkitBackdropFilter; return bf && bf !== 'none' && vis(el); }).map(tag);
};

/* In the page, motion allowed: everything this suite asks of the blurred surfaces on the screen that is drawn. */
const AUDIT = async () => {
  const vis = el => { const b = el.getBoundingClientRect(), s = getComputedStyle(el);
    return b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth && s.visibility !== 'hidden' && s.display !== 'none'; };
  const tag = el => (el.id ? '#' + el.id : el.tagName.toLowerCase()) + (el.classList[0] ? '.' + el.classList[0] : '');
  const blurred = [...document.querySelectorAll('body *')].filter(el => { const s = getComputedStyle(el), bf = s.backdropFilter || s.webkitBackdropFilter; return bf && bf !== 'none' && vis(el); });
  const BF = /backdrop-filter/;
  const transitioned = blurred.filter(el => BF.test(getComputedStyle(el).transitionProperty)).map(tag);
  const roots = [];
  for (const B of blurred) for (let a = B.parentElement; a && a !== document.documentElement; a = a.parentElement) {
    const s = getComputedStyle(a), why = [];
    if (parseFloat(s.opacity) < 1) why.push('opacity ' + s.opacity);
    if (s.filter && s.filter !== 'none') why.push('filter');
    if ((s.maskImage && s.maskImage !== 'none') || (s.webkitMaskImage && s.webkitMaskImage !== 'none')) why.push('mask');
    if (s.clipPath && s.clipPath !== 'none') why.push('clip-path');
    if (s.mixBlendMode && s.mixBlendMode !== 'normal') why.push('blend ' + s.mixBlendMode);
    if ((s.backdropFilter && s.backdropFilter !== 'none') || (s.webkitBackdropFilter && s.webkitBackdropFilter !== 'none')) why.push('backdrop-filter');
    if (/opacity|filter|mask|clip-path|mix-blend-mode/.test(s.willChange || '')) why.push('will-change ' + s.willChange);
    if (why.length) roots.push(tag(B) + ' under ' + tag(a) + ': ' + why.join(', '));
  }
  const anims = document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.nodeType === 1);
  const animatedBlur = anims.filter(a => { try { return a.effect.getKeyframes().some(k => 'backdropFilter' in k || 'webkitBackdropFilter' in k); } catch (_) { return false; } })
    .map(a => tag(a.effect.target));
  /* Painted beneath: at some point of the overlap the page's own stack has the blurred surface above the other thing.
     elementsFromPoint leaves out whatever has pointer-events:none (the hero's ECG canvas, every decorative glow), so for the
     length of this audit everything, pseudo-elements included, is made hit-testable; the style is taken away after. */
  const probe = document.createElement('style'); probe.id = '__gbProbe';
  probe.textContent = '*,*::before,*::after{pointer-events:auto!important}';
  document.head.appendChild(probe);
  const beneath = (T, B) => { const a = T.getBoundingClientRect(), b = B.getBoundingClientRect();
    const l = Math.max(a.left, b.left, 0), r = Math.min(a.right, b.right, innerWidth), t = Math.max(a.top, b.top, 0), bo = Math.min(a.bottom, b.bottom, innerHeight);
    if (r - l < 1 || bo - t < 1) return false;
    for (let i = 1; i < 6; i++) for (let j = 1; j < 6; j++) {
      const st = document.elementsFromPoint(l + (r - l) * i / 6, t + (bo - t) * j / 6);
      const ib = st.findIndex(e => e === B || B.contains(e)), it = st.findIndex(e => e === T || T.contains(e));
      if (ib >= 0 && it > ib) return true;
    }
    return false; };
  const under = [];
  const MOVES = /^(transform|translate|scale|rotate|top|left|right|bottom|inset|margin|offset)/i;
  const moves = a => { try { return a.effect.getKeyframes().some(k => Object.keys(k).some(p => MOVES.test(p))); } catch (_) { return false; } };
  for (const B of blurred) for (const a of anims) { const T = a.effect.target, pseudo = a.effect.pseudoElement, what = a.animationName || a.transitionProperty || 'animation';
    /* Inside the glass (its own ::before or ::after, or something it holds) is its content, painted over its backdrop. The glass
       itself moved, or anything that holds it, is the glass carried over its backdrop: blurred again every frame. An ancestor's
       pseudo-element cannot be asked where it paints (elementsFromPoint answers with its host), so it is counted as beneath. */
    if (B.contains(T) && T !== B) continue;
    if (T === B) { if (!pseudo && moves(a)) under.push(tag(B) + ' (' + what + ') moves the glass itself'); continue; }
    if (T.contains(B)) { under.push(pseudo ? tag(T) + pseudo + ' (' + what + ') may paint beneath ' + tag(B) : tag(T) + ' (' + what + ') carries the glass ' + tag(B)); continue; }
    if (beneath(T, B)) under.push(tag(T) + ' (' + (a.animationName || a.transitionProperty || 'animation') + ') beneath ' + tag(B)); }
  const canvases = [...document.querySelectorAll('canvas')].filter(vis);
  canvases.forEach(c => { c.__draws = 0; });
  await new Promise(r => setTimeout(r, 600));
  const drew = canvases.filter(c => c.__draws > 0);
  for (const B of blurred) for (const c of drew) { if (B.contains(c)) continue; if (beneath(c, B)) under.push('canvas ' + tag(c) + ' (' + c.__draws + ' draws) beneath ' + tag(B)); }
  probe.remove();
  return { blurred: blurred.length, transitioned, roots: [...new Set(roots)], animatedBlur, under: [...new Set(under)], drew: drew.map(tag) };
};

(async () => {
  const browser = await launch();
  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));

  head('the record this is held to');
  const missing = SIZES.flatMap(([w, h]) => Object.keys(SCREENS).filter(s => !(RECORD[`${w}x${h}`] && RECORD[`${w}x${h}`][s] > 0)).map(s => `${s} at ${w}x${h}`));
  ok('the T0.1 record counts every screen here at every size (precondition)', missing.length === 0, missing.join(', ') || Object.keys(SCREENS).length + ' screens, ' + SIZES.length + ' sizes');

  head('the ceiling: no screen has more blurred surfaces than before the revamp');
  /* As the record was taken: midnight, motion reduced, a tablet's touch, and the first-day card put away. */
  for (const [w, h] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: w < 700, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = watch(await ctx.newPage(), events, `${w}x${h}`); page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.dismiss());
    await watchTransitions(page);
    await page.goto(URL, { waitUntil: 'load', timeout: 200000 }); await booted(page);
    await page.evaluate(() => { try { setTheme('midnight'); } catch (_) {} try { dismissHello(); } catch (_) {} });
    const over = [], counts = {};
    for (const [name, go] of Object.entries(SCREENS)) {
      await page.evaluate(go);
      await settled(page, () => !window.__vtLive, { label: name }); await quiet(page);
      const b = await page.evaluate(BLURRED), was = (RECORD[`${w}x${h}`] || {})[name];
      counts[name] = b.length;
      if (!(was > 0)) over.push(`${name}: not in the record at ${w}x${h}`);
      else if (b.length > was) over.push(`${name} ${b.length} (was ${was}: ${b.join(' ')})`);
    }
    ok(`${w}x${h}: every screen has no more blurred surfaces than the record`, over.length === 0 && Object.values(counts).some(n => n > 0), over.join('; ') || J(counts));
    await ctx.close();
  }

  head('a blur is never animated, has no backdrop root above it, and nothing moves beneath it');
  /* Every 2D and WebGL draw call is counted on its canvas, from before the page's own code runs. */
  for (const [w, h] of [[1180, 820], [834, 1194]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, reducedMotion: 'no-preference', serviceWorkers: 'block' });
    await ctx.addInitScript(() => {
      const count = (P, names) => { if (!P) return; for (const m of names) if (typeof P[m] === 'function') { const o = P[m];
        P[m] = function () { const c = this.canvas; if (c) c.__draws = (c.__draws || 0) + 1; return o.apply(this, arguments); }; } };
      count(window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, ['fillRect', 'clearRect', 'fill', 'stroke', 'drawImage', 'putImageData', 'fillText', 'strokeText']);
      for (const G of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) count(G && G.prototype, ['drawArrays', 'drawElements', 'clear']);
    });
    const page = watch(await ctx.newPage(), events, `motion ${w}x${h}`); page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.dismiss());
    await watchTransitions(page);
    await page.goto(URL, { waitUntil: 'load', timeout: 200000 }); await booted(page);
    /* Home's motion playing: paused, Home stops everything that moves, and a canvas beneath its glass would read as still. */
    const playing = await page.evaluate(() => { try { setTheme('midnight'); } catch (_) {} try { dismissHello(); } catch (_) {} if (atlasPaused) toggleAtlasMotion();
      return !atlasPaused && !matchMedia('(prefers-reduced-motion: reduce)').matches; });
    const sheets = await page.evaluate(() => { const out = []; let read = 0;
      const walk = rules => { for (const r of rules) { read++; if (r.type === 7 /* KEYFRAMES */ && /backdrop-filter/.test(r.cssText)) out.push('@keyframes ' + r.name); if (r.cssRules) walk(r.cssRules); } };
      for (const s of document.styleSheets) { try { walk(s.cssRules); } catch (_) {} }
      return { out, read }; });
    const res = {};
    for (const [name, go] of Object.entries(SCREENS)) {
      await page.evaluate(go);
      await settled(page, () => !window.__vtLive, { label: name }); await quiet(page);
      /* At rest: a screen's one-shot entrance runs beneath the header once, as it is drawn, and is over. What is asked is what
         keeps moving: so every finite animation and transition is let finish first (as verify-contrast rests). */
      await settled(page, () => !document.getAnimations().some(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations !== Infinity),
        { timeout: 15000, label: name + ': its entrances to end' });
      res[name] = await page.evaluate(AUDIT);
    }
    const all = k => Object.entries(res).flatMap(([n, r]) => r[k].map(x => n + ': ' + x));
    const drewSomewhere = Object.values(res).some(r => r.drew.length > 0), blurredSomewhere = Object.values(res).every(r => r.blurred > 0);
    ok(`${w}x${h}: with motion playing, every screen read, each with its blurred surfaces, and canvases seen drawing (precondition)`,
       playing && blurredSomewhere && drewSomewhere && sheets.read > 500, J({ playing, rules: sheets.read, drew: Object.fromEntries(Object.entries(res).map(([n, r]) => [n, r.drew.length])) }));
    ok(`${w}x${h}: no keyframes set a backdrop-filter, no running animation changes one, and no blurred surface transitions it`,
       sheets.out.length === 0 && all('animatedBlur').length === 0 && all('transitioned').length === 0,
       J({ keyframes: sheets.out, animated: all('animatedBlur'), transitioned: all('transitioned') }));
    ok(`${w}x${h}: no blurred surface has a backdrop root above it (opacity, filter, mask, clip-path, blend, glass on glass)`, all('roots').length === 0, all('roots').slice(0, 8).join('; '));
    ok(`${w}x${h}: nothing animates or draws beneath a blurred surface`, all('under').length === 0, all('under').slice(0, 6).join('; '));
    await ctx.close();
  }

  head('and nothing broke');
  ok('no page error', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
