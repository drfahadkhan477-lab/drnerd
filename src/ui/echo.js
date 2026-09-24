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
        ' role="tab" aria-selected="' + (on ? 'true' : 'false') + '">' + esc(t.label) + '</button>';
    }
    return '<div class="echo-tabs" role="tablist">' + out + '</div>';
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
        '<th>Measurement</th><th>Normal</th><th>View</th><th>Source</th></tr></thead><tbody>';
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

  function fieldsHtml(fields) {
    var f = fields || {}, out = '', i;
    for (i = 0; i < FIELDS.length; i++) {
      var x = FIELDS[i];
      var v = num(f[x.id]) ? String(f[x.id]) : '';
      var view = byId(E.VIEWS, x.view);
      out += '<label class="echo-field">' +
        '<span class="echo-label">' + esc(x.label) + '</span>' +
        '<input type="number" inputmode="decimal" step="any" data-echo-field="' + esc(x.id) + '"' +
        ' value="' + esc(v) + '" aria-label="' + esc(x.label + ' in ' + x.units) + '">' +
        '<span class="echo-units">' + esc(x.units) + '</span>' +
        '<span class="echo-where">' + esc(view ? view.name : x.view) + '</span>' +
        '</label>';
    }
    return '<div class="echo-fields">' + out + '</div>';
  }

  function resultsHtml(fields) {
    var r = compute(fields), out = '', i;
    if (!r.rows.length) {
      out += '<p class="echo-empty">Enter measurements and the derived values appear here.</p>';
    } else {
      out += '<table class="echo-results"><thead><tr><th>Derived</th><th>Value</th>' +
        '<th>Grade</th><th>Source</th></tr></thead><tbody>';
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
    return '<div class="echo-calc">' + fieldsHtml(fields) +
      '<div class="echo-out">' + resultsHtml(fields) + '</div></div>';
  }

  /* ── the screen ─────────────────────────────────────────────────────── */

  function screenHtml(state) {
    var s = state || {};
    var active = tabId(s.tab);
    var body = active === 'calculator' ? calculatorHtml(s.fields) : referenceHtml(s);
    return '<section class="echo-studio">' +
      '<h2>Echo Studio</h2>' +
      tabsHtml(active) +
      '<div class="echo-panel" role="tabpanel">' + body + '</div>' +
      '</section>';
  }

  root.EchoUI = {
    TABS: TABS, FIELDS: FIELDS, DERIVED: DERIVED,
    esc: esc, fmt: fmt, tabId: tabId, tabsHtml: tabsHtml,
    diseaseListHtml: diseaseListHtml, viewCardHtml: viewCardHtml, diseaseHtml: diseaseHtml,
    rangeHtml: rangeHtml, measureRowHtml: measureRowHtml,
    referenceHtml: referenceHtml, compute: compute, fieldsHtml: fieldsHtml,
    resultsHtml: resultsHtml, calculatorHtml: calculatorHtml, screenHtml: screenHtml,
  };

})(typeof window !== 'undefined' ? window : this);
