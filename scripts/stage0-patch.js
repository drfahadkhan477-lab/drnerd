#!/usr/bin/env node
/*
 * Stage 0 — stabilize the single-file ACCSAP build.
 *
 * Applies the Stage 0 fixes from docs/BUILD-PLAN.html to an exported artifact,
 * without touching its structure: the output is still one self-contained file
 * you can drop in Files and open in Safari.
 *
 *   node scripts/stage0-patch.js <input.html> <output.html>
 *
 * Every edit below asserts it matched exactly once. If a future export changes
 * the surrounding code, this fails loudly instead of silently doing nothing.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
  console.error('usage: node scripts/stage0-patch.js <input.html> <output.html>');
  process.exit(1);
}

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];

function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) {
    throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  }
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ────────────────────────────────────────────────────────────────────────────
 * 1. Typefaces embedded — the app makes no network request on launch
 * ──────────────────────────────────────────────────────────────────────────── */
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
function face(family, file, style, weight) {
  const b64 = fs.readFileSync(path.join(FONT_DIR, file)).toString('base64');
  return `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};` +
         `font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
}
const FACES = [
  face('DM Sans', 'DMSans.woff2', 'normal', '400 700'),
  face('DM Sans', 'DMSans-Italic.woff2', 'italic', '400 700'),
  face('DM Serif Display', 'DMSerifDisplay.woff2', 'normal', '400'),
  face('JetBrains Mono', 'JetBrainsMono.woff2', 'normal', '400 700'),
].join('\n');

patch('fonts: drop Google Fonts links',
`<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Serif+Display&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
`,
`<!-- Typefaces are embedded in the stylesheet below (DM Sans, DM Serif Display,
     JetBrains Mono — SIL Open Font License). This file requests nothing from
     the network, so it opens identically on a plane or a hospital wifi. -->
`);

patch('fonts: embed faces',
'<style>\n',
'<style>\n/* ══ embedded typefaces — latin subset, OFL ══ */\n' + FACES + '\n\n');

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Question count — one item is quarantined, so the bank is 638
 * ──────────────────────────────────────────────────────────────────────────── */
patch('meta: question count',
'ACCSAP 12 cardiology board review — 639 questions,',
'ACCSAP 12 cardiology board review — 638 questions,');

/* ────────────────────────────────────────────────────────────────────────────
 * 3. New machinery: review log, ink-host sweeping, stroke simplification
 * ──────────────────────────────────────────────────────────────────────────── */
patch('helpers: review log, host sweep, stroke simplification',
`let storageWarned=false;
function warnStorage(){
  if(storageWarned)return; storageWarned=true;
  toast('Device storage is full or unavailable — use Export to save your annotations.');
}`,
`let storageWarned=false;
function warnStorage(){
  if(storageWarned)return; storageWarned=true;
  toast('Device storage is full or unavailable — use Export to save your annotations.');
}

/* ══════════ review log — append-only history of every answer and rating ══════════
   A scheduler is fitted to review history. FSRS needs, per review: which card,
   what you rated it, how long since you last saw it, and the card's state
   BEFORE it was rescheduled. None of that can be reconstructed afterwards, so
   the log starts now even though nothing reads it yet. */
const LOG_KEY='accsap12.log', LOG_CAP=20000;
let LOG=loadJSON(LOG_KEY,[]);
let logDirty=false, logTimer=null;
function saveLogSoon(){
  logDirty=true;
  if(logTimer)return;
  logTimer=setTimeout(()=>{ logTimer=null; if(!logDirty)return; logDirty=false; saveJSON(LOG_KEY,LOG); },1500);
}
function flushLog(){
  if(logTimer){ clearTimeout(logTimer); logTimer=null; }
  if(logDirty){ logDirty=false; saveJSON(LOG_KEY,LOG); }
}
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden')flushLog(); });
window.addEventListener('pagehide',flushLog);
/* grade is null for an ordinary practice answer, 0-5 for a real self-rating. */
function logReview(q,grade,ok,mode){
  try{
    const c=S.srs[q.id];
    LOG.push({t:Date.now(), q:q.id, ch:q.ch, g:grade, ok:ok?1:0, m:mode,
      ef:c?Math.round(c.ef*100)/100:null, ivl:c?c.ivl:0, reps:c?c.reps:0,
      el:(c&&c.last)?Math.round((Date.now()-Date.parse(c.last+'T00:00:00'))/86400000):null});
    if(LOG.length>LOG_CAP) LOG.splice(0,LOG.length-LOG_CAP);
    saveLogSoon();
  }catch(_){}
}

/* ══════════ ink hosts are released when they leave the document ══════════
   Every render replaces .q-card, so each render used to leak one
   ResizeObserver still watching a node nobody could see. */
const INK_HOSTS=new Set();
function sweepInkHosts(){
  for(const h of INK_HOSTS){
    if(h.isConnected) continue;
    if(h.__ro){ h.__ro.disconnect(); h.__ro=null; }
    if(h.__onResize){ window.removeEventListener('resize',h.__onResize); h.__onResize=null; }
    h.__ink=null; h.__notes=null; h.__redraw=null; h.__fit=null; h.__noteLayer=null;
    INK_HOSTS.delete(h);
  }
}

/* ══════════ strokes are rounded and simplified before they are stored ══════════
   A raw pointer coordinate serialises to ~18 characters; four decimals is
   sub-pixel on any screen this runs on. Ramer-Douglas-Peucker then drops the
   points that sit on a line their neighbours already describe. Together they
   cut stored ink by roughly an order of magnitude. */
function roundPt(p){
  return [Math.round(p[0]*1e4)/1e4, Math.round(p[1]*1e4)/1e4, Math.round(p[2]*100)/100];
}
function rdp(pts,eps){
  if(pts.length<3) return pts;
  const a=pts[0], b=pts[pts.length-1];
  const dx=b[0]-a[0], dy=b[1]-a[1], len=Math.hypot(dx,dy)||1e-9;
  let dmax=0, idx=0;
  for(let i=1;i<pts.length-1;i++){
    const d=Math.abs((pts[i][0]-a[0])*dy-(pts[i][1]-a[1])*dx)/len;
    if(d>dmax){ dmax=d; idx=i; }
  }
  if(dmax<=eps) return [a,b];
  return rdp(pts.slice(0,idx+1),eps).slice(0,-1).concat(rdp(pts.slice(idx),eps));
}
function simplifyStroke(s){
  if(s&&s.p&&s.p.length>2) s.p=rdp(s.p,0.0012);
  return s;
}`);

/* ────────────────────────────────────────────────────────────────────────────
 * 4. Ink: round on capture, simplify on release, register the host
 * ──────────────────────────────────────────────────────────────────────────── */
patch('ink: round captured points',
`  function pos(e){
    const r=cv.getBoundingClientRect();
    return [(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height,
            e.pressure&&e.pressure>0?e.pressure:.5];
  }`,
`  function pos(e){
    const r=cv.getBoundingClientRect();
    return roundPt([(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height,
            e.pressure&&e.pressure>0?e.pressure:.5]);
  }`);

patch('ink: simplify on stroke end',
`  function end(){
    if(cur&&cur.p.length){ strokes().push(cur); saveJSON(INK_KEY,INK); }
    cur=null; redraw(); refreshRail();
  }`,
`  function end(){
    if(cur&&cur.p.length){ strokes().push(simplifyStroke(cur)); saveJSON(INK_KEY,INK); }
    cur=null; redraw(); refreshRail();
  }`);

patch('ink: register host for sweeping',
`  host.__redraw=redraw; host.__fit=fit;
  if(typeof ResizeObserver!=='undefined'){
    host.__ro=new ResizeObserver(fit); host.__ro.observe(host);
  } else {
    window.addEventListener('resize',fit);          // fallback
  }
  fit();`,
`  host.__redraw=redraw; host.__fit=fit;
  INK_HOSTS.add(host);
  if(typeof ResizeObserver!=='undefined'){
    host.__ro=new ResizeObserver(fit); host.__ro.observe(host);
  } else {
    host.__onResize=fit; window.addEventListener('resize',fit);   // fallback
  }
  fit();`);

patch('ink: sweep detached hosts each render',
`function mountInk(){
  const q=currentQ();
  const rail=buildRail();`,
`function mountInk(){
  sweepInkHosts();
  const q=currentQ();
  const rail=buildRail();`);

/* ────────────────────────────────────────────────────────────────────────────
 * 5. Practice is not review
 * ──────────────────────────────────────────────────────────────────────────── */
patch('srs: record last-review date on the card',
`  return {ef,ivl,reps,due:addDays(todayISO(),ivl),lapses};`,
`  return {ef,ivl,reps,due:addDays(todayISO(),ivl),lapses,last:todayISO()};`);

patch('quiz: practice records an attempt, never reschedules',
`  if(S.mode!=='due') S.srs[q.id]=sm2FromCorrect(S.srs[q.id],ok);   // due mode rates after the explanation
  logAnswer(ok);`,
`  /* Practice and review are different signals. A chapter drill records that it
     happened; only the review queue is allowed to move a card's due date.
     Otherwise drilling a chapter silently rewrites the schedule for every card
     it touches, and answering twice in a day compresses its interval. */
  logReview(q,null,ok,S.mode==='due'?'review-answer':'practice');
  if(S.mode!=='due'){
    const pr=S.practice[q.id]||(S.practice[q.id]={n:0,c:0,t:0});
    pr.n++; if(ok)pr.c++; pr.t=Date.now();
  }
  logAnswer(ok);`);

patch('review: log the rating before rescheduling',
`function rateReview(grade){
  const q=S.questions[S.qIdx]; if(!q||!S.answered) return;
  S.srs[q.id]=sm2Update(S.srs[q.id],grade);
  bumpStreak();`,
`function rateReview(grade){
  const q=S.questions[S.qIdx]; if(!q||!S.answered) return;
  logReview(q,grade,grade>=3,'review');
  S.srs[q.id]=sm2Update(S.srs[q.id],grade);
  logRated();
  bumpStreak();`);

/* ────────────────────────────────────────────────────────────────────────────
 * 6. Mastery and "cards started" account for practice too
 * ──────────────────────────────────────────────────────────────────────────── */
patch('stats: mastery counts practice, review dominates',
`function masteryFor(ch){
  const qs=POOL.filter(q=>q.ch===ch);
  if(!qs.length) return 0;
  let score=0;
  for(const q of qs){
    const c=S.srs[q.id];
    if(!c) continue;
    // mastery rises with successful repetitions, capped per card
    score+=Math.min(1,(c.reps||0)/3);
  }
  return score/qs.length;
}`,
`function masteryFor(ch){
  const qs=POOL.filter(q=>q.ch===ch);
  if(!qs.length) return 0;
  let score=0;
  for(const q of qs){
    const c=S.srs[q.id];
    // mastery rises with successful repetitions, capped per card
    if(c){ score+=Math.min(1,(c.reps||0)/3); continue; }
    // a card only ever practised counts, but cannot reach what review reaches
    const p=S.practice[q.id];
    if(p) score+=Math.min(0.45,(p.c||0)*0.22);
  }
  return score/qs.length;
}
/* every card you have met, by either route */
function startedCount(){
  const s=new Set(Object.keys(S.srs));
  for(const k in S.practice) s.add(k);
  return s.size;
}`);

patch('stats: started count includes practice',
`  const seen=Object.keys(S.srs).length;
  const dueN=dueQuestions().length;`,
`  const seen=startedCount();
  const dueN=dueQuestions().length;`);

patch('home: started count includes practice',
`  const dueN=dueQuestions().length, seenN=Object.keys(S.srs).length;`,
`  const dueN=dueQuestions().length, seenN=startedCount();`);

/* ────────────────────────────────────────────────────────────────────────────
 * 7. Persistence: new fields, durable storage, backup nudge
 * ──────────────────────────────────────────────────────────────────────────── */
patch('persist: save practice and backup state',
`  srs:S.srs,reviewStreak:S.reviewStreak,lastReviewDay:S.lastReviewDay,daily:S.daily}));}catch(_){}}`,
`  srs:S.srs,reviewStreak:S.reviewStreak,lastReviewDay:S.lastReviewDay,daily:S.daily,
  practice:S.practice,sinceBackup:S.sinceBackup,lastBackup:S.lastBackup}));}catch(_){}}`);

patch('persist: load practice and backup state',
`  srs:boot.srs||{},reviewStreak:boot.reviewStreak||0,lastReviewDay:boot.lastReviewDay||null,
  daily:boot.daily||{},`,
`  srs:boot.srs||{},reviewStreak:boot.reviewStreak||0,lastReviewDay:boot.lastReviewDay||null,
  daily:boot.daily||{},practice:boot.practice||{},
  sinceBackup:boot.sinceBackup||0,lastBackup:boot.lastBackup||null,`);

patch('persist: count answers since last backup',
`function logAnswer(ok){
  const d=todayISO();
  const day=S.daily[d]||(S.daily[d]={a:0,c:0,r:0});
  day.a++; if(ok) day.c++;
}`,
`function logAnswer(ok){
  const d=todayISO();
  const day=S.daily[d]||(S.daily[d]={a:0,c:0,r:0});
  day.a++; if(ok) day.c++;
  S.sinceBackup=(S.sinceBackup||0)+1;
  if(S.sinceBackup>0 && S.sinceBackup%150===0)
    setTimeout(()=>toast('150 answers since your last backup — Progress → Export everything.'),900);
}
/* iPadOS clears storage for sites it thinks are disposable. Asking to persist
   is the difference between losing a month of review history and not. */
let PERSISTED=null;
function requestPersistence(){
  if(!navigator.storage||!navigator.storage.persist) return;
  navigator.storage.persist().then(granted=>{
    PERSISTED=granted;
    if(S.screen==='stats') render();
  }).catch(()=>{});
}
function storageLine(){
  const p = PERSISTED===null ? 'checking storage'
          : PERSISTED ? 'storage marked persistent'
          : 'storage not persistent — export regularly';
  const b = S.lastBackup
          ? 'last backup '+Math.max(0,Math.round((Date.now()-S.lastBackup)/86400000))+'d ago'
          : 'never backed up';
  return p+' · '+b;
}`);

/* ────────────────────────────────────────────────────────────────────────────
 * 8. Export / import carry the review log
 * ──────────────────────────────────────────────────────────────────────────── */
patch('export: include review log and practice history',
`function exportMarkup(){
  const blob=new Blob([JSON.stringify({v:4,ink:INK,notes:NOTES,
    refs:(typeof REF!=='undefined'?REF:[]),
    chat:loadJSON('accsap12.chat',{}),stats:loadJSON('accsap12.v2',{})},null,0)],
    {type:'application/json'});`,
`function exportMarkup(){
  if(typeof flushLog==='function') flushLog();
  const blob=new Blob([JSON.stringify({v:5,ink:INK,notes:NOTES,
    refs:(typeof REF!=='undefined'?REF:[]),
    log:(typeof LOG!=='undefined'?LOG:[]),
    chat:loadJSON('accsap12.chat',{}),stats:loadJSON('accsap12.v2',{})},null,0)],
    {type:'application/json'});
  try{ S.sinceBackup=0; S.lastBackup=Date.now(); save(); }catch(_){}`);

patch('import: restore review log',
`        if(d.chat) saveJSON('accsap12.chat',d.chat);
        if(d.stats)saveJSON('accsap12.v2',d.stats);`,
`        if(d.log&&Array.isArray(d.log)){ LOG=d.log; saveJSON(LOG_KEY,LOG); }
        if(d.chat) saveJSON('accsap12.chat',d.chat);
        if(d.stats)saveJSON('accsap12.v2',d.stats);`);

patch('stats: surface log size, persistence and backup age',
`      <div class="ref-hint">Progress, ink, notes and review schedule live in this device's local storage.`,
`      <div class="ref-hint">${'${LOG.length}'} reviews logged · ${'${storageLine()}'}<br>
        Progress, ink, notes and review schedule live in this device's local storage.`);

/* ────────────────────────────────────────────────────────────────────────────
 * 9. Boot
 * ──────────────────────────────────────────────────────────────────────────── */
patch('boot: request durable storage',
`(function boot(){
  const sh=document.getElementById('shell');`,
`(function boot(){
  requestPersistence();
  const sh=document.getElementById('shell');`);

/* ──────────────────────────────────────────────────────────────────────────── */
fs.writeFileSync(OUT, html);
const before = fs.statSync(SRC).size, after = fs.statSync(OUT).size;
console.log(`Stage 0 applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`\n${(before / 1048576).toFixed(2)} MB → ${(after / 1048576).toFixed(2)} MB  (fonts embedded: +${((after - before) / 1024).toFixed(0)} KB)`);
console.log(`written: ${OUT}`);
