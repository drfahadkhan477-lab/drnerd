/* ═════════════════════════════════════════════
   search.js — the topic search: a box, a chapter, and every question that matches, offline.

   It was buildSearch(), hl() and snippet() in app/systole.html (docs/ROADMAP.md, E1 step 3). They are here
   as functions of what they are given, so what the screen says can be held without a page:

     screenHtml(SQ, S, CHAPTERS, CH_COLORS, kit)   the screen's markup, as a string
     hl(kit, text, query)                          the text escaped, the words typed marked in it
     snippet(kit, q, query)                        the part of a question where a word typed is found

       SQ          the search's state. Read, never changed: q, what is typed; ch, the chapter chosen
                   ('' for all); hits, the matches, each { q: question, score }
       S           the page's state. Read, never changed: flagged and missed (two Sets)
       CHAPTERS    the bank's chapter names, in the order the choice lists them
       CH_COLORS   a chapter's colour, by name; a chapter with none takes the teal
       kit         what the markup uses of the page: { TOPIC_SUGGEST, BANK_BY, TOTAL_Q, chInk, clip, e, icon }
                   TOPIC_SUGGEST the topics offered before anything is typed; BANK_BY whose commentary
                   the bank has ('' for none) and TOTAL_Q how many questions it has, for the hint

   The parameters carry the names the page uses for the same things, so the bodies below moved as they
   stood. tests/verify-search-pure.js holds what follows, and the page's line that hands these over.

   WHAT THE SCREEN SAYS:

     1. Before anything is typed: the topics to try, and what the search looks in. A topic is marked when it
        is exactly what is typed; the topics are drawn only while nothing is, so the page never shows one
        marked. That is as it was in the page.
     2. Once something is typed: how many match, in which chapter if one is chosen; with none, that
        nothing matched what was typed, and what to try.
     3. A row for each match: its chapter and number, whether it was missed or is flagged, how many
        figures it has; the part of the question where a word typed is, and the right answer, with
        the words typed marked. Every word of a question reaches the page through e().
     4. "Quiz these N" with matches only; a way to clear what is typed only when something is.

   The search itself (runSearch()), what is typed as it is typed (searchInput(), and its timer) and the
   functions the markup's actions call (searchGo, searchChapter, quizFromSearch, jumpTo, goHome) stay the page's.

   No inline handler (docs/ROADMAP.md, E2). Each control names an action the page's tables call
   (src/core/actions.js): a tap, from ACTIONS; the box, from INPUT_ACTIONS as it is typed in; the chapter, from
   CHANGE_ACTIONS when another is chosen. A topic carries what it searches for in data-topic, and a row its
   question's id in data-qid, each through e(); the box and the choice are read for their value when the event
   comes, as this.value was.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

/* highlight matched words — text is escaped first, then wrapped */
function hlText(kit,text,query){
  const {e}=kit;
  const safe=e(text);
  const words=[...new Set(String(query||'').toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>=3))];
  if(!words.length) return safe;
  const alt=words.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
  try{
    return safe.replace(new RegExp('\\b('+alt+')[a-z]{0,4}\\b','gi'),'<mark>$1</mark>');
  }catch(_){ return safe; }
}

function snippetText(kit,q,query){
  const {clip}=kit;
  const words=String(query||'').toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>=3);
  const hay=q.s+' — '+q.ex;
  let at=-1;
  for(const w of words){ const i=hay.toLowerCase().indexOf(w); if(i>-1){at=i;break;} }
  if(at<0) return clip(q.s,180);
  const from=Math.max(0,at-70);
  return (from?'…':'')+hay.slice(from,from+230).replace(/\s+\S*$/,'')+'…';
}

function screenHtml(SQ, S, CHAPTERS, CH_COLORS, kit){
  const {TOPIC_SUGGEST,BANK_BY,TOTAL_Q,chInk,clip,e,icon}=kit;
  /* The two helpers, under the names the body below calls them by. */
  const hl=(text,query)=>hlText(kit,text,query), snippet=(q,query)=>snippetText(kit,q,query);
  const total=SQ.hits.length;
  const chips=TOPIC_SUGGEST.map(t=>
    `<button class="chip${SQ.q===t?' hot':''}" data-action="searchGo" data-topic="${e(t)}">${e(t)}</button>`).join('');
  const chSel=`<select id="sCh" aria-label="Chapter" data-action="searchChapter">
      <option value="">All chapters</option>
      ${CHAPTERS.map(c=>`<option value="${e(c)}"${SQ.ch===c?' selected':''}>${e(c)}</option>`).join('')}
    </select>`;

  const rows=SQ.hits.map(h=>{
    const q=h.q, col=CH_COLORS[q.ch]||'var(--teal)';
    const missed=S.missed.has(q.id);
    return `<button class="hit" data-action="jumpTo" data-qid="${e(q.id)}" style="border-left-color:${col}">
      <div class="hit-top">
        <span class="hit-ch" style="background:${col}1F;color:${chInk(col)}">${e(q.ch)} · ${q.n}</span>
        ${missed?'<span class="hit-flag">previously missed</span>':''}
        ${S.flagged.has(q.id)?'<span class="hit-flag flagged">flagged</span>':''}
        ${q.img?`<span class="hit-fig">${icon('image','icon-sm')} ${q.img}</span>`:''}
      </div>
      <div class="hit-stem">${hl(snippet(q,SQ.q),SQ.q)}</div>
      <div class="hit-ans">${icon('check','icon-sm')} ${hl(clip(q.o[q.ci].t,110),SQ.q)}</div>
    </button>`;
  }).join('');

  return `<div class="home-wrap anim-fade">
    <div class="search-bar">
      <div class="sb-row">
        <span class="sb-icon">${icon('search')}</span>
        <input id="sQ" type="search" placeholder="Search by topic — aortic valve, amyloidosis, long QT…"
          value="${e(SQ.q)}" autocomplete="off" autocapitalize="off" spellcheck="false"
          data-action="searchInput">
        ${SQ.q?`<button class="sb-x" data-action="searchClear" aria-label="Clear">${icon('x','icon-sm')}</button>`:''}
      </div>
      <div class="sb-row2">${chSel}
        ${total?`<button class="btn btn-next sb-quiz" data-action="quizFromSearch">Quiz these ${total} ${icon('arrow-right','icon-sm')}</button>`:''}
        <button class="btn sb-back" data-action="goHome">${icon('arrow-left','icon-sm')} Home</button>
      </div>
    </div>
    ${!SQ.q?`<div class="section-label">Try a topic</div><div class="chips sug">${chips}</div>
       <div class="sb-hint">Searches every stem, answer option and the full ${e(BANK_BY)}commentary across all ${TOTAL_Q} questions. Runs entirely offline — no API key needed.</div>`
      :`<div class="section-label">${total} match${total===1?'':'es'}${SQ.ch?' in '+e(SQ.ch):''}</div>`}
    ${SQ.q&&!total?`<div class="sb-none">Nothing matched <b>${e(SQ.q)}</b>.<br><span>Try a broader term, or a synonym — the index matches words, not meaning.</span></div>`:''}
    <div class="hits">${rows}</div>
  </div>`;
}

root.SearchScreen = { screenHtml, hl: hlText, snippet: snippetText };
})(typeof window !== 'undefined' ? window : this);
