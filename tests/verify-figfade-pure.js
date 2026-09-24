#!/usr/bin/env node
/*
 * A figure that fails to load must still appear.
 *
 *   node tests/verify-figfade-pure.js
 *
 * No browser, no build. figloadfade-patch.js injects a few lines into the
 * figure viewer's mount, and those lines carry a regression that is very easy
 * to reintroduce, because the obvious way to write the feature IS the bug:
 *
 *     .figv-scroll img{opacity:0}          /_ hidden by default _/
 *     .figv-scroll img.loaded{opacity:1}   /_ revealed by the script _/
 *
 * Written that way, every failure is invisible. A figure whose decode errors,
 * whose 404 the offline cache handed back, or whose script never ran is not a
 * broken-image mark — it is nothing at all, on a screen whose only content is
 * that figure. The shipped version inverts it: the hidden state is an opt-in
 * class, added only on a path that has already committed to removing it on
 * BOTH load and error.
 *
 * That inversion was proven once, in a scratch harness, and then the harness
 * was thrown away — docs/BUILD.md row 69 says so in as many words: "proven by
 * a standalone harness, not by a suite in this repository — nothing here will
 * catch it if that regresses". This is that suite. It exists because the
 * sentence admitting the hole was easier to write than the test.
 *
 * HOW IT READS THE CODE. The patch's own `replace` argument is lifted out of
 * the script and executed against stub objects — the technique
 * verify-swupdate-pure.js uses on build-pwa.js's template literals, for the
 * same reason: a copy of those lines kept here would stop matching the first
 * time they changed and would go on passing. Taking the `replace` and not the
 * `find` matters — the two are nearly identical, and the `find` is the OLD
 * code, so a suite that grabbed the first match would cheerfully test the
 * version without the error handler.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { blankComments } = require('./_source.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const PATCH = path.join(ROOT, 'scripts', 'figloadfade-patch.js');
const SRC = fs.readFileSync(PATCH, 'utf8');

/* The third argument of the patch() call whose label starts with the given
   prefix. Labels are what the build prints, so they are the stable handle —
   and unlike a line number they say which edit is meant. */
function replaceArg(labelPrefix) {
  const re = new RegExp(
    "patch\\('" + labelPrefix + "[^']*',\\s*`([\\s\\S]*?)`,\\s*`([\\s\\S]*?)`\\);");
  const m = SRC.match(re);
  if (!m) throw new Error(`figloadfade-patch.js no longer has a patch() labelled "${labelPrefix}…"`);
  return { find: m[1], replace: m[2] };
}

const JS = replaceArg('figloadfade: js');
const CSS = replaceArg('figloadfade: css');

head('the thing being tested is really the shipped thing');
{
  /* Every other check here reads this file as text, so a syntax error in it
     is invisible to all of them and would surface only at build time. */
  const r = spawnSync(process.execPath, ['--check', PATCH], { encoding: 'utf8' });
  ok('figloadfade-patch.js parses as JavaScript', r.status === 0, (r.stderr || '').split('\n')[0]);

  /* VACUITY GUARD. Every assertion below is a regex or a substring test over
     these two blocks. If extraction silently returned something empty or
     truncated, the interesting ones would pass by having nothing to look at —
     which is this project's most-repeated failure mode. */
  ok('the js block came out whole', JS.replace.length > 200 && /mountFigZoom/.test(JS.replace),
     `${JS.replace.length} chars`);
  ok('the css block came out whole', CSS.replace.length > 200 && /figv-scroll/.test(CSS.replace),
     `${CSS.replace.length} chars`);
  /* And that it is the NEW code, not the old: the find is the pre-patch
     version and the two differ only by the part under test. Blanked, for the
     same reason the css sweep below is — the replacement's own comment
     discusses the error listener, and an unblanked test would find the word
     rather than the call. */
  ok('it is the replacement that was lifted, not the thing being replaced',
     /addEventListener\('error'/.test(blankComments(JS.replace)) &&
     !/addEventListener\('error'/.test(blankComments(JS.find)));
}

/* ── the stubs ────────────────────────────────────────────────────────────
   An <img> reduced to what these lines touch: whether it has finished, the
   two classes, and the listeners. fire() is the browser's job, done by hand. */
function makeImg(complete) {
  const listeners = {};
  return {
    complete,
    classes: new Set(),
    classList: {
      add(c) { img.classes.add(c); },
      remove(c) { img.classes.delete(c); },
    },
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    fire(ev) { (listeners[ev] || []).forEach(fn => fn()); },
    hidden() { return img.classes.has('fig-loading'); },
  };
}
let img;

/* The lifted lines assign to an outer `figZ` and read `wrap`/`mountFigZoom`
   from their scope, so the harness supplies exactly those three names and
   nothing else — anything more would be this suite inventing an environment
   the app does not have. */
function run(complete) {
  img = makeImg(complete);
  const scroll = { querySelector: sel => (sel === 'img' ? img : null) };
  const wrap = { querySelector: sel => (sel === '.figv-scroll' ? scroll : null) };
  const mountFigZoom = () => ({ apply() {} });
  /* eslint-disable-next-line no-new-func */
  new Function('wrap', 'mountFigZoom', `let figZ;\n${JS.replace}`)(wrap, mountFigZoom);
  return img;
}

head('a figure already decoded is never hidden');
{
  const a = run(true);
  ok('a complete image is shown as it is', a.hidden() === false,
     a.hidden() ? 'it was given fig-loading and nothing will take it off' : 'no fig-loading');
}

head('a figure still loading is hidden, then revealed');
{
  const b = run(false);
  const whileLoading = b.hidden();
  b.fire('load');
  ok('it is hidden while the load is pending', whileLoading);
  ok('and revealed when the load arrives', b.hidden() === false);
}

head('and a figure that FAILS is revealed too — the regression');
{
  const c = run(false);
  const whileLoading = c.hidden();
  c.fire('error');
  ok('it is hidden while the load is pending', whileLoading);
  /* The whole reason this file exists. An errored figure that stays hidden is
     a blank screen with no way to tell a slow network from a missing file. */
  ok('an errored image is revealed, not left blank', c.hidden() === false,
     c.hidden() ? 'still carrying fig-loading — the error listener is gone' : 'revealed');
}

head('the css agrees: hiding is opt-in, so nothing can get stuck in it');
{
  /* BLANKED, AND THIS SUITE LEARNED WHY THE HARD WAY. The rule in CLAUDE.md
     is that any scan of this repository's own source reads the blanked copy,
     because the files explain themselves at length and the explanations quote
     the very patterns being hunted. The first draft of the sweep below
     scanned the raw block and went red on its own documentation: the comment
     in figloadfade-patch.js spells out the wrong way round — an opacity:0 on
     the bare selector — precisely in order to say not to do it, and the scan
     dutifully reported the warning as the defect. Fourth time in this
     project, first time in this file. Comments become spaces; offsets and
     line boundaries survive, so the slice below still lines up. */
  const css = blankComments(CSS.replace);
  ok('the hidden state is carried by a class', /\.figv-scroll img\.fig-loading\s*\{[^}]*opacity:\s*0/.test(css));

  /* THE INVERSION, ASSERTED DIRECTLY. Written the obvious way round there
     would be an opacity:0 on the bare element selector, and every failure
     path would be invisible. So: every opacity:0 in this block must belong to
     a rule that also names .fig-loading. */
  const zeroRules = css.split('}')
    .filter(r => /opacity:\s*0(?!\.)(?![1-9])/.test(r))
    .map(r => r.split('{')[0].trim());
  ok('there is an opacity:0 to check at all', zeroRules.length > 0, `${zeroRules.length} rule(s)`);
  ok('and every one of them is gated on .fig-loading, never the bare image',
     zeroRules.every(sel => /\.fig-loading/.test(sel)),
     zeroRules.join(' | '));

  /* Reduced motion gets the same information without the movement: the class
     stops meaning "invisible" rather than the fade merely being faster. */
  const rm = css.slice(css.indexOf('prefers-reduced-motion'));
  ok('reduced motion is handled', css.includes('prefers-reduced-motion'));
  ok('and there it neutralises the hidden state instead of shortening it',
     /\.fig-loading\s*\{\s*opacity:\s*1/.test(rm), rm.split('\n').slice(0, 3).join(' ').trim());
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
