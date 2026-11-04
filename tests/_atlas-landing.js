'use strict';
async function checkHomeDefault(page,ok){
  await page.emulateMedia({reducedMotion:'no-preference'});
  // The split build fetches its note library after first paint. Wait for the
  // input to arrive and its render to finish, then measure whether Home uses it.
  await page.evaluate(async()=>{
    if(typeof REF_SEED_READY!=='undefined')await REF_SEED_READY;
    if(window.__vtLive&&window.__vtLive.finished)await window.__vtLive.finished.catch(()=>{});
  });
  const home=await page.evaluate(()=>{
    const card=document.getElementById('pearlCard'),body=document.getElementById('pearlBody');
    return !!card&&!card.hidden&&getComputedStyle(card).display!=='none'&&!!body&&!body.hidden&&body.textContent.trim().length>0&&document.getElementById('atlasIntro').hidden;
  });
  ok('Home immediately shows the real pearl and answer without entering a guide',home);
  const live=await page.evaluate(async()=>{
    const canvas=document.getElementById('heroHeart3d');
    if(!canvas||!heroHeart3d)return false;
    const rect=canvas.getBoundingClientRect(),context=canvas.getContext('webgl2');
    if(!context)return false;
    const draw=context.drawElements;let paints=0;
    context.drawElements=function(...args){paints++;return draw.apply(this,args);};
    try{
      await new Promise(resolve=>{let n=0;const frame=()=>++n<20?requestAnimationFrame(frame):resolve();requestAnimationFrame(frame);});
      return {mode:document.querySelector('.hero-live').classList.contains('atlas-3d'),visibility:getComputedStyle(canvas.parentElement).visibility,width:rect.width,height:rect.height,paints};
    }finally{context.drawElements=draw;}
  });
  ok('Home immediately displays and draws the live 3D heart without an Explore tap',!!live&&live.mode&&live.visibility!=='hidden'&&live.width>=100&&live.height>=100&&live.paints>0,JSON.stringify(live));
  const controls=await page.evaluate(()=>['atlasExplore','atlasLandingPause'].map(id=>{
    const button=document.getElementById(id),box=button.getBoundingClientRect();
    const hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);
    return {id,clear:hit===button||button.contains(hit),hit:hit?.id||hit?.tagName,top:box.top,left:box.left,width:box.width,height:box.height};
  }));
  ok('heart view and Pause controls receive taps above the heart hit target',controls.every(x=>x.clear),JSON.stringify(controls));
}
// Home keeps the existing study controls; there is no invitation to enter first.
module.exports = async function homeLanding(page,ok,settled){
  await checkHomeDefault(page,ok);
  await page.locator('#pearlRecall').click();
  ok('Recall conceals the answer on the visible Home pearl',await page.evaluate(()=>!document.getElementById('pearlCard').hidden&&document.getElementById('pearlBody').hidden&&!document.getElementById('pearlPrompt').hidden));
  await page.evaluate(()=>setTheme(themeIsDark()?'daylight':'midnight'));
  await settled(page,()=>!window.__vtLive&&!!document.getElementById('pearlCard'),{label:'Home theme redraw'});
  ok('theme redraw preserves active recall',await page.evaluate(()=>document.getElementById('pearlCard').classList.contains('is-recalling')&&document.getElementById('pearlBody').hidden));
  await page.locator('#pearlRecall').click();
  ok('Reveal restores the note-derived answer',await page.evaluate(()=>!document.getElementById('pearlBody').hidden&&document.getElementById('pearlBody').textContent.trim().length>0));
  await page.getByRole('button',{name:'Show heart illustration',exact:true}).click();
  ok('the illustration is optional and leaves the pearl visible',await page.evaluate(()=>!atlas3D&&!document.getElementById('pearlCard').hidden&&getComputedStyle(document.querySelector('.atlas-anatomy')).display!=='none'));
  await page.getByRole('button',{name:'Explore heart in 3D',exact:true}).click();
  await checkHomeDefault(page,ok);
  const labSurfaces=await page.evaluate(()=>[...document.querySelectorAll('.lab-card')].map(e=>getComputedStyle(e).backgroundImage));
  ok('every Labs card has a painted surface behind its labels',labSurfaces.length>0&&labSurfaces.every(x=>x!=='none'));
  await page.evaluate(()=>{window.__doorStarts=new Set();document.addEventListener('animationstart',e=>{if(e.animationName==='door-greet'&&e.target.matches('#homePage2 .door-ic .icon'))window.__doorStarts.add(e.target);});});
  await page.evaluate(()=>homeGo(2,false));
  await settled(page,()=>homePage===2&&!homeTween,{label:'Labs opened'});
  await settled(page,()=>window.__doorStarts.size>=document.querySelectorAll('#homePage2 .door-ic .icon').length,{label:'study-tool entrances',timeout:8000}).catch(()=>{});
  const motion=await page.evaluate(()=>[...document.querySelectorAll('#homePage2 .door-ic .icon')].map(e=>window.__doorStarts.has(e)&&getComputedStyle(e).animationIterationCount==='1'));
  ok('study-tool icons animate once when Labs opens',motion.length===6&&motion.every(Boolean));
  await page.emulateMedia({reducedMotion:'reduce'});
  ok('study-tool icons stop for reduced motion',await page.evaluate(()=>[...document.querySelectorAll('#homePage2 .door-ic .icon')].every(e=>getComputedStyle(e).animationName==='none'&&e.getAnimations().length===0)));
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>homeGo(0,false));
  await settled(page,()=>homePage===0&&!homeTween,{label:'Home restored'});
  await page.locator('.pearl-open').click();
  await settled(page,()=>S.screen==='refs'&&!window.__vtLive,{label:'pearl source opened'});
  ok('Read note still opens the reference library',await page.evaluate(()=>S.screen==='refs'));
  await page.evaluate(()=>goHome());
  await settled(page,()=>S.screen==='home'&&!window.__vtLive,{label:'return from note'});
  await checkHomeDefault(page,ok);
};
module.exports.checkHomeDefault=checkHomeDefault;
