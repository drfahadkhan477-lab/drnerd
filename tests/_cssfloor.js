'use strict';
/*
 * The stylesheets this app ships, read for what the oldest Safari it supports would do with each line.
 *
 * tests/verify-floor-css-pure.js holds them to tests/css-floor-table.json, scripts/css-floor-table.js writes that table from
 * MDN's browser-compat-data, and tests/verify-floor.js makes the engine in front of it forget what an older Safari does not know.
 * The three read a stylesheet the same way, so it is one reader and it is here.
 *
 * WHAT AN OLD SAFARI DOES WITH A LINE IT DOES NOT KNOW, which is the whole reason this exists. It does not stop, and it does not say so:
 *
 *   · an unknown property, function or keyword drops that declaration, and nothing else;
 *   · an unknown pseudo-class anywhere in a selector list drops the WHOLE rule, the selectors it did know included;
 *   · an unknown media feature makes that query false, so everything inside it is skipped;
 *   · a declaration with a var() in it is taken at face value when the sheet is read, and is judged when the page is drawn: one whose
 *     substituted value is not valid comes to nothing then (the property is set back to unset), AFTER every fallback written before
 *     it has been passed over. So "background: #eee; background: color-mix(in srgb, var(--x) 12%, white)" is a plain background
 *     in a browser that does not know color-mix only if the second line has no var() in it, and this app's all have. The fallback
 *     has to come after, under @supports not, which is judged when the sheet is read.
 *
 * A TREE, NOT A LIST. The checks need a rule's neighbours (the @supports block that has to follow it) and its parents (the @media it
 * sits in), so parseCss returns blocks with their declarations and their children, in source order. It is a reader for the CSS in
 * this repository and nothing wider: comments and strings are blanked first, parentheses are followed so that a ; or a { inside
 * url() or a function does not end anything, and a stylesheet it cannot balance says so.
 */
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');

const ROOT = path.join(__dirname, '..');

/* The three stylesheet families the pages ship: the app (every file in app/css, in the order they are listed here, which is only the
   order of a directory listing: the cascade between files is the assembler's), the Memorizer's and the Lab page's. */
function families() {
  const dir = path.join(ROOT, 'app', 'css');
  return [
    { name: 'the Systole app', files: fs.readdirSync(dir).filter(f => f.endsWith('.css')).sort().map(f => 'app/css/' + f) },
    { name: 'the Memorizer', files: ['memorizer/app.css'] },
    { name: 'the Lab page', files: ['lab/app.css'] },
  ];
}
const readFile = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* Comments through the shared blanker, strings here, because a brace in one (content: "}") is not a brace and a ; in a data URL is not
   the end of a declaration. Positions and lines are kept. */
const blankCss = css => blankComments(css).replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, m => m.replace(/[^\n]/g, ' '));

const squash = s => s.replace(/\s+/g, ' ').trim();

/* A stylesheet as blocks: { t: 'root'|'rule'|'at', prelude, line, parent, children, decls }, in source order; a decl is
   { prop, value, line, important }. A statement at the top level that is not a block (@import, @charset) is a child with t 'atstmt'.
   Also whether the braces balanced, which is the first thing a reader that has lost its place says. */
function parseCss(css) {
  const text = blankCss(css);
  const nl = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') nl.push(i + 1);
  const lineAt = idx => { let lo = 0, hi = nl.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (nl[mid] <= idx) lo = mid; else hi = mid - 1; } return lo + 1; };
  const root = { t: 'root', prelude: '', line: 0, parent: null, children: [], decls: [] };
  let cur = root, start = 0, paren = 0, balanced = true;
  const flush = end => {
    const raw = text.slice(start, end);
    const m = /^\s*(--[\w-]+|-?[a-zA-Z][\w-]*)\s*:([\s\S]*)$/.exec(raw);
    const at = start + raw.search(/\S|$/);
    if (cur !== root && m) {
      let value = squash(m[2]), important = false;
      if (/\s*!\s*important$/i.test(value)) { important = true; value = value.replace(/\s*!\s*important$/i, ''); }
      cur.decls.push({ prop: m[1].startsWith('--') ? m[1] : m[1].toLowerCase(), value, line: lineAt(at), important });
    } else if (cur === root && /^\s*@/.test(raw)) {
      root.children.push({ t: 'atstmt', prelude: squash(raw), line: lineAt(at), parent: root, children: [], decls: [] });
    }
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') paren++;
    else if (c === ')') { if (paren) paren--; }
    else if (paren) continue;
    else if (c === '{') {
      const raw = text.slice(start, i), prelude = squash(raw);
      const node = { t: prelude.startsWith('@') ? 'at' : 'rule', prelude, line: lineAt(start + raw.search(/\S|$/)), parent: cur, children: [], decls: [] };
      cur.children.push(node); cur = node; start = i + 1;
    } else if (c === '}') {
      flush(i);
      if (cur === root) balanced = false; else cur = cur.parent;
      start = i + 1;
    } else if (c === ';') { flush(i); start = i + 1; }
  }
  flush(text.length);
  return { root, balanced: balanced && cur === root && paren === 0 };
}

/* every block under a node, depth first, in source order */
function* blocks(node) {
  for (const c of node.children) { yield c; yield* blocks(c); }
}

/* a selector list split where CSS splits it: at a comma that is not inside parentheses or brackets */
function splitList(prelude) {
  const out = []; let depth = 0, cur = '';
  for (const c of prelude) {
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) { out.push(squash(cur)); cur = ''; } else cur += c;
  }
  out.push(squash(cur));
  return out.filter(Boolean);
}

/* the blocks enclosing a node, outermost first */
function ancestors(node) {
  const out = [];
  for (let p = node.parent; p && p.t !== 'root'; p = p.parent) out.unshift(p);
  return out;
}

/* ── what a stylesheet uses ────────────────────────────────────────────────────────────────────────────────────────────────────
   One entry per use: { key: 'property inset', kind, name, line, node, decl? }. The kinds are the ones MDN's data is organised by:

     property   every declared property, as written (-webkit-mask-image is its own entry, and every custom property is "--*")
     function   every function in a value (var, calc, min, rgba, color-mix, ...)
     unit       the unit of every number in a value (px, %, vh, dvh, fr, s, ...)
     selector   every pseudo-class and pseudo-element in a style rule's selector, with its colons (:hover, ::before, :has)
     atrule     every at-rule by name
     media      every feature a media query asks about (min-/max- taken off), and range-syntax for width >= 600px, and not-or for the
                level 4 logic
     supports   selector() in an @supports condition, the one thing it tests that a Safari before 14.1 cannot read
     color      #rrggbbaa, and the space-separated rgb(0 0 0 / .5)
     value      a keyword an above-floor row of the table's watch list names, for the property it is the value of
     layout     flex-gap, for every gap: a Safari before 14.5 reads it on a grid and not on a flex box, and whether a rule's box is a flex box
                is the cascade's to say, not the text's, so every gap is taken for one that may be

   The tested condition of an @supports is not a use: the probe is the point of the block. */
function usesOf(root, watch) {
  const out = [];
  const add = (kind, name, node, extra) => out.push(Object.assign({ key: kind + ' ' + name, kind, name, line: node.line, node }, extra));
  const MEDIA_FEATURE = /\(\s*([a-z-]+)\s*(?=[:)<>=])/gi;
  for (const node of blocks(root)) {
    if (node.t === 'rule') {
      for (const sel of splitList(node.prelude)) {
        for (const m of sel.matchAll(/(::?)(-?[a-zA-Z][\w-]*)/g)) {
          if (/^\d/.test(m[2])) continue;
          add('selector', m[1] + m[2].toLowerCase(), node);
        }
        if (/\[[^\]]*\s[iIsS]\s*\]/.test(sel)) add('selector', '[attr i]', node);
        if (/(^|[\s>+~(,])&/.test(sel)) add('selector', '&', node);
      }
    } else if (node.t === 'at' || node.t === 'atstmt') {
      const name = (/^@([\w-]+)/.exec(node.prelude) || [])[1];
      add('atrule', '@' + name, node);
      if (name === 'media') {
        const q = node.prelude.slice(6);
        for (const m of q.matchAll(MEDIA_FEATURE)) add('media', m[1].toLowerCase().replace(/^(min|max)-/, ''), node);
        if (/[<>]=?/.test(q.replace(/\([^()]*:[^()]*\)/g, ''))) add('media', 'range-syntax', node);
        if (/(^|\s)(not|or)(\s|\()/i.test(q.replace(/\([^()]*\)/g, ' ()'))) add('media', 'not-or', node);
      }
      if (name === 'supports' && /\bselector\s*\(/i.test(node.prelude)) add('supports', 'selector()', node);
    }
    for (const d of node.decls) {
      const desc = node.t === 'at' && /^@(font-face|page|property|counter-style)\b/i.exec(node.prelude);     // descriptors, not properties: a row of their own, by the at-rule
      if (desc) add('descriptor', desc[0].toLowerCase() + ' ' + d.prop.toLowerCase(), node, { decl: d, line: d.line });
      else add('property', d.prop.startsWith('--') ? '--*' : d.prop, node, { decl: d, line: d.line });
      if (d.prop === 'gap' || d.prop === 'row-gap' || d.prop === 'column-gap') add('layout', 'flex-gap', node, { decl: d, line: d.line });
      const v = d.value;
      for (const m of v.matchAll(/(-?[a-zA-Z_][\w-]*)\(/g)) add('function', m[1].toLowerCase(), node, { decl: d, line: d.line });
      for (const m of v.matchAll(/(?<![\w#.-])(-?\d*\.?\d+)(%|[a-zA-Z]+)(?![\w-])/g)) {
        const u = m[2].toLowerCase();
        if (u === 'e') continue;
        add('unit', u, node, { decl: d, line: d.line });
      }
      if (/#[0-9a-fA-F]{8}(?![\w-])|#[0-9a-fA-F]{4}(?![\w-])/.test(v)) add('color', 'hex-alpha', node, { decl: d, line: d.line });
      if (/\b(?:rgb|rgba|hsl|hsla)\(\s*[^,()]+\s+[^,()]+\s+[^,()]+\s*(?:\/|\))/i.test(v) && !/\b(?:rgb|rgba|hsl|hsla)\([^)]*,/i.test(v)) add('color', 'space-separated', node, { decl: d, line: d.line });
      const w = watch && watch[d.prop];
      if (w) for (const m of v.toLowerCase().matchAll(/(?<![\w-])([a-z][a-z-]*)(?![\w(-])/g)) if (w[m[1]] !== undefined) add('value', d.prop + ': ' + m[1], node, { decl: d, line: d.line });
    }
  }
  return out;
}

/* ── versions ─────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const parts = v => String(v).replace(/^≤/, '').split('.').map(Number);
function versionCmp(a, b) {
  const A = parts(a), B = parts(b);
  for (let i = 0; i < 3; i++) { const x = A[i] || 0, y = B[i] || 0; if (x !== y) return x - y; }
  return 0;
}

/* What iOS Safari does with a feature at a given version, from the statements MDN's browser-compat-data makes about it (a node of the data, with a __compat):
   'yes', 'partial' (read, but not all of it), 'prefix' (read behind -webkit- and not without), 'no', or 'nodata'; and the first version that reads it unprefixed,
   in whole or in part. An entry with a flag, or under another name, is not a feature a page can use; one that was removed before the floor is not there; and a
   partial implementation that a later entry replaced is the one that is at the floor. */
function supportAt(node, floor) {
  const s = node && node.__compat && node.__compat.support && node.__compat.support.safari_ios;
  if (!s) return { state: 'nodata', since: null, prefixedSince: null };
  let since = null, prefixedSince = null, state = 'no';
  for (const e of Array.isArray(s) ? s : [s]) {
    if (e.flags || e.alternative_name) continue;
    const v = e.version_added;
    const starts = v === true || (typeof v === 'string' && versionCmp(v, floor) <= 0);
    const removed = e.version_removed && e.version_removed !== true ? e.version_removed : null;
    const there = starts && (!removed || versionCmp(removed, floor) > 0);
    if (e.prefix) {
      if (there && state === 'no') state = 'prefix';
      if (typeof v === 'string' && (!prefixedSince || versionCmp(v, prefixedSince) < 0)) prefixedSince = v;
      continue;
    }
    if (typeof v === 'string' && (since === null || versionCmp(v, since) < 0)) since = v;
    if (there) state = e.partial_implementation ? (state === 'yes' ? 'yes' : 'partial') : 'yes';
  }
  return { state, since, prefixedSince };
}

/* ── the table ─────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const TABLE_PATH = path.join(__dirname, 'css-floor-table.json');
const loadTable = () => JSON.parse(fs.readFileSync(TABLE_PATH, 'utf8'));

/* How the table sorts a use: { how: 'ok'|'prefixed'|'above'|'unlisted', row? }. A kind's ok names are bare; an above-floor row carries
   the first Safari that reads it, what the stylesheets do about it, and why that is enough. */
function classify(table, use) {
  const row = table.above[use.key];
  if (row) return { how: 'above', row };
  const pre = table.prefixed[use.key];
  if (pre) return { how: 'prefixed', row: pre };
  if ((table.ok[use.kind] || []).includes(use.name)) return { how: 'ok' };
  return { how: 'unlisted' };
}

/* ── what an older Safari makes of a stylesheet, as a text rewrite ──────────────────────────────────────────────────────────────
   The NAME of a feature is changed to one nothing knows, in the style text of a page, so that the engine in front of it does what the older one does
   (see the top of this file): the declaration is dropped, the rule with the pseudo-class is dropped whole, the var() with the unknown function comes
   to nothing when it is used. Comments and strings are not touched. Each entry is a pattern over the BLANKED text whose first group is the name, and
   the property or function name inside an @supports condition is changed as well, so that the condition is judged as the older engine judges it. A pattern
   looks FORWARD from the property to its keyword and never behind: blanking leaves long runs of spaces, and a lookbehind over \s* is tried at every
   one of them (28 s for each of two patterns over the app's stylesheet, where forward is 2 ms). */
const SIM = {
  'inset': /(?<=[{;\s(])(inset)(?=\s*:)/g,
  'aspect-ratio': /(?<=[{;\s(])(aspect-ratio)(?=\s*:)/g,
  'translate': /(?<=[{;\s(])(translate)(?=\s*:)/g,
  'contain': /(?<=[{;\s(])(contain)(?=\s*:)/g,
  'padding-block': /(?<=[{;\s(])(padding-block)(?=\s*:)/g,
  'scroll-behavior': /(?<=[{;\s(])(scroll-behavior)(?=\s*:)/g,
  'overscroll-behavior': /(?<=[{;\s(])(overscroll-behavior)(?=\s*:)/g,
  'text-wrap': /(?<=[{;\s(])(text-wrap)(?=\s*:)/g,
  'scrollbar-width': /(?<=[{;\s(])(scrollbar-width)(?=\s*:)/g,
  'color-mix': /(?<![\w-])(color-mix)(?=\()/g,
  'sin': /(?<![\w-])(sin)(?=\()/g,
  'focus-visible': /(?<=:)(focus-visible)(?![\w-])/g,
  'has': /(?<=:)(has)(?=\()/g,
  'where': /(?<=:)(where)(?=\()/g,
  'overflow-wrap-anywhere': /(?:overflow-wrap\s*:\s*)(anywhere)(?![\w-])/g,
  'align-content-start': /(?:align-content\s*:\s*)(start)(?![\w-])/g,
  'media-reduced-transparency': /(?<=\()(prefers-reduced-transparency)(?=\s*:)/g,
};

/* The <style> text of a page with the named features made unknown, and how many of each. */
function unknownFeatures(html, names) {
  for (const n of names) if (!SIM[n]) throw new Error('no such feature: ' + n);
  const counts = {};
  const out = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (all, open, css, close) => {
    const blanked = blankCss(css);                       // the same length, so a position found in it is a position in css
    const edits = [];
    for (const n of names) {
      const re = new RegExp(SIM[n].source, 'g');
      let m;
      while ((m = re.exec(blanked))) {
        edits.push(m.index + m[0].indexOf(m[1]));
        counts[n] = (counts[n] || 0) + 1;
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
    edits.sort((a, b) => b - a);
    let t = css;
    for (const at of edits) t = t.slice(0, at) + 'x-' + t.slice(at);
    return open + t + close;
  });
  return { html: out, counts };
}

/* The page with every @supports not (probe) block turned into @media all (and how many of each probe): the older spelling applied on an engine that reads the feature too, so
   that what an older engine draws can be compared with it, declaration for declaration. */
function forceFallbacks(html, probes) {
  let n = 0;
  const counts = Object.fromEntries(probes.map(p => [p, 0]));
  const out = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (all, open, css, close) => {
    let t = css;
    for (const p of probes) {
      const needle = '@supports not (' + p + ')';
      for (let at = t.indexOf(needle); at >= 0; at = t.indexOf(needle, at)) { t = t.slice(0, at) + '@media all' + t.slice(at + needle.length); n++; counts[p]++; }
    }
    return open + t + close;
  });
  return { html: out, count: n, counts };
}

/* ── the CSS that scripts and pages write inline ──────────────────────────────────────────────────────────────────────────────────────────────
   The stylesheets are not the only place a page says how it looks: a style="" attribute, a cssText string, el.style.x = ..., setProperty('x'), a <style> block of a
   page and a style element that a script fills are read by the same Safari, and a style attribute cannot carry an @supports rule. So that a feature that is only
   ever written there is classified like the rest, each is turned into STYLESHEET TEXT and read by parseCss and usesOf, the same reader the stylesheets go through:
   a list of declarations becomes x{...} and a block is itself. The text is padded with lines so that a line in it is a line in the file. */

/* The scripts and pages the app ships, as paths under the repository: every script of the three source directories, the shell, the page builder and the two
   other pages. */
function scriptFiles() {
  const out = [];
  const walk = (rel) => {
    const dir = path.join(ROOT, rel);
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!/node_modules|fixtures/.test(e.name)) walk(rel + '/' + e.name); }
      else if (/\.js$/.test(e.name)) out.push(rel + '/' + e.name);
    }
  };
  walk('src'); walk('memorizer/src'); walk('lab/src');
  for (const f of ['app/systole.html', 'scripts/build-pwa.js', 'memorizer/index.html', 'lab/index.html']) if (fs.existsSync(path.join(ROOT, f))) out.push(f);
  return out;
}

const STR = `"((?:[^"\\\\\\n]|\\\\.)*)"|'((?:[^'\\\\\\n]|\\\\.)*)'|\`([^\`]*)\``;
const TEMPLATE = /\$\{(?:[^{}]|\{[^{}]*\})*\}/g;
/* A ${...} is a number; one followed by two hex digits is a colour with an alpha (${col}1F), which no unit looks like. */
const maskTemplate = v => { let o = v; for (let k = 0; k < 3; k++) o = o.replace(new RegExp(TEMPLATE.source + '([0-9a-fA-F]{2})(?![\\w%-])', 'g'), '#000').replace(TEMPLATE, '0'); return o; };

/* The stylesheet text of a list of declarations (a style attribute, a cssText string): x{prop:value;...}. A ${...} of a template is a number. A value that script puts
   together from pieces ('width:' + Math.round(w) + 'px') has its pieces between quotes, which the reader blanks, so Math.round( is not round(). A name must look like a property. */
function declsToCss(list) {
  const out = [];
  for (const d of maskTemplate(list).split(';')) {
    const m = /^\s*(-{0,2}[a-zA-Z][\w-]*)\s*:([\s\S]*)$/.exec(d);
    if (!m) continue;
    out.push(m[1] + ':' + m[2]);
  }
  return out.length ? 'x{' + out.join(';') + '}' : '';
}

/* The text of an expression of string literals, from `at`: what a script assigns to a style or sets as a value, and where it ends. Literals joined with + are one text
   ('rgba(' + r + ',' + g + ')' is rgba(0,0)), anything that is not a literal is a 0, and any other operator ( ? : || ) separates, so that cond ? 'none' : 'block' is not one
   word. It ends at the , or the ; or the bracket that ends the expression, or at a line end that it does not go on past (an operator ends the line or starts the next). */
function literalsFrom(t, at) {
  let out = '', k = at, depth = 0;
  const prev = idx => { while (idx >= at && /\s/.test(t[idx])) idx--; return t[idx] || ''; };
  const next = idx => { while (idx < t.length && /\s/.test(t[idx])) idx++; return t[idx] || ''; };
  for (; k < t.length; k++) {
    const c = t[k];
    if (c === '"' || c === "'" || c === '`') {
      let e = k + 1;
      for (; e < t.length && t[e] !== c; e++) if (t[e] === '\\') e++;
      out += t.slice(k + 1, e).replace(/\\(.)/g, '$1'); k = e; continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
    else if ((c === ';' || c === ',') && depth === 0) break;
    else if (c === '\n') { if (depth === 0 && !/[+?:|&=(]/.test(prev(k - 1)) && !/[+?:|&.)]/.test(next(k + 1))) break; }
    else if (/[\w$]/.test(c)) {
      let e = k; while (e < t.length && /[\w$.]/.test(t[e])) e++;
      if (t[e] === '(') { let d = 0; for (; e < t.length; e++) { if (t[e] === '(') d++; else if (t[e] === ')' && --d === 0) break; } k = e; }   // a call: to its ), which the loop steps past
      else k = e - 1;                                                                                                                      // a name: the loop steps to what follows it
      out += '0';
    }
    else if (c !== '+' && !/\s/.test(c)) out += ' ';
  }
  return { text: out, end: k };
}
const literals = (t, at) => literalsFrom(t, at).text;

/* The stylesheet text of everything inline in a script or page: [{ css, line }]. */
function inlineSegments(text) {
  const t = blankComments(text);
  const nl = [0];
  for (let i = 0; i < t.length; i++) if (t[i] === '\n') nl.push(i + 1);
  const lineAt = idx => { let lo = 0, hi = nl.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (nl[mid] <= idx) lo = mid; else hi = mid - 1; } return lo + 1; };
  const out = [];
  const push = (css, idx) => { if (css) { const line = lineAt(idx); out.push({ css: '\n'.repeat(line - 1) + css, line }); } };
  const lists = (re, kept) => { for (const m of t.matchAll(re)) { const v = m[kept] ?? m[kept + 1] ?? m[kept + 2]; if (v != null) push(declsToCss(v), m.index); } };
  lists(/\bstyle\s*=\s*\\?"([^"\\]*)\\?"()()|\bstyle\s*=\s*\\?'([^'\\]*)\\?'()()/g, 1);
  // a list of declarations as an expression of literals: el.style.cssText = 'a:b;' + 'c:d', { style: 'a:b' }, setAttribute('style', 'a:b' + x)
  for (const re of [/\bcssText\s*\+?=\s*/g, /(?<![\w$.])style\s*:\s*/g, /setAttribute\(\s*['"]style['"]\s*,\s*/g]) for (const m of t.matchAll(re)) push(declsToCss(literals(t, m.index + m[0].length)), m.index);
  const kebab = n => n === 'cssFloat' ? 'float' : n.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
  const decl = (name, at, idx) => push('x{' + kebab(name) + ':' + (maskTemplate(literals(t, at)) || '0') + '}', idx);
  for (const m of t.matchAll(/\.style\.([a-zA-Z]+)\s*(?:=(?!=)|\+=)/g)) {
    if (/^(cssText|setProperty|removeProperty|getPropertyValue|length)$/.test(m[1])) continue;
    decl(m[1], m.index + m[0].length, m.index);
  }
  for (const m of t.matchAll(/\.style\[\s*(['"])(-{0,2}[a-zA-Z][\w-]*)\1\s*\]\s*(?:=(?!=)|\+=)/g)) decl(m[2], m.index + m[0].length, m.index);
  for (const m of t.matchAll(/\.style\.setProperty\(\s*(['"])(-{0,2}[a-zA-Z][\w-]*)\1\s*,?/g)) decl(m[2], m.index + m[0].length, m.index);
  // Object.assign(el.style, { background: '...', borderRadius: x + 'px' })
  for (const m of t.matchAll(/Object\.assign\(\s*[\w$.]+\.style\s*,\s*\{/g)) {
    for (let k = m.index + m[0].length; k < t.length;) {
      const e = /^[\s,]*(['"]?)(-{0,2}[a-zA-Z][\w-]*)\1\s*:/.exec(t.slice(k, k + 200));
      if (!e) break;
      const v = literalsFrom(t, k + e[0].length);
      push('x{' + kebab(e[2]) + ':' + (maskTemplate(v.text) || '0') + '}', k);
      k = v.end + 1;
    }
  }
  // sheet.insertRule('.a{...}', 0)
  for (const m of t.matchAll(/\.insertRule\(\s*/g)) push(maskTemplate(literals(t, m.index + m[0].length)), m.index);
  for (const m of t.matchAll(/\.style\.(?:removeProperty|getPropertyValue)\(\s*(['"])(-{0,2}[a-zA-Z][\w-]*)\1/g)) push('x{' + m[2] + ':0}', m.index);
  // a <style> block of a page, with the assembler's slots (where the stylesheets go) taken out
  for (const m of t.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) push(m[1].replace(/@@SLOT\[[^\]]*\]@@/g, ' '), m.index + m[0].indexOf('>') + 1);
  // a style element a script makes and fills with literals: var st = document.createElement('style'); st.textContent = '...' + '...';
  for (const mk of t.matchAll(/(\w+)\s*=\s*[\w.]*createElement\(\s*['"]style['"]\s*\)/g)) {
    const re = new RegExp('(?<![\\w$.])' + mk[1] + '\\.(?:textContent|innerHTML)\\s*\\+?=\\s*', 'g');
    re.lastIndex = mk.index;
    for (let m; (m = re.exec(t)) && m.index - mk.index < 4000;) push(maskTemplate(literals(t, m.index + m[0].length)), m.index);
  }
  return out;
}

/* Stylesheets that a script builds from data and does not write out in text: the Memorizer's look sheet, which memorizer/src/appearance.js css() returns. They are read
   as the script makes them, so that what they hold is classified like the rest. */
function generatedSheets() {
  const look = require(path.join(ROOT, 'memorizer', 'src', 'appearance.js'));
  return [{ file: 'memorizer/src/appearance.js', css: look.css(look.DEFAULT) }];
}

/* The uses of the same shape the stylesheet reader gives, for everything inline: property, function, unit, color, value, selector, at-rule. */
function inlineUses(text, watch) {
  const out = [];
  for (const seg of inlineSegments(text)) for (const u of usesOf(parseCss(seg.css).root, watch || null)) out.push(Object.assign(u, { inline: true }));
  return out;
}

module.exports = { ROOT, families, readFile, blankCss, squash, parseCss, blocks, splitList, ancestors, usesOf, versionCmp, supportAt, TABLE_PATH, loadTable, classify, SIM, unknownFeatures, forceFallbacks, scriptFiles, inlineSegments, inlineUses, generatedSheets };
