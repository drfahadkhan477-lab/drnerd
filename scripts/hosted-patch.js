#!/usr/bin/env node
/*
 * Gemini moves behind the Worker; Groq and Anthropic stay in your hands.
 *
 *   node scripts/hosted-patch.js <input.html> <output.html>
 *
 * Until now every request left the iPad carrying a key the fellow pasted in.
 * For one person using their own key that is fine, and it is why the app was
 * built that way. It stops being fine the moment the app is meant to be opened
 * by someone who should not have to hold a secret to use it.
 *
 * So exactly one provider moves: Gemini, the one with a free tier that reads
 * figures. Its key lives in Cloudflare and the app talks to /api/apex instead.
 * Groq and Anthropic are not touched — five of the eight provider call sites in
 * this app keep working precisely as they did, which is also five fewer things
 * this patch can break.
 *
 * BRING-YOUR-OWN-KEY DOES NOT GO AWAY. It is not sentiment: systole.html is a
 * single file with no server behind it, so removing key entry would kill Apex
 * there outright. And when the Worker is misconfigured, or the daily quota is
 * gone, a pasted key is the way back in. So the rule is narrow —
 *
 *     a key you typed always wins; hosted is what happens when there isn't one.
 *
 * — which also means the file:// build never looks for a server that cannot
 * exist there.
 *
 * THE SESSION THAT LAPSES WITHOUT SAYING SO. Cloudflare Access answers an
 * expired session with 200 OK and an HTML sign-in page. That is the same shape
 * that silently poisoned the figure cache last week, and here it is worse:
 * apiError() reads the body as JSON, so an HTML login page would be swallowed
 * and reported as an empty error. Every hosted response is therefore checked
 * for its content type BEFORE anything reads it.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/hosted-patch.js <input.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. the seam ─────────────────────────────────────────────────────────── */
patch('hosted: one place that decides whether a key is needed at all',
`function cur(){ return AI[AI.provider]; }`,
`function cur(){ return AI[AI.provider]; }

/* ═══════════ Gemini, hosted ═══════════
   A key you typed always wins. Hosted is what happens when there isn't one —
   and only where a server can exist, which is never the single-file build. */
const APEX_API='/api/apex/gemini';
function apexHosted(){
  try{
    if(location.protocol==='file:') return false;
    return !(AI.gemini&&AI.gemini.key);
  }catch(_){ return false; }
}
/* BYOK → Google directly, exactly as before. Hosted → the Worker, which
   attaches the secret. op is 'stream' | 'generate' | 'models'. */
function gemUrl(op,model,key){
  if(key) return op==='models'
    ? \`\${ENDPOINT.gemini}?pageSize=200\`
    : \`\${ENDPOINT.gemini}/\${model}:\${op==='stream'?'streamGenerateContent?alt=sse':'generateContent'}\`;
  return op==='models' ? \`\${APEX_API}/models\`
                       : \`\${APEX_API}/\${op}?model=\${encodeURIComponent(model||'')}\`;
}
function gemHeaders(key,post){
  const h=post?{'content-type':'application/json'}:{};
  if(key) h['x-goog-api-key']=key;      // hosted requests carry no secret at all
  return h;
}
/* Cloudflare Access answers a lapsed session with 200 OK and a sign-in page.
   Checked before anything reads the body, because apiError() parses it as JSON
   and would report the login page as an empty error. */
function apexSessionLapsed(r){
  if(!r) return false;
  const ct=(r.headers&&r.headers.get('content-type')||'').toLowerCase();
  return ct.indexOf('text/html')===0;
}
const APEX_LAPSED='Your session has expired. Reload the page, sign in again, and ask once more.';`);

/* ── 2. the four Gemini call sites ───────────────────────────────────────── */
patch('hosted: validating a key is still a key thing, but the route moves',
`  if(p==='gemini'){
    return fetch(\`\${ENDPOINT.gemini}/\${model}:generateContent\`,{method:'POST',
      headers:{'content-type':'application/json','x-goog-api-key':k},
      body:JSON.stringify({contents:[{role:'user',parts:[{text:'hi'}]}],
        generationConfig:{maxOutputTokens:1}})});
  }`,
`  if(p==='gemini'){
    return fetch(gemUrl('generate',model,k),{method:'POST',
      headers:gemHeaders(k,true),
      body:JSON.stringify({contents:[{role:'user',parts:[{text:'hi'}]}],
        generationConfig:{maxOutputTokens:1}})});
  }`);

patch('hosted: the model menu is built from whichever key is in play',
`r=await fetch(\`\${ENDPOINT.gemini}?pageSize=200\${pageToken?'&pageToken='+encodeURIComponent(pageToken):''}\`,
        {headers:{'x-goog-api-key':key}});`,
`r=await fetch(gemUrl('models','',key)+(pageToken?'&pageToken='+encodeURIComponent(pageToken):''),
        {headers:gemHeaders(key,false)});`);

patch('hosted: the streamed turn, which is the one that matters',
`  const r=await fetch(\`\${ENDPOINT.gemini}/\${model}:streamGenerateContent?alt=sse\`,{
    method:'POST', signal:aiAbort.signal,
    headers:{'content-type':'application/json','x-goog-api-key':cur().key},`,
`  const r=await fetch(gemUrl('stream',model,cur().key),{
    method:'POST', signal:aiAbort.signal,
    headers:gemHeaders(cur().key,true),`);

patch('hosted: and the session summariser',
`      const r=await fetch(\`\${ENDPOINT.gemini}/\${model}:generateContent\`,{method:'POST',
        headers:{'content-type':'application/json','x-goog-api-key':k},`,
`      const r=await fetch(gemUrl('generate',model,k),{method:'POST',
        headers:gemHeaders(k,true),`);

/* ── 3. a lapsed session must not be reported as an empty error ──────────── */
patch('hosted: say what actually happened when Access logs you out',
`  if(!r.ok) throw new Error(await apiError(r,'gemini'));`,
`  if(apexSessionLapsed(r)) throw new Error(APEX_LAPSED);
  if(!r.ok) throw new Error(await apiError(r,'gemini'));`);

/* ── 4. no key needed, so no setup screen ────────────────────────────────── */
patch('hosted: the panel opens straight into the conversation',
`  if(!cur().key) { wrap.innerHTML=head+setupHtml(); bindSetup(); mountApexAvatar(); return; }`,
`  /* Hosted Gemini needs nothing typed, so the setup screen would be a door
     with no lock on it. Every other provider still asks. */
  if(!cur().key && !(AI.provider==='gemini' && apexHosted())) {
    wrap.innerHTML=head+setupHtml(); bindSetup(); mountApexAvatar(); return; }`);

/* ── 5. and the footer stops claiming a key it does not have ─────────────── */
patch('hosted: the footer says where the key actually is',
`· your own key, called directly from this device</div></div>\`;`,
`· \${(AI.provider==='gemini'&&apexHosted())
        ?'hosted key, called through this site'
        :'your own key, called directly from this device'}</div></div>\`;`);

/* Pre-existing, and newly visible: the label comes from MODELS[provider], and a
   model discovered from ListModels is not in that static list, so the footer
   read "Powered by —". In hosted mode there is no Connect step to populate the
   menu before the first answer, so it would say that on the very first turn. */
patch('hosted: name the model even when it is not in the built-in list',
`Powered by <b>\${e((MODELS[AI.provider].find(m=>m[0]===cur().model)||['','\u2014'])[1].split(' \u2014 ')[0])}</b>`,
`Powered by <b>\${e(((MODELS[AI.provider]||[]).find(m=>m[0]===cur().model)||['',cur().model||'\u2014'])[1].split(' \u2014 ')[0])}</b>`);

fs.writeFileSync(OUT, html);
console.log(`Gemini, hosted — ${applied.length} edits applied`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
