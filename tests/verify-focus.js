#!/usr/bin/env node
/*
 * Focus Mode: the quiz without the chrome, and everything that must survive it.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-focus.js /path/to/build.html
 *
 * The feature is two CSS declarations and one attribute, so the interesting
 * claims are not "does it hide the bar" but the ones around the edges:
 *
 *   · the control is offered only on the screen it acts on, because
 *     applyFocus() applies the mode only while the quiz is up — a button on
 *     Home would flip, save, re-render and visibly do nothing;
 *   · the space the bar held actually comes back, which is --navh reaching 0
 *     and not merely the bar being invisible above a gap where it was;
 *   · what focus mode must NOT take: the progress bar, and the confidence
 *     row, which feeds calib.js — hiding that would change what gets
 *     recorded, which is a behaviour change dressed as a layout one;
 *   · there is a way out that cannot be rendered away, and it is big enough
 *     to hit on a tablet;
 *   · walking off the quiz restores the chrome without anything having to
 *     remember to.
 *
 * ON THE WAITS. Nothing here waits for data-focus to become what the next
 * line asserts — that is the tautology this project keeps catching itself
 * writing, and a wait that IS the proposition fails as a timeout rather than
 * as a finding. After a toggle we wait for the page to go quiet, which is
 * true whether the feature works or not, and then read.
 */
'use strict';
const path = require('path');
const { launch, isEngineNoise } = require('./_engine');
const { booted, onScreen, quiet } = require('./_render.js');
const { onDeath } = require('./_deathnote.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-focus.js <patched.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

const FOCUS_BTN = '#navbar [onclick="toggleFocusMode()"]';

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errors = [];
  const events = [];
  page.on('crash', () => events.push('the browser CRASHED the page'));
  page.on('close', () => events.push('the page closed'));
  page.on('requestfailed', r => {
    const why = (r.failure() || {}).errorText || '';
    if (why) events.push(`request failed: ${String(r.url()).slice(-50)} — ${why}`);
  });
  onDeath(() => ({ section, checks: passed + failed, errors,
                   events: events.length ? events.join(', ') : 'none' }));
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !isEngineNoise(m.text())) errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);

  head('the control is offered only on the screen it acts on');
  {
    const onHome = await page.evaluate(sel => ({
      screen: S.screen, btn: !!document.querySelector(sel),
    }), FOCUS_BTN);
    ok('the app opens on home', onHome.screen === 'home', onHome.screen);
    ok('and offers no focus control there, where it could not do anything',
       onHome.btn === false);

    await page.evaluate(() => startQuiz(CHAPTERS[0], 'all'));
    await onScreen(page, 'quiz', { marker: '.q-card' });
    const onQuiz = await page.evaluate(sel => {
      const b = document.querySelector(sel);
      return { btn: !!b, pressed: b && b.getAttribute('aria-pressed') };
    }, FOCUS_BTN);
    ok('the quiz screen offers it', onQuiz.btn);
    ok('and reports itself off to a screen reader before it is pressed',
       onQuiz.pressed === 'false', String(onQuiz.pressed));
  }

  head('turning it on takes the bar away AND gives its space back');
  {
    const before = await page.evaluate(() => ({
      navShown: getComputedStyle(document.getElementById('navbar')).display !== 'none',
      navh: getComputedStyle(document.documentElement).getPropertyValue('--navh').trim(),
      attr: document.documentElement.getAttribute('data-focus'),
    }));
    ok('the bar is there to begin with', before.navShown, `display !== none`);
    ok('and --navh is reserving real space', /^[1-9]/.test(before.navh), before.navh);
    ok('with no focus attribute set', before.attr === null, String(before.attr));

    await page.evaluate(() => toggleFocusMode());
    await quiet(page);

    const after = await page.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-focus'),
      navShown: getComputedStyle(document.getElementById('navbar')).display !== 'none',
      navh: getComputedStyle(document.documentElement).getPropertyValue('--navh').trim(),
      shellPad: getComputedStyle(document.getElementById('shell')).paddingTop,
    }));
    ok('the attribute goes on', after.attr === '1', String(after.attr));
    ok('the bar is gone', after.navShown === false);
    /* Not the same claim as the line above, and the reason this suite exists:
       display:none alone would leave #shell still padding down past a bar that
       is no longer there. --navh is what both #shell and #ai measure from. */
    ok('and the space it held is actually reclaimed, not merely vacated',
       parseFloat(after.navh) === 0, `--navh ${after.navh}, #shell padding-top ${after.shellPad}`);
  }

  head('and it keeps what the quiz needs');
  {
    const kept = await page.evaluate(() => {
      const shown = sel => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).display !== 'none' : null;
      };
      return { prog: shown('.prog-fill'), cf: shown('.cf-row'), card: shown('.q-card') };
    });
    ok('the question is still on screen', kept.card === true);
    ok('the progress bar is still visible — knowing where you are is the point',
       kept.prog === true, `.prog-fill ${kept.prog}`);
    /* Reported either way rather than skipped: if the confidence row is not in
       this build at all the claim is "focus mode did not remove it", which is
       still the thing being defended. */
    ok('the confidence row is untouched by focus mode',
       kept.cf === true || kept.cf === null,
       kept.cf === null ? '.cf-row not present in this build' : '.cf-row visible');
  }

  head('there is a way out, and it can be hit');
  {
    const exit = await page.evaluate(() => {
      const el = document.getElementById('focusExit');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { shown: getComputedStyle(el).display !== 'none',
               w: Math.round(r.width), h: Math.round(r.height),
               label: el.getAttribute('aria-label') };
    });
    ok('the exit exists while focus mode is on', !!exit && exit.shown, exit ? 'shown' : 'not in the document');
    ok('it is a 44px target, not a 24px one', !!exit && exit.w >= 44 && exit.h >= 44,
       exit ? `${exit.w}x${exit.h}` : 'n/a');
    ok('and it says what it does', !!exit && /leave focus/i.test(exit.label || ''), exit && exit.label);

    await page.click('#focusExit');
    await quiet(page);
    const out = await page.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-focus'),
      navShown: getComputedStyle(document.getElementById('navbar')).display !== 'none',
      flag: S.focusMode,
    }));
    ok('pressing it turns focus mode off', out.attr === null && out.flag === false,
       `attr ${out.attr}, S.focusMode ${out.flag}`);
    ok('and the bar comes back', out.navShown === true);
  }

  head('walking off the quiz restores the chrome by itself');
  {
    await page.evaluate(() => toggleFocusMode());
    await quiet(page);
    const onQuiz = await page.evaluate(() => document.documentElement.getAttribute('data-focus'));
    ok('focus mode is on again', onQuiz === '1', String(onQuiz));

    await page.evaluate(() => goHome());
    await onScreen(page, 'home');
    const home = await page.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-focus'),
      flag: S.focusMode,
      navShown: getComputedStyle(document.getElementById('navbar')).display !== 'none',
    }));
    ok('the attribute is dropped on another screen', home.attr === null, String(home.attr));
    ok('the bar is back on home', home.navShown === true);
    /* The preference is not the same thing as the mode being applied: it
       stays on so the next question is focused too. */
    ok('but the preference is still on', home.flag === true, String(home.flag));
  }

  head('the preference survives the app being closed');
  {
    await page.reload({ waitUntil: 'load', timeout: 200000 });
    await booted(page);
    const restored = await page.evaluate(() => S.focusMode);
    ok('it is still on after a reload', restored === true, String(restored));

    await page.evaluate(() => startQuiz(CHAPTERS[0], 'all'));
    await onScreen(page, 'quiz', { marker: '.q-card' });
    await quiet(page);
    const applied = await page.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-focus'),
      navShown: getComputedStyle(document.getElementById('navbar')).display !== 'none',
    }));
    ok('and the next quiz opens focused, without being asked again',
       applied.attr === '1' && applied.navShown === false, `attr ${applied.attr}`);
  }

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
