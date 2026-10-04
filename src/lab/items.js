/* ═════════════════════════════════════════════
   items.js — the Lab's three drills as one list of items the drill engine can serve.

   Heart sounds, pressure tracings and ECG strips each live in their own module and
   know nothing of being drilled. This is the seam: one item per thing to recognise, with
   an id the progress record can keep, a name, what it is, what to look at, and the
   look-alikes it is offered against.

     ids      snd:<lesion>   trc:<tracing>   ecg:<rhythm>
     site     what it is compared with: a heart sound is grouped by when it is heard
              (systolic murmurs against systolic murmurs), a tracing by where it was
              measured, a strip by its lead. The engine fills the options from it.

   The look-alikes for heart sounds are the author's: tracings and strips carry theirs.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

const HS = root.HeartSounds || (typeof require === 'function' ? require('./heartsounds.js').HeartSounds : null);
const HM = root.HeartMap || (typeof require === 'function' ? require('./heartmap.js').HeartMap : null);
const TR = root.Tracings || (typeof require === 'function' ? require('./tracings.js').Tracings : null);
const ST = root.Strips || (typeof require === 'function' ? require('./strips.js').Strips : null);

/* What each heart sound is most often mistaken for. */
const SOUND_LOOKALIKES = {
  normal: ['wide', 's3'],
  as:     ['hocm', 'mr', 'vsd'],
  mr:     ['vsd', 'as', 'mvp'],
  ms:     ['s3', 'ar'],
  ar:     ['ms', 'pda'],
  s3:     ['s4', 'ms'],
  s4:     ['s3', 'ms'],
  mvp:    ['mr', 'hocm'],
  hocm:   ['as', 'mvp', 'vsd'],
  vsd:    ['mr', 'as'],
  pda:    ['ar', 'vsd'],
  wide:   ['normal'],
};

const KINDS = [
  { id: 'sounds',   prefix: 'snd:', title: 'Heart sounds',      verb: 'Which heart sound is this?',   blurb: 'Listen, then name what you hear.' },
  { id: 'tracings', prefix: 'trc:', title: 'Pressure tracings', verb: 'Which pressure tracing is this?', blurb: 'Right atrial and wedge waveforms, normal and abnormal.' },
  { id: 'strips',   prefix: 'ecg:', title: 'ECG strips',        verb: 'Which rhythm is this?',        blurb: 'Single-lead rhythms, and what separates the look-alikes.' },
];

function build() {
  const sounds = HS.LESIONS.map(l => ({
    id: 'snd:' + l.id, kind: 'sounds', key: l.id, name: l.name, blurb: l.blurb, points: l.points,
    site: HM.phaseOf(l.id), confusableWith: (SOUND_LOOKALIKES[l.id] || []).map(x => 'snd:' + x),
  }));
  const tracings = TR.TRACINGS.map(t => ({
    id: 'trc:' + t.id, kind: 'tracings', key: t.id, name: t.name, blurb: t.blurb, points: t.points,
    site: t.site, confusableWith: t.confusableWith.map(x => 'trc:' + x),
  }));
  const strips = ST.STRIPS.map(s => ({
    id: 'ecg:' + s.id, kind: 'strips', key: s.id, name: s.name, blurb: s.blurb, points: s.points,
    site: s.site, confusableWith: s.confusableWith.map(x => 'ecg:' + x),
  }));
  return { sounds, tracings, strips };
}

const ITEMS = build();
const ALL = ITEMS.sounds.concat(ITEMS.tracings, ITEMS.strips);
const byId = id => ALL.find(i => i.id === id) || null;

root.LabItems = { KINDS, ITEMS, ALL, byId, SOUND_LOOKALIKES };

})(typeof window !== 'undefined' ? window : this);
