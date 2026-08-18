#!/usr/bin/env node
/*
 * Braunwald grounding — turn the reference library into a source Apex can be
 * held to, rather than one it merely consults.
 *
 *   node scripts/braunwald-patch.js <ink-output.html> <output.html>
 *
 * The library already existed: notes go into REF, get indexed into the same
 * BM25 index the question bank uses, and are retrieved alongside it. Three
 * things were missing for a Braunwald corpus to be usable as the ground truth.
 *
 * 1. PROVENANCE. A note had a title, tags and a body but nowhere to record
 *    where it came from. Without that a grounded answer cannot cite anything
 *    you could go and check, which is the only thing that makes grounding
 *    worth having. Notes now carry `source`, parsed from YAML front matter.
 *
 * 2. IMPORT AT SCALE. The picker took one file. A chapter-per-file corpus is
 *    dozens of files, so it now takes many at once and reports what it did.
 *
 * 3. A GROUNDED MODE. This is the substantive one. Normally Apex answers from
 *    its own knowledge, using your library as supporting material. In grounded
 *    mode that is inverted: retrieval returns your notes ONLY, the question
 *    bank is excluded, the budget for them roughly triples, and the system
 *    prompt is overridden with instructions to answer from those notes alone,
 *    cite each one by title, and say plainly when the notes do not cover
 *    something instead of reaching for what it already knows.
 *
 *    That last part is the whole point and the easiest to get wrong. A model
 *    told to "prefer" a source will still smooth over a gap with its own
 *    knowledge, and you cannot tell from the outside which sentences came from
 *    where. So the instruction is not a preference, it is a prohibition with a
 *    named escape hatch: say "your notes do not cover this".
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
  console.error('usage: node scripts/braunwald-patch.js <ink-output.html> <output.html>');
  process.exit(1);
}
let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. front matter carries real fields now ─────────────────────────────── */
patch('refs: front matter yields title, tags and source',
`function stripFrontmatter(raw){
  // Claude Skill files (SKILL.md) and many note tools prepend YAML frontmatter:
  // ---\\nname: ...\\ndescription: ...\\n---\\n  — strip it so it never becomes a note.
  const m=raw.match(/^---\\r?\\n[\\s\\S]*?\\r?\\n---\\r?\\n?/);
  if(!m) return {body:raw, meta:null};
  const yaml=m[0];
  const desc=yaml.match(/^description:\\s*(.+)$/m);
  const name=yaml.match(/^name:\\s*(.+)$/m);
  return {body:raw.slice(m[0].length), meta:{name:name&&name[1].trim(),desc:desc&&desc[1].trim()}};
}`,
`function stripFrontmatter(raw){
  // Claude Skill files (SKILL.md) and many note tools prepend YAML frontmatter:
  // ---\\nname: ...\\ndescription: ...\\n---\\n  — strip it so it never becomes a note.
  // A reference corpus wants more than that: a title to cite it by, tags to
  // retrieve it on, and a source you could actually go and open.
  const m=raw.match(/^---\\r?\\n[\\s\\S]*?\\r?\\n---\\r?\\n?/);
  if(!m) return {body:raw, meta:null};
  const yaml=m[0];
  const f=k=>{ const x=yaml.match(new RegExp('^'+k+':\\\\s*(.+)$','m')); return x?x[1].trim().replace(/^["']|["']$/g,''):''; };
  return {body:raw.slice(m[0].length), meta:{
    name:f('name')||null, desc:f('description')||null,
    title:f('title'), tags:f('tags'), source:f('source')||f('citation')||f('ref'),
  }};
}`);

patch('refs: notes carry a source, and it survives edits',
`function refAdd(title,body,tags){
  const r={id:'r'+Date.now().toString(36),title:title||'',body:body||'',tags:tags||'',ts:Date.now()};
  REF.push(r); saveJSON(REF_KEY,REF); invalidateIndex(); return r;
}`,
`function refAdd(title,body,tags,source){
  /* Date.now() alone collides when a whole chapter is imported in one tick —
     every note in the file would land on the same id and the last would win. */
  const r={id:'r'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),
           title:title||'',body:body||'',tags:tags||'',source:source||'',ts:Date.now()};
  REF.push(r); saveJSON(REF_KEY,REF); invalidateIndex(); return r;
}`);

patch('refs: parser carries front-matter title, tags and source through',
`  const {body,meta}=stripFrontmatter(raw);
  const tags=meta&&meta.name?meta.name.replace(/[_-]+/g,' '):'';
  const secs=splitSections(body);
  if(secs.length>1){
    return secs.map(s=>{
      const m=s.match(/^#{1,6}\\s*(.+)/);
      return {title:m?m[1].trim():'Note',
              body:s.replace(/^#{1,6}\\s*.+\\n?/,'').trim(), tags};
    }).filter(s=>s.body||s.title!=='Note');
  }
  const single=(secs[0]||body).trim();
  const m=single.match(/^#{1,6}\\s*(.+)/);
  return [{title: m?m[1].trim() : (meta&&meta.desc) || filename.replace(/\\.\\w+$/,''),
           body: m?single.replace(/^#{1,6}\\s*.+\\n?/,'').trim():single, tags}];`,
`  const {body,meta}=stripFrontmatter(raw);
  const fmTitle=(meta&&meta.title)||'';
  const source=(meta&&meta.source)||'';
  /* Front-matter tags win; the file name is a poor last resort but better than
     nothing, since it is usually the topic. */
  const tags=(meta&&meta.tags) || (meta&&meta.name?meta.name.replace(/[_-]+/g,' '):'')
             || filename.replace(/\\.\\w+$/,'').replace(/[_-]+/g,' ');
  const secs=splitSections(body);
  if(secs.length>1){
    /* One section per note. Retrieval works on whole notes, so a 4000-word
       chapter as a single note would either blow the context budget or be
       clipped mid-sentence; a section is the size a claim actually lives at.
       The file's own title is kept as a prefix so a citation still says which
       chapter it came from. */
    return secs.map(s=>{
      const m=s.match(/^#{1,6}\\s*(.+)/);
      const secTitle=m?m[1].trim():'Note';
      return {title: fmTitle? fmTitle+' — '+secTitle : secTitle,
              body:s.replace(/^#{1,6}\\s*.+\\n?/,'').trim(), tags, source};
    }).filter(s=>s.body||s.title!=='Note');
  }
  const single=(secs[0]||body).trim();
  const m=single.match(/^#{1,6}\\s*(.+)/);
  return [{title: fmTitle || (m?m[1].trim():'') || (meta&&meta.desc) || filename.replace(/\\.\\w+$/,''),
           body: m?single.replace(/^#{1,6}\\s*.+\\n?/,'').trim():single, tags, source}];`);

/* ── 2. import a whole corpus in one go ──────────────────────────────────── */
patch('refs: import many files at once',
`function refImportText(){
  const inp=document.createElement('input');
  inp.type='file'; inp.accept='.md,.txt,.json,text/plain,text/markdown,application/json';
  inp.onchange=()=>{
    const f=inp.files[0]; if(!f)return;
    const rd=new FileReader();
    rd.onload=()=>{
      const notes=parseImportText(String(rd.result||''), f.name);
      notes.forEach(n=>refAdd(n.title,n.body,n.tags));
      render(); toast(\`Added \${notes.length} reference note\${notes.length===1?'':'s'}.\`);
    };
    rd.readAsText(f);
  };
  inp.click();
}`,
`function refImportText(){
  const inp=document.createElement('input');
  inp.type='file'; inp.multiple=true;
  inp.accept='.md,.txt,.json,text/plain,text/markdown,application/json';
  inp.onchange=async()=>{
    const files=[...(inp.files||[])]; if(!files.length)return;
    let notes=0, failed=0;
    for(const f of files){
      try{
        const text=await f.text();
        const parsed=parseImportText(text, f.name);
        parsed.forEach(n=>refAdd(n.title,n.body,n.tags,n.source));
        notes+=parsed.length;
      }catch(_){ failed++; }
    }
    render();
    toast(\`Added \${notes} note\${notes===1?'':'s'} from \${files.length-failed} file\${files.length-failed===1?'':'s'}\`
          + (failed?\` · \${failed} could not be read\`:''));
  };
  inp.click();
}`);

/* ── 3. grounded mode ────────────────────────────────────────────────────── */
patch('grounded: the flag, remembered',
`let pendingNav=null, toolTrace=[];`,
`let pendingNav=null, toolTrace=[];
/* Grounded mode: answer from the reference library alone. Off by default —
   with an empty library it would leave Apex with nothing to say. */
let AI_GROUNDED=(()=>{try{return localStorage.getItem('accsap12.grounded')==='1';}catch(_){return false;}})();
function toggleGrounded(){
  if(!AI_GROUNDED && !REF.length){ toast('Import your reference notes first — grounded mode has nothing to read yet.'); return; }
  AI_GROUNDED=!AI_GROUNDED;
  try{localStorage.setItem('accsap12.grounded',AI_GROUNDED?'1':'0');}catch(_){}
  buildAI();
  toast(AI_GROUNDED?'Grounded: Apex will answer only from your reference library.'
                   :'Open mode: Apex will use its own knowledge again.');
}`);

patch('grounded: the prompt override',
`const SYSTEM = \`You go by Apex.`,
`/* A "prefer this source" instruction does not hold: a model told to prefer
   your notes will still bridge a gap with its own knowledge, and from the
   outside you cannot tell which sentence came from where — which defeats the
   purpose of grounding it. So this is a prohibition with one named way out. */
const GROUNDED = \`

═══ GROUNDED MODE IS ON — THIS OVERRIDES THE INSTRUCTIONS ABOVE WHERE THEY CONFLICT ═══

The fellow has built a reference library from their own reading, and has asked
you to answer from it and nothing else.

· Answer ONLY from the reference notes supplied in the context below. Do not
  supplement them from your own knowledge of cardiology, however confident you
  are and however standard the fact seems.
· Cite the note you are drawing on, by its title, for every substantive claim —
  like this: (Amyloidosis — Recognition). Where a note carries a source, name
  that too, so the fellow can go and check the page.
· If the notes do not cover what was asked, say exactly that: "Your notes do not
  cover this." Then say what related material IS in the library, and offer to
  answer from your own knowledge if they want it — but do not do so unless they
  ask in a following message.
· If two notes disagree, say so and quote both rather than reconciling them
  silently.
· Never present your own knowledge as though it came from a note. That is the
  one failure mode this mode exists to prevent.

The ACC commentary on the current question is deliberately withheld from you
in this mode. You can see the stem and the options, so you know what is being
asked; you cannot read the answer key, because teaching from it is exactly the
shortcut this mode exists to close.\`;

const SYSTEM = \`You go by Apex.`);

patch('grounded: build the system prompt through a function',
`      system:[{type:'text',text:SYSTEM},{type:'text',text:aiCtx(q)+(extra||'')}],`,
`      system:[{type:'text',text:systemPrompt()},{type:'text',text:aiCtx(q)+(extra||'')}],`);
patch('grounded: same on the text-only provider',
`  const sys={role:'system',content:SYSTEM+'\\n\\n'+aiCtx(q)+(extra||'')};`,
`  const sys={role:'system',content:systemPrompt()+'\\n\\n'+aiCtx(q)+(extra||'')};`);

patch('grounded: retrieval returns the library only, with room to breathe',
`function retrievedContext(userText,q){`,
`function systemPrompt(){ return AI_GROUNDED ? SYSTEM+GROUNDED : SYSTEM; }

/* In grounded mode the library is the whole answer, not supporting material:
   the question bank is excluded entirely, more notes are returned, and each
   gets far more of the budget — a Braunwald section clipped at 1500 characters
   loses exactly the qualifying clause that made it worth citing. */
function groundedContext(userText,q){
  const hits=search((userText+' ').repeat(3)+(q?clip(q.s,160):''),{limit:40})
              .filter(h=>h.meta.kind==='r').slice(0,6);
  if(!hits.length){
    return {text:'\\n\\nTHE FELLOW\\u2019S REFERENCE LIBRARY RETURNED NOTHING for this question. Tell them their notes do not cover it — do not answer from your own knowledge.\\n', hits:[]};
  }
  const parts=[]; const kept=[]; let used=0;
  for(const h of hits){
    const r=REF.find(x=>x.id===h.meta.id); if(!r) continue;
    const block=\`--- REFERENCE NOTE: "\${r.title||'Untitled'}"\${r.source?'\\n    source: '+r.source:''}\${r.tags?'\\n    tags: '+r.tags:''}\\n\${clip(r.body,4000)}\`;
    if(used+block.length>CTX_BUDGET*3) break;
    used+=block.length; parts.push(block); kept.push(h.meta);
  }
  return {
    text:\`\\n\\nTHE FELLOW'S REFERENCE LIBRARY — these notes are the ONLY material you may teach from in this reply. Cite each by title.\\n\\n\`+parts.join('\\n\\n'),
    hits:kept
  };
}

function retrievedContext(userText,q){
  if(AI_GROUNDED) return groundedContext(userText,q);`);


/* aiCtx hands the model the ACC commentary and calls it ground truth, which is
   right in open mode and flatly contradicts grounded mode. Withhold it: Apex
   still sees the stem and options, so it knows what is being asked, but the
   explanation has to come from the fellow's own notes or not at all. */
patch('grounded: withhold the answer key, keep the question',
`  return \`CURRENT QUESTION — ACCSAP 12, \${q.ch}, item \${q.n}\\n\\nSTEM\\n\${q.s}\\n\\nOPTIONS\\n\${opts}\\n\\nOFFICIAL ACC COMMENTARY\\n\${q.ex}\\n\\n\${Vision.figureContextLine(q, AI.provider)}Use this as the ground truth for the item. You may go well beyond it.\${ownBlock}\${profileBlock}\`;`,
`  if(AI_GROUNDED){
    return \`CURRENT QUESTION — ACCSAP 12, \${q.ch}, item \${q.n}\\n\\nSTEM\\n\${q.s}\\n\\nOPTIONS\\n\${opts}\\n\\n(The official ACC commentary for this item is withheld in grounded mode. You can see what is being asked; you may not read the answer key. Teach from the fellow's reference notes below, and if they do not cover it, say so.)\\n\\n\${Vision.figureContextLine(q, AI.provider)}\${ownBlock}\${profileBlock}\`;
  }
  return \`CURRENT QUESTION — ACCSAP 12, \${q.ch}, item \${q.n}\\n\\nSTEM\\n\${q.s}\\n\\nOPTIONS\\n\${opts}\\n\\nOFFICIAL ACC COMMENTARY\\n\${q.ex}\\n\\n\${Vision.figureContextLine(q, AI.provider)}Use this as the ground truth for the item. You may go well beyond it.\${ownBlock}\${profileBlock}\`;`);

/* ── 4. the control, and provenance on screen ────────────────────────────── */
patch('ai panel: a grounded switch in the header',
`      <button class="icon-btn" style="background:var(--card);border-color:var(--border);color:var(--muted)"
        onclick="aiSettings()" title="Settings">\${icon("settings")}</button>`,
`      <button class="icon-btn grounded-btn\${AI_GROUNDED?' on':''}"
        onclick="toggleGrounded()" aria-pressed="\${AI_GROUNDED?'true':'false'}"
        title="\${AI_GROUNDED?'Grounded: answering only from your reference library':'Open: Apex uses its own knowledge'}">\${icon("folder")}</button>
      <button class="icon-btn" style="background:var(--card);border-color:var(--border);color:var(--muted)"
        onclick="aiSettings()" title="Settings">\${icon("settings")}</button>`);

patch('ai panel: say which mode is running, under the name',
`        <div class="ai-sub">\${q?e(q.ch)+' · item '+q.n+visionBadge(q):'Cardiology tutor'}</div>`,
`        <div class="ai-sub">\${AI_GROUNDED
          ? \`<span class="grounded-tag">grounded · \${REF.length} note\${REF.length===1?'':'s'}</span>\`
          : (q?e(q.ch)+' · item '+q.n+visionBadge(q):'Cardiology tutor')}</div>`);

patch('css: the grounded switch and its tag',
`.ai-head{display:flex;align-items:center;gap:9px;padding:12px 14px;`,
`.grounded-btn{background:var(--card);border-color:var(--border);color:var(--muted)}
.grounded-btn.on{background:var(--teal4);border-color:var(--teal);color:var(--teal)}
.grounded-tag{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.06em;
  text-transform:uppercase;color:var(--teal);font-weight:600}
.ref-src{font-family:var(--font-mono);font-size:10.5px;color:var(--dim);margin-top:3px}
.ai-head{display:flex;align-items:center;gap:9px;padding:12px 14px;`);

/* Provenance has to be visible in the library itself, or you cannot tell an
   imported Braunwald section from a note you typed at 1am. */
patch('refs list: show each note\'s source',
`      \${r.tags?\`<div class="ref-tags">\${e(r.tags).split(',').map(t=>\`<span>\${t.trim()}</span>\`).join('')}</div>\`:''}
      <div class="ref-body">\${e(r.body).replace(/\\n+/g,'<br>')}</div>`,
`      \${r.source?\`<div class="ref-src">\${icon('folder','icon-sm')} \${e(r.source)}</div>\`:''}
      \${r.tags?\`<div class="ref-tags">\${e(r.tags).split(',').map(t=>\`<span>\${t.trim()}</span>\`).join('')}</div>\`:''}
      <div class="ref-body">\${e(r.body).replace(/\\n+/g,'<br>')}</div>`);

fs.writeFileSync(OUT, html);
console.log(`Braunwald grounding applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
