#!/usr/bin/env node
/*
 * Durable memory — what Apex knows about the fellow, kept across sessions.
 *
 *   node scripts/memory-patch.js <input.html> <output.html>
 *
 * Apex already knew how the fellow was SCORING: src/core/profile.js derives a
 * standing from S on every turn. It knew nothing it had been TOLD. Say "I sit
 * boards in October", close the tab, and it is gone — every session opens with
 * a tutor who has never met you.
 *
 * This embeds src/core/memory.js (the store) and wires it into five places.
 *
 * 1. INTO EVERY TURN, VIA aiCtx(). Profile taught the route: aiCtx() is the one
 *    function all three providers call, so appending the memory block beside
 *    profileBlock reaches Anthropic, Groq and Gemini with ZERO per-provider
 *    code. It goes in all three of aiCtx's returns, including the grounded one:
 *    grounded mode restricts what Apex may TEACH FROM, and memory is not source
 *    material, it is who is being taught. A fellow who said "boards in October"
 *    should not have to say it again because they turned grounding on.
 *
 * 2. TWO TOOLS, remember and forget. runTool is synchronous and returns
 *    {result:string}; both are localStorage writes, so they fit that contract
 *    unchanged. forget exists because a memory that has gone stale is worse
 *    than one that was never written, and the fellow should not be the only one
 *    who can correct the record — which is why Memory.build() prints an id
 *    against every line.
 *
 * 3. A SESSION SUMMARY. At the end of a sitting, one small non-streaming call
 *    asks for up to three durable things worth keeping. It cannot reuse the
 *    oneTurn* functions — those are bound to aiCtx and TOOLS — so there is a
 *    small oneShot() with the three provider shapes. It is silent on failure:
 *    a summariser that breaks the results screen is worse than one that skips.
 *
 * 4. A PANEL. Memories are written silently, which is only acceptable if they
 *    are also visible. buildMemory() follows buildRefs() exactly — same screen
 *    dispatch, same card markup, same classes — rather than inventing a second
 *    pattern for a list with delete buttons.
 *
 * 5. THE BACKUP. exportMarkup/importMarkup already round-trip refs, chat and
 *    stats. Memory is user data of the same kind; leaving it out would mean a
 *    restore silently wipes everything Apex knew.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/memory-patch.js <input.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const memory = fs.readFileSync(path.join(ROOT, 'src', 'core', 'memory.js'), 'utf8');

const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. the module ───────────────────────────────────────────────────────────
   Immediately after profile.js, which it is the counterpart to, and before the
   Apex panel that consumes both. */
patch('embed: memory.js, beside the profile it complements',
`/* ══════════════ Apex — cardiology reasoning panel ══════════════ */`,
`/* ══════════════ Durable memory — see src/core/memory.js ══════════════ */
${memory}

/* ══════════════ Apex — cardiology reasoning panel ══════════════ */`);

/* ── 2. into every turn ──────────────────────────────────────────────────── */
patch('context: memory rides beside the profile, in the no-question case',
`  if(!q) return 'The fellow is browsing the question index; no question is open.'
    + ((typeof Profile!=='undefined') ? Profile.build() : '');`,
`  if(!q) return 'The fellow is browsing the question index; no question is open.'
    + ((typeof Profile!=='undefined') ? Profile.build() : '')
    + ((typeof Memory!=='undefined') ? Memory.build() : '');`);

patch('context: compute the memory block once per turn',
`  const profileBlock = (typeof Profile!=='undefined') ? Profile.build() : '';`,
`  const profileBlock = (typeof Profile!=='undefined') ? Profile.build() : '';
  /* Grounded mode restricts what Apex may teach FROM. Memory is not source
     material — it is who is being taught — so it is present in both branches. */
  const memoryBlock = (typeof Memory!=='undefined') ? Memory.build() : '';`);

patch('context: attach memory to the grounded turn',
"(The official ACC commentary for this item is withheld in grounded mode. You can see what is being asked; you may not read the answer key. Teach from the fellow's reference notes below, and if they do not cover it, say so.)\\n\\n${Vision.figureContextLine(q, AI.provider)}${ownBlock}${profileBlock}`;",
"(The official ACC commentary for this item is withheld in grounded mode. You can see what is being asked; you may not read the answer key. Teach from the fellow's reference notes below, and if they do not cover it, say so.)\\n\\n${Vision.figureContextLine(q, AI.provider)}${ownBlock}${profileBlock}${memoryBlock}`;");

patch('context: attach memory to the open turn',
'Use this as the ground truth for the item. You may go well beyond it.${ownBlock}${profileBlock}`;',
'Use this as the ground truth for the item. You may go well beyond it.${ownBlock}${profileBlock}${memoryBlock}`;');

/* ── 3. the two tools ────────────────────────────────────────────────────── */
patch('tools: remember and forget',
` {name:'start_review_session',`,
` {name:'remember',
  description:"Keep one durable fact about this fellow, so you still know it in a month. Use it for things that outlive the current question: their exam date and training year, a confusion they keep repeating across topics, how they like to be taught. Do NOT use it for facts about the item in front of you — the transcript already carries those — and do not ask permission first, just keep it. If something you were told stops being true, call forget and keep the corrected version.",
  input_schema:{type:'object',properties:{
    text:{type:'string',description:'One sentence, written about them in the third person, e.g. "Sitting the boards in October 2026."'},
    kind:{type:'string',enum:['fact','gap','preference'],description:'fact = true about them; gap = a confusion worth pressing on; preference = how they want to be taught'}},
   required:['text']}},
 {name:'forget',
  description:'Delete one memory that has stopped being true. Use the id printed in square brackets beside it in what you know about this fellow.',
  input_schema:{type:'object',properties:{
    id:{type:'string',description:'The bracketed id, e.g. m1a2b3c'}},required:['id']}},
 {name:'start_review_session',`);

patch('tools: run them',
`    if(name==='save_reference_note'){`,
`    if(name==='remember'){
      if(typeof Memory==='undefined') return {result:'Memory is unavailable.'};
      const r=Memory.add(String(input.text||''),String(input.kind||'fact'));
      if(!r) return {result:'Nothing to remember — the text was empty.'};
      toolTrace.push({kind:'mem',text:r.text});
      return {result:\`Kept as [\${r.id}]. You will see this at the top of every future conversation, so do not repeat it back to them now.\`};
    }
    if(name==='forget'){
      if(typeof Memory==='undefined') return {result:'Memory is unavailable.'};
      return {result:Memory.remove(String(input.id||''))
        ? 'Forgotten. It will not appear in future conversations.'
        : 'No memory has that id — it may already be gone.'};
    }
    if(name==='save_reference_note'){`);

patch('tools: label the new ones, and the review session that was never labelled',
`const TOOL_LABEL={search_question_bank:'searching your bank',get_performance:'reading your scores',
  start_quiz:'building a quiz',open_question:'opening a question',save_reference_note:'saving a note'};`,
`const TOOL_LABEL={search_question_bank:'searching your bank',get_performance:'reading your scores',
  start_quiz:'building a quiz',open_question:'opening a question',save_reference_note:'saving a note',
  start_review_session:'opening your review queue',
  remember:'remembering that',forget:'forgetting that'};`);

/* ── 4. the session summary ──────────────────────────────────────────────── */
patch('memory: a one-shot, tool-less call, and the summariser that uses it',
`function toOpenAITools(tools){`,
`/* One non-streaming completion, no tools, no question context. The three
   oneTurn* functions cannot serve this — they are bound to aiCtx() and TOOLS —
   so this carries the three wire shapes in the smallest form that works.
   Returns '' rather than throwing: every caller here is best-effort. */
async function oneShot(prompt,maxTokens){
  const p=AI.provider, k=cur().key, model=cur().model;
  if(!k) return '';
  try{
    if(p==='anthropic'){
      const r=await fetch(ENDPOINT.anthropic,{method:'POST',
        headers:{'content-type':'application/json','x-api-key':k,
          'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
        body:JSON.stringify({model,max_tokens:maxTokens,messages:[{role:'user',content:prompt}]})});
      if(!r.ok) return '';
      const j=await r.json();
      return (j.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
    }
    if(p==='gemini'){
      const r=await fetch(\`\${ENDPOINT.gemini}/\${model}:generateContent\`,{method:'POST',
        headers:{'content-type':'application/json','x-goog-api-key':k},
        body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],
          generationConfig:{maxOutputTokens:maxTokens}})});
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
    return (((j.choices||[])[0]||{}).message||{}).content||'';
  }catch(_){ return ''; }
}

/* Written once at the end of a sitting, never per question. The fellow chose
   to have sessions summarised, but a summary is only worth its API call if
   something happened: a handful of answers, or a real conversation. */
let sessionSummarised=false;
async function summariseSession(){
  if(sessionSummarised) return;
  if(typeof Memory==='undefined') return;
  sessionSummarised=true;
  try{
    if(!cur().key) return;
    const answered=S.sessionTotal||0;
    const turns=Object.values(CHATS||{}).reduce((n,t)=>n+(t?t.length:0),0);
    if(answered<5 && turns<4) return;
    const weak=(typeof Profile!=='undefined'?Profile.weakChapters(3,3):[])
      .map(w=>\`\${w.ch} \${w.pct}%\`).join(', ');
    const talk=Object.values(CHATS||{}).flat().slice(-14)
      .map(m=>\`\${m.role==='user'?'FELLOW':'YOU'}: \${String(m.content||'').slice(0,320)}\`).join('\\n');
    const known=Memory.all().slice(0,20).map(m=>'- '+m.text).join('\\n');
    const out=await oneShot(
\`You are keeping notes on a cardiology fellow you tutor, for your own use next time.
This study session: \${S.sessionCorrect||0}/\${answered} correct\${weak?\`, weakest \${weak}\`:''}.

\${talk?\`What was said:\\n\${talk}\`:'There was no conversation this session.'}

\${known?\`You already know, and must NOT repeat:\\n\${known}\`:''}

Write AT MOST three short lines worth remembering in a month — a persistent
confusion, a stated goal or deadline, a teaching preference they showed. One
sentence each, third person, no bullets, no preamble. Skip anything that is
just this session's score, anything you already know, and anything that will
not still matter in a month. If there is nothing worth keeping, reply with the
single word NOTHING.\`, 220);
    if(!out || /^\\s*NOTHING\\s*$/i.test(out)) return;
    out.split('\\n').map(l=>l.replace(/^[-•*\\d.\\s]+/,'').trim())
      .filter(l=>l.length>12 && !/^NOTHING$/i.test(l))
      .slice(0,3).forEach(l=>Memory.add(l,'session'));
  }catch(_){ /* a broken summariser must never break the results screen */ }
}

function toOpenAITools(tools){`);

patch('memory: summarise when the sitting ends',
`  if(S.qIdx>=S.questions.length-1){S.screen='results';render();}`,
`  if(S.qIdx>=S.questions.length-1){S.screen='results';render();
    try{ summariseSession(); }catch(_){}}`);

/* A new sitting is a new summary. */
patch('memory: a fresh session may be summarised again',
`  S.chStats={};S.missed=new Set();S.sessionCorrect=0;S.sessionTotal=0;`,
`  S.chStats={};S.missed=new Set();S.sessionCorrect=0;S.sessionTotal=0;
  sessionSummarised=false;`);

/* ── 5. the panel ────────────────────────────────────────────────────────── */
patch('memory: the panel, built like the reference library',
`function goRefs(){ S.screen='refs'; refEditing=null; render(); window.scrollTo(0,0); }`,
`function goRefs(){ S.screen='refs'; refEditing=null; render(); window.scrollTo(0,0); }
function goMemory(){ S.screen='memory'; render(); window.scrollTo(0,0); }
function memForget(id){
  if(!confirm('Delete this memory? Apex will stop knowing it.'))return;
  Memory.remove(id); render();
}
function memForgetAll(){
  if(!Memory.count())return;
  if(!confirm('Forget everything Apex knows about you? This cannot be undone.'))return;
  Memory.clear(); render(); toast('Apex has forgotten everything.');
}
/* Written silently during teaching, so this is the only place the fellow can
   see what was kept — and correct it. Same card markup as the note library. */
function buildMemory(){
  const KINDS=[['fact','About you'],['gap','Where you keep going wrong'],
               ['preference','How you like to be taught'],['session','From past sessions']];
  const all=(typeof Memory!=='undefined')?Memory.all():[];
  const groups=KINDS.map(([k,label])=>{
    const rows=all.filter(m=>m.kind===k);
    if(!rows.length) return '';
    return \`<div class="section-label">\${e(label)}</div>\`+rows.map(m=>\`
      <div class="ref-card">
        <div class="ref-top">
          <div class="ref-title" style="font-weight:500">\${e(m.text)}</div>
          <div class="ref-acts"><button class="chip" onclick="memForget('\${m.id}')">Delete</button></div>
        </div>
        <div class="ref-src">kept \${e(new Date(m.created||0).toLocaleDateString())}</div>
      </div>\`).join('');
  }).join('');
  return \`<div class="home-wrap anim-fade">
    <div class="hero" style="padding:26px 22px">
      <div class="hero-badge">\${icon('book','icon-sm')} What Apex remembers</div>
      <div class="hero-title" style="font-size:28px">Memory</div>
      <div class="hero-sub">Everything Apex has kept about you, across every session. It writes
        these as it teaches, without interrupting — so this is where you check them. Delete
        anything that is wrong or out of date; it takes effect immediately.</div>
    </div>
    <div class="ref-new">
      <div class="ref-btns">
        <button class="btn" style="background:var(--card);border:1.5px solid var(--border);color:var(--muted)"
          onclick="memForgetAll()">Forget everything</button>
        <button class="btn" style="background:var(--card);border:1.5px solid var(--border);color:var(--muted)"
          onclick="goHome()">\${icon('arrow-left','icon-sm')} Back</button>
      </div>
      <div class="ref-hint">To add one, just tell Apex — "remember that I sit boards in October".</div>
    </div>
    \${groups||'<div style="text-align:center;color:var(--dim);font-size:13px;padding:18px">Apex has not kept anything yet. It will as you study.</div>'}
  </div>\`;
}`);

patch('memory: give the panel a screen',
`    :S.screen==='results'?buildResults():S.screen==='refs'?buildRefs()`,
`    :S.screen==='results'?buildResults():S.screen==='refs'?buildRefs()
    :S.screen==='memory'?buildMemory()`);

patch('memory: reachable from the home row, beside the notes it sits next to',
`      <button class="quick" onclick="goRefs()"><span>\${icon('folder')}</span>Notes\${typeof REF!=='undefined'&&REF.length?\` \${REF.length}\`:''}</button>`,
`      <button class="quick" onclick="goRefs()"><span>\${icon('folder')}</span>Notes\${typeof REF!=='undefined'&&REF.length?\` \${REF.length}\`:''}</button>
      <button class="quick" onclick="goMemory()"><span>\${icon('book')}</span>Memory\${typeof Memory!=='undefined'&&Memory.count()?\` \${Memory.count()}\`:''}</button>`);

patch('memory: and from the tutor settings, where the fellow goes to check on Apex',
`    \`<div class="setup" style="padding-top:0">
       <button class="btn" style="width:100%;background:var(--card);border:1.5px solid var(--border);color:var(--muted)"
         onclick="AI[AI.provider].key='';saveJSON('\${AI_CFG}',AI);buildAI()">Remove this key</button></div>\`;`,
`    \`<div class="setup" style="padding-top:0">
       <button class="btn" style="width:100%;background:var(--card);border:1.5px solid var(--border);color:var(--muted)"
         onclick="goMemory()">\${icon('book','icon-sm')} Memory — \${typeof Memory!=='undefined'?Memory.count():0} thing\${(typeof Memory!=='undefined'?Memory.count():0)===1?'':'s'} Apex remembers</button>
       <button class="btn" style="width:100%;margin-top:8px;background:var(--card);border:1.5px solid var(--border);color:var(--muted)"
         onclick="AI[AI.provider].key='';saveJSON('\${AI_CFG}',AI);buildAI()">Remove this key</button></div>\`;`);

/* ── 6. the backup ───────────────────────────────────────────────────────── */
patch('backup: memory joins the export',
`    chat:loadJSON('accsap12.chat',{}),stats:loadJSON('accsap12.v2',{})},null,0)],`,
`    chat:loadJSON('accsap12.chat',{}),stats:loadJSON('accsap12.v2',{}),
    mem:(typeof Memory!=='undefined'?Memory.all():[])},null,0)],`);

patch('backup: and the import, or a restore would wipe what Apex knew',
`        if(d.stats)saveJSON('accsap12.v2',d.stats);`,
`        if(d.stats)saveJSON('accsap12.v2',d.stats);
        if(d.mem&&typeof Memory!=='undefined') Memory.replaceAll(d.mem);`);

fs.writeFileSync(OUT, html);
console.log(`Durable memory — ${applied.length} edits applied`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
