/* ═════════════════════════════════════════════
   refs.js — the reference library: the notes the reader writes or imports, searched beside the bank and handed
   to Apex as context.

   It was buildRefs() and refPager() in app/systole.html (docs/ROADMAP.md, E1 step 3). They are here as
   functions of what they are given, so what the screen says can be held without a page:

     screenHtml(REF, kit)            the screen's markup, as a string
     pagerHtml(REF_PAGE, left)       the "Show N more" row under the notes, or nothing when none are left

       REF         the notes, each { id, title, tags, body, ts, source }. Read, never changed; only its
                   length is read here, the rest through the page's functions below
       kit         what the screen uses of the page, under the page's names:
                     refViewed()        the note being looked at on its own, if it is still there
                     refsNewestFirst()  the notes, newest first
                     refShown           how many the library shows, a page at a time
                     refEditing         the id of the note being edited, or null
                     refCard(r)         a note's card; the page's, because refMore() adds cards with it too
                     REF_PAGE           how many a page holds
                     icon               the page's helper

   The parameters carry the names the page uses for the same things, so the bodies below moved as they
   stood. tests/verify-refs-pure.js holds what follows, and the page's line that hands these over.

   WHAT THE SCREEN SAYS:

     1. The library: the form to write a note, how many notes are indexed, and the newest refShown of
        them, with a row that offers the next page and says how many are left.
     2. One note on its own, when one is being looked at: that note, the way back, no pager, and the
        form hidden unless that note is being edited.
     3. "Save changes" and Cancel while a note is edited; "Add note" otherwise.
     4. With no notes, a line that says how to add one.

   The buttons name refSave, refCancel, refImportText, refExport, refMore, goHome and goRefs, and the cards
   refEdit and refRemove: an inline handler is read where it is tapped, so those stay the page's.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function pagerHtml(REF_PAGE,left){
  return left>0?`<div class="ref-pager" id="refPager"><button class="chip" type="button" onclick="refMore()">Show ${Math.min(REF_PAGE,left)} more</button><span>${left} more in your library</span></div>`:'';
}

function screenHtml(REF, kit){
  const {refViewed,refsNewestFirst,refShown,refEditing,refCard,REF_PAGE,icon}=kit;
  /* The pager, under the name the body below calls it by. */
  const refPager=left=>pagerHtml(REF_PAGE,left);
  const viewed=refViewed();
  const sorted=viewed?[viewed]:refsNewestFirst();
  const drawn=viewed?sorted:sorted.slice(0,refShown);
  const rows=drawn.map(refCard).join('')+(viewed?'':refPager(sorted.length-drawn.length));
  return `<div class="home-wrap anim-fade">
    <div class="hero" style="padding:26px 22px">
      <div class="hero-badge">${icon('folder','icon-sm')} Your reference library</div>
      <div class="hero-title" style="font-size:28px">Reference Notes</div>
      <div class="hero-sub">Notes you write here are searched alongside the bank's commentary and handed to Apex as context — so the tutor teaches from your understanding, not just the question bank.</div>
    </div>
    <div class="ref-new"${viewed&&!refEditing?' hidden style="display:none"':''}>
      <input id="refT" placeholder="Title — e.g. Cardiac amyloidosis: red flags">
      <input id="refG" placeholder="Tags, comma separated — amyloid, restrictive, ATTR">
      <textarea id="refB" rows="6" placeholder="Write the concept in your own words. Summarising what you read is where the learning happens — and it gives the tutor your framing to build on."></textarea>
      <div class="ref-btns">
        <button class="btn btn-next" onclick="refSave()">${refEditing?'Save changes':'Add note'}</button>
        ${refEditing?`<button class="btn" style="background:var(--card);border:1.5px solid var(--border);color:var(--muted)" onclick="refCancel()">Cancel</button>`:''}
        <button class="btn" style="background:var(--card);border:1.5px solid var(--border);color:var(--muted)" onclick="refImportText()">⤒ Import .md / .txt / .json</button>
        <button class="btn" style="background:var(--card);border:1.5px solid var(--border);color:var(--muted)" onclick="refExport()">⤓ Export notes</button>
        <button class="btn" style="background:var(--card);border:1.5px solid var(--border);color:var(--muted)" onclick="goHome()">${icon('arrow-left','icon-sm')} Back</button>
      </div>
      <div class="ref-hint">Markdown files split on <code>#</code> headings — one note per section. Nothing you write leaves this device except as context on your own API calls.</div>
    </div>
    <div class="section-label">${viewed?'Source note':`${REF.length} note${REF.length===1?'':'s'} indexed`}</div>
    ${viewed?`<div class="ref-btns"><button class="chip" onclick="goHome()">Back to study</button><button class="chip" onclick="goRefs()">Show all notes</button></div>`:''}
    ${rows||'<div style="text-align:center;color:var(--muted);font-size:13px;padding:18px">No notes yet. Add one above, or import a markdown file.</div>'}
  </div>`;
}

root.RefsScreen = { screenHtml, pagerHtml };
})(typeof window !== 'undefined' ? window : this);
