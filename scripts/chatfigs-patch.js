#!/usr/bin/env node
/*
 * The figures Apex is reasoning from appear in the answer.
 *
 *   node scripts/chatfigs-patch.js <input.html> <output.html>
 *
 * Notes cite figures, the Notes panel renders them, and a cited note's figure
 * is attached to the request so a vision model can read it. What none of that
 * did was put the figure in front of the fellow while Apex explains it. Apex
 * would write "the wavefront advances from subendocardium outward, as the
 * figure shows" against a wall of text, and the figure — sitting in the very
 * note being quoted, already decoded, already on the device — stayed in the
 * library.
 *
 * TWO WAYS IN, AND THE UI OWNS THE RELIABLE ONE.
 *
 * A model cannot be trusted to emit the citation itself: it would have to
 * reproduce refimg://hf/033_FIG.55.8_p037.jpg exactly, and a near miss renders
 * as nothing at all. So the strip below the reply is built by the app from
 * lastHits — the same notes the "drawing on" pills already name — and appears
 * whether or not the model cooperates.
 *
 * The model may still place one inline, and that is worth having: a figure in
 * the middle of the paragraph that explains it beats a figure in a strip
 * underneath. In grounded mode the note body reaches the model with its
 * citation markup intact, so it can copy one verbatim, and md() already
 * renders refimg:// in an assistant turn. The system prompt now says so — and
 * says to copy it exactly rather than invent one, because an invented key is
 * the one failure mode that produces silence rather than a wrong picture.
 *
 * WHY THE STRIP IS NOT GATED ON GROUNDED MODE, WHEN THE VISION ATTACHMENT IS.
 * Sending an image costs tokens on every turn, and this app is aimed at free
 * tiers that are counted in tokens per minute — that restraint stands.
 * Rendering one costs nothing: the bytes are already in memory. So the figure
 * is shown whenever a note carrying one was used, and is still only *sent* to
 * the model in grounded mode, where the fellow has said those notes are the
 * material. Showing it also makes the provenance honest: it is captioned as
 * coming from the note, not presented as something Apex drew.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/chatfigs-patch.js <input.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. one place that knows which figures this turn is standing on ──────── */
patch('figures: split "which figures" from "should they be sent"',
`function refImagesForHits(hits){
  if(!AI_GROUNDED) return [];
  const out=[];
  for(const h of (hits||[])){
    if(!h||h.kind!=='r') continue;
    const r=REF.find(x=>x.id===h.id); if(!r) continue;
    for(const img of extractRefImages(r.body)){
      const dataUrl=refImgSrc(img.key);
      if(!dataUrl) continue;
      out.push({caption:img.caption, dataUrl, noteTitle:r.title});
      if(out.length>=4) return out;
    }
  }
  return out;
}`,
`/* Every figure carried by the notes this turn drew on. No mode gate: what is
   worth showing and what is worth paying to send are different questions, and
   conflating them is why the figures were invisible. */
function refFiguresForHits(hits,cap){
  const out=[]; const seen=Object.create(null);
  for(const h of (hits||[])){
    if(!h||h.kind!=='r') continue;
    const r=REF.find(x=>x.id===h.id); if(!r) continue;
    for(const img of extractRefImages(r.body)){
      if(seen[img.key]) continue;               // two notes may cite one figure
      const dataUrl=refImgSrc(img.key);
      if(!dataUrl) continue;
      seen[img.key]=1;
      out.push({key:img.key, caption:img.caption, dataUrl, noteTitle:r.title});
      if(out.length>=(cap||4)) return out;
    }
  }
  return out;
}
/* What actually rides on the request. Still grounded-mode only: an image costs
   tokens on every turn, and the free tiers this app is aimed at are metered in
   tokens per minute. Rendering the same figure costs nothing, so the panel
   shows it either way — see the strip in buildAI. */
function refImagesForHits(hits){
  return AI_GROUNDED ? refFiguresForHits(hits,4) : [];
}`);

/* ── 2. the sources belong to one conversation ───────────────────────────────
   lastHits is a single global, written by fire() and never associated with the
   thread it was retrieved for. Ask about one question, move to another that
   already has a conversation, and its "drawing on" pills name the notes from
   the question you left. That was mild while it was a row of small pills; it
   is not mild now that the same list decides which diagram is printed under
   the answer, captioned as the evidence for it.

   Tagging the hits with their thread is enough — the strips simply do not draw
   for a thread the hits did not come from. */
patch('sources: remember which conversation the retrieved notes belong to',
`let lastHits=[];`,
`let lastHits=[], lastHitsKey=null;`);

patch('sources: tag them as they are retrieved',
`  lastHits=extra.hits;
  aiBusy=true; buildAI();`,
`  lastHits=extra.hits; lastHitsKey=q?q.id:'_general';
  aiBusy=true; buildAI();`);

/* ── 3. the strip under the reply ────────────────────────────────────────── */
patch('figures: show them under the answer, captioned to their note',
`  const srcStrip=lastHits.length?\`<div class="src-strip"><span class="src-lbl">drawing on</span>\${
    lastHits.map(h=>h.kind==='r'
      ? \`<span class="src-pill ref">\${icon('folder','icon-sm')} \${e(clip(h.title,26))}</span>\`
      : \`<button class="src-pill" data-jump="\${h.id}">\${e(h.ch.split(' ')[0])} · \${h.n}</button>\`).join('')}</div>\`:'';`,
`  /* Only the notes retrieved for THIS conversation — see lastHitsKey. */
  const hits=(lastHitsKey===(q?q.id:'_general'))?lastHits:[];
  const srcStrip=hits.length?\`<div class="src-strip"><span class="src-lbl">drawing on</span>\${
    hits.map(h=>h.kind==='r'
      ? \`<span class="src-pill ref">\${icon('folder','icon-sm')} \${e(clip(h.title,26))}</span>\`
      : \`<button class="src-pill" data-jump="\${h.id}">\${e(h.ch.split(' ')[0])} · \${h.n}</button>\`).join('')}</div>\`:'';
  /* Only while a reply is on screen: a figure hanging under an empty thread,
     or under the setup screen, is furniture rather than evidence. Suppressed
     when the model already placed the same figure inline, so it is never shown
     twice in one answer. */
  const lastBot=hist.length&&hist[hist.length-1].role!=='user'?String(hist[hist.length-1].content||''):'';
  const figs=(hist.length&&!aiBusy)
    ? refFiguresForHits(hits,3).filter(f=>lastBot.indexOf('refimg://'+f.key)<0)
    : [];
  const figStrip=figs.length?\`<div class="fig-strip"><span class="src-lbl">figure\${figs.length===1?'':'s'} from those notes</span>
    \${figs.map(f=>\`<figure class="ai-fig"><img src="\${f.dataUrl}" alt="\${e(f.caption)}" loading="lazy">
      <figcaption>\${e(clip(f.caption,150))}<span class="ai-fig-src">\${e(clip(f.noteTitle,44))}</span></figcaption></figure>\`).join('')}</div>\`:'';`);

patch('figures: the strip goes between the sources and the chips',
`     \${srcStrip}
     <div class="chips">`,
`     \${srcStrip}
     \${figStrip}
     <div class="chips">`);

/* ── 3. how it looks ─────────────────────────────────────────────────────── */
patch('figures: styles, following the note figure rather than inventing a look',
`.src-strip{display:flex;flex-wrap:wrap;gap:5px;align-items:center;padding:0 14px 8px}`,
`.src-strip{display:flex;flex-wrap:wrap;gap:5px;align-items:center;padding:0 14px 8px}
.fig-strip{display:flex;flex-direction:column;gap:8px;padding:0 14px 10px}
.ai-fig{margin:0;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--white)}
.ai-fig img{display:block;width:100%;height:auto;max-height:320px;object-fit:contain;background:#fff}
/* 13px, not 12: the type suite holds every fixed size to the 9/11/13/16 ladder,
   and "just a bit smaller than 13" is exactly the twenty-ninth size it exists
   to refuse. Matches the note figure's own caption, which is the same thing in
   a different panel. */
.ai-fig figcaption{padding:7px 11px;font-size:13px;line-height:1.45;color:var(--muted);
  border-top:1px solid var(--border)}
.ai-fig-src{display:block;margin-top:3px;font-size:11px;color:var(--dim)}`);

/* ── 4. let the model place one where it belongs ─────────────────────────── */
patch('figures: the model may place one inline, by copying a citation exactly',
`- When a figure is attached, start by saying what you actually see in it`,
`- A reference note may carry a figure, written in it as ![caption](refimg://KEY). When one of them is what you are explaining, you may place it in your reply by copying that whole citation across EXACTLY as it appears in the note — same key, character for character — at the point in your explanation where the fellow should look at it. Never invent, guess or abbreviate a key: a wrong one renders as nothing at all, and a figure the fellow cannot see is worse than one you only described. If you are not copying a citation verbatim from a note in front of you, do not write one, and simply describe the figure instead.
- When a figure is attached, start by saying what you actually see in it`);

fs.writeFileSync(OUT, html);
console.log(`Figures in the answer — ${applied.length} edits applied`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
