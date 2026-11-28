/* Practice Lab screen and lazy mounting. The split build loads LabUI separately.
   The circulation request is shared with Rhythm Lab and Home through env. */
(function (root) {
'use strict';

function screenHtml(){ return `<div class="home-wrap anim-fade"><div class="plab" id="plabRoot"></div></div>`; }
/* The split build lifts the Lab's modules into vendor/ and leaves LAB_SRC naming the file (scripts/build-pwa.js);
   the first draw of this screen loads it and draws again when it is there. A failed load is not remembered. */
let labLibP=null, labNoCirc=false, labWaitingForCirc=false;
function mount(env){
  /* The Lab's heart sounds for AS, AR, MS and MR are placed on the circulation engine's valve events
     (HeartSounds.eventsFor), so the Lab waits for the engine too, which the split build also lifts (CIRC_SRC). If the
     engine will not load, the Lab draws all the same, on physio.js's events, which is what eventsFor gives without it. */
  if(!env.ui()||(env.circSrc()&&!env.hasCirculation()&&!labNoCirc)){
    if(env.screen()==='practice'&&env.labSrc()&&!labLibP&&!env.ui()){
      const s=env.doc.createElement('script'); s.src=env.labSrc();
      labLibP=new Promise(res=>{ s.onload=()=>{ res(); mount(env); }; s.onerror=()=>{ s.remove(); labLibP=null; res(); }; });
      env.doc.head.appendChild(s);
    }
    if(env.screen()==='practice'&&env.circSrc()&&!env.hasCirculation()&&!labNoCirc&&!labWaitingForCirc){
      if(!env.circLoad){
        const s=env.doc.createElement('script'); s.src=env.circSrc();
        env.circLoad=new Promise(res=>{ s.onload=()=>res(); s.onerror=()=>{ s.remove(); env.circLoad=null; res(); }; });
        env.doc.head.appendChild(s);
      }
      /* The Rhythm Lab or Home may already be loading the engine. Resume Practice in either case. */
      labWaitingForCirc=true;
      env.circLoad.then(()=>{
        labWaitingForCirc=false;
        labNoCirc=!env.hasCirculation();
        mount(env);
      });
    }
    return;
  }
  if(env.screen()==='practice') env.ui().mount(env.doc.getElementById('plabRoot'),env.examDate());
  else env.ui().unmount();
}
root.PracticeScreen = { screenHtml, mount };
})(typeof window !== 'undefined' ? window : module.exports);
