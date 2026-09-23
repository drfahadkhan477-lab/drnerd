#!/usr/bin/env node
/*
 * Does a tall pearl still push the landscape home screen past the viewport?
 *
 *   NODE_PATH=$(npm root -g) node tools/pearl-grid-proof.js
 *
 * THE BUG. On an 11-inch iPad in landscape the home screen is a grid,
 * `auto auto 1fr auto`, with the pearl spanning the first three rows. The
 * grid has a min-height, not a height, so its block size is indefinite, and
 * an indefinite grid sizes a 1fr row to the max-content of what spans it: a
 * tall pearl opened the row and pushed the page. On the owner's laptop, four
 * launches of one build measured
 *
 *   pearl 247 / 159 / 183px  →  rows 268 · 136 · 47 · 245, wrap 732, fits
 *   pearl 367px              →  rows 268 · 136 · 96 · 245, wrap 781, 9px over
 *
 * THE FIX is contain:size on the landscape .pearl-card (homewide-patch), so
 * the card takes the area the rows give it and scrolls inside it.
 *
 * WHY A TOOL. The suites that hold this — verify-home and verify-pwa — need
 * the licensed build. This needs none, so the fix can be checked on any
 * machine in a second.
 *
 * NOTHING UNDER TEST IS A COPY. The landscape CSS block is read out of
 * scripts/homewide-patch.js — from HEAD~ and from the working tree, when a
 * revision is given, so the before and after are the real before and after
 * — and the check is read out of tests/verify-home.js. What IS written here
 * is the environment: the three fixed row heights, the 62px nav, the two
 * base pearl rules homeflow-patch writes, and border-box sizing, which the
 * app sets globally. With those, the CSS from before the fix reproduces the
 * owner's numbers exactly — both the fitting launches and the failing one —
 * which is what makes the fixture evidence rather than a sketch.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { launch } = require('../tests/_engine.js');

const ROOT = path.join(__dirname, '..');
const BEFORE_REV = process.argv[2] || null;   // e.g. a commit before the fix

const block = src => {
  const a = src.indexOf('@media (min-width:1024px) and (orientation:landscape){');
  const b = src.indexOf('\n/* iPAD landscape / iPad Pro */', a);
  if (a < 0 || b < 0) throw new Error('landscape block not found in homewide-patch.js');
  return src.slice(a, b);
};
const NOW = block(fs.readFileSync(path.join(ROOT, 'scripts', 'homewide-patch.js'), 'utf8'));
/* THE BEFORE, reconstructed from NOW rather than fetched, when no revision is
   given: the fix is one declaration, and removing it is the defect. If the
   declaration is not there to remove, the fix is gone and that is reported
   rather than silently proving the same CSS twice. */
let BEFORE;
if (BEFORE_REV) {
  BEFORE = block(execSync(`git -C "${ROOT}" show ${BEFORE_REV}:scripts/homewide-patch.js`, { encoding: 'utf8' }));
} else {
  if (!/min-height:0;contain:size\}/.test(NOW)) {
    console.error('the fix is not in scripts/homewide-patch.js — nothing to compare');
    process.exit(1);
  }
  BEFORE = NOW.replace('min-height:0;contain:size}', 'min-height:0}');
}

/* The check, from verify-home: the body of its page.evaluate. */
const home = fs.readFileSync(path.join(ROOT, 'tests', 'verify-home.js'), 'utf8');
const cs = home.indexOf("const pb = document.getElementById('pearlBody');");
const ce = home.indexOf('h: Math.round(pb.getBoundingClientRect().height) };', cs);
if (cs < 0 || ce < 0) { console.error('could not extract the tall-pearl check from verify-home.js'); process.exit(1); }
const CHECK = home.slice(cs, ce + 'h: Math.round(pb.getBoundingClientRect().height) };'.length);

const PEARL = 'The threshold of forty millimetres should be confirmed on a repeated ' +
  'study before it is acted upon, because a single reading varies with loading conditions.';
const page = (css, body) => `<!doctype html><html><head><style>
  *,*::before,*::after{box-sizing:border-box}
  :root{--navh:62px;--sat:0px}
  body{margin:0;padding-top:62px;font:16px/1.4 sans-serif}
  nav{position:fixed;top:0;left:0;right:0;height:62px}
  .pearl-card{position:relative;display:flex;gap:0;align-items:stretch}
  .pearl-main{flex:1;min-width:0;padding:22px 24px 46px}
  .pearl-body{margin:0;font-size:23px;line-height:1.45}
  .pearl-open{display:block;height:65px}
  .hero-live{height:268px} .home-progress{height:122px} .door-row{height:227px}
  ${css}
</style></head><body><nav></nav>
<main id="app" data-screen="home"><div class="home-wrap">
  <div class="hero-live"></div><div class="home-progress"></div>
  <div class="pearl-card"><div class="pearl-main">${body}<div class="pearl-open"></div></div></div>
  <div class="door-row"></div>
</div></main></body></html>`;

(async () => {
  const b = await launch();
  const p = await b.newPage({ viewport: { width: 1194, height: 834 } });
  const verdict = r => !!r && r.h > 600 && r.over <= 0;   // verify-home's condition
  let bad = 0;
  const run = async (name, html, wantPass) => {
    await p.setContent(html);
    const r = await p.evaluate(`(() => { ${CHECK} })()`);
    const pass = verdict(r);
    if (pass !== wantPass) bad++;
    console.log(`  ${pass === wantPass ? 'as expected' : 'WRONG      '}  ${name.padEnd(46)}` +
      `check ${pass ? 'PASSES' : 'FAILS '}  → ${r ? `${r.over}px over, ${r.h}px pearl` : 'no pearl'}`);
  };
  const body = `<p class="pearl-body" id="pearlBody">${PEARL}</p>`;
  console.log(`landscape CSS from scripts/homewide-patch.js; check from tests/verify-home.js\n`);
  await run('before the fix, a manufactured tall pearl', page(BEFORE, body), false);
  await run('after the fix, the same tall pearl', page(NOW, body), true);
  /* The two ways it could pass without measuring. */
  await run('no pearl on screen at all', page(NOW, '<p>none</p>'), false);
  await run('a pearl that cannot grow (fixed 200px)',
    page(NOW, `<p class="pearl-body" id="pearlBody" style="height:200px;overflow:hidden">${PEARL}</p>`), false);
  await b.close();
  console.log(bad ? `\n${bad} not as expected` : '\nall as expected');
  process.exit(bad ? 1 : 0);
})();
