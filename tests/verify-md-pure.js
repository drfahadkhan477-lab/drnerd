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
 * The last two sections hold what md() makes of the lists a model writes and
 * of the blocks around them: the bullet Gemini, the default model here, writes
 * is a list, and no block is ever drawn inside a paragraph.
 *
 * THE FUNCTION IS LIFTED, NOT COPIED. A copy of md() pasted here would be
 * wrong the first time anybody changed the real one, and would keep passing.
 * So it is cut out of app/systole.html, the page that ships. (It used to be
 * rebuilt by replaying the patch chain onto read-patch's MD_NEW; the chain is
 * retired and every edit to md() now goes into the page.)
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

/* ── md() as the page ships it ────────────────────────────────────────────
   Until the patch chain was retired this suite rebuilt md() by taking
   read-patch.js's MD_NEW and replaying every later patch step whose anchor
   matched it. Since then md() lives in app/systole.html and every edit goes
   there, so it is cut out of the page: from its one `function md(t){` to the
   first closing brace at column 0 after it. */
function liftMd() {
  const page = read('app/systole.html');
  const open = 'function md(t){';
  const n = page.split(open).length - 1;
  if (n !== 1) throw new Error(`app/systole.html: expected one "${open}", found ${n}`);
  const i = page.indexOf(open), j = page.indexOf('\n}\n', i);
  if (j < 0) throw new Error('md() has no closing brace at column 0');
  return page.slice(i, j + 2);
}

const MD_SRC = liftMd();

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

head('the function under test is the one the page ships');
{
  ok('md() was found and is a whole function',
     /^function md\(t\)\{/.test(MD_SRC.trim()) && /return s;/.test(MD_SRC),
     `${MD_SRC.split('\n').length} lines`);
  /* Vacuity guard: a cut that stopped early would still compile and would
     test a fragment. The figure branch is the last thing md() learned. */
  ok('the cut runs past the figure branch to the end of the function',
     /refImgSrc\(/.test(MD_SRC) && MD_SRC.trim().endsWith('}'), `${MD_SRC.length} characters`);
  ok('it compiles to a callable function', typeof md === 'function');
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
    ['markup inside a star bullet', '*   <img src=x onerror=alert(1)>'],
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
  /* The figure rule builds `<img src="${src}" alt="${cap}">` from a caption
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
  ok('and so does a star bullet', /<li>one<\/li>/.test(md('* one')));
  ok('a fence becomes a code block', /<pre><code>/.test(md('```\nx\n```')));
  ok('a pipe table becomes a table', /<table>/.test(md('| a | b |\n|---|---|\n| 1 | 2 |')));
  ok('and prose becomes a paragraph', /<p>hello<\/p>/.test(md('hello')));
}

/* ── the nesting of what md() wrote ───────────────────────────────────────────
   Read the way a browser's parser reads it, which is the way that matters: a block element opened inside an open <p> closes
   the <p>, so the text after it is left outside any paragraph and the page has an empty <p> it did not write. A <li> belongs
   to a list, and every tag that opens is closed in order. Returns '' for sound markup, and the first fault otherwise. */
function nesting(html) {
  const BLOCK = new Set(['ul', 'ol', 'h3', 'h4', 'pre', 'div', 'table', 'figure', 'blockquote', 'hr']);
  const VOID = new Set(['hr', 'img', 'br']);
  const stack = [];
  for (const m of String(html).matchAll(/<(\/?)([a-z0-9]+)\b[^>]*>/g)) {
    const close = m[1] === '/', name = m[2];
    if (!close && BLOCK.has(name) && stack.includes('p')) return `<${name}> opened inside a <p>`;
    if (VOID.has(name)) continue;
    if (!close) {
      if (name === 'li' && !/^(ul|ol)$/.test(stack[stack.length - 1] || '')) return '<li> outside a list';
      stack.push(name);
    } else if (stack.pop() !== name) return `</${name}> closes something other than what is open`;
  }
  return stack.length ? `<${stack[stack.length - 1]}> never closed` : '';
}

head('a model\'s lists');
{
  /* Guard on the guard: a checker that says '' of everything would pass every check below for the wrong reason. */
  ok('the checker can tell a list inside a paragraph from a list beside one',
     nesting('<p>Intro: <ul><li>one</li></ul>Outro.</p>') === '<ul> opened inside a <p>' && nesting('<p>Intro:</p><ul><li>one</li></ul><p>Outro.</p>') === '',
     nesting('<p>Intro: <ul><li>one</li></ul>Outro.</p>'));
  ok('and a loose <li>, a tag left open and a tag closed out of order',
     nesting('<li>a</li>') === '<li> outside a list' && nesting('<p>a') === '<p> never closed' && nesting('<ul><li>a</ul></li>') !== '');

  const UL = (...items) => '<ul>' + items.map(i => `<li>${i}</li>`).join('') + '</ul>';
  const OL = (...items) => '<ol>' + items.map(i => `<li>${i}</li>`).join('') + '</ol>';
  const gem = md('The key points:\n\n*   **Aortic stenosis:** fixed obstruction.\n*   **HOCM:** dynamic obstruction.\n\nIn summary, they differ.');
  ok('the * bullets Gemini writes, with three spaces after the star, are a list between two paragraphs',
     gem === '<p>The key points:</p>' + UL('<strong>Aortic stenosis:</strong> fixed obstruction.', '<strong>HOCM:</strong> dynamic obstruction.') + '<p>In summary, they differ.</p>', gem);
  ok('and with one space', md('* one\n* two') === UL('one', 'two'), md('* one\n* two'));
  ok('a bullet with an emphasis in it keeps its bullet, and the emphasis is on the right words',
     md('* a *very* important point\n* second') === UL('a <em>very</em> important point', 'second'), md('* a *very* important point\n* second'));
  ok('a star between spaces is a times sign and is left as it is',
     md('It is 5 * 3 * 2 = 30 here.') === '<p>It is 5 * 3 * 2 = 30 here.</p>', md('It is 5 * 3 * 2 = 30 here.'));
  ok('an emphasis is still one: at the start of a line, in brackets, and several in a line',
     md('*important* and (*also*) so *this one*') === '<p><em>important</em> and (<em>also</em>) so <em>this one</em></p>', md('*important* and (*also*) so *this one*'));
  ok('a star with a space after it does not open an emphasis, and one with a space before it does not close one',
     md('x * y* z') === '<p>x * y* z</p>' && md('a *b and 5 * 3') === '<p>a *b and 5 * 3</p>', [md('x * y* z'), md('a *b and 5 * 3')].join('  |  '));

  ok('a list after a paragraph is a block of its own, and what follows it is a paragraph',
     md('Intro:\n\n- one\n- two\n\nOutro.') === '<p>Intro:</p>' + UL('one', 'two') + '<p>Outro.</p>', md('Intro:\n\n- one\n- two\n\nOutro.'));
  ok('so is one written straight under its lead-in line',
     md('Intro:\n- one\n- two\n\nOutro.') === '<p>Intro:</p>' + UL('one', 'two') + '<p>Outro.</p>', md('Intro:\n- one\n- two\n\nOutro.'));
  ok('and a numbered one', md('Steps:\n\n1. first\n2. second\n\nDone.') === '<p>Steps:</p>' + OL('first', 'second') + '<p>Done.</p>', md('Steps:\n\n1. first\n2. second\n\nDone.'));
  ok('a list with a blank line between its items is one list', md('- a\n\n- b\n\n- c') === UL('a', 'b', 'c'), md('- a\n\n- b\n\n- c'));
  ok('a list that changes kind is two lists', md('1. one\n2. two\n- a\n- b') === OL('one', 'two') + UL('a', 'b'), md('1. one\n2. two\n- a\n- b'));
  ok('a line of prose between two bullets is a paragraph between two lists',
     md('- a\nmiddle\n- b') === UL('a') + '<p>middle</p>' + UL('b'), md('- a\nmiddle\n- b'));
}

head('and the blocks around them');
{
  /* Each block, written straight under a line of prose and with a line of prose straight under it. */
  const around = [
    ['a heading', 'Intro\n## Head\nBody', /^<p>Intro<\/p><h3>Head<\/h3><p>Body<\/p>$/],
    ['a table', 'Compare:\n| a | b |\n|---|---|\n| 1 | 2 |\n\nAfter.', /^<p>Compare:<\/p><div class="tw"><table>.*<\/table><\/div><p>After\.<\/p>$/],
    ['a quotation', 'Said:\n> quoted\n\nAfter.', /^<p>Said:<\/p><blockquote><p>quoted<\/p><\/blockquote><p>After\.<\/p>$/],
    ['a rule', 'above\n---\nbelow', /^<p>above<\/p><hr><p>below<\/p>$/],
    ['a code fence', 'Run:\n```\nx = 1\n```\nAfter.', /^<p>Run:<\/p><pre><code>\nx = 1\n<\/code><\/pre><p>After\.<\/p>$/],
    ['a figure', 'See:\n![a caption](refimg://k)\nAfter.', /^<p>See:<\/p><figure class="ref-fig"[^>]*><img [^>]*><figcaption aria-hidden="true">a caption<\/figcaption><\/figure><p>After\.<\/p>$/],
  ];
  for (const [what, input, shape] of around) {
    const out = md(input);
    ok(`${what} written under a line of prose is a block of its own, and the line after it is a paragraph`, shape.test(out) && nesting(out) === '', out.slice(0, 110));
  }
  ok('a paragraph after a table, a quotation or a list is a paragraph, not loose text',
     md('| a | b |\n|---|---|\n| 1 | 2 |\n\nAfter the table.').endsWith('</div><p>After the table.</p>')
     && md('> quoted\n\nAfter the quote.').endsWith('</blockquote><p>After the quote.</p>')
     && md('- a\n\nAfter the list.').endsWith('</ul><p>After the list.</p>'));
  ok('a code fence with a blank line inside is as it was: cut at the blank line, not made worse',
     md('Run:\n\n```\nline one\n\nline three\n```\n\nDone.') === '<p>Run:</p><pre><code>\nline one<p>line three </code></pre></p><p>Done.</p>',
     md('Run:\n\n```\nline one\n\nline three\n```\n\nDone.'));
  ok('and nothing written is still nothing: an empty answer is the empty paragraph it always was', md('') === '<p></p>', md(''));

  /* The same property over documents: blocks and prose in every order, with one newline or several between them. A fixed
     generator, so a failure names the same document on every run. */
  let seed = 20260719;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const WORDS = ['aortic', 'valve', 'stenosis', '5 mg', 'HOCM', 'EF 55%', 'a < b', 'x & y', 'beta-blocker'];
  const line = () => Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => pick([w => w, w => w, w => `**${w}**`, w => `*${w}*`, w => '`' + w + '`'])(pick(WORDS))).join(' ');
  const BLOCKS = [
    () => line(), () => line() + '\n' + line(), () => '## ' + pick(WORDS), () => '> ' + line(), () => '---', () => '```\n' + pick(WORDS) + '\n```',
    () => '| a | b |\n|---|---|\n| ' + pick(WORDS) + ' | y |', () => '![cap](refimg://k)',
    () => '- ' + line() + '\n- ' + line(), () => '* ' + line() + '\n* ' + line(), () => '*   ' + line() + '\n*   ' + line(), () => '1. ' + line() + '\n2. ' + line(),
    () => '- ' + line() + '\n\n- ' + line(), () => '1. ' + line() + '\n- ' + line(),
  ];
  let faults = 0, first = '', lists = 0;
  for (let i = 0; i < 4000; i++) {
    const doc = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => pick(BLOCKS)()).join(pick(['\n\n', '\n\n', '\n\n\n', '\n']));
    const out = md(doc), why = nesting(out);
    lists += (out.match(/<li>/g) || []).length;
    if (why) { faults++; if (!first) first = `${why}: ${JSON.stringify(doc).slice(0, 90)}`; }
  }
  ok('4,000 documents of prose, lists and blocks in every order come out with no block inside a paragraph, and every tag closed', faults === 0 && lists > 8000, first || `${lists} list items`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
