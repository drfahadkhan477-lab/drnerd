/* ═════════════════════════════════════════════
   study.js — the Study screen: the chapters, the review queue, the study plan, topic runs, what was missed,
   flagged and written on, and the whole bank.

   It was buildStudy(), arc() and examLeftText() in app/systole.html (docs/ROADMAP.md, E1 step 3). They are
   here as functions of what they are given, so what the screen says can be held without a page:

     screenHtml(S, CHAPTERS, CH_COLORS, kit)   the screen's markup, as a string
     arc(cls, cx, cy, r, frac)                 a progress arc on a circle, the fraction clamped to 0..1
     examLeftText(S, kit)                      what the exam tile says of the days left

       S           the page's state. Read, never changed: chStats, examDate, missed, reviewStreak, srs
       CHAPTERS    the bank's chapter names, in the order shown
       CH_COLORS   a chapter's colour, by name; a chapter with none takes the teal (or, on its tile, a
                   lighter teal)
       kit         what the markup uses of the page, under the page's names:
                     CH_SHORT, CH_ICONS, POOL, TOTAL_Q        the bank's tables
                     NOTES, INK, QBYID                        for how many questions are written on
                     _flagArm                                 whether "Clear all flags" is waiting for its second tap
                     _runsShown                               the topic runs, as the page has just worked them out
                     dueQuestions, startedCount, masteryFor, planNow, recentPerDay, examDaysLeft, flaggedQs,
                     todayISO                                 the page's functions, asked as the screen is drawn
                     StudyPlan, FlagSet, FSRS                 src/core modules
                     chIcon, chInk, e, icon                   the page's helpers

   The parameters carry the names the page uses for the same things, so the bodies below moved as they
   stood, less one line: the page works out the topic runs into _runsShown before it asks for the screen,
   because startRun() and three browser suites read them from there. tests/verify-study-pure.js holds what
   follows, and the page's line that hands these over.

   WHAT THE SCREEN SAYS, each a thing a reader acts on:

     1. A ring for each chapter, as full as it is mastered, that starts that chapter.
     2. The review queue: how many are due, or that all are done, or how to begin; and the streak.
     3. The study plan: how much of the bank has been seen and is remembered today, the pace against the
        exam date, a plan for 10, 20 or 40 minutes, and the exam date, with the days left.
     4. Topic runs, when there are any; what was missed, flagged and written on, when there is any.
     5. Shuffle the whole bank, and a tile for each chapter: how many questions and figures, how many
        right, and how much is mastered.

   The controls name actions, not inline handlers (docs/ROADMAP.md, E2), which the page's tables call
   (src/core/actions.js): a chapter's story and tile startChapter, with the chapter in data-ch through e();
   the review, missed, flagged and every-question cards startDue, retryMissed, startFlagged and startAll;
   a plan chip startPlan and a topic run startRun, with the number in data-plan or data-run; the exam date
   setExamDate when another is chosen, and its clear button clearExamDate; and clearFlags, goAnnotations and
   goHome. The functions stay the page's.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

/* A progress arc on a circle of any radius. pathLength=100 makes the dash a percentage, so the arc drawn is
   exactly the fraction given (clamped to 0..1) whatever the radius. data-frac is that fraction, for the tests. */
function arc(cls,cx,cy,r,frac){
  const f=Math.max(0,Math.min(1,+frac||0));
  return `<circle class="${cls}" cx="${cx}" cy="${cy}" r="${r}" pathLength="100" stroke-dasharray="${(f*100).toFixed(1)} 100" data-frac="${f.toFixed(4)}" transform="rotate(-90 ${cx} ${cy})"/>`;
}

function examLeft(S,kit){
  const {FSRS,todayISO}=kit;
  if(!S.examDate) return '';
  const n=FSRS.daysBetween(todayISO(),S.examDate);
  return n>1?`${n} days to your exam`:n===1?'Your exam is tomorrow':n===0?'Your exam is today':'Your exam date has passed';
}

function screenHtml(S, CHAPTERS, CH_COLORS, kit){
  const {CH_SHORT,CH_ICONS,POOL,TOTAL_Q,NOTES,INK,QBYID,_flagArm,_runsShown,dueQuestions,startedCount,masteryFor,planNow,recentPerDay,
    examDaysLeft,flaggedQs,StudyPlan,FlagSet,chIcon,chInk,e,icon}=kit;
  /* The tile's words, under the name the body below calls them by. */
  const examLeftText=()=>examLeft(S,kit);
  const dueN=dueQuestions().length, seenN=startedCount();

  const stories=CHAPTERS.map(ch=>{
    const m=masteryFor(ch), col=CH_COLORS[ch]||'var(--teal)';
    const R=27,C=2*Math.PI*R;
    return `<button class="story" data-action="startChapter" data-ch="${e(ch)}"
        style="--accent:${col}" aria-label="${e(ch)}, ${Math.round(m*100)} percent mastered">
      <span class="story-ring">
        <svg viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="${R}" fill="none" stroke="var(--border)" stroke-width="4"/>
          <circle cx="32" cy="32" r="${R}" fill="none" stroke="${col}" stroke-width="4"
            stroke-dasharray="${C}" stroke-dashoffset="${C*(1-m)}" stroke-linecap="round"
            transform="rotate(-90 32 32)"/>
        </svg>
        <span class="story-ico">${chIcon(ch)}</span>
      </span>
      <span class="story-lbl">${e(CH_SHORT[ch]||ch.split(' ')[0])}</span>
    </button>`;
  }).join('');

  const reviewCard=`<button class="feed-card review-card${dueN?' live':''}" data-action="startDue">
    <div class="fc-glow"></div>
    <div class="fc-top">
      <span class="fc-badge">${dueN?'DUE NOW':'SPACED REPETITION'}</span>
      ${S.reviewStreak>0?`<span class="fc-streak">${S.reviewStreak}d ${icon("flame","icon-sm")}</span>`:''}
    </div>
    <div class="fc-title">${dueN?`${dueN} card${dueN===1?'':'s'} ready`:seenN?'All caught up':'Start your review queue'}</div>
    <div class="fc-sub">${dueN?'Recall them before the curve drops':seenN?'Next reviews are scheduled':'Active recall, scheduled by FSRS-5'}</div>
    <div class="fc-cta">${dueN?'Review now':'Begin'} ${icon('arrow-right','icon-sm')}</div>
  </button>`;

  const planPreview=planNow(20), ready=StudyPlan.readiness({pool:POOL,srs:S.srs,chStats:S.chStats,recentPerDay:recentPerDay(),examDate:S.examDate});
  const readyLine=ready.status==='no-data'?'':ready.text;
  /* Two rings: the outer is how much of the bank has been seen, the inner how much of that is remembered today. */
  const seenF=ready.total?ready.seen/ready.total:0, recallF=ready.retention==null?0:ready.retention;
  const recallPct=ready.retention==null?null:Math.round(ready.retention*100);
  const PACE={ahead:['Ahead','good'],'on-track':['On track','ok'],behind:['Behind','warn']}[ready.status];
  const daysLeft=examDaysLeft();
  const planCard=`<div class="feed-card plan-card" id="planCard" role="group" aria-label="Study plan">
    <div class="fc-glow" aria-hidden="true"></div>
    <div class="fc-top"><span class="fc-badge">${icon('clock')} STUDY PLAN</span>${PACE?`<span class="pace-pill ${PACE[1]}" id="pacePill" data-status="${ready.status}">${PACE[0]}</span>`:''}</div>
    <div class="plan-hero">
      <div class="plan-gauge" id="planGauge" role="img" aria-label="Seen ${Math.round(seenF*100)}% of the bank${recallPct==null?'':`, remembering about ${recallPct}% of it today`}">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle class="pg-track" cx="60" cy="60" r="52"/>${arc('pg-seen',60,60,52,seenF)}
          <circle class="pg-track" cx="60" cy="60" r="40"/>${arc('pg-recall',60,60,40,recallF)}
        </svg>
        <div class="pg-mid"><b>${recallPct==null?Math.round(seenF*100)+'%':recallPct+'%'}</b><span>${recallPct==null?'seen':'recall'}</span></div>
      </div>
      <div class="plan-copy">
        <div class="fc-title">I have…</div>
        <div class="fc-sub" id="planSub">${e(planPreview.text)}</div>
        <div class="pg-legend"><span class="lg-seen">Seen ${ready.seen} of ${ready.total}</span>${recallPct==null?'':`<span class="lg-recall">Recall ${recallPct}%</span>`}</div>
      </div>
    </div>
    ${readyLine?`<div class="fc-sub plan-ready" id="planReady">${e(readyLine)}</div>`:''}
    <div class="chips plan-chips">${[10,20,40].map(m=>`<button class="chip plan-chip" data-plan="${m}" data-action="startPlan" aria-label="${m} minutes">
      <svg class="mini-ring" viewBox="0 0 24 24" aria-hidden="true"><circle class="mr-track" cx="12" cy="12" r="9"/>${arc('mr-arc',12,12,9,m/40)}</svg>
      <b>${m}</b><span>min</span></button>`).join('')}</div>
    <div class="exam-tile${daysLeft!=null&&daysLeft>0?' set':''}">
      <span class="exam-ico" aria-hidden="true">${icon('calendar')}</span>
      <div class="exam-main">
        <label for="examDate">Exam date</label>
        <div class="exam-ctl"><input type="date" id="examDate" value="${S.examDate||''}" data-action="setExamDate">
          ${S.examDate?`<button class="exam-x" id="examClear" data-action="clearExamDate" aria-label="Clear the exam date" title="Clear">${icon('x')}</button>`:''}</div>
        <span class="exam-left" id="examLeft">${e(examLeftText())}</span>
      </div>
      ${daysLeft!=null&&daysLeft>0?`<div class="exam-count" aria-hidden="true"><b id="examDays">${daysLeft}</b><span>${daysLeft===1?'day':'days'}</span></div>`:''}
    </div>
  </div>`;

  const runCard=_runsShown.length?`<div class="feed-card run-card" id="runCard" role="group" aria-label="Topic runs">
    <div class="fc-top"><span class="fc-badge">${icon('layers')} TOPIC RUNS</span></div>
    <div class="fc-title">Same topic, back to back</div>
    <div class="fc-sub">Three to five questions about one thing, from what you most need.</div>
    <div class="run-list">${_runsShown.map((r,i)=>{
      const words=r.shared.slice(0,3).join(' · ');
      return `<button class="run-btn" data-run="${i}" data-ch="${e(r.ch)}" style="--ch:${CH_COLORS[r.ch]||'var(--teal)'}" data-action="startRun">
        <span class="run-ico" aria-hidden="true">${icon(CH_ICONS[r.ch]||'layers')}</span>
        <span class="run-t"><b>${e(CH_SHORT[r.ch]||r.ch)}</b>${words?`<span class="run-w"> — ${e(words)}</span>`:''}</span>
        <span class="run-side"><span class="run-pips" aria-hidden="true">${'<i></i>'.repeat(r.ids.length)}</span><span class="run-n">${r.ids.length} questions</span></span>
      </button>`;}).join('')}</div>
  </div>`:'';


  const missCard=S.missed.size>0?`<button class="feed-card miss-card" data-action="retryMissed">
    <div class="fc-top"><span class="fc-badge red">WEAK SPOTS</span></div>
    <div class="fc-title">${S.missed.size} to reclaim</div>
    <div class="fc-sub">Questions you have missed at least once</div>
    <div class="fc-cta">Drill them ${icon('arrow-right','icon-sm')}</div>
  </button>`:'';

  /* The fellow's own marks: the questions flagged to come back to, and the ones written on (src/core/flagset.js). */
  const flagN=flaggedQs().length, annoN=FlagSet.annotated(NOTES,INK,QBYID).length;
  const flagCard=flagN>0?`<div class="feed-card flag-card" id="flagCard" role="group" aria-label="Flagged questions">
    <div class="fc-top"><span class="fc-badge amber">${icon('flag')} FLAGGED</span></div>
    <div class="fc-title" id="flagCount">${e(FlagSet.phrase(flagN))}</div>
    <div class="fc-sub">The ones you marked to come back to. A flag stays until you take it off.</div>
    <button class="flag-go" id="flagGo" type="button" data-action="startFlagged">${icon('play')}<span>Go through them</span></button>
    <button class="flag-quiet${_flagArm?' arm':''}" id="flagClear" type="button" data-action="clearFlags">${_flagArm?'Tap again to clear all '+flagN:'Clear all flags'}</button>
  </div>`:'';
  const annoCard=annoN>0?`<button class="feed-card anno-card" id="annoCard" type="button" data-action="goAnnotations">
    <div class="fc-top"><span class="fc-badge amber">${icon('pencil')} ANNOTATED</span></div>
    <div class="fc-title">${annoN} question${annoN===1?'':'s'} you wrote on</div>
    <div class="fc-sub">Your sticky notes and pencil marks. Find one by what you wrote.</div>
    <div class="fc-cta">Open them ${icon('arrow-right','icon-sm')}</div>
  </button>`:'';

  const chCards=CHAPTERS.map(ch=>{
    const cnt=POOL.filter(q=>q.ch===ch).length;
    const fig=POOL.filter(q=>q.ch===ch&&q.img).length;
    const st=S.chStats[ch]||{correct:0,total:0};
    const cp=st.total>0?Math.round(st.correct/st.total*100):-1;
    const m=masteryFor(ch);
    const col=CH_COLORS[ch]||'#5EEAD4';
    return `<button class="ch-tile" data-action="startChapter" data-ch="${e(ch)}"
        style="--accent:${col};--ch-ink:${chInk(col)}">
      <span class="ct-ico">${chIcon(ch)}</span>
      <span class="ct-name">${e(ch)}</span>
      <span class="ct-meta">${cnt} Q${fig?` · ${fig} figures`:''}</span>
      <span class="ct-bar"><i style="width:0" data-w="${Math.round(m*100)}"></i></span>
      <span class="ct-foot">${cp>=0?`${cp}% correct`:m>0?'in progress':'not started'}<b>${Math.round(m*100)}%</b></span>
    </button>`;
  }).join('');

  return `<div class="home-wrap anim-fade study-wrap">
    <div class="study-head">
      <button class="study-back" data-action="goHome">${icon('arrow-left','icon-sm')} Home</button>
    </div>

    <div class="study-title">
      <h2>Chapters</h2>
      <p>${TOTAL_Q} questions across ${CHAPTERS.length} chapters, the review queue
         scheduled by FSRS-5, and the full shuffle.</p>
    </div>

    <div class="story-rail">${stories}</div>

    <div class="feed">
      ${reviewCard}
      ${planCard}
      ${runCard}
      ${missCard}
      ${flagCard}
      ${annoCard}
      <button class="feed-card all-card" data-action="startAll">
        <div class="fc-top"><span class="fc-badge">FULL BANK</span></div>
        <div class="fc-title">Shuffle all ${TOTAL_Q}</div>
        <div class="fc-sub">Every chapter, random order</div>
        <div class="fc-cta">Start ${icon('arrow-right','icon-sm')}</div>
      </button>
    </div>

    <div class="section-label">Chapters</div>
    <div class="ch-tiles">${chCards}</div>
  </div>`;
}

root.StudyScreen = { screenHtml, arc, examLeftText: examLeft };
})(typeof window !== 'undefined' ? window : this);
