/* ═══════════════════════════════════════════════════════════════════════════
   analogies.js — everyday comparisons for the ideas cardiology keeps coming
   back to, so a lesson can say "think of it like…" without a key or a network.

   THESE ARE NOT FROM THE STUDENT'S BOOK. Everything else the built-in coach
   teaches is the PDF's own words; these were written for Memorizer, and the
   lesson says so beside every one ("Analogy — Memorizer's, not your book's").
   An analogy explains a mechanism; it never carries a number, a dose, a
   threshold or a recommendation, because those must come from the book.
   Each one says where it stops being true, when that matters.

   An entry is chosen for a section when the section itself uses its terms:
   `match` is a list of patterns, scored by how often the section's text hits
   them (a hit in the title counts three times). The best two that clear
   MIN_SCORE are shown. PURE.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var MIN_SCORE = 2;

var BANK = [
  { id: 'preload', title: 'Preload', match: [/\bpreload\b/i, /end-?diastolic (?:volume|pressure|stretch)/i, /\bventricular filling\b/i],
    text: 'Preload is how far a rubber band is stretched before you let it go. Stretch it a bit more and it snaps back harder — that is the Frank–Starling relation. Overstretch it and it stops gaining force.' },
  { id: 'afterload', title: 'Afterload', match: [/\bafterload\b/i, /\bwall stress\b/i, /\bsystemic (?:vascular )?resistance\b/i],
    text: 'Afterload is the weight of the door the ventricle must push open to get blood out. A stiff, narrowed valve or high blood pressure makes the door heavier; the muscle has to squeeze harder for the same result, and over time it bulks up.' },
  { id: 'contractility', title: 'Contractility', match: [/\bcontractility\b/i, /\binotrop/i, /\bsystolic function\b/i],
    text: 'Contractility is the strength of the engine itself, independent of how much fuel is loaded (preload) or how steep the hill is (afterload). Inotropes tune the engine up; ischemia or failing muscle tunes it down.' },
  { id: 'frank-starling', title: 'Frank–Starling mechanism', match: [/frank[-– ]starling/i, /\bstarling\b/i],
    text: 'A heart that fills more pumps more, the way a sail that catches more wind pulls harder — up to the point where the sail is stretched flat and more wind adds nothing.' },
  { id: 'cardiac-output', title: 'Cardiac output', match: [/\bcardiac output\b/i, /\bstroke volume\b/i, /\bcardiac index\b/i],
    text: 'Cardiac output is buckets per minute: stroke volume is the size of each bucket and heart rate is how fast you pass them. Shrink the bucket and you must pass faster to keep up.' },
  { id: 'ejection-fraction', title: 'Ejection fraction', match: [/\bejection fraction\b/i, /\bLVEF\b/, /\bHFrEF\b/, /\bHFpEF\b/],
    text: 'Ejection fraction is how much of a full glass you drink with each gulp. It says nothing about how big the glass is, which is why a big failing ventricle and a small stiff one can hide the same symptoms behind different numbers.' },
  { id: 'compliance', title: 'Compliance and diastolic dysfunction', match: [/\bcomplian/i, /\bdiastolic dysfunction\b/i, /\brelaxation\b/i, /\bstiff(?:ness|ened)? (?:ventricle|myocardium|heart)\b/i],
    text: 'A compliant ventricle fills like a party balloon; a stiff one fills like a car tyre. To get the same volume into the tyre you need much more pressure — and that pressure backs up into the lungs.' },
  { id: 'hypertrophy', title: 'Concentric and eccentric hypertrophy', match: [/\bhypertroph/i, /\bremodel/i, /\bwall thickness\b/i],
    text: 'Pressure overload is like lifting heavy weights: the wall thickens inward (concentric). Volume overload is like carrying ever-bigger loads: the chamber stretches and enlarges (eccentric). Both help at first and harm later.' },
  { id: 'laplace', title: 'Law of Laplace', match: [/\blaplace\b/i, /\bwall tension\b/i, /\bdilat(?:ed|ation) (?:ventricle|aorta|chamber)\b/i],
    text: 'A bigger balloon is harder to hold closed than a small one at the same pressure: wall tension rises with radius. A dilated ventricle or aorta works against more tension, and a thicker wall shares the load.' },
  { id: 'stenosis', title: 'Valve stenosis', match: [/\bstenosis\b/i, /\bstenotic\b/i, /\bvalve area\b/i, /\bgradient\b/i],
    text: 'A stenotic valve is a doorway that has narrowed to a slit: the chamber behind it must push harder to get the same flow through, pressure builds up behind it, and the jet squirting through is fast — which is what Doppler measures.' },
  { id: 'regurgitation', title: 'Valve regurgitation', match: [/\bregurgita/i, /\binsufficiency\b/i, /\bleaky\b/i, /\bregurgitant\b/i],
    text: 'A regurgitant valve is a door that will not close: some of each beat flows back the wrong way, so the chamber has to pump the same blood twice. The extra volume stretches it — tolerated for years, until it is not.' },
  { id: 'atherosclerosis', title: 'Atherosclerosis', match: [/\batheroscler/i, /\bplaque\b/i, /\batheroma\b/i, /\bLDL\b/],
    text: 'A plaque is rust building up inside a water pipe: it narrows the lumen slowly, and the dangerous moment is not the slow narrowing but a crack in the rust that exposes the inside and sets off a clot.' },
  { id: 'plaque-rupture', title: 'Plaque rupture and thrombosis', match: [/\brupture\b/i, /\bthromb/i, /\berosion\b/i, /\bacute coronary syndrome\b/i, /\bACS\b/],
    text: 'Plaque rupture is a pothole tearing open in the road: platelets are the road crew rushing in to patch it, and in an artery the patch itself can block the whole lane.' },
  { id: 'ischemia', title: 'Ischemia and supply–demand', match: [/\bischemi/i, /\bischaemi/i, /\bangina\b/i, /\boxygen (?:supply|demand)\b/i],
    text: 'Ischemia is a factory whose delivery trucks cannot keep up with production: at rest the narrowed road is enough, but push the factory harder (exercise, fast heart rate) and the shortfall shows.' },
  { id: 'infarction', title: 'Myocardial infarction', match: [/\binfarct/i, /\bSTEMI\b/, /\bNSTEMI\b/, /\bnecrosis\b/i, /\breperfusion\b/i],
    text: 'An infarction is a town cut off from its only water main: the longer the outage, the more houses are lost for good. That is why "time is muscle" — reopening the pipe early saves what is still standing.' },
  { id: 'collaterals', title: 'Collateral circulation', match: [/\bcollateral/i],
    text: 'Collaterals are side streets that open up around a road that has slowly closed. They take time to form, which is why a sudden blockage hurts more than one that crept up over years.' },
  { id: 'heart-failure', title: 'Heart failure', match: [/\bheart failure\b/i, /\bcongest/i, /\bdecompensat/i],
    text: 'Heart failure is a pump that cannot keep up with the traffic: fluid backs up behind it (congestion) and too little gets ahead of it (low output). The body’s alarms — hormones that hold salt and tighten vessels — help briefly and then make the jam worse.' },
  { id: 'raas', title: 'Renin–angiotensin–aldosterone system', match: [/\brenin\b/i, /\bangiotensin\b/i, /\baldosterone\b/i, /\bRAAS\b/, /\bACE inhibitor/i, /\bARB\b/],
    text: 'The RAAS is the body’s emergency water-and-pressure plan: sensing low flow, it tightens vessels and holds on to salt and water. Useful after a bleed; in chronic heart failure it keeps pressing the emergency button, which is why blocking it helps.' },
  { id: 'sympathetic', title: 'Sympathetic activation and beta-blockade', match: [/\bsympathetic\b/i, /\bcatecholamine/i, /\bbeta[- ]?block/i, /\bbeta[- ]?adrenergic\b/i],
    text: 'Chronic sympathetic drive is a car kept in the red zone: it goes faster today and wears out the engine. Beta-blockers ease off the accelerator so the heart can rest and, over months, recover.' },
  { id: 'diuretics', title: 'Diuretics', match: [/\bdiuretic/i, /\bfurosemide\b/i, /\bloop diuretic/i, /\bnatriure/i],
    text: 'Diuretics open the drain in an overflowing bath: they lower the water level (volume and filling pressures) and so relieve the flooding in the lungs, but they do not fix the tap.' },
  { id: 'pulmonary-edema', title: 'Pulmonary edema', match: [/\bpulmonary (?:o)?edema\b/i, /\bpulmonary congestion\b/i, /\bpulmonary venous pressure\b/i],
    text: 'Raise the pressure in a garden soaker hose and water seeps out along its length. When left-sided filling pressure rises, fluid is pushed out of the lung capillaries into the air spaces the same way.' },
  { id: 'tamponade', title: 'Cardiac tamponade', match: [/\btamponade\b/i, /\bpericardial effusion\b/i],
    text: 'Tamponade is trying to fill a water balloon inside a rigid box that is already partly full of water: the heart cannot expand to fill, so output falls even though the muscle itself is fine.' },
  { id: 'constriction', title: 'Constrictive pericarditis', match: [/\bconstrict/i, /\bpericardi(?:tis|um)\b/i],
    text: 'Constriction is a heart wearing a shrunken, stiff jacket: it fills quickly at first and then stops dead when it meets the jacket, and the four chambers share the same cramped space.' },
  { id: 'sa-node', title: 'The sinus node and pacemaking', match: [/\bsinus node\b/i, /\bSA node\b/, /\bpacemaker\b/i, /\bautomaticity\b/i],
    text: 'The sinus node is the drummer setting the band’s tempo. If the drummer stops, a slower backup drummer lower down takes over — the escape rhythm — which is why a failing node often means a slow heart rather than none.' },
  { id: 'av-block', title: 'AV node and heart block', match: [/\bAV (?:node|block)\b/, /\batrioventricular\b/i, /\bheart block\b/i, /\bMobitz\b/i, /\bWenckebach\b/i],
    text: 'The AV node is a toll booth between atria and ventricles: it delays each car a little on purpose. First-degree block is a slow booth; Wenckebach is one that gets slower each time until it waves a car through without opening; complete block is a closed booth, with the ventricles driving on their own.' },
  { id: 'reentry', title: 'Re-entry', match: [/\bre-?entr/i, /\bcircus movement\b/i, /\bflutter\b/i],
    text: 'Re-entry is a runner lapping a track that has one slow lane: the impulse goes around and arrives back where it started just as that tissue is ready again, and keeps circling. Cut the track (ablation) and the loop stops.' },
  { id: 'af', title: 'Atrial fibrillation', match: [/\batrial fibrillation\b/i, /\bAF\b/, /\bAFib\b/i, /\bleft atrial appendage\b/i],
    text: 'In atrial fibrillation the atria stop beating as a team and quiver like a crowd all talking at once. Blood idles in the quiet corners — especially the appendage — which is where clots form, and why stroke prevention matters as much as rate.' },
  { id: 'vf', title: 'Ventricular fibrillation', match: [/\bventricular fibrillation\b/i, /\bVF\b/, /\bdefibrillat/i, /\bsudden cardiac death\b/i],
    text: 'Ventricular fibrillation is an orchestra where every player plays their own tune: plenty of electrical activity, no music, no output. A defibrillator stops everyone at once so the conductor can start again.' },
  { id: 'qt', title: 'QT prolongation', match: [/\bQT\b/, /\bQTc\b/, /\btorsade/i, /\brepolari[sz]ation\b/i],
    text: 'A long QT is a runner who takes too long to get back to the start line between races: if the next starter’s pistol fires while some are still walking back, the race breaks into chaos — torsades.' },
  { id: 'bbb', title: 'Bundle branch block', match: [/\bbundle branch\b/i, /\bLBBB\b/, /\bRBBB\b/, /\bdyssynchron/i],
    text: 'A bundle branch block is one motorway lane closed: the signal still reaches that ventricle by side roads, but late, so the two sides no longer squeeze together. That delay is what resynchronisation pacing tries to undo.' },
  { id: 'hypertension', title: 'Hypertension', match: [/\bhypertension\b/i, /\bblood pressure\b/i, /\bhypertensive\b/i],
    text: 'Hypertension is running a garden hose at high pressure all the time: nothing looks wrong for years, but the hose walls thicken and stiffen, the connections weaken, and the pump at the end works harder with every beat.' },
  { id: 'baroreflex', title: 'Baroreceptor reflex', match: [/\bbaroreceptor/i, /\bbaroreflex\b/i, /\borthostatic\b/i],
    text: 'Baroreceptors are the thermostat for blood pressure: sense a fall and they turn up the heart rate and tighten the vessels within seconds. Stand up too fast with a sluggish thermostat and you feel faint.' },
  { id: 'anticoagulation', title: 'Antiplatelets and anticoagulants', match: [/\banticoagul/i, /\bantiplatelet\b/i, /\baspirin\b/i, /\bwarfarin\b/i, /\bheparin\b/i, /\bclopidogrel\b/i],
    text: 'Platelets are the quick sandbags and the clotting cascade is the concrete poured behind them. Antiplatelets slow the sandbags (arterial, fast-flow clots); anticoagulants slow the concrete (slow-flow clots in veins and fibrillating atria).' },
  { id: 'statins', title: 'Lipid lowering', match: [/\bstatin/i, /\bcholesterol\b/i, /\blipid/i, /\bPCSK9\b/],
    text: 'Lowering LDL is turning down the tap that keeps refilling the rust in the pipes: existing plaques become quieter and less likely to crack, even before they visibly shrink.' },
  { id: 'endocarditis', title: 'Infective endocarditis', match: [/\bendocarditis\b/i, /\bvegetation/i, /\bbacteremi/i],
    text: 'A vegetation is a barnacle colony on a valve: bacteria settle where the flow is turbulent, build a clump that antibiotics struggle to penetrate, and pieces can break off and travel downstream.' },
  { id: 'dcm', title: 'Dilated cardiomyopathy', match: [/\bdilated cardiomyopathy\b/i, /\bDCM\b/],
    text: 'Dilated cardiomyopathy is an overstretched, weakened balloon: it holds more but squeezes less, and the bigger it gets the harder each squeeze becomes.' },
  { id: 'hcm', title: 'Hypertrophic cardiomyopathy', match: [/\bhypertrophic cardiomyopathy\b/i, /\bHCM\b/, /\boutflow (?:tract )?obstruction\b/i, /\bSAM\b/],
    text: 'In obstructive hypertrophic cardiomyopathy the thick septum is a doorway partly blocked by furniture, and a mitral leaflet gets sucked into the gap as blood rushes past. Anything that empties the ventricle more — dehydration, vasodilators — makes the doorway narrower.' },
  { id: 'rcm', title: 'Restrictive cardiomyopathy', match: [/\brestrictive cardiomyopathy\b/i, /\bamyloid/i, /\binfiltrat/i],
    text: 'A restrictive ventricle is a room whose walls have been filled with cement: normal size, normal squeeze for a while, but it will not stretch to take in blood, so the pressure behind it climbs.' },
  { id: 'dissection', title: 'Aortic dissection', match: [/\bdissection\b/i, /\bintimal (?:tear|flap)\b/i],
    text: 'A dissection is blood forcing its way between the layers of a wall, like water getting under wallpaper and peeling it off in a sheet. The new false channel can pinch off the branches it passes.' },
  { id: 'aneurysm', title: 'Aneurysm', match: [/\baneurysm/i],
    text: 'An aneurysm is a weak spot bulging on a tyre: the bigger the bulge, the more tension on its wall, so it tends to grow — and the risk of bursting rises with its size.' },
  { id: 'shunt', title: 'Shunts', match: [/\bshunt/i, /\bASD\b/, /\bVSD\b/, /\bPDA\b/, /\bseptal defect\b/i],
    text: 'A shunt is a hole in the wall between two rooms at different pressures: blood flows from the high-pressure room to the low one, and the rooms and vessels that carry the extra flow enlarge.' },
  { id: 'eisenmenger', title: 'Eisenmenger physiology', match: [/\beisenmenger\b/i, /\bshunt reversal\b/i],
    text: 'Years of extra flow into the lungs make the lung vessels thicken like a road narrowing under constant heavy traffic, until lung pressure exceeds body pressure and the flow through the hole reverses — sending blue blood to the body.' },
  { id: 'pulmonary-hypertension', title: 'Pulmonary hypertension', match: [/\bpulmonary (?:arterial )?hypertension\b/i, /\bpulmonary vascular resistance\b/i, /\bright ventricular (?:failure|pressure)\b/i],
    text: 'The right ventricle is built for a gentle slope; pulmonary hypertension turns it into a mountain. A thin-walled pump facing a steep climb dilates and fails, which is what finally limits these patients.' },
  { id: 'shock', title: 'Shock', match: [/\bshock\b/i, /\bhypoperfusion\b/i],
    text: 'Shock is a city whose water pressure has collapsed: the cause may be a failing pump (cardiogenic), too little water (hypovolemic) or pipes that have gone slack (distributive), and each needs a different fix.' },
  { id: 'murmur', title: 'Murmurs', match: [/\bmurmur/i, /\bauscultat/i, /\bheart sound/i],
    text: 'A murmur is the hiss of water through a narrowed or leaky tap: turbulence you can hear. When in the cycle it happens, and where it is loudest, tell you which tap and which fault.' },
  { id: 'doppler', title: 'Doppler echocardiography', match: [/\bdoppler\b/i, /\bechocardiogra/i, /\bvelocit/i, /\bbernoulli\b/i],
    text: 'Doppler is the pitch of a passing siren: blood moving toward the probe raises the pitch, away lowers it. The faster the jet through a narrow valve, the bigger the pressure drop behind it — the simplified Bernoulli equation turns speed into gradient.' },
  { id: 'syncope', title: 'Syncope', match: [/\bsyncope\b/i, /\bfaint/i, /\bvasovagal\b/i],
    text: 'Syncope is the brain’s power briefly cut: whether from a pump that stopped (arrhythmia), a pipe that is blocked (outflow obstruction) or pressure that sagged (reflex), the lights go out and come back on by themselves.' },
];

function score(entry, text, title) {
  var s = 0;
  entry.match.forEach(function (re) {
    var g = new RegExp(re.source, re.flags.indexOf('g') === -1 ? re.flags + 'g' : re.flags);
    s += (String(text || '').match(g) || []).length;
    if (re.test(String(title || ''))) s += 3;
  });
  return s;
}

/* The best `n` analogies for a section, strongest first, or none. */
function forSection(cluster, n) {
  var title = cluster && cluster.title, text = cluster && cluster.text;
  return BANK.map(function (e, i) { return { e: e, s: score(e, text, title), i: i }; })
    .filter(function (x) { return x.s >= MIN_SCORE; })
    .sort(function (a, b) { return b.s - a.s || a.i - b.i; })
    .slice(0, n == null ? 2 : n)
    .map(function (x) { return { title: x.e.title, text: x.e.text, source: 'Memorizer' }; });
}

var MemAnalogies = { BANK: BANK, MIN_SCORE: MIN_SCORE, score: score, forSection: forSection };
root.MemAnalogies = MemAnalogies;
if (typeof module !== 'undefined' && module.exports) module.exports = MemAnalogies;
})(typeof window !== 'undefined' ? window : this);
