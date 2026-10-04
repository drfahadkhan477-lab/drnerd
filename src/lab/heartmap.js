/* ═════════════════════════════════════════════
   heartmap.js — where in the heart it is, and where on the chest you hear it.

   A flat schematic of the four chambers, the four valves and the great vessels
   (patient's right on the viewer's left, as on a chest film), and for each Lab
   condition: which valve is the problem and what kind, which chambers it loads,
   where blood goes that should not, and which patch of chest to listen at.

   The geometry is data so a test can hold it: no two chambers overlap, and each
   valve sits on the edge the two chambers it separates share. The pictures
   themselves are the screen's job.

   What is derived rather than written down: WHEN a lesion is heard. phaseOf()
   reads it off the murmur the heart-sound synthesiser plays, against the valve
   events physio draws, so the map cannot say "diastolic" about a murmur the
   trainer plays in systole. A test then holds that to the textbook rule for the
   valve it names (stenosis of a semilunar valve and regurgitation of an AV valve
   are systolic; the other two are diastolic).

   Depends on physio.js and heartsounds.js.
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

const Physio = root.Physio || (typeof require === 'function' ? require('../core/physio.js').Physio : null);
const HS = root.HeartSounds || (typeof require === 'function' ? require('./heartsounds.js').HeartSounds : null);

/* viewBox 0 0 400 390. Patient's right is the viewer's left. */
const VIEWBOX = { w: 400, h: 390 };
const CHAMBERS = {
  SVC: { x: 60,  y: 10,  w: 34,  h: 120, name: 'Superior vena cava', side: 'right' },
  RA:  { x: 20,  y: 130, w: 130, h: 115, name: 'Right atrium', side: 'right' },
  RV:  { x: 20,  y: 247, w: 170, h: 130, name: 'Right ventricle', side: 'right' },
  PA:  { x: 150, y: 10,  w: 40,  h: 237, name: 'Pulmonary artery', side: 'right' },
  Ao:  { x: 210, y: 10,  w: 40,  h: 237, name: 'Aorta', side: 'left' },
  PV:  { x: 306, y: 10,  w: 34,  h: 120, name: 'Pulmonary veins', side: 'left' },
  LA:  { x: 250, y: 130, w: 130, h: 115, name: 'Left atrium', side: 'left' },
  LV:  { x: 210, y: 247, w: 170, h: 130, name: 'Left ventricle', side: 'left' },
};
/* a valve is a gate on the line two chambers share: x, y is its middle */
const VALVES = {
  tricuspid: { between: ['RA', 'RV'], x: 85,  y: 246, name: 'Tricuspid valve' },
  pulmonic:  { between: ['RV', 'PA'], x: 170, y: 247, name: 'Pulmonic valve' },
  aortic:    { between: ['LV', 'Ao'], x: 230, y: 247, name: 'Aortic valve' },
  mitral:    { between: ['LA', 'LV'], x: 315, y: 246, name: 'Mitral valve' },
};
/* The normal route of blood, drawn faintly under whatever is wrong. */
const NORMAL_FLOW = [['SVC', 'RA'], ['RA', 'RV'], ['RV', 'PA'], ['PV', 'LA'], ['LA', 'LV'], ['LV', 'Ao']];

/* The places to listen, on a chest drawn 200 wide (patient's right on the viewer's left). */
const AREAS = {
  aortic:         { x: 78,  y: 70,  name: 'Aortic area', where: 'Right 2nd intercostal space, at the sternal edge' },
  pulmonic:       { x: 122, y: 70,  name: 'Pulmonic area', where: 'Left 2nd intercostal space, at the sternal edge' },
  erb:            { x: 122, y: 100, name: 'Erb\'s point', where: 'Left 3rd to 4th intercostal space, at the sternal edge' },
  tricuspid:      { x: 112, y: 140, name: 'Tricuspid area', where: 'Left lower sternal border (4th to 5th intercostal space)' },
  mitral:         { x: 150, y: 160, name: 'Mitral area (apex)', where: '5th intercostal space, mid-clavicular line' },
  infraclavicular:{ x: 150, y: 40,  name: 'Left infraclavicular area', where: 'Below the left clavicle' },
};

/* Per condition. valve + state say what is wrong with it ('stenosis', 'regurgitation' or
   'prolapse'); enlarged and hypertrophied are chambers; flows are the abnormal routes of
   blood: a 'jet' crosses or leaks through a valve, a 'shunt' crosses a wall or a duct.
   These are the author's reading of the textbook, not the synthesiser's. */
const CONDITIONS = {
  normal: { valve: null, state: null, enlarged: [], hypertrophied: [], flows: [], area: 'aortic', radiates: '',
    note: 'Four valves that open fully and close without leaking; two sounds, silence between.' },
  as: { valve: 'aortic', state: 'stenosis', enlarged: [], hypertrophied: ['LV'], flows: [{ from: 'LV', to: 'Ao', kind: 'jet' }], area: 'aortic', radiates: 'to the carotids',
    note: 'The valve opens to a slit, so the left ventricle pumps against a fixed obstruction and thickens.' },
  mr: { valve: 'mitral', state: 'regurgitation', enlarged: ['LA', 'LV'], hypertrophied: [], flows: [{ from: 'LV', to: 'LA', kind: 'jet' }], area: 'mitral', radiates: 'to the axilla',
    note: 'The valve leaks backwards into the left atrium throughout systole; both chambers take the extra volume.' },
  ms: { valve: 'mitral', state: 'stenosis', enlarged: ['LA'], hypertrophied: [], flows: [{ from: 'LA', to: 'LV', kind: 'jet' }], area: 'mitral', radiates: 'nowhere: it stays at the apex',
    note: 'The valve opens to a narrow opening, so the left atrium works against it and enlarges; the left ventricle is not loaded.' },
  ar: { valve: 'aortic', state: 'regurgitation', enlarged: ['LV'], hypertrophied: [], flows: [{ from: 'Ao', to: 'LV', kind: 'jet' }], area: 'erb', radiates: 'down the left sternal border',
    note: 'The valve leaks backwards into the left ventricle in diastole; the ventricle dilates to take the extra volume.' },
  s3: { valve: null, state: null, enlarged: ['LV'], hypertrophied: [], flows: [], area: 'mitral', radiates: '',
    note: 'A ventricle that is volume-loaded or failing fills against a high pressure in early diastole.' },
  s4: { valve: null, state: null, enlarged: [], hypertrophied: ['LV'], flows: [], area: 'mitral', radiates: '',
    note: 'The atrium contracts hard against a stiff, thickened ventricle just before S1.' },
  mvp: { valve: 'mitral', state: 'prolapse', enlarged: [], hypertrophied: [], flows: [{ from: 'LV', to: 'LA', kind: 'jet' }], area: 'mitral', radiates: 'to the axilla when there is regurgitation',
    note: 'A leaflet balloons back into the left atrium late in systole, and may leak.' },
  hocm: { valve: null, state: null, enlarged: [], hypertrophied: ['LV'], flows: [{ from: 'LV', to: 'Ao', kind: 'jet' }], area: 'tricuspid', radiates: 'little: not to the carotids',
    note: 'A thickened septum narrows the outflow tract below the valve, more so when the ventricle is emptier.' },
  vsd: { valve: null, state: null, enlarged: [], hypertrophied: [], flows: [{ from: 'LV', to: 'RV', kind: 'shunt' }], area: 'tricuspid', radiates: 'across the precordium',
    note: 'Blood crosses the septum from the high-pressure left ventricle to the right ventricle all through systole. A large shunt loads the left heart.' },
  pda: { valve: null, state: null, enlarged: [], hypertrophied: [], flows: [{ from: 'Ao', to: 'PA', kind: 'shunt' }], area: 'infraclavicular', radiates: 'to the back',
    note: 'The duct joins the aorta to the pulmonary artery, so blood crosses all through the cycle. A large shunt loads the left heart.' },
  wide: { valve: null, state: null, enlarged: ['RA', 'RV'], hypertrophied: [], flows: [{ from: 'LA', to: 'RA', kind: 'shunt' }], area: 'pulmonic', radiates: '',
    note: 'The atria communicate, so breathing cannot change the split; the right heart carries the extra flow.' },
};

/* Tracings are pressures measured in one place. The wedge pressure is the left atrium's. */
const TRACING_MAP = {
  'ra-normal':       { site: 'RA' },
  'ra-tr':           { site: 'RA', valve: 'tricuspid', state: 'regurgitation' },
  'ra-ts':           { site: 'RA', valve: 'tricuspid', state: 'stenosis' },
  'ra-af':           { site: 'RA' },
  'ra-cannon':       { site: 'RA', valve: 'tricuspid', state: null },
  'ra-constriction': { site: 'RA', pericardium: true },
  'ra-tamponade':    { site: 'RA', pericardium: true },
  'ra-restrictive':  { site: 'RA' },
  'ra-pulmhtn':      { site: 'RA', hypertrophied: ['RV'] },
  'pcwp-normal':     { site: 'LA' },
  'pcwp-mr':         { site: 'LA', valve: 'mitral', state: 'regurgitation' },
  'pcwp-ms':         { site: 'LA', valve: 'mitral', state: 'stenosis' },
};

/* The chamber a valve's problem loads first: the one behind it. */
const PROXIMAL = { mitral: 'LA', aortic: 'LV', tricuspid: 'RA', pulmonic: 'RV' };
/* The textbook rule for when each kind of valve lesion is heard. */
const EXPECTED_PHASE = {
  stenosis:      { aortic: 'systolic', pulmonic: 'systolic', mitral: 'diastolic', tricuspid: 'diastolic' },
  regurgitation: { aortic: 'diastolic', pulmonic: 'diastolic', mitral: 'systolic', tricuspid: 'systolic' },
};

/* phaseOf(lesionId) → 'systolic' | 'diastolic' | 'continuous' | 'none', from the murmur the trainer plays. */
function phaseOf(lesionId) {
  const murmurs = HS.lesionById(lesionId).murmurs;
  if (!murmurs.length) return 'none';
  if (murmurs.some(m => m.shape === 'cont')) return 'continuous';
  const mc = Physio.EVENTS.find(e => e.id === 'mc').at, ac = Physio.EVENTS.find(e => e.id === 'ac').at;
  const phases = new Set(murmurs.map(m => {
    const f0 = HS.frac(m.from);
    let f1 = HS.frac(m.to); if (f1 <= f0) f1 += 1;
    const mid = (((f0 + f1) / 2) % 1 + 1) % 1;
    return mid >= mc && mid <= ac ? 'systolic' : 'diastolic';
  }));
  return phases.size === 1 ? [...phases][0] : 'both';
}

/* forLesion(id) → the condition with its derived timing and the place to listen. */
function forLesion(id) {
  const c = CONDITIONS[id];
  if (!c) throw new Error('heartmap: no condition "' + id + '"');
  return Object.assign({ id, phase: phaseOf(id), listen: AREAS[c.area] }, c);
}

/* centre of a chamber, for the arrows */
function centre(id) { const c = CHAMBERS[id]; return { x: c.x + c.w / 2, y: c.y + c.h / 2 }; }

root.HeartMap = { VIEWBOX, CHAMBERS, VALVES, NORMAL_FLOW, AREAS, CONDITIONS, TRACING_MAP, PROXIMAL, EXPECTED_PHASE, phaseOf, forLesion, centre };

})(typeof window !== 'undefined' ? window : this);
