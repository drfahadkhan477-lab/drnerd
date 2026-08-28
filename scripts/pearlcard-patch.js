#!/usr/bin/env node
/*
 * The pearl, as something to memorise rather than something to read.
 *
 *   node scripts/pearlcard-patch.js <input.html> <output.html>
 *
 * A board pearl is one sentence, and one sentence is a wall. "Clinical
 * restenosis is a different process: intimal hyperplasia, generally developing
 * within the first 6–9 months, presenting as recurrent angina rather than an
 * acute event" is four facts wearing the costume of one. You can read it. You
 * cannot hold it.
 *
 * Pearl.steps() breaks it at its own joints — the colon, the semicolon, the
 * connective that introduces a consequence — and this patch renders the result
 * as a numbered ladder. Nothing is invented, nothing is reordered, and the
 * connective that opens a step is lifted into a small label beside it, because
 * printing "so" in both the tag and the prose reads as a stutter.
 *
 * THE NUMBERS ARE THE THING BEING EXAMINED. 180 days, 42% versus 31%, 2.5
 * times the oral dose: these are what a question turns on, and they were set
 * in the same weight as the words around them. They are marked now — a tint
 * behind the figure, in the palette's own accent, so it survives a change of
 * theme.
 *
 * THE BACKGROUND IS ECG PAPER. Not a decorative gradient: the 1mm/5mm grid
 * that every trace in this app is drawn against, at an opacity where it reads
 * as texture rather than as a chart. It drifts, slowly, and a soft wash of the
 * accent moves across it out of phase — so the card is alive without anything
 * on it moving fast enough to compete with the sentence. Both are painted from
 * palette variables, so the eight themes carry them without a second rule.
 *
 * THE FIGURE IS EVIDENCE, SO IT IS CAPTIONED. It was a silent thumbnail; a
 * diagram with no legend is decoration. It now carries the caption its note
 * gave it and says where it came from.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/pearlcard-patch.js <input.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. the ladder, and the figures inside it ────────────────────────────── */
patch('pearl: render the sentence as a ladder',
`function pearlNext(){`,
`/* The measurements are what the question turns on, so they are marked. Applied
   AFTER escaping, and matching only digits and a unit word, so it can never
   reach into an entity the escaper produced — &amp; has no digit in it. */
const PEARL_NUM=/(\\d[\\d.,:]*(?:\\s?[–—-]\\s?\\d[\\d.,]*)?\\s?(?:%|mg|mcg|kg|g\\b|mmHg|mL|mm|cm|hours?|hrs?|days?|weeks?|months?|years?|minutes?|mins?|beats|bpm|mmol|mEq|msec|ms|mo)?)/g;
function pearlMark(escaped){
  return escaped.replace(PEARL_NUM,(m)=>/\\d/.test(m)?\`<b class="pearl-num">\${m}</b>\`:m);
}
/* One sentence, broken where it already bends. A single step means the
   sentence had no joint worth cutting — it is then set as prose rather than as
   a ladder of one, which would be a numbered list with nothing to order. */
function pearlLadder(p){
  let steps=[];
  try{ steps=(typeof Pearl!=='undefined')?Pearl.steps(p.text):[]; }catch(_){ steps=[]; }
  if(steps.length<2) return \`<p class="pearl-body pearl-in">\${pearlMark(e(p.text))}</p>\`;
  return \`<ol class="pearl-steps pearl-in">\${steps.map((s,i)=>
    \`<li class="pearl-step" style="--i:\${i}"><span class="pearl-n">\${i+1}</span>
      <span class="pearl-txt">\${s.lead?\`<em class="pearl-lead">\${e(s.lead)}</em>\`:''}\${pearlMark(e(s.text))}</span></li>\`).join('')}</ol>\`;
}
function pearlNext(){`);

patch('pearl: the card opens with the ladder',
`          <p class="pearl-body pearl-in" id="pearlBody">\${e(p.text)}</p>`,
`          <div class="pearl-bodywrap" id="pearlBody">\${pearlLadder(p)}</div>`);

patch('pearl: rolling to the next one rebuilds the ladder',
`  const el=document.getElementById('pearlBody');
  if(!el||!pearlCurrent) return;
  /* Repaint in place: re-rendering the whole home screen to change one
     sentence would restart the ECG canvas and the heart behind it. */
  el.classList.remove('pearl-in'); void el.offsetWidth; el.classList.add('pearl-in');
  el.innerHTML=e(pearlCurrent.text);`,
`  const el=document.getElementById('pearlBody');
  if(!el||!pearlCurrent) return;
  /* Repaint in place: re-rendering the whole home screen to change one
     sentence would restart the ECG canvas and the heart behind it. Rebuilding
     the ladder from scratch also restarts its own stagger, which is the point
     — the steps should arrive one at a time on every pearl, not just the first. */
  el.innerHTML=pearlLadder(pearlCurrent);`);

/* ── 2. the figure says what it is ───────────────────────────────────────── */
patch('pearl: a figure with no legend is decoration',
`  return \`<figure class="pearl-fig" id="pearlFig" onclick="goRefs()" role="button" tabindex="0"
    title="\${e(p.figCap||'')}"><img src="\${src}" alt="\${e(p.figCap||'Figure from this note')}" loading="lazy"></figure>\`;`,
`  const cap=(p.figCap||'').trim();
  return \`<figure class="pearl-fig" id="pearlFig" onclick="goRefs()" role="button" tabindex="0"
    title="\${e(cap)}"><img src="\${src}" alt="\${e(cap||'Figure from this note')}" loading="lazy">
    \${cap?\`<figcaption>\${e(cap.length>150?cap.slice(0,149)+'…':cap)}</figcaption>\`:''}</figure>\`;`);

/* ── 3. how it looks, and how it moves ───────────────────────────────────── */
patch('pearl: ECG paper, a drifting wash, and a ladder that arrives a rung at a time',
`.pearl-in{animation:pearlIn .5s var(--glide) both}
@keyframes pearlIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}`,
`/* ── the background ──────────────────────────────────────────────────────
   ECG paper, not an abstract gradient: the 1mm/5mm grid every trace in this
   app is drawn against, at an opacity where it reads as texture. Both layers
   are painted from palette variables, so all eight themes carry them without
   a rule of their own, and both are behind the content with pointer-events
   off — a decorative layer must never eat a tap meant for the card. */
.pearl-card::before,.pearl-card::after{content:'';position:absolute;inset:0;
  pointer-events:none;z-index:0}
.pearl-card::before{
  background-image:
    repeating-linear-gradient(0deg,  color-mix(in srgb, var(--teal) 22%, transparent) 0 1px, transparent 1px 5px),
    repeating-linear-gradient(90deg, color-mix(in srgb, var(--teal) 22%, transparent) 0 1px, transparent 1px 5px),
    repeating-linear-gradient(0deg,  color-mix(in srgb, var(--teal) 42%, transparent) 0 1px, transparent 1px 25px),
    repeating-linear-gradient(90deg, color-mix(in srgb, var(--teal) 42%, transparent) 0 1px, transparent 1px 25px);
  opacity:.16;
  -webkit-mask-image:radial-gradient(120% 90% at 12% 0%, #000 0%, transparent 72%);
  mask-image:radial-gradient(120% 90% at 12% 0%, #000 0%, transparent 72%);
  animation:pearlPaper 28s linear infinite}
/* A wash of the accent moving out of phase with the paper, so the card is
   never quite still and never fast enough to pull the eye off the sentence. */
.pearl-card::after{
  background:
    radial-gradient(52% 62% at 8% 0%,   color-mix(in srgb, var(--teal) 30%, transparent), transparent 70%),
    radial-gradient(46% 58% at 96% 100%,color-mix(in srgb, var(--navy3) 26%, transparent), transparent 68%);
  opacity:.5;animation:pearlWash 22s var(--ease,ease-in-out) infinite alternate}
@keyframes pearlPaper{from{background-position:0 0,0 0,0 0,0 0}
                      to{background-position:0 25px,25px 0,0 25px,25px 0}}
@keyframes pearlWash{from{transform:translate3d(0,0,0) scale(1)}
                     to{transform:translate3d(-4%,3%,0) scale(1.12)}}
/* Everything the fellow actually reads sits above both layers. The trace is
   raised WITHOUT being given a position: it is absolutely positioned along the
   card's foot, and .pearl-card is a flex row, so relative would put it back in
   the flow as a full-width flex item and crush the prose into a column one
   word wide. Only the z-index is wanted here. */
.pearl-rule,.pearl-main,.pearl-fig{position:relative;z-index:1}
.pearl-ecg{z-index:1}

/* ── the ladder ──────────────────────────────────────────────────────────
   Numbered, because the order is the argument: the fact, then what follows
   from it, then the caveat. The rungs arrive one at a time — 70ms apart, which
   is enough to read as a sequence and not enough to be a wait. */
.pearl-steps{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:11px}
.pearl-step{display:flex;gap:11px;align-items:flex-start;
  animation:pearlRung .5s var(--glide) both;animation-delay:calc(var(--i) * .07s + .06s)}
.pearl-n{flex:0 0 auto;width:22px;height:22px;margin-top:3px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  font-family:var(--font-mono);font-size:11px;font-weight:700;
  color:var(--teal);background:color-mix(in srgb, var(--teal) 12%, transparent);
  border:1px solid color-mix(in srgb, var(--teal) 30%, transparent)}
.pearl-txt{flex:1;min-width:0;font-family:var(--font-display);font-size:16px;
  line-height:1.5;color:var(--text);text-wrap:pretty}
/* The connective the step was cut at, lifted out of the prose so it labels the
   move rather than repeating inside it. */
.pearl-lead{display:inline-block;margin-right:7px;font-style:normal;
  font-family:var(--font-mono);font-size:9px;font-weight:700;letter-spacing:.11em;
  text-transform:uppercase;color:var(--teal);vertical-align:1px}
/* A threshold, a dose, a difference between two arms: what the question turns
   on, marked so it survives a glance. */
.pearl-num{font-weight:650;color:var(--text);
  background:color-mix(in srgb, var(--teal) 15%, transparent);
  border-radius:5px;padding:0 4px;box-decoration-break:clone;
  -webkit-box-decoration-break:clone}
@keyframes pearlRung{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:none}}
.pearl-in{animation:pearlIn .5s var(--glide) both}
@keyframes pearlIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
/* A card that breathes is pleasant; a card that breathes when the fellow has
   asked the system to stop moving is a headache. */
@media(prefers-reduced-motion:reduce){
  .pearl-card::before,.pearl-card::after{animation:none}
  .pearl-step{animation:none}
}
.pearl-fig figcaption{padding:8px 10px 2px;font-size:11px;line-height:1.45;
  color:var(--dim);text-align:left}`);

patch('pearl: the figure earns more of the card now that it is captioned',
`.pearl-fig{flex:0 0 34%;max-width:260px;margin:0;border-left:1px solid var(--border2);
  background:var(--white);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:10px}
.pearl-fig img{display:block;max-width:100%;max-height:190px;object-fit:contain}`,
`.pearl-fig{flex:0 0 38%;max-width:300px;margin:0;
  border-left:1px solid color-mix(in srgb, var(--border2) 70%, transparent);
  background:color-mix(in srgb, var(--white) 55%, transparent);
  cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:12px;transition:background .3s var(--glide)}
.pearl-fig:hover{background:color-mix(in srgb, var(--white) 80%, transparent)}
.pearl-fig img{display:block;max-width:100%;max-height:230px;object-fit:contain;
  border-radius:8px}`);

/* ── 4. Safari, which is the point of the exercise ────────────────────────
   iPadOS Safari shipped `backdrop-filter` behind `-webkit-` and only dropped
   the prefix in Safari 18. Six of the nine glass surfaces in this app carry
   both spellings; three were written with the unprefixed property alone and
   simply do not blur on an iPad — the navigation bar, the figure lightbox and
   the Rhythm Lab readout. Since the whole reason for the split build is to be
   opened in that browser, they are given the prefix here rather than left as
   three surfaces that quietly look wrong on the one device this is for. */
patch('safari: the navigation bar blurs on an iPad too',
`  box-shadow:0 2px 16px rgba(0,0,0,.25);backdrop-filter:blur(8px);`,
`  box-shadow:0 2px 16px rgba(0,0,0,.25);
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);`);

patch('safari: and the figure lightbox behind it',
`  align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(3px)}`,
`  align-items:center;justify-content:center;padding:18px;
  backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}`);

patch('safari: and the Rhythm Lab readout',
`  border:1px solid rgba(94,234,212,.22);backdrop-filter:blur(6px)}`,
`  border:1px solid rgba(94,234,212,.22);
  backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}`);

fs.writeFileSync(OUT, html);
console.log(`The pearl, as a ladder — ${applied.length} edits applied`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
