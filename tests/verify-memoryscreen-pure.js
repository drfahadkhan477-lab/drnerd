#!/usr/bin/env node
/*
 * The screen that shows what Apex has kept about the reader — src/app/memory.js.
 *
 *   node tests/verify-memoryscreen-pure.js
 *
 * Pure Node, over invented memories. The module is given the list and two helpers and returns markup;
 * nothing here has a page. The helpers it is handed below are stand-ins that say what they were asked
 * (e('x') is "E(x)"), so what is expected is worked out here from the list, never read back from the
 * module, and a helper that was not called shows as its absence.
 *
 * What is measured, rather than assumed:
 *   - four groups in one order whatever order the memories come in, a heading only for a group with
 *     something in it, and that the four are the kinds src/core/memory.js keeps;
 *   - a memory's card: its words escaped, its group's order kept, the day it was kept as the reader's
 *     calendar has it, and a Delete button that carries the id as data and never in the handler;
 *   - what is there with nothing kept, and what is there either way;
 *   - that it reads four names of a memory and changes nothing it is given;
 *   - the page's one line asks Memory for the list and hands over its own helpers; the three handlers
 *     the buttons name are the page's, and the two that delete ask first; and the page's own line, over
 *     the page's own helpers and the real Memory, draws what was kept and stops drawing what was deleted.
 *
 * A day is built from the reader's own calendar (new Date(y, m, d, h)), never from a count of
 * milliseconds, and is read back the same way. The check that a late evening is still that evening can
 * only fail where the clock is not UTC's; CI's logic job runs the pure suites a second time in New York.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { blankComments } = require('./_source.js');
const M = require('../src/app/memory.js').MemoryScreen;
const KEPT_KINDS = require('../src/core/memory.js').Memory.KINDS;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + String(detail).replace(/\s+/g, ' ') : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);

/* Stand-ins that say what they were asked. Neither writes a tag, so a button's words can be read whole. */
const KIT = Object.freeze({
  e: s => 'E(' + s + ')',
  icon: (name, cls) => '[icon ' + name + (cls ? ' ' + cls : '') + ']',
});
/* A module that throws says so in the markup, so the check that asked says FAIL and the run goes on. */
const draw = (list, kit) => { try { return String(M.screenHtml(list, kit || KIT)); } catch (err) { return 'THREW ' + err.message; } };
const mem = (id, kind, text, created) => ({ id, kind, text, created });

/* The parts of the markup a reader sees. */
const g = (s, re) => (s.match(re) || [])[1];
const cardsIn = s => s.split('<div class="ref-card">').slice(1).map(c => ({
  words: g(c, /class="ref-title"[^>]*>([^<]*)</), id: g(c, /data-memory-id="([^"]*)"/), does: g(c, /onclick="([^"]*)"/),
  says: g(c, /<button[^>]*>([^<]*)<\/button>/), kept: g(c, /class="ref-src">([^<]*)</) }));
/* [[heading, [cards]], …] in the order drawn. */
const groupsOf = html => html.split('<div class="section-label">').slice(1).map(s => [s.slice(0, s.indexOf('</div>')), cardsIn(s)]);
const handlersOf = html => [...html.matchAll(/onclick="([^"]*)"/g)].map(m => m[1]);
const buttonsOf = html => [...html.matchAll(/<button\b[^>]*\bonclick="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g)].map(m => [m[1], m[2].trim()]);
const NOTHING = 'Apex has not kept anything yet. It will as you study.';
const HEADINGS = { fact: 'E(About you)', gap: 'E(Where you keep going wrong)', preference: 'E(How you like to be taught)', session: 'E(From past sessions)' };
const ORDER = ['fact', 'gap', 'preference', 'session'];

head('four groups, in one order');
{
  const scrambled = [mem('s1', 'session', 'a session'), mem('f1', 'fact', 'a fact'), mem('p1', 'preference', 'a preference'), mem('g1', 'gap', 'a gap'), mem('f2', 'fact', 'another fact')];
  const groups = groupsOf(draw(scrambled));
  ok('the groups are About you, Where you keep going wrong, How you like to be taught, From past sessions, whatever order the memories come in',
     J(groups.map(x => x[0])) === J(ORDER.map(k => HEADINGS[k])), groups.map(x => x[0]).join(' | '));
  ok('and each memory is under its own heading', J(groups.map(x => x[1].map(c => c.id))) === J([['E(f1)', 'E(f2)'], ['E(g1)'], ['E(p1)'], ['E(s1)']]), J(groups.map(x => x[1].map(c => c.id))));
  const two = groupsOf(draw([mem('s1', 'session', 'a session'), mem('f1', 'fact', 'a fact')]));
  ok('a group with nothing in it has no heading', J(two.map(x => x[0])) === J([HEADINGS.fact, HEADINGS.session]), two.map(x => x[0]).join(' | '));
  /* What Memory keeps and what the screen shows are written in two files. A kind added to one and not the
     other is a memory that is counted, told to Apex, and cannot be seen or deleted here. */
  const each = KEPT_KINDS.map(k => groupsOf(draw([mem('x', k, 'one')])));
  ok('every kind src/core/memory.js keeps has a group of its own on the screen, and there are four',
     KEPT_KINDS.length === 4 && each.every(gs => gs.length === 1 && gs[0][1].length === 1) && new Set(each.map(gs => gs[0] && gs[0][0])).size === 4,
     KEPT_KINDS.join(' ') + ' → ' + each.map(gs => (gs[0] || ['NO GROUP'])[0]).join(' | '));
  const odd = draw([mem('o1', 'other', 'unknown kind'), mem('o2', undefined, 'no kind'), mem('o3', ['gap'], 'a list that reads as gap'), mem('o4', 'Fact', 'wrong case'), mem('f1', 'fact', 'a fact')]);
  ok('a kind is matched exactly: a memory whose kind is none of the four has no card', J(groupsOf(odd).map(x => [x[0], x[1].map(c => c.id)])) === J([[HEADINGS.fact, ['E(f1)']]]), J(groupsOf(odd).map(x => [x[0], x[1].map(c => c.id)])));
}

head('a memory, as its card');
{
  const three = groupsOf(draw([mem('f3', 'fact', 'third'), mem('f1', 'fact', 'first'), mem('f2', 'fact', 'second')]));
  ok('within a group the memories keep the order they were given in', J((three[0] || [0, []])[1].map(c => c.id)) === J(['E(f3)', 'E(f1)', 'E(f2)']), J((three[0] || [0, []])[1].map(c => c.id)));
  const card = (groupsOf(draw([mem('m7', 'gap', 'Reads constrictive as restrictive')]))[0] || [0, [{}]])[1][0] || {};
  ok('its words go through e()', card.words === 'E(Reads constrictive as restrictive)', card.words);
  ok('its Delete button carries the id as data, through e(), and says Delete', card.id === 'E(m7)' && card.says === 'Delete', card.id + ' · ' + card.says);
  ok('and the button calls memForget() with what the data holds', card.does === 'memForget(this.dataset.memoryId)', card.does);
  const hostile = draw([mem('x\');alert(1);(\'', 'fact', 'a fact'), mem('ok', 'gap', 'a gap')]);
  const allowed = ['memForget(this.dataset.memoryId)', 'memForgetAll()', 'goHome()'];
  ok('an id is never written into a handler: every handler on the screen is one of three fixed calls',
     !hostile.startsWith('THREW') && handlersOf(hostile).length === 4 && handlersOf(hostile).every(h => allowed.includes(h)), handlersOf(hostile).join(' | '));

  /* The reader's own calendar. 23:30 on the 8th of March is, in New York, 03:30 on the 9th by UTC's clock. */
  const evening = new Date(2026, 2, 8, 23, 30), small = new Date(2026, 2, 9, 0, 30);
  const want = d => 'kept E(' + d.toLocaleDateString() + ')';
  const days = (groupsOf(draw([mem('a', 'fact', 'late', evening.getTime()), mem('b', 'fact', 'early', small.getTime())]))[0] || [0, []])[1].map(c => c.kept);
  ok('the fixture\'s days are the 8th and the 9th of March 2026 on the reader\'s calendar, and read differently',
     evening.getDate() === 8 && small.getDate() === 9 && evening.getMonth() === 2 && /2026/.test(evening.toLocaleDateString()) && /(^|\D)8(\D|$)/.test(evening.toLocaleDateString()) && evening.toLocaleDateString() !== small.toLocaleDateString(),
     evening.toLocaleDateString() + ' · ' + small.toLocaleDateString());
  ok('a memory kept late in the evening is kept that day, and one kept after midnight the next', J(days) === J([want(evening), want(small)]), J(days));
  const undated = (groupsOf(draw([mem('c', 'fact', 'no date')]))[0] || [0, [{}]])[1][0] || {};
  ok('a memory with no date is given the first day the clock has, never "Invalid Date"', undated.kept === want(new Date(0)) && !/Invalid/.test(String(undated.kept)), undated.kept);
}

head('what is there with nothing kept, and what is there either way');
{
  const empty = draw([]), some = draw([mem('f1', 'fact', 'a fact')]);
  ok('with nothing kept, one line says so, and there is no heading and no card', !empty.startsWith('THREW') && empty.includes(NOTHING) && groupsOf(empty).length === 0 && cardsIn(empty).length === 0);
  ok('with something kept, that line is not there', cardsIn(some).length === 1 && !some.includes(NOTHING));
  for (const [name, html] of [['with nothing kept', empty], ['with something kept', some]]) {
    const b = buttonsOf(html).filter(x => x[0] !== 'memForget(this.dataset.memoryId)');
    ok(`${name}: the screen is named, and "Forget everything" and "Back" are there`,
       html.includes('<div class="hero-badge">[icon book icon-sm] What Apex remembers</div>') && html.includes('<div class="hero-title" style="font-size:28px">Memory</div>')
       && J(b) === J([['memForgetAll()', 'Forget everything'], ['goHome()', '[icon arrow-left icon-sm] Back']]), J(b));
  }
  ok('and how to add a memory is said', empty.includes('<div class="ref-hint">To add one, just tell Apex') && some.includes('<div class="ref-hint">To add one, just tell Apex'));
}

head('it reads what it is given, and changes nothing');
{
  const read = new Set(), wrote = [];
  const watched = m => new Proxy(m, {
    get(t, k) { if (typeof k === 'string') read.add(k); return t[k]; },
    set(t, k) { wrote.push('set ' + String(k)); return true; },
    deleteProperty(t, k) { wrote.push('delete ' + String(k)); return true; },
    defineProperty(t, k) { wrote.push('define ' + String(k)); return true; },
  });
  /* The gap first: a module that put the list in order where it stood would move it. */
  const list = () => [Object.assign(mem('g1', 'gap', 'a gap', 2000), { src: 'summary' }), Object.assign(mem('f1', 'fact', 'a fact', 1000), { src: 'tool', said: true, seen: 3 })];
  const html = draw(list().map(watched));
  ok('of a memory it asks for its id, its kind, its words and when it was kept, and nothing else', !html.startsWith('THREW') && J([...read].sort()) === J(['created', 'id', 'kind', 'text']), [...read].sort().join(' '));
  ok('it sets, deletes and defines nothing on one', !html.startsWith('THREW') && wrote.length === 0, wrote.join(', ') || 'nothing');
  /* Frozen all the way down: in a strict module a write throws, and draw() then says THREW. */
  const frozen = draw(Object.freeze(list().map(Object.freeze)), KIT), loose = draw(list(), Object.assign({}, KIT));
  ok('given the list, the memories and the helpers frozen, it draws the same screen', !frozen.startsWith('THREW') && frozen === loose && cardsIn(frozen).length === 2, frozen.slice(0, 80));
  const before = list(), given = list(); draw(given);
  ok('and the list is as it was: the same memories, in the same order', J(given) === J(before));
}

head('the page asks Memory for the list and hands over its own helpers');
{
  /* Read with its comments blanked: the page explains itself, and quotes what is looked for. Positions are
     kept, so code found in the blanked copy is taken from the real one. */
  const raw = fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8');
  const page = blankComments(raw);
  const count = text => page.split(text).length - 1;
  const LINE = 'function buildMemory(){ return MemoryScreen.screenHtml((typeof Memory!==\'undefined\')?Memory.all():[],{e,icon}); }';
  ok('buildMemory() is one line: what Memory has, or nothing on a page with no Memory, and the two helpers', count(LINE) === 1 && count('function buildMemory(') === 1, `${count(LINE)} such line(s), ${count('function buildMemory(')} declaration(s)`);
  const slot = page.indexOf('@@SLOT[src:src/app/memory.js]@@');
  ok('the module is written into the page once, above that line', slot >= 0 && count('@@SLOT[src:src/app/memory.js]@@') === 1 && page.indexOf(LINE) > slot, slot < 0 ? 'no slot' : 'slot at ' + slot);
  ok('and the screen\'s own words are no longer in the page', count('What Apex remembers') === 0 && count('has not kept anything') === 0 && count('How you like to be taught') === 0,
     ['What Apex remembers', 'has not kept anything', 'How you like to be taught'].map(t => count(t)).join(' '));

  const handlers = [...new Set(handlersOf(draw([mem('f1', 'fact', 'a fact')])).map(h => (h.match(/^[A-Za-z_$][\w$]*/) || ['NO NAME'])[0]))].sort();
  ok('its buttons name three handlers', J(handlers) === J(['goHome', 'memForget', 'memForgetAll']), handlers.join(' '));
  ok('and each is a function the page declares, once', handlers.length > 0 && handlers.every(n => count('function ' + n + '(') === 1), handlers.map(n => n + ':' + count('function ' + n + '(')).join(' '));
  /* The module's header says the two that delete ask first. That is the page's to keep, so it is held here. */
  ok('Delete asks before it deletes, then draws the screen again',
     count('function memForget(id){\n  if(!confirm(\'Delete this memory? Apex will stop knowing it.\'))return;\n  Memory.remove(id); render();\n}') === 1);
  ok('"Forget everything" does nothing with nothing kept, asks before it clears, then draws the screen again and says so',
     count('function memForgetAll(){\n  if(!Memory.count())return;\n  if(!confirm(\'Forget everything Apex knows about you? This cannot be undone.\'))return;\n  Memory.clear(); render(); toast(\'Apex has forgotten everything.\');\n}') === 1);

  /* The page's own helpers and its own line, with the real Memory and this module where their slots stand,
     in a context that has nothing else: what the reader is shown, less the page. Memory has no storage
     here, so it starts with nothing kept. */
  const whole = (from, to) => { const a = page.indexOf(from); if (a < 0 || page.indexOf(from, a + 1) >= 0) return '\nthrow new Error("not in the page once: ' + from.replace(/["\\]/g, '') + '");\n'; const b = page.indexOf(to, a); return raw.slice(a, b + to.length); };
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const helpers = [whole('function icon(name, cls){', '\n}'), whole('const ESC={', '\n'), whole('const e=s=>', '\n')].join('\n');
  const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
  const ask = code => { try { return vm.runInContext(code, ctx); } catch (err) { return 'THREW ' + err.message; } };
  ask(helpers + '\n' + read('src/core/memory.js') + '\n' + read('src/app/memory.js') + '\n' + LINE);
  const none = String(ask('buildMemory()'));
  ok('with nothing kept, the page\'s own line draws the empty screen', !none.startsWith('THREW') && none.includes(NOTHING) && cardsIn(none).length === 0, none.slice(0, 90));
  ask('Memory.add("Reads <b>constrictive</b> as \\"restrictive\\"", "gap"); Memory.add("Sits boards in October", "fact");');
  const kept = ask('Memory.all().map(m => ({ id: m.id, kind: m.kind }))');
  const shown = String(ask('buildMemory()')), groups = groupsOf(shown);
  ok('what Memory has kept is drawn, About you before Where you keep going wrong though the gap was kept first',
     Array.isArray(kept) && kept.length === 2 && J(groups.map(x => x[0])) === J(['About you', 'Where you keep going wrong']) && groups.every(x => x[1].length === 1), J(groups.map(x => x[0])));
  const gap = ((groups[1] || [0, []])[1][0]) || {}, gapId = Array.isArray(kept) ? (kept.find(m => m.kind === 'gap') || {}).id : null;
  ok('a memory\'s words are escaped by the page\'s e(), and its button carries Memory\'s own id for it',
     gap.words === 'Reads &lt;b&gt;constrictive&lt;/b&gt; as &quot;restrictive&quot;' && !shown.includes('<b>') && !!gapId && gap.id === String(gapId), gap.words + ' · ' + gap.id);
  ok('and the icons are the page\'s', shown.includes('<svg class="icon icon-sm" aria-hidden="true"><use href="#i-book"></use></svg> What Apex remembers') && shown.includes('<use href="#i-arrow-left">'));
  ask('Memory.remove(' + J(gapId) + ')');
  const after = groupsOf(String(ask('buildMemory()')));
  ok('a memory removed from Memory is gone from the next drawing, and the other stays', J(after.map(x => x[0])) === J(['About you']) && after[0][1].length === 1, J(after.map(x => x[0])));
  ask('Memory.clear()');
  ok('and with Memory cleared the screen is the empty one again', String(ask('buildMemory()')).includes(NOTHING));

  /* A page with no Memory at all: the line's own guard, which the page had before the screen moved. */
  const bare = {}; bare.window = bare; vm.createContext(bare);
  let lone; try { vm.runInContext(helpers + '\n' + read('src/app/memory.js') + '\n' + LINE, bare); lone = String(vm.runInContext('buildMemory()', bare)); } catch (err) { lone = 'THREW ' + err.message; }
  ok('on a page with no Memory the line draws the empty screen rather than throwing', !lone.startsWith('THREW') && lone.includes(NOTHING), lone.slice(0, 90));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
