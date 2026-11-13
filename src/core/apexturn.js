/* ═════════════════════════════════════════════
   apexturn.js — one turn with the tutor: the state it changes, in one place.

   A turn is the fellow's question going out and Apex's reply coming back, with whatever tools the reply
   calls in between. While it runs it changes seven things, and until now each was a script-level `let`
   in app/systole.html, declared in four places and rebound by whichever function got there: the loop,
   the tools, the send button, the panel. A function that rebinds a script-level name cannot leave the
   script. So the seven are one object now, made here, and the page holds the one copy as APEX_TURN:

     state()   a turn's state, as it stands before any turn has run

       busy          a reply is on its way: nothing else may be sent, and the send button stops it
       abort         the reply's AbortController while it runs, otherwise null
       trace         what the reply's tools did, for the chips under it: { kind: 'call' | 'mem' | 'note', … }
       groundedLeft  the characters of notes grounded searches may still add to this reply; Infinity
                     outside a turn, so a tool run on its own is not held to a budget no turn set
       hits          the notes this reply drew on: the "cited from" row, and the figures sent with it
       hitsKey       which conversation those notes belong to (a question's id, or '_general')
       nav           what opens when the reply is over: { kind: 'open' | 'due' | 'plan' | 'quiz', … } or null

   THE OLD NAMES ARE VIEWS. The page still says aiBusy, aiAbort, toolTrace, groundedTurnLeft, lastHits,
   lastHitsKey and pendingNav, in the panel's functions and in fourteen browser suites that set and read
   them from inside the page. Each is now an accessor on window over one field of APEX_TURN, so every one
   of those lines reads and writes the owner, unchanged. A function switches to the owner when it leaves
   the shell; the views go when nothing says the old names (docs/SHELL-MAP.md lists who still does).

   run() is the loop that runs a turn over that state (below). It reaches the page only through what it is
   handed, so bare Node can test it: no DOM, no clock, no storage of its own (tests/verify-apexturn-pure.js,
   tests/verify-apexloop-pure.js). ES2017 for async functions (Safari 10.1); Safari 13.4 is the floor
   (README).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function state(){
  return { busy:false, abort:null, trace:[], groundedLeft:Infinity, hits:[], hitsKey:null, nav:null };
}

/* ═══════════ the loop that runs a turn ═══════════
   run(st, d, q, hist, extra, explainOnly) asks the model, runs the tools its reply calls, hands the
   results back, and asks again, up to six steps; then it ends the turn. It was streamReply() in the
   page, and moved here unchanged but for what it reaches: the state is st, and everything of the
   page's is d, looked up by the page each time it is called (the page's streamReply() builds d):

     d.AbortController   the constructor, for the turn's stop button
     d.groundedBudget    the characters of notes grounded searches may add to this reply
     d.wire(hist)        the window of the thread the request carries (ApexWire.wire)
     d.oneTurn(q, wire, extra, explainOnly)   one request to the model → { text, raw, calls, finishReason, reused }
     d.runTool(name, input)                   one tool → { result, cite }
     d.exchange(wire, turn, results)          the model's parts and the tools' answers, onto the wire
     d.grounded()        whether grounded mode is on, asked as each result is cut
     d.away()            whether a mock block has opened, asked after each step
     d.save()            write the threads to storage
     d.render()          draw the panel again
     d.setState(s)       the avatar's state: 'thinking', then 'idle'
     d.flush()           open what a tool queued, once the turn is over

   THE RULES the loop keeps, each a way a turn once went wrong:

     1. A reply that arrives as Stop is pressed is neither kept nor acted on: no words saved, no tool run.
     2. Explain-only mode runs no tool; a reply that calls one is an error, said in the thread.
     3. A reply cut off by the output limit is kept and marked incomplete; one that stopped for any
        other reason without a tool call is said to have stopped, as a notice, not as teaching.
     4. A mock block opened while the reply was at the model: its words are kept, its calls are not run.
     5. A tool's answer is cut at 9,000 characters, except a grounded search, whose notes are already
        budgeted whole: a second cut could take off a qualification and leave its fence open.
     6. Six steps at most; calls still pending on the sixth are said to have been stopped.
     7. However it ends, the turn is over: not busy, nothing to stop, the panel drawn, the avatar idle,
        and what a tool queued opened. An error in opening it does not escape.

   tests/verify-apexloop-pure.js holds it, with tests/verify-apex-cancel.js for rule 1. */
async function run(st, d, q, hist, extra, explainOnly=false){
  st.abort=new d.AbortController();
  st.trace=[]; st.groundedLeft=d.groundedBudget;
  const wire=d.wire(hist);
  let guard=0, truncated=false;
  try{
    while(guard++ < 6){                       // bounded agent loop
      d.setState('thinking');
      const turn=await d.oneTurn(q,wire,extra,explainOnly);
      // A response can finish as Stop is pressed. Never commit or execute it.
      if(st.abort.signal.aborted) break;
      if(explainOnly&&turn.calls.length) throw new Error('Explain-only mode cannot run study tools. Use Send if you want Apex to take an action.');
      if(turn.text.trim()||turn.calls.length){
        if(turn.text.trim()) hist.push({role:'assistant',content:turn.text,...(turn.reused?{reused:true}:{}),...(turn.finishReason==='MAX_TOKENS'?{incomplete:true}:{})});
        d.save();
      }
      if(!turn.calls.length&&turn.finishReason&&turn.finishReason!=='STOP'&&!(turn.finishReason==='MAX_TOKENS'&&turn.text.trim())){
        hist.push({role:'assistant',err:true,content:turn.finishReason==='MAX_TOKENS'
          ?'This explanation reached the model’s output limit and may be incomplete. Ask a follow-up to continue; check the sources before relying on it.'
          :'The model stopped without confirming a complete explanation. Check the sources or rephrase your question.'});
        d.save();
      }
      /* A mock block opened while this turn was at the model: its words are kept, its calls are not run, and nothing more is asked. */
      if(!turn.calls.length||d.away()) break;
      if(guard>=6) truncated=true;          // calls still pending on the last allowed step
      const results=turn.calls.map(c=>{
        const out=d.runTool(c.name,c.input);
        if(out.cite) st.hits=(st.hits||[]).concat(out.cite).slice(-6);
        st.trace.push({kind:'call',name:c.name,input:c.input});
        // Grounded search already budgets whole fenced notes. A second character
        // cut here could remove a qualification and leave its fence unclosed.
        const content=String(out.result);
        return {id:c.id, name:c.name, content:d.grounded()&&c.name==='search_question_bank'
          ?content:content.slice(0,9000)};
      });
      d.exchange(wire,turn,results);            // provider-shaped (src/core/apexwire.js)
      d.render();                               // show the tool chips as they run
    }
    /* Marked err:true so it renders as a notice rather than as teaching, and
       so rule 3 above keeps it out of the next request. */
    if(truncated){
      hist.push({role:'assistant',err:true,
        content:'That needed more tool steps than one turn allows, so I stopped there. Ask again and I will carry on from where this left off.'});
      d.save();
    }
  }catch(err){
    if(err.name!=='AbortError'){
      hist.push({role:'assistant',err:true,content:err.message||'Request failed. Check the connection.'});
      d.save();
    }
  }finally{
    st.busy=false; st.abort=null; d.render();
    d.setState('idle');
    try{ d.flush(); }catch(_){}
  }
}

root.ApexTurn = { state, run };

})(typeof window !== 'undefined' ? window : this);
