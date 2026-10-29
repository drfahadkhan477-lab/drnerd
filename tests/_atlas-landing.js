'use strict';
// Exercise the invitation through its real controls, then return to Home.
module.exports = async function atlasLanding(page, ok, settled) {
  const landing=await page.evaluate(()=>({
    title:document.getElementById('atlasTitle')?.innerText.replace(/\s+/g,' '),
    steps:[...document.querySelectorAll('.atlas-steps strong')].map(e=>e.textContent).join(','),
    image:(()=>{const i=document.querySelector('.atlas-anatomy');return !!i&&i.complete&&i.naturalWidth>0&&i.getBoundingClientRect().height>200;})(),
    intro:!document.getElementById('atlasIntro')?.hidden,
    reader:document.getElementById('pearlCard')?.hidden
  }));
  ok('Home opens with the selected invitation and three learning steps',landing.title==='Make one idea stick.'&&landing.steps==='Observe,Explain,Recall'&&landing.intro&&landing.reader,JSON.stringify(landing));
  ok('the anatomical illustration is decoded and visibly sized',landing.image);
  const labSurfaces=await page.evaluate(()=>[...document.querySelectorAll('.lab-card')].map(e=>({
    name:e.querySelector('.lab-txt b')?.textContent,paint:getComputedStyle(e).backgroundImage
  })));
  ok('every Labs card has a painted surface behind its white labels',labSurfaces.length>0&&labSurfaces.every(c=>c.paint!=='none'),JSON.stringify(labSurfaces));
  const reduced=await page.evaluate(()=>matchMedia('(prefers-reduced-motion:reduce)').matches);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>homeGo(2,false));
  await settled(page,()=>homePage===2&&!homeTween,{label:'Labs icon entrance'});
  const motion=await page.evaluate(()=>[...document.querySelectorAll('#homePage2 .door-ic .icon')].map(e=>e.getAnimations().some(a=>a.animationName==='door-greet'&&a.effect.getTiming().iterations===1)));
  ok('study-tool icons animate once when Labs opens',motion.length===6&&motion.every(Boolean));
  await page.emulateMedia({reducedMotion:'reduce'});
  ok('study-tool icons stop for reduced motion',await page.evaluate(()=>[...document.querySelectorAll('#homePage2 .door-ic .icon')].every(e=>getComputedStyle(e).animationName==='none'&&e.getAnimations().length===0)));
  await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
  await page.evaluate(()=>homeGo(0,false));
  const viewport=page.viewportSize();
  for(const width of [744,834]){
    await page.setViewportSize({width,height:1000});
    ok(`portrait ${width}: legacy hero copy stays hidden behind the illustration`,await page.evaluate(()=>getComputedStyle(document.querySelector('.atlas-hero-summary')).display==='none'));
  }
  await page.setViewportSize(viewport);
  await page.getByRole('button',{name:'Begin recall',exact:true}).click();
  const recall=await page.evaluate(()=>({intro:document.getElementById('atlasIntro').hidden,card:document.getElementById('pearlCard').hidden,answer:document.getElementById('pearlBody').hidden,prompt:document.getElementById('pearlPrompt').hidden}));
  ok('Begin recall opens the real pearl with its answer concealed',recall.intro&&!recall.card&&recall.answer&&!recall.prompt,JSON.stringify(recall));
  await page.getByRole('button',{name:'Reveal',exact:true}).click();
  ok('Reveal shows the note-derived pearl answer',await page.evaluate(()=>!document.getElementById('pearlBody').hidden&&document.getElementById('pearlBody').textContent.trim().length>0));
  await page.getByRole('button',{name:'Back to Home',exact:true}).click();
  ok('Back restores the invitation and returns keyboard focus',await page.evaluate(()=>!document.getElementById('atlasIntro').hidden&&document.getElementById('pearlCard').hidden&&document.activeElement.textContent.includes('Begin recall')));
  await page.getByRole('button',{name:'Read note',exact:true}).click();
  await settled(page,()=>!window.__vtLive,{label:'reference opened from invitation'});
  ok('Read note opens the reference library',await page.evaluate(()=>S.screen==='refs'));
  await page.evaluate(()=>goHome());
  await settled(page,()=>!window.__vtLive&&!!document.getElementById('atlasIntro'),{label:'return to invitation'});
};
