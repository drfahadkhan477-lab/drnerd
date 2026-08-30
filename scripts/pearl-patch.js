#!/usr/bin/env node
/*
 * A pearl from your own notes, under the hero.
 *
 *   node scripts/pearl-patch.js <input.html> <output.html>
 *
 * The home screen opened with a question count, a percentage and a rhythm
 * label. Handsome, and it taught nothing. The first thing a board candidate
 * reads each morning should be a fact.
 *
 * Its own card, directly under the hero's ECG. Everything else on that screen
 * is a control — a chapter to open, a quiz to start — so this one is styled
 * against them rather than with them: the serif the wordmark uses, a teal rule
 * down its edge instead of the uniform border the action cards share, and no
 * affordance suggesting the card itself is pressable. It is the one thing on
 * the screen to read rather than to press, and it should look like it.
 *
 * When the note behind the pearl carries a figure, the figure comes with it,
 * beside the sentence rather than beneath — a pearl about the wavefront of
 * necrosis and the diagram of that wavefront are one thought, and stacking
 * them reads as two.
 *
 * The sentence comes from src/core/pearl.js, which mines the notes already on
 * the shelf; nothing is invented and no second corpus is kept.
 *
 * STABLE WITHIN A SESSION, not per render. render() runs on every answer,
 * every layout switch and every panel toggle, and a hero whose text changed
 * each time would be unreadable. So the choice is made once, and moves only
 * when the fellow asks — or on the next load.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/pearl-patch.js <input.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const pearl = fs.readFileSync(path.join(ROOT, 'src', 'core', 'pearl.js'), 'utf8');

const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. the module ───────────────────────────────────────────────────────── */
patch('embed: pearl.js',
`/* ═════════ Imported figures — see src/core/{refassets,zipread}.js ═════════ */`,
`/* ══════════════ The daily pearl — see src/core/pearl.js ══════════════ */
${pearl}

/* ═════════ Imported figures — see src/core/{refassets,zipread}.js ═════════ */`);

/* ── 2. choosing one, and holding it still ───────────────────────────────── */
patch('pearl: chosen once, moved only on request',
`function buildHome(){`,
`/* Harvested once — 146 notes is a few milliseconds of regex, but render() is
   called on every answer, and paying it there would be careless. Rebuilt when
   the library changes, which is what invalidateIndex already signals. */
let pearlCache=null, pearlCurrent=null;
function pearlAll(){
  if(pearlCache) return pearlCache;
  try{ pearlCache=(typeof Pearl!=='undefined'&&typeof REF!=='undefined')?Pearl.harvest(REF):[]; }
  catch(_){ pearlCache=[]; }
  return pearlCache;
}
function pearlNow(){
  if(pearlCurrent) return pearlCurrent;
  const all=pearlAll();
  if(!all.length) return null;
  try{ pearlCurrent=Pearl.pick(all, null); }catch(_){ pearlCurrent=all[0]; }
  return pearlCurrent;
}
/* The note's figure, when it has one. Shown beside the sentence rather than
   under it: a pearl about the wavefront of necrosis and the diagram of the
   wavefront belong on one line, and a diagram stacked underneath reads as a
   second, unrelated thing. */
function pearlFigure(p){
  if(!p||!p.figKey) return '';
  const src=(typeof refImgSrc==='function')?refImgSrc(p.figKey):'';
  if(!src) return '';
  return \`<figure class="pearl-fig" id="pearlFig" onclick="goRefs()" role="button" tabindex="0"
    title="\${e(p.figCap||'')}"><img src="\${src}" alt="\${e(p.figCap||'Figure from this note')}" loading="lazy"></figure>\`;
}
function pearlNext(){
  const all=pearlAll();
  if(all.length<2) return;
  try{ pearlCurrent=Pearl.pick(all, pearlCurrent&&pearlCurrent.id); }catch(_){}
  const el=document.getElementById('pearlBody');
  if(!el||!pearlCurrent) return;
  /* Repaint in place: re-rendering the whole home screen to change one
     sentence would restart the ECG canvas and the heart behind it. */
  el.classList.remove('pearl-in'); void el.offsetWidth; el.classList.add('pearl-in');
  el.innerHTML=e(pearlCurrent.text);
  const cap=document.getElementById('pearlCap');
  if(cap) cap.textContent=pearlCurrent.chapter||'From your notes';
  /* The figure belongs to the note, so it has to move with the sentence —
     including disappearing when the next note has none. */
  const card=document.getElementById('pearlCard'), old=document.getElementById('pearlFig');
  if(old) old.remove();
  const html=pearlFigure(pearlCurrent);
  if(card&&html) card.insertAdjacentHTML('beforeend',html);
  if(card) card.classList.toggle('has-fig',!!html);
}
function buildHome(){`);

/* ── 3. its own card, below the hero ─────────────────────────────────────── */
patch('pearl: a card of its own, under the ECG',
`      \${heartSVG('heroHeart')}
      <canvas id="heroHeart3d" class="heart-3d-mini" aria-hidden="true"></canvas>
    </div>`,
`      \${heartSVG('heroHeart')}
      <canvas id="heroHeart3d" class="heart-3d-mini" aria-hidden="true"></canvas>
    </div>

    \${(()=>{ const p=pearlNow(); if(!p) return '';
      return \`<div class="pearl-card" id="pearlCard">
        <div class="pearl-rule"></div>
        <div class="pearl-main">
          <div class="pearl-head">
            <span class="pearl-tag">\${icon('zap','icon-sm')} Pearl</span>
            <span class="pearl-cap" id="pearlCap">\${e(p.chapter||'From your notes')}</span>
            <button class="pearl-next" onclick="pearlNext()"
              title="Another pearl" aria-label="Another pearl">\${icon('rotate-ccw','icon-sm')}</button>
          </div>
          <p class="pearl-body pearl-in" id="pearlBody">\${e(p.text)}</p>
          <button class="pearl-open" onclick="goRefs()">Open the note \${icon('arrow-right','icon-sm')}</button>
        </div>
        \${pearlFigure(p)}
      </div>\`; })()}`);

/* ── 4. how it looks ─────────────────────────────────────────────────────── */
patch('pearl: an editorial card, set apart from the cards that are controls',
`.hero-rhythm-label{margin-top:12px;font-family:var(--font-mono);font-size:11px;`,
`/* Everything else on this screen is a control — something to press. This is
   the one thing to READ, so it is set in the serif the wordmark uses and given
   a teal rule down its edge instead of the uniform border the action cards
   share. The distinction is the point: it should not look pressable. */
.pearl-card{display:flex;gap:0;align-items:stretch;background:var(--white);
  border:1.5px solid var(--border2);border-radius:16px;overflow:hidden;
  margin:var(--s4,16px) 0 var(--s5,20px);animation:riseIn .6s var(--glide) .06s both}
.pearl-rule{flex:0 0 3px;background:linear-gradient(180deg,var(--teal) 0%,var(--teal) 55%,rgba(94,234,212,.15) 100%)}
.pearl-main{flex:1;min-width:0;padding:16px 18px}
.pearl-head{display:flex;align-items:center;gap:9px;margin-bottom:9px}
.pearl-tag{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;
  letter-spacing:.09em;text-transform:uppercase;color:var(--teal)}
.pearl-cap{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pearl-next{margin-left:auto;flex:0 0 auto;background:transparent;border:0;padding:4px;
  cursor:pointer;color:var(--dim);display:flex;border-radius:8px;
  transition:color .18s var(--ease),background .18s var(--ease),transform .3s var(--spring)}
.pearl-next:hover{color:var(--teal);background:var(--card)}
.pearl-next:active{transform:rotate(-90deg)}
.pearl-body{margin:0;font-family:var(--font-display);font-size:19px;line-height:1.5;
  color:var(--text);text-wrap:pretty}
.pearl-open{margin-top:11px;background:transparent;border:0;padding:0;cursor:pointer;
  display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:600;
  color:var(--teal);font-family:inherit}
.pearl-open .icon{transition:transform .22s var(--spring)}
.pearl-open:hover .icon{transform:translateX(3px)}
/* Beside the sentence, not under it: a pearl and the diagram that explains it
   are one thought, and stacking them reads as two. */
.pearl-fig{flex:0 0 34%;max-width:260px;margin:0;border-left:1px solid var(--border2);
  background:var(--white);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:10px}
.pearl-fig img{display:block;max-width:100%;max-height:190px;object-fit:contain}
.pearl-in{animation:pearlIn .5s var(--glide) both}
@keyframes pearlIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media(max-width:700px){
  .pearl-card{flex-wrap:wrap}
  .pearl-body{font-size:16px}
  .pearl-fig{flex:1 1 100%;max-width:none;border-left:0;border-top:1px solid var(--border2)}
  .pearl-fig img{max-height:220px}
}
.hero-rhythm-label{margin-top:12px;font-family:var(--font-mono);font-size:11px;`);

/* ── 5. the library changing means the pearls change ─────────────────────── */
patch('pearl: a new note can be quoted without a reload',
`function invalidateIndex(){`,
`function invalidateIndex(){
  pearlCache=null;`);

fs.writeFileSync(OUT, html);
console.log(`The daily pearl — ${applied.length} edits applied`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
