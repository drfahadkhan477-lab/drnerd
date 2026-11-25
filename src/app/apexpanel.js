/* ═════════════════════════════════════════════
   apexpanel.js — the Apex panel's markup: its head, the setup it shows where there is no key, and the
   conversation, with what Apex drew on, the figures from those notes, the suggested prompts and the box
   to write in.

   It was the markup of buildAI() in app/systole.html (docs/ROADMAP.md, E1 step 3). It is here as functions
   of what they are given, so what the panel says can be held without a page:

     headHtml(q, kit, session)           the head: Apex, what it is answering from or about, as one
                                         button that closes the panel; then, on a question, the session
                                         the page draws (its pill, which opens below the head)
     setupPanelHtml(head, kit)           where there is no key to call with: the head, the actions that
                                         need no AI request, the provider settings and the caution
     panelHtml(head, q, hist, kit)       the conversation panel

       q           the question open, or null away from a question
       hist        that question's thread (or the general one): {role, content, reused, err, incomplete}
       head        what headHtml() drew. buildAI() draws the head first and then asks whether there is a
                   key, as it always did, so each panel is handed the head already drawn
       kit         what the panel uses of the page, under the page's names:
                     AI_GROUNDED, REF            whether Apex answers only from the notes, and the notes
                                                 (their count)
                     CHIPS                       the suggested prompts; a prompt with a third element shows
                                                 when that says so
                     aiBusy                      whether a reply is being written
                     lastHits, lastHitsKey       the notes and questions the last reply drew on, and which
                                                 thread that was
                     apexChipsOpen, apexFigsOpen whether the prompts and the figures are open
                     apexFigsFor(hits, lastBot, hist)
                                                 the figures from those notes not already in the reply; the
                                                 page keeps the last answer (apexFigMemo), because finding
                                                 them is the costly part and buildAI() runs after every step
                     refImgAttrs(key, src)       a figure's width and height as attributes, so it keeps its
                                                 room while it loads (src/core/imagesize.js), or ''
                     apexLocalHtml(inTray), setupHtml(), visionBadge(q)
                                                 the page's own pieces: the actions on this device (in the
                                                 tray, with the session's asks first), the provider settings,
                                                 and what the model can see of the figures
                     clip, md, e, icon           the page's helpers
                   The values are handed as they stand when the panel is drawn: the page changes them as
                   a reply arrives, as the panel opens and closes, and as settings are saved, and draws again.

   The parameters carry the names the page uses for the same things, so the markup below moved as it stood.
   tests/verify-apexpanel-pure.js holds what follows, and the page's lines that hand these over.

   WHAT THE PANEL SAYS:

     1. The head: Apex, and under it the notes it is grounded in, or the question's number with whether the
        model can see its figures (it changes what the answers can be trusted with), or "Cardiology tutor";
        the whole of it closes the panel. Grounding, full screen and the connection are Settings'.
     2. With no key, and not Gemini through this site: the actions on this device, the provider settings,
        and that Apex is a study aid that can be wrong.
     3. Otherwise the thread: what was asked, escaped; each reply as markdown, marked where it reused an
        explanation, as an error where it failed, and as cut short where it reached its output limit. With
        no thread, one line asking for a question. While a reply is being written, the dots.
     4. What it drew on, for this thread only: a note by its title, a question by its chapter's first word
        and number, which opens it. Then, once a reply is on screen and none is being written, the figures
        from those notes, open or shut.
     5. The tray, open or shut (shut until the ⚡ opens it): the session's asks and the actions on this
        device, then the suggested prompts that apply to the question; Explain draft; Clear thread once there
        is one. The box to write in, Send or Stop, and the caution. Nothing else: the owner asked for a clean
        chat window (November 2026), so the model and provider are Settings' to say.

   The buttons name toggleAI (the head, which closes the panel) and openFigureFrom, and
   apexLocalHtml()'s apexLocalAction: an inline handler is read where it is tapped, so those stay the
   page's. The prompts, the questions drawn on, the figures' toggle and Send are wired by the page
   (bindChat(), and buildAI() for the questions) once the markup is in.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function headHtml(q, kit, session){
  const {AI_GROUNDED,REF,visionBadge,icon}=kit;
  /* One control, the owner's choice of November 2026: the mark and the name close the panel, as the master Apex Brain
     opened it. Grounding, full screen and the connection are Settings' (its Apex section), not buttons here. */
  const head=`<div class="ai-head">
      <button class="ai-mark" type="button" data-action="toggleAI" aria-label="Close Apex" title="Close Apex">
        <span class="ai-avatar"><canvas id="apexAvatar" aria-hidden="true"></canvas></span>
        <span class="ai-mark-text"><span class="ai-title">Apex</span>
        <span class="ai-sub">${AI_GROUNDED
          ? `<span class="grounded-tag">grounded · ${REF.length} note${REF.length===1?'':'s'}</span>`
          : (q?'Item '+q.n+visionBadge(q):'Cardiology tutor')}</span></span>
        <span class="ai-mark-close" aria-hidden="true">${icon('chevron-down','icon-sm')}</span>
      </button>${session||''}
    </div>`;
  return head;
}

function setupPanelHtml(head, kit){
  const {apexLocalHtml,setupHtml}=kit;
  return head+apexLocalHtml()+setupHtml()+`<div class="ai-disclaim">Study aid, not clinical advice — Apex can be wrong; check anything that changes care.</div>`;
}

function panelHtml(head, q, hist, kit){
  const {CHIPS,aiBusy,lastHits,lastHitsKey,apexChipsOpen,apexFigsOpen,apexFigsFor,refImgAttrs,apexLocalHtml,clip,md,e,icon}=kit;
  const msgs=hist.length
    ? hist.map(m=>m.role==='user'
        ? `<div class="msg user">${e(m.content)}</div>`
        : `<div class="msg bot">${m.reused?'<p class="src-lbl">Reused explanation · matching context</p>':''}${m.err?icon('alert','icon-sm')+' '+e(m.content):md(m.content)}${m.incomplete?'<p class="src-lbl">Response reached its output limit and may be incomplete. Ask Apex to continue.</p>':''}</div>`).join('')
    : `<div class="msg bot ai-hello"><p>${q?'Ask about this question, or anything in cardiology.':'Ask anything in cardiology.'}</p></div>`;
  /* Only the notes retrieved for THIS conversation — see lastHitsKey. */
  const hits=(lastHitsKey===(q?q.id:'_general'))?lastHits:[];
  const srcStrip=hits.length?`<div class="src-strip" data-apex-sources><span class="src-lbl">drawing on</span>${
    hits.map(h=>h.kind==='r'
      ? `<span class="src-pill ref">${icon('folder','icon-sm')} ${e(clip(h.title,26))}</span>`
      : `<button class="src-pill" data-jump="${h.id}">${e(h.ch.split(' ')[0])} · ${h.n}</button>`).join('')}</div>`:'';
  /* Only while a reply is on screen: a figure hanging under an empty thread,
     or under the setup screen, is furniture rather than evidence. Suppressed
     when the model already placed the same figure inline, so it is never shown
     twice in one answer. */
  const lastBot=hist.length&&hist[hist.length-1].role!=='user'?String(hist[hist.length-1].content||''):'';
  const figs=apexFigsFor(hits,lastBot,hist);
  const figStrip=figs.length?`<div class="fig-strip${apexFigsOpen?' open':''}" id="aiFigWrap">
    <button class="src-lbl fig-toggle" type="button" id="aiFigs" aria-controls="aiFigList"
      aria-expanded="${apexFigsOpen?'true':'false'}">${icon('chevron-down','icon-sm')}${figs.length} figure${figs.length===1?'':'s'} from those notes</button>
    <div class="fig-list" id="aiFigList">
    ${figs.map(f=>`<figure class="ai-fig" data-action="openFigureFrom" role="button" tabindex="0"
      title="Open this figure full size"><img src="${f.dataUrl}" alt="${e(f.caption)}"${refImgAttrs(f.key,f.dataUrl)} loading="lazy">
      <figcaption>${e(clip(f.caption,150))}<span class="ai-fig-src">${e(clip(f.noteTitle,44))}</span></figcaption></figure>`).join('')}</div></div>`:'';
  return head+
    `<div class="ai-body" id="aiBody" role="region" aria-label="Apex conversation" tabindex="0">${msgs}${aiBusy?'<div class="msg bot" id="aiLive"><span class="typing"><i></i><i></i><i></i></span></div>':''}</div>
     ${srcStrip}
     ${figStrip}
     <div class="chips${apexChipsOpen?' open':''}" id="aiChips">${apexLocalHtml(true)}${CHIPS.map((c,i)=>(!c[2]||c[2](q))?`<button class="chip${i<2?' hot':''}" data-chip="${i}">${e(c[0])}</button>`:'').join('')}
       <button class="chip" data-chip="explain" title="Explain your draft using supplied context, without study tools">Explain draft · no tools</button>
       ${hist.length?'<button class="chip" data-chip="clear">Clear thread</button>':''}</div>
     <div class="ai-foot"><div class="ai-input">
       <button class="ai-more${apexChipsOpen?' on':''}" id="aiMore" type="button"
         aria-controls="aiChips" aria-expanded="${apexChipsOpen?'true':'false'}"
         title="Prompts and shortcuts" aria-label="Prompts and shortcuts">${icon('zap','icon-sm')}</button>
       <textarea id="aiIn" rows="1" placeholder="Ask about this question…"></textarea>
       <button class="ai-send${aiBusy?' stopping':''}" id="aiSend" type="button"
         title="${aiBusy?'Stop':'Send'}" aria-label="${aiBusy?'Stop generating':'Send'}"
         >${aiBusy?'■':icon('send','icon-sm')}</button>
     </div><div class="ai-disclaim">Study aid, not clinical advice — Apex can be wrong; check anything that changes care.</div></div>`;
}

/* ── the place you had scrolled to ──
   They were the page's APEX_STICK, apexAtBottom(), apexStick() and the place apexPanelRestore() put the
   conversation back to; the page keeps apexAtBottom() and apexStick() as one line each, and what is read of the
   panel and put back into it.

     STICK                  px of slack: "at the bottom" is not an exact number
     atBottom(el)           whether el is scrolled to within STICK of its end; no element counts as at the bottom
     stick(body)            a reply arriving keeps you at the bottom if you were there, and never moves you otherwise
     keepPlace(body, st)    after a rebuild: the bottom if you were there (st.pinned), else where you were (st.top) */
const STICK=40;
function atBottom(el){
  return !el || (el.scrollHeight - el.scrollTop - el.clientHeight) < STICK;
}
/* Used by every streaming tick as well: a reply arriving is not a reason to
   move someone who is reading something further up. */
function stick(body){ if(body && atBottom(body)) body.scrollTop=body.scrollHeight; }
/* Only when it differs. Writing scrollTop is a no-op in principle when the
   value is unchanged, but on iOS writing it AT ALL during a momentum scroll
   stops the momentum — and this runs on every rebuild, which is after every
   tool step. */
function keepPlace(body,st){
  const want = st.pinned ? body.scrollHeight : st.top;
  if(Math.abs(body.scrollTop - want) > 1) body.scrollTop = want;
}

root.ApexPanel = { headHtml, setupPanelHtml, panelHtml, STICK, atBottom, stick, keepPlace };
})(typeof window !== 'undefined' ? window : this);
