#!/usr/bin/env node
'use strict';
const { stripCssDocs } = require('../scripts/css-docs.js');
let passed = 0, failed = 0;
const ok = (label, condition) => { condition ? passed++ : failed++; console.log((condition ? '  PASS  ' : '  FAIL  ') + label); };
const cases = [
  ['leading documentation', '/* explain */\n.a{color:red}', '\n.a{color:red}'],
  ['documentation between rules', '.a{}\n/* multi\nline */\n.b{}', '.a{}\n\n.b{}'],
  ['trailing documentation', '.a{} /* explain */', '.a{} '],
  ['quoted comment text', '.a{content:" /* keep */ "} /* omit */ ', '.a{content:" /* keep */ "}  '],
  ['escaped quotes in strings', '.a{content:"\\\" /* keep */ "} /* omit */ ', '.a{content:"\\\" /* keep */ "}  '],
  ['unquoted URL tokens', '.a{background:url(https://example.test/a/*keep*/b)} /* omit */ ', '.a{background:url(https://example.test/a/*keep*/b)}  '],
  ['quoted URL tokens', '.a{background:URL(" /* keep */ ")} /* omit */ ', '.a{background:URL(" /* keep */ ")}  '],
  ['comments separating name tokens', '.a{color:re/**/d} /* omit */ ', '.a{color:re/**/d}  '],
  ['comments inside compound selectors', '.a/**/.b{} /* omit */ ', '.a/**/.b{}  '],
  ['documentation touching a token', '/* keep */.a{} /* omit */ ', '/* keep */.a{}  '],
];
for (const [label, input, expected] of cases) ok(label, stripCssDocs(input) === expected);
ok('optional compaction collapses token whitespace without joining selectors or calc terms',
  stripCssDocs('.a   .b { width:calc(1px  +  2px); }', true) === '.a .b { width:calc(1px + 2px); }');
ok('compaction preserves strings, URLs, escapes and inline comments',
  stripCssDocs('.a { content:"a  b";background:url("a  b");color:re/**/d }', true) === '.a { content:"a  b";background:url("a  b");color:re/**/d }');
ok('compaction preserves hexadecimal escape terminators and a following descendant space',
  stripCssDocs(String.raw`.\31  .b { color:red }`, true) === String.raw`.\31  .b { color:red }`);
for (const input of ['/* incomplete', '.a{content:"incomplete', '.a{background:url(incomplete']) {
  let threw = false; try { stripCssDocs(input); } catch (_) { threw = true; }
  ok('malformed CSS is refused: ' + input.split('{')[0], threw);
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
