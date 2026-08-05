/**
 * The heat sink — an extruded profile, as an exercise.
 *
 * The fifth experiment, and the first whose answer depends on two heat paths that *fight each
 * other*. Conduction through the metal is ordinary. What makes the exercise is the boundary:
 *
 *   - convection, with `h` evaluated from the channel the fins leave between them rather than
 *     looked up once. Held constant, the model says more fins are always better for ever, which
 *     is the opposite of the answer;
 *   - radiation, exchanged inside each channel through exact two-dimensional view factors and
 *     with the room through the channel mouth. As the fins close up, a flank sees the facing
 *     fin instead of the room and the radiative loss collapses with the view factor.
 *
 * So thermal resistance has an interior minimum in fin count, and the page's headline is the
 * sweep that shows it — one solve cannot. See `docs/exercises/heat-sink.md`.
 *
 * There is no geometry widget, for the reason ADR-012 gives on the solenoid: `<fs-geometry-2d>`
 * edits a `domain2d` outline, and this profile is filled rectangles better described by the
 * quantities an engineer would name. The geometry payload carries the *envelope* the sink must
 * fit inside; the profile itself travels in `params`, because the correlation needs the channel
 * width and recovering that from a list of rectangles would be inferring a quantity from a
 * picture (ADR-019, and the adapter's own docstring).
 */

import '@fenix-spoon/viewer';

import { solversFor } from '/shared/api.js';
import { describeError, el, health, mountChrome, revealPanel } from '/shared/components.js';
import { drawCurve } from '/shared/curve.js';
import {
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
import { contentUrl, num, t } from '/shared/i18n.js';
import * as runs from '/shared/runs.js';
import { createWorkspace } from '/shared/workspace.js';

const EXERCISE = 'heatsink';
const GEOMETRY_TYPE = 'regions2d';
/**
 * `heatsink`, and deliberately not `heat`.
 *
 * Upstream's two conduction adapters declare `heat` and have no radiative boundary. Filtering
 * on that tag would offer this page a solver whose answer is a tenth high on the nominal
 * still-air case — not a different picture, a different number. It is the trap the magnetics
 * page fell into when `mock.heat2d` matched its geometry filter, and the adapter carries its
 * own tag so it cannot happen again.
 */
const PHYSICS = 'heatsink';
const SOLVER_PREFIX = 'lab.heatsink';

/** The extrusion is 60 mm wide and the profile has to fit inside it. Metres, on the wire. */
const ENVELOPE_WIDTH = 0.06;
const ENVELOPE_HEIGHT = 0.09;

const dom = Object.fromEntries(
  [
    'lesson',
    'viewer',
    'workspace',
    'schematic',
    'base',
    'fins',
    'footprint',
    'channel',
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
    'sweep',
    'sweepCurve',
    'radiativeCurve',
    'sweepNote',
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

/* ---------------------------------------------------------------- the profile */

/**
 * Ten fins, 25 mm tall, on a 5 mm base — and a sink that **misses the mission**.
 *
 * It is close to the best this fin height can do, which is the point: it lands at about 104 °C
 * against the 95 asked for, so the obvious move (add fins) makes it worse and the visitor has
 * to find the other lever. A default that already passed would leave nothing to do.
 */
const SHAPE_DEFAULTS = {
  baseThickness: 5,
  finCount: 10,
  finThickness: 1.5,
  finHeight: 25,
  power: 30,
  ambient: 25,
  footprint: 30,
  velocity: 0,
};

const shape = { ...SHAPE_DEFAULTS };
/** The choices that are not numbers, so they are not sliders. */
const choices = { finish: 'black_anodised', cooling: 'natural', flush: true };

const DESIGN_CONTROLS = [
  {
    key: 'finCount',
    label: t('heatsink.design.finCount'),
    min: 1,
    max: 30,
    step: 1,
    unit: '',
    title: t('heatsink.design.finCountTitle'),
  },
  {
    key: 'finHeight',
    label: t('heatsink.design.finHeight'),
    min: 5,
    max: 80,
    step: 1,
    unit: ' mm',
    title: t('heatsink.design.finHeightTitle'),
  },
  {
    key: 'finThickness',
    label: t('heatsink.design.finThickness'),
    min: 0.5,
    max: 5,
    step: 0.1,
    unit: ' mm',
    title: t('heatsink.design.finThicknessTitle'),
  },
  {
    key: 'baseThickness',
    label: t('heatsink.design.baseThickness'),
    min: 2,
    max: 15,
    step: 0.5,
    unit: ' mm',
    title: t('heatsink.design.baseThicknessTitle'),
  },
];

const CONDITION_CONTROLS = [
  {
    key: 'power',
    label: t('heatsink.design.power'),
    min: 5,
    max: 120,
    step: 1,
    unit: ' W',
    title: t('heatsink.design.powerTitle'),
  },
  {
    key: 'ambient',
    label: t('heatsink.design.ambient'),
    min: -10,
    max: 60,
    step: 1,
    unit: ' °C',
    title: t('heatsink.design.ambientTitle'),
  },
  {
    key: 'footprint',
    label: t('heatsink.design.footprint'),
    min: 5,
    max: 55,
    step: 1,
    unit: ' mm',
    title: t('heatsink.design.footprintTitle'),
  },
];

/**
 * The controls that are a choice rather than a magnitude.
 *
 * `buildShapeControls` makes range sliders, which is right for everything above and wrong for
 * these three: a finish is one of three coatings, cooling is a mode, and the mounting is a
 * yes-or-no. A slider over a set of names would be a lie about what lies between them.
 */
function buildChoiceControls(container) {
  const finish = el(
    'select',
    { id: 'choice-finish' },
    ...['mill', 'clear_anodised', 'black_anodised'].map(
      (value) =>
        new Option(t(`heatsink.finish.${value}`), value, false, choices.finish === value),
    ),
  );
  finish.addEventListener('change', () => {
    choices.finish = finish.value;
    applyShape();
  });

  const cooling = el(
    'select',
    { id: 'choice-cooling' },
    ...['natural', 'forced'].map(
      (value) =>
        new Option(t(`heatsink.cooling.${value}`), value, false, choices.cooling === value),
    ),
  );
  cooling.addEventListener('change', () => {
    choices.cooling = cooling.value;
    // A fan with no speed is not a fan. Give it one the moment the mode is chosen, rather
    // than letting the solver refuse the job for a reason the visitor did not cause.
    if (choices.cooling === 'forced' && shape.velocity <= 0) shape.velocity = 2;
    applyShape();
    renderVelocity();
  });

  const flush = el('input', { type: 'checkbox', id: 'choice-flush' });
  flush.checked = choices.flush;
  flush.addEventListener('change', () => {
    choices.flush = flush.checked;
    applyShape();
  });

  container.append(
    el(
      'div',
      { class: 'field' },
      el('label', { class: 'field__label', for: 'choice-finish' }, el('span', { text: t('heatsink.design.finish') })),
      finish,
      el('span', { class: 'field__hint', text: t('heatsink.design.finishHint') }),
    ),
    el(
      'div',
      { class: 'field' },
      el('label', { class: 'field__label', for: 'choice-cooling' }, el('span', { text: t('heatsink.design.cooling') })),
      cooling,
      el('span', { class: 'field__hint', text: t('heatsink.design.coolingHint') }),
    ),
    el('div', { class: 'field', id: 'velocity-slot' }),
    el(
      'div',
      { class: 'field field--check' },
      el(
        'label',
        { class: 'field__label', for: 'choice-flush' },
        flush,
        el('span', { text: t('heatsink.design.flush') }),
      ),
      el('span', { class: 'field__hint', text: t('heatsink.design.flushHint') }),
    ),
  );
  renderVelocity();
}

/** The fan speed, shown only when there is a fan. */
function renderVelocity() {
  const slot = document.getElementById('velocity-slot');
  if (!slot) return;
  slot.replaceChildren();
  slot.hidden = choices.cooling !== 'forced';
  if (slot.hidden) return;
  buildShapeControls(
    slot,
    [
      {
        key: 'velocity',
        label: t('heatsink.design.velocity'),
        min: 0.5,
        max: 10,
        step: 0.5,
        unit: ' m/s',
        title: t('heatsink.design.velocityTitle'),
      },
    ],
    shape,
    applyShape,
  );
}

/* ------------------------------------------------------------------ the payloads */

/**
 * The envelope, as `regions2d`.
 *
 * One region, and it is the space the sink may occupy rather than the sink itself — the same
 * "site" role the bridge's geometry plays. The vertices are inset by a micron because
 * `polygon2d` requires them strictly inside the bounds.
 */
function buildGeometry() {
  const eps = 1e-6;
  const [w, h] = [ENVELOPE_WIDTH, ENVELOPE_HEIGHT];
  return {
    type: 'regions2d',
    bounds: [0, 0, w, h],
    background: {},
    regions: [
      {
        name: 'envelope',
        shape: {
          type: 'polygon2d',
          points: [
            [eps, eps],
            [w - eps, eps],
            [w - eps, h - eps],
            [eps, h - eps],
          ],
        },
        material: {},
      },
    ],
  };
}

/** Millimetres on the page, metres on the wire. Converted in exactly one place. */
function profileParams() {
  return {
    base_thickness: shape.baseThickness / 1000,
    fin_count: Math.round(shape.finCount),
    fin_thickness: shape.finThickness / 1000,
    fin_height: shape.finHeight / 1000,
    finish: choices.finish,
    power: shape.power,
    t_ambient: shape.ambient,
    footprint_width: shape.footprint / 1000,
    cooling: choices.cooling,
    face_velocity: choices.cooling === 'forced' ? shape.velocity : 0,
    base_mounted_flush: choices.flush,
  };
}

function currentParams(extra = {}) {
  return { ...profileParams(), ...forms.numerical, ...extra };
}

/* ------------------------------------------------------------------ the schematic */

/** Channel width in millimetres — the quantity the correlation is evaluated on. */
function channelWidth() {
  const n = Math.round(shape.finCount);
  if (n < 2) return 0;
  return (60 - n * shape.finThickness) / (n - 1);
}

function finsFit() {
  return Math.round(shape.finCount) * shape.finThickness <= 60;
}

function applyShape() {
  const n = Math.round(shape.finCount);
  const pitch = n > 1 ? (60 - shape.finThickness) / (n - 1) : 0;

  setRect(dom.base, 0, 0, 60, shape.baseThickness);

  const fins = [];
  for (let i = 0; i < n; i += 1) {
    const x = n > 1 ? i * pitch : (60 - shape.finThickness) / 2;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('class', 'region region--core');
    rect.setAttribute('x', x.toFixed(3));
    rect.setAttribute('y', shape.baseThickness.toFixed(3));
    rect.setAttribute('width', shape.finThickness.toFixed(3));
    rect.setAttribute('height', shape.finHeight.toFixed(3));
    fins.push(rect);
  }
  dom.fins.replaceChildren(...fins);

  const half = shape.footprint / 2;
  setLine(dom.footprint, 30 - half, 0, 30 + half, 0);
  // The channel, drawn once between the first pair as the gap the air has to fit through.
  if (n > 1) {
    const left = shape.finThickness;
    setLine(dom.channel, left, shape.baseThickness + shape.finHeight / 2, left + channelWidth(), shape.baseThickness + shape.finHeight / 2);
    dom.channel.removeAttribute('hidden');
  } else {
    dom.channel.setAttribute('hidden', '');
  }

  // The viewBox follows the profile, so a 5 mm fin and an 80 mm fin are both legible.
  const top = shape.baseThickness + shape.finHeight;
  dom.schematic.setAttribute('viewBox', `-4 ${(-top - 4).toFixed(1)} 68 ${(top + 8).toFixed(1)}`);
  dom.schematic.querySelector('g').setAttribute('transform', `translate(0, ${(-top).toFixed(3)}) scale(1, -1)`);

  dom.shapeNote.textContent = finsFit()
    ? t('heatsink.shapeNote', {
        channel: num(channelWidth(), { maximumFractionDigits: 2 }),
        mass: num(estimatedMass() * 1000, { maximumFractionDigits: 0 }),
      })
    : t('heatsink.shapeOverlap', { count: n });
  dom.run.disabled = !finsFit() || !solver() || running;
  renderDerived();
}

function setRect(node, x, y, width, height) {
  node.setAttribute('x', x.toFixed(3));
  node.setAttribute('y', y.toFixed(3));
  node.setAttribute('width', Math.max(0, width).toFixed(3));
  node.setAttribute('height', Math.max(0, height).toFixed(3));
}

function setLine(node, x1, y1, x2, y2) {
  node.setAttribute('x1', x1.toFixed(3));
  node.setAttribute('y1', y1.toFixed(3));
  node.setAttribute('x2', x2.toFixed(3));
  node.setAttribute('y2', y2.toFixed(3));
}

/** Aluminium 6063, the adapter's default. Shown before a run so the budget is visible while
 *  the sliders move, rather than only after the solve has spent it. */
function estimatedMass() {
  const area = (60 * shape.baseThickness + Math.round(shape.finCount) * shape.finThickness * shape.finHeight) / 1e6;
  return 2700 * area * 0.06;
}

function renderDerived() {
  dom.derived.replaceChildren(
    ...entry(t('heatsink.derived.channel'), `${num(channelWidth(), { maximumFractionDigits: 2 })} mm`),
    ...entry(t('heatsink.derived.area'), `${num(exposedArea() * 1e4, { maximumFractionDigits: 0 })} cm²`),
    ...entry(t('heatsink.derived.mass'), `${num(estimatedMass() * 1000, { maximumFractionDigits: 0 })} g`),
    ...entry(t('heatsink.derived.flux'), `${num(shape.power / (shape.footprint * 0.06 / 1000), { maximumFractionDigits: 0 })} W/m²`),
  );
}

/** Exposed surface over the whole extrusion, m². The number the coefficient multiplies. */
function exposedArea() {
  const n = Math.round(shape.finCount);
  const flanks = 2 * n * shape.finHeight;
  const tips = n * shape.finThickness;
  const between = Math.max(0, 60 - n * shape.finThickness);
  return ((flanks + tips + between) / 1000) * 0.06;
}

function entry(label, value) {
  return [el('dt', { text: label }), el('dd', { class: 'num', text: value })];
}

/* --------------------------------------------------------------- what is reported */

const PARAM_UI = [
  { name: 'cell_size', label: t('heatsink.params.cellSize'), group: 'numerical', scale: 1 },
  { name: 'radiation', label: t('heatsink.params.radiation'), group: 'numerical' },
  { name: 'h_override', label: t('heatsink.params.hOverride'), group: 'numerical' },
];

const METRICS = [
  { key: 't_max', label: t('heatsink.metrics.tMax'), unit: '°C', digits: 1 },
  { key: 't_rise', label: t('heatsink.metrics.tRise'), unit: 'K', digits: 1 },
  { key: 'thermal_resistance', label: t('heatsink.metrics.resistance'), unit: 'K/W', digits: 3 },
  { key: 'mass', label: t('heatsink.metrics.mass'), unit: 'kg', digits: 3 },
  { key: 'score', label: t('heatsink.metrics.score'), unit: 'K·kg/W', digits: 4 },
  { key: 'fin_efficiency', label: t('heatsink.metrics.efficiency'), unit: '1', digits: 3 },
  { key: 'radiative_fraction', label: t('heatsink.metrics.radiative'), unit: '1', digits: 3 },
  { key: 'view_factor_to_room', label: t('heatsink.metrics.viewFactor'), unit: '1', digits: 3 },
  { key: 'h_convective', label: t('heatsink.metrics.h'), unit: 'W/m²·K', digits: 2 },
  { key: 'flux_max', label: t('heatsink.metrics.flux'), unit: 'W/m²', digits: 0 },
];

const METRIC_LABELS = Object.fromEntries(METRICS.map((metric) => [metric.key, metric]));

const KPIS = [
  { key: 't_max', label: t('heatsink.metrics.tMax'), unit: '°C', digits: 1 },
  { key: 'thermal_resistance', label: t('heatsink.metrics.resistance'), unit: 'K/W', digits: 3 },
  { key: 'mass', label: t('heatsink.metrics.mass'), unit: 'kg', digits: 3 },
  { key: 'score', label: t('heatsink.metrics.score'), unit: 'K·kg/W', digits: 4 },
];

/**
 * The two checks that reach the page.
 *
 * Both come back in the result envelope rather than in an artifact: the energy balance as
 * `residual`, and the view-factor identities folded into it — radiation lost into a badly
 * formed enclosure leaves through the balance. The identities themselves are asserted at
 * machine precision in the test suite, where a number that small belongs.
 */
const CHECKS = [
  {
    key: 'energy_balance_rel',
    tolerance: 'energy_balance_tol',
    label: t('heatsink.checks.energy'),
    describe: t('heatsink.checks.energyTitle'),
  },
];

const FIELD_VIEW = {
  T: { label: t('heatsink.fields.temperature'), units: '°C', colormap: 'inferno', hint: t('heatsink.fields.temperatureHint') },
  flux: { label: t('heatsink.fields.flux'), units: 'W/m²', colormap: 'viridis', hint: t('heatsink.fields.fluxHint') },
};

/* --------------------------------------------------------------------- the state */

const forms = { numerical: {} };
let catalogue = { all: [], byMode: {} };
let report = null;
let running = false;
let currentJob = null;
let workspace = null;
let content = null;
let lastSweep = null;
let selected = new Set();

function solver() {
  return catalogue.all.find((entry) => entry.name.startsWith(SOLVER_PREFIX)) ?? null;
}

/**
 * The report the exercise panels read, built here rather than fetched.
 *
 * The magnetics page carries its engineering answer in a `report.json` artifact, because when
 * it was written the envelope had nowhere to put a computed metric. It does now — protocol 1.3
 * gave it `metrics`, 1.5 gave it `series`, and this adapter also uses `residual` for the energy
 * balance and `warnings` for the model switches. So there is no artifact to fetch and no second
 * round trip: the report is a view over the result.
 */
function buildReport(result) {
  // `converged`, `residual` and `warnings` travel *inside* `diagnostics` on the wire — they
  // grew out of `stats` in protocol 1.3 and were grouped there rather than left loose at the
  // top level. Reading them off the envelope root returns undefined, which renders as a
  // verification row saying "not run" and a validity panel that silently swallows every
  // warning the solver wrote. Both failure modes look like a working page.
  const diagnostics = result.diagnostics ?? {};
  return {
    metrics: result.metrics ?? {},
    verification: {
      energy_balance_rel: diagnostics.residual ?? null,
      // The tolerance §8 declares. Stated here rather than by the solver, because it is a
      // claim about what this *page* considers verified.
      energy_balance_tol: 0.01,
    },
    validity: { warnings: diagnostics.warnings ?? [] },
    stats: result.stats ?? {},
    converged: diagnostics.converged ?? null,
  };
}

async function run() {
  if (running) return;
  const chosen = solver();
  if (!chosen) {
    setStatusOn(dom, t('heatsink.noSolver'), 'error');
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
    report = buildReport(result);
    dom.results.hidden = false;
    workspace.setResult(result);
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
    dom.run.disabled = !finsFit();
  }
}

/**
 * §10: the same sink at every fin count, in one job.
 *
 * The sweep is a solver parameter rather than a loop over jobs here, which keeps it one cache
 * key and one progress stream. Counts that do not fit the base are dropped by the adapter
 * rather than clamped — a point silently moved is a point that lies about which design
 * produced it — so the curve can come back shorter than it was asked for.
 */
async function runSweep() {
  if (running) return;
  const chosen = solver();
  if (!chosen) return;

  const counts = [];
  for (let n = 2; n <= 26; n += 2) {
    if (n * shape.finThickness <= 60) counts.push(n);
  }

  running = true;
  try {
    const result = await runSolve({
      dom,
      solver: chosen.name,
      geometry: buildGeometry(),
      params: currentParams({ sweep_fin_counts: counts }),
      onJob: (job) => {
        currentJob = job;
      },
    });
    if (!result) return;
    lastSweep = (result.series ?? [])[0] ?? null;
    report = buildReport(result);
    dom.results.hidden = false;
    workspace.setResult(result);
    present();
    setStatusOn(dom, t('experiment.done'), 'done');
  } finally {
    running = false;
    currentJob = null;
    dom.run.disabled = !finsFit();
  }
}

function present() {
  renderChallenge(dom.challenge, content?.challenge, report, METRIC_LABELS);
  renderKpis(dom.kpis, KPIS, report);
  renderMetrics(dom.metrics, METRICS, report);
  renderVerification(dom.verification, CHECKS, report);
  renderValidity(dom.validity, report);
  drawSweep();
}

function drawSweep() {
  if (!lastSweep) {
    dom.sweepNote.textContent = t('heatsink.sweepIdle');
    return;
  }
  const counts = lastSweep.x?.values ?? [];
  const trace = (name) => lastSweep.traces?.find((entry) => entry.name === name)?.values ?? [];
  const resistance = trace('thermal_resistance');
  const radiative = trace('radiative_fraction');
  if (!counts.length || !resistance.length) return;

  let best = 0;
  resistance.forEach((value, index) => {
    if (value < resistance[best]) best = index;
  });

  drawCurve(dom.sweepCurve, {
    traces: [{ name: 'R_θ', points: counts.map((n, i) => [n, resistance[i]]) }],
    xLabel: t('heatsink.plots.finCount'),
    yLabel: t('heatsink.plots.resistance'),
    marks: [{ x: counts[best], label: t('heatsink.plots.best') }],
  });
  drawCurve(dom.radiativeCurve, {
    traces: [{ name: 'Q_rad/Q', points: counts.map((n, i) => [n, radiative[i]]) }],
    xLabel: t('heatsink.plots.finCount'),
    yLabel: t('heatsink.plots.radiative'),
    marks: [{ x: counts[best] }],
  });

  const interior = best > 0 && best < counts.length - 1;
  dom.sweepNote.textContent = interior
    ? t('heatsink.sweepNote', {
        best: counts[best],
        value: num(resistance[best], { maximumFractionDigits: 3 }),
        worst: num(resistance[resistance.length - 1], { maximumFractionDigits: 3 }),
      })
    : t('heatsink.sweepEdge');
}

/* ------------------------------------------------------------------- the run table */

const COLUMNS = [
  { path: 'geometry.label', label: t('heatsink.columns.profile') },
  { path: 'metrics.t_max', label: 'T_max °C' },
  { path: 'metrics.thermal_resistance', label: 'R_θ K/W' },
  { path: 'metrics.mass', label: t('heatsink.columns.mass') },
  { path: 'metrics.score', label: 'R_θ·m' },
  { path: 'metrics.radiative_fraction', label: t('heatsink.columns.radiative') },
  { path: 'physical.emissivity', label: 'ε' },
  { path: 'verification.energy_balance_rel', label: t('heatsink.columns.energy') },
];

/** A profile deserves a name, and its four dimensions are one. */
function describeShape() {
  return t('heatsink.shapeLabel', {
    fins: Math.round(shape.finCount),
    height: shape.finHeight,
    thickness: num(shape.finThickness, { maximumFractionDigits: 1 }),
    base: num(shape.baseThickness, { maximumFractionDigits: 1 }),
  });
}

/** One row: every input, the answer, the residual, the warnings. The contract's §5. */
function row() {
  const mm = (value) => value / 1000;
  return {
    exercise: { id: EXERCISE, version: '1.0.0' },
    solver: { name: solver()?.name ?? null, version: solver()?.version ?? null },
    geometry: {
      source: 'parametric',
      label: describeShape(),
      base_width_m: ENVELOPE_WIDTH,
      base_thickness_m: mm(shape.baseThickness),
      fin_count: Math.round(shape.finCount),
      fin_thickness_m: mm(shape.finThickness),
      fin_height_m: mm(shape.finHeight),
      channel_width_m: mm(channelWidth()),
      depth_m: 0.06,
    },
    physical: {
      power_w: shape.power,
      t_ambient_c: shape.ambient,
      footprint_m: mm(shape.footprint),
      finish: choices.finish,
      // The emissivity the finish resolved to, not only its name: a row that recorded the
      // label alone could not be recomputed if the table behind it ever moved.
      emissivity: { mill: 0.05, clear_anodised: 0.6, black_anodised: 0.8 }[choices.finish],
      cooling: choices.cooling,
      face_velocity_ms: choices.cooling === 'forced' ? shape.velocity : 0,
      base_mounted_flush: choices.flush,
    },
    // Radiation and the pinned coefficient sit here beside the mesh size, and they are not
    // numerics: a run with either one set answered a different physical question. §9 says the
    // row has to carry them for exactly that reason.
    numerics: { ...forms.numerical },
    metrics: report?.metrics ?? {},
    verification: report?.verification ?? {},
    validity: report?.validity ?? {},
    cost: report?.stats ?? {},
  };
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

function buildForms() {
  const chosen = solver();
  if (!chosen) return;
  forms.numerical = buildParamForm(dom.numerical, chosen, PARAM_UI, forms.numerical);
}

/* ------------------------------------------------------------------------ wiring */

mountChrome(EXERCISE);
workspace = createWorkspace({
  root: dom.workspace,
  viewer: dom.viewer,
  editor: null,
  fitLabel: t('heatsink.fitProfile'),
  exportName: 'heatsink-field',
  // The profile fills its own domain, unlike the solenoid's magnet in an eight-times window,
  // so framing it is framing everything. Returning null lets the workspace fall back to the
  // whole domain rather than inventing a box that would be the same box.
  subject: () => null,
});

buildShapeControls(dom.shapeControls, DESIGN_CONTROLS, shape, applyShape);
buildShapeControls(dom.conditions, CONDITION_CONTROLS, shape, applyShape);
buildChoiceControls(dom.conditions);
applyShape();

dom.run.addEventListener('click', run);
dom.sweep.addEventListener('click', runSweep);
dom.cancel.addEventListener('click', () => currentJob?.cancel?.());
dom.reset.addEventListener('click', () => {
  Object.assign(shape, SHAPE_DEFAULTS);
  choices.finish = 'black_anodised';
  choices.cooling = 'natural';
  choices.flush = true;
  buildShapeControls(dom.shapeControls, DESIGN_CONTROLS, shape, applyShape);
  buildShapeControls(dom.conditions, CONDITION_CONTROLS, shape, applyShape);
  buildChoiceControls(dom.conditions);
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
  runs.download('heatsink-runs.csv', runs.toCsv(runs.load(EXERCISE)), 'text/csv'),
);
dom.exportJson.addEventListener('click', () =>
  runs.download('heatsink-runs.json', runs.toJson(runs.load(EXERCISE)), 'application/json'),
);
dom.clearRuns.addEventListener('click', () => {
  runs.clear(EXERCISE);
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
    t('bench.maintenance', { alternative: t('heatsink.maintenanceAlternative') }),
  );

  if (!chosen) {
    setStatusOn(dom, t('heatsink.noSolverHere'), 'error');
  } else if (!canSolve) {
    setStatusOn(dom, t('experiment.maintenanceStatus'));
  } else {
    dom.run.disabled = !finsFit();
    setStatusOn(dom, t('heatsink.ready'));
  }
} catch (error) {
  setStatusOn(dom, t('experiment.unreachable', { detail: describeError(error) }), 'error');
  dom.run.disabled = true;
}
