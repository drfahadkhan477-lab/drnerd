/* ═════════════════════════════════════════════
   figzoom.js — the figure viewer: which figures open together, and its zoom row (+ and −, Fit, and the readout
   between them) (docs/ROADMAP.md, E1).

     GROUP         what holds figures that open together: a reply's strip, a note's figures, a message's own
     item(el)      what the viewer is handed for the figure el is or holds: its picture's address, the picture,
                   the caption and its source; or null where there is no picture
     gather(el)    every figure that opens with el, in the order drawn, and where el is among them:
                   { items, at }; el alone when it is not one of them

     STEP          one press of + or −: times or divided by 1.4
     by(ps, k)     the current slide zoomed by k about the middle of the viewport, held between fitted and the most it
                   allows; nothing for a slide that cannot zoom
     fit(ps)       the current slide back to fitted
     pct(ps)       the readout: the current zoom in "times the fitted size", fitted being 100
     sync(ps)      the readout written into the bar, and the viewer marked zoomed while it is over 100

   ps is the PhotoSwipe viewer app/systole.html's openFigures() opened; all that is read of it is its current slide
   (zoomLevels, currZoomLevel, isZoomable, zoomTo), its viewport size and its element. Every function takes no viewer,
   or a viewer with no slide, as nothing to do.

   They were app/systole.html's FIG_STEP, figZoomBy(), figFit(), figPct() and figSyncZoom(), moved unchanged; the page
   keeps each name as one line into this. tests/verify-figzoom-pure.js holds them over a viewer of its own, and
   verify-figzoom the real one in a browser.

   No DOM of its own: what it touches is the viewer's element it is handed. ES2015; Safari 13.4 is the floor (README).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

/* The readout and the + − buttons speak in "times the fitted size", as the
   old viewer did: fitted is 100%, one press of + is 140%. */
const STEP=1.4;
function by(ps,k){
  const s=ps&&ps.currSlide; if(!s||!s.isZoomable()) return;
  const lv=Math.min(s.zoomLevels.max,Math.max(s.zoomLevels.initial,s.currZoomLevel*k));
  s.zoomTo(lv,{x:ps.viewportSize.x/2,y:ps.viewportSize.y/2},220);
  sync(ps);
}
function fit(ps){ const s=ps&&ps.currSlide; if(s){ s.zoomTo(s.zoomLevels.initial,undefined,220); sync(ps); } }
function pct(ps){
  const s=ps&&ps.currSlide;
  return s&&s.zoomLevels.initial?Math.round(s.currZoomLevel/s.zoomLevels.initial*100):100;
}
/* zoomTo sets the zoom level synchronously. Keep our controls in that same
   state, rather than waiting for the next frame (which can be delayed in
   WebKit). Gesture updates still use PhotoSwipe's zoomPanUpdate event. */
function sync(ps){
  const el0=ps&&ps.element; if(!el0) return;
  const p=pct(ps), el=el0.querySelector('.pswp__figv-pct');
  if(el) el.textContent=p+'%';
  el0.classList.toggle('figv-zoomed',p>100);
}

/* ── which figures open together ──
   They were the page's FIG_GROUP, figFromEl() and the gathering in openFigureFrom(); the page keeps figFromEl()
   as one line and openFigureFrom() as the call that opens what this gathers. */

/* Anything with a figure in it can hand the viewer an element. The other
   figures beside it (a reply's strip, a note's figures, a message's inline
   ones) come too, so a swipe goes to the next. */
const GROUP='.fig-list,.msg,.ref-body,.ref-view,.pearl-card,.feed-card,#aiBody,#app';
function item(el){
  const img=el.tagName==='IMG'?el:el.querySelector('img');
  if(!img) return null;
  const cap=el.querySelector('figcaption');
  const src=cap&&cap.querySelector('span');
  return {src:img.currentSrc||img.src,element:img,
    caption:(cap?cap.childNodes[0]&&cap.childNodes[0].textContent:'')||img.alt||'',
    source:src?src.textContent:''};
}
function gather(el){
  const scope=el.closest&&el.closest(GROUP);
  /* Every figure that opens full size names one of two actions (docs/ROADMAP.md, E2): a note's, a reply's and the Apex
     strip's openFigureFrom, and the pearl's openPearlFigure, which has keys of its own. Both are gathered, in the order
     they are drawn. */
  const els=scope?[...scope.querySelectorAll('figure[data-action="openFigureFrom"],figure[data-action="openPearlFigure"]')]:[];
  if(els.indexOf(el)<0) return {items:[item(el)].filter(Boolean),at:0};
  const items=els.map(item), at=els.indexOf(el);
  return {items:items.filter(Boolean),at:items.slice(0,at).filter(Boolean).length};
}

root.FigZoom = { STEP, by, fit, pct, sync, GROUP, item, gather };

})(typeof window !== 'undefined' ? window : this);
