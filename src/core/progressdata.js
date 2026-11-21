/* ═════════════════════════════════════════════
   progressdata.js — what a saved progress record may hold, read before it is taken (docs/ROADMAP.md, E1).

   A backup restored, a record another window wrote, and every export go through these rules, which were
   seven names in app/systole.html. They read nothing of the page's, so they are here as functions of what
   they are given, held by tests/verify-progressdata-pure.js:

     ENTRY                       per statistics map (daily, chStats, practice, srs, resume): the fields that
                                 must be counts, the counts that must be there, and a rule over the entry
     record(v)                   v is a plain object: not null, not an array
     day(s)                      s is a real calendar day written 'YYYY-MM-DD' (FSRS's own reading of it)
     examDay(v)                  the same question for an exam date, read by the calendar
     entryOk(map, entry, key)    one entry of one map passes ENTRY's row for it
     usable(raw)                 a copy of raw with each failing entry left out of each map, the exam history
                                 kept to valid entries and the flags cleaned: what an export writes
     fromBackup(raw)             the state a restore takes: refused with an Error, before anything is stored,
                                 where any entry, count, string or list is not what the app writes

   THE RULES, because each is a way a bad record outlives the restore that let it in:

     1. A whole file is refused for one bad entry. One null day once passed the import, was saved, and
        crashed Progress on every later launch.
     2. More correct than answered is a record the app never wrote, and is refused; so is a day that is not
        on the calendar, and a resume index past the end of its deck.
     3. An absent field is left to the reader's own default, as it always was.
     4. A backup made before flags existed does not empty the flags made since: an absent list says nothing,
        a list, even an empty one, replaces them.
     5. Nothing given is changed.

   It calls FSRS, MockExam and FlagSet, which the page loads before it, through `root` when it is asked, so a
   suite can load them beside it. The page keeps the old names (statRecord, statEntryOk, usableStats,
   progressFromBackup, validExamDate) as one line each.

   Pure: no DOM, no clock, no storage. ES2015; Safari 13.4 is the floor (README).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
/* A calendar day as the app writes one (FSRS.localDateToISO): a daily key, an srs due or last. One that does not
   read back as itself is a day the scheduler and Progress cannot place. */
const day=s=>{ if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d=root.FSRS.isoToLocalDate(s); return !!d&&root.FSRS.localDateToISO(d)===s; };

/* What one entry of each statistics map must hold. The import refuses a file
   with an entry that fails (fromBackup), and an export leaves such an entry
   out (usable), from this one table so the two cannot drift. The Progress
   screen and the scheduler read entries field by field (d.a in buildStats,
   S.srs[id].due in forecast7). A field is checked where the app reads it;
   one that is absent is left to the reader's own default. Per map: the
   fields that must be counts, the counts that must be there, and a rule over
   the whole entry.

   A correct answer is only ever counted as one of the answers (logAnswer,
   selectOpt), so more correct than answered is a record the app never
   wrote. Written as not-greater, not at-most: undefined<=n is false as
   well, which would refuse a missing count there and leave the need lists
   with nothing to prove. */
const ENTRY={
  daily:   [['a','c','r'],['a','c'],(v,key)=>!(v.c>v.a)&&day(key)],
  chStats: [['correct','total'],['correct','total'],v=>!(v.correct>v.total)],  // selectOpt does st.total++, st.correct++
  practice:[['n','c','t'],['n','c'],v=>!(v.c>v.n)],                          // and pr.n++, pr.c++: a missing count is NaN
  srs:     [['reps','lapses','ivl','stability','difficulty'],[],v=>(v.due==null||day(v.due))&&(v.last==null||day(v.last))],
  resume:  [['i','correct','total','ts'],[],v=>(v.ids==null||(Array.isArray(v.ids)&&v.ids.every(x=>typeof x==='string')))
    &&(v.i==null||(Number.isInteger(v.i)&&!(v.ids&&v.i>=v.ids.length)))&&(v.answers==null||record(v.answers))]};

function entryOk(k,v,key){
  const [fields,need,rule]=ENTRY[k], count=x=>x==null||(Number.isFinite(x)&&x>=0);
  return record(v)&&fields.every(f=>count(v[f]))&&need.every(f=>v[f]!=null)&&rule(v,key);
}
function usable(raw){
  if(!record(raw)) return raw;
  const out=Object.assign({},raw);
  for(const k in ENTRY) if(record(out[k]))
    out[k]=Object.fromEntries(Object.entries(out[k]).filter(([key,v])=>entryOk(k,v,key)));
  if('exams' in out) out.exams=Array.isArray(out.exams)?out.exams.filter(root.MockExam.validEntry):[];
  if('flagged' in out) out.flagged=root.FlagSet.clean(out.flagged);
  return out;
}
/* An exam date: a real day on the calendar, written 'YYYY-MM-DD'. */
function examDay(v){
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y,m,d]=v.split('-').map(Number), t=new Date(y,m-1,d);
  return t.getFullYear()===y&&t.getMonth()===m-1&&t.getDate()===d;
}
function fromBackup(raw){
  for(const k in ENTRY) if(raw[k]!=null&&!record(raw[k])) throw new Error('Invalid statistics.');
  /* Every entry too, before anything is stored: see ENTRY. */
  for(const k in ENTRY) for(const [key,v] of Object.entries(raw[k]||{})) if(!entryOk(k,v,key)) throw new Error('Invalid statistics.');
  for(const k of ['sessionCorrect','sessionTotal','reviewStreak','sinceBackup','lastBackup'])
    if(raw[k]!=null&&(!Number.isFinite(raw[k])||raw[k]<0)) throw new Error('Invalid statistics.');
  for(const k of ['theme','homeLayout','lastReviewDay','examDate']) if(raw[k]!=null&&typeof raw[k]!=='string') throw new Error('Invalid statistics.');
  if(raw.missed!=null&&(!Array.isArray(raw.missed)||raw.missed.some(x=>typeof x!=='string'))) throw new Error('Invalid missed list.');
  if(raw.exams!=null&&(!Array.isArray(raw.exams)||raw.exams.some(x=>!root.MockExam.validEntry(x)))) throw new Error('Invalid exam history.');
  if(!root.FlagSet.valid(raw.flagged)) throw new Error('Invalid flagged list.');
  return {resume:raw.resume||{},resumed:false,sessionCorrect:raw.sessionCorrect||0,sessionTotal:raw.sessionTotal||0,
    chStats:raw.chStats||{},missed:new Set(raw.missed||[]),srs:raw.srs||{},reviewStreak:raw.reviewStreak||0,
    lastReviewDay:raw.lastReviewDay||null,daily:raw.daily||{},practice:raw.practice||{},
    sinceBackup:raw.sinceBackup||0,lastBackup:raw.lastBackup||null,theme:raw.theme||'auto',homeLayout:raw.homeLayout||'signal',
    focusMode:!!raw.focusMode,examDate:examDay(raw.examDate)?raw.examDate:null,
    mocks:root.MockExam.cleanHistory(raw.exams),
    /* Absent says nothing: a backup made before flags must not empty the flags made since. A list, even an empty one, replaces them. */
    ...(raw.flagged!=null?{flagged:new Set(root.FlagSet.clean(raw.flagged))}:{})};
}

root.ProgressData = { ENTRY, record, day, examDay, entryOk, usable, fromBackup };

})(typeof window !== 'undefined' ? window : this);
