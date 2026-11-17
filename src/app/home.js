/* ═════════════════════════════════════════════
   home.js — the home screen's pages, as they leave app/systole.html one at a time (docs/ROADMAP.md, E1
   step 3). The Labs page is here, and the Brain page. The Home page itself, with the hero and the pearl,
   is still buildHome() in the page.

   They were buildLabs(), buildBrain(), buildBrainArt() with brainHash(), brainDendrites() and brainAxon(),
   and brainInfoHtml() in app/systole.html. They are here as functions of what they are given, so what
   the pages say can be held without a browser:

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

   WHAT THE BRAIN PAGE SAYS:

     1. What it is: FSRS's own estimate of what would be recalled today, chapter by chapter.
     2. The brain: a neuron for each part of each chapter, lit by how well it is remembered, with its
        legend; what the chosen neuron holds and the way to practise its chapter, or how to choose one.
     3. A gauge of how much is mastered within how much is seen; how much is seen of the bank, how many
        are due, how many were answered today and how many right, and the recall of the cards scheduled;
        and, with cards due, the way to review them.
     4. A row for each chapter: its mastery, how many of its questions are seen and due, each a way to
        practise it.

   The Labs page's buttons name goLab, goEcho, goPractice, goSessions, goStudy, openSearch, goStats, goRefs,
   goMemory and goAnnotations; the Brain page's name startQuiz, brainTap and brainKey. An inline handler is
   read where it is tapped, so those stay the page's.
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
    return `<button class="brain-ch" style="--c:${col};--ci:${chInk(col)}" onclick="startQuiz(${JSON.stringify(ch).replace(/"/g,'&quot;')})"
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
        ${dueN?`<div class="brain-actions"><button class="brain-go primary" onclick="startQuiz(null,'due')">${icon('repeat','icon-sm')} Review ${dueN} due</button></div>`:''}
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
      onclick="brainTap(event)" onkeydown="brainKey(event)">${defs}${body}<g class="brain-net" id="brainNet">${lobes}${axons}${signals}${glow}${flashes}${sparks}${cells}</g></svg>`;
}

function brainInfoHtml(kit){
  const {brainArtL,brainSel,BRAIN_STATE_LABEL,e,icon}=kit;
  const L=brainArtL&&brainArtL.L, x=L&&L.nodes[brainSel];
  if(!x) return `<span class="brain-info-hint">${icon('zap','icon-sm')} Tap a neuron: it fires, and says what it holds.</span>`;
  return `<span class="brain-info-k">This neuron</span> <b>${e(x.docId)}</b>
    <span class="brain-info-m">${e(x.title.split(' · ')[1]||'')} · ${BRAIN_STATE_LABEL[x.state]}${x.recall!=null?` · recall ${x.recall}% today`:''}</span>
    <button class="brain-go primary" onclick="startQuiz(${JSON.stringify(x.docId).replace(/"/g,'&quot;')})">${icon('play','icon-sm')} Practise this chapter</button>`;
}

root.HomeScreen = { labsHtml, brainHtml, brainArtHtml, brainInfoHtml };
})(typeof window !== 'undefined' ? window : this);
