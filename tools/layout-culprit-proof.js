#!/usr/bin/env node
/*
 * Do the two overflow leads name the right element?
 *
 *   NODE_PATH=$(npm root -g) node tools/layout-culprit-proof.js
 *
 * Two functions, one per axis, each printed only beside a check that has
 * ALREADY failed — which is the one moment nobody is also checking the
 * diagnostic:
 *
 *   widestOverflow()  tests/verify-layout.js  a screen scrolls sideways
 *   lowestInApp()     tests/verify-pwa.js     the landscape home scrolls down
 *
 * They are separate because the failures are. The --pwa phase never runs
 * verify-layout, and its one pixel check is vertical; a "9px over" from
 * there was first chased with the sideways finder, which could never have
 * explained it.
 *
 * WHY IT IS A TOOL AND NOT A SUITE. Both host suites need a build, and this
 * needs none, so folding it into either would make it unrunnable on every
 * machine without the licensed export. It runs standalone in a moment.
 *
 * IT EXTRACTS THE SHIPPED FUNCTIONS rather than restating them. A proof of a
 * second copy proves the second copy; this project has the scars.
 *
 * The fixtures are the answers that matter on each axis, including the two
 * each first draft got wrong: a left-hand overhang named as the cause of a
 * sideways scroll, and decoration named as the cause of anything. The
 * vertical set adds the case its numbers exist for — a page that scrolls
 * while its lowest content ends inside the viewport, which is padding, not
 * content, and a different fix.
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
  /* ── the vertical one, from tests/verify-pwa.js ─────────────────────────
     The --pwa phase never runs verify-layout. Its one pixel check is
     vertical — the landscape home screen must not scroll — and it is where
     a real "9px over" came from, which the sideways finder above could never
     have explained. Same method: extract, drive, compare. */
  const pwa = fs.readFileSync(path.join(__dirname, '..', 'tests', 'verify-pwa.js'), 'utf8');
  const vs = pwa.indexOf('function lowestInApp() {');
  const ve = pwa.indexOf('\n      }\n', pwa.indexOf('ends at ${Math.round(bottom)}')) + 8;
  if (vs < 0 || ve < 8) { console.error('could not extract lowestInApp'); process.exit(1); }
  const LOWEST = pwa.slice(vs, ve);
  console.log('\nextracted ' + LOWEST.split('\n').length + ' lines of lowestInApp() from tests/verify-pwa.js\n');

  const grid = (extra, cardH, appPad) => `<!doctype html><style>body{margin:0}
    #app{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:400px auto;gap:10px;
         padding-bottom:${appPad}px}
    .area{background:#ddd} .pearl-card{height:${cardH}px;background:#999}${extra}</style>
    <body><main id="app">
      <section class="hero area" style="height:400px"></section>
      <section class="doors area" style="height:400px"></section>
      <section class="today area"><div class="pearl-card"></div></section>
      <section class="spare area" style="height:100px"></section>
    </main></body>`;
  await page.setViewportSize({ width: 1194, height: 834 });
  for (const [name, html, expect] of [
    ['a home that fits names its lowest, inside', grid('', 400, 0), 'ends at 810 of 834'],
    ['a pearl card 9px too tall is named', grid('', 433, 0), 'section.today > div.pearl-card, 433px tall, ends at 843 of 834'],
    ['padding below the content is told apart', grid('', 400, 40), 'ends at 810 of 834'],
    ['decoration reaching further is skipped',
       grid('.glow{position:absolute;top:0;left:0;width:10px;height:1000px;pointer-events:none}', 433, 0)
         .replace('<main id="app">', '<main id="app"><div class="glow"></div>'),
       'div.pearl-card, 433px tall'],
  ]) {
    await page.setContent(html);
    const over = await page.evaluate('document.documentElement.scrollHeight - innerHeight');
    const got = await page.evaluate(`(() => { ${LOWEST} return lowestInApp(); })()`);
    const pass = String(got).includes(expect);
    if (!pass) bad++;
    console.log((pass ? '  PASS  ' : '  FAIL  ') + name.padEnd(52) +
                'page over ' + String(over).padStart(4) + 'px   →' + (got || ' (nothing)'));
  }

  await browser.close();
  process.exit(bad ? 1 : 0);
})();
