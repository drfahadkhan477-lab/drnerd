#!/usr/bin/env node
/*
 * md() — the one place model output becomes HTML.
 *
 *   node tests/verify-md-pure.js
 *
 * No browser and no build. md() lives in the built bundle, so this rebuilds it
 * from the patch chain and drives the result directly.
 *
 * WHY IT IS WORTH A SUITE. Seventeen sites in the app assign to innerHTML, and
 * the ones that matter are the AI path:
 *
 *     live.innerHTML = md(text) + toolStrip();     apex, gemini, streamthrottle
 *
 * `text` is whatever the model said. The design is right — md() opens with
 * `let s=e(t)`, escaping before it transforms — but until now nothing anywhere
 * in seventy suites asserted it. Every grep for "escap" in tests/ finds the
 * Escape key or an escape hatch.
 *
 * WHAT THIS CAN AND CANNOT CLAIM. e() is not in this repository: it comes from
 * the ACCSAP base export, so the app's whole HTML-injection defence is a
 * function the project does not own and cannot review. This suite therefore
 * does two separable things:
 *
 *   1. It checks md()'s OWN behaviour — that it escapes first, never reaches
 *      back to the raw input afterwards, and none of its own rules re-open
 *      what e() closed. That is entirely this repository's code and is checked
 *      exactly.
 *   2. It states what e() must do for (1) to be worth anything, and proves the
 *      dependency by running md() against an escaper that does NOT do it. That
 *      turns "we assume e() is fine" into a named, tested contract.
 *
 * It cannot verify e() itself. Only the built bundle can, and that needs a
 * browser — the same division tests/verify-ipad-pure.js draws for the same
 * reason.
 *
 * THE FUNCTION IS REBUILT, NOT COPIED. A copy of md() pasted here would be
 * wrong the first time anybody patched the real one, and would keep passing.
 * So the chain is walked: start from read-patch's MD_NEW and apply every later
 * patch whose anchor appears in the text, in chain order, each exactly once —
 * the chain's own safety model. Seven patches across five steps currently
 * apply, two of which (figview, apexpage) were not found by grepping for
 * "function md(" and would have been missed by a hand-written list.
 */
'use strict';
const fs = require('fs');
const path = require('path');
/* Not a local copy: five of those existed once and two had drifted.
   verify-engine.js enforces the single copy, and caught this file doing it. */
const { blankComments } = require('./_source.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ── rebuilding md() ─────────────────────────────────────────────────────── */
const applied = [];
function buildMd() {
  const m = read('scripts/read-patch.js')
    .match(/const MD_NEW = (\[[\s\S]*?\n\])\.join\('\\n'\);/);
  if (!m) throw new Error('read-patch.js no longer defines MD_NEW as a line array');
  /* eslint-disable no-eval */
  let md = eval(m[1]).join('\n');

  const chain = read('scripts/build.js').match(/const CHAIN = \[([\s\S]*?)\];/)[1];
  const names = [...chain.matchAll(/'([a-z0-9-]+)'/g)].map(x => x[1]);
  const after = names.slice(names.indexOf('read') + 1);
  const CALL = /patch\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*,\s*`((?:\\.|[^\\`])*)`\s*,\s*`((?:\\.|[^\\`])*)`\s*\)/g;
  const un = t => t.replace(/\\`/g, '`').replace(/\\\$/g, '$').replace(/\\\\/g, '\\');

  for (const n of after) {
    const f = path.join(ROOT, 'scripts', `${n}-patch.js`);
    if (!fs.existsSync(f)) continue;
    for (const p of fs.readFileSync(f, 'utf8').matchAll(CALL)) {
      const find = un(p[3]);
      if (find.length < 20) continue;          // too short to be md-specific
      const hits = md.split(find).length - 1;
      if (hits === 0) continue;
      /* The chain's rule, kept: an anchor that matches twice is not an anchor.
         Reporting it rather than guessing which one was meant. */
      if (hits > 1) { applied.push(`AMBIGUOUS ${n}: ${p[2]}`); continue; }
      md = md.split(find).join(un(p[4]));
      applied.push(`${n}: ${p[2]}`);
    }
  }
  return md;
}

const MD_SRC = buildMd();

/* An escaper that does what e() is assumed to do. Named REFERENCE rather than
   `e`, because it is this suite's assumption made visible — not the app's. */
const REFERENCE = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* The same thing with the quotes left alone — the one weakening that md()'s
   own output is sensitive to. */
const NO_QUOTES = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function compile(escaper, figures) {
  const refImgSrc = key => (figures && figures[key]) || '';
  const factory = new Function('e', 'refImgSrc', 'REF_IMGS', 'RefAssets',
    `${MD_SRC}\nreturn md;`);
  return factory(escaper, refImgSrc, figures || {}, { get: refImgSrc });
}
const md = compile(REFERENCE, { k: 'data:image/png;base64,AAAA' });

head('the function under test is the one the chain builds');
{
  const bad = applied.filter(a => a.startsWith('AMBIGUOUS'));
  ok('MD_NEW was found and is a whole function',
     /^function md\(t\)\{/.test(MD_SRC.trim()) && /return s;/.test(MD_SRC),
     `${MD_SRC.split('\n').length} lines`);
  /* Vacuity guard. "Apply every patch that matches and expect no failures" is
     also what applying none looks like. */
  ok('later patches were applied to it', applied.length >= 5, `${applied.length} applied`);
  ok('and none of their anchors was ambiguous', bad.length === 0, bad.join('; ') || 'none');
  ok('it compiles to a callable function', typeof md === 'function');
  for (const a of applied) console.log(`          ${a}`);
}

/* ── looking at tags, not at substrings ─────────────────────────────────────
   The first version of this suite asked whether the OUTPUT TEXT contained
   "<img" or " onerror=" and called that unsafe. It is not: escaped output
   contains those characters all the time —

       <p>&lt;img src=x onerror=alert(1)&gt;</p>

   is exactly right, and the predicate called it a breach. Eleven checks failed
   and the code was correct in all eleven. A substring of the rendered text
   says nothing; what matters is what is inside a real `<...>` span. So the
   output is taken apart into tags, and every tag and every attribute is held
   to what md() itself is allowed to emit. */
function tags(html) {
  return [...String(html).matchAll(/<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)]
    .map(m => ({ name: m[1].toLowerCase(), attrs: m[2], whole: m[0] }));
}
/* Everything md() builds, read off its own source rather than imagined. */
const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'code', 'pre', 'h3', 'h4',
  'ul', 'li', 'ol', 'hr', 'blockquote', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'figure', 'img', 'figcaption']);
/* md() emits exactly one event handler of its own, a literal from
   figview-patch. Any OTHER on-handler in a tag came from the input. */
const OWN_HANDLER = /^onclick="openFigureFrom\(this\)"$/;
function offences(html) {
  const bad = [];
  for (const t of tags(html)) {
    if (!ALLOWED_TAGS.has(t.name)) { bad.push(`<${t.name}>`); continue; }
    for (const a of t.attrs.matchAll(/([a-zA-Z-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g)) {
      const pair = `${a[1]}=${a[2]}`;
      if (/^on/i.test(a[1]) && !OWN_HANDLER.test(pair)) bad.push(pair);
    }
  }
  return bad;
}

head('the inspector can tell a live tag from an escaped one');
{
  /* Guard on the guard: offences() returning [] is also what a broken
     inspector returns, and that is the whole failure mode this repo produces. */
  ok('escaped markup in text is not an offence',
     offences('<p>&lt;img src=x onerror=alert(1)&gt;</p>').length === 0);
  ok('a real script tag is', offences('<p><script>x</script></p>').join() === '<script>',
     offences('<p><script>x</script></p>').join());
  ok('a real handler on an allowed tag is',
     offences('<img src="a" onerror="alert(1)">').join() === 'onerror="alert(1)"',
     offences('<img src="a" onerror="alert(1)">').join());
  ok("and md()'s own figure handler is not",
     offences('<figure onclick="openFigureFrom(this)">').length === 0);
}

head('escaping happens first, and the raw input is never reached again');
{
  /* Structural, because it is a property of the code rather than of any one
     input: every later rule operates on `s`, which is e(t). A rule that read
     `t` again would put unescaped text back into the output no matter how
     good e() is. */
  /* Blanked, not stripped: the scan below is per line and by position, and
     removing a comment would shift both. */
  const lines = blankComments(MD_SRC).split('\n');
  const first = lines.findIndex(l => /\S/.test(l) && !/^function md/.test(l.trim()));
  ok('the first thing md() does is escape its argument',
     /^\s*let\s+s\s*=\s*e\(\s*t\s*\)\s*;/.test(lines[first]), lines[first].trim());
  /* LITERALS FIRST, AND THAT IS NOT A DETAIL. Scanning the raw lines for the
     identifier `t` matched `[ \t]` inside two regexes — a tab, not a variable —
     and reported the table rule and the <hr> rule as reaching back to the
     unescaped input. The check was wrong, the code was right; narrowing it is
     the fix, not relaxing what it claims. */
  const scrub = src => src
    .replace(/\\./g, '\u0000')                     // escape sequences: \t, \", \\
    .replace(/`[^`]*`/g, '``')
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""')
    .replace(/\/(?![*/])(?:\[[^\]]*\]|[^/\n])+\/[gimsuy]*/g, '/RE/');
  const reaches = lines.slice(first + 1)
    .map(l => [l, scrub(l)])
    .filter(([, c]) => /(^|[^\w$.])t([^\w$]|$)/.test(c));
  ok('and nothing after that line reads the raw argument again',
     reaches.length === 0, reaches.map(([l]) => l.trim().slice(0, 60)).join(' | ') || 'none');
}

head('what a model says cannot become what the page runs');
{
  const cases = [
    ['a script tag', '<script>alert(1)</script>'],
    ['an image with an error handler', '<img src=x onerror=alert(1)>'],
    ['an inline event on a div', '<div onclick="alert(1)">tap</div>'],
    ['a javascript: URL', '<a href="javascript:alert(1)">x</a>'],
    ['an iframe', '<iframe src="data:text/html,<script>alert(1)</script>"></iframe>'],
    ['a closing tag mid-sentence', 'the dose is </p><script>alert(1)</script>'],
    ['markup inside a code fence', '```\n<img src=x onerror=alert(1)>\n```'],
    ['markup inside a bold run', '**<img src=x onerror=alert(1)>**'],
    ['markup inside a table cell', '| a | b |\n|---|---|\n| <img src=x onerror=alert(1)> | y |'],
    ['markup inside a list item', '- <img src=x onerror=alert(1)>'],
    ['markup inside a blockquote', '> <img src=x onerror=alert(1)>'],
    ['markup inside a heading', '## <img src=x onerror=alert(1)>'],
  ];
  for (const [what, input] of cases) {
    const bad = offences(md(input));
    ok(what, bad.length === 0, bad.join(', ') || 'inert');
  }
}

head('the figure rule is the one place md() writes an attribute');
{
  /* ref-images-patch builds `<img src="${src}" alt="${cap}">` from a caption
     taken out of the escaped string. It is the only interpolation in md() that
     lands inside quotes, which makes it the only one whose safety depends on
     e() escaping the quote character rather than just the angle brackets. */
  const out = md('![a plain caption](refimg://k)');
  ok('a well-formed citation still renders its figure',
     /<figure class="ref-fig"/.test(out) && /alt="a plain caption"/.test(out),
     (out.match(/<img[^>]*>/) || [''])[0].slice(0, 80));
  ok('an unknown key renders nothing rather than a broken image',
     md('![x](refimg://nope)').indexOf('<img') < 0, md('![x](refimg://nope)').slice(0, 60));
  const attacked = md('![x" onerror="alert(1)](refimg://k)');
  ok('a caption cannot close the alt attribute it lands in',
     offences(attacked).length === 0, offences(attacked).join(', ') || 'inert');
}

head('and that is exactly what e() has to guarantee');
{
  /* THE CONTRACT, PROVEN BY BREAKING IT. e() is not in this repository, so the
     honest thing is not to assume it escapes quotes but to show what md() does
     when it does not. If this suite ever needs weakening, the real e() is what
     changed and the alt attribute above is where it will show. */
  const weak = compile(NO_QUOTES, { k: 'data:image/png;base64,AAAA' });
  const out = weak('![x" onerror="alert(1)](refimg://k)');
  ok('with an escaper that leaves quotes alone, the caption breaks out',
     offences(out).some(b => /^onerror=/.test(b)), offences(out).join(', ') || 'still inert');
  ok('so e() MUST escape the double quote, and this is the site that needs it',
     /alt="/.test(MD_SRC), 'alt="${cap}" in the figure rule');
  /* Guard on the guard: a reference escaper that did nothing would make every
     check in the section above pass for the wrong reason. */
  ok('the reference escaper actually escapes', REFERENCE('<"&>') === '&lt;&quot;&amp;&gt;',
     REFERENCE('<"&>'));
  ok('and the weakened one differs from it only in the quote',
     NO_QUOTES('<"&>') === '&lt;"&amp;&gt;', NO_QUOTES('<"&>'));
}

head('and the whole section above is load-bearing');
{
  /* FAIL-FIRST, KEPT RATHER THAN PERFORMED ONCE. Twelve checks that say
     "inert" are worth exactly as much as the demonstration that they can say
     anything else. Compiling md() against an escaper that does nothing is the
     defect those checks exist to catch, and it belongs in the file rather than
     in a commit message nobody will re-run. */
  const raw = compile(s => String(s), { k: 'data:image/png;base64,AAAA' });
  const live = [
    ['<script>alert(1)</script>', 'script'],
    ['<img src=x onerror=alert(1)>', 'img'],
    ['<div onclick="alert(1)">tap</div>', 'div'],
  ];
  for (const [input, expected] of live) {
    const bad = offences(raw(input));
    ok(`without escaping, ${expected} gets through — so the checks above measure something`,
       bad.length > 0, bad.join(', ') || 'NOTHING GOT THROUGH — the checks above prove nothing');
  }
  ok('and escaped output of the same input is clean',
     offences(md(live[0][0])).length === 0);
}

head('the ordinary job still gets done');
{
  /* A renderer that escaped everything and rendered nothing would pass every
     check above. */
  ok('bold becomes strong', /<strong>dose<\/strong>/.test(md('**dose**')));
  ok('a heading becomes a heading', /<h3>Method<\/h3>/.test(md('## Method')));
  ok('a bullet becomes a list item', /<li>one<\/li>/.test(md('- one')));
  ok('a fence becomes a code block', /<pre><code>/.test(md('```\nx\n```')));
  ok('a pipe table becomes a table', /<table>/.test(md('| a | b |\n|---|---|\n| 1 | 2 |')));
  ok('and prose becomes a paragraph', /<p>hello<\/p>/.test(md('hello')));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
