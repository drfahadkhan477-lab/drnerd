/* ═════════════════════════════════════════════
   echoscreen.js — Echo Studio's wiring: putting the screen on the page, loading its code the first time, the four
   listeners the page puts on the document for it, and the repaint of its results (docs/ROADMAP.md, E1).

   EchoUI (src/ui/echo.js) writes the screen's markup; this is what the page does with it. It is written into the
   page's own script, not beside EchoUI, because the split build lifts EchoUI and src/core/echo.js into vendor/ and
   loads them when the screen is first drawn (scripts/build-pwa.js), while these listeners are on the document from
   the start.

     install(doc, env)   the four listeners, added to doc once and in this order, so a render that replaces the panel
                         leaves no listener dead and needs none attached again:
                           a tap on a tab or a disease: it is chosen, the screen drawn again, and focus put back on
                             the control of that name in the new markup
                           a tap on a phase button: it is chosen, the cycle shown in that phase, and that button
                             alone pressed
                           an arrow key, Home or End on a tab: focus moves along the tabs and none is chosen (manual
                             activation; Enter and Space are the button's own)
                           typing in a field: its number kept, or the field forgotten when it holds none, and the
                             results alone drawn again, so the field typed in is not rebuilt under the caret
     repaint(doc, env)   the results block (.echo-out) drawn again from the fields, where there is one

     loader()                   a load's state, { state: 'idle' }: then 'loading', and 'ready' or 'failed'
     screenHtml(doc, load, env) the screen's markup: EchoUI's, once it is there. Before, where the split build left
                                the file's name, the first drawing loads it, once, and draws the screen again when it
                                is in, if the screen is still Echo's; until then a line saying it is loading, and
                                after a load that failed, one saying so with a Retry that goes in again
     go(load, env)              the way in: a load that failed is let go, so it is tried again, and the screen shown

   env is what they use of the page, each asked when it is used:
     env.echo()      the page's ECHO: the tab, the disease, the phase and the fields
     env.ui()        EchoUI, once it is there
     env.render()    the page's render()
     env.repaint()   the page's echoRepaintResults()
     env.src()       the file the split build left EchoUI in (window.ECHO_SRC), or nothing where it is in the page
     env.screen()    the screen the page is on
     env.show()      the page's own way of putting Echo on: S.screen set, and render()

   They were the page's buildEchoScreen(), goEcho(), echoRepaintResults() and the four document.addEventListener calls
   below them, moved unchanged; the page keeps the three names as one line each, and installs the listeners where it
   added them.
   tests/verify-echoscreen-pure.js holds them over a document of its own, and verify-echo and verify-pwa (the split build's
   late load) in a browser.

   No DOM of its own: what it touches is the document it is handed. ES2015; Safari 13.4 is the floor (README).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function repaint(doc, env){
  var out = doc.querySelector('.echo-out');
  if (out) out.innerHTML = env.ui().resultsHtml(env.echo().fields);
}

function install(doc, env){
  /* Delegated once, from the document, so a render that replaces the panel
     cannot leave a dead listener behind or need a live one re-attached. */
  doc.addEventListener('click', function(e){
    var el = e.target && e.target.closest ? e.target.closest('[data-echo-tab],[data-echo-disease]') : null;
    if (!el) return;
    var echo = env.echo();
    if (el.hasAttribute('data-echo-tab')) echo.tab = env.ui().tabId(el.getAttribute('data-echo-tab'));
    else echo.disease = el.getAttribute('data-echo-disease');
    var attribute = el.hasAttribute('data-echo-tab') ? 'data-echo-tab' : 'data-echo-disease';
    var value = el.getAttribute(attribute);
    env.render();
    var replacement = doc.querySelector('[' + attribute + '="' + value + '"]');
    if (replacement) replacement.focus();
  });

  doc.addEventListener('click', function(e){
    var button = e.target && e.target.closest && e.target.closest('[data-echo-phase]');
    if (!button) return;
    var echo = env.echo();
    echo.phase = button.getAttribute('data-echo-phase');
    var cycle = doc.querySelector('.echo-cycle');
    if (cycle) cycle.setAttribute('data-phase', echo.phase);
    doc.querySelectorAll('[data-echo-phase]').forEach(function(b){
      b.setAttribute('aria-pressed', String(b === button));
    });
  });

  // Manual tab activation: arrows move focus, Enter/Space use the native button.
  doc.addEventListener('keydown', function(e){
    var el = e.target;
    if (!el || !el.matches || !el.matches('[data-echo-tab]')) return;
    var tabs = Array.prototype.slice.call(el.parentNode.querySelectorAll('[data-echo-tab]'));
    var i = tabs.indexOf(el), next;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i + tabs.length - 1) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    tabs.forEach(function(t, n){ t.tabIndex = n === next ? 0 : -1; });
    tabs[next].focus();
  });

  doc.addEventListener('input', function(e){
    var el = e.target;
    if (!el || !el.getAttribute || !el.hasAttribute('data-echo-field')) return;
    var id = el.getAttribute('data-echo-field');
    var n = parseFloat(el.value);
    /* Absent, not zero. An empty field means "not measured", and the module
       below reports that as missing rather than computing from a nought. */
    var echo = env.echo();
    if (typeof n === 'number' && isFinite(n)) echo.fields[id] = n;
    else delete echo.fields[id];
    env.repaint();
  });
}

function loader(){ return { state: 'idle' }; }

function screenHtml(doc, load, env){
  var ui = env.ui();
  if(ui) return ui.screenHtml(env.echo());
  if(load.state === 'idle' && env.src()){
    load.state = 'loading';
    var script = doc.createElement('script');
    script.src = env.src();
    script.onload = script.onerror = function(){
      load.state = env.ui() ? 'ready' : 'failed';
      if(load.state === 'failed') script.remove();
      if(env.screen() === 'echo') env.render();
    };
    doc.head.appendChild(script);
  }
  if(load.state === 'failed') return '<p role="status">Echo Studio could not load.</p><button data-action="goEcho">Retry</button>';
  return '<p role="status">Loading Echo Studio…</p>';
}

function go(load, env){
  if(load.state === 'failed') load.state = 'idle';
  env.show();
}

root.EchoScreen = { install: install, repaint: repaint, loader: loader, screenHtml: screenHtml, go: go };

})(typeof window !== 'undefined' ? window : this);
