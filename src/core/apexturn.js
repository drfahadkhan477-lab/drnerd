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

   No DOM, no clock, no storage: bare Node can test it (tests/verify-apexturn-pure.js). ES2015; Safari
   13.4 is the floor (README).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function state(){
  return { busy:false, abort:null, trace:[], groundedLeft:Infinity, hits:[], hitsKey:null, nav:null };
}

root.ApexTurn = { state };

})(typeof window !== 'undefined' ? window : this);
