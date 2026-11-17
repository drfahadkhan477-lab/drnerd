/* ═════════════════════════════════════════════
   apexpanel.js — the Apex panel's markup: its head, the setup it shows where there is no key, and the
   conversation, with what Apex drew on, the figures from those notes, the suggested prompts and the box
   to write in.

   It was the markup of buildAI() in app/systole.html (docs/ROADMAP.md, E1 step 3). It is here as functions
   of what they are given, so what the panel says can be held without a page:

     headHtml(q, kit)                    the head: Apex, what it is answering from or about, and its
                                         four buttons
     setupPanelHtml(head, kit)           where there is no key to call with: the head, the actions that
                                         need no AI request, the provider settings and the caution
     panelHtml(head, q, hist, kit)       the conversation panel

       q           the question open, or null away from a question
       hist        that question's thread (or the general one): {role, content, reused, err, incomplete}
       head        what headHtml() drew. buildAI() draws the head first and then asks whether there is a
                   key, as it always did, so each panel is handed the head already drawn
       kit         what the panel uses of the page, under the page's names:
                     AI, AI_GROUNDED, REF        the provider settings, whether Apex answers only from
                                                 the notes, and the notes (their count)
                     MODELS, PROVIDERS, CHIPS    the models and providers named, and the suggested prompts;
                                                 a prompt with a third element shows when that says so
                     aiBusy                      whether a reply is being written
                     lastHits, lastHitsKey       the notes and questions the last reply drew on, and which
                                                 thread that was
                     apexChipsOpen, apexFigsOpen whether the prompts and the figures are open
                     apexFigsFor(hits, lastBot, hist)
                                                 the figures from those notes not already in the reply; the
                                                 page keeps the last answer (apexFigMemo), because finding
                                                 them is the costly part and buildAI() runs after every step
                     apexIsFull(), apexHosted(), cur()
                                                 whether the panel is full screen, whether Gemini goes
                                                 through this site, and the provider's settings
                     apexLocalHtml(), setupHtml(), visionBadge(q)
                                                 the page's own pieces: the actions on this device, the
                                                 provider settings, and what the model can see of the figures
                     clip, md, e, icon           the page's helpers
                   The values are handed as they stand when the panel is drawn: the page changes them as
                   a reply arrives, as the panel opens and closes, and as settings are saved, and draws again.

   The parameters carry the names the page uses for the same things, so the markup below moved as it stood.
   tests/verify-apexpanel-pure.js holds what follows, and the page's lines that hand these over.

   WHAT THE PANEL SAYS:

     1. The head: Apex, and under it the notes it is grounded in, or the question's chapter and number with
        what the model can see of its figures, or "Cardiology tutor". Then grounding, pressed when on and
        titled for what it does; full screen or back, as the panel is; settings; close.
     2. With no key, and not Gemini through this site: the actions on this device, the provider settings,
        and that Apex is a study aid that can be wrong.
     3. Otherwise the thread: what was asked, escaped; each reply as markdown, marked where it reused an
        explanation, as an error where it failed, and as cut short where it reached its output limit. With
        no thread, what Apex can do. While a reply is being written, the dots.
     4. What it drew on, for this thread only: a note by its title, a question by its chapter's first word
        and number, which opens it. Then, once a reply is on screen and none is being written, the figures
        from those notes, open or shut.
     5. The suggested prompts, open or shut, those that apply to the question; Explain draft; Clear thread
        once there is one. The box to write in, Send or Stop, the caution, and the model and provider it
        is powered by, through this site's key or the reader's own.

   The buttons name toggleGrounded, toggleApexFull, aiSettings, toggleAI and openFigureFrom, and
   apexLocalHtml()'s apexLocalAction: an inline handler is read where it is tapped, so those stay the
   page's. The prompts, the questions drawn on, the figures' toggle and Send are wired by the page
   (bindChat(), and buildAI() for the questions) once the markup is in.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function headHtml(q, kit){
  const {AI_GROUNDED,REF,visionBadge,apexIsFull,e,icon}=kit;
  const head=`<div class="ai-head">
      <div class="ai-avatar"><canvas id="apexAvatar" aria-hidden="true"></canvas></div>
      <div style="flex:1;min-width:0">
        <div class="ai-title">Apex</div>
        <div class="ai-sub">${AI_GROUNDED
          ? `<span class="grounded-tag">grounded · ${REF.length} note${REF.length===1?'':'s'}</span>`
          : (q?e(q.ch)+' · item '+q.n+visionBadge(q):'Cardiology tutor')}</div>
      </div>
      <button class="icon-btn grounded-btn${AI_GROUNDED?' on':''}"
        onclick="toggleGrounded()" aria-pressed="${AI_GROUNDED?'true':'false'}"
        title="${AI_GROUNDED?'Grounded: answering only from your reference library':'Open: Apex uses its own knowledge'}">${icon("folder")}</button>
      <button class="icon-btn" style="background:var(--card);border-color:var(--border);color:var(--muted)"
        onclick="toggleApexFull()" aria-pressed="${apexIsFull()?'true':'false'}"
        title="${apexIsFull()?'Back to the side panel':'Open Apex full screen'}"
        aria-label="${apexIsFull()?'Back to the side panel':'Open Apex full screen'}">${icon(apexIsFull()?"collapse":"expand")}</button>
      <button class="icon-btn" style="background:var(--card);border-color:var(--border);color:var(--muted)"
        onclick="aiSettings()" title="Settings">${icon("settings")}</button>
      <button class="icon-btn" style="background:var(--card);border-color:var(--border);color:var(--muted)"
        onclick="toggleAI()" title="Close">${icon("x")}</button>
    </div>`;
  return head;
}

function setupPanelHtml(head, kit){
  const {apexLocalHtml,setupHtml}=kit;
  return head+apexLocalHtml()+setupHtml()+`<div class="ai-disclaim">Study aid, not clinical advice — Apex can be wrong; check anything that changes care.</div>`;
}

function panelHtml(head, q, hist, kit){
  const {AI,MODELS,PROVIDERS,CHIPS,aiBusy,lastHits,lastHitsKey,apexChipsOpen,apexFigsOpen,apexFigsFor,apexHosted,apexLocalHtml,cur,clip,md,e,icon}=kit;
  const msgs=hist.length
    ? hist.map(m=>m.role==='user'
        ? `<div class="msg user">${e(m.content)}</div>`
        : `<div class="msg bot">${m.reused?'<p class="src-lbl">Reused explanation · matching context</p>':''}${m.err?icon('alert','icon-sm')+' '+e(m.content):md(m.content)}${m.incomplete?'<p class="src-lbl">Response reached its output limit and may be incomplete. Ask Apex to continue.</p>':''}</div>`).join('')
    : `<div class="msg bot"><p>Ask me anything about the item you're on — mechanism, the distractors, the trial evidence, or the concept underneath.</p><p>I can also <b>search your whole question bank</b>, <b>read your score history</b>, <b>explain your misses</b>, <b>plan a session</b>, <b>build you a quiz</b>, and <b>save notes</b> into your reference library. Try <i>"where am I weakest?"</i> or <i>"why do I keep missing these?"</i>.</p></div>`;
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
    ${figs.map(f=>`<figure class="ai-fig" onclick="openFigureFrom(this)" role="button" tabindex="0"
      title="Open this figure full size"><img src="${f.dataUrl}" alt="${e(f.caption)}" loading="lazy">
      <figcaption>${e(clip(f.caption,150))}<span class="ai-fig-src">${e(clip(f.noteTitle,44))}</span></figcaption></figure>`).join('')}</div></div>`:'';
  return head+
    `<div class="ai-body" id="aiBody" role="region" aria-label="Apex conversation" tabindex="0">${apexLocalHtml()}${msgs}${aiBusy?'<div class="msg bot" id="aiLive"><span class="typing"><i></i><i></i><i></i></span></div>':''}</div>
     ${srcStrip}
     ${figStrip}
     <div class="chips${apexChipsOpen?' open':''}" id="aiChips">${CHIPS.map((c,i)=>(!c[2]||c[2](q))?`<button class="chip${i<2?' hot':''}" data-chip="${i}">${e(c[0])}</button>`:'').join('')}
       <button class="chip" data-chip="explain" title="Explain your draft using supplied context, without study tools">Explain draft · no tools</button>
       ${hist.length?'<button class="chip" data-chip="clear">Clear thread</button>':''}</div>
     <div class="ai-foot"><div class="ai-input">
       <button class="ai-more${apexChipsOpen?' on':''}" id="aiMore" type="button"
         aria-controls="aiChips" aria-expanded="${apexChipsOpen?'true':'false'}"
         title="Suggested prompts" aria-label="Suggested prompts">${icon('zap','icon-sm')}</button>
       <textarea id="aiIn" rows="1" placeholder="Ask about this question…"></textarea>
       <button class="ai-send${aiBusy?' stopping':''}" id="aiSend" type="button"
         title="${aiBusy?'Stop':'Send'}" aria-label="${aiBusy?'Stop generating':'Send'}"
         >${aiBusy?'■':icon('send','icon-sm')}</button>
     </div><div class="ai-disclaim">Study aid, not clinical advice — Apex can be wrong; check anything that changes care.</div><div class="ai-powered">Powered by <b>${e(((MODELS[AI.provider]||[]).find(m=>m[0]===cur().model)||['',cur().model||'—'])[1].split(' — ')[0])}</b> on ${e((PROVIDERS.find(p=>p[0]===AI.provider)||['',AI.provider])[1])} · ${(AI.provider==='gemini'&&apexHosted())
        ?'hosted key, called through this site'
        :'your own key, called directly from this device'}</div></div>`;
}

root.ApexPanel = { headHtml, setupPanelHtml, panelHtml };
})(typeof window !== 'undefined' ? window : this);
