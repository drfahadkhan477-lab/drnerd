'use strict';
const path=require('path');
const {launch}=require('./_engine');
const {booted,quiet}=require('./_render');
const {onDeath,watch}=require('./_deathnote');
const target=process.argv[2];
if(!target){console.error('usage: node tests/verify-settings.js <build.html | URL>');process.exit(1);}
const URL=/^https?:\/\//.test(target)?target:'file://'+path.resolve(target);
let failed=0,passed=0,section='startup';const errors=[],events=[];
const die=onDeath(()=>({section,checks:passed+failed,errors,events}));
let browser;
const negative=process.env.NEGATIVE_CHECK||'';
(async()=>{
 browser=await launch();const page=watch(await browser.newPage({viewport:{width:1194,height:834}}),events,'settings');
 page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));

 const ok=(name,value)=>{console.log((value?'PASS ':'FAIL ')+name);value?passed++:failed++;};
 // Capture live nodes rather than HTML: restoring a deliberately broken control
 // must retain its listeners, pending request handlers and the surrounding app.
 const check=async(name,measure,defect,index)=>{
   section=name;ok(name,await measure());
   if(negative!=='all'&&negative!==String(index))return;
   await page.evaluate(()=>{
     window.__settingsProbe={nodes:[...document.querySelectorAll('*')].map(el=>({el,attrs:[...el.attributes].map(a=>[a.name,a.value]),children:[...el.childNodes],value:el.value})),storage:{...localStorage},key:AI.gemini.key,qIdx:S.qIdx,focus:document.activeElement};
   });
   const errorCount=errors.length;
   try{
     await defect();const caught=!(await measure());
     console.log((caught?'FAIL ':'MISSED ')+name+' [injected negative control]');
     if(!caught)failed++;
   }finally{
     errors.length=errorCount;
     await page.evaluate(()=>{
       const s=window.__settingsProbe;
       for(const n of s.nodes){
         const now=[...n.el.childNodes];if(now.length!==n.children.length||now.some((x,i)=>x!==n.children[i]))n.el.replaceChildren(...n.children);
         for(const a of [...n.el.attributes])if(!n.attrs.some(([k])=>k===a.name))n.el.removeAttribute(a.name);
         for(const [k,v] of n.attrs)if(n.el.getAttribute(k)!==v)n.el.setAttribute(k,v);
         if(n.value!==undefined)n.el.value=n.value;
       }
       localStorage.clear();for(const [k,v] of Object.entries(s.storage))localStorage.setItem(k,v);
       AI.gemini.key=s.key;S.qIdx=s.qIdx;s.focus?.focus();delete window.__settingsProbe;
     });
   }
 };

 await page.goto(URL);await booted(page);await quiet(page);
 await page.evaluate(()=>{startAdhocQuiz([POOL.find(q=>!q.bad)],null);});await quiet(page);
 await page.click('#settingsBtn');
 await check('Settings opens with reading, appearance and Apex sections',async()=>await page.evaluate(()=>{const d=document.querySelector('#generalSettings');return d.open&&d.querySelectorAll('section').length===3;}),async()=>{await page.evaluate(()=>{document.querySelector('#generalSettings section').remove()});},1);
 await page.selectOption('[name="layout"]','split');
 await check('layout preference does not reveal an unanswered explanation',async()=>await page.evaluate(()=>!S.answered&&!document.querySelector('.reveal-card')&&!document.querySelector('.reading-split')),async()=>{await page.evaluate(()=>{document.querySelector('.reading-question').insertAdjacentHTML('beforeend','<div class="reveal-card">Premature answer</div>')});},2);
 await page.evaluate(()=>closeSettings());await page.evaluate(()=>selectOpt(S.questions[S.qIdx].ci));await quiet(page);
 await check('answered landscape question uses two real columns',async()=>await page.evaluate(()=>{const a=document.querySelector('.reading-question').getBoundingClientRect(),b=document.querySelector('.reading-explanation').getBoundingClientRect();return b.left>=a.right&&Math.abs(a.top-b.top)<2;}),async()=>{await page.evaluate(()=>{document.querySelector('.reading-columns').style.display='block'});},3);
 await page.setViewportSize({width:390,height:844});await quiet(page);
 await check('phone falls back without losing split preference',async()=>await page.evaluate(()=>!document.querySelector('.reading-split')&&displaySettings().layout==='split'),async()=>{await page.evaluate(()=>{document.querySelector('#app').classList.add('reading-split')});},4);
 await page.evaluate(()=>openSettings());await page.click('.read-opt[data-read="3"]');
 await check('text size applies without replacing the answered question',async()=>await page.evaluate(()=>S.answered&&document.documentElement.dataset.read==='3'&&document.querySelector('#generalSettings').open),async()=>{await page.evaluate(()=>{document.documentElement.removeAttribute('data-read')});},5);
 await page.locator('#tune-b').evaluate(e=>{e.value='50';e.dispatchEvent(new Event('input',{bubbles:true}));});
 await check('brightness uses the root filter without an input-blocking overlay',async()=>await page.evaluate(()=>{return document.documentElement.style.filter.includes('brightness(0.5)')&&!document.querySelector('#appDimmer')&&document.querySelector('#generalSettings').matches(':modal');}),async()=>{await page.evaluate(()=>{document.documentElement.style.filter='none'});},6);
 await page.locator('.width-opt[data-width="0"]').click({noWaitAfter:true});await page.reload();await booted(page);await quiet(page);
 await check('display preferences survive reload',async()=>await page.evaluate(()=>displaySettings().brightness===50&&displaySettings().width==='narrow'&&readSize()===3),async()=>{await page.evaluate(()=>{localStorage.removeItem(TUNE_KEY)});},7);
 await page.evaluate(()=>{AI.provider='gemini';AI.gemini={...AI.gemini,key:'AIza-original'};openSettings('apex');});
 await page.locator('#generalSettings [data-prov="gemini"]').click({noWaitAfter:true});
 await check('opening the saved provider preserves its credential',async()=>await page.evaluate(()=>AI.provider==='gemini'&&AI.gemini.key==='AIza-original'),async()=>{await page.evaluate(()=>{AI.gemini.key=''});},8);
 await page.locator('#generalSettings #aiKey').fill('invalid');await page.locator('#generalSettings #aiSave').click({noWaitAfter:true});
 await check('failed validation retains the working credential',async()=>await page.evaluate(()=>AI.provider==='gemini'&&AI.gemini.key==='AIza-original'),async()=>{await page.evaluate(()=>{AI.gemini.key=''});},9);
 await page.locator('#generalSettings #aiKeyVisibility').click({noWaitAfter:true});
 await check('key visibility is explicit and reversible',async()=>await page.locator('#generalSettings #aiKey').getAttribute('type')==='text',async()=>{await page.evaluate(()=>{document.querySelector('#generalSettings #aiKey').type='password'});},10);
 await page.locator('#generalSettings #aiKeyVisibility').click({noWaitAfter:true});
 await page.evaluate(()=>{DISCOVER.gemini.fn=async()=>({models:[['gemini-test','Test model']]});});
 await page.locator('#generalSettings [data-prov="gemini"]').click({noWaitAfter:true});
 await page.locator('#generalSettings #aiKey').fill('AIza-synthetic-replacement');await page.locator('#generalSettings #aiSave').click({noWaitAfter:true});
 await page.waitForFunction(()=>AI.gemini.key==='AIza-synthetic-replacement');
 await check('successful mocked connection saves the chosen credential',async()=>await page.evaluate(()=>AI.provider==='gemini'&&AI.gemini.key==='AIza-synthetic-replacement'),async()=>{await page.evaluate(()=>{AI.gemini.key=''});},11);
 await page.evaluate(()=>resetDisplaySettings());
 await check('display reset preserves Apex credentials',async()=>await page.evaluate(()=>readSize()===0&&displaySettings().brightness===100&&displaySettings().layout==='focused'&&AI.gemini.key==='AIza-synthetic-replacement'&&document.documentElement.style.filter===''),async()=>{await page.evaluate(()=>{AI.gemini.key=''});},12);
 await page.keyboard.press('Escape');
 await check('Escape closes Settings and restores focus',async()=>await page.evaluate(()=>!document.querySelector('#generalSettings')&&document.activeElement.id==='settingsBtn'),async()=>{await page.evaluate(()=>{document.activeElement.blur()});},13);
 await check('no browser errors',async()=>errors.length===0,async()=>{errors.push('Injected settings error');},14);

 await page.evaluate(()=>{openSettings('apex');DISCOVER.gemini.fn=async()=>({error:'Rejected AIza-failed-test'});});
 await page.locator('#generalSettings #aiKey').fill('AIza-failed-test');
 await page.locator('#generalSettings #aiSave').click({noWaitAfter:true});
 await page.waitForFunction(()=>document.querySelector('#generalSettings #keyMsg').classList.contains('bad'));
 await check('provider rejection preserves the key and redacts echoed credentials',async()=>await page.evaluate(()=>AI.gemini.key==='AIza-synthetic-replacement'&&!document.querySelector('#generalSettings #keyMsg').textContent.includes('AIza-failed-test')),async()=>{await page.evaluate(()=>document.querySelector('#generalSettings #keyMsg').textContent='Rejected AIza-failed-test');},15);
 await page.locator('#removeApexKey').click({noWaitAfter:true});await page.locator('#cancelRemoveApexKey').click({noWaitAfter:true});
 await check('cancelling key removal preserves the credential',async()=>await page.evaluate(()=>AI.gemini.key==='AIza-synthetic-replacement'),async()=>{await page.evaluate(()=>AI.gemini.key='');},16);
 await page.locator('#removeApexKey').click({noWaitAfter:true});await page.locator('#confirmRemoveApexKey').click({noWaitAfter:true});
 await check('confirmed removal clears the saved credential',async()=>await page.evaluate(()=>AI.gemini.key===''&&JSON.parse(localStorage.getItem(AI_CFG)).gemini.key===''),async()=>{await page.evaluate(()=>AI.gemini.key='retained');},17);
 await page.evaluate(()=>{const save=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw Error('blocked');};try{updateDisplaySetting('layout','split');}finally{Storage.prototype.setItem=save;}});
 await check('blocked storage does not claim a display preference was saved',async()=>await page.evaluate(()=>displaySettings().layout==='focused'&&document.querySelector('[name="layout"]').value==='focused'),async()=>{await page.evaluate(()=>document.querySelector('[name="layout"]').value='split');},18);
 await page.evaluate(()=>{closeSettings();AI.gemini.key='AIza-draft-test';if(!document.querySelector('#shell').classList.contains('ai-open'))toggleAI();else buildAI();});await quiet(page);
 await page.locator('#aiIn').fill('My unsent question');
 await page.evaluate(()=>{openSettings();setReadSize(1);setTheme('parchment');updateDisplaySetting('width','wide');closeSettings();});
 await check('display changes preserve an unsent Apex draft',async()=>await page.locator('#aiIn').inputValue()==='My unsent question',async()=>{await page.locator('#aiIn').fill('');},19);
 await page.evaluate(()=>{openSettings('apex');DISCOVER.gemini.fn=()=>new Promise(resolve=>window.resolveSettingsRequest=resolve);});
 await page.locator('#generalSettings #aiKey').fill('AIza-cancelled-test');await page.locator('#generalSettings #aiSave').click({noWaitAfter:true});
 await page.waitForFunction(()=>typeof window.resolveSettingsRequest==='function');
 await page.evaluate(async()=>{closeSettings();window.resolveSettingsRequest({models:[['gemini-test','Test']]});await Promise.resolve();});
 await check('closing Settings cancels pending credential replacement',async()=>await page.evaluate(()=>AI.gemini.key==='AIza-draft-test'),async()=>{await page.evaluate(()=>AI.gemini.key='AIza-cancelled-test');},20);
 await page.evaluate(()=>openSettings());await page.addScriptTag({content:require('axe-core').source});
 await check('Settings passes accessibility checks',async()=>(await page.evaluate(()=>axe.run('#generalSettings',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']}}))).violations.length===0,async()=>{await page.evaluate(()=>{const x=document.querySelector('#generalSettings #aiKey');x.removeAttribute('aria-label');x.removeAttribute('placeholder');});},21);
 await page.evaluate(()=>{closeSettings();HTMLDialogElement.prototype.showModal=undefined;openSettings();});
 await page.keyboard.press('Shift+Tab');
 await check('legacy dialog fallback contains keyboard focus',async()=>await page.evaluate(()=>document.querySelector('#settingsBackdrop')&&document.querySelector('#generalSettings').contains(document.activeElement)),async()=>{await page.evaluate(()=>document.activeElement.blur());},22);
 await page.keyboard.press('Escape');
 await page.evaluate(()=>{startAdhocQuiz(POOL.filter(q=>!q.bad).slice(0,2),null);});await quiet(page);
 await page.evaluate(()=>selectOpt(S.questions[0].ci));await quiet(page);
 await page.evaluate(()=>{openSettings();window.settingsQuizBefore={index:S.qIdx,flagged:S.flagged.has(S.questions[S.qIdx].id)};});
 await page.keyboard.press('f');await page.keyboard.press('ArrowRight');await page.keyboard.press('Space');await quiet(page);
 await check('Settings owns keyboard shortcuts without changing the quiz',async()=>await page.evaluate(()=>S.qIdx===window.settingsQuizBefore.index&&S.answered&&S.flagged.has(S.questions[S.qIdx].id)===window.settingsQuizBefore.flagged),async()=>{await page.evaluate(()=>S.qIdx++);},23);
 console.log(`${passed} passed, ${failed} failed`);await browser.close();process.exitCode=failed?1:0;
})().finally(async()=>{if(browser)await browser.close();}).catch(die);
