/* ═════════════════════════════════════════════
   rhythms.js — the cardiac waveform engine: physiologically-shaped ECG, in millivolts, as a function of time
   (docs/ROADMAP.md, E1). Original, offline, no external assets. It draws the live hero monitor, the answer
   feedback blips and the interactive Rhythm Lab.

     BASE                       the base rhythms: {name, hr, desc} for each key; the page merges RhythmsExtra.EXTRA in
     gauss(t, centre, width, amp)  a gaussian bump, the natural shape of P and T waves
     beatMV(t, o)               one PQRST beat, t in ms from the beat's onset; o can widen the QRS (qrsW), shift the ST
                                segment (stElev), and set the P, R and T amplitudes (pAmp, rAmp, tAmp)
     mv(kind, tms, state, RHYTHMS, RhythmsExtra)
                                the signal of a rhythm at an absolute time tms; state is the rhythm's own place, kept by
                                the caller (atrial fibrillation's beat-to-beat intervals)

   They were app/systole.html's RHYTHMS table, gauss(), beatMV() and rhythmMV(), moved unchanged; the page keeps RHYTHMS
   (this table with the extras merged in), RHYTHM_KEYS, and rhythmMV() as one line into mv().
   tests/verify-rhythms-pure.js holds them.

   Pure: no DOM, no clock, no randomness (atrial fibrillation's irregularity is a deterministic hash). ES2015; Safari
   13.4 is the floor (README).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

const BASE={
  sinus:      {name:'Normal Sinus',      hr:68,  desc:'P before every QRS, PR 120–200 ms, regular'},
  brady:      {name:'Sinus Bradycardia', hr:44,  desc:'Sinus mechanism under 60/min'},
  tachy:      {name:'Sinus Tachycardia', hr:130, desc:'Sinus mechanism over 100/min'},
  afib:       {name:'Atrial Fibrillation',hr:110,desc:'Irregularly irregular, no discrete P waves'},
  flutter:    {name:'Atrial Flutter',    hr:150, desc:'Sawtooth F waves ~300/min, often 2:1 conduction'},
  vt:         {name:'Ventricular Tachycardia',hr:180,desc:'Wide monomorphic complexes, AV dissociation'},
  vfib:       {name:'Ventricular Fibrillation',hr:0,desc:'Chaotic, no organised complexes — defibrillate'},
  chb:        {name:'Complete Heart Block',hr:38,desc:'P waves march independently of escape QRS'},
  torsades:   {name:'Torsades de Pointes',hr:230,desc:'Polymorphic VT twisting about the baseline'},
  stemi:      {name:'Anterior STEMI',    hr:88,  desc:'Convex ST elevation with reciprocal change'},
  paced:      {name:'Ventricular Paced', hr:70,  desc:'Pacing spike then wide, LBBB-like QRS'},
  asystole:   {name:'Asystole',          hr:0,   desc:'No electrical activity'}
};

/* gaussian bump — the natural shape of P and T waves */
function gauss(t,centre,width,amp){
  const x=(t-centre)/width;
  return amp*Math.exp(-0.5*x*x);
}
/* one PQRST beat, t in ms from beat onset, returns mV */
function beatMV(t,o){
  o=o||{};
  const pAmp = o.pAmp===undefined?0.13:o.pAmp;
  const qrsW = o.qrsW||1;            // width multiplier (wide for VT/paced/LBBB)
  const stE  = o.stElev||0;
  let v=0;
  if(pAmp) v+=gauss(t,45,20,pAmp);                        // P wave
  const q0=160;                                            // QRS onset
  const w=qrsW;
  v+=gauss(t,q0+8*w,5*w,-0.10);                            // Q
  v+=gauss(t,q0+26*w,9*w, 1.05*(o.rAmp||1));               // R
  v+=gauss(t,q0+48*w,10*w,-0.22);                          // S
  const stStart=q0+60*w;
  if(t>stStart&&t<stStart+120) v+=stE;                     // ST segment shift
  v+=gauss(t,q0+230*w,55*w,(o.tAmp===undefined?0.28:o.tAmp)); // T wave
  return v;
}
/* rhythm-aware signal: absolute time ms -> mV. RHYTHMS is the page's table, the base merged with RhythmsExtra.EXTRA,
   and RhythmsExtra is asked first, as it always was: a rhythm it draws is its own, and one it does not falls through to
   the cases below, where an unknown kind is a sinus beat at its table entry's rate (tests/verify-rhythms-pure.js holds
   that every rhythm in the table has a drawing of its own). */
function mv(kind,tms,state,RHYTHMS,RhythmsExtra){
  const R=RHYTHMS[kind]||RHYTHMS.sinus;
  const st=state||(state={});
  const extra=RhythmsExtra.extraRhythmMV(kind,tms,st);
  if(extra!==null) return extra;
  if(kind==='asystole') return Math.sin(tms/700)*0.008;
  if(kind==='vfib'){
    return 0.42*Math.sin(tms/38)+0.26*Math.sin(tms/17+1.1)
          +0.18*Math.sin(tms/9+2.3)+0.10*Math.sin(tms/54+0.4);
  }
  if(kind==='torsades'){
    const rr=60000/R.hr;
    const phase=(tms%rr)/rr;
    const envelope=Math.sin(tms/1400);                     // the "twist"
    return envelope*(0.9*Math.sin(phase*Math.PI*2)+0.35*Math.sin(phase*Math.PI*6));
  }
  if(kind==='chb'){
    // atria and ventricles run on independent clocks
    const pRR=60000/78, vRR=60000/38;
    const pv=gauss(tms%pRR,45,20,0.14);
    const qv=beatMV(tms%vRR,{pAmp:0,qrsW:1.5,tAmp:0.3});
    return pv+qv;
  }
  if(kind==='flutter'){
    const fRR=60000/300;                                   // sawtooth F waves
    const saw=((tms%fRR)/fRR)*0.22-0.11;
    const vRR=60000/R.hr;
    return saw+beatMV(tms%vRR,{pAmp:0,tAmp:0.18});
  }
  if(kind==='afib'){
    // irregularly irregular RR, driven by a deterministic hash so the trace is stable
    if(st.next===undefined){ st.next=0; st.rr=600; st.n=0; }
    while(tms>=st.next+st.rr){ st.next+=st.rr; st.n++;
      const h=Math.abs(Math.sin(st.n*12.9898)*43758.5453)%1;
      st.rr=380+h*620; }
    const fib=0.035*Math.sin(tms/23)+0.025*Math.sin(tms/11+1.7);
    return fib+beatMV(tms-st.next,{pAmp:0});
  }
  if(kind==='vt')     return beatMV(tms%(60000/R.hr),{pAmp:0,qrsW:2.3,tAmp:-0.35,rAmp:1.15});
  if(kind==='paced'){
    const rr=60000/R.hr, p=tms%rr;
    const spike=(p>150&&p<156)?1.1:0;                      // pacing artefact
    return spike+beatMV(p,{pAmp:0,qrsW:2.0,tAmp:-0.3});
  }
  if(kind==='stemi')  return beatMV(tms%(60000/R.hr),{stElev:0.32,tAmp:0.42});
  return beatMV(tms%(60000/R.hr),{});                      // sinus family
}

root.Rhythms = { BASE, gauss, beatMV, mv };

})(typeof window !== 'undefined' ? window : this);
