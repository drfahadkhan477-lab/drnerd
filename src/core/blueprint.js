/* ═════════════════════════════════════════════
   blueprint.js — how much of the exam each chapter is, for the readiness interval (docs/ROADMAP.md, S7).

   EMPTY UNTIL THE OWNER FILLS IT IN. The weights are the official exam blueprint, mapped onto this bank's
   chapter names, and they are the owner's to supply: the roadmap forbids estimating them, and a made-up
   weighting would print a confident exam score that is only a guess about the exam. While `weights` is null
   the Study screen gives each chapter its own interval and says the score across the exam needs this table.

   To fill it in: `weights` maps each chapter's name, exactly as the bank writes it, to that chapter's share
   of the exam, in any unit (percent, or questions on the paper); they are scaled to sum to one. A chapter
   the bank has and the table leaves out counts for nothing; a name the bank does not have makes the table
   refused, and the screen names it, rather than quietly scaling the rest. `source` says where the numbers
   came from, for example "ABIM Cardiovascular Disease blueprint, 2026".

     weights: { 'Heart Failure': 18, 'Arrhythmias': 15, … },
     source:  'ABIM Cardiovascular Disease blueprint, 2026',

   src/core/studyplan.js reads it as root.Blueprint, so it is written into the page before that file.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

root.Blueprint = {
  weights: null,
  source: null,
};

})(typeof window !== 'undefined' ? window : this);
