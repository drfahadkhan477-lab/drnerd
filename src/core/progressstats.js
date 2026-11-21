/* ═════════════════════════════════════════════
   progressstats.js — the numbers the Progress, Study and Brain screens lead with (docs/ROADMAP.md, E1).

   Five functions of app/systole.html that read the bank and the progress record and change nothing. Here they are
   functions of what they are given, held by tests/verify-progressstats-pure.js:

     mastery(pool, srs, practice, ch, today)
                                 a chapter's mastery, 0 to 1: the mean over its questions of FSRS's chance of
                                 recalling the card today; a card from before FSRS counts its reviews (a third each,
                                 at most 1), a question only practised its right answers (0.22 each, at most 0.45),
                                 an untouched one 0; a chapter with no questions 0
     retention(srs, today)       the mean chance of recall over every card FSRS has scheduled, as a whole percent;
                                 null where none has been
     forecast(srs, today)        the cards due on each of the next seven days, today first: [{ d, n }]
     started(pool, srs, practice)
                                 how many of the bank's questions have a card or a practice record; history from
                                 another bank is not counted, and not deleted
     last30(daily, today)        the last thirty days, oldest first, each { d, a, c }: answered and right, 0 for a day
                                 with nothing

       pool      the questions in this bank: [{ id, ch, … }]
       srs       the cards, by question id; practice the practice record, by question id; daily the days, by ISO day
       today     the reader's local day, 'YYYY-MM-DD' (the page's todayISO())

   Days are stepped by the calendar (setDate) and read back with FSRS.localDateToISO, never by a count of
   milliseconds. Nothing given is changed. FSRS is reached through `root` when asked, so a suite can load it beside
   this. The page keeps the old names (masteryFor, avgRetention, forecast7, startedCount, last30) as one line each.

   Pure: no DOM, no clock, no storage. ES2015; Safari 13.4 is the floor (README).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function day(iso, n){ const d=root.FSRS.isoToLocalDate(iso); d.setDate(d.getDate()+n); return root.FSRS.localDateToISO(d); }

function mastery(pool, srs, practice, ch, today){
  const qs=pool.filter(q=>q.ch===ch);
  if(!qs.length) return 0;
  let score=0;
  const t=today;
  for(const q of qs){
    const c=srs[q.id];
    if(c&&c.stability!==undefined){
      // "mastery" is literally FSRS's own prediction: how likely you are to
      // recall this card today, given how long it's been and how it's gone.
      score+=root.FSRS.retrievability(c.stability, root.FSRS.daysBetween(c.last||t,t));
      continue;
    }
    // a legacy card not yet touched by a review since the FSRS switch, or a
    // card only ever practised — both fall back to the old, coarser signal
    // until their next real review picks up a proper retrievability curve.
    if(c){ score+=Math.min(1,(c.reps||0)/3); continue; }
    const p=practice[q.id];
    if(p) score+=Math.min(0.45,(p.c||0)*0.22);
  }
  return score/qs.length;
}
/* average predicted retention across every card FSRS has actually scheduled —
   the single number the Progress screen leads with. */
function retention(srs, today){
  const t=today;
  let sum=0,n=0;
  for(const id in srs){
    const c=srs[id];
    if(!c||c.stability===undefined) continue;
    sum+=root.FSRS.retrievability(c.stability, root.FSRS.daysBetween(c.last||t,t)); n++;
  }
  return n?Math.round(sum/n*100):null;
}
/* how many cards come due on each of the next 7 days — so exam week doesn't
   ambush you with a queue you never saw coming. */
function forecast(srs, today){
  const out=[];
  for(let i=0;i<7;i++){
    const d=day(today,i);
    let n=0;
    for(const id in srs){ if(srs[id].due===d) n++; }
    out.push({d,n});
  }
  return out;
}
/* Current-bank coverage, without deleting history from other banks. */
function started(pool, srs, practice){
  return pool.reduce((n,q)=>n+(has(srs,q.id)||has(practice,q.id)?1:0),0);
}
function last30(daily, today){
  const out=[];
  for(let i=29;i>=0;i--){
    const d=day(today,-i);
    const v=daily[d];
    out.push({d,a:v?v.a:0,c:v?v.c:0});
  }
  return out;
}

root.ProgressStats = { mastery, retention, forecast, started, last30 };

})(typeof window !== 'undefined' ? window : this);
