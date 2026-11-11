#!/usr/bin/env node
/*
 * The dependency map of the shell's script: docs/SHELL-MAP.md is this file's output.
 *
 *   node tools/shell-map.js            what the map holds now, and whether docs/SHELL-MAP.md is current
 *   node tools/shell-map.js --write    write docs/SHELL-MAP.md
 *   node tools/shell-map.js --check    exit 1 when docs/SHELL-MAP.md is not what --write would write
 *   node tools/shell-map.js --why NAME one entry in full: every reference it makes, with the shell's line
 *   node tools/shell-map.js --json     the analysis as JSON
 *
 * WHY. The app's logic is one inline script in app/systole.html, and a function
 * there can read or write any of several hundred script-level names. Moving it
 * out (docs/ROADMAP.md, E1) starts with knowing what each function touches,
 * which no one can hold in their head for five hundred functions. This reads
 * the script with a real parser and writes that down.
 *
 * WHAT IT DOES. It takes the shell's application script, puts a marker where
 * each build slot stands (scripts/app-slots.js), and parses it. Every
 * statement at the script's top level is an item: a function, a class, a
 * declared name, or a statement that runs as the script loads. For each item
 * it finds the names used that the item does not itself declare (proper
 * scoping: parameters, var hoisting, block scope, catch, class and function
 * names), and says of each use whether it reads the name, rebinds it, changes
 * something inside it, or calls it. Names are then placed: the shell's own,
 * a src/ module's (each slot's file is parsed too, for what it defines and
 * what it uses), the browser's, the language's. What a function reaches
 * through the shell functions it calls is worked out to a fixed point.
 *
 * THE PARSER is acorn, which Node carries for its own use. A copy installed
 * as a package is used if there is one; otherwise this re-runs itself with
 * --expose-internals and takes Node's. Measured on Node 22 and 24. It is not
 * a dependency of the app, the build or any suite.
 *
 * IT CHECKS ITSELF BEFORE IT WRITES. selfTest() runs the analysis over a
 * small script whose every answer is known (a read, a rebind, a change through
 * a member, a change through a local name for one, a shadowed name, a call
 * made as the script loads, a handler named in markup) and refuses to write a
 * map if any answer is wrong. It runs on every invocation.
 *
 * WHAT IT CANNOT SEE is written into the map itself (LIMITS below), because
 * the reader of the map is the one who needs it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SHELL = 'app/systole.html';
const OUT = 'docs/SHELL-MAP.md';

function loadParser() {
  try { return require('acorn'); } catch (_) {}
  try { return require('internal/deps/acorn/acorn/dist/acorn'); } catch (_) {}
  return null;
}
const acorn = loadParser();
if (!acorn && require.main === module) {
  if (process.execArgv.includes('--expose-internals')) {
    console.error('shell-map: this Node has no acorn to lend, and none is installed. `npm i --no-save acorn` and run again.');
    process.exit(2);
  }
  const r = require('child_process').spawnSync(process.execPath, ['--expose-internals', __filename, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status === null ? 2 : r.status);
}

/* ── names that are not the app's ───────────────────────────────────────────
   The language's own are left out of the map: using Math or JSON is not a
   dependency. Date and the timers are kept, as `clock`, because a function
   that reads the time cannot be tested without one. */
const LANGUAGE = new Set(('Object Array Math JSON Promise Set Map WeakMap WeakSet Symbol Number String Boolean Error TypeError RangeError ' +
  'SyntaxError ReferenceError EvalError URIError RegExp Function parseInt parseFloat isNaN isFinite Infinity NaN undefined encodeURIComponent ' +
  'decodeURIComponent encodeURI decodeURI escape unescape Uint8Array Uint8ClampedArray Uint16Array Uint32Array Int8Array Int16Array Int32Array ' +
  'Float32Array Float64Array ArrayBuffer DataView Intl Reflect Proxy BigInt globalThis console arguments eval').split(' '));
const BROWSER = {
  DOM: ('document window self top parent navigator location history screen visualViewport getComputedStyle matchMedia requestAnimationFrame ' +
    'cancelAnimationFrame requestIdleCallback cancelIdleCallback Image Audio AudioContext webkitAudioContext OfflineAudioContext MutationObserver ' +
    'IntersectionObserver ResizeObserver Event CustomEvent KeyboardEvent PointerEvent MouseEvent TouchEvent HTMLElement HTMLCanvasElement ' +
    'HTMLImageElement Element Node DOMParser speechSynthesis SpeechSynthesisUtterance alert confirm prompt scrollTo scrollBy innerWidth innerHeight ' +
    'devicePixelRatio CSS getSelection FileReader Blob File DOMException URL URLSearchParams TextEncoder TextDecoder AbortController ' +
    'structuredClone atob btoa open close focus print WebGLRenderingContext WebGL2RenderingContext OffscreenCanvas createImageBitmap ' +
    'DecompressionStream CompressionStream ReadableStream Worker MessageChannel BroadcastChannel SpeechRecognition webkitSpeechRecognition').split(' '),
  storage: 'localStorage sessionStorage indexedDB caches'.split(' '),
  net: 'fetch XMLHttpRequest WebSocket EventSource Request Response Headers'.split(' '),
  clock: 'Date performance setTimeout setInterval clearTimeout clearInterval queueMicrotask crypto'.split(' '),
};
const BROWSER_OF = new Map();
for (const [cat, names] of Object.entries(BROWSER)) for (const n of names) BROWSER_OF.set(n, cat);
/* A member that changes its category: navigator.storage is storage, Math.random is not arithmetic. */
const MEMBER_CAT = { 'navigator.storage': 'storage', 'navigator.serviceWorker': 'storage', 'navigator.sendBeacon': 'net', 'Math.random': 'clock' };

/* Methods that change the thing they are called on. */
const MUTATORS = new Set('push pop shift unshift splice sort reverse fill copyWithin add delete clear set'.split(' '));
/* Methods of the language's own values. A call of any other method on a value the script holds in state (an avatar, a
   viewer, a canvas) is a call into something this cannot follow. */
const PLAIN_METHODS = new Set(('has get keys values entries forEach map filter find findIndex findLast some every includes indexOf lastIndexOf ' +
  'slice concat join reduce reduceRight flat flatMap at toString trim split replace match matchAll test exec startsWith endsWith padStart padEnd ' +
  'toFixed hasOwnProperty localeCompare charAt charCodeAt toLowerCase toUpperCase substring substr repeat normalize call apply bind then catch finally').split(' '));
/* Methods that hand back the thing's own elements, so a name bound to the result is a name for part of the thing. */
const ELEMENT_METHODS = new Set('find findLast at get filter slice'.split(' '));
/* Methods whose callback is given the thing's elements one at a time. */
const EACH_METHODS = new Set('forEach map filter find findIndex some every flatMap'.split(' '));
/* A function handed to one of these runs later, never while the script is still loading. */
const LATER = new Set('addEventListener setTimeout setInterval requestAnimationFrame requestIdleCallback then catch finally queueMicrotask'.split(' '));
const LATER_NEW = new Set('MutationObserver IntersectionObserver ResizeObserver Promise'.split(' '));

const isFn = n => !!n && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression');
const SKIP_KEYS = new Set(['type', 'start', 'end', 'loc', 'range']);
function children(node, fn) {
  for (const k of Object.keys(node)) {
    if (SKIP_KEYS.has(k)) continue;
    const v = node[k];
    if (Array.isArray(v)) { for (const x of v) if (x && typeof x.type === 'string') fn(x, k); }
    else if (v && typeof v.type === 'string') fn(v, k);
  }
}
function patternNames(p, out = []) {
  if (!p) return out;
  if (p.type === 'Identifier') out.push(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach(q => patternNames(q.type === 'RestElement' ? q.argument : q.value, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach(q => patternNames(q, out));
  else if (p.type === 'RestElement') patternNames(p.argument, out);
  else if (p.type === 'AssignmentPattern') patternNames(p.left, out);
  return out;
}
/* Every `var` (and nested function declaration) of a function body, without entering the functions inside it. */
function hoisted(node, out) {
  if (!node || isFn(node) || node.type === 'ClassBody') return;
  if (node.type === 'VariableDeclaration' && node.kind === 'var') node.declarations.forEach(d => patternNames(d.id, out));
  children(node, c => { if (c.type === 'FunctionDeclaration') { if (c.id) out.push(c.id.name); } else hoisted(c, out); });
}
/* let, const, class and function declared directly in a list of statements. */
function lexical(statements) {
  const out = [];
  for (const s of statements || []) {
    if (!s) continue;
    if (s.type === 'VariableDeclaration' && s.kind !== 'var') s.declarations.forEach(d => patternNames(d.id, out));
    else if ((s.type === 'ClassDeclaration' || s.type === 'FunctionDeclaration') && s.id) out.push(s.id.name);
  }
  return out;
}
/* a.b[c].d → { root: the node at the bottom, props: ['b', null, 'd'], members: the MemberExpression nodes } */
function chainOf(node) {
  const props = [], members = [];
  let n = node;
  for (;;) {
    if (n.type === 'ChainExpression') n = n.expression;
    else if (n.type === 'MemberExpression') {
      members.unshift(n);
      props.unshift(n.computed ? (n.property.type === 'Literal' && typeof n.property.value === 'string' ? n.property.value : null) : n.property.name);
      n = n.object;
    } else break;
  }
  return { root: n, props, members };
}
const HANDLER_RE = /\bon[a-z]+\s*=\s*(["'])([\s\S]*?)(?:\1|$)/g;
function handlersIn(text) {
  const out = [];
  if (!text || text.indexOf('on') < 0) return out;
  let m;
  HANDLER_RE.lastIndex = 0;
  while ((m = HANDLER_RE.exec(text))) for (const c of m[2].matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) out.push(c[1]);
  return out;
}

/* ── one item's free names ──────────────────────────────────────────────────
   refs(node, { later }) → [{ name, kind, prop, call, line, later, alias, wire }]
   kind:  r  the name's value is read          w  the name is rebound (=, ++, a destructuring target)
          m  something inside it is changed    c  it is called (or handed on as a value, when it is a function)
   prop:  the first property reached through it (S.srs → 'srs'; a computed one is '[…]')
   call:  for a call through a member, the path called (FSRS.update)
   later: the use stands inside a function that does not run when the item itself runs
   alias: the change was made through a local name bound to part of it
   wire:  the name was written into markup as an inline handler */
function refsOf(node, opts = {}) {
  const out = [];
  const mk = (names, parent, fn) => ({ names: new Map(names.map(n => [n, {}])), parent, fn });
  const lookup = (name, scope) => { for (let s = scope; s; s = s.parent) if (s.names.has(name)) return s.names.get(name); return null; };
  const line = n => (n.loc ? n.loc.start.line : 0);
  const emit = (id, kind, later, extra) => out.push(Object.assign({ name: id.name, kind, line: line(id), later }, extra));

  function aliasOf(e, scope) {
    if (!e) return null;
    switch (e.type) {
      case 'ChainExpression': return aliasOf(e.expression, scope);
      case 'Identifier': { const b = lookup(e.name, scope); return b ? (b.alias || null) : { root: e.name }; }
      case 'MemberExpression': {
        const c = chainOf(e);
        if (c.root.type === 'CallExpression') return aliasOf(c.root, scope);
        if (c.root.type !== 'Identifier') return null;
        const b = lookup(c.root.name, scope);
        if (b) return b.alias ? { root: b.alias.root, prop: b.alias.prop !== undefined ? b.alias.prop : propName(c.props[0]) } : null;
        return { root: c.root.name, prop: propName(c.props[0]) };
      }
      case 'LogicalExpression': return aliasOf(e.left, scope) || aliasOf(e.right, scope);
      case 'ConditionalExpression': return aliasOf(e.consequent, scope) || aliasOf(e.alternate, scope);
      case 'AssignmentExpression': return aliasOf(e.left, scope) || aliasOf(e.right, scope);
      case 'CallExpression': {
        const cal = e.callee.type === 'ChainExpression' ? e.callee.expression : e.callee;
        if (cal.type === 'MemberExpression' && !cal.computed && ELEMENT_METHODS.has(cal.property.name)) return aliasOf(cal.object, scope);
        return null;
      }
    }
    return null;
  }
  const propName = p => (p === undefined ? undefined : p === null ? '[…]' : p);

  /* A use of a member chain. mode: r | m | call */
  function member(node, scope, later, mode) {
    const c = chainOf(node);
    for (const m of c.members) if (m.computed) visit(m.property, scope, later);
    if (c.root.type !== 'Identifier') { visit(c.root, scope, later); return; }
    const b = lookup(c.root.name, scope);
    const last = c.props[c.props.length - 1];
    const changes = mode === 'm' || (mode === 'call' && MUTATORS.has(last) && c.root.name !== 'document');
    if (b) {
      if (changes && b.alias) out.push({ name: b.alias.root, kind: 'm', line: line(c.root), later, prop: b.alias.prop !== undefined ? b.alias.prop : (c.props.length > (mode === 'call' ? 1 : 0) ? propName(c.props[0]) : undefined), alias: true });
      return;
    }
    const extra = { prop: propName(c.props[0]) };
    if (mode === 'call') extra.call = c.root.name + '.' + c.props.map(p => (p === null ? '[…]' : p)).join('.');
    if (changes) {
      /* LOG.push(x) changes LOG; S.missed.add(x) changes S.missed. */
      const first = mode === 'call' && c.props.length === 1 ? undefined : propName(c.props[0]);
      emit(c.root, 'm', later, { prop: first, call: extra.call });
    } else emit(c.root, 'r', later, extra);
  }
  /* The target of an assignment, an update or a destructuring. */
  function target(node, scope, later, alsoRead) {
    if (!node) return;
    switch (node.type) {
      case 'Identifier': {
        const b = lookup(node.name, scope);
        if (!b) { emit(node, 'w', later); if (alsoRead) emit(node, 'r', later); }
        return;
      }
      case 'MemberExpression': case 'ChainExpression': member(node, scope, later, 'm'); return;
      case 'ObjectPattern': node.properties.forEach(p => { if (p.type === 'RestElement') target(p.argument, scope, later); else { if (p.computed) visit(p.key, scope, later); target(p.value, scope, later); } }); return;
      case 'ArrayPattern': node.elements.forEach(e => target(e, scope, later)); return;
      case 'RestElement': target(node.argument, scope, later); return;
      case 'AssignmentPattern': target(node.left, scope, later); visit(node.right, scope, later); return;
      default: visit(node, scope, later);
    }
  }
  /* The defaults and computed keys inside a binding pattern are expressions. */
  function patternExprs(p, scope, later) {
    if (!p) return;
    if (p.type === 'ObjectPattern') p.properties.forEach(q => { if (q.type === 'RestElement') patternExprs(q.argument, scope, later); else { if (q.computed) visit(q.key, scope, later); patternExprs(q.value, scope, later); } });
    else if (p.type === 'ArrayPattern') p.elements.forEach(q => patternExprs(q, scope, later));
    else if (p.type === 'RestElement') patternExprs(p.argument, scope, later);
    else if (p.type === 'AssignmentPattern') { patternExprs(p.left, scope, later); visit(p.right, scope, later); }
  }
  function func(node, scope, later, elementAlias) {
    const s = mk([], scope, true);
    if (node.type === 'FunctionExpression' && node.id) s.names.set(node.id.name, {});
    node.params.forEach(p => patternNames(p).forEach(n => s.names.set(n, {})));
    if (elementAlias && node.params[0] && node.params[0].type === 'Identifier') s.names.get(node.params[0].name).alias = elementAlias;
    node.params.forEach(p => patternExprs(p, s, later));
    if (node.body.type === 'BlockStatement') {
      const v = []; hoisted(node.body, v); v.forEach(n => { if (!s.names.has(n)) s.names.set(n, {}); });
      lexical(node.body.body).forEach(n => { if (!s.names.has(n)) s.names.set(n, {}); });
      node.body.body.forEach(st => visit(st, s, later));
    } else visit(node.body, s, later);
  }
  function block(statements, scope, later, extraNames) {
    const s = mk(lexical(statements).concat(extraNames || []), scope, false);
    statements.forEach(st => visit(st, s, later));
  }
  function visit(node, scope, later) {
    if (!node) return;
    switch (node.type) {
      case 'Identifier': { if (!lookup(node.name, scope)) emit(node, 'r', later); return; }
      case 'Literal': { if (typeof node.value === 'string') handlersIn(node.value).forEach(n => out.push({ name: n, kind: 'c', line: line(node), later: true, wire: true })); return; }
      case 'TemplateLiteral': {
        handlersIn(node.quasis.map(q => q.value.cooked || '').join('\u0000')).forEach(n => out.push({ name: n, kind: 'c', line: line(node), later: true, wire: true }));
        node.expressions.forEach(e => visit(e, scope, later)); return;
      }
      case 'FunctionDeclaration': func(node, scope, later); return;
      /* A function written as a value runs when something calls it, which is not now. */
      case 'FunctionExpression': case 'ArrowFunctionExpression': func(node, scope, true); return;
      case 'ClassDeclaration': case 'ClassExpression': {
        const s = node.type === 'ClassExpression' && node.id ? mk([node.id.name], scope, false) : scope;
        visit(node.superClass, s, later);
        for (const m of node.body.body) {
          if (m.type === 'StaticBlock') { block(m.body, s, later); continue; }
          if (m.computed) visit(m.key, s, later);
          if (m.value) { if (isFn(m.value)) func(m.value, s, true); else visit(m.value, s, true); }
        }
        return;
      }
      case 'BlockStatement': block(node.body, scope, later); return;
      case 'StaticBlock': block(node.body, scope, later); return;
      case 'SwitchStatement': {
        visit(node.discriminant, scope, later);
        const s = mk(lexical(node.cases.flatMap(c => c.consequent)), scope, false);
        node.cases.forEach(c => { visit(c.test, s, later); c.consequent.forEach(st => visit(st, s, later)); });
        return;
      }
      case 'CatchClause': {
        const s = mk(patternNames(node.param), scope, false);
        patternExprs(node.param, s, later);
        block(node.body.body, s, later); return;
      }
      case 'ForStatement': {
        const s = mk(node.init && node.init.type === 'VariableDeclaration' && node.init.kind !== 'var' ? node.init.declarations.flatMap(d => patternNames(d.id)) : [], scope, false);
        visit(node.init, s, later); visit(node.test, s, later); visit(node.update, s, later); visit(node.body, s, later); return;
      }
      case 'ForInStatement': case 'ForOfStatement': {
        const decl = node.left.type === 'VariableDeclaration' ? node.left : null;
        const s = mk(decl && decl.kind !== 'var' ? decl.declarations.flatMap(d => patternNames(d.id)) : [], scope, false);
        visit(node.right, scope, later);
        if (decl) {
          const id = decl.declarations[0].id;
          patternExprs(id, s, later);
          if (node.type === 'ForOfStatement' && id.type === 'Identifier') { const b = lookup(id.name, s); const a = aliasOf(node.right, scope); if (b && a) b.alias = a; }
        } else target(node.left, s, later);
        visit(node.body, s, later); return;
      }
      case 'VariableDeclaration': {
        for (const d of node.declarations) {
          patternExprs(d.id, scope, later);
          if (!d.init) continue;
          if (d.id.type === 'Identifier') { const b = lookup(d.id.name, scope); const a = aliasOf(d.init, scope); if (b && a) b.alias = a; }
          visit(d.init, scope, later);
        }
        return;
      }
      case 'AssignmentExpression': {
        target(node.left, scope, later, node.operator !== '=');
        if (node.left.type === 'Identifier') { const b = lookup(node.left.name, scope); if (b) { const a = aliasOf(node.right, scope); if (a && node.operator === '=') b.alias = a; } }
        visit(node.right, scope, later); return;
      }
      case 'UpdateExpression': target(node.argument, scope, later, true); return;
      case 'UnaryExpression': {
        if (node.operator === 'delete' && (node.argument.type === 'MemberExpression' || node.argument.type === 'ChainExpression')) member(node.argument, scope, later, 'm');
        else if (node.operator === 'typeof' && node.argument.type === 'Identifier') { if (!lookup(node.argument.name, scope)) emit(node.argument, 'r', later, { probe: true }); }
        else visit(node.argument, scope, later);
        return;
      }
      case 'MemberExpression': member(node, scope, later, 'r'); return;
      case 'ChainExpression': visit(node.expression, scope, later); return;
      case 'CallExpression': case 'NewExpression': {
        const cal = node.callee.type === 'ChainExpression' ? node.callee.expression : node.callee;
        let method = null, eachAlias = null, argsLater = later;
        if (isFn(cal)) func(cal, scope, later);                       // an IIFE runs now
        else if (cal.type === 'Identifier') {
          if (!lookup(cal.name, scope)) emit(cal, 'c', later);
          if (LATER.has(cal.name) || (node.type === 'NewExpression' && LATER_NEW.has(cal.name))) argsLater = true;
          method = cal.name;
        } else if (cal.type === 'MemberExpression') {
          member(cal, scope, later, 'call');
          if (!cal.computed) {
            method = cal.property.name;
            if (LATER.has(method)) argsLater = true;
            if (EACH_METHODS.has(method)) eachAlias = aliasOf(cal.object, scope);
            /* Object.assign(target, …) changes its first argument. */
            if (cal.object.type === 'Identifier' && cal.object.name === 'Object' && (method === 'assign' || method === 'defineProperty') && node.arguments[0]) {
              const a = node.arguments[0];
              if (a.type === 'Identifier') { const b = lookup(a.name, scope); if (!b) emit(a, 'm', later); else if (b.alias) out.push({ name: b.alias.root, kind: 'm', line: line(a), later, prop: b.alias.prop, alias: true }); }
              else if (a.type === 'MemberExpression') member(a, scope, later, 'm');
            }
          }
        } else visit(cal, scope, later);
        node.arguments.forEach((a, i) => {
          /* A function handed to a call runs when the call says: now, unless the call is one that waits. */
          if (isFn(a)) func(a, scope, argsLater, i === 0 ? eachAlias : null);
          else if (a.type === 'Identifier') { if (!lookup(a.name, scope)) emit(a, 'r', argsLater, { handed: true }); }
          else visit(a.type === 'SpreadElement' ? a.argument : a, scope, later);
        });
        return;
      }
      case 'Property': { if (node.computed) visit(node.key, scope, later); visit(node.value, scope, later); return; }
      case 'PropertyDefinition': case 'MethodDefinition': { if (node.computed) visit(node.key, scope, later); visit(node.value, scope, true); return; }
      case 'LabeledStatement': visit(node.body, scope, later); return;
      case 'BreakStatement': case 'ContinueStatement': case 'MetaProperty': case 'ThisExpression': case 'Super': case 'TemplateElement': case 'PrivateIdentifier': return;
      default: children(node, c => visit(c, scope, later));
    }
  }

  const top = mk([], null, true);
  if (isFn(node)) func(node, top, !!opts.later);
  else if (node.type === 'ClassDeclaration') visit(node, top, true);
  else visit(node, top, !!opts.later);
  return out;
}

/* ── a script's top level ───────────────────────────────────────────────────
   itemsOf(statements) → [{ name, kind, node, refs, … }] in order. A function
   or class is one item; each declared name is one; anything else is a
   statement that runs as the script loads. */
function itemsOf(statements, src) {
  const items = [];
  const text = n => src.slice(n.start, n.end);
  for (const st of statements) {
    if (st.type === 'ExpressionStatement' && (st.directive || (st.expression.type === 'Literal' && typeof st.expression.value === 'string'))) continue;
    if (st.type === 'EmptyStatement') continue;
    if (st.type === 'FunctionDeclaration') {
      items.push({ name: st.id.name, kind: 'function', async: st.async, params: st.params.map(text).join(','), node: st, refs: refsOf(st), start: st.start, line: st.loc.start.line, body: st.body });
    } else if (st.type === 'ClassDeclaration') {
      items.push({ name: st.id.name, kind: 'class', node: st, refs: refsOf(st), start: st.start, line: st.loc.start.line });
    } else if (st.type === 'VariableDeclaration') {
      for (const d of st.declarations) {
        const names = patternNames(d.id);
        const fn = isFn(d.init);
        /* The initializer runs as the script loads, unless it is a function, which runs when called. */
        const refs = d.init ? (fn ? refsOf(d.init) : refsOf(d.init, { later: false })) : [];
        names.forEach((name, i) => items.push({
          name, kind: fn ? 'function' : st.kind, declared: st.kind, viaConst: fn, async: fn && d.init.async, params: fn ? d.init.params.map(text).join(',') : undefined,
          node: d, refs: i === 0 ? refs : [], start: d.start, line: d.loc.start.line, init: d.init, body: fn ? d.init.body : null,
          shape: !d.init ? 'unset' : fn ? 'function' : shapeOf(d.init),
        }));
      }
    } else {
      items.push({ name: null, kind: 'statement', node: st, refs: refsOf(st, { later: false }), start: st.start, line: st.loc.start.line, text: text(st).replace(/\s+/g, ' ').slice(0, 90) });
    }
  }
  return items;
}
function shapeOf(e) {
  switch (e.type) {
    case 'Literal': case 'TemplateLiteral': return 'value';
    case 'ObjectExpression': return 'table';
    case 'ArrayExpression': return 'list';
    case 'NewExpression': return 'new ' + (e.callee.name || '…');
    case 'CallExpression': return isFn(e.callee) ? 'computed at load' : 'from ' + (e.callee.type === 'Identifier' ? e.callee.name + '()' : e.callee.type === 'MemberExpression' && !e.callee.computed ? (chainOf(e.callee).root.name || '…') + '.' + e.callee.property.name + '()' : 'a call');
    default: return 'computed at load';
  }
}

/* ── the shell ──────────────────────────────────────────────────────────────
   The application script is the inline script that holds the bank's slot. */
const TOKEN_RE = /@@SLOT\[([a-z]+):([^\]@]+)\]@@/g;
function readShell(html) {
  const scripts = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) scripts.push({ attrs: m[1] || '', text: m[2], at: m.index + m[0].indexOf('>') + 1 });
  const app = scripts.filter(s => s.text.includes('@@SLOT[payload:ALL_Q]@@'));
  if (app.length !== 1) throw new Error(`expected one inline script holding the bank's slot, found ${app.length}`);
  const script = app[0];
  const slots = [];
  /* Each token becomes something that parses, on the same line: a module or a
     vendored file becomes a marker statement, a payload a name the analysis
     can follow (what is made from the bank is the bank's data), an asset a 0. */
  const src = script.text.replace(TOKEN_RE, (t, kind, name) => {
    if (kind === 'src' || kind === 'app') { slots.push({ kind, name }); return `__slot__(${slots.length - 1});`; }
    return kind === 'payload' ? '__payload__' : '0';
  });
  const lineOffset = html.slice(0, script.at).split('\n').length - 1;
  const outside = html.slice(0, script.at) + html.slice(script.at + script.text.length);
  return { src, slots, lineOffset, digest: crypto.createHash('sha256').update(script.text).digest('hex').slice(0, 16), outside };
}

/* What a slotted file gives the script it is written into, and what it uses.
   A module is an IIFE that sets root.Name (or window.Name); a file that is not
   declares its names at the top level, and they are the script's own. */
function moduleOf(name, text, kind) {
  if (kind === 'app') {
    const umd = /globalThis\s*:\s*[\w$]+\s*\|\|\s*self\s*\)\s*\.\s*([A-Za-z_$][\w$]*)\s*=/.exec(text.slice(0, 2000));
    return { name, defines: umd ? [umd[1]] : [], members: {}, vendored: true };
  }
  let ast;
  try { ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'script', locations: true }); }
  catch (e) { return { name, defines: [], members: {}, uses: [], effects: {}, opaque: 'does not parse alone: ' + e.message }; }
  const defines = new Set(), members = {};
  /* The statements that are the module's own top level: the body of its IIFE, or the file's. */
  let body = ast.body, rootParam = null;
  const only = ast.body.filter(s => !(s.type === 'ExpressionStatement' && s.directive));
  if (only.length === 1 && only[0].type === 'ExpressionStatement') {
    let e = only[0].expression;
    if (e.type === 'UnaryExpression') e = e.argument;
    if (e.type === 'CallExpression' && isFn(e.callee) && e.callee.body.type === 'BlockStatement') {
      body = e.callee.body.body;
      rootParam = e.callee.params[0] && e.callee.params[0].type === 'Identifier' ? e.callee.params[0].name : null;
    }
  }
  const items = itemsOf(body, text);
  const local = new Map(items.filter(i => i.name).map(i => [i.name, i]));
  if (body === ast.body) for (const i of items) if (i.name) defines.add(i.name);
  /* root.X = …, window.X = …, anywhere in the file. */
  const globalObj = n => n.type === 'Identifier' && (n.name === rootParam || n.name === 'window' || n.name === 'globalThis' || n.name === 'self');
  (function find(n) {
    if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' && !n.left.computed && globalObj(n.left.object)) {
      const x = n.left.property.name;
      defines.add(x);
      /* root.X = { a, g: { u, v } } gives X.a, X.g.u and X.g.v, each traced to its own function. */
      if (n.right.type === 'ObjectExpression') {
        members[x] = [];
        (function collect(prefix, obj) {
          for (const p of obj.properties) {
            if (p.type !== 'Property' || p.computed) continue;
            const key = prefix + '.' + (p.key.name || p.key.value);
            if (p.value.type === 'ObjectExpression') collect(key, p.value);
            else members[x].push({ path: key, local: p.value.type === 'Identifier' ? p.value.name : null, node: p.value });
          }
        })(x, n.right);
      }
    }
    children(n, find);
  })(ast);
  return { name, defines: [...defines], members, items, local, ast, rootParam };
}

function analyse(html, readFile) {
  const shell = readShell(html);
  const comments = [];
  const ast = acorn.parse(shell.src, { ecmaVersion: 'latest', sourceType: 'script', locations: true, onComment: comments });
  const items = itemsOf(ast.body.filter(s => !(s.type === 'ExpressionStatement' && s.expression.type === 'CallExpression' && s.expression.callee.name === '__slot__')), shell.src);
  /* The slots, in place. One that stands inside a statement (a vendored file
     wrapped by the shell) is listed, and is part of that statement. */
  const slotAt = [];
  const isSlot = n => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression' && n.expression.callee.name === '__slot__';
  for (const top of ast.body) (function find(n, nested) {
    if (isSlot(n)) { slotAt.push(Object.assign({ start: n.start, line: n.loc.start.line, nested }, shell.slots[n.expression.arguments[0].value])); return; }
    children(n, c => find(c, true));
  })(top, false);
  const modules = slotAt.map(s => Object.assign(moduleOf(s.name, readFile(s.name), s.kind), { kind: s.kind, start: s.start, line: s.line, nested: s.nested }));

  const byName = new Map();
  for (const it of items) if (it.name) { if (byName.has(it.name)) it.duplicate = true; else byName.set(it.name, it); }
  const moduleOfName = new Map();
  for (const m of modules) for (const d of m.defines) if (!moduleOfName.has(d)) moduleOfName.set(d, m);
  /* window.X = … at the shell's top level makes X a name too. */
  const windowNames = new Set();
  for (const it of items) for (const r of it.refs) if (r.name === 'window' && r.kind === 'm' && r.prop && r.prop !== '[…]') windowNames.add(r.prop);

  const place = name => byName.has(name) ? 'shell' : moduleOfName.has(name) ? 'module' : LANGUAGE.has(name) ? 'language' : BROWSER_OF.has(name) ? BROWSER_OF.get(name) : windowNames.has(name) ? 'window' : 'unplaced';

  /* A module's own effects, per name it gives: what the function behind each
     member reaches inside the module, the module's own state included (a
     `let`, or a `const` it changes), and what it reaches through another
     module it calls. Worked to a fixed point across the modules. A member that
     is not a plain local function takes everything the module uses. */
  for (const m of modules) {
    m.back = []; m.all = new Set(); m.memberEffects = {};
    if (!m.items) continue;
    const changed = new Set();
    for (const it of m.items) for (const r of it.refs) if ((r.kind === 'm' || r.kind === 'w') && m.local.has(r.name)) changed.add(r.name);
    m.isState = name => { const it = m.local.get(name); return !!it && it.kind !== 'function' && it.kind !== 'class' && (it.declared === 'let' || it.declared === 'var' || changed.has(name)); };
    m.eff = new Map(m.items.filter(i => i.name).map(i => [i.name, new Set()]));
    /* What the module uses that is the shell's: it reaches back into the script it sits in. */
    const back = new Set();
    for (const it of m.items) for (const r of it.refs) if (!m.local.has(r.name) && r.name !== m.rootParam && byName.has(r.name) && !moduleOfName.has(r.name)) back.add(r.name);
    m.back = [...back].sort();
  }
  const lent = (r, from) => {               // what a use of another module's name brings with it
    const other = moduleOfName.get(r.name);
    if (!other || other === from || (from && from.local.has(r.name))) return null;
    /* The longest path that names a member: ApexWire.gemini.url before ApexWire.gemini. */
    const path = r.call ? r.call.split('.') : r.prop && r.prop !== '[…]' ? [r.name, r.prop] : [r.name];
    for (let n = path.length; n >= 2; n--) { const k = path.slice(0, n).join('.'); if (other.memberEffects[k]) return other.memberEffects[k]; }
    return other.all;
  };
  const refCats = (r, m) => {
    const s = new Set(), c = catOf(r);
    if (c) s.add(c);
    if (m.local.has(r.name) && m.isState(r.name)) s.add(r.kind === 'r' ? 'reads' : 'writes');
    for (const k of lent(r, m) || []) s.add(k);
    return s;
  };
  for (let again = true; again;) {
    again = false;
    for (const m of modules) {
      if (!m.items) continue;
      const before = m.all.size + Object.values(m.memberEffects).reduce((n, x) => n + x.size, 0);
      const direct = new Map(m.items.map(it => { const s = new Set(); for (const r of it.refs) for (const c of refCats(r, m)) s.add(c); return [it, s]; }));
      for (const it of m.items) if (it.name) for (const c of direct.get(it)) m.eff.get(it.name).add(c);
      for (let changed = true; changed;) {
        changed = false;
        for (const it of m.items) if (it.name) for (const r of it.refs) if (m.local.has(r.name) && r.name !== it.name && m.eff.has(r.name)) {
          const a = m.eff.get(it.name);
          for (const c of m.eff.get(r.name)) if (!a.has(c)) { a.add(c); changed = true; }
        }
      }
      for (const set of direct.values()) for (const c of set) m.all.add(c);
      for (const list of Object.values(m.members)) for (const p of list) {
        const set = m.memberEffects[p.path] || (m.memberEffects[p.path] = new Set());
        if (p.local && m.eff.has(p.local)) for (const c of m.eff.get(p.local)) set.add(c);
        else if (p.node.type !== 'Literal') for (const r of refsOf(p.node, { later: false })) { for (const c of refCats(r, m)) set.add(c); if (m.local.has(r.name)) for (const k of m.eff.get(r.name) || []) set.add(k); }
        /* An object that holds members is, used whole, everything they are. */
        const parts = p.path.split('.');
        for (let n = parts.length - 1; n >= 2; n--) { const k = parts.slice(0, n).join('.'), up = m.memberEffects[k] || (m.memberEffects[k] = new Set()); for (const c of set) up.add(c); }
      }
      if (m.all.size + Object.values(m.memberEffects).reduce((n, x) => n + x.size, 0) !== before) again = true;
    }
  }
  function catOf(r) {
    if (r.probe) return null;
    const viaMember = r.prop && r.prop !== '[…]' ? MEMBER_CAT[r.name + '.' + r.prop] : null;
    if (viaMember) return viaMember;
    if (r.name === 'Math') return null;
    if (r.name === 'window' && r.prop && r.prop !== '[…]') {
      if (BROWSER_OF.has(r.prop)) return BROWSER_OF.get(r.prop);
      return 'DOM';
    }
    return BROWSER_OF.get(r.name) || null;
  }

  /* ── each item, placed ── */
  const mutated = new Set();    // shell names something changes or rebinds after they are made
  for (const it of items) for (const r of it.refs) if ((r.kind === 'm' || r.kind === 'w') && byName.has(r.name)) mutated.add(r.name);
  /* What is made from a payload as the script loads is the bank's data: ALL_Q, and POOL made from it, and so on. It is
     listed with the state, because a function that reads it needs it handed over just the same. */
  const bank = new Set();
  for (let grew = true; grew;) {
    grew = false;
    for (const it of items) if (it.name && it.kind !== 'function' && it.kind !== 'class' && !bank.has(it.name) && it.refs.some(r => !r.later && (r.name === '__payload__' || bank.has(r.name)))) { bank.add(it.name); grew = true; }
  }
  const isState = name => { const it = byName.get(name); return !!it && it.kind !== 'function' && it.kind !== 'class' && (it.declared === 'let' || it.declared === 'var' || mutated.has(name) || bank.has(name)); };
  const isFunc = name => { const it = byName.get(name); return !!it && (it.kind === 'function' || it.kind === 'class'); };

  for (const it of items) {
    const d = it.facts = { reads: new Map(), writes: new Map(), calls: new Set(), wires: new Set(), consts: new Set(), modules: new Set(), cats: { DOM: new Set(), storage: new Set(), net: new Set(), clock: new Set() }, unplaced: new Set(), moduleCats: new Set(), opaque: new Set() };
    const add = (map, name, prop) => { if (!map.has(name)) map.set(name, new Set()); if (prop !== undefined) map.get(name).add(prop); };
    for (const r of it.refs) {
      if (r.name === '__slot__' || r.name === '__payload__') continue;
      let name = r.name, prop = r.prop, where = place(name);
      /* LOG.push(…) and POOL.filter(…) are uses of LOG and POOL, not of a property called push or filter. */
      if (r.call && r.call.split('.').length === 2) prop = undefined;
      /* window.NAME is NAME, when NAME is the app's. */
      if (name === 'window' && prop && prop !== '[…]' && (byName.has(prop) || moduleOfName.has(prop) || windowNames.has(prop))) {
        if (byName.has(prop) || moduleOfName.has(prop)) { name = prop; prop = undefined; where = place(name); }
        else { (r.kind === 'm' ? d.writes : d.reads).set('window.' + prop, new Set()); continue; }
      }
      if (where === 'shell') {
        if (name === it.name && it.kind !== 'function') continue;
        if (isFunc(name)) { if (r.wire) d.wires.add(name); else if (name !== it.name) d.calls.add(name); if (r.kind === 'w' || r.kind === 'm') add(d.writes, name, prop); continue; }
        if (r.wire) continue;
        if (r.kind === 'w') add(d.writes, name);
        else if (r.kind === 'm') add(d.writes, name, prop === undefined ? '*' : prop);
        else if (isState(name)) add(d.reads, name, prop);
        else d.consts.add(name);
        if (r.call && !r.alias && !(r.kind === 'm') && !PLAIN_METHODS.has(r.call.split('.').pop())) d.opaque.add(r.call);
      } else if (where === 'module') {
        if (r.wire) { d.wires.add(name); continue; }
        const call = r.call || (prop && prop !== '[…]' ? name + '.' + prop : name);
        d.modules.add(call);
        for (const c of (lent(r, null) || [])) d.moduleCats.add(c);
        if (r.kind === 'w' || (r.kind === 'm' && !r.call)) add(d.writes, name, prop === undefined ? '*' : prop);
      } else if (where === 'language') {
        const c = catOf(r); if (c) d.cats[c].add(name + (r.prop ? '.' + r.prop : ''));
      } else if (where === 'unplaced') { if (!r.wire && !r.probe) d.unplaced.add(name); }
      else if (where === 'window') { (r.kind === 'w' || r.kind === 'm' ? d.writes : d.reads).set('window.' + name, new Set()); }
      else { const c = catOf(r) || where; d.cats[c].add(name === 'window' && r.prop && r.prop !== '[…]' ? r.prop : name); }
    }
  }

  /* ── what a function reaches through what it calls ──
     A fixed point over the calls between shell functions. A handler the item
     only names in markup is not part of it: writing the markup does not run
     the handler. (It does count below, in what a screen owns.) */
  const TAGS = ['reads', 'writes', 'held', 'DOM', 'storage', 'net', 'clock'];
  const directTags = it => {
    const s = new Set(), f = it.facts;
    if (f.reads.size || f.moduleCats.has('reads')) s.add('reads');
    if (f.writes.size || f.moduleCats.has('writes')) s.add('writes');
    if (f.opaque.size) s.add('held');
    for (const c of ['DOM', 'storage', 'net', 'clock']) if (f.cats[c].size || f.moduleCats.has(c)) s.add(c);
    return s;
  };
  for (const it of items) { it.direct = directTags(it); it.reach = new Set(it.direct); }
  const fnItems = items.filter(i => i.kind === 'function' || i.kind === 'class');
  for (let changed = true; changed;) {
    changed = false;
    for (const it of items) for (const c of it.facts.calls) {
      const t = byName.get(c); if (!t) continue;
      for (const tag of t.reach) if (!it.reach.has(tag)) { it.reach.add(tag); changed = true; }
    }
  }
  const tier = it => {
    const r = it.reach;
    if (r.has('DOM') || r.has('storage') || r.has('net')) return 'outside';
    if (r.has('held')) return 'held';
    if (r.has('writes')) return 'writes';
    if (r.has('reads')) return 'reads';
    if (r.has('clock')) return 'clock';
    return 'pure';
  };
  for (const it of items) it.tier = tier(it);
  /* A function that is only a call into a module already lives there: one statement, which returns
     the call or just makes it, on a member at any depth (ApexWire.wire, ApexWire.gemini.url). */
  for (const it of fnItems) {
    const b = it.body;
    const st = b && b.type === 'BlockStatement' ? (b.body.length === 1 ? b.body[0] : null) : null;
    const one = !b ? null : b.type !== 'BlockStatement' ? b : !st ? null : st.type === 'ReturnStatement' ? st.argument : st.type === 'ExpressionStatement' ? st.expression : null;
    if (!one || one.type !== 'CallExpression' || one.callee.type !== 'MemberExpression') continue;
    const c = chainOf(one.callee);
    if (c.root.type === 'Identifier' && moduleOfName.has(c.root.name) && !byName.has(c.root.name) && c.props.every(Boolean)) it.wrapper = c.root.name + '.' + c.props.join('.');
  }

  /* ── who calls whom, backwards ── */
  const callers = new Map(items.filter(i => i.name).map(i => [i.name, new Set()]));
  for (const it of items) for (const c of [...it.facts.calls, ...it.facts.wires]) if (callers.has(c)) callers.get(c).add(it.name || '(load, line ' + (it.line + shell.lineOffset) + ')');
  for (const m of modules) for (const b of (m.back || [])) if (callers.has(b)) callers.get(b).add('(' + m.name + ')');
  const markupHandlers = new Set(handlersIn(shell.outside).filter(n => byName.has(n)));
  for (const h of markupHandlers) callers.get(h).add('(the page\'s own markup)');

  /* ── what runs as the script loads ──
     A statement, or a declared name's initializer, runs where it stands. A
     function it calls runs then too, and so on: everything a called function
     mentions is taken to run, since which of its branches run cannot be known
     here. A function reached from a statement that stands before the
     function's own text is one the script relies on hoisting for. */
  const loadReach = new Map();   // function name → the first load-time item that reaches it
  const loaders = items.filter(i => i.kind !== 'function' && i.kind !== 'class');
  for (const it of loaders) {
    const seen = new Set();
    const runs = r => !r.later && !r.wire && (r.kind === 'c' || r.handed) && isFunc(r.name);
    const stack = it.refs.filter(runs).map(r => r.name);
    while (stack.length) {
      const n = stack.pop();
      if (seen.has(n)) continue;
      seen.add(n);
      if (!loadReach.has(n)) loadReach.set(n, it);
      for (const r of byName.get(n).refs) if (runs(r) && !seen.has(r.name)) stack.push(r.name);
    }
    it.loadCalls = [...seen];
  }
  const hoistedAtLoad = fnItems.filter(f => f.kind === 'function' && !f.viaConst && loadReach.has(f.name) && loadReach.get(f.name).start < f.start)
    .map(f => ({ name: f.name, by: loadReach.get(f.name) }));

  /* ── sections: the shell's own banners ── */
  const topLevel = c => ast.body.every(n => !(c.start > n.start && c.end < n.end));
  const title = (c, ch) => c.value.split('\n')[0].replace(new RegExp(ch + '+', 'g'), ' ').replace(/\s+/g, ' ').trim();
  const banners = comments.filter(c => c.type === 'Block' && topLevel(c)).map(c => {
    const t = c.value.trim();
    if (/^═{3,}/.test(t)) return { start: c.start, level: 1, title: title(c, '═') };
    if (/^──/.test(t)) return { start: c.start, level: 2, title: title(c, '─') };
    return null;
  }).filter(b => b && b.title);
  const sections = [{ start: -1, level: 1, title: 'Before the first banner', items: [], subs: [] }];
  for (const b of banners) {
    if (b.level === 1) sections.push({ start: b.start, level: 1, title: b.title, items: [], subs: [] });
    else sections[sections.length - 1].subs.push({ start: b.start, title: b.title, items: [] });
  }
  const everything = items.map(i => ({ start: i.start, item: i })).concat(modules.filter(m => !m.nested).map(m => ({ start: m.start, module: m }))).sort((a, b) => a.start - b.start);
  for (const e of everything) {
    let sec = sections[0];
    for (const s of sections) if (s.start <= e.start) sec = s;
    let sub = null;
    for (const s of sec.subs) if (s.start <= e.start) sub = s;
    (sub || sec).items.push(e);
    if (e.item) e.item.section = sec.title + (sub ? ' / ' + sub.title : '');
  }

  /* ── screens: what buildScreen() dispatches to, and what only each reaches ── */
  const router = byName.get('buildScreen');
  const screens = router ? [...router.facts.calls].filter(n => /^build[A-Z]/.test(n)) : [];
  const graph = n => { const it = byName.get(n); return it ? [...it.facts.calls, ...it.facts.wires].filter(isFunc) : []; };
  const reachFrom = (roots, without) => {
    const seen = new Set(), stack = roots.filter(r => r !== without);
    while (stack.length) { const n = stack.pop(); if (seen.has(n) || n === without) continue; seen.add(n); for (const c of graph(n)) if (!seen.has(c)) stack.push(c); }
    return seen;
  };
  const entries = [...new Set(loaders.flatMap(l => [...l.facts.calls, ...l.facts.wires]).filter(isFunc).concat([...markupHandlers], modules.flatMap(m => (m.back || []).filter(isFunc))))];
  const reachable = reachFrom(entries);
  const screenInfo = screens.map(s => {
    const without = reachFrom(entries, s);
    const own = [...reachFrom([s])].filter(n => !without.has(n));
    const ownSet = new Set(own);
    const writes = new Map();
    for (const n of own) for (const [name, props] of byName.get(n).facts.writes) { if (!writes.has(name)) writes.set(name, new Set()); for (const p of props) writes.get(name).add(p); }
    const shared = new Set();
    for (const n of own) for (const c of graph(n)) if (!ownSet.has(c)) shared.add(c);
    return { name: s, own: own.sort(), writes, shared: [...shared].sort() };
  });
  const unreached = fnItems.filter(f => !reachable.has(f.name)).map(f => f.name);

  return { shell, items, fnItems, modules, byName, moduleOfName, sections, callers, hoistedAtLoad, loaders, screens: screenInfo, unreached, markupHandlers, isState, isFunc, place, TAGS, bank, mutated };
}

/* ── the map, as text ───────────────────────────────────────────────────── */
const LIMITS = [
  'A call made by a name the script builds while it runs: `window[name]()`, a handler attribute assembled from pieces (`onclick="${fn}()"`), `setTimeout` given a string, `eval`, `new Function`. Handlers written whole into markup, `onclick="name(…)"` in a string or a template, are read; so are the ones in the page\'s own markup outside the script.',
  'A change made through a value it cannot follow. It follows a local name bound to part of a script-level name (`const c=S.srs[id]; c.due=…` is a write to `S.srs`), a `for…of` over one, the first parameter of a `forEach`/`map`/`filter`/`find`/`some`/`every` callback on one, and the result of `find`/`at`/`get`/`filter`/`slice` on one. It does not follow a value handed to another function as an argument and changed there, a destructured name (`const {srs}=S`), or a value that came back from a call. So a function that passes `S.srs[id]` to a helper that changes it is listed as reading `S.srs`, and the helper as changing nothing of the script\'s.',
  'Anything finer than the first property. `S.srs[q.id].due=…` is "writes `S.srs`". A computed first property is shown as `[…]`.',
  'What a value is. *Pure* means the item uses nothing of the script\'s or the browser\'s by name. A function that works only on what it is handed is pure here even when what it is handed is an element, a canvas or a viewer (`apexAtBottom(el)`, `figZoomBy(ps,k)`); read a leaf before choosing between `src/core/` and `src/ui/` for it.',
  'Which branch runs. Every name a function mentions counts, whether or not the line is ever reached, and "runs as the script loads" takes a called function to run everything it mentions. Both err towards saying more.',
  'What a function handed to a call does, and when. One handed to a timer, a listener, a promise or an observer is taken to run later; one handed to anything else (`map`, a sort) is taken to run with the call.',
  'A module\'s insides beyond its own top level. For a module that sets `root.Name={a,b}` each member is traced to the module\'s function of that name and what that reaches: the browser\'s names, the module\'s own state (a caller of `Memory.add` is listed as changing state, though the state is the module\'s), and other modules. A member built any other way is given everything the module uses. The vendored libraries are not traced.',
  'The other inline scripts (the theme and the splash, above the application script), the service worker, the Worker, and anything the split build adds (`scripts/build-pwa.js` writes names such as `LAB_SRC` and `PSW_SRC` onto `window`). Names it could not place are listed at the end rather than dropped.',
  'Tests. A suite that calls a shell function by name from `page.evaluate`, or cuts one out of the shell by an anchor (`tests/_appcut.js`), depends on that name staying where it is; search `tests/` for the name before moving it.',
];

const tick = s => '`' + s + '`';
const list = (set, max) => { const a = [...set].sort(); return (max && a.length > max ? a.slice(0, max).map(tick).join(' ') + ` and ${a.length - max} more` : a.map(tick).join(' ')); };
const TIER_WORD = { pure: 'pure', clock: 'pure but for the clock', reads: 'reads state', writes: 'changes state', held: 'calls into an object held in state', outside: 'reaches the DOM, storage or the network' };

function entry(it, A) {
  const f = it.facts, parts = [];
  const field = (name, props) => { const p = [...props].filter(x => x !== '*').sort(); return p.length ? p.map(x => tick(x === '[…]' ? name + '[…]' : name + '.' + x)).join(' ') : tick(name); };
  const state = (map) => [...map.keys()].sort((a, b) => (a === 'S' ? -1 : b === 'S' ? 1 : a < b ? -1 : 1)).map(n => field(n, map.get(n))).join(' ');
  if (f.reads.size) parts.push('reads ' + state(f.reads));
  if (f.writes.size) parts.push('writes ' + state(f.writes));
  for (const c of ['DOM', 'storage', 'net', 'clock']) if (f.cats[c].size) parts.push(c + ' ' + list(f.cats[c]));
  if (f.opaque.size) parts.push('calls into ' + list(f.opaque));
  if (f.modules.size) parts.push('modules ' + list(f.modules));
  if (f.calls.size) parts.push('calls ' + list(f.calls));
  if (f.wires.size) parts.push('wires ' + list(f.wires));
  if (f.consts.size) parts.push('constants ' + list(f.consts));
  if (f.unplaced.size) parts.push('unplaced ' + list(f.unplaced));
  const through = [...it.reach].filter(t => !it.direct.has(t));
  if (it.kind === 'statement') return `- *runs at load:* ${tick(it.text.replace(/`/g, '\''))}${parts.length ? ' — ' + parts.join(' · ') : ''}`;
  let head;
  if (it.kind === 'function') head = `**${tick(it.name + '(' + (it.params || '') + ')')}**${it.async ? ' async' : ''}${it.viaConst ? ' (a ' + it.declared + ')' : ''}`;
  else if (it.kind === 'class') head = `**${tick('class ' + it.name)}**`;
  else head = `**${tick(it.name)}** ${it.declared}, ${it.shape}${A.bank.has(it.name) ? ', the bank\'s data' : ''}${A.mutated.has(it.name) && it.declared === 'const' ? ', changed in place' : ''}`;
  const tag = it.kind === 'function' || it.kind === 'class' ? ` — *${it.wrapper ? 'a call into ' + it.wrapper : TIER_WORD[it.tier]}*` : '';
  const more = through.length ? ` · through its calls: ${through.join(', ')}` : '';
  return `- ${head}${tag}${parts.length ? ' · ' + parts.join(' · ') : ''}${more}`;
}

function render(A) {
  const L = [];
  const { items, fnItems, modules } = A;
  const fns = fnItems.filter(f => f.kind === 'function');
  const count = t => fns.filter(f => f.tier === t && !f.wrapper).length;
  L.push('# The shell\'s script, mapped');
  L.push('');
  L.push('Generated by `node tools/shell-map.js --write`. Do not edit it: change the tool, or the shell, and write it again.');
  L.push('');
  L.push(`**A snapshot** of the application script in \`${SHELL}\`, digest \`${A.shell.digest}\` (SHA-256 of the script's text as committed, slots unfilled). No suite holds it current: \`node tools/shell-map.js --check\` exits 1 when the shell has moved on, and each step of roadmap item E1 writes it again in its own change. A count below is a count of that snapshot.`);
  L.push('');
  L.push('The script is one scope. Every function, class, `const` and `let` at its top level is visible to every other, to each `src/` module written into it through a slot, and to every inline handler in the markup. This lists each of them, in the shell\'s order and under the shell\'s own banners, with what it uses that it does not itself declare.');
  L.push('');
  L.push('## Reading an entry');
  L.push('');
  L.push('    - **`name(params)`** — *what it reaches, through everything it calls* · reads … · writes … · DOM … · storage … · net … · clock … · modules … · calls … · wires … · constants … · through its calls: …');
  L.push('');
  L.push('- **reads / writes** name the script\'s state: a top-level `let` (`S`, `LOG`, `CHATS`), a `const` that something changes in place, and the bank\'s data, which is every name made from a payload as the script loads (`ALL_Q`, `POOL`, `QBYID`). A property is the first one reached: `S.srs`. A write is a rebinding (`aiBusy=true`) or a change inside (`S.srs[id]=…`, `LOG.push(…)`).');
  L.push('- **DOM, storage, net, clock** are the browser\'s names the item uses itself: `document`, `localStorage`, `fetch`, `Date` and the timers.');
  L.push('- **modules** are calls into a `src/` module or a vendored library, as `Module.member`.');
  L.push('- **calls into** are methods called on a value the script holds in state (`apexAv.setState`, a viewer, a canvas context kept in a variable). What such a method does is not followed, so the item is put with neither the readers nor the writers.');
  L.push('- **calls** are the shell\'s own functions it calls, or hands on as a value. **wires** are the functions it writes into markup as inline handlers; they run when tapped, so they are no part of the item\'s reach, and they are counted where the map works out which functions a screen owns.');
  L.push('- **constants** are script-level names nothing changes after they are made, and that are not made from the bank.');
  L.push('- The phrase in italics is the item\'s reach through the shell functions it calls and wires, to a fixed point: *pure* (nothing below), *pure but for the clock*, *reads state*, *changes state*, *calls into an object held in state*, or *reaches the DOM, storage or the network*. **through its calls** names what that adds to what the item does itself.');
  L.push('');
  L.push('## What this cannot see');
  L.push('');
  LIMITS.forEach(l => L.push('- ' + l));
  L.push('');
  L.push('## The snapshot in numbers');
  L.push('');
  const vars = items.filter(i => i.name && i.kind !== 'function' && i.kind !== 'class');
  L.push('| | |');
  L.push('|---|---|');
  L.push(`| functions at the top level | ${fns.length} |`);
  L.push(`| of them already a call into a module | ${fns.filter(f => f.wrapper).length} |`);
  L.push(`| pure | ${count('pure')} |`);
  L.push(`| pure but for the clock | ${count('clock')} |`);
  L.push(`| read state, change nothing, reach nothing outside | ${count('reads')} |`);
  L.push(`| change state, reach nothing outside | ${count('writes')} |`);
  L.push(`| call a method of an object held in state | ${count('held')} |`);
  L.push(`| reach the DOM, storage or the network | ${count('outside')} |`);
  L.push(`| classes | ${fnItems.length - fns.length} |`);
  L.push(`| declared names that are state | ${vars.filter(v => A.isState(v.name)).length} |`);
  L.push(`| declared names that are constants | ${vars.filter(v => !A.isState(v.name)).length} |`);
  L.push(`| statements that run as the script loads | ${items.filter(i => i.kind === 'statement').length} |`);
  L.push(`| slots for \`src/\` modules and vendored files | ${modules.length} |`);
  L.push('');

  /* ── the order ── */
  L.push('## A recommended order of extraction');
  L.push('');
  L.push('The rule behind the order: move what depends on least first, so each move has less to carry and the next has less in its way. A function can leave the shell for `src/` when everything it uses can be handed to it. That is free for a pure one, cheap for one that only reads state (the state becomes an argument), and a design decision for one that changes state or draws, because the state and the page have to be reachable from where it lands.');
  L.push('');
  L.push('### 1. Leaves: functions that use nothing of the script\'s but constants and each other');
  L.push('');
  L.push('These take their inputs as arguments already. Each can move into a `src/` module with a pure suite, leaving a one-line function of the same name in the shell so that no caller, handler or test changes. Why first: nothing else has to move with them, and a pure suite can hold them without a browser. One that is handed an element or a canvas belongs in `src/ui/`; one that builds markup naming a handler (its entry says *wires*) still needs that handler to stay a script-level name.');
  L.push('');
  const leaf = fns.filter(f => (f.tier === 'pure' || f.tier === 'clock') && !f.wrapper);
  L.push(leaf.length ? leaf.map(f => tick(f.name) + (f.tier === 'clock' ? ' (clock)' : '')).join(' ') : '*(none left)*');
  L.push('');
  const done = fns.filter(f => f.wrapper);
  if (done.length) { L.push('Already moved, and now a call into a module: ' + done.map(f => `${tick(f.name)} → ${tick(f.wrapper)}`).join(', ') + '.'); L.push(''); }
  L.push('### 2. Readers: functions that read state and change nothing');
  L.push('');
  L.push('Each computes something from `S`, `POOL`, `LOG` or another script-level value. Given those as arguments it is a leaf. Why second: the rules worth testing live here (what is due, what a session holds, what Apex is told), and none of them needs the page.');
  L.push('');
  const readers = fns.filter(f => f.tier === 'reads' && !f.wrapper);
  L.push(readers.length ? readers.map(f => tick(f.name)).join(' ') : '*(none)*');
  L.push('');
  L.push('### 3. What every screen calls');
  L.push('');
  L.push('The shell functions with the most distinct callers. A screen moved to `src/app/` still calls these, so they need a home it can reach (a small `src/app/` module slotted before the first screen) before, or with, the first screen that moves. Moving a screen first would make it reach back into the shell for each of them.');
  L.push('');
  const busy = fns.map(f => ({ f, n: A.callers.get(f.name).size })).sort((a, b) => b.n - a.n || (a.f.name < b.f.name ? -1 : 1)).slice(0, 24);
  L.push('| function | callers | reach |');
  L.push('|---|---|---|');
  busy.forEach(({ f, n }) => L.push(`| ${tick(f.name)} | ${n} | ${f.wrapper ? 'a call into ' + f.wrapper : TIER_WORD[f.tier]} |`));
  L.push('');
  L.push('### 4. Screens, least entangled first');
  L.push('');
  L.push('`buildScreen()` dispatches to one builder per screen. For each: the functions only that builder reaches (remove the builder and nothing else calls them, so they move with it), the shell functions it shares with the rest, and the state its own functions write. The order is by how many shared functions it calls that change state or draw, then by size: the fewer of the shell\'s moving parts a screen holds on to, the less the move can disturb.');
  L.push('');
  L.push('| screen | its own functions | shared functions it calls | of those, not pure or readers | state its own functions write |');
  L.push('|---|---|---|---|---|');
  const rows = A.screens.map(s => {
    const heavy = s.shared.filter(n => { const t = A.byName.get(n).tier; return t === 'writes' || t === 'held' || t === 'outside'; });
    return { s, heavy };
  }).sort((a, b) => a.heavy.length - b.heavy.length || a.s.own.length - b.s.own.length || (a.s.name < b.s.name ? -1 : 1));
  rows.forEach(({ s, heavy }) => L.push(`| ${tick(s.name)} | ${s.own.length} | ${s.shared.length} | ${heavy.length} | ${[...s.writes.keys()].sort().map(n => n === 'S' ? [...s.writes.get(n)].filter(p => p !== '*').sort().map(p => tick('S.' + p)).join(' ') || tick('S') : tick(n)).join(' ') || 'none'} |`));
  L.push('');
  L.push('What each screen owns:');
  L.push('');
  rows.forEach(({ s }) => L.push(`- ${tick(s.name)}: ${s.own.length ? s.own.map(tick).join(' ') : '*(only itself)*'}`));
  L.push('');
  L.push('### 5. Last: the state itself');
  L.push('');
  L.push('`S`, its `save()` and `load()`, and `render()` are what everything above holds on to. They move when the screens have, as the boot the roadmap leaves in the shell. The index below says who would notice.');
  L.push('');

  /* ── load ── */
  L.push('## What runs as the script loads');
  L.push('');
  L.push('A module written into a slot runs where the slot stands. A function declaration is hoisted, so the shell may call one above the line that declares it. A module is not: a function moved into a module is defined only once the script has run down to its slot. So a function that runs during load, called from a statement above the function\'s own text, cannot be replaced by a module slotted at the function\'s position; its slot has to stand above that statement.');
  L.push('');
  if (A.hoistedAtLoad.length) {
    L.push('Functions the load reaches from above their own text (by the widest reading: everything a called function mentions is taken to run):');
    L.push('');
    const byLoader = new Map();
    for (const h of A.hoistedAtLoad) { const k = h.by.name ? tick(h.by.name) + '\'s initializer' : 'the statement ' + tick(h.by.text.replace(/`/g, '\'').slice(0, 60)); if (!byLoader.has(k)) byLoader.set(k, []); byLoader.get(k).push(h.name); }
    for (const [k, names] of byLoader) L.push(`- from ${k}: ${names.sort().map(tick).join(' ')}`);
  } else L.push('No function is reached from above its own text.');
  L.push('');

  /* ── state index ── */
  L.push('## Who touches what');
  L.push('');
  L.push('Each piece of state, with every item that writes it and every item that reads it. `(load)` is a statement or an initializer that runs as the script loads.');
  L.push('');
  const who = new Map();
  const note = (key, kind, it) => { if (!who.has(key)) who.set(key, { r: new Set(), w: new Set() }); who.get(key)[kind].add(it.name || '(load)'); };
  for (const it of items) {
    for (const [name, props] of it.facts.reads) { if (!props.size) note(name, 'r', it); for (const p of props) note(name === 'S' ? 'S.' + p : name, 'r', it); }
    for (const [name, props] of it.facts.writes) { if (!A.byName.has(name) || A.isFunc(name)) continue; const ps = [...props].filter(p => p !== '*'); if (!ps.length || name !== 'S') note(name, 'w', it); if (name === 'S') for (const p of ps) note('S.' + p, 'w', it); }
  }
  const keys = [...who.keys()].sort((a, b) => { const sa = a === 'S' || a.startsWith('S.'), sb = b === 'S' || b.startsWith('S.'); return sa !== sb ? (sa ? -1 : 1) : a < b ? -1 : a > b ? 1 : 0; });
  const names = (set) => { const a = [...set].sort(); return a.length ? a.map(tick).join(' ') : 'nothing'; };
  L.push('### `S`, by field');
  L.push('');
  for (const k of keys.filter(k => k === 'S' || k.startsWith('S.'))) { const w = who.get(k); L.push(`- ${tick(k)} — written by ${names(w.w)} — read by ${names(w.r)}`); }
  L.push('');
  L.push('### Every other piece of state');
  L.push('');
  for (const k of keys.filter(k => !(k === 'S' || k.startsWith('S.')))) { const w = who.get(k); L.push(`- ${tick(k)} — written by ${names(w.w)} — read by ${names(w.r)}`); }
  L.push('');

  /* ── modules ── */
  L.push('## The slots');
  L.push('');
  L.push('Each `src:` or `app:` slot in the script, in order: the names it gives the script, the shell names it uses back (a module that reaches into the script it is written into), and how many shell items use it.');
  L.push('');
  for (const m of modules) {
    const users = items.filter(it => [...it.facts.modules].some(c => m.defines.includes(c.split('.')[0]))).length;
    L.push(`- ${tick(m.name)}${m.vendored ? ' (vendored, not traced)' : ''}${m.nested ? ' (inside a statement of the shell\'s, which wraps it)' : ''} — gives ${m.defines.length ? m.defines.sort().map(tick).join(' ') : 'no name this can see'}${m.back && m.back.length ? ' — uses the shell\'s ' + m.back.map(tick).join(' ') : ''} — used by ${users} item${users === 1 ? '' : 's'}${m.opaque ? ' — ' + m.opaque : ''}`);
  }
  L.push('');

  /* ── the map ── */
  L.push('## The map');
  L.push('');
  for (const sec of A.sections) {
    const total = sec.items.length + sec.subs.reduce((n, s) => n + s.items.length, 0);
    if (!total) continue;
    L.push('### ' + sec.title);
    L.push('');
    const put = e => L.push(e.module ? `- *slot:* ${tick(e.module.name)}` : entry(e.item, A));
    sec.items.forEach(put);
    if (sec.items.length) L.push('');
    for (const sub of sec.subs) {
      if (!sub.items.length) continue;
      L.push('#### ' + sub.title);
      L.push('');
      sub.items.forEach(put);
      L.push('');
    }
  }

  /* ── leftovers ── */
  L.push('## Names it could not place, and functions nothing it can see calls');
  L.push('');
  const unplaced = new Map();
  for (const it of items) for (const n of it.facts.unplaced) { if (!unplaced.has(n)) unplaced.set(n, new Set()); unplaced.get(n).add(it.name || '(load)'); }
  L.push('Used, and neither declared in the script, given by a slot, nor a name of the browser or the language this tool knows. Each is either a name another script or the build puts on `window`, or a mistake:');
  L.push('');
  if (unplaced.size) for (const n of [...unplaced.keys()].sort()) L.push(`- ${tick(n)} — in ${names(unplaced.get(n))}`);
  else L.push('*(none)*');
  L.push('');
  L.push('Functions no statement, handler, module or other function reaches by a path this can follow. Each is called some way the list above says it cannot see (a test, a string), or is dead:');
  L.push('');
  L.push(A.unreached.length ? A.unreached.sort().map(tick).join(' ') : '*(none)*');
  L.push('');
  return L.join('\n');
}

/* ── the check on the tool itself ───────────────────────────────────────────
   A script small enough to know every answer. A map is not written unless
   the analysis gives all of them. */
const FIXTURE = `<html><body><button onclick="pageTap()">x</button>
<script>
const ALL_Q=@@SLOT[payload:ALL_Q]@@;
/* ═══════════ first banner ═══════════ */
'use strict';
let S={n:0,srs:{},list:[]};
const POOL=ALL_Q.filter(q=>!q.bad);
const LIMIT=3;
const LOG=[];
@@SLOT[src:src/core/demo.js]@@
early();
window.addEventListener('x',listener);
function listener(){ writer(); }
function early(){ return pureAdd(1,2); }
function pureAdd(a,b){ return a+b+LIMIT; }
function shadow(S){ S.n=1; const LOG=[]; LOG.push(1); return S; }
function reader(){ return S.n+LOG.length; }
function rebinder(){ S={n:0,srs:{},list:[]}; }
function writer(){ S.n++; LOG.push(1); }
function aliasWriter(id){ const c=S.srs[id]||(S.srs[id]={}); c.due='x'; for(const x of S.list) x.seen=true; S.list.forEach(y=>{ y.hit=1; }); }
function drawer(){ document.title=String(reader()); return \`<b onclick="handler(1)">\${Demo.twice(2)}</b>\`; }
function handler(n){ localStorage.setItem('k',String(n)); writer(); }
function pageTap(){ drawer(); }
function viaWrapper(x){ return Demo.twice(x); }
function clocked(){ return Date.now(); }
let viewer=null;
function held(){ return viewer.close(); }
function plain(){ return LOG.map(x=>x).join(','); }
function bankReader(){ return POOL.length; }
function moduleWriter(){ Demo.keep(1); }
function moduleReader(){ return Demo.peek(); }
function moduleClock(){ return Demo.stamp(); }
function nestedWrapper(x){ return Demo.inner.twice(x); }
function nestedCall(){ Demo.inner.stamp(); }
function nestedWhole(){ return Demo.inner; }
/* ── a light banner ── */
function later(){ setTimeout(()=>writer(),0); return [1].map(v=>pureAdd(v,1)); }
const table={a(){ writer(); }};
</script></body></html>`;
const FIXTURE_MODULE = `(function (root) {
'use strict';
function twice(n) { return n * 2; }
function stamp() { return Date.now(); }
let kept = 0;
function keep(n) { kept = n; }
function peek() { return kept; }
root.Demo = { twice, stamp, keep, peek, inner: { twice, stamp } };
})(typeof window !== 'undefined' ? window : this);
`;
function selfTest() {
  const A = analyse(FIXTURE, name => { if (name === 'src/core/demo.js') return FIXTURE_MODULE; throw new Error('no such file ' + name); });
  const it = n => A.byName.get(n);
  const has = (map, name, prop) => map.has(name) && (prop === undefined || map.get(name).has(prop));
  const want = [
    ['a function that uses only a constant and its arguments is pure', it('pureAdd').tier === 'pure' && it('pureAdd').facts.consts.has('LIMIT')],
    ['a parameter and a local of the same name hide the script\'s', it('shadow').tier === 'pure' && !it('shadow').facts.writes.size && !it('shadow').facts.reads.size],
    ['a read is a read, of the property reached', has(it('reader').facts.reads, 'S', 'n') && it('reader').facts.reads.has('LOG') && !it('reader').facts.writes.size && it('reader').tier === 'reads'],
    ['a rebinding is a write of the name', it('rebinder').facts.writes.has('S') && it('rebinder').tier === 'writes'],
    ['a change through a member, and a mutating method, are writes', has(it('writer').facts.writes, 'S', 'n') && it('writer').facts.writes.has('LOG')],
    ['a change through a local name for part of the state is a write to that part', has(it('aliasWriter').facts.writes, 'S', 'srs') && has(it('aliasWriter').facts.writes, 'S', 'list')],
    ['the DOM is seen, and a module call by its member', it('drawer').facts.cats.DOM.has('document') && it('drawer').facts.modules.has('Demo.twice')],
    ['storage is seen', it('handler').facts.cats.storage.has('localStorage')],
    ['what a function calls is part of its reach: one that only calls a function that draws reaches the DOM', it('pageTap').tier === 'outside' && !it('pageTap').direct.has('DOM') && it('handler').reach.has('writes') && !it('handler').direct.has('writes')],
    ['the page\'s own markup names a handler', A.markupHandlers.has('pageTap') && !A.unreached.includes('pageTap')],
    ['a function that is one call into a module is a wrapper, and takes that member\'s reach, not the module\'s', it('viaWrapper').wrapper === 'Demo.twice' && it('viaWrapper').tier === 'pure'],
    ['the clock is not pure', it('clocked').tier === 'clock'],
    ['a member of an object inside a module is traced to its own function, not to its neighbours\'; the object used whole is all of them', it('nestedWrapper').tier === 'pure' && it('nestedCall').tier === 'clock' && it('nestedWhole').tier === 'clock'],
    ['a function that is one call into a member at any depth is a wrapper, whether it returns the call or only makes it', it('nestedWrapper').wrapper === 'Demo.inner.twice' && it('nestedCall').wrapper === 'Demo.inner.stamp' && !it('nestedWhole').wrapper],
    ['a call into a module takes what that member reaches: its clock, its own state read, its own state changed', it('moduleClock').tier === 'clock' && it('moduleReader').tier === 'reads' && it('moduleWriter').tier === 'writes'],
    ['a method of an object held in state is a call into it; a method of a list is a read', it('held').tier === 'held' && it('held').facts.opaque.has('viewer.close') && it('plain').tier === 'reads' && !it('plain').facts.opaque.size],
    ['a handler named in markup is wired, not part of the reach; what it reaches is not the builder\'s', it('drawer').facts.wires.has('handler') && !it('drawer').reach.has('storage')],
    ['a function handed to a timer runs later; one handed to map runs with the call', it('later').refs.some(r => r.name === 'writer' && r.later) && it('later').refs.some(r => r.name === 'pureAdd' && !r.later)],
    ['a call made above the function\'s text, as the script loads, is found with what it reaches', A.hoistedAtLoad.some(h => h.name === 'early') && A.hoistedAtLoad.some(h => h.name === 'pureAdd') && !A.hoistedAtLoad.some(h => h.name === 'writer')],
    ['a function only handed to a listener as the script loads does not run then', !A.hoistedAtLoad.some(h => h.name === 'listener')],
    ['a method in a table made at load does not run at load', !A.hoistedAtLoad.some(h => h.name === 'writer') && it('table').refs.some(r => r.name === 'writer' && r.later)],
    ['state is a let, or a const something changes; a const nothing changes is a constant', A.isState('S') && A.isState('LOG') && !A.isState('LIMIT')],
    ['what is made from a payload is the bank\'s data, and reading it is reading state', A.bank.has('ALL_Q') && A.bank.has('POOL') && !A.bank.has('LIMIT') && it('bankReader').facts.reads.has('POOL') && it('bankReader').tier === 'reads'],
    ['the slot is a module that gives its name', A.modules.length === 1 && A.modules[0].defines.includes('Demo')],
    ['the banners are the sections', A.sections.some(s => s.title === 'first banner' && s.subs.some(x => x.title === 'a light banner' && x.items.some(e => e.item && e.item.name === 'later')))],
    ['nothing in the fixture is left unplaced', A.items.every(i => !i.facts.unplaced.size)],
  ];
  return want.filter(w => !w[1]).map(w => w[0]);
}

function build(root = ROOT) {
  const html = fs.readFileSync(path.join(root, SHELL), 'utf8');
  return analyse(html, name => fs.readFileSync(path.join(root, name), 'utf8'));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const failed = selfTest();
  if (failed.length) {
    console.error('shell-map: the analysis got its own fixture wrong, so nothing was written:');
    failed.forEach(f => console.error('  FAIL  ' + f));
    process.exit(3);
  }
  const A = build();
  if (args[0] === '--why') {
    const it = A.byName.get(args[1]);
    if (!it) { console.error(`shell-map: no top-level name ${args[1]}`); process.exit(2); }
    console.log(entry(it, A));
    console.log(`  section: ${it.section}   line ${it.line + A.shell.lineOffset}   callers: ${[...A.callers.get(it.name)].sort().join(', ') || 'none seen'}`);
    for (const r of it.refs) console.log(`  ${String(r.line + A.shell.lineOffset).padStart(5)}  ${r.kind}${r.later ? ' later' : ''}${r.alias ? ' alias' : ''}${r.wire ? ' wire' : ''}  ${r.name}${r.prop ? '.' + r.prop : ''}${r.call ? '   (' + r.call + ')' : ''}   [${A.place(r.name)}]`);
    process.exit(0);
  }
  const text = render(A);
  const out = path.join(ROOT, OUT);
  const now = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
  if (args.includes('--json')) {
    console.log(JSON.stringify(A.items.filter(i => i.name).map(i => ({ name: i.name, kind: i.kind, section: i.section, tier: i.tier, wrapper: i.wrapper || null,
      reads: [...i.facts.reads].map(([n, p]) => [n, [...p]]), writes: [...i.facts.writes].map(([n, p]) => [n, [...p]]), calls: [...i.facts.calls], wires: [...i.facts.wires],
      modules: [...i.facts.modules], DOM: [...i.facts.cats.DOM], storage: [...i.facts.cats.storage], net: [...i.facts.cats.net], clock: [...i.facts.cats.clock] })), null, 1));
  } else if (args.includes('--write')) {
    fs.writeFileSync(out, text);
    console.log(`shell-map: wrote ${OUT} (${text.split('\n').length} lines) for script ${A.shell.digest}`);
  } else {
    const current = now === text;
    console.log(`shell-map: script ${A.shell.digest}: ${A.fnItems.length} functions and classes, ${A.items.filter(i => i.name).length - A.fnItems.length} declared names, ${A.modules.length} slots.`);
    console.log(current ? `  ${OUT} is current.` : `  ${OUT} is ${now === null ? 'missing' : 'not what this would write'}: node tools/shell-map.js --write`);
    if (args.includes('--check') && !current) process.exit(1);
  }
}

module.exports = { analyse, refsOf, itemsOf, readShell, render, selfTest, build, handlersIn };
