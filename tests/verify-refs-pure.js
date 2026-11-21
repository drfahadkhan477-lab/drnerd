#!/usr/bin/env node
/*
 * The reference library's screen — src/app/refs.js.
 *
 *   node tests/verify-refs-pure.js
 *
 * Pure Node, over invented notes. The module is given the notes and a kit and returns markup; nothing in the
 * first four parts has a page. The kit there is stand-ins: refCard(r) says which note it drew ("[card r1]"),
 * icon() says its name, and refViewed() and refsNewestFirst() answer with what this file decides, so what the
 * screen is expected to say is worked out here and never read back from the module.
 *
 * What is measured, rather than assumed:
 *   - the pager: how many the next page holds, how many are left, and nothing with none left;
 *   - the library: the newest refShown notes in the order given, the count of notes indexed, the pager,
 *     the form and its buttons, and the line that stands in for no notes;
 *   - one note on its own: that note only, the way back, no pager, the form hidden unless it is edited;
 *   - "Save changes" and Cancel while a note is edited, "Add note" otherwise;
 *   - that it reads only the length of the notes and the seven names of the kit, and changes nothing;
 *   - the page's one line: what it hands over, the actions the markup names with no inline handler, each in
 *     the page's ACTIONS table over the page's function, refCard() kept for refMore(), and that line over the
 *     page's own refCard() and the real Markdown draws a library made here, its buttons tapped through the
 *     real src/core/actions.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { blankComments } = require('./_source.js');
const M = require('../src/app/refs.js').RefsScreen;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + String(detail).replace(/\s+/g, ' ') : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);
const run = f => { try { return String(f()); } catch (err) { return 'THREW ' + err.message; } };
const g1 = (s, re) => (s.match(re) || [])[1];
const times = (html, text) => html.split(text).length - 1;

const notes = n => Array.from({ length: n }, (_, k) => ({ id: 'r' + k, title: 'Note ' + k, ts: k }));
/* refsNewestFirst() is the page's; here it gives the notes in the reverse of the order they are made in. */
const kitOf = (REF, over) => Object.assign({
  refViewed: () => null, refsNewestFirst: () => REF.slice().reverse(), refShown: 3, refEditing: null, REF_PAGE: 3,
  refCard: r => '[card ' + r.id + ']', icon: (name, cls) => '[icon ' + name + (cls ? ' ' + cls : '') + ']',
}, over);
const draw = (REF, over) => run(() => M.screenHtml(REF, kitOf(REF, over)));
const cards = html => [...html.matchAll(/\[card ([^\]]*)\]/g)].map(m => m[1]);
const label = html => g1(html, /<div class="section-label">([^<]*)<\/div>/);
/* docs/ROADMAP.md, E2. Attribute names, read tag by tag with each value consumed whole, so text inside a value is never
   taken for a name; and the actions the markup names, in the order drawn. */
const attrsOf = tag => [...tag.replace(/^<[a-z0-9-]+/i, '').matchAll(/([^\s=>"'\/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)].map(m => m[1].toLowerCase());
const inlineOf = html => [...html.matchAll(/<[a-z][^>"']*(?:("[^"]*"|'[^']*')[^>"']*)*>/gi)].flatMap(m => attrsOf(m[0])).filter(n => /^on/.test(n));
const actionsOf = html => [...html.matchAll(/data-action="([^"]*)"/g)].map(m => m[1]);
const formTag = html => g1(html, /(<div class="ref-new"[^>]*>)/);

head('the pager');
{
  ok('with more left than a page, it offers a page and says how many are left', M.pagerHtml(24, 30) === '<div class="ref-pager" id="refPager"><button class="chip" type="button" data-action="refMore">Show 24 more</button><span>30 more in your library</span></div>', M.pagerHtml(24, 30));
  ok('with fewer left than a page, it offers those', M.pagerHtml(24, 5).includes('>Show 5 more</button><span>5 more in your library</span>') && M.pagerHtml(24, 1).includes('Show 1 more'));
  ok('with none left, nothing', M.pagerHtml(24, 0) === '' && M.pagerHtml(24, -3) === '');
}

head('the library');
{
  const REF = notes(5), html = draw(REF);
  ok('the newest refShown notes, in the order the page gives them', J(cards(html)) === J(['r4', 'r3', 'r2']), J(cards(html)));
  ok('then the pager for the rest, by the page\'s size', html.includes('<div class="ref-pager" id="refPager"><button class="chip" type="button" data-action="refMore">Show 2 more</button><span>2 more in your library</span></div>') && html.indexOf('[card r2]') < html.indexOf('refPager'));
  const ten = draw(notes(10));
  ok('with more left than a page, the next page is a whole page, by the size the page gives', ten.includes('>Show 3 more</button><span>7 more in your library</span>'), g1(ten, /(Show \d+ more<\/button><span>[^<]*)/));
  ok('with every note shown, no pager', !draw(notes(3)).includes('refPager') && !draw(notes(2)).includes('refPager') && J(cards(draw(notes(2)))) === J(['r1', 'r0']));
  ok('it says how many notes are indexed: "5 notes", "1 note"', label(html) === '5 notes indexed' && label(draw(notes(1))) === '1 note indexed', label(html));
  const none = draw([]);
  ok('with no notes, a line says how to add one, and no card or pager', none.includes('No notes yet. Add one above, or import a markdown file.') && cards(none).length === 0 && !none.includes('refPager') && label(none) === '0 notes indexed', label(none));
  ok('the form is shown, with its three fields', formTag(html) === '<div class="ref-new">' && times(html, '<input id="refT"') === 1 && times(html, '<input id="refG"') === 1 && times(html, '<textarea id="refB"') === 1);
  ok('its buttons: Add note, Import, Export, Back, each by its action', J(actionsOf(g1(html, /<div class="ref-btns">([\s\S]*?)<\/div>/) || '')) === J(['refSave', 'refImportText', 'refExport', 'goHome']) && html.includes('data-action="refSave">Add note</button>'), J(actionsOf(g1(html, /<div class="ref-btns">([\s\S]*?)<\/div>/) || '')));
  ok('no way back to the library from the library', !html.includes('Show all notes') && !html.includes('Source note'));
  ok('it is named, with its icon', html.includes('<div class="hero-badge">[icon folder icon-sm] Your reference library</div>') && html.includes('>Reference Notes</div>'));
}

head('one note on its own');
{
  const REF = notes(5), one = REF[1];
  const html = draw(REF, { refViewed: () => one });
  ok('that note only, and no pager, however many there are', J(cards(html)) === J(['r1']) && !html.includes('refPager'), J(cards(html)));
  ok('headed "Source note", with the way back to study and to every note', label(html) === 'Source note' && html.includes('<div class="ref-btns"><button class="chip" data-action="goHome">Back to study</button><button class="chip" data-action="goRefs">Show all notes</button></div>'), label(html));
  ok('the form is hidden', formTag(html) === '<div class="ref-new" hidden style="display:none">', formTag(html));
  const editing = draw(REF, { refViewed: () => one, refEditing: 'r1' });
  ok('unless that note is being edited', formTag(editing) === '<div class="ref-new">', formTag(editing));
}

head('a note being edited');
{
  const html = draw(notes(2), { refEditing: 'r0' });
  ok('the button says "Save changes", and Cancel is offered', html.includes('data-action="refSave">Save changes</button>') && html.includes('data-action="refCancel">Cancel</button>'));
  ok('not otherwise', !draw(notes(2)).includes('refCancel') && draw(notes(2)).includes('>Add note</button>'));
}

head('it reads what it is given, and changes nothing');
const KIT_READS = new Set(), REF_READS = new Set();
{
  const wrote = [];
  const watched = (o, into, name) => new Proxy(o, {
    get(t, k) { if (typeof k === 'string') into.add(k); return t[k]; },
    set(t, k) { wrote.push(name + ' set ' + String(k)); return true; },
    deleteProperty(t, k) { wrote.push(name + ' delete ' + String(k)); return true; },
    defineProperty(t, k) { wrote.push(name + ' define ' + String(k)); return true; },
  });
  const REF = notes(5);
  const outs = [{}, { refViewed: () => REF[0] }, { refEditing: 'r1' }].map(o => run(() => M.screenHtml(watched(REF, REF_READS, 'REF'), watched(kitOf(REF, o), KIT_READS, 'kit'))));
  const names = s => [...s].sort().join(' ');
  ok('of the notes it reads only how many there are', !outs.some(o => o.startsWith('THREW')) && names(REF_READS) === 'length', names(REF_READS));
  ok('of the kit, seven names', names(KIT_READS) === 'REF_PAGE icon refCard refEditing refShown refViewed refsNewestFirst', names(KIT_READS));
  ok('it sets, deletes and defines nothing on either', wrote.length === 0, wrote.join(', ') || 'nothing');
  /* The page's refsNewestFirst() hands back a list of its own; a module that sorted or cut the notes where they
     stood would change the page's REF. Frozen, a write throws. */
  const ice = Object.freeze(notes(5).map(Object.freeze)), list = Object.freeze(ice.slice().reverse());
  const frozen = run(() => M.screenHtml(ice, kitOf(ice, { refsNewestFirst: () => list })));
  ok('given the notes and the list frozen, it draws the same screen', !frozen.startsWith('THREW') && frozen === draw(notes(5)), frozen.slice(0, 60));
}

head('the page hands the module what it has, and keeps what the markup names');
{
  const raw = fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8');
  const page = blankComments(raw);
  const count = text => page.split(text).length - 1;
  const SLOT = '@@SLOT[src:src/app/refs.js]@@';
  const LINE = 'function buildRefs(){ return RefsScreen.screenHtml(REF,{refViewed,refsNewestFirst,refShown,refEditing,refCard,REF_PAGE,icon}); }';
  ok('buildRefs() is one line: the notes and the kit', count(LINE) === 1 && count('function buildRefs(') === 1);
  ok('the module is written into the page once, above that line', count(SLOT) === 1 && page.indexOf(LINE) > page.indexOf(SLOT));
  const handed = String(g1(page, /RefsScreen\.screenHtml\(REF,\{([^}]*)\}\); \}/));
  ok('the kit is the seven names the module was seen to ask for, each the page\'s own under its own name', KIT_READS.size === 7 && handed.split(',').sort().join(' ') === [...KIT_READS].sort().join(' '), handed);
  ok('refPager() is no longer the page\'s; refCard() is, and refMore() still adds a page of cards with it',
     count('function refPager(') === 0 && !/[^.\w$]refPager\(/.test(page) && count('function refCard(r){') === 1 && count("pager.insertAdjacentHTML('beforebegin',next.map(refCard).join(''));") === 1);
  const looks = [...page.matchAll(/getElementById\('(refPag[^']*)'\)/g)].map(m => m[1]);
  ok('the page finds the pager by the id the module gives it, wherever it looks', looks.length >= 1 && looks.every(id => id === 'refPager') && M.pagerHtml(24, 2).includes('id="refPager"'), looks.join(' '));
  const WORDS = ['Your reference library', 'No notes yet', 'Source note', 'Show all notes', ' more in your library</span>'];
  ok('and the screen\'s own words are no longer in the page', WORDS.every(t => count(t) === 0), WORDS.map(t => count(t)).join(' '));
  const all = draw(notes(5)) + draw(notes(5), { refViewed: () => notes(5)[0] }) + draw(notes(2), { refEditing: 'r0' });
  const actions = [...new Set(actionsOf(all))].sort();
  /* The stand-in cards are the suite's; the page's own refCard() is not this module's, and keeps its handlers. */
  ok('its markup, the library, one note and a note edited, names seven actions and carries no inline handler',
     J(actions) === J(['goHome', 'goRefs', 'refCancel', 'refExport', 'refImportText', 'refMore', 'refSave']) && inlineOf(all).length === 0, actions.join(' ') + ' · ' + (inlineOf(all).join(' ') || 'no on* attribute'));
  const tableOf = name => (page.match(new RegExp('const ' + name + '=\\{([\\s\\S]*?)\\n\\};')) || [])[1] || '';
  const keyed = (t, n) => (tableOf(t).match(new RegExp('(^|\\s)' + n + ':', 'g')) || []).length;
  const entry = n => n + ':()=>' + n + '(),';
  ok('each is in the page\'s ACTIONS table once, calling the page\'s function of that name with nothing, as the handler did, and in neither of the others; each function is declared once, and the listener is installed',
     actions.length === 7 && actions.every(n => tableOf('ACTIONS').split(entry(n)).length === 2 && keyed('ACTIONS', n) === 1 && keyed('INPUT_ACTIONS', n) === 0 && keyed('CHANGE_ACTIONS', n) === 0 && count('function ' + n + '(') === 1) && count('Actions.install(document,ACTIONS);') === 1,
     actions.map(n => n + ':' + keyed('ACTIONS', n) + (tableOf('ACTIONS').split(entry(n)).length === 2 ? '' : ' (not as written)') + '/' + count('function ' + n + '(')).join(' '));
  ok('the three fields the page reads on saving are drawn, by their ids', ['refT', 'refG', 'refB'].every(id => count("getElementById('" + id + "')") >= 1 && times(all, 'id="' + id + '"') === 3), ['refT', 'refG', 'refB'].map(id => count("getElementById('" + id + "')")).join(' '));

  /* The page's own line, its own refCard(), refsNewestFirst(), refViewed() and helpers, the real Markdown, and this
     module, in a context that has nothing else. */
  const whole = (from, to) => { const a = page.indexOf(from); if (a < 0 || page.indexOf(from, a + 1) >= 0) return '\nthrow new Error("not in the page once: ' + from.replace(/["\\]/g, '') + '");\n'; const b = page.indexOf(to, a); return raw.slice(a, b + to.length); };
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const parts = [read('src/core/markdown.js'), whole('function icon(name, cls){', '\n}'), whole('const ESC={', '\n'), whole('const e=s=>', '\n'), 'function refImgSrc(){ return ""; }',
    whole('function md(t){', '\n'), whole('const REF_PAGE=', '\n'), whole('let refShown=REF_PAGE', '\n').replace(/^let /, 'var '), whole('let refEditing=null, refViewing=null;', '\n').replace(/^let /, 'var '),
    whole('function refCard(r){', '\n    </div>`;\n}'), whole('const refsNewestFirst=()=>', '\n'), whole('const refViewed=()=>', '\n'), read('src/app/refs.js'), whole('function buildRefs(){', '\n')].join('\n');
  const ctx = { REF: Array.from({ length: 30 }, (_, k) => ({ id: 'n' + k, title: k === 29 ? 'Amyloid <b>red</b> flags' : 'Note ' + k, tags: '', body: '### Head\nbody ' + k, ts: k, source: '' })) };
  ctx.window = ctx; vm.createContext(ctx);
  const ask = code => { try { return vm.runInContext(code, ctx); } catch (err) { return 'THREW ' + err.message; } };
  const loaded = ask(parts + '\n"loaded"');
  const html = String(ask('buildRefs()'));
  const titles = [...html.matchAll(/<h2 class="ref-title">([^<]*)<\/h2>/g)].map(m => m[1]);
  ok('the page\'s own line draws the newest page of the library through its own refCard(), titles escaped by its e()',
     loaded === 'loaded' && titles.length === 24 && titles[0] === 'Amyloid &lt;b&gt;red&lt;/b&gt; flags' && titles[23] === 'Note 6', String(loaded).slice(0, 60) + ' · ' + titles.length + ' · ' + titles[0]);
  ok('the real Markdown draws the body, and the pager offers the six left', html.includes('<div class="ref-body" tabindex="0" role="group" aria-label="Note content"><h3>Head</h3>') && html.includes('>Show 6 more</button><span>6 more in your library</span>') && label(html) === '30 notes indexed');
  ask('refViewing = "n3"');
  const one = String(ask('buildRefs()'));
  ok('with one note looked at, only that one, through the page\'s refViewed()', [...one.matchAll(/<h2 class="ref-title">([^<]*)<\/h2>/g)].map(m => m[1]).join() === 'Note 3' && label(one) === 'Source note');
  ask('refViewing = "gone"');
  ok('a note looked at and then deleted leaves the library, as the page\'s refViewed() says', label(String(ask('buildRefs()'))) === '30 notes indexed');

  /* A tap, as the page takes it: the real src/core/actions.js listening on a stand-in document over the page's own
     tables, with a recording stand-in for each function they call, and as the element each button the page's own line
     drew that names an action (the cards' are refCard()'s, not this screen's), in the order drawn: the library with a
     note edited, then one note looked at. */
  ask('refViewing = null; refEditing = "n0"');
  const edited = String(ask('buildRefs()'));
  ask('refViewing = "n3"; refEditing = null');
  const looked = String(ask('buildRefs()'));
  const tcalls = [];
  const tctx = { tcalls }; tctx.window = tctx; vm.createContext(tctx);
  const tables = ['ACTIONS', 'INPUT_ACTIONS', 'CHANGE_ACTIONS'].map(t => (page.match(new RegExp('const ' + t + '=\\{[\\s\\S]*?\\n\\};')) || ['const ' + t + '={};'])[0].replace(/^const /, 'var ')).join('\n');
  const called = [...new Set([...tables.matchAll(/([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]))];
  vm.runInContext(read('src/core/actions.js') + '\nvar S={chapter:null}, offlineJob={busy:false};\n'
    + called.map(n => `function ${n}(){ tcalls.push(${J(n)} + (arguments.length ? " " + JSON.stringify([].slice.call(arguments)) : "")); }`).join('\n') + '\n' + tables
    + '\nvar listeners=[]; var doc={ addEventListener:(t,f)=>listeners.push([t,f]), removeEventListener(){}, contains:()=>true };\nActions.install(doc,ACTIONS);\nActions.install(doc,INPUT_ACTIONS,"input");\nActions.install(doc,CHANGE_ACTIONS,"change");', tctx);
  const tapAll = html => { tcalls.length = 0; [...html.matchAll(/<button\b([^>]*)>/g)].forEach(m => {
    const at = Object.fromEntries([...m[1].matchAll(/([a-z-]+)="([^"]*)"/g)].map(x => [x[1], x[2]]));
    /* dataset as a browser builds it: each data-* attribute, its name in camel case (data-ref-id is refId). */
    const dataset = Object.fromEntries(Object.entries(at).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v]));
    const el = { nodeType: 1, dataset, getAttribute: k => (k in at ? at[k] : null), closest: sel => (sel === '[data-action]' && 'data-action' in at ? el : null) };
    tctx.listeners.filter(l => l[0] === 'click').forEach(l => l[1]({ type: 'click', target: el })); }); return tcalls.slice(); };
  const tapsEdited = tapAll(edited), tapsLooked = tapAll(looked);
  /* A card's Edit and Delete name actions too (refCard(), docs/ROADMAP.md, E2), each with its own note's id: worked out
     here from the cards drawn, in the order drawn, newest first. */
  const cardTaps = html => [...html.matchAll(/data-ref-id="([^"]*)" data-action="refEdit"/g)].flatMap(m => ['refEdit ' + J([m[1]]), 'refRemove ' + J([m[1]])]);
  ok('tapped through the real Actions and the page\'s tables, with a note edited: Save, Cancel, Import, Export, Back with nothing, then each card\'s Edit and Delete with its own note\'s id, then the pager',
     cardTaps(edited).length === 48 && cardTaps(edited)[0] === 'refEdit ["n29"]' && J(tapsEdited) === J(['refSave', 'refCancel', 'refImportText', 'refExport', 'goHome', ...cardTaps(edited), 'refMore']), J(tapsEdited).slice(0, 220));
  ok('and with one note looked at: the hidden form\'s, then Back to study and Show all notes, with nothing, so the whole library is shown, then that note\'s Edit and Delete',
     J(tapsLooked) === J(['refSave', 'refImportText', 'refExport', 'goHome', 'goHome', 'goRefs', 'refEdit ["n3"]', 'refRemove ["n3"]']), J(tapsLooked));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
