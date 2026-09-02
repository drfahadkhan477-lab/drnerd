#!/usr/bin/env node
/*
 * The on-device self-test — that it runs, that it reports honestly, and above
 * all that it CAN FAIL.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-selftest.js <patched.html>
 *
 * A self-test that always passes is worse than no self-test: it converts "I
 * think something is wrong" into false reassurance, which is exactly the
 * position 1,496 green checks put the fellow in twice this week. So the
 * load-bearing check in this file is the one that breaks the app on purpose —
 * removes the max-height the figure viewer depends on — and demands that the
 * self-test notice. Everything else here is scaffolding around that.
 *
 * Note what this suite does NOT claim. It runs in Chromium, so it cannot show
 * that the self-test behaves on WebKit; it shows that the self-test is wired
 * correctly and is capable of reporting a failure. Whether the invariants hold
 * on an iPad is the question the self-test exists to answer, on the iPad.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-selftest.js <patched.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  const browser = await launch();
  /* Landscape, because that is the shape both shipped bugs needed and the
     shape no other suite in this project uses for the viewer. */
  const page = await browser.newPage({ viewport: { width: 1194, height: 834 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 150000 });

  const guarded = () => page.evaluate(() => typeof runSelfTest === 'function');
  const rows = () => page.evaluate(async () => (typeof runSelfTest === 'function' ? await runSelfTest() : null));

  head('the step is present, and reachable the way the fellow reaches it');
  ok('the runner exists', await guarded() === true);
  {
    const opened = await page.evaluate(async () => {
      if (typeof openSelfTest !== 'function') return null;
      location.hash = '#selftest';
      await new Promise(r => setTimeout(r, 250));
      /* hashchange is what a fellow typing it into Safari triggers. */
      const el = document.getElementById('selftest');
      return el ? { rows: el.querySelectorAll('.st-row').length, hasClose: !!document.getElementById('stClose') } : null;
    });
    ok('adding #selftest to the URL opens the panel', !!opened, opened ? `${opened.rows} rows` : 'no panel');
    ok('and it has a way out', !!opened && opened.hasClose === true);
  }

  head('what it reports on a build that is behaving');
  const clean = await rows();
  ok('it returns a row per check', Array.isArray(clean) && clean.length >= 5, clean ? String(clean.length) : '—');
  {
    const byName = Object.fromEntries((clean || []).map(r => [r.name, r]));
    const fig = byName['every figure fits the viewer at Fit'];
    ok('the figure check ran against real figures, not a fixture',
       !!fig && /\d+ sampled/.test(fig.detail), fig ? fig.detail : '—');
    ok('and it passes on this build', !!fig && fig.ok === true, fig ? fig.detail : '—');
    /* The whole point of the landscape viewport above: this is the frame in
       which 98% of the bank used to be clipped. */
    ok('having sampled more than a token number', !!fig && +(fig.detail.match(/^(\d+)/) || [0, 0])[1] >= 8,
       fig ? fig.detail : '—');

    const side = byName['nothing scrolls sideways'];
    ok('the sideways-scroll check passes', !!side && side.ok === true, side ? side.detail : '—');

    const store = byName['annotations can be saved here'];
    ok('storage reports writable', !!store && store.ok === true, store ? store.detail : '—');

    const env = byName['this device and orientation'];
    ok('the environment row is informational, not a pass or a fail',
       !!env && env.ok === null, env ? String(env.ok) : '—');
    ok('and it names the engine, the size and the orientation',
       !!env && /landscape/.test(env.detail) && /1194x834/.test(env.detail), env ? env.detail : '—');

    const strip = byName['the Apex figures arrive folded'];
    ok('a check with nothing to look at says so rather than passing',
       !!strip && strip.ok === null, strip ? `${strip.ok} — ${strip.detail}` : '—');
  }

  head('IT CAN FAIL — the check this whole file exists for');
  {
    /* Removes exactly the declaration chain step 68 added. If the self-test
       still reports green here, it is decoration. */
    const broken = await page.evaluate(async () => {
      const s = document.createElement('style');
      s.id = 'st-break';
      s.textContent = '.figv-scroll img{max-height:none !important}';
      document.head.appendChild(s);
      return await runSelfTest();
    });
    const fig = broken.find(r => r.name === 'every figure fits the viewer at Fit');
    ok('with max-height removed, the figure check FAILS', !!fig && fig.ok === false,
       fig ? fig.detail : '—');
    ok('and it names how far the figure escaped the frame',
       !!fig && /worst overflow \d+px/.test(fig.detail) && !/overflow 0px/.test(fig.detail),
       fig ? fig.detail : '—');
    ok('and which figure did it, so it can be looked at',
       !!fig && /on a \d+x\d+ figure/.test(fig.detail), fig ? fig.detail : '—');
    /* The other checks must be unaffected: a self-test that goes all-red on one
       broken rule cannot tell you what is actually wrong. */
    const side = broken.find(r => r.name === 'nothing scrolls sideways');
    ok('while the unrelated checks stay green', !!side && side.ok === true, side ? side.detail : '—');

    const panel = await page.evaluate(async () => {
      await openSelfTest();
      const el = document.getElementById('selftest');
      return { fails: el.querySelectorAll('.st-dot.fail').length, foot: el.querySelector('.st-foot span').textContent };
    });
    ok('the panel shows the failure rather than burying it', panel.fails >= 1, `${panel.fails} red row(s)`);
    ok('and the summary counts it', /failing/.test(panel.foot), panel.foot);

    await page.evaluate(() => { const s = document.getElementById('st-break'); if (s) s.remove(); });
  }

  head('two runs at once do not corrupt each other');
  {
    /* Found by this suite, not by reasoning: arriving on #selftest fires both
       the boot hook and the hashchange listener, and both runs drive the same
       figure viewer — so each one's closePeek() tore the other's image out and
       the result was figures reported unreachable on a device where every one
       of them loads. Serialised now; this is what keeps it that way. */
    const both = await page.evaluate(async () => {
      const [a, b] = await Promise.all([runSelfTest(), runSelfTest()]);
      const fig = r => r.find(x => x.name === 'every figure fits the viewer at Fit');
      return { a: fig(a).detail, b: fig(b).detail, aOk: fig(a).ok, bOk: fig(b).ok };
    });
    ok('both runs report a full sample', !/unreachable/.test(both.a) && !/unreachable/.test(both.b),
       `${both.a} | ${both.b}`);
    ok('and both agree', both.a === both.b && both.aOk === both.bOk, `${both.a} vs ${both.b}`);
    ok('and both still pass', both.aOk === true && both.bOk === true);
  }

  head('it puts the app back the way it found it');
  {
    const after = await page.evaluate(async () => {
      await openSelfTest();
      closeSelfTest();
      return {
        panel: !!document.getElementById('selftest'),
        hash: location.hash,
        /* The figure check opens the viewer two dozen times. Leaving one open
           over the app would be a worse bug than any it reports. */
        peek: !!document.querySelector('.figv-scroll'),
        locked: document.body.classList.contains('peek-locked'),
        screen: S.screen,
      };
    });
    ok('closing removes the panel', after.panel === false);
    ok('and clears #selftest, so a reload is a normal launch', after.hash === '', after.hash || '(empty)');
    ok('no figure viewer is left open over the app', after.peek === false);
    ok('and the body is not left scroll-locked', after.locked === false);
    ok('the app is on the screen it started on', after.screen === 'home', after.screen);
  }

  head('regression');
  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
