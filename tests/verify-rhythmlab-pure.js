#!/usr/bin/env node
/*
 * The Rhythm Lab screen — src/app/rhythmlab.js.
 *
 *   node tests/verify-rhythmlab-pure.js
 *
 * Pure Node, over invented rhythms. The module is given what the page has and returns markup with three
 * empty canvases in it; nothing here draws. The helpers it is handed below are stand-ins that say what they
 * were asked (e('x') is "E(x)", the lead card for V1 is "[card V1]"), so what is expected is worked out here
 * from what was handed over, never read back from the module.
 *
 * What is measured, rather than assumed:
 *   - the monitor names the chosen rhythm, its rate or a dash, and its description; a chip for every
 *     rhythm in the order given, the chosen one marked, each calling setLab() with its own key;
 *   - the cycle panel is headed with the chosen view, falls back to the first for a view it does not know,
 *     asks the page whether the cycle is playing each time it is drawn, marks one speed and one view, and
 *     offers the interventions in the PV loop and nowhere else;
 *   - the 12-lead panel has a canvas and the page's lead card only for a rhythm with a 12-lead of its own,
 *     and otherwise a note that names the rhythm and says why;
 *   - that it asks for fifteen names of what it is given and changes nothing;
 *   - the page: its line, the slot, that the two panel builders are no longer the page's, the two handlers,
 *     that every element the page's mounts look up is in the markup under that name, that what is chosen
 *     is still the page's, and the page's own line over its own constants, helpers, Physio and Leads12.
 *
 * Not held here: what the titles of the half and quarter speed chips say. They read "${label} of real
 * time", the name where the label was meant; that is the page's as it was before the screen moved, and it
 * is reported with the move rather than written into a check.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { blankComments } = require('./_source.js');
const L = require('../src/app/rhythmlab.js').RhythmLabScreen;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + String(detail).replace(/\s+/g, ' ') : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);

/* What a page has. The chips' order is deliberately not the table's, and vt and asys have no 12-lead. */
const RHYTHMS = () => ({ sinus: { name: 'Sinus rhythm', hr: 68, desc: 'Normal.' }, vt: { name: 'Ventricular tachycardia', hr: 180, desc: 'Wide & fast' },
                         asys: { name: 'Asystole', hr: 0, desc: 'No activity' }, afib: { name: 'Atrial fibrillation', hr: 110, desc: 'Irregular' } });
const KEYS = ['vt', 'sinus', 'asys', 'afib'];
const VIEWS = [['wiggers', 'Wiggers'], ['pv', 'PV loop'], ['flow', 'Flow']];
const SPEEDS = [[1, '1×'], [2, '½×'], [4, '¼×']];
const PHYSIO = { INTERVENTIONS: [{ id: 'base', label: 'Baseline' }, { id: 'pre', label: 'More preload' }, { id: 'ino', label: 'Inotrope' }] };
const page = o => Object.assign({
  RHYTHMS: RHYTHMS(), RHYTHM_KEYS: KEYS.slice(), labKind: 'sinus',
  PHYSIO_VIEWS: VIEWS.map(v => v.slice()), PHYSIO_SPEEDS: SPEEDS.map(v => v.slice()), physioView: 'wiggers', physioSlow: 2, physioIv: 'base',
  physioIsPlaying: () => true, Physio: PHYSIO, LEAD12_MAP: { sinus: 'sinus', afib: 'afib' }, twelveLead: null,
  leadCardHtml: id => '[card ' + id + ']', e: s => 'E(' + s + ')', icon: (name, cls) => '[icon ' + name + (cls ? ' ' + cls : '') + ']',
}, o);
/* A module that throws says so in the markup, so the check that asked says FAIL and the run goes on. */
const draw = (p, part) => { try { return String(L[part || 'screenHtml'](p)); } catch (err) { return 'THREW ' + err.message; } };

const g = (s, re) => (s.match(re) || [])[1];
const chipsOf = (html, attr) => [...html.matchAll(new RegExp('<button class="chip( mini)?( hot)?" ' + attr + '="([^"]*)"[^>]*>([^<]*)</button>', 'g'))].map(m => ({ key: m[3], says: m[4], hot: !!m[2] }));
const rhythmChips = html => [...html.matchAll(/<button class="chip( hot)?" onclick="([^"]*)">([^<]*)<\/button>/g)].map(m => ({ does: m[2], says: m[3], hot: !!m[1] }));
const playOf = html => { const m = html.match(/<button class="chip mini" data-physio-play\s+title="([^"]*)">([^<]*)<\/button>/); return m ? [m[1], m[2]] : ['NO BUTTON']; };
const times = (s, t) => s.split(t).length - 1;

head('the monitor, and a chip for every rhythm');
{
  const vt = draw(page({ labKind: 'vt' }));
  ok('it names the chosen rhythm, through e(), and gives its rate', g(vt, /class="lab-name">([^<]*)</) === 'E(Ventricular tachycardia)' && g(vt, /class="lab-hr">([^<]*)</) === '180 bpm',
     g(vt, /class="lab-name">([^<]*)</) + ' · ' + g(vt, /class="lab-hr">([^<]*)</));
  ok('a rhythm with no rate is given a dash, not "0 bpm"', g(draw(page({ labKind: 'asys' })), /class="lab-hr">([^<]*)</) === '—', g(draw(page({ labKind: 'asys' })), /class="lab-hr">([^<]*)</));
  ok('and it describes the rhythm, through e()', vt.includes('<div class="lab-desc">E(Wide & fast)</div>'));
  const chips = rhythmChips(vt);
  ok('there is a chip for every rhythm, in the order the page gives, named through e()',
     J(chips.map(c => c.says)) === J(['E(Ventricular tachycardia)', 'E(Sinus rhythm)', 'E(Asystole)', 'E(Atrial fibrillation)']), chips.map(c => c.says).join(' | '));
  ok('only the chosen rhythm\'s chip is marked', J(chips.map(c => c.hot)) === J([true, false, false, false]) && J(rhythmChips(draw(page({ labKind: 'afib' }))).map(c => c.hot)) === J([false, false, false, true]), J(chips.map(c => c.hot)));
  ok('each chip calls setLab() with its own key', J(chips.map(c => c.does)) === J(KEYS.map(k => 'setLab(\'' + k + '\')')), chips.map(c => c.does).join(' | '));
  ok('the Home button goes home', vt.includes('<button class="btn sb-back" onclick="goHome()">[icon arrow-left icon-sm] Home</button>'));
  ok('the monitor has one canvas for the page to draw into, and says the traces are models, not recordings',
     times(vt, '<canvas id="labCanvas" aria-label="Live electrocardiogram trace"></canvas>') === 1 && vt.includes('Traces are generated from waveform models, not recordings'));
  ok('the cycle panel and the 12-lead panel follow, once each, in that order',
     times(vt, 'class="panel physio-panel"') === 1 && times(vt, 'class="panel twelve-panel"') === 1 && vt.indexOf('lab-chips') < vt.indexOf('physio-panel') && vt.indexOf('physio-panel') < vt.indexOf('twelve-panel'));
  const p = page({ labKind: 'afib', physioView: 'pv', twelveLead: 'V1' });
  ok('and they are the panels the two panel functions give for the same page', !draw(p).startsWith('THREW') && draw(p).includes(draw(p, 'physioHtml')) && draw(p).includes(draw(p, 'twelveHtml')) && draw(p, 'physioHtml') !== draw(p, 'twelveHtml'));
}

head('the cardiac cycle panel');
{
  const pv = draw(page({ physioView: 'pv', physioIv: 'pre' }), 'physioHtml'), flow = draw(page({ physioView: 'flow' }), 'physioHtml');
  ok('it is headed with the chosen view\'s name, through e()', pv.includes('<span>Cardiac cycle · E(PV loop)</span>') && flow.includes('<span>Cardiac cycle · E(Flow)</span>'));
  const lost = draw(page({ physioView: 'a view that was removed' }), 'physioHtml');
  ok('a view it does not know is headed as the first view, and marks no view', lost.includes('<span>Cardiac cycle · E(Wiggers)</span>') && chipsOf(lost, 'data-physio-view').every(c => !c.hot), lost.slice(0, 90));
  ok('playing, the button says Pause; paused, it says Play: what a tap would do',
     J(playOf(draw(page({ physioIsPlaying: () => true }), 'physioHtml'))) === J(['Pause the cycle', 'Pause']) && J(playOf(draw(page({ physioIsPlaying: () => false }), 'physioHtml'))) === J(['Play the cycle', 'Play']),
     J(playOf(draw(page({ physioIsPlaying: () => false }), 'physioHtml'))));
  /* The page decides on its first answer (Reduce Motion), so it has to be asked, each time. */
  let playing = true, asked = 0;
  const live = page({ physioIsPlaying: () => { asked++; return playing; } });
  const first = playOf(draw(live, 'physioHtml'))[1]; playing = false; const second = playOf(draw(live, 'physioHtml'))[1];
  ok('it asks the page whether the cycle is playing each time it is drawn', asked >= 2 && first === 'Pause' && second === 'Play', `${asked} asked · ${first} then ${second}`);
  const speeds = chipsOf(draw(page({ physioSlow: 4 }), 'physioHtml'), 'data-physio-slow');
  ok('a chip for each speed, by its number, named through e(), the chosen one marked', J(speeds) === J([{ key: '1', says: 'E(1×)', hot: false }, { key: '2', says: 'E(½×)', hot: false }, { key: '4', says: 'E(¼×)', hot: true }]), J(speeds));
  ok('the first speed is titled "Real time"', /data-physio-slow="1"\s+title="Real time"/.test(pv));
  const views = chipsOf(pv, 'data-physio-view');
  ok('a chip for each view, in the page\'s order, the chosen one marked', J(views) === J([{ key: 'wiggers', says: 'E(Wiggers)', hot: false }, { key: 'pv', says: 'E(PV loop)', hot: true }, { key: 'flow', says: 'E(Flow)', hot: false }]), J(views));
  const ivs = chipsOf(pv, 'data-physio-iv');
  ok('in the PV loop the interventions are offered, named through e(), the chosen one marked', J(ivs) === J([{ key: 'base', says: 'E(Baseline)', hot: false }, { key: 'pre', says: 'E(More preload)', hot: true }, { key: 'ino', says: 'E(Inotrope)', hot: false }]), J(ivs));
  ok('and in no other view', !flow.includes('data-physio-iv') && !flow.includes('iv-chips') && !draw(page({}), 'physioHtml').includes('data-physio-iv'));
  ok('outside the PV loop it does not need Physio at all', !draw(page({ physioView: 'flow', Physio: undefined }), 'physioHtml').startsWith('THREW'), draw(page({ physioView: 'flow', Physio: undefined }), 'physioHtml').slice(0, 80));
  ok('it has one canvas, a place for the phase and an empty note for the page to fill, and says it is a teaching model',
     times(pv, '<canvas id="physioCanvas" aria-label="Cardiac cycle diagram"></canvas>') === 1 && times(pv, 'id="physioPhase"') === 1 && times(pv, '<div class="physio-note" id="physioNote"></div>') === 1
     && pv.includes('id="physioModel">A teaching model: every curve is computed from'));
}

head('the 12-lead panel');
{
  const sinus = draw(page({ labKind: 'sinus', twelveLead: 'V1' }), 'twelveHtml'), vt = draw(page({ labKind: 'vt', twelveLead: 'V1' }), 'twelveHtml');
  ok('it is headed with the rhythm\'s name, through e()', sinus.includes('<div class="panel-h">12-lead · E(Sinus rhythm)</div>') && vt.includes('<div class="panel-h">12-lead · E(Ventricular tachycardia)</div>'));
  ok('a rhythm with a 12-lead of its own has one canvas, and the page\'s card for the lead that is selected',
     times(sinus, '<canvas id="twelveCanvas" aria-label="12-lead electrocardiogram"></canvas>') === 1 && sinus.includes('<div class="lead-card" id="leadCard">[card V1]</div>') && !sinus.includes('twelve-none'), sinus.slice(0, 90));
  ok('with no lead selected, the card is what the page gives for none', draw(page({ labKind: 'afib', twelveLead: null }), 'twelveHtml').includes('<div class="lead-card" id="leadCard">[card null]</div>'));
  ok('a rhythm with none has no canvas and no card', !vt.startsWith('THREW') && !vt.includes('twelveCanvas') && !vt.includes('leadCard') && !vt.includes('[card'), vt.slice(0, 90));
  ok('and a note that names it, through e(), and says why it is not drawn', vt.includes('<div class="twelve-none">') && vt.includes('<b>E(Ventricular tachycardia)</b> is shown on the single-lead trace above') && vt.includes('which teaches the wrong pattern'));
}

head('it reads what it is given, and changes nothing');
{
  const read = new Set(), wrote = [];
  const watched = p => new Proxy(p, {
    get(t, k) { if (typeof k === 'string') read.add(k); return t[k]; },
    set(t, k) { wrote.push('set ' + String(k)); return true; },
    deleteProperty(t, k) { wrote.push('delete ' + String(k)); return true; },
    defineProperty(t, k) { wrote.push('define ' + String(k)); return true; },
  });
  const drawn = [page({ labKind: 'sinus', physioView: 'pv', twelveLead: 'V1' }), page({ labKind: 'vt', physioView: 'flow' })].map(p => draw(watched(p)));
  const WANT = ['LEAD12_MAP', 'PHYSIO_SPEEDS', 'PHYSIO_VIEWS', 'Physio', 'RHYTHMS', 'RHYTHM_KEYS', 'e', 'icon', 'labKind', 'leadCardHtml', 'physioIsPlaying', 'physioIv', 'physioSlow', 'physioView', 'twelveLead'];
  ok('of what the page has, it asks for fifteen names and no other', drawn.every(h => !h.startsWith('THREW')) && J([...read].sort()) === J(WANT), [...read].sort().join(' '));
  ok('and sets, deletes and defines nothing on it', drawn.every(h => !h.startsWith('THREW')) && wrote.length === 0, wrote.join(', ') || 'nothing');
  /* Frozen all the way down: in a strict module a write throws, and draw() then says THREW. */
  const deep = o => { Object.values(o).forEach(v => { if (v && typeof v === 'object') deep(v); }); return Object.freeze(o); };
  const o = { labKind: 'afib', physioView: 'pv', physioIv: 'ino', twelveLead: 'II' };
  const frozen = draw(deep(page(o))), loose = draw(page(o));
  ok('given everything frozen, the rhythms, the lists and the helpers, it draws the same screen', !frozen.startsWith('THREW') && frozen === loose && rhythmChips(frozen).length === 4, frozen.slice(0, 80));
  const before = page(o), given = page(o); draw(given);
  ok('and the rhythms and the lists are as they were, in the same order', J([given.RHYTHMS, given.RHYTHM_KEYS, given.PHYSIO_VIEWS, given.PHYSIO_SPEEDS, given.LEAD12_MAP]) === J([before.RHYTHMS, before.RHYTHM_KEYS, before.PHYSIO_VIEWS, before.PHYSIO_SPEEDS, before.LEAD12_MAP]));
}

head('the page hands over what it has, and keeps what is chosen');
{
  /* Read with its comments blanked: the page explains itself, and quotes what is looked for. Positions are
     kept, so code found in the blanked copy is taken from the real one. */
  const raw = fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8');
  const shell = blankComments(raw);
  const count = text => shell.split(text).length - 1;
  const LINE = 'function buildLab(){ return RhythmLabScreen.screenHtml({RHYTHMS,RHYTHM_KEYS,labKind,PHYSIO_VIEWS,PHYSIO_SPEEDS,physioView,physioSlow,physioIv,physioIsPlaying,\n'
             + '  Physio:typeof Physio!==\'undefined\'?Physio:undefined,LEAD12_MAP,twelveLead,leadCardHtml,e,icon}); }';
  ok('buildLab() is one call: the rhythms and which is chosen, the cycle\'s choices and the function that says whether it plays, Physio if the page has it, the leads, and the helpers',
     count(LINE) === 1 && count('function buildLab(') === 1, `${count(LINE)} such call(s), ${count('function buildLab(')} declaration(s)`);
  const slot = shell.indexOf('@@SLOT[src:src/app/rhythmlab.js]@@');
  ok('the module is written into the page once, above it', slot >= 0 && count('@@SLOT[src:src/app/rhythmlab.js]@@') === 1 && shell.indexOf(LINE) > slot, slot < 0 ? 'no slot' : 'slot at ' + slot);
  ok('the two panel builders are no longer the page\'s, and the screen\'s own words are not in it',
     count('function buildPhysio(') === 0 && count('function buildTwelveLead(') === 0 && count('tap a rhythm to morph the trace') === 0 && count('A teaching model: every curve') === 0 && count('teaches the wrong pattern') === 0,
     [count('function buildPhysio('), count('function buildTwelveLead('), count('tap a rhythm to morph the trace'), count('A teaching model: every curve'), count('teaches the wrong pattern')].join(' '));

  const all = draw(page({ labKind: 'sinus', physioView: 'pv', twelveLead: 'V1' }));
  const handlers = [...new Set([...all.matchAll(/onclick="([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]))].sort();
  ok('its markup names two handlers, and each is a function the page declares, once', J(handlers) === J(['goHome', 'setLab']) && handlers.every(n => count('function ' + n + '(') === 1), handlers.map(n => n + ':' + count('function ' + n + '(')).join(' '));

  /* The markup is the module's and the mounts are the page's. They meet at six ids and four data attributes:
     a name changed on one side leaves a canvas the page cannot find, and nothing says so. */
  const ids = [...new Set([...all.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]))].sort();
  const lookedUp = id => count('getElementById(\'' + id + '\')') > 0;
  /* physioModel is the seventh: the note that says the cycle is a teaching model. The page does not look it up;
     tests/verify-physio.js reads it there. */
  const MOUNTED = ['labCanvas', 'leadCard', 'physioCanvas', 'physioNote', 'physioPhase', 'twelveCanvas'];
  ok('the six elements the page\'s mounts look up by id are in the markup under those names, and it names no other but physioModel',
     J(ids) === J(MOUNTED.concat('physioModel').sort()) && MOUNTED.every(lookedUp) && !lookedUp('physioModel'),
     ids.map(i => i + (lookedUp(i) ? '' : ' (not looked up)')).join(' '));
  const datas = [...new Set([...all.matchAll(/\b(data-physio-[a-z]+)\b/g)].map(m => m[1]))].sort();
  ok('and every data attribute on a cycle chip is one the page binds a tap to', J(datas) === J(['data-physio-iv', 'data-physio-play', 'data-physio-slow', 'data-physio-view']) && datas.every(d => count('querySelectorAll(\'[' + d + ']\')') > 0),
     datas.map(d => d + ':' + count('querySelectorAll(\'[' + d + ']\')')).join(' '));

  ok('which rhythm is chosen is still the page\'s to keep', count('let labMon=null, labKind=\'sinus\';') === 1);
  ok('and setLab() still keeps it, gives the live cycle the rhythm\'s rate, and draws the screen again',
     count('function setLab(k){') === 1 && /function setLab\(k\)\{\s*labKind=k;\n  if\(physio\) physio\.setRate\(RHYTHMS\[k\]\.hr\|\|68\);\n  render\(\);\n\}/.test(shell));

  /* The page's own line, with the page's own constants and helpers and the real Physio and Leads12, in a
     context that has nothing else. The rhythms are invented: the page's table is the waveform engine's. */
  const whole = (from, to) => { const a = shell.indexOf(from); if (a < 0 || shell.indexOf(from, a + 1) >= 0) return '\nthrow new Error("not in the page once: ' + from.replace(/["\\]/g, '') + '");\n'; const b = shell.indexOf(to, a); return raw.slice(a, b + to.length); };
  const file = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const pageCode = [whole('function icon(name, cls){', '\n}'), whole('const ESC={', '\n'), whole('const e=s=>', '\n'), whole('const PHYSIO_VIEWS=[', '];'), whole('const PHYSIO_SPEEDS=[', '\n'),
    whole('const LEAD12_MAP={', '};'), whole('let physioPlaying=null;', '\n'), whole('function physioIsPlaying(){', '\n}'), whole('function leadCardHtml(id){', '\n}')].join('\n');
  const world = (state, opts) => {
    const ctx = { RHYTHMS: { sinus: { name: 'Sinus <rhythm>', hr: 68, desc: 'Normal & regular' }, vt: { name: 'VT', hr: 180, desc: 'Fast' } }, RHYTHM_KEYS: ['sinus', 'vt'] };
    ctx.window = ctx; if (opts && opts.reduce !== undefined) ctx.matchMedia = () => ({ matches: opts.reduce });
    vm.createContext(ctx);
    const ask = code => { try { return vm.runInContext(code, ctx); } catch (err) { return 'THREW ' + err.message; } };
    const loaded = ask((opts && opts.noPhysio ? '' : file('src/core/physio.js') + '\n') + file('src/core/leads12.js') + '\n' + pageCode + '\n' + file('src/app/rhythmlab.js') + '\n' + LINE + '\n' + state + '\n"loaded"');
    return { ask, shown: loaded === 'loaded' ? String(ask('buildLab()')) : String(loaded) };
  };
  const w = world('var labKind="sinus", physioView="pv", physioSlow=2, twelveLead="V1"; var physioIv=Physio.INTERVENTIONS[1].id;', { reduce: false });
  const iv = w.ask('({ id: Physio.INTERVENTIONS[1].id, label: Physio.INTERVENTIONS[1].label, n: Physio.INTERVENTIONS.length })');
  const ivs = chipsOf(w.shown, 'data-physio-iv');
  ok('the page\'s own line draws the screen: the rhythm\'s name escaped by the page\'s e(), the page\'s views, and the PV loop it was told',
     !w.shown.startsWith('THREW') && w.shown.includes('<span class="lab-name">Sinus &lt;rhythm&gt;</span>') && w.shown.includes('<span>Cardiac cycle · PV loop</span>') && w.ask('PHYSIO_VIEWS.length') > 2 && chipsOf(w.shown, 'data-physio-view').length === w.ask('PHYSIO_VIEWS.length'), w.shown.slice(0, 90));
  ok('the interventions are Physio\'s own, the chosen one marked', iv && ivs.length === iv.n && ivs.filter(c => c.hot).length === 1 && (ivs.find(c => c.hot) || {}).key === iv.id, J(ivs.map(c => c.key + (c.hot ? '*' : ''))));
  ok('the lead card is the page\'s, from Leads12, for the lead that is selected', w.shown.includes('<div class="lead-card" id="leadCard"><div class="lead-head"><span class="lead-id">V1</span>'), g(w.shown, /id="leadCard">([\s\S]{0,60})/));
  /* The function is handed over, not its answer: asked for the first time here, the page decides. */
  const still = world('var labKind="vt", physioView="wiggers", physioSlow=2, physioIv="base", twelveLead=null;', { reduce: true });
  ok('with Reduce Motion on, the first drawing finds the cycle paused, because the page was asked and decided',
     J(playOf(still.shown)) === J(['Play the cycle', 'Play']) && still.ask('physioPlaying') === false, J(playOf(still.shown)) + ' · physioPlaying ' + still.ask('physioPlaying'));
  const bare = world('var labKind="sinus", physioView="flow", physioSlow=1, physioIv="base", twelveLead=null;', { noPhysio: true, reduce: false });
  ok('on a page with no Physio the screen is still drawn outside the PV loop', !bare.shown.startsWith('THREW') && bare.shown.includes('<span>Cardiac cycle · Flow</span>'), bare.shown.slice(0, 90));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
