#!/usr/bin/env node
/*
 * The streaming reply repaints on every network chunk, not every frame.
 *
 *   node scripts/streamthrottle-patch.js <in.html> <out.html>
 *
 * THE DEFECT. oneTurnMistral and oneTurnGemini both do the same thing on
 * every SSE delta that carries text: append it, then immediately
 * `live.innerHTML=md(text)+toolStrip()` — re-parsing and re-serialising the
 * ENTIRE reply so far as Markdown, from scratch, on every chunk. A fast
 * connection can deliver far more chunks per second than the screen can
 * repaint at, so most of that work is thrown away the instant the next
 * chunk arrives and re-renders over it — wasted CPU on exactly the device
 * this app is built for, an iPad, during exactly the moment it is already
 * busy (a live conversation, mid-render).
 *
 * THE FIX IS COALESCING, NOT SKIPPING. Every chunk still updates `text`
 * immediately — nothing about what the reply eventually says changes.
 * Painting is what gets deferred to the next animation frame, and if three
 * chunks land before that frame arrives, they collapse into the one repaint
 * frame already coming rather than three separate synchronous ones.
 *
 * THE GUARANTEE THIS MUST NOT BREAK: the reply on screen when streaming ends
 * must be the LAST thing said, byte for byte — a coalescing throttle that
 * dropped the final chunk because no frame arrived before the stream closed
 * would be worse than no throttle at all. makeStreamPainter().flush() is
 * called once, unconditionally, right after each loop exits: it cancels
 * whatever frame was pending and paints text's CURRENT value synchronously,
 * so the last paint the reader ever sees is never behind the last byte the
 * network ever sent.
 *
 * ONE HELPER, TWO CALL SITES, ON PURPOSE. oneTurnMistral and oneTurnGemini
 * already carried the identical `live.innerHTML=md(text)+toolStrip();
 * apexStick(body);` line, verbatim, in two independently-evolved functions —
 * exactly the shape of duplication this codebase's own heart3d.js comment
 * warns about elsewhere ("duplicating it would mean a future fix landing in
 * one and not the other"). One small factory function, used identically by
 * both, is the same discipline applied here.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/streamthrottle-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

/* ── the shared coalescing painter ── */
patch('streamthrottle: makeStreamPainter, shared by both providers\' streaming loops',
`async function oneTurnMistral(q,wire,extra){`,
`/* Coalesces repeated paints of a streaming reply onto animation frames
   instead of network chunks. schedule() is cheap to call on every delta —
   it only ever queues one frame at a time, no matter how many deltas arrive
   before it fires. flush() is the correctness guarantee: called once after
   the stream ends, it cancels any pending frame and paints text's CURRENT
   value synchronously, so the very last chunk is never left unpainted
   waiting on a frame that may not come before the caller moves on. */
function makeStreamPainter(live,body,getText){
  let raf=0;
  const paint=()=>{ raf=0; if(live){ live.innerHTML=md(getText())+toolStrip(); apexStick(body); } };
  return {
    schedule(){ if(!raf) raf=requestAnimationFrame(paint); },
    flush(){ if(raf){ cancelAnimationFrame(raf); raf=0; } paint(); },
  };
}
async function oneTurnMistral(q,wire,extra){`);

/* ── oneTurnMistral: create the painter, schedule instead of paint, flush before returning ── */
patch('streamthrottle: oneTurnMistral schedules paints instead of forcing one per chunk',
`  let buf='', text='', callMap=new Map();       // index -> {id,name,args}`,
`  let buf='', text='', callMap=new Map();       // index -> {id,name,args}
  const painter=makeStreamPainter(live,body,()=>text);`);

patch('streamthrottle: oneTurnMistral\'s per-chunk paint becomes a scheduled one',
`      if(d.content){
        if(!text) apexSetState('speaking');
        text+=d.content;
        apexPulse();
        if(live){ live.innerHTML=md(text)+toolStrip(); apexStick(body); }
      }`,
`      if(d.content){
        if(!text) apexSetState('speaking');
        text+=d.content;
        apexPulse();
        painter.schedule();
      }`);

patch('streamthrottle: oneTurnMistral flushes the final chunk before returning',
`  const calls=[...callMap.values()].filter(c=>c.name).map(c=>{
    let input={}; try{ input=c.args?JSON.parse(c.args):{}; }catch(_){ input={}; }
    return {id:c.id||('call_'+Math.random().toString(36).slice(2)), name:c.name, input};
  });
  return {text, calls, raw:null};`,
`  painter.flush();
  const calls=[...callMap.values()].filter(c=>c.name).map(c=>{
    let input={}; try{ input=c.args?JSON.parse(c.args):{}; }catch(_){ input={}; }
    return {id:c.id||('call_'+Math.random().toString(36).slice(2)), name:c.name, input};
  });
  return {text, calls, raw:null};`);

/* ── oneTurnGemini: the same shape ── */
patch('streamthrottle: oneTurnGemini schedules paints instead of forcing one per chunk',
`  let buf='', text='', raw=[];`,
`  let buf='', text='', raw=[];
  const painter=makeStreamPainter(live,body,()=>text);`);

patch('streamthrottle: oneTurnGemini\'s per-chunk paint becomes a scheduled one',
`          apexPulse();
          if(live){ live.innerHTML=md(text)+toolStrip(); apexStick(body); }
        } else if(part.functionCall){`,
`          apexPulse();
          painter.schedule();
        } else if(part.functionCall){`);

patch('streamthrottle: oneTurnGemini flushes the final chunk before returning',
`  const calls=raw.filter(p=>p.functionCall).map(p=>({
    id:'call_'+Math.random().toString(36).slice(2),
    name:p.functionCall.name, input:p.functionCall.args||{}}));
  return {text, raw, calls};`,
`  painter.flush();
  const calls=raw.filter(p=>p.functionCall).map(p=>({
    id:'call_'+Math.random().toString(36).slice(2),
    name:p.functionCall.name, input:p.functionCall.args||{}}));
  return {text, raw, calls};`);

fs.writeFileSync(OUT, html);
console.log(`Stream throttle — ${edits.length} edit(s)`);
edits.forEach(e => console.log('  ✓ ' + e));
console.log(`written: ${OUT}`);
