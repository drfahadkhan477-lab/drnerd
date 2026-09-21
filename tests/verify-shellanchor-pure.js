#!/usr/bin/env node
/*
 * The shell's markup is rewritten five times. Every anchor into it must
 * survive all five.
 *
 *   node tests/verify-shellanchor-pure.js
 *
 * No browser, no build, no licensed export. The <header>/<div id="shell">/
 * <main id="app"> region is small enough, and the steps that touch it few
 * enough, that the whole region can be replayed here exactly — so an anchor
 * into it can be checked at the position it actually runs from.
 *
 * WHAT BROKE. focusmode is step 86 and anchored on three lines copied from
 * what fullbleed(34) emits:
 *
 *     <header id="navbar"></header>
 *     <div id="shell">
 *       <div id="app"></div>
 *
 * but disclaimer(64) swaps that last div for <main id="app"></main> — the
 * landmark a screen reader needs — and announce(65) puts a live region
 * beside it. Both run 30 steps after the form was written and 20 before the
 * step that copied it. So the anchor described markup that had not existed
 * since step 64, and the first build that ever reached step 86 died on it:
 *
 *     [focus: a way out that cannot be rendered away]
 *     expected exactly 1 match, found 0
 *
 * Reading fullbleed's source is how you get that wrong, and reading it is
 * the only thing available to anyone who cannot run a build. Which is the
 * whole reason this suite exists: it replays the region so the question
 * "does my anchor still exist at my position" has an answer without one.
 *
 * WHAT IT DOES NOT DO. It replays one region, not the chain. An anchor into
 * anything else is still unheld, and a step that touches the shell without
 * naming one of its ids is invisible to the discovery below. The ids are
 * asserted to be found in a known number of steps, so that going quiet is
 * itself a failure rather than a silent narrowing.
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
const SCRIPTS = path.join(ROOT, 'scripts');

/* The chain, read from build.js rather than restated here. */
const bs = fs.readFileSync(path.join(SCRIPTS, 'build.js'), 'utf8');
const open = bs.indexOf('const CHAIN = [');
/* eslint-disable-next-line no-eval */
const CHAIN = eval(bs.slice(open + 'const CHAIN = '.length, bs.indexOf('];', open) + 1));

/* Identifiers a replacement interpolates resolve to an inert stub: this
   replays STRUCTURE, and what the app would render into ${} is not it. */
const stub = new Proxy(function () { return '<!--x-->'; }, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => '<!--x-->' : k === 'then' ? undefined : stub),
  apply: () => '<!--x-->',
});
function tpl(raw) {
  try {
    /* eslint-disable-next-line no-new-func */
    /* Symbol.unscopables MUST come back undefined. with() consults it to
       decide which names the object does NOT supply, and a proxy that answers
       the stub there marks every identifier as excluded — the scope looks
       empty and the template throws 'X is not defined'. That is how splash
       went missing from this replay until the guard above said so. */
    return new Function('S', 'with(S){return `' + raw + '`}')(new Proxy({}, {
      has: () => true,
      get: (t, k) => (k === Symbol.unscopables ? undefined : stub),
    }));
  } catch (_) { return null; }
}
const PATCH_RE = /patch\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*`((?:\\.|[^\\`])*)`\s*,\s*`((?:\\.|[^\\`])*)`/g;
function pairs(file) {
  const src = fs.readFileSync(path.join(SCRIPTS, file), 'utf8');
  const out = [];
  let m;
  PATCH_RE.lastIndex = 0;
  while ((m = PATCH_RE.exec(src))) {
    const find = tpl(m[3]), repl = tpl(m[4]);
    if (find !== null && repl !== null) out.push({ label: m[2], find, repl });
  }
  return out;
}

const IDS = /id="(navbar|shell|app|srLive|focusExit)"/;

head('the steps that touch the shell are found, not assumed');
const touching = CHAIN
  .map((name, i) => ({ name, step: i + 1, file: `${name}-patch.js` }))
  .filter(s => fs.existsSync(path.join(SCRIPTS, s.file)) && IDS.test(fs.readFileSync(path.join(SCRIPTS, s.file), 'utf8')));
{
  /* VACUITY GUARD. Discovery returning nothing would make every replay below
     trivially true — the shape this repo keeps producing. */
  ok('some chain steps write the shell region', touching.length >= 4,
     touching.map(s => `${s.name}(${s.step})`).join(' '));
  /* And extraction must not quietly drop one of them: a shell-touching
     patch() the regex cannot read is a step this replay would skip. */
  const dropped = [];
  for (const s of touching) {
    const src = fs.readFileSync(path.join(SCRIPTS, s.file), 'utf8');
    const declared = [...src.matchAll(/patch\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*`((?:\\.|[^\\`])*)`/g)]
      .filter(m => IDS.test(m[3])).map(m => m[2]);
    const got = new Set(pairs(s.file).filter(p => IDS.test(p.find)).map(p => p.label));
    for (const d of declared) if (!got.has(d)) dropped.push(`${s.name}: ${d}`);
  }
  ok('and every shell-touching patch in them was readable', dropped.length === 0, dropped.join('; '));
}

head('replaying the region in chain order');
/* The shell before any step touches it. fullbleed anchors on exactly this,
   which is what makes it the right seed rather than a guess. */
let html = '<div id="shell">\n  <div id="app"></div>\n</div>';
const applied = [];
{
  const seed = html;
  ok('the seed is the form the first shell step anchors on',
     pairs('fullbleed-patch.js').some(p => seed.includes(p.find)));
  for (const s of touching) {
    for (const p of pairs(s.file)) {
      const n = html.split(p.find).length - 1;
      if (!IDS.test(p.find)) continue;
      if (n === 1) { html = html.replace(p.find, () => p.repl); applied.push(`${s.name}(${s.step})`); }
      else if (n > 1) ok(`${s.name}(${s.step}) "${p.label.slice(0, 40)}" is ambiguous in the shell`, false, `${n} matches`);
    }
  }
  ok('every discovered step found its place in the region', applied.length >= 4, applied.join(' '));
}

head('the region ends up with the landmarks it is supposed to have');
{
  /* Each of these is the point of the step that put it there — the <main>
     is disclaimer's skip-to-content target, srLive is announce's polite
     region, focusExit is the way out of focus mode. */
  ok('the accessibility landmark survived', /<main id="app"><\/main>/.test(html));
  ok('the live region is beside it, not inside it',
     /<main id="app"><\/main>[\s\S]*id="srLive"/.test(html) && !/<main[^>]*>[\s\S]*srLive[\s\S]*<\/main>/.test(html));
  ok('the header is there for the bar to be painted into', /<header id="navbar"><\/header>/.test(html));
  ok('and focus mode\'s exit is in the static shell, outside #app',
     /id="focusExit"/.test(html) && !/<main id="app">[\s\S]*focusExit/.test(html));
  /* NON-VACUITY. The pre-disclaimer form must be GONE — otherwise every
     check above would also pass against a replay that never ran. */
  ok('and the div that <main> replaced is no longer anywhere in it',
     !html.includes('<div id="app"></div>'));
}

head('every anchor into the region matches exactly once where it runs');
{
  /* THE REGRESSION. focusmode's anchor is evaluated against the region as it
     stands at step 86, not as fullbleed left it at 34. */
  const problems = [];
  for (const s of touching) {
    let state = '<div id="shell">\n  <div id="app"></div>\n</div>';
    for (const e of touching) {
      if (e.step >= s.step) break;
      for (const p of pairs(e.file)) {
        if (!IDS.test(p.find)) continue;
        if (state.split(p.find).length - 1 === 1) state = state.replace(p.find, () => p.repl);
      }
    }
    for (const p of pairs(s.file)) {
      if (!IDS.test(p.find)) continue;
      const n = state.split(p.find).length - 1;
      if (n !== 1) problems.push(`${s.name}(${s.step}) "${p.label.slice(0, 44)}" → found ${n}`);
    }
  }
  ok('no step anchors on shell markup that is gone by the time it runs',
     problems.length === 0, problems.join('; '));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
