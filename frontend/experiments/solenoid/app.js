/**
 * The magnetic circuit — the solenoid cross-section, as an exercise.
 *
 * The second experiment, and the first one whose geometry is about *materials* rather than an
 * obstacle. `regions2d` fills the whole rectangle and lets the physics vary by region: an iron
 * core, two windings carrying opposite-signed current density (the two sides of one coil cut by
 * the plane), and air everywhere else. The solver solves for the magnetic vector potential,
 *
 *     −div( (1/μ) grad A_z ) = J_z ,      B = ( ∂A_z/∂y , −∂A_z/∂x )
 *
 * with A_z = 0 on the outer boundary.
 *
 * There is no geometry widget on this page and that is not an omission: `<fs-geometry-2d>`
 * edits a `domain2d` outline, which is a different geometry kind with different physics behind
 * it. Nested material rectangles are better described by the quantities an engineer would
 * actually name — bore, winding thickness, permeability — so the controls are those quantities
 * and the cross-section is drawn from them.
 *
 * **Now an exercise.** It was a demonstration for two releases, because an exercise needs
 * metrics and every metric a magnetic design is judged on needed a definition in a 2-D slice
 * that had not been verified here. `lab.magnetics2d` settles them and checks them, so this page
 * now carries a challenge, a metrics table, five verification residuals and a run table. Two of
 * the specification's own predictions did not survive being measured, and both are stated on
 * the page rather than only in the repository: there is no peak flux density, and there is no
 * gap force. See `docs/exercises/solenoid.md` and ADR-018.
 */

import '@fenix-spoon/viewer';

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
  scalarsOf,
  setStatusOn,
  showArtifacts,
  showStats,
  syncFieldOptions,
} from '/shared/experiment.js';
import { contentUrl, num, t } from '/shared/i18n.js';
import * as runs from '/shared/runs.js';
import { createWorkspace, marker, polyline, svgNode } from '/shared/workspace.js';

const EXERCISE = 'solenoid';
const GEOMETRY_TYPE = 'regions2d';
/**
 * The physics this page is about.
 *
 * Load-bearing, and the reason this line exists: `mock.heat2d` also accepts `regions2d`, so a
 * page filtering on geometry alone offered a heat-sink solver in a magnetics solver menu — and
 * would have submitted a solenoid to it. The filter is the capability's own declared
 * `physics`, read from `GET /api/v1/capabilities`, rather than a list of solver names kept
 * here, which would go stale the first time one was renamed or added. See `shared/api.js`.
 */
const PHYSICS = 'magnetostatics';

/**
 * This exercise needs the lab's own solver, and only that one.
 *
 * `mock.magnetostatics2d` and `dolfinx.magnetostatics2d` solve the same equation and report no
 * metric, no residual and no validity warning — there is no `report.json` in their envelopes,
 * so a page that offered them here would show a field and an empty answer panel. Choosing by
 * prefix rather than by full name is the rule the airfoil uses, and it survives a version
 * suffix appearing upstream. The other two remain available through the API and are worth
 * running against this one; what they cannot do is answer the mission.
 */
const SOLVER_PREFIX = 'lab.magnetics';

/** Vacuum permeability, in H/m. The same constant the solvers use. */
const MU0 = 4e-7 * Math.PI;

/**
 * How much larger than the magnet the modelled window is, on every side.
 *
 * A_z = 0 on the outer edge confines the flux, so the window is a numerical choice that must
 * not set the answer — and at the fixed 60 mm window this page used to submit, it did: 7.2 % of
 * the stored energy sat against the boundary and the core flux came out 25 % below its
 * open-domain value. Eight times the magnet's half-extent holds that share under about half a
 * per cent in every configuration the sliders can reach.
 *
 * It is affordable because of two things in the solver, and neither was there when the window
 * was 60 mm. The cell count is set *across the magnet* rather than across the window, so
 * widening one does not coarsen the other; and the cells grow geometrically out in the air, so
 * the extra 210 mm of nothing costs about 23 cells per side instead of 280. The default
 * cross-section solves on fewer cells now than it did in the small window.
 *
 * A ratio rather than a constant, because the criterion scales with the magnet: a 90 mm magnet
 * in a window sized for a 60 mm one is the same mistake in a different place. Measured in
 * `docs/exercises/solenoid.md` §4.
 */
const WINDOW_RATIO = 8;

const dom = Object.fromEntries(
  [
    'lesson',
    'viewer',
    'workspace',
    'schematic',
    'axisV',
    'axisH',
    'core',
    'windingLeft',
    'windingRight',
    'midPlane',
    'status',
    'dot',
    'progress',
    'run',
    'cancel',
    'reset',
    'keep',
    'compareJump',
    'solver',
    'solverHint',
    'numerical',
    'conditions',
    'derivedToggle',
    'derivedWrap',
    'derived',
    'shapeControls',
    'shapeNote',
    'field',
    'fieldHint',
    'challenge',
    'kpis',
    'metrics',
    'verification',
    'validity',
    'stats',
    'artifacts',
    'results',
    'fluxCurve',
    'potentialCurve',
    'planeNote',
    'runsPanel',
    'runsTable',
    'runsNote',
    'compare',
    'exportCsv',
    'exportJson',
    'clearRuns',
    'maintenance',
  ].map((key) => [
    key,
    document.getElementById(key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)),
  ]),
);

/* ---------------------------------------------------------------- the magnet */

/**
 * A 10 mm half-width iron core in a 15 mm bore, 10 mm of winding at 5 A/mm², μᵣ = 1000.
 * Ordinary numbers for a small laboratory electromagnet — and deliberately a cross-section that
 * **misses** the mission on two of its three targets: it carries 3.45 mWb/m against the 4.5
 * asked for, and leaks 1.7 % against the 1 % allowed. A default that already passed would leave
 * nothing to do.
 */
const SHAPE_DEFAULTS = {
  coreHalfWidth: 10,
  gap: 5,
  winding: 10,
  halfHeight: 30,
  muExponent: 3,
  currentDensity: 5,
};

const shape = { ...SHAPE_DEFAULTS };

/**
 * The controls are deliberately *independent* of one another.
 *
 * The protocol rejects regions that overlap partially — they describe an ambiguous material
 * assignment rather than nesting — so a form offering "core width" and "bore radius" as two
 * free sliders can be dragged into a payload the server refuses, and the visitor is left
 * reading a validation error about something they cannot see. Measuring the winding *outward
 * from the core* instead (core half-width, then an air gap, then a thickness) makes every
 * combination geometrically valid by construction: there is no ordering left to violate.
 *
 * Split into two groups by what kind of decision each is — the shape of the magnet, and what
 * it is made of and driven with — which is the same Design/Conditions split the airfoil uses.
 * Both groups together are the contract's §5: on this page the physical inputs *are* the
 * geometry, which is why the generated parameter form under Advanced holds numerics only.
 */
const DESIGN_CONTROLS = [
  {
    key: 'coreHalfWidth',
    label: t('solenoid.design.coreHalfWidth'),
    min: 2,
    max: 14,
    step: 0.5,
    unit: ' mm',
    title: t('solenoid.design.coreHalfWidthTitle'),
  },
  {
    key: 'gap',
    label: t('solenoid.design.gap'),
    min: 1,
    max: 10,
    step: 0.5,
    unit: ' mm',
    title: t('solenoid.design.gapTitle'),
  },
  {
    key: 'winding',
    label: t('solenoid.design.winding'),
    min: 3,
    max: 20,
    step: 0.5,
    unit: ' mm',
    title: t('solenoid.design.windingTitle'),
  },
  {
    key: 'halfHeight',
    label: t('solenoid.design.halfHeight'),
    min: 10,
    max: 45,
    step: 1,
    unit: ' mm',
    title: t('solenoid.design.halfHeightTitle'),
  },
];

const CONDITION_CONTROLS = [
  {
    key: 'muExponent',
    label: t('solenoid.design.permeability'),
    min: 0,
    max: 4,
    step: 0.05,
    unit: '',
    // A relative permeability worth exploring spans four decades — 1 (no core at all) to
    // 10 000 (a good soft ferrite). A linear slider would spend nine tenths of its travel
    // between 1000 and 10 000, where almost nothing changes, so the slider carries the
    // exponent and the readout shows the value.
    format: (value) => num(permeabilityFrom(value)),
    title: t('solenoid.design.permeabilityTitle'),
  },
  {
    key: 'currentDensity',
    label: t('solenoid.design.currentDensity'),
    min: 0.5,
    max: 10,
    step: 0.5,
    unit: ' A/mm²',
    title: t('solenoid.design.currentDensityTitle'),
  },
];

function permeabilityFrom(exponent) {
  return Math.round(10 ** exponent);
}

/** Total current through one side of the winding, in ampere-turns. Exact: no solve involved. */
function ampereTurns() {
  const area = (shape.winding / 1000) * ((2 * shape.halfHeight) / 1000); // m²
  return shape.currentDensity * 1e6 * area;
}

/** The magnet's half-extent, in millimetres: the larger of its two half-dimensions. */
function magnetHalfExtent() {
  return Math.max(shape.coreHalfWidth + shape.gap + shape.winding, shape.halfHeight);
}

/** Half-width of the square modelling window, in millimetres. Derived, never typed. */
function windowHalf() {
  return WINDOW_RATIO * magnetHalfExtent();
}

/**
 * The `regions2d` payload this page will submit.
 *
 * Lengths are in metres, because the protocol's bounds are; the sliders are in millimetres
 * because that is how someone thinks about a coil. Current density is signed: the plane cuts
 * one winding twice, and the current goes into the page on one side and out on the other. Give
 * both sides the same sign and you have modelled two coils fighting each other — which is a
 * perfectly good experiment, but not a solenoid, and the solver says so on the run.
 *
 * Only the keys each solver documents are set. `core` carries no `current_density`, so it
 * defaults to zero; the windings carry no `mu_r`, so they default to 1 — copper is
 * non-magnetic, which is the right answer rather than a convenient one. The core also carries
 * `b_sat`, the flux density its permeability collapses at: the protocol's material dict is an
 * open bag of scalars, and a solver that does not know the key ignores it.
 */
function buildGeometry() {
  const mm = (value) => value / 1000;
  const { coreHalfWidth: a, gap: g, winding: w, halfHeight: h } = shape;
  const bore = a + g;
  const outer = bore + w;
  const current = shape.currentDensity * 1e6; // A/mm² → A/m²
  const window = windowHalf();

  const rect = (x0, y0, x1, y1) => ({
    type: 'polygon2d',
    points: [
      [mm(x0), mm(y0)],
      [mm(x1), mm(y0)],
      [mm(x1), mm(y1)],
      [mm(x0), mm(y1)],
    ],
  });

  return {
    type: 'regions2d',
    bounds: [mm(-window), mm(-window), mm(window), mm(window)],
    background: { mu_r: 1.0 },
    regions: [
      {
        name: 'core',
        shape: rect(-a, -h, a, h),
        material: { mu_r: permeabilityFrom(shape.muExponent), b_sat: 1.5 },
      },
      {
        name: 'winding_left',
        shape: rect(-outer, -h, -bore, h),
        material: { current_density: -current },
      },
      {
        name: 'winding_right',
        shape: rect(bore, -h, outer, h),
        material: { current_density: current },
      },
    ],
  };
}

/** Redraw the cross-section and re-describe it. Called on every slider edit. */
function applyShape() {
  const { coreHalfWidth: a, gap: g, winding: w, halfHeight: h } = shape;
  const bore = a + g;
  const outer = bore + w;

  // The diagram frames the magnet with a margin, not the modelled window: at eight times the
  // half-extent the window would leave the cross-section a speck in the middle of an empty
  // box. The note below says how big the window actually is, which is the honest way to show
  // a thing that does not fit.
  const half = 1.2 * magnetHalfExtent();
  dom.schematic.setAttribute('viewBox', `${-half} ${-half} ${2 * half} ${2 * half}`);
  setLine(dom.axisV, 0, -half, 0, half);
  setLine(dom.axisH, -half, 0, half, 0);
  setLine(dom.midPlane, -a, 0, a, 0);

  setRect(dom.core, -a, -h, 2 * a, 2 * h);
  setRect(dom.windingLeft, -outer, -h, w, 2 * h);
  setRect(dom.windingRight, bore, -h, w, 2 * h);

  // What the page would submit right now, published on the diagram it describes. It costs one
  // attribute and it makes the payload inspectable — in the browser's element panel when a
  // solve is refused, and in the browser test, which asserts the region invariants across the
  // whole slider range without spending a solve on each combination.
  dom.schematic.dataset.geometry = JSON.stringify(buildGeometry());

  dom.shapeNote.textContent = t('solenoid.described', {
    core: 2 * a,
    bore: 2 * bore,
    winding: w,
    length: 2 * h,
    permeability: num(permeabilityFrom(shape.muExponent)),
    turns: num(Math.round(ampereTurns())),
    window: 2 * windowHalf(),
  });
  renderDerived();
  workspace?.draw();
}

function setRect(node, x, y, width, height) {
  node.setAttribute('x', String(x));
  node.setAttribute('y', String(y));
  node.setAttribute('width', String(width));
  node.setAttribute('height', String(height));
}

function setLine(node, x1, y1, x2, y2) {
  node.setAttribute('x1', String(x1));
  node.setAttribute('y1', String(y1));
  node.setAttribute('x2', String(x2));
  node.setAttribute('y2', String(y2));
}

/** What follows from the sliders, before anything has been solved. */
function renderDerived() {
  const { coreHalfWidth: a, winding: w, halfHeight: h } = shape;
  dom.derived.replaceChildren(
    entry(t('solenoid.derived.ampereTurns'), `${num(Math.round(ampereTurns()))} A`),
    entry(t('solenoid.derived.coreWidth'), `${((2 * a) / 1000).toFixed(4)} m`),
    entry(t('solenoid.derived.copper'), `${((w * 2 * h) / 1e6).toExponential(3)} m²`),
    entry(
      t('solenoid.derived.window'),
      t('solenoid.derived.windowValue', { size: 2 * windowHalf(), ratio: WINDOW_RATIO }),
    ),
    entry(t('solenoid.derived.permeability'), num(permeabilityFrom(shape.muExponent))),
  );
}

function entry(label, value) {
  return el('div', {}, el('dt', { text: label }), el('dd', { text: value }));
}

/* ---------------------------------------------------------- the solver parameter form */

/**
 * Which parameters the exercise offers, in display order, and which group each is in.
 *
 * All numerical — and that is not an accident of this solver but a property of `regions2d`:
 * the physics travels in the *geometry*, so the permeability, the current density and every
 * dimension are region properties rather than params. The Design and Conditions panels are
 * therefore the contract's §5, and this list is its numerical group. Arrived at from the other
 * side, and the same split.
 *
 * `core_region` is deliberately absent. It names which region is the magnetic circuit, and its
 * default — the most permeable region — is right for every cross-section this page can build.
 * Offering it would be offering a way to get a wrong answer.
 */
const PARAM_UI = [
  {
    name: 'cells_across',
    group: 'numerical',
    label: t('solenoid.params.cells'),
    hint: t('solenoid.params.cellsHint'),
  },
  {
    name: 'convergence_check',
    group: 'numerical',
    label: t('solenoid.params.convergence'),
    hint: t('solenoid.params.convergenceHint'),
  },
  {
    name: 'far_field_growth',
    group: 'numerical',
    label: t('solenoid.params.growth'),
    hint: t('solenoid.params.growthHint'),
    step: 0.05,
  },
  // `tolerance` is deliberately not offered. It is a logarithmic quantity spanning six decades
  // and its range is [0, 1e-4], so a linear slider over it can only ever read zero — a control
  // that cannot express its own parameter is worse than none. The default is right, and the
  // residual it governs is reported on every run, which is the half a visitor needs.
  {
    name: 'max_iterations',
    group: 'numerical',
    label: t('solenoid.params.iterations'),
    hint: t('solenoid.params.iterationsHint'),
    step: 1000,
  },
  {
    name: 'resolution',
    group: 'numerical',
    label: t('solenoid.params.resolution'),
    hint: t('solenoid.params.resolutionHint'),
  },
  {
    name: 'output',
    group: 'numerical',
    label: t('solenoid.params.output'),
    hint: t('solenoid.params.outputHint'),
    // The keys are the schema's enum values and go to the server unchanged.
    optionLabels: {
      grid2d: t('solenoid.params.outputGrid'),
      mesh2d: t('solenoid.params.outputMesh'),
    },
  },
];

/**
 * How each reported quantity is named in front of a person.
 *
 * One table, read by three things — the mission's targets, the headline tiles and the full
 * table — so `flux_core` and `b_section_max` cannot leak onto the screen from one of them while
 * the other two are polite. The keys are the report's; nothing else on the page knows them.
 */
const METRICS = [
  {
    key: 'flux_core',
    label: t('solenoid.metrics.flux'),
    symbol: 'Φ′',
    unit: 'Wb/m',
    digits: 6,
    hint: t('solenoid.metrics.fluxHint'),
  },
  {
    key: 'b_mean_core',
    label: t('solenoid.metrics.meanDensity'),
    symbol: 'B̄',
    unit: 'T',
    digits: 4,
    hint: t('solenoid.metrics.meanDensityHint'),
  },
  {
    key: 'b_section_max',
    label: t('solenoid.metrics.busiest'),
    symbol: 'B_sec',
    unit: 'T',
    digits: 4,
    hint: t('solenoid.metrics.busiestHint'),
  },
  {
    key: 'leakage_ratio',
    label: t('solenoid.metrics.leakage'),
    symbol: 'σ',
    unit: '1',
    digits: 4,
    hint: t('solenoid.metrics.leakageHint'),
  },
  {
    key: 'ampere_turns',
    label: t('solenoid.metrics.ampereTurns'),
    symbol: 'NI′',
    unit: 'A',
    digits: 0,
    hint: t('solenoid.metrics.ampereTurnsHint'),
  },
  {
    key: 'energy',
    label: t('solenoid.metrics.energy'),
    symbol: 'W′',
    unit: 'J/m',
    digits: 4,
    hint: t('solenoid.metrics.energyHint'),
  },
  {
    key: 'inductance_index',
    label: t('solenoid.metrics.permeance'),
    symbol: 'Φ′/NI′',
    unit: 'H/m',
    digits: 9,
    hint: t('solenoid.metrics.permeanceHint'),
  },
  {
    key: 'flux_total',
    label: t('solenoid.metrics.bundle'),
    symbol: 'Φ′tot',
    unit: 'Wb/m',
    digits: 6,
    hint: t('solenoid.metrics.bundleHint'),
  },
  {
    key: 'net_current',
    label: t('solenoid.metrics.netCurrent'),
    symbol: 'ΣI',
    unit: 'A',
    digits: 3,
    hint: t('solenoid.metrics.netCurrentHint'),
  },
];

/** The `key -> wording` table the challenge and the comparison read, built from the same list. */
const METRIC_LABELS = Object.fromEntries(METRICS.map((metric) => [metric.key, metric]));

/** The few numbers that answer the mission, shown before any table. */
const KPIS = [
  {
    key: 'flux_core',
    label: t('solenoid.metrics.flux'),
    symbol: '|Φ′|',
    unit: 'Wb/m',
    digits: 5,
    from: (report) =>
      typeof report.metrics?.flux_core === 'number' ? Math.abs(report.metrics.flux_core) : null,
    absent: t('solenoid.metrics.noCore'),
    hint: t('solenoid.metrics.fluxAbsHint'),
  },
  {
    key: 'ampere_turns',
    label: t('solenoid.metrics.ampereTurns'),
    symbol: 'NI′',
    unit: 'A',
    digits: 0,
  },
  {
    key: 'leakage_ratio',
    label: t('solenoid.metrics.leakage'),
    symbol: 'σ',
    unit: '1',
    digits: 4,
    absent: t('solenoid.metrics.noCore'),
  },
  {
    key: 'b_section_max',
    label: t('solenoid.metrics.busiest'),
    symbol: 'B_sec',
    unit: 'T',
    digits: 3,
    absent: t('solenoid.metrics.noCore'),
  },
  {
    key: 'inductance_index',
    label: t('solenoid.metrics.permeance'),
    symbol: 'Φ′/NI′',
    unit: 'H/m',
    digits: 8,
    absent: t('solenoid.metrics.noCore'),
  },
  { key: 'energy', label: t('solenoid.metrics.energy'), symbol: 'W′', unit: 'J/m', digits: 3 },
];

const CHECKS = [
  {
    key: 'energy_balance_rel',
    label: t('solenoid.checks.energy'),
    tolerance: 'energy_balance_tolerance',
    describe: t('solenoid.checks.energyDescribe'),
  },
  {
    key: 'flux_consistency_rel',
    label: t('solenoid.checks.flux'),
    tolerance: 'flux_consistency_tolerance',
    describe: t('solenoid.checks.fluxDescribe'),
  },
  {
    key: 'ampere_law_rel',
    label: t('solenoid.checks.ampere'),
    tolerance: 'ampere_law_tolerance',
    describe: t('solenoid.checks.ampereDescribe'),
  },
  {
    key: 'flux_convergence_rel',
    label: t('solenoid.checks.mesh'),
    tolerance: 'flux_convergence_tolerance',
    describe: t('solenoid.checks.meshDescribe'),
  },
  {
    key: 'linear_residual',
    label: t('solenoid.checks.linear'),
    tolerance: 'linear_residual_tolerance',
    describe: t('solenoid.checks.linearDescribe'),
  },
];

/**
 * How each field is presented: the colorbar caption, the colormap, the contours, and what to
 * say about it.
 *
 * The `contours` setting carries real weight on this page. The viewer draws iso-lines of
 * *whatever field is displayed*, and the iso-lines of A_z are exactly the magnetic field
 * lines — a fact worth having rather than a coincidence, since B is the in-plane curl of A_z
 * and so runs along its level sets. Contours of |B| are perfectly meaningful curves but they
 * are *not* field lines, and drawing them in the same white line style would invite exactly
 * that misreading. So A gets contours and nothing else does, and the hints say why.
 *
 * The captions are units and one Greek letter, so they are the same in both languages — and
 * they have to stay short whatever the language, because the widget right-aligns them against
 * the topmost tick of the colour bar.
 */
const FIELD_VIEW = {
  B: {
    option: t('solenoid.fields.b'),
    caption: 'T',
    colormap: 'viridis',
    contours: 0,
    hint: t('solenoid.fields.bHint'),
  },
  A: {
    option: t('solenoid.fields.a'),
    caption: 'Wb/m',
    colormap: 'viridis',
    contours: 14,
    hint: t('solenoid.fields.aHint'),
  },
  H: {
    option: t('solenoid.fields.h'),
    caption: 'kA/m',
    colormap: 'plasma',
    contours: 0,
    hint: t('solenoid.fields.hHint'),
  },
  mu_r: {
    option: t('solenoid.fields.mu'),
    caption: 'μᵣ',
    // Greyscale, and no contours: this is not a computed field but a picture of which material
    // the solver put where. Every interface lands on a cell face, so the core is exactly as
    // wide here as it is on the diagram — which is the whole point of the fitted grid.
    colormap: 'greyscale',
    contours: 0,
    hint: t('solenoid.fields.muHint'),
  },
};

/* --------------------------------------------------------------------- the solve */

/**
 * The parameter group, a *live* object that its own controls mutate in place.
 *
 * One group rather than three because this solver has only numerical parameters. Kept as the
 * object `buildParamForm` returns rather than a copy of it: copying — `params = {...form}` —
 * produces something that looks right and then never changes again, which is a bug you only
 * see by moving a slider and watching the result not move. That has already happened here once.
 */
const forms = { numerical: {} };
let catalogue = { all: [], byMode: {} };
let report = null;
let running = false;
let currentJob = null;
let selected = new Set();
let workspace = null;
let content = null;

function currentParams() {
  return { ...forms.numerical };
}

function solver() {
  return catalogue.all.find((entry) => entry.name.startsWith(SOLVER_PREFIX)) ?? null;
}

async function run() {
  if (running) return;
  const chosen = solver();
  if (!chosen) {
    setStatusOn(dom, t('solenoid.noSolver'), 'error');
    return;
  }

  running = true;
  dom.artifacts.replaceChildren();

  try {
    const result = await runSolve({
      dom,
      solver: chosen.name,
      geometry: buildGeometry(),
      params: currentParams(),
      onJob: (job) => {
        currentJob = job;
      },
    });
    if (!result) return;

    const first = report === null;
    report = await fetchReport(result);
    addFieldStrength(result);
    // Explore comes after Run: the result section only exists once there is a result, which
    // is what removes the row of "Nothing computed yet" panels the page used to open with.
    dom.results.hidden = false;
    workspace.setResult(result);
    // The window is eight times the magnet, so the whole domain is the wrong first view of a
    // result — the subject would arrive as a bright speck in a large dark square. Framing the
    // magnet is what a visitor would do next anyway. Only on the *first* result: after that the
    // view is theirs, and re-framing it under them on every run would undo their exploring.
    if (first) workspace.fit();
    syncFieldOptions(dom.viewer, dom.field, FIELD_VIEW, dom.fieldHint);
    showStats(dom.stats, result);
    showArtifacts(dom.artifacts, result.artifacts);
    present();
    setStatusOn(dom, t('experiment.done'), 'done');
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

/**
 * Magnetic field strength H, derived in the browser from what the solver returned.
 *
 * The solver publishes A, |B| and μᵣ and no H — but H needs no solving, because it is B and μᵣ
 * at the same point:
 *
 *     B = μ₀ μᵣ H      ⟹      H = |B| / (μ₀ μᵣ)
 *
 * It is worth deriving because it is the field that makes a magnetic circuit legible. |B| is
 * large inside the iron and H is small there; step across the interface into air and B falls
 * while H does not. Seeing the two side by side is seeing why a core concentrates flux: not by
 * creating field, but by offering it a path that costs almost no H to drive.
 *
 * Reported in kA/m rather than A/m so the colorbar reads in ordinary numbers — the viewer
 * switches to exponential notation above 10⁴, and H in air here is a few tens of kA/m.
 *
 * Returns silently unmodified when the result carries no μᵣ, which is the honest outcome for a
 * solver that did not publish one rather than a field derived from an assumption.
 */
function addFieldStrength(result) {
  const fields = scalarsOf(result);
  const flux = fields?.B;
  const permeability = fields?.mu_r;
  if (!flux || !permeability) return result;

  fields.H = Array.from(
    flux,
    (value, index) => value / (MU0 * Math.max(permeability[index], 1e-12)) / 1000,
  );
  return result;
}

/* ------------------------------------------------------------------------- presentation */

function present() {
  renderChallenge(dom.challenge, content?.challenge, report, METRIC_LABELS);
  renderKpis(dom.kpis, KPIS, report);
  renderMetrics(dom.metrics, METRICS, report);
  renderVerification(dom.verification, CHECKS, report);
  renderValidity(dom.validity, report);
  declareOverlays();

  if (!report) return;

  // Millimetres on the axis, metres in the data. The curve is read by a person, and a tick
  // labelled 0.015 is a tick nobody converts in their head.
  //
  // Cropped to a few times the magnet, because the window is eight times it and everything
  // worth seeing — the core, the sign change, the decay — happens in the first eighth. Plotted
  // whole, the structure is a spike at the origin of a flat line, which is a picture of the
  // truncation rather than of the magnet.
  const limit = 2.5 * (shape.coreHalfWidth + shape.gap + shape.winding);
  const toMm = (points) =>
    points.map(([x, y]) => [1000 * x, y]).filter(([x]) => Math.abs(x) <= limit);
  const halfCore = 500 * (report.geometry?.core_width ?? 0);
  const bundle = report.validity?.bundle_x ?? null;
  const marks = [
    { y: 0 },
    ...(halfCore ? [{ x: -halfCore, label: t('solenoid.plots.core') }, { x: halfCore }] : []),
    ...(bundle ? bundle.map((x) => ({ x: 1000 * x })) : []),
  ];

  drawCurve(dom.fluxCurve, {
    traces: [{ name: 'B_y', points: toMm(report.curves.b_y) }],
    xLabel: t('solenoid.plots.xAxis'),
    yLabel: t('solenoid.plots.fluxAxis'),
    marks,
  });
  drawCurve(dom.potentialCurve, {
    traces: [{ name: 'A_z', points: toMm(report.curves.a_z) }],
    xLabel: t('solenoid.plots.xAxis'),
    yLabel: t('solenoid.plots.potentialAxis'),
    marks,
  });

  // `leakage_ratio` is null when the bundle carries no flux at all — the marks still exist,
  // because they are where A_z turns over, and the ratio they would be part of does not. Read
  // through `Number.isFinite` rather than trusting the branch: `100 * null` is 0 in JavaScript,
  // so the arithmetic would have printed a confident "0.00 %" for a quantity that has no value.
  const leakage = report.metrics.leakage_ratio;
  const share = Number.isFinite(leakage)
    ? t('solenoid.plots.leakageShare', { value: (100 * leakage).toFixed(2) })
    : t('solenoid.plots.noBundle');

  dom.planeNote.textContent = bundle
    ? t('solenoid.plots.note', {
        share,
        limit: limit.toFixed(0),
        window: windowHalf(),
      })
    : t('solenoid.plots.noCoreNote');
}

/* --------------------------------------------------------------- the annotation layer */

/** Region outlines over the field, and the surfaces every reported number is measured on. */
function declareOverlays() {
  const noRun = t('workspace.noRun');
  workspace.setOverlays([
    { id: 'regions', label: t('solenoid.overlays.regions'), colour: 'var(--core)', on: true },
    { id: 'axis', label: t('solenoid.overlays.axis'), colour: 'var(--overlay-chord)', on: false },
    {
      id: 'plane',
      label: t('solenoid.overlays.plane'),
      colour: 'var(--overlay-cp)',
      on: true,
      enabled: Boolean(report?.geometry?.core_width),
      why: report ? t('solenoid.overlays.planeWhy') : noRun,
      title: t('solenoid.overlays.planeTitle'),
    },
    {
      id: 'bundle',
      label: t('solenoid.overlays.bundle'),
      colour: 'var(--overlay-peak)',
      enabled: Boolean(report?.validity?.bundle_x),
      why: report ? t('solenoid.overlays.bundleWhy') : noRun,
      title: t('solenoid.overlays.bundleTitle'),
    },
    {
      id: 'contour',
      label: t('solenoid.overlays.contour'),
      colour: 'var(--overlay-ac)',
      enabled: Boolean(report?.validity?.ampere_contour),
      why: noRun,
      title: t('solenoid.overlays.contourTitle'),
    },
  ]);
}

function drawOverlay({ svg, project, layerOn, bounds }) {
  if (layerOn('regions')) {
    const payload = buildGeometry();
    const group = svgNode('g', { class: 'overlay__regions' });
    for (const region of payload.regions) {
      const ring = [...region.shape.points, region.shape.points[0]].map(project);
      group.append(polyline(ring, `overlay__region overlay__region--${region.name.split('_')[0]}`));
    }
    svg.append(group);
  }
  if (layerOn('axis')) {
    const [xmin, ymin, xmax, ymax] = bounds;
    const group = svgNode('g', { class: 'overlay__chord' });
    group.append(polyline([project([0, ymin]), project([0, ymax])], 'overlay__chordline'));
    group.append(polyline([project([xmin, 0]), project([xmax, 0])], 'overlay__chordline'));
    svg.append(group);
  }
  if (layerOn('plane') && report?.geometry?.core_width) {
    const half = report.geometry.core_width / 2;
    const y = report.geometry.mid_plane_y ?? 0;
    const group = svgNode('g', { class: 'overlay__plane' });
    group.append(polyline([project([-half, y]), project([half, y])], 'overlay__planeline'));
    group.append(marker(project([half, y]), 'Φ′', 'overlay__cp'));
    svg.append(group);
  }
  if (layerOn('bundle') && report?.validity?.bundle_x) {
    const [left, right] = report.validity.bundle_x;
    const y = report.geometry?.mid_plane_y ?? 0;
    const reach = Math.abs(right - left) * 0.12;
    const group = svgNode('g', { class: 'overlay__bundle' });
    for (const x of [left, right]) {
      group.append(
        polyline([project([x, y - reach]), project([x, y + reach])], 'overlay__bundleline'),
      );
    }
    group.append(marker(project([right, y]), t('solenoid.plots.bundle'), 'overlay__peak'));
    svg.append(group);
  }
  if (layerOn('contour') && report?.validity?.ampere_contour) {
    const [x0, y0, x1, y1] = report.validity.ampere_contour;
    const ring = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ].map(project);
    const group = svgNode('g', { class: 'overlay__contour' });
    group.append(polyline(ring, 'overlay__contourline'));
    group.append(marker(project([x1, y1]), '∮H·dl', 'overlay__ac'));
    svg.append(group);
  }
}

/** The box "Fit magnet" frames: the core and both windings, in metres. */
function magnetBox() {
  const outer = (shape.coreHalfWidth + shape.gap + shape.winding) / 1000;
  const half = shape.halfHeight / 1000;
  return [-outer, -half, outer, half];
}

/* -------------------------------------------------------------------------- the run table */

/** What the table shows at a glance. Everything else stays in the row, for Compare and export. */
const COLUMNS = [
  { path: 'geometry.label', label: t('solenoid.columns.section') },
  // The symbol columns are symbols in both languages: an Italian engineer reads Φ′ as Φ′.
  { path: 'metrics.flux_core', label: 'Φ′ Wb/m' },
  { path: 'metrics.ampere_turns', label: 'NI′ A' },
  { path: 'metrics.leakage_ratio', label: t('solenoid.columns.leakage') },
  { path: 'metrics.b_section_max', label: 'B_sec T' },
  { path: 'physical.mu_r', label: 'μᵣ' },
  { path: 'numerics.cells_across', label: t('solenoid.columns.cells') },
  { path: 'verification.energy_balance_rel', label: t('solenoid.columns.energy') },
];

/** One row: every input, the answer, the residuals, the warnings, the provenance. */
function row() {
  const mm = (value) => value / 1000;
  return {
    exercise: { id: EXERCISE, version: '1.0.0' },
    solver: report.solver,
    model: report.model,
    geometry: {
      source: 'parametric',
      label: describeShape(),
      core_half_width_m: mm(shape.coreHalfWidth),
      gap_m: mm(shape.gap),
      winding_m: mm(shape.winding),
      half_height_m: mm(shape.halfHeight),
      window_half_m: mm(windowHalf()),
      window_ratio: WINDOW_RATIO,
      core_width_m: report.geometry.core_width,
      mid_plane_y_m: report.geometry.mid_plane_y,
      interface_fitted: report.geometry.interface_fitted,
      regions: report.geometry.regions,
    },
    physical: {
      mu_r: permeabilityFrom(shape.muExponent),
      current_density: shape.currentDensity * 1e6,
      b_sat: report.model.saturation_flux_density,
    },
    // From the report, not from `currentParams()`: the page does not offer every parameter the
    // solver has — the tolerance is logarithmic and has no usable slider — and a row recording
    // only the offered ones would be missing inputs it cannot be recomputed without. The solver
    // echoes what it resolved, which is the thing that actually ran.
    numerics: { ...report.numerics, cells: report.geometry.cells },
    dimensionless: report.dimensionless,
    metrics: report.metrics,
    verification: report.verification,
    validity: report.validity,
    cost: { cells: report.geometry.cells },
  };
}

/** A cross-section deserves a name, and its four dimensions are one. */
function describeShape() {
  const { coreHalfWidth: a, gap: g, winding: w, halfHeight: h } = shape;
  return t('solenoid.shapeLabel', { core: 2 * a, length: 2 * h, winding: w, gap: g });
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
}

/** Put a saved row's inputs back on the page. Does not re-solve: Run is still the visitor's. */
function loadRun(entry) {
  Object.assign(shape, {
    coreHalfWidth: 1000 * entry.geometry.core_half_width_m,
    gap: 1000 * entry.geometry.gap_m,
    winding: 1000 * entry.geometry.winding_m,
    halfHeight: 1000 * entry.geometry.half_height_m,
    muExponent: Math.log10(Math.max(entry.physical.mu_r, 1)),
    currentDensity: entry.physical.current_density / 1e6,
  });
  buildShapeControls(dom.shapeControls, DESIGN_CONTROLS, shape, applyShape);
  buildShapeControls(dom.conditions, CONDITION_CONTROLS, shape, applyShape);

  // Rebuilt from the saved values rather than assigned into the live object: `buildParamForm`
  // carries across any previous value the current schema still admits, which is exactly the
  // rule a loaded row needs.
  buildForms({ ...currentParams(), ...entry.numerics });
  applyShape();
  setStatusOn(dom, t('experiment.loaded', { label: entry.geometry.label }));
}

function buildForms(previous = currentParams()) {
  const chosen = solver();
  if (!chosen) return;
  const byGroup = groupParameters(PARAM_UI);
  forms.numerical = buildParamForm(dom.numerical, chosen, byGroup.numerical, previous);
}

/* ---------------------------------------------------------------------- start-up */

mountChrome('experiments');
buildShapeControls(dom.shapeControls, DESIGN_CONTROLS, shape, applyShape);
buildShapeControls(dom.conditions, CONDITION_CONTROLS, shape, applyShape);

workspace = createWorkspace({
  root: dom.workspace,
  viewer: dom.viewer,
  editor: null,
  fitLabel: t('solenoid.fitMagnet'),
  exportName: 'solenoid-field',
  subject: magnetBox,
  onDraw: drawOverlay,
});

applyShape();
declareOverlays();

dom.run.addEventListener('click', run);
dom.cancel.addEventListener('click', () => currentJob?.cancel());
dom.reset.addEventListener('click', () => {
  Object.assign(shape, SHAPE_DEFAULTS);
  buildShapeControls(dom.shapeControls, DESIGN_CONTROLS, shape, applyShape);
  buildShapeControls(dom.conditions, CONDITION_CONTROLS, shape, applyShape);
  applyShape();
});
dom.derivedToggle.addEventListener('click', () => {
  const open = dom.derivedWrap.hidden;
  dom.derivedWrap.hidden = !open;
  dom.derivedToggle.setAttribute('aria-expanded', String(open));
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
  runs.download('solenoid-runs.csv', runs.toCsv(runs.load(EXERCISE)), 'text/csv'),
);
dom.exportJson.addEventListener('click', () =>
  runs.download('solenoid-runs.json', runs.toJson(runs.load(EXERCISE)), 'application/json'),
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
    fetch(contentUrl(EXERCISE)).then((response) => response.json()),
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
    workspace.draw();
  }

  const canSolve = applyMaintenance(
    dom,
    info,
    t('bench.maintenance', { alternative: t('solenoid.maintenanceAlternative') }),
  );

  if (!chosen) {
    setStatusOn(dom, t('solenoid.noSolverHere'), 'error');
  } else if (!canSolve) {
    setStatusOn(dom, t('experiment.maintenanceStatus'));
  } else {
    dom.run.disabled = false;
    setStatusOn(dom, t('solenoid.ready'));
  }
} catch (error) {
  setStatusOn(dom, t('experiment.unreachable', { detail: describeError(error) }), 'error');
  dom.run.disabled = true;
}
