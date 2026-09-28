'use strict';
/*
 * Comments out of the code the split build ships — and only there.
 *
 * WHY. verify-pwa's shell budget (280 KB gzipped, index.html + app.js) was set
 * on the reasoning that comments are "close to free once compressed". Measured
 * on src/ at 7947642 they are not: 76 KB of the 149 KB the modules gzip to is
 * comment. That is how the shell reached 287 KB with no single change to blame
 * — echo, notesearch, the Wiggers diagram and the conduction views each paid
 * their way honestly, and their documentation rode along into every download.
 *
 * The comments stay where they are read: in src/, and in the single-file
 * build, which is also the file every browser suite tests. build-pwa hands
 * each src/ module it finds verbatim in app.js through strip() below, so the
 * device downloads the code without the prose about it.
 *
 * WHY A LEXER, NOT tests/_source.js. blankComments() says of itself that it is
 * not a lexer: a // inside a string is blanked as though it opened a comment.
 * Right for scanning, wrong for shipping — here a mistake is a broken app, not
 * a missed pattern. So this reads strings, template literals (with nested
 * ${...}), regular-expression literals and division properly. What it cannot
 * know is whether a / after `)` or `}` begins a regex; it treats it as
 * division, which is what every one of those sites in src/ is. Anything it
 * misreads either fails to compile, which build-pwa checks before it ships a
 * module, or survives verify-stripcomments-pure's round trips.
 *
 * WHAT A COMMENT BECOMES. A block comment that spans a line break becomes one
 * line break, so automatic semicolon insertion sees what it saw before; any
 * other comment becomes one space, so `a/**\/b` cannot become `ab`. A line
 * left with nothing but whitespace by the removal is dropped whole. Nothing
 * inside a string, template or regex is ever touched.
 */

const KEYWORD_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete',
  'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

function strip(src) {
  const s = String(src), n = s.length;
  let out = '', i = 0;
  let last = '';            // the last significant token's kind: 'id' | 'num' | 'close' | 'punct' | ''
  let lastWord = '';
  const braces = [];        // for each open { : true if it opened a template's ${
  let lineHadComment = false, lineStart = 0;   // lineStart indexes into out

  const endLine = () => {
    if (lineHadComment && /^[ \t]*\r?$/.test(out.slice(lineStart))) out = out.slice(0, lineStart);
    else out += '\n';
    lineStart = out.length; lineHadComment = false;
  };
  const regexAllowed = () => last === '' || last === 'punct' || (last === 'id' && KEYWORD_BEFORE_REGEX.has(lastWord));

  // Copy a template literal's text from s[i] (just past a ` or a closing } of ${) to its end or its next ${.
  const templateText = () => {
    while (i < n) {
      const c = s[i];
      if (c === '\\') { out += s.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { out += c; i++; last = 'close'; return; }
      if (c === '$' && s[i + 1] === '{') { out += '${'; i += 2; braces.push(true); last = 'punct'; return; }
      out += c; i++;
    }
    throw new Error('strip-comments: unterminated template literal');
  };

  while (i < n) {
    const c = s[i], d = s[i + 1];
    if (c === '\n') { endLine(); i++; continue; }
    if (c === '/' && d === '/') {
      let j = i + 2; while (j < n && s[j] !== '\n' && s[j] !== '\r') j++;
      out = out.replace(/[ \t]+$/, ''); lineHadComment = true; i = j; continue;
    }
    if (c === '/' && d === '*') {
      const j = s.indexOf('*/', i + 2);
      if (j < 0) throw new Error('strip-comments: unterminated block comment');
      const body = s.slice(i, j + 2);
      lineHadComment = true;
      if (body.includes('\n')) { out = out.replace(/[ \t]+$/, ''); if (/\r\n/.test(body)) out += '\r'; endLine(); }
      else if (out.length > lineStart && !/[ \t]$/.test(out)) out += ' ';
      i = j + 2; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && s[j] !== c) { if (s[j] === '\\') j++; if (s[j] === '\n') throw new Error('strip-comments: newline in a string literal'); j++; }
      out += s.slice(i, j + 1); i = j + 1; last = 'close'; continue;
    }
    if (c === '`') { out += c; i++; templateText(); continue; }
    if (c === '/' && regexAllowed()) {
      let j = i + 1, inClass = false;
      while (j < n) {
        const r = s[j];
        if (r === '\\') { j += 2; continue; }
        if (r === '\n') throw new Error('strip-comments: newline in a regular expression');
        if (inClass) { if (r === ']') inClass = false; }
        else if (r === '[') inClass = true;
        else if (r === '/') break;
        j++;
      }
      j++; while (j < n && /[a-z]/i.test(s[j])) j++;
      out += s.slice(i, j); i = j; last = 'close'; continue;
    }
    if (c === '{') { braces.push(false); out += c; i++; last = 'punct'; continue; }
    if (c === '}') {
      const tpl = braces.pop();
      out += c; i++;
      if (tpl) templateText(); else last = 'close';
      continue;
    }
    if (/[A-Za-z_$\u0080-￿]/.test(c)) {
      let j = i + 1; while (j < n && /[\w$\u0080-￿]/.test(s[j])) j++;
      lastWord = s.slice(i, j); last = 'id'; out += lastWord; i = j; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(d))) {
      let j = i + 1; while (j < n && /[\w.]/.test(s[j])) j++;
      out += s.slice(i, j); i = j; last = 'num'; continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') { out += c; i++; continue; }
    /* a++ / 2 — a postfix ++ or -- ends an operand, so a / after it divides */
    if ((c === '+' || c === '-') && d === c && (last === 'id' || last === 'num' || last === 'close')) {
      out += c + d; i += 2; last = 'close'; continue;
    }
    out += c; i++;
    last = (c === ')' || c === ']') ? 'close' : 'punct';
  }
  if (lineHadComment && /^[ \t]*\r?$/.test(out.slice(lineStart))) out = out.slice(0, lineStart);
  return out;
}

/* Each module that appears verbatim exactly once in `code` is replaced by its
   stripped text, which must still compile as a script — a module this lexer
   misread stops the build rather than reaching a device. A module found zero
   times (a later chain step edited it) or twice is left alone and named. */
function stripEmbedded(code, modules) {
  const vm = require('vm');
  const stripped = [], skipped = [];
  for (const [name, text] of modules) {
    const at = code.indexOf(text);
    if (!text || at < 0 || code.indexOf(text, at + 1) >= 0) { skipped.push(name); continue; }
    const lean = strip(text);
    try { new vm.Script(lean, { filename: name }); }
    catch (e) { throw new Error(`strip-comments: ${name} no longer compiles once stripped: ${e.message}`); }
    code = code.slice(0, at) + lean + code.slice(at + text.length);
    stripped.push(name);
  }
  return { code, stripped, skipped };
}

module.exports = { strip, stripEmbedded };
