#!/usr/bin/env node
/*
 * Echo Studio's wiring — src/app/echoscreen.js.
 *
 *   node tests/verify-echoscreen-pure.js
 *
 * Pure Node, over a document of its own: elements that keep their attributes and say when they are focused, a
 * document that keeps the listeners it is given and finds elements by the few selectors the wiring asks for, and an
 * EchoUI and a render() that say what they were asked. What each listener should do is worked out here by hand.
 *
 * What is measured, rather than assumed:
 *   - install() adds four listeners, two for a tap, one for a key and one for typing, in that order, and nothing else;
 *   - a tap on a tab chooses it through EchoUI's tabId, on a disease chooses that, draws the screen again and puts
 *     focus on the control of that name in the new markup; a tap on anything else does nothing;
 *   - a tap on a phase button, or on something inside one, chooses that phase, shows the cycle in it, and presses that
 *     button alone; with no cycle on the screen the buttons are still pressed;
 *   - the arrow keys, Home and End move focus along the tabs, round at the ends, and stop the browser's own handling;
 *     the tab under focus is the only one reached by Tab; any other key, or a key on something that is no tab, does
 *     nothing;
 *   - typing a number keeps it as a number, under its field's name; anything that is no finite number, an empty field
 *     among them, forgets the field rather than keeping a nought; and the results alone are repainted;
 *   - repaint() draws the results block from the fields, and does nothing where there is no block;
 *   - the screen is EchoUI's once it is there; before, the split build's file is added once and the screen says it is
 *     loading; a load that ends is ready, or failed (an error, or a file without EchoUI), and a failed one is taken out
 *     and said, with a Retry; the screen is drawn again only if the page is still on Echo; the way in lets a failed
 *     load go, so it is tried again, and leaves any other;
 *   - the page: the module is written into the page's own script once, after the two slots the split build lifts and not
 *     between them; buildEchoScreen(), goEcho() and echoRepaintResults() are one line each into it, the load is the
 *     module's and the page keeps none of its own; the page installs it once and adds no Echo listener of
 *     its own; and, through the page's own lines, ECHO_ENV hands the wiring the page's ECHO, EchoUI once it is there,
 *     render() and the repaint, and the way in and the load the page's S, document and window.ECHO_SRC.
 *
 * verify-echo is the browser half: it cuts this out of the page with the rest of Echo's glue and drives it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { blankComments } = require('./_source.js');
const E = require('../src/app/echoscreen.js').EchoScreen;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + String(detail).replace(/\s+/g, ' ') : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);
const run = f => { try { return f(); } catch (err) { return 'THREW ' + err.message; } };

/* The selectors the wiring asks for: [a], [a="v"], .c, and lists of them. */
const matches = (el, sel) => sel.split(',').some(p => { p = p.trim(); let m;
  if ((m = /^\[([a-z-]+)="([^"]*)"\]$/.exec(p))) return el.attrs[m[1]] === m[2];
  if ((m = /^\[([a-z-]+)\]$/.exec(p))) return m[1] in el.attrs;
  if ((m = /^\.([a-z-]+)$/.exec(p))) return el.cls === m[1];
  return false; });

/* A screen: three tabs in a bar, two diseases, two phase buttons (one with an icon inside it), three fields, and,
   where asked, the results block and the cycle. render() draws it again, as new elements, when asked to. */
const screen = (o = {}) => {
  const log = []; let els = [], gen = 0;
  const el = (attrs, cls, parent) => {
    const x = { attrs: Object.assign({}, attrs), cls, parentNode: parent || null, tabIndex: 0, innerHTML: '-', value: '', gen };
    x.hasAttribute = a => a in x.attrs; x.getAttribute = a => (a in x.attrs ? x.attrs[a] : null);
    x.setAttribute = (a, v) => { x.attrs[a] = String(v); };
    x.matches = s => matches(x, s);
    x.closest = s => { for (let y = x; y; y = y.parentNode) if (matches(y, s)) return y; return null; };
    x.focus = () => log.push('focus ' + Object.entries(x.attrs).map(([k, v]) => k + '=' + v).join() + ' (drawing ' + x.gen + ')');
    return x;
  };
  const draw = () => {
    const bar = el({}, 'echo-tabs'); bar.querySelectorAll = s => els.filter(x => x.parentNode === bar && matches(x, s));
    const phase = ['diastole', 'systole'].map(p => el({ 'data-echo-phase': p, 'aria-pressed': 'false' }));
    els = [bar, ...['reference', 'calculator', 'visual'].filter(t => !(gen > 0 && o.dropOnRedraw === t)).map(t => el({ 'data-echo-tab': t }, '', bar)),
      ...['dcm', 'hcm'].map(d => el({ 'data-echo-disease': d })), ...phase, el({}, 'echo-icon', phase[1]),
      ...['lvotD', 'vti', 'ivc'].map(f => el({ 'data-echo-field': f })), el({ 'data-action': 'goHome' })];
    if (!o.noOut) els.push(el({}, 'echo-out'));
    if (!o.noCycle) els.push(el({}, 'echo-cycle'));
  };
  draw();
  const listeners = [];
  const doc = { addEventListener: (t, f) => listeners.push([t, f]), querySelector: s => els.find(x => matches(x, s)) || null,
    querySelectorAll: s => els.filter(x => matches(x, s)) };
  const ECHO = { tab: 'reference', disease: null, fields: { lvotD: 1.9 } };
  const env = { echo: () => ECHO, ui: () => ({ tabId: t => 'id:' + t, resultsHtml: f => 'results ' + J(f) }),
    render: () => { log.push('render'); if (o.redraw) { gen++; draw(); } }, repaint: () => log.push('repaint') };
  const find = (a, v) => els.find(x => x.attrs[a] === v), cls = c => els.find(x => x.cls === c);
  const fire = (type, ev) => { ev.preventDefault = () => log.push('preventDefault'); listeners.filter(l => l[0] === type).forEach(l => l[1](ev)); return ev; };
  return { log, doc, ECHO, env, listeners, find, cls, fire, els: () => els };
};
const installed = o => { const s = screen(o); run(() => E.install(s.doc, s.env)); return s; };

head('install(): four listeners on the document, once');
{
  const s = screen(), r = run(() => E.install(s.doc, s.env));
  ok('two for a tap, one for a key, one for typing, in that order, and nothing else asked of the page', r === undefined && J(s.listeners.map(l => l[0])) === J(['click', 'click', 'keydown', 'input']) && s.log.length === 0,
     J([r, s.listeners.map(l => l[0]), s.log]));
}

head('a tap on a tab or a disease');
{
  const s = installed({ redraw: true });
  s.fire('click', { target: s.find('data-echo-tab', 'calculator') });
  ok('a tab is chosen through EchoUI\'s tabId, the screen drawn again, and focus put on that tab in the new drawing',
     s.ECHO.tab === 'id:calculator' && J(s.log) === J(['render', 'focus data-echo-tab=calculator (drawing 1)']), J([s.ECHO.tab, s.log]));
  s.log.length = 0; s.fire('click', { target: s.find('data-echo-disease', 'hcm') });
  ok('a disease is chosen as it is named, the tab left, and focus put on it in the new drawing',
     s.ECHO.disease === 'hcm' && s.ECHO.tab === 'id:calculator' && J(s.log) === J(['render', 'focus data-echo-disease=hcm (drawing 2)']), J([s.ECHO, s.log]));
  const n = installed();
  n.fire('click', { target: n.find('data-echo-tab', 'visual') });
  ok('where drawing again leaves the same markup, focus goes back to the control tapped', n.ECHO.tab === 'id:visual' && J(n.log) === J(['render', 'focus data-echo-tab=visual (drawing 0)']),
     J(n.log));
  const g = installed({ redraw: true, dropOnRedraw: 'visual' });
  const rg = run(() => g.fire('click', { target: g.find('data-echo-tab', 'visual') }));
  ok('where the new drawing has no control of that name, the screen is drawn and nothing focused', typeof rg === 'object' && g.ECHO.tab === 'id:visual' && J(g.log) === J(['render']),
     J([typeof rg === 'object' ? 'ran' : rg, g.log]));
  const q = installed(), before = J(q.ECHO);
  [q.find('data-action', 'goHome'), q.find('data-echo-field', 'vti'), null, {}].forEach(t => run(() => q.fire('click', { target: t })));
  ok('a tap on anything else, on nothing, or on a node that cannot look up its ancestors, does nothing', J(q.ECHO) === before && J(q.log) === J([]), J([q.ECHO, q.log]));
}

head('a tap on a phase');
{
  const s = installed();
  s.fire('click', { target: s.find('data-echo-phase', 'systole') });
  const pressed = () => s.els().filter(x => 'data-echo-phase' in x.attrs).map(x => x.attrs['data-echo-phase'] + ':' + x.attrs['aria-pressed']);
  ok('the phase is chosen, the cycle shown in it, and that button alone pressed', s.ECHO.phase === 'systole' && s.cls('echo-cycle').attrs['data-phase'] === 'systole' && J(pressed()) === J(['diastole:false', 'systole:true']),
     J([s.ECHO.phase, s.cls('echo-cycle').attrs, pressed()]));
  s.fire('click', { target: s.find('data-echo-phase', 'diastole') });
  ok('another phase moves both', s.ECHO.phase === 'diastole' && s.cls('echo-cycle').attrs['data-phase'] === 'diastole' && J(pressed()) === J(['diastole:true', 'systole:false']), J(pressed()));
  s.fire('click', { target: s.cls('echo-icon') });
  ok('a tap on the icon inside a button is a tap on the button', s.ECHO.phase === 'systole' && J(pressed()) === J(['diastole:false', 'systole:true']), J([s.ECHO.phase, pressed()]));
  const n = installed({ noCycle: true }), r = run(() => n.fire('click', { target: n.find('data-echo-phase', 'systole') }));
  ok('with no cycle on the screen, the phase is still chosen and its button pressed', typeof r === 'object' && n.ECHO.phase === 'systole' && n.find('data-echo-phase', 'systole').attrs['aria-pressed'] === 'true', String(r && r.target ? 'ran' : r));
  ok('and neither tap draws the screen again', s.log.length === 0 && n.log.length === 0, J([s.log, n.log]));
}

head('keys on the tabs');
{
  /* From each tab, each key: where focus goes, and the tab order the tabs are left in. */
  const press = (from, key) => { const s = installed(); const ev = s.fire('keydown', { target: s.find('data-echo-tab', from), key });
    const tabs = s.els().filter(x => 'data-echo-tab' in x.attrs);
    return { log: s.log.join(' | '), order: tabs.map(t => t.tabIndex).join('') }; };
  const f = t => 'focus data-echo-tab=' + t + ' (drawing 0)';
  const moved = [press('reference', 'ArrowRight'), press('visual', 'ArrowRight'), press('reference', 'ArrowLeft'), press('calculator', 'ArrowLeft'), press('calculator', 'Home'), press('reference', 'End')];
  ok('right and left move focus one tab along, round at either end', J(moved.slice(0, 4).map(m => m.log)) === J(['preventDefault | ' + f('calculator'), 'preventDefault | ' + f('reference'), 'preventDefault | ' + f('visual'), 'preventDefault | ' + f('reference')]),
     J(moved.slice(0, 4).map(m => m.log)));
  ok('Home goes to the first tab and End to the last', moved[4].log === 'preventDefault | ' + f('reference') && moved[5].log === 'preventDefault | ' + f('visual'), J([moved[4].log, moved[5].log]));
  /* Each tab's tabIndex, in order: 0 for the one focus lands on, -1 for the others. */
  ok('and the tab focus lands on is the only one Tab reaches', J(moved.map(m => m.order)) === J(['-10-1', '0-1-1', '-1-10', '0-1-1', '0-1-1', '-1-10']),
     J(moved.map(m => m.order)));
  const still = [press('calculator', 'Enter'), press('calculator', ' '), press('calculator', 'a'), press('calculator', 'ArrowDown')];
  ok('Enter, Space, a letter and the up and down arrows are left to the browser: nothing moves, nothing is stopped', still.every(m => m.log === '' && m.order === '000'), J(still));
  const s = installed();
  [{ target: s.find('data-echo-field', 'vti'), key: 'ArrowRight' }, { target: s.find('data-echo-disease', 'dcm'), key: 'Home' }, { target: null, key: 'End' }, { target: {}, key: 'End' }]
    .forEach(ev => run(() => s.fire('keydown', ev)));
  ok('a key on a field, a disease, nothing, or a node that cannot be matched, does nothing', s.log.length === 0, J(s.log));
}

head('typing in a field');
{
  const typed = (field, value) => { const s = installed(); const el = s.find('data-echo-field', field); el.value = value;
    s.fire('input', { target: el }); return { fields: s.ECHO.fields, log: s.log.join(' | ') }; };
  const numbers = [['vti', '21'], ['vti', '2.1'], ['vti', ' 3 '], ['vti', '1e3'], ['vti', '.5'], ['vti', '0'], ['vti', '2.1.3'], ['vti', '4 cm']].map(([f, v]) => typed(f, v));
  ok('a number is kept as a number, under its field\'s name, beside what was there; what parseFloat reads from the front of it is what is kept',
     J(numbers.map(n => n.fields.vti)) === J([21, 2.1, 3, 1000, 0.5, 0, 2.1, 4]) && numbers.every(n => n.fields.lvotD === 1.9), J(numbers.map(n => n.fields)));
  const gone = [['lvotD', ''], ['lvotD', 'abc'], ['lvotD', 'Infinity'], ['lvotD', '-Infinity'], ['lvotD', 'NaN']].map(([f, v]) => typed(f, v));
  ok('an empty field, a word, or a number that is not finite forgets the field, rather than keeping a nought', gone.every(n => !('lvotD' in n.fields)) && J(gone.map(n => n.fields)) === J([{}, {}, {}, {}, {}]),
     J(gone.map(n => n.fields)));
  const minus = typed('ivc', '-0');
  ok('minus nought is a number, and is kept', 'ivc' in minus.fields && Object.is(minus.fields.ivc, -0), J(minus));
  ok('every keystroke repaints the results alone: the screen is not drawn again', numbers.concat(gone, [minus]).every(n => n.log === 'repaint'), J(numbers.concat(gone).map(n => n.log)));
  const s = installed(), before = J(s.ECHO);
  [{ target: s.find('data-action', 'goHome') }, { target: s.find('data-echo-tab', 'visual') }, { target: null }, { target: {} }].forEach(ev => run(() => s.fire('input', ev)));
  ok('typing in anything that is no field, or into nothing, changes nothing and repaints nothing', J(s.ECHO) === before && s.log.length === 0, J([s.ECHO, s.log]));
}

head('repaint()');
{
  const s = screen(); s.ECHO.fields = { lvotD: 2, vti: 20 };
  const r = run(() => E.repaint(s.doc, s.env));
  ok('the results block is drawn from the fields as they are now', r === undefined && s.cls('echo-out').innerHTML === 'results {"lvotD":2,"vti":20}', J([r, s.cls('echo-out').innerHTML]));
  const n = screen({ noOut: true }), rn = run(() => E.repaint(n.doc, Object.assign({}, n.env, { ui: () => { throw new Error('asked'); } })));
  ok('with no results block, nothing is drawn and EchoUI is not asked', rn === undefined, String(rn));
}

head('putting the screen on the page, and loading its code the first time');
{
  /* A page that keeps the scripts it is asked to make and add, an EchoUI that may arrive, and a render() that says the
     screen it was drawn on. */
  const page = (o = {}) => {
    const log = [], scripts = [];
    const doc = { createElement: t => { const s = { t, src: '', remove() { log.push('remove ' + this.src); } }; scripts.push(s); return s; },
      head: { appendChild: s => log.push('add ' + s.src) } };
    let ui = o.ui ? { screenHtml: e => 'drawn by EchoUI on tab ' + e.tab } : undefined;
    const st = { screen: o.screen || 'echo' };
    const env = { echo: () => ({ tab: 'reference' }), ui: () => ui, src: () => (o.noSrc ? undefined : 'vendor/echo-1.js'), screen: () => st.screen,
      render: () => log.push('render on ' + st.screen), show: () => { st.screen = 'echo'; log.push('show'); } };
    return { log, scripts, doc, env, st, load: E.loader(), arrive: () => { ui = { screenHtml: e => 'drawn by EchoUI on tab ' + e.tab }; },
      draw() { return run(() => E.screenHtml(doc, this.load, env)); } };
  };
  const LOADING = '<p role="status">Loading Echo Studio…</p>';
  const FAILED = '<p role="status">Echo Studio could not load.</p><button data-action="goEcho">Retry</button>';
  ok('a load begins idle, and each is its own', J(E.loader()) === J({ state: 'idle' }) && E.loader() !== E.loader());
  const there = page({ ui: true });
  ok('with EchoUI there, the screen is EchoUI\'s drawing of ECHO, and nothing is loaded', there.draw() === 'drawn by EchoUI on tab reference' && there.scripts.length === 0 && there.load.state === 'idle',
     J([there.draw(), there.log]));
  const a = page(), first = a.draw(), second = a.draw();
  ok('without it, the first drawing adds the split build\'s file once and says it is loading; a second adds nothing',
     first === LOADING && second === LOADING && J(a.log) === J(['add vendor/echo-1.js']) && a.load.state === 'loading', J([first, a.log, a.load]));
  a.arrive(); run(() => a.scripts[0].onload());
  ok('when it is in, the load is ready and the screen drawn again, and then it is EchoUI\'s', a.load.state === 'ready' && J(a.log) === J(['add vendor/echo-1.js', 'render on echo']) && a.draw() === 'drawn by EchoUI on tab reference',
     J([a.load, a.log]));
  const f = page(); f.draw(); run(() => f.scripts[0].onerror());
  ok('a load that fails is taken out of the page, and the screen drawn again says so, with a Retry that goes in again',
     f.load.state === 'failed' && J(f.log) === J(['add vendor/echo-1.js', 'remove vendor/echo-1.js', 'render on echo']) && f.draw() === FAILED && f.scripts.length === 1, J([f.load, f.log]));
  const g = page(); g.draw(); run(() => g.scripts[0].onload());
  ok('so does one that loads a file without EchoUI in it', g.load.state === 'failed' && g.log.includes('remove vendor/echo-1.js'), J([g.load, g.log]));
  const away = page(); away.draw(); away.st.screen = 'home'; away.arrive(); run(() => away.scripts[0].onload());
  ok('a load that ends after the page has moved on does not draw the page again', away.load.state === 'ready' && J(away.log) === J(['add vendor/echo-1.js']), J(away.log));
  const none = page({ noSrc: true });
  ok('where the split build left no file, nothing is loaded, and the screen says it is loading', none.draw() === LOADING && none.scripts.length === 0 && none.load.state === 'idle', J([none.draw(), none.load]));
}

head('the way in');
{
  const page = state => { const log = []; const load = { state }; const env = { show: () => log.push('show with ' + load.state) };
    return { log, load, r: run(() => E.go(load, env)) }; };
  const failed = page('failed');
  ok('after a load that failed, going in lets it go, so the screen tries again, then shows the screen', failed.r === undefined && J(failed.log) === J(['show with idle']), J(failed.log));
  const others = ['idle', 'loading', 'ready'].map(s => page(s).log[0]);
  ok('any other load is left as it is', J(others) === J(['show with idle', 'show with loading', 'show with ready']), J(others));
}

head('the module reaches the page only through what it is handed');
{
  /* Read with its comments blanked: the module says in prose what it does not touch; quoted selectors set aside. */
  const mod = blankComments(fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'echoscreen.js'), 'utf8')).replace(/'[^'\n]*'/g, "''");
  const body = mod.slice(mod.indexOf('(function (root) {'), mod.indexOf('root.EchoScreen'));
  const seen = ['document', 'window', 'ECHO', 'EchoUI', 'ECHO_SRC', 'render', 'echoRepaintResults', 'goEcho', 'S'].filter(t => new RegExp('(?<![.\\w$])' + t + '\\b').test(body));
  ok('no name of the page\'s is used but through env, or the document it is handed', body.length > 0 && seen.length === 0, seen.join(' ') || 'none');
}

head('the page');
{
  /* Read with its comments blanked: the shell explains itself, and quotes what is looked for. Positions are kept, so
     code found in the blanked copy is taken from the real one. */
  const raw = fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8');
  const shell = blankComments(raw);
  const n = t => shell.split(t).length - 1;
  const lifted = '@@SLOT[src:src/core/echo.js]@@\n@@SLOT[src:src/ui/echo.js]@@', slot = '@@SLOT[src:src/app/echoscreen.js]@@';
  ok('the module is written into the page once, after the two slots the split build lifts as one block, and not between them',
     n(slot) === 1 && n(lifted) === 1 && shell.indexOf(slot) > shell.indexOf(lifted), [n(slot), n(lifted), shell.indexOf(slot) - shell.indexOf(lifted)].join(' '));
  const LINES = ['function buildEchoScreen(){ return EchoScreen.screenHtml(document,ECHO_LOAD,ECHO_ENV); }', 'function goEcho(){ EchoScreen.go(ECHO_LOAD,ECHO_ENV); }',
    'function echoRepaintResults(){ EchoScreen.repaint(document,ECHO_ENV); }', 'EchoScreen.install(document,ECHO_ENV);', 'const ECHO_LOAD=EchoScreen.loader();'];
  ok('buildEchoScreen(), goEcho() and echoRepaintResults() are one line each into it, declared once; the load is the module\'s; the page installs the listeners once; all below the slot',
     LINES.every(l => n(l) === 1 && shell.indexOf(l) > shell.indexOf(slot)) && ['buildEchoScreen', 'goEcho', 'echoRepaintResults'].every(f => n('function ' + f + '(') === 1),
     LINES.map(l => n(l)).join(' '));
  ok('and the page keeps no load of its own: no echoLoadState, and no script made for ECHO_SRC', n('echoLoadState') === 0 && n('window.ECHO_SRC;') === 0 && n('script.src = window.ECHO_SRC') === 0,
     [n('echoLoadState'), n('script.src = window.ECHO_SRC')].join(' '));
  const echoListeners = [...shell.matchAll(/document\.addEventListener\('(?:click|keydown|input)', ?function\(e\)\{[^\n]*\n[^\n]*(?:data-echo|\.echo-)/g)].length;
  ok('and adds no Echo listener of its own', echoListeners === 0 && n("closest('[data-echo-tab],[data-echo-disease]')") === 0 && n("hasAttribute('data-echo-field')") === 0, String(echoListeners));
  /* The page's own lines, from the load below the slot to the next banner, over a document of this suite's and a page that says what
     it was asked: ECHO and EchoUI are the page's names, read when a listener runs. */
  const at = raw.indexOf("const ECHO_LOAD="), end = raw.indexOf('/* ══════════ Search your notes');
  const pageLines = at >= 0 && end > at ? raw.slice(at, end) : 'throw new Error("no ECHO_LOAD in the page")';
  const s = screen({ redraw: false });
  const ctx = { document: s.doc, calls: [] }; ctx.window = ctx; vm.createContext(ctx);
  const loaded = run(() => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'echoscreen.js'), 'utf8') + '\nvar ECHO={tab:"reference",fields:{}};\nvar S={screen:"home"};\nfunction render(){ calls.push("render on " + S.screen); }\n' + pageLines + '\n"loaded"', ctx));
  /* EchoUI arrives after the page has loaded, as the split build's does. */
  ctx.EchoUI = { tabId: t => 'ui:' + t, resultsHtml: f => 'from the page ' + J(f) };
  const tap = run(() => { s.fire('click', { target: s.find('data-echo-tab', 'visual') }); const el = s.find('data-echo-field', 'vti'); el.value = '7'; s.fire('input', { target: el });
    return J({ calls: ctx.calls, tab: vm.runInContext('ECHO.tab', ctx), fields: vm.runInContext('ECHO.fields', ctx), out: s.cls('echo-out').innerHTML, listeners: s.listeners.length }); });
  ok('through the page\'s own lines, ECHO_ENV hands the wiring the page\'s ECHO, the EchoUI that arrived after it, its render() and its repaint',
     loaded === 'loaded' && tap === J({ calls: ['render on home'], tab: 'ui:visual', fields: { vti: 7 }, out: 'from the page {"vti":7}', listeners: 4 }), String(loaded === 'loaded' ? tap : loaded));
  /* The way in and the load, through the page's own lines: the split build's file named on window, the screen put on
     by the page's S and render(), the script made and added on the page's document, and EchoUI arriving with it. */
  const scripts = []; s.doc.createElement = t => { const x = { t, src: '', remove() { ctx.calls.push('remove ' + this.src); } }; scripts.push(x); return x; };
  s.doc.head = { appendChild: x => ctx.calls.push('add ' + x.src) };
  const ui = ctx.EchoUI; delete ctx.EchoUI; ctx.ECHO_SRC = 'vendor/echo-9.js'; ctx.calls.length = 0;
  const way = run(() => { vm.runInContext('goEcho()', ctx); const before = vm.runInContext('buildEchoScreen()', ctx);
    ctx.EchoUI = Object.assign({}, ui, { screenHtml: e => 'EchoUI on ' + e.tab }); scripts[0].onload();
    return J({ before, after: vm.runInContext('buildEchoScreen()', ctx), screen: vm.runInContext('S.screen', ctx), load: vm.runInContext('ECHO_LOAD.state', ctx), calls: ctx.calls }); });
  ok('and the way in and the load find the page\'s S, render(), document and window.ECHO_SRC',
     way === J({ before: '<p role="status">Loading Echo Studio…</p>', after: 'EchoUI on ui:visual', screen: 'echo', load: 'ready', calls: ['render on echo', 'add vendor/echo-9.js', 'render on echo'] }), String(way));
  /* The screen the page is on, which the load above reads only while it is Echo's: here a second load, after one that
     failed, ends once the page has moved on. */
  const moved = run(() => { ctx.calls.length = 0; delete ctx.EchoUI; vm.runInContext('ECHO_LOAD.state="failed"; goEcho(); buildEchoScreen(); S.screen="home";', ctx);
    ctx.EchoUI = { screenHtml: () => 'x' }; scripts[scripts.length - 1].onload(); return J(ctx.calls); });
  ok('and a load that ends once the page has left Echo, read from the page\'s own S, does not draw the page again',
     moved === J(['render on echo', 'add vendor/echo-9.js']), String(moved));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
