#!/usr/bin/env node
/*
 * Apex gets a whole page, and its answers get set like prose.
 *
 *   node scripts/apexpage-patch.js <in.html> <out.html>
 *
 * TWO THINGS, AND THEY ARE THE SAME THING. Apex is where the long answers
 * live — a mechanism walked through, a table of regimens, four paragraphs on
 * why the distractor is wrong — and it has been reading them in a 560 px
 * column pinned to the side of a quiz. That is the right home for "why is this
 * the answer?" next to the item, and the wrong one for a twenty-minute
 * discussion. So: a full-page mode, and typography that earns the extra room.
 *
 * ── 1. FULL PAGE ─────────────────────────────────────────────────────────
 * A button in the panel header expands #ai to the whole viewport under the
 * nav and hides #app behind it. Escape brings it back. The state persists,
 * because someone who studies by talking to Apex should not re-expand it
 * every morning.
 *
 * WHY A SHELL CLASS AND NOT A SCREEN. Every other view in this app is an
 * S.screen value that render() paints into #app. Apex is deliberately not:
 * #ai lives OUTSIDE #app precisely so that render() rebuilding the quiz does
 * not tear down a conversation mid-reply, and buildAI() has its own careful
 * state save/restore (apexPanelState) around every rebuild. Making full-page
 * a screen would mean either moving the panel inside #app — losing that — or
 * maintaining two mount points for one conversation. A class on #shell keeps
 * exactly one Apex, one thread, one composer, and changes only its box.
 *
 * SPECIFICITY, NOT ORDER. There are four #ai rules in this stylesheet —
 * base, .ai-open, the portrait bottom sheet, the landscape split — several of
 * them inside media queries that come after wherever this CSS lands. So the
 * full-page rules are written as `#shell.ai-full #ai`: two ids and a class
 * beats a bare `#ai` in every one of those contexts regardless of source
 * order. Relying on "mine comes last" would have worked until the next patch
 * appended a media query.
 *
 * THE MEASURE IS CAPPED. A thread that runs the full width of a 1366 px iPad
 * is unreadable — 160 characters a line. In full-page mode the body, the
 * chips and the composer all sit in a centred 860 px column, which is the
 * same reason the reading column in the rest of the app is capped.
 *
 * ── 2. HOW THE ANSWERS READ ──────────────────────────────────────────────
 * THE ORDERED-LIST BUG, FIRST, BECAUSE IT IS A BUG. md() turned both `- x`
 * and `1. x` into <li> and then wrapped every run in <ul>. So every numbered
 * list Apex has ever written — "the three steps, in order" — rendered as
 * bullets with the numbers stripped. Order is the entire content of an
 * ordered list. Items are now tagged by kind before wrapping, and a run that
 * mixes both is split at the boundary rather than forced into one tag.
 *
 * BLOCKQUOTES AND RULES, because a model that is told it may use markdown
 * will use markdown, and `> ` and `---` were being rendered literally.
 *
 * HEADINGS WERE SMALLER THAN THE BODY. .msg.bot h3 was 13px against a 16px
 * paragraph, which inverts the hierarchy: the section head was the quietest
 * thing in the answer. They now sit above the body size, take their space
 * above rather than below (a heading belongs to what follows it), and lose
 * the top margin when they open a message.
 *
 * The rest is spacing: paragraphs at a real interval instead of 6px, list
 * items with room to breathe and a marker in the accent, tables with a zebra
 * so a wide row can be tracked across, and a first-child/last-child reset so
 * a message never opens or closes with a stray margin.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/apexpage-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 240)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── the two icons the header button needs ────────────────────────────────
   Drawn here rather than reused: nothing in the set meant "make this bigger".
   Four corner brackets pointing out, and the same pointing in. */
patch('apex: expand and collapse icons join the sprite',
`</defs>
</svg>\`;`,
`<symbol id="i-expand" viewBox="0 0 24 24"><path d="M9 4.5H4.5V9M15 4.5h4.5V9M9 19.5H4.5V15M15 19.5h4.5V15"/></symbol>
<symbol id="i-collapse" viewBox="0 0 24 24"><path d="M4.5 9H9V4.5M19.5 9H15V4.5M4.5 15H9v4.5M19.5 15H15v4.5"/></symbol>
</defs>
</svg>\`;`);

/* ── the header button ────────────────────────────────────────────────────
   Between grounded and settings: expanding is a thing you do to the reading
   surface, so it sits with the other surface controls rather than beside the
   close button, where it would be one mis-tap from dismissing the thread. */
patch('apex: the header carries an expand button',
`      <button class="icon-btn" style="background:var(--card);border-color:var(--border);color:var(--muted)"
        onclick="aiSettings()" title="Settings">\${icon("settings")}</button>`,
`      <button class="icon-btn" style="background:var(--card);border-color:var(--border);color:var(--muted)"
        onclick="toggleApexFull()" aria-pressed="\${apexIsFull()?'true':'false'}"
        title="\${apexIsFull()?'Back to the side panel':'Open Apex full screen'}"
        aria-label="\${apexIsFull()?'Back to the side panel':'Open Apex full screen'}">\${icon(apexIsFull()?"collapse":"expand")}</button>
      <button class="icon-btn" style="background:var(--card);border-color:var(--border);color:var(--muted)"
        onclick="aiSettings()" title="Settings">\${icon("settings")}</button>`);

/* ── the state, the toggle, and the way out ───────────────────────────────
   Placed with toggleAI, which owns the other half of this panel's geometry. */
patch('apex: full-page state, toggle and Escape',
`function toggleAI(){
  const sh=document.getElementById('shell');
  sh.classList.toggle('ai-open');`,
`function apexIsFull(){
  const sh=document.getElementById('shell');
  return !!sh && sh.classList.contains('ai-full');
}
/* Expanding an unopened panel opens it — the button is only reachable from
   inside the panel today, but a keyboard shortcut or a deep link would not
   be, and a toggle that silently does nothing is worse than one that does the
   obvious thing. */
function toggleApexFull(){
  const sh=document.getElementById('shell'); if(!sh) return;
  sh.classList.add('ai-open');
  const full=sh.classList.toggle('ai-full');
  try{ localStorage.setItem('accsap12.aifull',full?'1':'0'); }catch(_){}
  try{ localStorage.setItem('accsap12.aiopen','1'); }catch(_){}
  const fab=document.getElementById('aiFab'); if(fab) fab.style.display='none';
  buildAI();
}
/* Escape leaves full-page and stops there. It deliberately does NOT go on to
   close the panel on a second press: someone reading a long answer full
   screen who hits Escape twice out of habit should end up looking at the
   thread beside their question, not at a dismissed conversation. */
document.addEventListener('keydown',ev=>{
  if(ev.key!=='Escape'||!apexIsFull()) return;
  /* Not while a composer or a settings field has the caret — Escape belongs
     to whatever is being typed into first. */
  const t=ev.target;
  if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA')&&t.id!=='aiIn') return;
  ev.preventDefault();
  toggleApexFull();
});
function toggleAI(){
  const sh=document.getElementById('shell');
  sh.classList.toggle('ai-open');`);

/* Closing the panel leaves full-page behind. The alternative — remembering it
   — means the next tap on the FAB takes over the whole screen with no warning
   and no visible way back except a button the fellow has not seen yet. */
patch('apex: closing the panel also leaves full-page',
`  const open=sh.classList.contains('ai-open');
  try{localStorage.setItem('accsap12.aiopen',open?'1':'0');}catch(_){}`,
`  const open=sh.classList.contains('ai-open');
  if(!open){ sh.classList.remove('ai-full'); try{localStorage.setItem('accsap12.aifull','0');}catch(_){} }
  try{localStorage.setItem('accsap12.aiopen',open?'1':'0');}catch(_){}`);

/* Boot restores it alongside the open state, and under the same width gate:
   full-page on a phone is what the portrait bottom sheet already is. */
patch('apex: boot restores full-page with the open state',
`  if(open&&window.innerWidth>=1024){ sh.classList.add('ai-open'); buildAI(); }`,
`  if(open&&window.innerWidth>=1024){
    let full=false; try{ full=localStorage.getItem('accsap12.aifull')==='1'; }catch(_){}
    sh.classList.add('ai-open');
    if(full) sh.classList.add('ai-full');
    buildAI();
  }`);

/* ── the geometry ─────────────────────────────────────────────────────────
   Appended after the last .msg rule so the reading changes sit with the rest
   of the thread's typography rather than in a block of their own at the end
   of the stylesheet. */
patch('apex: full-page geometry and the reading measure',
`.msg.err{align-self:stretch;background:var(--red-bg);border:1px solid var(--red-b);
  color:var(--red);padding:9px 12px;border-radius:10px;font-size:13px}`,
`.msg.err{align-self:stretch;background:var(--red-bg);border:1px solid var(--red-b);
  color:var(--red);padding:9px 12px;border-radius:10px;font-size:13px}

/* ── Apex, full page ──────────────────────────────────────────────────────
   Two ids and a class, so this wins over the bare #ai rules inside the
   portrait and landscape media queries no matter what order they land in. */
#shell.ai-full #ai{position:fixed;left:0;right:0;
  top:calc(var(--navh) + var(--sat));bottom:0;
  width:auto;max-width:none;height:auto;flex:0 0 auto;
  border:0;border-radius:0;box-shadow:none;z-index:60;
  background:var(--white)}
#shell.ai-full #app{visibility:hidden}
#shell.ai-full .ai-fab{display:none!important}
/* One centred column for all three stacked regions, so the composer lines up
   under the thread instead of running the width of an iPad. */
#shell.ai-full .ai-head>div:first-of-type,
#shell.ai-full .ai-body,
#shell.ai-full .chips,
#shell.ai-full .src-strip,
#shell.ai-full .fig-strip,
#shell.ai-full .ai-foot>*{max-width:860px;margin-left:auto;margin-right:auto;width:100%}
#shell.ai-full .ai-body{padding:28px 24px 32px;gap:24px}
#shell.ai-full .ai-head{padding:14px 20px}
/* The header's own centred column would push the buttons to the middle of the
   screen; only the title block is capped, and the row itself stays full width. */
#shell.ai-full .ai-head>div:first-of-type{margin-left:0;margin-right:auto}
#shell.ai-full .msg{max-width:100%}
#shell.ai-full .msg.user{max-width:min(82%,620px)}
#shell.ai-full .msg.bot p{max-width:74ch}

/* ── how an answer reads ──────────────────────────────────────────────────
   Written after the .msg.bot block above, so these override it by order. */
.msg.bot h3{font-size:17px;font-weight:700;color:var(--teal);
  margin:22px 0 7px;line-height:1.3;letter-spacing:-.012em}
.msg.bot h4{font-size:15px;font-weight:700;color:var(--text);
  margin:18px 0 5px;line-height:1.35;letter-spacing:-.008em}
/* A heading that opens a message has nothing above it to be separated from. */
.msg.bot>h3:first-child,.msg.bot>h4:first-child{margin-top:0}
.msg.bot p{margin:0 0 13px}
.msg.bot>*:last-child{margin-bottom:0}
.msg.bot ul,.msg.bot ol{margin:0 0 14px;padding-left:24px}
.msg.bot ol{list-style:decimal}
.msg.bot ul{list-style:disc}
.msg.bot li{margin:0 0 7px;padding-left:2px}
.msg.bot li:last-child{margin-bottom:0}
.msg.bot li::marker{color:var(--teal);font-weight:600}
/* A quote from a guideline or a stem, set as an aside rather than a wall. */
.msg.bot blockquote{margin:0 0 14px;padding:2px 0 2px 15px;
  border-left:3px solid var(--teal);color:var(--muted)}
.msg.bot blockquote p:last-child{margin-bottom:0}
.msg.bot hr{border:0;border-top:1px solid var(--border);margin:20px 0}
/* Zebra, so a wide row can be followed across a table that scrolls sideways. */
.msg tbody tr:nth-child(even) td{background:var(--card)}
.msg.bot pre{margin:0 0 14px;padding:12px 14px;border-radius:10px;
  background:var(--card);border:1px solid var(--border);overflow-x:auto}
.msg.bot pre code{background:none;padding:0;font-size:13px;line-height:1.6}`);

/* ── md() ─────────────────────────────────────────────────────────────────
   Blockquotes and rules before the list rules, so a quoted bullet is not
   claimed by the list pass first. `>` arrives here as &gt;, because e() has
   already run over the whole string. */
patch('apex: md() renders blockquotes and horizontal rules',
`  s=s.replace(/^\\s*[-•]\\s+(.+)$/gm,'<li>$1</li>');`,
`  /* One <blockquote> per run of quoted lines, rather than one per line. */
  s=s.replace(/^&gt;\\s?(.*)$/gm,'\\u0001$1\\u0002');
  s=s.replace(/(?:\\u0001[^\\u0002]*\\u0002\\n?)+/g,run=>
    '<blockquote><p>'+(run.match(/\\u0001([^\\u0002]*)\\u0002/g)||[])
      .map(x=>x.slice(1,-1)).join(' ').trim()+'</p></blockquote>');
  /* [ \\t]* and not \\s*: with the m flag \\s matches newlines too, so a \\s*-
     anchored rule eats the blank lines on either side of the divider — and
     those blank lines are exactly what the paragraph pass below splits on.
     The rule still fired; the <hr> just ended up inside the paragraph it was
     supposed to separate. */
  s=s.replace(/^[ \\t]*(?:---+|___+)[ \\t]*$/gm,'<hr>');
  s=s.replace(/^\\s*[-•]\\s+(.+)$/gm,'<li>$1</li>');`);

patch('apex: md() keeps a numbered list numbered',
`  s=s.replace(/^\\s*\\d+\\.\\s+(.+)$/gm,'<li>$1</li>');
  s=s.replace(/(<li>[\\s\\S]*?<\\/li>)(?!\\s*<li>)/g,'<ul>$1</ul>');`,
`  s=s.replace(/^\\s*\\d+\\.\\s+(.+)$/gm,'<li data-o>$1</li>');
  /* THE ORDER IS THE CONTENT. Both kinds used to become a bare <li> and every
     run was wrapped in <ul>, so "1. 2. 3." came out as three bullets with the
     numbers gone. Tag the kind, wrap a run, and split it where the kind
     changes — a list that mixes them is two lists, not one guess. */
  s=s.replace(/(?:<li(?: data-o)?>[\\s\\S]*?<\\/li>\\s*)+/g,run=>{
    const items=run.match(/<li(?: data-o)?>[\\s\\S]*?<\\/li>/g)||[];
    let out='',cur=null,buf=[];
    const flush=()=>{ if(buf.length){ out+='<'+cur+'>'+buf.join('')+'</'+cur+'>'; buf=[]; } };
    for(const it of items){
      const kind=it.startsWith('<li data-o>')?'ol':'ul';
      if(kind!==cur){ flush(); cur=kind; }
      buf.push(it.replace('<li data-o>','<li>'));
    }
    flush();
    return out;
  });`);

patch('apex: the paragraph pass leaves the new blocks alone',
`  s=s.split(/\\n{2,}/).map(p=>/^<(ul|h3|h4|pre|div|table|figure)/.test(p.trim())?p:\`<p>\${p.replace(/\\n/g,' ')}</p>\`).join('');`,
`  s=s.split(/\\n{2,}/).map(p=>/^<(ul|ol|h3|h4|pre|div|table|figure|blockquote|hr)/.test(p.trim())?p:\`<p>\${p.replace(/\\n/g,' ')}</p>\`).join('');`);

fs.writeFileSync(OUT, html);
console.log(`Apex full page and reading polish applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
