#!/usr/bin/env node
/*
 * The quiz says what just happened — to a screen reader, and to a keyboard.
 *
 *   node scripts/announce-patch.js <in.html> <out.html>
 *
 * FROM THE FIFTH EXTERNAL AUDIT, which was right about this and specific
 * enough to act on directly. Four earlier reviews and this repo's own
 * accessibility pass all missed it.
 *
 * THE BUG. The option buttons carried aria-pressed="${answered&&i===q.ci}".
 * q.ci is the ANSWER KEY. So on a wrong answer a screen reader announced the
 * correct option as pressed and the user's own choice as not pressed: it gave
 * the answer away and misreported what the user did, in one attribute.
 * Measured before the fix, choosing option 1 on a question whose key is 0:
 *   {"ci":0,"chose":1,"onChosen":"false","onCorrect":"true"}
 * `selected` was already in scope two lines above. One token.
 *
 * Correctness is not lost by this — it never lived in aria-pressed. It is
 * carried by .correct/.wrong, the icon swap, the percentages, the answer
 * distribution and the explanation, none of which move here.
 *
 * WHY THE LIVE REGION SITS OUTSIDE #app. selectOpt() ends in render(), and
 * render() rebuilds the screen with innerHTML. A live region inside that
 * subtree is destroyed and recreated already containing its text, and a
 * region that appears already-populated is not announced by any screen
 * reader — the announcement is triggered by a mutation to a region the AT is
 * already observing. So the region is a permanent sibling of <main id="app">,
 * created once in the shell, never replaced, and only its textContent
 * changes. That is also why the test asserts it exists and is EMPTY before
 * the first answer.
 *
 * FOCUS. Verified before writing: 4 .focus() calls existed in the whole file,
 * none of them in selectOpt/nextQ/prevQ. Answering moved focus nowhere, so a
 * keyboard or VoiceOver user was left on a button that had just become
 * disabled. Both targets get tabindex="-1" — focusable programmatically,
 * never in the tab order — and are focused with {preventScroll:true} so they
 * do not fight toTop(), which nextQ/prevQ call one line earlier.
 *
 * THE KEY. The keyboard was in better shape than first reported: A-E already
 * select an option ('abcde'.indexOf(...)), and guards-patch.js already
 * excludes INPUT/TEXTAREA/SELECT/[contenteditable]. The real gap was narrower
 * — ArrowRight is bound in BOTH branches and ArrowLeft in neither, so the
 * Previous button quiznav-patch.js shipped had no key at all while Next had
 * two. prevQ() already no-ops at S.qIdx<=0, so no bounds check is added here.
 *
 * AND THE LAST --dim. contrastfix-patch.js moved 46 sites off --dim (2.56:1,
 * fails AA at every theme). One survived its sweep: the peer-response
 * percentage on options that are neither correct nor selected — a number the
 * learner reads to compare against their own answer, which is exactly the
 * "text anyone is expected to read" the rule was written for. Found while
 * checking the audit's contrast claims; not in the audit.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/announce-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

/* ── 1. aria-pressed tells the truth ─────────────────────────────────────── */

patch('announce: aria-pressed reports the user\'s selection, not the answer key',
`aria-pressed="${'${answered&&i===q.ci}'}"`,
`aria-pressed="${'${answered&&i===selected}'}"`);

/* ── 2. the last --dim on read text ──────────────────────────────────────── */

patch('announce: an unselected option\'s percentage moves off --dim onto --muted',
`(i===selected?'var(--red)':'var(--dim)')`,
`(i===selected?'var(--red)':'var(--muted)')`);

/* ── 3. the live region, outside everything render() rebuilds ────────────── */

patch('announce: a permanent live region beside the main landmark',
`  <main id="app"></main>`,
`  <main id="app"></main>
  <!-- Outside #app on purpose: render() rebuilds #app wholesale, and a live
       region that is replaced already holding its text is never announced. -->
  <div id="srLive" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>`);

patch('announce: the visually-hidden rule the live region needs',
`.ai-disclaim{font-size:var(--t-micro);line-height:1.5;color:var(--muted);text-align:center;`,
`/* The standard visually-hidden idiom: reachable by assistive technology,
   zero visual footprint, and NOT display:none — which would remove it from
   the accessibility tree and silence the announcement entirely. */
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;
  overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.ai-disclaim{font-size:var(--t-micro);line-height:1.5;color:var(--muted);text-align:center;`);

/* ── 4. focus targets ────────────────────────────────────────────────────── */

patch('announce: the reveal header becomes a focus target',
`<div class="reveal-header ${'${ok?\'ok\':\'bad\'}'}">`,
`<div class="reveal-header ${'${ok?\'ok\':\'bad\'}'}" tabindex="-1">`);

patch('announce: the question card becomes a focus target',
`<div class="q-card anim-pop" style="border-left-color:${'${chColor}'}">`,
`<div class="q-card anim-pop" tabindex="-1" style="border-left-color:${'${chColor}'}">`);

/* ── 5. announce and move focus, once the screen has been rebuilt ────────── */

/* Both of these run AFTER render(), because render() is what creates the
   nodes they reach for. preventScroll keeps the focus call from undoing the
   toTop() that nextQ/prevQ perform one line earlier. */
const HELPERS =
`function announceResult(ok,corr){
  const live=document.getElementById('srLive');
  if(!live)return;
  /* Cleared first: setting the same string twice in a row is not a mutation,
     so two identical verdicts in a row would announce only once. */
  live.textContent='';
  live.textContent=ok?'Correct.':'Incorrect. The correct answer is '+corr.l+'. '+corr.t;
}
function focusEl(sel){
  const el=document.querySelector(sel);
  if(el){ try{ el.focus({preventScroll:true}); }catch(_){ el.focus(); } }
}
/* A permanent region keeps whatever it last said. Left alone, a verdict from
   the previous question sits in the accessibility tree while a new, unanswered
   question is on screen — so anyone who navigates back to the region reads a
   result that belongs to a question they have left. Cleared on every move. */
function clearAnnounce(){
  const live=document.getElementById('srLive');
  if(live)live.textContent='';
}
`;

patch('announce: the result is spoken, and focus lands on the explanation',
`S.selected=idx;S.answered=true;S.answers[S.qIdx]={selected:idx,rated:false};save();render();`,
`S.selected=idx;S.answered=true;S.answers[S.qIdx]={selected:idx,rated:false};save();render();
  try{ announceResult(ok,q.o[q.ci]); focusEl('.reveal-header'); }catch(_){}`);

patch('announce: the two helpers, defined just above their only callers',
`function nextQ(){`,
HELPERS + `function nextQ(){`);

patch('announce: moving forward puts focus on the new question',
`  else{S.qIdx++;restoreQuizState();render();}`,
`  else{S.qIdx++;restoreQuizState();render();clearAnnounce();focusEl('.q-card');}`);

patch('announce: and so does moving back',
`  S.qIdx--;restoreQuizState();render();`,
`  S.qIdx--;restoreQuizState();render();clearAnnounce();focusEl('.q-card');`);

/* ── 6. ArrowLeft, in both branches, inside the guard that already exists ── */

patch('announce: a new quiz starts with nothing left over to announce',
`  render();toTop();
}`,
`  render();toTop();clearAnnounce();
}`);

patch('announce: ArrowLeft goes back after an answer, as ArrowRight goes on',
`    if(ev.key===' '||ev.key==='Enter'||ev.key==='ArrowRight'){ev.preventDefault();nextQ();}`,
`    if(ev.key===' '||ev.key==='Enter'||ev.key==='ArrowRight'){ev.preventDefault();nextQ();}
    if(ev.key==='ArrowLeft'){ev.preventDefault();prevQ();}`);

patch('announce: and before one, so a skipped question can be returned to',
`  if(ev.key==='ArrowRight'){ev.preventDefault();nextQ();}`,
`  if(ev.key==='ArrowRight'){ev.preventDefault();nextQ();}
  if(ev.key==='ArrowLeft'){ev.preventDefault();prevQ();}`);

patch('announce: the hint names the key that now exists',
"`Press ${letters} to answer · <kbd>→</kbd> to skip`",
"`Press ${letters} to answer · <kbd>←</kbd> <kbd>→</kbd> to move`");

fs.writeFileSync(OUT, html, 'utf8');
console.log('announce-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
