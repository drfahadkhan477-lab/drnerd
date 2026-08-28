#!/usr/bin/env node
/*
 * Checks for the theme system.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-theme.js <patched.html|url>
 *
 * The claims worth testing are the ones that would rot silently:
 *
 *   · a theme is a mode (data-theme) paired with a palette (data-palette), and
 *     applying one sets both attributes correctly — including removing the
 *     palette on the default presets rather than leaving a stale one behind;
 *   · each palette actually MOVES the core tokens — a "theme" that resolves to
 *     the same --bg and --accent as another is not a theme;
 *   · the semantic colours are deliberately NOT themed, so green still means
 *     "right answer" under every palette;
 *   · the hero, which is dark under every theme, recolours its accent so the
 *     greeting, the rhythm label and the ECG strip agree — the cohesion fix;
 *   · the picker opens, sets the theme, persists it, and an outside click
 *     dismisses it;
 *   · old saved values (bare 'dark'/'light') still resolve, so nobody's stored
 *     preference breaks on upgrade;
 *   · the pre-paint boot script applies the saved theme before the app mounts,
 *     which is the whole point of it — no flash of the wrong palette.
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-theme.js <patched.html|url>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 460, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 150000 });

  head('the presets');
  const presets = await page.evaluate(() => ({
    n: THEMES.length,
    light: THEMES.filter(t => t.group === 'light').map(t => t.id),
    dark: THEMES.filter(t => t.group === 'dark').map(t => t.id),
    modes: THEMES.map(t => t.mode),
    everyHasSwatch: THEMES.every(t => /^#/.test(t.bg) && /^#/.test(t.ac)),
  }));
  ok('there are eight themes', presets.n === 8, String(presets.n));
  ok('four are light, four are dark', presets.light.length === 4 && presets.dark.length === 4,
     `light ${presets.light.join(',')} | dark ${presets.dark.join(',')}`);
  ok('every theme carries a two-colour swatch', presets.everyHasSwatch);

  head('applying a theme sets both axes');
  const applied = await page.evaluate(() => {
    const out = {};
    for (const t of THEMES) {
      setTheme(t.id);
      const h = document.documentElement;
      out[t.id] = { theme: h.getAttribute('data-theme'), palette: h.getAttribute('data-palette') };
    }
    return out;
  });
  ok('auto removes data-theme and uses no palette',
     applied.auto.theme === null && applied.auto.palette === null, JSON.stringify(applied.auto));
  ok('midnight is dark with no palette override', applied.midnight.theme === 'dark' && applied.midnight.palette === null);
  ok('cathlab is dark with the cathlab palette', applied.cathlab.theme === 'dark' && applied.cathlab.palette === 'cathlab');
  ok('parchment is light with the parchment palette', applied.parchment.theme === 'light' && applied.parchment.palette === 'parchment');
  ok('daylight is light with no palette override — no stale palette left behind',
     applied.daylight.theme === 'light' && applied.daylight.palette === null, JSON.stringify(applied.daylight));

  head('each palette actually moves the tokens');
  const tokens = await page.evaluate(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      return { bg: cs.getPropertyValue('--bg').trim(), teal: cs.getPropertyValue('--teal').trim(),
               text: cs.getPropertyValue('--text').trim(), hero: cs.getPropertyValue('--hero-accent').trim(),
               green: cs.getPropertyValue('--green').trim(), red: cs.getPropertyValue('--red').trim() };
    };
    const out = {};
    for (const t of THEMES) { setTheme(t.id); out[t.id] = read(); }
    return out;
  });
  const bgs = new Set(['daylight', 'slate', 'parchment', 'midnight', 'nocturne', 'cathlab', 'monitor'].map(k => tokens[k].bg));
  ok('the seven explicit themes have seven distinct backgrounds', bgs.size === 7, `${bgs.size} distinct`);
  const accents = new Set(['daylight', 'slate', 'parchment', 'nocturne', 'cathlab', 'monitor'].map(k => tokens[k].teal));
  ok('their accents are distinct too', accents.size === 6, `${accents.size} distinct`);
  ok('cath lab is genuinely amber, not the default blue', /f5|fb|d9|b4/i.test(tokens.cathlab.teal), tokens.cathlab.teal);
  ok('monitor accent is minted clear of the "correct" green so they do not collide',
     tokens.monitor.teal.toLowerCase() !== tokens.monitor.green.toLowerCase(), `accent ${tokens.monitor.teal} vs green ${tokens.monitor.green}`);

  head('semantic colours are not themed');
  const greens = new Set(Object.values(tokens).map(t => t.green.toLowerCase()));
  const reds = new Set(Object.values(tokens).map(t => t.red.toLowerCase()));
  /* Parchment softens its answer backgrounds for the warm paper, but the
     foreground green/red that MEAN right and wrong stay put across the dark
     themes and the default light one. Allow parchment its one warm exception. */
  ok('"correct" green is stable across the non-parchment themes',
     new Set(Object.entries(tokens).filter(([k]) => k !== 'parchment').map(([, t]) => t.green.toLowerCase())).size === 1,
     [...greens].join(' '));
  ok('"wrong" red is stable across the non-parchment themes',
     new Set(Object.entries(tokens).filter(([k]) => k !== 'parchment').map(([, t]) => t.red.toLowerCase())).size === 1,
     [...reds].join(' '));

  head('the hero recolours as one');
  const heroCohesion = await page.evaluate(() => {
    setTheme('cathlab');
    const cs = getComputedStyle(document.documentElement);
    const hero = cs.getPropertyValue('--hero-accent').trim().toLowerCase();
    const greet = getComputedStyle(document.querySelector('.hero-greet')).color;
    return { hero, greet };
  });
  ok('the cath-lab hero accent is amber', /fbbf24|f59e0b|fb|f5/i.test(heroCohesion.hero), heroCohesion.hero);
  ok('the greeting is drawn from that accent, not a hard-coded mint',
     /25[0-5],\s*1[0-9][0-9]/.test(heroCohesion.greet) || /rgb/.test(heroCohesion.greet), heroCohesion.greet);

  head('the picker');
  await page.evaluate(() => setTheme('midnight'));
  const menu = await page.evaluate(async () => {
    toggleThemeMenu();
    await new Promise(r => setTimeout(r, 60));
    const m = document.getElementById('themeMenu');
    const openNow = m.classList.contains('open');
    const opts = m.querySelectorAll('.theme-opt').length;
    const checked = m.querySelector('.theme-opt.on .tk')?.textContent;
    return { openNow, opts, checked };
  });
  ok('the menu opens', menu.openNow);
  ok('it lists all eight themes', menu.opts === 8, String(menu.opts));
  ok('the active theme is marked', /midnight/i.test(menu.checked || ''), menu.checked);

  const picked = await page.evaluate(async () => {
    document.querySelector('[onclick="setTheme(\'nocturne\')"]').click();
    await new Promise(r => setTimeout(r, 60));
    return { theme: S.theme, attr: document.documentElement.getAttribute('data-palette'),
             menuOpen: document.getElementById('themeMenu').classList.contains('open') };
  });
  ok('clicking an option applies that theme', picked.theme === 'nocturne' && picked.attr === 'nocturne');
  ok('and closes the menu', picked.menuOpen === false);

  const dismiss = await page.evaluate(async () => {
    toggleThemeMenu();
    await new Promise(r => setTimeout(r, 60));
    const wasOpen = document.getElementById('themeMenu').classList.contains('open');
    document.body.click();
    await new Promise(r => setTimeout(r, 60));
    return { wasOpen, nowOpen: document.getElementById('themeMenu').classList.contains('open') };
  });
  ok('an outside click dismisses the menu', dismiss.wasOpen && dismiss.nowOpen === false);

  head('it persists, and old preferences still resolve');
  const persisted = await page.evaluate(() => {
    setTheme('monitor');
    return JSON.parse(localStorage.getItem('accsap12.v2')).theme;
  });
  ok('the choice is saved', persisted === 'monitor');

  const legacy = await page.evaluate(() => {
    /* Someone who saved 'dark' before this system existed should land on the
       dark default, not on a broken unknown id. */
    S.theme = 'dark'; applyTheme();
    const a = { theme: document.documentElement.getAttribute('data-theme'), def: themeDef().id };
    S.theme = 'light'; applyTheme();
    const b = { theme: document.documentElement.getAttribute('data-theme'), def: themeDef().id };
    return { a, b };
  });
  ok('a saved "dark" resolves to a dark theme', legacy.a.theme === 'dark' && legacy.a.def === 'midnight', JSON.stringify(legacy.a));
  ok('a saved "light" resolves to a light theme', legacy.b.theme === 'light' && legacy.b.def === 'daylight', JSON.stringify(legacy.b));

  head('the pre-paint boot script applies the theme on a cold load');
  /* Save a theme, then RELOAD this same context (a fresh page on a file:// URL
     does not inherit another page's localStorage, so reload is the honest test
     of persistence). The inline boot script near the top of <body> runs long
     before the app defines S, and must stamp the attributes off localStorage so
     the very first paint is already the saved palette — no flash of the wrong
     one. If it applied them correctly on this cold load, it applies them on
     every cold launch. */
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('accsap12.v2') || '{}'); s.theme = 'cathlab'; localStorage.setItem('accsap12.v2', JSON.stringify(s)); });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 250000 });
  const early = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    palette: document.documentElement.getAttribute('data-palette'),
    savedFromStorage: (JSON.parse(localStorage.getItem('accsap12.v2') || '{}')).theme,
  }));
  ok('a cold load restores the saved palette from localStorage, attributes and all',
     early.theme === 'dark' && early.palette === 'cathlab' && early.savedFromStorage === 'cathlab', JSON.stringify(early));

  head('no painted surface is blind to the palette');
  /* The theme checks above assert that the surfaces we tokenised read their
     tokens. They cannot catch a surface nobody thought to tokenise, and three
     had been missed for exactly that reason — the shuffle-all card, the review
     card's glow and Apex's launcher kept the export's literal hexes, so a slab
     of default blue sat in the middle of Parchment, Cath Lab and Monitor.

     So instead of naming surfaces, render under two palettes chosen to share
     nothing — warm paper against monitor green — and diff the computed
     background of every element large enough to be seen. Anything identical
     under both either reads no token at all, or is a semantic that is meant to
     stay put. There are no unthemed semantics on the home screen, so the
     expected count here is zero, and a new hardcoded colour anywhere on it will
     fail this check on the day it is added. */
  const paint = async id => {
    await page.evaluate(t => setTheme(t), id);
    await page.waitForTimeout(500);
    return page.evaluate(() => {
      const out = {};
      for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        const bg = cs.backgroundImage !== 'none' ? cs.backgroundImage : cs.backgroundColor;
        if (!bg || bg === 'rgba(0, 0, 0, 0)') continue;
        const r = el.getBoundingClientRect();
        if (r.width * r.height < 3000) continue;
        const key = el.tagName.toLowerCase() + '.' + (el.className || '').toString().trim().split(/\s+/).slice(0, 2).join('.');
        if (!(key in out)) out[key] = bg;
      }
      return out;
    });
  };
  const warm = await paint('parchment'), green = await paint('monitor');
  const painted = Object.keys(warm).length;
  const blind = Object.keys(warm).filter(k => k in green && warm[k] === green[k]);
  ok('the sweep found surfaces to compare at all', painted >= 8, `${painted} painted surfaces`);
  ok('every one of them moves when the palette does', blind.length === 0,
     blind.length ? blind.join(', ') : `${painted}/${painted} follow the palette`);

  /* Borders carry the same risk and hid one more: the review card's edge was a
     fixed teal, so it stayed teal on an amber page. The rule here has to be
     narrower than the one above, because a hairline of pure white or black at
     low alpha is *meant* to be palette-independent — it is a highlight, not a
     colour. So only borders carrying hue are required to move. */
  const edges = async id => {
    await page.evaluate(t => setTheme(t), id);
    await page.waitForTimeout(500);
    return page.evaluate(() => {
      const out = {};
      for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.width * r.height < 3000) continue;
        if (parseFloat(cs.borderTopWidth) < 0.5) continue;
        const c = cs.borderTopColor;
        if (!c || c === 'rgba(0, 0, 0, 0)') continue;
        const [x, y, z] = c.match(/[\d.]+/g).map(Number);
        if (x === y && y === z) continue;                    /* neutral hairline */
        const key = el.tagName.toLowerCase() + '.' + (el.className || '').toString().trim().split(/\s+/).slice(0, 2).join('.');
        if (!(key in out)) out[key] = c;
      }
      return out;
    });
  };
  const warmE = await edges('parchment'), greenE = await edges('monitor');
  const stuck = Object.keys(warmE).filter(k => k in greenE && warmE[k] === greenE[k]);
  ok('and every coloured border moves with it too', stuck.length === 0,
     stuck.length ? stuck.join(', ') : `${Object.keys(warmE).length} coloured borders, all themed`);

  head('glass, on the browser this is meant to be installed from');
  /* iPadOS Safari shipped backdrop-filter behind -webkit- and only dropped the
     prefix in Safari 18. A glass surface written with the unprefixed property
     alone does not blur there — it is a flat translucent panel, which is worse
     than not having tried. Every use must carry both spellings. */
  /* Read the stylesheet as text rather than through the CSSOM: Chromium drops
     a property it does not recognise, so -webkit-backdrop-filter is not in the
     parsed rule at all and the very thing under test would be invisible. */
  const prefixes = await page.evaluate(() => {
    const css = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n');
    const plain = [], missing = [];
    for (const m of css.matchAll(/\{[^{}]*\}/g)) {
      const block = m[0];
      const bare = block.replace(/-webkit-backdrop-filter/g, '');
      if (!/backdrop-filter\s*:/.test(bare)) continue;
      plain.push(block.slice(0, 60));
      if (!/-webkit-backdrop-filter\s*:/.test(block)) missing.push(block.slice(0, 90));
    }
    return { plain, missing };
  });
  ok('the app actually uses glass', prefixes.plain.length >= 6, String(prefixes.plain.length));
  ok('and every glass surface carries the -webkit- spelling Safari needs',
     prefixes.missing.length === 0, prefixes.missing.join(', '));

  head('auto follows the system, not just the first paint');
  {
    /* THE FAILURE THIS DEFENDS AGAINST. Auto is the default, and it only ever
       read prefers-color-scheme at load. When the iPad flips to dark at sunset
       with the app open, the CSS follows on its own — so this looked fine —
       but the three canvas renderers hold their own palette and are only told
       through notifyThemeRenderers(), which nothing called. The heart, the
       12-lead and the cardiac cycle stayed light on a dark page until reload.

       emulateMedia is a real change event, the same one the OS fires. */
    await page.evaluate(() => setTheme('auto'));
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(250);
    const before = await page.evaluate(() => ({
      dark: themeIsDark(),
      bar: (document.querySelector('meta[name="theme-color"]') || {}).content,
      heart: typeof heroHeart3d !== 'undefined' && heroHeart3d ? !!heroHeart3d.isDark : null,
    }));

    /* The renderers do not expose their palette, so the change is observed the
       way the app makes it: count the calls that carry it to them. */
    await page.evaluate(() => {
      window.__notified = 0;
      const real = window.notifyThemeRenderers;
      window.notifyThemeRenderers = function () { window.__notified++; return real.apply(this, arguments); };
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({
      dark: themeIsDark(),
      bar: (document.querySelector('meta[name="theme-color"]') || {}).content,
      notified: window.__notified,
      attr: document.documentElement.getAttribute('data-theme'),
    }));

    ok('the emulated flip actually reached the page',
       before.dark === false && after.dark === true, `${before.dark} → ${after.dark}`);
    ok('the canvases are told the palette moved under them',
       after.notified > 0, `${after.notified} notification(s)`);
    ok('and the status-bar colour follows it',
       before.bar !== after.bar, `${before.bar} → ${after.bar}`);
    ok('auto still leaves data-theme off, so the CSS keeps deciding for itself',
       after.attr === null, String(after.attr));

    /* And the other half: a theme you chose is a decision, and the sun going
       down is not a reason to revisit it. */
    await page.evaluate(() => { setTheme('daylight'); window.__notified = 0; });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(300);
    const chosen = await page.evaluate(() => ({ notified: window.__notified, dark: themeIsDark(), id: themeDef().id }));
    ok('a theme you picked is not overridden by the system',
       chosen.notified === 0 && chosen.dark === false && chosen.id === 'daylight',
       `${chosen.id}, ${chosen.notified} notification(s)`);

    await page.emulateMedia({ colorScheme: null });
    await page.evaluate(() => setTheme('auto'));
  }

  head('a swatch is a promise about the palette');
  {
    /* The eight swatches are hard-coded hex in THEMES, and the palettes they
       claim to preview live in CSS. Nothing held them together, so a palette
       could be retuned and its swatch would go on showing the old colour —
       silently, because a swatch has nothing to be wrong against. */
    const drift = await page.evaluate(async () => {
      const out = [];
      const near = (a, b) => {
        const hex = h => { h = String(h).replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
        const rgb = c => {
          const m = String(c).match(/-?[\d.]+/g);
          return m ? m.slice(0, 3).map(Number) : null;
        };
        const x = /^#/.test(a) ? hex(a) : rgb(a), y = /^#/.test(b) ? hex(b) : rgb(b);
        if (!x || !y) return false;
        /* Generous: a swatch is a preview, not a colour match. This catches a
           palette that moved, not one that was nudged. */
        return Math.max(...[0, 1, 2].map(i => Math.abs(x[i] - y[i]))) <= 40;
      };
      for (const t of THEMES) {
        if (t.id === 'auto') continue;            // auto has no palette of its own
        setTheme(t.id);
        await new Promise(r => requestAnimationFrame(r));
        const cs = getComputedStyle(document.documentElement);
        const bg = cs.getPropertyValue('--bg').trim();
        /* --teal is the accent token. The name is historical — it was the one
           accent before there were palettes — and every palette overrides it. */
        const ac = cs.getPropertyValue('--teal').trim();
        if (!near(t.bg, bg)) out.push(`${t.id} bg ${t.bg} vs ${bg}`);
        if (!near(t.ac, ac)) out.push(`${t.id} accent ${t.ac} vs ${ac}`);
      }
      setTheme('auto');
      return out;
    });
    ok('every swatch still shows the palette it claims to preview',
       drift.length === 0, drift.slice(0, 3).join(' | '));
  }

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
