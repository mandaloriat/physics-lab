/**
 * Wind tunnel — the airfoil experiment.
 *
 * Everything simulation-related is Fenix Spoon's: `<fs-geometry-2d>` produces protocol
 * geometry, `@fenix-spoon/client` submits the job and streams progress, `<fs-viewer>` renders
 * the result. Everything page-shaped is `shared/experiment.js`: the parameter form, the solver
 * picker, the status line, the result panel and the lesson.
 *
 * What is left in this file is the experiment itself — a profile the visitor can reason about
 * in physical terms, the pressure coefficient derived from what the solver returned, and how
 * each field should be read.
 */

import '@fenix-spoon/geometry-2d';
import '@fenix-spoon/viewer';

import { solversFor } from '/shared/api.js';
import { describeError, health, mountChrome } from '/shared/components.js';
import {
  applyFieldView,
  applyMaintenance,
  buildParamForm,
  buildShapeControls,
  describeSolver,
  fillSolverPicker,
  renderLesson,
  runSolve,
  scalarsOf,
  setStatusOn,
  showArtifacts,
  showStats,
  syncFieldOptions,
} from '/shared/experiment.js';

const GEOMETRY_TYPE = 'domain2d';

const dom = {
  intro: document.getElementById('intro'),
  lesson: document.getElementById('lesson'),
  editor: document.getElementById('editor'),
  viewer: document.getElementById('viewer'),
  status: document.getElementById('status'),
  dot: document.getElementById('dot'),
  progress: document.getElementById('progress'),
  run: document.getElementById('run'),
  cancel: document.getElementById('cancel'),
  reset: document.getElementById('reset'),
  solver: document.getElementById('solver'),
  solverHint: document.getElementById('solver-hint'),
  solverParams: document.getElementById('solver-params'),
  shapeControls: document.getElementById('shape-controls'),
  shapeNote: document.getElementById('shape-note'),
  field: document.getElementById('field'),
  fieldHint: document.getElementById('field-hint'),
  stats: document.getElementById('stats'),
  artifacts: document.getElementById('artifacts'),
  maintenance: document.getElementById('maintenance'),
};

/* ------------------------------------------------------------------ the profile */

/** Where the maximum camber sits along the chord. Fixed at the NACA-4 convention. */
const CAMBER_POSITION = 0.4;

/** NACA 2412 at a few degrees — cambered enough that the asymmetry is visible at a glance. */
const SHAPE_DEFAULTS = { camber: 2, thickness: 12, angle: 4 };

/** Control points per surface. Twelve or thirteen points is what a Catmull-Rom through a
 *  cosine-spaced NACA outline needs to stay faithful without becoming fiddly to drag. */
const POINTS_PER_SURFACE = 6;

const shape = { ...SHAPE_DEFAULTS };
/** Set once the visitor drags a handle: the sliders no longer describe what is on screen. */
let shapeIsCustom = false;
/** Suppresses the editor's `change` event while we are the ones writing the points. */
let applyingShape = false;

/** Half-thickness distribution of a NACA four-digit profile. */
function thicknessAt(x, t) {
  return (
    5 *
    t *
    (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1015 * x ** 4)
  );
}

/** Mean line and its slope. Below `p` and above it are different polynomials. */
function camberAt(x, m, p) {
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
 * Control points for a NACA four-digit profile, ordered around the outline.
 *
 * Cosine spacing puts points where the curvature is — dense at the leading edge, sparse
 * along the flat middle — which is what keeps a hand-draggable point count from rounding
 * off the nose. The two surfaces meet at a single leading-edge point; the trailing edge
 * keeps its (tiny) real thickness rather than being pinched shut, because a pinched tip
 * gives the spline a cusp the protocol's polygon validator rejects.
 */
function nacaControlPoints({ camber, thickness, angle }) {
  const m = camber / 100;
  const t = thickness / 100;
  const p = CAMBER_POSITION;

  const surface = (x, sign) => {
    const { y: yc, slope } = camberAt(x, m, p);
    const theta = Math.atan(slope);
    const yt = thicknessAt(x, t);
    return [x - sign * yt * Math.sin(theta), yc + sign * yt * Math.cos(theta)];
  };

  const xs = [];
  for (let i = 1; i <= POINTS_PER_SURFACE; i += 1) {
    xs.push(0.5 * (1 - Math.cos((Math.PI * i) / POINTS_PER_SURFACE)));
  }

  const points = [];
  for (let i = xs.length - 1; i >= 0; i -= 1) points.push(surface(xs[i], +1)); // upper, TE → LE
  points.push([0, 0]); // leading edge
  for (const x of xs) points.push(surface(x, -1)); // lower, LE → TE

  // Angle of attack: rotate about the quarter-chord, the conventional reference point.
  const a = (angle * Math.PI) / 180;
  const [cx, cy] = [0.25, 0];
  return points.map(([x, y]) => [
    cx + (x - cx) * Math.cos(a) + (y - cy) * Math.sin(a),
    cy - (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a),
  ]);
}

function applyShape() {
  applyingShape = true;
  try {
    dom.editor.controlPoints = nacaControlPoints(shape);
  } finally {
    applyingShape = false;
  }
  shapeIsCustom = false;
  updateShapeNote();
}

function updateShapeNote() {
  dom.shapeNote.textContent = shapeIsCustom
    ? 'You are editing the points by hand: the sliders above no longer describe this shape. Reset to go back to the NACA profile.'
    : `Four-digit NACA profile: camber ${shape.camber} %, thickness ${shape.thickness} %, angle of attack ${shape.angle}°.`;
}

const SHAPE_CONTROLS = [
  {
    key: 'camber',
    label: 'Camber',
    min: 0,
    max: 9,
    step: 0.5,
    unit: '%',
    hint: 'How far the mean line departs from the chord. At 0 the profile is symmetric.',
  },
  {
    key: 'thickness',
    label: 'Thickness',
    min: 6,
    max: 20,
    step: 1,
    unit: '%',
    hint: 'Maximum thickness as a percentage of the chord.',
  },
  {
    key: 'angle',
    label: 'Angle of attack',
    min: -10,
    max: 12,
    step: 1,
    unit: '°',
    hint: 'Rotation of the profile about the quarter-chord point.',
  },
];

/* ---------------------------------------------------------- solver parameter form */

/** Which parameters the experiment offers, in display order. Bounds come from the schema. */
const PARAM_UI = [
  {
    name: 'resolution',
    label: 'Resolution',
    hint: 'Grid points along the longer edge of the domain.',
  },
  {
    name: 'mesh_size',
    label: 'Mesh size',
    hint: 'Reference element length. Smaller means more elements: the server refuses values that overrun its cell budget.',
    step: 0.005,
  },
  { name: 'iterations', label: 'Iterations', hint: 'Steps of the Jacobi iteration.' },
  { name: 'u_inf', label: 'Free-stream velocity', hint: 'Undisturbed velocity upstream.' },
  {
    name: 'output',
    label: 'Result kind',
    hint: 'The triangular mesh shows the actual discretisation.',
    optionLabels: { grid2d: 'regular grid', mesh2d: 'triangular mesh' },
  },
  { name: 'write_vtk', label: 'Attach VTK file', hint: 'Downloadable, and opens in ParaView.' },
];

/** Current parameter values, keyed by name. Rebuilt whenever the solver changes. */
let params = {};
let catalogue = { all: [], byMode: {} };

function selectedSolver() {
  return catalogue.all.find((solver) => solver.name === dom.solver.value) ?? null;
}

function onSolverChange() {
  const solver = selectedSolver();
  if (!solver) return;
  dom.solverHint.textContent = describeSolver(solver, catalogue);
  params = buildParamForm(dom.solverParams, solver, PARAM_UI, params);
}

/* --------------------------------------------------------------------- the solve */

let running = false;
let currentJob = null;

async function run() {
  if (running) return;
  const solver = selectedSolver();
  if (!solver) {
    setStatusOn(dom, 'No solver is available on this server.', 'error');
    return;
  }

  running = true;
  dom.artifacts.replaceChildren();

  try {
    const result = await runSolve({
      dom,
      solver: solver.name,
      // The editor hands over protocol geometry directly — there is no translation layer
      // between the widget and the wire format, by design.
      geometry: dom.editor.value,
      params,
      onJob: (job) => {
        currentJob = job;
      },
    });
    if (!result) return;

    // Derive Cp before handing the result over, so it shows up in the viewer's field list
    // like any other field rather than needing a separate code path.
    addPressureCoefficient(result, params.u_inf);
    dom.viewer.result = result;
    syncFieldOptions(dom.viewer, dom.field, FIELD_VIEW, dom.fieldHint);
    showStats(dom.stats, result);
    showArtifacts(dom.artifacts, result.artifacts);
    setStatusOn(dom, 'Done.', 'done');
  } finally {
    running = false;
    currentJob = null;
  }
}

/**
 * Pressure coefficient, derived in the browser from the speed the solver returned.
 *
 * The solver computes no pressure — `psi` and `speed` are the whole result envelope. But
 * potential flow is exactly the case where pressure follows from speed alone, with no
 * further solving: Bernoulli along a streamline, plus irrotationality making the constant
 * the same everywhere, gives
 *
 *     p + ½ρ|v|²  =  p∞ + ½ρU∞²      ⟹      Cp = (p − p∞) / (½ρU∞²) = 1 − (|v|/U∞)²
 *
 * so density never enters and the answer is dimensionless. Doing it here rather than in a
 * solver keeps it where it belongs: this is the lab's didactic layer, and Fenix Spoon's
 * result contract stays exactly what the solver produced.
 *
 * Returns silently unmodified when it cannot be computed — a solver that publishes no
 * `u_inf`, or a free stream of zero, has no Cp to speak of rather than an infinite one.
 */
function addPressureCoefficient(result, freeStream) {
  const fields = scalarsOf(result);
  const speed = fields?.speed;
  if (!speed || !Number.isFinite(freeStream) || freeStream === 0) return result;

  fields.Cp = Array.from(speed, (value) => 1 - (value / freeStream) ** 2);
  return result;
}

/** How each field is presented: the colorbar caption, the colormap, and what to say about it. */
const FIELD_VIEW = {
  speed: {
    option: 'speed',
    caption: 'speed',
    colormap: 'viridis',
    contours: 10,
    hint: 'Velocity magnitude. The bright regions are where the flow accelerates.',
  },
  psi: {
    option: 'psi (streamfunction)',
    caption: 'psi',
    colormap: 'viridis',
    contours: 10,
    hint:
      'Streamfunction: its contour lines are the streamlines. Most of the vertical gradient is ' +
      'the far-field condition psi = U·y, not the body — so watch how the contours bend, not the colour.',
  },
  Cp: {
    option: 'Cp (pressure)',
    caption: 'Cp',
    colormap: 'coolwarm',
    contours: 10,
    // Cp is signed and its zero is ambient pressure, so a diverging map centred on zero is
    // the only one that reads correctly — blue suction, red compression, pale where the
    // flow is undisturbed.
    symmetric: true,
    hint:
      'Pressure coefficient, Cp = 1 − (|v|/U∞)², derived here from speed — the solver does not ' +
      'compute pressure. Blue is suction, red is compression, and Cp = 1 marks a stagnation point.',
  },
};

/* ---------------------------------------------------------------------- start-up */

mountChrome('experiments');
buildShapeControls(dom.shapeControls, SHAPE_CONTROLS, shape, applyShape);
applyShape();

dom.editor.addEventListener('change', () => {
  if (applyingShape) return;
  shapeIsCustom = true;
  updateShapeNote();
});
dom.run.addEventListener('click', run);
dom.cancel.addEventListener('click', () => currentJob?.cancel());
dom.reset.addEventListener('click', () => {
  Object.assign(shape, SHAPE_DEFAULTS);
  buildShapeControls(dom.shapeControls, SHAPE_CONTROLS, shape, applyShape);
  applyShape();
});
dom.solver.addEventListener('change', onSolverChange);
dom.field.addEventListener('change', () => {
  dom.viewer.field = dom.field.value;
  applyFieldView(dom.viewer, FIELD_VIEW, dom.field.value, dom.fieldHint);
});

try {
  const [content, info, solvers] = await Promise.all([
    fetch('/experiments/airfoil/content.json').then((response) => response.json()),
    health().catch(() => null),
    solversFor(GEOMETRY_TYPE),
  ]);

  renderLesson({ content, intro: dom.intro, lesson: dom.lesson });
  catalogue = solvers;

  if (catalogue.all.length) {
    fillSolverPicker(dom.solver, catalogue);
    onSolverChange();
  }

  const canSolve = applyMaintenance(
    dom,
    info,
    'The lab is not accepting new simulations right now. You can still explore the page and reshape the geometry.',
  );

  // Run is enabled here and nowhere else — see `applyMaintenance` for why it starts disabled.
  // Each branch leaves the status line saying something that is true of this deployment.
  if (!catalogue.all.length) {
    setStatusOn(dom, 'This server exposes no solver compatible with this geometry.', 'error');
  } else if (!canSolve) {
    setStatusOn(dom, 'Simulations are paused for maintenance.');
  } else {
    dom.run.disabled = false;
    setStatusOn(dom, 'Press Run to start the first simulation.');
  }
} catch (error) {
  setStatusOn(dom, `Cannot reach the server — ${describeError(error)}`, 'error');
  dom.run.disabled = true;
}
