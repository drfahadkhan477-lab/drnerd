/* ═════════════════════════════════════════════
   stroke.js — a pen stroke made small enough to keep, and its outline drawn (docs/ROADMAP.md, E1).

   Ink is stored as strokes of points [x, y, pressure(, tilt)], x and y as fractions of the canvas. These were four
   functions of app/systole.html that read nothing of the page's, held here by tests/verify-stroke-pure.js:

     round(p)              a point with x and y to four decimals and pressure (and tilt) to two: sub-pixel on any
                           screen this runs on, and about a fifth of a raw coordinate's characters
     rdp(pts, eps)         Ramer–Douglas–Peucker: the points that a line between their neighbours already describes,
                           to within eps, left out; the first and last always kept, and a stroke that ends where it
                           began measured from that point, so it keeps its shape
     simplify(s)           a stroke of three points or more simplified IN PLACE (s.p replaced) at eps 0.0012, and s
                           returned; the page stores what comes back
     fill(ctx, outline)    an outline (perfect-freehand's) filled on a 2D context as one curved path through the
                           midpoints of its sides, each corner a control point; under three points, nothing

   Together round and rdp cut stored ink by roughly an order of magnitude. The page keeps the old names (roundPt,
   rdp, simplifyStroke, fillOutline) as one line each; penOutline(), which reads the page's pen and PencilFX's width
   curve, stays the page's.

   Pure: no DOM of its own, no clock, no storage. ES2015; Safari 13.4 is the floor (README).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function round(p){
  const out=[Math.round(p[0]*1e4)/1e4, Math.round(p[1]*1e4)/1e4, Math.round(p[2]*100)/100];
  if(p.length>3) out.push(Math.round(p[3]*100)/100);
  return out;
}
function rdp(pts,eps){
  if(pts.length<3) return pts;
  const a=pts[0], b=pts[pts.length-1];
  const dx=b[0]-a[0], dy=b[1]-a[1], len=Math.hypot(dx,dy);
  let dmax=0, idx=0;
  for(let i=1;i<pts.length-1;i++){
    /* A stroke that ends where it began has a chord of no length, and every point was 0 off it: the stroke was kept
       as two points. Off a chord of no length, the distance is from its point. */
    const d=len>0?Math.abs((pts[i][0]-a[0])*dy-(pts[i][1]-a[1])*dx)/len:Math.hypot(pts[i][0]-a[0],pts[i][1]-a[1]);
    if(d>dmax){ dmax=d; idx=i; }
  }
  if(dmax<=eps) return [a,b];
  return rdp(pts.slice(0,idx+1),eps).slice(0,-1).concat(rdp(pts.slice(idx),eps));
}
function simplify(s){
  if(s&&s.p&&s.p.length>2) s.p=rdp(s.p,0.0012);
  return s;
}
function fill(ctx,o){
  if(o.length<3) return;
  ctx.beginPath(); ctx.moveTo(o[0][0],o[0][1]);
  /* Through the midpoints, each corner a control point: the outline is curved, not a polygon. */
  for(let i=1;i<o.length;i++){ const a=o[i], b=o[(i+1)%o.length]; ctx.quadraticCurveTo(a[0],a[1],(a[0]+b[0])/2,(a[1]+b[1])/2); }
  ctx.closePath(); ctx.fill();
}

root.Stroke = { round, rdp, simplify, fill };

})(typeof window !== 'undefined' ? window : this);
