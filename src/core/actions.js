/* ═════════════════════════════════════════════
   actions.js — one delegated listener in place of inline handlers.

   docs/ROADMAP.md, E2. A button that said onclick="memForgetAll()" says data-action="memForgetAll", and the page
   installs one listener that, on a click anywhere under its root, finds the nearest element with a data-action and
   calls the function of that name from a table the page hands it. When no inline handler is left, the split build
   can ship a script-src that refuses them (scripts/csp.js, scriptPolicy; tests/verify-csp.js shows what it refuses).

     install(root, table, type = 'click')   listen on root; returns the function that stops listening
     find(target, root)                     the element a listener on root would act for, or null

   The table is the allowlist. Only a name that is the table's own property and a function is called, so markup that
   gets into the page can name only what the page already offers by a button, never any global, and never a name
   every object inherits (constructor, toString, __proto__). An action is called with the element and the event, so
   one that needs the element's data reads it there (el.dataset), as `this.dataset` did in the handler it replaces.

   A disabled button fires no click, as before. The listener is on the root, so it runs after any listener between
   the element and the root: one that stops the event's propagation stops the action too, where an inline handler on
   the element ran first. So a screen moved to data-action is held by a browser suite that clicks through the real page
   (the memory screen's Delete: verify-memory and verify-backup-ids), not only by tests/verify-actions-pure.js.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

const own = Object.prototype.hasOwnProperty;

function find(target, rootEl) {
  /* A click's target is an element, but a text node can be one where an engine reports it; its element is its parent. */
  const start = target && target.nodeType === 3 ? target.parentNode : target;
  const el = start && typeof start.closest === 'function' ? start.closest('[data-action]') : null;
  if (!el) return null;
  return rootEl && rootEl !== el && typeof rootEl.contains === 'function' && !rootEl.contains(el) ? null : el;
}

function install(rootEl, table, type) {
  const kind = type || 'click';
  const listener = ev => {
    const el = find(ev.target, rootEl);
    if (!el) return;
    const name = el.getAttribute('data-action');
    if (!own.call(table, name) || typeof table[name] !== 'function') return;
    table[name](el, ev);
  };
  rootEl.addEventListener(kind, listener);
  return () => rootEl.removeEventListener(kind, listener);
}

root.Actions = { install, find };
})(typeof window !== 'undefined' ? window : this);
