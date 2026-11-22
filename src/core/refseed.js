/* ═════════════════════════════════════════════
   refseed.js — the build's own notes brought up to date on a device, without touching the fellow's (docs/ROADMAP.md, E1).

   The build ships a corpus of reference notes (REF_SEED). The first version stored a bare '1' once a device was
   seeded and returned early whenever it was there, so a device was seeded exactly once, for ever: when the corpus
   later grew figure citations, every device already seeded kept the old bodies and showed no figures. Now the stored
   value is a hash of the seed itself. Change the corpus and the sync runs; change nothing and it does not.

   Sync, not merely seed — while still never clobbering your own writing:
     · a note you wrote yourself is never touched;
     · a seeded note you have since edited is left alone, detected by its body
       no longer hashing to what was written when it was seeded;
     · an untouched seeded note is brought up to date, which is what lets a
       corpus change — new figures, a corrected trial number — actually reach
       a device seeded months ago;
     · a seeded note you deleted comes back only when the corpus itself
       changes, which is the price of not keeping a tombstone for every title
       ever shipped.

     hash(s)                       FNV-1a, 32-bit, in base 36: change detection, not cryptography
     apply(cur, seed, env)         cur (the device's notes) synced to seed IN PLACE; returns null when there is
                                   nothing to do (no seed yet, or this very seed already applied), else
                                   { version, added, updated }, version being what to store
       env.stored()                the version stored on the device, or null; asked only when there is a seed
       env.now                     the time to stamp a note added now
       env.id(n)                   the id for the n-th note added in this sync (n from 0)

   They were app/systole.html's refHash() and the rules inside refSeedApply(), which keeps the storage, the save and
   the index; tests/verify-refseed-pure.js holds them, and verify-references the page's use in a browser.

   Pure: no DOM, no clock, no storage of its own. ES2015; Safari 13.4 is the floor (README).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

/* FNV-1a, 32-bit. Small, dependency-free, and only ever compared against
   itself — this is change detection, not cryptography. */
function hash(s){
  let h=0x811c9dc5;
  for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,0x01000193); }
  return (h>>>0).toString(36);
}
function apply(cur, seed, env){
  /* The split build empties REF_SEED and fetches it instead, so an empty
     seed means "not here yet" — never "seeded, nothing to do". Marking the
     key now would permanently block the fetched copy from ever landing. */
  if(!seed || !seed.length) return null;
  const version = hash(JSON.stringify(seed));
  if(env.stored() === version) return null;
  const byTitle = Object.create(null);
  for(const r of cur) byTitle[r.title] = r;
  let added=0, updated=0;
  for(const s of seed){
    const r = byTitle[s.title];
    if(!r){
      cur.push({ id:env.id(added++),
                 title:s.title, body:s.body, tags:s.tags, source:s.source,
                 ts:env.now, seed:true, seedHash:hash(s.body||'') });
      continue;
    }
    if(!r.seed) continue;                       // yours, not ours — hands off
    /* Notes seeded before seedHash existed carry no fingerprint, so an edit
       cannot be told from an original. They are adopted rather than frozen:
       they were machine-written and are almost certainly untouched, and
       freezing them would mean the devices that most need this fix are the
       only ones it never reaches. */
    if(r.seedHash !== undefined && r.seedHash !== hash(r.body||'')) continue;
    if(r.body !== s.body || r.tags !== s.tags || r.source !== s.source) updated++;
    r.body = s.body; r.tags = s.tags; r.source = s.source;
    r.seedHash = hash(s.body||'');
  }
  return { version, added, updated };
}

root.RefSeed = { hash, apply };

})(typeof window !== 'undefined' ? window : this);
