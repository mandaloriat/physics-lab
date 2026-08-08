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
  attemptState,
  renderAfterAttempt,
  renderTeacher,
} from '/shared/exercise.js';
import {
  changedTheDesign,
  mountPath,
  mountPrediction,
  renderPredictionRecall,
} from '/shared/journey.js';
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
import { contentUrl, t } from '/shared/i18n.js';
import { createGuide } from '/shared/guide.js';
import { createWorkspace, marker, polyline, svgNode } from '/shared/workspace.js';
import * as runs from '/shared/runs.js';
import { controlPoints } from './naca.js';
import { drawFlowFigure, drawNacaFigure, drawSliceFigure, mountFigureDefs } from './figures.js';

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
    'guide',
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
    'path',
    'prediction',
    'predictionRecall',
    'outcome',
    'hint',
    'credibility',
    'explain',
    'teacher',
    'whyPanel',
    'predictPanel',
    'teacherCard',
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
 *  theory's, and the solver recomputes them from whatever outline it is actually given.
 *
 *  The designation is the profile's name and is the same in every language — it is what the
 *  saved run records and what a reader would look up. Only the note beside it is prose, so only
 *  the note is translated, keyed by the designation. */
const CATALOGUE = [
  { label: 'NACA 0009', m: 0, p: 0.4, t: 0.09 },
  { label: 'NACA 0012', m: 0, p: 0.4, t: 0.12 },
  { label: 'NACA 1408', m: 0.01, p: 0.4, t: 0.08 },
  { label: 'NACA 1412', m: 0.01, p: 0.4, t: 0.12 },
  { label: 'NACA 2312', m: 0.02, p: 0.3, t: 0.12 },
  { label: 'NACA 2412', m: 0.02, p: 0.4, t: 0.12 },
  { label: 'NACA 2415', m: 0.02, p: 0.4, t: 0.15 },
  { label: 'NACA 2512', m: 0.02, p: 0.5, t: 0.12 },
  { label: 'NACA 4412', m: 0.04, p: 0.4, t: 0.12 },
  { label: 'NACA 4415', m: 0.04, p: 0.4, t: 0.15 },
].map((profile) => ({ ...profile, note: t(`airfoil.notes.${profile.label}`) }));

const DEFAULT_PROFILE = 'NACA 2412';

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
      ? t('airfoil.edited')
      : t('airfoil.described', {
          label: geometry.label,
          camber: (100 * shape.m).toFixed(1),
          position: (100 * shape.p).toFixed(0),
          thickness: (100 * shape.t).toFixed(1),
        });

  dom.geometryReadback.textContent = report
    ? // What the solver read back out of the outline it was actually given. Shown because the
      // spline through the control points is the geometry of record, and any difference from
      // the nominal profile should be visible rather than assumed away (§4.4).
      t('airfoil.readback', {
        chord: report.geometry.chord_m.toFixed(3),
        thickness: (100 * report.geometry.thickness_over_c).toFixed(1),
        camber: (100 * report.geometry.camber_over_c).toFixed(2),
        panels: report.geometry.panels,
        vertices: report.geometry.vertices,
      })
    : '';
}

/* ------------------------------------------------------------------------- physical inputs */

const SHAPE_CONTROLS = [
  {
    key: 'm',
    label: t('airfoil.shape.camber'),
    min: 0,
    max: 0.06,
    step: 0.002,
    unit: '',
    hint: '',
    title: t('airfoil.shape.camberTitle'),
    format: (v) => `${(100 * v).toFixed(1)} %`,
  },
  {
    key: 'p',
    label: t('airfoil.shape.position'),
    min: 0.2,
    max: 0.6,
    step: 0.05,
    unit: '',
    hint: '',
    title: t('airfoil.shape.positionTitle'),
    format: (v) => t('airfoil.shape.chordUnit', { value: (100 * v).toFixed(0) }),
  },
  {
    key: 't',
    label: t('airfoil.shape.thickness'),
    min: 0.06,
    max: 0.2,
    step: 0.005,
    unit: '',
    hint: '',
    title: t('airfoil.shape.thicknessTitle'),
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
    label: t('airfoil.params.alpha'),
    hint: '',
    title: t('airfoil.params.alphaTitle'),
    step: 0.1,
  },
  {
    name: 'u_inf',
    group: 'physical',
    label: t('airfoil.params.speed'),
    hint: '',
    title: t('airfoil.params.speedTitle'),
    step: 1,
  },
  {
    name: 'kutta',
    group: 'physical',
    label: t('airfoil.params.kutta'),
    hint: '',
    title: t('airfoil.params.kuttaTitle'),
    // The keys are the schema's own enum values and travel to the server unchanged; only what
    // the menu shows is translated.
    optionLabels: {
      enforced: t('airfoil.params.kuttaEnforced'),
      none: t('airfoil.params.kuttaNone'),
    },
  },
  {
    name: 'panels',
    group: 'numerical',
    label: t('airfoil.params.panels'),
    hint: t('airfoil.params.panelsHint'),
  },
  {
    name: 'trailing_edge',
    group: 'numerical',
    label: t('airfoil.params.trailingEdge'),
    hint: t('airfoil.params.trailingEdgeHint'),
    optionLabels: {
      closed: t('airfoil.params.trailingEdgeClosed'),
      as_drawn: t('airfoil.params.trailingEdgeAsDrawn'),
    },
  },
  {
    name: 'resolution',
    group: 'numerical',
    label: t('airfoil.params.resolution'),
    hint: t('airfoil.params.resolutionHint'),
  },
  {
    name: 'convergence_check',
    group: 'numerical',
    label: t('airfoil.params.convergence'),
    hint: t('airfoil.params.convergenceHint'),
  },
  {
    name: 'sweep_from_deg',
    group: 'study',
    label: t('airfoil.params.sweepFrom'),
    hint: t('airfoil.params.sweepFromHint'),
    step: 1,
  },
  {
    name: 'sweep_to_deg',
    group: 'study',
    label: t('airfoil.params.sweepTo'),
    hint: t('airfoil.params.sweepToHint'),
    step: 1,
  },
  {
    name: 'sweep_step_deg',
    group: 'study',
    label: t('airfoil.params.sweepStep'),
    hint: t('airfoil.params.sweepStepHint'),
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
    label: t('airfoil.metrics.cl'),
    symbol: 'C_L',
    unit: '1',
    digits: 4,
    hint: t('airfoil.metrics.clHint'),
  },
  {
    key: 'l_prime',
    goal: t('airfoil.goal.lift'),
    label: t('airfoil.metrics.lift'),
    symbol: 'L′',
    unit: 'N/m',
    digits: 1,
    hint: t('airfoil.metrics.liftHint'),
  },
  {
    key: 'c_m_c4',
    goal: t('airfoil.goal.twist'),
    label: t('airfoil.metrics.moment'),
    symbol: 'C_m,c/4',
    unit: '1',
    digits: 4,
    hint: t('airfoil.metrics.momentHint'),
  },
  {
    key: 'x_cp_over_c',
    label: t('airfoil.metrics.centre'),
    symbol: 'x_cp/c',
    unit: '1',
    digits: 4,
    hint: t('airfoil.metrics.centreHint'),
  },
  {
    key: 'cp_min',
    label: t('airfoil.metrics.peak'),
    symbol: 'C_p,min',
    unit: '1',
    digits: 3,
    hint: t('airfoil.metrics.peakHint'),
  },
  {
    key: 'cp_min_station',
    label: t('airfoil.metrics.peakStation'),
    symbol: 'x/c',
    unit: '1',
    digits: 3,
  },
  {
    key: 'circulation',
    label: t('airfoil.metrics.circulation'),
    symbol: 'Γ',
    unit: 'm²/s',
    digits: 4,
  },
  {
    key: 'alpha_deg',
    label: t('airfoil.metrics.incidence'),
    symbol: 'α',
    unit: '°',
    digits: 3,
    hint: t('airfoil.metrics.incidenceHint'),
  },
  // The aerodynamic centre was a headline tile until the row went to three, and it is here
  // rather than deleted because of what it says when it is *absent*: this is a property of
  // several incidences, so one solve cannot produce it. A quantity that says why it is missing
  // is teaching something; one that quietly vanishes is not. `docs/exercise-contract.md` §7.
  {
    key: 'x_ac_over_c',
    label: t('airfoil.metrics.aerodynamicCentre'),
    symbol: 'x_ac/c',
    unit: '1',
    digits: 3,
    from: (found) => found.sweep?.x_ac_over_c,
    requires: 'sweep',
    absent: t('airfoil.metrics.aerodynamicCentreAbsent'),
    hint: t('airfoil.metrics.aerodynamicCentreHint'),
  },
];

/** The `key -> wording` table the challenge reads, built from the same list. */
const METRIC_LABELS = Object.fromEntries(METRICS.map((metric) => [metric.key, metric]));

/** The few numbers that answer the mission, shown before any table. */
const KPIS = [
  {
    key: 'l_prime',
    label: t('airfoil.headline.lift'),
    symbol: 'L′',
    unit: 'N/m',
    plainUnit: t('airfoil.headline.perMetre'),
    digits: 0,
    goal: { value: 800, comparator: '==', tolerance: 0.02, tolerance_kind: 'relative' },
    hint: t('airfoil.headline.liftHint'),
  },
  {
    key: 'c_m_c4',
    label: t('airfoil.headline.twist'),
    symbol: 'C_m,c/4',
    unit: '%',
    plainUnit: '%',
    digits: 0,
    // As a percentage of the limit rather than a signed coefficient: −0.0731 says nothing to
    // somebody meeting a pitching moment for the first time, and "91 % of the limit" says the
    // one thing they need. The sign is not thrown away — it is the sentence underneath.
    from: (found) =>
      typeof found.metrics?.c_m_c4 === 'number'
        ? (100 * Math.abs(found.metrics.c_m_c4)) / MOMENT_LIMIT
        : null,
    goal: { value: 100, comparator: '<' },
    note: (value, found) =>
      t(found.metrics?.c_m_c4 <= 0 ? 'airfoil.headline.noseDown' : 'airfoil.headline.noseUp'),
    hint: t('airfoil.headline.twistHint'),
  },
  {
    key: 'cp_min',
    label: t('airfoil.headline.suction'),
    symbol: 'C_p,min',
    unit: '1',
    digits: 2,
    note: () => t('airfoil.headline.suctionNote'),
    hint: t('airfoil.headline.suctionHint'),
  },
];

/** The moment ceiling the challenge is set against, read from the content rather than typed. */
const MOMENT_LIMIT = 0.08;

const CHECKS = [
  {
    key: 'cl_consistency_rel',
    label: t('airfoil.checks.liftTwoWays'),
    tolerance: 'cl_consistency_tolerance',
    describe: t('airfoil.checks.liftTwoWaysDescribe'),
  },
  {
    key: 'cd_pressure_spurious',
    label: t('airfoil.checks.dalembert'),
    tolerance: 'cd_pressure_tolerance',
    describe: t('airfoil.checks.dalembertDescribe'),
  },
  {
    key: 'cl_convergence_rel',
    label: t('airfoil.checks.convergence'),
    tolerance: 'cl_convergence_tolerance',
    describe: t('airfoil.checks.convergenceDescribe'),
  },
];

const FIELD_VIEW = {
  Cp: {
    option: t('airfoil.fields.cp'),
    // The colorbar caption is the field's own symbol and stays put: the widget right-aligns it
    // against a tick sized for strings like "m/s", and a translated word would crowd it.
    caption: 'Cp',
    colormap: 'coolwarm',
    contours: 12,
    symmetric: true,
    hint: t('airfoil.fields.cpHint'),
  },
  speed: {
    option: t('airfoil.fields.speed'),
    caption: 'm/s',
    colormap: 'viridis',
    contours: 10,
    hint: t('airfoil.fields.speedHint'),
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
let guide = null;

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
    setStatusOn(dom, t('airfoil.noSolver'), 'error');
    return;
  }

  running = true;
  syncGuidePresets();
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
    setStatusOn(dom, t('experiment.done'), 'done');
  } finally {
    running = false;
    currentJob = null;
    dom.keep.disabled = report === null;
    syncGuidePresets();
  }
}

/**
 * Build the guided path, if this exercise's content file carries one.
 *
 * The chapters are prose and live in `content.json`; the drawings are code and live in
 * `figures.js`, because a figure of a NACA section has to come from the same formula the
 * solver is handed. `content.guide` being absent is not an error — it is an exercise that has
 * not been given a lesson yet, and the page is exactly what it was before.
 */
function mountGuide() {
  if (!content.guide?.length) return;
  mountFigureDefs(dom.guide);
  guide = createGuide({
    root: dom.guide,
    chapters: content.guide,
    storageKey: `spoon-physics:guide:${EXERCISE}`,
    figures: { flow: drawFlowFigure, slice: drawSliceFigure, naca: drawNacaFigure },
    onPreset: runPreset,
    // The guide does not know where the bench is, and should not: it hands back control and
    // the page decides what "go to the simulator" means on this page.
    onSkip: () => {
      dom.workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  });
  syncGuidePresets();
}

/**
 * Tell the guided path whether its preset buttons may act, and why not when they may not.
 *
 * Called on both edges of a solve rather than only on the way in, because `run()` can leave
 * through its `catch` as easily as through its happy path, and a preset left disabled after a
 * failed solve would be a dead control with a stale reason on it.
 */
function syncGuidePresets() {
  if (!guide) return;
  if (running) guide.setPresetsAvailable({ ok: false, why: t('guide.presetBusy') });
  else if (!solver()) guide.setPresetsAvailable({ ok: false, why: t('guide.presetNoSolver') });
  else if (dom.run.disabled) guide.setPresetsAvailable({ ok: false, why: t('guide.presetPaused') });
  else guide.setPresetsAvailable({ ok: true });
}

/**
 * Run one of the guided path's preset incidences.
 *
 * It sets the control and lets the control's own handler carry the value into the parameter
 * object, rather than writing to that object directly. The two are not equivalent: the object
 * `buildParamForm` returns is mutated by the controls, so a preset that wrote straight into it
 * would leave the `<input>` showing one angle while the solver received another — silently,
 * and only visible by reading the annotation on the field afterwards. This is also the exact
 * path `setParam` in `e2e/airfoil.spec.mjs` drives, so the tested route and the real one are
 * the same route.
 */
function runPreset(alphaDeg) {
  if (running) return;
  const input = document.getElementById('param-alpha_deg');
  if (!input) return;
  input.value = String(alphaDeg);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  run();
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
  renderAfterAttempt(dom, {
    challenge: content?.challenge,
    explain: content?.explain,
    report,
    state: attemptState(content?.challenge, report),
    checks: CHECKS,
    hint: report ? suggestion() : null,
    facts: attemptFacts(),
  });
  renderPredictionRecall(dom.predictionRecall, prediction?.answer() ?? null);
  if (report) path.mark('attempt');

  describeGeometry(report);
  renderDerived();
  declareOverlays();

  if (!report) return;

  drawCurve(dom.cpCurve, {
    traces: [
      { name: t('airfoil.plots.upper'), points: report.curves.cp_upper },
      { name: t('airfoil.plots.lower'), points: report.curves.cp_lower },
    ],
    xLabel: t('airfoil.plots.stationAxis'),
    yLabel: t('airfoil.plots.cpAxis'),
    invertY: true,
    marks: [{ y: 0 }],
  });

  dom.sweepPanel.hidden = !report.sweep;
  if (report.sweep) {
    const sweep = report.sweep;
    drawCurve(dom.sweepCurve, {
      traces: [
        {
          name: t('airfoil.plots.liftTrace'),
          points: sweep.alpha_deg.map((a, i) => [a, sweep.c_l[i]]),
        },
        {
          name: t('airfoil.plots.momentTrace'),
          points: sweep.alpha_deg.map((a, i) => [a, sweep.c_m_c4[i]]),
        },
      ],
      xLabel: t('airfoil.plots.alphaAxis'),
      yLabel: t('airfoil.plots.coefficientAxis'),
      marks: [{ y: 0 }],
    });
    dom.sweepMetrics.replaceChildren(
      entry(t('airfoil.plots.liftSlope'), `${sweep.lift_slope.toFixed(3)} /rad`),
      entry(t('airfoil.plots.slopeMultiple'), (sweep.lift_slope / (2 * Math.PI)).toFixed(3)),
      entry(t('airfoil.plots.zeroLift'), `${sweep.alpha_l0_deg.toFixed(2)} °`),
      entry(t('airfoil.plots.aerodynamicCentre'), `${sweep.x_ac_over_c.toFixed(3)} c`),
      entry(t('airfoil.plots.fit'), sweep.x_ac_fit_r2.toFixed(5)),
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
    entry(t('airfoil.air.density'), `${rho.toFixed(4)} kg/m³`),
    entry(t('airfoil.air.viscosity'), `${mu.toExponential(3)} Pa·s`),
    entry(t('airfoil.air.soundSpeed'), `${a.toFixed(1)} m/s`),
    state ? entry(t('airfoil.air.temperature'), `${state.temperature.toFixed(2)} K`) : null,
    state ? entry(t('airfoil.air.pressure'), `${(state.pressure / 1000).toFixed(2)} kPa`) : null,
    entry(t('airfoil.air.dynamicPressure'), `${derived.dynamicPressure.toFixed(0)} Pa`),
    entry(t('airfoil.air.reynolds'), derived.reynolds.toExponential(2)),
    entry(t('airfoil.air.mach'), derived.mach.toFixed(3)),
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
  const noRun = t('workspace.noRun');
  workspace.setOverlays([
    {
      id: 'profile',
      label: t('airfoil.overlays.profile'),
      colour: 'var(--overlay-profile)',
      on: true,
    },
    {
      id: 'chord',
      label: t('airfoil.overlays.chord'),
      colour: 'var(--overlay-chord)',
      on: true,
      title: t('airfoil.overlays.chordTitle'),
    },
    {
      id: 'stream',
      label: t('airfoil.overlays.stream'),
      colour: 'var(--overlay-stream)',
      on: true,
      title: t('airfoil.overlays.streamTitle'),
    },
    {
      id: 'cp',
      label: t('airfoil.overlays.centre'),
      colour: 'var(--overlay-cp)',
      on: true,
      enabled: Boolean(report) && typeof report.metrics?.x_cp_over_c === 'number',
      why: report ? t('airfoil.overlays.centreWhy') : noRun,
    },
    {
      id: 'resultant',
      label: t('airfoil.overlays.resultant'),
      colour: 'var(--overlay-cp)',
      enabled: Boolean(report) && typeof report.metrics?.x_cp_over_c === 'number',
      why: report ? t('airfoil.overlays.resultantWhy') : noRun,
      title: t('airfoil.overlays.resultantTitle'),
    },
    {
      id: 'peak',
      label: t('airfoil.overlays.peak'),
      colour: 'var(--overlay-peak)',
      enabled: Boolean(report?.curves),
      why: noRun,
    },
    {
      id: 'ac',
      label: t('airfoil.overlays.ac'),
      colour: 'var(--overlay-ac)',
      enabled: Boolean(report?.sweep),
      why: t('airfoil.overlays.acWhy'),
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
  { path: 'geometry.label', label: t('airfoil.columns.profile') },
  { path: 'physical.alpha_deg', label: t('airfoil.columns.alpha') },
  // The symbol columns are the same in every language, and are left as symbols on purpose:
  // a header that reads `C_L` is read by an Italian engineer exactly as it is by an English one.
  { path: 'metrics.c_l', label: 'C_L' },
  { path: 'metrics.l_prime', label: "L' N/m" },
  { path: 'metrics.c_m_c4', label: 'C_m,c/4' },
  { path: 'metrics.cp_min', label: 'C_p,min' },
  { path: 'numerics.panels', label: t('airfoil.columns.panels') },
  { path: 'verification.cl_consistency_rel', label: t('airfoil.columns.consistency') },
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
      label: geometry.source === 'custom' ? t('airfoil.custom') : geometry.label,
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

  const parts = [t('experiment.kept', { count: rows.length, capacity: runs.CAPACITY })];
  if (evicted) parts.push(t('experiment.evicted', { count: evicted }));
  dom.runsNote.textContent = parts.join(' ');
  for (const button of [dom.exportCsv, dom.exportJson, dom.clearRuns])
    button.disabled = !rows.length;
  dom.compareJump.hidden = rows.length < 2;
  if (selected.size >= 2) path.mark('compare');
  if (!rows.length) dom.runsNote.textContent = t('runs.none');
  else if (rows.length === 1) dom.runsNote.textContent += ` ${t('runs.one')}`;
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
  setStatusOn(dom, t('experiment.loaded', { label: entry.geometry.label }));
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
  const mode = el('select', { id: 'atmosphere-mode', 'aria-label': t('airfoil.air.atmosphere') });
  mode.replaceChildren(
    new Option(t('airfoil.air.isa'), 'isa', false, physical.atmosphere === 'isa'),
    new Option(t('airfoil.air.manual'), 'manual', false, physical.atmosphere === 'manual'),
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
          text: t('airfoil.air.atmosphere'),
          title: t('airfoil.air.atmosphereTitle'),
        }),
      ),
      mode,
    ),
  ];

  if (physical.atmosphere === 'isa') {
    children.push(
      numberField(
        'altitude',
        t('airfoil.air.altitude'),
        physical.altitude,
        0,
        15000,
        250,
        'm',
        (value) => {
          physical.altitude = value;
          renderDerived();
        },
      ),
    );
  } else {
    children.push(
      numberField(
        'rho',
        t('airfoil.air.density'),
        physical.rho,
        0.05,
        2,
        0.005,
        'kg/m³',
        (value) => {
          physical.rho = value;
          renderDerived();
        },
      ),
      numberField(
        'mu',
        t('airfoil.air.viscosity'),
        physical.mu,
        1e-6,
        5e-5,
        1e-7,
        'Pa·s',
        (value) => {
          physical.mu = value;
          renderDerived();
        },
      ),
      numberField('sound', t('airfoil.air.soundSpeed'), physical.a, 100, 400, 1, 'm/s', (value) => {
        physical.a = value;
        renderDerived();
      }),
    );
  }

  children.push(
    numberField('chord', t('airfoil.air.chord'), physical.chord, 0.05, 5, 0.05, 'm', (value) => {
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
  fitLabel: t('airfoil.fitProfile'),
  exportName: 'airfoil-field',
  subject: profileBox,
  onDraw: drawOverlay,
  // On from the first result. Everywhere else in the lab a streamline is a tool you reach
  // for; here it is the subject — the question the page opens with is how the air gets round
  // the section, and a C_p field alone answers it only for someone who can already read one.
  // This solver publishes `vector_fields.velocity` on a grid, so the tool can always deliver.
  streamlines: true,
  onModeChange: (mode) => {
    dom.editShape.classList.toggle('is-active', mode === 'edit');
    dom.editShape.setAttribute('aria-pressed', String(mode === 'edit'));
    dom.editShape.textContent = mode === 'edit' ? t('airfoil.doneEditing') : t('airfoil.editShape');
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
  new Option(t('airfoil.customDragged'), 'custom'),
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
  geometry.label = t('airfoil.custom');
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
  // "Improve" is not "run it again". A second attempt at a finer grid is a numerical
  // experiment and a worthwhile one, but it is not a second design — `changedTheDesign`
  // compares the geometry and the physical conditions, and nothing else. See `journey.js`.
  const kept = runs.load(EXERCISE);
  const entry = row();
  if (kept.length && changedTheDesign(kept[0], entry)) path.mark('improve');
  const { rows, evicted } = runs.save(EXERCISE, entry);
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

/* ------------------------------------------------------------- one suggestion at a time */

/**
 * What to say after an attempt that did not pass.
 *
 * Editorial rules rather than generated prose (§13.7): one problem named, one direction
 * offered, and never the value that would end the exercise. The order is the order the
 * constraints bind in — a run outside the model is not a lift problem, whatever the lift says.
 */
function suggestion() {
  if (!report) return null;
  const lift = report.metrics?.l_prime;
  const moment = Math.abs(report.metrics?.c_m_c4 ?? 0);
  const outside = (report.validity?.warnings ?? []).length > 0;

  if (outside) return t('airfoil.hint.outside');
  if (typeof lift !== 'number') return null;
  if (lift < 800 * 0.98) return t('airfoil.hint.lowLift');
  if (lift > 800 * 1.02) return t('airfoil.hint.highLift');
  if (moment >= MOMENT_LIMIT) return t('airfoil.hint.moment');
  return null;
}

/** Numbers the post-attempt cards may quote, so an explanation can be about *this* attempt. */
function attemptFacts() {
  if (!report) return {};
  return {
    lift: Math.round(report.metrics?.l_prime ?? 0),
    alpha: Number(document.getElementById('param-alpha_deg')?.value ?? 0).toFixed(1),
  };
}

/* ------------------------------------------------------------------- predict, try, compare */

/**
 * The loop the page is played in, mounted once.
 *
 * The prediction is asked before anything is computed and gates nothing; the path lights the
 * steps that have been taken. Both live in `shared/journey.js` — see the note there about why
 * neither is allowed to block a solve or to score an answer.
 */
const path = mountPath(dom.path, { exercise: EXERCISE });
let prediction = null;

function mountLoop() {
  if (content?.prediction) {
    prediction = mountPrediction(dom.prediction, {
      exercise: EXERCISE,
      prediction: content.prediction,
      hasSolved: () => Boolean(report),
      onAnswer: () => path.mark('predict'),
    });
  } else {
    dom.predictPanel?.remove();
  }
  renderTeacher(dom.teacher, content?.teacher);
  if (!content?.teacher) dom.teacherCard?.remove();
}

try {
  const [loaded, info, solvers] = await Promise.all([
    fetch(contentUrl(EXERCISE)).then((response) => response.json()),
    health().catch(() => null),
    solversFor(GEOMETRY_TYPE, { physics: PHYSICS }),
  ]);

  content = loaded;
  catalogue = solvers;
  mountLoop();
  renderLesson({ content, intro: null, lesson: dom.lesson, open: ['problem'] });
  mountGuide();
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
    t('bench.maintenance', { alternative: t('airfoil.maintenanceAlternative') }),
  );

  if (!chosen) {
    setStatusOn(dom, t('airfoil.noSolverHere'), 'error');
  } else if (!canSolve) {
    setStatusOn(dom, t('experiment.maintenanceStatus'));
  } else {
    dom.run.disabled = false;
    setStatusOn(dom, t('airfoil.ready'));
  }
  // After the Run button has been decided, not before: `syncGuidePresets` reads it, and
  // `mountGuide` runs while it is still disabled — which is the state the page ships in
  // precisely so it never offers an action it has not yet heard the server agree to. Without
  // this second call every preset sits there greyed out saying the lab is under maintenance.
  syncGuidePresets();
} catch (error) {
  setStatusOn(dom, t('experiment.unreachable', { detail: describeError(error) }), 'error');
  dom.run.disabled = true;
}
