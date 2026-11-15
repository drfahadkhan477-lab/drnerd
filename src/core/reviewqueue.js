/* ═════════════════════════════════════════════
   reviewqueue.js — what a review session holds, and how the next interval is said.

   A review session is the cards FSRS says are due, topped up with questions never reviewed. Which
   questions those are was three functions in app/systole.html reading the bank and the cards as globals;
   they are here as functions of what they are given, so the rules can be held without a page:

     due(pool, srs, today)              the questions whose card is due on or before today, in the bank's order
     fresh(pool, srs, limit)            up to `limit` questions with no card, taken a round at a time across chapters
     queue(pool, srs, today, target)    every due question, then fresh ones until the session reaches `target`
     fmtInterval(days)                  "tomorrow", "in 5 days", "in 3 weeks": the words on a rating button

       pool    the questions a session may draw from: [{ id, ch, … }], quarantined items already left out
       srs     the cards, by question id: { [id]: { due: 'YYYY-MM-DD', … } }
       today   the reader's local day, 'YYYY-MM-DD' (the page's todayISO()); ISO days compare as strings

   THE RULES, because each is a way a schedule quietly stops being one:

     1. Due is not capped. queue() returns EVERY due card, topped up with new ones until the session
        reaches `target`. If 70 cards are due, all 70 come back. Dropping overdue cards to hit a round
        number is how a review backlog silently becomes a hole in the schedule.
     2. New questions are sampled round-robin across chapters rather than in the bank's order. Otherwise
        a fresh reviewer would grind straight through Arrhythmias (first alphabetically) before ever
        seeing another chapter.
     3. A question with a card is never "new", due or not; a card with no question in the pool is never
        dealt. Chapters are kept in an object with no prototype, so one named "constructor" is a chapter.
     4. Nothing given is changed: the pool, the cards and the questions come back as they went in.

   They were dueQuestions(), newQuestionsForReview(), reviewQueue() and fmtInterval() in the page until
   they moved here (docs/ROADMAP.md, E1); the page keeps those four names as one line each, handing over
   POOL, S.srs and todayISO(). queue() calls due() and fresh() here where reviewQueue() called the page's
   two functions; nothing else differs. tests/verify-reviewqueue-pure.js holds it.

   No DOM, no clock, no storage: bare Node can test it. ES2015; Safari 13.4 is the floor (README).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function due(pool, srs, today){
  return pool.filter(q=>{ const c=srs[q.id]; return c && c.due<=today; });
}
function fresh(pool, srs, limit){
  if(limit<=0) return [];
  const byCh=Object.create(null);
  for(const q of pool) if(!srs[q.id]) (byCh[q.ch]||(byCh[q.ch]=[])).push(q);
  const chs=Object.keys(byCh);
  if(!chs.length) return [];
  const out=[]; let i=0;
  while(out.length<limit){
    let added=false;
    for(const ch of chs){
      const bucket=byCh[ch];
      if(i<bucket.length){ out.push(bucket[i]); added=true; if(out.length>=limit) break; }
    }
    if(!added) break;
    i++;
  }
  return out;
}
function queue(pool, srs, today, target){
  const d=due(pool,srs,today);
  const topUp=fresh(pool,srs,Math.max(0,target-d.length));
  return [...d,...topUp];
}
function fmtInterval(days){
  if(days<1) return 'later today';
  if(days===1) return 'tomorrow';
  if(days<14) return `in ${days} days`;
  if(days<60) return `in ${Math.round(days/7)} weeks`;
  return `in ${Math.round(days/30)} months`;
}

root.ReviewQueue = { due, fresh, queue, fmtInterval };

})(typeof window !== 'undefined' ? window : this);
