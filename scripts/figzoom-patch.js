#!/usr/bin/env node
/*
 * A figure you can actually examine: pinch, pan, and a magnification you pick.
 *
 *   node scripts/figzoom-patch.js <in.html> <out.html>
 *
 * WHAT WAS THERE, AND WHY IT WAS NOT ENOUGH. figview-patch.js already opened a
 * figure full-screen with a caption and four ways out, and tapping it toggled
 * between fitted and natural size with the container scrolled. For a diagram
 * that is fine. For the figures this app is actually about it is not: a
 * 12-lead where the question is a 40 ms notch, an angiogram where it is the
 * calibre of one vessel, a Braunwald plate whose legend is six-point type.
 * Those need a magnification you choose at a point you choose — a continuous
 * gesture, not a two-state toggle — and four external reviews said so.
 *
 * THE MATHS IS NOT HERE. src/core/figzoom.js holds it, because zoom-about-a-
 * point is the part that goes subtly wrong: a sign or ordering error makes the
 * picture creep away from your fingers over successive pinches, which reads as
 * "the zoom feels bad" and is nearly impossible to attribute by eye. As pure
 * functions it is checked numerically instead — including across twenty
 * alternating gestures, where drift compounds and a single-zoom check would
 * still pass.
 *
 * WHAT THIS FILE OWES THE OLD VIEWER. All four exits keep working, and that is
 * the constraint that shapes the event handling: the backdrop tap has to
 * survive the arrival of dragging, so a pan must not be mistaken for a tap and
 * a pinch must not leave a stray click behind. The original comment about that
 * bug — "there is no way out of this image" — is the reason to be careful here
 * rather than clever.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/figzoom-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

/* ── the module ──────────────────────────────────────────────────────────── */

patch('figzoom: figzoom.js is embedded whole',
`let peekKeyHandler=null;`,
fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'figzoom.js'), 'utf8') +
'\nlet peekKeyHandler=null;\nlet figZ=null;');

/* ── the wiring ──────────────────────────────────────────────────────────── */

const WIRING = [
  '/* Pointer events, so one path serves finger, Pencil, trackpad and mouse. */',
  'function mountFigZoom(scroll){',
  '  const img=scroll.querySelector("img"); if(!img) return null;',
  '  /* A finger never holds still to the pixel, so latching "moved" on any',
  '     nonzero delta swallowed every real tap while zoomed — yet passed each',
  '     synthetic one, which moves exactly 0px. Measured from where the finger',
  '     LANDED, not summed along the path, so a slow wobble cannot creep past. */',
  '  const TAP_SLOP=8;',
  '  const z={st:FigZoom.fit(), pts:new Map(), moved:false, pinchAt:0, dx0:0, dy0:0};',
  '  const box=()=>scroll.getBoundingClientRect();',
  '  const content=()=>({w:img.offsetWidth, h:img.offsetHeight});',
  '  function apply(){',
  '    const b=box(), c=content();',
  '    z.st=FigZoom.constrain(z.st,b.width,b.height,c.w,c.h);',
  '    img.style.transform="translate("+z.st.tx+"px,"+z.st.ty+"px) scale("+z.st.scale+")";',
  '    scroll.classList.toggle("zoomed",!FigZoom.isFitted(z.st));',
  '    const pc=scroll.parentNode.querySelector(".figv-pct");',
  '    if(pc) pc.textContent=Math.round(z.st.scale*100)+"%";',
  '  }',
  '  const local=(x,y)=>{ const b=box(); return [x-b.left,y-b.top]; };',
  '  function zoomAt(f,x,y){ const p=local(x,y); z.st=FigZoom.zoomAbout(z.st,f,p[0],p[1]); apply(); }',
  '  /* Viewport centre, for buttons and keys — no pointer to anchor on. */',
  '  function zoomCentre(f){ const b=box(); z.st=FigZoom.zoomAbout(z.st,f,b.width/2,b.height/2); apply(); }',
  '  function reset(){ z.st=FigZoom.fit(); apply(); }',
  '',
  '  scroll.addEventListener("pointerdown",function(ev){',
  '    z.pts.set(ev.pointerId,{x:ev.clientX,y:ev.clientY});',
  '    z.moved=false; z.dx0=ev.clientX; z.dy0=ev.clientY;',
  '    if(z.pts.size===1&&!FigZoom.isFitted(z.st)){ try{ scroll.setPointerCapture(ev.pointerId); }catch(_){} }',
  '  });',
  '  scroll.addEventListener("pointermove",function(ev){',
  '    if(!z.pts.has(ev.pointerId)) return;',
  '    const prev=z.pts.get(ev.pointerId);',
  '    z.pts.set(ev.pointerId,{x:ev.clientX,y:ev.clientY});',
  '    if(z.pts.size===2){',
  '      const p=[...z.pts.values()];',
  '      const d=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);',
  '      if(z.pinchAt){',
  '        z.moved=true;',
  '        ev.preventDefault();',
  '        zoomAt(d/z.pinchAt,(p[0].x+p[1].x)/2,(p[0].y+p[1].y)/2);',
  '      }',
  '      z.pinchAt=d;',
  '      return;',
  '    }',
  '    if(z.pts.size===1&&!FigZoom.isFitted(z.st)){',
  '      const dx=ev.clientX-prev.x, dy=ev.clientY-prev.y;',
  '      /* Only the LATCH waits; panning follows from pixel one. */',
  '      if(Math.hypot(ev.clientX-z.dx0,ev.clientY-z.dy0)>TAP_SLOP) z.moved=true;',
  '      ev.preventDefault();',
  '      z.st=FigZoom.panBy(z.st,dx,dy); apply();',
  '    }',
  '  });',
  '  const release=function(ev){',
  '    z.pts.delete(ev.pointerId);',
  '    if(z.pts.size<2) z.pinchAt=0;',
  '    try{ scroll.releasePointerCapture(ev.pointerId); }catch(_){}',
  '  };',
  '  scroll.addEventListener("pointerup",release);',
  '  scroll.addEventListener("pointercancel",release);',
  '',
  '  /* Trackpad and mouse. ctrl+wheel is what a pinch on a trackpad sends. */',
  '  scroll.addEventListener("wheel",function(ev){',
  '    ev.preventDefault();',
  '    zoomAt(Math.exp(-ev.deltaY*(ev.ctrlKey?0.01:0.002)),ev.clientX,ev.clientY);',
  '  },{passive:false});',
  '',
  '  return {apply:apply, reset:reset, zoomCentre:zoomCentre, zoomAt:zoomAt,',
  '          state:function(){return z.st;}, moved:function(){return z.moved;},',
  '          tapped:function(x,y){',
  '            /* A SINGLE tap: what this viewer already did and said it did.',
  '               Double-tap was written first and the test refused it. What',
  '               changes is the toggle is anchored on the point tapped, so',
  '               magnifying a lead brings THAT lead closer. */',
  '            /* To NATURAL size, not a round number: 1:1 is why this viewer',
  '               exists, and verify-chatfigs asserts the magnified width',
  '               equals the source width. A 2.5x constant was refused. */',
  '            const c=content();',
  '            const nat=c.w>0?FigZoom.clamp(img.naturalWidth/c.w,1,FigZoom.MAX):2;',
  '            const p=local(x,y); z.st=FigZoom.toggle(z.st,p[0],p[1],nat); apply(); return true;',
  '          }};',
  '}',
].join('\n');

patch('figzoom: the pointer, pinch and wheel wiring',
`function openFigure(src,caption,source){`,
WIRING + '\nfunction openFigure(src,caption,source){');

/* ── the markup ──────────────────────────────────────────────────────────── */

patch('figzoom: a control row, for the times a gesture is not to hand',
`      <div class="figv-hint">tap the figure to magnify · tap outside to close</div>`,
`      <div class="figv-ctl" role="group" aria-label="Zoom">
        <button class="figv-btn" type="button" aria-label="Zoom out" onclick="figZ&&figZ.zoomCentre(1/1.4)">−</button>
        <span class="figv-pct" aria-live="off">100%</span>
        <button class="figv-btn" type="button" aria-label="Zoom in" onclick="figZ&&figZ.zoomCentre(1.4)">+</button>
        <button class="figv-btn figv-fit" type="button" aria-label="Fit to screen" onclick="figZ&&figZ.reset()">Fit</button>
      </div>
      <div class="figv-hint">tap to magnify · pinch or scroll to zoom · drag to pan · tap outside to close</div>`);

patch('figzoom: the image becomes a transform surface rather than a scrolled one',
`.figv-scroll img{`,
`.figv-ctl{flex:0 0 auto;display:flex;align-items:center;justify-content:center;gap:8px;margin-top:10px}
.figv-btn{min-width:40px;height:34px;padding:0 12px;border-radius:17px;border:0;cursor:pointer;
  background:rgba(255,255,255,.12);color:#fff;font-size:var(--t-body);line-height:1;
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.figv-fit{font-size:var(--t-meta)}
.figv-pct{min-width:4.2em;text-align:center;color:rgba(255,255,255,.75);font-size:var(--t-tiny);
  font-variant-numeric:tabular-nums}
/* touch-action:none is what lets a pinch reach the handler at all: without it
   the browser claims it for page zoom and the figure sits still. */
.figv-scroll{touch-action:none;overflow:hidden}
.figv-scroll.zoomed{cursor:grab}
.figv-scroll.zoomed:active{cursor:grabbing}
.figv-scroll img{transform-origin:0 0;will-change:transform;`);

/* ── the gestures the old handler owned ──────────────────────────────────── */

/* The old viewer magnified by changing LAYOUT: .zoomed set max-width:none so
   the image jumped to natural size and the container scrolled. The transform
   does that job now, and leaving both in place applied it twice — a tap to
   natural size rendered at natural x natural. Overriding it from a rule
   earlier in the stylesheet does not work either: same specificity, so the
   original still wins. It has to be edited where it is, and what survives is
   the part that was never about magnification. */
patch('figzoom: .zoomed stops changing layout, so the transform is not applied twice',
`.figv-scroll.zoomed img{max-width:none;width:auto;cursor:zoom-out;margin:0 auto}`,
`.figv-scroll.zoomed img{margin:0 auto}`);

patch('figzoom: a tap on the picture magnifies, a drag pans, and neither closes',
`    if(t.tagName==='IMG'&&t.closest('.figv-scroll')){
      t.closest('.figv-scroll').classList.toggle('zoomed');
      return;
    }`,
`    /* A pan ends on the image, so without this the drag that moved the figure
       would also be read as the tap that dismisses it. The old check could not
       have this problem because nothing dragged. */
    if(figZ&&figZ.moved()) return;
    if(t.tagName==='IMG'&&t.closest('.figv-scroll')){
      if(figZ) figZ.tapped(ev.clientX,ev.clientY);
      return;
    }
    if(t.closest&&t.closest('.figv-ctl')) return;`);

patch('figzoom: the keyboard reaches the zoom too',
`  peekKeyHandler=ev=>{ if(ev.key==='Escape') closePeek(); };`,
`  peekKeyHandler=ev=>{
    if(ev.key==='Escape'){ closePeek(); return; }
    if(!figZ) return;
    /* The pairs a browser already trains people to expect for zoom. */
    if(ev.key==='+'||ev.key==='='){ ev.preventDefault(); figZ.zoomCentre(1.4); }
    else if(ev.key==='-'||ev.key==='_'){ ev.preventDefault(); figZ.zoomCentre(1/1.4); }
    else if(ev.key==='0'){ ev.preventDefault(); figZ.reset(); }
  };
  /* Only for a figure: peekQuestion's dialog has no image. */
  const fs_=wrap.querySelector('.figv-scroll');
  figZ = fs_ ? mountFigZoom(fs_) : null;
  if(figZ){ const im=fs_.querySelector('img');
    if(im&&!im.complete) im.addEventListener('load',figZ.apply,{once:true}); else figZ.apply(); }`);

patch('figzoom: closing forgets the zoom, so the next figure opens fitted',
`  document.body.classList.remove('peek-locked');`,
`  document.body.classList.remove('peek-locked');
  figZ=null;`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('figzoom-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
