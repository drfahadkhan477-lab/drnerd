#!/usr/bin/env node
/*
 * The shared render waits actually wait — and the trap they warn about is real.
 *
 *   node tests/verify-render.js
 *
 * No target argument and no Systole build: every page here is synthetic,
 * written by this file, and reproduces the mechanism rather than the app. That
 * is deliberate. The race being guarded against is a property of
 * document.startViewTransition, not of Systole, so a fixture that isolates it
 * proves more than one that buries it under 42 MB of question bank — and it
 * runs in three seconds on any machine instead of two minutes on one.
 *
 * WHAT MUST BE PROVEN, in this order:
 *
 *   1. The race exists in the fixture. If reading immediately after a
 *      transition-wrapped mutation saw the NEW markup, the fixture would not
 *      reproduce anything and every check below would be vacuous. This is the
 *      fail-first evidence, asserted rather than assumed.
 *   2. settled() sees through it.
 *   3. quiet() alone does NOT — the trap the header warns about, asserted so
 *      that a future refactor which "simplifies" settled() into quiet() fails
 *      here instead of silently reintroducing all four races.
 *   4. A wait that never comes true reports what it was waiting for.
 */
'use strict';
const { launch, engineName } = require('./_engine.js');
const R = require('./_render.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

/* A page whose only job is to swap one screen for another the way the app
   does: state changes synchronously, markup changes in the transition's async
   callback. The fallback path matters — not every engine ships
   startViewTransition, and where it is missing a deferred callback reproduces
   the same ordering, which is the property under test. */
const FIXTURE = `<!doctype html><html><body>
<div id="app"><h1 class="hero-h1">home</h1></div>
<script>
  var S = { screen: 'home' };
  function render(){
    var swap = function(){
      document.getElementById('app').innerHTML =
        S.screen === 'home' ? '<h1 class="hero-h1">home</h1>'
                            : '<div class="q-counter">Q 1 / 10</div>';
    };
    if (document.startViewTransition) document.startViewTransition(swap);
    else setTimeout(swap, 30);
  }
  function go(screen){ S.screen = screen; render(); }
  /* The same swap, but landing later than a couple of animation frames. This
     is not an artificial delay invented to make a check pass: it is the model
     of the machine these races actually failed on. The owner's laptop renders
     slowly enough that the transition callback lands well after the point this
     container reaches it, which is exactly why all four races were green here
     and red there. A fixture that only ever swaps within two frames cannot
     reproduce the class of bug being guarded against. */
  function goSlow(screen){ S.screen = screen; setTimeout(function(){
    document.getElementById('app').innerHTML =
      screen === 'home' ? '<h1 class="hero-h1">home</h1>'
                        : '<div class="q-counter">Q 1 / 10</div>';
  }, 400); }
</script></body></html>`;

(async () => {
  const browser = await launch();
  const page = await (await browser.newContext()).newPage();
  await page.setContent(FIXTURE);
  console.log(`  engine: ${engineName()}`);

  head('the fixture reproduces the race it is here to guard against');
  await R.booted(page, { timeout: 10000 });
  ok('booted() returns once state and the first render are both up', true);

  /* Reading with no wait at all. If this sees the quiz counter, the fixture is
     not reproducing the deferred swap and nothing below means anything. */
  await page.evaluate(() => go('quiz'));
  const immediate = await page.evaluate(() => ({
    screen: S.screen,
    counter: !!document.querySelector('.q-counter'),
    heroStillThere: !!document.querySelector('.hero-h1'),
  }));
  ok('state changes synchronously', immediate.screen === 'quiz', immediate.screen);
  ok('but the markup has NOT — this is the race, reproduced',
     immediate.counter === false && immediate.heroStillThere === true,
     `counter:${immediate.counter} hero:${immediate.heroStillThere}`);

  head('settled() sees through it');
  await R.settled(page, () => !!document.querySelector('.q-counter'),
                  { label: 'the quiz counter' });
  const after = await page.evaluate(() => ({
    counter: !!document.querySelector('.q-counter'),
    hero: !!document.querySelector('.hero-h1'),
  }));
  ok('the new screen is in the document', after.counter === true);
  ok('and the old one is gone', after.hero === false);

  head('onScreen() waits for the markup, not just the flag');
  await page.evaluate(() => go('home'));
  await R.onScreen(page, 'home', { marker: '.hero-h1', timeout: 10000 });
  ok('onScreen with a marker lands on committed markup',
     await page.evaluate(() => !!document.querySelector('.hero-h1') && S.screen === 'home'));

  head('the trap: quiet() alone is NOT a render wait');
  /* The document is perfectly still between render() returning and the
     transition callback running, so quiescence is satisfied while the OLD
     screen is still up. Asserted so that "simplify settled() to quiet()"
     fails here rather than in four suites six months from now. */
  await page.evaluate(() => goSlow('quiz'));
  const wentQuiet = await R.quiet(page, { timeout: 2000 });
  const duringQuiet = await page.evaluate(() => !!document.querySelector('.q-counter'));
  ok('quiet() reports the document as settled', wentQuiet === true);
  ok('while the screen it settled on is still the OLD one',
     duringQuiet === false,
     duringQuiet ? 'the swap landed inside the quiet window — raise the fixture delay' : '');
  /* And the documented combination gets it right where quiet() alone did not. */
  await R.afterRender(page, () => !!document.querySelector('.q-counter'),
                      { label: 'the quiz counter', timeout: 10000 });
  ok('afterRender() lands on the new screen and lets it finish',
     await page.evaluate(() => !!document.querySelector('.q-counter')));

  head('a wait that never comes true says what it was waiting for');
  let msg = '';
  try {
    await R.settled(page, () => !!document.querySelector('.never-exists'),
                    { label: 'a control that is not in this fixture', timeout: 700 });
  } catch (e) { msg = e.message; }
  ok('it throws rather than hanging to the harness timeout', msg !== '');
  ok('and names the condition, not just a millisecond count',
     /a control that is not in this fixture/.test(msg), msg.slice(0, 90));
  ok('and says which screen it was probably reading',
     /previous one/.test(msg));

  head('booted() is a real wait, not an immediate true');
  const blank = await (await browser.newContext()).newPage();
  await blank.setContent('<!doctype html><html><body><p>nothing here</p></body></html>');
  let bootMsg = '';
  try { await R.booted(blank, { timeout: 700 }); } catch (e) { bootMsg = e.message; }
  ok('a page with no app never satisfies booted()', bootMsg !== '', bootMsg.slice(0, 60));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
