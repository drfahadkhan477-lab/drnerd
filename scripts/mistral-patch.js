#!/usr/bin/env node
/*
 * Groq and Anthropic leave. Mistral arrives, bring-your-own-key, seeing figures.
 *
 *   node scripts/mistral-patch.js <input.html> <output.html>
 *
 * LAST IN THE CHAIN ON PURPOSE. This revises code that `apex`, `gemini`,
 * `hosted`, `memory`, `ref-images`, `toolfence`, `chatfix` and `apexroom` all
 * touched, and the anchors below only exist in their combined, final form.
 *
 * MISTRAL'S WIRE FORMAT IS OPENAI-COMPATIBLE, verified against a real client
 * library's source rather than a marketing page — one search result claimed
 * image_url was a bare data-URL string, and it was wrong; pydantic-ai's own
 * Mistral model adapter builds it as {type:'image_url', image_url:{url:...}},
 * nested exactly like OpenAI's. Same for tools: {type:'function',
 * function:{name,description,parameters}} is what toOpenAITools() already
 * produces for Groq. This is not a coincidence — Groq's endpoint was ALSO
 * OpenAI-compatible, which is why it already occupied the "else" branch in
 * pushToolExchange, oneTurn and validateKey. Mistral takes that branch now.
 * Groq disappears; the branch it needed does not.
 *
 * ONE GENUINE DIFFERENCE: Mistral streams a tool call as a complete object in
 * one delta rather than fragmenting it token-by-token the way Groq's models
 * sometimes do. The accumulate-by-index parsing oneTurnGroq already used
 * handles this correctly as a special case — accumulating one complete chunk
 * once produces the same result — so oneTurnMistral reuses it unchanged
 * rather than growing a second parser.
 *
 * MISTRAL'S GET /v1/models RETURNS REAL CAPABILITY BOOLEANS
 * (capabilities.completion_chat / .function_calling / .vision) — Gemini's list has
 * nothing like this and needed a name-exclusion regex (GEM_NOT_CHAT) built
 * from a bug report. Filtering on those booleans directly means every model
 * that ever reaches the dropdown is vision-capable BY CONSTRUCTION, so
 * VISION_PROVIDERS can stay the simple per-provider boolean it already is —
 * no per-model vision flag needed.
 *
 * MISTRAL KEYS HAVE NO RECOGNISABLE PREFIX (confirmed: opaque tokens, unlike
 * Groq's gsk_ or Anthropic's sk-ant-). KEY_PREFIX.mistral='' makes the
 * "does this look like the right kind of key" gate a no-op for it —
 * k.startsWith('') is always true — which is correct: the real check is the
 * live API call that follows.
 *
 * THE ANCIENT MIGRATION SHIM IS DELETED, NOT REWRITTEN. It carried a config
 * format from before per-provider sub-objects existed into an Anthropic
 * shape that no longer exists. The general "unknown/missing provider slot"
 * normalisation chatfix-patch.js already added handles this for free: an old
 * bare {key,model} config has no .provider field at all, falls through to
 * AI_DEFAULT.provider (now 'gemini'), and gets fresh empty slots for every
 * current provider. The old key is dropped — it would not validate against
 * any remaining provider's format anyway.
 *
 * THE CONNECT FLOW IS GENERALISED, NOT DUPLICATED. bindSetup() had a ~40-line
 * discover-then-connect sequence hard-coded to Gemini. Mistral needs the
 * identical sequence against a different discovery function and cache key,
 * so the two are parameterised through one DISCOVER map instead of pasting
 * those 40 lines a second time with the words changed.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/mistral-patch.js <input.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}
function cut(label, from, to) {
  const a = html.indexOf(from);
  if (a < 0 || html.indexOf(from, a + 1) > -1) throw new Error(`[${label}] start anchor not unique`);
  const b = html.indexOf(to, a);
  if (b < 0) throw new Error(`[${label}] end anchor not found`);
  html = html.slice(0, a) + html.slice(b + to.length);
  applied.push(label);
}

/* ── 1. the provider tables ──────────────────────────────────────────────── */
patch('mistral: the ancient shim goes — the general normalisation below already covers it',
`const AI_CFG='accsap12.ai', AI_CHAT='accsap12.chat';
const AI_DEFAULT={provider:'groq',
  groq:{key:'',model:'openai/gpt-oss-120b'},
  anthropic:{key:'',model:'claude-sonnet-5'},
  gemini:{key:'',model:'gemini-2.5-flash'}};
let AI = loadJSON(AI_CFG, AI_DEFAULT);
if(AI && AI.key!==undefined && !AI.anthropic){
  AI={provider:'anthropic', anthropic:{key:AI.key||'',model:AI.model||'claude-sonnet-5'},
      groq:{key:'',model:'openai/gpt-oss-120b'}};
  saveJSON(AI_CFG,AI);
}
/* A config saved before Gemini existed has no .gemini slot at all — cur()
   would read undefined the instant someone picks it in settings. */
if(AI && !AI.gemini){ AI.gemini={key:'',model:'gemini-2.5-flash'}; saveJSON(AI_CFG,AI); }`,
`const AI_CFG='accsap12.ai', AI_CHAT='accsap12.chat';
/* Gemini is the default: hosted, so a fresh install needs nothing typed. */
const AI_DEFAULT={provider:'gemini',
  gemini:{key:'',model:'gemini-2.5-flash'},
  mistral:{key:'',model:''}};
let AI = loadJSON(AI_CFG, AI_DEFAULT);`);

patch('mistral: the fallback branch is named for what it now serves',
`   leaving oneTurn() to fall through to the Groq branch with a key that is not
   a Groq key. The set of real providers is the keys of AI_DEFAULT. */`,
`   leaving oneTurn() to fall through to the Mistral branch with a key that is
   not a Mistral key. The set of real providers is the keys of AI_DEFAULT. */`);

patch('mistral: two providers, not three',
`const PROVIDERS=[
  ['groq','Groq','free — open models',"No card. Create a key at console.groq.com → API Keys."],
  ['gemini','Gemini','free — sees figures',"No card. Create a key at aistudio.google.com → Get API key."],
  ['anthropic','Claude','paid — your account',"Create a key at console.claude.com → Settings → API keys."]
];
const MODELS={
  anthropic:[['claude-sonnet-5','Sonnet 5 — balanced (recommended)'],
             ['claude-opus-5','Opus 5 — deepest reasoning'],
             ['claude-haiku-4-5-20251001','Haiku 4.5 — fastest, cheapest']],
  groq:[['openai/gpt-oss-120b','GPT-OSS 120B — best quality (recommended)'],
        ['openai/gpt-oss-20b','GPT-OSS 20B — fastest'],
        ['qwen/qwen3.6-27b','Qwen 3.6 27B — alternate reasoning style']],
  /* Placeholder only — Connect replaces this with the live list. */
  gemini:[['gemini-2.5-flash','Gemini 2.5 Flash']]
};`,
`const PROVIDERS=[
  ['gemini','Gemini','free — sees figures',"No card. Create a key at aistudio.google.com → Get API key."],
  ['mistral','Mistral','free — sees figures',"No card, but activate the free Experiment plan first: console.mistral.ai → Billing → Experiment. Then create a key under API Keys."]
];
const MODELS={
  /* Placeholders only — Connect replaces both with the live list. Mistral's
     lineup changes often enough that shipping a guessed id here would be the
     same "stale model" bug Gemini's discovery was built to stop happening. */
  gemini:[['gemini-2.5-flash','Gemini 2.5 Flash']],
  mistral:[['pixtral-large-latest','Pixtral Large']]
};`);

patch('mistral: no key prefix to check, and the two endpoints are bases you append onto',
`const KEY_PREFIX={anthropic:'sk-ant-',groq:'gsk_',gemini:['AQ.','AIza']};
const ENDPOINT={anthropic:'https://api.anthropic.com/v1/messages',
                groq:'https://api.groq.com/openai/v1/chat/completions',
                gemini:'https://generativelanguage.googleapis.com/v1beta/models'};`,
`/* Mistral keys are opaque — no recognisable prefix like Groq's gsk_ or
   Anthropic's sk-ant-. '' makes the "does this look like the right kind of
   key" gate a no-op for it (k.startsWith('') is always true): the real check
   is the live API call in validateKey/Connect, same as it always was. */
const KEY_PREFIX={gemini:['AQ.','AIza'],mistral:''};
/* Both remaining providers need more than one URL — a chat endpoint and a
   models endpoint — so both entries are bases the call sites append onto. */
const ENDPOINT={gemini:'https://generativelanguage.googleapis.com/v1beta/models',
                mistral:'https://api.mistral.ai/v1'};
/* The live list, once discovered, outlives the tab — same rule as Gemini's,
   see GEM_MODELS_KEY below. */
const MISTRAL_MODELS_KEY='accsap12.mistral.models';
try{
  const cached=JSON.parse(localStorage.getItem(MISTRAL_MODELS_KEY)||'null');
  if(Array.isArray(cached)&&cached.length) MODELS.mistral=cached;
}catch(_){}`);

/* ── 2. the setup screen ──────────────────────────────────────────────────── */
patch('mistral: a provider with no prefix gets a real placeholder, not a bare "..."',
`      <input id="aiKey" type="password" placeholder="\${(Array.isArray(KEY_PREFIX[p])?KEY_PREFIX[p][0]:KEY_PREFIX[p])}..." autocomplete="off"`,
`      <input id="aiKey" type="password" placeholder="\${KEY_PREFIX[p]?(Array.isArray(KEY_PREFIX[p])?KEY_PREFIX[p][0]:KEY_PREFIX[p])+'...':'Paste your key'}" autocomplete="off"`);

/* ── 3. Connect: one flow, parameterised, not pasted twice ───────────────── */
patch('mistral: what Connect needs to know per discoverable provider',
`function bindSetup(){`,
`/* One discover-then-connect flow, driven by provider. Adding a second
   provider with live model discovery should mean adding an entry here, not
   pasting the ~40 lines below a second time with different vendor names. */
const DISCOVER={
  gemini:{fn:(k)=>geminiModels(k), cacheKey:GEM_MODELS_KEY, pickDefault:geminiDefaultModel,
    askMsg:'Asking Google which models this key can use…', vendor:'Google',
    hint:'A key made with <b>Get API key</b> in Google AI Studio gets the free tier without any billing account — try creating a fresh one there.'},
  mistral:{fn:(k)=>mistralModels(k), cacheKey:MISTRAL_MODELS_KEY, pickDefault:mistralDefaultModel,
    askMsg:'Asking Mistral which models this key can use…', vendor:'Mistral',
    hint:'Make sure the free Experiment plan is activated under Billing at console.mistral.ai — a key on an account that never selected a plan cannot reach any model.'},
};
function bindSetup(){`);

patch('mistral: the Gemini-only branch becomes the two-provider branch',
`      if(p==='gemini'){
        keyMsg('Asking Google which models this key can use…','');
        const found=await geminiModels(k);
        if(found.error){ keyMsg(found.error,'bad'); btn.disabled=false; btn.textContent='Connect'; return; }
        if(!found.models.length){
          /* Say what Google actually returned. The first version of this
             asserted the project had no chat model and sent the fellow to the
             Cloud console, where enabling the API asks for a billing account
             they do not need — when the real fault was this app's own filter.
             A dead end that cannot show its evidence costs a day. */
          const saw=(found.raw||[]).slice(0,8).join(', ');
          keyMsg('That key reached Google, but nothing it returned can hold a conversation.'
                +(saw?\` Google listed: <span class="err-raw">\${e(saw)}\${found.raw.length>8?' …':''}</span>.\`:' Google listed no models at all.')
                +' A key made with <b>Get API key</b> in Google AI Studio gets the free tier without any billing account — try creating a fresh one there.','bad');
          btn.disabled=false; btn.textContent='Connect'; return;
        }
        MODELS.gemini=found.models;
        try{ localStorage.setItem(GEM_MODELS_KEY,JSON.stringify(found.models)); }catch(_){}
        const asked=model, have=found.models.some(m=>m[0]===asked);
        if(!have) model=geminiDefaultModel(found.models);
        AI[p]={key:k,model}; saveJSON(AI_CFG,AI);
        const label=(found.models.find(m=>m[0]===model)||[model,model])[1];
        keyMsg(icon('check','icon-sm')+' Connected — '+e(label)
              +(have?'':' <span class="err-raw">(the model you picked is not on this key)</span>'),'good');
        setTimeout(()=>buildAI(),700);
        return;
      }`,
`      if(DISCOVER[p]){
        const d=DISCOVER[p];
        keyMsg(d.askMsg,'');
        const found=await d.fn(k);
        if(found.error){ keyMsg(found.error,'bad'); btn.disabled=false; btn.textContent='Connect'; return; }
        if(!found.models.length){
          /* Say what the provider actually returned. The first version of
             this asserted the project had no chat model and sent the fellow
             to a billing page they did not need — when the real fault was
             this app's own filter. A dead end that cannot show its evidence
             costs a day. */
          const saw=(found.raw||[]).slice(0,8).join(', ');
          keyMsg(\`That key reached \${d.vendor}, but nothing it returned can hold a conversation.\`
                +(saw?\` \${d.vendor} listed: <span class="err-raw">\${e(saw)}\${found.raw.length>8?' …':''}</span>.\`:\` \${d.vendor} listed no models at all.\`)
                +' '+d.hint,'bad');
          btn.disabled=false; btn.textContent='Connect'; return;
        }
        MODELS[p]=found.models;
        try{ localStorage.setItem(d.cacheKey,JSON.stringify(found.models)); }catch(_){}
        const asked=model, have=found.models.some(m=>m[0]===asked);
        if(!have) model=d.pickDefault(found.models);
        AI[p]={key:k,model}; saveJSON(AI_CFG,AI);
        const label=(found.models.find(m=>m[0]===model)||[model,model])[1];
        keyMsg(icon('check','icon-sm')+' Connected — '+e(label)
              +(have?'':' <span class="err-raw">(the model you picked is not on this key)</span>'),'good');
        setTimeout(()=>buildAI(),700);
        return;
      }`);

/* ── 4. validateKey, oneShot, apiError — anthropic branch gone, groq renamed ── */
patch('mistral: validateKey no longer offers Anthropic, and the fallback is Mistral',
`function validateKey(p,k,model){
  if(p==='anthropic'){
    return fetch(ENDPOINT.anthropic,{method:'POST',
      headers:{'content-type':'application/json','x-api-key':k,
        'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body:JSON.stringify({model,max_tokens:1,messages:[{role:'user',content:'hi'}]})});
  }
  if(p==='gemini'){
    return fetch(gemUrl('generate',model,k),{method:'POST',
      headers:gemHeaders(k,true),
      body:JSON.stringify({generationConfig:{maxOutputTokens:1},
        contents:[{role:'user',parts:[{text:'hi'}]}]})});
  }
  return fetch(ENDPOINT.groq,{method:'POST',
    headers:{'content-type':'application/json',authorization:'Bearer '+k},
    body:JSON.stringify({model,max_tokens:1,messages:[{role:'user',content:'hi'}]})});
}`,
`function validateKey(p,k,model){
  if(p==='gemini'){
    return fetch(gemUrl('generate',model,k),{method:'POST',
      headers:gemHeaders(k,true),
      body:JSON.stringify({generationConfig:{maxOutputTokens:1},
        contents:[{role:'user',parts:[{text:'hi'}]}]})});
  }
  return fetch(\`\${ENDPOINT.mistral}/chat/completions\`,{method:'POST',
    headers:{'content-type':'application/json',authorization:'Bearer '+k},
    body:JSON.stringify({model,max_tokens:1,messages:[{role:'user',content:'hi'}]})});
}`);

patch('mistral: model discovery with real capability booleans, not a name regex',
`function geminiDefaultModel(models){
  const plain=models.find(m=>/flash/i.test(m[0])&&!/lite|image|tts|audio|native|preview|thinking|robotics/i.test(m[0]));
  const anyFlash=models.find(m=>/flash/i.test(m[0]));
  return (plain||anyFlash||models[0])[0];
}`,
`function geminiDefaultModel(models){
  const plain=models.find(m=>/flash/i.test(m[0])&&!/lite|image|tts|audio|native|preview|thinking|robotics/i.test(m[0]));
  const anyFlash=models.find(m=>/flash/i.test(m[0]));
  return (plain||anyFlash||models[0])[0];
}
/* Ask Mistral what this key can actually reach. Simpler than Gemini's
   discovery: the list carries real capability booleans (capabilities.
   completion_chat, .function_calling, .vision), so this is a direct filter
   rather than a name regex assembled from a bug report. Every model that
   survives is therefore vision-capable BY CONSTRUCTION, which is what lets
   VISION_PROVIDERS stay a flat per-provider boolean instead of needing a
   per-model check. completion_chat, not chat — the field name a real key's
   real response actually uses, confirmed the hard way: a first version
   checked cap.chat, which is never set on anything Mistral returns, so
   every model failed the filter and a working key looked starved. */
async function mistralModels(key){
  let r;
  try{ r=await fetch(\`\${ENDPOINT.mistral}/models\`,{headers:{authorization:'Bearer '+key}}); }
  catch(err){ return {error:networkErrorMsg(err,'Mistral'), models:[], raw:[]}; }
  if(!r.ok) return {error:await apiError(r,'mistral'), models:[], raw:[]};
  let j={}; try{ j=await r.json(); }catch(_){}
  const raw=[], out=[];
  for(const m of (j.data||[])){
    const id=String(m.id||''); if(!id) continue;
    raw.push(id);
    const cap=m.capabilities||{};
    if(!cap.completion_chat||!cap.function_calling||!cap.vision) continue;
    out.push([id, id]);
  }
  return {models:out, raw};
}
/* Prefer the cheapest capable tier — same "default to the free-tier-friendly
   option" instinct as Gemini defaulting to Flash over Pro. */
function mistralDefaultModel(models){
  const small=models.find(m=>/small/i.test(m[0]));
  return (small||models[0])[0];
}`);

patch('mistral: oneShot loses Anthropic, keeps the fallback under a new name',
`    if(p==='anthropic'){
      const r=await fetch(ENDPOINT.anthropic,{method:'POST',
        headers:{'content-type':'application/json','x-api-key':k,
          'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
        body:JSON.stringify({model,max_tokens:maxTokens,messages:[{role:'user',content:prompt}]})});
      if(!r.ok) return '';
      const j=await r.json();
      return (j.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
    }
    if(p==='gemini'){
      const r=await fetch(gemUrl('generate',model,k),{method:'POST',
        headers:gemHeaders(k,true),
        body:JSON.stringify({generationConfig:{maxOutputTokens:maxTokens},
          contents:[{role:'user',parts:[{text:prompt}]}]})});
      if(!r.ok) return '';
      const j=await r.json();
      const parts=((j.candidates||[])[0]||{}).content;
      return ((parts&&parts.parts)||[]).map(x=>x.text||'').join('');
    }
    const r=await fetch(ENDPOINT.groq,{method:'POST',
      headers:{'content-type':'application/json',authorization:'Bearer '+k},
      body:JSON.stringify({model,max_tokens:maxTokens,messages:[{role:'user',content:prompt}]})});
    if(!r.ok) return '';
    const j=await r.json();
    return (((j.choices||[])[0]||{}).message||{}).content||'';`,
`    if(p==='gemini'){
      const r=await fetch(gemUrl('generate',model,k),{method:'POST',
        headers:gemHeaders(k,true),
        body:JSON.stringify({generationConfig:{maxOutputTokens:maxTokens},
          contents:[{role:'user',parts:[{text:prompt}]}]})});
      if(!r.ok) return '';
      const j=await r.json();
      const parts=((j.candidates||[])[0]||{}).content;
      return ((parts&&parts.parts)||[]).map(x=>x.text||'').join('');
    }
    const r=await fetch(\`\${ENDPOINT.mistral}/chat/completions\`,{method:'POST',
      headers:{'content-type':'application/json',authorization:'Bearer '+k},
      body:JSON.stringify({model,max_tokens:maxTokens,messages:[{role:'user',content:prompt}]})});
    if(!r.ok) return '';
    const j=await r.json();
    return (((j.choices||[])[0]||{}).message||{}).content||'';`);

patch('mistral: apiError names the two providers that remain',
`  const name=provider==='anthropic'?'Anthropic':provider==='gemini'?'Gemini':'Groq';`,
`  const name=provider==='gemini'?'Gemini':'Mistral';`);

/* ── 5. vision: gemini keeps its converter, mistral gets its own ─────────── */
patch('mistral: both remaining providers see figures',
`const VISION_PROVIDERS = { anthropic: true, groq: false, gemini: true };`,
`const VISION_PROVIDERS = { gemini: true, mistral: true };`);

patch('mistral: the comment describing who sees what',
`   2. It never claims a provider can see when it cannot. Only Anthropic
      models are wired for vision here; the Groq models this app offers
      (gpt-oss, qwen) are text-only, so on Groq the original "describe it to
      me" prompt is left exactly as it was. Silently dropping the image and
      letting the model bluff would be worse than not offering the feature.`,
`   2. It never claims a provider can see when it cannot. Both providers this
      app offers now are vision-capable — Mistral's model menu is filtered at
      discovery time to models with capabilities.vision, so nothing without
      it ever reaches the dropdown. The false branch and its "describe it to
      me" fallback stay in VISION_PROVIDERS regardless: correct, cheap, and
      what a future text-only provider would need. Silently dropping the
      image and letting the model bluff would be worse than not offering the
      feature.`);

/* ── 6. the turn functions ────────────────────────────────────────────────── */
cut('mistral: oneTurnAnthropic leaves entirely',
`async function oneTurnAnthropic(q,wire,extra){`,
`  return {text, raw, calls:raw.filter(b=>b.type==='tool_use')};
}

`);

patch('mistral: oneTurnGroq becomes oneTurnMistral — same body, new endpoint, and it can finally see',
`async function oneTurnGroq(q,wire,extra){
  const sys={role:'system',content:systemPrompt()+'\\n\\n'+aiCtx(q)+(extra||'')};
  const r=await fetch(ENDPOINT.groq,{
    method:'POST', signal:aiAbort.signal,
    headers:{'content-type':'application/json',authorization:'Bearer '+cur().key},
    body:JSON.stringify({model:cur().model,max_tokens:2000,stream:true,
      tools:toOpenAITools(TOOLS), tool_choice:'auto', messages:[sys,...wire]})
  });
  if(!r.ok) throw new Error(await apiError(r,'groq'));`,
`/* The one canonical block Vision.withFigures/withImages ever produces —
   {type:'text',text} and {type:'image',source:{media_type,data}} — becomes
   Mistral's image_url shape. Unlike Gemini, plain string content is valid
   here and is left untouched rather than wrapped, and every OTHER field on a
   message (tool_calls, tool_call_id — the shape pushToolExchange's OpenAI
   branch already builds) survives by not being touched at all. */
function mistralParts(content){
  if(!Array.isArray(content)) return content;
  return content.map(b=>b.type==='image'
    ? {type:'image_url',image_url:{url:'data:'+b.source.media_type+';base64,'+b.source.data}}
    : {type:'text',text:b.text||''});
}
function toMistralMessages(wire){
  return wire.map(m=>{
    const parts=mistralParts(m.content);
    return parts===m.content ? m : Object.assign({},m,{content:parts});
  });
}
async function oneTurnMistral(q,wire,extra){
  const sys={role:'system',content:systemPrompt()+'\\n\\n'+aiCtx(q)+(extra||'')};
  /* Non-mutating, same contract as the Gemini and (formerly) Anthropic turns:
     withFigures/withImages return a fresh array each call rather than
     stacking copies of the image onto the same wire, and the persisted
     history in CHATS never sees an image block at all. */
  const msgs=toMistralMessages(Vision.withImages(
    Vision.withFigures(wire, q, (typeof IMGS!=='undefined'?IMGS[q&&q.id]:null), AI.provider),
    refImagesForHits(lastHits), AI.provider));
  const r=await fetch(\`\${ENDPOINT.mistral}/chat/completions\`,{
    method:'POST', signal:aiAbort.signal,
    headers:{'content-type':'application/json',authorization:'Bearer '+cur().key},
    body:JSON.stringify({model:cur().model,max_tokens:2000,stream:true,
      tools:toOpenAITools(TOOLS), tool_choice:'auto', messages:[sys,...msgs]})
  });
  if(!r.ok) throw new Error(await apiError(r,'mistral'));`);

patch('mistral: the return statement closes the renamed function',
`  const calls=[...callMap.values()].filter(c=>c.name).map(c=>{
    let input={}; try{ input=c.args?JSON.parse(c.args):{}; }catch(_){ input={}; }
    return {id:c.id||('call_'+Math.random().toString(36).slice(2)), name:c.name, input};
  });
  return {text, calls, raw:null};
}`,
`  const calls=[...callMap.values()].filter(c=>c.name).map(c=>{
    let input={}; try{ input=c.args?JSON.parse(c.args):{}; }catch(_){ input={}; }
    return {id:c.id||('call_'+Math.random().toString(36).slice(2)), name:c.name, input};
  });
  return {text, calls, raw:null};
}
/* MISTRAL STREAMS A TOOL CALL AS ONE COMPLETE OBJECT, not fragmented across
   many deltas the way Groq's models sometimes did — verified against a real
   client's parsing code before relying on it. The accumulate-by-index loop
   above still handles that correctly: accumulating one complete chunk once
   produces the same result as accumulating many partial ones, so nothing
   about the parsing above needed to change for the provider it now serves. */`);

patch('mistral: pushToolExchange loses the Anthropic branch, keeps the shape Mistral wants',
`/* Anthropic bundles the whole tool exchange into one assistant turn + one user
   turn of tool_result blocks. OpenAI-shaped APIs (Groq) want a distinct
   assistant message carrying tool_calls, then one role:'tool' message per call. */
function pushToolExchange(wire,turn,results){
  if(AI.provider==='anthropic'){
    wire.push({role:'assistant',content:turn.raw});
    wire.push({role:'user',content:results.map(r=>({type:'tool_result',tool_use_id:r.id,content:r.content}))});
  } else if(AI.provider==='gemini'){`,
`/* OpenAI-shaped APIs (Mistral) want a distinct assistant message carrying
   tool_calls, then one role:'tool' message per call — exactly what the else
   branch below already builds, unchanged from when it served Groq. */
function pushToolExchange(wire,turn,results){
  if(AI.provider==='gemini'){`);

patch('mistral: the dispatcher is two-way now',
`function oneTurn(q,wire,extra){
  return AI.provider==='anthropic' ? oneTurnAnthropic(q,wire,extra)
       : AI.provider==='gemini' ? oneTurnGemini(q,wire,extra)
       : oneTurnGroq(q,wire,extra);`,
`function oneTurn(q,wire,extra){
  return AI.provider==='gemini' ? oneTurnGemini(q,wire,extra)
       : oneTurnMistral(q,wire,extra);`);

/* ── 4. the error body, which the two providers do not spell the same ────── */
/* THE SECOND HALF OF THE capabilities.chat BUG. Reading an error body is
   guessing at a shape too, and this file guessed once already. Gemini and
   Anthropic both nest the text under `error`; Mistral puts it at the top
   level ({"object":"error","message":"…"}), and its FastAPI validation
   errors use `detail` instead — sometimes an array rather than a string.
   So `j.error?.message` was empty for every Mistral failure there is,
   which silently disabled the out-of-credit branch and left the fallback
   printing "API error 400." with the explanation cut off.

   The fix is not to swap one guess for another: it reads whichever of the
   three documented shapes is actually present. Gemini is unaffected — its
   own shape is tried first and still wins. */
patch('mistral: read the error body every provider actually sends, not one of them',
`async function apiError(r,provider){
  let d=''; try{ d=(await r.json()).error?.message||''; }catch(_){}`,
`/* Gemini/Anthropic: {error:{message}}. Mistral: {message} at the top level,
   or {detail} on a validation error, either of which may be an object rather
   than a string. Take the first that is actually there. */
function errMsg(j){
  if(!j||typeof j!=='object') return '';
  const m = (j.error&&j.error.message) ?? j.message ?? j.detail;
  if(typeof m==='string') return m;
  if(m==null) return '';
  try{ return JSON.stringify(m).slice(0,300); }catch(_){ return ''; }
}
async function apiError(r,provider){
  let d=''; try{ d=errMsg(await r.json()); }catch(_){}`);

/* THE OTHER END OF THE SAME WIRE. keyMsg() assigns its argument with
   innerHTML — it has to, because several apiError branches deliberately return
   markup ("press <b>Connect</b> again"). That makes the one interpolation of
   the provider's own text into that string an injection sink: a body of
   {"message":"<img src=x onerror=…>"} becomes a real element and the handler
   runs, in the origin that holds the fellow's API keys, notes and chats.
   networkErrorMsg() three lines down already writes ${e(raw)}; this call site
   simply never got the same treatment.

   IT IS ALSO A HOLE THIS STEP WIDENED. Before errMsg() above, `d` was
   j.error?.message — which Mistral never sets, so nothing reached the sink on
   that provider. Teaching the app to read Mistral's error text correctly also
   handed that text to innerHTML. Escaping the value, not the sentence, keeps
   the deliberate markup working. */
patch('mistral: the provider says it, the fellow reads it — it does not get to run',
'  return `API error ${r.status}. ${d}`;',
'  return `API error ${r.status}. ${e(d)}`;');

/* A mid-stream error is the same bug with a worse ending. Mistral can abort a
   turn by emitting one error object into the SSE stream; `if(j.error)` never
   matched its shape, so the object fell through to the choices check, was
   skipped as an ordinary chunk, and the reply simply stopped — a truncated
   answer with no error anywhere, which reads as the app losing the thread.
   Anchored on the line after it, because the identical line exists in
   oneTurnGemini and is correct there. */
patch('mistral: a mid-stream error stops the turn instead of being skipped',
`      if(j.error) throw new Error(j.error.message||'stream error');
      const ch=j.choices&&j.choices[0]; if(!ch)continue;`,
`      if(j.error||j.object==='error') throw new Error(errMsg(j)||'stream error');
      const ch=j.choices&&j.choices[0]; if(!ch)continue;`);

fs.writeFileSync(OUT, html);
console.log(`Mistral arrives, Groq and Anthropic leave — ${applied.length} edits applied`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
