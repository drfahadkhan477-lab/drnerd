/* ═══════════════════════════════════════════════════════════════════════════
   echo.js (ui) — Echo Studio: a reference you can browse and a calculator
   you can drive, as two tabs over the same data.

   STRINGS IN, STRINGS OUT. Every function here takes plain values and
   returns markup. Nothing reads the document, nothing writes it, nothing
   holds a timer. The patch that installs the screen does the wiring; this
   module does the thinking, which is what makes all of it testable in Node
   without a browser — and the numbers on this screen are clinical, so being
   able to test them without a build is the difference between a feature that
   is checked and one that is hoped over.

   IT RESTATES NO CLINICAL NUMBER. Every value, cutoff, unit and source comes
   from src/core/echo.js. A second copy of a cutoff living in the view layer
   is how two parts of an app come to disagree about what severe means, so
   there is no second copy: if a number appears on this screen and not in the
   core module, that is a bug in this file.

   ── THE TWO TABS ─────────────────────────────────────────────────────────

   REFERENCE   pick a disease and see the views it needs, what to look for in
               each, and the numbers that grade it. Or pick a view and see
               how to obtain it and what it is for.
   CALCULATOR  enter what you measured and it derives the rest — continuity
               area, dimensionless index, PISA orifice, regurgitant volume,
               PASP, EF, mass — and grades each against the same tables the
               reference tab is showing.

   ── THE RULE THE CALCULATOR IS BUILT ON ──────────────────────────────────

   A row appears only when every input it needs is present. It never fills a
   gap with a default, never prints NaN, and never shows a grade for a number
   it had to guess at. Missing inputs are reported as missing, by name, which
   is more useful than a screen of blanks and much safer than a screen of
   confident wrong answers.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var E = root.Echo;

  var TABS = [
    { id: 'reference', label: 'Reference' },
    { id: 'calculator', label: 'Calculator' },
    { id: 'visual', label: 'Visual guide' },
  ];

  /* Markup is built from our own tables, but escaping is not optional just
     because today's inputs are trusted: the calculator echoes what was typed
     into the field, and a value that round-trips through innerHTML without
     escaping is the standard way this goes wrong later. */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function num(v) { return typeof v === 'number' && isFinite(v); }

  /* A number for display: enough places to be useful, not so many as to
     imply a precision the measurement never had. */
  function fmt(v, places) {
    if (!num(v)) return '—';
    var p = typeof places === 'number' ? places : 2;
    return v.toFixed(p);
  }

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) return list[i]; }
    return null;
  }

  /* ── tabs ───────────────────────────────────────────────────────────── */

  function tabId(requested) {
    for (var i = 0; i < TABS.length; i++) { if (TABS[i].id === requested) return TABS[i].id; }
    return TABS[0].id;
  }

  function tabsHtml(active) {
    var a = tabId(active), out = '', i;
    for (i = 0; i < TABS.length; i++) {
      var t = TABS[i], on = t.id === a;
      out += '<button class="echo-tab' + (on ? ' on' : '') + '" data-echo-tab="' + esc(t.id) + '"' +
        ' id="echo-tab-' + esc(t.id) + '" aria-controls="echo-panel" tabindex="' + (on ? '0' : '-1') + '" role="tab" aria-selected="' + (on ? 'true' : 'false') + '">' + esc(t.label) + '</button>';
    }
    return '<div class="echo-tabs" role="tablist" aria-label="Echo Studio">' + out + '</div>';
  }

  /* ── reference tab ──────────────────────────────────────────────────── */

  function diseaseListHtml(selectedId) {
    var out = '', i;
    for (i = 0; i < E.DISEASES.length; i++) {
      var d = E.DISEASES[i], on = d.id === selectedId;
      out += '<button class="echo-pick' + (on ? ' on' : '') + '" data-echo-disease="' + esc(d.id) + '"' +
        (on ? ' aria-current="true"' : '') + '>' + esc(d.name) + '</button>';
    }
    return '<div class="echo-list">' + out + '</div>';
  }

  function viewCardHtml(viewId) {
    var v = byId(E.VIEWS, viewId);
    if (!v) return '';
    return '<div class="echo-view">' +
      '<h4>' + esc(v.name) + '</h4>' +
      '<dl>' +
      '<dt>Window</dt><dd>' + esc(v.window) + '</dd>' +
      '<dt>Position</dt><dd>' + esc(v.position) + '</dd>' +
      '<dt>Index mark</dt><dd>' + esc(v.mark) + '</dd>' +
      '<dt>Angle</dt><dd>' + esc(v.angle) + '°</dd>' +
      '<dt>For</dt><dd>' + esc(v.forWhat) + '</dd>' +
      '</dl></div>';
  }

  /* A range as the table holds it. Where the source gives separate ranges
     for men and women, `normal` is the men's and `normalF` the women's, and
     both are shown: printing only one reads a normal woman's value as
     abnormal, which is what this screen did for four measurements. */
  function rangeHtml(m) {
    /* Both ends at the same precision. A number prints as JavaScript holds
       it, so the men's septal range read "0.6–1 cm" and LVIDs "2.5–4 cm":
       the table says 1.0 and 4.0, and a reference screen should too. */
    var places = function (v) { var t = String(v), i = t.indexOf('.'); return i < 0 ? 0 : t.length - i - 1; };
    var one = function (r) {
      var p = Math.max(places(r[0]), places(r[1]));
      return esc(r[0].toFixed(p)) + '–' + esc(r[1].toFixed(p)) + ' ' + esc(m.units);
    };
    if (m.normalText) return esc(m.normalText);
    if (!m.normalF) return one(m.normal);
    return one(m.normal) + ' <span class="echo-sex">men</span><br>' +
      one(m.normalF) + ' <span class="echo-sex">women</span>';
  }

  function measureRowHtml(measureId) {
    var m = byId(E.MEASUREMENTS, measureId);
    if (!m) return '';
    var view = byId(E.VIEWS, m.view);
    /* THE NOTE IS SHOWN NOW. Every measurement carried one — the teaching
       point, and for two of them the women's range — and nothing rendered
       it: fourteen notes of declared data that no screen read. */
    return '<tr>' +
      '<td>' + esc(m.name) + (m.note ? '<div class="echo-note">' + esc(m.note) + '</div>' : '') + '</td>' +
      '<td>' + rangeHtml(m) + '</td>' +
      '<td>' + esc(view ? view.name : m.view) + '</td>' +
      '<td class="echo-ref">' + esc(m.ref) + '</td>' +
      '</tr>';
  }

  function diseaseHtml(diseaseId) {
    var d = byId(E.DISEASES, diseaseId);
    if (!d) return '<p class="echo-empty">Pick a diagnosis to see its views, signs and numbers.</p>';
    var i, out = '<h3>' + esc(d.name) + '</h3>';

    out += '<h4>Views</h4><div class="echo-views">';
    for (i = 0; i < d.views.length; i++) out += viewCardHtml(d.views[i]);
    out += '</div>';

    out += '<h4>What to look for</h4><ul class="echo-qual">';
    for (i = 0; i < d.qualitative.length; i++) out += '<li>' + esc(d.qualitative[i]) + '</li>';
    out += '</ul>';

    out += '<h4>The numbers</h4><ul class="echo-quant">';
    for (i = 0; i < d.quantitative.length; i++) out += '<li>' + esc(d.quantitative[i]) + '</li>';
    out += '</ul>';

    if (d.measures.length) {
      out += '<h4>Measured where</h4><table class="echo-measures"><thead><tr>' +
        '<th>Measurement</th><th>Reference / interpretation</th><th>View</th><th>Source</th></tr></thead><tbody>';
      for (i = 0; i < d.measures.length; i++) out += measureRowHtml(d.measures[i]);
      out += '</tbody></table>';
    }
    return out;
  }

  function referenceHtml(state) {
    var s = state || {};
    return '<div class="echo-ref-tab">' +
      diseaseListHtml(s.disease) +
      '<div class="echo-detail">' + diseaseHtml(s.disease) + '</div>' +
      '</div>';
  }

  /* ── calculator ─────────────────────────────────────────────────────── */

  /* The fields, and what each one feeds. `needs` is what makes the rule
     below enforceable: a derived row names its inputs, so "only compute what
     the inputs allow" is a property of the table rather than of remembering
     to write an if. */
  var FIELDS = [
    { id: 'lvotD', label: 'LVOT diameter', units: 'cm', view: 'plax' },
    { id: 'lvotVti', label: 'LVOT VTI', units: 'cm', view: 'a5c' },
    { id: 'avVti', label: 'Aortic VTI', units: 'cm', view: 'a5c' },
    { id: 'avVmax', label: 'Aortic peak velocity', units: 'm/s', view: 'a5c' },
    { id: 'edv', label: 'LV end-diastolic volume', units: 'mL', view: 'a4c' },
    { id: 'esv', label: 'LV end-systolic volume', units: 'mL', view: 'a4c' },
    { id: 'trVmax', label: 'TR peak velocity', units: 'm/s', view: 'a4c' },
    { id: 'ivcD', label: 'IVC diameter', units: 'cm', view: 'ivc' },
    { id: 'ivcCollapse', label: 'IVC collapse', units: '%', view: 'ivc' },
    { id: 'pisaR', label: 'PISA radius', units: 'cm', view: 'a4c' },
    { id: 'alias', label: 'Aliasing velocity', units: 'cm/s', view: 'a4c' },
    { id: 'regVmax', label: 'Regurgitant peak velocity', units: 'cm/s', view: 'a4c' },
    { id: 'regVti', label: 'Regurgitant VTI', units: 'cm', view: 'a4c' },
    { id: 'pht', label: 'Mitral pressure half-time', units: 'ms', view: 'a4c' },
    { id: 'hr', label: 'Heart rate', units: 'bpm', view: 'a4c' },
  ];

  var DERIVED = [
    { id: 'sv', label: 'Stroke volume', units: 'mL', places: 1, needs: ['lvotD', 'lvotVti'],
      compute: function (f) { return E.strokeVolume(f.lvotD, f.lvotVti); } },
    { id: 'ava', label: 'Aortic valve area (continuity)', units: 'cm²', places: 2,
      needs: ['lvotD', 'lvotVti', 'avVti'], gradeBy: 'as-ava',
      compute: function (f) { return E.continuityArea(f.lvotD, f.lvotVti, f.avVti); } },
    { id: 'di', label: 'Dimensionless index', units: '', places: 2, needs: ['lvotVti', 'avVti'],
      compute: function (f) { return E.dimensionlessIndex(f.lvotVti, f.avVti); } },
    { id: 'avGrad', label: 'Aortic peak gradient', units: 'mmHg', places: 0,
      needs: ['avVmax'], gradeBy: 'as-vmax', gradeFrom: 'avVmax',
      compute: function (f) { return E.gradient(f.avVmax); } },
    { id: 'ef', label: 'Ejection fraction', units: '%', places: 0, needs: ['edv', 'esv'],
      compute: function (f) { return E.ejectionFraction(f.edv, f.esv); } },
    { id: 'co', label: 'Cardiac output', units: 'L/min', places: 1, needs: ['lvotD', 'lvotVti', 'hr'],
      compute: function (f) { return E.cardiacOutput(E.strokeVolume(f.lvotD, f.lvotVti), f.hr); } },
    { id: 'rap', label: 'RA pressure (estimated)', units: 'mmHg', places: 0, needs: ['ivcD', 'ivcCollapse'],
      compute: function (f) { return E.raPressure(f.ivcD, f.ivcCollapse); } },
    { id: 'pasp', label: 'PA systolic pressure', units: 'mmHg', places: 0,
      needs: ['trVmax', 'ivcD', 'ivcCollapse'],
      compute: function (f) { return E.pasp(f.trVmax, E.raPressure(f.ivcD, f.ivcCollapse)); } },
    { id: 'ero', label: 'Effective regurgitant orifice (PISA)', units: 'cm²', places: 2,
      needs: ['pisaR', 'alias', 'regVmax'], gradeBy: 'mr-ero',
      compute: function (f) { return E.pisaEro(f.pisaR, f.alias, f.regVmax); } },
    { id: 'rvol', label: 'Regurgitant volume', units: 'mL', places: 0,
      needs: ['pisaR', 'alias', 'regVmax', 'regVti'], gradeBy: 'mr-rvol',
      compute: function (f) { return E.regurgitantVolume(E.pisaEro(f.pisaR, f.alias, f.regVmax), f.regVti); } },
    { id: 'mva', label: 'Mitral valve area (half-time)', units: 'cm²', places: 2,
      needs: ['pht'], gradeBy: 'ms-mva',
      compute: function (f) { return E.mvaByPht(f.pht); } },
  ];

  /* THE RULE. A row is produced only when every input it names is a finite
     number. Anything else is reported as missing, by name. Nothing is
     defaulted and nothing is guessed, because a plausible wrong number on a
     study screen is worse than an obviously absent one. */
  function compute(fields) {
    var f = fields || {}, rows = [], missing = [], i, j;
    for (i = 0; i < DERIVED.length; i++) {
      var d = DERIVED[i], lack = [];
      for (j = 0; j < d.needs.length; j++) {
        if (!num(f[d.needs[j]])) lack.push(d.needs[j]);
      }
      if (lack.length) { missing.push({ id: d.id, label: d.label, needs: lack }); continue; }
      var value = d.compute(f);
      if (!num(value)) { missing.push({ id: d.id, label: d.label, needs: d.needs.slice() }); continue; }
      var row = { id: d.id, label: d.label, value: value, units: d.units, places: d.places };
      if (d.gradeBy) {
        var g = E.grade(d.gradeBy, d.gradeFrom ? f[d.gradeFrom] : value);
        if (g) { row.grade = g.grade; row.ref = g.ref; row.lesion = g.lesion; }
      }
      rows.push(row);
    }
    return { rows: rows, missing: missing };
  }

  var GROUPS = [
    { title: 'Flow & aortic valve', ids: ['lvotD', 'lvotVti', 'avVti', 'avVmax', 'hr'] },
    { title: 'LV volumes', ids: ['edv', 'esv'] },
    { title: 'Right-heart pressure', ids: ['trVmax', 'ivcD', 'ivcCollapse'] },
    { title: 'Mitral valve', ids: ['pisaR', 'alias', 'regVmax', 'regVti', 'pht'] }
  ];

  function fieldsHtml(fields, ids) {
    var f = fields || {}, out = '', i;
    for (i = 0; i < FIELDS.length; i++) {
      var x = FIELDS[i];
      if (ids && ids.indexOf(x.id) < 0) continue;
      var v = num(f[x.id]) ? String(f[x.id]) : '';
      var view = byId(E.VIEWS, x.view);
      out += '<label class="echo-field">' +
        '<span class="echo-label">' + esc(x.label) + '</span>' +
        '<input type="number" inputmode="decimal" step="any" min="0" data-echo-field="' + esc(x.id) + '"' +
        ' value="' + esc(v) + '" aria-label="' + esc(x.label + ' in ' + x.units) + '">' +
        '<span class="echo-units">' + esc(x.units) + '</span>' +
        '<span class="echo-where">' + esc(view ? view.name : x.view) + '</span>' +
        '</label>';
    }
    return '<div class="echo-fields">' + out + '</div>';
  }

  function resultsHtml(fields) {
    var r = compute(fields), out = '', i;
    var invalid = FIELDS.filter(function (f) { return num((fields || {})[f.id]) &&
      (fields[f.id] < 0 || (f.id === 'ivcCollapse' && fields[f.id] > 100)); });
    if (invalid.length) out += '<p class="echo-warning" role="status">Check measurements: ' +
      esc(invalid.map(function (f) { return f.label; }).join(', ')) + '. Use non-negative magnitudes; IVC collapse must be a percentage within its valid range.</p>';
    if (!r.rows.length) {
      out += '<p class="echo-empty">Enter measurements and the derived values appear here.</p>';
    } else {
      out += '<table class="echo-results"><thead><tr><th>Derived</th><th>Value</th>' +
        '<th>Single-metric band</th><th>Source</th></tr></thead><tbody>';
      for (i = 0; i < r.rows.length; i++) {
        var row = r.rows[i];
        out += '<tr><td>' + esc(row.label) + '</td>' +
          '<td class="echo-value">' + esc(fmt(row.value, row.places)) +
          (row.units ? ' ' + esc(row.units) : '') + '</td>' +
          '<td>' + (row.grade ? '<span class="echo-grade" data-grade="' + esc(row.grade) + '">' +
            esc(row.grade) + '</span>' : '—') + '</td>' +
          '<td class="echo-ref">' + esc(row.ref || '') + '</td></tr>';
      }
      out += '</tbody></table>';
    }
    if (r.missing.length) {
      out += '<details class="echo-missing"><summary>' + esc(r.missing.length) +
        ' not yet computable</summary><ul>';
      for (i = 0; i < r.missing.length; i++) {
        var m = r.missing[i], names = [], j;
        for (j = 0; j < m.needs.length; j++) {
          var fd = byId(FIELDS, m.needs[j]);
          names.push(fd ? fd.label : m.needs[j]);
        }
        out += '<li>' + esc(m.label) + ' — needs ' + esc(names.join(', ')) + '</li>';
      }
      out += '</ul></details>';
    }
    return out;
  }

  function calculatorHtml(fields) {
    var groups = GROUPS.map(function (g) {
      return '<fieldset class="echo-group"><legend>' + esc(g.title) + '</legend>' + fieldsHtml(fields, g.ids) + '</fieldset>';
    }).join('');
    return '<div class="echo-calc"><p class="echo-note">Enter measured magnitudes in the displayed units. Blank means not measured. Results update as you type.</p>' + groups +
      '<aside class="echo-cautions"><strong>Interpret together</strong><p>Valve bands describe one measurement, not an integrated severity diagnosis. Check flow, acquisition quality and discordant measurements.</p><p>PASP assumes no RV outflow or pulmonary valve obstruction. IVC-based RA pressure assumes spontaneous breathing. PISA assumes hemispheric convergence; its displayed bands are for primary MR. Pressure half-time can be unreliable after valvuloplasty or with significant AR.</p></aside>' +
      '<div class="echo-out" aria-live="polite" aria-atomic="true">' + resultsHtml(fields) + '</div></div>';
  }

  function visualHtml(state) {
    var phase = state.phase || 'auto', media = root.ECHO_MEDIA || {};
    return '<div class="echo-visual">' +
      '<section class="echo-visual-card"><p class="echo-eyebrow">See the cycle</p><h3>From filling to contraction</h3>' +
      '<p>Ventricles fill during diastole and eject during systole. Compare chamber size across the cycle before measuring volumes.</p>' +
      '<div class="echo-cycle" data-phase="' + esc(phase) + '">' +
      '<svg viewBox="0 0 520 350" role="img" aria-label="Simplified four-chamber diagram: right ventricle and atrium on the left, left ventricle and atrium on the right. Ventricles become smaller during contraction.">' +
      '<path class="echo-sector" d="M260 12 L28 326 Q260 374 492 326 Z"/>' +
      '<g class="echo-ventricle echo-rv"><path d="M244 52 Q128 70 120 202 Q160 222 244 207 Z"/></g>' +
      '<g class="echo-ventricle echo-lv"><path d="M274 52 Q378 68 390 204 Q340 226 274 207 Z"/></g>' +
      '<path class="echo-atrium" d="M126 233 Q102 321 232 318 L244 235 Z"/>' +
      '<path class="echo-atrium" d="M276 235 L288 318 Q410 321 386 233 Z"/>' +
      '<path class="echo-valve" d="M126 221 L180 229 L241 220 M277 220 L330 229 L386 221"/>' +
      '<g class="echo-diagram-labels"><text x="184" y="155">RV</text><text x="330" y="155">LV</text><text x="179" y="278">RA</text><text x="332" y="278">LA</text><text x="260" y="28">Apex</text></g></svg>' +
      '<div class="echo-phase-key"><span>Diastole · filling</span><span>Systole · contraction</span></div></div>' +
      '<div class="echo-phase-controls" role="group" aria-label="Cardiac cycle animation">' +
      [['auto','Play cycle'],['diastole','Freeze filling'],['systole','Freeze contraction']].map(function(x){return '<button data-echo-phase="' + x[0] + '" aria-pressed="' + (phase === x[0]) + '">' + x[1] + '</button>';}).join('') + '</div>' +
      '<p class="echo-note">Original teaching schematic, not a patient scan or a measurement model. Motion is illustrative; anatomy is simplified. Reduced-motion settings stop playback.</p></section>' +
      '<section class="echo-visual-card"><p class="echo-eyebrow">Connect image &amp; anatomy</p><h3>Recognise the view</h3><div class="echo-image-grid">' +
      '<figure><img class="echo-teaching-image" src="' + esc(media.fourChamber || '') + '" alt="Real four-chamber echocardiogram with the apex pointing down and the left heart on the right of the image" loading="lazy" width="636" height="434"><figcaption><strong>Real echo · four chambers</strong><p>Notice the dark cavities and brighter tissue borders. This example displays the apex down; orientation varies between acquisitions.</p><a href="https://commons.wikimedia.org/wiki/File:Echocardiogram_4chambers.jpg" target="_blank" rel="noopener noreferrer">Kjetil Lenes · public domain · original image</a></figcaption></figure>' +
      '<figure><img class="echo-teaching-image" src="' + esc(media.plax || '') + '" alt="Anatomical illustration of a parasternal long-axis section showing the left ventricle, mitral valve, left atrium and aortic root" loading="lazy" width="960" height="640"><figcaption><strong>Anatomy illustration · long axis</strong><p>Trace the LV cavity to the mitral valve and atrium, then identify the outflow tract and aortic root.</p><a href="https://commons.wikimedia.org/wiki/File:Heart_lpla_echo_view.jpg" target="_blank" rel="noopener noreferrer">Patrick J. Lynch &amp; C. Carl Jaffe · source (resized by Wikimedia)</a> · <a href="https://creativecommons.org/licenses/by/2.5/" target="_blank" rel="noopener noreferrer">CC BY 2.5</a></figcaption></figure></div></section>' +
      '<section class="echo-visual-card"><p class="echo-eyebrow">A practical reading path</p><h3>From a clinical question to an integrated answer</h3><ol class="echo-flow">' +
      '<li><strong>Start with the question</strong><span>Define what the study needs to explain; note rhythm and relevant context.</span></li>' +
      '<li><strong>Is image quality adequate?</strong><div class="echo-flow-branches"><p><b>No / uncertain</b> Optimise the window and settings. Check another view; record limitations if uncertainty remains.</p><p><b>Yes</b> Acquire the relevant views and Doppler envelopes. Avoid foreshortening and off-axis measurements.</p></div></li>' +
      '<li><strong>Measure consistently</strong><span>Use the correct phase, method and units. Compare chamber size, function, valve morphology and haemodynamics.</span></li>' +
      '<li><strong>Do the findings agree?</strong><div class="echo-flow-branches"><p><b>No</b> Recheck acquisition, loading conditions and measurement assumptions. Use the relevant guideline pathway.</p><p><b>Yes</b> Integrate the findings with the clinical picture and available prior studies.</p></div></li>' +
      '<li><strong>Explain the conclusion</strong><span>State the findings, limitations and unresolved questions. One measurement does not establish the whole diagnosis.</span></li></ol><p class="echo-note">Study workflow, not a diagnostic algorithm. See Current guidance for the complete society documents.</p></section></div>';
  }

  /* ── the screen ─────────────────────────────────────────────────────── */

  function screenHtml(state) {
    var s = state || {};
    var active = tabId(s.tab);
    var body = active === 'calculator' ? calculatorHtml(s.fields) : active === 'visual' ? visualHtml(s) : referenceHtml(s);
    return '<section class="echo-studio">' +
      '<header class="echo-header"><p class="echo-eyebrow">Acquire · Measure · Interpret</p><h2>Echo Studio</h2><p>Explore views, connect findings and practise the arithmetic.</p></header>' +
      '<details class="echo-guidance"><summary>Current guidance &amp; study scope</summary><p>Teaching reference, not a diagnostic report. Valve bands retain their named guideline editions; diastolic teaching reflects the ASE update. Sources open online; this summary works offline.</p>' +
      E.GUIDANCE.map(function (g) { return '<article><a href="' + esc(g.url) + '" target="_blank" rel="noopener noreferrer">' + esc(g.title) + '</a><p>' + esc(g.note) + '</p></article>'; }).join('') + '</details>' +
      tabsHtml(active) +
      '<div class="echo-panel" id="echo-panel" role="tabpanel" aria-labelledby="echo-tab-' + esc(active) + '">' + body + '</div>' +
      '</section>';
  }

  root.EchoUI = {
    TABS: TABS, FIELDS: FIELDS, DERIVED: DERIVED,
    esc: esc, fmt: fmt, tabId: tabId, tabsHtml: tabsHtml,
    diseaseListHtml: diseaseListHtml, viewCardHtml: viewCardHtml, diseaseHtml: diseaseHtml,
    rangeHtml: rangeHtml, measureRowHtml: measureRowHtml,
    referenceHtml: referenceHtml, compute: compute, fieldsHtml: fieldsHtml,
    resultsHtml: resultsHtml, calculatorHtml: calculatorHtml, visualHtml: visualHtml, screenHtml: screenHtml,
  };

})(typeof window !== 'undefined' ? window : this);
