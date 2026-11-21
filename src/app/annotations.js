/* ═════════════════════════════════════════════
   annotations.js — "Your annotations": every question with a sticky note or pencil marks, found by what the note says.

   It was buildAnnotations() and four helpers in app/systole.html (docs/ROADMAP.md, E1 step 3). They are here
   as functions of what they are given, so what the screen says can be held without a page:

     screenHtml(p, rows)        the whole screen, for the rows that match what is typed
     listHtml(p, rows)          the list: a row each, or a line that says why there is none
     rowHtml(p, r)              one question's row
     countText(p, all, shown)   the line above the list
     practiseHtml(p, n)         what the Practise button says

   Typing repaints the list, the count and the button and nothing else, so the keyboard stays in the box.
   That is why those three are functions of their own: the page's annoInput() asks for each as a key goes down.

   p is what the page has, under the page's own names for it, so the bodies moved as they stood:

       ANNO          the screen's state: q, what is typed, and rows, every annotated question, made by
                     the page as the screen is drawn. Read here, never changed.
       S             of the page's state, the flagged and the missed (two Sets) and no more of it
       CH_COLORS     a chapter's colour, by name; a chapter with none takes the teal
       FlagSet       src/core/flagset.js, for words() and highlight()
       chInk, clip   the page's helpers: a chapter colour as readable ink (it asks the theme), and a
                     text cut short at a word
       e, icon       the page's helpers

   A row r is one of FlagSet.annotated()'s: { id, q, notes, text, ink } with q the question.

   WHAT THE SCREEN SAYS:

     1. A row names the question's chapter and number, says whether it is flagged or was missed, and
        whether it carries notes (one, or how many) or pencil. It shows what the notes say, or says the
        note is empty or that there is only pencil; then the start of the question.
     2. What is typed is marked where it is found, in the note and in the question, by FlagSet.highlight(),
        which escapes a piece at a time. Nothing a note or a question holds reaches the page as markup.
     3. The count says how many questions are annotated, or how many match once words are typed; white
        space or punctuation alone is not words.
     4. With no rows to show it says which case it is: nothing matched what was typed, or nothing is
        written anywhere yet.
     5. The Practise button says how many, and is disabled with none.

   The box and the buttons carry no inline handler (docs/ROADMAP.md, E2): the box names the annoInput action,
   which the page's input listener (src/core/actions.js, over INPUT_ACTIONS) calls with what is in the box as
   a key goes down, and the buttons practiceAnnotated and goStudy, from the page's ACTIONS table. A tap on a
   row is caught by the page's listener on [data-anno]. The functions stay the page's.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function countText(p,all,shown){
  const {ANNO,FlagSet}=p;
  return !all?'Nothing is written on any question yet.'
    :ANNO.q.trim()&&FlagSet.words(ANNO.q).length?shown+' of '+all+' match':all+' question'+(all===1?'':'s')+' with a sticky note or pencil marks';
}

function rowHtml(p,r){
  const {ANNO,S,CH_COLORS,FlagSet,chInk,clip,e,icon}=p;
  const q=r.q, col=CH_COLORS[q.ch]||'var(--teal)', w=ANNO.q;
  return `<button class="hit anno-row" type="button" data-anno="${e(r.id)}" style="border-left-color:${col}">
    <div class="hit-top"><span class="hit-ch" style="background:${col}1F;color:${chInk(col)}">${e(q.ch)} · ${q.n}</span>
      ${S.flagged.has(r.id)?'<span class="hit-flag flagged">flagged</span>':''}
      ${S.missed.has(r.id)?'<span class="hit-flag">previously missed</span>':''}
      ${r.notes?`<span class="hit-fig">${icon('sticky-note','icon-sm')} ${r.notes>1?r.notes+' notes':'note'}</span>`:''}
      ${r.ink?`<span class="hit-fig">${icon('pencil','icon-sm')} pencil</span>`:''}</div>
    ${r.text?`<div class="anno-text">${FlagSet.highlight(clip(r.text,320),w,e)}</div>`:`<div class="anno-text none">${r.notes?'An empty sticky note':'Pencil marks, no words'}</div>`}
    <div class="anno-stem">${FlagSet.highlight(clip(q.s,150),w,e)}</div>
  </button>`;
}

function listHtml(p,rows){
  const {ANNO,e}=p;
  const annoRowHtml=r=>rowHtml(p,r);
  if(rows.length) return rows.map(annoRowHtml).join('');
  return ANNO.rows.length
    ?`<div class="sb-none">Nothing matched <b>${e(ANNO.q)}</b>.<br><span>Try fewer or shorter words. It looks in the note, the chapter and the question.</span></div>`
    :`<div class="sb-none">Nothing is written on any question yet.<br><span>Open a question, choose the pencil, then the sticky note: what you write is kept here.</span></div>`;
}

function practiseHtml(p,n){
  const {icon}=p;
  return `Practise these ${n} ${icon('arrow-right','icon-sm')}`;
}

function screenHtml(p,rows){
  const {ANNO,e,icon}=p;
  /* The pieces, under the names the body below calls them by. */
  const annoPractiseHtml=n=>practiseHtml(p,n), annoCountText=(all,shown)=>countText(p,all,shown), annoListHtml=list=>listHtml(p,list);
  return `<div class="home-wrap anim-fade anno-wrap">
    <div class="search-bar">
      <div class="sb-row">
        <span class="sb-icon">${icon('pencil')}</span>
        <input id="annoQ" type="search" placeholder="Find a note by what it says…" aria-label="Search your annotations"
          value="${e(ANNO.q)}" autocomplete="off" autocapitalize="off" spellcheck="false" data-action="annoInput">
      </div>
      <div class="sb-row2">
        <button class="btn btn-next sb-quiz" id="annoPractise" type="button" data-action="practiceAnnotated"${rows.length?'':' disabled'}>${annoPractiseHtml(rows.length)}</button>
        <button class="btn sb-back" type="button" data-action="goStudy">${icon('arrow-left','icon-sm')} Chapters</button>
      </div>
    </div>
    <div class="section-label" id="annoCount" role="status">${e(annoCountText(ANNO.rows.length,rows.length))}</div>
    <div class="hits" id="annoList">${annoListHtml(rows)}</div>
  </div>`;
}

root.AnnotationsScreen = { screenHtml, listHtml, rowHtml, countText, practiseHtml };
})(typeof window !== 'undefined' ? window : this);
