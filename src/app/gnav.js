/* ═════════════════════════════════════════════
   gnav.js — the glass capsule in the header that moves between Home, Brain, Labs and Chapters.

   docs/UI-REVAMP.md, C. Brain and Labs are pages of Home's pager and the study screens are reached from Labs' doors, so
   until this the only way across was a lone Home button on each page. The capsule sits in the header band, between the
   brand and the header's buttons: it costs no height and covers nothing (a capsule floating under the header would cover
   each page's heading, and no fit test would see it, because a fixed element never changes a page's scroll height).

     ITEMS                  the four destinations, in order: [{ key, label }]
     gnavActive(screen, page)    which item is lit for a screen and a Home pager page, or null
     gnavShown(screen, page, focus)    whether the capsule is drawn there at all
     gnavHtml(screen, page, kit)       its markup (kit: { icon }), drawn whether shown or not, so a move along Home's pager,
                                       which redraws nothing, can show or hide it (the page's gnavSync does)

   WHERE IT SHOWS. Not on Home's first page: that page is the calm one, with nothing added to it (docs/ROADMAP.md: no new
   element on Home). Not on the screens where a question is read or a block sat (quiz, results, mock, mockreport), nor in
   focus mode, where the header itself is gone. Everywhere else: Brain and Labs, and every screen a Labs door or the header
   opens. A phone has no room for it in the header (measured: 0-73 px free at 390 px wide), so the stylesheet hides it below
   700 px; that is the stylesheet's business, not this module's.

   WHICH ITEM IS LIT. Home's pages light Brain or Labs. The screens reached from the Labs page (its labs and its study
   tools) light Labs, Chapters lights Chapters, and the two searches light nothing: search is the header's own button.

   THE BACK BUTTONS IT TAKES OVER (T3.6). While the capsule is up, each screen's own back button whose destination is a
   capsule item (Brain's and Labs' Home, Chapters' Back, the Labs screens' Home or Labs, Notes' and Memory's Back) is set
   aside by app/css/gnav.css,
   under body.has-gnav, which the page's gnavSync sets only when the capsule is drawn and fits. So a phone, focus mode, the
   question screens and a header with no room keep their back buttons; the lit item goes back to its section's root, as a
   tab bar's selected tab does. tests/verify-gnav-pure.js holds the list to the buttons in the source.

   The buttons name one action, gnavGo, with the destination as data; the page's ACTIONS table holds what it does. No
   role="tab" and no .home-tabs: the owner's "no tab bar" stands for Home (verify-homepager), and this is a labelled group
   of buttons, the current one marked with aria-current, not a tab list. It is a group, not a nav of its own, because the
   header it sits in is already the page's nav landmark.
   tests/verify-gnav-pure.js holds what follows.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

const ITEMS = [
  { key: 'home', label: 'Home' },
  { key: 'brain', label: 'Brain' },
  { key: 'labs', label: 'Labs' },
  { key: 'chapters', label: 'Chapters' },
];
const LABS = ['lab', 'echo', 'practice', 'sessions', 'stats', 'refs', 'memory', 'annotations'];
const READING = ['quiz', 'results', 'mock', 'mockreport'];

function gnavActive(screen, page){
  if (screen === 'home') return page === 1 ? 'brain' : page === 2 ? 'labs' : null;
  if (screen === 'study') return 'chapters';
  if (LABS.includes(screen)) return 'labs';
  return null;
}
function gnavShown(screen, page, focus){
  if (focus) return false;
  if (READING.includes(screen)) return false;
  if (screen === 'home') return page === 1 || page === 2;
  return true;
}
function gnavHtml(screen, page, kit){
  const { icon } = kit;
  /* Each icon named where it is drawn, so tests/verify-icons-pure.js can read every name against the sprite. */
  const glyph = { home: icon('home', 'icon-sm'), brain: icon('brain', 'icon-sm'), labs: icon('activity', 'icon-sm'), chapters: icon('book', 'icon-sm') };
  const on = gnavActive(screen, page);
  return `<div class="gnav" id="gnav" role="group" aria-label="Sections"${gnavShown(screen, page, false) ? '' : ' hidden'}>`
    + `<span class="gnav-ind" aria-hidden="true"></span>`
    + ITEMS.map(it => `<button class="gnav-it" type="button" data-action="gnavGo" data-go="${it.key}" aria-label="${it.label}"`
      + `${it.key === on ? ' aria-current="page"' : ''}>${glyph[it.key]}<span>${it.label}</span></button>`).join('')
    + `</div>`;
}

root.GNav = { ITEMS, gnavActive, gnavShown, gnavHtml };
})(typeof window !== 'undefined' ? window : this);
