#!/usr/bin/env node
/*
 * The app's themes, and which one a saved choice is — src/core/themes.js.
 *
 *   node tests/verify-themes-pure.js
 *
 * Pure Node. The table is the module's; what is held here is what the app relies on of it, and that the script which
 * adopts the saved theme before anything paints (app/systole.html's first inline script, which runs ahead of every
 * module) draws each theme as the table says.
 *
 * What is measured, rather than assumed:
 *   - every theme has an id of its own, a group of light or dark, a mode its group allows (Auto is light's), a
 *     palette or none, and the three colours of its swatch and bar;
 *   - a saved choice is its own theme; the old 'dark' and 'light' are Midnight and Daylight; anything else is Auto;
 *   - a theme is dark by its mode, and Auto by the system, which is asked only for Auto;
 *   - only Auto follows the system; the next theme after the last is the first;
 *   - the script before paint gives every theme, and the two old names, the mode and palette the table gives;
 *   - the page's names are the calls into this, written into the page once, above them.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');
const T = require('../src/core/themes.js').Themes;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);
const safely = fn => { try { return fn(); } catch (e) { return 'THREW ' + e.message; } };
const HEX = /^#[0-9A-F]{6}$/i;

head('every theme is one the app can draw');
{
  const ids = T.LIST.map(t => t.id);
  ok('each has an id of its own, and byId finds it', new Set(ids).size === ids.length && ids.every(id => T.byId[id] && T.byId[id].id === id), ids.join(' '));
  ok('each is light or dark, with a mode its group allows: Auto is light\'s', T.LIST.every(t => (t.group === 'light' && ['auto', 'light'].includes(t.mode)) || (t.group === 'dark' && t.mode === 'dark')),
     J(T.LIST.filter(t => !((t.group === 'light' && ['auto', 'light'].includes(t.mode)) || (t.group === 'dark' && t.mode === 'dark'))).map(t => t.id)));
  ok('Auto is the first, and the only one that follows the system', T.LIST[0].id === 'auto' && T.LIST.filter(t => t.mode === 'auto').length === 1);
  ok('each has a palette or none, a name, and the three colours of its swatch and bar', T.LIST.every(t => (t.palette === null || /^[a-z]+$/.test(t.palette)) && t.name && HEX.test(t.bg) && HEX.test(t.ac) && HEX.test(t.bar)));
}

head('which theme a saved choice is');
{
  ok('a saved id is its own theme', T.LIST.every(t => safely(() => T.def(t.id)) === t));
  ok('the old dark and light are Midnight and Daylight', safely(() => T.def('dark').id) === 'midnight' && safely(() => T.def('light').id) === 'daylight');
  /* A restored backup's theme is any string (ProgressData only asks that it be one), and the table is a plain
     object: "constructor" found Object itself, "__proto__" its prototype, and the page set data-theme="undefined" and
     drew no theme at all. */
  const inherited = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];
  ok('a name every object inherits is no theme, and is Auto', inherited.every(v => safely(() => T.def(v)) === T.byId.auto), inherited.map(v => { const t = safely(() => T.def(v)); return v + ':' + (t && t.id || typeof t); }).join(' '));
  ok('nothing saved, or a name no theme has, is Auto', [undefined, null, '', 'sepia', 'Midnight'].every(v => safely(() => T.def(v)) === T.byId.auto), [undefined, null, '', 'sepia', 'Midnight'].map(v => safely(() => T.def(v).id)).join(' '));
}

head('dark, light, or as the system is');
{
  let asked = 0; const sys = d => () => (asked++, d);
  ok('a dark theme is dark and a light one light, the system not asked', T.isDark(T.byId.midnight, sys(false)) === true && T.isDark(T.byId.daylight, sys(true)) === false && asked === 0, asked + ' asked');
  ok('Auto is as the system is', T.isDark(T.byId.auto, sys(true)) === true && T.isDark(T.byId.auto, sys(false)) === false && asked === 2);
  ok('and light where the system cannot say', T.isDark(T.byId.auto, null) === false && T.isDark(T.byId.auto, () => undefined) === false);
  ok('only Auto follows the system, and no theme at all does', T.followsSystem(T.byId.auto) && !T.followsSystem(T.byId.midnight) && !T.followsSystem(T.byId.slate) && T.followsSystem(null));
  ok('the next theme is the one after it, and after the last, the first', safely(() => T.next('auto')) === T.LIST[1].id && safely(() => T.next(T.LIST[T.LIST.length - 1].id)) === 'auto');
}

head('the script before paint draws each theme as the table says');
{
  /* It runs ahead of every module, so it has a map of its own. Read with comments blanked, and run on its own. */
  const page = fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8');
  const m = /var _M=(\{[\s\S]*?\});/.exec(blankComments(page));
  const M = m ? safely(() => new Function('return ' + m[1])()) : null;
  ok('the map is there to read', !!M && typeof M === 'object', m ? 'found' : 'not found');
  const want = t => [t.mode === 'auto' ? '' : t.mode, t.palette || ''];
  const off = M && typeof M === 'object' ? T.LIST.filter(t => J(M[t.id]) !== J(want(t))).map(t => t.id + ': ' + J(M[t.id]) + ' not ' + J(want(t))) : ['no map'];
  ok('every theme, with the mode and palette the table gives', off.length === 0, off.join('; ') || 'all ' + T.LIST.length);
  ok('and the two old names as the themes they now are', !!M && J(M.dark) === J(want(T.def('dark'))) && J(M.light) === J(want(T.def('light'))), M ? J([M.dark, M.light]) : '');
  ok('and no theme the table does not have', !!M && Object.keys(M).every(k => T.byId[k] || k === 'dark' || k === 'light'), M ? Object.keys(M).filter(k => !T.byId[k] && k !== 'dark' && k !== 'light').join(' ') || 'none' : '');
}

head('the page\'s names are the calls into this');
{
  const page = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
  const n = t => page.split(t).length - 1;
  const lines = ['const THEMES=Themes.LIST, THEME_BY_ID=Themes.byId;', 'function themeDef(){ return Themes.def(S.theme); }',
    "function themeIsDark(t){ return Themes.isDark(t||themeDef(),()=>!!(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)); }",
    'function themeFollowsSystem(){ return Themes.followsSystem(themeDef()); }', 'function cycleTheme(){ setTheme(Themes.next(themeDef().id)); }'];
  const missing = lines.filter(l => n(l) !== 1);
  ok('each is one line handing over what the page holds', missing.length === 0, missing.join(' | ') || 'all five');
  const slot = page.indexOf('@@SLOT[src:src/core/themes.js]@@');
  ok('the module is written into the page once, above them', slot >= 0 && n('@@SLOT[src:src/core/themes.js]@@') === 1 && slot < page.indexOf('const THEMES=Themes.LIST'), slot < 0 ? 'no slot' : 'slot at ' + slot);
  ok('and the page keeps no second table', n("{id:'midnight'") === 0 && n('Object.fromEntries(THEMES') === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
