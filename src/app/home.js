/* ═════════════════════════════════════════════
   home.js — the home screen's pages, as they leave app/systole.html one at a time (docs/ROADMAP.md, E1
   step 3). All three are here now: the Home page itself, with the hero and the pearl, the Brain page and
   the Labs page.

   They were buildHome(), buildLabs(), buildBrain(), buildBrainArt() with brainHash(), brainDendrites() and
   brainAxon(), and brainInfoHtml() in app/systole.html. They are here as functions of what they are given, so what
   the pages say can be held without a browser:

     homeHtml(S, CHAPTERS, kit)         the home screen: its three pages side by side, and the tabs
       S           read, never changed: sessionTotal, sessionCorrect, daily and homeLayout
       CHAPTERS    the bank's chapters, for how much of the bank is mastered
       kit         POOL, TOTAL_Q; the page's switches as they stand when it is drawn (atlas3D, atlasPaused,
                   atlasReading, heroCutaway, pearlAsWritten); the two heart images, each a whole <img>
                   element with the build's slot in it (ATLAS_IMG, HERO_IMG: the build fills a slot in the
                   page only, and the split build finds each image by its element); dueQuestions(),
                   startedCount(), todayISO(), masteryFor(); the pearl's pearlNow(), pearlAll(),
                   pearlFigure(), pearlEmblem() and pearlLadder(), which its handlers repaint with too;
                   showHello(); and buildBrain() and buildLabs(), the page's lines over the two pages below,
                   which draw them with what this one counted. The page sets atlasReading from pearlNow()
                   before it draws, and hands it over.

     labsHtml(S, CHAPTERS, dueN, kit)   the Labs page's markup, as a string

       S           the page's state. Read, never changed: mock (a block in progress, if any)
       CHAPTERS    the bank's chapters: how many
       dueN        how many cards are due now, as buildHome() counted them for all three pages
       kit         what the page uses of the app, under the app's names:
                     REF       the reader's notes, or undefined where the app has none
                     Memory    what Apex remembers (src/core/memory.js), or undefined where it is not loaded
                     TOTAL_Q   how many questions the bank has
                     icon      the app's helper

     brainHtml(S, CHAPTERS, CH_COLORS, dueN, seenN, covered, masteryPct, today, kit)
                                        the Brain page's markup
       S           read, never changed: srs and practice, for each chapter's cards seen and due
       CHAPTERS, CH_COLORS   the chapters, a row each, in their accents
       dueN, seenN, covered, masteryPct, today
                   what buildHome() counted for all three pages: cards due, cards started, the share
                   started, the share mastered, and today's answers ({a, c})
       kit         POOL, TOTAL_Q, avgRetention(), masteryFor(ch), todayISO(), chInk, chIcon, e, icon, and
                   the page's own buildBrainArt() and brainInfoHtml(), below, which the Brain page draws
                   in that order: the art can lay the brain out anew, and the info reads that layout.

     brainArtHtml(CH_COLORS, kit)        the brain itself, an svg, or nothing before there is one
       kit         BrainMap (src/core/brain.js, or undefined where it is not loaded), brainLayoutNow()
                   (the page's: it keeps the layout it worked out), brainSel (the neuron chosen, or -1),
                   BRAIN_TUNE, BRAIN_STATE_LABEL, e

     brainInfoHtml(kit)                  what the chosen neuron holds, or how to choose one
       kit         brainArtL (the page's kept layout), brainSel, BRAIN_STATE_LABEL, e, icon. brainPick()
                   draws it again in place when a neuron is chosen.

   The parameters carry the names the page uses for the same things, so the bodies below moved as they
   stood. tests/verify-homescreen-pure.js holds what follows, and the page's lines that hand these over.

   WHAT THE LABS PAGE SAYS:

     1. What Labs is: traces, echo views, sounds and strips.
     2. A card for each lab, each a way in: the Rhythm Lab, Echo Studio, the Practice Lab and Sessions,
        which says that a mock block is open when one is.
     3. The study tools: Chapters, saying how many chapters and how many cards are due or, with none due,
        how many questions there are; Search; Progress; Notes, saying how many references there are;
        Memory, saying how many things Apex knows; and Annotations.

   WHAT THE HOME PAGE SAYS:

     1. With no pearl to read, what the daily pearl is for and the way to the notes; with one, the pearl
        itself: what it is about, the statement as a ladder or as written, the prompt to explain it, the
        ways to recall, read, see the source and open the note, and its figure or its chapter's emblem.
     2. The living heart: the illustration and the 3D model's place, whether it is live, the way to
        switch between them, to pause, and the menu with chambers and flow, motion and the model's credit.
     3. How much of the bank is explored, answered today and due, the mastery, and the session strip.
     4. For someone new, what Chapters and Apex are.
     5. The Brain page and the Labs page beside it, and the three tabs.

   WHAT THE BRAIN PAGE SAYS:

     1. What it is: FSRS's own estimate of what would be recalled today, chapter by chapter.
     2. The brain: a neuron for each part of each chapter, lit by how well it is remembered, with its
        legend; what the chosen neuron holds and the way to practise its chapter, or how to choose one.
     3. A gauge of how much is mastered within how much is seen; how much is seen of the bank, how many
        are due, how many were answered today and how many right, and the recall of the cards scheduled;
        and, with cards due, the way to review them.
     4. A row for each chapter: its mastery, how many of its questions are seen and due, each a way to
        practise it.

   The buttons name actions, not inline handlers (docs/ROADMAP.md, E2), which the page's ACTIONS table calls
   (src/core/actions.js). The Home page's: goRefs, toggleAtlas3D, toggleAtlasMotion, toggleHeroMenu,
   toggleHeroMechanics, toggleHeroCredit, pearlNext, pearlToggleAll, pearlRecall, pearlReading, pearlSourceToggle,
   pearlOpen and dismissHello; its strip reviewAllDue, goStudy, or startPlan with 20 in data-plan; and each tab
   homeGo, with its page in data-page. The Labs page's: goLab, goEcho, goPractice, goSessions, goStudy, openSearch,
   goStats, goRefs, goMemory and goAnnotations. The Brain page's: brainTap on the brain, startDue, and startChapter
   with the chapter in data-ch through e(). A key on a tab or in the brain is the page's KEY_ACTIONS under the
   same names, homeGo and brainTap, which call homeTabKey() and brainKey(); the pager and the pearl's statement name
   homePagerScroll and pearlScroll, which SCROLL_ACTIONS calls for a scroll of that element itself. No inline handler
   is left. The functions stay the page's.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function homeHtml(S, CHAPTERS, kit){
  const {POOL,TOTAL_Q,atlas3D,atlasPaused,atlasReading,heroCutaway,heroLesion,PHYSIO_LESIONS,pearlAsWritten,ATLAS_IMG,HERO_IMG,
    dueQuestions,startedCount,todayISO,masteryFor,pearlNow,pearlAll,pearlFigure,pearlEmblem,pearlLadder,showHello,buildBrain,buildLabs,e,icon}=kit;
  const p=S.sessionTotal>0?Math.round(S.sessionCorrect/S.sessionTotal*100):0;
  /* The session strip's button: with cards due, Review them; with history and nothing due, Continue opens Chapters;
     with nothing answered yet, Start begins the 20-minute plan Study offers, because a first visit should not open
     on a menu (docs/ux-discovery, principle 1). */
  const dueN=dueQuestions().length, seenN=startedCount();

  const today=S.daily[todayISO()]||{a:0,c:0};
  const covered=TOTAL_Q?Math.min(100,Math.round(seenN/TOTAL_Q*100)):0;
  /* Mastery is FSRS's own recall estimate, summed over the whole bank — the
     same measure the chapter rings show, aggregated. So the bar and the rings
     can never tell different stories. */
  const masteryFrac=TOTAL_Q?CHAPTERS.reduce((s,ch)=>s+masteryFor(ch)*POOL.filter(q=>q.ch===ch).length,0)/TOTAL_Q:0;
  const masteryPct=Math.round(masteryFrac*100);

  return `<div class="home-pages${atlasPaused?' atlas-paused':''}" id="homePages">
    <div class="home-pager" id="homePager" data-action="homePagerScroll">
    <section class="home-page" id="homePage0" role="tabpanel" aria-labelledby="homeTab0"><div class="home-page-in">
    <div class="home-wrap anim-fade${atlasReading?' atlas-reading':''}" data-home="${S.homeLayout}">
    <section class="atlas-intro" id="atlasIntro"${atlasReading?' hidden':''} aria-labelledby="atlasTitle">
      <div class="atlas-eyebrow">${icon('sun')} <span>Daily pearl</span></div>
      <h1 id="atlasTitle">Make one <br>idea stick.</h1>
      <p class="atlas-description">Explain the mechanism in your own words.<br>Then reveal the note and compare.</p>
      <ol class="atlas-steps">
        <li><span class="atlas-step-icon">${icon('eye')}</span><span class="atlas-step-arrow">${icon('arrow-right')}</span><strong>Observe</strong><span>Study the figure<br>and prompt.</span></li>
        <li><span class="atlas-step-icon">${icon('message-circle')}</span><span class="atlas-step-arrow">${icon('arrow-right')}</span><strong>Explain</strong><span>Put it in your<br>own words.</span></li>
        <li><span class="atlas-step-icon">${icon('clipboard')}</span><strong>Recall</strong><span>Reveal the note<br>and compare.</span></li>
      </ol>
      <div class="atlas-intro-actions"><button class="atlas-primary" data-action="goRefs">Open notes${icon('arrow-right')}</button></div>
    </section>
    <div class="hero-live${atlas3D?' atlas-3d':''}">
      ${ATLAS_IMG}
      <div class="hero-orbit" aria-hidden="true"><span></span><span></span></div>
      <canvas id="heroECG" class="hero-ecg" aria-hidden="true"></canvas>
      <div class="hero-inner atlas-hero-summary">
        <div class="hero-h1">The living heart</div>


        <div class="hero-rhythm-label" id="heroRhythmLabel">&nbsp;</div>
        <div class="hero-line hero-stats-row" hidden></div>
      </div>
      <div class="hero-heart-plate" id="heroHeart" aria-hidden="true">
        <div class="h-beat">${HERO_IMG}</div>
      </div>
      <div id="heroHeart3dSlot" class="hero-heart-3d" aria-hidden="true"></div>
      <span class="hero-live-status"><i aria-hidden="true"></i> ${atlas3D?'Live cardiac cycle':'Illustrative anatomy'}</span>
      <button class="hero-mechanics${heroCutaway?' is-active':''}" id="atlasExplore" data-action="toggleAtlas3D"
        aria-label="${atlas3D?'Show heart illustration':'Explore heart in 3D'}" aria-pressed="${atlas3D}" title="${atlas3D?'Show heart illustration':'Explore heart in 3D'}">${icon('layers','icon-sm')} ${atlas3D?'Illustration':'Explore in 3D'}</button>
      <button class="atlas-pause" id="atlasLandingPause" data-action="toggleAtlasMotion" aria-label="${atlasPaused?'Play animation':'Pause animation'}">${icon(atlasPaused?'play':'pause','icon-sm')}</button>
      <button class="hero-heart-hit" id="heroHeartBtn" data-action="toggleHeroMenu" aria-label="Heart model: motion, chambers and credit"
        aria-expanded="false" aria-controls="heroMenu" title="Heart model"></button>
      <div class="hero-menu" id="heroMenu" role="group" aria-label="Heart model" hidden>
        <button class="hero-tool hero-mechanics${heroCutaway?' is-active':''}" id="heroMechanics" data-action="toggleHeroMechanics"
          aria-pressed="${heroCutaway}">${icon('layers','icon-sm')}<span>Chambers and flow</span></button>
        ${PHYSIO_LESIONS?`<label class="hero-tool hero-lesion">${icon('heart-pulse','icon-sm')}<span>Lesion</span>
          <select id="heroLesion" data-action="heroLesion">${PHYSIO_LESIONS.map(([k,label])=>
            `<option value="${e(k)}"${heroLesion===k?' selected':''}>${e(label)}</option>`).join('')}</select></label>`:''}
        <button class="hero-tool atlas-pause" id="atlasPause" data-action="toggleAtlasMotion" aria-pressed="${atlasPaused}">${icon(atlasPaused?'play':'pause','icon-sm')}<span>${atlasPaused?'Play motion':'Pause motion'}</span></button>
        <button class="hero-tool hero-credit-btn" id="heroCreditBtn" data-action="toggleHeroCredit" hidden
          aria-expanded="false" aria-controls="heroScanCredit">${icon('info','icon-sm')}<span>Model credit</span></button>
        <p class="hero-scan-credit" id="heroScanCredit" hidden></p>
      </div>
    </div>

    ${(()=>{ const p=pearlNow(); if(!p) return '';
      return `<div class="pearl-card${pearlFigure(p)?' has-fig':''}" id="pearlCard"${atlasReading?'':' hidden'}>

        <canvas id="pearlCurrent" class="pearl-current" aria-hidden="true"></canvas>
        <div class="pearl-rule"></div>
        <div class="pearl-main">
          <div class="pearl-head">

            <span class="pearl-tag">${icon('zap','icon-sm')} Pearl</span>
            <span class="pearl-cap sr-only" id="pearlCap">${e(p.chapter||'From your notes')}</span>
            <button class="pearl-next" data-action="pearlNext"
              title="Another pearl" aria-label="Another pearl"${pearlAll().length<2?' disabled':''}>${icon('rotate-ccw','icon-sm')}</button>
          </div>
          <h1 class="pearl-concept" id="pearlConcept" tabindex="-1">${e(p.concept||p.title)}</h1>

          <div class="pearl-bodywrap" id="pearlBody" role="region" aria-labelledby="pearlConcept" tabindex="0" data-action="pearlScroll">${pearlLadder(p)}</div>
          <button class="pearl-morecue" id="pearlMore" data-action="pearlToggleAll" aria-controls="pearlBody" aria-expanded="false" hidden>${icon('chevron-down','icon-sm')}<span>Show all</span></button>
          <div class="sr-only" id="pearlAnnounce" aria-live="polite" aria-atomic="true"></div>
          <div class="pearl-prompt" id="pearlPrompt" hidden>
            <span class="pearl-prompt-icon" aria-hidden="true">${icon('brain')}</span>
            <strong>Explain it in your own words.</strong>
            <span>State the key rule, then any condition or exception. Reveal it when you're ready to compare.</span>
          </div>
          <div class="pearl-actions">
            <button class="pearl-recall" id="pearlRecall" data-action="pearlRecall" aria-controls="pearlBody" aria-expanded="true">Recall</button>
            <button class="pearl-reading" id="pearlReading" data-action="pearlReading" aria-controls="pearlBody" aria-pressed="${pearlAsWritten}" title="Read the complete statement as a paragraph">${icon('book','icon-sm')} Paragraph</button>
            <button class="pearl-reading" id="pearlSourceToggle" data-action="pearlSourceToggle" aria-controls="pearlSource" aria-expanded="false">Source</button>
            <button class="pearl-open" data-action="pearlOpen" title="${e(p.source||'Your reference notes')}">Read note ${icon('arrow-right','icon-sm')}</button>
          </div>
          <div class="pearl-source" id="pearlSource" role="region" aria-label="Pearl source" hidden>${e(p.source||'Your reference notes')}</div>

        </div>
        ${pearlFigure(p)}${pearlEmblem(p)}
      </div>`; })()}

    <div class="atlas-session"><div class="observatory-progress"><div class="observatory-stats"><div><strong>${covered}<small>%</small></strong><span>Explored</span></div><div><strong>${today.a}</strong><span>Answers today</span></div><div><strong>${dueN}</strong><span>Due</span></div></div><div class="observatory-meter" role="progressbar" aria-label="Question bank explored" aria-valuemin="0" aria-valuemax="${Math.max(1,TOTAL_Q)}" aria-valuenow="${Math.min(seenN,Math.max(1,TOTAL_Q))}" aria-valuetext="${seenN} of ${TOTAL_Q} questions explored"><span style="width:${covered}%"></span></div></div><button ${dueN?'data-action="reviewAllDue"':seenN?'data-action="goStudy"':'data-action="startPlan" data-plan="20"'}${dueN||seenN?'':' aria-label="Start a 20-minute study session"'}>${dueN?'Review':seenN?'Continue':'Start'} ${icon('arrow-right','icon-sm')}</button></div>
    ${showHello()?`<div class="hello" id="homeHello">
      <span class="hello-ic">${icon('zap')}</span>
      <div class="hello-txt">
        <b>New here?</b>
        <i><b>Chapters</b> holds all ${TOTAL_Q} questions, grouped by topic.
           <b>Apex</b> — your study companion — explains any answer,
           and can read the figures with you.</i>
        <button class="hello-x" data-action="dismissHello">Got it</button>
      </div>
    </div>`:''}
    </div></div></section>
    <section class="home-page home-brain" id="homePage1" role="tabpanel" aria-labelledby="homeTab1"><div class="home-page-in">${buildBrain(dueN,seenN,covered,masteryPct,today)}</div></section>
    <section class="home-page home-labs" id="homePage2" role="tabpanel" aria-labelledby="homeTab2"><div class="home-page-in">${buildLabs(dueN)}</div></section>
    </div>
    <div class="home-tabs" role="tablist" aria-label="Home pages">
      <span class="home-tab-pill" aria-hidden="true"></span>
      <button class="home-tab" role="tab" id="homeTab0" aria-controls="homePage0" data-action="homeGo" data-page="0">${icon('home','icon-sm')}<span>Home</span></button>
      <button class="home-tab" role="tab" id="homeTab1" aria-controls="homePage1" data-action="homeGo" data-page="1">${icon('brain','icon-sm')}<span>Brain</span></button>
      <button class="home-tab" role="tab" id="homeTab2" aria-controls="homePage2" data-action="homeGo" data-page="2">${icon('activity','icon-sm')}<span>Labs</span></button>
    </div>
  </div>`;
}

function labsHtml(S, CHAPTERS, dueN, kit){
  const {REF,Memory,TOTAL_Q,icon}=kit;
  return `<header class="page-head"><span class="page-eyebrow">${icon('activity','icon-sm')} Labs</span>
      <h1 class="page-title">Hear it, see it, read it</h1>
      <p class="page-sub">Traces drawn live, echo views to explore, and sounds and strips to practise on.</p></header>
    <div class="labs-grid">
      <button class="lab-card lab-rhythm" data-action="goLab">
        <svg class="lab-art" viewBox="0 0 240 60" preserveAspectRatio="none" aria-hidden="true"><path pathLength="100" d="M0 34h46l6-3 6 3h14l5 6 6-36 6 44 5-14h16l8-6 9 6h40l6-3 6 3h14l5 6 6-36 6 44 5-14h14"/></svg>
        <span class="lab-ic" aria-hidden="true">${icon('activity')}</span>
        <span class="lab-txt"><b>Rhythm Lab</b><i>Every trace, drawn live</i></span>
        <span class="lab-go" aria-hidden="true">Open ${icon('arrow-right','icon-sm')}</span>
      </button>
      <button class="lab-card lab-echo" data-action="goEcho">
        <svg class="lab-art lab-art-echo" viewBox="0 0 240 120" aria-hidden="true"><path d="M120 6 30 114M120 6l90 108"/><path class="la-w1" d="M66 70a70 70 0 0 1 108 0"/><path class="la-w2" d="M48 92a96 96 0 0 1 144 0"/><path class="la-w3" d="M84 48a44 44 0 0 1 72 0"/></svg>
        <span class="lab-ic" aria-hidden="true">${icon('waveform')}</span>
        <span class="lab-txt"><b>Echo Studio</b><i>Views, findings and the arithmetic</i></span>
        <span class="lab-go" aria-hidden="true">Open ${icon('arrow-right','icon-sm')}</span>
      </button>
      <button class="lab-card lab-practice" data-action="goPractice">
        <span class="lab-art lab-art-beat" aria-hidden="true">${icon('heart-solid')}</span>
        <span class="lab-ic" aria-hidden="true">${icon('heart-pulse')}</span>
        <span class="lab-txt"><b>Practice Lab</b><i>Sounds, tracings, strips</i></span>
        <span class="lab-go" aria-hidden="true">Open ${icon('arrow-right','icon-sm')}</span>
      </button>
      <button class="lab-card lab-sessions" id="labSessions" data-action="goSessions">
        <span class="lab-art lab-art-beat" aria-hidden="true">${icon('alarm')}</span>
        <span class="lab-ic" aria-hidden="true">${icon('alarm')}</span>
        <span class="lab-txt"><b>Sessions</b><i>${S.mock?'A mock block is open · resume it':'Timed mock exam · voice drill'}</i></span>
        <span class="lab-go" aria-hidden="true">Open ${icon('arrow-right','icon-sm')}</span>
      </button>
    </div>
    <h3 class="page-h3">Study tools</h3>
    <div class="door-row lab-doors">
      <button class="door door-wide" data-action="goStudy">
        <span class="door-ic">${icon("book")}</span>
        <span class="door-txt"><b>Chapters</b><i>${`${CHAPTERS.length} chapters · ${dueN?`${dueN} due for review`:`${TOTAL_Q} questions`}`}</i></span>
        <span class="door-go">${icon('arrow-right','icon-sm')}</span>
      </button>
      <button class="door" data-action="openSearch"><span class="door-ic">${icon("search")}</span><span class="door-txt"><b>Search</b><i>the whole bank</i></span></button>
      <button class="door" data-action="goStats"><span class="door-ic">${icon("trending-up")}</span><span class="door-txt"><b>Progress</b><i>chapter by chapter</i></span></button>
      <button class="door" data-action="goRefs"><span class="door-ic">${icon('folder')}</span><span class="door-txt"><b>Notes</b><i>${typeof REF!=='undefined'&&REF.length?`${REF.length} references`:'your references'}</i></span></button>
      <button class="door" data-action="goMemory"><span class="door-ic">${icon('pin')}</span><span class="door-txt"><b>Memory</b><i>${typeof Memory!=='undefined'&&Memory.count()?`${Memory.count()} things Apex knows`:'what Apex knows'}</i></span></button>
      <button class="door" data-action="goAnnotations"><span class="door-ic">${icon('highlighter')}</span><span class="door-txt"><b>Annotations</b><i>flags and notes</i></span></button>
    </div>`;
}

function brainHash(t){ let x=7; for(let i=0;i<t.length;i++) x=(x*31+t.charCodeAt(i))>>>0; return x; }
/* A neuron's four branches, each forked at the tip of every other one (Memorizer's ui.js dendrites). */
function brainDendrites(n){
  const h0=brainHash(n.key); let d='';
  for(let k=0;k<4;k++){
    const a=(h0%628)/100+k*Math.PI/2+((h0>>(k+3))%60-30)/100, len=n.r*(1.5+((h0>>(k*2))%9)/10), bend=((h0>>k)%2?1:-1)*n.r*0.5;
    const sx=n.x+Math.cos(a)*n.r*0.8, sy=n.y+Math.sin(a)*n.r*0.8, ex=n.x+Math.cos(a)*(n.r+len), ey=n.y+Math.sin(a)*(n.r+len);
    const cx=(sx+ex)/2-Math.sin(a)*bend, cy=(sy+ey)/2+Math.cos(a)*bend;
    d+='M'+sx.toFixed(1)+' '+sy.toFixed(1)+'Q'+cx.toFixed(1)+' '+cy.toFixed(1)+' '+ex.toFixed(1)+' '+ey.toFixed(1);
    if(k%2===0){ const fa=a+0.6; d+='M'+ex.toFixed(1)+' '+ey.toFixed(1)+'L'+(ex+Math.cos(fa)*n.r*0.7).toFixed(1)+' '+(ey+Math.sin(fa)*n.r*0.7).toFixed(1); }
  }
  return d;
}

function brainHtml(S, CHAPTERS, CH_COLORS, dueN, seenN, covered, masteryPct, today, kit){
  const {POOL,TOTAL_Q,avgRetention,masteryFor,todayISO,chInk,chIcon,buildBrainArt,brainInfoHtml,e,icon}=kit;
  const ret=avgRetention();
  const rows=CHAPTERS.map(ch=>{
    const qs=POOL.filter(q=>q.ch===ch), m=Math.round(masteryFor(ch)*100), col=CH_COLORS[ch]||'var(--teal)';
    const seen=qs.filter(q=>S.srs[q.id]||S.practice[q.id]).length, due=qs.filter(q=>{ const c=S.srs[q.id]; return c&&c.due<=todayISO(); }).length;
    return `<button class="brain-ch" style="--c:${col};--ci:${chInk(col)}" data-action="startChapter" data-ch="${e(ch)}"
        aria-label="${e(ch)}: ${m} percent mastered, ${seen} of ${qs.length} seen${due?`, ${due} due`:''}">
      <span class="brain-ch-ic" aria-hidden="true">${chIcon(ch)}</span>
      <span class="brain-ch-main"><b>${e(ch)}</b>
        <span class="brain-bar" aria-hidden="true"><i data-w="${m}"></i></span>
        <span class="brain-ch-meta">${seen} of ${qs.length} seen${due?` · <em>${due} due</em>`:''}</span></span>
      <span class="brain-ch-pct" aria-hidden="true">${m}%</span>
    </button>`;
  }).join('');
  return `<header class="page-head"><span class="page-eyebrow">${icon('brain','icon-sm')} Your brain</span>
      <h1 class="page-title">What you remember</h1>
      <p class="page-sub">Mastery is FSRS's own estimate of what you would recall today, chapter by chapter.</p></header>
    <div class="brain-hero">
      <div class="brain-stage"><div class="brain-3d" id="brain3d"><div class="brain-tilt" id="brainTilt">${buildBrainArt()}</div></div>
        <div class="brain-legend" aria-hidden="true"><span><i data-state="solid"></i>solid</span><span><i data-state="fading"></i>fading</span><span><i data-state="weak"></i>weak</span><span><i data-state="new"></i>not seen yet</span><span class="brain-livetag"><i></i>live</span></div>
        <div class="brain-info" id="brainInfo" aria-live="polite">${brainInfoHtml()}</div>
      </div>
      <div class="brain-gauge" role="img" aria-label="${masteryPct}% mastered, ${covered}% seen">
        <svg viewBox="0 0 132 132" aria-hidden="true">
          <circle class="bg-track" cx="66" cy="66" r="58"/>
          <circle class="bg-seen" cx="66" cy="66" r="58" pathLength="100" stroke-dasharray="0 100" data-frac="${covered}" transform="rotate(-90 66 66)"/>
          <circle class="bg-track" cx="66" cy="66" r="44"/>
          <circle class="bg-mast" cx="66" cy="66" r="44" pathLength="100" stroke-dasharray="0 100" data-frac="${masteryPct}" transform="rotate(-90 66 66)"/>
        </svg>
        <div class="brain-mid">${icon('brain')}<b>${masteryPct}%</b><span>mastered</span></div>
      </div>
      <div class="brain-side">
        <div class="brain-stats">
          <span class="brain-stat bs-seen"><b>${covered}%</b><i>seen · ${seenN} of ${TOTAL_Q}</i></span>
          <span class="brain-stat bs-due"><b>${dueN}</b><i>due for review</i></span>
          <span class="brain-stat bs-today"><b>${today.a}</b><i>answered today${today.a?` · ${today.c} right`:''}</i></span>
          <span class="brain-stat bs-ret"><b>${ret==null?'—':ret+'%'}</b><i>recall, cards scheduled</i></span>
        </div>
        ${dueN?`<div class="brain-actions"><button class="brain-go primary" data-action="startDue">${icon('repeat','icon-sm')} Review ${dueN} due</button></div>`:''}
      </div>
    </div>
    <h3 class="page-h3">Chapters</h3>
    <div class="brain-chs">${rows}</div>`;
}

function brainArtHtml(CH_COLORS, kit){
  const {BrainMap,brainLayoutNow,brainSel,BRAIN_TUNE,BRAIN_STATE_LABEL,e}=kit;
  const brainAxon=(a,b,i)=>{ const c=BrainMap.axonCtrl(a,b,i); return 'M'+a.x+' '+a.y+'Q'+c.x+' '+c.y+' '+b.x+' '+b.y; };
  if(typeof BrainMap==='undefined') return '';
  const L=brainLayoutNow(), B=BrainMap.BRAIN, nodes=L.nodes;
  if(!nodes.length) return '';
  const lit=nodes.filter(x=>x.state!=='new').length;
  const grad=(id,cls)=>`<radialGradient id="${id}"><stop offset="0" class="${cls} g0"/><stop offset=".45" class="${cls} g1"/><stop offset="1" class="${cls} g2"/></radialGradient>`;
  const folds=(cls,dx)=>`<g class="${cls}" clip-path="url(#sbClip)"><g${dx?` transform="translate(${dx} ${dx})"`:''}>${B.GYRI.map(d=>`<path d="${d}"/>`).join('')}${B.SULCI.map(d=>`<path class="major" d="${d}"/>`).join('')}</g></g>`;
  const defs=`<defs>
    <radialGradient id="sbTissue" cx="42%" cy="36%" r="72%"><stop offset="0" class="bt-1"/><stop offset=".62" class="bt-2"/><stop offset="1" class="bt-3"/></radialGradient>
    <linearGradient id="sbSheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="bs-1"/><stop offset=".5" class="bs-2"/></linearGradient>
    ${grad('sbGlowSolid','gl-solid')}${grad('sbGlowFading','gl-fading')}${grad('sbGlowWeak','gl-weak')}${grad('sbGlowNew','gl-new')}${grad('sbGlowSpark','gl-spark')}
    <linearGradient id="sbGlint" x1="0" y1="0" x2="1" y2="0"><stop offset="0" class="bgl-0"/><stop offset=".5" class="bgl-1"/><stop offset="1" class="bgl-0"/></linearGradient>
    <clipPath id="sbClip"><path d="${B.cerebrum}"/></clipPath><clipPath id="sbCblClip"><path d="${B.cerebellum}"/></clipPath>
    <radialGradient id="sbShade" cx="68%" cy="88%" r="75%"><stop offset="0" class="sh-0"/><stop offset="1" class="sh-1"/></radialGradient>
    <radialGradient id="sbFloor" cx="50%" cy="50%" r="50%"><stop offset="0" class="fl-0"/><stop offset="1" class="fl-1"/></radialGradient>
    <radialGradient id="sbSoma" cx="36%" cy="30%" r="70%"><stop offset="0" class="ss-0"/><stop offset=".55" class="ss-1"/><stop offset="1" class="ss-2"/></radialGradient></defs>`;
  const glowOf=st=>'url(#sbGlow'+st.charAt(0).toUpperCase()+st.slice(1)+')';
  const body=`<g class="brain-body" aria-hidden="true">
    <ellipse class="brain-floor" cx="520" cy="652" rx="330" ry="24" fill="url(#sbFloor)"/>
    <path class="brain-stem" d="${B.stem}"/><g class="brain-stem-lines">${B.STEM_LINES.map(d=>`<path d="${d}"/>`).join('')}</g>
    <path class="brain-cbl" d="${B.cerebellum}"/><g class="brain-folia" clip-path="url(#sbCblClip)">${B.FOLIA.map(d=>`<path d="${d}"/>`).join('')}</g>
    <path class="brain-cortex" d="${B.cerebrum}" fill="url(#sbTissue)"/>
    ${folds('brain-grooves',0)}${folds('brain-gyri-lit',-2.2)}${folds('brain-sulci',0)}
    <g class="brain-fine" clip-path="url(#sbClip)">${B.FINE.map(d=>`<path d="${d}"/>`).join('')}</g>
    <path class="brain-shade" d="${B.cerebrum}" fill="url(#sbShade)"/><path class="brain-sheen" d="${B.cerebrum}" fill="url(#sbSheen)"/>
    <g clip-path="url(#sbClip)"><g transform="skewX(-20)"><rect class="brain-glint" x="-420" y="0" width="260" height="720" fill="url(#sbGlint)"/></g></g>
    <path class="brain-rim" d="${B.cerebrum}"/></g>`;
  const lobes=`<g class="brain-lobes" clip-path="url(#sbClip)" aria-hidden="true">${L.units.map(u=>{ const c=CH_COLORS[u.name]||'#38BDF8';
    return `<circle cx="${u.x}" cy="${u.y}" r="${Math.round(L.gap*(1.2+Math.sqrt(u.n)))}" fill="${c}" fill-opacity=".14"/>`; }).join('')}</g>`;
  const axons=`<g class="brain-axons" aria-hidden="true">${L.edges.map((ed,i)=>`<path d="${brainAxon(nodes[ed.a],nodes[ed.b],i)}" data-fired="${ed.lit}" data-state="${ed.state}" data-kind="${ed.kind}" data-e="${i}"/>`).join('')}</g>`;
  const signals=`<g class="brain-signals" aria-hidden="true">${L.edges.map((ed,i)=>ed.lit===2?`<path d="${brainAxon(nodes[ed.a],nodes[ed.b],i)}" data-state="${ed.state}" style="animation-delay:-${(brainHash(nodes[ed.a].key)%30)/10}s"/>`:'').join('')}</g>`;
  const glow=`<g class="brain-glow" aria-hidden="true">${nodes.map(x=>x.state==='new'?'':`<circle cx="${x.x}" cy="${x.y}" r="${(x.r*2.6).toFixed(1)}" fill="${glowOf(x.state)}" style="animation-delay:-${(brainHash(x.key)%36)/10}s"/>`).join('')}</g>`;
  const flashes=`<g class="brain-flashes" aria-hidden="true">${nodes.map((x,i)=>`<circle class="flash" data-i="${i}" cx="${x.x}" cy="${x.y}" r="${(x.r*3.4).toFixed(1)}" fill="${glowOf(x.state)}" style="opacity:0"/>`).join('')}</g>`;
  const sparkR=Math.max(18,L.gap*0.8).toFixed(1);
  const sparks=`<g class="brain-sparks" aria-hidden="true">${Array.from({length:BrainMap.liveTune(BRAIN_TUNE).MAX_SPARKS},()=>`<g class="bspark" style="display:none"><circle class="tail t1" r="4.2"/><circle class="tail t2" r="3.5"/><circle class="tail t3" r="2.8"/><circle class="tail t4" r="2.1"/><g class="head"><circle class="halo" r="${sparkR}" fill="url(#sbGlowSpark)"/><circle class="core" r="5"/></g></g>`).join('')}</g>`;
  const cells=`<g class="brain-neurons">${nodes.map((x,i)=>{ const label=`${x.title}, ${BRAIN_STATE_LABEL[x.state]}${x.recall!=null?`, recall ${x.recall}% today`:''}`;
    return `<g class="neuron${i===brainSel?' sel':''}" data-i="${i}" data-state="${x.state}" role="button" tabindex="${i===(brainSel<0?0:brainSel)?0:-1}" aria-label="${e(label)}" aria-pressed="${i===brainSel}">
      <circle class="nhit" cx="${x.x}" cy="${x.y}" r="${Math.max(x.r*1.9,L.gap*0.5).toFixed(1)}"/><path class="dendrite" d="${brainDendrites(x)}"/>
      <circle class="soma" cx="${x.x}" cy="${x.y}" r="${x.r}"/><circle class="soma-shine" cx="${x.x}" cy="${x.y}" r="${x.r}" fill="url(#sbSoma)"/>
      <circle class="nucleus" cx="${(x.x-x.r*0.25).toFixed(1)}" cy="${(x.y-x.r*0.25).toFixed(1)}" r="${(x.r*0.34).toFixed(1)}"/></g>`; }).join('')}</g>`;
  return `<svg class="brain-svg" id="brainArt" viewBox="${B.VIEW}" role="group" aria-label="Your brain: ${lit} of ${nodes.length} parts of the bank lit. Arrow keys move between them; Enter practises that chapter."
      data-action="brainTap">${defs}${body}<g class="brain-net" id="brainNet">${lobes}${axons}${signals}${glow}${flashes}${sparks}${cells}</g></svg>`;
}

function brainInfoHtml(kit){
  const {brainArtL,brainSel,BRAIN_STATE_LABEL,e,icon}=kit;
  const L=brainArtL&&brainArtL.L, x=L&&L.nodes[brainSel];
  if(!x) return `<span class="brain-info-hint">${icon('zap','icon-sm')} Tap a neuron: it fires, and says what it holds.</span>`;
  return `<span class="brain-info-k">This neuron</span> <b>${e(x.docId)}</b>
    <span class="brain-info-m">${e(x.title.split(' · ')[1]||'')} · ${BRAIN_STATE_LABEL[x.state]}${x.recall!=null?` · recall ${x.recall}% today`:''}</span>
    <button class="brain-go primary" data-action="startChapter" data-ch="${e(x.docId)}">${icon('play','icon-sm')} Practise this chapter</button>`;
}

root.HomeScreen = { homeHtml, labsHtml, brainHtml, brainArtHtml, brainInfoHtml };
})(typeof window !== 'undefined' ? window : this);
