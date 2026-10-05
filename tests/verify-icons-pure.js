#!/usr/bin/env node
/*
 * Every icon the app names is drawn by the one sprite the page has.
 *
 *   node tests/verify-icons-pure.js
 *
 * icon(name) is <use href="#i-name">, and a <use> that points at nothing draws nothing and says nothing:
 * no error, no console line, just an empty button. The focus-mode, theme and Apex full-screen buttons were
 * blank that way, because their symbols lived in a second sprite (a script string nothing inserted), and
 * the theme button's symbol existed nowhere. So, read from app/systole.html and src/ with comments blanked:
 *   · the live sprite is the <svg><defs> in the page markup, and it is the only place a symbol is defined;
 *   · every name handed to icon() is one of its symbols: string literals in the call, the values of
 *     CH_ICONS, and the literals of a const the call is handed by name (msgIcon);
 *   · every href="#i-..." written into markup is one of its symbols.
 * It cannot see a name built at run time from data it does not read; there is none today, and a new one
 * would show here as an identifier with no literals, which fails.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};

const raw = fs.readFileSync(path.join(ROOT, 'app', 'systole.html'), 'utf8');
const html = blankComments(raw);
/* in markup means not inside a <script>: the last script opened before it was closed before it */
const lastOpen = html.lastIndexOf('<script', html.indexOf('<defs>'));
const inScript = lastOpen !== -1 && html.indexOf('</script>', lastOpen) > html.indexOf('<defs>');
const spriteAt = html.indexOf('<defs>');
const spriteEnd = html.indexOf('</defs>', spriteAt);
const live = new Set([...html.slice(spriteAt, spriteEnd).matchAll(/<symbol id="i-([a-z0-9-]+)"/g)].map(m => m[1]));
const everywhere = [...html.matchAll(/<symbol id="i-([a-z0-9-]+)"/g)].length;

console.log('\n── the one sprite ──');
ok('the sprite is in the page markup, not inside a script', spriteAt > 0 && spriteEnd > spriteAt && !inScript, `defs at ${spriteAt}`);
ok('it draws the app\'s icons', live.size >= 40, live.size + ' symbols');
ok('no symbol is defined anywhere else in the file', everywhere === live.size, `${everywhere} defined, ${live.size} in the sprite`);

/* what the code names */
const files = [['app/systole.html', html]];
(function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p); else if (f.name.endsWith('.js')) files.push([path.relative(ROOT, p), blankComments(fs.readFileSync(p, 'utf8'))]);
  }
})(path.join(ROOT, 'src'));

const named = new Map();   // name → where
const note = (n, where) => { if (!named.has(n)) named.set(n, where); };
const unresolved = [];
for (const [file, src] of files) {
  /* icon( … ) — the first argument, up to the comma or close paren at depth 0 */
  const re = /\bicon\(/g; let m;
  while ((m = re.exec(src))) {
    if (/function\s+$/.test(src.slice(Math.max(0, m.index - 10), m.index))) continue;   // the definition itself
    let i = m.index + 5, depth = 0, arg = '';
    for (; i < src.length; i++) {
      const c = src[i];
      if ((c === ',' || c === ')') && depth === 0) break;
      if (c === '(' || c === '[') depth++;
      if (c === ')' || c === ']') depth--;
      arg += c;
    }
    const lits = [...arg.matchAll(/['"]([a-z0-9-]+)['"]/g)].map(x => x[1]);
    lits.forEach(n => note(n, file));
    if (/CH_ICONS/.test(arg)) continue;   // its values are read below
    const ident = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(arg);
    if (ident && ident[1] !== 'name') {
      const def = new RegExp('(?:const|let|var)\\s+' + ident[1] + '\\s*=([^;\\n]*)').exec(src);
      const dl = def ? [...def[1].matchAll(/['"]([a-z0-9-]+)['"]/g)].map(x => x[1]) : [];
      if (!dl.length) unresolved.push(`${file}: icon(${ident[1]})`);
      dl.forEach(n => note(n, file + ' via ' + ident[1]));
    } else if (!lits.length && !(ident && ident[1] === 'name')) unresolved.push(`${file}: icon(${arg.trim().slice(0, 40)})`);
  }
  for (const h of src.matchAll(/href="#i-([a-z0-9-]+)"/g)) note(h[1], file + ' href');
}
const ch = /const CH_ICONS=(\{[^}]*\})/.exec(html);
const chIcons = ch ? Object.values(JSON.parse(ch[1])) : [];
chIcons.forEach(n => note(n, 'CH_ICONS'));

console.log('\n── every icon named is drawn ──');
ok('the chapter icons are read', chIcons.length >= 10, chIcons.length + ' chapters');
ok('there are icon names to check, from the markup and the code', named.size >= 40, named.size + ' names');
const missing = [...named].filter(([n]) => !live.has(n)).map(([n, w]) => `${n} (${w})`);
ok('every one of them is a symbol in the sprite', missing.length === 0, missing.join(', ') || 'all ' + named.size);
ok('no icon is named by something this check cannot read', unresolved.length === 0, unresolved.join('; ') || 'none');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
