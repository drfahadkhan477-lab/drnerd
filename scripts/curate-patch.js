#!/usr/bin/env node
/*
 * The trap gets scoped, the heart waits its turn, and the card says its name.
 *
 *   node scripts/curate-patch.js <in.html> <out.html>
 *
 * SIX SMALL THINGS from two more external audits, each verified against the
 * running build before it was accepted. The seventh and most valuable finding
 * of that round — 19 explanations ending in ACCSAP's CME credit paperwork —
 * is NOT here: it is content, so it lives in flags-patch.js (chain step 3)
 * where a content correction survives re-extraction.
 *
 * WHAT WAS REJECTED, so it is not rediscovered as a good idea:
 *
 *   · "vt.updateCallbackDone.catch(showCrashScreen) is overly aggressive —
 *     an interrupted transition should not crash." Backwards. Per the View
 *     Transitions spec updateCallbackDone rejects ONLY when the update
 *     callback itself throws; an interrupted or skipped transition rejects
 *     `ready`. renderNow() runs inside that callback, and the surrounding
 *     try/catch has already returned by the time it runs — so this catch is
 *     the only thing that can see a render throw on the transition path.
 *     Removing it reinstates exactly the blank screen failsafe-patch.js
 *     exists to prevent. Left alone deliberately.
 *   · "Raise dark-mode --muted from #94A3B8." Measured on the real dark
 *     backgrounds: 6.43-7.30:1. Passes AA, near AAA. #94A3B8 fails only at
 *     2.56:1 on white, which is the LIGHT theme's --dim and was swept by
 *     contrastfix-patch.js. The audit confused the two tokens.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/curate-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

/* ── 1. the double-tap trap stops being global ───────────────────────────── */

/* Flagged by three consecutive audits, and they were right. A document-wide
   touchend that preventDefaults any second tap within 350ms suppresses iOS
   double-tap zoom everywhere — including on the figure viewer, where
   double-tap-to-zoom is the gesture a fellow reaches for on an ECG, and on
   the ink surface. Scoped to the quiz option rows and the nav, which is where
   an accidental double tap actually causes trouble (a second tap landing on
   the next question's option after the screen re-renders). Everything else —
   figures, Pencil, browser zoom — gets its gestures back. */
patch('curate: double-tap suppression scopes to the controls that need it',
`document.addEventListener('touchend',ev=>{
  const now=Date.now();
  if(now-lastTap<350&&now-lastTap>0)ev.preventDefault();
  lastTap=now;},{passive:false});`,
`document.addEventListener('touchend',ev=>{
  /* Scoped, not global. A bare document-level preventDefault here also
     suppressed double-tap zoom on figures and interfered with Pencil and
     browser gestures — three separate audits flagged it. Only the controls
     where a stray second tap actually misfires are guarded. */
  const t=ev.target&&ev.target.closest&&ev.target.closest('.opt,.btn,.nav-item,.door,.rate-btn');
  if(!t)return;
  const now=Date.now();
  if(now-lastTap<350&&now-lastTap>0)ev.preventDefault();
  lastTap=now;},{passive:false});`);

/* ── 2. NOT DONE: defer the WebGL heart to requestIdleCallback ───────────
   Built, measured, reverted. The audit was factually right that
   requestIdleCallback appears nowhere and the heart mounts on the first-paint
   path. Deferring it is still the wrong trade here, and the evidence is
   specific:

   THE COST IS REAL AND MEASURED. With the mount deferred, verify-home's
   11-inch-landscape no-scroll check passed 3/3 standalone at 0px over and
   FAILED at 9px over inside the full suite, where the other suites compete
   for CPU. The idle callback lands after the layout has been declared
   settled, so the home screen's height becomes a function of how busy the
   machine is. That is a late layout shift on the primary screen, on the
   device this app is actually used on.

   THE BENEFIT WAS OVERSTATED. The same audit called pausing rAF-driven
   canvases the "biggest battery win" when browsers already suspend them; its
   performance framing did not survive checking. This app is offline-first, so
   first paint is not network-bound, and splash-patch.js already covers the
   boot window — verify-splash proves it under 4x CPU throttle.

   AND THE TEST IT BROKE IS NOT NEGOTIABLE. verify-home's no-scroll guarantee
   is homeflow's "the home screen is three things" thesis, enforced. It
   already refused the medical disclaimer from the home screen earlier in this
   project and was right to. Weakening it to admit a decoration would be
   arguing with the design instead of reading it. */

/* ── 3. the rotate timer stops when nobody is looking ────────────────────── */

/* The audit that raised this called it the single biggest battery win. It is
   not: ECGMonitor and Heart3D both drive their loops with
   requestAnimationFrame, which browsers already suspend for a hidden page.
   What genuinely survives backgrounding is this setInterval, which keeps
   swapping rhythms every 11 seconds at nobody. Cheap to stop, so stop it. */
patch('curate: the hero rotation stops while the page is hidden',
`document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden')flushLog(); });`,
`document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden'){
    flushLog();
    /* rAF-driven canvases need nothing — the browser suspends them. This
       interval does not suspend, so it is the only thing worth stopping. */
    if(heroRotateTimer){ clearInterval(heroRotateTimer); heroRotateTimer=null; }
  } else if(S.screen==='home'&&!heroRotateTimer&&heroMon){
    heroRotateTimer=startHeroRotation();
  }
});`);

/* ── 4. one definition of the rotation, so pause/resume cannot drift ─────── */

patch('curate: the rotation interval gets a name, so resuming reuses it',
`  heroRotateTimer=setInterval(()=>{`,
`  heroRotateTimer=startHeroRotation();
  return;
}
/* Extracted so visibilitychange can restart exactly what mountHero started.
   Two hand-copied interval bodies would drift the moment either changed. */
function startHeroRotation(){
  return setInterval(()=>{`);

/* ── 5. the question card says which question it is ──────────────────────── */

/* .q-card already takes focus on navigation (announce-patch.js) and carries
   tabindex="-1", but nothing named it — so focusing it announced the stem
   with no context. The tag line beside it already reads "Question 12 ·
   Arrhythmias", which is exactly the name it wants. */
patch('curate: the question card is labelled by the tag that names it',
`<div class="q-card anim-pop" tabindex="-1" style="border-left-color:${'${chColor}'}">
      <div class="q-tag">`,
`<div class="q-card anim-pop" tabindex="-1" aria-labelledby="qTag" style="border-left-color:${'${chColor}'}">
      <div class="q-tag" id="qTag">`);

/* ── 6. NOT DONE: focus on a microtask after the announcement ────────────
   The audit asked for queueMicrotask between announceResult() and the focus
   call, to stop a screen reader announcing the live region and the focus
   change over each other. Written, then reverted, because it does not do
   what it claims: a microtask runs inside the SAME task, before the browser
   next updates the accessibility tree, so assistive technology observes both
   mutations together either way. Real separation would need a timeout or a
   frame — a visible delay before focus lands, which is a worse trade than
   the speech overlap it is guessing at.

   It also made focus asynchronous, which broke the existing check that
   answering moves focus to the reveal. That test was right to fail: focus
   timing is behaviour, and this change altered it for no measured benefit.
   Left as a direct call. */

/* ── 7. two honest words ─────────────────────────────────────────────────── */

/* navigator.storage.persist() grants stronger eviction protection. It does
   not make data permanent, and the fellow reading this line is deciding
   whether they still need to export a backup. */
patch('curate: persistent storage is described as protection, not permanence',
`: PERSISTED ? 'storage marked persistent'`,
`: PERSISTED ? 'storage granted eviction protection (not permanent — keep exporting backups)'`);

/* reviewQueue's parameter never capped anything: it sizes the new-question
   top-up, and every due card is returned however many there are. That is the
   correct behaviour for spaced repetition — silently dropping overdue cards
   would be the bug — and the tool that calls it already reports the true
   counts. Only the name was lying. */
patch('curate: reviewQueue names its parameter for what it actually does',
`function reviewQueue(cap){
  const due=dueQuestions();
  const topUp=newQuestionsForReview(Math.max(0,cap-due.length));
  return [...due,...topUp];
}`,
`/* Returns EVERY due card, topped up with new ones until the session reaches
   \`target\`. It is not a cap: if 70 cards are due, all 70 come back. Dropping
   overdue cards to hit a round number is how a review backlog silently
   becomes a hole in the schedule. */
function reviewQueue(target){
  const due=dueQuestions();
  const topUp=newQuestionsForReview(Math.max(0,target-due.length));
  return [...due,...topUp];
}`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('curate-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
