/* ═════════════════════════════════════════════
   rhythmlab.js — the Rhythm Lab screen: a live trace of the chosen rhythm, the cardiac cycle, and a 12-lead.

   It was buildLab(), buildPhysio() and buildTwelveLead() in app/systole.html (docs/ROADMAP.md, E1 step 3).
   They are here as functions of what they are given, so what the screen says can be held without a page:

     screenHtml(p)    the whole screen: the monitor and its chips, then the two panels below
     physioHtml(p)    the cardiac cycle panel
     twelveHtml(p)    the 12-lead panel

   p is what the page has, under the page's own names for it, so the three bodies moved as they stood:

       RHYTHMS, RHYTHM_KEYS    the rhythms the lab can show, and their order on the chips
       labKind                 the rhythm that is chosen
       PHYSIO_VIEWS, PHYSIO_SPEEDS, physioView, physioSlow, physioIv
                               the cycle's views and speeds, and which view, speed and intervention are chosen
       PHYSIO_LESIONS, physioLesion
                               the lesions the Wiggers view can draw (docs/ROADMAP.md, S8), and the one chosen
       physioIsPlaying         the page's function that says whether the cycle is playing. It is called, not
                               read: on its first call the page decides from the device's Reduce Motion setting
       Physio                  src/core/physio.js, for the interventions of the PV loop; used in that view only
       LEAD12_MAP, twelveLead  which rhythms have a 12-lead of their own, and the lead that is selected
       leadCardHtml            the page's card for a lead, which the page also redraws when a lead is tapped
       e, icon                 the page's helpers

   Nothing here is changed, and nothing is drawn: this is markup with three empty canvases in it. The
   page's mountLab() draws into them after the screen is in the document, and keeps what is chosen.

   WHAT THE SCREEN SAYS:

     1. The monitor names the chosen rhythm and its rate, or a dash for a rhythm with no rate, and
        describes it. A chip for every rhythm, in RHYTHM_KEYS' order, the chosen one marked.
     2. The cycle panel is headed with the chosen view's name, and falls back to the first view when what
        is stored names none. Play or Pause says what a tap would do. One speed and one view are marked.
        The lesions are offered in every view but Curves and Conduction, whose figures no lesion changes, the chosen one
        marked; the interventions in the PV loop on the normal heart alone, since each changes physio.js's
        loop and a lesion's is the engine's.
     3. The 12-lead panel has a canvas only for a rhythm that has a modelled 12-lead. Any other rhythm gets
        a note that says why: a normal trace under an abnormal name teaches the wrong pattern.
     4. Every panel says it is a model and not a recording.

   The rhythm chips and the Home button carry no inline handler (docs/ROADMAP.md, E2): each names an
   action, setLab with the rhythm's key in data-kind, or goHome, which the page's one delegated listener
   (src/core/actions.js) finds in its ACTIONS table and calls. goHome() is the page's, and setLab() its one line
   into setKind() below; mountPhysio() still gives the cycle's chips their listeners by their data-physio-*
   attributes, each a call into the handlers below.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function physioHtml(p){
  const {PHYSIO_VIEWS,PHYSIO_SPEEDS,PHYSIO_LESIONS,physioView,physioSlow,physioIv,physioLesion,physioIsPlaying,Physio,e}=p;
  const v=PHYSIO_VIEWS.find(x=>x[0]===physioView)||PHYSIO_VIEWS[0];
  return `<div class="panel physio-panel">
    <div class="panel-h"><span>Cardiac cycle · ${e(v[1])}</span>
      <span class="physio-phase" id="physioPhase">&nbsp;</span></div>
    <div class="physio-chips speed-chips"><button class="chip mini" data-physio-play
        title="${physioIsPlaying()?'Pause the cycle':'Play the cycle'}">${physioIsPlaying()?'Pause':'Play'}</button><span class="speed-lbl">speed</span>${
      PHYSIO_SPEEDS.map(([n,label])=>
        `<button class="chip mini${physioSlow===n?' hot':''}" data-physio-slow="${n}"
           title="${n===1?'Real time':'\u0024{label} of real time'}">${e(label)}</button>`).join('')}</div>
    <div class="physio-chips">${PHYSIO_VIEWS.map(([k,label])=>
      `<button class="chip${physioView===k?' hot':''}" data-physio-view="${k}">${e(label)}</button>`).join('')}</div>
    ${(v[0]==='wiggers'||v[0]==='pv'||v[0]==='flow'||v[0]==='right'||v[0]==='coronary')&&PHYSIO_LESIONS?`<div class="physio-chips lesion-chips">${PHYSIO_LESIONS.map(([k,label])=>
      `<button class="chip mini${physioLesion===k?' hot':''}" data-physio-lesion="${k}">${e(label)}</button>`).join('')}</div>`:''}
    <div class="physio-stage"><canvas id="physioCanvas" aria-label="Cardiac cycle diagram"></canvas></div>
    ${physioView==='pv'&&(physioLesion||'normal')==='normal'?`<div class="physio-chips iv-chips">${Physio.INTERVENTIONS.map(iv=>
      `<button class="chip${physioIv===iv.id?' hot':''}" data-physio-iv="${iv.id}">${e(iv.label)}</button>`).join('')}</div>`:''}
    <div class="physio-note" id="physioNote"></div>
    <div class="ref-hint physio-model" id="physioModel">A teaching model: every curve is computed from
      textbook resting values, not recorded from a patient. Use it to understand the cycle, not to
      measure or interpret one.</div>
  </div>`;
}

function twelveHtml(p){
  const {LEAD12_MAP,RHYTHMS,labKind,twelveLead,leadCardHtml,e}=p;
  const modelled=!!LEAD12_MAP[labKind];
  return `<div class="panel twelve-panel">
    <div class="panel-h">12-lead · ${e(RHYTHMS[labKind].name)}</div>
    ${modelled?`
      <div class="twelve-stage"><canvas id="twelveCanvas" aria-label="12-lead electrocardiogram"></canvas></div>
      <div class="twelve-hint">25 mm/s · 10 mm/mV · tap any lead to see what it looks at</div>
      <div class="lead-card" id="leadCard">${leadCardHtml(twelveLead)}</div>`
    :`<div class="twelve-none">A distinct 12-lead is modelled for sinus, bradycardia, tachycardia,
        atrial fibrillation, flutter, RBBB, LBBB, anterior STEMI, pericarditis, hyperkalaemia and long QT.
        <b>${e(RHYTHMS[labKind].name)}</b> is shown on the single-lead trace above — drawing it here would mean
        showing normal morphology under an abnormal name, which teaches the wrong pattern.</div>`}
  </div>`;
}

function screenHtml(p){
  const {RHYTHMS,RHYTHM_KEYS,labKind,e,icon}=p;
  /* The two panels, under the names the body below calls them by. */
  const buildPhysio=()=>physioHtml(p), buildTwelveLead=()=>twelveHtml(p);
  const r=RHYTHMS[labKind];
  return `<div class="home-wrap anim-fade">
    <div class="stats-head">
      <div>
        <div class="stats-title">Rhythm Lab</div>
        <div class="stats-sub">Live waveforms — tap a rhythm to morph the trace</div>
      </div>
      <button class="btn sb-back" data-action="goHome">${icon('arrow-left','icon-sm')} Home</button>
    </div>
    <nav class="lab-sections" aria-label="Rhythm Lab sections">
      <a href="#labRhythm">Rhythm</a><a href="#labLoop">Loop</a>
    </nav>
    <section id="labRhythm" aria-labelledby="labRhythmHeading">
    <h2 class="lab-section-heading" id="labRhythmHeading">Rhythm</h2>
    <div class="lab-monitor">
      <canvas id="labCanvas" aria-label="Live electrocardiogram trace"></canvas>
      <div class="lab-readout">
        <span class="lab-name">${e(r.name)}</span>
        <span class="lab-hr">${r.hr?r.hr+' bpm':'—'}</span>
      </div>
    </div>
    <div class="lab-desc">${e(r.desc)}</div>
    <div class="chips lab-chips">${RHYTHM_KEYS.map(k=>
      `<button class="chip${k===labKind?' hot':''}" data-action="setLab" data-kind="${k}">${e(RHYTHMS[k].name)}</button>`).join('')}</div>
    <div class="ref-hint" style="margin-top:12px">Traces are generated from waveform models, not recordings —
      shapes are schematic and meant for pattern recognition, not measurement.</div>
    ${buildTwelveLead()}
    </section>
    <section id="labLoop" aria-labelledby="labLoopHeading">
    <h2 class="lab-section-heading" id="labLoopHeading">Loop</h2>
    ${buildPhysio()}
    </section>
  </div>`;
}

/* ── a lead's card ──
   It was the page's leadCardHtml(), which keeps its name as one line handing over Leads12 and e: the 12-lead screen
   draws it for the lead selected, and mountTwelve() draws it again when a lead is tapped. Nothing without Leads12, a
   prompt to tap one before a lead is chosen, and nothing for an id Leads12 does not have. */
function leadCardHtml(id,kit){
  const {Leads12,e}=kit;
  if(!Leads12) return '';
  if(!id) return `<div class="lead-empty">Tap a lead above.</div>`;
  const L=Leads12.LEADS.find(l=>l.id===id); if(!L) return '';
  return `<div class="lead-head"><span class="lead-id">${e(L.id)}</span>
      <span class="lead-terr">${e(L.territory)}</span>
      <span class="lead-art">${e(L.artery)}</span></div>
    <div class="lead-sees">${e(L.sees)}</div>
    <div class="lead-look">${e(L.look)}</div>`;
}

/* ── the lab's state ──
   What the Rhythm Lab chooses and holds, as one object the page keeps (its old names are views of these fields):

     mon        the monitor drawing the chosen rhythm, or null       (labMon)
     kind       the chosen rhythm's key, 'sinus' to begin            (labKind)
     physio     the cardiac cycle's diagram, or null                 (physio)
     view       the cycle's view: the saved one, if it is one of VIEWS, else 'wiggers'   (physioView)
     iv         the PV loop's intervention, 'base' to begin          (physioIv)
     canvas     the canvas the diagram was mounted on                (physioCanvasEl)
     lesion     the saved lesion, if it is one of LESIONS, else 'normal'                 (physioLesion)
     slow       the saved slowing as a number, or 2 (half speed) where there is none     (physioSlow)
     playing    null until the screen first asks, then whether the cycle plays           (physioPlaying)
     twelve     the 12-lead's diagram, or null                       (twelve)
     lead       the lead selected on it, or null                     (twelveLead)
     noteAt, notePhase   the caption's last paint and the phase it showed                (__physioNoteAt, __physioNotePhase)

   store is read with getItem, and a store that throws, or holds nothing, gives the defaults. */
function state(store, VIEWS, LESIONS){
  const read=k=>{ try{ return store.getItem(k); }catch(_){ return null; } };
  const v=read('accsap12.physioview'), l=read('accsap12.physiolesion');
  return { mon:null, kind:'sinus', physio:null,
    view:VIEWS.some(x=>x[0]===v)?v:'wiggers', iv:'base', canvas:null,
    lesion:LESIONS.some(x=>x[0]===l)?l:'normal',
    slow:+read('accsap12.physioslow')||2,
    playing:null, twelve:null, lead:null, noteAt:0, notePhase:'' };
}

/* ── the cycle panel's caption ──
   It was the page's physioNoteHtml(), which keeps its name as one line handing over what this reads: the view, the
   lesion and the intervention chosen, Physio, the lesions and their notes (PHYSIO_LESION_NOTE stays the page's, where
   tests/verify-circulation-pure.js holds each note's valve area to the circulation presets), e, and two functions it
   asks only where it needs them: cycle() (the diagram's beat, in the PV loop) and phase() (the phase now, in Wiggers).

     noteHtml({view, lesion, iv, cycle, phase, Physio, LESIONS, NOTES, e})   the caption's markup, as a string */
function noteHtml(o){
  const {view,lesion,iv,cycle,phase,Physio,LESIONS,NOTES,e}=o;
  if(view==='pv'&&lesion!=='normal'&&NOTES[lesion])
    return `<b>${e(LESIONS.find(x=>x[0]===lesion)[1])}.</b> ${e(NOTES[lesion])} The dashed loop is the normal heart's. Computed by the circulation model.`;
  if(view==='pv'){
    const it=Physio.INTERVENTIONS.find(x=>x.id===iv)||Physio.INTERVENTIONS[0];
    const y=cycle();
    /* Drawn by the engine: the resting loop's figures are the engine's own, not physio.js's. */
    if(y&&y.loop){
      const l=y.loop, note=it.id==='base'?`Ees ${l.ees.toFixed(1)} mmHg/mL, Ea ${l.ea.toFixed(2)}, EDV ${l.edv.toFixed(0)} mL. Everything else is measured off this.`:it.note;
      return `<b>${e(it.label)}</b> ${e(note)} Computed by the circulation model.`;
    }
    return `<b>${e(it.label)}</b> ${e(it.note)}`;
  }
  if(view==='curves')
    return `<b>Two curves, one intersection.</b> Cardiac output is not set by the heart alone —
      it is set where what the heart can pump meets what the circulation returns. That is why an
      inotrope moves it so little, and why volume moves it so much in a failing ventricle.`;
  if(view==='flow'&&lesion!=='normal'&&NOTES[lesion])
    return `<b>${e(LESIONS.find(x=>x[0]===lesion)[1])}.</b> ${e(NOTES[lesion])} Flow below the line runs back through a leaking valve. Computed by the circulation model.`;
  if(view==='flow')
    return `<b>Flow follows the gradient.</b> The left coronary bed is squeezed shut by the muscle
      around it during systole and fills in diastole; the right is perfused throughout, because RV
      cavity pressure never rises far. Shorten diastole and you starve the left side first.`;
  if(view==='right'&&lesion!=='normal'&&NOTES[lesion])
    return `<b>${e(LESIONS.find(x=>x[0]===lesion)[1])}.</b> ${e(NOTES[lesion])} The splits are measured where the pressures cross. Computed by the circulation model.`;
  if(view==='right')
    return `<b>Same cycle, quarter the pressure, different timing.</b> The right ventricle has
      about 10 mmHg to overcome instead of 80, so it opens earlier and shuts later — which is the
      physiological splitting of the second heart sound, not a separate phenomenon to memorise.`;
  if(view==='conduction')
    return `<b>The pause is the point.</b> SA to atria is fast — that is the P wave. Atria to
      ventricle is not: the AV node deliberately slows conduction so the atria finish emptying
      into the ventricles before they contract, which is what the isoelectric PR segment actually
      is. Lose that delay (WPW's accessory pathway) and you lose the coordination it buys.`;
  if(view==='coronary'&&lesion!=='normal'&&NOTES[lesion])
    return `<b>${e(LESIONS.find(x=>x[0]===lesion)[1])}.</b> ${e(NOTES[lesion])} The glow is on a scale that holds the normal heart's peak, so a starved bed reads dimmer. Computed by the circulation model.`;
  if(view==='coronary')
    return `<b>The left ventricle squeezes its own arteries.</b> Intramyocardial pressure in
      systole compresses the left coronary bed, so most left coronary flow arrives in diastole — and
      the subendocardium, where that compression is greatest, is where ischaemia shows first. The
      right coronary keeps flowing through systole because RV pressure stays low. Tachycardia
      shortens diastole, and with it the left ventricle's perfusion time.`;
  const ph=phase();
  const lesionNote=lesion!=='normal'&&NOTES[lesion];
  return `<b>${e(ph.name)}.</b> ${e(ph.blurb)}`+(lesionNote?`<br><b>${e(LESIONS.find(x=>x[0]===lesion)[1])}.</b> ${e(lesionNote)} Computed by the circulation model.`:'');
}

/* ── the lab's handlers ──
   They were the page's setLab(), setPhysioSlow(), physioIsPlaying(), setPhysioPlaying() and the three taps
   mountPhysio() wrote inline (a lesion, a view, an intervention); the page keeps the four names as one line each, and
   mountPhysio() hands each tap its button. st is the page's LAB (state() above); env what they use of the page:

     env.doc.querySelectorAll(q)     the page's buttons, to mark the chosen one
     env.store.setItem(k, v)          where a choice is remembered; a store that refuses is let be
     env.reducedMotion()             whether the device asks for less motion
     env.RHYTHMS                     the rhythms, for a rhythm's rate
     env.render(), env.applyLesion(), env.paintNote()   the screen drawn again, the lesion handed to the diagram, the
                                                         caption painted

     isPlaying(st, env)              whether the cycle plays: decided the first time it is asked, by the device (paused
                                     with Reduce Motion on), then kept
     setPlaying(st, on, env)         plays or pauses it, and says so on the Play chip
     setSlow(st, n, env)             the speed: kept, remembered, handed to the diagram, its chip marked
     setKind(st, k, env)             the rhythm: kept, its rate handed to the diagram (68 where it has none), the screen
                                     drawn again; a lead selected stays selected
     chooseLesion(st, btn, env)      the lesion btn names: kept and remembered; in the PV loop the screen is drawn again
                                     (the interventions come and go with Normal), elsewhere the diagram is handed it,
                                     its chip marked and the caption painted afresh
     chooseView(st, btn, env)        the view btn names: kept, remembered, the screen drawn again
     chooseIv(st, btn, env)          the intervention btn names: kept, handed to the diagram with the lesion, its chip
                                     marked and the caption painted afresh */
function isPlaying(st,env){
  if(st.playing===null){
    let reduced=false;
    try{ reduced=!!env.reducedMotion(); }catch(_){}
    st.playing=!reduced;
  }
  return st.playing;
}
function setPlaying(st,on,env){
  st.playing=!!on;
  if(st.physio) st.playing?st.physio.play():st.physio.pause();
  env.doc.querySelectorAll('[data-physio-play]').forEach(b=>{
    b.textContent=st.playing?'Pause':'Play';
    b.title=st.playing?'Pause the cycle':'Play the cycle';
  });
}
function setSlow(st,n,env){
  st.slow=n;
  try{ env.store.setItem('accsap12.physioslow',String(n)); }catch(_){}
  if(st.physio&&st.physio.setSlow) st.physio.setSlow(n);
  env.doc.querySelectorAll('[data-physio-slow]').forEach(b=>
    b.classList.toggle('hot',+b.dataset.physioSlow===n));
}
/* A lead selected on one rhythm is still the lead you want to watch on the
   next, so the selection survives — but only if that rhythm has a 12-lead. */
function setKind(st,k,env){
  st.kind=k;
  if(st.physio) st.physio.setRate(env.RHYTHMS[k].hr||68);
  env.render();
}
function chooseLesion(st,b,env){
  st.lesion=b.dataset.physioLesion;
  try{ env.store.setItem('accsap12.physiolesion',st.lesion); }catch(_){}
  /* In the PV loop the interventions come and go with Normal, so the panel is drawn again. */
  if(st.view==='pv'){ env.render(); return; }
  env.applyLesion();
  env.doc.querySelectorAll('[data-physio-lesion]').forEach(x=>x.classList.toggle('hot',x===b));
  st.notePhase=''; env.paintNote();
}
function chooseView(st,b,env){
  st.view=b.dataset.physioView;
  try{ env.store.setItem('accsap12.physioview',st.view); }catch(_){}
  env.render();
}
function chooseIv(st,b,env){
  st.iv=b.dataset.physioIv;
  st.physio.setIntervention(st.iv);
  env.applyLesion();
  env.doc.querySelectorAll('[data-physio-iv]').forEach(x=>x.classList.toggle('hot',x===b));
  st.notePhase=''; env.paintNote();
}

root.RhythmLabScreen = { screenHtml, physioHtml, twelveHtml, leadCardHtml, state, noteHtml,
  isPlaying, setPlaying, setSlow, setKind, chooseLesion, chooseView, chooseIv };
})(typeof window !== 'undefined' ? window : this);
