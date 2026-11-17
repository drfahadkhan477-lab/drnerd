/* ═════════════════════════════════════════════
   home.js — the home screen's pages, as they leave app/systole.html one at a time (docs/ROADMAP.md, E1
   step 3). The Labs page is here: the four labs, and under them the study tools. The Brain page and the
   Home page itself, with the hero and the pearl, are still buildBrain() and buildHome() in the page.

   It was buildLabs() in app/systole.html. It is here as a function of what it is given, so what the page
   says can be held without a browser:

     labsHtml(S, CHAPTERS, dueN, kit)   the Labs page's markup, as a string

       S           the page's state. Read, never changed: mock (a block in progress, if any)
       CHAPTERS    the bank's chapters: how many
       dueN        how many cards are due now, as buildHome() counted them for all three pages
       kit         what the page uses of the app, under the app's names:
                     REF       the reader's notes, or undefined where the app has none
                     Memory    what Apex remembers (src/core/memory.js), or undefined where it is not loaded
                     TOTAL_Q   how many questions the bank has
                     icon      the app's helper

   The parameters carry the names the page uses for the same things, so the body below moved as it stood.
   tests/verify-homescreen-pure.js holds what follows, and the page's line that hands these over.

   WHAT THE LABS PAGE SAYS:

     1. What Labs is: traces, echo views, sounds and strips.
     2. A card for each lab, each a way in: the Rhythm Lab, Echo Studio, the Practice Lab and Sessions,
        which says that a mock block is open when one is.
     3. The study tools: Chapters, saying how many chapters and how many cards are due or, with none due,
        how many questions there are; Search; Progress; Notes, saying how many references there are;
        Memory, saying how many things Apex knows; and Annotations.

   The buttons name goLab, goEcho, goPractice, goSessions, goStudy, openSearch, goStats, goRefs, goMemory
   and goAnnotations: an inline handler is read where it is tapped, so those stay the page's.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function labsHtml(S, CHAPTERS, dueN, kit){
  const {REF,Memory,TOTAL_Q,icon}=kit;
  return `<header class="page-head"><span class="page-eyebrow">${icon('activity','icon-sm')} Labs</span>
      <h1 class="page-title">Hear it, see it, read it</h1>
      <p class="page-sub">Traces drawn live, echo views to explore, and sounds and strips to practise on.</p></header>
    <div class="labs-grid">
      <button class="lab-card lab-rhythm" onclick="goLab()">
        <svg class="lab-art" viewBox="0 0 240 60" preserveAspectRatio="none" aria-hidden="true"><path pathLength="100" d="M0 34h46l6-3 6 3h14l5 6 6-36 6 44 5-14h16l8-6 9 6h40l6-3 6 3h14l5 6 6-36 6 44 5-14h14"/></svg>
        <span class="lab-ic" aria-hidden="true">${icon('activity')}</span>
        <span class="lab-txt"><b>Rhythm Lab</b><i>Every trace, drawn live</i></span>
        <span class="lab-go" aria-hidden="true">Open ${icon('arrow-right','icon-sm')}</span>
      </button>
      <button class="lab-card lab-echo" onclick="goEcho()">
        <svg class="lab-art lab-art-echo" viewBox="0 0 240 120" aria-hidden="true"><path d="M120 6 30 114M120 6l90 108"/><path class="la-w1" d="M66 70a70 70 0 0 1 108 0"/><path class="la-w2" d="M48 92a96 96 0 0 1 144 0"/><path class="la-w3" d="M84 48a44 44 0 0 1 72 0"/></svg>
        <span class="lab-ic" aria-hidden="true">${icon('waveform')}</span>
        <span class="lab-txt"><b>Echo Studio</b><i>Views, findings and the arithmetic</i></span>
        <span class="lab-go" aria-hidden="true">Open ${icon('arrow-right','icon-sm')}</span>
      </button>
      <button class="lab-card lab-practice" onclick="goPractice()">
        <span class="lab-art lab-art-beat" aria-hidden="true">${icon('heart-solid')}</span>
        <span class="lab-ic" aria-hidden="true">${icon('heart-pulse')}</span>
        <span class="lab-txt"><b>Practice Lab</b><i>Sounds, tracings, strips</i></span>
        <span class="lab-go" aria-hidden="true">Open ${icon('arrow-right','icon-sm')}</span>
      </button>
      <button class="lab-card lab-sessions" id="labSessions" onclick="goSessions()">
        <span class="lab-art lab-art-beat" aria-hidden="true">${icon('alarm')}</span>
        <span class="lab-ic" aria-hidden="true">${icon('alarm')}</span>
        <span class="lab-txt"><b>Sessions</b><i>${S.mock?'A mock block is open · resume it':'Timed mock exam · voice drill'}</i></span>
        <span class="lab-go" aria-hidden="true">Open ${icon('arrow-right','icon-sm')}</span>
      </button>
    </div>
    <h3 class="page-h3">Study tools</h3>
    <div class="door-row lab-doors">
      <button class="door door-wide" onclick="goStudy()">
        <span class="door-ic">${icon("book")}</span>
        <span class="door-txt"><b>Chapters</b><i>${`${CHAPTERS.length} chapters · ${dueN?`${dueN} due for review`:`${TOTAL_Q} questions`}`}</i></span>
        <span class="door-go">${icon('arrow-right','icon-sm')}</span>
      </button>
      <button class="door" onclick="openSearch()"><span class="door-ic">${icon("search")}</span><span class="door-txt"><b>Search</b><i>the whole bank</i></span></button>
      <button class="door" onclick="goStats()"><span class="door-ic">${icon("trending-up")}</span><span class="door-txt"><b>Progress</b><i>chapter by chapter</i></span></button>
      <button class="door" onclick="goRefs()"><span class="door-ic">${icon('folder')}</span><span class="door-txt"><b>Notes</b><i>${typeof REF!=='undefined'&&REF.length?`${REF.length} references`:'your references'}</i></span></button>
      <button class="door" onclick="goMemory()"><span class="door-ic">${icon('pin')}</span><span class="door-txt"><b>Memory</b><i>${typeof Memory!=='undefined'&&Memory.count()?`${Memory.count()} things Apex knows`:'what Apex knows'}</i></span></button>
      <button class="door" onclick="goAnnotations()"><span class="door-ic">${icon('highlighter')}</span><span class="door-txt"><b>Annotations</b><i>flags and notes</i></span></button>
    </div>`;
}

root.HomeScreen = { labsHtml };
})(typeof window !== 'undefined' ? window : this);
