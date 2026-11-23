#!/usr/bin/env node
'use strict';
/*
 * The UI revamp's baseline: what the header, the landing pages and the glass measure today.
 *
 *   node tools/ui-baseline.js <build.html> <out-dir>
 *
 * WHY. docs/UI-REVAMP.md (T0.1) decides where the navigation capsule goes and how much the
 * Study Tools may grow from numbers, not from screenshots: the free width between the brand
 * and the header's buttons on every inner screen, the landing pages' slack, the visible
 * backdrop-filter count per screen, the Apex button's rect, the z-index ladder, and what the
 * two CSS variables used but never defined (--hp-b, --font-serif) change when defined. Run it
 * on a synthetic build before and after a revamp task and compare the two baseline.json files.
 * It reads only what the browser computed; it is a measurement tool, not a suite, and passes
 * or fails nothing. Screenshots of Home, Brain, Labs and Study go to <out-dir>/shots. Two
 * readings move between runs and are not for comparison: runningAnimations (it depends on
 * when the frame is read) and a phone Home page's slack (the pearl drawn varies).
 */
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..', 'tests') + '/';
const { launch } = require(R + '_engine.js');
const { booted, settled, quiet, watchTransitions } = require(R + '_render.js');
const BUILD = path.resolve(process.argv[2] || ''), OUT = path.resolve(process.argv[3] || 'ui-baseline');
if (!process.argv[2]) { console.error('usage: node tools/ui-baseline.js <build.html> <out-dir>'); process.exit(2); }
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });

const INNER = {
  brain: 'goHome(); homeGo(1,false)', labs: 'goHome(); homeGo(2,false)', home: 'goHome(); homeGo(0,false)',
  study: 'goStudy()', search: 'openSearch()', stats: 'goStats()', refs: 'goRefs()', memory: 'goMemory()',
  annotations: 'goAnnotations()', lab: 'goLab()', echo: 'goEcho()', practice: 'goPractice()', sessions: 'goSessions()',
  notesearch: 'goNoteSearch()',
};
const SIZES = [[1180, 820], [834, 1194], [1024, 768], [744, 1133], [390, 844]];

(async () => {
  const browser = await launch();
  const out = { build: path.basename(BUILD), engine: 'chromium', measuredAt: new Date().toISOString(), sizes: {} };
  for (const theme of ['midnight', 'daylight']) {
    for (const [w, h] of SIZES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: theme === 'midnight' ? 2 : 1,
        hasTouch: true, isMobile: w < 700, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const page = await ctx.newPage(); await watchTransitions(page);
      await page.goto('file://' + BUILD, { waitUntil: 'load', timeout: 200000 }); await booted(page);
      await page.evaluate(t => { try { setTheme(t); } catch (_) {} try { dismissHello(); } catch (_) {} }, theme);
      const key = `${w}x${h}`; const rec = out.sizes[key] = out.sizes[key] || {};
      for (const [name, go] of Object.entries(INNER)) {
        try { await page.evaluate(go); } catch (e) { rec[name] = { error: String(e.message).slice(0, 120) }; continue; }
        await settled(page, () => !window.__vtLive, { label: name }); await quiet(page);
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        const m = await page.evaluate((name) => {
          const rect = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
          const brand = document.querySelector('#navbar .nav-brand'), right = document.querySelector('#navbar .nav-right');
          const br = brand && brand.getBoundingClientRect(), rr = right && right.getBoundingClientRect();
          const vis = el => { const b = el.getBoundingClientRect(); const s = getComputedStyle(el);
            return b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth && s.visibility !== 'hidden' && s.display !== 'none'; };
          let blur = 0; const blurred = [];
          for (const el of document.querySelectorAll('body *')) {
            const s = getComputedStyle(el); const bf = s.backdropFilter || s.webkitBackdropFilter;
            if (bf && bf !== 'none' && vis(el)) { blur++; if (blurred.length < 40) blurred.push((el.id ? '#' + el.id : '') + '.' + [...el.classList].slice(0, 2).join('.')); }
          }
          const page = name === 'brain' ? document.getElementById('homePage1') : name === 'labs' ? document.getElementById('homePage2') : name === 'home' ? document.getElementById('homePage0') : null;
          const navh = document.getElementById('navbar').getBoundingClientRect().bottom;
          const nearTop = [], nearBottom = [];
          for (const el of document.querySelectorAll('body *')) {
            const s = getComputedStyle(el); if (s.position !== 'fixed' && s.position !== 'sticky') continue; if (!vis(el)) continue;
            const b = el.getBoundingClientRect(); const tag = (el.id ? '#' + el.id : el.tagName.toLowerCase()) + (el.classList[0] ? '.' + el.classList[0] : '');
            if (b.top < navh + 80) nearTop.push(tag); if (b.bottom > innerHeight - 80) nearBottom.push(tag);
          }
          const under = [...document.querySelectorAll('canvas')].filter(c => vis(c) && c.getBoundingClientRect().top < navh).length;
          const anims = document.getAnimations().filter(a => a.playState === 'running').length;
          return {
            screen: S.screen, homePage: typeof homePage !== 'undefined' ? homePage : null,
            navFree: br && rr ? Math.round(rr.left - br.right) : null, brandW: br ? Math.round(br.width) : null, rightW: rr ? Math.round(rr.width) : null,
            navbarZ: getComputedStyle(document.getElementById('navbar')).zIndex,
            fab: rect(document.getElementById('aiFab')), blurCount: blur, blurred,
            slack: page ? page.clientHeight - page.scrollHeight : null,
            docScroll: document.scrollingElement.scrollHeight - innerHeight,
            fixedNearTop: [...new Set(nearTop)], fixedNearBottom: [...new Set(nearBottom)], canvasesUnderHeader: under, runningAnimations: anims,
          };
        }, name);
        rec[name] = Object.assign(rec[name] || {}, theme === 'midnight' ? m : { navFreeDaylight: m.navFree });
        if (['home', 'brain', 'labs', 'study'].includes(name))
          await page.screenshot({ path: path.join(OUT, 'shots', `${name}-${key}-${theme}.png`) });
      }
      if (theme === 'midnight') {
        // with the session score pill showing
        await page.evaluate(() => { S.sessionTotal = 5; S.sessionCorrect = 1; render(); });
        for (const name of ['study', 'labs', 'stats']) {
          await page.evaluate(INNER[name]); await settled(page, () => !window.__vtLive, { label: name }); await quiet(page);
          rec[name].navFreeWithScore = await page.evaluate(() => { const b = document.querySelector('#navbar .nav-brand').getBoundingClientRect(), r = document.querySelector('#navbar .nav-right').getBoundingClientRect(); return Math.round(r.left - b.right); });
        }
        await page.evaluate(() => { S.sessionTotal = 0; S.sessionCorrect = 0; });
        // z-index ladder and the two undefined variables
        if (key === '1180x820') {
          out.zIndex = await page.evaluate(() => { const z = s => { const e = document.querySelector(s); return e ? getComputedStyle(e).zIndex : null; };
            return { navbar: z('#navbar'), ai: z('#ai'), peek: z('#peek'), aiFab: z('#aiFab'), rail: z('#rail'), settings: z('#generalSettings') }; });
          await page.evaluate(INNER.home); await settled(page, () => !window.__vtLive, { label: 'home' }); await quiet(page);
          out.undefinedVars = await page.evaluate(() => ({
            auroraBackgroundImage: getComputedStyle(document.getElementById('homePages'), '::before').backgroundImage.slice(0, 60),
            heroH1Font: (document.querySelector('#homePage0 .hero-h1') ? getComputedStyle(document.querySelector('#homePage0 .hero-h1')).fontFamily : 'no .hero-h1'),
            heroH1Visible: !!document.querySelector('#homePage0 .hero-h1') && document.querySelector('#homePage0 .hero-h1').getClientRects().length > 0,
          }));
          const before = await page.screenshot();
          await page.evaluate(() => { const s = document.createElement('style'); s.id = 'probeVars'; s.textContent = ':root{--hp-b:var(--purple);--font-serif:var(--font-display)}'; document.head.appendChild(s); });
          await quiet(page);
          const after = await page.screenshot();
          out.undefinedVars.homeAuroraWhenDefined = await page.evaluate(() => getComputedStyle(document.getElementById('homePages'), '::before').backgroundImage.slice(0, 60));
          out.undefinedVars.homeScreenshotChangedWhenDefined = !before.equals(after);
          fs.writeFileSync(path.join(OUT, 'shots', 'home-vars-defined-1180x820.png'), after);
          await page.evaluate(() => document.getElementById('probeVars').remove());
          await page.evaluate(INNER.stats); await settled(page, () => !window.__vtLive, { label: 'stats' }); await quiet(page);
          out.undefinedVars.statsTitleFont = await page.evaluate(() => { const t = document.querySelector('.stats-title'); return t ? getComputedStyle(t).fontFamily : 'no .stats-title'; });
        }
      }
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'baseline.json'), JSON.stringify(out, null, 1));
  console.log('done');
})().catch(e => { console.error('BASELINE FAILED', e); process.exit(1); });
