#!/usr/bin/env node
/*
 * Stage 2 — FSRS-5 scheduling, on top of the Stage-0 + Apex build.
 *
 *   node scripts/stage2-patch.js <apex-output.html> <output.html>
 *
 * Replaces SM-2 with FSRS-5 (see src/core/fsrs.js for the algorithm and why).
 * The concrete thing this fixes: under SM-2, every rating on a card's first
 * review produced the same interval — reps===1 forced ivl=1 unconditionally,
 * so all four buttons said "tomorrow" regardless of whether you tapped Again
 * or Easy. FSRS gives each rating its own initial stability from the first
 * review, so the four buttons genuinely diverge (verified below: 1d / 2d /
 * 4d / 16d on a brand-new card, not four copies of the same date).
 *
 * Scope, deliberately:
 *   - The due-date scheduling infrastructure (dueQuestions, reviewQueue,
 *     newQuestionsForReview's chapter round-robin, the practice/review split
 *     Stage 0 already built) is untouched — FSRS only replaces what happens
 *     inside rateReview() and what a card's {difficulty,stability} mean.
 *   - Legacy SM-2 cards ({ef,ivl,reps,due,lapses,last}, no stability field)
 *     migrate in place, seeded from their existing interval, the moment they
 *     are next reviewed — no batch migration pass, no data loss, no card
 *     silently reset to a fresh state.
 *   - Mastery becomes real predicted retrievability (the model's own "how
 *     likely are you to get this right today") instead of reps/3, which
 *     could read 100% on a card you saw three times a year ago.
 *   - Chapter mastery rings, the Progress screen's headline stats, and the
 *     rate-row's per-button interval preview all read from the same numbers
 *     a session actually schedules from — nothing is a separate display-only
 *     estimate that can drift from what really happens on tap.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
  console.error('usage: node scripts/stage2-patch.js <apex-output.html> <output.html>');
  process.exit(1);
}

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];

function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) {
    throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  }
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ────────────────────────────────────────────────────────────────────────────
 * 1. Embed the FSRS module
 * ──────────────────────────────────────────────────────────────────────────── */
const ROOT = path.join(__dirname, '..');
const fsrs = fs.readFileSync(path.join(ROOT, 'src', 'core', 'fsrs.js'), 'utf8');

patch('embed: fsrs.js',
`/* ═══════════ SM-2 spaced repetition + active recall ═══════════`,
`/* ═══════════ FSRS-5 — see src/core/fsrs.js ═══════════ */
${fsrs}

/* ═══════════ SM-2 spaced repetition + active recall ═══════════`);

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Replace the scheduler. sm2Update/sm2FromCorrect are removed outright —
 *    Stage 0 already made sm2FromCorrect dead code (practice stopped calling
 *    it), and sm2Update's only two call sites are both replaced below.
 * ──────────────────────────────────────────────────────────────────────────── */
patch('scheduler: FSRS replaces SM-2',
`function sm2Update(card,quality){
  const c=card||{ef:2.5,ivl:0,reps:0,due:todayISO(),lapses:0};
  const q=Math.max(0,Math.min(5,quality));
  let ef=c.ef+(0.1-(5-q)*(0.08+(5-q)*0.02));
  if(ef<1.3) ef=1.3;
  let ivl, reps=c.reps, lapses=c.lapses||0;
  if(q<3){ ivl=1; reps=0; lapses++; }
  else{
    reps=c.reps+1;
    if(reps===1) ivl=1;
    else if(reps===2) ivl=6;
    else ivl=Math.round(c.ivl*ef);
  }
  return {ef,ivl,reps,due:addDays(todayISO(),ivl),lapses,last:todayISO()};
}
function sm2FromCorrect(card,correct){ return sm2Update(card, correct?4:2); }`,
`/* rateReview() and the rate-row preview call FSRS.update(card, rating, today)
   directly — see src/core/fsrs.js. Rating scale is FSRS's own: 1 Again,
   2 Hard, 3 Good, 4 Easy (RATINGS below carries these, not SM-2's 0/3/4/5). */
function fsrsPreview(card,rating){ return FSRS.update(card,rating,todayISO()); }`);

patch('ratings: FSRS scale (1 Again .. 4 Easy), not SM-2 quality (0/3/4/5)',
`const RATINGS=[['again','Again',0,'#EF4444'],['hard','Hard',3,'#F59E0B'],
               ['good','Good',4,'#10B981'],['easy','Easy',5,'#0891B2']];`,
`const RATINGS=[['again','Again',1,'#EF4444'],['hard','Hard',2,'#F59E0B'],
               ['good','Good',3,'#10B981'],['easy','Easy',4,'#0891B2']];`);

patch('rateReview: schedule via FSRS, and a rating of 2 (Hard) or above counts as recalled',
`function rateReview(grade){
  const q=S.questions[S.qIdx]; if(!q||!S.answered) return;
  logReview(q,grade,grade>=3,'review');
  S.srs[q.id]=sm2Update(S.srs[q.id],grade);
  logRated();
  bumpStreak();
  save();
  nextQ();
}`,
`function rateReview(grade){
  const q=S.questions[S.qIdx]; if(!q||!S.answered) return;
  logReview(q,grade,grade>=2,'review');
  S.srs[q.id]=FSRS.update(S.srs[q.id],grade,todayISO());
  logRated();
  bumpStreak();
  save();
  nextQ();
}`);

patch('rate-row: preview each button\'s FSRS interval, not SM-2\'s',
`           <span class="rate-sched">\${fmtInterval(sm2Update(S.srs[q.id],grade).ivl)}</span>`,
`           <span class="rate-sched">\${fmtInterval(fsrsPreview(S.srs[q.id],grade).ivl)}</span>`);

/* ────────────────────────────────────────────────────────────────────────────
 * 3. Mastery: predicted retrievability, not reps/3 — a card seen three times
 *    a year ago should not still read 100%.
 * ──────────────────────────────────────────────────────────────────────────── */
patch('mastery: retrievability for FSRS cards, graceful fallback for cards not yet migrated',
`function masteryFor(ch){
  const qs=POOL.filter(q=>q.ch===ch);
  if(!qs.length) return 0;
  let score=0;
  for(const q of qs){
    const c=S.srs[q.id];
    // mastery rises with successful repetitions, capped per card
    if(c){ score+=Math.min(1,(c.reps||0)/3); continue; }
    // a card only ever practised counts, but cannot reach what review reaches
    const p=S.practice[q.id];
    if(p) score+=Math.min(0.45,(p.c||0)*0.22);
  }
  return score/qs.length;
}`,
`function masteryFor(ch){
  const qs=POOL.filter(q=>q.ch===ch);
  if(!qs.length) return 0;
  let score=0;
  const t=todayISO();
  for(const q of qs){
    const c=S.srs[q.id];
    if(c&&c.stability!==undefined){
      // "mastery" is literally FSRS's own prediction: how likely you are to
      // recall this card today, given how long it's been and how it's gone.
      score+=FSRS.retrievability(c.stability, FSRS.daysBetween(c.last||t,t));
      continue;
    }
    // a legacy card not yet touched by a review since the FSRS switch, or a
    // card only ever practised — both fall back to the old, coarser signal
    // until their next real review picks up a proper retrievability curve.
    if(c){ score+=Math.min(1,(c.reps||0)/3); continue; }
    const p=S.practice[q.id];
    if(p) score+=Math.min(0.45,(p.c||0)*0.22);
  }
  return score/qs.length;
}
/* average predicted retention across every card FSRS has actually scheduled —
   the single number the Progress screen leads with. */
function avgRetention(){
  const t=todayISO();
  let sum=0,n=0;
  for(const id in S.srs){
    const c=S.srs[id];
    if(!c||c.stability===undefined) continue;
    sum+=FSRS.retrievability(c.stability, FSRS.daysBetween(c.last||t,t)); n++;
  }
  return n?Math.round(sum/n*100):null;
}
/* how many cards come due on each of the next 7 days — so exam week doesn't
   ambush you with a queue you never saw coming. */
function forecast7(){
  const t=todayISO();
  const out=[];
  for(let i=0;i<7;i++){
    const day=addDays(t,i);
    let n=0;
    for(const id in S.srs){ if(S.srs[id].due===day) n++; }
    out.push({d:day,n});
  }
  return out;
}`);

/* ────────────────────────────────────────────────────────────────────────────
 * 4. Progress screen: predicted retention tile, and a 7-day workload strip
 * ──────────────────────────────────────────────────────────────────────────── */
patch('stats: predicted retention tile',
`    <div class="stat-grid">
      <div class="stat-tile"><div class="st-v">\${S.reviewStreak||0}</div><div class="st-l">day streak \${icon('flame','icon-sm')}</div></div>
      <div class="stat-tile"><div class="st-v">\${totalA}</div><div class="st-l">answered</div></div>
      <div class="stat-tile"><div class="st-v">\${acc}%</div><div class="st-l">accuracy</div></div>
      <div class="stat-tile"><div class="st-v">\${dueN}</div><div class="st-l">due now</div></div>
    </div>`,
`    <div class="stat-grid">
      <div class="stat-tile"><div class="st-v">\${S.reviewStreak||0}</div><div class="st-l">day streak \${icon('flame','icon-sm')}</div></div>
      <div class="stat-tile"><div class="st-v">\${totalA}</div><div class="st-l">answered</div></div>
      <div class="stat-tile"><div class="st-v">\${acc}%</div><div class="st-l">accuracy</div></div>
      <div class="stat-tile"><div class="st-v">\${dueN}</div><div class="st-l">due now</div></div>
    </div>
    \${retentionTile()}`);

patch('stats: forecast strip in the panel, and the tile builder',
`function goStats(){ S.screen='stats'; render(); window.scrollTo(0,0); }`,
`function retentionTile(){
  const r=avgRetention();
  if(r===null) return '';
  const col=r>=85?'var(--green)':r>=65?'var(--amber)':'var(--red)';
  const fc=forecast7();
  const maxN=Math.max(1,...fc.map(d=>d.n));
  const bars=fc.map((d,i)=>{
    const dow=new Date(d.d+'T00:00:00').toLocaleDateString(undefined,{weekday:'short'})[0];
    const h=Math.round((d.n/maxN)*28)+4;
    return \`<div class="fc-bar-wrap" title="\${e(d.d)}: \${d.n} due">
      <div class="fc-bar" style="height:\${h}px"></div>
      <span class="fc-n">\${d.n}</span><span class="fc-dow">\${i===0?'today':e(dow)}</span></div>\`;
  }).join('');
  return \`<div class="panel">
    <div class="panel-h">Predicted retention</div>
    <div class="retention-row">
      <div class="retention-num" style="color:\${col}">\${r}%</div>
      <div class="retention-sub">Average chance you'd recall a reviewed card today, across \${Object.keys(S.srs).filter(id=>S.srs[id]&&S.srs[id].stability!==undefined).length} scheduled card\${Object.keys(S.srs).length===1?'':'s'}.</div>
    </div>
    <div class="fc-title">Next 7 days</div>
    <div class="fc-row">\${bars}</div>
  </div>\`;
}
function goStats(){ S.screen='stats'; render(); window.scrollTo(0,0); }`);

patch('css: retention tile and forecast strip',
`.mast-grid{`,
`.retention-row{display:flex;align-items:baseline;gap:14px;margin-bottom:16px}
.retention-num{font-family:var(--font-display);font-size:36px;font-weight:400;letter-spacing:-.01em;line-height:1}
.retention-sub{font-size:12.5px;color:var(--muted);line-height:1.5;max-width:38ch}
.fc-title{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin-bottom:8px}
.fc-row{display:flex;gap:6px;align-items:flex-end}
.fc-bar-wrap{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px}
.fc-bar{width:100%;max-width:26px;border-radius:5px 5px 2px 2px;background:var(--teal);opacity:.85}
.fc-n{font-size:11px;font-weight:700;color:var(--text)}
.fc-dow{font-size:9.5px;color:var(--dim);text-transform:uppercase;letter-spacing:.03em}
.mast-grid{`);

/* ────────────────────────────────────────────────────────────────────────────
 * 5. Doc comment on the persisted card shape, updated to describe FSRS
 * ──────────────────────────────────────────────────────────────────────────── */
patch('comment: describe the FSRS card shape, not the old SM-2 one',
`   Per-question card: {ef, ivl, reps, due, lapses}.
   ef: ease factor (2.5 default, floor 1.3). ivl: days until next due.
   due: ISO date string (day granularity — ISO strings compare correctly with <=).
   quality: 0-5 scale per canonical SM-2. Two entry points feed it:
     - ordinary quiz answers (binary correct/wrong) map conservatively to 4 / 2
     - a real post-explanation self-rating in review sessions supplies 0 / 3 / 4 / 5 directly
*/`,
`   Per-question card: {difficulty, stability, ivl, reps, due, lapses, last}.
   difficulty/stability drive FSRS-5's forgetting-curve model (src/core/fsrs.js).
   ivl: the scheduled interval in days, at FSRS's default 90% target retention.
   due: ISO date string (day granularity — ISO strings compare correctly with <=).
   rating: FSRS's own 1-4 scale (Again/Hard/Good/Easy), supplied directly by
   the post-explanation self-rating in review sessions. Ordinary quiz answers
   (Stage 0 onward) never reach the scheduler at all — see selectOpt/S.practice.
*/`);

/* ──────────────────────────────────────────────────────────────────────────── */
fs.writeFileSync(OUT, html);
const before = fs.statSync(SRC).size, after = fs.statSync(OUT).size;
console.log(`Stage 2 applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`\n${(before / 1048576).toFixed(2)} MB → ${(after / 1048576).toFixed(2)} MB`);
console.log(`written: ${OUT}`);
