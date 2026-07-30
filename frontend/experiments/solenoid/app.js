/**
 * Magnetics lab — the solenoid cross-section.
 *
 * The second experiment, and the first one whose geometry is about *materials* rather than an
 * obstacle. `regions2d` fills the whole rectangle and lets the physics vary by region: an iron
 * core, two windings carrying opposite-signed current density (the two sides of one coil cut by
 * the plane), and air everywhere else. The server solves for the magnetic vector potential,
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
 * **Still a demonstration, on purpose.** The redesign brings this page into the same shell as
 * the airfoil — workspace, toolbar, progressive controls, folded didactics — and stops there.
 * Turning it into an exercise needs metrics, and the metrics a magnetic design is judged on
 * have definitions in a 2-D slice that have not been verified here yet. `docs/exercises/
 * solenoid.md` says which they are and what each one has to survive before it is printed. The
 * extension points are marked in this file and in the markup rather than half-built.
 */

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
import { createWorkspace, polyline, svgNode } from '/shared/workspace.js';

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

/** Vacuum permeability, in H/m. The same constant the solvers use. */
const MU0 = 4e-7 * Math.PI;

/**
 * Half-width of the square modelling window, in millimetres.
 *
 * The boundary condition is A_z = 0 on the outer edge, which confines the flux to this window.
 * That is a modelling choice, not a physical wall, so the window has to be comfortably larger
 * than the magnet — hence the slider limits below, which cannot reach it.
 */
const WINDOW_MM = 60;

const dom = Object.fromEntries(
  [
    'intro',
    'lesson',
    'viewer',
    'workspace',
    'schematic',
    'core',
    'windingLeft',
    'windingRight',
    'status',
    'dot',
    'progress',
    'run',
    'cancel',
    'reset',
    'solver',
    'solverHint',
    'numerical',
    'conditions',
    'shapeControls',
    'shapeNote',
    'field',
    'fieldHint',
    'stats',
    'artifacts',
    'results',
    'maintenance',
  ].map((key) => [
    key,
    document.getElementById(key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)),
  ]),
);

/* ---------------------------------------------------------------- the magnet */

/**
 * A 10 mm half-width iron core in a 15 mm bore, 10 mm of winding at 5 A/mm², μᵣ = 1000.
 * Ordinary numbers for a small laboratory electromagnet, and the same cross-section Fenix
 * Spoon's own solenoid demo uses — so the two are comparable.
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
 * combination geometrically valid by construction: there is no ordering left to violate, and
 * their maxima sum to 44 mm inside a 60 mm window.
 *
 * Split into two groups by what kind of decision each is — the shape of the magnet, and what
 * it is made of and driven with — which is the same Design/Conditions split the airfoil uses.
 */
const DESIGN_CONTROLS = [
  {
    key: 'coreHalfWidth',
    label: 'Core half-width',
    min: 2,
    max: 14,
    step: 0.5,
    unit: ' mm',
    title: 'Half the thickness of the iron bar down the middle. The magnetic circuit is the core.',
  },
  {
    key: 'gap',
    label: 'Air gap',
    min: 1,
    max: 10,
    step: 0.5,
    unit: ' mm',
    title: 'Clearance between the core and the winding — the space insulation and formers take.',
  },
  {
    key: 'winding',
    label: 'Winding thickness',
    min: 3,
    max: 20,
    step: 0.5,
    unit: ' mm',
    title: 'How far the copper extends outward. Thicker winding, more total current.',
  },
  {
    key: 'halfHeight',
    label: 'Half-height',
    min: 10,
    max: 45,
    step: 1,
    unit: ' mm',
    title: 'Half the length of the core and the coil, along the axis.',
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
    title: 'How much more easily the core carries flux than air. 1 means no core; iron is 10³–10⁴.',
  },
  {
    key: 'currentDensity',
    label: 'Current density',
    min: 0.5,
    max: 10,
    step: 0.5,
    unit: ' A/mm²',
    title: 'Current per unit area of copper. Around 5 A/mm² is a conventionally cooled winding.',
  },
];

function permeabilityFrom(exponent) {
  return Math.round(10 ** exponent);
}

/** Total current through one side of the winding, in ampere-turns. */
function ampereTurns() {
  const area = (shape.winding / 1000) * ((2 * shape.halfHeight) / 1000); // m²
  return shape.currentDensity * 1e6 * area;
}

/**
 * The `regions2d` payload this page will submit.
 *
 * Lengths are in metres, because the protocol's bounds are; the sliders are in millimetres
 * because that is how someone thinks about a coil. Current density is signed: the plane cuts
 * one winding twice, and the current goes into the page on one side and out on the other. Give
 * both sides the same sign and you have modelled two coils fighting each other — which is a
 * perfectly good experiment, but not a solenoid.
 *
 * Only the keys each solver documents are set. `core` carries no `current_density`, so it
 * defaults to zero; the windings carry no `mu_r`, so they default to 1 — copper is
 * non-magnetic, which is the right answer rather than a convenient one.
 */
function buildGeometry() {
  const mm = (value) => value / 1000;
  const { coreHalfWidth: a, gap: g, winding: w, halfHeight: h } = shape;
  const bore = a + g;
  const outer = bore + w;
  const current = shape.currentDensity * 1e6; // A/mm² → A/m²

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
    bounds: [mm(-WINDOW_MM), mm(-WINDOW_MM), mm(WINDOW_MM), mm(WINDOW_MM)],
    background: { mu_r: 1.0 },
    regions: [
      {
        name: 'core',
        shape: rect(-a, -h, a, h),
        material: { mu_r: permeabilityFrom(shape.muExponent) },
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

  setRect(dom.core, -a, -h, 2 * a, 2 * h);
  setRect(dom.windingLeft, -(bore + w), -h, w, 2 * h);
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
    `${2 * h} mm long. μᵣ = ${permeability}, and ${turns} ampere-turns per side.`;
  workspace?.draw();
}

function setRect(node, x, y, width, height) {
  node.setAttribute('x', String(x));
  node.setAttribute('y', String(y));
  node.setAttribute('width', String(width));
  node.setAttribute('height', String(height));
}

/* ---------------------------------------------------------- solver parameter form */

/**
 * Which parameters the experiment offers, in display order.
 *
 * The two magnetostatics solvers do not agree on their inputs: `mock.magnetostatics2d` takes
 * `resolution`, `iterations` and an `output` kind, `dolfinx.magnetostatics2d` takes `mesh_size`
 * and emits `mesh2d` only. The form is generated from whichever schema the selected solver
 * publishes, so listing both here is how one page serves both — and `report_every` is left out
 * because how often the solver reports its progress is not a physical question.
 *
 * All of them are numerical: none changes the magnet, only how well it is approximated. That
 * is why they all live under Advanced, and it is the same distinction the exercise contract's
 * §5 draws for the airfoil.
 */
const PARAM_UI = [
  {
    name: 'resolution',
    label: 'Resolution',
    hint: 'Grid points along the longer edge of the window.',
  },
  {
    name: 'mesh_size',
    label: 'Mesh size',
    hint: 'Reference element length, in metres. The server refuses values that overrun its cell budget.',
    step: 0.001,
  },
  {
    name: 'iterations',
    label: 'Iterations',
    hint: 'Sweeps of the iterative solve. A high-permeability core needs more to settle.',
  },
  {
    name: 'output',
    label: 'Result kind',
    hint: 'The triangular mesh shows the actual discretisation.',
    optionLabels: { grid2d: 'regular grid', mesh2d: 'triangular mesh' },
  },
  { name: 'write_vtk', label: 'Attach VTK file', hint: 'Downloadable, and opens in ParaView.' },
];

let params = {};
let catalogue = { all: [], byMode: {} };
let workspace = null;

function selectedSolver() {
  return catalogue.all.find((solver) => solver.name === dom.solver.value) ?? null;
}

function onSolverChange() {
  const solver = selectedSolver();
  if (!solver) return;
  dom.solverHint.textContent = describeSolver(solver, catalogue);
  params = buildParamForm(dom.numerical, solver, PARAM_UI, params);
}

/* --------------------------------------------------------------------- the solve */

let running = false;
let currentJob = null;

async function run() {
  if (running) return;
  const solver = selectedSolver();
  if (!solver) {
    setStatusOn(dom, 'No magnetostatics solver is available on this server.', 'error');
    return;
  }

  running = true;
  dom.artifacts.replaceChildren();

  try {
    const result = await runSolve({
      dom,
      solver: solver.name,
      geometry: buildGeometry(),
      params,
      onJob: (job) => {
        currentJob = job;
      },
    });
    if (!result) return;

    addFieldStrength(result);
    dom.results.hidden = false;
    workspace.setResult(result);
    syncFieldOptions(dom.viewer, dom.field, FIELD_VIEW, dom.fieldHint);
    showStats(dom.stats, result);
    showArtifacts(dom.artifacts, result.artifacts);
    declareOverlays();
    setStatusOn(dom, 'Done.', 'done');
  } finally {
    running = false;
    currentJob = null;
  }
}

/**
 * Magnetic field strength H, derived in the browser from what the solver returned.
 *
 * The solvers publish A, |B| and μᵣ and no H — but H needs no solving, because it is B and μᵣ
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
 * This is also why the workspace's *Streamlines* tool is correctly unavailable here: these
 * solvers publish scalars only, and a streamline is an integral of a vector field. The
 * contours of A are the honest device, and they are upstream's.
 */
const FIELD_VIEW = {
  B: {
    option: 'Flux density, |B|',
    caption: 'T',
    colormap: 'viridis',
    contours: 0,
    hint:
      'Flux density, in tesla — what a Hall probe or a Gauss meter measures. Bright is where ' +
      'the flux is concentrated. Switch to A to see the field lines it runs along.',
  },
  A: {
    option: 'Vector potential, A_z (field lines)',
    caption: 'Wb/m',
    colormap: 'viridis',
    contours: 14,
    hint:
      'Vector potential A_z, the quantity actually solved for. Its contour lines are the ' +
      'magnetic field lines: closely spaced lines mean strong B, and the flux between any two ' +
      'of them is the same everywhere along their length.',
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
    // the solver put where. On the FEniCSx mesh it shows the region tagging directly — the
    // iron/air boundary lands on element edges instead of being staircased onto a raster.
    colormap: 'greyscale',
    contours: 0,
    hint:
      'Not a result but a check: where the solver placed the iron. On the triangular mesh the ' +
      'interface follows element edges exactly, which is the point of tagging regions.',
  },
};

/* --------------------------------------------------------------- the annotation layer */

/** Region outlines over the field: exactly where the solver was told the materials are. */
function declareOverlays() {
  workspace.setOverlays([
    { id: 'regions', label: 'Core & windings', colour: 'var(--core)', on: true },
    { id: 'axis', label: 'Axis', colour: 'var(--overlay-chord)', on: false },
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
}

/** The box "Fit magnet" frames: the core and both windings, in metres. */
function magnetBox() {
  const outer = (shape.coreHalfWidth + shape.gap + shape.winding) / 1000;
  const half = shape.halfHeight / 1000;
  return [-outer, -half, outer, half];
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
dom.solver.addEventListener('change', onSolverChange);
dom.field.addEventListener('change', () => {
  dom.viewer.field = dom.field.value;
  applyFieldView(dom.viewer, FIELD_VIEW, dom.field.value, dom.fieldHint);
  workspace.draw();
});

try {
  const [content, info, solvers] = await Promise.all([
    fetch('/experiments/solenoid/content.json').then((response) => response.json()),
    health().catch(() => null),
    solversFor(GEOMETRY_TYPE, { physics: PHYSICS }),
  ]);

  renderLesson({ content, intro: dom.intro, lesson: dom.lesson, open: ['question'] });
  catalogue = solvers;

  if (catalogue.all.length) {
    fillSolverPicker(dom.solver, catalogue);
    onSolverChange();
  }

  const canSolve = applyMaintenance(
    dom,
    info,
    'The lab is not accepting new simulations right now. You can still explore the page and change the cross-section.',
  );

  // Run is enabled here and nowhere else — see `applyMaintenance` for why it starts disabled.
  // Each branch leaves the status line saying something that is true of this deployment.
  if (!catalogue.all.length) {
    setStatusOn(dom, 'This server exposes no magnetostatics solver for this geometry.', 'error');
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
