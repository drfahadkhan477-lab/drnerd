#!/usr/bin/env node
/*
 * The Living Diagram's rules, before there is a screen to show them on.
 *
 *   node tests/verify-livingdiagram-pure.js
 *
 * No browser, no build. src/ui/livingDiagram.js says in its own header that
 * it is shaped this way — no DOM, no timers — for the same reason
 * heroRhythm.js and pencil.js are: the rules that decide WHEN ambient mode
 * may run and WHICH view it shows next are worth holding in a test that
 * needs no browser, even though what it eventually draws needs one badly.
 * This suite is written alongside the module, not after it goes unheld the
 * way those two did.
 *
 * WHAT IT DEFENDS. Three things, and the first is the one a slip most
 * easily produces: ambient mode must be scoped as tightly as Focus Mode is —
 * home screen only, no overlay open, motion not reduced — because the cost
 * of it starting somewhere it shouldn't (mid-quiz, mid-chat, over a
 * half-read pearl) is a real interruption, not a cosmetic miss. The second
 * is the idle threshold's boundary, exactly, not approximately. The third is
 * the view-cycling step-off, held to the same exhaustive standard
 * verify-herorhythm-pure holds heroRhythm's rhythm-cycling to, since it is
 * the same algorithm reused rather than re-implemented.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* Executed against a stand-in global, the way verify-herorhythm-pure and
   verify-pencil-pure load their modules — what is tested is the file that
   ships, not a copy of its logic kept here. */
const root = {};
/* eslint-disable-next-line no-new-func */
new Function(read('src/ui/livingDiagram.js')).call(root);
const L = root.LivingDiagram;

head('the module loaded and exposes what the app will call');
{
  ok('LivingDiagram is on the global it was given', !!L);
  const want = ['IDLE_MS', 'DWELL_MS', 'VIEWS', 'eligible', 'shouldEnter', 'nextView'];
  const missing = want.filter(k => !(L && k in L));
  ok('and exports every name this suite exercises', missing.length === 0, missing.join(', '));
}

head('the tuning constants are the values chosen, not read back at whatever they happen to be');
{
  /* Every boundary check below reads L.IDLE_MS reflectively, so it tests
     shouldEnter's RELATIONSHIP to the constant regardless of the constant's
     actual value — and stayed green when IDLE_MS was changed from 120000 to
     130000 in a scratch copy while writing this suite. That is a real gap,
     not a false alarm: a 5-second idle threshold (constant firing) and a
     1-hour one (never firing) would both pass every check below just as
     cleanly. Pinned independently here, the way heroRhythm.js's suite pins
     beatDurationMs's MIN/MAX rather than only reading them back. */
  ok('two minutes idle before ambient mode may start', L.IDLE_MS === 120000, `${L.IDLE_MS}ms`);
  ok('nine seconds per view once it has', L.DWELL_MS === 9000, `${L.DWELL_MS}ms`);
}

head('VIEWS is the thing the no-repeat rule depends on');
{
  ok('it is a non-empty list', Array.isArray(L.VIEWS) && L.VIEWS.length > 0, `${L.VIEWS.length} views`);
  ok('every entry is a non-empty string', L.VIEWS.every(v => typeof v === 'string' && v.length > 0));
  ok('and no view appears in it twice', new Set(L.VIEWS).size === L.VIEWS.length,
     `${L.VIEWS.length} entries, ${new Set(L.VIEWS).size} distinct`);
}

head('eligible: the home screen, and only the home screen, unconditionally');
{
  ok('home with nothing else set is eligible', L.eligible('home', {}) === true);
  ok('home with opts entirely omitted is eligible — the ordinary call shape',
     L.eligible('home', undefined) === true);
  const others = ['quiz', 'chapters', 'stats', 'lab', 'study'];
  const leaked = others.filter(s => L.eligible(s, {}) !== false);
  ok('every other screen is ineligible, plain', leaked.length === 0, leaked.join(', '));
}

head('eligible: three reasons to refuse the home screen anyway');
{
  ok('an open overlay (chat, figures) refuses it', L.eligible('home', { aiOpen: true }) === false);
  ok('Focus Mode refuses it — the two are siblings, never nested',
     L.eligible('home', { focusMode: true }) === false);
  ok('reduced motion refuses it outright, not at a lower intensity',
     L.eligible('home', { reducedMotion: true }) === false);
  /* NON-VACUITY, the shape CLAUDE.md names three times over: a guard that
     refuses everything would pass every check above by accident. Confirm
     the "clean" case actually differs from the refused ones. */
  ok('and a clean home screen is not accidentally refused too',
     L.eligible('home', { aiOpen: false, focusMode: false, reducedMotion: false }) === true);
}

head('eligible: refusals stack — being on the wrong screen is not excused by opts');
{
  ok('the wrong screen stays refused even with every opt clean',
     L.eligible('quiz', { aiOpen: false, focusMode: false, reducedMotion: false }) === false);
}

head('shouldEnter: the idle threshold, at its exact boundary');
{
  ok('one millisecond short of the threshold does not enter',
     L.shouldEnter(L.IDLE_MS - 1, 'home', {}) === false);
  ok('exactly at the threshold does enter', L.shouldEnter(L.IDLE_MS, 'home', {}) === true);
  ok('comfortably past the threshold enters', L.shouldEnter(L.IDLE_MS * 10, 'home', {}) === true);
  ok('freshly active (0ms) does not enter', L.shouldEnter(0, 'home', {}) === false);
  ok('a negative elapsed time — clock skew, not a real state — does not enter',
     L.shouldEnter(-1, 'home', {}) === false);
}

head('shouldEnter: an eligible screen for long enough is not the whole story');
{
  ok('a huge idle time on the wrong screen still never enters',
     L.shouldEnter(Number.MAX_SAFE_INTEGER, 'quiz', {}) === false);
  ok('a huge idle time on the home screen with an overlay open still never enters',
     L.shouldEnter(Number.MAX_SAFE_INTEGER, 'home', { aiOpen: true }) === false);
  ok('a huge idle time with reduced motion still never enters',
     L.shouldEnter(Number.MAX_SAFE_INTEGER, 'home', { reducedMotion: true }) === false);
}

head('nextView: it never shows the view already on screen');
{
  const p = L.VIEWS;
  let cases = 0, repeats = [];
  /* Exhaustive, not sampled — every previous view against every index the
     random source can land on, the same standard verify-herorhythm-pure
     holds heroRhythm's identical algorithm to. */
  for (const prev of p) {
    for (let i = 0; i < p.length; i++) {
      const got = L.nextView(prev, null, () => i / p.length);
      cases++;
      if (got === prev) repeats.push(`${prev}@${i}`);
    }
  }
  ok('every previous-view and every landing spot was tried', cases === p.length * p.length, `${cases} cases`);
  ok('and not one of them returned the view already showing', repeats.length === 0, repeats.join(', '));
  ok('the result is always a member of VIEWS',
     p.every(prev => p.every((_, i) => p.includes(L.nextView(prev, null, () => i / p.length)))));
}

head('nextView: the same edges heroRhythm.js\'s identical algorithm is held to');
{
  const p = L.VIEWS;
  ok('r() = 1 lands on the last view, not past it',
     p.includes(L.nextView(null, null, () => 1)), String(L.nextView(null, null, () => 1)));
  ok('r() above 1 is clamped too', p.includes(L.nextView(null, null, () => 4.2)));
  ok('a negative r() is clamped to the first', p.includes(L.nextView(null, null, () => -0.5)));
  ok('an empty view list returns nothing rather than throwing',
     L.nextView('x', [], Math.random) === undefined);
  ok('a single-view list returns it, even if it is the one on screen',
     L.nextView('a', ['a'], Math.random) === 'a');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
