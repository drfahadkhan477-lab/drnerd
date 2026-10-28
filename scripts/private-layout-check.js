#!/usr/bin/env node
/*
 * Real-content layout check, numbers only.
 *
 *   node scripts/private-layout-check.js [build/systole.html] [--pearls 60] [--engine webkit]
 *
 * Public CI draws the app around an invented bank (scripts/synthetic-export.js),
 * whose notes are shaped like the owner's but are not them. This is the check
 * that runs on the owner's own build, before a deploy, where the licensed notes
 * are: it walks the first N pearls at six iPad windows and says whether Home,
 * Brain or Labs scrolls, and how the pearl headings were found.
 *
 * It prints counts and pixels, never a word of a note or a question (AGENTS.md:
 * suite output can quote licensed text; this is written so it cannot). Exit 1
 * when any window scrolls, so a deploy script can stop on it.
 */
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const file = path.resolve(positional[0] || 'build/systole.html');
const PEARLS = +flag('--pearls', 60);
const ENGINE = flag('--engine', 'webkit');
const SIZES = [[834, 1100], [1194, 770], [1024, 1260], [1366, 950], [744, 1000], [1133, 700]];

(async () => {
  const pw = require('playwright');
  const browser = await pw[ENGINE].launch();
  let worst = 0;
  for (const [w, h] of SIZES) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 300000 });
    await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), null, { timeout: 300000 });
    await page.evaluate(() => { try { dismissHello(); } catch (_) {} });
    const r = await page.evaluate(async n => {
      const over = () => {
        const pg = document.getElementById('homePage0');
        return Math.max(pg ? pg.scrollHeight - pg.clientHeight : 0, document.scrollingElement.scrollHeight - innerHeight);
      };
      const all = pearlAll();
      let scrolled = 0, px = 0, tried = 0;
      for (const p of all.slice(0, n)) {
        pearlCurrent = p; render();
        await new Promise(res => setTimeout(res, 120));
        const o = over(); tried++;
        if (o > 0) scrolled++;
        px = Math.max(px, o);
      }
      const pages = [1, 2].map(i => { const pg = document.getElementById('homePage' + i); return pg ? pg.scrollHeight - pg.clientHeight : -1; });
      return { pearls: all.length, tried, scrolled, worstPx: px, brain: pages[0], labs: pages[1] };
    }, PEARLS);
    worst = Math.max(worst, r.worstPx, r.brain, r.labs);
    console.log(`${w}x${h}  home: ${r.scrolled}/${r.tried} pearls scroll, worst ${r.worstPx}px  brain: ${r.brain}px  labs: ${r.labs}px`);
    await page.close();
  }

  const page = await browser.newPage();
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && typeof Pearl !== 'undefined', null, { timeout: 300000 });
  const h = await page.evaluate(() => {
    const all = pearlAll(), out = { pearls: all.length, fallback: 0, fragment: 0, fromPassage: 0, citeLeft: 0, stepOpensWithOr: 0 };
    for (const p of all) {
      const c = p.concept || '';
      if (c === 'From your notes') out.fallback++;
      const parts = c.split(/\s*[,;]\s*/);
      if (parts.length > 1 && parts.every(x => !/\s/.test(x))) out.fragment++;
      if (c && c === Pearl.subject(p.text)) out.fromPassage++;
      if (/[a-z)\]]\.\d{1,3}(?=\s|$)/.test(p.text)) out.citeLeft++;
      if (Pearl.lesson(p.text).some(s => /^or\b/i.test((s.lead ? s.lead + ' ' : '') + s.text))) out.stepOpensWithOr++;
    }
    return out;
  });
  console.log(`headings: ${h.pearls} pearls, ${h.fromPassage} named from the passage, ${h.fallback} "From your notes", ${h.fragment} fragments, ${h.citeLeft} with a reference number left, ${h.stepOpensWithOr} with a step opening "or"`);
  await browser.close();
  console.log(worst > 0 ? `FAIL  something scrolls (worst ${worst}px)` : 'PASS  nothing scrolls at any window');
  process.exit(worst > 0 || h.fragment > 0 ? 1 : 0);
})().catch(e => { console.error(e.message.split('\n')[0]); process.exit(2); });
