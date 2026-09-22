#!/usr/bin/env node
/*
 * Does verify-layout's overflow culprit-finder name the right element?
 *
 *   NODE_PATH=$(npm root -g) node tools/layout-culprit-proof.js
 *
 * WHY IT IS A TOOL AND NOT A SUITE. widestOverflow() runs only when a screen
 * has ALREADY failed the sideways check, which is the one moment nobody is
 * also checking the diagnostic. But it takes no build, and verify-layout does
 * — so folding it into that suite would make it unreachable on any machine
 * without the licensed export, which is every machine this was written on.
 * It runs standalone in about a second instead.
 *
 * IT EXTRACTS THE SHIPPED FUNCTION rather than restating it. A proof of a
 * second copy proves the second copy; this project has the scars.
 *
 * The four fixtures are the four answers that matter: a clean page names
 * nothing, a flex row too wide names the row, a wide table three deep names
 * the table rather than the anonymous `td`, and a small real overflow sitting
 * behind a pointer-events:none bleed and a left-hand overhang still names the
 * real one. That last is the case the first draft got wrong — it took
 * max(right - w, -left) and named a 30px left overhang as the cause of a 9px
 * sideways scroll.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { launch } = require('../tests/_engine.js');

const LAYOUT = path.join(__dirname, '..', 'tests', 'verify-layout.js');
const src = fs.readFileSync(LAYOUT, 'utf8');
const start = src.indexOf('function widestOverflow() {');
const end = src.indexOf("\n    }\n", src.indexOf("return ' [' + chain")) + 6;
if (start < 0 || end < 6) { console.error('could not extract widestOverflow'); process.exit(1); }
const FINDER = src.slice(start, end);
console.log('extracted ' + FINDER.split('\n').length + ' lines of widestOverflow() from tests/verify-layout.js\n');

const page_ = w => `<!doctype html><meta name=viewport><style>body{margin:0}${w}`;
const CLEAN = page_(`.row{display:flex}.row>div{width:100px;height:40px;background:#ccc}</style>
  <body><div class="row"><div></div><div></div></div></body>`);
const NAV = page_(`.nav{display:flex;height:44px}.icon-btn{width:44px;height:44px;flex:none}</style>
  <body><header><nav class="nav">${'<button class="icon-btn"></button>'.repeat(10)}</nav></header></body>`);
const DEEP = page_(`table{border-collapse:collapse}td{min-width:120px;height:20px;border:1px solid}</style>
  <body><main id="app"><section class="echo-studio"><div class="echo-panel">
  <table class="echo-results"><tr>${'<td></td>'.repeat(6)}</tr></table></div></section></main></body>`);
const OFFLEFT = page_(`.slab{position:relative;left:-30px;width:200px;height:60px;background:#ccc}</style>
  <body><div id="app"><div class="slab"></div></div></body>`);
/* The case that matters most: a small real overflow hiding behind a large
   decorative bleed and a large left-hand overhang. */
const MIXED = page_(`.glow{position:absolute;left:-20%;right:-20%;top:0;height:80px;
    background:#eee;pointer-events:none}
  .slab{position:relative;left:-30px;width:200px;height:60px;background:#ccc}
  .bar{width:399px;height:30px;background:#333}</style>
  <body><div id="app"><div class="glow"></div><div class="slab"></div>
  <div class="bar"></div></div></body>`);

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let bad = 0;
  for (const [name, html, expect] of [
    ['a clean page names nothing', CLEAN, ''],
    ['a nav row of ten 44px buttons', NAV, 'nav.nav'],
    ['a wide table three deep', DEEP, 'table.echo-results'],
    ['content pushed off the left edge is not named', OFFLEFT, ''],
    ['a 9px overflow behind decoration and an overhang', MIXED, 'div.bar'],
  ]) {
    await page.setContent(html);
    const over = await page.evaluate('(()=>{const d=document.documentElement;return Math.round(d.scrollWidth-d.clientWidth)})()');
    const got = await page.evaluate(`(() => { ${FINDER} return widestOverflow(); })()`);
    const pass = expect === '' ? got === '' : String(got).includes(expect);
    if (!pass) bad++;
    console.log((pass ? '  PASS  ' : '  FAIL  ') + name.padEnd(52) +
                'scrollWidth over ' + String(over).padStart(4) + 'px   →' + (got || ' (nothing)'));
  }
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
