#!/usr/bin/env node
/*
 * One turn with the tutor: the state it changes, and who holds it — src/core/apexturn.js.
 *
 *   node tests/verify-apexturn-pure.js
 *
 * Pure Node, no browser and no build. What a turn changes was seven script-level names in the shell,
 * declared in four places. It is one object now, made by the module and held by the page as APEX_TURN,
 * and the seven old names are views of its fields: the panel's functions still say them, and so do the
 * browser suites, from inside the page. The page's own lines that make the owner and the views are cut
 * out of app/systole.html (tests/_appcut.js, the module's slot filled) and run in a vm whose `window`
 * is its global, as a page's is.
 *
 * What is measured, rather than assumed:
 *   - the state before any turn: seven fields, each what the `let` it replaces began as, and a new
 *     object and new lists on every call;
 *   - the page makes one owner, from the module, and nothing in the shell declares an old name again,
 *     which would hide the view and split the state in two without a word;
 *   - each old name reads its own field and no other, an assignment to it lands in that field, a change
 *     to the owner is seen through it, and what it holds is the owner's own list, not a copy;
 *   - the forms the page and the suites use on those names work through a view: `typeof`, `-=`,
 *     `.push()`, and a call on what the name holds.
 *
 * The browser half is every suite that waits on aiBusy or sets lastHits in the built page; none of them
 * changed when the state got its owner, which is the point of the views.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { blankComments } = require('./_source.js');
const { cut } = require('./_appcut.js');
const T = require('../src/core/apexturn.js').ApexTurn;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v, (k, x) => (x === Infinity ? 'Infinity' : x));
/* A module or a page that throws says FAIL where it was asked, and the run goes on. */
const safely = fn => { try { return fn(); } catch (e) { return 'THREW: ' + e.message; } };

/* Each old name and the field it is a view of. Written out here, not read from the page: the page is
   what is being checked against it. */
const VIEWS = { aiBusy: 'busy', aiAbort: 'abort', toolTrace: 'trace', groundedTurnLeft: 'groundedLeft', lastHits: 'hits', lastHitsKey: 'hitsKey', pendingNav: 'nav' };
const NAMES = Object.keys(VIEWS);

head('the state before any turn');
{
  const s = safely(() => T.state());
  ok('seven fields, and no other', J(Object.keys(Object(s))) === J(['busy', 'abort', 'trace', 'groundedLeft', 'hits', 'hitsKey', 'nav']), J(Object.keys(Object(s))));
  ok('nothing is on its way, and nothing to stop', s.busy === false && s.abort === null, J([s.busy, s.abort]));
  ok('no tool has run and no note is cited', Array.isArray(s.trace) && s.trace.length === 0 && Array.isArray(s.hits) && s.hits.length === 0 && s.hitsKey === null, J([s.trace, s.hits, s.hitsKey]));
  ok('nothing is queued to open', s.nav === null);
  /* A tool run outside a turn (a suite calling runTool, the self-test) must not be told its budget is spent. */
  ok('outside a turn the grounded budget is unlimited, not zero', s.groundedLeft === Infinity && !(s.groundedLeft <= 0), String(s.groundedLeft));
  const a = safely(() => T.state()), b = safely(() => T.state());
  ok('each call is a state of its own, with lists of its own', a !== b && a.trace !== b.trace && a.hits !== b.hits);
  a.trace.push(1); a.busy = true;
  ok('so one changed does not change another', b.trace.length === 0 && b.busy === false && safely(() => T.state()).trace.length === 0);
}

/* The page's own lines, in a world whose window is its global. */
const BLOCK = safely(() => cut('app/systole.html', '@@SLOT[src:src/core/apexturn.js]@@', "pendingNav:apexTurnView('nav')});", { inclusive: true }));
function page() {
  const w = {};
  w.window = w;
  vm.createContext(w);
  vm.runInContext(BLOCK, w);
  return { w, run: code => vm.runInContext(code, w), owner: () => vm.runInContext('APEX_TURN', w) };
}

/* The names a script declares with let, const or var: for each such statement, its declarators split at
   the commas that stand outside brackets and strings, and the name each one begins with. A name read on
   the right of an `=` is not declared: the first version of this matched `const nav=pendingNav;` as a
   declaration of pendingNav. Destructuring is not read; nothing in the shell destructures these names. */
function declaredNames(src) {
  const out = new Set();
  for (const m of src.matchAll(/\b(?:let|const|var)\s+/g)) {
    let i = m.index + m[0].length, depth = 0, quote = null, start = i;
    const take = (from, to) => { const id = /^\s*([A-Za-z_$][\w$]*)/.exec(src.slice(from, to)); if (id) out.add(id[1]); };
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
      else if (depth === 0 && (c === ';' || c === '\n')) break;
      else if (depth === 0 && c === ',') { take(start, i); start = i + 1; }
    }
    take(start, i);
  }
  return out;
}

head('the page makes one owner, from the module');
{
  const shell = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
  const n = text => shell.split(text).length - 1;
  ok('the lines were found in the page', typeof BLOCK === 'string' && !/^THREW/.test(BLOCK) && BLOCK.includes('function state('), String(BLOCK).slice(0, 80));
  ok('APEX_TURN is ApexTurn.state(), made once', n('const APEX_TURN=ApexTurn.state();') === 1 && n('APEX_TURN=') === 1, `${n('const APEX_TURN=ApexTurn.state();')} of that line, ${n('APEX_TURN=')} assignments to the name`);
  const slot = shell.indexOf('@@SLOT[src:src/core/apexturn.js]@@');
  ok('and the module is written into the page once, above it', slot >= 0 && shell.indexOf('@@SLOT[src:src/core/apexturn.js]@@', slot + 1) < 0 && slot < shell.indexOf('const APEX_TURN='), slot < 0 ? 'no slot' : 'slot at ' + slot);
  /* A `let aiBusy` anywhere in the script would stand in front of the view: the function below it would
     set a name of its own, the owner would never hear, and every suite waiting on the view would wait. */
  const declared = NAMES.filter(name => declaredNames(shell).has(name) || new RegExp('\\bfunction\\s+' + name + '\\b').test(shell));
  ok('nothing in the shell declares one of the old names again', declared.length === 0, declared.join(', ') || 'none declared');
  const p = safely(page);
  ok('the page\'s owner starts as the module says a state starts', p.owner && J(safely(() => p.owner())) === J(T.state()), p.owner ? J(safely(() => p.owner())) : String(p));
}

head('each old name is a view of its own field');
{
  const p = safely(page);
  const usable = !!p.owner;
  ok('the seven names are there, and are accessors on window', usable && NAMES.every(name => { const d = Object.getOwnPropertyDescriptor(p.w, name); return d && typeof d.get === 'function' && typeof d.set === 'function'; }),
     usable ? NAMES.filter(name => !Object.getOwnPropertyDescriptor(p.w, name)).join(', ') || 'all seven' : String(p));
  ok('and no eighth: every accessor the lines define is one of the seven', usable && Object.getOwnPropertyNames(p.w).filter(k => { const d = Object.getOwnPropertyDescriptor(p.w, k); return d && d.get; }).sort().join() === NAMES.slice().sort().join());
  /* Read: give every field a value no other has, and ask each name for its own. */
  const read = usable && safely(() => { const o = p.owner(); Object.keys(o).forEach(f => { o[f] = 'in:' + f; }); return NAMES.filter(name => p.run(name) !== 'in:' + VIEWS[name]); });
  ok('each name reads its own field, and no other', usable && Array.isArray(read) && read.length === 0, Array.isArray(read) ? read.join(', ') || 'all seven' : String(read));
  /* Write: assign through each name, and look at every field. */
  const q = safely(page);
  const keysBefore = q.owner ? Object.getOwnPropertyNames(q.w).sort().join() : '';
  const wrote = q.owner && safely(() => NAMES.filter(name => { q.run(name + '=' + JSON.stringify('by:' + name)); const o = q.owner(); return o[VIEWS[name]] !== 'by:' + name; }));
  ok('an assignment to a name lands in its field', Array.isArray(wrote) && wrote.length === 0, Array.isArray(wrote) ? wrote.join(', ') || 'all seven' : String(wrote));
  ok('and in no other: after all seven, each field holds what its own name was given', q.owner && J(safely(() => q.owner())) === J(Object.fromEntries(Object.values(VIEWS).map(f => [f, 'by:' + NAMES.find(k => VIEWS[k] === f)]))), q.owner ? J(safely(() => q.owner())) : '');
  ok('nothing was written beside the owner: the world has no data property of an old name', q.owner && NAMES.every(name => !('value' in (Object.getOwnPropertyDescriptor(q.w, name) || { value: 1 }))));
  /* Not only no property of an old name: no property at all. The first version looked only at the seven names,
     and passed a view that also kept a copy of each value on window under another name. */
  ok('and the seven assignments added no property to the world at all', q.owner && Object.getOwnPropertyNames(q.w).sort().join() === keysBefore,
     q.owner ? Object.getOwnPropertyNames(q.w).filter(k => !keysBefore.split(',').includes(k)).join(', ') || 'none added' : '');
  /* What a name is given is what the owner holds: the very list, so a change made to it after, by whoever handed it
     over, is the owner's change too. The first version checked only that the name and the owner agreed, which a
     view that stored a copy also passes. */
  const r = safely(page);
  ok('a list given to a name is the very list the owner holds, and the name gives that list back', r.owner && safely(() => r.run('var mine=[1]; lastHits=mine; mine.push(2); APEX_TURN.hits===mine && lastHits===mine && lastHits.length===2')) === true);
}

head('the forms the page and the suites use, through a view');
{
  const p = safely(page), usable = !!p.owner;
  ok('typeof aiBusy is not "undefined", which is what a suite waiting on it asks first', usable && safely(() => p.run('typeof aiBusy')) === 'boolean', usable ? String(safely(() => p.run('typeof aiBusy'))) : String(p));
  ok('toolTrace.push() adds to the owner\'s own list', usable && safely(() => { p.run("toolTrace.push({kind:'call',name:'x'})"); return p.owner().trace.length === 1 && p.owner().trace[0].name === 'x' && p.run('toolTrace') === p.owner().trace; }) === true);
  ok('toolTrace=[] gives the owner a new list, and the name then holds that one', usable && safely(() => { const before = p.owner().trace; p.run('toolTrace=[]'); return p.owner().trace !== before && p.owner().trace.length === 0 && p.run('toolTrace') === p.owner().trace; }) === true);
  ok('groundedTurnLeft-=n takes n from the owner\'s budget', usable && safely(() => { p.run('groundedTurnLeft=100; groundedTurnLeft-=30'); return p.owner().groundedLeft; }) === 70, usable ? String(safely(() => p.owner().groundedLeft)) : '');
  ok('lastHits=(lastHits||[]).concat(x).slice(-6) keeps the last six, in the owner', usable && safely(() => { p.run('lastHits=[1,2,3,4,5]; lastHits=(lastHits||[]).concat([6,7]).slice(-6)'); return J(p.owner().hits); }) === '[2,3,4,5,6,7]');
  ok('a call on what a name holds reaches the owner\'s object: aiAbort.abort()', usable && safely(() => { p.run('var hit=0; aiAbort={abort(){ hit++; },signal:{aborted:false}}; aiAbort.abort(); aiAbort.abort()'); return p.run('hit') === 2 && typeof p.owner().abort.abort === 'function'; }) === true);
  ok('a function in the page that sets a name sets the owner, and one that reads it reads the owner', usable && safely(() => { p.run('function setBusy(v){ aiBusy=v; } function isBusy(){ return aiBusy; }'); p.run('setBusy(true)'); const a = p.owner().busy; p.owner().busy = false; return a === true && p.run('isBusy()') === false; }) === true);
  ok('pendingNav set and cleared, as the tools and flushNav do', usable && safely(() => { p.run("pendingNav={kind:'plan',minutes:20}"); const a = J(p.owner().nav); p.run('var nav=pendingNav; pendingNav=null'); return a === '{"kind":"plan","minutes":20}' && p.owner().nav === null && p.run('nav.kind') === 'plan'; }) === true);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
