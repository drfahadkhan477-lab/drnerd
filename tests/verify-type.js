#!/usr/bin/env node
/*
 * Checks the type scale and the spacing scale hold.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-type.js <patched.html>
 *
 * A design system's failure mode is not a crash — it is the twenty-ninth font
 * size, added six months later by someone who needed "just a bit smaller than
 * 13". Nothing breaks; the system simply stops being one. So this reads the
 * shipped stylesheet and asserts the invariants directly:
 *
 *   · every fixed font-size is a step on the ladder, and there are no more
 *     steps than the ladder has;
 *   · the ladder really is a minor third — each step ~1.2x the one below, which
 *     is what makes it a scale rather than a list;
 *   · the reading roles sit at the body step at every viewport, because the
 *     most-read text in a study app must not be the smallest thing on screen;
 *   · the spacing tokens exist and every one is a multiple of 4.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { launch } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-type.js <patched.html>'); process.exit(1); }
const FILE = path.resolve(target);
const URL = 'file://' + FILE;

let passed = 0, failed = 0;
const ok = (l, c, d = '') => { c ? passed++ : failed++; console.log((c ? '  PASS  ' : '  FAIL  ') + l + (d ? '  → ' + d : '')); };
const head = t => console.log('\n── ' + t + ' ──');

const LADDER = [9, 11, 13, 16, 19, 23, 28, 33, 40, 48, 58];

(async () => {
  const css = fs.readFileSync(FILE, 'utf8');

  head('the type scale');
  const sizes = [...new Set([...css.matchAll(/font-size:([0-9.]+)px/g)].map(m => parseFloat(m[1])))].sort((a, b) => a - b);
  const stray = sizes.filter(v => !LADDER.includes(v));
  ok('every fixed font-size is a step on the ladder', stray.length === 0, stray.length ? stray.join(', ') : sizes.join(' '));
  ok('the app uses far fewer sizes than it did (was 28)', sizes.length <= 11, `${sizes.length} steps`);
  ok('no half-pixel sizes survive', !sizes.some(v => v % 1 !== 0));

  /* A scale is a ratio, not a list. Check the ladder itself is geometric. */
  const ratios = LADDER.slice(1).map((v, i) => v / LADDER[i]);
  const off = ratios.filter(r => r < 1.14 || r > 1.28);
  ok('the ladder is a minor third throughout (~1.2x per step)', off.length === 0,
     ratios.map(r => r.toFixed(2)).join(' '));

  head('the spacing scale');
  const toks = [...css.matchAll(/--s(\d+):(\d+)px/g)].map(m => ({ n: +m[1], v: +m[2] }));
  ok('spacing tokens are defined', toks.length >= 10, `${toks.length} tokens`);
  const nonFour = toks.filter(t => t.v % 4 !== 0 && t.v !== 2);
  ok('every step is a multiple of 4 (bar the 2px hairline)', nonFour.length === 0,
     nonFour.map(t => `--s${t.n}:${t.v}`).join(' '));
  ok('the tokens are actually used, not just declared',
     (css.match(/var\(--s\d+\)/g) || []).length >= 20,
     `${(css.match(/var\(--s\d+\)/g) || []).length} uses`);

  head('the reading roles hold the body step at every width');
  const browser = await launch();
  const errors = [];
  for (const vw of [1280, 834, 460, 390]) {
    const page = await browser.newPage({ viewport: { width: vw, height: 1000 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
    await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 150000 });
    await page.evaluate(() => startQuiz(null));
    await page.waitForTimeout(900);
    const fs2 = await page.evaluate(() => {
      const c = document.querySelector('.q-card');
      return c ? parseFloat(getComputedStyle(c).fontSize) : null;
    });
    ok(`the question stem is 16px at ${vw}px wide`, fs2 === 16, `${fs2}px`);
    await page.close();
  }
  ok('no page errors while checking', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
