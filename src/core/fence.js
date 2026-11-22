/* ═════════════════════════════════════════════
   fence.js — where the fellow's material starts and stops in what Apex is sent (docs/ROADMAP.md, E1).

   Retrieved notes are DATA. They are also imported from wherever the fellow got them, so their text is untrusted,
   and a plain "--- REFERENCE NOTE:" heading is a boundary any note can imitate. A block is opened and closed by a
   fence carrying a nonce that is new for every request, so a note written yesterday cannot hold today's closing
   fence; and fence-shaped text is taken out of what goes inside, so it cannot close one by accident either.

     current()                 the fence for this request: 12 characters, A-Z and 0-9, made once and kept
     roll()                    a new fence, for a new turn; returned
     safe(s)                   s with every whole forged delimiter, half of one against a word, and bare block id
                               taken out; ordinary comparisons ("LVEDP >>> RVEDP") left as written
     block(label, head, body)  <<<label-FENCE>>> head, the body made safe, <<</label-FENCE>>>
     id(bytes)                 the fence six random bytes make: two characters a byte, always

   They were app/systole.html's refFenceId, refFence(), refFenceRoll(), refSafe() and refBlock(), moved unchanged;
   the page keeps the four names as one line each. tests/verify-fence-pure.js holds them, and verify-boundary the
   page's use of them in a browser.

   No DOM, no clock, no storage. The bytes come from crypto.getRandomValues where there is one, else Math.random.
   ES2015; Safari 13.4 is the floor (README).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

/* padStart is not decoration. A byte's base36 is one character below 36 and
   two above it, so six raw bytes produced anywhere from six to twelve
   characters — a fence whose LENGTH leaked how lucky the draw was, and
   occasionally only 30 bits of it. Two characters per byte, always. */
function id(bytes){ return Array.from(bytes).map(n=>(n%1296).toString(36).padStart(2,'0')).join('').slice(0,12).toUpperCase(); }
let fenceId=null;
function current(){
  if(!fenceId){
    const c=root.crypto;
    const b=(c&&c.getRandomValues)
      ? Array.from(c.getRandomValues(new Uint8Array(6)))
      : Array.from({length:6},()=>Math.floor(Math.random()*256));
    fenceId=id(b);
  }
  return fenceId;
}
/* A new fence for every turn: a nonce that never changes is a nonce that can
   eventually be learned and written into a note. */
function roll(){ fenceId=null; return current(); }
/* Nothing inside a fence may contain something that looks like a fence. */
function safe(s){
  /* Narrow on purpose. An earlier version collapsed any run of three angle
     brackets, which quietly rewrote "LVEDP >>> RVEDP" in a haemodynamics note.
     What has to go is fence-SHAPED text: a whole forged delimiter, half of one
     sitting against a word, and a bare block id that could be cited as if it
     named a real block. Ordinary comparisons are left exactly as written. */
  return String(s==null?'':s)
    .replace(/<<<\/?[^\n>]{0,64}>>>/g,'[fence removed]')
    .replace(/<{3,}([\/\w])/g,'--$1')
    .replace(/([\/\w])>{3,}/g,'$1--')
    .replace(/\b(?:NOTE|MEMORY)-[A-Za-z0-9]{6,}\b/g,'[block id removed]');
}
function block(label,head,body){
  const F=current();
  return `<<<${label}-${F}>>>
${head}
${safe(body)}
<<</${label}-${F}>>>`;
}

root.Fence = { current, roll, safe, block, id };

})(typeof window !== 'undefined' ? window : this);
