#!/usr/bin/env node
/*
 * No canvas draws what nobody can see.
 *
 *   node tests/verify-frames.js build/synthetic/systole.html
 *
 * Roadmap E5: measure battery on the iPad, then set a frame budget, and before that confirm every canvas stops when it is
 * off screen or the page is hidden. The page is opened with #frames, which installs src/core/framemeter.js (held in Node by
 * verify-framemeter-pure) and shows its line; that meter is what counts here, frame by frame and canvas by canvas.
 *
 * The rules:
 *   · while the page is hidden nothing draws outside requestAnimationFrame. A browser stops that for a hidden page; a timer
 *     drawing behind it is one nothing stops. The hidden page is the document's own two properties set to hidden and its
 *     visibilitychange sent, so the app's handlers run as they would; the browser here keeps running frames regardless,
 *     which is why the rule is about what draws outside them.
 *   · and the home screen's own canvases stop when it is hidden, without waiting for the browser to;
 *   · once a move between home pages or screens has settled, no canvas draws while off screen. The move itself may draw a
 *     few frames as the page slides, which is what lets it arrive moving; this counts the two seconds after it.
 *
 * NOT CLAIMED: how fast anything draws. This browser draws WebGL in software, at a few frames a second where an iPad draws
 * sixty, so a frame rate measured here says nothing about the device. What is drawing, and where, does not depend on that.
 * The frame rates go in the detail of each line so a reader can see them, and no check is made of them.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, quiet, settled } = require('./_render.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-frames.js <build.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);
const WINDOW = 2000;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

(async () => {
  const browser = await launch();
  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));
  const page = watch(await browser.newPage({ viewport: { width: 1194, height: 834 } }), events, 'main');
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL + '#frames', { waitUntil: 'load', timeout: 200000 });
  await booted(page);
  await quiet(page);

  /* What the meter counted in one window, by canvas: frames per second at the end, and what was drawn unseen in it. */
  const measure = async () => {
    await page.evaluate(() => FrameMeter.install(window).reset());
    await page.waitForTimeout(WINDOW);
    return page.evaluate(() => FrameMeter.install(window).snapshot().filter(r => r.total > 0));
  };
  const say = rows => rows.map(r => `${r.name.split(' in ')[0]} ${r.total} frames, ${r.offscreen} off screen, ${r.hiddenOutsideFrame} hidden`).join('; ') || 'nothing drew';
  const HERO = ['#heroECG', '#heroHeart3d'];
  const named = (rows, id) => rows.find(r => r.name.split(' in ')[0] === id);

  head('the #frames line is there, and counts what the home screen draws');
  {
    const shown = await settled(page, () => !!document.getElementById('framesLine') && /^frames\/s/.test(document.getElementById('framesLine').textContent),
      { label: 'the #frames line' }).then(() => true, () => false);
    ok('opening the app with #frames shows the line', shown);
    if (!shown) { console.log(`\n${passed} passed, ${failed} failed`); await browser.close(); process.exit(1); }
    const rows = await measure();
    const line = await page.evaluate(() => document.getElementById('framesLine').textContent);
    ok('the home screen\'s hero canvases are drawing, so what follows measures something',
       HERO.every(id => (named(rows, id) || {}).total > 0), say(rows));
    ok('and the line names them', HERO.every(id => line.includes(id)), line);
  }

  head('hidden');
  {
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const rows = await measure();
    ok('nothing draws outside an animation frame while the page is hidden', rows.every(r => r.hiddenOutsideFrame === 0), say(rows));
    ok('and the home screen\'s canvases stop without waiting for the browser to', HERO.every(id => !named(rows, id)), say(rows));
    await page.evaluate(() => {
      delete document.hidden; delete document.visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const back = await measure();
    ok('and they start again when it is shown', HERO.every(id => (named(back, id) || {}).total > 0), say(back));
  }

  head('off screen, after a move has settled');
  for (const [where, go, want, lab] of [
    ['the Brain page of home', () => homeGo(1), () => S.screen === 'home' && homePage === 1],
    ['the Labs page of home', () => homeGo(2), () => S.screen === 'home' && homePage === 2],
    ['back to the first page of home', () => homeGo(0), () => S.screen === 'home' && homePage === 0],
    ['Study', () => goStudy(), () => S.screen === 'study'],
    ['the quiz', () => startQuiz(null, 'due'), () => S.screen === 'quiz'],
    ['Practice', () => goPractice(), () => S.screen === 'practice'],
    ['the Lab', () => goLab(), () => S.screen === 'lab' && !!document.getElementById('labCanvas'), true],
  ]) {
    await page.evaluate(go);
    await settled(page, want, { label: where });
    await page.waitForTimeout(1500);   // the slide or the screen change, which may draw a few frames as it moves
    const rows = await measure();
    ok(`${where}: no canvas draws off screen`, rows.every(r => r.offscreen === 0), say(rows));
    if (lab) ok('and the Lab\'s monitor is one of those drawing, so the Lab measured something', !!named(rows, '#labCanvas'), say(rows));
  }
  /* The cardiac-cycle diagram sits below the fold on the Lab at this size: it drew every frame there until src/ui/wiggers.js
     stopped drawing out of view. Scrolled to, it must draw again, or "nothing off screen" would be bought by drawing nothing. */
  {
    await page.locator('#physioCanvas').scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    const rows = await measure();
    const cycle = named(rows, '#physioCanvas');
    ok('scrolled to, the Lab\'s cardiac-cycle diagram draws again, on screen', !!cycle && cycle.total > 0 && cycle.offscreen === 0, say(rows));
    ok('and the monitor above it, now out of view, has stopped drawing', rows.every(r => r.offscreen === 0), say(rows));
  }

  head('the line goes when it is tapped');
  {
    await page.click('#framesLine');
    const gone = await page.evaluate(() => ({ line: !!document.getElementById('framesLine'), kept: sessionStorage.getItem('systole.frames') }));
    ok('tapping the line closes it and stops it coming back on reload', !gone.line && gone.kept === null, JSON.stringify(gone));
  }

  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
