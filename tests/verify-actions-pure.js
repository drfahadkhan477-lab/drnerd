#!/usr/bin/env node
/*
 * One delegated listener in place of inline handlers — src/core/actions.js (docs/ROADMAP.md, E2).
 *
 *   node tests/verify-actions-pure.js
 *
 * Pure Node, over stand-in elements: each has the attributes it was given, a parent, and closest() and contains()
 * worked out from those here, so which element a tap should reach is decided by this file and never read back from
 * the module. The browser suites that tap a moved screen through the real page (verify-memory, verify-backup-ids)
 * hold the rest: that the document's own events arrive.
 *
 * What is measured, rather than assumed:
 *   - install() adds one listener of the type asked for (a click unless told) to the root, and what it returns removes
 *     that listener and no other;
 *   - a tap on an element with data-action, or on anything inside one, calls that action with the element and the
 *     event, once; the nearest such element wins; a text node's element is its parent;
 *   - nothing is called for a tap outside every data-action, for one outside the root, for a name the table does not
 *     have as its own function (a name every object inherits included), or for an empty name;
 *   - find() says which element a tap would act for, and nothing changes the table or the element;
 *   - asked to capture, it listens as the event goes down, and what it returns removes that listener; asked to act only
 *     for the element the event is on, an event on something inside an element with data-action calls nothing;
 *   - no on* attribute is left in the shell or in any module under src/, read with comments blanked, by a scan seen to
 *     find one written as they write markup and to pass over a handler set by script, a comment and a word that starts
 *     with "on".
 */
'use strict';
const { Actions } = require('../src/core/actions.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + String(detail).replace(/\s+/g, ' ') : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);

/* A stand-in element: its attributes, its parent, and the two DOM methods the module uses, answered by walking up. */
function node(name, attrs, parent) {
  const el = { nodeType: 1, name, attrs: attrs || {}, parentNode: parent || null,
    getAttribute: k => (k in el.attrs ? el.attrs[k] : null),
    closest(sel) { const m = sel.match(/^\[([a-z-]+)\]$/); for (let x = el; x && x.nodeType === 1; x = x.parentNode) if (m && m[1] in x.attrs) return x; return null; },
    contains(other) { for (let x = other; x; x = x.parentNode) if (x === el) return true; return false; } };
  return el;
}
/* A root that records its listeners, so a tap can be dispatched to what was installed and removal can be seen. */
function rootNode(parent) {
  const r = node('root', {}, parent);
  r.listeners = [];
  /* As the DOM keeps them: a listener is its type, its function and whether it captures, and removing one names all three. */
  r.addEventListener = (type, fn, capture) => r.listeners.push([type, fn, !!capture]);
  r.removeEventListener = (type, fn, capture) => { r.listeners = r.listeners.filter(l => !(l[0] === type && l[1] === fn && l[2] === !!capture)); };
  /* As the DOM dispatches: an error in a listener is reported, and the dispatch, and the caller, carry on. */
  r.errors = [];
  r.tap = (target, type = 'click') => { const ev = { type, target }; r.listeners.filter(l => l[0] === type).forEach(l => { try { l[1](ev); } catch (err) { r.errors.push(err.message); } }); return ev; };
  return r;
}

const calls = [];
const table = {
  go: (el, ev) => calls.push(['go', el.name, ev.type]),
  forget: el => calls.push(['forget', el.getAttribute('data-id')]),
  notFn: 'a string',
};

head('install');
{
  const r = rootNode();
  const off = Actions.install(r, table);
  ok('adds one listener to the root, for clicks when no type is given', r.listeners.length === 1 && r.listeners[0][0] === 'click', J(r.listeners.map(l => l[0])));
  const r2 = rootNode();
  Actions.install(r2, table, 'change');
  ok('or for the type it is given', r2.listeners.length === 1 && r2.listeners[0][0] === 'change');
  const other = () => {};
  r.addEventListener('click', other);
  off();
  ok('and what it returns removes that listener, and leaves another on the root alone', r.listeners.length === 1 && r.listeners[0][1] === other, r.listeners.length + ' left');
}

head('a tap');
{
  const r = rootNode();
  Actions.install(r, table);
  const btn = node('button', { 'data-action': 'go' }, r);
  calls.length = 0;
  const ev = r.tap(btn);
  ok('on an element with data-action calls that action once, with the element and the event', J(calls) === J([['go', 'button', 'click']]) && r.errors.length === 0, J(calls) + ' ' + r.errors.join(' '));
  const svg = node('svg', {}, node('span', {}, btn));
  calls.length = 0; r.tap(svg);
  ok('on something inside it calls the same action, for the element that names it', J(calls) === J([['go', 'button', 'click']]), J(calls));
  calls.length = 0; r.tap({ nodeType: 3, parentNode: svg });
  ok('on a text node inside it, through the text node\'s element', J(calls) === J([['go', 'button', 'click']]), J(calls));
  const inner = node('button', { 'data-action': 'forget', 'data-id': 'm7' }, node('div', { 'data-action': 'go' }, r));
  calls.length = 0; r.tap(inner);
  ok('the nearest element with data-action wins, and its action reads its own data', J(calls) === J([['forget', 'm7']]), J(calls));
  calls.length = 0; r.tap(node('p', {}, r)); r.tap(r);
  ok('nothing for a tap outside every data-action, the root itself included', calls.length === 0, J(calls));
  void ev;
}

head('what it will not call');
{
  const r = rootNode();
  Actions.install(r, table);
  const tried = [];
  for (const name of ['nope', 'notFn', '', 'constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    calls.length = 0;
    let threw = null;
    r.errors.length = 0;
    try { r.tap(node('button', { 'data-action': name }, r)); } catch (err) { threw = err.message; }
    tried.push([name, calls.length, threw || r.errors[0] || null]);
  }
  ok('a name the table does not have, one that is not a function, an empty one, or one every object inherits: nothing is called and nothing throws',
     tried.every(t => t[1] === 0 && t[2] === null), J(tried.filter(t => t[1] || t[2])));
  const outside = node('button', { 'data-action': 'go' }, null);
  calls.length = 0; r.tap(outside);
  ok('nor for an element outside the root', calls.length === 0, J(calls));
  const ownTable = Object.create({ inherited: () => calls.push(['inherited']) });
  const r2 = rootNode();
  Actions.install(r2, ownTable);
  calls.length = 0; r2.tap(node('button', { 'data-action': 'inherited' }, r2));
  ok('nor for a function the table only inherits: the table\'s own names are the allowlist', calls.length === 0, J(calls));
}

head('capture, and only the element itself');
{
  const r = rootNode();
  Actions.install(r, table);
  ok('without options, the listener does not capture', r.listeners.length === 1 && r.listeners[0][2] === false, J(r.listeners.map(l => l.slice(0, 1).concat(l[2]))));
  const r2 = rootNode();
  const off = Actions.install(r2, table, 'scroll', { capture: true, own: true });
  ok('asked to capture, one listener of that type, capturing', r2.listeners.length === 1 && r2.listeners[0][0] === 'scroll' && r2.listeners[0][2] === true, J(r2.listeners.map(l => [l[0], l[2]])));
  const pane = node('div', { 'data-action': 'go' }, r2), inner = node('div', {}, pane), deeper = node('p', {}, inner);
  calls.length = 0;
  r2.tap(pane, 'scroll');
  ok('a scroll on the element with data-action calls its action, with the element and the event', J(calls) === J([['go', 'div', 'scroll']]), J(calls));
  calls.length = 0;
  r2.tap(inner, 'scroll'); r2.tap(deeper, 'scroll');
  ok('a scroll on something inside it calls nothing: it is not the element that scrolled', J(calls) === J([]) && r2.errors.length === 0, J(calls));
  const r3 = rootNode();
  Actions.install(r3, table, 'scroll', { capture: true });
  const pane3 = node('div', { 'data-action': 'go' }, r3), inner3 = node('div', {}, pane3);
  calls.length = 0;
  r3.tap(inner3, 'scroll');
  ok('without own, an event inside it still reaches the nearest one, as a tap does', J(calls) === J([['go', 'div', 'scroll']]), J(calls));
  off();
  ok('and what it returns removes the capturing listener', r2.listeners.length === 0, r2.listeners.length + ' left');
}

head('find');
{
  const r = rootNode();
  const btn = node('button', { 'data-action': 'go' }, r);
  const child = node('i', {}, btn);
  ok('find() gives the element a listener on the root would act for, or null', Actions.find(child, r) === btn && Actions.find(btn, r) === btn && Actions.find(node('p', {}, r), r) === null && Actions.find(node('button', { 'data-action': 'go' }), r) === null && Actions.find(null, r) === null);
  const deep = o => { Object.values(o).forEach(v => v && typeof v === 'object' && Object.freeze(v)); return Object.freeze(o); };
  const frozenTable = deep({ go: el => calls.push(['frozen', el.name]) });
  const r2 = rootNode();
  Actions.install(r2, frozenTable);
  const fb = node('button', { 'data-action': 'go' }, r2); Object.freeze(fb.attrs); Object.freeze(fb);
  calls.length = 0;
  let threw = null; try { r2.tap(fb); } catch (err) { threw = err.message; }
  ok('a frozen table and a frozen element: the action is called, nothing is written', threw === null && J(calls) === J([['frozen', 'button']]), threw || J(calls));
}

head('no inline handler is left in what the app is built from');
{
  /* docs/ROADMAP.md, E2: when no on* attribute is left in the markup the app writes, the split build can ship a script-src
     that refuses one (scripts/csp.js, scriptPolicy). Read here: the shell and every module under src/, each with its
     comments blanked (tests/_source.js), since the comments quote the very attributes looked for. An attribute is a name
     with a space before it and a value after it that opens with a quote or with ${...}; a handler set by script
     (el.onclick=...) has a dot before it and is not one. */
  const fs = require('fs'), path = require('path');
  const { blankComments } = require('./_source.js');
  const ROOT = path.join(__dirname, '..');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(x => x.isDirectory() ? walk(path.join(d, x.name)) : /\.js$/.test(x.name) ? [path.join(d, x.name)] : []);
  const files = [path.join(ROOT, 'app', 'systole.html'), ...walk(path.join(ROOT, 'src'))];
  const ATTR = /\son[a-z]{3,}\s*=\s*(?:\\?["'`]|\$\{)/gi;
  const hits = text => { const out = []; const b = blankComments(text); let m; ATTR.lastIndex = 0;
    while ((m = ATTR.exec(b))) out.push((b.slice(0, m.index).match(/\n/g) || []).length + 1 + ': ' + m[0].trim()); return out; };
  /* The scan, seen to find what it is there to find, on lines shaped as the app writes them. */
  const SHOULD = ['<button onclick="go()">', "x+'<a onclick=\\\"go()\\\">'", '<img src="${u}" onerror=${bad}>', "html=`<div onkeydown='k(event)'>`"];
  const SHOULD_NOT = ['el.onclick=()=>go();', 'img.onerror = fallback;', '// <button onclick="go()">', '/* onclick="go()" */', 'const ion=1;', 'data-action="goOn"', 'aria-label="Turn on"'];
  ok('the scan finds an inline handler written as the shell and the modules write markup',
     SHOULD.every(t => hits(t).length === 1), SHOULD.map(t => hits(t).length).join(' '));
  ok('and nothing that is not one: a handler set by script, a comment, a word that starts with "on"',
     SHOULD_NOT.every(t => hits(t).length === 0), SHOULD_NOT.map(t => t + ':' + hits(t).length).join(' | '));
  const found = files.flatMap(f => hits(fs.readFileSync(f, 'utf8')).map(h => path.relative(ROOT, f) + ':' + h));
  ok('no on* attribute in the shell or in any module under src/ (' + files.length + ' files read)', files.length > 20 && found.length === 0, found.slice(0, 6).join(' | ') || 'none');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
