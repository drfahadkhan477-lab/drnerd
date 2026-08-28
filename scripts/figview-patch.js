#!/usr/bin/env node
/*
 * A figure you can actually read, and a way back out of it.
 *
 *   node scripts/figview-patch.js <input.html> <output.html>
 *
 * A Braunwald figure is a 982-pixel diagram whose legend is set in six-point
 * type. Shown inside the Apex panel it is scaled to about 340 pixels tall,
 * which is enough to see that there IS an algorithm and not nearly enough to
 * read one — and the legend, which names every abbreviation in the diagram and
 * cites the trial it came from, is illegible at any panel width.
 *
 * So a figure opens. Tap it anywhere it appears — in a reply, under a reply,
 * in the pearl, in a note — and it fills the screen at its natural size with
 * its caption underneath.
 *
 * AND IT CLOSES, WHICH IS THE PART THAT MATTERS. The complaint that started
 * this was an image that could not be got out of. So: a close button that is
 * always in the same corner, a tap anywhere outside the picture, the Escape
 * key, and the back gesture — four ways out, none of which depends on
 * scrolling to find a control. The overlay also takes the scroll away from the
 * page beneath it, so a drag on the picture cannot leave the page underneath
 * moving while the picture stays put, which is what "stuck" feels like.
 *
 * It reuses #peek — the overlay the related-question preview already uses —
 * rather than inventing a second modal with a second set of close semantics.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/figview-patch.js <input.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. opening one ──────────────────────────────────────────────────────── */
patch('figures: open one full size, and make sure it closes',
`function closePeek(){ const p=document.getElementById('peek'); if(p){p.className='';p.innerHTML='';} }`,
`function closePeek(){
  const p=document.getElementById('peek');
  if(p){p.className='';p.innerHTML='';}
  document.body.classList.remove('peek-locked');
  if(peekKeyHandler){ document.removeEventListener('keydown',peekKeyHandler); peekKeyHandler=null; }
}
/* ═══════ a figure, full size ═══════
   Six-point legend type inside a 340px panel is not a figure, it is a
   thumbnail of one. This opens the same image at its natural size with the
   caption under it, and closes four ways — the button, the backdrop, Escape,
   and the browser's own back gesture — because the bug that prompted it was an
   image with no way out. */
let peekKeyHandler=null;
function openFigure(src,caption,source){
  if(!src) return;
  const wrap=document.getElementById('peek')||(()=>{
    const d=document.createElement('div'); d.id='peek'; document.body.appendChild(d); return d;})();
  wrap.className='peek-open fig-open';
  wrap.innerHTML=\`<div class="figv" role="dialog" aria-modal="true" aria-label="\${e(caption||'Figure')}">
      <button class="figv-x" onclick="closePeek()" aria-label="Close figure">\${icon('x')}</button>
      <div class="figv-scroll"><img src="\${src}" alt="\${e(caption||'Figure')}"></div>
      <div class="figv-hint">tap the figure to magnify · tap outside to close</div>
      \${caption?\`<figcaption class="figv-cap">\${e(caption)}\${source?\`<span>\${e(source)}</span>\`:''}</figcaption>\`:''}
    </div>\`;
  /* Everything except the picture, its caption and the button dismisses.
     Checking ev.target===wrap is the obvious way and it is wrong here: .figv
     is stretched over the whole overlay, so the backdrop is never the target
     and the tap-outside gesture silently does nothing — which is the same
     "there is no way out of this image" bug in a new place. */
  wrap.onclick=ev=>{
    const t=ev.target;
    /* The picture itself toggles magnification rather than dismissing. Fitted
       to the width it is already about 1:1 in device pixels on a retina
       screen, which is sharp — but a Braunwald legend is six-point type, and
       sharp is not the same as legible. Tapping goes to natural size and lets
       the container scroll, which is the only way to actually read one. */
    if(t.tagName==='IMG'&&t.closest('.figv-scroll')){
      t.closest('.figv-scroll').classList.toggle('zoomed');
      return;
    }
    if(t.closest&&t.closest('.figv-cap,.figv-x')) return;
    closePeek();
  };
  peekKeyHandler=ev=>{ if(ev.key==='Escape') closePeek(); };
  document.addEventListener('keydown',peekKeyHandler);
  /* The page beneath must not scroll under the overlay: a drag that moves the
     page while the picture stays still is exactly what "stuck" feels like. */
  document.body.classList.add('peek-locked');
}
/* Anything with a figure in it can hand the viewer an element. */
function openFigureFrom(el){
  if(!el) return;
  const img=el.tagName==='IMG'?el:el.querySelector('img');
  if(!img) return;
  const cap=el.querySelector('figcaption');
  const src=cap&&cap.querySelector('span');
  openFigure(img.currentSrc||img.src,
    (cap?cap.childNodes[0]&&cap.childNodes[0].textContent:'')||img.alt||'',
    src?src.textContent:'');
}`);

/* ── 2. every place a figure appears ─────────────────────────────────────── */
patch('figures: the strip under a reply opens',
`  const figStrip=figs.length?\`<div class="fig-strip"><span class="src-lbl">figure\${figs.length===1?'':'s'} from those notes</span>
    \${figs.map(f=>\`<figure class="ai-fig"><img src="\${f.dataUrl}" alt="\${e(f.caption)}" loading="lazy">`,
`  const figStrip=figs.length?\`<div class="fig-strip"><span class="src-lbl">figure\${figs.length===1?'':'s'} from those notes</span>
    \${figs.map(f=>\`<figure class="ai-fig" onclick="openFigureFrom(this)" role="button" tabindex="0"
      title="Open this figure full size"><img src="\${f.dataUrl}" alt="\${e(f.caption)}" loading="lazy">`);

patch('figures: and one the model placed inline',
`    return \`<figure class="ref-fig"><img src="\${src}" alt="\${cap}" loading="lazy"><figcaption>\${cap}</figcaption></figure>\`;`,
`    return \`<figure class="ref-fig" onclick="openFigureFrom(this)" role="button" tabindex="0"
      title="Open this figure full size"><img src="\${src}" alt="\${cap}" loading="lazy"><figcaption>\${cap}</figcaption></figure>\`;`);

patch('figures: and the pearl\'s',
`  return \`<figure class="pearl-fig" id="pearlFig" onclick="goRefs()" role="button" tabindex="0"`,
`  return \`<figure class="pearl-fig" id="pearlFig" onclick="openFigureFrom(this)" role="button" tabindex="0"`);

/* ── 3. how it looks ─────────────────────────────────────────────────────── */
patch('figures: the viewer, and a page that stays put behind it',
`/* peek modal */`,
`/* ── the figure viewer ───────────────────────────────────────────────────
   Dark ground, because a diagram printed on white reads best against one, and
   because it makes plain that the app is in a different mode now. */
#peek.fig-open{background:rgba(6,14,28,.88);padding:0;align-items:stretch}
.figv{position:relative;flex:1;display:flex;flex-direction:column;min-width:0;
  padding:calc(var(--sat,0px) + 12px) 12px calc(var(--sab,0px) + 12px)}
.figv-scroll{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;
  display:flex;align-items:center;justify-content:center}
/* Natural size when it fits, scaled down when it does not, and scrollable
   either way — a wide algorithm should be pannable, not squeezed to nothing. */
.figv-scroll img{display:block;max-width:100%;height:auto;margin:auto;
  border-radius:10px;background:#fff;cursor:zoom-in;
  transition:max-width .28s var(--glide,ease)}
/* Natural size, and the container scrolls to it. This is what makes a legend
   readable rather than merely crisp. */
.figv-scroll.zoomed img{max-width:none;width:auto;cursor:zoom-out;margin:0 auto}
.figv-hint{flex:0 0 auto;margin-top:8px;text-align:center;color:rgba(255,255,255,.55);
  font-size:11px;letter-spacing:.02em}
.figv-cap{flex:0 0 auto;margin-top:10px;padding:10px 12px;border-radius:12px;
  background:rgba(255,255,255,.08);color:#fff;font-size:13px;line-height:1.5;
  max-height:34vh;overflow-y:auto}
.figv-cap span{display:block;margin-top:5px;font-size:11px;opacity:.7}
/* Always the same corner, always on top of the picture. */
.figv-x{position:absolute;top:calc(var(--sat,0px) + 16px);right:16px;z-index:2;
  width:40px;height:40px;border-radius:20px;border:0;cursor:pointer;
  background:rgba(10,22,40,.72);color:#fff;display:flex;align-items:center;
  justify-content:center;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.figv-x .icon{width:20px;height:20px}
/* The page underneath does not move while the viewer is open. A drag that
   scrolls the page while the picture stays still is what "stuck" feels like. */
body.peek-locked{overflow:hidden}
.ai-fig,.ref-fig,.pearl-fig{cursor:zoom-in}

/* peek modal */`);

fs.writeFileSync(OUT, html);
console.log(`A figure you can read — ${applied.length} edits applied`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
