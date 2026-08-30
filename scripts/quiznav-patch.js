#!/usr/bin/env node
/*
 * A Previous button in the quiz — and the state to make it safe.
 *
 *   node scripts/quiznav-patch.js <in.html> <out.html>
 *
 * nextQ() only ever moved qIdx forward, and the quiz kept no memory of a
 * question once it was left: S.selected and S.answered were reset to nothing
 * on every advance. There was no way back from a skip, and none from an
 * accidental Next either.
 *
 * THE HARD PART IS NOT THE BUTTON, it is not re-grading. selectOpt() writes
 * chapter stats, the missed set, the review log and the FSRS card the moment
 * an option is chosen, and in review mode rateReview() writes the FSRS
 * schedule again on top of that. Both are write-once by construction — call
 * them twice on the same question and a chapter's stats double-count, or a
 * card's due date gets pushed out twice for one review. So going back cannot
 * simply re-show the question; it has to reconstruct EXACTLY what render()
 * showed the first time, without going anywhere near either write path.
 *
 * S.answers[qIdx] is that memory: {selected, rated}. selectOpt already
 * refuses to run a second time once S.answered is true (and the option
 * buttons are disabled the moment it is, so a tap cannot even reach it) — so
 * restoring S.answered from this map for real gets that guard for free. The
 * same is true of rateReview once its question is marked rated: the rate-row
 * that calls it is the thing that stops rendering, not a new check inside the
 * function, which is the same "the button that could misfire does not exist"
 * discipline the option buttons already use.
 *
 * A skipped question is deliberately different: nothing is written to
 * S.answers for it, so going back finds no entry, S.answered comes back
 * false, and the question is exactly as answerable as it was the first time.
 * That is the whole of "skip by mistake" — there is no separate skip-recovery
 * path to get wrong, because a skip never left a mark to recover from.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/quiznav-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

/* The live quiz fields (questions, qIdx, selected, answered) are already
   deliberately absent from save()'s whitelist — a reload always returns to
   the home screen, never mid-quiz — so S.answers never needs to survive a
   reload either. This is only for a render path that reaches buildQuiz
   before startQuiz has run. */
patch('quiznav: the initial state literal carries the same field',
"let S={screen:'home',chapter:null,questions:[],qIdx:0,selected:null,answered:false,",
"let S={screen:'home',chapter:null,questions:[],qIdx:0,selected:null,answered:false,answers:{},");

patch('quiznav: a quiz session remembers what it has shown',
"  Object.assign(S,{screen:'quiz',chapter:ch,questions:qs,qIdx:0,selected:null,\n    answered:false,mode,zoomed:-1,quizCorrect:0,quizTotal:0});",
"  Object.assign(S,{screen:'quiz',chapter:ch,questions:qs,qIdx:0,selected:null,\n    answered:false,mode,zoomed:-1,quizCorrect:0,quizTotal:0,answers:{}});");

patch('quiznav: grading a question records what was chosen',
"  S.selected=idx;S.answered=true;save();render();",
"  S.selected=idx;S.answered=true;S.answers[S.qIdx]={selected:idx,rated:false};save();render();");

patch('quiznav: a review rating is recorded too, so going back cannot repeat it',
"function rateReview(grade){\n  const q=S.questions[S.qIdx]; if(!q||!S.answered) return;\n  logReview(q,grade,grade>=2,'review');\n  S.srs[q.id]=FSRS.update(S.srs[q.id],grade,todayISO());\n  logRated();\n  bumpStreak();\n  save();\n  nextQ();\n}",
"function rateReview(grade){\n  const q=S.questions[S.qIdx]; if(!q||!S.answered) return;\n  const ans=S.answers[S.qIdx]; if(ans&&ans.rated) return;   // the rate-row is gone once true; this is the second line of defence\n  logReview(q,grade,grade>=2,'review');\n  S.srs[q.id]=FSRS.update(S.srs[q.id],grade,todayISO());\n  if(ans) ans.rated=true;\n  logRated();\n  bumpStreak();\n  save();\n  nextQ();\n}");

/* Restoring on arrival, not on departure, is deliberate: nextQ/prevQ change
   qIdx and then ask "what was shown here", rather than trying to remember
   what to undo. One restore function serves both directions. */
patch('quiznav: nextQ and prevQ both restore, they do not just reset',
"function nextQ(){\n  toTop();\n  if(S.qIdx>=S.questions.length-1){S.screen='results';render();\n    try{ summariseSession(); }catch(_){}}\n  else{S.qIdx++;S.selected=null;S.answered=false;S.zoomed=-1;render();}\n}",
"function restoreQuizState(){\n  const a=S.answers[S.qIdx];\n  S.selected=a?a.selected:null;\n  S.answered=!!a;\n  S.zoomed=-1;\n}\nfunction nextQ(){\n  toTop();\n  if(S.qIdx>=S.questions.length-1){S.screen='results';render();\n    try{ summariseSession(); }catch(_){}}\n  else{S.qIdx++;restoreQuizState();render();}\n}\nfunction prevQ(){\n  if(S.qIdx<=0)return;\n  toTop();\n  S.qIdx--;restoreQuizState();render();\n}");

patch('quiznav: the panel knows which question it is on',
"  const {questions,qIdx,selected,answered}=S;",
"  const {questions,qIdx,selected,answered}=S;\n  const ansHere=S.answers[qIdx];\n  const alreadyRated=S.mode==='due'&&!!(ansHere&&ansHere.rated);\n  const canGoBack=qIdx>0;");

patch('quiznav: a rated review question stays rated, not re-askable',
"  const reviewing = answered && S.mode==='due';",
"  const reviewing = answered && S.mode==='due' && !alreadyRated;");

/* One button, one place, both branches: it sits beside Home whether the
   question is answered or not, because "go back" is meaningful either way —
   before answering to re-read something, after to see it once more. */
patch('quiznav: Previous sits beside Home in both action rows',
"  const actions = reviewing ? '' : answered\n    ?`<button class=\"btn btn-home\" onclick=\"goHome()\" type=\"button\" aria-label=\"Home\">${icon('home')}</button>\n      <button class=\"btn btn-next anim-pop\" onclick=\"nextQ()\" type=\"button\">${qIdx<questions.length-1?'Next Question':'View Results'} ${icon('arrow-right','icon-sm')}</button>`\n    :`<button class=\"btn btn-home\" onclick=\"goHome()\" type=\"button\" aria-label=\"Home\">${icon('home')}</button>\n      <button class=\"btn btn-skip\" onclick=\"nextQ()\" type=\"button\">Skip ${icon('arrow-right','icon-sm')}</button>`;",
"  const prevBtn=canGoBack?`<button class=\"btn btn-prev\" onclick=\"prevQ()\" type=\"button\" aria-label=\"Previous question\">${icon('arrow-left','icon-sm')}</button>`:'';\n  const actions = reviewing ? '' : answered\n    ?`<button class=\"btn btn-home\" onclick=\"goHome()\" type=\"button\" aria-label=\"Home\">${icon('home')}</button>${prevBtn}\n      <button class=\"btn btn-next anim-pop\" onclick=\"nextQ()\" type=\"button\">${qIdx<questions.length-1?'Next Question':'View Results'} ${icon('arrow-right','icon-sm')}</button>`\n    :`<button class=\"btn btn-home\" onclick=\"goHome()\" type=\"button\" aria-label=\"Home\">${icon('home')}</button>${prevBtn}\n      <button class=\"btn btn-skip\" onclick=\"nextQ()\" type=\"button\">Skip ${icon('arrow-right','icon-sm')}</button>`;");

patch('quiznav: .btn-prev styled as a secondary action, beside .btn-home',
'.btn-home{background:var(--card);border:1.5px solid var(--border);color:var(--muted);\n  font-size:13px;flex:0;min-width:52px;padding:15px 14px}',
'.btn-home{background:var(--card);border:1.5px solid var(--border);color:var(--muted);\n  font-size:13px;flex:0;min-width:52px;padding:15px 14px}\n.btn-prev{background:var(--card);border:1.5px solid var(--border);color:var(--muted);\n  font-size:13px;flex:0;min-width:52px;padding:15px 14px}\n.btn-prev:hover{border-color:var(--navy);color:var(--navy)}\n.btn-prev:active{transform:scale(.94)}');

fs.writeFileSync(OUT, html);
console.log(`Quiz navigation — ${edits.length} edit(s)`);
edits.forEach(e => console.log('  ✓ ' + e));
console.log(`written: ${OUT}`);
