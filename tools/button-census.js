#!/usr/bin/env node
'use strict';
/*
 * Every kind of button in the built app, and how it is painted today.
 *
 *   node tools/button-census.js build/systole.html
 *   node tools/button-census.js build/systole.html --theme cathlab
 *
 * WHY. Restyling the buttons (the glass pass) has to know what each one is
 * before it touches any: which are neutral controls, which are filled
 * primaries, and which carry meaning in their colour — an answer option
 * turning green or red is feedback, not decoration. The base stylesheet comes
 * from the licensed export, which is not read here or anywhere; this reads
 * only what the browser computed.
 *
 * WHAT IT PRINTS. One line per distinct class list, with how many there were,
 * on which screens, and the computed background, colour, border, radius,
 * shadow, position, and whether ::before/::after are already in use (a glass
 * sheen drawn in a pseudo-element must not collide with one already there).
 *
 * WHAT IT NEVER PRINTS: any text. Answer options hold question text, which is
 * licensed; only class names and computed styles leave the page.
 */
const path = require('path');
const { launch } = require('../tests/_engine.js');
const { booted, onScreen } = require('../tests/_render.js');

const args = process.argv.slice(2);
const target = args.find(a => !a.startsWith('--'));
const ti = args.indexOf('--theme');
const themeId = ti > -1 ? args[ti + 1] : null;
if (!target) { console.error('usage: node tools/button-census.js <build.html | http://…> [--theme <id>]'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);


const census = () => {
  const out = [];
  for (const el of document.querySelectorAll('button, [role="button"], .btn, .opt, .chip, .door, .pill')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el), b = getComputedStyle(el, '::before'), a = getComputedStyle(el, '::after');
    const pseudo = [['before', b], ['after', a]].filter(([, s]) => s.content && s.content !== 'none' && s.content !== 'normal').map(([n]) => n);
    out.push({
      key: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).sort().join('.') : ''),
      bg: cs.backgroundColor, img: cs.backgroundImage === 'none' ? '' : cs.backgroundImage.slice(0, 60),
      color: cs.color, border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
      radius: cs.borderTopLeftRadius, shadow: cs.boxShadow === 'none' ? '' : cs.boxShadow.slice(0, 50),
      blur: cs.backdropFilter || cs.webkitBackdropFilter || '', pos: cs.position, overflow: cs.overflow,
      pseudo: pseudo.join('+'), h: Math.round(r.height), trans: cs.transitionProperty === 'all' ? 'all' : cs.transitionProperty.slice(0, 40),
    });
  }
  return out;
};

(async () => {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 1194, height: 834 } })).newPage();
  await page.goto(URL);
  await booted(page);
  if (themeId) {
    /* The app's own setTheme(), as verify-theme drives it: it sets both
       data-theme and data-palette, which is what a dark theme needs. */
    const ok = await page.evaluate(id => typeof setTheme === 'function' && THEMES.some(t => t.id === id) ? (setTheme(id), true) : false, themeId);
    if (!ok) { console.error(`no theme "${themeId}" — the app's THEMES are not what this expected`); process.exit(1); }
  }
  const all = new Map();
  const take = async (screen) => {
    await page.waitForTimeout(400);   // a census, not a test: let entrance transitions finish before reading colours
    for (const row of await page.evaluate(census)) {
      const k = row.key + ' | ' + row.bg + ' | ' + row.color;
      const e = all.get(k) || Object.assign({ n: 0, screens: new Set() }, row);
      e.n++; e.screens.add(screen); all.set(k, e);
    }
  };
  const visit = async (name, go, marker) => {
    try {
      await page.evaluate(go, name);
      await onScreen(page, name, { marker, timeout: 8000 });
      await take(name);
    } catch (e) { console.log(`  (skipped ${name}: ${e.message.split('\n')[0].slice(0, 90)})`); }
  };

  await take('home');
  await visit('quiz', () => startQuiz(null), '.opt');
  try {
    await page.locator('.opt').first().click();
    await page.waitForTimeout(400);
    await take('quiz-answered');
  } catch (e) { console.log('  (skipped quiz-answered: ' + e.message.split('\n')[0].slice(0, 90) + ')'); }
  for (const s of ['memory', 'refs', 'stats', 'lab', 'echo', 'study', 'notesearch', 'results']) {
    await visit(s, n => { S.screen = n; render(); }, null);
  }
  await visit('home', () => { S.screen = 'home'; render(); }, '.hero-h1');

  const theme = await page.evaluate(() => ({ palette: document.documentElement.getAttribute('data-palette'),
    theme: document.documentElement.getAttribute('data-theme'), contrast: document.documentElement.getAttribute('data-contrast') }));
  console.log(`\nButton census — ${URL.replace(/^file:\/\/.*\//, '')}   palette ${theme.palette || 'default'}  theme ${theme.theme || '-'}\n`);
  const rows = [...all.values()].sort((a, b) => b.n - a.n);
  for (const r of rows) {
    console.log(`${String(r.n).padStart(4)}  ${r.key}`);
    console.log(`        on: ${[...r.screens].join(', ')}`);
    console.log(`        bg ${r.bg}${r.img ? '  img ' + r.img : ''}  color ${r.color}  border ${r.border}  radius ${r.radius}  h ${r.h}px`);
    console.log(`        ${r.shadow ? 'shadow ' + r.shadow + '  ' : ''}${r.blur && r.blur !== 'none' ? 'blur ' + r.blur + '  ' : ''}pos ${r.pos}  overflow ${r.overflow}${r.pseudo ? '  PSEUDO ' + r.pseudo : ''}  transition ${r.trans}`);
  }
  console.log(`\n${rows.length} distinct kinds of button, ${rows.reduce((n, r) => n + r.n, 0)} seen in all`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
