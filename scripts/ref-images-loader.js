'use strict';
/*
 * The reference figures, fetched after the home screen — not during it.
 *
 * build-pwa splits the note figures into one file per unit under
 * content/refs-images/ (about 19 MB in all; valv.json alone is 7.2 MB) and
 * appends this to app.js. It used to fetch all four the moment app.js ran:
 * on the owner's boot-probe (split build, CPU slowed 4×) they started just
 * before the hero appeared and took until 5.2 s to land, each one parsed as
 * JSON on the main thread as it did — 19 MB competing with the reference seed
 * the pearl needs, on a connection an iPad may be sharing with a phone.
 *
 * Nothing on the home screen needs them to draw. The pearl's figure, a note's
 * figures and a grounded answer's figures all read REF_IMGS when they render;
 * refLatePaint() repaints the notes screen and a pearl whose figure arrives
 * late, and a grounded answer simply goes without a figure that has not
 * landed yet. So this waits:
 *
 *   1. for the reference seed to be applied (REF_SEED_READY — resolved on
 *      failure too, so a missing seed never strands the figures), so the
 *      pearl's own text is not queued behind 19 MB;
 *   2. for two animation frames, so whatever the seed repainted is on screen;
 *   3. for the browser to be idle — requestIdleCallback where there is one,
 *      and a timer where there is not, which is Safari, which is the iPad;
 *
 * and then fetches the units ONE AT A TIME, the unit holding the current
 * pearl's figure first, so what is on screen fills in before what is not and
 * no two 4-7 MB parses land in the same moment. A unit that fails costs that
 * unit's figures; the next one is still fetched.
 *
 * A string, because it runs in the page, not in Node: build-pwa substitutes
 * __PARTS__ and appends it. tests/verify-refimgdefer-pure.js runs this very
 * string against a stubbed page.
 */
const REF_IMG_LOADER = `
/* ── reference figures: after the home screen, one unit at a time (see scripts/ref-images-loader.js) ── */
(function(){
  if(typeof REF_IMGS === 'undefined') return;
  var parts = __PARTS__;
  var unitOf = function(key){
    var slash = String(key).indexOf('/');
    return slash > 0 ? String(key).slice(0, slash).replace(/[^A-Za-z0-9_-]/g, '_') : 'loose';
  };
  var ordered = function(){
    var fig = (typeof pearlCurrent !== 'undefined' && pearlCurrent && pearlCurrent.figKey) || '';
    /* A unit too big for one file continues in unit.2.json, unit.3.json
       (build-pwa splitRefImages); the pearl's figure may be in any of them,
       so all of that unit's files go first. */
    var base = fig ? 'content/refs-images/' + unitOf(fig) : '';
    var mine = function(u){ return !!base && (u === base + '.json' || u.indexOf(base + '.') === 0); };
    return parts.filter(mine).concat(parts.filter(function(u){ return !mine(u); }));
  };
  var next = function(queue){
    if(!queue.length) return;
    var u = queue.shift();
    fetch(u).then(function(r){ return r.json(); }).then(function(imgs){
      /* Merged into the binding, never assigned over it. */
      for(var k in imgs) REF_IMGS[k] = imgs[k];
      if(typeof refLatePaint === 'function') refLatePaint();
    }).catch(function(){ /* that unit's notes still render — just without their figures */ })
      .then(function(){ next(queue); });
  };
  var frame = function(){ return new Promise(function(done){
    if(typeof requestAnimationFrame === 'function') requestAnimationFrame(function(){ done(); }); else setTimeout(done, 16);
  }); };
  var idle = function(){ return new Promise(function(done){
    if(typeof requestIdleCallback === 'function') requestIdleCallback(function(){ done(); }, { timeout: 3000 });
    else setTimeout(done, 1000);
  }); };
  var seed = (typeof REF_SEED_READY !== 'undefined' && REF_SEED_READY && typeof REF_SEED_READY.then === 'function')
    ? REF_SEED_READY : Promise.resolve();
  seed.then(frame, frame).then(frame).then(idle).then(function(){ next(ordered()); });
})();
`;

module.exports = { REF_IMG_LOADER };
