#!/usr/bin/env node
/*
 * A chapter you left is a chapter you can come back to.
 *
 *   node scripts/resume-patch.js <in.html> <out.html>
 *
 * THE BUG, AS THE FELLOW MET IT. Open Arrhythmias, answer eleven questions,
 * tap Home to look something up, tap Arrhythmias again — and it is question
 * one of a freshly shuffled deck. The eleven answers are still in the stats
 * and the FSRS schedule, so nothing was lost except the place, but the place
 * is what you came back for.
 *
 * WHY AN INDEX IS NOT ENOUGH, and this is the whole design. startQuiz() ends
 * with `qs=shuf(qs)`. The deck is shuffled on every entry, so "question 12"
 * names a different question each time and saving qIdx alone would return you
 * to a stranger. What has to be remembered is the ORDER — the question ids as
 * they were dealt — and the index into it. Restore the order and the index
 * addresses the same question it did before.
 *
 * WHAT ELSE TRAVELS WITH IT. S.answers is quiznav's per-question memory of
 * {selected, rated}; without it a resumed deck forgets which of the questions
 * behind you were answered and Previous re-offers them as unanswered. And
 * quizCorrect/quizTotal are the "this quiz: 7/11" line, which would otherwise
 * restart at zero on a deck that is eleven questions deep. All four are one
 * fact and are saved as one record.
 *
 * WHICH MODES RESUME, AND WHICH DELIBERATELY DO NOT. Practice decks — a
 * chapter, or the whole bank — are a fixed set you work through, so resuming
 * is simply correct. `due` and `missed` are not: `due` is reviewQueue(20)
 * computed from the FSRS schedule at the moment you ask, and `missed` is a
 * live set that shrinks as you get things right. Restoring yesterday's due
 * list would hand you cards that are no longer due and hide ones that are —
 * a saved position for those two would be a saved WRONG position. So they
 * shuffle fresh every time, as they always did.
 *
 * FINISHING CLEARS IT. Reaching the results screen deletes the record, so the
 * next entry into that chapter starts over. A deck you completed is not a
 * deck you are in the middle of.
 *
 * AND IT IS NOT SILENT. A quiz that opens at question 12 with no explanation
 * is indistinguishable from a bug — which is exactly how the fellow described
 * the original problem, in reverse. The counter grows a "restart" control, and
 * the resumption is announced to screen readers through the same aria-live
 * region every other screen change uses.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/resume-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. the state field ─────────────────────────────────────────────────── */
patch('resume: a place to keep where you were',
`let S={screen:'home',chapter:null,questions:[],qIdx:0,selected:null,answered:false,answers:{},`,
`let S={screen:'home',chapter:null,questions:[],qIdx:0,selected:null,answered:false,answers:{},
  /* {key: {ids,i,answers,correct,total,ts}} — one record per practice deck.
     See resumeKey() for what a key is and why due/missed have none. */
  resume:boot.resume||{}, resumed:false,`);

/* ── 2. the record, and the rules about it ──────────────────────────────── */
patch('resume: save, restore and forget a place',
`function startQuiz(ch,mode='all'){`,
`/* ONLY PRACTICE DECKS HAVE A KEY. Returning null is how the three functions
   below all decline at once: a mode with no key is a mode that never saves,
   never restores and never needs clearing. 'due' is recomputed from the FSRS
   schedule every time it is asked for and 'missed' shrinks as you improve, so
   for both of them a remembered deck is a stale deck. */
function resumeKey(ch,mode){
  if(mode!=='all') return null;
  return 'all|'+(ch||'*');
}
/* Twelve decks is more than anyone has half-finished at once, and it bounds
   what this can cost in a store that is already carrying the FSRS cards for
   the whole bank. Oldest touched goes first. */
const RESUME_MAX=12;
function saveResume(){
  const key=resumeKey(S.chapter,S.mode);
  if(!key||S.screen!=='quiz'||!S.questions.length) return;
  S.resume[key]={ids:S.questions.map(q=>q.id), i:S.qIdx,
    answers:S.answers, correct:S.quizCorrect, total:S.quizTotal, ts:Date.now()};
  const keys=Object.keys(S.resume);
  if(keys.length>RESUME_MAX){
    keys.sort((a,b)=>(S.resume[a].ts||0)-(S.resume[b].ts||0));
    while(keys.length>RESUME_MAX) delete S.resume[keys.shift()];
  }
  save();
}
function clearResume(ch,mode){
  const key=resumeKey(ch,mode);
  if(key&&S.resume[key]){ delete S.resume[key]; save(); }
}
/* Rebuilds the deck in its saved order, or returns null and lets the caller
   shuffle a fresh one. Every reason to decline is a reason the saved record no
   longer describes a deck this build can deal:

     · the bank moved under it — a reseed can retire an id, so ids are resolved
       through the pool that actually exists and a record that loses any of
       them is dropped rather than silently dealt short;
     · it was finished, or all but — a record sitting on the last question is
       a completed deck nobody cleared, and resuming onto it would show one
       question and end;
     · it is not this deck — the saved ids are checked against the pool the
       caller computed, so a chapter's record can never be dealt into "all". */
function restoreDeck(qs,key){
  const rec=key&&S.resume[key];
  if(!rec||!Array.isArray(rec.ids)||!rec.ids.length) return null;
  const have={}; qs.forEach(q=>{ have[q.id]=q; });
  const deck=[]; for(const id of rec.ids){ const q=have[id]; if(!q) return null; deck.push(q); }
  if(deck.length!==qs.length) return null;
  const i=rec.i|0;
  if(!(i>0&&i<deck.length)) return null;
  return {deck,i,answers:(rec.answers&&typeof rec.answers==='object')?rec.answers:{},
          correct:rec.correct|0,total:rec.total|0};
}
function startQuiz(ch,mode='all'){`);

/* ── 3. startQuiz deals the saved order when there is one ───────────────── */
patch('resume: deal the deck you were already holding',
`  qs=shuf(qs);
  Object.assign(S,{screen:'quiz',chapter:ch,questions:qs,qIdx:0,selected:null,
    answered:false,mode,zoomed:-1,quizCorrect:0,quizTotal:0,answers:{}});
  render();toTop();clearAnnounce();markShown();`,
`  const back=restoreDeck(qs,resumeKey(ch,mode));
  if(back){
    Object.assign(S,{screen:'quiz',chapter:ch,questions:back.deck,qIdx:back.i,
      selected:null,answered:false,mode,zoomed:-1,
      quizCorrect:back.correct,quizTotal:back.total,answers:back.answers,resumed:true});
    /* quiznav's restoreQuizState() is what turns S.answers[qIdx] back into
       S.selected/S.answered for the question being shown. Resuming lands on a
       question the same way Previous does, so it uses the same one function
       rather than a second copy of that reasoning. */
    if(typeof restoreQuizState==='function') restoreQuizState();
    render();toTop();markShown();
    /* Written INTO the live region rather than cleared out of it — the one
       screen change in the app that has something to say. #srLive is the
       region announceResult already speaks through. */
    const live=document.getElementById('srLive');
    if(live) live.textContent='Resumed at question '+(back.i+1)+' of '+back.deck.length;
    return;
  }
  qs=shuf(qs);
  Object.assign(S,{screen:'quiz',chapter:ch,questions:qs,qIdx:0,selected:null,
    answered:false,mode,zoomed:-1,quizCorrect:0,quizTotal:0,answers:{},resumed:false});
  render();toTop();clearAnnounce();markShown();`);

/* ── 4. every move writes the place down ────────────────────────────────── */
/* nextQ and prevQ are the only two things that change qIdx, and selectOpt is
   the only thing that changes S.answers. Saving from those three covers the
   state completely without a save() on every render. */
patch('resume: leaving a question remembers it',
`function nextQ(){
  toTop();
  if(S.qIdx>=S.questions.length-1){S.screen='results';render();
    try{ summariseSession(); }catch(_){}}
  else{S.qIdx++;restoreQuizState();render();clearAnnounce();focusEl('.q-card');markShown();}
}`,
`function nextQ(){
  toTop();
  if(S.qIdx>=S.questions.length-1){
    /* The deck is done. Clearing here rather than on the results screen means
       it is cleared exactly once, by the one path that can finish a deck. */
    clearResume(S.chapter,S.mode);
    S.resumed=false;
    S.screen='results';render();
    try{ summariseSession(); }catch(_){}}
  else{S.qIdx++;restoreQuizState();render();clearAnnounce();focusEl('.q-card');markShown();saveResume();}
}`);

patch('resume: stepping back remembers that too',
`function prevQ(){
  if(S.qIdx<=0)return;
  toTop();
  S.qIdx--;restoreQuizState();render();clearAnnounce();focusEl('.q-card');markShown();
}`,
`function prevQ(){
  if(S.qIdx<=0)return;
  toTop();
  S.qIdx--;restoreQuizState();render();clearAnnounce();focusEl('.q-card');markShown();saveResume();
}`);

/* ── 5. starting over, on purpose ───────────────────────────────────────── */
patch('resume: a way to deal a fresh deck instead',
`function goHome(){if(typeof closePeek==='function')closePeek();`,
`/* The counterpart to resuming, and the reason resuming can be automatic: if
   the deck you came back to is not the one you wanted, one tap deals a new
   one. Forgetting first is what stops startQuiz simply restoring it again. */
function restartQuiz(){
  const ch=S.chapter, mode=S.mode;
  clearResume(ch,mode);
  S.resumed=false;
  startQuiz(ch,mode);
}
function goHome(){if(typeof closePeek==='function')closePeek();`);

/* ── 6. the counter says so, and offers the way out ─────────────────────── */
patch('resume: the quiz says it resumed, and offers to start over',
`        <span class="q-counter">Q \${qIdx+1} / \${questions.length}</span>`,
`        <span class="q-counter">Q \${qIdx+1} / \${questions.length}</span>
        \${S.resumed?\`<button class="q-restart" type="button" onclick="restartQuiz()"
          title="Deal this chapter again from the beginning">Resumed · start over</button>\`:''}`);

patch('resume: the restart control looks like the counter, not like an action',
`.q-counter{font-size:13px;color:var(--muted);font-weight:600}`,
`.q-counter{font-size:13px;color:var(--muted);font-weight:600}
/* Quiet on purpose. It sits beside the counter as a statement of fact — you
   are part-way through — with the escape hatch attached. Loud enough to
   explain why the quiz opened at question twelve, not so loud that it competes
   with the question. */
.q-restart{font-size:12px;font-weight:600;color:var(--muted);background:none;
  border:1px solid var(--border);border-radius:999px;padding:3px 10px;cursor:pointer;
  margin-left:8px;line-height:1.4}
.q-restart:hover{color:var(--fg);border-color:var(--fg)}`);

/* ── 7. it survives the app being closed ────────────────────────────────── */
patch('resume: the place is part of the saved state',
`const SCHEMA_KEYS=['schemaVersion','chStats','missed','theme','homeLayout',
  'sessionCorrect','sessionTotal','srs','reviewStreak','lastReviewDay','daily',
  'practice','sinceBackup','lastBackup'];`,
`const SCHEMA_KEYS=['schemaVersion','chStats','missed','theme','homeLayout',
  'sessionCorrect','sessionTotal','srs','reviewStreak','lastReviewDay','daily',
  'practice','sinceBackup','lastBackup','resume'];`);

patch('resume: written with the rest of the progress',
`  srs:S.srs,reviewStreak:S.reviewStreak,lastReviewDay:S.lastReviewDay,daily:S.daily,
  practice:S.practice,sinceBackup:S.sinceBackup,lastBackup:S.lastBackup})));}`,
`  srs:S.srs,reviewStreak:S.reviewStreak,lastReviewDay:S.lastReviewDay,daily:S.daily,
  practice:S.practice,sinceBackup:S.sinceBackup,lastBackup:S.lastBackup,
  resume:S.resume})));}`);

/* ── 8. resetting progress forgets where you were, too ──────────────────── */
/* Leaving the records behind would mean "reset all scores" hands you back a
   half-finished deck with a 7/11 counter on it, which is not what was reset. */
patch('resume: a reset clears the places as well as the scores',
`  S.quizCorrect=0;S.quizTotal=0;S.srs={};S.reviewStreak=0;S.lastReviewDay=null;S.daily={};save();goHome();`,
`  S.quizCorrect=0;S.quizTotal=0;S.srs={};S.reviewStreak=0;S.lastReviewDay=null;S.daily={};
  S.resume={};S.resumed=false;save();goHome();`);

fs.writeFileSync(OUT, html);
console.log(`Resume applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
