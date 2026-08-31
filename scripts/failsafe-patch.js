#!/usr/bin/env node
/*
 * render() throwing must never leave a blank screen.
 *
 *   node scripts/failsafe-patch.js <in.html> <out.html>
 *
 * THE GAP, CONFIRMED BY READING render() BEFORE TOUCHING IT. Every call to
 * render() — at boot, on every screen change, on every answer — is
 * unguarded. If buildScreen() throws (a bad question record, a null where a
 * figure was expected, anything), the exception propagates straight out of
 * render(), and depending on where that call sat, the effect ranges from
 * "the rest of boot() never runs — no splash dismissal, no resize listener"
 * to "the tap that was supposed to change screens does nothing, forever,
 * with no visible sign anything went wrong." Either way: no error message,
 * no way back except knowing to reload from memory. That is what a fellow
 * mid-review sees as a blank or frozen screen.
 *
 * There is a second path into the same failure that a plain try/catch
 * around render()'s body does not cover: document.startViewTransition()'s
 * update callback does not throw synchronously into the caller — per spec,
 * a throwing callback just skips the transition and rejects the returned
 * ViewTransition's updateCallbackDone promise. An unhandled rejection there
 * is silent in exactly the same way. Both paths get the same fix.
 *
 * THE FIX IS A CIRCUIT BREAKER, NOT A NEW UI. showCrashScreen() replaces
 * #app's content directly with an self-contained, inline-styled fragment —
 * no dependency on buildScreen(), a CSS class, or anything else that might
 * be the thing that is actually broken — a short explanation, a Reload
 * button, and the real error collapsed under a <details> for whoever is
 * looking. It is written with string concatenation rather than this app's
 * usual template literals so nothing here can itself throw on an unusual
 * character in an error message; the message and stack are still run
 * through e(), the app's own escaper, since a stack trace is exactly the
 * kind of string nobody has reason to trust wholesale into innerHTML.
 *
 * A window-level 'error' handler is the second half: it catches anything
 * that reaches the window uncaught before render() itself ever ran (a
 * throw during boot, outside any render() call), but only takes the screen
 * over when #app is still visibly empty — a stray rejection from, say, an
 * Apex network call after a real screen is already painted should not blow
 * that screen away. render()'s own catch already handles the case where an
 * already-painted screen fails to update; this handler is only for the
 * window never having painted anything at all.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/failsafe-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

/* ── the circuit breaker itself, and render() wrapped to use it ── */
patch('failsafe: render() catches its own failure, both the sync path and the view-transition path',
`function render(){
  const changingScreen = lastScreen!==null && lastScreen!==S.screen;
  lastScreen = S.screen;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(changingScreen && document.startViewTransition && !reduced){
    document.startViewTransition(()=>renderNow());
  } else {
    renderNow();
  }
}`,
`function showCrashScreen(err){
  try{ console.error('Systole: a screen failed to render —', err); }catch(_){}
  try{
    const app=document.getElementById('app');
    if(!app) return;
    const msg=err&&err.message?err.message:String(err);
    const stack=err&&err.stack?err.stack:'';
    app.innerHTML=
      '<div style="max-width:26rem;margin:18vh auto 0;padding:0 1.5rem;text-align:center;'+
      'font-family:-apple-system,BlinkMacSystemFont,\\'Segoe UI\\',sans-serif;">'+
      '<div style="font-size:2.25rem;margin-bottom:.6rem;">\\u26A0\\uFE0F</div>'+
      '<h2 style="margin:0 0 .4rem;font-size:1.1rem;">Something went wrong</h2>'+
      '<p style="opacity:.7;margin:0 0 1.1rem;font-size:.9rem;line-height:1.4;">'+
      'This screen could not draw itself. Nothing already answered or saved is lost — '+
      'reloading should bring it back.</p>'+
      '<button onclick="location.reload()" style="padding:.55rem 1.3rem;border:none;'+
      'border-radius:.6rem;background:#3b82f6;color:#fff;font-size:.9rem;font-weight:600;'+
      'cursor:pointer;">Reload</button>'+
      '<details style="margin-top:1.1rem;text-align:left;opacity:.55;font-size:.72rem;">'+
      '<summary style="cursor:pointer;">Details</summary>'+
      '<pre style="white-space:pre-wrap;word-break:break-word;margin:.5rem 0 0;">'+e(msg)+'\\n'+e(stack)+'</pre>'+
      '</details></div>';
  }catch(_){
    try{ document.body.innerHTML='<p style="padding:2rem;font-family:sans-serif;">Something went wrong. <a href="javascript:location.reload()">Reload</a></p>'; }catch(__){}
  }
}
function render(){
  const changingScreen = lastScreen!==null && lastScreen!==S.screen;
  lastScreen = S.screen;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  try{
    if(changingScreen && document.startViewTransition && !reduced){
      const vt=document.startViewTransition(()=>renderNow());
      vt.updateCallbackDone.catch(showCrashScreen);
    } else {
      renderNow();
    }
  }catch(err){
    showCrashScreen(err);
  }
}`);

/* ── the window-level backstop, armed just before the first render() ── */
patch('failsafe: a boot-time throw outside render() still gets a real screen, not silence',
`applyTheme();
/* After applyTheme so the first paint is already right, and before render so
   a flip during boot is not missed. */
watchSystemTheme();
render();`,
`applyTheme();
/* After applyTheme so the first paint is already right, and before render so
   a flip during boot is not missed. */
watchSystemTheme();
/* Scoped to "the screen never painted anything at all" — render()'s own
   catch above already handles a throw while updating a screen that is
   already up, and an unrelated rejection (a dropped Apex request, say)
   should not blow away a working quiz just because it happened to be
   uncaught. */
window.addEventListener('error', ev=>{
  console.error('Uncaught error:', ev.error||ev.message);
  const app=document.getElementById('app');
  if(app && !app.firstElementChild) showCrashScreen(ev.error||new Error(String(ev.message||'unknown error')));
});
window.addEventListener('unhandledrejection', ev=>{
  console.error('Unhandled rejection:', ev.reason);
});
render();`);

fs.writeFileSync(OUT, html);
console.log(`Failsafe — ${edits.length} edit(s)`);
edits.forEach(e => console.log('  ✓ ' + e));
console.log(`written: ${OUT}`);
