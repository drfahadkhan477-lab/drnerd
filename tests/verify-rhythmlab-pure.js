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
 *   - the lab's handlers, over a stand-in page that says what it was asked: whether the cycle plays is decided
 *     by the device once and then kept; Play and Pause, a speed, a rhythm, a lesion, a view and an intervention
 *     are each kept, remembered under their key where they were, handed to the diagram, their chip alone marked,
 *     and the screen or the caption drawn again, in the order the page did it; and they touch nothing else;
 *   - the beat handed to the diagram: a lesion's, or Normal's, which in the PV loop is the intervention's, or none
 *     without the engine; the engine asked for while it is not there; the phase, the diagram's or Physio's at its
 *     time; and the caption painted in Wiggers only when the phase turns over, in any other view each time;
 *   - the mounts: the cycle's diagram mounted once per canvas with the view, theme, rate, speed and whether it
 *     plays, and waited for where Wiggers is not there; its chips bound to their handlers; a drag that scrubs it
 *     outside the PV loop and Curves; the 12-lead with the lead kept, a tap selecting a lead or letting it go;
 *     and the monitor stopped on every draw and started again on the Lab;
 *   - the page: its line, the slot, that the two panel builders are no longer the page's, the two handlers,
 *     that every element the mounts look up is in the markup under that name, that what is chosen
 *     is still the page's, and the page's own line over its own constants, helpers, Physio and Leads12; that the
 *     page's four handler names are one line each into the module, that mountPhysio() hands its chips to them,
 *     and, called through those lines, that LAB_ENV reaches the page's document, store, draw and two mounts;
 *     that the lesion's beat, the phase and the caption's painter are one line each into the module, and, called
 *     through them, that the circulation engine is asked for once while it loads, and asked again after a load
 *     that failed; that the three mounts are one line each, and, through the page's own mountLab(), that LAB_ENV
 *     lends the diagrams' code, the next frame, Wiggers' load, the 12-lead map, the lead card, the theme and the
 *     screen.
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
const LESIONS = [['normal', 'Normal'], ['as', 'AS<b>'], ['tamponade', 'Tamponade']];
const PHYSIO = { INTERVENTIONS: [{ id: 'base', label: 'Baseline' }, { id: 'pre', label: 'More preload' }, { id: 'ino', label: 'Inotrope' }] };
const page = o => Object.assign({
  RHYTHMS: RHYTHMS(), RHYTHM_KEYS: KEYS.slice(), labKind: 'sinus',
  PHYSIO_VIEWS: VIEWS.map(v => v.slice()), PHYSIO_SPEEDS: SPEEDS.map(v => v.slice()), physioView: 'wiggers', physioSlow: 2, physioIv: 'base',
  PHYSIO_LESIONS: LESIONS.map(v => v.slice()), physioLesion: 'normal',
  physioIsPlaying: () => true, Physio: PHYSIO, LEAD12_MAP: { sinus: 'sinus', afib: 'afib' }, twelveLead: null,
  leadCardHtml: id => '[card ' + id + ']', e: s => 'E(' + s + ')', icon: (name, cls) => '[icon ' + name + (cls ? ' ' + cls : '') + ']',
}, o);
/* A module that throws says so in the markup, so the check that asked says FAIL and the run goes on. */
const draw = (p, part) => { try { return String(L[part || 'screenHtml'](p)); } catch (err) { return 'THREW ' + err.message; } };

const g = (s, re) => (s.match(re) || [])[1];
const chipsOf = (html, attr) => [...html.matchAll(new RegExp('<button class="chip( mini)?( hot)?" ' + attr + '="([^"]*)"[^>]*>([^<]*)</button>', 'g'))].map(m => ({ key: m[3], says: m[4], hot: !!m[2] }));
const rhythmChips = html => [...html.matchAll(/<button class="chip( hot)?" data-action="([^"]*)" data-kind="([^"]*)">([^<]*)<\/button>/g)].map(m => ({ does: m[2] + ' ' + m[3], says: m[4], hot: !!m[1] }));
/* docs/ROADMAP.md, E2. Attribute names, read tag by tag with each value consumed whole, so text inside a value is never
   taken for a name; and the actions the markup names. */
const attrsOf = tag => [...tag.replace(/^<[a-z0-9-]+/i, '').matchAll(/([^\s=>"'\/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)].map(m => m[1].toLowerCase());
const inlineOf = html => [...html.matchAll(/<[a-z][^>"']*(?:("[^"]*"|'[^']*')[^>"']*)*>/gi)].flatMap(m => attrsOf(m[0])).filter(n => /^on/.test(n));
const actionsOf = html => [...html.matchAll(/data-action="([^"]*)"/g)].map(m => m[1]);
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
  ok('each chip names the setLab action, with its own key as data', J(chips.map(c => c.does)) === J(KEYS.map(k => 'setLab ' + k)), chips.map(c => c.does).join(' | '));
  ok('the Home button names the goHome action', vt.includes('<button class="btn sb-back" data-action="goHome">[icon arrow-left icon-sm] Home</button>'));
  ok('the monitor has one canvas for the page to draw into, and says the traces are models, not recordings',
     times(vt, '<canvas id="labCanvas" aria-label="Live electrocardiogram trace"></canvas>') === 1 && vt.includes('Traces are generated from waveform models, not recordings'));
  ok('the Rhythm section contains the trace and 12-lead, followed by the Loop section with the cycle',
     vt.includes('href="#labRhythm"') && vt.includes('href="#labLoop"') &&
     times(vt, 'class="panel physio-panel"') === 1 && times(vt, 'class="panel twelve-panel"') === 1 &&
     vt.indexOf('id="labRhythm"') < vt.indexOf('lab-chips') && vt.indexOf('lab-chips') < vt.indexOf('twelve-panel') &&
     vt.indexOf('twelve-panel') < vt.indexOf('id="labLoop"') && vt.indexOf('id="labLoop"') < vt.indexOf('physio-panel'));
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

head('a lead\'s card');
{
  /* A Leads12 of the test's own, so every card below is written out by hand. */
  const LEADS = { LEADS: [{ id: 'V1', territory: 'Septal', artery: 'LAD <septal>', sees: 'the septum', look: 'rSR\' & ST' }, { id: 'II', territory: 'Inferior', artery: 'RCA', sees: 'the inferior wall', look: 'P waves' }] };
  const card = (id, leads) => { try { return String(L.leadCardHtml(id, { Leads12: leads, e: s => 'E(' + s + ')' })); } catch (err) { return 'THREW ' + err.message; } };
  ok('a lead is its name, territory and artery, then what it sees and what to look for, each through e()',
     card('V1', LEADS) === '<div class="lead-head"><span class="lead-id">E(V1)</span>\n      <span class="lead-terr">E(Septal)</span>\n      <span class="lead-art">E(LAD <septal>)</span></div>\n'
       + '    <div class="lead-sees">E(the septum)</div>\n    <div class="lead-look">E(rSR\' & ST)</div>', card('V1', LEADS));
  ok('the lead asked for, not the first', card('II', LEADS).includes('<span class="lead-id">E(II)</span>') && !card('II', LEADS).includes('V1'), card('II', LEADS).slice(0, 60));
  ok('before a lead is chosen, a prompt to tap one', [null, undefined, ''].every(id => card(id, LEADS) === '<div class="lead-empty">Tap a lead above.</div>'), card(null, LEADS));
  ok('a lead Leads12 does not have, or no Leads12 at all, is no card', card('V7', LEADS) === '' && card('v1', LEADS) === '' && card('V1', undefined) === '' && card(null, undefined) === '',
     [card('V7', LEADS), card('V1', undefined)].map(J).join(' '));
  /* Read with its comments blanked: the shell explains itself, and quotes what is looked for. */
  const pg = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
  const n = t => pg.split(t).length - 1;
  ok('the page\'s leadCardHtml() is one line handing over Leads12 and e, and the page keeps no card of its own',
     n("function leadCardHtml(id){ return RhythmLabScreen.leadCardHtml(id,{Leads12:typeof Leads12!=='undefined'?Leads12:undefined,e}); }") === 1 && n('function leadCardHtml(') === 1
     && n('<span class="lead-terr">') === 0 && n('Tap a lead above.') === 0);
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
  const WANT = ['LEAD12_MAP', 'PHYSIO_LESIONS', 'PHYSIO_SPEEDS', 'PHYSIO_VIEWS', 'Physio', 'RHYTHMS', 'RHYTHM_KEYS', 'e', 'icon', 'labKind', 'leadCardHtml', 'physioIsPlaying', 'physioIv', 'physioLesion', 'physioSlow', 'physioView', 'twelveLead'];
  ok('of what the page has, it asks for seventeen names and no other', drawn.every(h => !h.startsWith('THREW')) && J([...read].sort()) === J(WANT), [...read].sort().join(' '));
  ok('and sets, deletes and defines nothing on it', drawn.every(h => !h.startsWith('THREW')) && wrote.length === 0, wrote.join(', ') || 'nothing');
  /* Frozen all the way down: in a strict module a write throws, and draw() then says THREW. */
  const deep = o => { Object.values(o).forEach(v => { if (v && typeof v === 'object') deep(v); }); return Object.freeze(o); };
  const o = { labKind: 'afib', physioView: 'pv', physioIv: 'ino', twelveLead: 'II' };
  const frozen = draw(deep(page(o))), loose = draw(page(o));
  ok('given everything frozen, the rhythms, the lists and the helpers, it draws the same screen', !frozen.startsWith('THREW') && frozen === loose && rhythmChips(frozen).length === 4, frozen.slice(0, 80));
  const before = page(o), given = page(o); draw(given);
  ok('and the rhythms and the lists are as they were, in the same order', J([given.RHYTHMS, given.RHYTHM_KEYS, given.PHYSIO_VIEWS, given.PHYSIO_SPEEDS, given.LEAD12_MAP]) === J([before.RHYTHMS, before.RHYTHM_KEYS, before.PHYSIO_VIEWS, before.PHYSIO_SPEEDS, before.LEAD12_MAP]));
}

head('the lesions: offered in every view a lesion changes (docs/ROADMAP.md, S8)');
{
  const lesions = h => [...h.matchAll(/<button class="chip mini( hot)?" data-physio-lesion="([^"]*)">([^<]*(?:<b>)?[^<]*)<\/button>/g)].map(m => [m[2], m[3], !!m[1]]);
  const w = draw(page({ physioLesion: 'as' }), 'physioHtml');
  ok('in the Wiggers view, a chip for each lesion in order, its name through e(), the chosen one alone marked',
     J(lesions(w)) === J([['normal', 'E(Normal)', false], ['as', 'E(AS<b>)', true], ['tamponade', 'E(Tamponade)', false]]), J(lesions(w)));
  ok('above the canvas, in a row of their own', w.indexOf('lesion-chips') > 0 && w.indexOf('lesion-chips') < w.indexOf('id="physioCanvas"'));
  ok('the PV loop offers the same chips', J(lesions(draw(page({ physioView: 'pv', physioLesion: 'tamponade' }), 'physioHtml'))) === J([['normal', 'E(Normal)', false], ['as', 'E(AS<b>)', false], ['tamponade', 'E(Tamponade)', true]]));
  const more = VIEWS.concat([['right', 'Right heart'], ['curves', 'Curves'], ['conduction', 'Conduction'], ['coronary', 'Coronary']]);
  ok('and so do Flow, the right heart and Coronary; Curves and Conduction, whose figures no lesion changes, do not', ['flow', 'right', 'coronary'].every(v => draw(page({ physioView: v, PHYSIO_VIEWS: more }), 'physioHtml').includes('data-physio-lesion="as"'))
     && ['curves', 'conduction'].every(v => !draw(page({ physioView: v, PHYSIO_VIEWS: more }), 'physioHtml').includes('data-physio-lesion')));
  ok('in the PV loop the interventions are offered on the normal heart and not with a lesion chosen, whose loop is not physio.js\'s',
     draw(page({ physioView: 'pv', physioLesion: 'normal' }), 'physioHtml').includes('data-physio-iv') && !draw(page({ physioView: 'pv', physioLesion: 'as' }), 'physioHtml').includes('data-physio-iv'));
  ok('a page with no lesions to offer draws none, and does not throw', (() => { const h = draw(page({ PHYSIO_LESIONS: undefined }), 'physioHtml'); return !h.startsWith('THREW') && !h.includes('lesion-chips'); })());
}

head('the lab\'s state: one object, read from what was saved');
{
  const store = saved => ({ getItem: k => (k in saved ? saved[k] : null) });
  const V = [['wiggers', 'W'], ['pv', 'PV'], ['flow', 'F']], LS = [['normal', 'N'], ['as', 'AS']];
  const mk = (saved, views, lesions) => { try { return L.state(store(saved || {}), views || V, lesions || LS); } catch (err) { return { err: err.message }; } };
  const fresh = mk();
  ok('nothing saved: sinus, the Wiggers view, Normal, half speed, and nothing mounted, chosen or decided yet',
     J(fresh) === J({ mon: null, kind: 'sinus', physio: null, view: 'wiggers', iv: 'base', canvas: null, lesion: 'normal', slow: 2, playing: null, twelve: null, lead: null, noteAt: 0, notePhase: '' }), J(fresh));
  const kept = mk({ 'accsap12.physioview': 'pv', 'accsap12.physiolesion': 'as', 'accsap12.physioslow': '4' });
  ok('a saved view, lesion and speed are kept, the speed as a number', kept.view === 'pv' && kept.lesion === 'as' && kept.slow === 4, J([kept.view, kept.lesion, kept.slow]));
  const lost = mk({ 'accsap12.physioview': 'a view that was removed', 'accsap12.physiolesion': 'constructor', 'accsap12.physioslow': 'fast' });
  ok('a saved view or lesion the lab no longer has is the default, and a speed that is no number is half speed', lost.view === 'wiggers' && lost.lesion === 'normal' && lost.slow === 2 && mk({ 'accsap12.physioslow': '0' }).slow === 2,
     J([lost.view, lost.lesion, lost.slow]));
  const thrown = (() => { try { return L.state({ getItem: () => { throw new Error('denied'); } }, V, LS); } catch (err) { return { err: err.message }; } })();
  ok('a store that refuses to be read gives the defaults', thrown.view === 'wiggers' && thrown.lesion === 'normal' && thrown.slow === 2, J(thrown));
  ok('each call is an object of its own', mk() !== mk() && (() => { const a = mk(), b = mk(); a.kind = 'vt'; return b.kind === 'sinus'; })());
  /* A name put into a pattern is escaped whole, every character a pattern gives a meaning to, the backslash first among
     them; these names are the suite's own and hold none of them today, and a pattern built from one should not depend on
     that. */
  const escapeRe = t => String(t).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  /* The page's views: each old name reads and writes one field of LAB. */
  const VIEWS = { labMon: 'mon', labKind: 'kind', physio: 'physio', physioView: 'view', physioIv: 'iv', physioCanvasEl: 'canvas', physioLesion: 'lesion', physioSlow: 'slow',
    physioPlaying: 'playing', twelve: 'twelve', twelveLead: 'lead', __physioNoteAt: 'noteAt', __physioNotePhase: 'notePhase' };
  const pg = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
  const views = (/Object\.defineProperties\(window,\{labMon:([\s\S]*?)\}\);/.exec(pg) || [])[0] || '';
  const named = [...views.matchAll(/([A-Za-z_$][\w$]*):labView\('([A-Za-z]+)'\)/g)].map(m => m[1] + ':' + m[2]);
  ok('the page keeps each of the thirteen old names as a view of its own field, and declares none of them again',
     J(named.sort()) === J(Object.entries(VIEWS).map(([k, f]) => k + ':' + f).sort()) && Object.keys(VIEWS).every(k => !new RegExp('\\b(?:let|var|const)\\s+(?:[^;]*,\\s*)?' + escapeRe(k) + '\\s*=').test(pg)),
     named.length + ' views');
  ok('and every field the module makes has its view', Object.values(VIEWS).sort().join(' ') === Object.keys(fresh).sort().join(' '), Object.keys(fresh).sort().join(' '));
}

head('the cycle panel\'s caption');
{
  const PH = { INTERVENTIONS: [{ id: 'base', label: 'Rest', note: 'At rest.' }, { id: 'ino', label: 'Inotrope', note: 'Stronger.' }] };
  const LS = [['normal', 'Normal'], ['as', 'AS'], ['hfref', 'HFrEF']], NOTES = { as: 'A narrow valve.' };
  let asked = [];
  const note = (o, beat, ph) => { asked = []; try { return R0(Object.assign({ view: 'wiggers', lesion: 'normal', iv: 'base', Physio: PH, LESIONS: LS, NOTES, e: x => 'E(' + x + ')',
    cycle: () => (asked.push('cycle'), beat === undefined ? null : beat), phase: () => (asked.push('phase'), ph || { name: 'Ejection', blurb: 'The valve is open.' }) }, o)); } catch (err) { return 'THREW ' + err.message; } };
  const R0 = o => L.noteHtml(o);
  ok('in Wiggers: the phase now, by name, and what happens in it', note({}) === '<b>E(Ejection).</b> E(The valve is open.)' && J(asked) === J(['phase']), note({}));
  ok('and a lesion that has a note says it after, by name', note({ lesion: 'as' }) === '<b>E(Ejection).</b> E(The valve is open.)<br><b>E(AS).</b> E(A narrow valve.) Computed by the circulation model.',
     note({ lesion: 'as' }));
  ok('a lesion with no note, or one the lab does not have, adds nothing', note({ lesion: 'hfref' }) === note({}) && note({ lesion: 'gone' }) === note({}));
  ok('in the PV loop a lesion with a note is that note, measured against the normal heart, and neither beat nor phase is asked',
     note({ view: 'pv', lesion: 'as' }) === '<b>E(AS).</b> E(A narrow valve.) The dashed loop is the normal heart\'s. Computed by the circulation model.' && J(asked) === J([]),
     note({ view: 'pv', lesion: 'as' }));
  /* The engine's resting loop: Ees 2 to one decimal, Ea 1.5 to two, EDV 120.4 to none. */
  ok('at rest with the engine\'s beat, the loop\'s own figures', note({ view: 'pv' }, { loop: { ees: 2, ea: 1.5, edv: 120.4 } }) ===
     '<b>E(Rest)</b> E(Ees 2.0 mmHg/mL, Ea 1.50, EDV 120 mL. Everything else is measured off this.) Computed by the circulation model.' && J(asked) === J(['cycle']),
     note({ view: 'pv' }, { loop: { ees: 2, ea: 1.5, edv: 120.4 } }));
  ok('with an intervention, its own note; without the engine\'s beat, or with a beat that has no loop, the note alone; an unknown one is the first',
     note({ view: 'pv', iv: 'ino' }, { loop: { ees: 2, ea: 1.5, edv: 120 } }) === '<b>E(Inotrope)</b> E(Stronger.) Computed by the circulation model.'
     && note({ view: 'pv', iv: 'ino' }) === '<b>E(Inotrope)</b> E(Stronger.)' && note({ view: 'pv', iv: 'ino' }, {}) === '<b>E(Inotrope)</b> E(Stronger.)'
     && note({ view: 'pv', iv: 'gone' }) === '<b>E(Rest)</b> E(At rest.)',
     note({ view: 'pv', iv: 'gone' }));
  ok('Flow, the right heart and Coronary say a lesion\'s note with what they show of it, and their own words without one',
     /^<b>E\(AS\)\.<\/b> E\(A narrow valve\.\) Flow below the line runs back/.test(note({ view: 'flow', lesion: 'as' })) && /^<b>Flow follows the gradient\.<\/b>/.test(note({ view: 'flow' }))
     && /The splits are measured where the pressures cross\./.test(note({ view: 'right', lesion: 'as' })) && /^<b>Same cycle, quarter the pressure/.test(note({ view: 'right' }))
     && /The glow is on a scale that holds the normal heart/.test(note({ view: 'coronary', lesion: 'as' })) && /^<b>The left ventricle squeezes its own arteries\.<\/b>/.test(note({ view: 'coronary' })));
  ok('Curves and Conduction say their own words, whatever the lesion, and ask nothing', /^<b>Two curves, one intersection\.<\/b>/.test(note({ view: 'curves', lesion: 'as' })) && J(asked) === J([])
     && /^<b>The pause is the point\.<\/b>/.test(note({ view: 'conduction', lesion: 'as' })));
  /* Read with its comments blanked: the shell explains itself, and quotes what is looked for. */
  const pg = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
  const n = t => pg.split(t).length - 1;
  ok('the page\'s physioNoteHtml() hands over what the panel chose, its tables, and the beat and phase to ask, and keeps no copy of the words',
     n("function physioNoteHtml(){ return RhythmLabScreen.noteHtml({view:physioView,lesion:physioLesion,iv:physioIv,") === 1
     && n("cycle:()=>physio&&physio.cycle&&physio.cycle(),phase:()=>physioPhaseNow()}); }") === 1 && n('The dashed loop is the normal heart') === 0 && n('Two curves, one intersection') === 0);
}

head('what a tap on the cycle panel does, and a rhythm chip');
{
  /* A stand-in page: chips with the data attributes the panel draws, a store, a live diagram and a draw, each saying what
     it was asked, in order. What each handler should do is worked out here by hand, from the old bodies' plain reading. */
  const rig = (st0, o = {}) => {
    const log = [], saved = {};
    const chip = (attr, key, val) => { const b = { attr, val, dataset: { [key]: val }, hot: false, textContent: '-', title: '-' };
      b.classList = { toggle: (c, on) => { if (c === 'hot') b.hot = !!on; } }; return b; };
    const chips = [chip('data-physio-lesion', 'physioLesion', 'normal'), chip('data-physio-lesion', 'physioLesion', 'as'),
      chip('data-physio-slow', 'physioSlow', '1'), chip('data-physio-slow', 'physioSlow', '2'), chip('data-physio-slow', 'physioSlow', '4'),
      chip('data-physio-play', 'physioPlay', ''), chip('data-physio-play', 'physioPlay', ''),
      chip('data-physio-view', 'physioView', 'wiggers'), chip('data-physio-view', 'physioView', 'pv'),
      chip('data-physio-iv', 'physioIv', 'base'), chip('data-physio-iv', 'physioIv', 'ino')];
    const physio = o.noPhysio ? null : { play: () => log.push('play'), pause: () => log.push('pause'), setRate: r => log.push('rate ' + r), setIntervention: i => log.push('iv ' + i) };
    if (physio && !o.noSetSlow) physio.setSlow = n => log.push('slow ' + n);
    const st = Object.assign({ kind: 'sinus', physio, view: 'wiggers', iv: 'base', lesion: 'normal', slow: 2, playing: null, notePhase: 'Ejection' }, st0);
    const env = {
      doc: { querySelectorAll: q => { const m = /^\[([a-z-]+)\]$/.exec(q); return m ? chips.filter(c => c.attr === m[1]) : []; } },
      store: { getItem: () => null, setItem: (k, v) => { if (o.storeThrows) throw new Error('full'); saved[k] = v; log.push('save ' + k + '=' + v); } },
      reducedMotion: () => { log.push('asked'); if (o.mmThrows) throw new Error('no matchMedia'); return !!o.reduced; },
      RHYTHMS: { sinus: { hr: 68 }, vt: { hr: 180 }, asys: { hr: 0 } },
      render: () => log.push('render'), applyLesion: () => log.push('applyLesion'), paintNote: () => log.push('paintNote "' + st.notePhase + '"'),
    };
    const hot = attr => chips.filter(c => c.attr === attr && c.hot).map(c => c.val);
    const tap = (fn, attr, val) => run(() => L[fn](st, chips.find(c => c.attr === attr && c.val === val), env));
    return { log, saved, st, env, chips, hot, tap };
  };
  const run = f => { try { return f(); } catch (err) { return 'THREW ' + err.message; } };

  {
    const a = rig({}, { reduced: true }), first = run(() => L.isPlaying(a.st, a.env)), again = run(() => L.isPlaying(a.st, a.env));
    ok('isPlaying(): the first time, the device is asked, once; with Reduce Motion on the cycle is paused, and stays so',
       first === false && again === false && a.st.playing === false && J(a.log) === J(['asked']), J([first, again, a.log]));
    const b = rig({}), c = rig({}, { mmThrows: true });
    ok('without Reduce Motion it plays, and a device that cannot be asked plays too', run(() => L.isPlaying(b.st, b.env)) === true && b.st.playing === true
       && run(() => L.isPlaying(c.st, c.env)) === true && c.st.playing === true, J([b.st.playing, c.st.playing]));
    const d = rig({ playing: false }), f = rig({ playing: true }, { reduced: true });
    ok('once decided, it is not asked again: paused stays paused, and playing stays playing whatever the device says',
       run(() => L.isPlaying(d.st, d.env)) === false && run(() => L.isPlaying(f.st, f.env)) === true && d.log.length + f.log.length === 0, J([d.log, f.log]));
  }
  {
    const a = rig({ playing: false });
    const on = run(() => L.setPlaying(a.st, true, a.env)), saysOn = a.chips.filter(c => c.attr === 'data-physio-play').map(c => c.textContent + '/' + c.title);
    const off = run(() => L.setPlaying(a.st, 0, a.env)), saysOff = a.chips.filter(c => c.attr === 'data-physio-play').map(c => c.textContent + '/' + c.title);
    ok('setPlaying(): played, the diagram plays and every Play chip says Pause; 0 pauses it, kept as false, and the chips say Play',
       on === undefined && off === undefined && J(saysOn) === J(['Pause/Pause the cycle', 'Pause/Pause the cycle']) && J(saysOff) === J(['Play/Play the cycle', 'Play/Play the cycle'])
       && a.st.playing === false && J(a.log.slice(-2)) === J(['play', 'pause']), J([saysOn, saysOff, a.st.playing, a.log]));
    const b = rig({ playing: true }, { noPhysio: true }), r = run(() => L.setPlaying(b.st, false, b.env));
    ok('with no diagram mounted, the chips still say what a tap would do', r === undefined && b.st.playing === false && b.chips.filter(c => c.attr === 'data-physio-play').every(c => c.textContent === 'Play'), String(r));
  }
  {
    const a = rig({}), r = run(() => L.setSlow(a.st, 4, a.env));
    ok('setSlow(): the speed is kept as given, remembered as text, handed to the diagram, and its chip alone is marked',
       r === undefined && a.st.slow === 4 && J(a.saved) === J({ 'accsap12.physioslow': '4' }) && J(a.log) === J(['save accsap12.physioslow=4', 'slow 4']) && J(a.hot('data-physio-slow')) === J(['4'])
       && J(a.hot('data-physio-lesion').concat(a.hot('data-physio-view'), a.hot('data-physio-iv'))) === J([]), J([r, a.st.slow, a.log, a.hot('data-physio-slow')]));
    run(() => L.setSlow(a.st, 1, a.env));
    ok('another speed moves the mark', J(a.hot('data-physio-slow')) === J(['1']) && a.st.slow === 1, J(a.hot('data-physio-slow')));
    const b = rig({}, { storeThrows: true }), c = rig({}, { noSetSlow: true }), d = rig({}, { noPhysio: true });
    const rs = [b, c, d].map(x => run(() => L.setSlow(x.st, 4, x.env)));
    ok('a store that refuses, a diagram with no speed of its own, or none at all, and the speed is still kept and marked',
       rs.every(x => x === undefined) && [b, c, d].every(x => x.st.slow === 4 && J(x.hot('data-physio-slow')) === J(['4'])) && J(b.log) === J(['slow 4']) && J(c.log) === J(['save accsap12.physioslow=4']), J([rs, b.log, c.log]));
  }
  {
    const a = rig({ lead: 'V1' }), r = run(() => L.setKind(a.st, 'vt', a.env));
    ok('setKind(): the rhythm is kept, the diagram given its rate, then the screen drawn again; the lead selected stays',
       r === undefined && a.st.kind === 'vt' && a.st.lead === 'V1' && J(a.log) === J(['rate 180', 'render']), J([r, a.st.kind, a.log]));
    const b = rig({}), c = rig({}, { noPhysio: true });
    run(() => L.setKind(b.st, 'asys', b.env)); const rc = run(() => L.setKind(c.st, 'vt', c.env));
    ok('a rhythm with no rate gives the diagram 68; with no diagram, the screen is only drawn again',
       J(b.log) === J(['rate 68', 'render']) && rc === undefined && c.st.kind === 'vt' && J(c.log) === J(['render']), J([b.log, rc, c.log]));
  }
  {
    const a = rig({ view: 'pv' }), r = a.tap('chooseLesion', 'data-physio-lesion', 'as');
    ok('chooseLesion() in the PV loop: kept, remembered, and the panel drawn again, since the interventions come and go with it; nothing else',
       r === undefined && a.st.lesion === 'as' && a.st.notePhase === 'Ejection' && J(a.log) === J(['save accsap12.physiolesion=as', 'render']) && J(a.hot('data-physio-lesion')) === J([]), J([r, a.log]));
    const b = rig({}), rb = b.tap('chooseLesion', 'data-physio-lesion', 'as');
    ok('in any other view: kept and remembered, handed to the diagram, its chip alone marked, and the caption painted from no phase',
       rb === undefined && b.st.lesion === 'as' && b.st.notePhase === '' && J(b.log) === J(['save accsap12.physiolesion=as', 'applyLesion', 'paintNote ""'])
       && J(b.hot('data-physio-lesion')) === J(['as']) && J(b.hot('data-physio-view').concat(b.hot('data-physio-iv'), b.hot('data-physio-slow'))) === J([]), J([rb, b.log, b.hot('data-physio-lesion')]));
    const c = rig({}, { storeThrows: true }), rc = c.tap('chooseLesion', 'data-physio-lesion', 'normal');
    ok('a store that refuses changes nothing else', rc === undefined && c.st.lesion === 'normal' && J(c.log) === J(['applyLesion', 'paintNote ""']) && J(c.hot('data-physio-lesion')) === J(['normal']), J([rc, c.log]));
  }
  {
    const a = rig({}), r = a.tap('chooseView', 'data-physio-view', 'pv'), b = rig({}, { storeThrows: true }), rb = b.tap('chooseView', 'data-physio-view', 'pv');
    ok('chooseView(): kept, remembered, and the screen drawn again, which marks the chip; a store that refuses only goes unwritten',
       r === undefined && a.st.view === 'pv' && J(a.log) === J(['save accsap12.physioview=pv', 'render']) && rb === undefined && b.st.view === 'pv' && J(b.log) === J(['render']), J([r, a.log, rb, b.log]));
  }
  {
    const a = rig({ view: 'pv' }), r = a.tap('chooseIv', 'data-physio-iv', 'ino');
    ok('chooseIv(): kept, handed to the diagram, the lesion handed again over it, its chip alone marked, and the caption painted from no phase',
       r === undefined && a.st.iv === 'ino' && a.st.notePhase === '' && J(a.log) === J(['iv ino', 'applyLesion', 'paintNote ""']) && J(a.hot('data-physio-iv')) === J(['ino'])
       && Object.keys(a.saved).length === 0, J([r, a.log, a.hot('data-physio-iv')]));
  }
  /* Read with its comments blanked: the module says in prose what it does not touch. From the first handler to the export,
     a name of the page's not reached through st or env (no dot before it) is the page reached around them. */
  const mod = blankComments(fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'rhythmlab.js'), 'utf8'));
  const at = mod.indexOf('function isPlaying('), end = mod.indexOf('root.RhythmLabScreen');
  /* The quoted selectors and keys name the page's attributes, not its code, and are set aside; the handlers quote with ' alone. */
  const part = at >= 0 && end > at ? mod.slice(at, end).replace(/'[^'\n]*'/g, "''") : '';
  const seen = ['document', 'localStorage', 'window', 'matchMedia', 'render', 'physioApplyLesion', 'paintPhysioNote', 'RHYTHMS', 'physio', 'LAB',
    'Wiggers', 'ECG12', 'ECGMonitor', 'requestAnimationFrame', 'LEAD12_MAP', 'leadCardHtml', 'loadWiggers', 'S', 'Circulation', 'Physio'].filter(t => new RegExp('(?<![.\\w$])' + t + '\\b').test(part));
  ok('the handlers, and the functions below them, reach the page only through what they are handed', part.length > 0 && seen.length === 0, part ? (seen.join(' ') || 'none of the page\'s names') : 'handlers not found');
}

head('the beat handed to the diagram, and the caption painted');
{
  /* A stand-in page again: a diagram that says what beat it was handed, an engine that names the beat it ran, a caption
     and a pill that keep what was written into them, and a loader that keeps what it was asked to call. */
  const PH = [{ id: 'ivc', name: 'Isovolumic contraction' }, { id: 'ej', name: 'Ejection' }];
  const rig = (st0, o = {}) => {
    const log = [], els = {};
    if (!o.noNote) els.physioNote = { innerHTML: '-' };
    if (!o.noPill) els.physioPhase = { textContent: '-' };
    const physio = o.noPhysio ? null : { setCycle: (c, r) => log.push('setCycle ' + c + ' ' + r), time: () => (o.t == null ? 0.2 : o.t) };
    if (physio && o.phase != null) physio.phaseNow = () => PH[o.phase];
    let C = o.noEngine ? undefined : { cycle: id => { if (o.throws) throw new Error('no beat'); return 'beat(' + id + ')'; }, INTERVENTIONS: o.noIvs ? undefined : { ino: 'inotrope' } };
    const st = Object.assign({ physio, view: 'wiggers', iv: 'base', lesion: 'normal', notePhase: '' }, st0);
    const later = [];
    const env = {
      doc: { getElementById: id => els[id] || null, querySelectorAll: () => [] },
      Physio: () => ({ phaseAt: t => PH[t > 0.5 ? 1 : 0] }), Circulation: () => C,
      loadCirculation: then => { log.push('load'); later.push(then); },
      noteHtml: () => { log.push('noteHtml'); return 'NOTE ' + st.view; }, VIEWS: [['wiggers', 'Wiggers'], ['pv', 'PV loop'], ['flow', 'Flow']],
      applyLesion: () => { log.push('applyLesion'); L.applyLesion(st, env); }, paintNote: () => { log.push('paintNote "' + st.notePhase + '"'); },
    };
    return { log, els, st, env, later, arrive: () => { C = { cycle: id => 'beat(' + id + ')', INTERVENTIONS: {} }; } };
  };
  const run = f => { try { return f(); } catch (err) { return 'THREW ' + err.message; } };
  {
    const a = rig({}), b = rig({}, { noEngine: true }), c = rig({}, { throws: true });
    ok('cycle(): a lesion is the engine\'s beat of that lesion; without the engine, or where it throws, none',
       run(() => L.cycle(a.st, 'as', a.env)) === 'beat(as)' && run(() => L.cycle(b.st, 'as', b.env)) === null && run(() => L.cycle(c.st, 'as', c.env)) === null,
       J([L.cycle(a.st, 'as', a.env), run(() => L.cycle(b.st, 'as', b.env)), run(() => L.cycle(c.st, 'as', c.env))]));
    const pv = rig({ view: 'pv', iv: 'ino' }), flow = rig({ view: 'flow', iv: 'ino' }), unknown = rig({ view: 'pv', iv: 'gone' }), none = rig({ view: 'pv', iv: 'ino' }, { noIvs: true });
    const said = [pv, flow, unknown, none].map(x => run(() => L.cycle(x.st, 'normal', x.env)));
    ok('Normal is, in the PV loop, the chosen intervention\'s beat; elsewhere, for an intervention the engine has not, or an engine with none, the normal beat',
       J(said) === J(['beat(inotrope)', 'beat(normal)', 'beat(normal)', 'beat(normal)']), J(said));
    ok('ref(): the normal beat, or none without the engine or where it throws',
       run(() => L.ref(a.env)) === 'beat(normal)' && run(() => L.ref(b.env)) === null && run(() => L.ref(c.env)) === null, J([run(() => L.ref(a.env)), run(() => L.ref(b.env)), run(() => L.ref(c.env))]));
  }
  {
    const a = rig({ view: 'pv', iv: 'ino', lesion: 'normal' }), r = run(() => L.applyLesion(a.st, a.env));
    ok('applyLesion(): the diagram is handed the chosen beat and the normal one, and the engine is not asked for',
       r === undefined && J(a.log) === J(['setCycle beat(inotrope) beat(normal)']), J([r, a.log]));
    const b = rig({ lesion: 'as' }, { noEngine: true }), rb = run(() => L.applyLesion(b.st, b.env));
    ok('without the engine: it is asked for, and the diagram draws its own beat meanwhile',
       rb === undefined && J(b.log) === J(['load', 'setCycle null undefined']) && b.later.length === 1, J([rb, b.log]));
    b.log.length = 0; b.st.notePhase = 'ivc'; b.arrive(); const rl = run(() => b.later[0]());
    ok('and when it is there, the lesion is handed over again, and the caption painted from no phase',
       rl === undefined && J(b.log) === J(['applyLesion', 'setCycle beat(as) beat(normal)', 'paintNote ""']) && b.st.notePhase === '', J([rl, b.log]));
    const c = rig({}, { noPhysio: true, noEngine: true }), rc = run(() => L.applyLesion(c.st, c.env));
    ok('with no diagram, nothing is handed and nothing asked for', rc === undefined && J(c.log) === J([]), J([rc, c.log]));
  }
  {
    const own = rig({}, { phase: 1, t: 0.1 }), clock = rig({}, { t: 0.9 }), none = rig({}, { noPhysio: true });
    ok('phaseNow(): the diagram\'s own phase where it says one, else Physio\'s at the diagram\'s time, else at the start',
       run(() => L.phaseNow(own.st, own.env).id) === 'ej' && run(() => L.phaseNow(clock.st, clock.env).id) === 'ej' && run(() => L.phaseNow(none.st, none.env).id) === 'ivc',
       J([own, clock, none].map(x => run(() => L.phaseNow(x.st, x.env).id))));
  }
  {
    const a = rig({ notePhase: '' }, { phase: 1 }), r = run(() => L.paintNote(a.st, a.env));
    ok('paintNote() in Wiggers: a phase not yet shown is written, the caption and the pill painted with it',
       r === undefined && a.st.notePhase === 'ej' && a.els.physioNote.innerHTML === 'NOTE wiggers' && a.els.physioPhase.textContent === 'Ejection' && J(a.log) === J(['noteHtml']), J([r, a.st.notePhase, a.els, a.log]));
    a.els.physioNote.innerHTML = 'kept'; run(() => L.paintNote(a.st, a.env));
    ok('and the same phase again paints nothing', a.els.physioNote.innerHTML === 'kept' && J(a.log) === J(['noteHtml']), J([a.els.physioNote.innerHTML, a.log]));
    /* A view besides Wiggers, asked twice in the phase it already holds. */
    const twice = view => { const x = rig({ view, notePhase: 'ivc' }, { phase: 0 }); run(() => L.paintNote(x.st, x.env)); run(() => L.paintNote(x.st, x.env)); return [x.els.physioPhase.textContent, x.st.notePhase, x.log.length]; };
    ok('in the PV loop it paints each time it is asked, the pill naming the view, and the phase it holds is left',
       J(twice('pv')) === J(['PV loop', 'ivc', 2]), J(twice('pv')));
    /* The guard is Wiggers' alone: a view that is neither Wiggers nor the PV loop paints each time too. */
    ok('and so does Flow, a view that is neither', J(twice('flow')) === J(['Flow', 'ivc', 2]), J(twice('flow')));
    const c = rig({}, { noNote: true, phase: 1 }), d = rig({ view: 'flow' }, { noPill: true });
    const rc = run(() => L.paintNote(c.st, c.env)), rd = run(() => L.paintNote(d.st, d.env));
    ok('with no caption on the page nothing is painted or kept; with no pill, the caption alone',
       rc === undefined && c.st.notePhase === '' && J(c.log) === J([]) && rd === undefined && d.els.physioNote.innerHTML === 'NOTE flow', J([rc, c.st.notePhase, c.log, rd]));
  }
}

head('the mounts: the monitor, the 12-lead and the cycle, drawn into their canvases');
{
  /* A stand-in page with the three canvases, a lead card and the cycle's chips, and stand-ins for the diagrams' code that
     say what they were asked: Wiggers mounts a diagram, ECG12 a 12-lead, ECGMonitor a monitor. Wiggers' load is a
     promise that has already settled, so what it does is seen at once. What each mount should do is worked out here. */
  const rig = (st0, o = {}) => {
    const log = [], frames = [];
    const canvas = id => ({ id, getBoundingClientRect: () => ({ left: 10, top: 20 }), setPointerCapture: p => log.push(id + ' capture ' + p),
      releasePointerCapture: p => { log.push(id + ' release ' + p); if (o.releaseThrows) throw new Error('gone'); } });
    const els = {};
    if (!o.noLabCanvas) els.labCanvas = canvas('labCanvas');
    if (!o.noPhysioCanvas) els.physioCanvas = canvas('physioCanvas');
    if (!o.noTwelveCanvas) els.twelveCanvas = canvas('twelveCanvas');
    els.leadCard = { innerHTML: '-' };
    const chip = (attr, key, val) => { const b = { attr, val, dataset: { [key]: val }, hot: false, textContent: '-', title: '-' };
      b.classList = { toggle: (c, on) => { if (c === 'hot') b.hot = !!on; } }; return b; };
    const chips = [chip('data-physio-lesion', 'physioLesion', 'as'), chip('data-physio-slow', 'physioSlow', '4'), chip('data-physio-play', 'physioPlay', ''),
      chip('data-physio-view', 'physioView', 'pv'), chip('data-physio-iv', 'physioIv', 'ino')];
    let n = 0;
    const diagram = () => { const tag = 'cycle' + (++n);
      return { tag, destroy: () => log.push(tag + ' destroy'), setIntervention: i => log.push(tag + ' iv ' + i), scrubAt: (x, y) => log.push(tag + ' scrub ' + x + ',' + y),
        setScrub: on => log.push(tag + ' scrub ' + on), draw: () => log.push(tag + ' draw'), play: () => log.push(tag + ' play'), pause: () => log.push(tag + ' pause'),
        setSlow: s => log.push(tag + ' slow ' + s), setRate: r => log.push(tag + ' rate ' + r) }; };
    const Wiggers = { mount: (cv, op) => { const { onFrame, ...rest } = op; log.push('Wiggers ' + cv.id + ' ' + J(rest)); frames.push(() => onFrame && onFrame()); return o.mountFails ? null : diagram(); } };
    const ECG12 = { mount: (cv, op) => { log.push('ECG12 ' + cv.id + ' ' + J(op)); return o.twelveFails ? null : {
      select: id => log.push('select ' + id), leadAt: (x, y) => (x > 50 ? 'V1' : x > 20 ? 'II' : null), draw: () => log.push('twelve draw') }; } };
    class ECGMonitor { constructor(cv, op) { this.cv = cv.id; log.push('monitor ' + cv.id + ' ' + J(op)); } start() { log.push('monitor start'); } destroy() { log.push('monitor destroy ' + this.cv); } }
    let libs = { Wiggers: o.noWiggers ? undefined : Wiggers, ECG12: o.noECG12 ? undefined : ECG12, ECGMonitor };
    const st = Object.assign({ mon: null, kind: 'sinus', physio: null, view: 'wiggers', iv: 'base', canvas: null, lesion: 'normal', slow: 2, playing: true, twelve: null, lead: null, notePhase: 'Ejection' }, st0);
    const env = {
      doc: { getElementById: id => els[id] || null, querySelectorAll: q => { const m = /^\[([a-z-]+)\]$/.exec(q); return m ? chips.filter(c => c.attr === m[1]) : []; } },
      store: { getItem: () => null, setItem: (k, v) => log.push('save ' + k + '=' + v) }, reducedMotion: () => false,
      RHYTHMS: { sinus: { hr: 68 }, vt: { hr: 180 }, asys: { hr: 0 }, afib: { hr: 110 } }, render: () => log.push('render'),
      applyLesion: () => log.push('applyLesion'), paintNote: () => log.push('paintNote "' + st.notePhase + '"'),
      dark: () => !!o.dark, libs: () => libs, frame: f => frames.push(f), screen: () => (o.screen || 'lab'),
      lead12: k => ({ sinus: 'sinus', afib: 'afib' })[k], leadCardHtml: id => 'card ' + id,
      loadWiggers: () => ({ then: f => { log.push('load Wiggers'); if (o.arrives) libs = Object.assign({}, libs, { Wiggers }); if (o.canvasReplaced) els.physioCanvas = canvas('physioCanvas'); f(!!o.arrives); } }),
    };
    const runFrames = () => { frames.splice(0).forEach(f => f()); };
    /* Anything the mount did not bind, tapped, says so in the log, so the check that asked fails and the run goes on. */
    const call = (el, h, ev) => (el && typeof el[h] === 'function' ? el[h](ev) : log.push('no ' + h));
    return { log, els, chips, st, env, runFrames, call, tap: attr => call(chips.find(c => c.attr === attr), 'onclick') };
  };
  const run = f => { try { return f(); } catch (err) { return 'THREW ' + err.message; } };

  {
    const a = rig({ kind: 'vt', view: 'flow', iv: 'ino', slow: 4, playing: false }, { dark: true }), r = run(() => L.mountPhysio(a.st, a.env));
    ok('mountPhysio(): the diagram is mounted with the view, the theme, the rhythm\'s rate, the speed and whether it plays, then handed the intervention and the lesion, and the caption painted from no phase',
       r === undefined && J(a.log) === J(['Wiggers physioCanvas {"view":"flow","dark":true,"hr":180,"slow":4,"playing":false}', 'cycle1 iv ino', 'applyLesion', 'paintNote ""'])
       && a.st.physio && a.st.physio.tag === 'cycle1' && a.st.canvas === a.els.physioCanvas, J([r, a.log]));
    a.log.length = 0; a.runFrames();
    ok('and on the next frames it is drawn, and each frame it draws paints the caption', J(a.log) === J(['paintNote ""', 'cycle1 draw']), J(a.log));
    const b = rig({ kind: 'asys', playing: null }), rb = run(() => L.mountPhysio(b.st, b.env));
    ok('a rhythm with no rate gives it 68, and whether it plays is decided then', rb === undefined && /"hr":68,"slow":2,"playing":true\}$/.test(b.log[0]) && b.st.playing === true, J([rb, b.log[0]]));
  }
  {
    const a = rig({}); run(() => L.mountPhysio(a.st, a.env)); a.log.length = 0;
    const again = run(() => L.mountPhysio(a.st, a.env));
    ok('mounted again on the same canvas, nothing is done: one diagram per canvas', again === undefined && J(a.log) === J([]) && a.st.physio.tag === 'cycle1', J(a.log));
    a.els.physioCanvas = { id: 'physioCanvas', getBoundingClientRect: () => ({ left: 0, top: 0 }) }; run(() => L.mountPhysio(a.st, a.env));
    ok('on a new canvas the old diagram is destroyed before the new one is mounted', a.log[0] === 'cycle1 destroy' && /^Wiggers physioCanvas /.test(a.log[1]) && a.st.physio.tag === 'cycle2' && a.st.canvas === a.els.physioCanvas, J(a.log.slice(0, 2)));
    const c = rig({}, { mountFails: true }), rc = run(() => L.mountPhysio(c.st, c.env));
    ok('a diagram that will not mount leaves nothing kept and nothing handed', rc === undefined && c.st.physio === null && c.st.canvas === null && c.log.length === 1, J([rc, c.log]));
  }
  {
    const old = { tag: 'old', destroy() { this.gone = true; } };
    const a = rig({ physio: old, canvas: {} }, { noWiggers: true, arrives: true }), r = run(() => L.mountPhysio(a.st, a.env));
    ok('without Wiggers: the diagram there was destroyed and forgotten, Wiggers asked for, and mounted when it is there, the canvas still the panel\'s',
       r === undefined && old.gone === true && a.log[0] === 'load Wiggers' && /^Wiggers physioCanvas /.test(a.log[1]) && a.st.physio && a.st.physio.tag === 'cycle1', J([r, a.log.slice(0, 2)]));
    const b = rig({}, { noWiggers: true, arrives: true, canvasReplaced: true }), c = rig({}, { noWiggers: true });
    run(() => L.mountPhysio(b.st, b.env)); run(() => L.mountPhysio(c.st, c.env));
    ok('but not when the canvas was replaced meanwhile, nor when Wiggers could not be had', J(b.log) === J(['load Wiggers']) && J(c.log) === J(['load Wiggers']) && b.st.physio === null && c.st.physio === null, J([b.log, c.log]));
    const d = rig({ physio: { tag: 'old', destroy() { this.gone = true; } } }, { noPhysioCanvas: true });
    const rd = run(() => L.mountPhysio(d.st, d.env));
    ok('with no canvas, the diagram is destroyed and forgotten, and Wiggers not asked for', rd === undefined && d.st.physio === null && d.st.canvas === null && J(d.log) === J([]), J([rd, d.log]));
  }
  {
    const a = rig({ view: 'wiggers' }); run(() => L.mountPhysio(a.st, a.env)); a.log.length = 0;
    ['data-physio-slow', 'data-physio-play', 'data-physio-lesion', 'data-physio-iv', 'data-physio-view'].forEach(t => run(() => a.tap(t)));
    ok('each chip the mount bound does its own handler\'s work: the speed, Play, the lesion, the intervention, the view',
       a.st.slow === 4 && a.st.playing === false && a.st.lesion === 'as' && a.st.iv === 'ino' && a.st.view === 'pv'
       && J(a.log) === J(['save accsap12.physioslow=4', 'cycle1 slow 4', 'cycle1 pause', 'save accsap12.physiolesion=as', 'applyLesion', 'paintNote ""', 'cycle1 iv ino', 'applyLesion', 'paintNote ""', 'save accsap12.physioview=pv', 'render']), J(a.log));
  }
  {
    const a = rig({ view: 'wiggers' }); run(() => L.mountPhysio(a.st, a.env)); a.log.length = 0;
    const cv = a.els.physioCanvas;
    const at = (h, ev) => run(() => a.call(cv, h, ev));
    at('onpointermove', { clientX: 99, clientY: 99 });
    at('onpointerdown', { pointerId: 7, clientX: 40, clientY: 50 }); at('onpointermove', { pointerId: 7, touches: [{ clientX: 70, clientY: 30 }] }); at('onpointerup', { pointerId: 7 });
    at('onpointermove', { clientX: 99, clientY: 99 }); at('onpointerup', { pointerId: 7 });
    ok('dragging the diagram scrubs it at the finger, less the canvas\'s corner, and paints the caption; a move with no finger down, or a second lift, does nothing',
       J(a.log) === J(['cycle1 scrub true', 'physioCanvas capture 7', 'cycle1 scrub 30,30', 'paintNote ""', 'cycle1 scrub 60,10', 'paintNote ""', 'cycle1 scrub false', 'physioCanvas release 7']), J(a.log));
    const pv = ['pv', 'curves'].map(view => { const x = rig({ view }); run(() => L.mountPhysio(x.st, x.env)); x.log.length = 0; run(() => x.call(x.els.physioCanvas, 'onpointerdown', { pointerId: 1, clientX: 40, clientY: 50 })); return x.log.length; });
    const b = rig({}, { releaseThrows: true }); run(() => L.mountPhysio(b.st, b.env));
    const rb = run(() => { b.call(b.els.physioCanvas, 'onpointerdown', { pointerId: 2, clientX: 40, clientY: 50 }); b.call(b.els.physioCanvas, 'onpointercancel', { pointerId: 2 }); });
    ok('the PV loop and Curves, which have no time to scrub, take no drag; a cancelled drag ends it, and a capture already gone is let be',
       J(pv) === J([0, 0]) && rb === undefined && b.log.slice(-2).join() === 'cycle1 scrub false,physioCanvas release 2', J([pv, rb, b.log.slice(-2)]));
  }
  {
    const a = rig({ kind: 'afib', lead: 'II' }, { dark: true }), r = run(() => L.mountTwelve(a.st, a.env));
    ok('mountTwelve(): the 12-lead of the rhythm\'s own, its rate and the theme, the lead selected kept, and drawn on the next frame',
       r === undefined && J(a.log) === J(['ECG12 twelveCanvas {"kind":"afib","hr":110,"dark":true}', 'select II']) && (a.runFrames(), a.log[a.log.length - 1] === 'twelve draw'), J([r, a.log]));
    a.log.length = 0; const cv = a.els.twelveCanvas;
    const tapAt = x => run(() => a.call(cv, 'onclick', { clientX: x, clientY: 5 }));
    tapAt(70); const first = [a.st.lead, a.els.leadCard.innerHTML];
    tapAt(70); const second = [a.st.lead, a.els.leadCard.innerHTML];
    tapAt(20);
    ok('a tap on a lead selects it and draws its card; on it again lets it go; off any lead does nothing',
       J(first) === J(['V1', 'card V1']) && J(second) === J([null, 'card null']) && J(a.log) === J(['select V1', 'select null']), J([first, second, a.log]));
    const b = rig({ kind: 'vt' }), c = rig({ twelve: 'old' }, { noECG12: true }), d = rig({ twelve: 'old' }, { noTwelveCanvas: true });
    run(() => L.mountTwelve(b.st, b.env)); run(() => L.mountTwelve(c.st, c.env)); run(() => L.mountTwelve(d.st, d.env));
    ok('a rhythm with no 12-lead of its own is drawn as sinus at its own rate; with no ECG12 or no canvas there is no 12-lead',
       b.log[0] === 'ECG12 twelveCanvas {"kind":"sinus","hr":180,"dark":false}' && c.st.twelve === null && d.st.twelve === null && c.log.length + d.log.length === 0, J([b.log[0], c.log, d.log]));
  }
  {
    const a = rig({ kind: 'vt' }), r = run(() => L.mountLab(a.st, a.env));
    ok('mountLab() on the Lab: the monitor made for the rhythm and started, then the 12-lead and the cycle mounted',
       r === undefined && a.log[0] === 'monitor labCanvas {"kind":"vt","speed":0.15,"grid":true,"amp":60,"lineWidth":2.2}' && a.log[1] === 'monitor start'
       && /^ECG12 twelveCanvas /.test(a.log[2]) && /^Wiggers physioCanvas /.test(a.log[3]) && a.st.mon && a.st.mon.cv === 'labCanvas', J([r, a.log.slice(0, 4)]));
    a.log.length = 0; run(() => L.mountLab(a.st, a.env));
    ok('drawn again, the monitor that was running is destroyed before the next is made', a.log[0] === 'monitor destroy labCanvas' && /^monitor labCanvas /.test(a.log[1]), J(a.log.slice(0, 2)));
    const b = rig({}, { screen: 'home' }); b.st.mon = { destroy: () => b.log.push('monitor destroy') }; const rb = run(() => L.mountLab(b.st, b.env));
    const c = rig({}, { noLabCanvas: true }); run(() => L.mountLab(c.st, c.env));
    ok('on any other screen the monitor is destroyed and nothing is mounted; on the Lab with no monitor canvas, the diagrams still are',
       rb === undefined && J(b.log) === J(['monitor destroy']) && b.st.mon === null && c.st.mon === null && /^ECG12 /.test(c.log[0]) && /^Wiggers /.test(c.log[1]), J([b.log, c.log.slice(0, 2)]));
  }
}

head('the page hands over what it has, and keeps what is chosen');
{
  /* Read with its comments blanked: the page explains itself, and quotes what is looked for. Positions are
     kept, so code found in the blanked copy is taken from the real one. */
  const raw = fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8');
  const shell = blankComments(raw);
  const count = text => shell.split(text).length - 1;
  const LINE = 'function buildLab(){ return RhythmLabScreen.screenHtml({RHYTHMS,RHYTHM_KEYS,labKind,PHYSIO_VIEWS,PHYSIO_SPEEDS,PHYSIO_LESIONS,physioView,physioSlow,physioIv,physioLesion,physioIsPlaying,\n'
             + '  Physio:typeof Physio!==\'undefined\'?Physio:undefined,LEAD12_MAP,twelveLead,leadCardHtml,e,icon}); }';
  ok('buildLab() is one call: the rhythms and which is chosen, the cycle\'s choices and the function that says whether it plays, Physio if the page has it, the leads, and the helpers',
     count(LINE) === 1 && count('function buildLab(') === 1, `${count(LINE)} such call(s), ${count('function buildLab(')} declaration(s)`);
  const slot = shell.indexOf('@@SLOT[src:src/app/rhythmlab.js]@@');
  ok('the module is written into the page once, above it', slot >= 0 && count('@@SLOT[src:src/app/rhythmlab.js]@@') === 1 && shell.indexOf(LINE) > slot, slot < 0 ? 'no slot' : 'slot at ' + slot);
  ok('the two panel builders are no longer the page\'s, and the screen\'s own words are not in it',
     count('function buildPhysio(') === 0 && count('function buildTwelveLead(') === 0 && count('tap a rhythm to morph the trace') === 0 && count('A teaching model: every curve') === 0 && count('teaches the wrong pattern') === 0,
     [count('function buildPhysio('), count('function buildTwelveLead('), count('tap a rhythm to morph the trace'), count('A teaching model: every curve'), count('teaches the wrong pattern')].join(' '));

  const all = draw(page({ labKind: 'sinus', physioView: 'pv', twelveLead: 'V1' }));
  const handlers = [...new Set(actionsOf(all))].sort();
  ok('its markup names two actions, and carries no inline handler, in any panel', J(handlers) === J(['goHome', 'setLab']) && inlineOf(all).length === 0 && inlineOf(draw(page({ labKind: 'vt', physioView: 'wiggers' }))).length === 0, handlers.join(' ') + ' · ' + (inlineOf(all).join(' ') || 'no on* attribute'));
  const TABLE = { goHome: 'goHome:()=>goHome(),', setLab: 'setLab:el=>setLab(el.dataset.kind),' };
  const table = (shell.match(/const ACTIONS=\{([\s\S]*?)\n\};/) || [])[1] || '';
  ok('each is in the page\'s ACTIONS table once, calling the page\'s function of that name, which the page declares once; setLab passes the key from the chip\'s data',
     handlers.length === 2 && handlers.every(n => table.split(TABLE[n]).length === 2 && count('function ' + n + '(') === 1) && count('Actions.install(document,ACTIONS);') === 1,
     handlers.map(n => n + ':' + (table.split(TABLE[n] || '\u0000').length - 1) + '/' + count('function ' + n + '(')).join(' '));

  /* The markup is the module's, and so, since the mounts and the caption's painter moved, is what finds its elements
     again; a lookup left in the page counts too. The two meet at six ids and five data attributes: a name changed on
     one side leaves a canvas or a caption nothing can find, and nothing says so. Both are read with their comments
     blanked. */
  const ids = [...new Set([...all.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]))].sort();
  const modSrc = blankComments(fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'rhythmlab.js'), 'utf8'));
  const lookedUp = id => count('getElementById(\'' + id + '\')') + modSrc.split('getElementById(\'' + id + '\')').length - 1 > 0;
  /* physioModel is the seventh: the note that says the cycle is a teaching model. The page does not look it up;
     tests/verify-physio.js reads it there. */
  const MOUNTED = ['labCanvas', 'leadCard', 'physioCanvas', 'physioNote', 'physioPhase', 'twelveCanvas'];
  const sectionIds = ['labRhythm', 'labRhythmHeading', 'labLoop', 'labLoopHeading'];
  ok('the mounted elements and the section links have their distinct ids, and each mounted one is looked up by the page or the module',
     J(ids) === J(MOUNTED.concat('physioModel', sectionIds).sort()) && MOUNTED.every(lookedUp) && !lookedUp('physioModel'),
     ids.map(i => i + (lookedUp(i) ? '' : ' (not looked up)')).join(' '));
  const wig = draw(page({ physioView: 'wiggers' }));
  const datas = [...new Set([...(all + wig).matchAll(/\b(data-physio-[a-z]+)\b/g)].map(m => m[1]))].sort();
  /* The taps are bound by the cycle's mount, which is the module's since it left the page: each attribute's chips, found
     and each given an onclick. A query that only marks a chip (the handlers do that too) is not a binding. */
  const physioMount = (at => at < 0 ? '' : modSrc.slice(at, modSrc.indexOf('\n}\n', at)))(modSrc.indexOf('function mountPhysio(st,env){'));
  const binds = d => physioMount.split(new RegExp("querySelectorAll\\('\\[" + d + "\\]'\\)\\.forEach\\(b=>\\s*b\\.onclick=")).length - 1;
  ok('and every data attribute on a cycle chip, in the PV loop and the Wiggers view, is one the cycle\'s mount binds a tap to', J(datas) === J(['data-physio-iv', 'data-physio-lesion', 'data-physio-play', 'data-physio-slow', 'data-physio-view']) && datas.every(d => binds(d) === 1),
     physioMount ? datas.map(d => d + ':' + binds(d)).join(' ') : 'no mountPhysio(st,env) in the module');

  ok('which rhythm is chosen is still the page\'s to keep: its state is LAB, made by the module, and labKind is a view of LAB.kind',
     count('const LAB=RhythmLabScreen.state({getItem:k=>localStorage.getItem(k)},PHYSIO_VIEWS,PHYSIO_LESIONS);') === 1 && count("labKind:labView('kind')") === 1
     && count('const labView=f=>({get(){ return LAB[f]; },set(v){ LAB[f]=v; },configurable:true});') === 1);
  const ONE = ['function setLab(k){ RhythmLabScreen.setKind(LAB,k,LAB_ENV); }', 'function setPhysioSlow(n){ RhythmLabScreen.setSlow(LAB,n,LAB_ENV); }',
    'function physioIsPlaying(){ return RhythmLabScreen.isPlaying(LAB,LAB_ENV); }', 'function setPhysioPlaying(on){ RhythmLabScreen.setPlaying(LAB,on,LAB_ENV); }'];
  ok('setLab(), setPhysioSlow(), physioIsPlaying() and setPhysioPlaying() are one line each into the module, with LAB and what the page lends it, each declared once',
     ONE.every(l => count(l) === 1) && ['setLab', 'setPhysioSlow', 'physioIsPlaying', 'setPhysioPlaying'].every(n => count('function ' + n + '(') === 1), ONE.map(l => count(l)).join(' '));
  const MOUNTS = ['function mountPhysio(){ RhythmLabScreen.mountPhysio(LAB,LAB_ENV); }', 'function mountTwelve(){ RhythmLabScreen.mountTwelve(LAB,LAB_ENV); }',
    'function mountLab(){ RhythmLabScreen.mountLab(LAB,LAB_ENV); }'];
  const TAPS = ["doc.querySelectorAll('[data-physio-lesion]').forEach(b=>b.onclick=()=>chooseLesion(st,b,env));",
    "doc.querySelectorAll('[data-physio-view]').forEach(b=>b.onclick=()=>chooseView(st,b,env));",
    "doc.querySelectorAll('[data-physio-iv]').forEach(b=>b.onclick=()=>chooseIv(st,b,env));",
    'b.onclick=()=>setSlow(st,+b.dataset.physioSlow,env));', 'b.onclick=()=>setPlaying(st,!isPlaying(st,env),env));'];
  ok('mountPhysio(), mountTwelve() and mountLab() are one line each into the module, each declared once, and the module\'s cycle mount hands each chip to its own handler, with the state and what the page lends',
     MOUNTS.every(l => count(l) === 1) && ['mountPhysio', 'mountTwelve', 'mountLab'].every(n => count('function ' + n + '(') === 1) && physioMount.length > 0 && TAPS.every(l => physioMount.split(l).length === 2),
     MOUNTS.map(l => count(l)).join(' ') + ' · ' + (physioMount ? TAPS.map(l => physioMount.split(l).length - 1).join(' ') : 'no mountPhysio(st,env)'));
  ok('and the page keeps no copy of what they do: no key they remember a choice under, and no word the Play chip says',
     count('accsap12.physio') === 0 && count('Pause the cycle') === 0 && count("'Pause'") === 0, [count('accsap12.physio'), count('Pause the cycle'), count("'Pause'")].join(' '));

  /* The page's own line, with the page's own constants and helpers and the real Physio and Leads12, in a
     context that has nothing else. The rhythms are invented: the page's table is the waveform engine's. */
  const whole = (from, to) => { const a = shell.indexOf(from); if (a < 0 || shell.indexOf(from, a + 1) >= 0) return '\nthrow new Error("not in the page once: ' + from.replace(/["\\]/g, '') + '");\n'; const b = shell.indexOf(to, a); return raw.slice(a, b + to.length); };
  const file = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const pageCode = [whole('function icon(name, cls){', '\n}'), whole('const ESC={', '\n'), whole('const e=s=>', '\n'), whole('const PHYSIO_VIEWS=[', '];'), whole('const PHYSIO_SPEEDS=[', '\n'),
    whole('const PHYSIO_LESIONS=[', '];'), whole('const LEAD12_MAP={', '};'), whole('const LAB=RhythmLabScreen.state(', '\n'), whole('const labView=', '\n'), whole('Object.defineProperties(window,{labMon:', '});'), whole('const LAB_ENV=', '};\n'), whole('function physioIsPlaying(){', '\n'), whole('function setPhysioSlow(n){', '\n'),
    whole('function setPhysioPlaying(on){', '\n'), whole('function setLab(k){', '\n'), whole('function leadCardHtml(id){', '\n'),
    whole('let circLibP=null, labCircWait=null;', '\n'), whole('function physioCycle(id){', '\n'), whole('function physioRef(){', '\n'), whole('function physioApplyLesion(){', '\n'),
    whole('function physioPhaseNow(){', '\n'), whole('function paintPhysioNote(){', '\n'), whole('function mountPhysio(){', '\n'), whole('function mountTwelve(){', '\n'),
    whole('function mountLab(){', '\n')].join('\n');
  const world = (state, opts) => {
    const ctx = { RHYTHMS: { sinus: { name: 'Sinus <rhythm>', hr: 68, desc: 'Normal & regular' }, vt: { name: 'VT', hr: 180, desc: 'Fast' } }, RHYTHM_KEYS: ['sinus', 'vt'] };
    ctx.window = ctx; if (opts && opts.reduce !== undefined) ctx.matchMedia = () => ({ matches: opts.reduce });
    vm.createContext(ctx);
    const ask = code => { try { return vm.runInContext(code, ctx); } catch (err) { return 'THREW ' + err.message; } };
    const loaded = ask((opts && opts.noPhysio ? '' : file('src/core/physio.js') + '\n') + file('src/core/leads12.js') + '\n' + file('src/app/rhythmlab.js') + '\n' + pageCode + '\n' + LINE + '\n"loaded"');
    /* The state is set after the page's lines have run, as a suite sets it from inside a loaded page: written into the
       same script, its vars are hoisted above them and made before LAB's views can be. */
    if (loaded === 'loaded') ask(state);
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
  /* A tap, as the page takes it: the real src/core/actions.js listening on a stand-in document, the page's own ACTIONS
     table over stand-ins for setLab() and goHome() that record their calls, and each button the page's own line drew,
     with the attributes it drew, as the element tapped. */
  const calls = [];
  const tctx = { calls }; tctx.window = tctx; vm.createContext(tctx);
  vm.runInContext(file('src/core/actions.js') + '\nfunction goHome(){ calls.push("goHome"); }\nfunction setLab(k){ calls.push("setLab " + k); }\nfunction memForget(){ calls.push("memForget"); }\nfunction memForgetAll(){ calls.push("memForgetAll"); }\n'
    + (shell.match(/const ACTIONS=\{[\s\S]*?\n\};/) || ['const ACTIONS={};'])[0].replace(/^const /, 'var ') + '\nvar listeners=[]; var doc={ addEventListener:(t,f)=>listeners.push([t,f]), removeEventListener(){}, contains:()=>true };\nActions.install(doc,ACTIONS);', tctx);
  const tapped = [...w.shown.matchAll(/<button\b([^>]*)>/g)].map(m => Object.fromEntries([...m[1].matchAll(/([a-z-]+)="([^"]*)"/g)].map(x => [x[1], x[2]]))).filter(at => 'data-action' in at);
  for (const at of tapped) {
    const el = { nodeType: 1, getAttribute: k => (k in at ? at[k] : null), dataset: { kind: at['data-kind'] }, closest: sel => (sel === '[data-action]' ? el : null) };
    tctx.listeners.filter(l => l[0] === 'click').forEach(l => l[1]({ target: el }));
  }
  ok('tapped through the real Actions and the page\'s table, the buttons the page\'s own line drew go home and set each rhythm by its own key',
     J(calls) === J(['goHome', 'setLab sinus', 'setLab vt']), J(calls));
  /* What the page lends the handlers, LAB_ENV, over stand-ins for the document, the store, the draw and the two mounts'
     functions, called through the page's own lines as a tap would call them. */
  const live = world('var labKind="sinus", physioView="wiggers", physioSlow=2, physioIv="base", twelveLead=null;', { reduce: false });
  const wired = live.ask(`var did=[], chip=(a,k,v)=>({a,v,dataset:{[k]:v},hot:false,textContent:'-',classList:{toggle(c,on){ if(c==='hot') this.owner.hot=!!on; }}});
    var chips=[chip('data-physio-slow','physioSlow','2'),chip('data-physio-slow','physioSlow','4'),chip('data-physio-lesion','physioLesion','normal'),chip('data-physio-lesion','physioLesion','as'),chip('data-physio-play','physioPlay','')];
    chips.forEach(c=>{ c.classList.owner=c; });
    document={querySelectorAll:q=>chips.filter(c=>q==='['+c.a+']')};
    localStorage={getItem:()=>null,setItem:(k,v)=>did.push('save '+k+'='+v)};
    render=()=>did.push('render'); physioApplyLesion=()=>did.push('applyLesion'); paintPhysioNote=()=>did.push('paintNote "'+__physioNotePhase+'"');
    physio={setSlow:n=>did.push('slow '+n),setRate:r=>did.push('rate '+r),play:()=>did.push('play'),pause:()=>did.push('pause')};
    setPhysioSlow(4); setLab('vt'); setPhysioPlaying(false); RhythmLabScreen.chooseLesion(LAB,chips[3],LAB_ENV);
    JSON.stringify({did,slow:physioSlow,kind:labKind,playing:physioPlaying,lesion:physioLesion,play:chips[4].textContent,hot:chips.filter(c=>c.hot).map(c=>c.v)})`);
  const want = { did: ['save accsap12.physioslow=4', 'slow 4', 'rate 180', 'render', 'pause', 'save accsap12.physiolesion=as', 'applyLesion', 'paintNote ""'],
    slow: 4, kind: 'vt', playing: false, lesion: 'as', play: 'Play', hot: ['4', 'as'] };
  ok('through LAB_ENV the handlers find the page\'s document, store, draw, lesion and caption: each call reaches its own, in order, and the old names read what was chosen',
     wired === J(want), String(wired));
  const BEAT = ['function physioCycle(id){ return RhythmLabScreen.cycle(LAB,id,LAB_ENV); }', 'function physioRef(){ return RhythmLabScreen.ref(LAB_ENV); }',
    'function physioApplyLesion(){ RhythmLabScreen.applyLesion(LAB,LAB_ENV); }', 'function physioPhaseNow(){ return RhythmLabScreen.phaseNow(LAB,LAB_ENV); }',
    'function paintPhysioNote(){ RhythmLabScreen.paintNote(LAB,LAB_ENV); }'];
  const kept = [count('Circulation.cycle('), count('.phaseAt('), count("getElementById('physioNote')"), count("getElementById('physioPhase')")];
  ok('physioCycle(), physioRef(), physioApplyLesion(), physioPhaseNow() and paintPhysioNote() are one line each into the module, each declared once, and the page asks the engine for no beat, reads no phase, and looks up no caption or pill of its own',
     BEAT.every(l => count(l) === 1) && ['physioCycle', 'physioRef', 'physioApplyLesion', 'physioPhaseNow', 'paintPhysioNote'].every(n => count('function ' + n + '(') === 1) && kept.every(k => k === 0),
     BEAT.map(l => count(l)).join(' ') + ' · kept ' + kept.join(' '));
  /* The engine's load, as LAB_ENV does it, called through the page's own names: the split build's file asked for once while
     a load is under way, and when it is in, the chosen lesion's beat handed over and the caption painted from no phase. A
     failed load is not remembered. The world has physio.js and no circulation engine, as the split build's page does. */
  const loading = fail => world('var labKind="sinus", physioView="wiggers", physioSlow=2, physioIv="base", twelveLead=null;', { reduce: false }).ask(`var did=[], made=[], noteEl={innerHTML:'-'}, pillEl={textContent:'-'};
    CIRC_SRC='vendor/circulation.js';
    document={getElementById:id=>({physioNote:noteEl,physioPhase:pillEl})[id]||null, querySelectorAll:()=>[],
      createElement:t=>{ const s={t,src:'',remove(){ did.push('remove '+this.src); }}; made.push(s); return s; }, head:{appendChild:s=>did.push('append '+s.src)}};
    physioNoteHtml=()=>'NOTE '+physioView;
    physio={setCycle:(c,r)=>did.push('setCycle '+(c&&c.id)+' '+(r&&r.id)), phaseNow:()=>({id:'ej',name:'Ejection'}), time:()=>0};
    physioApplyLesion(); physioApplyLesion();
    if(${fail}){ made[0].onerror(); physioApplyLesion(); }
    else { Circulation={cycle:id=>({id}),INTERVENTIONS:{}}; physioLesion='as'; made[0].onload(); }
    JSON.stringify({did, scripts:made.length, phase:__physioNotePhase, note:noteEl.innerHTML, pill:pillEl.textContent, loading:circLibP!==null})`);
  const arrived = loading(false), failed = loading(true);
  ok('without the engine, the page\'s names ask for its file once while it loads, and when it is in, hand over the chosen lesion\'s beat and paint the caption from no phase',
     arrived === J({ did: ['append vendor/circulation.js', 'setCycle null undefined', 'setCycle null undefined', 'setCycle as normal'], scripts: 1, phase: 'ej', note: 'NOTE wiggers', pill: 'Ejection', loading: true }), String(arrived));
  ok('and a load that fails is let go, so the next drawing asks again',
     failed === J({ did: ['append vendor/circulation.js', 'setCycle null undefined', 'setCycle null undefined', 'remove vendor/circulation.js', 'append vendor/circulation.js', 'setCycle null undefined'], scripts: 2, phase: '', note: '-', pill: '-', loading: true }), String(failed));
  const joined = world('').ask(`var ready=[], did=[];
    CIRC_SRC='vendor/circulation.js'; circLibP={ then: callback=>ready.push(callback) };
    LAB_ENV.loadCirculation(()=>did.push('repaint'));
    LAB_ENV.loadCirculation(()=>did.push('duplicate repaint'));
    Circulation={}; ready.forEach(callback=>callback());
    JSON.stringify({subscriptions:ready.length, did})`);
  ok('Rhythm Lab joins another screen\'s pending circulation load once and repaints when it arrives',
     joined === J({ subscriptions: 1, did: ['repaint'] }), String(joined));
  /* The two of LAB_ENV's loans the load above does not reach: Physio, asked where a diagram keeps only a clock, and the
     views, which name the pill outside Wiggers. The diagram's time, 0.62, is in rapid filling, a phase the start of the
     cycle is not in, so a Physio asked at the wrong time says so. */
  const read = world('var labKind="sinus", physioView="flow", physioSlow=2, physioIv="base", twelveLead=null;', { reduce: false }).ask(`var noteEl={innerHTML:'-'}, pillEl={textContent:'-'};
    document={getElementById:id=>({physioNote:noteEl,physioPhase:pillEl})[id]||null, querySelectorAll:()=>[]};
    physioNoteHtml=()=>'NOTE'; physio={time:()=>0.62};
    var at=physioPhaseNow(), want=Physio.phaseAt(0.62); paintPhysioNote();
    JSON.stringify({phase:at.id, physio:want.id, start:Physio.phaseAt(0).id, pill:pillEl.textContent, view:PHYSIO_VIEWS.find(v=>v[0]==='flow')[1]})`);
  const rd = (() => { try { return JSON.parse(read); } catch (err) { return {}; } })();
  ok('and LAB_ENV lends the page\'s own Physio and views: a diagram with only a clock is in Physio\'s phase at its time, and outside Wiggers the pill names the page\'s own view',
     rd.phase === rd.physio && rd.phase !== rd.start && typeof rd.phase === 'string' && rd.pill === rd.view && rd.view === 'Flow', String(read));
  /* The mounts, called through the page's own mountLab(), over stand-ins for the diagrams' code, the next frame, the screen
     and Wiggers' load, with the page's own LEAD12_MAP and lead card. AF has a 12-lead of its own in the page's map and is
     given a rate here. The theme is asked three ways: the page's dark, its light, and none, where the device's is dark. */
  const mounted = (theme, late) => world('var labKind="afib", physioView="wiggers", physioSlow=2, physioIv="base", twelveLead="V1";', { reduce: false }).ask(`var did=[], frames=[], cv={};
    RHYTHMS.afib={name:'AF',hr:110,desc:'Irregular'};
    ['labCanvas','physioCanvas','twelveCanvas','leadCard'].forEach(id=>cv[id]={id,innerHTML:'-',getBoundingClientRect:()=>({left:0,top:0})});
    document={getElementById:id=>cv[id]||null, querySelectorAll:()=>[], documentElement:{getAttribute:a=>a==='data-theme'?${J(theme)}:null, hasAttribute:a=>a==='data-theme'&&${J(theme)}!==null}};
    matchMedia=q=>({matches:/dark/.test(q)});
    var W={mount:(c,o)=>{ did.push('Wiggers '+c.id+' dark '+o.dark+' hr '+o.hr); return {setIntervention(){},draw:()=>did.push('cycle draw')}; }};
    if(!${late}) Wiggers=W;
    ECG12={mount:(c,o)=>{ did.push('ECG12 '+c.id+' '+o.kind+' dark '+o.dark); return {select:id=>did.push('select '+id),leadAt:()=>'V2',draw:()=>did.push('twelve draw')}; }};
    ECGMonitor=class{ constructor(c,o){ did.push('monitor '+c.id+' '+o.kind); } start(){ did.push('monitor start'); } destroy(){} };
    requestAnimationFrame=f=>frames.push(f); S={screen:'lab'}; loadWiggers=()=>({then:f=>{ did.push('load Wiggers'); Wiggers=W; f(true); }});
    physioApplyLesion=()=>did.push('applyLesion'); paintPhysioNote=()=>did.push('paintNote');
    mountLab(); frames.forEach(f=>f()); cv.twelveCanvas.onclick({clientX:5,clientY:5});
    JSON.stringify({did, card:/lead-id">V2</.test(cv.leadCard.innerHTML), lead:twelveLead})`);
  const wantMounted = (dark, late) => J({ did: ['monitor labCanvas afib', 'monitor start', 'ECG12 twelveCanvas afib dark ' + dark, 'select V1'].concat(late ? ['load Wiggers'] : [],
    ['Wiggers physioCanvas dark ' + dark + ' hr 110', 'applyLesion', 'paintNote', 'twelve draw', 'cycle draw', 'select V2']), card: true, lead: 'V2' });
  const themes = [mounted('dark', false), mounted('light', false), mounted(null, false), mounted('dark', true)];
  ok('through LAB_ENV the page\'s mounts find the diagrams\' code, the next frame, Wiggers\' load, the page\'s 12-lead map and lead card, and the page\'s theme, or where it has none the device\'s',
     themes[0] === wantMounted(true, false) && themes[1] === wantMounted(false, false) && themes[2] === wantMounted(true, false) && themes[3] === wantMounted(true, true),
     themes.map(t => String(t).slice(0, 160)).join(' | '));
  /* The screen the page is on, which the check above holds at the Lab: here a monitor is running and the page has moved on. */
  const away = world('var labKind="sinus", physioView="wiggers", physioSlow=2, physioIv="base", twelveLead=null;', { reduce: false }).ask(`var did=[];
    document={getElementById:id=>({id}), querySelectorAll:()=>[], documentElement:{getAttribute:()=>null, hasAttribute:()=>false}};
    ECGMonitor=class{ constructor(){ did.push('monitor'); } start(){} destroy(){} }; ECG12={mount:()=>{ did.push('ECG12'); return null; }}; Wiggers={mount:()=>{ did.push('Wiggers'); return null; }};
    requestAnimationFrame=()=>{}; loadWiggers=()=>({then(){}});
    labMon={destroy:()=>did.push('monitor destroy')}; S={screen:'home'}; mountLab();
    JSON.stringify({did, mon:labMon})`);
  ok('and the screen the page is on: once it has left the Lab, the page\'s mountLab() stops the monitor and mounts nothing',
     away === J({ did: ['monitor destroy'], mon: null }), String(away));
  const bare = world('var labKind="sinus", physioView="flow", physioSlow=1, physioIv="base", twelveLead=null;', { noPhysio: true, reduce: false });
  ok('on a page with no Physio the screen is still drawn outside the PV loop', !bare.shown.startsWith('THREW') && bare.shown.includes('<span>Cardiac cycle · Flow</span>'), bare.shown.slice(0, 90));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
