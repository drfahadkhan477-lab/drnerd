/* ═════════════════════════════════════════════
   mock.js — a mock exam block: the question, the clock and pace, the flag, the grid of questions, and the
   summary before the block is handed in.

   It was buildMock() and buildMockEnd() in app/systole.html (docs/ROADMAP.md, E1 step 3). They are here as
   functions of what they are given, so what the screen says can be held without a page:

     screenHtml(S, kit)   the screen's markup, as a string: the block, paused or not, or its summary
     endHtml(S, kit)      the summary before handing in

       S           the page's state. Read, never changed: mock (the block, src/core/mockexam.js's record)
                   and mockView ('end' for the summary)
       kit         what the screen uses of the page, under the page's names:
                     MockExam                      src/core/mockexam.js, for states(), pace() and urgency()
                     mockQ()                       the question the block is on, or nothing
                     mockClockText, mockPaceText   what the clock and the pace line say of a block
                     mockCellLabel                 what a cell of the grid says to a screen reader
                     e, icon                       the page's helpers
                     window                        for how wide the screen is (a phone is not told the keys)
                   The four mock functions are the page's because the ticker and the keys use them too, to
                   repaint the clock, the pace line and the grid in place.

   The parameters carry the names the page uses for the same things, so the bodies below moved as they
   stood. tests/verify-mock-pure.js holds what follows, and the page's line that hands these over.

   WHAT THE SCREEN SAYS:

     1. With no block open, or no question: that none is open, and the way back to Sessions.
     2. Paused: the clock, stopped, and the way to resume; the question is hidden.
     3. The block: the clock (time left or elapsed), the place, the pause, the progress, how many are
        answered and flagged, and the pace; the question and its options, the chosen one pressed; back,
        flag and next ("Review and hand in" on the last); and a cell for each question, marked answered,
        flagged and current.
     4. The summary: how many answered, the time, the questions not answered and those flagged as ways
        back to each, the way back to the block, and "Hand in".

   The buttons name actions, not inline handlers (docs/ROADMAP.md, E2), which the page's ACTIONS table calls
   (src/core/actions.js): mockPrev, mockNext, mockFlag, mockPause, mockUnpause, mockEnd, mockSubmit and
   goSessions with nothing; mockPick with the option's index (data-mi) and mockGo with the question's
   (data-q, on a summary chip and on a cell), each read as a number, as the handlers were given; and mockBack,
   which goes back to the question the block is on, read when tapped, as mockGo(S.mock.i) read it. The
   functions stay the page's.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function endHtml(S, kit){
  const {MockExam,mockClockText,icon}=kit;
  const r=S.mock, st=MockExam.states(r), n=st.n;
  const chip=(c,cls)=>`<button class="mock-chip ${cls}" type="button" data-action="mockGo" data-q="${c.n-1}" aria-label="Go to question ${c.n}">${c.n}</button>`;
  const blank=st.cells.filter(c=>!c.answered), flagged=st.cells.filter(c=>c.flagged);
  const left=r.secPerQ?`<span class="mock-clock sm" id="mockClock" data-urgency="${MockExam.urgency(r)}">${mockClockText(r)}</span> left`
    :`<span class="mock-clock sm" id="mockClock" data-urgency="none">${mockClockText(r)}</span> so far`;
  return `<div class="quiz-wrap mock-wrap"><div class="mock-end">
    <h2 tabindex="-1">Hand in this block?</h2>
    <div class="mock-end-sub">${st.answered} of ${n} answered · ${left}</div>
    ${blank.length?`<div class="mock-end-sec"><b>${blank.length} not answered</b> — counted as wrong
      <div class="mock-chips">${blank.map(c=>chip(c,'')).join('')}</div></div>`:'<div class="mock-end-sec ok">Every question has an answer.</div>'}
    ${flagged.length?`<div class="mock-end-sec"><b>${flagged.length} flagged</b> — to look at again
      <div class="mock-chips">${flagged.map(c=>chip(c,'flag')).join('')}</div></div>`:''}
    <div class="actions mock-end-actions">
      <button class="btn btn-prev wide" type="button" data-action="mockBack">${icon('arrow-left','icon-sm')} Back to the block</button>
      <button class="btn btn-next" type="button" data-action="mockSubmit">Hand in ${icon('check','icon-sm')}</button>
    </div></div></div>`;
}

function screenHtml(S, kit){
  const {MockExam,IMGS,mockQ,mockClockText,mockPaceText,mockCellLabel,e,icon,window}=kit;
  /* The summary, under the name the body below calls it by. */
  const buildMockEnd=()=>endHtml(S,kit);
  const r=S.mock, q=mockQ();
  if(!r||!q) return `<div class="mock-wrap"><div class="mock-gone"><p>No block is open.</p>
    <button class="btn btn-next" type="button" data-action="goSessions">${icon('arrow-left','icon-sm')} Back to Sessions</button></div></div>`;
  if(S.mockView==='end') return buildMockEnd();
  const n=r.ids.length, st=MockExam.states(r), chosen=r.sel[r.i], lab=r.secPerQ?'left':'elapsed';
  if(r.paused) return `<div class="quiz-wrap mock-wrap"><div class="mock-paused" role="status">
      <span class="mock-pause-ic">${icon('pause')}</span><h2>Paused</h2>
      <p>The clock is stopped and the question is hidden. Nothing is scored until you hand the block in.</p>
      <div class="mock-clockbox big"><span class="mock-clock" id="mockClock" data-urgency="${MockExam.urgency(r)}">${mockClockText(r)}</span><span class="mock-clock-lab">${lab}</span></div>
      <button class="btn btn-next" type="button" data-action="mockUnpause">${icon('play','icon-sm')} Resume</button></div></div>`;
  const pace=MockExam.pace(r);
  const opts=q.o.map((o,i)=>`<button class="opt mock-opt${q.imgopt?' img-opt':''}${chosen===i?' picked':''}" type="button" data-mi="${i}"
      data-action="mockPick" aria-pressed="${chosen===i}" style="--acc:var(--teal)">
      <span class="opt-letter">${e(o.l)}</span><span class="opt-text">${e(o.t)}</span></button>`).join('');
  const cells=st.cells.map(c=>`<button class="mock-cell${c.answered?' done':''}${c.flagged?' flag':''}${c.current?' cur':''}" type="button"
      data-mc="${c.n-1}" data-action="mockGo" data-q="${c.n-1}" aria-label="${mockCellLabel(c)}"${c.current?' aria-current="true"':''}>${c.n}</button>`).join('');
  const flagged=!!r.flag[r.i], lastQ=r.i>=n-1;
  const isMobile=window.innerWidth<768;
  return `<div class="quiz-wrap mock-wrap">
    <div class="qbar mock-bar anim-slide">
      <div class="mock-top">
        <div class="mock-clockbox"><span class="mock-clock" id="mockClock" role="timer" aria-live="off" data-urgency="${MockExam.urgency(r)}">${mockClockText(r)}</span><span class="mock-clock-lab">${lab}</span></div>
        <span class="q-counter">Question ${r.i+1} of ${n}</span>
        <button class="mock-mini" type="button" data-action="mockPause" aria-label="Pause the block">${icon('pause','icon-sm')}<span>Pause</span></button>
      </div>
      <div class="prog-track"><div class="prog-fill" id="mockProg" style="transform:scaleX(${(st.answered/n).toFixed(4)})"></div></div>
      <div class="mock-subrow"><span id="mockSub">${st.answered} answered · ${st.flagged} flagged</span><span class="mock-pace" id="mockPace" data-status="${pace?pace.status:''}">${e(mockPaceText(r))}</span></div>
    </div>
    <div class="fig-pair">${q.img&&IMGS[q.id]&&IMGS[q.id].length?'<div class="reading-figs"><div class="fig-zone"></div></div>':'<div class="fig-zone"></div>'}<div class="reading-text">
    <div class="q-card anim-pop" tabindex="-1" aria-labelledby="qTag" style="border-left-color:var(--teal)">
      <div class="q-tag" id="qTag"><span class="q-tag-dot" style="color:var(--teal-ink)"></span>Question ${r.i+1}</div>
      ${e(q.s)}
      ${q.imgopt?'<div class="q-imgnote">Answer options refer to the labelled panels in the figure.</div>':''}
      ${q.flag?`<div class="notice"><span>${icon("alert")}</span><span>${e(q.flag)}</span></div>`:''}
    </div>
    <div class="opts" role="group" aria-label="Answer options">${opts}</div>
    ${isMobile?'':'<div class="kb-hint kbd-row kb-keys">Press <kbd>A</kbd>–<kbd>E</kbd> to answer · <kbd>F</kbd> to flag · <kbd>←</kbd> <kbd>→</kbd> to move</div>'}
    </div></div>
    <div class="actions mock-actions">
      <button class="btn btn-prev" type="button" data-action="mockPrev" aria-label="Previous question"${r.i===0?' disabled':''}>${icon('arrow-left','icon-sm')}</button>
      <button class="btn mock-flag${flagged?' on':''}" id="mockFlagBtn" type="button" data-action="mockFlag" aria-pressed="${flagged}">${icon('flag','icon-sm')} <span class="mock-flag-l">Flag</span></button>
      <button class="btn btn-next" type="button" data-action="mockNext">${lastQ?'Review and hand in':'Next'} ${icon('arrow-right','icon-sm')}</button>
    </div>
    <div class="mock-navcard">
      <div class="mock-navh"><span>Questions</span><button class="mock-mini" type="button" data-action="mockEnd">${icon('check','icon-sm')}<span>End block</span></button></div>
      <div class="mock-nav" role="group" aria-label="Questions in this block">${cells}</div>
      <div class="mock-key"><span><i class="k done"></i>answered</span><span><i class="k flag"></i>flagged</span><span><i class="k"></i>not answered</span></div>
    </div>
  </div>`;
}

root.MockScreen = { screenHtml, endHtml };
})(typeof window !== 'undefined' ? window : this);
