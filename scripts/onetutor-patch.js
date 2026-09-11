#!/usr/bin/env node
/*
 * The second tutor leaves; one provider, one wire shape.
 *
 *   node scripts/onetutor-patch.js <in.html> <out.html>
 *
 * ASKED FOR, AFTER AN AUDIT. Neither was broken. Both were surface the owner
 * decided the app does not need, and the audit that preceded this found no
 * dead code at all — so this is the only kind of removal left: features that
 * work, that somebody has to maintain, and that nobody uses.
 *
 * WHY A LATE STEP RATHER THAN DELETING THE EARLY ONES. The chain is 78 steps
 * of exact-match patches, and a step's find-string frequently depends on text
 * an earlier step inserted. Deleting `mistral` (step 47) or `assets` (step 27)
 * in place would strand every later step that anchors on their output. The
 * chain already solved this twice — step 20 removes the Rhythm Lab's 3D heart
 * and step 53 removes the Signal/Focus/Grid switcher, both late, both for this
 * reason — and the note beside step 20 says it plainly: late, so what it
 * deletes is final.
 *
 * WHY MARKERS RATHER THAN WHOLE-BLOCK FIND STRINGS. These removals are
 * hundreds of lines each. A find-string that long is not a safety property, it
 * is a transcription exercise that fails on a re-indent. cut() takes a unique
 * opening needle and a unique closing one and removes the span between them,
 * asserting both are unique first — then the guards at the bottom assert the
 * IDENTIFIERS are gone from the whole document, which is the property that
 * actually matters and which no amount of careful transcription would prove.
 *
 * WHAT GOES WITH THE IMPORTER, and it is worth knowing before running this:
 * the button read "Import .md / .txt / .zip", and it imported reference notes
 * as well as chapters. Removing it removes both. The corpus is seeded through
 * the build chain (content/refs), notes can still be written in the app by
 * hand, and refExport() still writes them out — but a markdown file can no
 * longer be read in on the device.
 *
 * WHAT STAYS BEHIND FROM MISTRAL. The provider machinery keeps its shape:
 * PROVIDERS, ENDPOINT, KEY_PREFIX and MODELS remain maps, now with one entry.
 * Collapsing them into bare Gemini constants would be a far larger diff
 * through the settings screen, the key handling and the error paths, for no
 * behaviour anyone can see — and it would have to be undone the day a second
 * provider is wanted again.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/onetutor-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
let removed = 0;

function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  removed += find.length - replace.length;
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* Remove everything from `open` to the end of `close`. Both must be unique in
   the document; `backTo`, when given, extends the cut backwards to the nearest
   occurrence of it before `open` (used to take a module's banner comment with
   the module). */
function cut(label, open, close, backTo) {
  const opens = html.split(open).length - 1;
  if (opens !== 1) throw new Error(`[${label}] opening marker is not unique (${opens})\n${open.slice(0, 160)}`);
  let i = html.indexOf(open);
  if (backTo) {
    const b = html.lastIndexOf(backTo, i);
    if (b < 0) throw new Error(`[${label}] could not extend the cut back to ${JSON.stringify(backTo)}`);
    i = b;
  }
  const j = html.indexOf(close, i);
  if (j < 0) throw new Error(`[${label}] closing marker never appears after the opening one\n${close.slice(0, 160)}`);
  if (html.indexOf(close, j + close.length) !== -1 && html.split(close).length - 1 !== 1) {
    throw new Error(`[${label}] closing marker is not unique`);
  }
  const n = (j + close.length) - i;
  removed += n;
  html = html.slice(0, i) + html.slice(j + close.length);
  applied.push(`${label}  (−${(n / 1024).toFixed(1)} KB)`);
}

/* ═══════════════════ 2. the second tutor ═══════════════════ */

patch('onetutor: Mistral is not a vision provider, because it is not a provider',
`const VISION_PROVIDERS = { gemini: true, mistral: true };`,
`const VISION_PROVIDERS = { gemini: true };`);

patch('onetutor: no Mistral key or model is kept',
`  mistral:{key:'',model:''}};`,
`};`);

patch('onetutor: Mistral leaves the provider list',
`  ['mistral','Mistral','free — sees figures',"No card, but activate the free Experiment plan first: console.mistral.ai → Billing → Experiment. Then create a key under API Keys."]
];`,
`];`);

patch('onetutor: and its placeholder model',
`  mistral:[['pixtral-large-latest','Pixtral Large']]`, '');

patch('onetutor: its key prefix',
`const KEY_PREFIX={gemini:['AQ.','AIza'],mistral:''};`,
`const KEY_PREFIX={gemini:['AQ.','AIza']};`);

/* The wire code itself. De-registering Mistral without this would leave the
   whole client shipped and unreachable — which is precisely the dead code the
   audit went looking for and did not find. */

patch('onetutor: one provider needs no dispatch',
`function oneTurn(q,wire,extra){
  return AI.provider==='gemini' ? oneTurnGemini(q,wire,extra)
       : oneTurnMistral(q,wire,extra);
}`,
`function oneTurn(q,wire,extra){
  return oneTurnGemini(q,wire,extra);
}`);

patch('onetutor: a key is validated against the one endpoint there is',
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
}`,
/* p is kept in the signature: every caller passes it, and a one-provider app
   is not a promise that it stays that way. */
`function validateKey(p,k,model){
  return fetch(gemUrl('generate',model,k),{method:'POST',
    headers:gemHeaders(k,true),
    body:JSON.stringify({generationConfig:{maxOutputTokens:1},
      contents:[{role:'user',parts:[{text:'hi'}]}]})});
}`);

/* THE TOOL EXCHANGE LOSES ITS OTHER HALF. The else branch built the
   OpenAI-shaped assistant/tool message pair, which nothing now speaks. The
   Gemini branch is not merely the surviving one — the comments inside it are
   the reasoning that keeps a tool call alive across a turn, so it is lifted
   out whole rather than retyped. */
patch('onetutor: the tool exchange speaks one wire shape',
`function pushToolExchange(wire,turn,results){
  if(AI.provider==='gemini'){
    /* Gemini correlates`,
`function pushToolExchange(wire,turn,results){
  {
    /* Gemini correlates`);

patch('onetutor: and the shape nothing speaks any more goes',
`    wire.push({role:'user',parts:results.map(r=>({functionResponse:{name:r.name,response:{content:r.content}}}))});
  } else {
    wire.push({role:'assistant',content:turn.text||null,
      tool_calls:turn.calls.map(c=>({id:c.id,type:'function',
        function:{name:c.name,arguments:JSON.stringify(c.input)}}))});
    for(const r of results) wire.push({role:'tool',tool_call_id:r.id,content:r.content});
  }
}`,
`    wire.push({role:'user',parts:results.map(r=>({functionResponse:{name:r.name,response:{content:r.content}}}))});
  }
}`);

patch('onetutor: the endpoint map and the model cache lose their second entry',
`const ENDPOINT={gemini:'https://generativelanguage.googleapis.com/v1beta/models',
                mistral:'https://api.mistral.ai/v1'};
/* The live list, once discovered, outlives the tab — same rule as Gemini's,
   see GEM_MODELS_KEY below. */
const MISTRAL_MODELS_KEY='accsap12.mistral.models';
try{
  const cached=JSON.parse(localStorage.getItem(MISTRAL_MODELS_KEY)||'null');
  if(Array.isArray(cached)&&cached.length) MODELS.mistral=cached;
}catch(_){}`,
`const ENDPOINT={gemini:'https://generativelanguage.googleapis.com/v1beta/models'};`);

patch('onetutor: nothing discovers Mistral models',
`  mistral:{fn:(k)=>mistralModels(k), cacheKey:MISTRAL_MODELS_KEY, pickDefault:mistralDefaultModel,
    askMsg:'Asking Mistral which models this key can use…', vendor:'Mistral',
    hint:'Make sure the free Experiment plan is activated under Billing at console.mistral.ai — a key on an account that never selected a plan cannot reach any model.'},
`, '');

/* Ends at the CLOSING BRACE of mistralDefaultModel, not at its signature. The
   first version of this cut used the signature as its closing needle and left
   the body — `return (small||models[0])[0];}` — sitting at the top level of
   the script, which the parser rejects with "Illegal return statement" and the
   whole app fails to boot. The same slip appeared twice in this step; both are
   the same lesson, that a closing needle has to close something. */
cut('onetutor: the Mistral model discovery',
    `/* Ask Mistral what this key can actually reach. Simpler than Gemini's`,
    `function mistralDefaultModel(models){
  const small=models.find(m=>/small/i.test(m[0]));
  return (small||models[0])[0];
}`);

/* TWO CUTS, NOT ONE, AND THE GAP BETWEEN THEM IS THE POINT. makeStreamPainter
   sits between toMistralMessages and oneTurnMistral, and it is SHARED — the
   Gemini turn paints its stream with it too. A single span from the wire-shape
   comment to the closing note swallowed it, and the whole tool round trip then
   failed with "makeStreamPainter is not defined". Neighbouring code is not
   related code.

   Each cut also ends at a closing brace or a closing comment, never at an
   opening signature: an earlier version stopped at `async function
   oneTurnMistral(...){` and left the body as orphaned statements, which the
   parser rejects outright. */
cut('onetutor: the Mistral wire shape',
    `   Mistral's image_url shape. Unlike Gemini, plain string content is valid`,
    `function toMistralMessages(wire){
  return wire.map(m=>{
    const parts=mistralParts(m.content);
    return parts===m.content ? m : Object.assign({},m,{content:parts});
  });
}`,
    `/* `);

cut('onetutor: and its one turn, leaving the painter both turns share',
    `async function oneTurnMistral(q,wire,extra){`,
    `   about the parsing above needed to change for the provider it now serves. */`);

patch('onetutor: the one-shot completion has one shape to take',
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
    return (((j.choices||[])[0]||{}).message||{}).content||'';`,
`    const r=await fetch(gemUrl('generate',model,k),{method:'POST',
      headers:gemHeaders(k,true),
      body:JSON.stringify({generationConfig:{maxOutputTokens:maxTokens},
        contents:[{role:'user',parts:[{text:prompt}]}]})});
    if(!r.ok) return '';
    const j=await r.json();
    const parts=((j.candidates||[])[0]||{}).content;
    return ((parts&&parts.parts)||[]).map(x=>x.text||'').join('');`);

patch('onetutor: one error message needs no vendor guess',
`  const name=provider==='gemini'?'Gemini':'Mistral';`,
`  const name='Gemini';`);

/* ═══════════════════ 3. the prose that is now untrue ═══════════════════ */
/* Not tidying. In this codebase the comments carry the reasoning, so a comment
   describing a branch that no longer exists is worse than no comment: the next
   reader trusts it and goes looking for code that is not there. Each of these
   made a claim that this step falsified. */

patch('onetutor: the vision note stops describing two providers',
`   2. It never claims a provider can see when it cannot. Both providers this
      app offers now are vision-capable — Mistral's model menu is filtered at
      discovery time to models with capabilities.vision, so nothing without
      it ever reaches the dropdown. The false branch and its "describe it to
      me" fallback stay in VISION_PROVIDERS regardless: correct, cheap, and`,
`   2. It never claims a provider can see when it cannot. The one provider this
      app offers is vision-capable. The false branch and its "describe it to
      me" fallback stay in VISION_PROVIDERS regardless: correct, cheap, and`);

patch('onetutor: the provider guard stops naming a branch that no longer exists',
`/* Known, not merely present: a config can carry a slot for a provider this
   build has no code path for, and "it has a slot" would happily keep it —
   leaving oneTurn() to fall through to the Mistral branch with a key that is
   not a Mistral key. The set of real providers is the keys of AI_DEFAULT. */`,
`/* Known, not merely present: a config can carry a slot for a provider this
   build has no code path for — a stored 'mistral' from a build before that
   provider was removed is exactly such a slot — and "it has a slot" would
   happily keep it, leaving oneTurn() to send a key of one vendor to another.
   The set of real providers is the keys of AI_DEFAULT. */`);

patch('onetutor: the placeholder note stops saying "both"',
`  /* Placeholders only — Connect replaces both with the live list. Mistral's
     lineup changes often enough that shipping a guessed id here would be the
     same "stale model" bug Gemini's discovery was built to stop happening. */`,
`  /* A placeholder only — Connect replaces it with the live list, because
     shipping a guessed id is the "stale model" bug Gemini's discovery was
     built to stop happening. */`);

patch('onetutor: and the key-prefix note goes with the prefix it explained',
`/* Mistral keys are opaque — no recognisable prefix like Groq's gsk_ or
   Anthropic's sk-ant-. '' makes the "does this look like the right kind of
   key" gate a no-op for it (k.startsWith('') is always true): the real check
   is the live API call in validateKey/Connect, same as it always was. */`,
`/* A prefix is a hint, not a gate: the real check is the live API call in
   validateKey/Connect, same as it always was. A provider whose keys carry no
   recognisable prefix would sit here as '', since k.startsWith('') is always
   true. */`);

patch('onetutor: the tool-exchange note describes the branch that survived',
`/* OpenAI-shaped APIs (Mistral) want a distinct assistant message carrying
   tool_calls, then one role:'tool' message per call — exactly what the else
   branch below already builds, unchanged from when it served Groq. */`,
`/* Gemini correlates a tool result to its call by name and position rather
   than by an id, so this pushes the model's own parts back verbatim and
   answers with functionResponse parts. The OpenAI-shaped alternative — an
   assistant message carrying tool_calls, then one role:'tool' message per
   call — left with the second provider. */`);

patch('onetutor: the error-shape note stops promising shapes nothing sends',
`/* Gemini/Anthropic: {error:{message}}. Mistral: {message} at the top level,
   or {detail} on a validation error, either of which may be an object rather
   than a string. Take the first that is actually there. */`,
`/* Gemini says {error:{message}}. The other shapes — {message} or {detail} at
   the top level, either possibly an object rather than a string — are kept
   because an error body is the one response nobody controls, and reading a
   shape that never arrives costs nothing. Take the first that is there. */`);

/* ═══════════════════ the guards ═══════════════════ */
/* The find-strings above prove each edit matched something. These prove the
   RESULT: that no identifier from either feature survives anywhere in the
   document, which is the property a reader actually wants and which no amount
   of careful transcription would establish. */
const GONE = ['oneTurnMistral', 'toMistralMessages', 'mistralParts',
              'mistralModels', 'mistralDefaultModel', 'MISTRAL_MODELS_KEY',
              'ENDPOINT.mistral'];
const left = GONE.filter(id => html.indexOf(id) !== -1);
if (left.length) {
  throw new Error('onetutor: these should no longer exist anywhere in the build:\n  ' + left.join('\n  '));
}
/* The one deliberate survivor, asserted so that a later tidy-up cannot quietly
   delete the note explaining what happens to a stored 'mistral' provider from
   a build made before this step existed. */
if (!/a stored 'mistral' from a build before that/.test(html)) {
  throw new Error('onetutor: the note about migrating an older config lost its explanation');
}
/* And what must NOT have gone with them. refExport is the other half of the
   button that was removed; RefAssets still serves figures in the split build. */
/* makeStreamPainter is on this list because it was ALREADY removed once by
   accident: it lives between toMistralMessages and oneTurnMistral, and a
   single span across that neighbourhood took it. Both turns paint through it. */
for (const keep of ['refImportText', 'ZipRead', 'oneTurnGemini', 'pushToolExchange',
                    'makeStreamPainter', 'refImagesForHits']) {
  if (html.indexOf(keep) === -1) throw new Error(`onetutor: ${keep} was removed and should not have been`);
}
applied.push('onetutor: nothing of either feature survives, and nothing else went with them');

fs.writeFileSync(OUT, html);
console.log(`One tutor applied — ${applied.length} edits, ${(removed / 1024).toFixed(1)} KB removed`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
