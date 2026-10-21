#!/usr/bin/env node
/**
 * Every CSS feature the stylesheets use, or that a script or page writes inline, is in tests/css-floor-table.json, and one that the floor (iPadOS 13.4) does not read has what the table says.
 *
 *   node tests/verify-floor-css-pure.js
 *
 * tests/verify-ipad-pure.js holds the SCRIPT to a list of constructs that arrived after the floor, and holds the stylesheets to two things: the
 * -webkit- prefix on backdrop-filter and a vh before every dvh. The rest of what they use was not measured, and what is newer than the floor does
 * not stop an older Safari: it skips the declaration, or the whole rule, or the whole @media, and says nothing (see the top of tests/_cssfloor.js).
 * Measured with those features made unknown to an engine, the top bar of the app had no ground and its white text lay on the page, the diagram
 * stages were 0 px tall, and the chapter icons and the ring in the study screen were not where they belong.
 *
 * THE TABLE. Every property, function, unit, pseudo-class, at-rule and media feature the stylesheets use (and every property and function a script or page writes
 * inline) is a row, with MDN's first iOS Safari that
 * reads it (scripts/css-floor-table.js writes it from the data). A use that is not in the table fails here, which is how a newer feature is stopped
 * from arriving unclassified: whoever writes it has to run the script and say what the stylesheets do about it. A feature newer than the floor has a
 * class, and the class is a claim that is checked here wherever it can be:
 *
 *     fallback     the older spelling is in the stylesheets. "companion": each rule that uses it is followed by an @supports not rule for the same
 *                  selector (the only way for a declaration with a var() in it, which an older Safari takes at face value and then drops);
 *                  "guard": such a rule exists for a named selector, and every use of the feature is on that selector; "before": the same property, in the same rule, with a value the floor reads,
 *                  is written first; "split": no selector list holds it with a selector that does not need it, because the whole rule goes;
 *                  "elsewhere": another suite holds it.
 *     progressive  not having it is the older default, and the row says what that is.
 *     accepted     it has a cost, measured or stated, that was not worth removing.
 *     inert        it means nothing on an iPad.
 *     banned       not used, and not to be: the row says what to write.
 *
 * The browser half is tests/verify-floor.js, which draws the app with the features that have a fallback made unknown and compares it.
 *
 * The reader is tried on small stylesheets first, one for each way it could be wrong, because a reader that finds nothing would pass every file below.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('./_cssfloor.js');
const { blankComments } = require('./_source.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const CLASSES = ['fallback', 'progressive', 'accepted', 'inert', 'banned'];
const HOWS = ['companion', 'guard', 'before', 'split', 'elsewhere'];

/* ── the checks, as functions of a parsed stylesheet and a table, so that the small stylesheets below and the real ones go through the same code ── */
const SHORTHAND = { 'place-content': ['align-content', 'justify-content'], 'place-items': ['align-items', 'justify-items'], 'place-self': ['align-self', 'justify-self'] };
const overlaps = (a, b) => a === b || a.startsWith(b + '-') || b.startsWith(a + '-') || (SHORTHAND[a] || []).includes(b) || (SHORTHAND[b] || []).includes(a);   // a shorthand and its longhands: border and border-top-color
const compact = s => s.replace(/\s+/g, '').toLowerCase();
const isNotSupports = (block, probe) => !!block && block.t === 'at' && compact(block.prelude) === compact('@supports not (' + probe + ')');
const inNotSupports = node => C.ancestors(node).some(a => a.t === 'at' && /^@supports\s+not\b/i.test(a.prelude)) || (node.t === 'at' && /^@supports\s+not\b/i.test(node.prelude));
const selectorsOf = rule => C.splitList(rule.prelude);
const readAtFloor = (decl, watch) => !Object.keys((watch && watch[decl.prop]) || {}).some(k => new RegExp('(?<![\\w-])' + k + '(?![\\w(-])', 'i').test(decl.value));
const where = (file, u) => `${file}:${u.line}`;

/* what a use of a feature is followed by: an @supports not (probe) block, right after its rule in the same parent, holding a rule for the same
   selector (or, for a cell that is only one kind of that selector, a descendant of it) that sets what the use had set */
function companionProblems(file, uses, row) {
  const out = [];
  const exempt = Object.keys(row.exempt || {}).map(C.squash);
  const byRule = new Map();
  for (const u of uses) { if (!byRule.has(u.node)) byRule.set(u.node, []); byRule.get(u.node).push(u); }
  for (const [rule, mine] of byRule) {
    if (rule.t !== 'rule') { out.push(`${where(file, mine[0])} ${mine[0].key} is not in a style rule`); continue; }
    const sels = selectorsOf(rule).filter(s => !exempt.includes(s));
    if (!sels.length) continue;
    const sibs = rule.parent.children, next = sibs[sibs.indexOf(rule) + 1];
    if (!isNotSupports(next, row.probe)) { out.push(`${where(file, mine[0])} ${rule.prelude.slice(0, 50)}: not followed by @supports not (${row.probe})`); continue; }
    const needs = row.sets ? [row.sets] : [...new Set(mine.map(u => u.decl.prop))].map(p => [p]);
    for (const o of sels) {                              // each selector of a list, since an older Safari that has no rule for one of them draws it without
      const same = next.children.filter(r => r.t === 'rule' && selectorsOf(r).some(s => s === o || s.endsWith(' ' + o)));
      if (!same.length) { out.push(`${where(file, mine[0])} ${o}: its @supports not block has no rule for it`); continue; }
      const set = same.flatMap(r => r.decls.map(d => d.prop));
      for (const need of needs) if (!need.some(n => set.some(s => overlaps(n, s)))) out.push(`${where(file, mine[0])} ${o}: its fallback sets none of ${need.join(', ')}`);
    }
  }
  return out;
}

/* a use of a keyword the floor does not read has, in the same rule and before it, the same property with a value it does */
function beforeProblems(file, uses, watch) {
  const out = [];
  for (const u of uses) {
    const rule = u.node, at = rule.decls.indexOf(u.decl);
    const prior = rule.decls.slice(0, at);
    let found = false;
    for (let i = prior.length - 1; i >= 0; i--) {
      if (prior[i].prop === u.decl.prop) { found = readAtFloor(prior[i], watch); break; }
      if (overlaps(prior[i].prop, u.decl.prop)) break;       // a shorthand between them says something else to the Safari that reads it
    }
    if (!found) out.push(`${where(file, u)} ${u.key}: no ${u.decl.prop} the floor reads written before it in the same rule`);
  }
  return out;
}

/* a selector list that holds a pseudo-class the floor does not read holds only selectors that use it: an unknown one drops the whole rule */
function splitProblems(file, root, name) {
  const out = [];
  for (const node of C.blocks(root)) {
    if (node.t !== 'rule') continue;
    const sels = selectorsOf(node);
    if (sels.length < 2) continue;
    const has = sels.map(s => [...s.matchAll(/(::?)(-?[a-zA-Z][\w-]*)/g)].some(m => m[1] + m[2].toLowerCase() === name));
    if (has.some(Boolean) && !has.every(Boolean)) out.push(`${file}:${node.line} ${node.prelude.slice(0, 60)}: a list with ${name} and a selector without it`);
  }
  return out;
}

/* the simple selectors of the last compound of a selector: .x .sr.on > i  is  i,  and  .x .sr.on  is  .sr, .on */
const lastCompound = s => (s.split(/\s*[>+~]\s*|\s+/).filter(Boolean).pop() || '').match(/[.#][\w-]+|\[[^\]]*\]|::?[\w-]+(?:\([^)]*\))?|[\w-]+|\*/g) || [];
/* a guard is an @supports not (probe) block with a rule for the named selector, and every use of the feature is on that selector (or on a refinement of it):
   a use anywhere else has no rule that says what an older Safari draws instead */
const guardProblems = (roots, row, uses) => {
  const out = [];
  const found = roots.some(({ root }) => [...C.blocks(root)].some(b => isNotSupports(b, row.probe) && b.children.some(r => r.t === 'rule' && selectorsOf(r).includes(row.guard))));
  if (!found) out.push(`no @supports not (${row.probe}) block has a rule for ${row.guard}`);
  const want = lastCompound(row.guard);
  for (const u of uses || []) {
    if (u.node.t !== 'rule') { out.push(`${where(u.file, u)} ${u.key} is not in a style rule`); continue; }
    for (const s of selectorsOf(u.node)) if (!want.every(t => lastCompound(s).includes(t))) out.push(`${where(u.file, u)} ${s}: uses ${u.key} and is not ${row.guard}, the one its guard is for`);
  }
  return out;
};

/* every plain use of a feature that is read at the floor only behind -webkit- has the prefixed one in its rule */
function prefixProblems(file, uses, table) {
  const out = [];
  for (const u of uses) {
    if (u.kind !== 'property' || !table.prefixed[u.key] || u.name.startsWith('-webkit-')) continue;
    if (!u.node.decls.some(d => d.prop === '-webkit-' + u.name)) out.push(`${where(file, u)} ${u.name}: no -webkit-${u.name} in its rule`);
  }
  return out;
}

/* one pass over parsed files: what is not in the table, what is in it wrongly, and what each class says that is not so */
function analyse(files, table) {
  const res = { unlisted: new Map(), todo: [], malformed: [], rows: {}, stray: [], newerInside: [], unusedRows: [], prefix: [] };
  const all = files.flatMap(f => f.uses.map(u => Object.assign({ file: f.file }, u)));
  for (const u of all) {
    const c = C.classify(table, u);
    if (c.how === 'unlisted' && !res.unlisted.has(u.key)) res.unlisted.set(u.key, where(u.file, u));
    if (c.how === 'above' && inNotSupports(u.node) && u.kind !== 'atrule') res.newerInside.push(`${where(u.file, u)} ${u.key}`);
  }
  const used = new Set(all.map(u => u.key));
  for (const [key, row] of Object.entries(table.above)) {
    const bad = [];
    if (!(row.since === null || C.versionCmp(row.since, table.floor) > 0)) bad.push('is not newer than the floor');
    if (row.class === 'TODO') { res.todo.push(key); continue; }
    if (!CLASSES.includes(row.class)) bad.push('has no class from ' + CLASSES.join('/'));
    if (typeof row.note !== 'string' || row.note.length < 10) bad.push('has no note saying what the stylesheets do about it');
    if (row.class === 'fallback' && !HOWS.includes(row.how)) bad.push('is a fallback and does not say how: ' + HOWS.join('/'));
    if ((row.how === 'companion' || row.how === 'guard') && !row.probe) bad.push('has no probe');
    if (row.how === 'guard' && !row.guard) bad.push('has no guard selector');
    if (row.how === 'elsewhere' && !row.where) bad.push('does not say where');
    if (bad.length) res.malformed.push(`${key} ${bad.join(', ')}`);
    const mine = all.filter(u => u.key === key);
    if (row.class !== 'banned' && !mine.length) res.unusedRows.push(key);
    const problems = [];
    if (row.class === 'banned') for (const u of mine) problems.push(`${where(u.file, u)} ${key} is banned: ${row.note}`);
    else if (row.how === 'companion') for (const f of files) problems.push(...companionProblems(f.file, mine.filter(u => u.file === f.file), row));
    else if (row.how === 'before') for (const f of files) problems.push(...beforeProblems(f.file, mine.filter(u => u.file === f.file), table.watch));
    else if (row.how === 'split') for (const f of files) problems.push(...splitProblems(f.file, f.root, key.replace(/^selector /, '')));
    else if (row.how === 'guard') problems.push(...(mine.length ? guardProblems(files, row, mine) : []));
    res.rows[key] = problems;
  }
  for (const f of files) {
    for (const b of C.blocks(f.root)) {
      const m = /^@supports\s+not\s*\((.*)\)\s*$/i.exec(b.prelude);
      const newer = Object.keys(table.above).filter(k => !/^(value|layout|selector) /.test(k)).map(k => k.split(' ')[1]);
      const about = newer.some(n => new RegExp('(?<![\\w-])' + n + '(?![\\w-])').test(m ? m[1] : ''));
      if (m && about && !Object.values(table.above).some(r => r.probe && compact(r.probe) === compact(m[1]))) res.stray.push(`${f.file}:${b.line} @supports not (${m[1]}) is no row's probe`);
    }
    res.prefix.push(...prefixProblems(f.file, f.uses, table));
  }
  return res;
}

const parseFile = (file, css, table) => { const p = C.parseCss(css); return { file, root: p.root, balanced: p.balanced, uses: C.usesOf(p.root, table.watch) }; };

head('the reader, on small stylesheets');
{
  const T = { floor: '13.4', ok: { property: ['color', 'padding-bottom', 'height', 'background', 'border', 'overflow-wrap', 'content', 'display', 'opacity'], function: ['min', 'var', 'rgba', 'url', 'blur'], unit: ['px', '%', 'vh', 's'], selector: [':hover', '::before', ':not', ':focus'], atrule: ['@media', '@supports', '@keyframes'], media: ['width', 'hover'] }, prefixed: { 'property backdrop-filter': { since: '18', prefixedSince: '9' }, 'property -webkit-backdrop-filter': { since: '18', prefixedSince: '9' } }, above: {}, watch: { 'overflow-wrap': { anywhere: '15.4' }, 'align-content': { start: '15.6' } } };
  const row = (o) => Object.assign({ since: '15', note: 'a note that says what happens', class: 'fallback' }, o);
  const P = css => parseFile('t.css', css, T);
  const A = (css, rows, extra) => { const t = Object.assign({}, T, { above: rows }, extra || {}); return analyse([parseFile('t.css', css, t)], t); };
  const probe = 'color:color-mix(in srgb,red,blue)';
  const CM = { 'function color-mix': row({ since: '16.2', how: 'companion', probe }) };
  const SUP = '@supports not (' + probe + ')';

  /* the tree */
  const t1 = C.parseCss('@media (min-width:1px){.a,.b{color:red;height:1px !important}}.c{--x:1}@import "x.css";');
  const media = t1.root.children[0], rule = media.children[0];
  ok('a stylesheet is read as blocks: an at-rule holding a rule holding its declarations, and a statement at the top', t1.balanced && media.t === 'at' && rule.t === 'rule' && rule.decls.length === 2 && t1.root.children[2].t === 'atstmt', `${rule.decls.map(d => d.prop).join()}`);
  ok('!important is not part of the value, a custom property keeps its case, and the line is the line of the declaration', rule.decls[1].important && rule.decls[1].value === '1px' && C.parseCss('.a{--Foo:1}').root.children[0].decls[0].prop === '--Foo' && C.parseCss('\n\n.a{\n  color:red}').root.children[0].decls[0].line === 4);
  ok('a comment or a string with braces or a semicolon in it is nothing', C.parseCss('.a{content:"}{;"}/* .b{color:red} */.c{color:blue}').root.children.length === 2 && C.parseCss('.a{content:"}{;"}').balanced);
  ok('a ; or a } inside url() or a function does not end the declaration', C.parseCss('.a{background:url(data:image/svg+xml;utf8,<svg>;}</svg>);color:red}').root.children[0].decls.length === 2);
  ok('braces that do not balance are found, a block never closed and one closed twice', !C.parseCss('.a{color:red').balanced && !C.parseCss('.a{}}').balanced && !C.parseCss('.a{b:url(').balanced && C.parseCss('@media (x){.a{color:red}}').balanced);
  ok('a selector list is split at its commas and not at those in parentheses or brackets', C.splitList(':is(.a,.b) .c, .d[x="1,2"] , .e').join('|') === ':is(.a,.b) .c|.d[x="1,2"]|.e');

  /* the uses */
  const keysOf = (css, w) => C.usesOf(C.parseCss(css).root, w).map(u => u.key);
  const k1 = keysOf('.a:hover::before,.b:not(:focus){inset:0;color:rgba(0,0,0,.5);height:calc(100vh - 4px);transition:opacity .3s}@media (min-width:600px) and (hover:hover){.c{opacity:1}}');
  ok('a use is found for a property, a function, a unit, a pseudo-class and a pseudo-element, an at-rule and a media feature', ['property inset', 'function rgba', 'function calc', 'unit vh', 'unit px', 'unit s', 'selector :hover', 'selector ::before', 'selector :not', 'selector :focus', 'atrule @media', 'media width', 'media hover'].every(k => k4(k1, k)), k1.join(' '));
  function k4(list, k) { return list.includes(k); }
  ok('a custom property is one feature, and a number with no unit has none', keysOf('.a{--x:1;--y:2}').filter(k => k.startsWith('property')).join() === 'property --*,property --*' && !keysOf('.a{opacity:.5;z-index:3}').some(k => k.startsWith('unit')));
  ok('a name with a hyphen in front is read: ::-webkit-details-marker, -webkit-gradient()', keysOf('.a::-webkit-details-marker{background:-webkit-gradient(linear,0 0,0 1)}').join() === 'selector ::-webkit-details-marker,property background,function -webkit-gradient');
  ok('the tested condition of an @supports is not a use, and the rules in it are', !keysOf('@supports not (color:color-mix(in srgb,red,blue)){.a{color:red}}').includes('function color-mix') && keysOf('@supports not (x:y){.a{inset:0}}').includes('property inset'));
  ok('a unit is not found in a colour, a hex alpha and a space-separated rgb are, and selector() in an @supports is', !keysOf('.a{color:#5EEAD4}').some(k => k.startsWith('unit')) && keysOf('.a{color:#5EEAD4AA}').includes('color hex-alpha') && keysOf('.a{color:rgb(0 0 0 / .5)}').includes('color space-separated') && !keysOf('.a{color:rgba(0,0,0,.5)}').includes('color space-separated') && keysOf('@supports selector(:has(a)){.a{color:red}}').includes('supports selector()'));
  ok('range syntax and not/or in a media query are found, and min- and max- are one feature', keysOf('@media (width >= 600px){.a{color:red}}').includes('media range-syntax') && keysOf('@media not all and (hover:hover){.a{color:red}}').includes('media not-or') && keysOf('@media (min-width:1px) and (max-width:9px){.a{color:red}}').filter(k => k === 'media width').length === 2 && !keysOf('@media (min-width:1px){.a{color:red}}').includes('media range-syntax'));
  ok('a keyword the watch list names is a use of the property it is the value of, and only of that one', keysOf('.a{overflow-wrap:anywhere}.b{display:anywhere}', T.watch).filter(k => k.startsWith('value')).join() === 'value overflow-wrap: anywhere' && !keysOf('.a{overflow-wrap:break-word}', T.watch).some(k => k.startsWith('value')));
  ok('a gap is taken for a flex box\'s, which the text cannot tell', keysOf('.a{gap:4px}.b{row-gap:1px}.c{column-gap:2px}.d{grid-gap:3px}').filter(k => k === 'layout flex-gap').length === 3);
  ok('the descriptors of an @font-face, @page, @property and @counter-style are descriptors of their at-rule and not properties, and the functions and units in their values are read', (() => {
    const k = keysOf('@font-face{font-family:x;src:url(x.woff2) format("woff2");font-display:swap;size-adjust:100%}@property --x{syntax:"<length>";inherits:false}@counter-style c{system:cyclic;symbols:"a"}@page{size:A4;margin:1cm}');
    return ['descriptor @font-face src', 'descriptor @font-face size-adjust', 'descriptor @property syntax', 'descriptor @counter-style system', 'descriptor @page size', 'function url', 'function format', 'unit %', 'unit cm'].every(x => k.includes(x)) &&
      !k.some(x => x === 'property src' || x === 'property font-display' || x === 'property size' || x === 'property margin');
  })());

  /* the table */
  ok('a feature that is in no part of the table is unlisted, and one in ok, in prefixed or in above is not', A('.a{scroll-snap-type:x}', {}).unlisted.has('property scroll-snap-type') && !A('.a{color:red}', {}).unlisted.size && !A('.a{backdrop-filter:blur(1px);-webkit-backdrop-filter:blur(1px)}', {}).unlisted.size && !A('.a{inset:0}', { 'property inset': row({ class: 'banned' }) }).unlisted.size);
  ok('a row that is still TODO is found, and so is one with no class, no note, a fallback with no how, a companion with no probe, and one that is not newer than the floor',
     A('.a{inset:0}', { 'property inset': { since: '14.5', class: 'TODO' } }).todo.length === 1 &&
     A('.a{inset:0}', { 'property inset': { since: '14.5', class: 'maybe', note: 'a note that says what happens' } }).malformed.length === 1 &&
     A('.a{inset:0}', { 'property inset': { since: '14.5', class: 'banned' } }).malformed.length === 1 &&
     A('.a{inset:0}', { 'property inset': row({ how: undefined }) }).malformed.length === 1 &&
     A('.a{inset:0}', { 'property inset': row({ how: 'companion' }) }).malformed.length === 1 &&
     A('.a{inset:0}', { 'property inset': row({ since: '13.4', class: 'banned' }) }).malformed.length === 1 &&
     A('.a{inset:0}', { 'property inset': row({ since: '9', class: 'banned' }) }).malformed.length === 1 &&
     A('.a{inset:0}', { 'property inset': row({ since: null, class: 'banned' }) }).malformed.length === 0);
  ok('a row for a feature that is not used is found, unless it is banned', A('.a{color:red}', { 'property inset': row({ class: 'progressive' }) }).unusedRows.length === 1 && A('.a{color:red}', { 'property inset': row({ class: 'banned' }) }).unusedRows.length === 0);

  /* banned */
  ok('a banned feature that is used is found, and one that is not is not', A('.a{inset:0}', { 'property inset': row({ class: 'banned' }) }).rows['property inset'].length === 1 && A('.a{top:0}', { 'property inset': row({ class: 'banned' }) }).rows['property inset'].length === 0);

  /* companion */
  const cm = (css, rows) => A(css, rows || CM).rows['function color-mix'];
  ok('a rule is followed by its @supports not rule for the same selector: nothing is found', cm('.a{background:color-mix(in srgb,var(--x) 10%,transparent)}' + SUP + '{.a{background:var(--y)}}').length === 0);
  ok('and one with no @supports after it is found, and so is one with another rule between, one for another selector, and a positive @supports', cm('.a{background:color-mix(in srgb,var(--x) 10%,transparent)}').length === 1 &&
     cm('.a{background:color-mix(in srgb,var(--x) 10%,transparent)}.b{color:red}' + SUP + '{.a{background:var(--y)}}').length === 1 &&
     cm('.a{background:color-mix(in srgb,var(--x) 10%,transparent)}' + SUP + '{.b{background:var(--y)}}').length === 1 &&
     cm('.a{background:color-mix(in srgb,var(--x) 10%,transparent)}@supports (' + probe + '){.a{background:var(--y)}}').length === 1);
  ok('a different probe is not the probe, and white space in it is not a difference', cm('.a{background:color-mix(in srgb,var(--x) 10%,transparent)}@supports not (color:red){.a{background:var(--y)}}').length === 1 &&
     cm('.a{background:color-mix(in srgb,var(--x) 10%,transparent)}@supports  not ( color : color-mix( in srgb , red , blue ) ){.a{background:var(--y)}}').length === 0);
  ok('its fallback sets what the use set, and a shorthand and its longhands are the same thing', cm('.a{border:1px solid color-mix(in srgb,var(--x) 10%,transparent)}' + SUP + '{.a{border-color:red}}').length === 0 &&
     cm('.a{border-color:color-mix(in srgb,var(--x) 10%,transparent)}' + SUP + '{.a{border:1px solid red}}').length === 0 &&
     cm('.a{border:1px solid color-mix(in srgb,var(--x) 10%,transparent)}' + SUP + '{.a{color:red}}').length === 1 &&
     cm('.a{background:color-mix(in srgb,var(--x) 10%,transparent);border:1px solid color-mix(in srgb,var(--x) 10%,transparent)}' + SUP + '{.a{background:red}}').length === 1);
  ok('a refinement of the selector counts, and a rule inside an @media follows it inside that @media', cm('.a{background:color-mix(in srgb,var(--x) 10%,transparent)}' + SUP + '{.g .a{background:red}}').length === 0 &&
     cm('@media (hover:hover){.a:hover{background:color-mix(in srgb,var(--x) 10%,transparent)}' + SUP + '{.a:hover{background:red}}}').length === 0 &&
     cm('@media (hover:hover){.a:hover{background:color-mix(in srgb,var(--x) 10%,transparent)}}' + SUP + '{.a:hover{background:red}}').length === 1);
  const MIX = 'background:color-mix(in srgb,var(--x) 10%,transparent)';
  ok('a selector list is covered when every selector of it is: by one rule that lists them, or by a rule each', cm('.a,.b{' + MIX + '}' + SUP + '{.a,.b{background:red}}').length === 0 &&
     cm('.a,.b{' + MIX + '}' + SUP + '{.a{background:red}.b{background:red}}').length === 0 && cm('.a,.b{' + MIX + '}' + SUP + '{.b,.a{background:red}}').length === 0);
  ok('and one that covers only some of them is found, whichever it leaves out, and so is a selector of it whose rule sets something else', cm('.a,.b{' + MIX + '}' + SUP + '{.a{background:red}}').length === 1 &&
     cm('.a,.b{' + MIX + '}' + SUP + '{.b{background:red}}').length === 1 && cm('.a,.b,.c{' + MIX + '}' + SUP + '{.a{background:red}.c{background:red}}').length === 1 &&
     cm('.a,.b{' + MIX + '}' + SUP + '{.a{background:red}.b{color:red}}').length === 1);
  const AR = { 'property aspect-ratio': row({ how: 'companion', probe: 'aspect-ratio:1', sets: ['height', 'padding-bottom'], exempt: { '.img': 'an image' } }) };
  const ar = css => A(css, AR).rows['property aspect-ratio'];
  ok('a ratio box has the box made the old way, and an exempt selector has none', ar('.s{aspect-ratio:1.5}@supports not (aspect-ratio:1){.s{height:0;padding-bottom:66%}}').length === 0 && ar('.s{aspect-ratio:1.5}@supports not (aspect-ratio:1){.s{width:1px}}').length === 1 && ar('.s{aspect-ratio:1.5}').length === 1 && ar('.img{aspect-ratio:1.5}').length === 0 && ar('.img,.s{aspect-ratio:1.5}').length === 1);
  const DS = { 'descriptor @font-face size-adjust': row({ since: '17', class: 'progressive' }) };
  ok('a descriptor that is not in the table is found, and one that a row lists as newer than the floor is classified like any other feature', A('@font-face{font-family:x;size-adjust:100%}', {}).unlisted.has('descriptor @font-face size-adjust') &&
     !A('@font-face{font-family:x;size-adjust:100%}', DS).unlisted.has('descriptor @font-face size-adjust') && A('@font-face{font-family:x;size-adjust:100%}', DS).malformed.length === 0);
  ok('the older spelling uses nothing newer than the floor', A('.a{background:color-mix(in srgb,var(--x) 10%,transparent)}' + SUP + '{.a{background:color-mix(in srgb,var(--y) 10%,transparent)}}', CM).newerInside.length === 1 && A('.a{background:color-mix(in srgb,var(--x) 10%,transparent)}' + SUP + '{.a{background:var(--y)}}', CM).newerInside.length === 0);
  ok('an @supports not that tests a feature the table lists as newer and is no row\'s probe is found, a row\'s is not, and one that tests something else is not either', A('@supports not (color:color-mix(in srgb,red,blue) or x:y){.a{color:red}}', CM).stray.length === 1 && A('@supports not (display:grid){.a{color:red}}', CM).stray.length === 0 && A('.a{background:color-mix(in srgb,var(--x) 10%,transparent)}' + SUP + '{.a{background:red}}', CM).stray.length === 0);

  /* before */
  const OW = { 'value overflow-wrap: anywhere': row({ since: '15.4', how: 'before' }) };
  const ow = css => A(css, OW).rows['value overflow-wrap: anywhere'];
  ok('a keyword the floor does not read has the property before it, in its rule: nothing is found', ow('.a{overflow-wrap:break-word;overflow-wrap:anywhere}').length === 0 && ow('.a{overflow-wrap:break-word;color:red;overflow-wrap:anywhere}').length === 0);
  ok('and one with nothing before it is found, and so is one with the fallback after it, in another rule, or that is itself newer', ow('.a{overflow-wrap:anywhere}').length === 1 && ow('.a{overflow-wrap:anywhere;overflow-wrap:break-word}').length === 1 &&
     ow('.a{overflow-wrap:break-word}.a{overflow-wrap:anywhere}').length === 1 && ow('.a{overflow-wrap:anywhere;overflow-wrap:anywhere}').length === 2 && ow('.a{color:red;overflow-wrap:anywhere}').length === 1);
  const AC = { 'value align-content: start': row({ since: '15.6', how: 'before' }) };
  ok('and a shorthand between them is found, because it says something else to the Safari that reads it, and a declaration of another property is not', A('.a{align-content:flex-start;place-content:center;align-content:start}', AC).rows['value align-content: start'].length === 1 &&
     A('.a{align-content:flex-start;align-items:center;align-content:start}', AC).rows['value align-content: start'].length === 0 && A('.a{align-content:flex-start;align-content:start}', AC).rows['value align-content: start'].length === 0);

  /* split */
  const FV = { 'selector :focus-visible': row({ since: '15.4', how: 'split' }) };
  const sp = css => A(css, FV).rows['selector :focus-visible'];
  ok('a pseudo-class the floor does not read is alone in its rule, or with others that need it: nothing is found', sp('.a:focus-visible{color:red}').length === 0 && sp('.a:focus-visible,.b:focus-visible{color:red}').length === 0 && sp('.a:focus-visible .x,.b:focus-visible{color:red}').length === 0);
  ok('and one in a list with a selector that does not is found, in either place in the list, and one inside :not()', sp('.a:focus-visible,.b{color:red}').length === 1 && sp('.b,.a:focus-visible{color:red}').length === 1 && sp('.a:not(:focus-visible),.b{color:red}').length === 1 && sp('@media (hover:hover){.a,.b:focus-visible{color:red}}').length === 1);

  /* guard */
  const GD = { 'property translate': row({ since: '14.5', how: 'guard', probe: 'translate:0 1px', guard: '.sr' }) };
  const gd = css => A(css, GD).rows['property translate'];
  ok('a named selector has an @supports not block for the probe, anywhere: nothing is found, and without one it is', gd('.sr{translate:0 1px}@supports not (translate:0 1px){.sr{opacity:1}}').length === 0 && gd('.sr{translate:0 1px}.sr{opacity:1}').length === 1 && gd('.sr{translate:0 1px}@supports not (translate:0 1px){.x{opacity:1}}').length === 1);
  ok('every use of the feature is on the guarded selector or a refinement of it', gd('.sr{translate:0 1px}.sr.on{translate:0 0}.x .sr{translate:none}@supports not (translate:0 1px){.sr{opacity:1}}').length === 0 &&
     gd('.sr{translate:0 1px}@media (hover:hover){.sr:hover{translate:0 0}}@supports not (translate:0 1px){.sr{opacity:1}}').length === 0);
  ok('and one anywhere else is found, with the guard in place: another selector, one of a list, a child of it, a use outside a rule', gd('.sr{translate:0 1px}.other{translate:0 1px}@supports not (translate:0 1px){.sr{opacity:1}}').length === 1 &&
     gd('.sr,.other{translate:0 1px}@supports not (translate:0 1px){.sr{opacity:1}}').length === 1 && gd('.sr{translate:0 1px}.sr .kid{translate:0 1px}@supports not (translate:0 1px){.sr{opacity:1}}').length === 1 &&
     gd('.sr{translate:0 1px}.sr-x{translate:0 1px}@supports not (translate:0 1px){.sr{opacity:1}}').length === 1 && gd('.sr{translate:0 1px}@keyframes k{from{translate:0 1px}}@supports not (translate:0 1px){.sr{opacity:1}}').length === 1);

  /* prefixed */
  const pf = css => A(css, {}).prefix;
  ok('a feature that is read only behind -webkit- has it in the same rule: nothing is found, and a plain one alone is, and so is the prefixed one in another rule', pf('.a{-webkit-backdrop-filter:blur(1px);backdrop-filter:blur(1px)}').length === 0 && pf('.a{backdrop-filter:blur(1px)}').length === 1 && pf('.a{backdrop-filter:blur(1px)}.a{-webkit-backdrop-filter:blur(1px)}').length === 1 && pf('.a{-webkit-backdrop-filter:blur(1px)}').length === 0);
}

head('the data, as the script that writes the table reads it');
{
  /* scripts/css-floor-table.js sorts a feature into ok, prefixed or above by what MDN's data says iOS Safari does with it at the floor. That reading is here, so that it
     can be tried on small statements of the data, one for each way MDN writes one down, without the package. */
  const at = s => ({ __compat: { support: { safari_ios: s } } });
  const r = (s, floor = '13.4') => { const x = C.supportAt(at(s), floor); return `${x.state} ${x.since} ${x.prefixedSince}`; };
  ok('a feature from before the floor is read there, one from the floor itself too, and one from after it is not, with the version it came in', r({ version_added: '9' }) === 'yes 9 null' && r({ version_added: '13.4' }) === 'yes 13.4 null' && r({ version_added: '14.5' }) === 'no 14.5 null' && r({ version_added: '13.10' }) === 'no 13.10 null');
  ok('versions are compared as numbers, not as text: 9 is before 13.4 and 13.10 is after it', r({ version_added: '9' }, '13.4') === 'yes 9 null' && r({ version_added: '13.10' }, '13.4') === 'no 13.10 null' && r({ version_added: '13.4' }, '13.10') === 'yes 13.4 null');
  ok('one that was never added, or is read in every version, is no and yes', r({ version_added: false }) === 'no null null' && r({ version_added: true }) === 'yes null null');
  ok('one that is read only behind -webkit- is prefix, and says since when, and a later unprefixed entry says since when it is read plain', r({ version_added: '9', prefix: '-webkit-' }) === 'prefix null 9' && r([{ version_added: '18' }, { version_added: '9', prefix: '-webkit-' }]) === 'prefix 18 9' && r([{ version_added: '12' }, { version_added: '9', prefix: '-webkit-' }]) === 'yes 12 9');
  ok('a prefixed entry that starts after the floor is not read there', r({ version_added: '14', prefix: '-webkit-' }) === 'no null 14');
  ok('a partial implementation is partial, and a full one beside it makes it yes', r({ version_added: '1', partial_implementation: true }) === 'partial 1 null' && r([{ version_added: '1', partial_implementation: true }, { version_added: '9' }]) === 'yes 1 null');
  ok('an older partial implementation that a later entry replaced is the one at the floor, and one removed before the floor is not', r([{ version_added: '16.4' }, { version_added: '1', version_removed: '16.4', partial_implementation: true }]) === 'partial 1 null' && r({ version_added: '3', version_removed: '13' }) === 'no 3 null');
  ok('an entry behind a flag, or under another name, is not the feature', r({ version_added: '10', flags: [{ type: 'preference', name: 'x' }] }) === 'no null null' && r([{ version_added: '14' }, { version_added: '10', alternative_name: 'grid-gap' }]) === 'no 14 null' && r([{ version_added: '12' }, { version_added: '10', alternative_name: 'grid-gap' }]) === 'yes 12 null' && r({ version_added: '10', alternative_name: 'x' }) === 'no null null');
  ok('nothing said about iOS Safari, or about the feature, is nodata', r(undefined) === 'nodata null null' && C.supportAt(undefined, '13.4').state === 'nodata' && C.supportAt({}, '13.4').state === 'nodata' && C.supportAt({ __compat: { support: {} } }, '13.4').state === 'nodata');
}

head('the simulation the browser suite relies on, on small pages');
{
  /* tests/verify-floor.js makes a feature unknown by changing its name in the page's style text, so that an engine that knows it forgets it. A pattern that
     misses it leaves the suite comparing a page with itself, and one that takes a longer name, a class or a string for it breaks something that was fine. */
  const sim = (css, names) => C.unknownFeatures('<style>' + css + '</style>', names).html.slice(7, -8);
  const cases = [
    ['inset', '.a{inset:0}.b{clip-path:inset(0 4%)}.c{padding-inset:1px}', '.a{x-inset:0}.b{clip-path:inset(0 4%)}.c{padding-inset:1px}'],
    ['aspect-ratio', '.a{aspect-ratio:1}@supports not (aspect-ratio:1){.a{height:0}}.b{my-aspect-ratio:2}', '.a{x-aspect-ratio:1}@supports not (x-aspect-ratio:1){.a{height:0}}.b{my-aspect-ratio:2}'],
    ['translate', '.a{translate:0 18px}.b{transform:translate(1px,2px) translate3d(0,0,0)}@supports not (translate:0 1px){.a{opacity:1}}', '.a{x-translate:0 18px}.b{transform:translate(1px,2px) translate3d(0,0,0)}@supports not (x-translate:0 1px){.a{opacity:1}}'],
    ['color-mix', '.a{color:color-mix(in srgb,red,blue)}.b{color:my-color-mix(1)}@supports not (color:color-mix(in srgb,red,blue)){.a{color:red}}', '.a{color:x-color-mix(in srgb,red,blue)}.b{color:my-color-mix(1)}@supports not (color:x-color-mix(in srgb,red,blue)){.a{color:red}}'],
    ['focus-visible', '.a:focus-visible,.b{x:y}.focus-visible{x:y}.focus-visible-ring{x:y}.c:focus-visible-not{x:y}', '.a:x-focus-visible,.b{x:y}.focus-visible{x:y}.focus-visible-ring{x:y}.c:focus-visible-not{x:y}'],
    ['has', '.a:has(i){x:y}.has-x{x:y}', '.a:x-has(i){x:y}.has-x{x:y}'],
    ['overflow-wrap-anywhere', '.a{overflow-wrap:break-word;overflow-wrap: anywhere;word-break:anywhere}', '.a{overflow-wrap:break-word;overflow-wrap: x-anywhere;word-break:anywhere}'],
    ['align-content-start', '.a{align-content:flex-start;align-content:start;align-items:start}', '.a{align-content:flex-start;align-content:x-start;align-items:start}'],
    ['media-reduced-transparency', '@media (prefers-reduced-transparency: reduce){.a{x:y}}', '@media (x-prefers-reduced-transparency: reduce){.a{x:y}}'],
  ];
  for (const [name, css, want] of cases) ok(`${name} is renamed where it is the feature, and not in a longer name, a class, or another property`, sim(css, [name]) === want, sim(css, [name]).slice(0, 90));
  ok('nothing in a comment or a string is renamed', sim('/* inset:0 color-mix(1) */.a{content:"inset:0 color-mix(x) :has("}', ['inset', 'color-mix', 'has']) === '/* inset:0 color-mix(1) */.a{content:"inset:0 color-mix(x) :has("}');
  ok('only the page\'s style is changed, and the count says how many were', C.unknownFeatures('<p>inset:0</p><style>.a{inset:0}</style><script>var o={inset:0}</script>', ['inset']).html === '<p>inset:0</p><style>.a{x-inset:0}</style><script>var o={inset:0}</script>' && C.unknownFeatures('<style>.a{inset:0;inset:1px}</style>', ['inset']).counts.inset === 2);
  ok('a name that is no feature is refused', (() => { try { C.unknownFeatures('<style></style>', ['inset-x']); return false; } catch (e) { return /no such feature/.test(e.message); } })());
  const probe = 'color:color-mix(in srgb,red,blue)';
  const forced = C.forceFallbacks('<style>.a{x:y}@supports not (' + probe + '){.a{x:z}}@supports not (display:grid){.b{x:y}}@supports (' + probe + '){.c{x:y}}</style>', [probe]);
  ok('an @supports not block with a probe is turned into @media all, and no other block is, and the count is of that probe', forced.count === 1 && forced.counts[probe] === 1 && C.forceFallbacks('<style>.a{x:y}</style>', [probe]).counts[probe] === 0 && forced.html === '<style>.a{x:y}@media all{.a{x:z}}@supports not (display:grid){.b{x:y}}@supports (' + probe + '){.c{x:y}}</style>');
}

head('the table');
{
  const T = C.loadTable();
  const readme = fs.readFileSync(path.join(C.ROOT, 'README.md'), 'utf8');
  const m = readme.match(/\*\*iPadOS (\d+\.\d+) or newer\.\*\*/);
  const ipad = fs.readFileSync(path.join(__dirname, 'verify-ipad-pure.js'), 'utf8').match(/const FLOOR = '(\d+\.\d+)'/);
  ok('the table\'s floor is the README\'s and the script guard\'s', !!m && !!ipad && T.floor === m[1] && T.floor === ipad[1], `table ${T.floor}, README ${m && m[1]}, verify-ipad-pure ${ipad && ipad[1]}`);
  ok('it says where its versions come from', /browser-compat-data/.test(T.source) && /safari_ios/.test(T.source), T.source);
  const dup = [];
  for (const [kind, names] of Object.entries(T.ok)) { const seen = new Set(); for (const n of names) { if (seen.has(n)) dup.push(kind + ' ' + n); seen.add(n); } }
  ok('no name is in its kind\'s ok list twice, and none is also a row of prefixed or above', dup.length === 0 && Object.entries(T.ok).every(([kind, names]) => names.every(n => !T.above[kind + ' ' + n] && !T.prefixed[kind + ' ' + n])), dup.join(', ') || `${Object.values(T.ok).reduce((n, a) => n + a.length, 0)} names`);
  const sims = Object.entries(T.above).filter(([, r]) => r.sim);
  ok('every row that has a sim names one the browser suite can make unknown, and every fallback that is not a split list or held elsewhere has one', sims.every(([, r]) => !!C.SIM[r.sim]) &&
     Object.entries(T.above).filter(([, r]) => r.class === 'fallback' && ['companion', 'guard', 'before'].includes(r.how)).every(([, r]) => !!r.sim), sims.map(([k, r]) => `${k} → ${r.sim}`).join(', '));
  ok('every row that is a fallback made of an @supports not rule has a probe the browser suite can put on top, and no probe is in two rows with different spellings', Object.values(T.above).filter(r => r.probe).every(r => r.probe.length > 5) &&
     new Set(Object.values(T.above).filter(r => r.probe).map(r => r.probe)).size === new Set(Object.values(T.above).filter(r => r.probe).map(r => r.probe.replace(/\s+/g, ''))).size);
  ok('every prefixed row is read at the floor behind a prefix and not without one', Object.entries(T.prefixed).every(([, r]) => (r.since === null || C.versionCmp(r.since, T.floor) > 0) && C.versionCmp(r.prefixedSince, T.floor) <= 0));
}

head('the stylesheets');
{
  const T = C.loadTable();
  const fams = C.families();
  const files = [];
  for (const fam of fams) {
    const read = fam.files.map(f => parseFile(f, C.readFile(f), T));
    files.push(...read);
    ok(`${fam.name}: its stylesheets are read, none is empty, and every file's braces balance`, read.length > 0 && read.every(r => r.uses.length > 0 && r.balanced), `${read.length} file(s), ${read.reduce((n, r) => n + r.uses.length, 0)} uses${read.some(r => !r.balanced) ? ', unbalanced: ' + read.filter(r => !r.balanced).map(r => r.file).join(', ') : ''}`);
  }
  const res = analyse(files, T);
  const list = (a, n = 4) => a.slice(0, n).join(' | ') + (a.length > n ? ` … ${a.length - n} more` : '');
  ok('every feature they use is in the table, so a newer one cannot arrive unclassified (node scripts/css-floor-table.js says how to add a row)', res.unlisted.size === 0, list([...res.unlisted].map(([k, w]) => `${k} (${w})`)) || `${new Set(files.flatMap(f => f.uses.map(u => u.key))).size} features`);
  ok('every one that is newer than the floor has been classified, with a note that says what the stylesheets do about it', res.todo.length === 0 && res.malformed.length === 0, list([...res.todo.map(k => k + ' is TODO'), ...res.malformed]) || `${Object.keys(T.above).length} rows`);
  ok('and every such row is for a feature that is still used, or is banned', res.unusedRows.length === 0, list(res.unusedRows));
  for (const [key, row] of Object.entries(T.above)) {
    if (row.how === 'elsewhere') {
      const f = path.join(C.ROOT, row.where);
      ok(`${key}: held by ${row.where}, which is there and names it`, fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes(key.split(' ').pop()), row.where);
    }
  }
  const byHow = {};
  for (const [key, row] of Object.entries(T.above)) if (['companion', 'guard', 'before', 'split'].includes(row.how) || row.class === 'banned') (byHow[row.how || row.class] = byHow[row.how || row.class] || []).push(key);
  for (const [how, keys] of Object.entries(byHow)) {
    const bad = keys.flatMap(k => res.rows[k] || []);
    ok(`${how === 'banned' ? 'what is banned is not used' : how === 'companion' ? 'every rule that uses a feature with a companion is followed by its @supports not rule' : how === 'guard' ? 'every guarded feature has the rule that guards it' : how === 'before' ? 'every keyword with a fallback in front has it' : 'no selector list holds a pseudo-class the floor does not read with one that does not need it'}: ${keys.join(', ')}`, bad.length === 0, list(bad) || 'none');
  }
  ok('every @supports not in the stylesheets is a row\'s probe, and every row\'s probe is used', res.stray.length === 0 && Object.values(T.above).filter(r => r.probe).every(r => files.some(f => [...C.blocks(f.root)].some(b => isNotSupports(b, r.probe)))), list(res.stray));
  ok('the older spelling uses nothing newer than the floor, which would be no fallback', res.newerInside.length === 0, list(res.newerInside));
  ok('what the floor reads only behind -webkit- is written with it in the same rule', res.prefix.length === 0, list(res.prefix));
  const flex = T.above['layout flex-gap'];
  ok('the table says what a gap on a flex box does before the Safari that reads it, because the text cannot show it', !!flex && flex.class === 'accepted' && files.some(f => f.uses.some(u => u.key === 'layout flex-gap')), flex ? `since ${flex.since}` : 'no row');
}

head('and a style written in script is held to the rows the table has');
{
  /* A style attribute or a script that sets one cannot carry an @supports rule, so a feature that needs one cannot be written there. Two things are held. What the
     scripts and pages write inline (style attributes, cssText strings, el.style.x, setProperty) is read by the same reader as the stylesheets and must be in the
     table, so that a feature that is only ever written there cannot arrive unclassified. And a property or a function that a row says is newer than the floor, in a
     string that looks like a style or in an assignment to element.style, is found, unless the row says it is read as an older spelling there (the image figure's
     ratio in the Memorizer is exempt in the one function that sets it, by its name: file#function in the row). What is not read: CSS that a function builds from data
     (the Memorizer's look sheet, memorizer/src/appearance.js css()), a style assembled from variables entirely, and the standalone demo pages (demo/), which are opened
     in Safari on their own and are not the app (they write inset, aspect-ratio and :focus-visible with no fallback). */
  const T = C.loadTable();
  const above = Object.entries(T.above).filter(([k, r]) => (k.startsWith('property ') || k.startsWith('function ')) && r.class !== 'inert');
  const names = above.map(([k]) => k.split(' ')[1]);
  const camel = n => n.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const makeFound = above => (text) => {
    const out = [];
    for (const [k, r] of above) {
      const n = k.split(' ')[1];
      const styled = k.startsWith('property ')
        ? new RegExp('(?:style\\s*=\\s*["\'`][^"\'`]*|cssText\\s*[+]?=\\s*["\'`][^"\'`]*|["\'`;{]\\s*)(?<![\\w-])' + n + '\\s*:|\\.style\\.' + camel(n) + '\\b|setProperty\\(\\s*["\']' + n + '["\']').test(text)
        : new RegExp('(?:style\\s*=\\s*["\'`][^"\'`]*|cssText\\s*[+]?=\\s*["\'`][^"\'`]*)[:\\s,(]' + n + '\\(').test(text);
      if (styled) out.push(k);
    }
    return out;
  };
  const found = makeFound(above);
  ok('the reader finds a newer property in a style attribute, a cssText string and an assignment, and a newer function in a style', found('<div style="inset:0;color:red">').includes('property inset') && found("box.style.cssText = 'position:fixed;inset:0;z-index:1'").includes('property inset') &&
     found('el.style.aspectRatio = "1 / 1"').includes('property aspect-ratio') && found("el.style.setProperty('aspect-ratio', '1')").includes('property aspect-ratio') && found('<i style="background:color-mix(in srgb,red 10%,blue)">').includes('function color-mix'), names.join(' '));
  ok('and nothing in a clip-path inset() shape, a class name or a comment', !found('<i style="clip-path:inset(0 4% 0 0 round 5px)">').length && !found('<i class="inset aspect-ratio">').length && !found('// inset: 0 is the same').length);
  /* The span of `function name(...) {...}` in a script (comments blanked): from the word to its closing brace, strings stepped over. */
  const functionSpan = (t, name) => {
    const m = new RegExp('(?<![\\w$])function\\s+' + name + '\\s*\\(').exec(t);
    const open = m ? t.indexOf('{', m.index) : -1;
    if (open < 0) return null;
    for (let k = open, depth = 0; k < t.length; k++) {
      const c = t[k];
      if (c === '"' || c === "'" || c === '`') { for (k++; k < t.length && t[k] !== c; k++) if (t[k] === '\\') k++; continue; }
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return [m.index, k + 1];
    }
    return null;
  };
  /* What the scripts and pages set that the table says is newer than the floor, except in the function a row exempts (file#function, so that a second
     use in the same file is found), and the exemptions that excuse nothing: a function that is not there, or does not use the feature, or a file that is
     not read, or a file where a function is meant. */
  const scriptProblems = (sources, above, found) => {
    const hits = [], stale = [], seen = new Set(), rests = {};
    for (const { rel, text } of sources) {
      let rest = text;
      for (const [k, r] of above) for (const e of Object.keys(r.exempt || {})) {
        const [file, fn] = e.split('#');
        if (!fn || file !== rel) continue;
        seen.add(k + ' ' + e);
        const span = functionSpan(rest, fn);
        if (!span) { stale.push(`${e}: no function by that name`); continue; }
        const inside = rest.slice(span[0], span[1]);
        if (!found(inside).includes(k)) stale.push(`${e}: the function does not set ${k}`);
        rest = rest.slice(0, span[0]) + inside.replace(/[^\n]/g, ' ') + rest.slice(span[1]);
      }
      for (const k of found(rest)) hits.push(`${rel}: ${k}`);
      rests[rel] = rest;
    }
    for (const [k, r] of above) for (const e of Object.keys(r.exempt || {})) {
      if (e.includes('#')) { if (!seen.has(k + ' ' + e)) stale.push(`${e}: no such file is read`); }
      else if (/\.(?:js|html)$/.test(e)) stale.push(`${e}: a file is not an exemption, name the function (file#function)`);
    }
    return { hits, stale, rests };
  };
  {
    const AR = { 'property aspect-ratio': { class: 'fallback', exempt: { 'a.js#paint': 'x' } } };
    const sp = (text, exempt) => scriptProblems([{ rel: 'a.js', text }], Object.entries(exempt === undefined ? AR : exempt), makeFound(Object.entries(exempt === undefined ? AR : exempt)));
    const USE = "function paint(el) { el.style.aspectRatio = '1 / 1'; el.onload = function () { el.style.aspectRatio = ''; }; }\n";
    const bad = sp(USE + "function other(el) { el.style.aspectRatio = '2 / 1'; }");
    const stale1 = sp("function other(el) { el.style.aspectRatio = '2 / 1'; }"), stale2 = sp("function paint(el) { el.title = '{'; }");
    const file = sp(USE, { 'property aspect-ratio': { class: 'fallback', exempt: { 'a.js': 'x' } } }), gone = sp(USE, { 'property aspect-ratio': { class: 'fallback', exempt: { 'b.js#paint': 'x' } } });
    ok('a script that sets a newer property is excused in the function its row names and only there', sp(USE).hits.length === 0 && sp(USE).stale.length === 0 && bad.hits.length === 1 && bad.stale.length === 0 && stale1.hits.length === 1,
       `${JSON.stringify(sp(USE))} ${JSON.stringify(bad)}`);
    ok('and an exemption that excuses nothing is found: a function that is not there, one that does not set it, a file where a function is meant, a file that is not read', stale1.stale.length === 1 && stale2.stale.length === 1 && file.stale.length === 1 && gone.stale.length === 1,
       [stale1, stale2, file, gone].map(r => r.stale.join(';')).join(' | '));
    const braced = sp("function paint(el) { el.title = '}'; el.style.aspectRatio = '1'; }"), braced2 = sp("function paint(el) { el.title = '}'; el.style.aspectRatio = '1'; }\nfunction other(el) { el.style.aspectRatio = '2'; }");
    ok('the function ends at its own closing brace, whatever a string in it holds', braced.hits.length === 0 && braced.stale.length === 0 && braced2.hits.length === 1 && braced2.stale.length === 0, JSON.stringify(braced));
  }
  const SRC = C.scriptFiles();
  const sources = SRC.map(rel => ({ rel, text: blankComments(C.readFile(rel)) }));
  const real = scriptProblems(sources, above, found);
  ok('no script or markup that Safari reads sets a property or calls a function the table says is newer than the floor, except in the function its row names', real.hits.length === 0, list0(real.hits) || `${sources.length} files, ${names.length} names`);
  ok('and every exemption of a script names a function that is there and sets the feature', real.stale.length === 0, list0(real.stale) || 'each is used');
  const IN = text => C.inlineUses(text, null).map(u => u.key);
  ok('the inline reader finds a property in a style attribute, a cssText string, a helper\'s style:, setAttribute, an assignment, setProperty and a custom property, and a function of a plain value', IN('<div style="inset:0;color:red">').join() === 'property inset,property color' &&
     IN("box.style.cssText = 'position:fixed;inset:0;z-index:1'").join() === 'property position,property inset,property z-index' && IN('el.style.aspectRatio = "1 / 1"; el.style.cssFloat = "left"').join() === 'property aspect-ratio,property float' &&
     IN("h('div', { style: 'container-type:inline-size' })").join() === 'property container-type' && IN("el.setAttribute('style', 'container-type:inline-size')").join() === 'property container-type' &&
     IN("el.style.setProperty('aspect-ratio', '1'); el.style.setProperty('--x', '1')").join() === 'property aspect-ratio,property --*' && IN('<i style="background:color-mix(in srgb,red,blue)">').join() === 'property background,function color-mix');
  ok('and it finds what the stylesheet reader finds in a value: a unit, a function with its units, a color', IN('<div style="height:100dvh">').join() === 'property height,unit dvh' && IN('<i style="width:min(88vw,1100px)">').join() === 'property width,function min,unit vw,unit px' &&
     IN('<i style="color:#1234abcd">').join() === 'property color,color hex-alpha');
  ok('and a <style> block of a page, with the assembler\'s slots taken out, and a style element that a script fills with literals, are read as stylesheets', IN('<style>.x{container-type:inline-size}</style>').join() === 'property container-type' &&
     IN('<style>@@SLOT[app:app/css/a.css]@@ .y{color:red}</style>').join() === 'property color' && IN("var st = document.createElement('style'); st.textContent = '.a{width:' + w + 'px}' + '@keyframes k{from{opacity:0}}';").join() === 'property width,unit px,atrule @keyframes,property opacity' &&
     IN("var st = document.createElement('style'); st.textContent = css(look);").length === 0);
  ok('and a value assigned through element.style or setProperty is read like any other: a function, a unit, a number that script makes, a pair of alternatives', IN("el.style.background = 'color-mix(in srgb, red, blue)'").join() === 'property background,function color-mix' &&
     IN("el.style.height = '100dvh'").join() === 'property height,unit dvh' && IN("el.style.setProperty('height', '100dvh')").join() === 'property height,unit dvh' && IN('el.style.width = Math.round(w) + "px"').join() === 'property width,unit px' &&
     IN("el.style.transform = 'translate(' + x + 'px,' + y + 'px)'").join() === 'property transform,function translate,unit px,unit px' && IN("el.style.display = on ? 'none' : 'block'").join() === 'property display');
  ok('and a statement ends where it ends: at its ;, at a line end the expression does not go on past, and a name is not run into what follows it', IN("a.style.display=open?'none':'flex'; b.style.width='5px'").join() === 'property display,property width,unit px' &&
     IN("a.style.width = '10px'\nb.style.height = '5em'\n").join() === 'property width,unit px,property height,unit em' && IN("a.style.background =\n  'rgba(' + r + ',' + g + ')' +\n  'x';").join() === 'property background,function rgba');
  ok('and an expression of several literals is read whole: a cssText joined over lines, a style: with more after it that is not its own, a setAttribute that script finishes', IN("t.style.cssText='position:fixed;left:50%;'+\n 'background:#111;border-radius:11px;'+\n 'inset:0';").join() === 'property position,property left,unit %,property background,property border-radius,unit px,property inset' &&
     IN("h('div', { style: 'width:1px', title: '5em' })").join() === 'property width,unit px' && IN("h('div', { style: 'width:' + w + 'px;inset:0', class: 'x' })").join() === 'property width,unit px,property inset' && IN("el.setAttribute('style', 'height:100dvh;' + extra)").join() === 'property height,unit dvh');
  ok('and Object.assign(el.style, {...}), a bracket assignment and insertRule are read', IN("Object.assign(el.style, { background: 'color-mix(in srgb, red, blue)', borderRadius: r + 'px', 'z-index': 3 })").join() === 'property background,function color-mix,property border-radius,unit px,property z-index' &&
     IN("el.style['container-type'] = 'inline-size'").join() === 'property container-type' && IN("sheet.insertRule('.a{container-type:inline-size}', 0)").join() === 'property container-type');
  ok('and nothing in a class name, a comment, a comparison, a read, a style: that is not a declaration, a text that is not a style element\'s, or script putting a value together', !IN('<i class="inset aspect-ratio">').length && !IN('// style="inset:0"').length && !IN('if (el.style.display === "none") {}').length &&
     !IN('var w = el.style.width;').length && !IN("var o = { style: 'solid' };").length && !IN("var el = document.createElement('div'); el.textContent = '.a{inset:0}';").length &&
     IN("'<i style=\"width:' + Math.round(w) + 'px\">'").join() === 'property width' && IN('<i style="clip-path:inset(0 ${(100 - x).toFixed(2)}% 0 0 round 5px)">').join() === 'property clip-path,function inset,unit %,unit px' &&
     IN('<i style="background:${col}1F;color:${col}">').join() === 'property background,property color');
  ok('and a line is the line it is on', C.inlineUses('a\nb\n<i style="color:red">', null).map(u => u.line).join() === '3' && C.inlineUses('a\n<style>\n.x{color:red}\n</style>', null).map(u => u.line).join() === '3');

  /* inline CSS goes through the same classification as a stylesheet: each piece is a pseudo-file, and analyse() sorts what is in it */
  const inlineFiles = [];
  for (const { rel } of sources) for (const seg of C.inlineSegments(real.rests[rel])) inlineFiles.push(parseFile(rel, seg.css, T));
  const generated = C.generatedSheets();                  // a stylesheet a script builds from data is read as the script makes it
  for (const g of generated) inlineFiles.push(parseFile(g.file, g.css, T));
  const resIn = analyse(inlineFiles, T);
  const inlineBad = [...[...resIn.unlisted].map(([k, w]) => `${w} ${k} is not in the table`), ...Object.values(resIn.rows).flat(), ...resIn.newerInside, ...resIn.stray, ...resIn.prefix];
  ok('everything the scripts and pages write inline is in the table, so a feature that is only ever written there cannot arrive unclassified (node scripts/css-floor-table.js says how to add a row)', resIn.unlisted.size === 0 && inlineFiles.length > 0, list0([...resIn.unlisted].map(([k, w]) => `${w} ${k}`)) || `${inlineFiles.length} pieces`);
  ok('and what is newer than the floor in it has what its row says it needs, which an attribute cannot give an @supports rule to (an older value written first is all it can have)', inlineBad.length === 0, list0(inlineBad) || 'none');
  const reads = rel => new Set(inlineFiles.filter(f => f.file === rel).flatMap(f => f.uses.map(u => u.key)));
  ok('and the pieces the pages make are read: the shell\'s <style> block (@font-face), the style element its script fills (@keyframes, min()), the page builder\'s overlay, the Memorizer\'s scripts', reads('app/systole.html').has('atrule @font-face') && reads('app/systole.html').has('atrule @keyframes') &&
     reads('app/systole.html').has('function min') && reads('app/systole.html').has('descriptor @font-face font-display') && reads('scripts/build-pwa.js').has('property z-index') && reads('memorizer/src/ui.js').has('property width'), `${inlineFiles.length} pieces in ${new Set(inlineFiles.map(f => f.file)).size} files`);
  ok('and the stylesheets that scripts build from data are read as built: the Memorizer\'s look sheet has its themes (:root blocks), its dark scheme (@media) and its custom properties', generated.length > 0 && generated.every(g => g.css.length > 500) && reads('memorizer/src/appearance.js').has('atrule @media') &&
     reads('memorizer/src/appearance.js').has('property --*') && generated.some(g => /:root\[data-look="auto"\]/.test(g.css)), generated.map(g => `${g.file} ${g.css.length} chars`).join(', '));
  ok('and the scripts and pages read are the ones the app ships: the shell, the builder, both other pages and the sources of all three', ['app/systole.html', 'scripts/build-pwa.js', 'memorizer/index.html', 'lab/index.html'].every(f => SRC.includes(f)) &&
     ['src/', 'memorizer/src/', 'lab/src/'].every(d => SRC.some(f => f.startsWith(d))) && sources.every(x => x.text.length > 0), `${SRC.length} files`);
  function list0(a) { return a.slice(0, 4).join(' | '); }
}

head('and the README says what the table says');
{
  const T = C.loadTable();
  const readme = fs.readFileSync(path.join(C.ROOT, 'README.md'), 'utf8');
  ok('it points at the table and at the guard, and the gap on a flex box is named with the version that reads it', readme.includes('tests/css-floor-table.json') && readme.includes('tests/verify-floor-css-pure.js') && new RegExp('flex[^.]*' + T.above['layout flex-gap'].since.replace('.', '\\.')).test(readme.replace(/\s+/g, ' ')));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
