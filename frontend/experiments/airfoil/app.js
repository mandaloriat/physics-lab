/**
 * Airfoil design — the first exercise.
 *
 * The page's job is to set a problem, keep the visitor's inputs honest about what kind of
 * thing each one is, and present the answer with its verification. The physics is
 * `lab.airfoil_panel2d` and is untouched by the redesign; the workspace is
 * `shared/workspace.js`; the exercise-shaped parts — challenge, KPIs, metrics, verification,
 * validity — are `shared/exercise.js`.
 *
 * What is left here is this exercise: the profile catalogue, the atmosphere, which parameter
 * is physical and which is numerical, what each number should be called in front of a person,
 * and what is worth drawing on top of the field.
 *
 * Specification: docs/exercises/airfoil.md. Contract: docs/exercise-contract.md.
 * Arrangement: ADR-017.
 */

import '@fenix-spoon/geometry-2d';
import '@fenix-spoon/viewer';

import { groups, isa } from '/shared/atmosphere.js';
import { client, solversFor } from '/shared/api.js';
import { describeError, el, health, mountChrome, revealPanel } from '/shared/components.js';
import { drawCurve } from '/shared/curve.js';
import {
  groupParameters,
  renderChallenge,
  renderKpis,
  renderMetrics,
  renderValidity,
  renderVerification,
} from '/shared/exercise.js';
import {
  applyFieldView,
  applyMaintenance,
  buildParamForm,
  buildShapeControls,
  renderLesson,
  runSolve,
  setStatusOn,
  showArtifacts,
  showStats,
  syncFieldOptions,
} from '/shared/experiment.js';
import { createWorkspace, marker, polyline, svgNode } from '/shared/workspace.js';
import * as runs from '/shared/runs.js';

const EXERCISE = 'airfoil';
const GEOMETRY_TYPE = 'domain2d';
/** The physics this page is about, matched against what each capability declares. */
const PHYSICS = 'potential-flow';
/** This exercise's model is ideal flow *with* a Kutta condition, so only a solver that has
 *  one can implement it. The no-circulation model is reachable, but as a model selector
 *  rather than as a different solver — see docs/exercises/airfoil.md §14. */
const SOLVER_PREFIX = 'lab.airfoil';

const dom = Object.fromEntries(
  [
    'lesson',
    'editor',
    'viewer',
    'workspace',
    'status',
    'dot',
    'progress',
    'run',
    'cancel',
    'keep',
    'compareJump',
    'reset',
    'editShape',
    'solver',
    'solverHint',
    'field',
    'fieldHint',
    'stats',
    'artifacts',
    'maintenance',
    'challenge',
    'kpis',
    'metrics',
    'verification',
    'validity',
    'physical',
    'numerical',
    'study',
    'advanced',
    'profile',
    'shapeControls',
    'shapeNote',
    'geometryReadback',
    'atmosphere',
    'derived',
    'derivedWrap',
    'derivedToggle',
    'results',
    'cpCurve',
    'sweepPanel',
    'sweepCurve',
    'sweepMetrics',
    'runsTable',
    'runsPanel',
    'compare',
    'exportCsv',
    'exportJson',
    'clearRuns',
    'runsNote',
  ].map((key) => [
    key,
    document.getElementById(key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)),
  ]),
);

/* ------------------------------------------------------------------------- the catalogue */

/** Real profiles, with all three four-digit parameters. The reference columns are thin-airfoil
 *  theory's, and the solver recomputes them from whatever outline it is actually given. */
const CATALOGUE = [
  { label: 'NACA 0009', m: 0, p: 0.4, t: 0.09, note: 'symmetric, thin' },
  { label: 'NACA 0012', m: 0, p: 0.4, t: 0.12, note: 'symmetric — the reference section' },
  { label: 'NACA 1408', m: 0.01, p: 0.4, t: 0.08, note: 'barely cambered, thin' },
  { label: 'NACA 1412', m: 0.01, p: 0.4, t: 0.12, note: 'barely cambered' },
  { label: 'NACA 2312', m: 0.02, p: 0.3, t: 0.12, note: 'camber well forward' },
  { label: 'NACA 2412', m: 0.02, p: 0.4, t: 0.12, note: 'the classic light-aircraft section' },
  { label: 'NACA 2415', m: 0.02, p: 0.4, t: 0.15, note: 'the same mean line, thicker' },
  { label: 'NACA 2512', m: 0.02, p: 0.5, t: 0.12, note: 'camber well aft' },
  { label: 'NACA 4412', m: 0.04, p: 0.4, t: 0.12, note: 'strongly cambered' },
  { label: 'NACA 4415', m: 0.04, p: 0.4, t: 0.15, note: 'strongly cambered, thick' },
];

const DEFAULT_PROFILE = 'NACA 2412';

/** Control points per surface. Six is what a Catmull-Rom through a cosine-spaced outline needs
 *  to stay faithful while staying draggable; `samples` on the editor then decides how many
 *  polygon vertices the solver receives from it. */
const POINTS_PER_SURFACE = 6;

/** Closed trailing edge: the published −0.1015 leaves a finite base, and the Kutta condition is
 *  applied *at* the trailing edge. Matches `physics_lab/solvers/airfoil_geometry.py`. */
const TE_CLOSED = 0.1036;

const shape = { m: 0.02, p: 0.4, t: 0.12 };
const geometry = { source: 'catalogue', label: DEFAULT_PROFILE };
const physical = {
  chord: 1.0,
  altitude: 0,
  atmosphere: 'isa',
  rho: 1.225,
  mu: 1.789e-5,
  a: 340.29,
};

let applyingShape = false;

function halfThickness(x, t) {
  return (
    5 *
    t *
    (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - TE_CLOSED * x ** 4)
  );
}

function meanLine(x, m, p) {
  if (m === 0) return { y: 0, slope: 0 };
  if (x < p) {
    return { y: (m / p ** 2) * (2 * p * x - x ** 2), slope: ((2 * m) / p ** 2) * (p - x) };
  }
  return {
    y: (m / (1 - p) ** 2) * (1 - 2 * p + 2 * p * x - x ** 2),
    slope: ((2 * m) / (1 - p) ** 2) * (p - x),
  };
}

/**
 * Control points for a four-digit profile, ordered around the outline on a unit chord.
 *
 * No rotation: incidence is the free stream's direction, not the profile's (§5.1). The trailing
 * edge is a single point, because two coincident points are a zero-length panel and a
 * `duplicate consecutive points` rejection from the protocol's validator.
 */
function controlPoints({ m, p, t }) {
  const stations = [];
  for (let i = 1; i <= POINTS_PER_SURFACE; i += 1) {
    stations.push(0.5 * (1 - Math.cos((Math.PI * i) / POINTS_PER_SURFACE)));
  }
  const surface = (x, sign) => {
    const { y, slope } = meanLine(x, m, p);
    const theta = Math.atan(slope);
    const yt = halfThickness(x, t);
    return [x - sign * yt * Math.sin(theta), y + sign * yt * Math.cos(theta)];
  };

  const points = [[1, 0]]; // trailing edge, once
  for (let i = stations.length - 2; i >= 0; i -= 1) points.push(surface(stations[i], -1)); // lower
  points.push([0, 0]); // leading edge
  for (let i = 0; i < stations.length - 1; i += 1) points.push(surface(stations[i], +1)); // upper
  return points;
}

function applyShape() {
  applyingShape = true;
  try {
    dom.editor.controlPoints = controlPoints(shape);
  } finally {
    applyingShape = false;
  }
  geometry.source = geometry.source === 'catalogue' ? 'catalogue' : 'parametric';
  describeGeometry();
  workspace?.draw();
}

function describeGeometry(report) {
  dom.shapeNote.textContent =
    geometry.source === 'custom'
      ? 'Edited by hand, so the profile menu no longer describes this shape.'
      : `${geometry.label} — camber ${(100 * shape.m).toFixed(1)} %, at ${(100 * shape.p).toFixed(0)} % of chord, thickness ${(100 * shape.t).toFixed(1)} %.`;

  dom.geometryReadback.textContent = report
    ? // What the solver read back out of the outline it was actually given. Shown because the
      // spline through the control points is the geometry of record, and any difference from
      // the nominal profile should be visible rather than assumed away (§4.4).
      `The solver read: chord ${report.geometry.chord_m.toFixed(3)} m, thickness ${(100 * report.geometry.thickness_over_c).toFixed(1)} %, camber ${(100 * report.geometry.camber_over_c).toFixed(2)} %, ${report.geometry.panels} panels from ${report.geometry.vertices} outline vertices.`
    : '';
}

/* ------------------------------------------------------------------------- physical inputs */

const SHAPE_CONTROLS = [
  {
    key: 'm',
    label: 'Camber',
    min: 0,
    max: 0.06,
    step: 0.002,
    unit: '',
    hint: '',
    title: 'Maximum camber, as a fraction of chord. At 0 the profile is symmetric.',
    format: (v) => `${(100 * v).toFixed(1)} %`,
  },
  {
    key: 'p',
    label: 'Camber position',
    min: 0.2,
    max: 0.6,
    step: 0.05,
    unit: '',
    hint: '',
    title: 'Where the maximum camber sits along the chord — the third four-digit parameter.',
    format: (v) => `${(100 * v).toFixed(0)} % chord`,
  },
  {
    key: 't',
    label: 'Thickness',
    min: 0.06,
    max: 0.2,
    step: 0.005,
    unit: '',
    hint: '',
    title: 'Maximum thickness, as a fraction of chord.',
    format: (v) => `${(100 * v).toFixed(1)} %`,
  },
];

/**
 * Parameters this page offers from the solver's schema, and which group each belongs to.
 *
 * Every one is classified: an unclassified parameter would land in whichever panel came last,
 * which is how a mesh size ends up looking like a fact about the air. The long explanations
 * that used to sit under every control are now `title` — a tooltip and an accessible
 * description — because a sentence under each slider turned the panel into an essay that
 * nobody read and that pushed Run off the screen. Nothing is deleted: the full reasoning is
 * in *Understand the model*.
 */
const PARAM_UI = [
  {
    name: 'alpha_deg',
    group: 'physical',
    label: 'Angle of attack',
    hint: '',
    title:
      'Direction of the free stream relative to the chord line. The stream tilts; the profile does not.',
    step: 0.1,
  },
  {
    name: 'u_inf',
    group: 'physical',
    label: 'Free-stream speed',
    hint: '',
    title: 'Undisturbed speed far upstream, in m/s.',
    step: 1,
  },
  {
    name: 'kutta',
    group: 'physical',
    label: 'Kutta condition',
    hint: '',
    title:
      'A model choice. Turn it off and the circulation, and therefore the lift, is zero at every incidence — which is what this page computed before it had one.',
    optionLabels: { enforced: 'enforced (lifting model)', none: 'none (no circulation)' },
  },
  {
    name: 'panels',
    group: 'numerical',
    label: 'Panels',
    hint: 'Its only legitimate effect is on the verification residuals.',
  },
  {
    name: 'trailing_edge',
    group: 'numerical',
    label: 'Trailing edge',
    hint: 'An open base makes the Kutta condition depend on how it is closed.',
    optionLabels: { closed: 'closed', as_drawn: 'as drawn' },
  },
  {
    name: 'resolution',
    group: 'numerical',
    label: 'Field resolution',
    hint: 'Affects the picture and no reported number.',
  },
  {
    name: 'convergence_check',
    group: 'numerical',
    label: 'Check convergence',
    hint: 'Also solve at twice the panels, and report how far the lift moved.',
  },
  {
    name: 'sweep_from_deg',
    group: 'study',
    label: 'Sweep from',
    hint: 'Leave empty for a single incidence.',
    step: 1,
  },
  { name: 'sweep_to_deg', group: 'study', label: 'Sweep to', hint: 'End of the sweep.', step: 1 },
  {
    name: 'sweep_step_deg',
    group: 'study',
    label: 'Sweep step',
    hint: 'Every extra angle costs one back-substitution, not one solve.',
    step: 0.5,
  },
];

/**
 * How each reported quantity is named in front of a person.
 *
 * One table, read by three things — the mission's targets, the headline tiles and the full
 * table — so `l_prime` and `c_m_c4` cannot leak onto the screen from one of them while the
 * other two are polite. The keys are the report's; nothing else on the page knows them.
 */
const METRICS = [
  {
    key: 'c_l',
    label: 'Lift coefficient',
    symbol: 'C_L',
    unit: '1',
    digits: 4,
    hint: 'From the circulation, via Kutta–Joukowski.',
  },
  {
    key: 'l_prime',
    label: 'Lift per metre of span',
    symbol: 'L′',
    unit: 'N/m',
    digits: 1,
    hint: 'The dimensional answer the target is set in.',
  },
  {
    key: 'c_m_c4',
    label: 'Pitching moment',
    symbol: 'C_m,c/4',
    unit: '1',
    digits: 4,
    hint: 'About the quarter chord, nose-up positive.',
  },
  {
    key: 'x_cp_over_c',
    label: 'Centre of pressure',
    symbol: 'x_cp/c',
    unit: '1',
    digits: 4,
    hint: 'Not applicable when the normal force is too small to place it.',
  },
  {
    key: 'cp_min',
    label: 'Suction peak',
    symbol: 'C_p,min',
    unit: '1',
    digits: 3,
    hint: 'How hard this shape pulls. A real boundary layer may not survive a deep one.',
  },
  { key: 'cp_min_station', label: 'Peak position', symbol: 'x/c', unit: '1', digits: 3 },
  { key: 'circulation', label: 'Circulation', symbol: 'Γ', unit: 'm²/s', digits: 4 },
  {
    key: 'alpha_deg',
    label: 'Incidence, as read',
    symbol: 'α',
    unit: '°',
    digits: 3,
    hint: 'Derived from the outline’s own chord line, which is why it can differ slightly from the value requested.',
  },
];

/** The `key -> wording` table the challenge reads, built from the same list. */
const METRIC_LABELS = Object.fromEntries(METRICS.map((metric) => [metric.key, metric]));

/** The few numbers that answer the mission, shown before any table. */
const KPIS = [
  { key: 'c_l', label: 'Lift coefficient', symbol: 'C_L', unit: '1', digits: 3 },
  { key: 'l_prime', label: 'Lift per metre', symbol: 'L′', unit: 'N/m', digits: 0 },
  { key: 'c_m_c4', label: 'Pitching moment', symbol: 'C_m,c/4', unit: '1', digits: 4 },
  {
    key: 'x_cp_over_c',
    label: 'Centre of pressure',
    symbol: 'x_cp/c',
    unit: '1',
    digits: 3,
    absent: 'not defined here',
  },
  { key: 'cp_min', label: 'Suction peak', symbol: 'C_p,min', unit: '1', digits: 2 },
  {
    key: 'x_ac_over_c',
    label: 'Aerodynamic centre',
    symbol: 'x_ac/c',
    unit: '1',
    digits: 3,
    from: (report) => report.sweep?.x_ac_over_c,
    absent: 'needs a sweep',
    hint: 'A property of several incidences, so one solve cannot produce it.',
  },
];

const CHECKS = [
  {
    key: 'cl_consistency_rel',
    label: 'Lift two ways',
    tolerance: 'cl_consistency_tolerance',
    describe: 'Circulation against integrated pressure.',
  },
  {
    key: 'cd_pressure_spurious',
    label: "d'Alembert residual",
    tolerance: 'cd_pressure_tolerance',
    describe: 'The chordwise force, which must vanish. An error bar, not a drag.',
  },
  {
    key: 'cl_convergence_rel',
    label: 'Panel convergence',
    tolerance: 'cl_convergence_tolerance',
    describe: 'Change in the lift coefficient when the panel count is doubled.',
  },
];

const FIELD_VIEW = {
  Cp: {
    option: 'Pressure coefficient, C_p',
    caption: 'Cp',
    colormap: 'coolwarm',
    contours: 12,
    symmetric: true,
    hint: 'Blue is suction, red compression, and C_p = 1 marks the stagnation point. With the Kutta condition imposed the suction over the upper surface no longer cancels — that is the lift. The thin white curves are contours of C_p, not streamlines: switch Streamlines on to see the flow itself, integrated from the velocity field.',
  },
  speed: {
    option: 'Speed',
    caption: 'm/s',
    colormap: 'viridis',
    contours: 10,
    hint: 'Velocity magnitude. Bright is fast.',
  },
};

/* --------------------------------------------------------------------------- the solve */

/**
 * The three parameter groups, each a *live* object that its own controls mutate in place.
 *
 * Kept as three rather than merged into one, because `buildParamForm` returns the object its
 * controls write to: copying it — `params = {...form}` — produces something that looks right and
 * then never changes again, which is a bug you only see by moving a slider.
 */
const forms = { physical: {}, numerical: {}, study: {} };
let catalogue = { all: [], byMode: {} };
let report = null;
let running = false;
let currentJob = null;
let selected = new Set();
let workspace = null;

/** Every parameter, as the solver will receive it. */
function currentParams() {
  return { ...forms.physical, ...forms.numerical, ...forms.study };
}

function solver() {
  return catalogue.all.find((entry) => entry.name.startsWith(SOLVER_PREFIX)) ?? null;
}

/** The geometry payload: the editor's outline and bounds, scaled to the chord in metres. */
function payload() {
  const value = dom.editor.value;
  const c = physical.chord;
  return {
    type: 'domain2d',
    bounds: value.bounds.map((b) => b * c),
    obstacle: {
      type: 'polygon2d',
      points: value.obstacle.points.map(([x, y]) => [x * c, y * c]),
    },
  };
}

function air() {
  if (physical.atmosphere === 'isa') {
    const state = isa(physical.altitude);
    return { rho: state.density, mu: state.viscosity, a: state.soundSpeed, state };
  }
  return { rho: physical.rho, mu: physical.mu, a: physical.a, state: null };
}

async function run() {
  if (running) return;
  const chosen = solver();
  if (!chosen) {
    setStatusOn(dom, 'This server has no solver that can impose a Kutta condition.', 'error');
    return;
  }

  running = true;
  dom.artifacts.replaceChildren();
  const { rho, mu, a } = air();

  try {
    const result = await runSolve({
      dom,
      solver: chosen.name,
      geometry: payload(),
      params: { ...currentParams(), rho, mu, sound_speed: a },
      onJob: (job) => {
        currentJob = job;
      },
    });
    if (!result) return;

    report = await fetchReport(result);
    // Explore comes after Run: the result section only exists once there is a result, which
    // is what removes the row of "Nothing computed yet" panels the page used to open with.
    dom.results.hidden = false;
    workspace.setResult(result);
    syncFieldOptions(dom.viewer, dom.field, FIELD_VIEW, dom.fieldHint);
    showStats(dom.stats, result);
    showArtifacts(dom.artifacts, result.artifacts);
    present();
    setStatusOn(dom, 'Done.', 'done');
  } finally {
    running = false;
    currentJob = null;
    dom.keep.disabled = report === null;
  }
}

/**
 * The engineering answer travels as a declared artifact, not in the result envelope.
 *
 * Protocol 1.2 has nowhere to put a computed metric, a warning or a curve — `stats` is
 * `dict[str, float]` and means what the solve cost. Upstream's issue #46 is the one that gives
 * the envelope somewhere for this; until it lands, `report.json` is the honest carrier and its
 * content is exactly the payload that becomes native metrics later. ADR-015.
 */
async function fetchReport(result) {
  const artifact = (result.artifacts ?? []).find((entry) => entry.name === 'report.json');
  if (!artifact) return null;
  const response = await fetch(client.artifactUrl(artifact));
  if (!response.ok) return null;
  return response.json();
}

/* ------------------------------------------------------------------------- presentation */

function present() {
  renderChallenge(dom.challenge, content?.challenge, report, METRIC_LABELS);
  renderKpis(dom.kpis, KPIS, report);
  renderMetrics(dom.metrics, METRICS, report);
  renderVerification(dom.verification, CHECKS, report);
  renderValidity(dom.validity, report);
  describeGeometry(report);
  renderDerived();
  declareOverlays();

  if (!report) return;

  drawCurve(dom.cpCurve, {
    traces: [
      { name: 'upper surface', points: report.curves.cp_upper },
      { name: 'lower surface', points: report.curves.cp_lower },
    ],
    xLabel: 'x / c',
    yLabel: 'C_p',
    invertY: true,
    marks: [{ y: 0 }],
  });

  dom.sweepPanel.hidden = !report.sweep;
  if (report.sweep) {
    const sweep = report.sweep;
    drawCurve(dom.sweepCurve, {
      traces: [
        { name: 'lift coefficient', points: sweep.alpha_deg.map((a, i) => [a, sweep.c_l[i]]) },
        { name: 'pitching moment', points: sweep.alpha_deg.map((a, i) => [a, sweep.c_m_c4[i]]) },
      ],
      xLabel: 'angle of attack, degrees',
      yLabel: 'coefficient',
      marks: [{ y: 0 }],
    });
    dom.sweepMetrics.replaceChildren(
      entry('Lift-curve slope', `${sweep.lift_slope.toFixed(3)} /rad`),
      entry('as a multiple of 2π', (sweep.lift_slope / (2 * Math.PI)).toFixed(3)),
      entry('Zero-lift incidence', `${sweep.alpha_l0_deg.toFixed(2)} °`),
      entry('Aerodynamic centre', `${sweep.x_ac_over_c.toFixed(3)} c`),
      entry('Fit R²', sweep.x_ac_fit_r2.toFixed(5)),
    );
  }
}

function entry(label, value) {
  return el('div', {}, el('dt', { text: label }), el('dd', { text: value }));
}

function renderDerived() {
  const { rho, mu, a, state } = air();
  const speed = currentParams().u_inf ?? 0;
  const derived = groups({
    speed,
    chord: physical.chord,
    density: rho,
    viscosity: mu,
    soundSpeed: a,
  });
  dom.derived.replaceChildren(
    entry('Density', `${rho.toFixed(4)} kg/m³`),
    entry('Viscosity', `${mu.toExponential(3)} Pa·s`),
    entry('Speed of sound', `${a.toFixed(1)} m/s`),
    state ? entry('Temperature', `${state.temperature.toFixed(2)} K`) : null,
    state ? entry('Pressure', `${(state.pressure / 1000).toFixed(2)} kPa`) : null,
    entry('Dynamic pressure', `${derived.dynamicPressure.toFixed(0)} Pa`),
    entry('Reynolds number', derived.reynolds.toExponential(2)),
    entry('Mach number', derived.mach.toFixed(3)),
  );
}

/* --------------------------------------------------------------- the annotation layer */

/**
 * The outline the solver was given, in domain coordinates, plus the chord it defines.
 *
 * The same rule the solver uses (`airfoil_geometry.read_profile`): the trailing edge is the
 * vertex of greatest x, and the leading edge is the vertex furthest from it. Applied to the
 * *outline* rather than to the control points, because the spline is the geometry of record.
 */
function outlineFrame() {
  const points = (dom.editor.outlinePoints?.() ?? []).map(([x, y]) => [
    x * physical.chord,
    y * physical.chord,
  ]);
  if (points.length < 3) return null;

  const te = points.reduce((best, p) => (p[0] > best[0] ? p : best), points[0]);
  const le = points.reduce(
    (best, p) =>
      Math.hypot(p[0] - te[0], p[1] - te[1]) > Math.hypot(best[0] - te[0], best[1] - te[1])
        ? p
        : best,
    points[0],
  );
  const axis = [te[0] - le[0], te[1] - le[1]];
  const chord = Math.hypot(axis[0], axis[1]);
  if (!(chord > 0)) return null;
  const unit = [axis[0] / chord, axis[1] / chord];
  return {
    points,
    le,
    te,
    chord,
    /** A station along the chord, as a point in the domain. */
    at: (fraction) => [le[0] + unit[0] * fraction * chord, le[1] + unit[1] * fraction * chord],
    /** The outline point nearest a chordwise station, on the requested side. */
    surface: (fraction, upper) => {
      const target = fraction * chord;
      let best = null;
      let bestError = Infinity;
      for (const p of points) {
        const along = (p[0] - le[0]) * unit[0] + (p[1] - le[1]) * unit[1];
        const across = -(p[0] - le[0]) * unit[1] + (p[1] - le[1]) * unit[0];
        if (upper ? across < 0 : across > 0) continue;
        const error = Math.abs(along - target);
        if (error < bestError) {
          bestError = error;
          best = p;
        }
      }
      return best;
    },
  };
}

/** Which surface carries the suction peak, read from the two published curves. */
function peakSurface() {
  if (!report?.curves) return null;
  const low = (curve) => curve.reduce((best, p) => (p[1] < best[1] ? p : best), curve[0]);
  const upper = low(report.curves.cp_upper);
  const lower = low(report.curves.cp_lower);
  return upper[1] <= lower[1]
    ? { station: upper[0], upper: true }
    : { station: lower[0], upper: false };
}

/**
 * Which annotations this run can carry, and why the others cannot.
 *
 * Recomputed on every result, because availability is a property of the run: the aerodynamic
 * centre exists only across a sweep, and the centre of pressure runs off to infinity as the
 * normal force vanishes. Both are declared and disabled with that reason rather than dropped,
 * so the absence is a statement about the physics instead of a gap in the interface.
 */
function declareOverlays() {
  const noRun = 'Run the solve first.';
  workspace.setOverlays([
    { id: 'profile', label: 'Profile', colour: 'var(--overlay-profile)', on: true },
    {
      id: 'chord',
      label: 'Chord & c/4',
      colour: 'var(--overlay-chord)',
      on: true,
      title: 'The chord line, and the quarter chord the moment is taken about',
    },
    {
      id: 'stream',
      label: 'Free stream',
      colour: 'var(--overlay-stream)',
      on: true,
      title: 'Direction and speed of the undisturbed flow',
    },
    {
      id: 'cp',
      label: 'Centre of pressure',
      colour: 'var(--overlay-cp)',
      on: true,
      enabled: Boolean(report) && typeof report.metrics?.x_cp_over_c === 'number',
      why: report
        ? 'The normal force is too small to place a centre of pressure: it genuinely runs off to infinity here.'
        : noRun,
    },
    {
      id: 'resultant',
      label: 'Resultant',
      colour: 'var(--overlay-cp)',
      enabled: Boolean(report) && typeof report.metrics?.x_cp_over_c === 'number',
      why: report ? 'Drawn at the centre of pressure, which this run does not have.' : noRun,
      title: 'The aerodynamic force, acting at the centre of pressure',
    },
    {
      id: 'peak',
      label: 'Suction peak',
      colour: 'var(--overlay-peak)',
      enabled: Boolean(report?.curves),
      why: noRun,
    },
    {
      id: 'ac',
      label: 'Aerodynamic centre',
      colour: 'var(--overlay-ac)',
      enabled: Boolean(report?.sweep),
      why: 'The aerodynamic centre is a property of several incidences. Run a sweep under Advanced.',
    },
  ]);
}

/** Paint the annotations. Called by the workspace on every resize, zoom, result and toggle. */
function drawOverlay({ svg, project, layerOn, width, height }) {
  const frame = outlineFrame();
  if (!frame) return;

  if (layerOn('profile')) {
    const closed = [...frame.points, frame.points[0]];
    svg.append(polyline(closed.map(project), 'overlay__profile'));
  }

  if (layerOn('chord')) {
    const group = svgNode('g', { class: 'overlay__chord' });
    group.append(polyline([project(frame.le), project(frame.te)], 'overlay__chordline'));
    group.append(marker(project(frame.at(0.25)), 'c/4', 'overlay__quarter'));
    svg.append(group);
  }

  if (layerOn('stream')) {
    // In the domain frame the free stream arrives at exactly the requested incidence: the
    // solve is done in the chord frame and the page's angle is measured there, so the two
    // rotations cancel. §5.1 — the stream tilts, the profile does not.
    const alpha = ((currentParams().alpha_deg ?? 0) * Math.PI) / 180;
    const speed = currentParams().u_inf ?? 0;
    const start = [width * 0.06, height * 0.16];
    const length = Math.min(width, height) * 0.16;
    const end = [start[0] + length * Math.cos(alpha), start[1] - length * Math.sin(alpha)];
    const group = svgNode('g', { class: 'overlay__stream' });
    group.append(polyline([start, end], 'overlay__arrow'));
    for (const sweep of [2.6, -2.6]) {
      const angle = Math.atan2(end[1] - start[1], end[0] - start[0]);
      group.append(
        polyline(
          [end, [end[0] + 9 * Math.cos(angle + sweep), end[1] + 9 * Math.sin(angle + sweep)]],
          'overlay__arrow',
        ),
      );
    }
    group.append(
      svgNode(
        'text',
        { x: start[0], y: start[1] - 10 },
        document.createTextNode(
          `U∞ ${speed.toFixed(0)} m/s at ${(currentParams().alpha_deg ?? 0).toFixed(1)}°`,
        ),
      ),
    );
    svg.append(group);
  }

  if (!report) return;

  const xcp = report.metrics?.x_cp_over_c;
  if (layerOn('cp') && typeof xcp === 'number') {
    svg.append(marker(project(frame.at(xcp)), `x_cp/c = ${xcp.toFixed(3)}`, 'overlay__cp'));
  }

  if (layerOn('resultant') && typeof xcp === 'number') {
    // Perpendicular to the free stream, because in an inviscid attached flow the resultant
    // *is* the lift: the chordwise component is d'Alembert's residual, and this page reports
    // that as an error bar rather than drawing it as a force.
    const alpha = ((currentParams().alpha_deg ?? 0) * Math.PI) / 180;
    const at = project(frame.at(xcp));
    const sign = (report.metrics.c_l ?? 0) >= 0 ? 1 : -1;
    const length = Math.min(width, height) * 0.22 * sign;
    const end = [at[0] - length * Math.sin(alpha), at[1] - length * Math.cos(alpha)];
    const group = svgNode('g', { class: 'overlay__resultant' });
    group.append(polyline([at, end], 'overlay__arrow'));
    const angle = Math.atan2(end[1] - at[1], end[0] - at[0]);
    for (const sweep of [2.6, -2.6]) {
      group.append(
        polyline(
          [end, [end[0] + 9 * Math.cos(angle + sweep), end[1] + 9 * Math.sin(angle + sweep)]],
          'overlay__arrow',
        ),
      );
    }
    group.append(
      svgNode(
        'text',
        { x: end[0] + 8, y: end[1] },
        document.createTextNode(`L′ ${Math.round(report.metrics.l_prime)} N/m`),
      ),
    );
    svg.append(group);
  }

  const peak = peakSurface();
  if (layerOn('peak') && peak) {
    const at = frame.surface(peak.station, peak.upper);
    if (at) {
      svg.append(
        marker(project(at), `C_p,min ${report.metrics.cp_min.toFixed(2)}`, 'overlay__peak'),
      );
    }
  }

  if (layerOn('ac') && report.sweep) {
    svg.append(
      marker(
        project(frame.at(report.sweep.x_ac_over_c)),
        `x_ac/c = ${report.sweep.x_ac_over_c.toFixed(3)}`,
        'overlay__ac',
      ),
    );
  }
}

/** The box the "Fit profile" action frames. */
function profileBox() {
  const frame = outlineFrame();
  if (!frame) return null;
  const xs = frame.points.map((p) => p[0]);
  const ys = frame.points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/* -------------------------------------------------------------------------- the run table */

/** What the table shows at a glance. Everything else stays in the row, for Compare and export. */
const COLUMNS = [
  { path: 'geometry.label', label: 'Profile' },
  { path: 'physical.alpha_deg', label: 'α °' },
  { path: 'metrics.c_l', label: 'C_L' },
  { path: 'metrics.l_prime', label: "L' N/m" },
  { path: 'metrics.c_m_c4', label: 'C_m,c/4' },
  { path: 'metrics.cp_min', label: 'C_p,min' },
  { path: 'numerics.panels', label: 'panels' },
  { path: 'verification.cl_consistency_rel', label: 'consistency' },
];

/** One row: every input, the answer, the residuals, the warnings, the provenance. */
function row() {
  const { rho, mu, a, state } = air();
  const params = currentParams();
  return {
    exercise: { id: EXERCISE, version: '1.0.0' },
    solver: report.solver,
    model: report.model,
    geometry: {
      source: geometry.source,
      label: geometry.source === 'custom' ? 'Custom' : geometry.label,
      m: geometry.source === 'custom' ? null : shape.m,
      p: geometry.source === 'custom' ? null : shape.p,
      t: geometry.source === 'custom' ? null : shape.t,
      chord_m: report.geometry.chord_m,
      thickness_over_c: report.geometry.thickness_over_c,
      camber_over_c: report.geometry.camber_over_c,
      te_gap_over_c: report.geometry.te_gap_over_c,
      vertices: report.geometry.vertices,
      outline: fingerprint(dom.editor.value.obstacle.points),
    },
    physical: {
      alpha_deg: params.alpha_deg,
      u_inf: params.u_inf,
      chord_m: physical.chord,
      atmosphere: physical.atmosphere,
      altitude_m: physical.atmosphere === 'isa' ? physical.altitude : null,
      temperature_k: state?.temperature ?? null,
      rho,
      mu,
      sound_speed: a,
      kutta: params.kutta,
    },
    numerics: {
      panels: report.geometry.panels,
      trailing_edge: params.trailing_edge,
      resolution: params.resolution,
      convergence_check: params.convergence_check,
    },
    dimensionless: report.dimensionless,
    metrics: report.metrics,
    sweep: report.sweep
      ? {
          lift_slope: report.sweep.lift_slope,
          alpha_l0_deg: report.sweep.alpha_l0_deg,
          x_ac_over_c: report.sweep.x_ac_over_c,
          x_ac_fit_r2: report.sweep.x_ac_fit_r2,
          points: report.sweep.alpha_deg.length,
        }
      : null,
    verification: report.verification,
    validity: report.validity,
    cost: { panels: report.geometry.panels },
  };
}

/**
 * A short, stable fingerprint of the outline as submitted.
 *
 * A dragged shape cannot be described by parameters, so the row identifies it by its geometry.
 * This is not a cryptographic hash and does not need to be — it needs to differ when the shape
 * differs, so that two rows claiming the same geometry really had one. (Upstream's #47 is where
 * a canonical content hash belongs; when it lands, this is replaced by it.)
 */
function fingerprint(points) {
  let hash = 0x811c9dc5;
  for (const [x, y] of points) {
    for (const value of [Math.round(x * 1e6), Math.round(y * 1e6)]) {
      hash ^= value & 0xffffffff;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return `fnv1a:${hash.toString(16).padStart(8, '0')}`;
}

function refreshRuns(rows = runs.load(EXERCISE), evicted = 0) {
  selected = new Set([...selected].filter((key) => rows.some((entry) => entry.saved_at === key)));
  runs.renderTable(dom.runsTable, rows, {
    columns: COLUMNS,
    selected,
    onSelect: (savedAt, on) => {
      if (on) selected.add(savedAt);
      else selected.delete(savedAt);
      refreshRuns(rows);
    },
    onLoad: (entry) => loadRun(entry),
    onDelete: (savedAt) => refreshRuns(runs.remove(EXERCISE, savedAt)),
  });
  runs.renderComparison(
    dom.compare,
    rows.filter((entry) => selected.has(entry.saved_at)),
    { labels: METRIC_LABELS },
  );

  const parts = [`${rows.length} of ${runs.CAPACITY} kept, in this browser only.`];
  if (evicted) parts.push(`${evicted} oldest dropped to make room.`);
  dom.runsNote.textContent = parts.join(' ');
  for (const button of [dom.exportCsv, dom.exportJson, dom.clearRuns])
    button.disabled = !rows.length;
  dom.compareJump.hidden = rows.length < 2;
}

/** Put a saved row's inputs back on the page. Does not re-solve: Run is still the visitor's. */
function loadRun(entry) {
  physical.chord = entry.physical.chord_m;
  physical.atmosphere = entry.physical.atmosphere;
  if (entry.physical.altitude_m !== null) physical.altitude = entry.physical.altitude_m;
  physical.rho = entry.physical.rho;
  physical.mu = entry.physical.mu;
  physical.a = entry.physical.sound_speed;
  renderAtmosphere();

  if (entry.geometry.source !== 'custom' && entry.geometry.m !== null) {
    Object.assign(shape, { m: entry.geometry.m, p: entry.geometry.p, t: entry.geometry.t });
    geometry.source = entry.geometry.source;
    geometry.label = entry.geometry.label;
    dom.profile.value = CATALOGUE.some((profile) => profile.label === entry.geometry.label)
      ? entry.geometry.label
      : 'custom';
    buildShapeControls(dom.shapeControls, SHAPE_CONTROLS, shape, onShapeSlider);
    applyShape();
  }

  // Rebuilt from the saved values rather than assigned into the live objects: `buildParamForm`
  // carries across any previous value the current schema still admits, which is exactly the
  // rule a loaded row needs.
  buildForms({
    ...currentParams(),
    alpha_deg: entry.physical.alpha_deg,
    u_inf: entry.physical.u_inf,
    kutta: entry.physical.kutta,
    panels: entry.numerics.panels,
    trailing_edge: entry.numerics.trailing_edge,
    resolution: entry.numerics.resolution,
  });
  renderDerived();
  workspace.draw();
  setStatusOn(
    dom,
    `Loaded the inputs of the ${entry.geometry.label} run. Press Run to recompute it.`,
  );
}

/* ---------------------------------------------------------------------------- the controls */

function onShapeSlider() {
  if (geometry.source !== 'custom') {
    const match = CATALOGUE.find(
      (profile) =>
        Math.abs(profile.m - shape.m) < 1e-9 &&
        Math.abs(profile.p - shape.p) < 1e-9 &&
        Math.abs(profile.t - shape.t) < 1e-9,
    );
    geometry.source = match ? 'catalogue' : 'parametric';
    geometry.label = match ? match.label : derivedName();
    dom.profile.value = match ? match.label : 'custom';
  }
  applyShape();
}

/** A parametric profile still deserves a name, and a four-digit one where the digits are whole. */
function derivedName() {
  const digits = [100 * shape.m, 10 * shape.p, 100 * shape.t];
  const whole = digits.every((value) => Math.abs(value - Math.round(value)) < 1e-6);
  return whole
    ? `NACA ${Math.round(digits[0])}${Math.round(digits[1])}${String(Math.round(digits[2])).padStart(2, '0')}`
    : `NACA m=${shape.m.toFixed(3)} p=${shape.p.toFixed(2)} t=${shape.t.toFixed(3)}`;
}

function buildForms(previous = currentParams()) {
  const chosen = solver();
  if (!chosen) return;
  const byGroup = groupParameters(PARAM_UI);
  forms.physical = buildParamForm(dom.physical, chosen, byGroup.physical, previous);
  forms.numerical = buildParamForm(dom.numerical, chosen, byGroup.numerical, previous);
  forms.study = buildParamForm(dom.study, chosen, byGroup.study, previous);
  // `rho`, `mu` and `sound_speed` are deliberately absent from PARAM_UI: they are consequences
  // of the atmosphere rather than free inputs, and they are sent from `air()`.
}

function renderAtmosphere() {
  const mode = el('select', { id: 'atmosphere-mode', 'aria-label': 'Atmosphere' });
  mode.replaceChildren(
    new Option('ISA altitude', 'isa', false, physical.atmosphere === 'isa'),
    new Option('Enter the air properties', 'manual', false, physical.atmosphere === 'manual'),
  );
  mode.addEventListener('change', () => {
    physical.atmosphere = mode.value;
    renderAtmosphere();
    renderDerived();
  });

  const children = [
    el(
      'div',
      { class: 'field' },
      el(
        'label',
        { class: 'field__label', for: 'atmosphere-mode' },
        el('span', {
          text: 'Atmosphere',
          title:
            'Altitude sets temperature, pressure, density, viscosity and the speed of sound together, because they are one decision and not five.',
        }),
      ),
      mode,
    ),
  ];

  if (physical.atmosphere === 'isa') {
    children.push(
      numberField('altitude', 'Altitude', physical.altitude, 0, 15000, 250, 'm', (value) => {
        physical.altitude = value;
        renderDerived();
      }),
    );
  } else {
    children.push(
      numberField('rho', 'Density', physical.rho, 0.05, 2, 0.005, 'kg/m³', (value) => {
        physical.rho = value;
        renderDerived();
      }),
      numberField('mu', 'Viscosity', physical.mu, 1e-6, 5e-5, 1e-7, 'Pa·s', (value) => {
        physical.mu = value;
        renderDerived();
      }),
      numberField('sound', 'Speed of sound', physical.a, 100, 400, 1, 'm/s', (value) => {
        physical.a = value;
        renderDerived();
      }),
    );
  }

  children.push(
    numberField('chord', 'Chord', physical.chord, 0.05, 5, 0.05, 'm', (value) => {
      physical.chord = value;
      renderDerived();
      workspace?.draw();
    }),
  );

  dom.atmosphere.replaceChildren(...children);
}

function numberField(id, label, value, min, max, step, unit, onChange) {
  const input = el('input', { type: 'number', id: `phys-${id}`, value, min, max, step });
  input.addEventListener('change', () => {
    const parsed = Number(input.value);
    if (Number.isFinite(parsed)) onChange(Math.min(Math.max(parsed, min), max));
  });
  return el(
    'div',
    { class: 'field' },
    el(
      'label',
      { class: 'field__label', for: `phys-${id}` },
      el('span', { text: label }),
      el('span', { class: 'field__value', text: unit }),
    ),
    input,
  );
}

/* ---------------------------------------------------------------------------- start-up */

let content = null;

mountChrome('experiments');
buildShapeControls(dom.shapeControls, SHAPE_CONTROLS, shape, onShapeSlider);
renderAtmosphere();

workspace = createWorkspace({
  root: dom.workspace,
  viewer: dom.viewer,
  editor: dom.editor,
  fitLabel: 'Fit profile',
  exportName: 'airfoil-field',
  subject: profileBox,
  onDraw: drawOverlay,
  onModeChange: (mode) => {
    dom.editShape.classList.toggle('is-active', mode === 'edit');
    dom.editShape.setAttribute('aria-pressed', String(mode === 'edit'));
    dom.editShape.textContent = mode === 'edit' ? 'Done editing' : 'Edit shape';
  },
});

applyShape();
declareOverlays();

dom.profile.replaceChildren(
  ...CATALOGUE.map(
    (profile) =>
      new Option(
        `${profile.label} — ${profile.note}`,
        profile.label,
        false,
        profile.label === DEFAULT_PROFILE,
      ),
  ),
  new Option('Custom (dragged)', 'custom'),
);
dom.profile.addEventListener('change', () => {
  const profile = CATALOGUE.find((entry) => entry.label === dom.profile.value);
  if (!profile) return; // "Custom" is a state you reach by dragging, not by choosing
  Object.assign(shape, { m: profile.m, p: profile.p, t: profile.t });
  geometry.source = 'catalogue';
  geometry.label = profile.label;
  buildShapeControls(dom.shapeControls, SHAPE_CONTROLS, shape, onShapeSlider);
  applyShape();
});

dom.editor.addEventListener('change', () => {
  if (applyingShape) return;
  geometry.source = 'custom';
  geometry.label = 'Custom';
  dom.profile.value = 'custom';
  describeGeometry(report);
  workspace.draw();
});

dom.editShape.addEventListener('click', () => {
  workspace.setMode(workspace.mode === 'edit' ? 'pan' : 'edit');
});

dom.derivedToggle.addEventListener('click', () => {
  const open = dom.derivedWrap.hidden;
  dom.derivedWrap.hidden = !open;
  dom.derivedToggle.setAttribute('aria-expanded', String(open));
});

dom.run.addEventListener('click', run);
dom.cancel.addEventListener('click', () => currentJob?.cancel());
dom.reset.addEventListener('click', () => {
  const profile = CATALOGUE.find((entry) => entry.label === DEFAULT_PROFILE);
  Object.assign(shape, { m: profile.m, p: profile.p, t: profile.t });
  geometry.source = 'catalogue';
  geometry.label = profile.label;
  dom.profile.value = profile.label;
  buildShapeControls(dom.shapeControls, SHAPE_CONTROLS, shape, onShapeSlider);
  applyShape();
});
dom.field.addEventListener('change', () => {
  dom.viewer.field = dom.field.value;
  applyFieldView(dom.viewer, FIELD_VIEW, dom.field.value, dom.fieldHint);
  workspace.draw();
});
dom.keep.addEventListener('click', () => {
  if (!report) return;
  const { rows, evicted } = runs.save(EXERCISE, row());
  refreshRuns(rows, evicted);
  revealPanel(dom.runsPanel);
});
dom.compareJump.addEventListener('click', () => revealPanel(dom.runsPanel));
dom.exportCsv.addEventListener('click', () =>
  runs.download('airfoil-runs.csv', runs.toCsv(runs.load(EXERCISE)), 'text/csv'),
);
dom.exportJson.addEventListener('click', () =>
  runs.download('airfoil-runs.json', runs.toJson(runs.load(EXERCISE)), 'application/json'),
);
dom.clearRuns.addEventListener('click', () => {
  runs.clear(EXERCISE);
  // Re-read rather than assume the table is now empty: a store that refuses to be written to
  // also refuses to be cleared, and a table showing nothing while the rows are still there is
  // the one thing worse than a delete that did not happen.
  refreshRuns();
});

try {
  const [loaded, info, solvers] = await Promise.all([
    fetch('/experiments/airfoil/content.json').then((response) => response.json()),
    health().catch(() => null),
    solversFor(GEOMETRY_TYPE, { physics: PHYSICS }),
  ]);

  content = loaded;
  catalogue = solvers;
  renderLesson({ content, intro: null, lesson: dom.lesson, open: ['problem'] });
  present();
  refreshRuns();

  const chosen = solver();
  if (chosen) {
    dom.solver.replaceChildren(new Option(chosen.title, chosen.name));
    dom.solverHint.textContent = chosen.description;
    buildForms();
    renderDerived();
    workspace.draw();
  }

  const canSolve = applyMaintenance(
    dom,
    info,
    'The lab is not accepting new simulations right now. You can still read the problem, reshape the profile and look at any runs you have kept.',
  );

  if (!chosen) {
    setStatusOn(
      dom,
      'This server has no solver that imposes a Kutta condition, so this exercise cannot be run here.',
      'error',
    );
  } else if (!canSolve) {
    setStatusOn(dom, 'Simulations are paused for maintenance.');
  } else {
    dom.run.disabled = false;
    setStatusOn(dom, 'Press Run to solve the section as it stands.');
  }
} catch (error) {
  setStatusOn(dom, `Cannot reach the server — ${describeError(error)}`, 'error');
  dom.run.disabled = true;
}
