/* ═════════════════════════════════════════════
   quiz.js — the question screen: the question, its options, the reveal after answering, how sure the reader
   was and why a miss was missed, the review ratings, and the way on.

   It was buildQuiz(), cfRowHtml() and missRowHtml() in app/systole.html (docs/ROADMAP.md, E1 step 3). They
   are here as functions of what they are given, so what the screen says can be held without a page:

     screenHtml(S, LOG, CH_COLORS, kit)   the screen's markup, as a string
     cfRowHtml(S, kit)                    "How sure?" before answering, or nothing once answered
     missRowHtml(S, LOG, kit, wasCorrect) "Why did you miss it?" after a miss, or nothing after a right answer

       S           the page's state. Read, never changed: questions, qIdx, selected, answered, answers, mode,
                   flagged, srs, resumed, quizCorrect, quizTotal
       LOG         the answers given, newest last, for why the question on screen was last missed. Read only
       CH_COLORS   a chapter's colour, by name; a chapter with none takes the teal
       kit         what the screen uses of the page, under the page's names:
                     BANK                        the bank's name, for what is said of its commentary
                     RATINGS                     the four review ratings: key, label, grade, colour
                     Calib                       src/core/calib.js, for the confidence bands and miss reasons
                     hasPeers, hasMarkup         whether a question has peer statistics, and marks of the reader's
                     fmtInterval, fsrsPreview    when a card would come back after each rating
                     chInk, e, icon              the page's helpers
                     window                      for how wide the screen is (a phone is told to tap)

   The parameters carry the names the page uses for the same things, so the bodies below moved as they
   stood. tests/verify-quiz-pure.js holds what follows, and the page's line that hands these over.

   WHAT THE SCREEN SAYS, each a thing a reader acts on:

     1. Where the reader is: the chapter, the question's place in the session, a way to start over when
        the session was resumed, and the score so far.
     2. The question, its options, and whether it is flagged or written on.
     3. Before answering: how sure the reader is, and the keys or a tap to answer.
     4. After answering: which option was right and which was chosen, the commentary, peer statistics where
        the bank has them, and why a miss was missed.
     5. In a review session, before rating: the four ratings, each with when the card would come back.
        Otherwise: home, back, flag, and next (or skip).

   The buttons name toggleFlag, rateReview, prevQ, nextQ, goHome, restartQuiz, setConfidence,
   setMissReason and askApexWhy, and an option is answered by the page's listener on [data-idx]: an inline
   handler is read where it is tapped, so those stay the page's.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function cfRow(S,kit){
  const {Calib,e}=kit;
  if(S.answered) return "";
  const a=S.answers[S.qIdx];
  const chips=Calib.BANDS.map(function(b){
    const on = a && a.cf===b.id;
    return '<button class="cf-chip'+(on?" on":"")+'" type="button" data-cf="'+b.id+'"'
      + ' aria-pressed="'+(on?"true":"false")+'" onclick="setConfidence('+b.id+')">'
      + e(b.label) + '</button>';
  }).join("");
  return '<div class="cf-row" role="group" aria-label="How sure are you, before answering?">'
    + '<span class="cf-lab">How sure?</span>' + chips + '</div>';
}

function missRow(S,LOG,kit,wasCorrect){
  const {Calib,e,icon}=kit;
  if(wasCorrect) return "";
  const q=S.questions[S.qIdx];
  let why=null;
  if(q) for(let i=LOG.length-1;i>=0;i--){ if(LOG[i].q===q.id){ why=LOG[i].why; break; } }
  const chips=Calib.REASONS.map(function(r){
    const on = why===r.id;
    return '<button class="miss-chip'+(on?" on":"")+'" type="button" data-why="'+r.id+'"'
      + ' aria-pressed="'+(on?"true":"false")+'" onclick="setMissReason(\''+r.id+'\')">'
      + e(r.label) + '</button>';
  }).join("");
  return '<div class="miss-row" role="group" aria-label="Why did you miss it?">'
    + '<span class="miss-lab">Why did you miss it?</span>' + chips
    + '<button class="miss-ask" type="button" onclick="askApexWhy()">' + icon('zap','icon-sm') + ' Ask Apex why</button></div>';
}

function screenHtml(S, LOG, CH_COLORS, kit){
  const {BANK,RATINGS,hasPeers,hasMarkup,fmtInterval,fsrsPreview,chInk,e,icon,window}=kit;
  /* The two rows, under the names the body below calls them by. */
  const cfRowHtml=()=>cfRow(S,kit), missRowHtml=wasCorrect=>missRow(S,LOG,kit,wasCorrect);
  const {questions,qIdx,selected,answered}=S;
  const ansHere=S.answers[qIdx];
  const alreadyRated=S.mode==='due'&&!!(ansHere&&ansHere.rated);
  const canGoBack=qIdx>0;
  if(!questions.length)return '<div style="padding:60px;text-align:center;color:var(--muted)">No questions found.</div>';
  const q=questions[qIdx];
  const prog=(qIdx+1)/questions.length*100;
  const chColor=CH_COLORS[q.ch]||'var(--teal)';
  const figHtml='<div class="fig-zone"></div>';

  const opts=q.o.map((o,i)=>{
    let cls='opt'+(q.imgopt?' img-opt':'');
    let pctEl='';
    if(answered){
      if(i===q.ci)cls+=' correct';
      else if(i===selected)cls+=' wrong';
      const col=i===q.ci?'var(--green-ink)':(i===selected?'var(--red-ink)':'var(--muted)');
      if(typeof o.p==='number') pctEl=`<span class="opt-pct" style="color:${col}">${o.p}%</span>`;
    }
    return `<button class="${cls}" ${answered?'disabled':''} data-idx="${i}" type="button"
      aria-pressed="${answered&&i===selected}" style="--acc:${chColor}">
      <span class="opt-letter">${o.l}</span>
      <span class="opt-text">${e(o.t)}</span>${pctEl}</button>`;
  }).join('');

  let revealHtml='';
  if(answered){
    const ok=selected===q.ci;
    const corr=q.o[q.ci];
    const short=corr.t.length>58?e(corr.t.slice(0,58))+'…':e(corr.t);
    const distRows=q.o.map((o,i)=>{
      let rowCls='dist-row';
      if(i===q.ci)rowCls+=' correct-row'; else if(i===selected)rowCls+=' wrong-row';
      return `<div class="${rowCls}"><span class="dist-letter">${o.l}</span>
        <div class="dist-bar-wrap"><div class="dist-bar" style="clip-path:inset(0 ${(100 - Math.max(o.p, 0.6)).toFixed(2)}% 0 0 round 5px)"></div>
        <span class="dist-pct">${o.p}%</span></div></div>`;
    }).join('');
    revealHtml=`<div class="reveal-card">
      <div class="reveal-header ${ok?'ok':'bad'}" tabindex="-1">
        <span class="reveal-icon">${ok?icon("check-circle"):icon("x-circle")}</span>
        <div><div class="reveal-verdict">${ok?'Correct!':'Incorrect — Answer: '+corr.l}</div>
          <div class="reveal-sub">${ok?(typeof corr.p==='number'?corr.p+'% of candidates answered correctly':''):'Correct: '+short}</div></div>
      </div>
      <div class="reveal-body">
        <div class="exp-text">${e(q.ex).replace(/\n+/g,'<br><br>')}</div>
        ${q.tr?`<div class="exp-trunc">${icon("alert","icon-sm")} The ${e(BANK.name)} text export truncated this commentary. Open the item in ${e(BANK.name)} for the complete discussion.</div>`:''}
        ${q.src?`<div class="exp-trunc" style="color:var(--green-ink);font-style:normal">${icon('check','icon-sm')} Question, answer key, peer statistics and full commentary verified against the ${e(BANK.name)} source export.</div>`:''}
        ${hasPeers(q)?`<div class="dist-title">Answer Distribution</div>${distRows}`:''}${missRowHtml(ok)}
      </div></div>`;
  }

  const isMobile=window.innerWidth<768;
  const letters=q.o.map(o=>`<kbd>${o.l}</kbd>`).join('');
  const kbHint=!answered
    ?`<div class="kb-hint kbd-row">${isMobile?'Tap to answer':`Press ${letters} to answer · <kbd>←</kbd> <kbd>→</kbd> to move · <kbd>F</kbd> to flag`}</div>`
    :`<div class="kb-hint">${isMobile?'Tap Next to continue':'Press <kbd>Enter</kbd> or <kbd>Space</kbd> for next · <kbd>F</kbd> to flag'}</div>`;

  /* The flag is a toggle: its name stays "Flag" and aria-pressed says whether it is on, as the mock block's does. */
  const flagOn=S.flagged.has(q.id);
  const flagBtn=`<button class="btn btn-flag${flagOn?' on':''}" id="qFlag" type="button" onclick="toggleFlag()" aria-pressed="${flagOn}"
    title="Flag this question to come back to it (F)">${icon('flag','icon-sm')}<span class="btn-flag-l">Flag</span></button>`;
  const reviewing = answered && S.mode==='due' && !alreadyRated;
  /* A review session's action row is empty until the card is rated, and rating moves on: the Flag button is in the prompt,
     where "right, but I do not trust it" is felt. */
  const rateRow = reviewing ? `<div class="rate-prompt anim-pop">
      <div class="rate-q">How well did you know this — before you saw the options?</div>
      <div class="rate-row">${RATINGS.map(([key,label,grade,col])=>
        `<button class="rate-btn" style="--rc:${col}" onclick="rateReview(${grade})">
           <span class="rate-label">${label}</span>
           <span class="rate-sched">${fmtInterval(fsrsPreview(S.srs[q.id],grade).ivl)}</span>
         </button>`).join('')}</div>
      <div class="rate-flag">${flagBtn}</div>
    </div>` : '';
  const prevBtn=canGoBack?`<button class="btn btn-prev" onclick="prevQ()" type="button" aria-label="Previous question">${icon('arrow-left','icon-sm')}</button>`:'';
  const actions = reviewing ? '' : answered
    ?`<button class="btn btn-home" onclick="goHome()" type="button" aria-label="Home">${icon('home')}</button>${prevBtn}${flagBtn}
      <button class="btn btn-next anim-pop" onclick="nextQ()" type="button">${qIdx<questions.length-1?'Next Question':'View Results'} ${icon('arrow-right','icon-sm')}</button>`
    :`<button class="btn btn-home" onclick="goHome()" type="button" aria-label="Home">${icon('home')}</button>${prevBtn}${flagBtn}
      <button class="btn btn-skip" onclick="nextQ()" type="button">Skip ${icon('arrow-right','icon-sm')}</button>`;

  return `<div class="quiz-wrap">
    <div class="qbar anim-slide">
      <div class="qbar-top">
        <span class="ch-badge" style="background:${chColor}22;color:${chInk(chColor)}">${e(q.ch)}</span>
        <span class="q-counter">${qIdx+1} of ${questions.length}<span class="sr-only"> in this session</span></span>
        ${S.resumed?`<button class="q-restart" type="button" onclick="restartQuiz()"
          title="Deal this chapter again from the beginning">Resumed · start over</button>`:''}
      </div>
      <div class="prog-track"><div class="prog-fill" style="transform:scaleX(${(prog / 100).toFixed(4)})"></div></div>
      <div class="qstats">${S.quizTotal?`This quiz: ${S.quizCorrect}/${S.quizTotal} (${Math.round(S.quizCorrect/S.quizTotal*100)}%)`:''}</div>
    </div>
    <div class="reading-columns"><div class="reading-question">${figHtml}
    <div class="q-card anim-pop" tabindex="-1" aria-labelledby="qTag" style="border-left-color:${chColor}">
      <div class="q-tag" id="qTag"><span class="q-tag-dot" style="color:${chColor}"></span>Question ${q.n} · ${e(q.ch)}
        <span class="src-badge flag-badge" id="qFlagBadge"${flagOn?'':' hidden'}>${icon('flag','icon-sm')} flagged</span>
        ${typeof hasMarkup==='function'&&hasMarkup(q.id)?`<span class="src-badge" style="color:var(--amber-ink);background:var(--amber-bg);border-color:var(--amber-b)">${icon('pencil','icon-sm')} annotated</span>`:''}</div>
      ${e(q.s)}
      ${q.imgopt?'<div class="q-imgnote">Answer options refer to the labelled panels in the figure above.</div>':''}
      ${q.flag?`<div class="notice"><span>${icon("alert")}</span><span>${e(q.flag)}</span></div>`:''}
    </div>
    ${cfRowHtml()}
    <div class="opts">${opts}</div>
    ${kbHint}</div>
    <div class="reading-explanation">${revealHtml}</div></div>
    ${rateRow}
    <div class="actions">${actions}</div>
  </div>`;
}

root.QuizScreen = { screenHtml, cfRowHtml: cfRow, missRowHtml: missRow };
})(typeof window !== 'undefined' ? window : this);
