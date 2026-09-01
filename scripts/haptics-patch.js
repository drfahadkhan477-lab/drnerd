#!/usr/bin/env node
/*
 * A felt pulse alongside the correct/wrong feedback selectOpt already draws.
 *
 *   node scripts/haptics-patch.js <in.html> <out.html>
 *
 * selectOpt() already triggers a real signature moment on every answer —
 * popIn/ringPulse on a correct option, a nudge shake on a wrong one, an
 * icon swap, and feedbackBlip() mounting a live ECGMonitor canvas that
 * draws an actual sinus-rhythm trace (correct) or an asystole flatline
 * (wrong). That is more distinctive than a generic checkmark treatment and
 * is not touched here. The one real, small gap: nothing in this file calls
 * navigator.vibrate anywhere. This adds exactly that, mirroring
 * feedbackBlip's own calling convention — a small function, called from
 * selectOpt through the same try{...}catch(_){} style already used for it.
 *
 * navigator.vibrate does not exist on iOS Safari at all (the Vibration API
 * was never shipped there), so hapticAnswer is a silent, feature-detected
 * no-op on iPhone and iPad Safari — this app's primary platform — and real
 * only on Android Chrome and similar. That is fine: a free enhancement
 * where it exists, never a regression where it does not. Gated on
 * prefers-reduced-motion like every other motion in this file, since
 * haptic intensity is a sensory axis some of the same people who disable
 * motion also want off.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/haptics-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

patch('haptics: a felt pulse alongside the correct/wrong feedback selectOpt already draws',
`function selectOpt(idx){
  if(S.answered)return;
  const q=S.questions[S.qIdx];
  if(!(idx>=0&&idx<q.o.length))return;                 // guard: key beyond option count
  const ok=idx===q.ci;
  const st=S.chStats[q.ch]||(S.chStats[q.ch]={correct:0,total:0});
  st.total++;S.sessionTotal++;S.quizTotal++;
  if(ok){st.correct++;S.sessionCorrect++;S.quizCorrect++;S.missed.delete(q.id);}
  else S.missed.add(q.id);
  /* Practice and review are different signals. A chapter drill records that it
     happened; only the review queue is allowed to move a card's due date.
     Otherwise drilling a chapter silently rewrites the schedule for every card
     it touches, and answering twice in a day compresses its interval. */
  logReview(q,null,ok,S.mode==='due'?'review-answer':'practice');
  if(S.mode!=='due'){
    const pr=S.practice[q.id]||(S.practice[q.id]={n:0,c:0,t:0});
    pr.n++; if(ok)pr.c++; pr.t=Date.now();
  }
  logAnswer(ok);
  S.selected=idx;S.answered=true;S.answers[S.qIdx]={selected:idx,rated:false};save();render();
  try{ feedbackBlip(document.querySelector('.reveal-header'),ok); }catch(_){}
}`,
`/* One short pulse for right, a short-pause-short triplet for wrong — the
   same correct/wrong split feedbackBlip already draws, felt as well as
   seen. */
function hapticAnswer(ok){
  if(!navigator.vibrate) return;
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  navigator.vibrate(ok?30:[30,60,30]);
}
function selectOpt(idx){
  if(S.answered)return;
  const q=S.questions[S.qIdx];
  if(!(idx>=0&&idx<q.o.length))return;                 // guard: key beyond option count
  const ok=idx===q.ci;
  const st=S.chStats[q.ch]||(S.chStats[q.ch]={correct:0,total:0});
  st.total++;S.sessionTotal++;S.quizTotal++;
  if(ok){st.correct++;S.sessionCorrect++;S.quizCorrect++;S.missed.delete(q.id);}
  else S.missed.add(q.id);
  /* Practice and review are different signals. A chapter drill records that it
     happened; only the review queue is allowed to move a card's due date.
     Otherwise drilling a chapter silently rewrites the schedule for every card
     it touches, and answering twice in a day compresses its interval. */
  logReview(q,null,ok,S.mode==='due'?'review-answer':'practice');
  if(S.mode!=='due'){
    const pr=S.practice[q.id]||(S.practice[q.id]={n:0,c:0,t:0});
    pr.n++; if(ok)pr.c++; pr.t=Date.now();
  }
  logAnswer(ok);
  S.selected=idx;S.answered=true;S.answers[S.qIdx]={selected:idx,rated:false};save();render();
  try{ feedbackBlip(document.querySelector('.reveal-header'),ok); }catch(_){}
  try{ hapticAnswer(ok); }catch(_){}
}`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('haptics-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
