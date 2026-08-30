#!/usr/bin/env node
/*
 * The panel keeps what you typed, where you were reading, and its head.
 *
 *   node scripts/chatfix-patch.js <input.html> <output.html>
 *
 * Four things, all in buildAI() and streamReply(), all felt rather than
 * theorised:
 *
 * 1. THE COMPOSER WAS WIPED MID-REPLY. buildAI() sets wrap.innerHTML, which
 *    destroys #aiIn — and it runs after every tool step. Start typing a
 *    follow-up while Apex is working and it disappeared under your hands. The
 *    text, the caret and the grown height are now carried across the rebuild.
 *
 * 2. THE SCROLL WAS YANKED TO THE BOTTOM. bindChat ended with an unconditional
 *    scrollTop = scrollHeight, and so does every streaming tick. Scroll up to
 *    re-read the paragraph Apex is expanding on and the next token dragged you
 *    away from it. Now it only sticks to the bottom if you were already there —
 *    the rule every chat client uses, and the one people notice the absence of.
 *
 * 3. THE THREAD ONLY EVER GREW. Every message was re-sent on every turn and
 *    kept forever in localStorage. A long conversation about one question got
 *    slower and more expensive with each exchange for no benefit, and
 *    accsap12.chat had no ceiling at all. The wire now carries a window, and
 *    says so in it rather than silently dropping the past.
 *
 *    THE CUT IS MADE ON A USER TURN, DELIBERATELY. Anthropic rejects two
 *    assistant turns in a row; a window that happened to start on an assistant
 *    reply would turn a long conversation into an HTTP 400 — the failure would
 *    arrive exactly when the fix was doing its job.
 *
 * 4. A CORRUPTED CONFIG TOOK THE WHOLE PANEL DOWN. PROVIDERS.find(…)[1] with no
 *    guard, on a line whose neighbour already reads MODELS[AI.provider]||[] for
 *    exactly this reason. An unknown provider threw before anything rendered,
 *    so there was no settings screen left to fix it from. The provider is now
 *    normalised where it is loaded — the root cause — and the two direct
 *    indexings are guarded anyway.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/chatfix-patch.js <input.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}
function patchAll(label, find, replace, expected) {
  const n = html.split(find).length - 1;
  if (n !== expected) throw new Error(`[${label}] expected exactly ${expected} matches, found ${n}`);
  html = html.split(find).join(replace);
  applied.push(`${label} (${n})`);
}

/* ── 1. a provider that is not a provider ────────────────────────────────── */
patch('chatfix: an unknown provider cannot take the panel down',
`let CHATS = loadJSON(AI_CHAT,{});`,
`/* A stored config naming a provider this build does not have — a downgrade, a
   hand-edited backup, a half-written localStorage entry — used to throw inside
   buildAI() before anything rendered, which left no settings screen to correct
   it from. Normalise once, here, where the config is loaded: every provider
   this build knows about gets a slot, and the selected one is guaranteed to be
   one of them. The gemini fix above is the same repair done for one case. */
if(!AI || typeof AI!=='object') AI={};
let aiFixed=false;
for(const p of Object.keys(AI_DEFAULT)){
  if(p==='provider') continue;
  if(!AI[p] || typeof AI[p]!=='object'){ AI[p]=Object.assign({},AI_DEFAULT[p]); aiFixed=true; }
}
/* Known, not merely present: a config can carry a slot for a provider this
   build has no code path for, and "it has a slot" would happily keep it —
   leaving oneTurn() to fall through to the Groq branch with a key that is not
   a Groq key. The set of real providers is the keys of AI_DEFAULT. */
if(AI.provider==='provider' || !AI_DEFAULT[AI.provider]){ AI.provider=AI_DEFAULT.provider; aiFixed=true; }
if(aiFixed) saveJSON(AI_CFG,AI);
let CHATS = loadJSON(AI_CHAT,{});`);

/* ── 2. the panel's own state, carried across the rebuild ────────────────── */
patch('chatfix: what the panel was holding before it was replaced',
`function chatFor(q){ const k=q?q.id:'_general'; return CHATS[k]||(CHATS[k]=[]); }`,
`function chatFor(q){ const k=q?q.id:'_general'; return CHATS[k]||(CHATS[k]=[]); }

/* ═══════════ what survives a rebuild ═══════════
   buildAI() replaces the whole panel, and it runs after every tool step. These
   two carry across the parts of it that belong to you rather than to the app:
   the sentence you were part-way through typing, and the place you had scrolled
   to. Without them, working through a long answer while Apex used a tool meant
   losing both, several times per question. */
const APEX_STICK=40;         // px of slack — "at the bottom" is not an exact number
function apexAtBottom(el){
  return !el || (el.scrollHeight - el.scrollTop - el.clientHeight) < APEX_STICK;
}
function apexPanelState(){
  const ta=document.getElementById('aiIn'), body=document.getElementById('aiBody');
  return { text: ta?ta.value:'', start: ta?ta.selectionStart:0, end: ta?ta.selectionEnd:0,
           focus: !!ta && document.activeElement===ta,
           top: body?body.scrollTop:0, pinned: apexAtBottom(body) };
}
function apexPanelRestore(st){
  if(!st) return;
  const ta=document.getElementById('aiIn'), body=document.getElementById('aiBody');
  if(ta && st.text){
    ta.value=st.text;
    /* Height is grown by the input handler, which has not run on this element
       yet — set it here or a multi-line draft comes back one line tall. */
    ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,120)+'px';
    if(st.focus){ try{ ta.focus(); ta.setSelectionRange(st.start,st.end); }catch(_){} }
  }
  if(body) body.scrollTop = st.pinned ? body.scrollHeight : st.top;
}
/* Used by every streaming tick as well: a reply arriving is not a reason to
   move someone who is reading something further up. */
function apexStick(body){ if(body && apexAtBottom(body)) body.scrollTop=body.scrollHeight; }`);

patch('chatfix: capture it on the way in',
`function buildAI(){
  const wrap=document.getElementById('ai'); if(!wrap)return;`,
`function buildAI(){
  const wrap=document.getElementById('ai'); if(!wrap)return;
  const panelWas=apexPanelState();`);

patch('chatfix: and put it back on the way out',
`  wrap.querySelectorAll('[data-jump]').forEach(b=>b.onclick=()=>peekQuestion(b.dataset.jump));
  bindChat(q);
  mountApexAvatar();
}`,
`  wrap.querySelectorAll('[data-jump]').forEach(b=>b.onclick=()=>peekQuestion(b.dataset.jump));
  bindChat(q);
  apexPanelRestore(panelWas);
  mountApexAvatar();
}`);

patch('chatfix: stop bindChat forcing the bottom',
`  const body=document.getElementById('aiBody'); if(body)body.scrollTop=body.scrollHeight;
}`,
`  /* Scroll is restored by apexPanelRestore, which knows whether you were at
     the bottom. Forcing it here would undo that on every rebuild. */
}`);

patchAll('chatfix: and every streaming tick asking the same',
`if(body)body.scrollTop=body.scrollHeight;`, `apexStick(body);`, 3);

/* ── 3. the panel's chips belong to the panel ────────────────────────────── */
patch('chatfix: the chips are the panel\'s, not the document\'s',
`  document.querySelectorAll('[data-chip]').forEach(b=>b.onclick=()=>{`,
`  const panel=document.getElementById('ai')||document;
  panel.querySelectorAll('[data-chip]').forEach(b=>b.onclick=()=>{`);

/* ── 4. the two unguarded lookups ────────────────────────────────────────── */
patch('chatfix: name the provider without assuming it exists',
`on \${e(PROVIDERS.find(p=>p[0]===AI.provider)[1])} ·`,
`on \${e((PROVIDERS.find(p=>p[0]===AI.provider)||['',AI.provider])[1])} ·`);

patch('chatfix: and in the setup screen too',
`    const p=AI.provider, name=PROVIDERS.find(x=>x[0]===p)[1];`,
`    const p=AI.provider, name=(PROVIDERS.find(x=>x[0]===p)||['',p])[1];`);

/* ── 5. a window on the thread, not the whole of it ──────────────────────── */
patch('chatfix: the wire carries a window, and says so',
`/* err turns are the panel's record of a failed request — an expired session,
     a dropped connection — kept in the thread so you can see what happened.
     They are NOT things Apex said, and sending them back as assistant turns
     wrote every network blip permanently into the context of that question. */
  const wire=hist.filter(m=>!m.err).map(m=>({role:m.role,content:m.content}));`,
`const wire=apexWire(hist);`);

patch('chatfix: how that window is chosen',
`async function streamReply(q,hist,extra){`,
`/* ═══════════ how much of a thread rides on a request ═══════════
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
    'request carries. Ask me to recap if you need something from before this.]\\n\\n'+
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
async function streamReply(q,hist,extra){`);

patch('chatfix: trim as the thread is added to',
`  const hist=chatFor(q);
  hist.push({role:'user',content:text});
  saveJSON(AI_CHAT,CHATS);`,
`  const hist=apexTrim(chatFor(q));
  hist.push({role:'user',content:text});
  saveJSON(AI_CHAT,CHATS);`);

/* ── 6. the figure strip is derived once, not on every rebuild ───────────── */
patch('chatfix: do not re-derive the figure strip on every tool step',
`  const figs=(hist.length&&!aiBusy)
    ? refFiguresForHits(hits,3).filter(f=>lastBot.indexOf('refimg://'+f.key)<0)
    : [];`,
`  /* refFiguresForHits walks REF and resolves a data: URL per figure, and the
     strip it feeds is several hundred KB of base64 in the HTML string. buildAI
     runs after every tool step, so all of that was being redone to show a chip.
     Memoised on the only things it depends on. */
  const figKey=hits.map(h=>h.id).join(',')+'|'+lastBot.length+'|'+(aiBusy?1:0);
  if(apexFigMemo.key!==figKey){
    apexFigMemo={ key:figKey, figs:(hist.length&&!aiBusy)
      ? refFiguresForHits(hits,3).filter(f=>lastBot.indexOf('refimg://'+f.key)<0)
      : [] };
  }
  const figs=apexFigMemo.figs;`);

patch('chatfix: somewhere to keep that',
`let apexAv=null;`,
`let apexFigMemo={key:null,figs:[]};
let apexAv=null;`);

fs.writeFileSync(OUT, html);
console.log(`The panel keeps its place — ${applied.length} edits applied`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
