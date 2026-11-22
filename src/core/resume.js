/* ═════════════════════════════════════════════
   resume.js — a practice deck put down and taken up again where it was left (docs/ROADMAP.md, E1).

     key(ch, mode)              the record a deck is kept under, or null for a mode that is never kept
     keep(resume, key, entry)   entry written under key IN PLACE, and the oldest touched dropped past MAX
     restore(rec, qs)           the deck rec describes, rebuilt from the pool qs, with where it was and what was
                                answered; or null, and the caller deals a fresh one
     MAX                        how many decks are kept

   ONLY PRACTICE DECKS HAVE A KEY. Returning null is how the page's three functions all decline at once: a mode with
   no key is a mode that never saves, never restores and never needs clearing. 'due' is recomputed from the FSRS
   schedule every time it is asked for and 'missed' shrinks as you improve, so for both of them a remembered deck is
   a stale deck.

   They were app/systole.html's resumeKey(), RESUME_MAX (now MAX), the trimming in recordResume() and the rules of
   restoreDeck(), moved unchanged but for what they read of the page (S.resume and the record's entry), which they
   are now handed. tests/verify-resume-pure.js holds them, and verify-resume the page's use in a browser.

   Pure: no DOM, no clock, no storage. ES2015; Safari 13.4 is the floor (README).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function key(ch,mode){
  if(mode!=='all') return null;
  return 'all|'+(ch||'*');
}
/* Twelve decks is more than anyone has half-finished at once, and it bounds
   what this can cost in a store that is already carrying the FSRS cards for
   the whole bank. Oldest touched goes first. */
const MAX=12;
function keep(resume,k,entry){
  resume[k]=entry;
  const keys=Object.keys(resume);
  if(keys.length>MAX){
    keys.sort((a,b)=>(resume[a].ts||0)-(resume[b].ts||0));
    while(keys.length>MAX) delete resume[keys.shift()];
  }
  return resume;
}
/* Rebuilds the deck in its saved order, or returns null and lets the caller
   shuffle a fresh one. Every reason to decline is a reason the saved record no
   longer describes a deck this build can deal:

     · the bank moved under it — a reseed can retire an id, so ids are resolved
       through the pool that actually exists and a record that loses any of
       them is dropped rather than silently dealt short;
     · it was finished — a record sitting on the last question with that
       question answered is a completed deck nobody cleared, and resuming onto
       it would show one question and end;
     · it is not this deck — the saved ids are checked against the pool the
       caller computed, so a chapter's record can never be dealt into "all". */
function restore(rec,qs){
  if(!rec||!Array.isArray(rec.ids)||!rec.ids.length) return null;
  const have={}; qs.forEach(q=>{ have[q.id]=q; });
  const deck=[]; for(const id of rec.ids){ const q=have[id]; if(!q) return null; deck.push(q); }
  if(deck.length!==qs.length) return null;
  const i=rec.i|0;
  /* QUESTION ONE IS A PLACE TOO (28 October 2026, reported from the app: open a chapter, answer the first question or
     only read it, go back, open the chapter again, and it was a freshly shuffled deck). This declined every record at
     index 0 as "nothing done", and the deck dealt on entry was never written until the first answer or Next, so
     leaving from the first question always lost it. The record is written as the deck is dealt (startQuiz), and index
     0 is a place like any other. */
  if(!(i>=0&&i<deck.length)) return null;
  const answers=(rec.answers&&typeof rec.answers==='object')?rec.answers:{};
  if(i===deck.length-1&&answers[i]&&answers[i].selected!=null) return null;
  return {deck,i,answers,correct:rec.correct|0,total:rec.total|0};
}

root.Resume = { key, keep, restore, MAX };

})(typeof window !== 'undefined' ? window : this);
