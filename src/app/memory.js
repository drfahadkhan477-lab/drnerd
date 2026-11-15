/* ═════════════════════════════════════════════
   memory.js — the screen that shows what Apex has kept about the reader.

   Apex writes its memories silently as it teaches, so this screen is the only place the reader can see
   what was kept, and correct it. It was buildMemory() in app/systole.html (docs/ROADMAP.md, E1 step 3);
   it is here as a function of what it is given, so what the screen shows can be held without a page:

     screenHtml(all, kit)    the screen's markup, as a string

       all    what Apex has kept, in the order to show it: [{ id, kind, text, created }], which is
              Memory.all() in the page (src/core/memory.js). Read, never changed.
       kit    the page's helpers the markup uses: { e, icon }

   The parameters carry the names the page used, so the body below moved as it stood, less the one line
   that asked Memory for the list: the page's line does that now. tests/verify-memoryscreen-pure.js holds
   what follows, and the page's line.

   WHAT THE SCREEN SHOWS:

     1. Four groups, always in this order, whatever order the memories come in: "About you" (fact),
        "Where you keep going wrong" (gap), "How you like to be taught" (preference), "From past
        sessions" (session). These are Memory.KINDS; a group with nothing in it has no heading.
     2. Within a group, the memories in the order they were given. Each is its words, the day it was
        kept as the reader's own calendar says it, and a Delete button that carries the memory's id.
     3. The id is written into the button's data, never into the handler: the handler says
        this.dataset.memoryId, so an id cannot be read as code.
     4. With nothing kept, one line says so. "Forget everything", "Back" and how to add a memory are
        there either way.

   The buttons name memForget(), memForgetAll() and goHome(). They stay the page's: an inline handler
   is read where it is tapped, and the first two ask before they delete with confirm(), which
   tests/verify-ui-pure.js holds to the page that calls it.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function screenHtml(all, kit){
  const {e,icon}=kit;
  const KINDS=[['fact','About you'],['gap','Where you keep going wrong'],
               ['preference','How you like to be taught'],['session','From past sessions']];
  const groups=KINDS.map(([k,label])=>{
    const rows=all.filter(m=>m.kind===k);
    if(!rows.length) return '';
    return `<div class="section-label">${e(label)}</div>`+rows.map(m=>`
      <div class="ref-card">
        <div class="ref-top">
          <div class="ref-title" style="font-weight:500">${e(m.text)}</div>
          <div class="ref-acts"><button class="chip" data-memory-id="${e(m.id)}" onclick="memForget(this.dataset.memoryId)">Delete</button></div>
        </div>
        <div class="ref-src">kept ${e(new Date(m.created||0).toLocaleDateString())}</div>
      </div>`).join('');
  }).join('');
  return `<div class="home-wrap anim-fade">
    <div class="hero" style="padding:26px 22px">
      <div class="hero-badge">${icon('book','icon-sm')} What Apex remembers</div>
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
          onclick="goHome()">${icon('arrow-left','icon-sm')} Back</button>
      </div>
      <div class="ref-hint">To add one, just tell Apex — "remember that I sit boards in October".</div>
    </div>
    ${groups||'<div style="text-align:center;color:var(--muted);font-size:13px;padding:18px">Apex has not kept anything yet. It will as you study.</div>'}
  </div>`;
}

root.MemoryScreen = { screenHtml };
})(typeof window !== 'undefined' ? window : this);
