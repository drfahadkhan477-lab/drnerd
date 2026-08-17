/* ═══════════════════════════════════════════════════════════════════════════
   vision.js — hand Apex the figure it is being asked about.

   305 of the 638 questions carry a figure, and for a rhythm strip, an echo
   still or a PV loop the figure *is* the question. Before this, the system
   prompt told the tutor it could not see the image and should ask the fellow
   to describe it — which inverts the teaching relationship on exactly the
   items where help is worth most.

   Two things this deliberately does NOT do:

   1. It never writes image data into the persisted chat history. The figures
      are injected into the request at send time only. CHATS is serialised to
      localStorage, which Stage 0 spent real effort keeping under the ~5 MB
      origin quota — a single 122 KB WebP as base64 in a saved thread would
      undo that, and a few would blow the quota outright.

   2. It never claims a provider can see when it cannot. Only Anthropic
      models are wired for vision here; the Groq models this app offers
      (gpt-oss, qwen) are text-only, so on Groq the original "describe it to
      me" prompt is left exactly as it was. Silently dropping the image and
      letting the model bluff would be worse than not offering the feature.

   Format verified against the Anthropic vision docs: image content blocks
   take {type:'image', source:{type:'base64', media_type, data}}; WebP is a
   supported media type; images should precede the text they relate to; and
   with several images each gets a short text label so they can be referred
   to by number. Our figures are ≤122 KB against a 10 MB per-image limit and
   ≤4 per question against a 100-image limit, so no resizing is needed.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

/* Which providers this app can actually send images to. Keyed by the app's
   own provider ids, not by model — every Claude model supports vision. */
const VISION_PROVIDERS = { anthropic: true, groq: false };

function providerSeesFigures(provider) { return !!VISION_PROVIDERS[provider]; }

/* Split a data: URL into the pieces the API wants. Returns null for anything
   that is not a base64 data URL of a supported type, so a malformed entry
   degrades to "no image" rather than a 400 from the API. */
const SUPPORTED = { 'image/jpeg': 1, 'image/png': 1, 'image/gif': 1, 'image/webp': 1 };
function dataUrlToSource(url) {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(String(url || ''));
  if (!m) return null;
  const mediaType = m[1].toLowerCase();
  if (!SUPPORTED[mediaType]) return null;
  return { type: 'base64', media_type: mediaType, data: m[2] };
}

/* The content blocks for one question's figures: a label then the image,
   per the multiple-image guidance, so the fellow and the tutor can both say
   "Figure 2" and mean the same panel. */
function figureBlocks(q, imgs) {
  if (!q || !q.img || !imgs || !imgs.length) return [];
  const blocks = [];
  const n = imgs.length;
  imgs.forEach((url, i) => {
    const source = dataUrlToSource(url);
    if (!source) return;
    blocks.push({ type: 'text', text: n > 1 ? `Figure ${i + 1}:` : 'Figure:' });
    blocks.push({ type: 'image', source });
  });
  return blocks;
}

/* Returns a NEW messages array with the figures attached to the first user
   turn — images first, then that turn's original text. Non-mutating, so the
   bounded agent loop can call it on every iteration without stacking copies
   of the image; and because it lands at the front of the conversation, later
   turns in the same thread still refer back to it without resending.

   Falls back to returning `wire` untouched whenever there is nothing to
   attach, so the caller never has to branch. */
function withFigures(wire, q, imgs, provider) {
  if (!providerSeesFigures(provider)) return wire;
  const blocks = figureBlocks(q, imgs);
  if (!blocks.length || !wire.length) return wire;
  const first = wire[0];
  if (!first || first.role !== 'user') return wire;
  if (Array.isArray(first.content)) return wire;      // already has blocks — leave it alone
  const out = wire.slice();
  out[0] = {
    role: 'user',
    content: blocks.concat([{ type: 'text', text: String(first.content || '') }]),
  };
  return out;
}

/* The line in the question context that tells the tutor what it can see.
   Kept here so the two halves — what we actually send, and what we claim to
   have sent — can never drift apart. */
function figureContextLine(q, provider) {
  if (!q || !q.img) return '';
  const n = q.img;
  const plural = n > 1 ? 's' : '';
  if (providerSeesFigures(provider)) {
    return `\n(The ${n} clinical figure${plural} for this item ${n > 1 ? 'are' : 'is'} attached to this conversation — read ${n > 1 ? 'them' : 'it'} directly. Describe what you actually see before reasoning from it, so the fellow can catch you if you have misread it. These are compressed reproductions, and this is a study aid: where your read of the image and the official ACC commentary disagree, the commentary is the ground truth and you should say so plainly rather than defending your reading.)\n`;
  }
  return `\n(The fellow is also looking at ${n} clinical figure${plural} for this item, which you cannot see — the current provider does not accept images. If the answer turns on a finding in the figure, ask them what they see rather than guessing.)\n`;
}

root.Vision = {
  withFigures, figureBlocks, figureContextLine, providerSeesFigures, dataUrlToSource,
  VISION_PROVIDERS,
};

})(typeof window !== 'undefined' ? window : this);
