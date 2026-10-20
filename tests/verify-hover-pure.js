#!/usr/bin/env node
/**
 * Every :hover rule in the stylesheets the pages ship is asked for only where a device can hover.
 *
 *   node tests/verify-hover-pure.js
 *
 * On a touch screen the element that was tapped goes on matching :hover until something else is tapped, so a hover style that is
 * not behind @media (hover:hover) stays on the screen after the tap: the Flag button, tapped on and then off, stayed amber with no
 * flag set. tests/verify-taps.js holds the Systole app to this in a browser, on the stylesheets as the engine holds them, and
 * taps the button. This reads the stylesheets as text, with no browser and no build, so that the Memorizer's page and the
 * Lab's are held to it as well, on every push, in a tenth of a second.
 *
 * HOW IT READS A STYLESHEET. Comments and strings are blanked, keeping every position, and the braces are followed with a stack of
 * the at-rules the walk is inside. A style rule whose selector list holds :hover counts as asked for if some @media rule on the stack
 * applies only where the device's primary input can hover, which tests/_hover.js decides: every query in its list must be a plain
 * conjunction holding (hover: hover), so that a negation, an "or", a list with a query every device satisfies, or (any-hover: hover),
 * which a touch screen with a mouse beside it satisfies while the finger can still leave :hover behind, is not taken for a guard (the
 * first version took any media text that contained the words, and was shown the first two of those by the review). A list that mixes
 * :hover with :focus-visible, :active or a class is one rule and is bare, so the others have to be split out of it. CSS reads :HOVER
 * as :hover, @MEDIA as @media and NOT as not, and so does this (a browser hands its own walk all three in lower case, and this
 * reader is handed the text as written); what it does not read is a selector spelt with an escape (:\68 over), which no stylesheet
 * here holds and which is not worth the code to read.
 * The reader is tried on small stylesheets first, one for each way it could be wrong, because a reader that finds nothing, or finds
 * everything guarded, would pass over every file below.
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

const { blankComments } = require('./_source.js');
const { impliesHover } = require('./_hover.js');

const ROOT = path.join(__dirname, '..');

/* The :hover style rules of a stylesheet, as { sel, guarded }, and whether its braces balanced. Comments go through the shared
   blanker; strings are blanked here, because a brace in one (content: "}") is not a brace. The shared blanker reads // as a comment,
   which CSS does not: no stylesheet here holds one outside a comment or a string, and one that gained an unquoted url(//host/...)
   would lose the rest of its line, which the check that the braces balance would notice. */
function hoverRules(css) {
  const blank = blankComments(css)
    .replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, m => m.replace(/[^\n]/g, ' '));
  const stack = [], found = []; let prelude = '', balanced = true;
  for (const c of blank) {
    if (c === '{') { stack.push(prelude.trim()); prelude = ''; }
    else if (c === '}') {
      const sel = stack.pop(); prelude = '';
      if (sel === undefined) { balanced = false; continue; }
      if (!sel.startsWith('@') && /:hover/i.test(sel)) {
        found.push({ sel: sel.replace(/\s+/g, ' '), guarded: stack.some(s => /^@media\b/i.test(s) && impliesHover(s.replace(/^@media/i, ''))) });
      }
    } else if (c === ';') prelude = '';
    else prelude += c;
  }
  return { rules: found, balanced: balanced && stack.length === 0 };
}
const bare = css => hoverRules(css).rules.filter(r => !r.guarded).map(r => r.sel);

head('the reader, on small stylesheets');
{
  const one = '{color:red}';
  ok('a :hover rule that nothing guards is found', bare('.a:hover' + one).join() === '.a:hover');
  ok('and it is found however the pseudo-class is cased, which CSS reads as the same one', bare('.a:HOVER' + one + '.b:Hover' + one).join() === '.a:HOVER,.b:Hover');
  ok('one inside @media (hover:hover) is not', bare('@media (hover:hover){.a:hover' + one + '}').length === 0);
  ok('but one inside (any-hover: hover) is, because a mouse beside a touch screen satisfies it and the finger can still leave :hover behind', bare('@media (any-hover: hover){.a:hover' + one + '}').join() === '.a:hover');
  ok('nor one inside a conjunction that holds it', bare('@media screen and (hover:hover){.a:hover' + one + '}@media (hover: hover) and (pointer: fine){.b:hover' + one + '}').length === 0);
  ok('nor one in a guard that sits inside another at-rule', bare('@media (prefers-reduced-motion: reduce){@media (hover:hover){.a:hover' + one + '}}').length === 0);
  ok('but one inside (hover: none), the wrong way round, is', bare('@media (hover:none){.a:hover' + one + '}').join() === '.a:hover');
  ok('and one inside some other media query is', bare('@media (min-width:600px){.a:hover' + one + '}').join() === '.a:hover');
  ok('and one inside the negation of the guard, which applies on exactly the devices that cannot hover, is', bare('@media not (hover:hover){.a:hover' + one + '}@media (not (hover:hover)){.b:hover' + one + '}').length === 2);
  ok('and one inside the negation of a query that holds it, with a media type in front, is', bare('@media not all and (hover:hover){.a:hover' + one + '}').join() === '.a:hover');
  ok('and one inside a list that a query every device satisfies is in, however the list is written, is', bare('@media (hover:hover), (min-width:1px){.a:hover' + one + '}@media (min-width:1px), (hover:hover){.b:hover' + one + '}@media (min-width:1px), screen and (hover:hover){.c:hover' + one + '}').length === 3);
  ok('and one inside an "or", or an "or" mixed with "and", is', bare('@media (hover:hover) or (min-width:1px){.a:hover' + one + '}@media (min-width:1px) or (max-width:5px) and (hover:hover){.b:hover' + one + '}').length === 2);
  ok('but not one inside a list whose every query holds it', bare('@media (hover:hover), screen and (hover: hover){.a:hover' + one + '}').length === 0);
  ok('and a guard is a guard however it is cased, @MEDIA (HOVER: HOVER) and (hover:hover) AND (pointer:fine) included', bare('@MEDIA (HOVER: HOVER){.a:hover' + one + '}@media (hover:hover) AND (pointer:fine){.b:hover' + one + '}').length === 0);
  ok('and @supports is not a guard', bare('@supports (hover:hover){.a:hover' + one + '}').join() === '.a:hover');
  ok('a list that mixes :hover with :focus-visible is one rule, and is found', bare('.a:hover,.a:focus-visible' + one).length === 1);
  ok('a rule after a guarded one is not taken for guarded', bare('@media (hover:hover){.a:hover' + one + '}.b:hover' + one).join() === '.b:hover');
  ok('a :hover in a comment or a string is not a rule', bare('/* .a:hover{color:red} */ .b{content:".c:hover{"} .d{color:red}').length === 0);
  ok('braces in a string do not lose its place', hoverRules('.b{content:"}}"} .a:hover' + one).rules.length === 1 && hoverRules('.b{content:"}}"}').balanced);
}

head('the stylesheets');
{
  const dirs = fs.readdirSync(path.join(ROOT, 'app', 'css')).filter(f => f.endsWith('.css')).sort().map(f => path.join('app', 'css', f));
  const families = [
    ['the Systole app', dirs],
    ['the Memorizer', [path.join('memorizer', 'app.css')]],
    ['the Lab page', [path.join('lab', 'app.css')]],
  ];
  for (const [name, files] of families) {
    const text = files.map(f => ({ f, css: fs.readFileSync(path.join(ROOT, f), 'utf8') }));
    const read = text.map(t => ({ f: t.f, bytes: t.css.length, ...hoverRules(t.css) }));
    ok(`${name}: its stylesheets are read, none is empty, and every file's braces balance`, files.length > 0 && read.every(r => r.bytes > 0 && r.balanced),
       `${files.length} files, ${read.reduce((n, r) => n + r.bytes, 0)} bytes${read.some(r => !r.balanced) ? ', unbalanced: ' + read.filter(r => !r.balanced).map(r => r.f).join(', ') : ''}`);
    const rules = read.flatMap(r => r.rules.map(x => ({ ...x, f: r.f })));
    const loose = rules.filter(r => !r.guarded);
    ok(`${name}: no :hover rule applies where a device cannot hover`, loose.length === 0, `${loose.length} bare: ${loose.slice(0, 4).map(r => r.f.split(path.sep).pop() + ' ' + r.sel).join(' | ')}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
