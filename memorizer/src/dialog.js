/* ═══════════════════════════════════════════════════════════════════════════
   dialog.js — a modal over the app: a page or figure enlarged, a chart made
   from the book.

   The lightbox had role="dialog" and aria-modal="true", which SAYS modal to
   a screen reader, and did none of what makes it one: focus stayed on the
   button behind it, Tab walked on through the page underneath, and on close
   focus fell to the top of the document. So a keyboard or switch user
   opened a figure and lost their place. Here, opening:
     · marks the app behind it inert (and hidden from assistive tech), so
       nothing under the dialog can be reached or read;
     · moves focus into it — to its Close button when it has one;
     · keeps Tab and Shift+Tab inside it;
     · closes on Escape, on the backdrop, or on its own buttons;
     · and on close gives focus back to what opened it. The app redraws
       itself often (a figure finishing, a save landing), so "what opened
       it" may have been replaced by an identical new button; that one, found
       by its id or its label, gets focus instead.

   One dialog at a time: opening a second closes the first.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var doc = root.document;
var FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
var openNow = null;

function focusables(el) {
  return Array.prototype.slice.call(el.querySelectorAll(FOCUSABLE)).filter(function (x) { return !x.hidden; });
}

/* The element that opened the dialog, or its replacement after a redraw. */
function again(opener) {
  if (!opener || opener === doc.body) return null;
  if (opener.isConnected) return opener;
  if (opener.id) return doc.getElementById(opener.id);
  var label = opener.getAttribute && opener.getAttribute('aria-label');
  if (label) {
    var all = doc.querySelectorAll(opener.tagName + '[aria-label]');
    for (var i = 0; i < all.length; i++) if (all[i].getAttribute('aria-label') === label) return all[i];
  }
  return null;
}

/* el: the dialog element, not yet in the document. app: the element to make
   inert behind it. Returns close(). */
function open(el, app, opts) {
  opts = opts || {};
  if (openNow) openNow();
  var opener = doc.activeElement;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  var key = function (e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    var list = focusables(el);
    if (!list.length) { e.preventDefault(); el.focus(); return; }
    var first = list[0], last = list[list.length - 1], at = doc.activeElement;
    if (!el.contains(at)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && (at === first || at === el)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  };
  var close = function () {
    if (!el.parentNode) return;
    el.parentNode.removeChild(el);
    doc.removeEventListener('keydown', key, true);
    if (app) { app.removeAttribute('inert'); app.removeAttribute('aria-hidden'); }
    openNow = null;
    var back = again(opener);
    if (back && back.focus) back.focus();
    if (opts.onClose) opts.onClose();
  };
  el.addEventListener('click', function (e) { if (e.target === el) close(); });
  doc.addEventListener('keydown', key, true);
  if (app) { app.setAttribute('inert', ''); app.setAttribute('aria-hidden', 'true'); }
  doc.body.appendChild(el);
  var first = el.querySelector('[data-autofocus]') || focusables(el)[0] || el;
  first.focus();
  openNow = close;
  return close;
}

var api = { open: open, focusables: focusables, again: again };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.MemDialog = api;
})(typeof window !== 'undefined' ? window : this);
