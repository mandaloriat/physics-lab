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
    label: 'Core half-width',
    min: 2,
    max: 14,
    step: 0.5,
    unit: ' mm',
    title:
      'Half the thickness of the iron bar down the middle. It sets the area the flux has to fit through, so it moves the flux density more than the flux.',
  },
  {
    key: 'gap',
    label: 'Air gap',
    min: 1,
    max: 10,
    step: 0.5,
    unit: ' mm',
    title:
      'Clearance between the core and the winding — the space insulation and formers take. It is what leakage is bought with: a tight gap keeps the copper’s field in the iron.',
  },
  {
    key: 'winding',
    label: 'Winding thickness',
    min: 3,
    max: 20,
    step: 0.5,
    unit: ' mm',
    title: 'How far the copper extends outward. Thicker winding, more ampere-turns.',
  },
  {
    key: 'halfHeight',
    label: 'Half-height',
    min: 10,
    max: 45,
    step: 1,
    unit: ' mm',
    title:
      'Half the length of the core and the coil, along the axis. It buys ampere-turns and shortens the return path relative to the magnet, which is usually the most effective thing on this page.',
  },
];

const CONDITION_CONTROLS = [
  {
    key: 'muExponent',
    label: 'Core permeability μᵣ',
    min: 0,
    max: 4,
    step: 0.05,
    unit: '',
    // A relative permeability worth exploring spans four decades — 1 (no core at all) to
    // 10 000 (a good soft ferrite). A linear slider would spend nine tenths of its travel
    // between 1000 and 10 000, where almost nothing changes, so the slider carries the
    // exponent and the readout shows the value.
    format: (value) => permeabilityFrom(value).toLocaleString('en-US'),
    title:
      'How much more easily the core carries flux than air. 1 means no core; iron is 10³–10⁴. Past about 1000 it stops helping, because the flux still has to return through air.',
  },
  {
    key: 'currentDensity',
    label: 'Current density',
    min: 0.5,
    max: 10,
    step: 0.5,
    unit: ' A/mm²',
    title:
      'Current per unit area of copper. Around 5 A/mm² is a conventionally cooled winding. The model is linear, so this scales every field exactly.',
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

  const permeability = permeabilityFrom(shape.muExponent).toLocaleString('en-US');
  const turns = Math.round(ampereTurns()).toLocaleString('en-US');
  dom.shapeNote.textContent =
    `Core ${2 * a} mm across in a ${2 * bore} mm bore, ${w} mm of winding, ` +
    `${2 * h} mm long. μᵣ = ${permeability}, and ${turns} ampere-turns per side. ` +
    `Solved in a ${2 * windowHalf()} mm window, which is too large to draw here.`;
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
    entry('Ampere-turns per side', `${Math.round(ampereTurns()).toLocaleString('en-US')} A`),
    entry('Core width', `${((2 * a) / 1000).toFixed(4)} m`),
    entry('Copper section', `${((w * 2 * h) / 1e6).toExponential(3)} m²`),
    entry('Modelled window', `${2 * windowHalf()} mm square, ${WINDOW_RATIO}× the magnet`),
    entry('Core permeability', permeabilityFrom(shape.muExponent).toLocaleString('en-US')),
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
    label: 'Cells across the magnet',
    hint: 'Across the regions, not the window — so widening the window does not coarsen the iron.',
  },
  {
    name: 'convergence_check',
    group: 'numerical',
    label: 'Check convergence',
    hint: 'Also solve at twice the resolution, and report how far the flux density moved.',
  },
  {
    name: 'far_field_growth',
    group: 'numerical',
    label: 'Far-field growth',
    hint: 'How fast cells grow out in the air. 1.0 is a uniform grid, and a costly one.',
    step: 0.05,
  },
  // `tolerance` is deliberately not offered. It is a logarithmic quantity spanning six decades
  // and its range is [0, 1e-4], so a linear slider over it can only ever read zero — a control
  // that cannot express its own parameter is worse than none. The default is right, and the
  // residual it governs is reported on every run, which is the half a visitor needs.
  {
    name: 'max_iterations',
    group: 'numerical',
    label: 'Iteration ceiling',
    hint: 'A four-decade permeability contrast needs the room. Raise it if a solve stops short.',
    step: 1000,
  },
  {
    name: 'resolution',
    group: 'numerical',
    label: 'Field resolution',
    hint: 'Affects the picture and no reported number.',
  },
  {
    name: 'output',
    group: 'numerical',
    label: 'Result kind',
    hint: 'The mesh shows the interface-fitted cells; the grid is a resampling of them.',
    optionLabels: { grid2d: 'regular grid', mesh2d: 'the solver’s own cells' },
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
    label: 'Core flux',
    symbol: 'Φ′',
    unit: 'Wb/m',
    digits: 6,
    hint: 'Per metre of depth, across the core’s mid-plane. Negative because it crosses downward — the sign is the winding sense, and the mission is set on the magnitude.',
  },
  {
    key: 'b_mean_core',
    label: 'Mean flux density',
    symbol: 'B̄',
    unit: 'T',
    digits: 4,
    hint: 'The core flux divided by the core’s width, at the mid-plane.',
  },
  {
    key: 'b_section_max',
    label: 'Busiest section',
    symbol: 'B_sec',
    unit: 'T',
    digits: 4,
    hint: 'The same quantity at every height along the core, maximised. This is what saturates, and it is a section average rather than a peak on purpose.',
  },
  {
    key: 'leakage_ratio',
    label: 'Leakage',
    symbol: 'σ',
    unit: '1',
    digits: 4,
    hint: 'The share of the flux crossing the mid-plane that misses the iron, measured against the whole bundle.',
  },
  {
    key: 'ampere_turns',
    label: 'Ampere-turns',
    symbol: 'NI′',
    unit: 'A',
    digits: 0,
    hint: 'Through one side of the winding. Exact — a property of the geometry, needing no solve.',
  },
  {
    key: 'energy',
    label: 'Stored energy',
    symbol: 'W′',
    unit: 'J/m',
    digits: 4,
    hint: 'Inside the modelled window, per metre of depth. Bounded by the window rather than by space.',
  },
  {
    key: 'inductance_index',
    label: 'Permeance',
    symbol: 'Φ′/NI′',
    unit: 'H/m',
    digits: 9,
    hint: 'The magnetic circuit’s own figure of merit. Multiply by turns squared and by the real depth for an inductance.',
  },
  {
    key: 'flux_total',
    label: 'Whole flux bundle',
    symbol: 'Φ′tot',
    unit: 'Wb/m',
    digits: 6,
    hint: 'Everything crossing the mid-plane in one direction, core and air together. The leakage is measured against this.',
  },
  {
    key: 'net_current',
    label: 'Net current',
    symbol: 'ΣI',
    unit: 'A',
    digits: 3,
    hint: 'Zero for a coil. Anything else is a wire, whose far field the modelled window cannot hold.',
  },
];

/** The `key -> wording` table the challenge and the comparison read, built from the same list. */
const METRIC_LABELS = Object.fromEntries(METRICS.map((metric) => [metric.key, metric]));

/** The few numbers that answer the mission, shown before any table. */
const KPIS = [
  {
    key: 'flux_core',
    label: 'Core flux',
    symbol: '|Φ′|',
    unit: 'Wb/m',
    digits: 5,
    from: (report) =>
      typeof report.metrics?.flux_core === 'number' ? Math.abs(report.metrics.flux_core) : null,
    absent: 'no core in this geometry',
    hint: 'The magnitude, which is what the mission is set on. The signed value is in the table.',
  },
  { key: 'ampere_turns', label: 'Ampere-turns', symbol: 'NI′', unit: 'A', digits: 0 },
  {
    key: 'leakage_ratio',
    label: 'Leakage',
    symbol: 'σ',
    unit: '1',
    digits: 4,
    absent: 'no core in this geometry',
  },
  {
    key: 'b_section_max',
    label: 'Busiest section',
    symbol: 'B_sec',
    unit: 'T',
    digits: 3,
    absent: 'no core in this geometry',
  },
  {
    key: 'inductance_index',
    label: 'Permeance',
    symbol: 'Φ′/NI′',
    unit: 'H/m',
    digits: 8,
    absent: 'no core in this geometry',
  },
  { key: 'energy', label: 'Stored energy', symbol: 'W′', unit: 'J/m', digits: 3 },
];

const CHECKS = [
  {
    key: 'energy_balance_rel',
    label: 'Energy two ways',
    tolerance: 'energy_balance_tolerance',
    describe: 'Energy from the field against energy from the sources. Equal for a linear medium.',
  },
  {
    key: 'flux_consistency_rel',
    label: 'Core flux two ways',
    tolerance: 'flux_consistency_tolerance',
    describe: 'The drop in A_z across the core against the integral of B along the same line.',
  },
  {
    key: 'ampere_law_rel',
    label: 'Ampère’s law',
    tolerance: 'ampere_law_tolerance',
    describe: 'H·dl round a contour in the air against the current it encloses.',
  },
  {
    key: 'flux_convergence_rel',
    label: 'Mesh convergence',
    tolerance: 'flux_convergence_tolerance',
    describe: 'Change in the mean flux density when the resolution is doubled.',
  },
  {
    key: 'linear_residual',
    label: 'Linear solve',
    tolerance: 'linear_residual_tolerance',
    describe: 'How far the conjugate-gradient solve got, against what it was asked for.',
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
 */
const FIELD_VIEW = {
  B: {
    option: 'Flux density, |B|',
    caption: 'T',
    colormap: 'viridis',
    contours: 0,
    hint:
      'Flux density, in tesla — what a Hall probe or a Gauss meter measures. Bright is where ' +
      'the flux is concentrated. Switch to A to see the field lines it runs along, or turn on ' +
      'Streamlines: this solver publishes B as a vector, so they are integrated rather than drawn.',
  },
  A: {
    option: 'Vector potential, A_z (field lines)',
    caption: 'Wb/m',
    colormap: 'viridis',
    contours: 14,
    hint:
      'Vector potential A_z, the quantity actually solved for. Its contour lines are the ' +
      'magnetic field lines: closely spaced lines mean strong B, and the flux between any two ' +
      'of them is the same everywhere along their length. Every flux this page reports is a ' +
      'difference of this field between two points.',
  },
  H: {
    option: 'Field strength, H',
    caption: 'kA/m',
    colormap: 'plasma',
    contours: 0,
    hint:
      'Field strength, H = |B| / (μ₀ μᵣ), derived here rather than solved. Compare it with |B| ' +
      'inside the core: B is large there and H is small, which is what a high permeability means.',
  },
  mu_r: {
    option: 'Material map, μᵣ',
    caption: 'μᵣ',
    // Greyscale, and no contours: this is not a computed field but a picture of which material
    // the solver put where. Every interface lands on a cell face, so the core is exactly as
    // wide here as it is on the diagram — which is the whole point of the fitted grid.
    colormap: 'greyscale',
    contours: 0,
    hint:
      'Not a result but a check: where the solver placed the iron. Every material boundary is a ' +
      'cell face rather than a staircase, which is what makes the core exactly as wide as drawn.',
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
    setStatusOn(dom, 'This server has no solver that reports magnetic metrics.', 'error');
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
    ...(halfCore ? [{ x: -halfCore, label: 'core' }, { x: halfCore }] : []),
    ...(bundle ? bundle.map((x) => ({ x: 1000 * x })) : []),
  ];

  drawCurve(dom.fluxCurve, {
    traces: [{ name: 'B_y', points: toMm(report.curves.b_y) }],
    xLabel: 'x, mm',
    yLabel: 'B_y, T',
    marks,
  });
  drawCurve(dom.potentialCurve, {
    traces: [{ name: 'A_z', points: toMm(report.curves.a_z) }],
    xLabel: 'x, mm',
    yLabel: 'A_z, Wb/m',
    marks,
  });

  // `leakage_ratio` is null when the bundle carries no flux at all — the marks still exist,
  // because they are where A_z turns over, and the ratio they would be part of does not. Read
  // through `Number.isFinite` rather than trusting the branch: `100 * null` is 0 in JavaScript,
  // so the arithmetic would have printed a confident "0.00 %" for a quantity that has no value.
  const leakage = report.metrics.leakage_ratio;
  const share = Number.isFinite(leakage)
    ? `Leakage is one minus their ratio — ${(100 * leakage).toFixed(2)} % on this run.`
    : 'No flux crosses this plane in either direction on this run, so there is no bundle for ' +
      'the core flux to be a share of, and no leakage is reported.';

  dom.planeNote.textContent = bundle
    ? 'The inner pair of marks is the core, the outer pair is where B_y changes sign. The drop ' +
      'in A_z across the inner pair is the core flux; across the outer pair, the whole bundle. ' +
      `${share} The outer marks sit where B_y crosses zero, which is what makes that ` +
      'surface — and therefore the leakage — insensitive to exactly where it is placed. ' +
      `Shown out to ±${limit.toFixed(0)} mm; the solve runs to ±${windowHalf()} mm, where A_z ` +
      'reaches the zero the boundary condition imposes.'
    : 'Nothing in this geometry is magnetic, so there is no core flux to mark and no leakage ' +
      'to measure. The curves are still the field along the same line.';
}

/* --------------------------------------------------------------- the annotation layer */

/** Region outlines over the field, and the surfaces every reported number is measured on. */
function declareOverlays() {
  const noRun = 'Run the solve first.';
  workspace.setOverlays([
    { id: 'regions', label: 'Core & windings', colour: 'var(--core)', on: true },
    { id: 'axis', label: 'Axis', colour: 'var(--overlay-chord)', on: false },
    {
      id: 'plane',
      label: 'Flux surface',
      colour: 'var(--overlay-cp)',
      on: true,
      enabled: Boolean(report?.geometry?.core_width),
      why: report ? 'This geometry has no core, so there is no surface to measure across.' : noRun,
      title: 'The core’s mid-plane: the surface the core flux is measured across',
    },
    {
      id: 'bundle',
      label: 'Flux bundle',
      colour: 'var(--overlay-peak)',
      enabled: Boolean(report?.validity?.bundle_x),
      why: report ? 'This run reports no bundle, so the leakage is not defined.' : noRun,
      title: 'Where B_y changes sign — the ends of the bundle the leakage is measured against',
    },
    {
      id: 'contour',
      label: 'Ampère contour',
      colour: 'var(--overlay-ac)',
      enabled: Boolean(report?.validity?.ampere_contour),
      why: noRun,
      title: 'The closed path H·dl is integrated around, and the winding it encloses',
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
    group.append(marker(project([right, y]), 'bundle', 'overlay__peak'));
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
  { path: 'geometry.label', label: 'Cross-section' },
  { path: 'metrics.flux_core', label: 'Φ′ Wb/m' },
  { path: 'metrics.ampere_turns', label: 'NI′ A' },
  { path: 'metrics.leakage_ratio', label: 'leakage' },
  { path: 'metrics.b_section_max', label: 'B_sec T' },
  { path: 'physical.mu_r', label: 'μᵣ' },
  { path: 'numerics.cells_across', label: 'cells/magnet' },
  { path: 'verification.energy_balance_rel', label: 'energy check' },
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
  return `${2 * a}×${2 * h} core, ${w} mm winding at ${g} mm`;
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
  setStatusOn(
    dom,
    `Loaded the inputs of the ${entry.geometry.label} run. Press Run to recompute it.`,
  );
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
  fitLabel: 'Fit magnet',
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
    fetch('/experiments/solenoid/content.json').then((response) => response.json()),
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
    'The lab is not accepting new simulations right now. You can still read the problem, change the cross-section and look at any runs you have kept.',
  );

  if (!chosen) {
    setStatusOn(
      dom,
      'This server has no solver that reports magnetic metrics, so this exercise cannot be run here.',
      'error',
    );
  } else if (!canSolve) {
    setStatusOn(dom, 'Simulations are paused for maintenance.');
  } else {
    dom.run.disabled = false;
    setStatusOn(dom, 'Press Run to solve the cross-section as it stands.');
  }
} catch (error) {
  setStatusOn(dom, `Cannot reach the server — ${describeError(error)}`, 'error');
  dom.run.disabled = true;
}
