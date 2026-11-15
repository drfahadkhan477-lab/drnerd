/* ═════════════════════════════════════════════
   mockreport.js — the report a mock exam block ends on.

   It was buildMockReport() in app/systole.html (docs/ROADMAP.md, E1 step 3). It is here as a function of
   what it is given, so what the report says can be held without a page:

     screenHtml(S, CH_COLORS, CH_SHORT, kit)    the screen's markup, as a string

       S           the page's state. Read, never changed: mockLast, the block last handed in (or
                   nothing), and flagged, the reader's Flagged list as it is now (a Set)
       CH_COLORS   a chapter's accent, by name; a chapter with none takes the teal
       CH_SHORT    a chapter's short name, for the slowest questions; one with none is named in full
       kit         what the markup uses of the page: { MockExam, mockLookup, chIcon, e, icon, semText }
                   MockExam is src/core/mockexam.js, for grade(), fmtClock() and reviewIds();
                   mockLookup(id) is the page's, and says a question's chapter and right answer, or
                   nothing for a question the bank no longer has

   The parameters carry the names the page uses for the same things, so the body below moved as it
   stood. tests/verify-mockreport-pure.js holds what follows, and the page's line that hands these over.

   WHAT THE REPORT SAYS, each a thing a reader acts on:

     1. With no block handed in, it says so and offers the way back to Sessions, and nothing else.
     2. The score is MockExam.grade()'s percent of the whole block: a question left blank is wrong.
        80% and over is green, a trophy and "Outstanding!"; 60% and over amber, a target and "Good
        Progress!"; under that red, a book and "Keep Studying!". The ring is drawn to the same percent.
     3. Under it: how many correct, wrong and not answered, of how many; and the time. A block that ran
        out says when; one with a limit says how much of it was used; one without says so. Then about
        how many seconds a question.
     4. How many were flagged, how many of those were not right, and how many are in the Flagged list
        now: the report is opened again after flags have been taken off.
     5. The three slowest questions, by number, chapter and time.
     6. A row for each chapter in the block, the weakest first and by name where two are level: 70% and
        over green, 50% and over amber, under that red. A percent is written in the ink of its colour
        (semText), never the colour itself.
     7. "Review the N to learn from" is offered only when something was wrong, blank or flagged, with
        the count; "Review all N" and "Back to Sessions" always.

   The buttons name mockReview() and goSessions(): an inline handler is read where it is tapped, in the
   page, so those two names stay the page's.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function screenHtml(S, CH_COLORS, CH_SHORT, kit){
  const {MockExam,mockLookup,chIcon,e,icon,semText}=kit;
  const r=S.mockLast;
  if(!r) return `<div class="mock-wrap"><div class="mock-gone"><p>No block has been handed in yet.</p>
    <button class="btn btn-next" type="button" onclick="goSessions()">${icon('arrow-left','icon-sm')} Back to Sessions</button></div></div>`;
  const g=MockExam.grade(r,mockLookup), p=g.pct;
  const col=p>=80?'var(--green)':p>=60?'var(--amber)':'var(--red)';
  const msg=p>=80?'Outstanding!':p>=60?'Good Progress!':'Keep Studying!', msgIcon=p>=80?'trophy':p>=60?'target':'book';
  const rad=50, circ=2*Math.PI*rad;
  const ring=`<svg width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="Score ${p} percent">
    <circle cx="64" cy="64" r="${rad}" fill="none" stroke="var(--border)" stroke-width="10"/>
    <circle cx="64" cy="64" r="${rad}" fill="none" stroke="${col}" stroke-width="10"
      stroke-dasharray="${circ}" stroke-dashoffset="${circ*(1-p/100)}" stroke-linecap="round"
      transform="rotate(-90 64 64)" style="transition:stroke-dashoffset 1.2s cubic-bezier(.16,1,.3,1)"/></svg>`;
  const rows=g.byCh.slice().sort((a,b)=>(a.correct/a.n)-(b.correct/b.n)||a.ch.localeCompare(b.ch)).map(c=>{
    const cp=Math.round(c.correct/c.n*100), cc=cp>=70?'var(--green)':cp>=50?'var(--amber)':'var(--red)', bc=CH_COLORS[c.ch]||'var(--teal)';
    return `<div class="chp-row mock-chrow" data-ch="${e(c.ch)}" style="--accent:${bc}"><span class="chp-icon">${chIcon(c.ch)}</span>
      <div class="chp-info"><div class="chp-name">${e(c.ch)}</div><div class="chp-bar"><div class="chp-fill" style="transform:scaleX(${cp/100});background:${cc}"></div></div></div>
      <div class="chp-score"><div class="chp-pct" style="color:${semText(cc)}">${cp}%</div><div class="chp-count">${c.correct}/${c.n}</div></div></div>`;
  }).join('');
  const used=MockExam.fmtClock(g.usedMs), lim=g.limitMs!=null?MockExam.fmtClock(g.limitMs,'down'):null;
  const timeLine=g.expired?'Time ran out at '+lim:lim?used+' of '+lim:used+', no time limit';
  const per=g.avgMs!=null?' · about '+Math.round(g.avgMs/1000)+' s a question':'';
  const slow=g.slowest.length?`<div class="mock-slow"><b>Slowest</b> ${g.slowest.map(s=>'Q'+(s.i+1)+' ('+e(CH_SHORT[s.ch]||s.ch)+', '+MockExam.fmtClock(s.ms)+')').join(' · ')}</div>`:'';
  /* Said of the list as it is now, not of the moment of hand-in: the report is opened again after flags have been taken off. */
  const kept=g.items.filter(it=>it.flagged&&S.flagged.has(it.id)).length;
  const flagLine=g.flagged?`<div class="mock-slow"><b>${g.flagged} flagged</b> — ${g.flaggedWrong} of them not right. In your Flagged list: ${kept} of ${g.flagged}.</div>`:'';
  const missed=MockExam.reviewIds(g,'missed').length;
  return `<div class="results-wrap mock-report anim-fade">
    <div class="score-hero">
      <div class="score-circle">${ring}<div class="score-num"><span class="score-pct" style="color:${semText(col)}">${p}%</span><span class="score-label">Mock block</span></div></div>
      <div class="score-msg">${icon(msgIcon,'icon-lg')} ${msg}</div>
      <div class="score-sub" id="mockSummary">${g.correct} correct · ${g.wrong} wrong · ${g.skipped} not answered · of ${g.n}</div>
      <div class="mock-timeline" id="mockTime">${e(timeLine)}${per}</div>
    </div>
    ${flagLine}${slow}
    ${rows?`<div class="section-label">This block, by chapter</div><div class="ch-perf">${rows}</div>`:''}
    <div class="results-btns">
      ${missed?`<button class="btn btn-next" type="button" onclick="mockReview('missed')">${icon('repeat','icon-sm')} Review the ${missed} to learn from</button>`:''}
      <button class="btn" type="button" style="background:var(--card);border:1.5px solid var(--border);color:var(--muted)" onclick="mockReview('all')">Review all ${g.n}</button>
      <button class="btn" type="button" style="background:var(--card);border:1.5px solid var(--border);color:var(--muted)" onclick="goSessions()">${icon('arrow-left','icon-sm')} Back to Sessions</button>
    </div>
  </div>`;
}

root.MockReportScreen = { screenHtml };
})(typeof window !== 'undefined' ? window : this);
