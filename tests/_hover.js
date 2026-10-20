'use strict';
/*
 * Whether a media query applies only where a device can hover.
 *
 * tests/verify-hover-pure.js reads stylesheets as text and tests/verify-taps.js reads them as the browser holds them; both ask
 * this of every @media rule a :hover rule sits inside. It is one function so the two cannot disagree about it, and it is a plain
 * function with no closure so the second can send its source into a page.
 *
 * WHAT IT SAYS. A media query list applies where ANY of its queries does, so the list guards only if EVERY query in it does. A
 * query guards if it holds no "not" and no "or" and one of its "and" terms is exactly (hover: hover), which says the PRIMARY input can
 * hover. Anything else is refused, because it can apply where a finger can still leave :hover behind:
 *
 *     not (hover: hover)                       the negation, which applies on exactly the devices that cannot
 *     not all and (hover: hover)               the same, with a media type: the term is there and the query is its opposite
 *     (hover: hover), (min-width: 1px)         a list, one of whose queries is satisfied by every device
 *     (min-width: 1px), (hover: hover)         the same, the other way round
 *     (hover: hover) or (min-width: 1px)       the same, written with "or"
 *     (a) or (b) and (hover: hover)            "and" and "or" mixed, which a browser reads as no query at all
 *     (hover: none)                            the wrong way round
 *     (any-hover: hover)                       true on a touch screen with a mouse beside it, where the primary input is the finger
 *
 * It refuses a few forms that are in fact fine (a conjunction with a nested "or" in it, say): the cost of that is a failure that
 * asks for the simpler form, and the cost of the alternative is a guard with a hole in it. The substring test this replaced
 * (/hover\s*:\s*hover/ somewhere in the rule's media text) accepted the first six. Every line of the function has a fixture in
 * tests/verify-hover-pure.js that fails without it.
 */
function impliesHover(mediaText) {
  var text = String(mediaText || ''), queries = [], depth = 0, cur = '', i, c;
  for (i = 0; i < text.length; i++) {
    c = text.charAt(i);
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === ',' && depth === 0) { queries.push(cur); cur = ''; } else cur += c;
  }
  queries.push(cur);
  return queries.every(function (query) {
    var q = query.trim().toLowerCase();
    if (/\b(not|or)\b/.test(q)) return false;
    return q.split(/\s+and\s+/).some(function (term) { return /^\(\s*hover\s*:\s*hover\s*\)$/.test(term.trim()); });
  });
}

module.exports = { impliesHover };
