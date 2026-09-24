#!/usr/bin/env node
/*
 * The Living Diagram — ambient mode on the home screen.
 *
 *   node scripts/ambient-patch.js <in.html> <out.html>
 *
 * src/ui/livingDiagram.js has decided since the Conduction Wave branch WHEN
 * ambient mode may run and WHICH view it shows next, and nothing drew it.
 * That module's header is the spec, and this step follows it:
 *
 *   · the home screen only, with the Apex panel closed and Focus Mode off —
 *     nothing a fellow could be mid-thought in is ever covered;
 *   · after LivingDiagram.IDLE_MS of no interaction;
 *   · never under prefers-reduced-motion — continuous motion for as long as
 *     nobody touches the screen is exactly what that setting refuses;
 *   · cycling heart, 12-lead and PV loop every DWELL_MS, never the same view
 *     twice running.
 *
 * ── WHY THIS COULD BE BUILT NOW, WHEN IT WAS DEFERRED BEFORE ─────────────
 *
 * The session that wrote the module stopped here because the home hero's
 * live ECG runs on ECGMonitor, which is defined only inside the licensed
 * export: its lifecycle could not be read, and relocating it blind was a
 * risk worth refusing. This step does not touch it. Every view is drawn by
 * code this repository holds and tests:
 *
 *   heart   Heart3D.create()   src/core/heart3d.js — its destroy() and the
 *                              WebGL context budget are already held by
 *                              verify-heartreuse
 *   ecg     ECG12.mount()      src/ui/ecg12.js — no timers, no listeners
 *   pvloop  Wiggers.mount()    src/ui/wiggers.js, view 'pv' — destroy()
 *                              cancels its frame loop
 *
 * All three, and LivingDiagram itself, are embedded by earlier steps (apex,
 * leads, physio, polish). A view whose module is absent, or whose canvas
 * cannot get a context — Heart3D.create returns null without WebGL2 — is
 * skipped rather than shown blank.
 *
 * ── ONE ANCHOR ──────────────────────────────────────────────────────────
 *
 * The Durable memory banner assets(27) emits, the insertion point echo uses
 * too; this step re-emits it, so echo still finds it exactly once. No mount,
 * no state on S, no CSS anchor: listeners are delegated from `document`
 * once, and the stylesheet is injected on first use. Placed after focusmode
 * (86), whose S.focusMode it reads, and before echo, which stays last.
 *
 * ── A TAP WAKES THE SCREEN; IT DOES NOT PRESS WHAT IS UNDER IT ──────────
 *
 * The overlay closes on its own `click`, not on pointerdown. Remove it on
 * pointerdown and the click that follows lands on whatever door was beneath
 * the finger — waking the screen would also open a chapter. A drag that
 * never becomes a click still closes it, a moment after the finger lifts.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/ambient-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 200)}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

/* Written for the same Safari 13.4 floor as src/: var and function, no
   optional chaining, no nullish coalescing, and no `inset` in the CSS. */
patch('ambient: the Living Diagram, on an idle home screen',
`/* ══════════════ Durable memory — see src/core/memory.js ══════════════ */`,
`/* ═════════ Living Diagram — ambient mode, see src/ui/livingDiagram.js ═════════ */
var AMBIENT = (function(){
  var LD = window.LivingDiagram;
  var noop = function(){};
  if (!LD) return { tick: noop, enter: noop, exit: noop, next: noop,
                    active: function(){ return false; }, view: function(){ return null; } };

  var NAMES = { heart: 'The heart', ecg: 'The 12-lead', pvloop: 'The pressure–volume loop' };
  var last = Date.now(), active = false, view = null, el = null, live = null;
  var dwell = 0, closing = 0, moved = 0, lastX = null, lastY = null, lastScreen = null;

  function shellOpen(){ var sh = document.getElementById('shell'); return !!(sh && sh.classList.contains('ai-open')); }
  function reduced(){ try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch(_) { return false; } }
  function screenNow(){ return (typeof S !== 'undefined' && S) ? S.screen : null; }
  function opts(){ return { aiOpen: shellOpen(), focusMode: !!(typeof S !== 'undefined' && S && S.focusMode), reducedMotion: reduced() }; }

  function style(){
    if (document.getElementById('ambientStyle')) return;
    var st = document.createElement('style');
    st.id = 'ambientStyle';
    st.textContent =
      '.ambient{position:fixed;top:0;right:0;bottom:0;left:0;z-index:9000;background:rgba(3,7,12,.96);' +
        'display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;' +
        'animation:ambientIn .9s ease both}' +
      '.ambient-stage{width:min(88vw,1100px);height:min(72vh,720px);display:flex}' +
      '.ambient-canvas{width:100%;height:100%;display:block}' +
      '.ambient-caption{margin-top:18px;color:#94a3b8;font:500 13px/1.4 system-ui,-apple-system,sans-serif;text-align:center}' +
      '.ambient-name{color:#e2e8f0;font-weight:700}' +
      '@keyframes ambientIn{from{opacity:0}to{opacity:1}}';
    document.head.appendChild(st);
  }

  function release(){
    if (live && live.destroy) { try { live.destroy(); } catch(_) {} }
    live = null;
  }

  /* Mount one view. Returns whether it drew: a missing module or a canvas
     with no context is skipped rather than left on screen blank. */
  function show(v){
    release();
    var stage = el.querySelector('.ambient-stage');
    stage.innerHTML = '';
    var cv = document.createElement('canvas');
    cv.className = 'ambient-canvas';
    stage.appendChild(cv);
    if (v === 'heart' && window.Heart3D) live = Heart3D.create(cv, { rhythm: 'sinus', mode: 'whole' });
    else if (v === 'ecg' && window.ECG12) live = ECG12.mount(cv, { kind: 'sinus', hr: 68, dark: true });
    else if (v === 'pvloop' && window.Wiggers) live = Wiggers.mount(cv, { view: 'pv', dark: true, hr: 68 });
    view = v;
    el.setAttribute('data-view', v);
    el.setAttribute('data-live', live ? '1' : '0');
    el.querySelector('.ambient-name').textContent = NAMES[v] || v;
    return !!live;
  }

  function next(){
    if (!active) return;
    clearTimeout(dwell);
    /* At most one try per view, so a device that can draw none of them ends
       ambient mode instead of spinning. */
    var tries = LD.VIEWS.length, v = view;
    do { v = LD.nextView(v); } while (!show(v) && --tries > 0);
    if (!live) { exit(); return; }
    dwell = setTimeout(next, LD.DWELL_MS);
  }

  function enter(){
    if (active) return;
    style();
    el = document.createElement('div');
    el.className = 'ambient';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="ambient-stage"></div>' +
      '<div class="ambient-caption"><span class="ambient-name"></span> · tap anywhere to return</div>';
    el.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); exit(); });
    el.addEventListener('pointerup', function(){
      clearTimeout(closing);
      closing = setTimeout(function(){ if (active) exit(); }, 450);
    });
    document.body.appendChild(el);
    active = true;
    view = null;
    next();
  }

  function exit(){
    clearTimeout(dwell); clearTimeout(closing);
    release();
    if (el && el.parentNode) el.parentNode.removeChild(el);
    el = null; active = false; view = null;
    moved = 0; lastX = lastY = null;
    last = Date.now();
  }

  /* A CHANGE OF SCREEN IS ACTIVITY. Someone who has just come back to the
     home screen is not idle there, however long ago their last tap was — and
     every browser suite drives this app through page.evaluate rather than
     input events, so without this a suite that spent two minutes elsewhere
     would find the overlay rise the moment it returned home, over whatever
     it had come to measure. */
  function tick(nowMs){
    var n = typeof nowMs === 'number' ? nowMs : Date.now();
    var sc = screenNow();
    /* The first look records the screen without calling it a change: nothing
       changed, we simply had not looked. (Not read at load: S may not be
       initialised yet when this script runs, and typeof on an uninitialised
       let throws.) */
    if (lastScreen === null) lastScreen = sc;
    else if (sc !== lastScreen) { lastScreen = sc; last = n; }
    if (!active) { if (LD.shouldEnter(n - last, sc, opts())) enter(); }
    else if (!LD.eligible(screenNow(), opts())) exit();
  }

  /* Anything a person does is activity. While ambient mode is showing, a key
     or a wheel also closes it, and a tap closes it through the overlay's own
     click, above, so it cannot fall through to what is beneath.

     A MOUSE CLOSES IT BY MOVING — BUT BY MOVING DELIBERATELY. The first
     version closed on any mouse pointermove, and verify-ambient caught what
     that costs: a click is a move and then a press, so the move removed the
     overlay and the click that followed pressed the door beneath it. A hand
     resting on the mouse while clicking to wake the screen does the same. So
     movement has to add up to a real distance before it counts; a jitter
     does not, and a click without one is caught by the overlay like a tap. */
  function activity(e){
    last = Date.now();
    if (!active) return;
    if (e.type === 'keydown' || e.type === 'wheel') { exit(); return; }
    if (e.type === 'pointermove' && e.pointerType === 'mouse') {
      if (lastX !== null) moved += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
      lastX = e.clientX; lastY = e.clientY;
      if (moved > 40) exit();
    }
  }
  ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'].forEach(function(t){
    document.addEventListener(t, activity, { capture: true, passive: true });
  });
  document.addEventListener('visibilitychange', function(){
    last = Date.now();
    if (document.hidden && active) exit();
  });
  setInterval(tick, 5000);

  return { tick: tick, enter: enter, exit: exit, next: next,
           active: function(){ return active; }, view: function(){ return view; },
           live: function(){ return !!live; } };
})();

/* ══════════════ Durable memory — see src/core/memory.js ══════════════ */`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('ambient-patch applied:');
for (const e of edits) console.log('  ✓ ' + e);
