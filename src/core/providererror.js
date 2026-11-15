/* ═════════════════════════════════════════════
   providererror.js — what the fellow is told when the model provider refuses a request.

   A refused request comes back as a status, sometimes a header, and a body nobody here controls. What is
   said about it decides what the fellow does next: re-enter a key, wait, check billing, press Connect, or
   tell whoever runs the site. A wrong sentence has cost an evening more than once (a quota read as a bad
   key, a relay's refusal read as the fellow's own). This is that decision and nothing else: no fetch, no
   DOM, no clock of its own.

     errMsg(j)                                    the provider's own words, out of whichever shape the body took
     message(r, provider, j, viaRelay, e, now)    the sentence to show
       r          the response, read only for r.status and r.headers.get('retry-after')
       provider   'gemini'
       j          the response's body as JSON, or null when it was not JSON
       viaRelay   r → whether the response came from this site's own relay rather than from the provider
       e          the page's escaper; the provider's words are written into HTML
       now        () → the time in ms, used only to turn a Retry-After date into seconds

   It was app/systole.html's errMsg() and the body of its apiError() until it moved here (docs/ROADMAP.md,
   E1), unchanged but for now() standing where Date.now() did. The page's apiError(r, provider) reads the
   body and calls message(). viaRelay and now are called only on the branches that called them before, so
   a response is read exactly as it was. tests/verify-providererror-pure.js holds it.

   ES2015, and one thing past it: errMsg() uses ?? (ES2020, Safari 13.1). Safari 13.4 is the floor (README).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

/* Gemini says {error:{message}}. The other shapes — {message} or {detail} at
   the top level, either possibly an object rather than a string — are kept
   because an error body is the one response nobody controls, and reading a
   shape that never arrives costs nothing. Take the first that is there. */
function errMsg(j){
  if(!j||typeof j!=='object') return '';
  const m = (j.error&&j.error.message) ?? j.message ?? j.detail;
  if(typeof m==='string') return m;
  if(m==null) return '';
  try{ return JSON.stringify(m).slice(0,300); }catch(_){ return ''; }
}

function message(r, provider, j, viaRelay, e, now) {
  const d=errMsg(j), detail=JSON.stringify(j&&j.error&&j.error.details||[]);
  const name='Gemini';
  const account=viaRelay(r)?'the hosted key’s project':'your key’s project';
  if((r.status===401||r.status===403)&&viaRelay(r)) return `This site refused to pass the request to Gemini${d?': '+e(d):'.'}`;
  if(r.status===401) return 'Your API key was rejected. Tap the settings icon to re-enter it.';
  if(r.status===403&&provider==='gemini'){
    if(/api key not valid|key.*(?:blocked|leaked|revoked)/i.test(d)) return 'Your API key was rejected or blocked. Check its status in Google AI Studio and replace it if necessary.';
    return 'Google denied permission. Check the project’s API access, key restrictions and free-tier eligibility in Google AI Studio. A new key in the same project may not resolve this.';
  }
  if(r.status===400&&provider==='gemini'&&/api key not valid/i.test(d)) return 'Your API key was rejected. Tap the settings icon to re-enter it.';
  if(r.status===402) return `Check billing, prepaid balance and spending limits for ${account} in Google AI Studio. Repeated retries will not restore credit.`;
  if(r.status===429){
    const evidence=d+' '+detail;
    if(/per.?day|daily/i.test(evidence)) return `Gemini's daily quota was reached for ${account}. Daily request quotas reset at midnight Pacific time. Check the affected model’s limits in Google AI Studio; creating another key in the same project does not reset them.`;
    if(/billing|credit|balance|limit:\s*0\b/i.test(evidence)) return `Gemini has no available allowance for ${account}. Check billing, balance and the model’s active quota in Google AI Studio before retrying.`;
    let seconds=null;
    const h=r.headers&&r.headers.get('retry-after');
    if(h!==null&&h!==undefined){const n=Number(h);seconds=Number.isFinite(n)?n:(Date.parse(h)-now())/1000;}
    if(seconds===null){
      const info=j&&j.error&&Array.isArray(j.error.details)&&j.error.details.find(x=>/RetryInfo$/.test(x&&x['@type']||''));
      const m=info&&String(info.retryDelay||'').match(/^(\d+(?:\.\d+)?)s$/);
      if(m) seconds=Number(m[1]);
    }
    const wait=Number.isFinite(seconds)&&seconds>0?` Wait at least ${Math.ceil(seconds)} seconds before trying again.`:' Check the active limit before retrying; its reset time depends on the limit.';
    if(viaRelay(r)&&/Too many requests in a minute/i.test(d)) return 'This site’s request limit was reached. Pause before asking again; replacing your Gemini key will not fix this site limit.';
    return `Gemini’s quota or rate limit was reached for ${account}.`+wait+' Multiple keys in one project share quota.';
  }
  if(r.status>=500&&viaRelay(r)&&/GEMINI_API_KEY|ACCESS_AUD|ACCESS_TEAM_DOMAIN|APEX_MODELS|signing keys/i.test(d)) return 'This site’s Apex relay needs attention. Ask the site owner to check its Gemini secret, Access configuration and model settings. Re-entering a personal key is not required to repair the hosted service.';
  if(r.status===400&&/credit|balance/i.test(d)) return `Your ${name} account is out of credit.`;
  /* Pointing at the model menu is useless when every name in it is stale —
     which is the normal case once Google retires a generation. Pressing
     Connect is what rebuilds the menu from the live list. */
  if(r.status===404&&provider==='gemini') return 'Google does not offer that model to your key. Open settings and press <b>Connect</b> again — the app will ask Google for the current list and pick one that works.';
  if(r.status===404) return `That model is not available on ${name} right now — pick a different one in settings.`;
  if(r.status>=500) return `${name} is temporarily unavailable. Try again shortly, or choose another available model in Apex settings.`;
  return `API error ${r.status}. ${e(d)}`;
}

root.ProviderError = { errMsg, message };

})(typeof window !== 'undefined' ? window : this);
