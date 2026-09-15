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
const fs = require('fs');
const path = require('path');

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

/* ── every wait in this repo waits as long as it says it does ───────────── */
/* THE BUG THIS CATCHES, which hid in plain sight across 69 call sites.
   Playwright's signature is waitForFunction(pageFunction, arg, options). Write
   it with two arguments — waitForFunction(pred, { timeout: 120000 }) — and the
   object binds to `arg`, is handed to the predicate, which ignores it, and the
   wait runs on the DEFAULT 30 second timeout. The number is not overridden or
   clamped; it is simply never read.

   Nothing fails loudly. The suite still passes on a fast machine, and on a
   slow one it reports "Timeout 30000ms exceeded" — which reads like the app
   failing to boot rather than like an option in the wrong position. The single
   file is ~42 MB of HTML and WebKit spends around 100 seconds parsing it
   before a line of app code runs, so on the owner's laptop a 30 second cap
   cannot be met no matter how healthy the app is. The 120000 was right; it was
   never in effect.

   Checked by walking parentheses rather than by regex, because the predicates
   here contain commas, braces, strings and nested calls, and a pattern that
   tried to skip them would be the same kind of guess this file exists to
   replace. */
/* Comments are blanked, not removed, so every index and line number below
   still points at the real file. Without this the scan finds the pattern in
   the paragraph above and reports this file — which it did, first run. */
function blankComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}

function twoArgWaits() {
  const dir = __dirname;
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.js')) continue;
    const raw = fs.readFileSync(path.join(dir, name), 'utf8');
    const src = blankComments(raw);
    const rawLines = raw.split('\n');
    const re = /waitForFunction\(/g;
    let m;
    while ((m = re.exec(src))) {
      let i = m.index + m[0].length, depth = 1, inS = null, argStart = i;
      const args = [];
      for (; i < src.length && depth > 0; i++) {
        const c = src[i];
        if (inS) { if (c === '\\') { i++; continue; } if (c === inS) inS = null; continue; }
        if (c === "'" || c === '"' || c === '`') { inS = c; continue; }
        if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) depth--;
        if (depth === 0) break;
        if (c === ',' && depth === 1) { args.push(src.slice(argStart, i)); argStart = i + 1; }
      }
      args.push(src.slice(argStart, i));
      if (args.length === 2 && /\{\s*timeout\s*:/.test(args[1])) {
        const line = src.slice(0, m.index).split('\n').length;
        /* One deliberate instance has to exist: the behavioural check below
           proves the premise of this whole block by making the mistake on
           purpose and measuring that the timeout is ignored. It is marked
           rather than excluded, so the rest of THIS file stays covered and the
           exemption is one grep away from anyone who wonders. */
        const marked = [rawLines[line - 1], rawLines[line - 2]]
          .some(l => l && l.includes('lint-allow: two-arg'));
        if (!marked) out.push(`${name}:${line}`);
      }
    }
  }
  return out;
}

head('no wait passes its options where the argument goes');
{
  const bad = twoArgWaits();
  ok('every waitForFunction passes options as the third argument',
     bad.length === 0, bad.slice(0, 6).join(', ') || 'none');

  /* And the boot wait is not hand-rolled anywhere any more: one predicate, one
     timeout default, one place to change when the target artifact gets slower. */
  const handRolled = fs.readdirSync(__dirname)
    .filter(n => n.endsWith('.js') && n !== '_render.js' && n !== 'verify-render.js')
    .filter(n => fs.readFileSync(path.join(__dirname, n), 'utf8')
      .includes("typeof S !== 'undefined' && !!document.querySelector('.hero-h1')"));
  ok('and no suite still spells the boot wait out by hand',
     handRolled.length === 0, handRolled.join(', ') || 'none');
}

(async () => {
  const browser = await launch();
  const page = await (await browser.newContext()).newPage();
  await page.setContent(FIXTURE);
  console.log(`  engine: ${engineName()}`);

  head('the fixture reproduces the race it is here to guard against');
  await R.booted(page, { timeout: 10000 });
  /* The postcondition, not `true`. This was `ok(..., true)` on the reasoning
     that a throw inside booted() means the line is never reached — which is
     exactly why it was worthless: booted() rejecting takes the whole suite
     down as an unhandled rejection, printing no FAIL and leaving the count
     wrong, so the one failure this was meant to describe is the one it could
     not report. Asserting what booted() PROMISES can fail, and says which half
     is missing when it does. */
  const afterBoot = await page.evaluate(() => ({
    state: typeof S !== 'undefined',
    firstRender: !!document.querySelector('.hero-h1'),
  }));
  ok('booted() returns only once state and the first render are both up',
     afterBoot.state && afterBoot.firstRender, JSON.stringify(afterBoot));

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

  head('the two-argument form really does ignore its timeout');
  /* The static check above is only worth having if its premise is true, so the
     premise is measured rather than asserted. Both calls ask for 500ms against
     a condition that never becomes true. The correct form must reject at about
     500ms; the two-argument form must still be waiting well past it, because
     it is running on the 30 second default. Raced against a 3 second timer so
     proving this costs 3 seconds instead of 30. */
  {
    const race = (promise, ms) => Promise.race([
      promise.then(() => 'resolved', () => 'rejected'),
      new Promise(r => setTimeout(() => r('still waiting'), ms)),
    ]);
    const blank = await (await browser.newContext()).newPage();
    await blank.setContent('<!doctype html><html><body>nothing</body></html>');

    const right = await race(
      blank.waitForFunction(() => window.__never === true, null, { timeout: 500 }), 3000);
    ok('options in the third position are honoured — it gives up at 500ms',
       right === 'rejected', right);

    const wrong = await race(
      /* lint-allow: two-arg — deliberately wrong, that is the measurement */
      blank.waitForFunction(() => window.__never === true, { timeout: 500 }), 3000);
    ok('options in the second position are not — it is still waiting at 3s',
       wrong === 'still waiting', wrong);
    await blank.close();
  }

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
