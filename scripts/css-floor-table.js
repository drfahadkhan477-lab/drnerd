#!/usr/bin/env node
'use strict';
/*
 * tests/css-floor-table.json: every CSS feature the shipped stylesheets use, and the scripts and pages write inline (a style attribute, cssText, el.style.x), with the first iOS Safari that reads it.
 *
 *   node scripts/css-floor-table.js --bcd <the @mdn/browser-compat-data package> [--write]
 *
 * The versions are MDN's (support.safari_ios, which is the Safari an iPad runs). The package is not a dependency of this repository, on
 * purpose: the table is committed, tests/verify-floor-css-pure.js holds the stylesheets to it with nothing installed, and this is what a person
 * runs, with a copy of the package from wherever they have one (`npm install --prefix /tmp/bcd @mdn/browser-compat-data`), when the guard says
 * a feature is not in the table. It reads the stylesheets with tests/_cssfloor.js, the reader the guard reads them with.
 *
 * WHAT IT WRITES. "ok" lists, by kind, what the floor (the table's "floor") reads; "prefixed" what it reads only behind -webkit-; "above" what
 * it does not read, with the first Safari that does. What the stylesheets DO about a row in "above" is a decision, made by a person, so that
 * part is read back from the table as it stands: class, how, note, probe, exempt. A feature that is new gets class "TODO", which the guard
 * refuses until someone says what the stylesheets do about it. "watch" is the keywords of a property that arrived after the floor, for every
 * property in use: a use of one is a use of a feature the table has to have a row for, which is how a newer value of an old property is seen.
 *
 * Without --write it says whether the file is what it would write, and exits 1 if it is not.
 */
const fs = require('fs');
const path = require('path');
const C = require('../tests/_cssfloor.js');

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf('--' + name); return i < 0 ? null : args[i + 1]; };
const bcdDir = opt('bcd');
if (!bcdDir) { console.error('usage: node scripts/css-floor-table.js --bcd <@mdn/browser-compat-data> [--write]'); process.exit(2); }
const bcd = require(path.resolve(bcdDir));
const bcdVersion = JSON.parse(fs.readFileSync(path.join(path.resolve(bcdDir), 'package.json'), 'utf8')).version;
const existing = fs.existsSync(C.TABLE_PATH) ? C.loadTable() : { floor: '13.4', above: {}, prefixed: {}, ok: {}, watch: {} };
const FLOOR = opt('floor') || existing.floor;

const at = p => p.reduce((o, k) => (o ? o[k] : null), bcd);
const index = {};                                         // every name under css.*, lower-cased, to the paths it is at
(function walk(node, parts) {
  for (const k of Object.keys(node)) {
    if (k === '__compat') continue;
    (index[k.toLowerCase()] = index[k.toLowerCase()] || []).push(parts.concat(k));
    walk(node[k], parts.concat(k));
  }
})(bcd.css, ['css']);

/* The names MDN files under another one, or not at all. A value here says where to look; a version says what it is (px has no entry: every
   engine has it). Each is a fact about CSS, written once, with where it comes from. */
const ALIASES = {
  'property custom-property': ['css', 'properties', 'custom-property'],
  'property --*': ['css', 'properties', 'custom-property'],
  'function var': ['css', 'types', 'var'],
  'function rgba': ['css', 'types', 'color', 'rgb'], 'function hsla': ['css', 'types', 'color', 'hsl'],
  'function repeat': ['css', 'properties', 'grid-template-columns', 'repeat'], 'function minmax': ['css', 'properties', 'grid-template-columns', 'minmax'],
  'unit %': ['css', 'types', 'percentage'],
  'unit s': ['css', 'types', 'time'], 'unit ms': ['css', 'types', 'time'],
  'unit deg': ['css', 'types', 'angle'], 'unit turn': ['css', 'types', 'angle'], 'unit rad': ['css', 'types', 'angle'],
  'unit fr': ['css', 'types', 'flex'],
  'unit dvh': ['css', 'types', 'length', 'viewport_percentage_units_dynamic'], 'unit dvw': ['css', 'types', 'length', 'viewport_percentage_units_dynamic'],
  'unit svh': ['css', 'types', 'length', 'viewport_percentage_units_small'], 'unit lvh': ['css', 'types', 'length', 'viewport_percentage_units_large'],
  'function rect': ['css', 'properties', 'clip'],           // clip: rect(), which every Safari has; BCD's other rect() is the basic shape of 17.2
  'layout flex-gap': ['css', 'properties', 'gap', 'flex_context'],
  'color hex-alpha': ['css', 'types', 'color', 'hex_rgba'],
  'color space-separated': ['css', 'types', 'color', 'rgb', 'space_separated_parameters'],
  'media range-syntax': ['css', 'at-rules', 'media', 'range_syntax'],
  'media not-or': ['css', 'at-rules', 'media', 'logical_operators'],
  'supports selector()': ['css', 'at-rules', 'supports', 'selector'],
};
const KNOWN = { 'unit px': '1', 'property word-wrap': '3.2', 'unit pt': '1', 'unit cm': '1', 'unit mm': '1' };
/* Safari's own names: where BCD has nothing under a -webkit- name, the engine that spells it is the engine that reads it. */
const isWebkit = name => /^(::?)?-webkit-/.test(name);

function resolve(use) {
  const strip = n => n.replace(/^-webkit-|^-moz-|^-ms-/, '');
  const pick = cs => { for (const c of cs) { const n = at(c); if (n && n.__compat) return n; } return null; };
  if (ALIASES[use.key]) return pick([ALIASES[use.key]]);
  switch (use.kind) {
    case 'property': return pick([['css', 'properties', use.name], ['css', 'properties', strip(use.name)]]);
    case 'function': { const ts = (index[use.name] || []).filter(p => p[1] === 'types'); return ts.length ? pick([ts.sort((a, b) => a.length - b.length)[0]]) : null; }
    case 'unit': { const ts = (index[use.name] || []).filter(p => p[1] === 'types' && p[2] === 'length'); return ts.length ? pick([ts[0]]) : null; }
    case 'selector': { const n = use.name.replace(/^::?/, ''); return pick([['css', 'selectors', n], ['css', 'selectors', strip(n)]]); }
    case 'atrule': return pick([['css', 'at-rules', use.name.slice(1)]]);
    case 'media': return pick([['css', 'at-rules', 'media', use.name]]);
    case 'value': { const [prop, kw] = use.name.split(': '); return pick([['css', 'properties', prop, kw]]); }
  }
  return null;
}

/* the keywords of a property, from BCD, that arrived after the floor (or never): one level, the ones that are words */
function watchOf(prop) {
  const node = at(['css', 'properties', prop]);
  const out = {};
  if (!node) return out;
  for (const k of Object.keys(node)) {
    if (k === '__compat' || !/^[a-z][a-z-]*$/.test(k) || !node[k].__compat) continue;
    const s = C.supportAt(node[k], FLOOR);
    if (s.state !== 'yes' && s.state !== 'partial') out[k] = s.since;
  }
  return out;
}

/* ── read ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const firstPass = [];
for (const fam of C.families()) for (const f of fam.files) firstPass.push(...C.usesOf(C.parseCss(C.readFile(f)).root, null));
const inlineOf = watch => {                              // what scripts and pages write inline (style attributes, cssText, el.style.x, <style> blocks): the same Safari reads it
  const out = [];
  for (const f of C.scriptFiles()) for (const u of C.inlineUses(C.readFile(f), watch)) out.push(Object.assign(u, { node: { line: f + ':' + u.line } }));
  return out;
};
firstPass.push(...inlineOf(null));
const props = [...new Set(firstPass.filter(u => u.kind === 'property' && u.name !== '--*' && !isWebkit(u.name)).map(u => u.name))].sort();
const watch = {};
for (const p of props) {
  if (p === 'cursor' || p === 'resize') continue;         // iOS has no pointer to show a cursor on and no corner to resize from: every keyword is "no" there, and means nothing
  const w = watchOf(p);
  if (Object.keys(w).length) watch[p] = w;
}
const uses = [];
for (const fam of C.families()) for (const f of fam.files) uses.push(...C.usesOf(C.parseCss(C.readFile(f)).root, watch));
uses.push(...inlineOf(watch));
const keys = new Map();
for (const u of uses) if (!keys.has(u.key)) keys.set(u.key, u);

const ok = {}, prefixed = {}, above = {}, unresolved = [];
for (const [key, u] of [...keys].sort((a, b) => a[0].localeCompare(b[0]))) {
  let s;
  if (KNOWN[key]) s = { state: 'yes', since: KNOWN[key] };
  else {
    const node = resolve(u);
    s = node ? C.supportAt(node, FLOOR) : { state: 'nodata', since: null };
    if (s.state === 'nodata') {
      if (isWebkit(u.name)) s = { state: 'yes', since: null };
      else { unresolved.push(key + '  (' + u.node.line + ')'); continue; }
    }
  }
  if (s.state === 'yes' || s.state === 'partial') (ok[u.kind] = ok[u.kind] || []).push(u.name);
  else if (s.state === 'prefix') prefixed[key] = { since: s.since, prefixedSince: s.prefixedSince };
  else {
    const kept = Object.assign({}, existing.above[key] || { class: 'TODO' });  // what a person decided is kept, and only the version is the data's
    delete kept.since;
    above[key] = Object.assign({ since: s.since }, kept);
  }
}
/* A feature the stylesheets no longer use, and may not use again, stays: that is what "banned" says. */
for (const [k, row] of Object.entries(existing.above)) if (row.class === 'banned' && !above[k]) above[k] = row;
for (const k of Object.keys(ok)) ok[k].sort();

const sorted = o => Object.fromEntries(Object.entries(o).sort((a, b) => a[0].localeCompare(b[0])));
const out = { floor: FLOOR, source: '@mdn/browser-compat-data ' + bcdVersion + ', support.safari_ios', ok, prefixed, above: sorted(above), watch };
const text = JSON.stringify(out, null, 2) + '\n';
if (unresolved.length) { console.error('not in the data, and not a -webkit- name (add it to ALIASES or KNOWN, with where it comes from):\n  ' + unresolved.join('\n  ')); process.exit(1); }

const todo = Object.keys(above).filter(k => above[k].class === 'TODO');
if (args.includes('--write')) {
  fs.writeFileSync(C.TABLE_PATH, text);
  console.log(`wrote ${path.relative(C.ROOT, C.TABLE_PATH)}: ${Object.values(ok).reduce((n, a) => n + a.length, 0)} ok, ${Object.keys(prefixed).length} prefixed, ${Object.keys(above).length} above the floor (${FLOOR})`);
  if (todo.length) console.log('unclassified, for a person to say what the stylesheets do about each:\n  ' + todo.join('\n  '));
} else {
  const same = fs.existsSync(C.TABLE_PATH) && fs.readFileSync(C.TABLE_PATH, 'utf8') === text;
  console.log(same ? 'tests/css-floor-table.json is what the stylesheets and the data say' : 'tests/css-floor-table.json differs: run with --write');
  process.exit(same ? 0 : 1);
}
