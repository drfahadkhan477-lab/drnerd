#!/usr/bin/env node
/*
 * The header's capsule, src/app/gnav.js: where it shows, which item it lights, and what it draws.
 *
 *   node tests/verify-gnav-pure.js
 *
 * Pure Node. The module is handed a stand-in icon() that says what it was asked, so what is expected is written here, never
 * read back from the module. What is measured:
 *   - the four items, in order, and each one's action and destination;
 *   - for every screen the app has and every page of Home's pager, whether the capsule shows and which item it lights,
 *     against a table written out here (docs/UI-REVAMP.md, C): never on Home's first page or where a question is read,
 *     Labs for the screens reached from the Labs page, Chapters for Chapters, nothing for the searches;
 *   - that it is no tab bar: no role="tab", no .home-tabs, one aria-current at most, and hidden where it does not show;
 *   - the page's side, read from the shell's text: buildNav draws it between the brand and the buttons, renderNow and
 *     homeMark keep it in step, ACTIONS names gnavGo, and gnavGo sends Chapters to goStudy and the pages to Home's pager.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');
const G = require('../src/app/gnav.js').GNav;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + String(detail).replace(/\s+/g, ' ') : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);
const kit = { icon: (n, c) => '[icon ' + n + (c ? ' ' + c : '') + ']' };

head('the items');
ok('four, in order: Home, Brain, Labs, Chapters', J(G.ITEMS.map(i => i.key)) === J(['home', 'brain', 'labs', 'chapters']) && J(G.ITEMS.map(i => i.label)) === J(['Home', 'Brain', 'Labs', 'Chapters']), J(G.ITEMS));
{
  const html = G.gnavHtml('study', 0, kit);
  const btns = [...html.matchAll(/<button class="gnav-it" type="button" data-action="([^"]*)" data-go="([^"]*)" aria-label="([^"]*)"( aria-current="page")?>(\[icon [^\]]*\])<span>([^<]*)<\/span><\/button>/g)];
  ok('each a button naming one action, gnavGo, with its destination as data', btns.length === 4 && btns.every(m => m[1] === 'gnavGo') && J(btns.map(m => m[2])) === J(['home', 'brain', 'labs', 'chapters']), J(btns.map(m => m[1] + ':' + m[2])));
  ok('each with its own icon from the sprite and its name both spoken and shown', J(btns.map(m => m[5])) === J(['[icon home icon-sm]', '[icon brain icon-sm]', '[icon activity icon-sm]', '[icon book icon-sm]']) && btns.every(m => m[3] === m[6]), J(btns.map(m => m[5])));
  ok('a labelled group with the lit capsule first, not a nav of its own (the header is the nav)', /^<div class="gnav" id="gnav" role="group" aria-label="Sections"><span class="gnav-ind" aria-hidden="true"><\/span><button/.test(html) && html.endsWith('</button></div>') && !/<nav\b/.test(html), html.slice(0, 120));
}

head('where it shows and what it lights, screen by screen');
/* Every value S.screen takes (buildScreen in app/systole.html), and Home's three pages. Written out, not derived. */
const TABLE = [
  ['home', 0, false, null], ['home', 1, true, 'brain'], ['home', 2, true, 'labs'],
  ['quiz', 0, false, null], ['results', 0, false, null], ['mock', 0, false, null], ['mockreport', 0, false, null],
  ['study', 0, true, 'chapters'],
  ['lab', 0, true, 'labs'], ['echo', 0, true, 'labs'], ['practice', 0, true, 'labs'], ['sessions', 0, true, 'labs'],
  ['stats', 0, true, 'labs'], ['refs', 0, true, 'labs'], ['memory', 0, true, 'labs'], ['annotations', 0, true, 'labs'],
  ['search', 0, true, null], ['notesearch', 0, true, null],
];
const shell = fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8');
const screens = [...new Set([...blankComments(shell).matchAll(/S\.screen==='([a-z]+)'\?/g)].map(m => m[1]))];
ok('the table names every screen buildScreen draws (precondition)', screens.length >= 15 && screens.every(s => TABLE.some(r => r[0] === s)), 'buildScreen: ' + screens.join(' '));
const wrongShown = TABLE.filter(([s, p, sh]) => G.gnavShown(s, p, false) !== sh).map(r => r[0] + '/' + r[1]);
ok('shown on Brain, Labs and every study screen; not on Home\'s first page or where a question is read', wrongShown.length === 0, wrongShown.join(', '));
const wrongLit = TABLE.filter(([s, p, , lit]) => G.gnavActive(s, p) !== lit).map(r => `${r[0]}/${r[1]}: ${G.gnavActive(r[0], r[1])}`);
ok('lit: Brain or Labs on their pages, Labs for what the Labs page opens, Chapters for Chapters, nothing for the searches', wrongLit.length === 0, wrongLit.join(', '));
ok('and never in focus mode, where the header is gone', TABLE.every(([s, p]) => G.gnavShown(s, p, true) === false));

head('no tab bar');
{
  const all = TABLE.map(([s, p]) => G.gnavHtml(s, p, kit));
  ok('no role="tab" and no .home-tabs anywhere it is drawn', all.every(h => !/role="tab"|home-tabs?\b/.test(h)));
  ok('at most one item marked current, and exactly the lit one', TABLE.every(([s, p, , lit], i) => {
    const cur = [...all[i].matchAll(/data-go="([a-z]+)"[^>]*aria-current="page"/g)].map(m => m[1]);
    return lit ? J(cur) === J([lit]) : cur.length === 0; }));
  ok('drawn hidden where it does not show, so a move along the pager can bring it in', TABLE.every(([s, p, sh], i) => /^<div class="gnav"[^>]*\shidden>/.test(all[i]) === !sh));
}

head('the page\'s side');
{
  const code = blankComments(shell);
  ok('the module is written into the page once', (shell.match(/@@SLOT\[src:src\/app\/gnav\.js\]@@/g) || []).length === 1);
  ok('buildNav draws it between the brand and the buttons', /<\/div>\s*\$\{GNav\.gnavHtml\(S\.screen,typeof homePage==='number'\?homePage:0,\{icon\}\)\}\s*<div class="nav-right">/.test(code));
  ok('renderNow puts it right after drawing the bar, and homeMark when the page changes', /bar\.innerHTML=buildNav\(\); gnavSync\(\);/.test(code) && /function homeMark\(\)\{[\s\S]*?gnavSync\(\);\s*\}/.test(code));
  ok('ACTIONS names gnavGo, with the destination from the button', /gnavGo:el=>gnavGo\(el\.dataset\.go\)/.test(code));
  const fn = (code.match(/function gnavGo\(k\)\{[\s\S]*?\n\}/) || [''])[0];
  ok('gnavGo: Chapters opens Chapters; Home, Brain and Labs glide the pager there, or open Home on that page', /if\(k==='chapters'\)\{ goStudy\(\); return; \}/.test(fn) && /\{home:0,brain:1,labs:2\}\[k\]/.test(fn) && /if\(S\.screen==='home'\) homeGo\(p\); else \{ homePage=p; goHome\(\); \}/.test(fn), fn.replace(/\s+/g, ' ').slice(0, 200));
  ok('gnavSync shows it only where the module says and only from 700px, and folds Home\'s search while it is up', /GNav\.gnavShown\(S\.screen,page,!!S\.focusMode\)&&!\(window\.matchMedia&&matchMedia\('\(max-width:699px\)'\)\.matches\)/.test(code) && /classList\.toggle\('has-gnav',want\)/.test(code));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
