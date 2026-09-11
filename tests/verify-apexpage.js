#!/usr/bin/env node
/*
 * Apex takes the whole page when asked, and its answers are set like prose.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-apexpage.js <patched.html>
 *   NODE_PATH=$(npm root -g) node tests/verify-apexpage.js http://localhost:8137
 *
 * TWO HALVES, AND THE SECOND ONE IS WHERE THE BUG WAS.
 *
 * FULL PAGE. The panel's geometry is set by four different #ai rules, several
 * inside media queries. Full-page mode overrides them by specificity rather
 * than order (#shell.ai-full #ai), which is the kind of thing that works until
 * someone appends one more media query. So this suite does not check that a
 * class was added — it measures the rendered box against the viewport, which
 * is the thing that actually breaks.
 *
 * MARKDOWN. md() turned `1. one` and `- one` both into a bare <li> and wrapped
 * every run in <ul>, so every numbered list Apex ever wrote rendered as
 * bullets with the numbers thrown away. In an app that teaches sequences —
 * the steps of an algorithm, the order of a work-up — that is not cosmetic.
 * The checks below are written against md() directly rather than against a
 * mocked reply, because md() is the whole of the claim and going through a
 * fake provider would only add ways for the test to be flaky.
 */
'use strict';
const path = require('path');
const { launch, isEngineNoise } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-apexpage.js <patched.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !isEngineNoise(m.text())) errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
  await page.waitForTimeout(600);

  head('how an answer is turned into markup');
  const md = await page.evaluate(() => {
    const out = {};
    out.ordered = md('1. first\n2. second\n3. third');
    out.unordered = md('- alpha\n- beta');
    out.mixed = md('1. first\n2. second\n- a bullet\n- another');
    /* A literal '>' — md() runs e() over its input first, so passing the
       already-escaped entity here would have tested nothing. */
    out.quote = md('> a quoted line\n> and its continuation');
    out.rule = md('above\n\n---\n\nbelow');
    out.heading = md('## A section\n\nBody text.');
    return out;
  }).catch(e => ({ error: String(e) }));

  ok('md() is reachable from the page', !md.error, md.error || '');
  if (!md.error) {
    const ol = (md.ordered.match(/<ol>/g) || []).length;
    ok('a numbered list becomes an <ol>, not a bullet list',
       ol === 1 && !/<ul>/.test(md.ordered), md.ordered.slice(0, 90));
    ok('and it keeps all three items', (md.ordered.match(/<li>/g) || []).length === 3,
       `${(md.ordered.match(/<li>/g) || []).length} items`);
    ok('a dashed list is still a <ul>',
       /<ul>/.test(md.unordered) && !/<ol>/.test(md.unordered), md.unordered.slice(0, 80));
    /* The interesting case: a run that changes kind halfway is two lists. The
       old code produced one <ul> holding all four, which is how the numbers
       disappeared without anything looking wrong. */
    ok('a run that changes kind halfway becomes two lists',
       /<ol>/.test(md.mixed) && /<ul>/.test(md.mixed)
       && (md.mixed.match(/<li>/g) || []).length === 4,
       md.mixed.slice(0, 130));
    ok('a quoted run becomes one <blockquote>, not one per line',
       (md.quote.match(/<blockquote>/g) || []).length === 1, md.quote.slice(0, 100));
    /* Not just "an <hr> appeared" — the first version of this rule produced
       one inside the paragraph it was meant to divide, which looked right in
       the string and wrong on the page. */
    ok('a bare rule becomes an <hr> that actually separates the two paragraphs',
       /<p>above<\/p>\s*<hr>\s*<p>below<\/p>/.test(md.rule), md.rule.slice(0, 110));
    ok('a heading is still a heading, and its body is still a paragraph',
       /<h3>A section<\/h3>/.test(md.heading) && /<p>Body text\.<\/p>/.test(md.heading));
  }

  head('the panel can take the whole page');
  const open = () => page.evaluate(() => {
    AI.provider = 'gemini';
    AI.gemini = { key: 'test-gemini-key', model: 'gemini-2.5-flash' };
    const sh = document.getElementById('shell');
    if (!sh.classList.contains('ai-open')) toggleAI(); else buildAI();
  });
  await open();
  await page.waitForTimeout(350);

  const geoOf = () => page.evaluate(() => {
    const ai = document.getElementById('ai');
    const app = document.getElementById('app');
    const sh = document.getElementById('shell');
    const r = ai.getBoundingClientRect();
    const body = document.getElementById('aiBody');
    return {
      full: sh.classList.contains('ai-full'),
      w: Math.round(r.width), h: Math.round(r.height),
      vw: window.innerWidth, vh: window.innerHeight,
      appVisible: getComputedStyle(app).visibility !== 'hidden',
      bodyW: body ? Math.round(body.getBoundingClientRect().width) : 0,
      hasButton: !!document.querySelector('.ai-head [onclick="toggleApexFull()"]'),
    };
  });

  const side = await geoOf();
  ok('the header carries the expand button', side.hasButton);
  ok('as a side panel it takes part of the width, not all of it',
     side.w > 0 && side.w < side.vw * 0.75, `${side.w} of ${side.vw}px`);

  await page.evaluate(() => toggleApexFull());
  await page.waitForTimeout(350);
  const full = await geoOf();
  ok('expanding sets the full-page state', full.full);
  /* The measurement that matters: specificity actually beat the media-query
     rules, and the panel really is the width of the window. */
  ok('and the panel really spans the viewport', full.w >= full.vw - 2,
     `${full.w} of ${full.vw}px`);
  ok('the quiz behind it is hidden rather than showing through', !full.appVisible);
  ok('the thread keeps a readable measure instead of running the full width',
     full.bodyW > 0 && full.bodyW <= 900, `${full.bodyW}px column in a ${full.vw}px window`);

  head('and gives the page back');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const afterEsc = await geoOf();
  ok('Escape returns it to the side panel', !afterEsc.full);
  ok('and the panel is still open, not dismissed by the same press',
     afterEsc.w > 0 && afterEsc.appVisible, `${afterEsc.w}px wide`);

  /* Closing while full must not leave the flag set: the next tap on the FAB
     would otherwise take the whole screen with no warning. */
  await page.evaluate(() => { toggleApexFull(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { toggleAI(); });
  await page.waitForTimeout(200);
  const closed = await page.evaluate(() => {
    const sh = document.getElementById('shell');
    let stored = null; try { stored = localStorage.getItem('accsap12.aifull'); } catch (_) {}
    return { full: sh.classList.contains('ai-full'), open: sh.classList.contains('ai-open'), stored };
  });
  ok('closing the panel clears full-page too', !closed.full && !closed.open);
  ok('and clears it in storage, so the next launch is not a surprise',
     closed.stored === '0', `stored ${closed.stored}`);

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
