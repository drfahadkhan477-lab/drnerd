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
  ok('gnavGo: Chapters opens Chapters; Home, Brain and Labs glide the pager there (Home through homeOpen, which hands focus back to the door that was used), or open Home on that page', /if\(k==='chapters'\)\{ goStudy\(\); return; \}/.test(fn) && /\{home:0,brain:1,labs:2\}\[k\]/.test(fn) && /if\(S\.screen==='home'\)\{ if\(p===0\) homeOpen\(0\); else homeGo\(p\); \} else \{ homePage=p; goHome\(\); \}/.test(fn), fn.replace(/\s+/g, ' ').slice(0, 200));
  ok('the session score beside it is spoken as what it is, not as bare numbers (docs/UI-REVAMP.md, D)',
     /<div class="score-pill" role="img" aria-label="This session: \$\{S\.sessionCorrect\} of \$\{S\.sessionTotal\} correct, \$\{p\}%"/.test(code));
  ok('gnavSync shows it only where the module says and only from 700px, and folds Home\'s search while it is up', /GNav\.gnavShown\(S\.screen,page,!!S\.focusMode\)&&!\(window\.matchMedia&&matchMedia\('\(max-width:699px\)'\)\.matches\)/.test(code) && /classList\.toggle\('has-gnav',want\)/.test(code));
}

head('the back buttons it takes over (app/css/gnav.css)');
{
  /* The rule in gnav.css that sets a back button aside while the capsule is up, read as text with comments blanked: a
     display:none under body.has-gnav outside the header (the header folds its own search with rules of the same shape). */
  const css = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'css', 'gnav.css'), 'utf8'));
  const rules = [...css.matchAll(/([^{}]+)\{\s*display\s*:\s*none\s*\}/g)].map(m => m[1].split(',').map(x => x.trim()).filter(Boolean))
    .filter(sels => sels.length && sels.every(x => x.startsWith('body.has-gnav ') && !x.startsWith('body.has-gnav .nav')));   // .nav: the header's own
  const sels = rules.length === 1 ? rules[0].map(x => x.slice('body.has-gnav '.length)) : [];
  /* Written out: each back button whose destination is a capsule item (Home, Brain and Labs' Home button; Chapters' Back;
     the Rhythm Lab's, Search's and Progress's Home; Sessions' Labs; Annotations' Chapters; the Practice lab's Home; the
     Notes screen's Back and Back to study; Memory's Back). */
  const WANT = ['.home-back', '.study-back', '.sb-back[data-action="goHome"]', '.sb-back[data-action="goLabs"]',
    '.sb-back[data-action="goStudy"]', '.plab-back[data-act="leave"]', '.ref-btns [data-action="goHome"]'];
  ok('one rule, and only while the capsule is up (body.has-gnav), sets aside exactly these', rules.length === 1 && J(sels) === J(WANT), J(rules));
  /* Every button the app's modules draw: its classes, its attributes, and its file. A button in a module that draws a
     .ref-btns row counts as inside it: Notes (refs.js) and Memory (memory.js) hold their goHome buttons there. */
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const files = walk(path.join(__dirname, '..', 'src')).filter(f => f.endsWith('.js'));
  const refRows = new Set(files.filter(f => /class="ref-btns"/.test(blankComments(fs.readFileSync(f, 'utf8')))).map(f => path.relative(path.join(__dirname, '..'), f)));
  const buttons = files.flatMap(f => [...blankComments(fs.readFileSync(f, 'utf8')).matchAll(/<button class="([^"]*)"([^>]*)>/g)].map(m => ({
    file: path.relative(path.join(__dirname, '..'), f), cls: m[1].split(/\s+/),
    attrs: Object.fromEntries([...m[2].matchAll(/([a-z-]+)="([^"]*)"/g)].map(a => [a[1], a[2]])) })));
  const one = (sel, b) => {
    const m = sel.match(/^(\.ref-btns )?(?:\.([a-z-]+))?(?:\[([a-z-]+)="([^"]*)"\])?$/);
    if (!m) return null;
    if (m[1] && !refRows.has(b.file)) return false;
    if (m[2] && !b.cls.includes(m[2])) return false;
    if (m[3] && b.attrs[m[3]] !== m[4]) return false;
    return true;
  };
  const read = WANT.every(x => buttons.some(b => one(x, b) !== null));
  ok('the source was read: many buttons, each selector understood, and the .ref-btns rows found where Notes and Memory draw them (precondition)',
     buttons.length > 50 && read && refRows.has('src/app/refs.js') && refRows.has('src/app/memory.js'), buttons.length + ' buttons; .ref-btns in ' + [...refRows].join(', '));
  const hit = sels.map(x => ({ x, b: buttons.filter(b => one(x, b)) }));
  ok('each selector sets aside a button the app draws, none a name nothing has', hit.length === WANT.length && hit.every(h => h.b.length > 0), J(hit.map(h => h.x + ': ' + h.b.length)));
  /* Where each goes, and the capsule item that goes there too (Home's pages and the screens Labs opens come back through
     goHome to the page they were left on, which the capsule names). */
  const dest = b => b.attrs['data-action'] === 'homeOpen' && b.attrs['data-page'] === '0' ? 'home'
    : b.attrs['data-action'] === 'goHome' || b.attrs['data-act'] === 'leave' ? 'home'
    : b.attrs['data-action'] === 'goLabs' ? 'labs' : b.attrs['data-action'] === 'goStudy' ? 'chapters' : null;
  const stray = hit.flatMap(h => h.b).filter(b => !dest(b) || /\/(quiz|results|mock[a-z]*)\.js$/.test(b.file));
  ok('and every one it sets aside goes where a capsule item goes, on a screen the capsule is drawn on', stray.length === 0,
     J(stray.map(b => b.file + ' ' + b.cls.join('.') + ' ' + J(b.attrs))));
  const KEPT = [['the Practice lab\'s back to the lab', b => b.cls.includes('plab-back') && b.attrs['data-act'] === 'home'],
    ['the note search\'s back to its results', b => b.cls.includes('ns-back')],
    ['the question screens\' Home', b => b.cls.includes('btn-home')],
    ['Progress\'s export and import buttons, which share the back button\'s style', b => b.cls.includes('sb-back') && /Markup|Backup|reset/i.test(b.attrs['data-action'] || '')]];
  const taken = KEPT.map(([what, is]) => [what, buttons.filter(is)]).map(([what, bs]) => [what, bs.length, bs.filter(b => sels.some(x => one(x, b))).length]);
  ok('and it keeps the ones the capsule does not cover: ' + KEPT.map(k => k[0]).join('; '), taken.every(([, n, t]) => n > 0 && t === 0), J(taken));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
