#!/usr/bin/env node
/*
 * Gemini as a third provider — free, and the only free one that still sees a
 * figure.
 *
 *   node scripts/gemini-patch.js <input.html> <output.html>
 *
 * Groq's own vision models (Llama 4 Scout, Llama 4 Maverick) were deprecated
 * in 2026; every model left on Groq's free tier is text-only. Anthropic still
 * sees figures, but costs money. Google's Gemini has a genuinely free tier —
 * no card, a real daily quota — and Gemini 2.5 Flash reads images natively.
 * This wires it in as a full third option, not a second-class one: it gets
 * its own tool-calling loop, not a text-only fallback.
 *
 * WHY IT IS ITS OWN FUNCTION RATHER THAN A THIRD BRANCH BOLTED ONTO
 * oneTurnGroq. Gemini's wire format is close to neither of the other two:
 *
 *   - the system prompt is a top-level `systemInstruction`, not a message;
 *   - roles are 'user' and 'model', never 'assistant';
 *   - a turn's content is a `parts` array (text / inlineData / functionCall /
 *     functionResponse), and images ride as base64 `inlineData` rather than
 *     Anthropic's `source` block or an OpenAI `image_url`;
 *   - streamed chunks are whole incremental parts, not a token delta wrapped
 *     in a content-block-start/delta/stop envelope, and a function call
 *     arrives as one complete part rather than being assembled token by token
 *     the way oneTurnGroq's callMap has to;
 *   - a tool result goes back as a `functionResponse` part matched by name,
 *     not a `tool_result` block or a `role:'tool'` message matched by id.
 *
 * Trying to squeeze that through either existing function would have meant
 * threading a provider check through nearly every line of it. Three parallel
 * oneTurn* functions, one per genuinely different wire shape, is the honest
 * version of this — the same reasoning apex.js already applied by giving
 * Anthropic and Groq their own functions instead of one with branches.
 *
 * Vision.withFigures / Vision.withImages need no changes at all: they already
 * gate purely on providerSeesFigures(provider), and the block shape they
 * produce — {type:'text',text} / {type:'image',source:{media_type,data}} — is
 * exactly what toGeminiContents() below converts, unchanged, into Gemini's
 * inlineData parts. Vision was already provider-agnostic; only the wire
 * format on the way OUT needed a new translator.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/gemini-patch.js <input.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. a slot for the key, and a repair for anyone who already has one saved
   without it ── */
patch('gemini: a config slot, and a repair for configs saved before this existed',
`const AI_DEFAULT={provider:'groq',
  groq:{key:'',model:'openai/gpt-oss-120b'},
  anthropic:{key:'',model:'claude-sonnet-5'}};
let AI = loadJSON(AI_CFG, AI_DEFAULT);
if(AI && AI.key!==undefined && !AI.anthropic){
  AI={provider:'anthropic', anthropic:{key:AI.key||'',model:AI.model||'claude-sonnet-5'},
      groq:{key:'',model:'openai/gpt-oss-120b'}};
  saveJSON(AI_CFG,AI);
}`,
`const AI_DEFAULT={provider:'groq',
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
if(AI && !AI.gemini){ AI.gemini={key:'',model:'gemini-2.5-flash'}; saveJSON(AI_CFG,AI); }`);

/* ── 2. the provider list, its models, its key shape, its endpoint ── */
patch('gemini: listed as a provider, free tier, no card',
`const PROVIDERS=[
  ['groq','Groq','free — open models',"No card. Create a key at console.groq.com → API Keys."],
  ['anthropic','Claude','paid — your account',"Create a key at console.claude.com → Settings → API keys."]
];`,
`const PROVIDERS=[
  ['groq','Groq','free — open models',"No card. Create a key at console.groq.com → API Keys."],
  ['gemini','Gemini','free — sees figures',"No card. Create a key at aistudio.google.com → Get API key."],
  ['anthropic','Claude','paid — your account',"Create a key at console.claude.com → Settings → API keys."]
];`);

patch('gemini: model list — Flash sees figures, on the free tier',
`const MODELS={
  anthropic:[['claude-sonnet-5','Sonnet 5 — balanced (recommended)'],
             ['claude-opus-5','Opus 5 — deepest reasoning'],
             ['claude-haiku-4-5-20251001','Haiku 4.5 — fastest, cheapest']],
  groq:[['openai/gpt-oss-120b','GPT-OSS 120B — best quality (recommended)'],
        ['openai/gpt-oss-20b','GPT-OSS 20B — fastest'],
        ['qwen/qwen3.6-27b','Qwen 3.6 27B — alternate reasoning style']]
};`,
`const MODELS={
  anthropic:[['claude-sonnet-5','Sonnet 5 — balanced (recommended)'],
             ['claude-opus-5','Opus 5 — deepest reasoning'],
             ['claude-haiku-4-5-20251001','Haiku 4.5 — fastest, cheapest']],
  groq:[['openai/gpt-oss-120b','GPT-OSS 120B — best quality (recommended)'],
        ['openai/gpt-oss-20b','GPT-OSS 20B — fastest'],
        ['qwen/qwen3.6-27b','Qwen 3.6 27B — alternate reasoning style']],
  gemini:[['gemini-2.5-flash','Gemini 2.5 Flash — free, sees figures (recommended)'],
          ['gemini-2.5-flash-lite','Gemini 2.5 Flash-Lite — free, fastest'],
          ['gemini-2.5-pro','Gemini 2.5 Pro — free, deepest reasoning (50/day)']]
};`);

/* Google migrated Gemini API keys from the old "Standard" shape (AIzaSy...)
   to a new "Auth" shape (AQ.Ab...) in 2026 — AI Studio issues AQ. keys by
   default now, and an unrestricted AIza key already stopped working in June.
   A restricted AIza key still works, and both shapes authenticate the same
   way (the x-goog-api-key header), so the client-side sanity check has to
   accept either — one entry per provider was never going to survive a vendor
   changing its own key format, so KEY_PREFIX now holds an array where a
   single string was enough before. */
patch('gemini: key prefix (both key generations Google has issued) and endpoint',
`const KEY_PREFIX={anthropic:'sk-ant-',groq:'gsk_'};
const ENDPOINT={anthropic:'https://api.anthropic.com/v1/messages',
                groq:'https://api.groq.com/openai/v1/chat/completions'};`,
`const KEY_PREFIX={anthropic:'sk-ant-',groq:'gsk_',gemini:['AQ.','AIza']};
const ENDPOINT={anthropic:'https://api.anthropic.com/v1/messages',
                groq:'https://api.groq.com/openai/v1/chat/completions',
                gemini:'https://generativelanguage.googleapis.com/v1beta/models'};`);

patch('gemini: the key-field placeholder shows whichever prefix is first, not the whole array',
`<input id="aiKey" type="password" placeholder="\${KEY_PREFIX[p]}..." autocomplete="off"`,
`<input id="aiKey" type="password" placeholder="\${(Array.isArray(KEY_PREFIX[p])?KEY_PREFIX[p][0]:KEY_PREFIX[p])}..." autocomplete="off"`);

patch('gemini: a key is accepted if it matches ANY of a provider\'s prefixes, not exactly one',
`    if(!k.startsWith(KEY_PREFIX[p])){
      keyMsg(\`A \${name} key starts with <b>\${KEY_PREFIX[p]}</b>. That looks like a different kind of key.\`,'warn');
      return;
    }`,
`    const validPrefixes=[].concat(KEY_PREFIX[p]);
    if(!validPrefixes.some(pfx=>k.startsWith(pfx))){
      keyMsg(\`A \${name} key starts with <b>\${validPrefixes.join('</b> or <b>')}</b>. That looks like a different kind of key.\`,'warn');
      return;
    }`);

/* ── 3. Gemini can see a figure ── */
patch('gemini: added to the providers that can actually see a figure',
`const VISION_PROVIDERS = { anthropic: true, groq: false };`,
`const VISION_PROVIDERS = { anthropic: true, groq: false, gemini: true };`);

/* ── 4. key validation ── */
patch('gemini: key validation — one throwaway generateContent call',
`function validateKey(p,k,model){
  if(p==='anthropic'){
    return fetch(ENDPOINT.anthropic,{method:'POST',
      headers:{'content-type':'application/json','x-api-key':k,
        'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body:JSON.stringify({model,max_tokens:1,messages:[{role:'user',content:'hi'}]})});
  }
  return fetch(ENDPOINT.groq,{method:'POST',
    headers:{'content-type':'application/json',authorization:'Bearer '+k},
    body:JSON.stringify({model,max_tokens:1,messages:[{role:'user',content:'hi'}]})});
}`,
`function validateKey(p,k,model){
  if(p==='anthropic'){
    return fetch(ENDPOINT.anthropic,{method:'POST',
      headers:{'content-type':'application/json','x-api-key':k,
        'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body:JSON.stringify({model,max_tokens:1,messages:[{role:'user',content:'hi'}]})});
  }
  if(p==='gemini'){
    return fetch(\`\${ENDPOINT.gemini}/\${model}:generateContent\`,{method:'POST',
      headers:{'content-type':'application/json','x-goog-api-key':k},
      body:JSON.stringify({contents:[{role:'user',parts:[{text:'hi'}]}],
        generationConfig:{maxOutputTokens:1}})});
  }
  return fetch(ENDPOINT.groq,{method:'POST',
    headers:{'content-type':'application/json',authorization:'Bearer '+k},
    body:JSON.stringify({model,max_tokens:1,messages:[{role:'user',content:'hi'}]})});
}`);

/* ── 5. the three-way dispatch, and the fourth field a tool result now
   carries — Gemini matches a functionResponse to its call by name, not id,
   so the name has to survive from runTool() to pushToolExchange() ── */
patch('gemini: dispatch a turn to its own function',
`function oneTurn(q,wire,extra){
  return AI.provider==='anthropic' ? oneTurnAnthropic(q,wire,extra) : oneTurnGroq(q,wire,extra);
}`,
`function oneTurn(q,wire,extra){
  return AI.provider==='anthropic' ? oneTurnAnthropic(q,wire,extra)
       : AI.provider==='gemini' ? oneTurnGemini(q,wire,extra)
       : oneTurnGroq(q,wire,extra);
}`);

patch('gemini: a tool result keeps its name — Anthropic and Groq ignore the extra field, Gemini needs it',
`      const results=turn.calls.map(c=>{
        const out=runTool(c.name,c.input);
        if(out.cite) lastHits=(lastHits||[]).concat(out.cite).slice(-6);
        toolTrace.push({kind:'call',name:c.name,input:c.input});
        return {id:c.id, content:String(out.result).slice(0,9000)};
      });`,
`      const results=turn.calls.map(c=>{
        const out=runTool(c.name,c.input);
        if(out.cite) lastHits=(lastHits||[]).concat(out.cite).slice(-6);
        toolTrace.push({kind:'call',name:c.name,input:c.input});
        return {id:c.id, name:c.name, content:String(out.result).slice(0,9000)};
      });`);

patch('gemini: its own shape for the tool exchange — a model turn of parts, then a user turn of functionResponse parts',
`function pushToolExchange(wire,turn,results){
  if(AI.provider==='anthropic'){
    wire.push({role:'assistant',content:turn.raw});
    wire.push({role:'user',content:results.map(r=>({type:'tool_result',tool_use_id:r.id,content:r.content}))});
  } else {`,
`function pushToolExchange(wire,turn,results){
  if(AI.provider==='anthropic'){
    wire.push({role:'assistant',content:turn.raw});
    wire.push({role:'user',content:results.map(r=>({type:'tool_result',tool_use_id:r.id,content:r.content}))});
  } else if(AI.provider==='gemini'){
    /* Gemini correlates a functionResponse to its call by name and by
       position, not by an id — there is nothing here to carry one. */
    wire.push({role:'model',parts:turn.raw});
    wire.push({role:'user',parts:results.map(r=>({functionResponse:{name:r.name,response:{content:r.content}}}))});
  } else {`);

/* ── 6. the function itself: convert the wire, stream the SSE, come back in
   the same {text, raw, calls} shape the other two already return ── */
patch('gemini: the request, the stream parser, and the wire/tool converters it needs',
`function toOpenAITools(tools){
  return tools.map(t=>({type:'function',
    function:{name:t.name,description:t.description,parameters:t.input_schema}}));
}`,
`function toOpenAITools(tools){
  return tools.map(t=>({type:'function',
    function:{name:t.name,description:t.description,parameters:t.input_schema}}));
}
/* Gemini's function-declaration schema is the same OpenAPI-flavoured JSON
   Schema our TOOLS already speak (type/properties/items/required, all
   lowercase) — no translation needed beyond the field name. */
function toGeminiTools(tools){
  return tools.map(t=>({name:t.name,description:t.description,parameters:t.input_schema}));
}
/* The one block shape Vision.withFigures/withImages ever produces —
   {type:'text',text} and {type:'image',source:{media_type,data}} — becomes
   Gemini's inlineData part. A wire entry already shaped {role,parts} (a
   tool exchange pushToolExchange added this turn) rides through untouched. */
function geminiParts(content){
  if(content==null||typeof content==='string') return [{text:String(content||'')}];
  if(Array.isArray(content)) return content.map(b=>
    b.type==='image' ? {inlineData:{mimeType:b.source.media_type,data:b.source.data}}
                      : {text:b.text||''});
  return [{text:String(content)}];
}
function toGeminiContents(wire){
  return wire.map(m=>m.parts ? {role:m.role,parts:m.parts}
                              : {role:m.role==='assistant'?'model':'user',parts:geminiParts(m.content)});
}
async function oneTurnGemini(q,wire,extra){
  const model=cur().model;
  const contents=toGeminiContents(Vision.withImages(
    Vision.withFigures(wire, q, (typeof IMGS!=='undefined'?IMGS[q&&q.id]:null), AI.provider),
    refImagesForHits(lastHits), AI.provider));
  const r=await fetch(\`\${ENDPOINT.gemini}/\${model}:streamGenerateContent?alt=sse\`,{
    method:'POST', signal:aiAbort.signal,
    headers:{'content-type':'application/json','x-goog-api-key':cur().key},
    body:JSON.stringify({
      systemInstruction:{parts:[{text:systemPrompt()+'\\n\\n'+aiCtx(q)+(extra||'')}]},
      tools:[{functionDeclarations:toGeminiTools(TOOLS)}],
      generationConfig:{maxOutputTokens:2000},
      contents})
  });
  if(!r.ok) throw new Error(await apiError(r,'gemini'));
  const rd=r.body.getReader(), dec=new TextDecoder();
  const live=document.getElementById('aiLive'), body=document.getElementById('aiBody');
  /* Gemini streams whole parts, not token deltas inside a block envelope: a
     text part is the next chunk of prose, a functionCall part arrives
     complete in one piece (structured args are not assembled incrementally
     the way oneTurnGroq's callMap has to). raw keeps every part in the order
     it arrived, so a turn that starts talking and then calls a tool pushes
     back exactly what it did, not a reconstruction of it. */
  let buf='', text='', raw=[];
  while(true){
    const {done,value}=await rd.read(); if(done)break;
    buf+=dec.decode(value,{stream:true});
    const lines=buf.split('\\n'); buf=lines.pop();
    for(const ln of lines){
      if(!ln.startsWith('data:'))continue;
      const p=ln.slice(5).trim(); if(!p)continue;
      let j; try{ j=JSON.parse(p); }catch(_){ continue; }
      if(j.error) throw new Error(j.error.message||'stream error');
      const cand=j.candidates&&j.candidates[0]; if(!cand)continue;
      for(const part of (cand.content&&cand.content.parts)||[]){
        if(part.text){
          if(!text) apexSetState('speaking');
          text+=part.text; raw.push({text:part.text});
          apexPulse();
          if(live){ live.innerHTML=md(text)+toolStrip(); if(body)body.scrollTop=body.scrollHeight; }
        } else if(part.functionCall){
          apexSetState('tool');
          raw.push({functionCall:part.functionCall});
        }
      }
    }
  }
  const calls=raw.filter(p=>p.functionCall).map(p=>({
    id:'call_'+Math.random().toString(36).slice(2),
    name:p.functionCall.name, input:p.functionCall.args||{}}));
  return {text, raw, calls};
}`);

/* ── 7. errors in Gemini's own words ── */
patch('gemini: named in the error line, and its own key-rejection / quota shapes recognised',
`async function apiError(r,provider){
  let d=''; try{ d=(await r.json()).error?.message||''; }catch(_){}
  const name=provider==='anthropic'?'Anthropic':'Groq';
  if(r.status===401) return 'Your API key was rejected. Tap the settings icon to re-enter it.';
  if(r.status===429) return 'Rate limited — wait a few seconds and try again.';
  if(r.status===400&&/credit|balance/i.test(d)) return \`Your \${name} account is out of credit.\`;
  if(r.status===404) return \`That model is not available on \${name} right now — pick a different one in settings.\`;
  if(r.status>=500) return \`\${name} had a server error. Try again shortly.\`;
  return \`API error \${r.status}. \${d}\`;
}`,
`async function apiError(r,provider){
  let d=''; try{ d=(await r.json()).error?.message||''; }catch(_){}
  const name=provider==='anthropic'?'Anthropic':provider==='gemini'?'Gemini':'Groq';
  if(r.status===401) return 'Your API key was rejected. Tap the settings icon to re-enter it.';
  if(r.status===403&&provider==='gemini') return 'Your API key was rejected. Tap the settings icon to re-enter it.';
  if(r.status===400&&provider==='gemini'&&/api key not valid/i.test(d)) return 'Your API key was rejected. Tap the settings icon to re-enter it.';
  /* Gemini's free tier is a DAILY quota, not a per-minute one — "wait a few
     seconds" is actively wrong advice for it. */
  if(r.status===429&&provider==='gemini'&&/quota/i.test(d)) return "Gemini's free daily quota is used up for today — try again tomorrow, or switch provider in settings.";
  if(r.status===429) return 'Rate limited — wait a few seconds and try again.';
  if(r.status===400&&/credit|balance/i.test(d)) return \`Your \${name} account is out of credit.\`;
  if(r.status===404) return \`That model is not available on \${name} right now — pick a different one in settings.\`;
  if(r.status>=500) return \`\${name} had a server error. Try again shortly.\`;
  return \`API error \${r.status}. \${d}\`;
}`);

fs.writeFileSync(OUT, html);
console.log(`Gemini provider — ${applied.length} edits applied`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
