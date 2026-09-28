#!/usr/bin/env node
'use strict';
/*
 * The split build ships src/'s modules without their comments: is what it
 * ships still exactly the code, and nothing but the comments gone?
 *
 *   node tests/verify-stripcomments-pure.js
 *
 * scripts/strip-comments.js is a small lexer that build-pwa runs over every
 * src/ module app.js carries verbatim (see "the comments in src/'s modules"
 * there). A lexer that misreads one construct ships a broken app, so this
 * checks it three ways:
 *
 *   · the constructs a comment stripper gets wrong, each with its exact
 *     expected output — // and /* inside strings, templates with nested
 *     ${...}, regex literals against division, CRLF, and what a removed
 *     comment leaves behind so that no two tokens join and no line merges;
 *   · every real src/ module: it still compiles, stripping it again changes
 *     nothing, and heart3d.js — the largest — still computes the very same
 *     mesh, byte for byte, which is behaviour and not just syntax;
 *   · stripEmbedded(), the function build-pwa calls: it replaces a module
 *     only where app.js holds it verbatim exactly once, and stops the build
 *     when a stripped module will not compile.
 *
 * NOT HERE: the split build itself. verify-pwa measures the shell it ships
 * and boots it; this suite needs no build.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { strip, stripEmbedded } = require('../scripts/strip-comments.js');
const { blankComments } = require('./_source.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const ROOT = path.join(__dirname, '..');
const same = (label, src, want) => {
  let got; try { got = strip(src); } catch (e) { got = 'threw: ' + e.message; }
  ok(label, got === want, got === want ? '' : JSON.stringify(got));
};

head('what a comment leaves behind');
same('a line that was only a comment is gone', '// only a comment\nx = 1;\n', 'x = 1;\n');
same('a trailing comment takes its whitespace with it', 'x = 1;   // trailing\ny = 2;\n', 'x = 1;\ny = 2;\n');
same('an inline block comment becomes a space, so two tokens cannot join', 'a/*x*/b', 'a b');
same('a block comment across lines becomes a line break, so ASI sees what it saw', 'f() /* one\ntwo */ g()', 'f()\n g()');
same('CRLF line ends survive, and a comment-only CRLF line goes whole', 'x=1; // c\r\n// d\r\ny=2;\r\n', 'x=1;\r\ny=2;\r\n');

head('nothing inside a literal is touched');
same('// and /* inside double quotes', 's = "http://a // b /* c */";', 's = "http://a // b /* c */";');
same('an escaped quote does not end the string', "t = 'it\\'s // here'; // gone", "t = 'it\\'s // here';");
same('a template keeps its //, and a comment inside ${} goes', 'u = `a // b ${ c /* d */ } e`; // f', 'u = `a // b ${ c  } e`;');
same('a template nested in a template\'s ${}', 'v = `x ${ `y // ${z} /*w*/` } q`;', 'v = `x ${ `y // ${z} /*w*/` } q`;');
same('an object literal inside ${} does not end the template', 'w = `${ {a: 1}.a } // k`;', 'w = `${ {a: 1}.a } // k`;');

head('a regex is a regex, and division is division');
same('slashes escaped and inside a class', 'r = /\\/\\/[/*]+/g.test(u); // c', 'r = /\\/\\/[/*]+/g.test(u);');
same('division, twice on one line', 'a = b / c / d; // c', 'a = b / c / d;');
same('a regex after return, // inside its class and all', 'return /[//]/.test(s); // c', 'return /[//]/.test(s);');
same('division after a name, which a regex reading would end at the comment', 'h = w / 2; // c / d', 'h = w / 2;');
same('division after a postfix ++', 'n = i++ / 2; // half', 'n = i++ / 2;');
same('division after a closing bracket', 'm = a[0] / b[1] /* per */;', 'm = a[0] / b[1] ;');

head('every src/ module, stripped');
const mods = require('child_process').execFileSync('git', ['ls-files', 'src'], { cwd: ROOT, encoding: 'utf8' })
  .trim().split('\n').filter(f => /\.js$/.test(f) && !/^src\/worker\//.test(f));
const broken = [], unstable = [], unshrunk = [];
for (const f of mods) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  let lean;
  try { lean = strip(src); new vm.Script(lean, { filename: f }); }
  catch (e) { broken.push(f + ': ' + e.message.slice(0, 60)); continue; }
  if (strip(lean) !== lean) unstable.push(f);
  if (blankComments(src) !== src && !(lean.length < src.length)) unshrunk.push(f);
}
ok('there are modules to strip', mods.length >= 20, `${mods.length} modules`);
ok('every one still compiles once stripped', broken.length === 0, broken.join('; ') || `${mods.length} of ${mods.length}`);
ok('stripping one again changes nothing: nothing left that the lexer reads as a comment', unstable.length === 0, unstable.join(', '));
ok('and every module that has comments comes out smaller', unshrunk.length === 0, unshrunk.join(', '));

const HEART = fs.readFileSync(path.join(ROOT, 'src', 'core', 'heart3d.js'), 'utf8');
const { bake } = require('../scripts/heart-bake.js');
const noKey = b => Buffer.concat([b.subarray(0, 4), b.subarray(20)]);   // the key is a digest of the text, so it must differ
const meshOf = src => Buffer.from(bake(src).b64, 'base64');
const full = meshOf(HEART);
let lean; try { lean = meshOf(strip(HEART)); } catch (e) { lean = e; }
ok('heart3d.js stripped computes the same mesh, byte for byte',
   Buffer.isBuffer(lean) && full.length === lean.length && noKey(full).equals(noKey(lean)),
   Buffer.isBuffer(lean) ? `${lean.length} bytes` : 'threw: ' + lean.message.slice(0, 60));

head('stripEmbedded(), as build-pwa calls it');
const modA = '/* A */\nvar a = 1; // one\n', modB = '// B\nvar b = 2;\n', modC = 'var c = 3; /* C */\n';
const app = 'var pre = 0;\n' + modA + 'var mid = 0;\n' + modB + modB + 'var post = 0;\n';
const r = stripEmbedded(app, [['a.js', modA], ['b.js', modB], ['c.js', modC]]);
ok('a module held verbatim once is replaced by its stripped text', r.stripped.includes('a.js') && r.code.includes('var a = 1;\nvar mid') && !r.code.includes('/* A */'));
ok('one held twice is left alone and named', r.skipped.includes('b.js') && r.code.split(modB).length === 3);
ok('one not there at all is left alone and named', r.skipped.includes('c.js'));
ok('and nothing outside the modules changes', r.code.startsWith('var pre = 0;\n') && r.code.endsWith('var post = 0;\n'));
let refused; try { stripEmbedded('x;\nlet = = ;\n', [['bad.js', 'let = = ;\n']]); refused = 'shipped'; } catch (e) { refused = e.message; }
ok('a module that will not compile once stripped stops the build', /bad\.js no longer compiles/.test(refused), refused.slice(0, 70));

head('build-pwa runs it');
const PWA = blankComments(fs.readFileSync(path.join(ROOT, 'scripts', 'build-pwa.js'), 'utf8'));
ok('build-pwa passes app.js and src/\'s modules through stripEmbedded',
   /require\('\.\/strip-comments\.js'\)/.test(PWA) && /stripEmbedded\(appCode, mods\)/.test(PWA) && /appCode = strippedModules\.code;/.test(PWA));
ok('and stops if the heart\'s module was not among them',
   /strippedModules\.stripped\.includes\('src\/core\/heart3d\.js'\)/.test(PWA));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
