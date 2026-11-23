/* ═════════════════════════════════════════════
   figzoom.js — the figure viewer's zoom row: + and −, Fit, and the readout between them (docs/ROADMAP.md, E1).

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

root.FigZoom = { STEP, by, fit, pct, sync };

})(typeof window !== 'undefined' ? window : this);
