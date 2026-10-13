'use strict';
/*
 * Reading this repository's own source as text, without reading its comments.
 *
 * Several suites scan the tree for patterns — a suite calling chromium.launch()
 * directly, a waitForFunction passing options where the argument goes, an ok()
 * whose condition cannot come out false, a tool still guessing at a field name.
 * Every one of them has the same problem: the files here explain themselves at
 * length, and those explanations QUOTE the very patterns being hunted. A scan
 * that reads comments finds the paragraph warning about the bug and reports it
 * as the bug.
 *
 * That has now happened three times in one day, in three different files, twice
 * to the person who had just written the paragraph. So it lives here once.
 *
 * ── BLANKED, NOT STRIPPED ────────────────────────────────────────────────
 *
 * Comments are replaced with spaces of the same length, newlines kept. Two
 * things depend on that, and both were got wrong by an earlier local version:
 *
 *   · POSITIONS SURVIVE. A scanner that finds a hit at index N can report the
 *     line it is really on, and an edit computed against the blanked copy can
 *     be applied to the real file. tools that rewrite source need this;
 *     stripping silently shifts everything after the first comment.
 *   · LINES DO NOT MERGE. Replacing a multi-line comment with a single space
 *     joins the code before it to the code after it. Every ^-anchored /m
 *     pattern in these suites then sees a line that does not exist, which can
 *     hide a real call or invent one.
 *
 * ── IT READS STRINGS, BECAUSE TWO REGULAR EXPRESSIONS COULD NOT ──────────
 *
 * This used to be two regular expressions, and the first took any slash-star
 * for the start of a comment, wherever it stood. The browser suites stub the
 * AI provider with page.route('**\/generativelanguage.googleapis.com/**', …),
 * and that string holds one; so do '**\/*.js' and every 'https://…/**'. From
 * there to the next real comment's close was blanked as though it were prose.
 * Measured at c6f12d9 against a real parser's comment ranges: code blanked in
 * 48 files, on 91 lines of verify-gemini.js, 96 of verify-memory.js, 269 of
 * scripts/build-pwa.js, and every guard reading the blanked copy was blind
 * there, passing because it saw nothing. A guard with a hole in it.
 *
 * So it is now a small lexer, modelled on scripts/strip-comments.js: it steps
 * over '…' and "…" strings, template literals (with ${…} nested to any depth)
 * and regular-expression literals, and blanks only what is a comment outside
 * all of them. verify-engine holds it to that on fixtures, and on every
 * JavaScript file in the tree: each one that compiles must still compile once
 * blanked, which the old version failed on 36 of those 48.
 *
 * ── WHAT IT IS STILL NOT ─────────────────────────────────────────────────
 *
 * Not a parser, and the callers do not only hand it JavaScript: the app
 * template app/systole.html is HTML and CSS around its scripts, and some read
 * CSS alone. So where JavaScript would be malformed it reads the character as
 * plain text rather than let it run on:
 *
 *   · a quote with no partner on its line is not a string (an apostrophe in
 *     prose), and a regular expression not closed on its line, or closed only
 *     by the first slash of a comment, is a division (CSS's 50% / 10%, and
 *     the / of a closing tag, would otherwise eat a comment's opening);
 *   · a backtick whose template never closes is not a template;
 *   · a // straight after a : or a \ is not a comment, as before — the // in
 *     a URL written outside quotes in markup or CSS.
 *
 * That has limits, found by trying them on a copy of the template: a stray
 * backtick in prose that a later backtick closes is read as a template, and
 * a slash-star in prose that a later comment closes is read as a comment, and
 * either carries on into the script after it. An apostrophe does not. So
 * verify-engine holds app/systole.html to it: each inline script must blank
 * the same inside the page as it does alone.
 *
 * What it cannot know: whether a / after ) or } begins a regular expression.
 * It reads division there, as strip-comments does. What was measured, at the
 * same commit, against the comment ranges of a real parser (the acorn bundled
 * in Node): it blanked exactly the same characters in every .js file in the
 * tree, every <script> and <style> in its HTML and every .css file. A comment
 * inside a template's ${…} is blanked; one inside the template's text is not
 * a comment and stays. Do not reach for it to parse someone else's JavaScript.
 */

/* After a name, a number, a closing bracket or a literal, a / divides; after
   an operator, an opening bracket or one of these words, it starts a regular
   expression. */
const KEYWORD_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete',
  'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

/* A name is ASCII letters, digits, _ and $, or anything past ASCII. Read as
   char codes: a regular expression per character made this more than twice as
   slow, and some suites blank every file in tests/ several times over. */
const isDigit = ch => ch >= 48 && ch <= 57;
const isNameStart = ch => (ch >= 97 && ch <= 122) || (ch >= 65 && ch <= 90) || ch === 95 || ch === 36 || ch >= 128;
const isNamePart = ch => isNameStart(ch) || isDigit(ch);

/* One reading of `s`. Returns the blanked text, or — when a template never
   closed — the index of the outermost such backtick, so that the caller can
   read it as plain text and try again. */
function blankPass(s, plainBackticks) {
  const n = s.length, parts = [];
  let copied = 0;
  const blank = (from, to) => {
    parts.push(s.slice(copied, from), s.slice(from, to).replace(/[^\n]/g, ' '));
    copied = to;
  };
  let i = 0;
  let last = '';            // the previous token's kind: 'id' | 'num' | 'close' | 'punct' | ''
  let word = '';            // and its text, when it was a name
  const braces = [];        // for each open {: true when it was a template's ${
  const open = [];          // the backtick of each template still open, outermost first
  const regexAllowed = () => last === '' || last === 'punct' || (last === 'id' && KEYWORD_BEFORE_REGEX.has(word));

  /* Template text from s[i] up to its closing backtick (true) or its next ${
     (false); null if the input ends first. */
  const templateText = () => {
    while (i < n) {
      const c = s[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { i++; open.pop(); last = 'close'; return true; }
      if (c === '$' && s[i + 1] === '{') { i += 2; braces.push(true); last = 'punct'; return false; }
      i++;
    }
    return null;
  };

  while (i < n) {
    const c = s[i], d = s[i + 1];
    if (c === '/' && d === '/') {
      if (i > 0 && (s[i - 1] === ':' || s[i - 1] === '\\')) { i += 2; last = 'punct'; continue; }
      let j = i + 2;
      while (j < n && s[j] !== '\n') j++;
      blank(i, j); i = j; continue;
    }
    if (c === '/' && d === '*') {
      const j = s.indexOf('*/', i + 2);
      if (j >= 0) { blank(i, j + 2); i = j + 2; continue; }
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && s[j] !== c && s[j] !== '\n') {
        j += s[j] !== '\\' ? 1 : (s[j + 1] === '\r' && s[j + 2] === '\n' ? 3 : 2);
      }
      if (j < n && s[j] === c) { i = j + 1; last = 'close'; continue; }
      i++; last = 'punct'; continue;              // no partner on its line: not a string
    }
    if (c === '`' && !plainBackticks.has(i)) {
      open.push(i); i++;
      if (templateText() === null) return open[0];
      continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1, inClass = false;
      while (j < n && s[j] !== '\n') {
        const r = s[j];
        if (r === '\\') { if (s[j + 1] === '\n') break; j += 2; continue; }
        if (inClass) { if (r === ']') inClass = false; }
        else if (r === '[') inClass = true;
        else if (r === '/') break;
        j++;
      }
      /* Closed on its line, and not by the first slash of a comment: CSS's
         `50% / 10%; /* … *\/`, and markup's `</p> /* … *\/`, would otherwise
         read as a regular expression that eats the comment's opening. */
      if (j < n && s[j] === '/' && s[j + 1] !== '*' && s[j + 1] !== '/') {
        j++;
        while (j < n && isNamePart(s.charCodeAt(j))) j++;      // its flags
        i = j; last = 'close'; continue;
      }
      i++; last = 'punct'; continue;              // not closed on its line: a division
    }
    if (c === '{') { braces.push(false); i++; last = 'punct'; continue; }
    if (c === '}') {
      i++;
      if (braces.pop() === true) { if (templateText() === null) return open[0]; }
      else last = 'close';
      continue;
    }
    if (isNameStart(s.charCodeAt(i))) {
      let j = i + 1;
      while (j < n && isNamePart(s.charCodeAt(j))) j++;
      word = s.slice(i, j); last = 'id'; i = j; continue;
    }
    if (isDigit(s.charCodeAt(i)) || (c === '.' && isDigit(s.charCodeAt(i + 1)))) {
      let j = i + 1;
      while (j < n && (isNamePart(s.charCodeAt(j)) || s[j] === '.')) j++;
      i = j; last = 'num'; continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    /* a++ / 2 — a postfix ++ or -- ends an operand, so a / after it divides */
    if ((c === '+' || c === '-') && d === c && (last === 'id' || last === 'num' || last === 'close')) {
      i += 2; last = 'close'; continue;
    }
    i++;
    last = (c === ')' || c === ']') ? 'close' : 'punct';
  }
  if (open.length) return open[0];
  parts.push(s.slice(copied));
  return parts.join('');
}

const blankComments = src => {
  const s = String(src), plainBackticks = new Set();
  for (;;) {
    const r = blankPass(s, plainBackticks);
    if (typeof r === 'string') return r;
    plainBackticks.add(r);
  }
};

module.exports = { blankComments };
