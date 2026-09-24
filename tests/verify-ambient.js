#!/usr/bin/env node
/*
 * The Living Diagram's ambient mode, in a browser: does what ambient-patch
 * INSERTS keep the promises livingDiagram.js makes?
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-ambient.js
 *
 * Takes no build, by the method verify-echo uses: a scaffold carrying the one
 * anchor ambient-patch looks for is patched by the SHIPPED script, and the
 * views are this repository's own modules — Heart3D, ECG12 and Leads12,
 * Wiggers and Physio, LivingDiagram — loaded as the earlier chain steps
 * embed them. Nothing under test is a copy.
 *
 * WHAT IS HELD, each a promise from livingDiagram.js's header or from the
 * step's own:
 *
 *   it waits for IDLE_MS of no interaction, and not a moment less
 *   the home screen only: not the quiz, not with the Apex panel open, not in
 *     Focus Mode, never under prefers-reduced-motion
 *   it cycles views without showing the same one twice running
 *   a tap closes it WITHOUT pressing what was beneath the finger
 *   a key closes it; hiding the tab closes it
 *   the WebGL heart is released every time: Chromium keeps sixteen contexts
 *     and warns before discarding the oldest, so twenty visits to the heart
 *     view that each leaked one would say so
 *
 * Time is driven through AMBIENT.tick(now) rather than waited for: a two
 * minute idle threshold is a number to pass, not a duration to sit through.
 *
 * WHAT THIS CANNOT SAY: how it looks over the real home screen, or on an
 * iPad's GPU. Those need the build and the device.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { launch, isEngineNoise } = require('./_engine');
const { onDeath } = require('./_deathnote.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

const ROOT = path.join(__dirname, '..');
const src = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ambient-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} });

/* The environment the earlier steps would supply: the modules, an S with a
   screen, a #shell the Apex panel toggles `ai-open` on, and one door under
   the middle of the screen, to find out whether a tap on the overlay presses
   it. The anchor is spelled as ambient-patch spells it. */
const MODULES = ['src/core/physio.js', 'src/core/leads12.js', 'src/ui/ecg12.js',
                 'src/ui/wiggers.js', 'src/core/heart3d.js', 'src/ui/livingDiagram.js'];
const SCAFFOLD = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;height:100vh} #door{position:fixed;left:50%;top:50%;width:240px;height:120px;
  transform:translate(-50%,-50%)}</style></head><body>
<div id="shell"><button id="door" onclick="window.doorPresses=(window.doorPresses||0)+1">a door</button></div>
${MODULES.map(m => '<script>' + src(m) + '</script>').join('\n')}
<script>
var S = { screen: 'home', focusMode: false };
/* ══════════════ Durable memory — see src/core/memory.js ══════════════ */
</script>
</body></html>`;

const IN = path.join(TMP, 'in.html'), OUT = path.join(TMP, 'out.html');
fs.writeFileSync(IN, SCAFFOLD, 'utf8');
const applied = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'ambient-patch.js'), IN, OUT], { encoding: 'utf8' });
const patchOut = (applied.stdout || '') + (applied.stderr || '');

head('the shipped patch applies to the scaffold');
ok('scripts/ambient-patch.js exits 0', applied.status === 0,
   applied.status === 0 ? 'applied' : patchOut.trim().split('\n').slice(0, 2).join(' / '));
ok('and reports its one edit', (patchOut.match(/✓/g) || []).length === 1, (patchOut.match(/✓/g) || []).length + ' edits');
if (applied.status !== 0) { console.log(`\n${passed} passed, ${failed} failed`); process.exit(1); }

(async () => {
  const browser = await launch();
  /* hasTouch, because the device this is for is an iPad: the tap below is a
     real touchscreen tap, not a mouse click standing in for one. */
  const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [], contextWarnings = [];
  onDeath(() => ({ section, checks: passed + failed, errors }));
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 120)));
  page.on('console', m => {
    const t = m.text();
    if (/too many active webgl contexts/i.test(t)) contextWarnings.push(t.slice(0, 100));
    else if (m.type() === 'error' && !isEngineNoise(t)) errors.push(t.slice(0, 120));
  });
  await page.goto('file://' + OUT);

  const state = () => page.evaluate(() => ({
    active: AMBIENT.active(), view: AMBIENT.view(),
    overlays: document.querySelectorAll('.ambient').length,
  }));
  const IDLE = await page.evaluate(() => LivingDiagram.IDLE_MS);
  const later = ms => page.evaluate(ms => { AMBIENT.tick(Date.now() + ms); }, ms);

  head('it waits, and only where it may');
  ok('the patched page defines AMBIENT and is not showing it yet',
     await page.evaluate(() => typeof AMBIENT === 'object' && !AMBIENT.active()));
  await later(IDLE - 5000);
  ok('five seconds short of the idle threshold, it stays away', !(await state()).active);
  await later(IDLE + 1000);
  const on = await state();
  ok('past the threshold on the home screen, it comes up', on.active && on.overlays === 1,
     `active ${on.active}, ${on.overlays} overlay(s), view ${on.view}`);
  ok('showing a view that actually drew', await page.evaluate(() => AMBIENT.live()), String(on.view));
  await page.evaluate(() => AMBIENT.exit());

  for (const [name, set, unset] of [
    ['not on the quiz', () => { S.screen = 'quiz'; }, () => { S.screen = 'home'; }],
    ['not with the Apex panel open', () => document.getElementById('shell').classList.add('ai-open'),
                                     () => document.getElementById('shell').classList.remove('ai-open')],
    ['not in Focus Mode', () => { S.focusMode = true; }, () => { S.focusMode = false; }],
  ]) {
    await page.evaluate(set);
    await later(IDLE * 3);
    const st = await state();
    ok(name, !st.active && st.overlays === 0, `active ${st.active}`);
    await page.evaluate(unset);
    await page.evaluate(() => AMBIENT.tick());   /* registers the screen, now */
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await later(IDLE * 3);
  ok('never under prefers-reduced-motion', !(await state()).active);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  /* Eligibility is checked while it runs, too, not only on the way in. */
  await later(IDLE + 1000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await later(IDLE + 2000);
  ok('and it leaves if reduced motion is switched on while it is showing', !(await state()).active);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  /* Coming back to the home screen is not idleness on it. THE IDLE CLOCK MUST
     BE GENUINELY OLD FIRST: a first draft ran this straight after an exit(),
     which resets the clock, so "not raised at once" held whatever screen
     changes did — it passed with the reset removed. Now three idle
     thresholds pass on another screen before the return home. */
  const back = await page.evaluate(({ idle }) => {
    const t0 = Date.now();
    S.screen = 'lab';  AMBIENT.tick(t0 + idle * 3);
    S.screen = 'home'; AMBIENT.tick(t0 + idle * 3 + 1000);
    const atOnce = AMBIENT.active();
    AMBIENT.tick(t0 + idle * 4 + 2000);
    const after = AMBIENT.active();
    AMBIENT.exit();
    return { atOnce, after };
  }, { idle: IDLE });
  ok('returning to the home screen after long idleness elsewhere does not raise it at once',
     back.atOnce === false, `active on return: ${back.atOnce}`);
  ok('but idling there for the full threshold still does', back.after === true);

  head('it cycles');
  await later(IDLE + 1000);
  const seq = await page.evaluate(() => {
    const out = [AMBIENT.view()];
    for (let i = 0; i < 12; i++) { AMBIENT.next(); out.push(AMBIENT.view()); }
    return { seq: out, live: AMBIENT.live() };
  });
  const repeats = seq.seq.filter((v, i) => i > 0 && v === seq.seq[i - 1]).length;
  ok('thirteen views, never the same one twice running', repeats === 0 && seq.seq.length === 13, seq.seq.join(' '));
  ok('and all three views appear', ['heart', 'ecg', 'pvloop'].every(v => seq.seq.includes(v)),
     [...new Set(seq.seq)].join(', '));

  head('closing it');
  /* The door sits under the middle of the screen. Waking the screen must not
     press it — by touch or by mouse. */
  const presses = () => page.evaluate(() => window.doorPresses || 0);
  await page.touchscreen.tap(597, 417);
  const afterTap = await state();
  ok('a tap closes it', !afterTap.active && afterTap.overlays === 0, `active ${afterTap.active}`);
  ok('without pressing what was beneath the finger', (await presses()) === 0, `${await presses()} door press(es)`);
  await page.touchscreen.tap(597, 417);
  ok('and the next tap, with it gone, reaches the door as normal', (await presses()) === 1, `${await presses()}`);

  /* A hand already on the mouse, clicking to wake the screen: the cursor is
     over the door before ambient mode comes up, and the click moves nothing. */
  await page.mouse.move(597, 417);
  await later(IDLE + 1000);
  await page.mouse.move(599, 418, { steps: 3 });
  ok('a jitter of the mouse does not close it', (await state()).active);
  await page.mouse.down(); await page.mouse.up();
  const afterClick = await state();
  ok('a mouse click closes it, and does not press the door either',
     !afterClick.active && (await presses()) === 1, `active ${afterClick.active}, ${await presses()} press(es)`);
  await later(IDLE + 1000);
  await page.mouse.move(897, 417, { steps: 12 });
  ok('a deliberate mouse movement closes it', !(await state()).active);

  await later(IDLE + 1000);
  await page.keyboard.press('Shift');
  ok('a key closes it', !(await state()).active);

  await later(IDLE + 1000);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });
  ok('hiding the tab closes it', !(await state()).active);

  head('the WebGL heart is released every time');
  /* Twenty times onto the heart view and off again. PRECONDITION FIRST: if
     Heart3D could not draw here, no context was ever made and "no warning"
     would be the absence of a test. So the heart must have been live on
     every one of those visits. */
  /* DETERMINISTIC, NOT LIKELY. The first version stepped to the heart at
     random with six tries per visit — a miss one visit in sixty, so about one
     run in four came back "19 of 20" for no reason in the code. With the
     random source held at 0, nextView lands on VIEWS[0], the heart, every
     time it is not already showing. Restored after. */
  const visits = await page.evaluate(async () => {
    let live = 0;
    const rnd = Math.random;
    Math.random = () => 0;
    for (let i = 0; i < 20; i++) {
      AMBIENT.enter();
      if (AMBIENT.view() === 'heart' && AMBIENT.live()) live++;
      await new Promise(r => setTimeout(r, 30));
      AMBIENT.exit();
    }
    Math.random = rnd;
    return { live, overlays: document.querySelectorAll('.ambient').length };
  });
  await page.waitForTimeout(300);
  ok('the heart view drew on all twenty visits (the precondition)', visits.live === 20, `${visits.live} of 20`);
  ok('and no context was discarded for want of room', contextWarnings.length === 0,
     contextWarnings.length ? `${contextWarnings.length} warning(s): ${contextWarnings[0]}` : 'none');
  ok('and no overlay was left behind', visits.overlays === 0, `${visits.overlays} left`);

  head('and nothing broke');
  ok('no page or console error', errors.length === 0, errors.slice(0, 2).join(' | ') || 'clean');

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
