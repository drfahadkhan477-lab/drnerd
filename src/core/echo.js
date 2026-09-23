/* ═══════════════════════════════════════════════════════════════════════════
   echo.js — the echocardiogram as data: views, measurements, and the
   arithmetic that turns one into the other.

   No DOM, no timers, no rendering. Everything here is a table or a function,
   so the whole module can be unit-tested without a browser — which matters
   more here than elsewhere, because the numbers are clinical and a silently
   wrong one is worse than a missing feature.

   ── WHAT IS IN HERE ──────────────────────────────────────────────────────

   VIEWS         the standard transthoracic views: window, patient position,
                 probe index mark, transducer angle, and what each is FOR.
   MEASUREMENTS  what is measured, in which view, in what units, with the
                 normal range and the reference that defines it.
   FORMULAS      the arithmetic — continuity, Simpson, PISA, Bernoulli — as
                 functions that take numbers and return numbers.
   LESIONS       severity grading, as ordered bands rather than prose, so a
                 value can be graded and the grading can be checked.
   DISEASES      what to look for and where, qualitative and quantitative.

   ── WHERE THE NUMBERS COME FROM ──────────────────────────────────────────

   Valve severity follows the 2020 ACC/AHA Valvular Heart Disease guideline
   and the ASE recommendations for native valve regurgitation (2017);
   chamber quantification follows the ASE/EACVI 2015 update; diastolic
   function follows the ASE/EACVI 2016 algorithm. Each band carries the
   reference that defines it in `ref`, because a cutoff without a source is a
   number somebody will eventually change on a hunch.

   These are teaching references for a board-review app. They are not a
   substitute for the guideline documents, and the module says so rather than
   implying an authority it does not have.

   ── A NOTE ON MITRAL STENOSIS, WHICH IS WHERE SOURCES DISAGREE ────────────

   The older ASE grading calls an area of 1.0-1.5 cm² moderate and ≤1.0 cm²
   severe. The 2020 ACC/AHA staging calls ≤1.5 cm² severe (stage C/D) and
   ≤1.0 cm² very severe. Both are in current use and they conflict, so the
   bands below follow ACC/AHA and say which they follow. Anything quoting one
   of these numbers without naming the source is ambiguous by construction.

   Wiring: everything is exported on root.Echo. The UI layer reads the tables
   and calls the formulas; it does not restate a single number of its own.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* ── views ──────────────────────────────────────────────────────────────
     `angle` is the transducer rotation in degrees as it is conventionally
     taught for a phased-array probe, and `mark` is where the index mark
     points. Both are included because the pair is what actually gets a
     trainee from "I know the name of the view" to "I can obtain it". */
  var VIEWS = [
    { id: 'plax', name: 'Parasternal long axis', window: 'Left parasternal, 3rd-4th intercostal space',
      position: 'Left lateral decubitus', mark: "Patient's right shoulder", angle: 0,
      sees: ['LV', 'LA', 'aortic valve', 'mitral valve', 'LVOT', 'proximal aorta', 'RV outflow', 'pericardium'],
      forWhat: 'LV dimensions, LVOT diameter, aortic root, mitral and aortic anatomy, pericardial effusion' },

    { id: 'psax-av', name: 'Parasternal short axis — aortic valve', window: 'Left parasternal',
      position: 'Left lateral decubitus', mark: "Patient's left shoulder", angle: 90,
      sees: ['aortic valve cusps', 'RA', 'RV', 'tricuspid valve', 'pulmonic valve', 'interatrial septum'],
      forWhat: 'Cusp number and morphology, bicuspid valve, TR and PR interrogation' },

    { id: 'psax-mv', name: 'Parasternal short axis — mitral valve', window: 'Left parasternal',
      position: 'Left lateral decubitus', mark: "Patient's left shoulder", angle: 90,
      sees: ['mitral leaflets', 'LV', 'RV'],
      forWhat: 'Mitral orifice planimetry, fish-mouth appearance in rheumatic stenosis' },

    { id: 'psax-pm', name: 'Parasternal short axis — papillary muscle', window: 'Left parasternal',
      position: 'Left lateral decubitus', mark: "Patient's left shoulder", angle: 90,
      sees: ['LV mid cavity', 'papillary muscles', 'RV', 'interventricular septum'],
      forWhat: 'Regional wall motion in all three coronary territories, septal motion, LV geometry' },

    { id: 'psax-apex', name: 'Parasternal short axis — apex', window: 'Left parasternal, lateral and inferior',
      position: 'Left lateral decubitus', mark: "Patient's left shoulder", angle: 90,
      sees: ['LV apex'],
      forWhat: 'Apical thrombus, apical hypertrophy, apical ballooning' },

    { id: 'a4c', name: 'Apical four chamber', window: 'Apex, at the point of maximal impulse',
      position: 'Left lateral decubitus', mark: "Patient's left side", angle: 0,
      sees: ['all four chambers', 'mitral valve', 'tricuspid valve', 'interatrial septum', 'interventricular septum'],
      forWhat: 'Biplane volumes and EF, E and A waves, tissue Doppler, TR jet, RV size and TAPSE' },

    { id: 'a5c', name: 'Apical five chamber', window: 'Apex, angled anteriorly from four chamber',
      position: 'Left lateral decubitus', mark: "Patient's left side", angle: 0,
      sees: ['four chambers', 'LVOT', 'aortic valve'],
      forWhat: 'LVOT velocity by pulsed Doppler and aortic velocity by continuous wave' },

    { id: 'a2c', name: 'Apical two chamber', window: 'Apex, rotated from four chamber',
      position: 'Left lateral decubitus', mark: "Patient's left shoulder", angle: 60,
      sees: ['LV', 'LA', 'mitral valve', 'LA appendage'],
      forWhat: 'The second plane of the biplane volume, inferior and anterior wall motion' },

    { id: 'a3c', name: 'Apical three chamber', window: 'Apex, rotated further from two chamber',
      position: 'Left lateral decubitus', mark: "Patient's right shoulder", angle: 120,
      sees: ['LV', 'LA', 'LVOT', 'aortic valve', 'mitral valve'],
      forWhat: 'An alternative LVOT and aortic Doppler window, inferolateral and anteroseptal walls' },

    { id: 'subcostal', name: 'Subcostal four chamber', window: 'Subxiphoid',
      position: 'Supine, knees flexed', mark: "Patient's left side", angle: 0,
      sees: ['all four chambers', 'interatrial septum', 'pericardium'],
      forWhat: 'The rescue window when parasternal fails, pericardial effusion, atrial septal defect' },

    { id: 'ivc', name: 'Subcostal IVC', window: 'Subxiphoid, rotated to long axis of the IVC',
      position: 'Supine', mark: "Patient's head", angle: 90,
      sees: ['inferior vena cava', 'hepatic vein', 'RA junction'],
      forWhat: 'Right atrial pressure estimation from calibre and inspiratory collapse' },

    { id: 'ssn', name: 'Suprasternal notch', window: 'Suprasternal',
      position: 'Supine, neck extended, head turned left', mark: "Patient's left shoulder", angle: 0,
      sees: ['aortic arch', 'branch vessels', 'descending aorta'],
      forWhat: 'Coarctation, dissection flap, diastolic flow reversal in severe aortic regurgitation' },
  ];

  /* ── measurements ───────────────────────────────────────────────────────
     `view` names the view each is obtained in, and every one of those ids
     must exist in VIEWS above — checked, not assumed, by the suite. */
  var MEASUREMENTS = [
    { id: 'lvidd', name: 'LV internal diameter, diastole', view: 'plax', units: 'cm',
      normal: [4.2, 5.8], note: 'Sex-specific: 4.2-5.8 cm men, 3.8-5.2 cm women', ref: 'ASE 2015' },
    { id: 'lvids', name: 'LV internal diameter, systole', view: 'plax', units: 'cm',
      normal: [2.5, 4.0], note: 'Used for fractional shortening', ref: 'ASE 2015' },
    { id: 'ivsd', name: 'Interventricular septum, diastole', view: 'plax', units: 'cm',
      normal: [0.6, 1.0], note: 'Above 1.1 cm is hypertrophy in men', ref: 'ASE 2015' },
    { id: 'lvot-d', name: 'LVOT diameter', view: 'plax', units: 'cm',
      normal: [1.8, 2.2], note: 'Squared in the continuity equation, so a 10% error becomes 21%', ref: 'ASE 2017' },
    { id: 'lvot-vti', name: 'LVOT velocity time integral', view: 'a5c', units: 'cm',
      normal: [18, 22], note: 'Pulsed wave, sample 5 mm proximal to the valve', ref: 'ASE 2017' },
    { id: 'av-vmax', name: 'Aortic peak velocity', view: 'a5c', units: 'm/s',
      normal: [1.0, 1.7], note: 'Continuous wave, interrogate from multiple windows', ref: 'ACC/AHA 2020' },
    { id: 'lvef', name: 'LV ejection fraction', view: 'a4c', units: '%',
      normal: [52, 72], note: 'Biplane Simpson; 52-72% men, 54-74% women', ref: 'ASE 2015' },
    { id: 'lavi', name: 'LA volume index', view: 'a4c', units: 'mL/m2',
      normal: [16, 34], note: 'Above 34 is a marker of chronically raised filling pressure', ref: 'ASE 2015' },
    { id: 'e-vel', name: 'Mitral E velocity', view: 'a4c', units: 'm/s',
      normal: [0.6, 1.3], note: 'Pulsed wave at the leaflet tips', ref: 'ASE 2016' },
    { id: 'e-prime', name: "Mitral annular e'", view: 'a4c', units: 'cm/s',
      normal: [7, 15], note: "Septal e' below 7 or lateral below 10 is abnormal", ref: 'ASE 2016' },
    { id: 'e-over-e', name: "E/e' ratio, average", view: 'a4c', units: 'ratio',
      normal: [4, 14], note: 'Above 14 suggests raised LV filling pressure', ref: 'ASE 2016' },
    { id: 'tr-vmax', name: 'Tricuspid regurgitant peak velocity', view: 'a4c', units: 'm/s',
      normal: [0, 2.8], note: 'Drives the pulmonary pressure estimate', ref: 'ASE 2016' },
    { id: 'tapse', name: 'Tricuspid annular plane systolic excursion', view: 'a4c', units: 'mm',
      normal: [17, 30], note: 'Below 17 mm indicates RV systolic dysfunction', ref: 'ASE 2015' },
    { id: 'ivc-d', name: 'IVC diameter', view: 'ivc', units: 'cm',
      normal: [0.9, 2.1], note: 'With collapse, estimates right atrial pressure', ref: 'ASE 2015' },
  ];

  /* ── formulas ───────────────────────────────────────────────────────────
     Each returns a number, or null when an input makes the answer
     meaningless. Returning null rather than NaN is deliberate: NaN
     propagates silently through arithmetic and prints as "NaN" on screen,
     whereas null fails a comparison immediately and is easy to test for. */

  function num(v) { return typeof v === 'number' && isFinite(v); }

  /* Simplified Bernoulli. Valid where the proximal velocity is negligible;
     above roughly 1.5 m/s proximally the full equation is needed and this
     overestimates, which is why `gradientFull` exists beside it. */
  function gradient(v) { return num(v) ? 4 * v * v : null; }

  function gradientFull(v, vProximal) {
    if (!num(v) || !num(vProximal)) return null;
    return 4 * (v * v - vProximal * vProximal);
  }

  /* Circular cross-section from a diameter. The LVOT is mildly elliptical,
     so this systematically under-reads area, which is the main reason
     continuity-derived valve areas run smaller than planimetered ones. */
  function csa(diameter) {
    if (!num(diameter) || diameter <= 0) return null;
    return Math.PI * (diameter / 2) * (diameter / 2);
  }

  function strokeVolume(lvotDiameter, lvotVti) {
    var area = csa(lvotDiameter);
    if (area === null || !num(lvotVti) || lvotVti <= 0) return null;
    return area * lvotVti;
  }

  /* Continuity: what passes through the outflow tract must pass through the
     valve. Area falls out of the ratio of the two velocity integrals. */
  function continuityArea(lvotDiameter, lvotVti, avVti) {
    var sv = strokeVolume(lvotDiameter, lvotVti);
    if (sv === null || !num(avVti) || avVti <= 0) return null;
    return sv / avVti;
  }

  /* Dimensionless index — the same ratio without the diameter, and therefore
     without the squared error the diameter carries. Useful exactly when the
     LVOT cannot be measured confidently. */
  function dimensionlessIndex(lvotVti, avVti) {
    if (!num(lvotVti) || !num(avVti) || avVti <= 0) return null;
    return lvotVti / avVti;
  }

  function cardiacOutput(sv, hr) {
    if (!num(sv) || !num(hr) || hr <= 0) return null;
    return sv * hr / 1000;
  }

  /* Body surface area, Mosteller. Used to index volumes and valve areas. */
  function bsa(heightCm, weightKg) {
    if (!num(heightCm) || !num(weightKg) || heightCm <= 0 || weightKg <= 0) return null;
    return Math.sqrt(heightCm * weightKg / 3600);
  }

  function ejectionFraction(edv, esv) {
    if (!num(edv) || !num(esv) || edv <= 0 || esv < 0 || esv > edv) return null;
    return (edv - esv) / edv * 100;
  }

  function fractionalShortening(lvidd, lvids) {
    if (!num(lvidd) || !num(lvids) || lvidd <= 0 || lvids < 0 || lvids > lvidd) return null;
    return (lvidd - lvids) / lvidd * 100;
  }

  /* Mitral area from pressure half-time. The 220 is empirical, and the
     method fails after valvuloplasty and in significant aortic
     regurgitation, where the half-time reflects compliance rather than
     orifice. Said here because the formula is often applied where it does
     not hold. */
  function mvaByPht(pht) {
    if (!num(pht) || pht <= 0) return null;
    return 220 / pht;
  }

  /* PISA. Radius in cm, aliasing velocity and peak regurgitant velocity in
     cm/s, giving an effective orifice in cm². Assumes a hemispheric
     convergence zone, which a constrained or eccentric jet violates. */
  function pisaEro(radius, aliasVelocity, peakRegurgVelocity) {
    if (!num(radius) || !num(aliasVelocity) || !num(peakRegurgVelocity)) return null;
    if (radius <= 0 || peakRegurgVelocity <= 0) return null;
    return 2 * Math.PI * radius * radius * aliasVelocity / peakRegurgVelocity;
  }

  function regurgitantVolume(ero, regurgVti) {
    if (!num(ero) || !num(regurgVti) || ero < 0 || regurgVti <= 0) return null;
    return ero * regurgVti;
  }

  function regurgitantFraction(regVolume, totalStrokeVolume) {
    if (!num(regVolume) || !num(totalStrokeVolume) || totalStrokeVolume <= 0) return null;
    return regVolume / totalStrokeVolume * 100;
  }

  /* Pulmonary artery systolic pressure. Equal to RV systolic pressure only
     when there is no pulmonic stenosis or RVOT obstruction. */
  function pasp(trVmax, raPressure) {
    var g = gradient(trVmax);
    if (g === null || !num(raPressure)) return null;
    return g + raPressure;
  }

  /* Right atrial pressure from the IVC, as the three-band estimate the ASE
     recommends rather than a continuous function it does not support. */
  function raPressure(ivcDiameterCm, collapsePercent) {
    if (!num(ivcDiameterCm) || !num(collapsePercent)) return null;
    var small = ivcDiameterCm <= 2.1;
    var collapses = collapsePercent > 50;
    if (small && collapses) return 3;
    if (!small && !collapses) return 15;
    return 8;
  }

  /* LV mass, Devereux, from linear dimensions in cm, returning grams. */
  function lvMass(lvidd, pwtd, swtd) {
    if (!num(lvidd) || !num(pwtd) || !num(swtd)) return null;
    if (lvidd <= 0 || pwtd < 0 || swtd < 0) return null;
    var sum = lvidd + pwtd + swtd;
    return 0.8 * (1.04 * (sum * sum * sum - lvidd * lvidd * lvidd)) + 0.6;
  }

  function indexed(value, bodySurfaceArea) {
    if (!num(value) || !num(bodySurfaceArea) || bodySurfaceArea <= 0) return null;
    return value / bodySurfaceArea;
  }

  /* ── severity bands ─────────────────────────────────────────────────────
     Ordered, so every finite value falls in exactly one band. `dir` says
     which way severity runs: 'up' means a larger number is worse (a
     velocity), 'down' means smaller is worse (a valve area).

     A band's upper edge is OPEN unless it carries `le: true`, and `le` is
     set exactly where the cited source writes <=. That is the whole reason
     it exists. Guidelines write the two directions differently — "severe
     AS: Vmax >= 4" puts 4.0 in the band ABOVE the line, "severe AS: AVA <=
     1.0" puts 1.0 in the band BELOW it — and one rule for both got every
     "smaller is worse" threshold one grade too mild: a 1.0 cm2 aortic valve
     read as moderate, a 1.5 cm2 mitral valve as progressive. It is per band
     rather than per `dir` because the sources are not uniform even within a
     direction: ASE writes severe AR as PHT < 200 but moderate as 200-500, so
     200 is moderate and 500 is too.

     The suite holds both halves: totality and ordering over a sweep, and
     every cited threshold fed in exactly with the grade its source gives. */
  var LESIONS = [
    { id: 'as-vmax', lesion: 'Aortic stenosis', metric: 'Peak velocity', units: 'm/s', dir: 'up',
      ref: 'ACC/AHA 2020',
      /* Mild starts at 2.0, which is ACC/AHA 2020's line (Stage B, Vmax
         2.0-2.9). It read 2.6 — ASE/EACVI's sclerosis cutoff — under a `ref`
         naming ACC/AHA, so a 2.3 m/s jet graded as no stenosis on a screen
         whose source calls it mild. */
      bands: [ { upTo: 2.0, grade: 'none or sclerosis' }, { upTo: 3.0, grade: 'mild' },
               { upTo: 4.0, grade: 'moderate' }, { upTo: 5.0, grade: 'severe' },
               { upTo: Infinity, grade: 'very severe' } ] },

    { id: 'as-mean', lesion: 'Aortic stenosis', metric: 'Mean gradient', units: 'mmHg', dir: 'up',
      ref: 'ACC/AHA 2020',
      bands: [ { upTo: 20, grade: 'mild' }, { upTo: 40, grade: 'moderate' },
               { upTo: 60, grade: 'severe' }, { upTo: Infinity, grade: 'very severe' } ] },

    { id: 'as-ava', lesion: 'Aortic stenosis', metric: 'Valve area', units: 'cm2', dir: 'down',
      ref: 'ACC/AHA 2020',
      bands: [ { upTo: 0.6, grade: 'very severe' }, { upTo: 1.0, le: true, grade: 'severe' },
               { upTo: 1.5, le: true, grade: 'moderate' }, { upTo: Infinity, grade: 'mild' } ] },

    { id: 'ms-mva', lesion: 'Mitral stenosis', metric: 'Valve area', units: 'cm2', dir: 'down',
      ref: 'ACC/AHA 2020 staging',
      bands: [ { upTo: 1.0, le: true, grade: 'very severe' }, { upTo: 1.5, le: true, grade: 'severe' },
               { upTo: Infinity, grade: 'progressive' } ] },

    { id: 'mr-ero', lesion: 'Mitral regurgitation', metric: 'Effective regurgitant orifice', units: 'cm2', dir: 'up',
      ref: 'ASE 2017, primary MR',
      bands: [ { upTo: 0.20, grade: 'mild' }, { upTo: 0.40, grade: 'moderate' },
               { upTo: Infinity, grade: 'severe' } ] },

    { id: 'mr-rvol', lesion: 'Mitral regurgitation', metric: 'Regurgitant volume', units: 'mL', dir: 'up',
      ref: 'ASE 2017, primary MR',
      bands: [ { upTo: 30, grade: 'mild' }, { upTo: 60, grade: 'moderate' },
               { upTo: Infinity, grade: 'severe' } ] },

    { id: 'ar-ero', lesion: 'Aortic regurgitation', metric: 'Effective regurgitant orifice', units: 'cm2', dir: 'up',
      ref: 'ASE 2017',
      bands: [ { upTo: 0.10, grade: 'mild' }, { upTo: 0.30, grade: 'moderate' },
               { upTo: Infinity, grade: 'severe' } ] },

    { id: 'ar-pht', lesion: 'Aortic regurgitation', metric: 'Pressure half-time', units: 'ms', dir: 'down',
      ref: 'ASE 2017',
      bands: [ { upTo: 200, grade: 'severe' }, { upTo: 500, le: true, grade: 'moderate' },
               { upTo: Infinity, grade: 'mild' } ] },

    { id: 'tr-vc', lesion: 'Tricuspid regurgitation', metric: 'Vena contracta', units: 'mm', dir: 'up',
      ref: 'ASE 2017',
      bands: [ { upTo: 3, grade: 'mild' }, { upTo: 7, grade: 'moderate' },
               { upTo: Infinity, grade: 'severe' } ] },
  ];

  /* Grade a value against a lesion's bands. Returns null for an unknown id
     or a value that is not a finite number — never a default band, because
     a grading that silently answers "mild" when it was handed nothing is
     the kind of check that passes while measuring nothing. */
  function grade(lesionId, value) {
    if (!num(value)) return null;
    var i, L = null;
    for (i = 0; i < LESIONS.length; i++) { if (LESIONS[i].id === lesionId) { L = LESIONS[i]; break; } }
    if (!L) return null;
    for (i = 0; i < L.bands.length; i++) {
      var b = L.bands[i];
      if (b.le ? value <= b.upTo : value < b.upTo) {
        return { grade: L.bands[i].grade, lesion: L.lesion, metric: L.metric, units: L.units, ref: L.ref };
      }
    }
    return { grade: L.bands[L.bands.length - 1].grade, lesion: L.lesion, metric: L.metric, units: L.units, ref: L.ref };
  }

  /* ── diseases ───────────────────────────────────────────────────────────
     `views` and `measures` reference ids above. Both are checked. */
  var DISEASES = [
    { id: 'as', name: 'Aortic stenosis',
      views: ['plax', 'psax-av', 'a5c', 'a3c'],
      measures: ['lvot-d', 'lvot-vti', 'av-vmax', 'lvef'],
      qualitative: [
        'Calcified, restricted cusps with reduced separation in long axis',
        'Cusp number counted in short axis — bicuspid valves stenose two decades earlier',
        'Concentric LV hypertrophy from chronic pressure overload',
        'Post-stenotic dilatation of the ascending aorta' ],
      quantitative: [
        'Severe: peak velocity 4.0 m/s or more, mean gradient 40 mmHg or more, valve area under 1.0 cm2',
        'Dimensionless index under 0.25 supports severity when the LVOT cannot be measured',
        'Low-flow low-gradient disease needs dobutamine stress to separate true from pseudo-severe' ] },

    { id: 'mr', name: 'Mitral regurgitation',
      views: ['plax', 'psax-mv', 'a4c', 'a2c', 'a3c'],
      measures: ['lvidd', 'lvef', 'lavi'],
      qualitative: [
        'Jet direction names the mechanism: posteriorly directed in anterior leaflet prolapse and the reverse',
        'A central jet in a tethered valve indicates secondary rather than primary disease',
        'Systolic flow reversal in the pulmonary veins is a specific sign of severe regurgitation' ],
      quantitative: [
        'Severe primary: effective orifice 0.40 cm2 or more, regurgitant volume 60 mL or more, fraction 50% or more',
        'Surgery once ejection fraction falls to 60% or below or end-systolic dimension reaches 40 mm',
        'Vena contracta 7 mm or more supports severe disease' ] },

    { id: 'ms', name: 'Mitral stenosis',
      views: ['plax', 'psax-mv', 'a4c'],
      measures: ['lavi', 'tr-vmax'],
      qualitative: [
        'Diastolic doming of the anterior leaflet, the hockey-stick deformity',
        'Fish-mouth orifice on short axis planimetry',
        'Left atrial enlargement with spontaneous echo contrast' ],
      quantitative: [
        'Severe by ACC/AHA staging: valve area 1.5 cm2 or less; very severe 1.0 cm2 or less',
        'Pressure half-time gives area as 220 divided by the half-time',
        'Mean gradient rises with heart rate and is supportive rather than defining' ] },

    { id: 'hcm', name: 'Hypertrophic cardiomyopathy',
      views: ['plax', 'psax-pm', 'a3c', 'a4c'],
      measures: ['ivsd', 'lvef'],
      qualitative: [
        'Asymmetric septal hypertrophy with wall thickness 15 mm or more unexplained by loading',
        'Systolic anterior motion of the mitral valve with a posteriorly directed regurgitant jet',
        'Late-peaking dagger-shaped outflow signal, unlike the symmetric envelope of aortic stenosis' ],
      quantitative: [
        'Obstruction is significant at a resting or provoked gradient of 50 mmHg or more',
        'Two thirds obstruct only on provocation, so Valsalva or exercise is required',
        'Maximal wall thickness 30 mm or more is a sudden death risk marker in its own right' ] },

    { id: 'amyloid', name: 'Cardiac amyloidosis',
      views: ['plax', 'a4c'],
      measures: ['ivsd', 'lavi', 'e-over-e'],
      qualitative: [
        'Increased wall thickness with discordantly low QRS voltage',
        'Apical sparing on longitudinal strain — the cherry-on-top pattern',
        'Granular sparkling myocardium, thickened valves and interatrial septum, small effusion' ],
      quantitative: [
        'Wall thickness above 12 mm with low voltage should trigger bone scintigraphy',
        'Restrictive filling with E/e\' well above 14 despite a preserved ejection fraction' ] },

    { id: 'tamponade', name: 'Cardiac tamponade',
      views: ['subcostal', 'a4c', 'ivc', 'plax'],
      measures: ['ivc-d'],
      qualitative: [
        'Circumferential effusion with right atrial systolic and right ventricular diastolic collapse',
        'Plethoric inferior vena cava with less than 50% inspiratory collapse',
        'Exaggerated respiratory variation in mitral and tricuspid inflow, the echocardiographic pulsus' ],
      quantitative: [
        'Mitral inflow variation above 30% and tricuspid above 60% support tamponade physiology',
        'Tamponade is a clinical diagnosis and drainage should not await these numbers' ] },

    { id: 'constriction', name: 'Constrictive pericarditis',
      views: ['a4c', 'ivc', 'subcostal'],
      measures: ['e-prime', 'ivc-d'],
      qualitative: [
        'Respirophasic septal shift, the septal bounce',
        'Annulus paradoxus: preserved or exaggerated medial e\' despite a restrictive filling pattern',
        'Hepatic vein expiratory diastolic flow reversal' ],
      quantitative: [
        'Medial e\' 8 cm/s or more distinguishes constriction from restriction',
        'Mitral inflow respiratory variation above 25%' ] },

    { id: 'rv-strain', name: 'Acute right ventricular strain',
      views: ['a4c', 'psax-pm', 'ivc'],
      measures: ['tapse', 'tr-vmax', 'ivc-d'],
      qualitative: [
        'Dilated hypokinetic right ventricle with a basal diameter exceeding the left',
        'McConnell sign: free wall akinesis with preserved apical contraction',
        'Septal flattening giving the D-shaped left ventricle in short axis' ],
      quantitative: [
        'TAPSE below 17 mm indicates right ventricular systolic dysfunction',
        'A 60/60 sign — acceleration time under 60 ms with a TR gradient under 60 mmHg — suggests acute disease' ] },

    { id: 'hfpef', name: 'Heart failure with preserved ejection fraction',
      views: ['a4c', 'plax'],
      measures: ['e-over-e', 'e-prime', 'lavi', 'tr-vmax'],
      qualitative: [
        'Normal cavity size with increased relative wall thickness',
        'Left atrial enlargement in the absence of atrial fibrillation or valve disease' ],
      quantitative: [
        'Three or four of: average E/e\' above 14, septal e\' below 7 or lateral below 10, TR velocity above 2.8 m/s, LA volume index above 34 mL/m2',
        'Two of four positive is indeterminate and warrants exercise haemodynamics' ] },
  ];

  root.Echo = {
    VIEWS: VIEWS, MEASUREMENTS: MEASUREMENTS, LESIONS: LESIONS, DISEASES: DISEASES,
    gradient: gradient, gradientFull: gradientFull, csa: csa, strokeVolume: strokeVolume,
    continuityArea: continuityArea, dimensionlessIndex: dimensionlessIndex,
    cardiacOutput: cardiacOutput, bsa: bsa, ejectionFraction: ejectionFraction,
    fractionalShortening: fractionalShortening, mvaByPht: mvaByPht, pisaEro: pisaEro,
    regurgitantVolume: regurgitantVolume, regurgitantFraction: regurgitantFraction,
    pasp: pasp, raPressure: raPressure, lvMass: lvMass, indexed: indexed, grade: grade,
  };

})(typeof window !== 'undefined' ? window : this);
