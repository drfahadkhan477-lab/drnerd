/* ═══════════════════════════════════════════════════════════════════════════
   ask.js — ask your book, and find anything in it, on the device.

   PURE. No model: the built-in coach answers a question with YOUR BOOK'S
   OWN SENTENCES, each with its page, found through five indexes and ranked
   by how well they match; it arranges them under clinical headings
   (definition, causes, mechanism, presentation, diagnosis, treatment,
   complications) by the words they use; and when nothing in the book
   matches, it says so rather than guess. Every line of an answer is a
   sentence of the book, word for word — tests/verify-memorizer-ask-pure.js
   holds that — and the headings are labelled as Memorizer's arrangement.

   The five indexes: chapters → sections; and diseases, clinical scenarios,
   diagnostic tests and treatments → the sections that discuss them. The
   last four are built from VOCAB below: lists of cardiology terms and their
   synonyms written for this file, not taken from any book, matched against
   the owner's text on the device. A term the book never uses indexes
   nothing.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var Coach = root.MemCoach || (typeof require === 'function' ? require('./coach.js') : null);
var Vec = root.MemVec || (typeof require === 'function' ? require('./vec.js') : null);

/* ── the vocabulary: [id, label, terms…], terms as regular-expression
   sources matched case-insensitively at word boundaries ─────────────────── */
var VOCAB = {
  disease: [
    ['acs', 'Acute coronary syndrome', 'acute coronary syndromes?', 'ACS', 'myocardial infarctions?', 'STEMI', 'NSTEMI', 'NSTE-ACS', 'unstable angina', 'heart attack'],
    ['cad', 'Stable coronary artery disease', 'stable angina', 'chronic coronary', 'coronary artery disease', 'CAD', 'ischemic heart disease', 'ischaemic heart disease'],
    ['hf', 'Heart failure', 'heart failure', 'HFrEF', 'HFpEF', 'HFmrEF', 'cardiac failure', 'congestive'],
    ['dcm', 'Dilated cardiomyopathy', 'dilated cardiomyopath(?:y|ies)', 'DCM'],
    ['hcm', 'Hypertrophic cardiomyopathy', 'hypertrophic cardiomyopath(?:y|ies)', 'HCM', 'HOCM'],
    ['rcm', 'Restrictive cardiomyopathy', 'restrictive cardiomyopath(?:y|ies)', 'amyloidosis', 'amyloid', 'sarcoidosis'],
    ['arvc', 'Arrhythmogenic cardiomyopathy', 'arrhythmogenic', 'ARVC', 'ARVD'],
    ['myocarditis', 'Myocarditis', 'myocarditis'],
    ['pericardial', 'Pericardial disease', 'pericarditis', 'pericardial effusions?', 'tamponade', 'constrictive pericarditis', 'constriction'],
    ['af', 'Atrial fibrillation', 'atrial fibrillation', 'AF', 'AFib'],
    ['flutter', 'Atrial flutter', 'atrial flutter'],
    ['svt', 'Supraventricular tachycardia', 'supraventricular tachycardias?', 'SVT', 'AVNRT', 'AVRT', 'Wolff-Parkinson-White', 'WPW', 'pre-excitation'],
    ['vt', 'Ventricular arrhythmias', 'ventricular tachycardias?', 'VT', 'ventricular fibrillation', 'VF', 'torsades'],
    ['brady', 'Bradycardia and heart block', 'bradycardias?', 'heart block', 'AV block', 'atrioventricular block', 'sick sinus', 'sinus node dysfunction'],
    ['channel', 'Inherited arrhythmia syndromes', 'long QT', 'LQTS', 'Brugada', 'short QT', 'CPVT'],
    ['scd', 'Sudden cardiac death', 'sudden cardiac death', 'sudden death', 'cardiac arrest', 'SCD'],
    ['as', 'Aortic stenosis', 'aortic stenosis', 'AS'],
    ['ar', 'Aortic regurgitation', 'aortic regurgitation', 'aortic insufficiency', 'AR'],
    ['ms', 'Mitral stenosis', 'mitral stenosis', 'MS'],
    ['mr', 'Mitral regurgitation', 'mitral regurgitation', 'mitral insufficiency', 'MR', 'mitral valve prolapse', 'MVP'],
    ['tricuspid', 'Tricuspid and pulmonic valve disease', 'tricuspid', 'pulmonic stenosis', 'pulmonary stenosis', 'pulmonic regurgitation'],
    ['ie', 'Infective endocarditis', 'endocarditis', 'IE'],
    ['rheumatic', 'Rheumatic heart disease', 'rheumatic'],
    ['chd', 'Congenital heart disease', 'congenital', 'atrial septal defects?', 'ASD', 'ventricular septal defects?', 'VSD', 'patent ductus', 'PDA', 'tetralogy', 'coarctation', 'Eisenmenger', 'Fontan'],
    ['aorta', 'Aortic disease', 'aortic dissection', 'dissection', 'aortic aneurysms?', 'aneurysms?', 'intramural hematoma'],
    ['pad', 'Peripheral artery disease', 'peripheral arter(?:y|ial) disease', 'PAD', 'claudication', 'carotid'],
    ['vte', 'Venous thromboembolism', 'pulmonary embol(?:ism|i)', 'PE', 'deep vein thrombosis', 'DVT', 'thromboembolism'],
    ['ph', 'Pulmonary hypertension', 'pulmonary hypertension', 'pulmonary arterial hypertension', 'PAH'],
    ['htn', 'Hypertension', 'hypertension', 'high blood pressure', 'hypertensive'],
    ['lipids', 'Dyslipidemia', 'dyslipidemia', 'dyslipidaemia', 'hypercholesterolemia', 'cholesterol', 'LDL', 'lipoprotein\\(a\\)', 'triglycerides?'],
    ['dm', 'Diabetes', 'diabetes', 'diabetic'],
    ['tumors', 'Cardiac tumors', 'cardiac tumou?rs?', 'myxoma'],
    ['pregnancy', 'Heart disease in pregnancy', 'pregnan(?:cy|t)', 'peripartum'],
  ],
  scenario: [
    ['chest-pain', 'Chest pain', 'chest pain', 'chest discomfort', 'angina', 'pleuritic'],
    ['dyspnea', 'Dyspnea', 'dyspn(?:o)?ea', 'breathlessness', 'shortness of breath', 'orthopn(?:o)?ea', 'paroxysmal nocturnal'],
    ['syncope', 'Syncope', 'syncope', 'presyncope', 'fainting', 'loss of consciousness'],
    ['palpitations', 'Palpitations', 'palpitations?'],
    ['shock', 'Shock', 'shock', 'cardiogenic shock', 'hypotension', 'hypoperfusion'],
    ['edema', 'Edema', '(?:o)?edema', 'swelling', 'ascites'],
    ['cyanosis', 'Cyanosis', 'cyanosis', 'hypox(?:a)?emia'],
    ['murmur', 'A murmur', 'murmurs?', 'bruit', 'thrill'],
    ['fatigue', 'Fatigue and exercise intolerance', 'fatigue', 'exercise intolerance'],
    ['arrest', 'Cardiac arrest', 'cardiac arrest', 'resuscitation', 'CPR'],
  ],
  test: [
    ['ecg', 'ECG', 'ECG', 'EKG', 'electrocardiogra(?:m|ms|phy|phic)', 'ST-segment', 'ST elevation', 'QRS', 'QT interval'],
    ['echo', 'Echocardiography', 'echocardiogra(?:m|ms|phy|phic)', 'echo', 'TTE', 'TEE', 'transthoracic', 'transesophageal', 'Doppler'],
    ['ct', 'CT', 'CT', 'computed tomography', 'CTA', 'calcium score', 'coronary calcium'],
    ['mri', 'Cardiac MRI', 'MRI', 'CMR', 'magnetic resonance', 'late gadolinium'],
    ['nuclear', 'Stress testing and nuclear imaging', 'stress test(?:ing)?', 'exercise test(?:ing)?', 'SPECT', 'PET', 'myocardial perfusion', 'dobutamine stress'],
    ['troponin', 'Troponin', 'troponins?', 'hs-cTn', 'cardiac biomarkers?'],
    ['bnp', 'Natriuretic peptides', 'BNP', 'NT-proBNP', 'natriuretic peptides?'],
    ['cath', 'Cardiac catheterization', 'catheteri[sz]ation', 'coronary angiogra(?:m|phy)', 'angiogra(?:m|phy)', 'hemodynamics?', 'right heart'],
    ['ep', 'Electrophysiology', 'electrophysiolog(?:y|ic)', 'EP study', 'mapping'],
    ['monitor', 'Ambulatory monitoring', 'Holter', 'ambulatory monitoring', 'event monitor', 'loop recorder'],
    ['cxr', 'Chest radiography', 'chest x-ray', 'chest radiograph(?:y)?', 'CXR'],
    ['ddimer', 'D-dimer', 'D-dimer'],
  ],
  treatment: [
    ['bb', 'Beta-blockers', 'beta[- ]?blockers?', 'β-blockers?', '\\w+olol', 'carvedilol'],
    ['acei', 'ACE inhibitors', 'ACE inhibitors?', 'ACEI', '\\w+pril'],
    ['arb', 'Angiotensin receptor blockers', 'angiotensin receptor blockers?', 'ARBs?', '\\w+sartan'],
    ['arni', 'ARNI', 'ARNI', 'sacubitril', 'neprilysin'],
    ['mra', 'Mineralocorticoid antagonists', 'mineralocorticoid', 'MRA', 'spironolactone', 'eplerenone', 'finerenone'],
    ['sglt2', 'SGLT2 inhibitors', 'SGLT2', '\\w+gliflozin'],
    ['diuretic', 'Diuretics', 'diuretics?', 'furosemide', 'torsemide', 'bumetanide', 'thiazides?', 'loop diuretics?'],
    ['statin', 'Statins and lipid lowering', 'statins?', '\\w+vastatin', 'ezetimibe', 'PCSK9'],
    ['antiplatelet', 'Antiplatelet therapy', 'antiplatelet', 'aspirin', 'clopidogrel', 'ticagrelor', 'prasugrel', 'P2Y12', 'DAPT'],
    ['anticoag', 'Anticoagulation', 'anticoagula(?:nt|nts|tion)', 'warfarin', 'heparin', 'apixaban', 'rivaroxaban', 'dabigatran', 'edoxaban', 'DOACs?', 'NOACs?'],
    ['nitrate', 'Nitrates', 'nitrates?', 'nitroglycerin'],
    ['ccb', 'Calcium channel blockers', 'calcium channel blockers?', 'amlodipine', 'diltiazem', 'verapamil'],
    ['aad', 'Antiarrhythmic drugs', 'antiarrhythmics?', 'amiodarone', 'sotalol', 'flecainide', 'propafenone', 'dofetilide', 'dronedarone'],
    ['digoxin', 'Digoxin', 'digoxin', 'digitalis'],
    ['inotrope', 'Inotropes and vasopressors', 'inotrop(?:e|es|ic)', 'dobutamine', 'milrinone', 'vasopressors?', 'norepinephrine'],
    ['lysis', 'Fibrinolysis', 'fibrinoly(?:sis|tic)', 'thromboly(?:sis|tic)'],
    ['pci', 'PCI and stents', 'PCI', 'percutaneous coronary', 'stents?', 'angioplasty'],
    ['cabg', 'Bypass surgery', 'CABG', 'bypass graft(?:ing)?', 'coronary artery bypass'],
    ['valve-rx', 'Valve intervention', 'TAVR', 'TAVI', 'transcatheter aortic', 'valve replacement', 'valve repair', 'valvuloplasty', 'MitraClip', 'edge-to-edge'],
    ['ablation', 'Catheter ablation', 'ablation'],
    ['device', 'Pacemakers and defibrillators', 'pacemakers?', 'pacing', 'ICDs?', 'implantable cardioverter', 'defibrillat(?:or|ors|ion)', 'CRT', 'resynchronization'],
    ['support', 'Mechanical support and transplant', 'LVAD', 'ventricular assist', 'ECMO', 'intra-aortic balloon', 'IABP', 'Impella', 'transplant(?:ation)?'],
    ['surgery', 'Cardiac surgery', 'surgery', 'surgical'],
    ['lifestyle', 'Lifestyle and rehabilitation', 'lifestyle', 'exercise training', 'cardiac rehabilitation', 'smoking cessation', 'diet'],
    ['caution', 'Contraindications and cautions', 'contraindicat(?:ed|ion|ions)', 'should be avoided', 'avoid(?:ed)?', 'caution'],
  ],
};
var KIND_LABELS = { disease: 'Diseases', scenario: 'Clinical scenarios', test: 'Diagnostic tests', treatment: 'Treatments' };

/* Compiled once: each entry's terms as one pattern. Abbreviations (all
   capitals) are matched case-sensitively — "AS" is aortic stenosis, "as"
   is a word; everything else ignores case. */
var COMPILED = null;
function compiled() {
  if (COMPILED) return COMPILED;
  COMPILED = {};
  Object.keys(VOCAB).forEach(function (kind) {
    COMPILED[kind] = VOCAB[kind].map(function (e) {
      var terms = e.slice(2);
      var upper = terms.filter(function (t) { return /^[A-Z0-9\-]+s?\??$/.test(t) && /[A-Z]{2}/.test(t); });
      var lower = terms.filter(function (t) { return upper.indexOf(t) === -1; });
      return { id: e[0], label: e[1], kind: kind,
               ci: lower.length ? new RegExp('(?:^|[^A-Za-z0-9])(?:' + lower.join('|') + ')(?![A-Za-z0-9])', 'i') : null,
               cs: upper.length ? new RegExp('(?:^|[^A-Za-z0-9])(?:' + upper.join('|') + ')(?![A-Za-z0-9])') : null };
    });
  });
  return COMPILED;
}
function matches(e, text) { return !!((e.ci && e.ci.test(text)) || (e.cs && e.cs.test(text))); }
/* Every vocabulary entry a text names, by kind. */
function entriesIn(text) {
  var C = compiled(), out = [];
  Object.keys(C).forEach(function (k) { C[k].forEach(function (e) { if (matches(e, text)) out.push(e); }); });
  return out;
}

/* ── words ──────────────────────────────────────────────────────────────── */
var STOP = {};
('a an and are as at be been but by can do does for from has have how if in into is it its may of on or ' +
 'that the their there these this those to was were what when where which who why will with than then also ' +
 'about should would could not no more most other such between after before during over under both each ' +
 'tell me explain describe give list show find').split(' ').forEach(function (w) { STOP[w] = true; });
/* "reduce", "reduces", "reduced" → "reduc": the final e goes too, or a
   question's "reduces" and the book's "reduce" never meet. */
function stem(w) { return w.replace(/(?:ies|es|s|ed|ing|ly)$/, '').replace(/e$/, '').replace(/(.)\1$/, '$1'); }
function terms(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9\-]+/).filter(function (w) { return w.length >= 2 && !STOP[w]; }).map(stem);
}

/* ── the corpus: every sentence of every unit, with where it is ────────── */
/* docs: the units (a book's chapters among them). Returns the searchable
   corpus and the five indexes. Slow on a whole book (every sentence, every
   term), so the caller builds it once and keeps it. */
function build(docs) {
  var sents = [], sections = [], df = {}, total = 0;
  (docs || []).forEach(function (d) {
    (d.clusters || []).forEach(function (c, ci) {
      var sec = { id: sections.length, docId: d.id, ci: ci, title: c.title, chapter: d.name, book: d.bookName || '',
                  pageStart: c.pageStart, pageEnd: c.pageEnd, text: c.text, first: sents.length, entries: {} };
      sections.push(sec);
      Coach.sentences(c, true).forEach(function (s) {
        var t = terms(s.text), tf = {};
        t.forEach(function (w) { tf[w] = (tf[w] || 0) + 1; });
        Object.keys(tf).forEach(function (w) { df[w] = (df[w] || 0) + 1; });
        sents.push({ text: s.text, page: s.page, sec: sec.id, tf: tf, len: t.length });
        total += t.length;
      });
      sec.last = sents.length;
    });
  });
  /* Each section's vocabulary: which entries it names, and how often. */
  var C = compiled(), index = {};
  Object.keys(C).forEach(function (k) {
    index[k] = C[k].map(function (e) {
      var where = [];
      sections.forEach(function (sec) {
        var n = 0;
        for (var i = sec.first; i < sec.last; i++) if (matches(e, sents[i].text)) n++;
        if (n) { where.push({ sec: sec.id, count: n }); sec.entries[e.id] = n; }
      });
      where.sort(function (a, b) { return b.count - a.count || a.sec - b.sec; });
      return { id: e.id, label: e.label, sections: where };
    }).filter(function (x) { return x.sections.length; });
  });
  /* Chapters → sections, in book order. */
  var chapters = [], byDoc = {};
  sections.forEach(function (sec) {
    if (!byDoc[sec.docId]) { byDoc[sec.docId] = { docId: sec.docId, title: sec.chapter, book: sec.book, sections: [] }; chapters.push(byDoc[sec.docId]); }
    byDoc[sec.docId].sections.push(sec.id);
  });
  return { sents: sents, sections: sections, df: df, n: sents.length, avg: sents.length ? total / sents.length : 1, index: index, chapters: chapters };
}

/* ── answering ─────────────────────────────────────────────────────────── */
/* The headings an answer is arranged under, each with the words that put a
   sentence there; the first that fits wins. MEMORIZER'S ARRANGEMENT: the
   book did not put its sentences under these headings; Memorizer did. */
var HEADINGS = [
  /* A definition names its term first: "Aortic stenosis is a narrowing…",
     not "This is a common cause…". */
  ['Definition', /^(?!(?:This|That|It|There|These|Those|Which|Such|One|Each)\b)[A-Z][\w\-\/(),' ]{0,60}?\s(?:is|are)\s(?:a|an|defined (?:as|by)|characteri[sz]ed by)\b|\brefers to\b|\bis defined as\b/],
  ['Causes and risk factors', /\b(?:caus(?:e|es|ed)\b|due to\b|etiolog\w*|aetiolog\w*|risk factors?\b|predispos\w*|associated with\b|secondary to\b|results from\b)/i],
  ['Mechanism', /\b(?:leads? to\b|results? in\b|mechanism\w*|pathophysiolog\w*|because\b|increases?\b|decreases?\b|reduces?\b|raises?\b|impairs?\b)/i],
  ['Presentation', /\b(?:present(?:s|ing|ation)?\b|symptom\w*|signs?\b|examination\b|murmurs?\b|complain\w*|history\b)/i],
  ['Diagnosis', /\b(?:diagnos\w*|ECG\b|electrocardiogra\w*|echocardiogra\w*|imaging\b|troponin\w*|natriuretic\b|BNP\b|MRI\b|CT\b|angiogra\w*|biomarker\w*|tests?\b|testing\b|criteria\b|sensitivity\b|specificity\b)/i],
  ['Treatment', /\b(?:treat\w*|therap\w*|manag(?:e|ed|ement)\b|recommend\w*|indicated\b|dose\w*|drugs?\b|surg\w*|interven\w*|implant\w*|ablation\b|PCI\b|should be (?:given|used|started)\b)/i],
  ['Complications and prognosis', /\b(?:complication\w*|prognos\w*|mortality\b|survival\b|outcomes?\b|death\b|recurren\w*|morbidity\b)/i],
];
var OTHER = 'Also in your book';
/* A sentence that names a treatment (a drug class, a procedure) is filed
   under Treatment ahead of the headings after Causes: "Diuretics reduce
   preload" is about a treatment, though "reduce" is a mechanism's word. */
function headingOf(text) {
  for (var i = 0; i < HEADINGS.length; i++) {
    if (HEADINGS[i][0] === 'Mechanism' && compiled().treatment.some(function (e) { return e.id !== 'caution' && matches(e, text); })) return 'Treatment';
    if (HEADINGS[i][1].test(text)) return HEADINGS[i][0];
  }
  return OTHER;
}

/* Words that say what KIND of answer is wanted ("how is it treated", "what
   causes it"), not what it is about. They pick a heading instead of being
   matched: "Valve replacement is indicated…" answers "how is aortic
   stenosis treated?" without the word "treat". */
var INTENTS = [
  ['Treatment', /\b(?:treat\w*|manag\w*|therap\w*|drugs?|medications?)\b/i],
  ['Diagnosis', /\b(?:diagnos\w*|investigat\w*|tests?|workup|work-up)\b/i],
  ['Causes and risk factors', /\b(?:caus\w*|why|etiolog\w*|aetiolog\w*|risks?)\b/i],
  ['Presentation', /\b(?:symptoms?|present\w*|signs?|examination|features?)\b/i],
  ['Complications and prognosis', /\b(?:complications?|prognosis|outcomes?|survival)\b/i],
  ['Definition', /\b(?:define|definition|meaning)\b/i],
];
function intentsOf(question) {
  return INTENTS.filter(function (x) { return x[1].test(question); }).map(function (x) { return x[0]; });
}

var PER_SECTION = 3, MAX_ITEMS = 12, K1 = 1.2, B = 0.75;
/* A sentence must match at least this share of the question's words (or
   name what the question names) to be an answer at all. */
var MIN_SHARE = 0.5;

/* `meaning`: sentences found by meaning (vec.js), [{ i: sentence index,
   cos }], already past its floor. Without it, the word search alone, as
   before. With it, both rankings are merged by reciprocal rank, and a
   sentence found by meaning alone is marked so — still the book's sentence,
   word for word, with its page. */
function ask(idx, question, meaning) {
  var qEntries = entriesIn(question);
  var qTerms = terms(question).filter(function (w, i, a) { return a.indexOf(w) === i; });
  if (!qTerms.length && !qEntries.length) return { question: question, found: false, groups: [], sections: [], named: [] };
  var named = {};
  qEntries.forEach(function (e) { named[e.id] = e; });
  /* Words the question names through an entry ("BNP" → natriuretic…) are
     not required word for word: the entry stands for them. */
  var covered = {};
  qEntries.forEach(function (e) { terms(e.label).forEach(function (w) { covered[w] = true; }); });
  var want = intentsOf(question);
  /* An intent's own words are not required word for word either. */
  INTENTS.forEach(function (x) { if (want.indexOf(x[0]) !== -1) qTerms.forEach(function (w) { if (x[1].test(w)) covered[w] = true; }); });
  var free = qTerms.filter(function (w) { return !covered[w]; });
  var scored = [];
  idx.sents.forEach(function (s, i) {
    var sec = idx.sections[s.sec];
    var hit = 0, score = 0;
    /* Only the words not already stood for by a named thing or the intent
       are scored as words: "aortic stenosis" counts once, as the thing named. */
    free.forEach(function (w) {
      var f = s.tf[w] || 0;
      if (!f) return;
      hit++;
      var idf = Math.log(1 + (idx.n - (idx.df[w] || 0) + 0.5) / ((idx.df[w] || 0) + 0.5));
      score += idf * f * (K1 + 1) / (f + K1 * (1 - B + B * s.len / idx.avg));
    });
    var names = 0;
    Object.keys(named).forEach(function (id) { if (matches(named[id], s.text)) names++; });
    var inSec = 0;
    Object.keys(named).forEach(function (id) { if (sec.entries[id]) inSec++; });
    /* With something named ("aortic stenosis"), a sentence answers if it
       names it too, or if its SECTION is about it and it matches the rest of
       the question — a section on aortic stenosis says "valve replacement is
       indicated when…" without repeating the disease. Without, it must match
       enough of the question's own words. */
    /* Half the words, but never one word of two: "what reduces preload" is
       not answered by every sentence that says "preload". */
    var need = free.length <= 2 ? free.length : Math.ceil(free.length * MIN_SHARE);
    var rest = free.length ? hit > 0 && hit >= need : true;
    var fits = want.length && want.indexOf(headingOf(s.text)) !== -1;
    var enough = qEntries.length ? names === qEntries.length || (inSec === qEntries.length && (free.length ? rest : !want.length || fits)) || (names > 0 && rest)
                                 : free.length ? rest : fits;
    if (!enough) return;
    scored.push({ i: i, score: score + 3 * names + inSec + (fits ? 4 : 0) });
  });
  scored.sort(function (a, b) { return b.score - a.score || a.i - b.i; });
  if (meaning && meaning.length) {
    var byWords = {};
    scored.forEach(function (x) { byWords[x.i] = true; });
    var order = Vec.fuse([scored.map(function (x) { return String(x.i); }), meaning.map(function (x) { return String(x.i); })]).map(Number);
    scored = order.map(function (i, r) { return { i: i, score: order.length - r, meaning: !byWords[i] }; });
  }
  var perSec = {}, items = [];
  scored.forEach(function (x) {
    if (items.length >= MAX_ITEMS) return;
    var s = idx.sents[x.i];
    if ((perSec[s.sec] || 0) >= PER_SECTION) return;
    perSec[s.sec] = (perSec[s.sec] || 0) + 1;
    items.push({ text: s.text, page: s.page, sec: s.sec, heading: headingOf(s.text), score: x.score, by: x.meaning ? 'meaning' : 'words' });
  });
  var groups = HEADINGS.map(function (hd) { return hd[0]; }).concat([OTHER]).map(function (name) {
    return { heading: name, items: items.filter(function (it) { return it.heading === name; }) };
  }).filter(function (g) { return g.items.length; });
  /* Where to read more: the sections the answer came from, best first. */
  var secScore = {};
  scored.forEach(function (x) { var s = idx.sents[x.i].sec; secScore[s] = (secScore[s] || 0) + x.score; });
  var sections = Object.keys(secScore).map(Number).sort(function (a, b) { return secScore[b] - secScore[a] || a - b; }).slice(0, 6);
  return { question: question, found: items.length > 0, groups: groups, sections: sections, named: qEntries.map(function (e) { return e.label; }) };
}

var MemAsk = { VOCAB: VOCAB, KIND_LABELS: KIND_LABELS, HEADINGS: HEADINGS, OTHER: OTHER, PER_SECTION: PER_SECTION, MAX_ITEMS: MAX_ITEMS, MIN_SHARE: MIN_SHARE, INTENTS: INTENTS, intentsOf: intentsOf,
               entriesIn: entriesIn, terms: terms, build: build, ask: ask, headingOf: headingOf };
root.MemAsk = MemAsk;
if (typeof module !== 'undefined' && module.exports) module.exports = MemAsk;
})(typeof window !== 'undefined' ? window : this);
