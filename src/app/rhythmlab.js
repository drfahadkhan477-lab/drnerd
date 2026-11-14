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
        The interventions are offered in the PV loop and nowhere else.
     3. The 12-lead panel has a canvas only for a rhythm that has a modelled 12-lead. Any other rhythm gets
        a note that says why: a normal trace under an abnormal name teaches the wrong pattern.
     4. Every panel says it is a model and not a recording.

   The chips name setLab() and the Home button goHome(); those stay the page's, as do the handlers
   mountPhysio() gives the cycle's chips. An inline handler is read where it is tapped.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function physioHtml(p){
  const {PHYSIO_VIEWS,PHYSIO_SPEEDS,physioView,physioSlow,physioIv,physioIsPlaying,Physio,e}=p;
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
    <div class="physio-stage"><canvas id="physioCanvas" aria-label="Cardiac cycle diagram"></canvas></div>
    ${physioView==='pv'?`<div class="physio-chips iv-chips">${Physio.INTERVENTIONS.map(iv=>
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
      <button class="btn sb-back" onclick="goHome()">${icon('arrow-left','icon-sm')} Home</button>
    </div>
    <div class="lab-monitor">
      <canvas id="labCanvas" aria-label="Live electrocardiogram trace"></canvas>
      <div class="lab-readout">
        <span class="lab-name">${e(r.name)}</span>
        <span class="lab-hr">${r.hr?r.hr+' bpm':'—'}</span>
      </div>
    </div>
    <div class="lab-desc">${e(r.desc)}</div>
    <div class="chips lab-chips">${RHYTHM_KEYS.map(k=>
      `<button class="chip${k===labKind?' hot':''}" onclick="setLab('${k}')">${e(RHYTHMS[k].name)}</button>`).join('')}</div>
    <div class="ref-hint" style="margin-top:12px">Traces are generated from waveform models, not recordings —
      shapes are schematic and meant for pattern recognition, not measurement.</div>
    ${buildPhysio()}
    ${buildTwelveLead()}
  </div>`;
}

root.RhythmLabScreen = { screenHtml, physioHtml, twelveHtml };
})(typeof window !== 'undefined' ? window : this);
