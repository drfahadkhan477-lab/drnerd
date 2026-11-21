/* ═════════════════════════════════════════════
   apexwire.js — what Apex sends the model and what it reads back: the wire, and nothing else.

   A turn with the tutor is a thread cut to a window, turned into one provider's request, sent, and a
   stream read back into text, tool calls and the reason the model stopped. All of that is shape: which
   messages ride, which key a field goes under, what a streamed part means. It was spread through
   app/systole.html beside the code that draws the panel and runs the tools. It is here so that the shape
   can be held without a browser, and so that a second provider is a second object beside `gemini` rather
   than a second copy of the panel (docs/ROADMAP.md, A1).

   For any provider:
     SEND, KEEP           how many messages a request carries, and how many a thread keeps
     wire(hist)           the thread as a request carries it: no failed turns, the last SEND, opening on a user turn
     trim(hist)           the thread as it is kept: cut in place to the last KEEP, on a user turn

   Gemini's shapes, as ApexWire.gemini:
     url(base, relay, op, model, key, page)   where a request goes: Google's, with a key; this site's relay, without
     headers(key, post)                       and what it carries: the key only when there is one
     tools(tools)                             the tool list (Anthropic's input_schema shape) as functionDeclarations
     parts(content), contents(wire)           a thread's messages as Gemini's contents; images as inlineData
     request(system, tools, contents, max)    the body of a streamed turn, as the JSON text that is sent
     plain(prompt, max)                       the body of a one-message request with no tools
     text(j)                                  the words of a reply that was not streamed
     reader(on)                               the stream, read a decoded chunk at a time: .push(chunk), then
                                              .text, .raw (each part as it arrived, signatures kept), .finishReason.
                                              on.speaking() before the first words, on.words() after each text
                                              part, on.tool() before a call is kept; all three optional
     calls(raw)                               the tool calls among the parts, each with an id of its own
     exchange(wire, turn, results)            the model's parts and the tools' answers, pushed onto the wire

   THE RULES, because each was a request that failed or a thread that died:

     1. A failed turn is the panel's record, not something Apex said. It is never sent back.
     2. The window opens on a user turn, and says once, inside that turn, that earlier messages are missing.
     3. A streamed part goes back exactly as it came, with the signature that arrived beside it; a
        signature that arrives alone belongs to the part before it. A first call with no signature is
        given Google's opt-out token rather than a request that is refused.
     4. A hosted request carries no secret: without a key, no key header is written at all.
     5. An error inside the stream is thrown, with the provider's words. A line that is not JSON is skipped.

   What is not here: fetch, the retry, the panel, the tools themselves, the prompt's words, and the loop
   that runs a turn (run() in src/core/apexturn.js, with the state a turn changes).
   These were the page's gemUrl(), gemHeaders(), apexWire(), apexTrim(), pushToolExchange(),
   toGeminiTools(), geminiParts(), toGeminiContents() and the inside of oneTurnGemini() and oneShot() until
   they moved here (docs/ROADMAP.md, E1 step 2). tests/verify-apexwire-pure.js holds them.

   No DOM, no clock, no storage, no network: bare Node can test it. calls() uses Math.random for ids.
   ES2018 for object spread (Safari 11.1); Safari 13.4 is the floor (README).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

/* ═══════════ how much of a thread rides on a request ═══════════
   Every turn used to carry every message ever sent about this question, so a
   long conversation grew slower and more expensive with each exchange and had
   no ceiling at all. APEX_SEND is the window; APEX_KEEP is what is written to
   storage, which is larger because reading back a thread is free and re-sending
   it is not.

   TWO THINGS THIS DOES CAREFULLY.

   err turns are dropped: they are the panel's record of a failed request — an
   expired session, a dropped connection — kept in the thread so you can see
   what happened, but they are not things Apex said, and sending them back as
   assistant turns wrote every network blip permanently into the context.

   And the window starts on a USER turn. Anthropic rejects two assistant turns
   in a row, so a window that happened to open on a reply would turn a long
   conversation into an HTTP 400 — arriving precisely when this was working. */
const APEX_SEND=16, APEX_KEEP=60;
function apexWire(hist){
  const live=(hist||[]).filter(m=>!m.err).map(m=>({role:m.role,content:m.content}));
  if(live.length<=APEX_SEND) return live;
  let from=live.length-APEX_SEND;
  while(from<live.length && live[from].role!=='user') from++;
  if(from>=live.length) return live.slice(-1);
  const kept=live.slice(from);
  /* Said inside the first message kept rather than as a message of its own —
     an extra turn would be the very assistant-adjacency this avoids. */
  kept[0]=Object.assign({},kept[0],{content:
    '[Earlier messages in this thread are not included — it is longer than one '+
    'request carries. Ask me to recap if you need something from before this.]\n\n'+
    kept[0].content});
  return kept;
}
/* Storage has a ceiling too: accsap12.chat held every exchange about all 639
   questions, forever, in a 5 MB budget. Trimmed on the same user-turn boundary
   so what is kept is always a whole exchange. */
function apexTrim(hist){
  if(!hist || hist.length<=APEX_KEEP) return hist;
  let from=hist.length-APEX_KEEP;
  while(from<hist.length && hist[from].role!=='user') from++;
  if(from>=hist.length) return hist;
  hist.splice(0,from);
  return hist;
}

/* ═══════════ Gemini ═══════════ */
/* BYOK → Google directly, exactly as before. Hosted → the Worker, which
   attaches the secret. op is 'stream' | 'generate' | 'models'. base is Google's
   models address and relay this site's own; both are the page's to name. */
function gemUrl(base,relay,op,model,key,page){
  /* The page token belongs in here rather than at the call site. It used to be
     concatenated on by the caller as '&pageToken=…', which is right for
     Google's URL — that one already carries ?pageSize=200 — and wrong for the
     hosted one, which had no query string at all, so the '&' started nothing
     and every page after the first silently re-fetched page one. */
  const pt=page?'&pageToken='+encodeURIComponent(page):'';
  if(key) return op==='models'
    ? `${base}?pageSize=200${pt}`
    : `${base}/${model}:${op==='stream'?'streamGenerateContent?alt=sse':'generateContent'}`;
  return op==='models' ? `${relay}/models?pageSize=200${pt}`
                       : `${relay}/${op}?model=${encodeURIComponent(model||'')}`;
}
function gemHeaders(key,post){
  const h=post?{'content-type':'application/json'}:{};
  if(key) h['x-goog-api-key']=key;      // hosted requests carry no secret at all
  return h;
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
/* The body of a streamed turn, as the text that is sent. tools is the page's
   list, or nothing for a turn that may not use any: then the request carries no
   tools key at all, rather than an empty list. The keys are written in this
   order, which the Worker's checks and the explanation cache's identity read. */
function geminiRequest(system,tools,contents,maxOutputTokens){
  return JSON.stringify({
      systemInstruction:{parts:[{text:system}]},
      ...(tools?{tools:[{functionDeclarations:toGeminiTools(tools)}]}:{}),
      generationConfig:{maxOutputTokens},
      contents});
}
/* One message, no tools, not streamed: the key check and the session summary. */
function geminiPlain(prompt,maxTokens){
  return JSON.stringify({generationConfig:{maxOutputTokens:maxTokens},
    contents:[{role:'user',parts:[{text:prompt}]}]});
}
/* And the words of its reply. */
function geminiText(j){
  const parts=((j.candidates||[])[0]||{}).content;
  return ((parts&&parts.parts)||[]).map(x=>x.text||'').join('');
}
/* Gemini streams whole parts, not token deltas inside a block envelope: a
   text part is the next chunk of prose, a functionCall part arrives
   complete in one piece (structured args are not assembled incrementally
   the way oneTurnGroq's callMap has to). raw keeps every part in the order
   it arrived, so a turn that starts talking and then calls a tool pushes
   back exactly what it did, not a reconstruction of it.

   The stream is server-sent events. push() is given each chunk as text, in
   order; a line cut in two by a chunk boundary is kept until its end arrives. */
function geminiReader(on){
  on=on||{};
  const st={buf:'', text:'', raw:[], finishReason:''};
  st.push=function(chunk){
    st.buf+=chunk;
    const lines=st.buf.split('\n'); st.buf=lines.pop();
    for(const ln of lines){
      if(!ln.startsWith('data:'))continue;
      const p=ln.slice(5).trim(); if(!p)continue;
      let j; try{ j=JSON.parse(p); }catch(_){ continue; }
      if(j.error) throw new Error(j.error.message||'stream error');
      const cand=j.candidates&&j.candidates[0]; if(!cand)continue;
      if(cand.finishReason) st.finishReason=cand.finishReason;
      for(const part of (cand.content&&cand.content.parts)||[]){
        /* THE SIGNATURE TRAVELS WITH THE PART, AND HAS TO GO BACK WITH IT.
           Gemini 3 signs the parts of a turn that involved thinking, and
           validates on the next request that the signature came back exactly
           as issued. Dropping it does not degrade the answer, it fails the
           call: "Function call is missing a thought_signature in functionCall
           parts", HTTP 400, and the conversation dies at the point Apex tried
           to use a tool. Every part is therefore pushed with whatever
           signature arrived beside it. */
        if(part.text){
          if(!st.text&&on.speaking) on.speaking();
          st.text+=part.text;
          st.raw.push(part.thoughtSignature?{text:part.text,thoughtSignature:part.thoughtSignature}
                                           :{text:part.text});
          if(on.words) on.words();
        } else if(part.functionCall){
          if(on.tool) on.tool();
          st.raw.push(part.thoughtSignature?{functionCall:part.functionCall,thoughtSignature:part.thoughtSignature}
                                           :{functionCall:part.functionCall});
        } else if(part.thoughtSignature&&st.raw.length){
          /* A signature can arrive in a chunk of its own, with neither text nor
             a call attached. It belongs to the part before it. */
          st.raw[st.raw.length-1].thoughtSignature=part.thoughtSignature;
        }
      }
    }
  };
  return st;
}
/* The calls among the parts, in order. Gemini gives a call no id; the page's
   loop wants one to carry a result back by, so each is given one here. */
function geminiCalls(raw){
  return raw.filter(p=>p.functionCall).map(p=>({
    id:'call_'+Math.random().toString(36).slice(2),
    name:p.functionCall.name, input:p.functionCall.args||{}}));
}
/* Gemini correlates a tool result to its call by name and position rather
   than by an id, so this pushes the model's own parts back verbatim and
   answers with functionResponse parts. The OpenAI-shaped alternative — an
   assistant message carrying tool_calls, then one role:'tool' message per
   call — left with the second provider. */
function pushToolExchange(wire,turn,results){
  {
    /* Gemini correlates a functionResponse to its call by name and by
       position, not by an id — there is nothing here to carry one. */
    /* A floor under the signature rule. Gemini 3 validates that the FIRST
       functionCall part of a step carries its signature; if one never arrived
       — an older model on the same key, a part reassembled oddly, a thread
       resumed from somewhere this app did not see — the request 400s and the
       conversation dies mid-tool-call. Google publishes an explicit opt-out
       token for calls it did not generate. It costs some model performance and
       is documented as a last resort, which is exactly what this is: a wrong
       signature is refused, a missing one is fatal, and a slightly worse
       answer beats a dead thread. */
    const parts=turn.raw.slice();
    const firstCall=parts.findIndex(p=>p.functionCall);
    if(firstCall>=0&&!parts[firstCall].thoughtSignature){
      parts[firstCall]=Object.assign({},parts[firstCall],
        {thoughtSignature:'skip_thought_signature_validator'});
    }
    wire.push({role:'model',parts});
    wire.push({role:'user',parts:results.map(r=>({functionResponse:{name:r.name,response:{content:r.content}}}))});
  }
}

root.ApexWire = { SEND: APEX_SEND, KEEP: APEX_KEEP, wire: apexWire, trim: apexTrim,
  gemini: { url: gemUrl, headers: gemHeaders, tools: toGeminiTools, parts: geminiParts, contents: toGeminiContents,
            request: geminiRequest, plain: geminiPlain, text: geminiText, reader: geminiReader, calls: geminiCalls,
            exchange: pushToolExchange } };

})(typeof window !== 'undefined' ? window : this);
