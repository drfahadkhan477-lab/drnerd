'use strict';
/* Omit whitespace-delimited CSS documentation from the split build. Leave inline comments alone: removing one
   can join tokens or change a selector. Strings, escapes and url() tokens are copied verbatim. Optional compaction collapses whitespace tokens, never quoted content or URLs. */
function stripCssDocs(value, compact = false) {
  const s = String(value), n = s.length;
  const space = c => /[\t\n\r\f ]/.test(c || '');
  let out = '', i = 0;
  function quoted() {
    const start = i, quote = s[i++];
    while (i < n) {
      if (s[i] === '\\') { i += Math.min(2, n - i); continue; }
      if (s[i++] === quote) return s.slice(start, i);
    }
    throw new Error('Unterminated CSS string');
  }
  while (i < n) {
    if (s[i] === '"' || s[i] === "'") { out += quoted(); continue; }
    if (s[i] === '\\') {
      const escape = s.slice(i).match(/^\\(?:[0-9a-fA-F]{1,6}(?:\r\n|[\t\n\r\f ])?|[\s\S])/);
      const token = escape ? escape[0] : s[i];
      out += token; i += token.length; continue;
    }
    if ((i === 0 || !/[\w-]/.test(s[i - 1])) && /^url\(/i.test(s.slice(i, i + 4))) {
      const start = i; i += 4;
      while (i < n && s[i] !== ')') {
        if (s[i] === '"' || s[i] === "'") quoted();
        else if (s[i] === '\\') i += Math.min(2, n - i);
        else i++;
      }
      if (i === n) throw new Error('Unterminated CSS URL');
      out += s.slice(start, ++i); continue;
    }
    if (s[i] === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      if (end < 0) throw new Error('Unterminated CSS comment');
      if (!((i === 0 || space(s[i - 1])) && (end + 2 === n || space(s[end + 2])))) out += s.slice(i, end + 2);
      i = end + 2; continue;
    }
    if (compact && space(s[i])) {
      while (i < n && space(s[i])) i++;
      out += ' '; continue;
    }
    out += s[i++];
  }
  return out;
}
module.exports = { stripCssDocs };
