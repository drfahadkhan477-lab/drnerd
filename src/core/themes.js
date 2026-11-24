/* ═════════════════════════════════════════════
   themes.js — the app's themes, and which one a saved choice is (docs/ROADMAP.md, E1).

   A theme is a mode (which drives every existing component style) paired with
   a palette (which recolours the core tokens). 'auto' follows the system.
   The swatch is the two colours the eye reads first: the ground, and the
   accent laid over it.

     LIST, byId               every theme, in the order the menu shows them, and by id
     def(saved)               the theme a saved choice is: its id; an old name (OLD), the theme it now is; anything
                              else Auto
     OLD                      the old names and the themes they now are
     isDark(t, systemDark)    whether t is drawn dark; for Auto, what systemDark() says (asked only then)
     followsSystem(t)         true only while the theme has no opinion of its own
     next(id)                 the theme after id, round to the first

   They were app/systole.html's THEMES, THEME_BY_ID, themeDef(), themeIsDark(), themeFollowsSystem() and the step
   in cycleTheme(), moved unchanged but for what they read of the page (S.theme, matchMedia), which they are now
   handed. The page keeps each name. The script that adopts the saved theme before anything paints has its own
   small map, because it runs ahead of this; tests/verify-themes-pure.js holds the two to each other.

   Pure: no DOM, no clock, no storage. ES2015; Safari 13.4 is the floor (README).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

/* FOUR, AND EACH KEPT CORRECT (docs/ROADMAP.md, D6, decided November 2026): Auto, one light, one dark and the
   high-contrast one, the floor the roadmap set. Every palette multiplied the contrast and floor checks; the app keeps
   no record of which themes are used, so the floor is what is kept. */
const LIST=[
  {id:'auto',     name:'Auto',      group:'light', mode:'auto',  palette:null,        bg:'#EFF3F8',ac:'#0284C7',bar:'#0A1628'},
  {id:'daylight', name:'Daylight',  group:'light', mode:'light', palette:null,        bg:'#EFF3F8',ac:'#0284C7',bar:'#0F1E3D'},
  {id:'midnight', name:'Midnight',  group:'dark',  mode:'dark',  palette:null,        bg:'#0A1628',ac:'#0EA5E9',bar:'#0A1628'},
  {id:'contrast', name:'Contrast',  group:'dark',  mode:'dark',  palette:'contrast',  bg:'#060606',ac:'#38BDF8',bar:'#060606'},
];
const byId=Object.fromEntries(LIST.map(t=>[t.id,t]));
/* Only the table's own themes: a saved "constructor" or "__proto__" (a restored backup's theme is any string) found
   what every object inherits, and the page drew no theme at all. */
const own=k=>typeof k==='string'&&Object.prototype.hasOwnProperty.call(byId,k)?byId[k]:null;
/* What a choice saved under an old name now is. The bare 'dark' and 'light' came first; the five retired with D6 are
   each the kept theme of their own lightness, so nobody's page changes from light to dark, or back, on upgrade. */
const OLD={dark:'midnight',light:'daylight',
  slate:'daylight',parchment:'daylight',nocturne:'midnight',cathlab:'midnight',monitor:'midnight'};
function def(saved){ return own(saved)||own(Object.prototype.hasOwnProperty.call(OLD,saved)?OLD[saved]:null)||byId.auto; }
function isDark(t, systemDark){
  if(t.mode==='dark')return true;
  if(t.mode==='light')return false;
  return !!(systemDark&&systemDark());
}
/* True only while the chosen theme has no opinion of its own. Every other
   theme is a decision, and a decision is not revisited because the sun set. */
function followsSystem(t){ return !t || t.mode==='auto'; }
function next(id){ const i=LIST.findIndex(t=>t.id===id); return LIST[(i+1)%LIST.length].id; }

root.Themes = { LIST, byId, def, isDark, followsSystem, next, OLD: Object.freeze(Object.assign({}, OLD)) };

})(typeof window !== 'undefined' ? window : this);
