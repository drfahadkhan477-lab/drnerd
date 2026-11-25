#!/usr/bin/env node
/**
 * A colour written as a hex literal goes in a token, not in a rule or a script (roadmap D1, part c).
 *
 *   node tests/verify-hexcolours-pure.js
 *
 * WHY. A theme reaches a colour only through a custom property. A rule that writes #EF4444, or a script that hands one to
 * the page, paints the same colour in Daylight, Midnight and Contrast, and nothing says so. D1 asks for one design language:
 * colours declared once, as tokens, and every other place naming the token.
 *
 * WHAT COUNTS. Comments are blanked first (tests/_source.js), so a comment quoting a colour is not one.
 *   - In a stylesheet (app/css): a hex literal in a value, unless that value is a custom property's (`--name: … #hex`),
 *     which is a token. One in a selector (#fade{…}) is an id, and one in a string is not drawn.
 *   - In the shell (app/systole.html) and in src/: every hex literal, except an HTML character reference (&#8212;).
 *     A script has no structure this reads: a canvas colour, a meta tag's and a rule's are all counted.
 * A hex literal is # and 3, 4, 6 or 8 hex digits, not followed by a letter, digit, - or _.
 *
 * KNOWN is what each file held when this suite was written, less the review ratings, which became tokens in the same
 * change. It is exact: the suite fails on a file over its number (a new literal: make it a token, or say in the change why
 * it is not one, as a canvas drawing may), on a file under it (lower the number in the change that removed one), and on a
 * file it names that is gone. So the table can only shrink, in the change that shrinks it. themes.css holds the palettes
 * and declares nothing but tokens; a literal in one of its values would be counted like any other.
 *
 * The reader is tried on small texts first, one for each way it could be wrong: a reader that finds nothing would pass
 * every file below. It does not read colours written as rgb(), hsl() or names; those are not counted, here or anywhere.
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
const J = JSON.stringify;

const ROOT = path.join(__dirname, '..');
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9A-Za-z_-])/g;

/* Stylesheet: comments and strings blanked, positions kept. Then each hex literal is read by what stands around it: the
   next of { ; } after it is { for a selector; the declaration it is in starts after the last { ; } before it. */
function cssHexes(css) {
  const t = blankComments(css).replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, m => m.replace(/[^\n]/g, ' '));
  const out = [];
  for (const m of t.matchAll(HEX)) {
    const after = t.slice(m.index).search(/[{;}]/);
    if (after >= 0 && t[m.index + after] === '{') continue;                      // an id in a selector
    const before = Math.max(t.lastIndexOf('{', m.index), t.lastIndexOf(';', m.index), t.lastIndexOf('}', m.index));
    if (/^\s*--[A-Za-z0-9_-]+\s*:/.test(t.slice(before + 1, m.index))) continue;  // a token's value
    out.push({ hex: m[0], line: t.slice(0, m.index).split('\n').length });
  }
  return out;
}
/* Script, or the shell: comments blanked, strings kept (a colour in a script is in a string). */
function scriptHexes(src) {
  const t = blankComments(src), out = [];
  for (const m of t.matchAll(HEX)) {
    if (m.index > 0 && t[m.index - 1] === '&') continue;                         // &#8212; is a character, not a colour
    out.push({ hex: m[0], line: t.slice(0, m.index).split('\n').length });
  }
  return out;
}

head('the reader, on small texts');
{
  const hx = css => cssHexes(css).map(h => h.hex);
  ok('a colour in a rule is found', J(hx('.a{color:#EF4444}')) === '["#EF4444"]', J(hx('.a{color:#EF4444}')));
  ok('in any of its lengths, 3, 4, 6 and 8', J(hx('.a{color:#fff;background:#ffff;border-color:#a1b2c3;outline-color:#a1b2c3d4}')) === '["#fff","#ffff","#a1b2c3","#a1b2c3d4"]');
  ok('and inside a longer value, as the last declaration of a block', J(hx('.a{box-shadow:0 1px 2px #000}')) === '["#000"]');
  ok('a token\'s value is not counted', hx(':root{--red:#DC2626;--edge: 0 0 0 1px #fff}').length === 0);
  ok('but a rule after a token is', J(hx(':root{--red:#DC2626}.a{color:#111}')) === '["#111"]');
  ok('an id in a selector is not a colour, nor one with a pseudo-class before it', hx('#fade{color:red}.x:not(#bad) b{color:red}').length === 0);
  ok('a colour in a comment or a string is not one', hx('/* #EF4444 */.a::after{content:"#EF4444"}').length === 0);
  ok('five digits, or a name that runs on, is not a colour', hx('.a{color:#abcde}.b{color:#fff-ish}').length === 0);
  ok('each is reported with its line', (() => { const h = cssHexes('.a{}\n.b{color:#123}'); return h.length === 1 && h[0].line === 2; })());
  const sx = src => scriptHexes(src).map(h => h.hex);
  ok('in a script, a colour in a string is found', J(sx("const c='#EF4444', d=`#0891B2`;")) === '["#EF4444","#0891B2"]');
  ok('and one in a comment is not', sx('// #EF4444\n/* #0891B2 */ const x=1;').length === 0);
  ok('a character reference is not a colour', sx("html='&#8212; &#x2014;'").length === 0);
}

/* Every stylesheet the pages ship, the shell, and every module in src/. */
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
const rel = f => path.relative(ROOT, f).replace(/\\/g, '/');
const files = [
  ...fs.readdirSync(path.join(ROOT, 'app', 'css')).filter(f => f.endsWith('.css')).sort().map(f => path.join(ROOT, 'app', 'css', f)),
  path.join(ROOT, 'app', 'systole.html'),
  ...walk(path.join(ROOT, 'src')).filter(f => f.endsWith('.js')).sort(),
];
const found = new Map(files.map(f => {
  const text = fs.readFileSync(f, 'utf8');
  return [rel(f), f.endsWith('.css') ? cssHexes(text) : scriptHexes(text)];
}));

/* What each file held when this suite was written (none means it is not listed). Illustration is a canvas or an SVG drawn
   in colours of its own: the heart, the traces, the diagrams. */
const KNOWN = {
  'app/css/apex.css': 17,
  'app/css/cardiac.css': 16,
  'app/css/figures.css': 8,
  'app/css/figviewer.css': 4,
  'app/css/gnav.css': 55,
  'app/css/home.css': 27,
  'app/css/nav.css': 15,
  'app/css/refinements.css': 7,
  'app/css/study.css': 18,
  'app/css/themes.css': 1,
  'app/systole.html': 40,
  'src/app/home.js': 1,
  'src/app/study.js': 1,
  'src/core/physio.js': 7,              // illustration
  'src/core/themes.js': 12,
  'src/lab/ui.js': 1,
  'src/ui/apex.js': 1,
  'src/ui/ecg12.js': 8,                 // illustration
  'src/ui/wiggers.js': 26,              // illustration
};

head('the stylesheets, the shell and src/, against what they held');
{
  ok('there is something to read: the stylesheets, the shell and the modules', files.length > 40 && found.get('app/systole.html') !== undefined && [...found.keys()].some(f => f.startsWith('app/css/')), files.length + ' files');
  ok('and the reader finds colours in them, so a reader gone blind cannot pass', [...found.values()].reduce((n, h) => n + h.length, 0) > 200);
  const over = [], under = [];
  for (const [file, hexes] of found) {
    const known = KNOWN[file] || 0;
    if (hexes.length > known) over.push(file + ' ' + hexes.length + ' of ' + known + ' (' + hexes.slice(0, 3).map(h => h.hex + ' at line ' + h.line).join(', ') + ')');
    else if (hexes.length < known) under.push(file + ' ' + hexes.length + ' of ' + known);
  }
  ok('no file holds a hex colour outside a token that it did not hold before', over.length === 0, over.join(' · ') || 'none');
  ok('and none holds fewer: a number in the table falls in the change that removes a colour', under.length === 0, under.join(' · ') || 'none');
  const gone = Object.keys(KNOWN).filter(f => !found.has(f));
  ok('every file the table names is still read', gone.length === 0, gone.join(' ') || 'none');
}

head('the review ratings are tokens');
{
  const page = blankComments(fs.readFileSync(path.join(ROOT, 'app', 'systole.html'), 'utf8'));
  const ratings = (page.match(/const RATINGS=\[([\s\S]*?)\];/) || [])[1] || '';
  const names = [...ratings.matchAll(/'var\((--[a-z-]+)\)'/g)].map(m => m[1]);
  ok('the four ratings name a custom property each, and no colour', names.length === 4 && new Set(names).size === 4 && !HEX.test(ratings), J(names));
  HEX.lastIndex = 0;
  const base = blankComments(fs.readFileSync(path.join(ROOT, 'app', 'css', 'base.css'), 'utf8'));
  const declared = names.filter(n => new RegExp('[{;\\s]' + n + '\\s*:\\s*#[0-9A-Fa-f]{6}\\b').test(base));
  ok('and base.css declares each, so a theme can reach it', declared.length === 4, J(declared));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
