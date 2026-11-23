#!/usr/bin/env node
/**
 * Every var(--name) in the stylesheets the pages ship names a custom property something defines.
 *
 *   node tests/verify-cssvars-pure.js
 *
 * WHY. A var() whose property nothing defines, written without a fallback, makes its whole declaration invalid when the page is
 * drawn, and the browser says nothing. Home's aurora named --hp-b, which nothing defined, so its three gradients painted none of
 * the colour the glass above them was meant to show; two titles named --font-serif, which nothing defined (the token is
 * --font-display), so they were set in the body face. Both were found by measuring (docs/validation/ui-revamp-baseline.json),
 * not by any suite. verify-tokens holds the colour aliases to each other; nothing held a var() to its definition until this.
 *
 * WHAT COUNTS AS A DEFINITION. A declaration `--name:` in any stylesheet in app/css, in the shell (app/systole.html, whose inline
 * styles and script write some), in src/ (modules that write an inline style or call style.setProperty('--name')), or in a vendored
 * library in app/vendor (PhotoSwipe sets --pswp-transition-duration from its script), with comments
 * blanked first, so a comment quoting a name does not define it. Where it is defined (which selector, which theme) is not read: a
 * property defined for one scope and used in another passes here, and that is a browser question, not a text one.
 * A var() with a fallback, var(--name, something), is never invalid for want of --name, so it is not asked about.
 *
 * KNOWN lists the undefined names this suite found when it was written that are still waiting for a decision, each with what it
 * breaks. The suite fails on any undefined name not in it, and on any name in it that is now defined or no longer used, so the list
 * can only shrink, and shrinks in the change that fixes the name. The reader is tried on small stylesheets first, one for each way
 * it could be wrong: a reader that finds nothing would pass every file below.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const NAME = '--[A-Za-z0-9_-]+';

/* CSS text with comments and strings blanked, positions kept (strings, because content:"var(--x)" is not a use). */
const cssText = css => blankComments(css).replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, m => m.replace(/[^\n]/g, ' '));
/* Names a text defines: a declaration `--name:` or a setProperty('--name', …). Script and HTML keep their strings, which is where
   an inline style or a setProperty call holds the name; only their comments are blanked. */
function definedIn(text, isCss) {
  const t = isCss ? cssText(text) : blankComments(text), out = new Set();
  for (const m of t.matchAll(new RegExp('(' + NAME + ')\\s*:', 'g'))) out.add(m[1]);
  for (const m of t.matchAll(new RegExp('setProperty\\(\\s*["\'`](' + NAME + ')', 'g'))) out.add(m[1]);
  return out;
}
/* Uses with no fallback in a stylesheet: [{ name, line }]. */
function bareUses(css) {
  const t = cssText(css), out = [];
  for (const m of t.matchAll(new RegExp('var\\(\\s*(' + NAME + ')\\s*([,)])', 'g')))
    if (m[2] === ')') out.push({ name: m[1], line: t.slice(0, m.index).split('\n').length });
  return out;
}
function undefinedUses(files, defs) {
  const out = [];
  for (const [file, css] of files) for (const u of bareUses(css)) if (!defs.has(u.name)) out.push(Object.assign({ file }, u));
  return out;
}

head('the reader, on small stylesheets');
{
  const run = (css, extra = '') => {
    const defs = new Set([...definedIn(css, true), ...definedIn(extra, false)]);
    return undefinedUses([['t.css', css]], defs).map(u => u.name);
  };
  ok('a var() nothing defines is found', JSON.stringify(run('.a{color:var(--nope)}')) === '["--nope"]', JSON.stringify(run('.a{color:var(--nope)}')));
  ok('one the stylesheet defines is not', run(':root{--yes:red}.a{color:var(--yes)}').length === 0);
  ok('one with a fallback is not asked about', run('.a{color:var(--nope, red)}').length === 0 && run(':root{--and:red}.a{color:var(--nope,var(--and))}').length === 0);
  ok('but the var() inside a fallback is', JSON.stringify(run('.a{color:var(--x,var(--deeper))}')) === '["--deeper"]', JSON.stringify(run('.a{color:var(--x,var(--deeper))}')));
  ok('a definition written in a comment defines nothing', JSON.stringify(run('/* --c: red */.a{color:var(--c)}')) === '["--c"]');
  ok('a use written in a comment or a string is not a use', run('/* var(--c) */.a::after{content:"var(--d)"}').length === 0);
  ok('a script setting the property defines it', run('.a{color:var(--s)}', "el.style.setProperty('--s', 'red')").length === 0);
  ok('and so does an inline style a script writes', run('.a{color:var(--i)}', 'html += `<b style="--i:2">`').length === 0);
  ok('but not one only a script comment mentions', JSON.stringify(run('.a{color:var(--k)}', "// el.style.setProperty('--k', 1)")) === '["--k"]');
  ok('each use is reported with its line', (() => { const u = bareUses('.a{}\n.b{color:var(--q)}'); return u.length === 1 && u[0].line === 2; })());
}

/* Undefined when this suite was written (and its reader found every one of them), each with what it costs. */
const KNOWN = {
  '--hp-b': 'Home aurora (home.css): the declaration is void, so no aurora paints under Home\'s glass',
  '--font-serif': '.hero-h1 and .stats-title (cardiac.css): the font-family is void; the Progress title falls back to the body face',
  '--fg': '.q-restart:hover (home-quiz.css): colour and border fall back to the inherited text colour',
  '--card2': '.pearl-emblem (home.css): the radial ground is void; only its background-color paints',
  '--ground': '.echo-phase-controls button, .echo-flow-branches p (nav.css): no background paints',
};

head('the stylesheets the pages ship');
const cssFiles = fs.readdirSync(path.join(ROOT, 'app/css')).filter(f => f.endsWith('.css')).sort()
  .map(f => ['app/css/' + f, fs.readFileSync(path.join(ROOT, 'app/css', f), 'utf8')]);
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const scriptFiles = [path.join(ROOT, 'app/systole.html'), ...walk(path.join(ROOT, 'src')).filter(f => /\.(js|html)$/.test(f)),
  ...walk(path.join(ROOT, 'app/vendor')).filter(f => /\.js$/.test(f))];
const defs = new Set();
for (const [, css] of cssFiles) for (const n of definedIn(css, true)) defs.add(n);
for (const f of scriptFiles) for (const n of definedIn(fs.readFileSync(f, 'utf8'), false)) defs.add(n);

const uses = cssFiles.flatMap(([file, css]) => bareUses(css).map(u => Object.assign({ file }, u)));
ok('the stylesheets were read: many var() uses and many definitions (precondition)', cssFiles.length >= 10 && uses.length > 200 && defs.size > 100,
   `${cssFiles.length} files, ${uses.length} bare uses, ${defs.size} names defined`);
const missing = undefinedUses(cssFiles, defs);
const unknown = missing.filter(u => !KNOWN[u.name]);
ok('every var() with no fallback names a property something defines, or a known one waiting for a decision', unknown.length === 0,
   unknown.map(u => `${u.name} at ${u.file}:${u.line}`).join(', '));
const still = new Set(missing.map(u => u.name));
const stale = Object.keys(KNOWN).filter(n => !still.has(n));
ok('and every known one is still used and still undefined, so the list only shrinks', stale.length === 0,
   stale.map(n => n + (defs.has(n) ? ' is now defined' : ' is no longer used') + ': take it out of KNOWN').join('; '));
console.log('  known, undefined: ' + [...still].filter(n => KNOWN[n]).map(n => `${n} (${KNOWN[n]})`).join('; '));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
