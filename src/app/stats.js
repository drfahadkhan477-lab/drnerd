/* ═════════════════════════════════════════════
   stats.js — the Progress screen: the streak and totals, the figures kept on this device, predicted
   retention and the week ahead, calibration, the mock blocks handed in, the last thirty days, chapter
   mastery, and the reader's data.

   It was buildStats(), calibPanel() with pct() and secs(), retentionTile() and mockPanel() in
   app/systole.html (docs/ROADMAP.md, E1 step 3). They are here as functions of what they are given, so
   what the screen says can be held without a page:

     screenHtml(S, LOG, CHAPTERS, CH_COLORS, kit)   the screen's markup, as a string
     calibHtml(LOG, kit)                            the calibration panel, or nothing before anything is rated
     retentionHtml(S, kit)                          predicted retention and the next seven days, or nothing
                                                    before a card is scheduled
     mockHtml(S, kit)                               the blocks handed in, the last eight, or nothing before one

       S           the page's state. Read, never changed: daily, reviewStreak, srs and mocks. The two panels
                   that read srs and mocks are each handed that field alone, under the name S, so the screen's
                   own function is seen to read all four.
       LOG         the review log: its length, and what Calib makes of it
       CHAPTERS    the bank's chapters, a ring each
       CH_COLORS   the chapters' accents
       kit         what the screen uses of the page, under the page's names:
                     Calib, MockExam                  src/core/calib.js and src/core/mockexam.js
                     certainWrongQs()                 the bank's questions answered Certain and wrong and not since
                                                      answered right (Calib.certainWrong over the log), newest first
                     TOTAL_Q, CH_SHORT                how many questions the bank has; the chapters' short names
                     pendingBackupSave                a backup written and not yet confirmed saved, as it stands
                                                      when the screen is drawn
                     last30(), forecast7()            the last thirty days answered, and the cards due each of
                                                      the next seven
                     avgRetention()                   the average chance of recalling a scheduled card today
                     startedCount(), dueQuestions()   cards started in this bank, and those due now
                     masteryFor(ch)                   a chapter's mastery, 0 to 1
                     storageOK(), storageLine()       whether this device can save, and what it says of its storage
                     safariTabStorage()               whether this is a Safari tab, whose data has seven days
                     offlineCapable()                 whether the figures can be kept on this device
                     chIcon, e, icon                  the page's helpers
                   Those functions are the page's because they read its state, its storage or its browser, and
                   other screens and handlers use them too.

   The parameters carry the names the page uses for the same things, so the bodies below moved as they
   stood. tests/verify-statsscreen-pure.js holds what follows, and the page's lines that hand these over.

   WHAT THE SCREEN SAYS:

     1. Whether progress is saved on this device, and the way home.
     2. The streak, how many answered, the accuracy, and how many are due now.
     3. Where figures can be kept on this device, the card the page's survey fills in, with the download.
     4. Predicted retention with its colour, across how many scheduled cards, and a bar for each of the
        next seven days.
     5. Calibration: how often "Certain" was wrong, a bar for each band, the button that practises the
        questions answered Certain and wrong, a Brier score a week, the pace right and wrong, and where
        the misses come from.
     6. The mock blocks handed in: the last eight as bars, and the last one in words.
     7. The last thirty days as a line and a heat map.
     8. A ring for each chapter's mastery, each starting a quiz in that chapter.
     9. The reader's data: export, the confirmation a pending backup asks for, import, reset, the Safari
        tab's warning, how many reviews are logged and the state of the storage.

   The buttons name actions, not inline handlers (docs/ROADMAP.md, E2), which the page's ACTIONS table calls
   (src/core/actions.js): goHome, startCertainWrong, exportMarkup, confirmBackupSaved, importMarkup and resetProgress, each by
   the page's function of that name; startChapter, which starts a quiz in the chapter a ring carries in
   data-ch, through e(); and offlineButton, the figures card's button, which stops a download while one runs
   and starts one otherwise. The functions stay the page's. The page also
   starts its survey of the figures on this device as it draws this screen; that is the page's doing, and
   stays in its line.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function pct(x){ return Math.round(x*100)+"%"; }
function secs(ms){ return ms==null?"—":(ms<10000?(ms/1000).toFixed(1):Math.round(ms/1000))+"s"; }
function calibHtml(LOG, kit){
  const {Calib,certainWrongQs,e}=kit;
  const cal=Calib.calibration(LOG), sp=Calib.speed(LOG), rs=Calib.reasons(LOG), tr=Calib.brierTrend(LOG,8);
  const cw=certainWrongQs().length;
  if(!cal.rated && !sp.n && !rs.tagged) return "";
  const bars=cal.bands.map(function(b){
    const w = b.accuracy==null ? 0 : Math.round(b.accuracy*100);
    const val = b.accuracy==null ? ("needs "+(Calib.MIN_SAMPLES-b.n)+" more") : pct(b.accuracy);
    return '<div class="cb-row"><span class="cb-lab">'+e(b.label)+'</span>'
      + '<span class="cb-track"><span class="cb-fill" style="width:'+w+'%"></span></span>'
      + '<span class="cb-val'+(b.accuracy==null?" cb-thin":"")+'">'+e(val)+'</span></div>';
  }).join("");
  const head = cal.certainButWrong==null
    ? '<div class="cb-head cb-thin">Rate a few more answers and this will show how often "Certain" was wrong.</div>'
    : '<div class="cb-head">Certain, and wrong: <b>'+pct(cal.certainButWrong)+'</b>'
      + '<span class="cb-sub">the gap you cannot feel from the inside</span></div>';
  /* docs/ROADMAP.md, S5: the questions answered Certain and wrong and not since answered right, to practise. */
  const queue = !cw ? '' : '<button class="btn cb-go" type="button" data-action="startCertainWrong">Practise the '
    + (cw===1 ? 'one' : cw) + ' answered Certain and wrong</button>';
  /* A Brier score a week, once two weeks each have enough rated answers; a week with too few says so. */
  const week = function(w){
    const d=new Date(w.week+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'});
    return '<div class="cb-row"><span class="cb-lab">'+e(d)+'</span>'
      + '<span class="cb-track"><span class="cb-fill" style="width:'+(w.brier==null?0:Math.round(w.brier*100))+'%"></span></span>'
      + '<span class="cb-val'+(w.brier==null?' cb-thin':'')+'">'+e(w.brier==null?w.n+' rated':w.brier.toFixed(2))+'</span></div>';
  };
  const trend = !cal.rated ? '' : '<div class="panel-h cb-h2">Calibration by week</div>' + (!tr.enough
    ? '<div class="cb-thin">A score a week shows here once two weeks each have '+Calib.MIN_SAMPLES+' rated answers.</div>'
    : '<div class="cb-sub">Brier score: the gap between how sure you said you were and how it went. Lower is better.</div>'
      + tr.weeks.map(week).join(''));
  const speed = !sp.enough ? '<div class="cb-thin">Not enough timed answers yet.</div>'
    : '<div class="cb-row2">Correct in <b>'+secs(sp.correctMs)+'</b> · wrong in <b>'+secs(sp.wrongMs)+'</b>'
      + (sp.fragile ? '<span class="cb-sub">right, but slower than your wrong answers — the concept is there, the retrieval is not yet</span>' : "")
      + '</div>';
  const mix = !rs.enough ? '<div class="cb-thin">'+(rs.misses? "Tag a few misses and the pattern shows here." : "No misses recorded.")+'</div>'
    : rs.counts.filter(function(c){return c.n;}).sort(function(a,b){return b.n-a.n;}).map(function(c){
        return '<div class="cb-row"><span class="cb-lab">'+e(c.label)+'</span>'
          + '<span class="cb-track"><span class="cb-fill" style="width:'+Math.round(c.share*100)+'%"></span></span>'
          + '<span class="cb-val">'+pct(c.share)+'</span></div>';
      }).join("");
  return '<div class="panel"><div class="panel-h">Calibration · '+cal.rated+' rated</div>'
    + head + bars + queue + trend
    + '<div class="panel-h cb-h2">Pace</div>' + speed
    + '<div class="panel-h cb-h2">Where the misses come from</div>' + mix
    + '</div>';
}

function retentionHtml(S, kit){
  const {avgRetention,forecast7,e}=kit;
  const r=avgRetention();
  if(r===null) return '';
  const col=r>=85?'var(--green-ink)':r>=65?'var(--amber-ink)':'var(--red-ink)';
  const fc=forecast7();
  const maxN=Math.max(1,...fc.map(d=>d.n));
  const bars=fc.map((d,i)=>{
    const dow=new Date(d.d+'T00:00:00').toLocaleDateString(undefined,{weekday:'short'})[0];
    const h=Math.round((d.n/maxN)*28)+4;
    return `<div class="fc-bar-wrap" title="${e(d.d)}: ${d.n} due">
      <div class="fc-bar" style="height:${h}px"></div>
      <span class="fc-n">${d.n}</span><span class="fc-dow">${i===0?'today':e(dow)}</span></div>`;
  }).join('');
  return `<div class="panel">
    <div class="panel-h">Predicted retention</div>
    <div class="retention-row">
      <div class="retention-num" style="color:${col}">${r}%</div>
      <div class="retention-sub">Average chance you'd recall a reviewed card today, across ${Object.keys(S.srs).filter(id=>S.srs[id]&&S.srs[id].stability!==undefined).length} scheduled card${Object.keys(S.srs).length===1?'':'s'}.</div>
    </div>
    <div class="fc-title">Next 7 days</div>
    <div class="fc-row">${bars}</div>
  </div>`;
}

function mockHtml(S, kit){
  const {MockExam,e}=kit;
  const h=S.mocks.slice(-8);
  if(!h.length) return '';
  const pc=x=>Math.round(100*x.correct/x.n);
  const bars=h.map(x=>{
    const p=pc(x), cls=p>=80?'g':p>=60?'a':'r';
    const d=new Date(x.ts).toLocaleDateString(undefined,{month:'short',day:'numeric'});
    const t=x.limit!=null?MockExam.fmtClock(x.ms)+' of '+MockExam.fmtClock(x.limit,'down'):MockExam.fmtClock(x.ms);
    return `<div class="mk-bar ${cls}" role="listitem" data-pct="${p}" title="${e(d)}: ${x.correct} of ${x.n}, ${p}%, ${e(t)}"><b>${p}%</b>
      <span class="mk-col"><i style="height:${Math.max(4,p)}%"></i></span><span class="mk-d">${e(d)}</span><em>${x.n} q</em></div>`;
  }).join('');
  const last=S.mocks[S.mocks.length-1], per=Math.round(last.ms/last.n/1000);
  return `<div class="panel" id="mockPanel"><div class="panel-h">Mock exam blocks · ${S.mocks.length}</div>
    <div class="mk-hist" role="list">${bars}</div>
    <div class="ref-hint">Last: ${pc(last)}%, ${last.correct} of ${last.n} in ${e(MockExam.fmtClock(last.ms))}, about ${per} s a question. A question left blank counts as wrong, as it does in the real exam.</div></div>`;
}

function screenHtml(S, LOG, CHAPTERS, CH_COLORS, kit){
  const {TOTAL_Q,CH_SHORT,pendingBackupSave,last30,startedCount,dueQuestions,masteryFor,storageOK,storageLine,safariTabStorage,offlineCapable,chIcon,e,icon}=kit;
  const retentionTile=()=>retentionHtml({srs:S.srs},kit), calibPanel=()=>calibHtml(LOG,kit), mockPanel=()=>mockHtml({mocks:S.mocks},kit);
  const days=last30();
  const maxA=Math.max(1,...days.map(d=>d.a));
  const totalA=Object.values(S.daily).reduce((s,d)=>s+d.a,0);
  const totalC=Object.values(S.daily).reduce((s,d)=>s+d.c,0);
  const acc=totalA?Math.round(totalC/totalA*100):0;
  const seen=startedCount();
  const dueN=dueQuestions().length;
  const ok=storageOK();

  const heat=days.map(d=>{
    const lvl=d.a===0?0:d.a<5?1:d.a<15?2:d.a<30?3:4;
    return `<div class="heat-cell l${lvl}" title="${d.d}: ${d.a} answered, ${d.c} correct"></div>`;
  }).join('');

  const spark=(()=>{
    const w=280,h=54,n=days.length;
    const pts=days.map((d,i)=>{
      const x=i/(n-1)*w;
      const y=h-(d.a/maxA)*(h-6)-3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <polyline points="${pts}" fill="none" stroke="var(--teal)" stroke-width="2"
        stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
  })();

  const rings=CHAPTERS.map(ch=>{
    const m=masteryFor(ch), pct=Math.round(m*100);
    const col=CH_COLORS[ch]||'var(--teal)';
    const R=26, C=2*Math.PI*R;
    return `<button class="mast" style="--accent:${col}" data-action="startChapter" data-ch="${e(ch)}">
      <svg viewBox="0 0 64 64" class="mast-ring">
        <circle cx="32" cy="32" r="${R}" fill="none" stroke="var(--border)" stroke-width="5"/>
        <circle cx="32" cy="32" r="${R}" fill="none" stroke="${col}" stroke-width="5"
          stroke-dasharray="${C}" stroke-dashoffset="${C*(1-m)}" stroke-linecap="round"
          transform="rotate(-90 32 32)"/>
      </svg>
      <span class="mast-ico">${chIcon(ch)}</span>
      <span class="mast-pct">${pct}%</span>
      <span class="mast-name">${e(CH_SHORT[ch]||ch.split(' ')[0])}</span>
    </button>`;
  }).join('');

  return `<div class="home-wrap anim-fade">
    <div class="stats-head">
      <div>
        <div class="stats-title">Your Progress</div>
        <div class="stats-sub">${ok?icon('check','icon-sm')+' Saved locally on this device':icon('alert','icon-sm')+' Local storage unavailable — use Export'}</div>
      </div>
      <button class="btn sb-back" data-action="goHome">${icon('arrow-left','icon-sm')} Home</button>
    </div>

    <div class="stat-grid">
      <div class="stat-tile"><div class="st-v">${S.reviewStreak||0}</div><div class="st-l">day streak ${icon('flame','icon-sm')}</div></div>
      <div class="stat-tile"><div class="st-v">${totalA}</div><div class="st-l">answered</div></div>
      <div class="stat-tile"><div class="st-v">${acc}%</div><div class="st-l">accuracy</div></div>
      <div class="stat-tile"><div class="st-v">${dueN}</div><div class="st-l">due now</div></div>
    </div>
    ${offlineCapable()?`<div class="off-card" id="offlineCard">
      <div class="off-head">
        <span class="off-tag">${icon('image','icon-sm')} On this device</span>
        <span class="off-val">checking…</span>
      </div>
      <div class="off-track"><span class="off-fill" style="width:0%"></span></div>
      <div class="off-foot">
        <span class="off-note">Pull every figure down once and the bank works with no network at all.</span>
        <button class="off-btn" data-action="offlineButton">Download the rest</button>
      </div>
    </div>`:''}
    ${retentionTile()}
    ${calibPanel()}
    ${mockPanel()}

    <div class="panel">
      <div class="panel-h">Last 30 days</div>
      ${spark}
      <div class="heat">${heat}</div>
      <div class="heat-key"><span>less</span>
        <i class="heat-cell l0"></i><i class="heat-cell l1"></i><i class="heat-cell l2"></i>
        <i class="heat-cell l3"></i><i class="heat-cell l4"></i><span>more</span></div>
    </div>

    <div class="panel">
      <div class="panel-h">Chapter mastery · ${seen}/${TOTAL_Q} cards started</div>
      <div class="mast-grid">${rings}</div>
    </div>

    <div class="panel">
      <div class="panel-h">Your data</div>
      <div class="data-row">
        <button class="btn sb-back" data-action="exportMarkup">⤓ Export everything</button>
        ${pendingBackupSave?'<button class="btn sb-back" data-action="confirmBackupSaved">I saved the backup file</button>':''}
        <button class="btn sb-back" data-action="importMarkup">⤒ Import backup</button>
        <button class="btn sb-back" data-action="resetProgress">Reset progress</button>
      </div>
      ${safariTabStorage()?`<div class="notice" id="safariTabNote"><span>${icon('alert')}</span><span><b>Add Systole to your Home Screen to keep this.</b>
        In a Safari tab, Safari deletes a site's saved data (progress, schedule, notes, ink and the downloaded bank) after
        seven days of use without a visit here. The Home Screen app is exempt. Share, then Add to Home Screen; and export a backup.</span></div>`:''}
      <div class="ref-hint">${LOG.length} reviews logged · ${storageLine()}<br>
        Progress, ink, notes and review schedule live in this device's local storage.
        iPadOS can clear that for files opened directly from Files — export a backup before any system update.
        <p class="app-disclaim">For board preparation and education only — not a clinical
        decision-support tool, and not a substitute for current guidelines or professional
        judgement.</p></div>
    </div>
  </div>`;
}

root.StatsScreen = { screenHtml, calibHtml, retentionHtml, mockHtml };
})(typeof window !== 'undefined' ? window : this);
