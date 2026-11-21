/*
 * A figure's room while it loads, against its room once loaded.
 *
 * A figure written without a width and height has no room until it decodes, so whatever is round it grows as it
 * arrives, and a tap lands on whatever moved under it (the notes library, Apex's panel, the pearl on the home
 * screen; src/core/imagesize.js). heldRoom() takes a figure already drawn and loaded, puts it back as a fresh <img>
 * with the attributes the page wrote, holds that picture back at the network, measures the room the <img> has while
 * it waits, then lets it through and measures again.
 *
 * A fresh <img>, because one given a new src goes on painting the old picture until the new one arrives, and would
 * keep its room whatever the page wrote. The <img>'s own box is measured, not its card's: a note's body is capped in
 * height, and a card already at the cap does not grow.
 *
 *   heldRoom(page, selector) → {
 *     found      a drawn, loaded figure matched the selector
 *     attrs      its width and height attributes, as written ('' for none), and its natural width and height
 *     drawn      its room as drawn, 'WxH' in whole pixels
 *     pending    the fresh <img> had not loaded when it was measured
 *     loading    its room then
 *     loaded     its room once its picture was let through, or null if it never loaded
 *   }
 *
 * The caller decides what to claim. A room equal while loading and once loaded, with pending true, is a figure that
 * kept its place; with pending false the measure was of nothing.
 */
'use strict';

let n = 0;

async function heldRoom(page, selector) {
  const url = 'http://fig.invalid/held-' + (++n);
  let release = null, fig = null;
  await page.route(url, route => new Promise(resolve => {
    release = async () => {
      try {
        const comma = fig.src.indexOf(','), type = fig.src.slice(5, fig.src.indexOf(';'));
        await route.fulfill({ status: 200, contentType: type, body: Buffer.from(fig.src.slice(comma + 1), 'base64') });
      } finally { resolve(); }
    };
  }));
  try {
    fig = await page.evaluate(({ selector, url }) => {
      const old = [...document.querySelectorAll(selector)].find(x => x.complete && x.naturalWidth);
      if (!old) return null;
      const area = im => {
        const r = im.getBoundingClientRect();
        return Math.round(r.width) + 'x' + Math.round(r.height);
      };
      /* Measure and replace in the same frame. A panel changing width
         while Playwright installs its route is unrelated to image loading. */
      const src = old.getAttribute('src'), drawn = area(old);
      const attrs = [old.getAttribute('width') || '', old.getAttribute('height') || '', old.naturalWidth, old.naturalHeight];
      const im = old.cloneNode(false);
      im.setAttribute('data-held', '1');
      im.removeAttribute('loading');
      im.src = url;
      old.replaceWith(im);
      return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() =>
        resolve({ src, attrs, drawn, pending: !im.complete, loading: area(im) })
      )));
    }, { selector, url });
    if (!fig) return { found: false };
    /* The request reaches the route a moment after the src is set: it is let through once it has. */
    for (let i = 0; !release && i < 50; i++) await new Promise(r => setTimeout(r, 100));
    if (release) await release();
    const loaded = !release ? null : await page.waitForFunction(() => { const im = document.querySelector('img[data-held]'); return !!im && im.complete && im.naturalWidth > 0; }, null, { timeout: 10000 })
      .then(() => page.evaluate(() => { const b = document.querySelector('img[data-held]').getBoundingClientRect(); return Math.round(b.width) + 'x' + Math.round(b.height); }), () => null);
    return { found: true, attrs: fig.attrs, drawn: fig.drawn, pending: fig.pending, loading: fig.loading, loaded };
  } finally {
    await page.unroute(url);
  }
}

/* The check every caller makes: a figure measured while it was really loading had then the room it took once loaded,
   which is the room it was drawn with. */
const keptRoom = r => !!r && r.found && r.pending && r.loaded !== null && r.loading === r.loaded && r.loaded === r.drawn;
const roomSaid = r => !r || !r.found ? 'no loaded figure to measure'
  : `${r.loading} loading (${r.pending ? 'pending' : 'not pending'}), ${r.loaded} loaded, ${r.drawn} as drawn`;
/* And the other: its width and height attributes are its own natural size. */
const ownSize = r => !!r && r.found && r.attrs[0] === String(r.attrs[2]) && r.attrs[1] === String(r.attrs[3]);

module.exports = { heldRoom, keptRoom, roomSaid, ownSize };
