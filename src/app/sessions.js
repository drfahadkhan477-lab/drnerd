/* ═════════════════════════════════════════════
   sessions.js — the Sessions screen: the mock exam's card, to set a timed block up or carry on the one
   in progress, and the voice session's card.

   It was buildSessions(), voiceCardHtml(), mockCard() and mockCardInner() in app/systole.html
   (docs/ROADMAP.md, E1 step 3). They are here as functions of what they are given, so what the screen
   says can be held without a page:

     screenHtml(S, CHAPTERS, kit)      the screen's markup, as a string
     mockCardHtml(S, CHAPTERS, kit)    the mock exam's card
     mockInnerHtml(S, CHAPTERS, kit)   what is inside that card: the page draws it again in place when a
                                       size, a pace or a chapter is chosen (setMockCfg())
     voiceCardHtml(kit)                the voice session's card, or nothing where the browser cannot
                                       speak and listen

       S           the page's state. Read, never changed: mock (the block in progress, if any), mocks
                   (the blocks handed in) and mockLast (the last one's report)
       CHAPTERS    the bank's chapters, for the chapter menu
       kit         what the screen uses of the page, under the page's names:
                     MockExam                 src/core/mockexam.js, for PACES, states(), remainingMs()
                                              and fmtClock()
                     _mockCfg                 what the card is set to start: n, sec and ch
                     _mockArm                 whether "discard" has been tapped once
                     _mockLost                whether a block that was open could not be carried on
                     mockSize(), mockSizes()  the size a block would be, and the sizes on offer
                     mockStartText()          what the start button says
                     voiceAvailable()         whether this browser can speak and listen
                     e, icon                  the page's helpers
                   The three mock functions and voiceAvailable() are the page's because startMock() and
                   startVoice() use them too. The three variables are handed as they stand at the moment
                   the screen is drawn: the page writes them, in setMockCfg(), startMock(), resumeMock()
                   and discardMock(), and draws again.

   The parameters carry the names the page uses for the same things, so the bodies below moved as they
   stood. tests/verify-sessions-pure.js holds what follows, and the page's lines that hand these over.

   WHAT THE SCREEN SAYS:

     1. The way back to Labs, and what Sessions is for.
     2. With a block open: that one is, how far it is (answered, time left or so far, flagged), the way
        to resume it, and the way to discard it, which asks for a second tap.
     3. With none: the sizes the pool allows with the chosen one pressed, the paces and "no limit" with
        the chosen one pressed, the chapter menu, the start button saying what it would start, that the
        clock runs only on screen, that a block was set aside if one was lost, and the last block's
        score, as the way to its report when the report kept is that block's.
     4. The voice card, where the browser can speak and listen, and nothing where it cannot.

   The buttons name goLabs, resumeMock, discardMock, setMockCfg, startMock, openMockReport and
   startVoice: an inline handler is read where it is tapped, so those stay the page's.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function mockInnerHtml(S, CHAPTERS, kit){
  const {MockExam,_mockCfg,_mockArm,_mockLost,mockSize,mockSizes,mockStartText,e,icon}=kit;
  const r=S.mock, lastH=S.mocks.length?S.mocks[S.mocks.length-1]:null;
  /* The report kept is the last block's only if it was handed in at the moment the history says: an import replaces the
     history and leaves the report, and a report that could not be written leaves the one before it. */
  const hasReport=!!(lastH&&S.mockLast&&S.mockLast.submittedAt===lastH.ts);
  const lastLine=lastH?`<button class="mock-quiet" type="button" onclick="openMockReport()"${hasReport?'':' disabled'}>Last block: ${Math.round(100*lastH.correct/lastH.n)}%${hasReport?' · see the report':''}</button>`:'';
  if(r){
    const st=MockExam.states(r), left=r.secPerQ?MockExam.fmtClock(MockExam.remainingMs(r),'down')+' left':MockExam.fmtClock(r.elapsedMs)+' so far';
    return `<div class="fc-glow" aria-hidden="true"></div>
      <div class="fc-top"><span class="fc-badge">${icon('alarm')} MOCK EXAM</span><span class="pace-pill ok">In progress</span></div>
      <div class="fc-title">A block is open</div>
      <div class="fc-sub" id="mockLive">${st.answered} of ${st.n} answered · ${left} · ${st.flagged} flagged</div>
      <button class="mock-go" id="mockResume" type="button" onclick="resumeMock()">${icon('play')}<span>Resume the block</span></button>
      <button class="mock-quiet${_mockArm?' arm':''}" id="mockDiscard" type="button" onclick="discardMock()">${_mockArm?'Tap again to discard it':'Discard this block'}</button>`;
  }
  const sizes=mockSizes();
  const chip=(k,v,on,label)=>`<button class="mock-pick${on?' on':''}" type="button" data-${k}="${v}" aria-pressed="${on}" onclick="setMockCfg('${k}','${v}')">${label}</button>`;
  return `<div class="fc-glow" aria-hidden="true"></div>
    <div class="fc-top"><span class="fc-badge">${icon('alarm')} MOCK EXAM</span></div>
    <div class="fc-title">A timed block, no feedback until you hand it in</div>
    <div class="fc-sub">Like the real thing: choose, move on, come back, find out at the end. Questions you have not met come first.</div>
    <div class="mock-row" role="group" aria-label="Questions in the block">${sizes.map(n=>chip('n',n,mockSize()===n,'<b>'+n+'</b><span>questions</span>')).join('')}</div>
    <div class="mock-row" role="group" aria-label="Time for each question">${[...MockExam.PACES,0].map(s=>chip('sec',s,_mockCfg.sec===s,s?'<b>'+s+'</b><span>sec each</span>':'<b>No</b><span>limit</span>')).join('')}</div>
    <label class="mock-chsel"><span>Chapter</span><select id="mockCh" onchange="setMockCfg('ch',this.value)">
      <option value="">All chapters</option>${CHAPTERS.map(c=>`<option value="${e(c)}"${_mockCfg.ch===c?' selected':''}>${e(c)}</option>`).join('')}</select></label>
    <button class="mock-go" id="mockStart" type="button" onclick="startMock()">${icon('alarm')}<span>${e(mockStartText())}</span></button>
    <div class="mock-note">The clock runs only while Systole is on screen. Search, Echo and Apex are off while you are in the block.</div>
    ${_mockLost?'<div class="mock-note lost">The block that was open could not be carried on, so it was set aside.</div>':''}
    ${lastLine}`;
}

function mockCardHtml(S, CHAPTERS, kit){
  const mockCardInner=()=>mockInnerHtml(S,CHAPTERS,kit);
  return `<div class="feed-card mock-card${S.mock?' live':''}" id="mockCard" role="group" aria-label="Mock exam">${mockCardInner()}</div>`;
}

function voiceHtml(kit){
  const {voiceAvailable,icon}=kit;
  return voiceAvailable()?`<div class="feed-card voice-card" id="voiceCard" role="group" aria-label="Voice session">
    <div class="fc-top"><span class="fc-badge">${icon('mic')} VOICE</span></div>
    <div class="voice-hero">
      <span class="voice-orb" aria-hidden="true"><span class="vo-ring"></span><span class="vo-ring r2"></span>${icon('mic')}</span>
      <div><div class="fc-title">Hands full? Answer out loud</div>
      <div class="fc-sub">Ten questions, read aloud. Needs the microphone.</div></div>
    </div>
    <div class="voice-wave" aria-hidden="true">${Array.from({length:28},(_,k)=>`<i style="--k:${k}"></i>`).join('')}</div>
    <div class="voice-say">Say <kbd>A</kbd>–<kbd>E</kbd> <kbd>repeat</kbd> <kbd>skip</kbd> <kbd>explain</kbd> <kbd>stop</kbd></div>
    <button class="voice-go" id="voiceStart" onclick="startVoice()">${icon('mic')}<span>Start a voice session</span></button>
  </div>`:'';
}

function screenHtml(S, CHAPTERS, kit){
  const {icon}=kit;
  const mockCard=()=>mockCardHtml(S,CHAPTERS,kit), voiceCardHtml=()=>voiceHtml(kit);
  return `<div class="sessions-page" id="sessionsPage">
    <button class="btn sb-back" type="button" onclick="goLabs()">${icon('arrow-left','icon-sm')} Labs</button>
    <header class="page-head"><span class="page-eyebrow">${icon('alarm','icon-sm')} Sessions</span>
      <h1 class="page-title">Practise under pressure</h1>
      <p class="page-sub">A timed block like the real exam, or ten questions answered out loud.</p></header>
    <div class="feed sessions-feed">${mockCard()}${voiceCardHtml()}</div></div>`;
}

root.SessionsScreen = { screenHtml, mockCardHtml, mockInnerHtml, voiceCardHtml: voiceHtml };
})(typeof window !== 'undefined' ? window : this);
