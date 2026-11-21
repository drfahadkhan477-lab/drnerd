/* ═════════════════════════════════════════════
   terms.js — how a note, a question or a query becomes the terms the search scores (docs/ROADMAP.md, E1).

   The words of a text, lower-cased, without the words every question says (STOP), without numbers and without
   words of under three letters unless they are a clinical abbreviation (SHORTOK), each stemmed conservatively
   (stemWord), and a hyphenated word also as its parts. They were app/systole.html's STOP, KEEP, STEMMED, stem(),
   stemWord(), SHORTOK and tok(), and moved here unchanged; tests/verify-terms-pure.js holds them, and the suites
   that rank (verify-phrase-pure, verify-indexwarm-pure) run them as the page does.

     tok(s)          the terms of a text, in order: [string]
     stem(w)         stemWord(w), remembered: the index stems the same few thousand words again and again
     stemWord(w)     a word's stem: amyloidosis and amyloid, ischemia and ischemic, stenotic and stenosis meet;
                     a word of four letters or fewer, or one in KEEP, is its own; a stem under five letters is
                     refused, and the word kept
     STOP, SHORTOK   the words left out, and the short words kept

   The page keeps stem(), stemWord() and tok() as one line each. Pure: no DOM, no clock, no storage; the memo is
   this module's own and is a function of the word alone, so it is never stale. ES2015; Safari 13.4 is the floor
   (README).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

const STOP=new Set(('a an the and or but if then than that this these those of in on at to for with '+
 'from by as is are was were be been being it its he she they them his her their you your we our '+
 'which who whom what when where why how all any both each few more most other some such no nor not '+
 'only own same so too very can will just should now also may might one two patient patients year '+
 'years old man woman male female presents present presented history following one-of which-one '+
 'answer choice correct incorrect because therefore however although while during after before '+
 'likely most-likely appropriate next best initial').split(/\s+/));

/* conservative stemmer — medical morphology is unforgiving */
const KEEP=/^(stenosis|sclerosis|thrombosis|fibrosis|necrosis|diagnosis|prognosis|anastomosis|apoptosis|stasis|crisis|axis|basis)$/;
/* The index stems every token of every document, and a few thousand words make up nearly all of them: each is stemmed
   once. The answer is a function of the word alone, so what is kept can never be stale. */
const STEMMED=new Map();
function stem(w){
  let s=STEMMED.get(w);
  if(s===undefined){
    if(STEMMED.size>60000) STEMMED.clear();
    s=stemWord(w); STEMMED.set(w,s);
  }
  return s;
}
function stemWord(w){
  if(w.length<=4) return w;
  if(KEEP.test(w)) return w;
  // fold clinical morphology: amyloidosis/amyloid, ischemia/ischemic, stenotic/stenosis
  // 'otic' only folds when a real stem survives (stenotic->stenosis is handled below)
  let x=w.replace(/(osis|osed)$/,'').replace(/otic$/, m=>'')
         .replace(/(aemia|emia|aemic|emic)$/,'em')
         .replace(/(pathy|pathic)$/,'path')
         .replace(/(itis|itic)$/,'it')
         .replace(/(ically|ical|ically)$/,'ic')
         .replace(/(fication|fied|fying)$/,'fi')
         .replace(/(tion|sion)$/,'t')
         .replace(/(ance|ence)$/,'an')
         .replace(/(ing|ed)$/,'');
  if(x.length<5) x=w;                       // refuse aggressive truncation
  if(/^sten/.test(w)) x='stenosis';         // stenosis / stenotic / stenoses
  if(/ies$/.test(x)) return x.slice(0,-3)+'y';
  if(/(ches|shes|xes|ses)$/.test(x)) return x.slice(0,-2);
  if(/(us|ss|is|as)$/.test(x)) return x;
  if(/s$/.test(x)) return x.slice(0,-1);
  return x;
}
// short clinical abbreviations that a length>=3 filter would otherwise erase
const SHORTOK=new Set(['qt','av','mi','pe','lv','rv','la','ra','pa','bp','hr','ef','cad','chd',
  'afib','vt','vf','svt','avb','mr','ar','ts','tr','pr','ps','as','mv','tv','pv','ivc','svc',
  'lad','lcx','rca','pci','cabg','icd','ppm','crt','hf','cvd','dvt','copd','osa']);
function tok(s){
  const out=[];
  for(let t of String(s||'').toLowerCase().split(/[^a-z0-9₀-₉+/-]+/)){
    /* Only a token with a - + or / at an end has anything to trim; most have none. */
    const a=t.charCodeAt(0), z=t.charCodeAt(t.length-1);
    if(a===45||a===43||a===47||z===45||z===43||z===47) t=t.replace(/^[-+/]+|[-+/]+$/g,'');
    if(!t||STOP.has(t)||/^\d+$/.test(t)) continue;
    if(t.length<3 && !SHORTOK.has(t)) continue;
    out.push(t.length<=4&&SHORTOK.has(t)?t:stem(t));
    if(t.includes('-')) for(const p of t.split('-')) if((p.length>=3||SHORTOK.has(p))&&!STOP.has(p)) out.push(SHORTOK.has(p)?p:stem(p));
  }
  return out;
}

root.Terms = { STOP, SHORTOK, stemWord, stem, tok };

})(typeof window !== 'undefined' ? window : this);
