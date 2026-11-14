/* ═════════════════════════════════════════════
   results.js — the screen a finished session ends on.

   The first screen to leave app/systole.html (docs/ROADMAP.md, E1 step 3). It was buildResults() there,
   reading the page's state and the bank's chapters as globals; it is here as a function of what it is
   given, so what the screen says can be held without a page:

     screenHtml(S, CHAPTERS, CH_COLORS, kit)    the screen's markup, as a string

       S           the page's state. Read, never changed: quizTotal, quizCorrect, sessionTotal,
                   sessionCorrect, chStats ({ [chapter]: { correct, total } }), missed (a Set), mode, chapter
       CHAPTERS    the bank's chapter names, in the order the rows are shown
       CH_COLORS   a chapter's accent, by name; a chapter with none takes the teal
       kit         the page's helpers the markup uses: { e, icon, chIcon, semText }

   The parameters carry the names the page uses for the same things, so the body below moved as it
   stood. tests/verify-results-pure.js holds what follows, and the page's line that hands these over.

   WHAT THE SCREEN SAYS, each a thing a reader acts on:

     1. The score is the quiz's when a quiz was answered, and the session's when none was. Nothing
        answered is 0%, never "NaN%".
     2. 80% and over is green, a trophy and "Outstanding!"; 60% and over amber, a target and "Good
        Progress!"; under that red, a book and "Keep Studying!". The ring is drawn to the same percent.
     3. A row for every chapter that has been answered at all, in the bank's order, from the cumulative
        record and not from this session: 70% and over green, 50% and over amber, under that red. A
        chapter never answered has no row, and with no rows the heading is not shown either.
     4. A percent is written in the ink of its colour (semText), never the colour itself: the fill may be
        var(--green), the figures on the card are var(--green-ink).
     5. "session total a/b" is added only when the session's total is not the number already shown.
     6. "Retry Missed" and "Explain my misses" are offered only when something is missed, the first with
        the count. The last button restarts what was being done: due cards again, the flagged again, the
        chapter again, or the whole quiz.

   The buttons name goHome(), startQuiz() and askApexMisses(), and the restart button says S.chapter: an
   inline handler is read where it is tapped, in the page, so those four names stay the page's.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function screenHtml(S, CHAPTERS, CH_COLORS, kit){
  const {chIcon,e,icon,semText}=kit;
  const sc=S.quizTotal?S.quizCorrect:S.sessionCorrect, st=S.quizTotal||S.sessionTotal;
  const p=st>0?Math.round(sc/st*100):0;
  const col=p>=80?'var(--green)':p>=60?'var(--amber)':'var(--red)';
  const msgIcon=p>=80?'trophy':p>=60?'target':'book';
  const msg=p>=80?'Outstanding!':p>=60?'Good Progress!':'Keep Studying!';
  const r=50,circ=2*Math.PI*r;
  const svgCircle=`<svg width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="Score ${p} percent">
    <circle cx="64" cy="64" r="${r}" fill="none" stroke="var(--border)" stroke-width="10"/>
    <circle cx="64" cy="64" r="${r}" fill="none" stroke="${col}" stroke-width="10"
      stroke-dasharray="${circ}" stroke-dashoffset="${circ*(1-p/100)}" stroke-linecap="round"
      transform="rotate(-90 64 64)" style="transition:stroke-dashoffset 1.2s cubic-bezier(.16,1,.3,1)"/></svg>`;
  const rows=CHAPTERS.map(ch=>{
    const s=S.chStats[ch];
    if(!s||!s.total)return '';
    const cp=Math.round(s.correct/s.total*100);
    const cc=cp>=70?'var(--green)':cp>=50?'var(--amber)':'var(--red)';
    const bc=CH_COLORS[ch]||'var(--teal)';
    return `<div class="chp-row" style="--accent:${bc}"><span class="chp-icon">${chIcon(ch)}</span>
      <div class="chp-info"><div class="chp-name">${e(ch)}</div>
        <div class="chp-bar"><div class="chp-fill" style="transform:scaleX(${cp / 100});background:${cc}"></div></div></div>
      <div class="chp-score"><div class="chp-pct" style="color:${semText(cc)}">${cp}%</div>
        <div class="chp-count">${s.correct}/${s.total}</div></div></div>`;
  }).filter(Boolean).join('');

  const restartLabel=(S.mode==='due'?'Continue Reviewing':S.mode==='flagged'?'Flagged Again':S.chapter?'Restart Chapter':'Restart Quiz');
  const restartMode=S.mode==='due'?'due':S.mode==='missed'?'missed':S.mode==='flagged'?'flagged':'all';
  return `<div class="results-wrap anim-fade">
    <div class="score-hero">
      <div class="score-circle">${svgCircle}
        <div class="score-num"><span class="score-pct" style="color:${semText(col)}">${p}%</span>
        <span class="score-label">Score</span></div></div>
      <div class="score-msg">${icon(msgIcon,'icon-lg')} ${msg}</div>
      <div class="score-sub">${sc} correct · ${st-sc} wrong · ${st} answered${
        S.sessionTotal!==st?` · session total ${S.sessionCorrect}/${S.sessionTotal}`:''}</div>
    </div>
    ${rows?`<div class="section-label">Cumulative Chapter Performance</div><div class="ch-perf">${rows}</div>`:''}
    <div class="results-btns">
      <button class="btn btn-next" onclick="goHome()" type="button">${icon('arrow-left','icon-sm')} Back to Chapters</button>
      ${S.missed.size>0?`<button class="btn" type="button" style="background:var(--red-bg);color:var(--red-ink);border:1.5px solid var(--red-b)" onclick="startQuiz(null,'missed')">${icon('repeat','icon-sm')} Retry Missed (${S.missed.size})</button>`:''}
      ${S.missed.size>0?`<button class="btn" type="button" style="background:var(--card);border:1.5px solid var(--accent);color:var(--teal-ink)" onclick="askApexMisses()">${icon('zap','icon-sm')} Explain my misses</button>`:''}
      <button class="btn" type="button" style="background:var(--card);border:1.5px solid var(--border);color:var(--muted)"
        onclick="startQuiz(${S.mode==='due'?'null':'S.chapter'},'${restartMode}')">${restartLabel}</button>
    </div>
  </div>`;
}

root.ResultsScreen = { screenHtml };
})(typeof window !== 'undefined' ? window : this);
