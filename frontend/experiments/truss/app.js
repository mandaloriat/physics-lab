/**
 * The bridge — a pin-jointed lattice across a gorge, as an exercise you build rather than tune.
 *
 * The fourth experiment, and the first whose geometry is a **network**: joints and bars, with
 * an axial force in each bar and nothing in between them. Neither `<fs-geometry-2d>` nor a
 * slider panel can describe that — one edits a `domain2d` outline and the other names
 * dimensions — so the editor here is the page's own, layered in the workspace exactly where
 * the airfoil layers the widget and hidden outside Build mode for the same reason: a drag must
 * never be both a pan and a reshaping.
 *
 * **What travels on the wire, and why it is split the way it is.** Three payloads, and the
 * split is the point of the exercise:
 *
 * - the **site** is the geometry (`regions2d`): the bounds, the two banks, the shipping
 *   channel that must stay clear, and — protocol 1.8 — a *named boundary* for every place a
 *   condition can be attached to;
 * - the **lattice** is a parameter, because the protocol has no line geometry. That is a
 *   finding rather than a convention, and `physics_lab/solvers/truss2d.py` records it;
 * - **what the bridge is asked to carry** is a load case (protocol 1.9): a total force on the
 *   joints a boundary catches, or a load per unit length along the members it spans.
 *
 * So dropping a load on one joint mints a boundary named `load_7` with a box round that joint
 * and a `force_y` on it; the deck load is a `load_y` on the band along the carriageway. Both
 * are refused rather than ignored if they catch nothing, which is exactly what makes "loaded
 * at a joint or along a stretch" a statement the server can check instead of a hope.
 *
 * See `docs/exercises/truss.md` and ADR-019.
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
import * as runs from '/shared/runs.js';
import { createWorkspace, polyline, svgNode } from '/shared/workspace.js';

const EXERCISE = 'truss';
const GEOMETRY_TYPE = 'regions2d';
/**
 * The physics this page is about, and the reason it is not `elasticity`.
 *
 * `mock.elasticity2d` also accepts `regions2d` and also solves structures, so a page filtering
 * on geometry alone — or on the nearest-sounding physics — would offer a continuum solver in a
 * truss menu and submit a site to it. It would answer, too: a rectangle of steel with a hole
 * in it, which is not the bridge. The capability declares `truss` and the page asks for that.
 */
const PHYSICS = 'truss';
const SOLVER_PREFIX = 'lab.truss';

/* ------------------------------------------------------------------------------- the site */

/**
 * The gorge, in metres, and fixed. It is the problem, not a design variable.
 *
 * A 24 m crossing with the deck at y = 0, ground either side, and a shipping channel under the
 * middle of it that nothing may pass through. The channel is what makes the site a site rather
 * than an empty rectangle: without it, a truss slung below the deck is available everywhere
 * and the design question has one obvious answer.
 */
const SITE = {
  bounds: [-4, -6, 28, 8],
  span: 24,
  deck: 0,
  bank: 4,
  channel: [4, -4.5, 20, -0.6],
};

/** Grid the builder snaps to, in metres. Half a metre: fine enough to place an apex. */
const SNAP = 0.5;

/** How close a click has to be to a joint or a bar to mean it, in metres. */
const JOINT_REACH = 0.7;
const BAR_REACH = 0.35;

const dom = Object.fromEntries(
  [
    'lesson',
    'viewer',
    'workspace',
    'editor',
    'builder',
    'builderSite',
    'builderLattice',
    'builderMarks',
    'buildTools',
    'buildHint',
    'status',
    'dot',
    'progress',
    'run',
    'cancel',
    'reset',
    'undo',
    'preset',
    'keep',
    'compareJump',
    'solver',
    'solverHint',
    'designParams',
    'loadControls',
    'conditionParams',
    'numerical',
    'derivedToggle',
    'derivedWrap',
    'derived',
    'latticeNote',
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
    'forceCurve',
    'memberTable',
    'membersNote',
    'runsPanel',
    'runsTable',
    'runsNote',
    'compare',
    'exportCsv',
    'exportJson',
    'clearRuns',
    'maintenance',
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
  ].map((key) => [
    key,
    document.getElementById(key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)),
  ]),
);

/* ---------------------------------------------------------------------------- the lattice */

/**
 * Warren truss generators, and one that is deliberately not a truss.
 *
 * `deck only` is in the list on purpose: it is a chain of collinear bars, which folds, and the
 * solver refuses it by name. Meeting that refusal early — with a sentence saying which joints
 * swing — teaches the single most important thing about a lattice in one click, and it is the
 * kind of thing a page usually hides because it looks like an error.
 */
const PRESETS = {
  'warren-8': { label: t('truss.presets.warren-8'), build: () => warren(8, 3) },
  'warren-10': { label: t('truss.presets.warren-10'), build: () => warren(10, 3) },
  'warren-6-deep': { label: t('truss.presets.warren-6-deep'), build: () => warren(6, 4.5) },
  'pratt-8': { label: t('truss.presets.pratt-8'), build: () => pratt(8, 3) },
  deck: { label: t('truss.presets.deck'), build: () => deckOnly(8) },
  empty: { label: t('truss.presets.empty'), build: () => bare() },
};

/** The lattice the page opens with: it carries the load, and it misses the mission. */
const DEFAULT_PRESET = 'warren-8';

function deckJoints(panels) {
  const step = SITE.span / panels;
  return Array.from({ length: panels + 1 }, (_, i) => [round(i * step), SITE.deck]);
}

function warren(panels, depth) {
  const step = SITE.span / panels;
  const nodes = [
    ...deckJoints(panels),
    ...Array.from({ length: panels }, (_, i) => [round((i + 0.5) * step), SITE.deck + depth]),
  ];
  const members = [];
  for (let i = 0; i < panels; i += 1) members.push([i, i + 1]);
  for (let i = 0; i < panels - 1; i += 1) members.push([panels + 1 + i, panels + 2 + i]);
  for (let i = 0; i < panels; i += 1) members.push([i, panels + 1 + i], [panels + 1 + i, i + 1]);
  return withDefaultSupports({ nodes, members }, panels);
}

function pratt(panels, depth) {
  const step = SITE.span / panels;
  const nodes = [
    ...deckJoints(panels),
    ...Array.from({ length: panels - 1 }, (_, i) => [round((i + 1) * step), SITE.deck + depth]),
  ];
  const top = (i) => panels + i; // top joint above deck joint i, for i in 1..panels-1
  const members = [];
  for (let i = 0; i < panels; i += 1) members.push([i, i + 1]);
  for (let i = 1; i < panels - 1; i += 1) members.push([top(i), top(i + 1)]);
  members.push([0, top(1)], [top(panels - 1), panels]); // the end posts
  for (let i = 1; i < panels; i += 1) members.push([i, top(i)]); // the verticals
  // Diagonals leaning towards midspan, which is what makes a Pratt a Pratt: under a downward
  // load they end up in tension and the shorter verticals take the compression.
  for (let i = 1; i < panels / 2; i += 1) members.push([top(i), i + 1]);
  for (let i = Math.ceil(panels / 2); i < panels; i += 1) members.push([top(i), i - 1]);
  return withDefaultSupports({ nodes, members }, panels);
}

function deckOnly(panels) {
  const nodes = deckJoints(panels);
  const members = Array.from({ length: panels }, (_, i) => [i, i + 1]);
  return withDefaultSupports({ nodes, members }, panels);
}

function bare() {
  return { nodes: [], members: [], supports: {}, loads: {} };
}

/** A pin on the left bank and a roller on the right: the statically determinate pair. */
function withDefaultSupports(shape, panels) {
  return { ...shape, supports: { 0: 'pin', [panels]: 'roller' }, loads: {} };
}

function round(value) {
  return Math.round(value / SNAP) * SNAP;
}

/** The live lattice. Mutated in place by the builder; every payload is derived from it. */
let lattice = PRESETS[DEFAULT_PRESET].build();

/**
 * What the bridge is asked to carry. Page-owned rather than solver parameters, because each
 * one becomes a *load case* on a named boundary rather than a number in `params`.
 */
const LOAD_DEFAULTS = { deck: 4, point: 10, wind: 0 };
const loading = { ...LOAD_DEFAULTS };

const LOAD_CONTROLS = [
  {
    key: 'deck',
    label: t('truss.loads.deck'),
    min: 0,
    max: 12,
    step: 0.5,
    unit: ' kN/m',
    title: t('truss.loads.deckTitle'),
  },
  {
    key: 'point',
    label: t('truss.loads.point'),
    min: 0,
    max: 60,
    step: 5,
    unit: ' kN',
    title: t('truss.loads.pointTitle'),
  },
  {
    key: 'wind',
    label: t('truss.loads.wind'),
    min: 0,
    max: 60,
    step: 5,
    unit: ' kN',
    title: t('truss.loads.windTitle'),
  },
];

/* -------------------------------------------------------------------- the solver's params */

/**
 * Which parameters the exercise offers, in display order, with two classifications.
 *
 * `group` is the contract's §5 taxonomy — physical or numerical — and `groupParameters` is
 * called on this list purely to enforce that every offered parameter has one; an unclassified
 * parameter would otherwise land wherever the last panel happened to be, which is how a
 * display width comes to look like a fact about steel.
 *
 * `panel` is where it is *rendered*, and the two are not the same taxonomy: the area and the
 * material are both physical, and they belong on opposite sides of the design/conditions split
 * this page (and the airfoil, and the magnetics page) arranges its configuration by. Saying
 * both explicitly is shorter than inventing a third group name that means "physical, but a
 * decision rather than a given".
 *
 * `nodes` and `members` are deliberately absent: they are the lattice, and the lattice is
 * drawn rather than typed. A generated number box for a list of 26 coordinate pairs is not a
 * control anybody can use.
 */
const PARAM_UI = [
  {
    name: 'area',
    group: 'physical',
    panel: 'design',
    label: t('truss.params.area'),
    step: 0.0002,
    hint: t('truss.params.areaHint'),
  },
  {
    name: 'self_weight',
    group: 'physical',
    panel: 'conditions',
    label: t('truss.params.selfWeight'),
    hint: t('truss.params.selfWeightHint'),
  },
  {
    name: 'safety_factor',
    group: 'physical',
    panel: 'conditions',
    label: t('truss.params.safety'),
    step: 0.1,
    hint: t('truss.params.safetyHint'),
  },
  {
    name: 'yield_strength',
    group: 'physical',
    panel: 'conditions',
    label: t('truss.params.yield'),
    step: 1e7,
    hint: t('truss.params.yieldHint'),
  },
  {
    name: 'youngs_modulus',
    group: 'physical',
    panel: 'conditions',
    label: t('truss.params.modulus'),
    step: 1e10,
    hint: t('truss.params.modulusHint'),
  },
  {
    name: 'density',
    group: 'physical',
    panel: 'conditions',
    label: t('truss.params.density'),
    step: 100,
    hint: t('truss.params.densityHint'),
  },
  {
    name: 'bar_width',
    group: 'numerical',
    panel: 'advanced',
    label: t('truss.params.barWidth'),
    step: 0.05,
    hint: t('truss.params.barWidthHint'),
  },
];

/** How each reported quantity is named in front of a person. One table, read by three things. */
const METRICS = [
  {
    key: 'utilisation_max',
    goal: t('truss.goal.capacity'),
    label: t('truss.metrics.worst'),
    symbol: 'η',
    unit: '1',
    digits: 3,
    hint: t('truss.metrics.worstHint'),
  },
  {
    key: 'span_ratio',
    goal: t('truss.goal.sag'),
    label: t('truss.metrics.spanRatio'),
    symbol: 'δ/L',
    unit: '1',
    digits: 6,
    hint: t('truss.metrics.spanRatioHint'),
  },
  {
    key: 'deflection_max',
    label: t('truss.metrics.deflection'),
    symbol: 'δ',
    unit: 'm',
    digits: 4,
    hint: t('truss.metrics.deflectionHint'),
  },
  {
    key: 'mass',
    goal: t('truss.goal.steel'),
    label: t('truss.metrics.mass'),
    symbol: 'm',
    unit: 'kg',
    digits: 1,
    hint: t('truss.metrics.massHint'),
  },
  {
    key: 'carried_per_mass',
    label: t('truss.metrics.carried'),
    symbol: 'F/m',
    unit: 'N/kg',
    digits: 1,
    hint: t('truss.metrics.carriedHint'),
  },
  {
    key: 'buckling_margin_min',
    label: t('truss.metrics.buckling'),
    symbol: 'P_cr/P',
    unit: '1',
    digits: 3,
    hint: t('truss.metrics.bucklingHint'),
  },
  {
    key: 'compression_max',
    label: t('truss.metrics.compression'),
    symbol: 'C',
    unit: 'N',
    digits: 0,
    hint: t('truss.metrics.compressionHint'),
  },
  {
    key: 'tension_max',
    label: t('truss.metrics.tension'),
    symbol: 'T',
    unit: 'N',
    digits: 0,
    hint: t('truss.metrics.tensionHint'),
  },
  {
    key: 'stress_max',
    label: t('truss.metrics.stress'),
    symbol: 'σ',
    unit: 'Pa',
    digits: 0,
    hint: t('truss.metrics.stressHint'),
  },
  {
    key: 'reaction_max',
    label: t('truss.metrics.reaction'),
    symbol: 'R',
    unit: 'N',
    digits: 0,
    hint: t('truss.metrics.reactionHint'),
  },
];

const METRIC_LABELS = Object.fromEntries(METRICS.map((metric) => [metric.key, metric]));

/** The few numbers that answer the mission, shown before any table. */
const KPIS = [
  {
    key: 'utilisation_max',
    label: t('truss.headline.worst'),
    symbol: 'η',
    unit: '%',
    plainUnit: '%',
    digits: 0,
    from: (found) =>
      typeof found.metrics?.utilisation_max === 'number'
        ? 100 * found.metrics.utilisation_max
        : null,
    goal: { value: 100, comparator: '<' },
    hint: t('truss.headline.worstHint'),
  },
  {
    key: 'mass',
    label: t('truss.headline.steel'),
    symbol: 'm',
    unit: 'kg',
    plainUnit: 'kg',
    digits: 0,
    goal: { value: 2400, comparator: '<' },
    hint: t('truss.headline.steelHint'),
  },
  {
    key: 'deflection_max',
    label: t('truss.headline.sag'),
    symbol: 'δ',
    unit: 'mm',
    plainUnit: 'mm',
    digits: 1,
    // Millimetres, not a span ratio. `δ/L < 1/800` is how a code states a serviceability limit
    // and "18 of 30 mm" is how a person pictures one; the ratio is still in All results and in
    // the tooltip, which is where §2.4 puts a symbol.
    from: (found) =>
      typeof found.metrics?.deflection_max === 'number'
        ? 1000 * Math.abs(found.metrics.deflection_max)
        : null,
    goal: { value: 30, comparator: '<' },
    hint: t('truss.headline.sagHint'),
  },
];

const CHECKS = [
  {
    key: 'joint_equilibrium_rel',
    label: t('truss.checks.joints'),
    tolerance: 'joint_equilibrium_tolerance',
    describe: t('truss.checks.jointsDescribe'),
  },
  {
    key: 'reaction_balance_rel',
    label: t('truss.checks.force'),
    tolerance: 'reaction_balance_tolerance',
    describe: t('truss.checks.forceDescribe'),
  },
  {
    key: 'moment_balance_rel',
    label: t('truss.checks.moment'),
    tolerance: 'moment_balance_tolerance',
    describe: t('truss.checks.momentDescribe'),
  },
  {
    key: 'energy_consistency_rel',
    label: t('truss.checks.energy'),
    tolerance: 'energy_consistency_tolerance',
    describe: t('truss.checks.energyDescribe'),
  },
  {
    key: 'linear_residual',
    label: t('truss.checks.linear'),
    tolerance: 'linear_residual_tolerance',
    describe: t('truss.checks.linearDescribe'),
  },
];

/**
 * How each field is presented.
 *
 * `axial_stress` is the one that needs `symmetric`: it is signed, tension one way and
 * compression the other, and a colormap centred anywhere but zero would put the sign change
 * somewhere arbitrary. `utilisation` is unsigned and has a meaningful threshold at 1 rather
 * than at its own maximum, which is what the Lock scale tool is for — pin the range on a run
 * that reaches 1 and every later run is read against the same edge.
 *
 * The captions are a symbol and two unit strings: the same in both languages, and short, which
 * is what the widget's right-aligned colorbar label needs.
 */
const FIELD_VIEW = {
  utilisation: {
    option: t('truss.fields.utilisation'),
    caption: 'η',
    colormap: 'plasma',
    contours: 0,
    hint: t('truss.fields.utilisationHint'),
  },
  axial_force: {
    option: t('truss.fields.force'),
    caption: 'N',
    colormap: 'coolwarm',
    contours: 0,
    symmetric: true,
    hint: t('truss.fields.forceHint'),
  },
  axial_stress: {
    option: t('truss.fields.stress'),
    caption: 'MPa',
    colormap: 'coolwarm',
    contours: 0,
    symmetric: true,
    hint: t('truss.fields.stressHint'),
  },
};

/* ------------------------------------------------------------------------------ the state */

const forms = { design: {}, conditions: {}, advanced: {} };
let catalogue = { all: [], byMode: {} };
let report = null;
let running = false;
let currentJob = null;
let selected = new Set();
let workspace = null;
let content = null;

/** Builder state: which tool has the pointer, and what it has half-done. */
const build = { tool: 'joint', armed: null, hover: null, pointer: null, history: [] };

const BUILD_TOOLS = [
  { id: 'move', label: t('truss.tools.move'), icon: '✥', hint: t('truss.tools.moveHint') },
  { id: 'joint', label: t('truss.tools.joint'), icon: '•', hint: t('truss.tools.jointHint') },
  { id: 'bar', label: t('truss.tools.bar'), icon: '╱', hint: t('truss.tools.barHint') },
  { id: 'support', label: t('truss.tools.support'), icon: '△', hint: t('truss.tools.supportHint') },
  { id: 'load', label: t('truss.tools.load'), icon: '↓', hint: t('truss.tools.loadHint') },
  { id: 'erase', label: t('truss.tools.erase'), icon: '⌫', hint: t('truss.tools.eraseHint') },
];

/* --------------------------------------------------------------------------- the payloads */

/**
 * The site, as `regions2d`, with a named boundary for everything a condition can attach to.
 *
 * The boundaries are **generated from what has been placed**, not fixed: a support at joint 7
 * mints `support_7` with a box round that joint, and the box is small enough (±0.2 m against a
 * 0.5 m grid) that it cannot catch its neighbour. That is what "loaded arbitrarily at one or
 * more joints" means on the wire — the geometry says where, the load case says what.
 *
 * `deck` is a band rather than a box because it names a *stretch*: every joint within 50 mm of
 * the carriageway, which resolves to the bars whose both ends are on it. `above_deck` is the
 * other stretch, and only appears when there is a side load to put on it — a boundary that
 * catches nothing is refused at submit, correctly, so a page must not declare one it has no
 * use for.
 */
function buildGeometry() {
  const [xmin, ymin, xmax, ymax] = SITE.bounds;
  const rect = (x0, y0, x1, y1) => ({
    type: 'polygon2d',
    points: [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
  });

  const boundaries = [
    {
      name: 'deck',
      select: { type: 'near', axis: 'y', value: SITE.deck, tol: 0.05 },
      description: t('truss.boundaries.deck'),
    },
  ];
  for (const index of Object.keys(lattice.supports)) {
    boundaries.push({
      name: `support_${index}`,
      select: { type: 'box', bounds: boxAround(lattice.nodes[index]) },
      description: t('truss.boundaries.support', { index }),
    });
  }
  for (const index of Object.keys(lattice.loads)) {
    boundaries.push({
      name: `load_${index}`,
      select: { type: 'box', bounds: boxAround(lattice.nodes[index]) },
      description: t('truss.boundaries.load', { index }),
    });
  }
  if (loading.wind > 0 && aboveDeck().length) {
    boundaries.push({
      name: 'above_deck',
      select: { type: 'box', bounds: [xmin, SITE.deck + 0.25, xmax, ymax] },
      description: t('truss.boundaries.aboveDeck'),
    });
  }

  return {
    type: 'regions2d',
    bounds: SITE.bounds,
    background: {},
    regions: [
      { name: 'left_bank', shape: rect(xmin + 0.1, ymin + 0.1, 0, SITE.deck), material: {} },
      {
        name: 'right_bank',
        shape: rect(SITE.span, ymin + 0.1, xmax - 0.1, SITE.deck),
        material: {},
      },
      // The one material property this capability reads. Anything else in here would be
      // ignored, which is the protocol's rule for an open bag of scalars.
      { name: 'channel', shape: rect(...SITE.channel), material: { keep_clear: 1 } },
    ],
    boundaries,
  };
}

function boxAround([x, y]) {
  const reach = 0.2;
  return [x - reach, y - reach, x + reach, y + reach];
}

/** The load case: what happens on each of those places. Newtons and newtons per metre. */
function buildConditions() {
  const conditions = {};
  for (const [index, kind] of Object.entries(lattice.supports)) {
    conditions[`support_${index}`] = kind === 'pin' ? { fixed_x: 1, fixed_y: 1 } : { fixed_y: 1 };
  }
  for (const [index, kilonewtons] of Object.entries(lattice.loads)) {
    conditions[`load_${index}`] = { force_y: -1000 * kilonewtons };
  }
  if (loading.deck > 0) conditions.deck = { load_y: -1000 * loading.deck };
  if (loading.wind > 0 && aboveDeck().length) {
    conditions.above_deck = { force_x: 1000 * loading.wind };
  }
  return conditions;
}

function currentParams() {
  return {
    ...forms.design,
    ...forms.conditions,
    ...forms.advanced,
    nodes: lattice.nodes,
    members: lattice.members,
  };
}

/* ------------------------------------------------------------------------- what is ready */

function aboveDeck() {
  return lattice.nodes.filter(([, y]) => y > SITE.deck + 0.25);
}

function attachedJoints() {
  const attached = new Set();
  for (const [i, j] of lattice.members) attached.add(i).add(j);
  return attached;
}

function deckMembers() {
  const onDeck = (index) => Math.abs(lattice.nodes[index][1] - SITE.deck) <= 0.05;
  return lattice.members.filter(([i, j]) => onDeck(i) && onDeck(j));
}

/**
 * Whether this lattice can be submitted at all, and what to say when it cannot.
 *
 * Every one of these would come back from the server as a refusal with a good message — that
 * is what the load-case design is for — but a Run button that always 422s teaches nothing, and
 * the round trip is the wrong place to learn that a bridge with no supports has none. What the
 * page must never do is *guess*: each check below mirrors a refusal the solver actually makes,
 * in the same terms, so the two cannot say different things.
 */
function readiness() {
  const attached = attachedJoints();
  if (!lattice.members.length) return { ok: false, why: t('truss.readiness.nothingBuilt') };
  const held = Object.keys(lattice.supports).filter((index) => attached.has(Number(index)));
  if (!held.length) return { ok: false, why: t('truss.readiness.nothingHolds') };
  if (loading.deck > 0 && !deckMembers().length) {
    return { ok: false, why: t('truss.readiness.noDeck') };
  }
  const stray = Object.keys(lattice.loads).find((index) => !attached.has(Number(index)));
  if (stray !== undefined) {
    return { ok: false, why: t('truss.readiness.strayLoad', { index: stray }) };
  }
  if (!Object.keys(lattice.loads).length && loading.deck === 0 && loading.wind === 0) {
    return { ok: false, why: t('truss.readiness.noLoad') };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------------- the builder */

/** Domain coordinates to the builder's own SVG frame, which flips y and nothing else. */
function toSvg([x, y]) {
  return [x, -y];
}

function drawBuilder() {
  const [xmin, ymin, xmax, ymax] = SITE.bounds;
  dom.builder.setAttribute('viewBox', `${xmin} ${-ymax} ${xmax - xmin} ${ymax - ymin}`);
  drawSite();
  drawLattice();
  drawMarks();
  dom.latticeNote.textContent = describeLattice();
  refreshBuildTools();
}

function drawSite() {
  const [xmin, ymin, xmax, ymax] = SITE.bounds;
  const grid = [];
  for (let x = Math.ceil(xmin); x <= xmax; x += 2) {
    grid.push(line([x, ymin], [x, ymax], 'site__grid'));
  }
  for (let y = Math.ceil(ymin); y <= ymax; y += 2) {
    grid.push(line([xmin, y], [xmax, y], 'site__grid'));
  }

  const [cx0, cy0, cx1, cy1] = SITE.channel;
  dom.builderSite.replaceChildren(
    ...grid,
    box(xmin, ymin, 0, SITE.deck, 'site__ground'),
    box(SITE.span, ymin, xmax, SITE.deck, 'site__ground'),
    box(cx0, cy0, cx1, cy1, 'site__clear'),
    line([0, SITE.deck], [SITE.span, SITE.deck], 'site__deck'),
    text([cx0 + 0.4, cy1 - 1.2], t('truss.site.keepClear'), 'site__label'),
    text([xmin + 0.4, SITE.deck - 1.2], t('truss.site.ground'), 'site__label'),
  );
}

function drawLattice() {
  const bars = lattice.members.map(([i, j], index) => {
    const hot = build.hover?.kind === 'member' && build.hover.index === index;
    const fouled = report?.geometry?.fouled_members?.includes(index);
    return line(
      lattice.nodes[i],
      lattice.nodes[j],
      `bar${hot ? ' bar--hot' : ''}${fouled ? ' bar--fouled' : ''}`,
    );
  });

  if (build.armed !== null && build.pointer) {
    bars.push(line(lattice.nodes[build.armed], build.pointer, 'bar--ghost'));
  }

  const joints = lattice.nodes.map((node, index) => {
    const hot = build.hover?.kind === 'joint' && build.hover.index === index;
    const [cx, cy] = toSvg(node);
    return svgNode('circle', {
      cx,
      cy,
      r: 0.26,
      class: `joint${hot ? ' joint--hot' : ''}${build.armed === index ? ' joint--armed' : ''}`,
    });
  });

  dom.builderLattice.replaceChildren(...bars, ...joints);
}

function drawMarks() {
  const marks = [];
  for (const [index, kind] of Object.entries(lattice.supports)) {
    const node = lattice.nodes[index];
    if (!node) continue;
    const [x, y] = toSvg(node);
    // A triangle under the joint for a pin; the same triangle on a line for a roller, which is
    // the drawing convention and also the honest picture: one holds two directions, the other
    // holds one and lets the deck grow.
    marks.push(
      svgNode('path', {
        d: `M ${x} ${y} L ${x - 0.55} ${y + 0.9} L ${x + 0.55} ${y + 0.9} Z`,
        class: kind === 'pin' ? 'support' : 'support support--roller',
      }),
    );
    if (kind === 'roller')
      marks.push(
        line([node[0] - 0.7, node[1] - 1.1], [node[0] + 0.7, node[1] - 1.1], 'support--roller'),
      );
  }
  for (const [index, kilonewtons] of Object.entries(lattice.loads)) {
    const node = lattice.nodes[index];
    if (!node) continue;
    const [x, y] = toSvg(node);
    const reach = 1.2 + 0.02 * kilonewtons;
    marks.push(
      svgNode('path', { d: `M ${x} ${y - reach} L ${x} ${y - 0.3}`, class: 'load' }),
      svgNode('path', {
        d: `M ${x} ${y - 0.25} L ${x - 0.28} ${y - 0.85} L ${x + 0.28} ${y - 0.85} Z`,
        class: 'load__head',
      }),
      text([node[0] + 0.4, node[1] + reach - 0.2], `${kilonewtons} kN`, 'site__label'),
    );
  }
  dom.builderMarks.replaceChildren(...marks);
}

function line(a, b, className) {
  const [x1, y1] = toSvg(a);
  const [x2, y2] = toSvg(b);
  return svgNode('line', { x1, y1, x2, y2, class: className });
}

function box(x0, y0, x1, y1, className) {
  const [left, top] = toSvg([Math.min(x0, x1), Math.max(y0, y1)]);
  return svgNode('rect', {
    x: left,
    y: top,
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
    class: className,
  });
}

function text(at, value, className) {
  const [x, y] = toSvg(at);
  return svgNode('text', { x, y, class: className }, document.createTextNode(value));
}

/* ------------------------------------------------------------------- builder interaction */

/** Where a pointer event is, in domain coordinates. */
function pointOf(event) {
  const rect = dom.builder.getBoundingClientRect();
  const [xmin, , xmax, ymax] = SITE.bounds;
  const [, ymin] = SITE.bounds;
  return [
    xmin + ((event.clientX - rect.left) / rect.width) * (xmax - xmin),
    ymax - ((event.clientY - rect.top) / rect.height) * (ymax - ymin),
  ];
}

function nearestJoint(point) {
  let best = null;
  lattice.nodes.forEach((node, index) => {
    const distance = Math.hypot(node[0] - point[0], node[1] - point[1]);
    if (distance <= JOINT_REACH && (!best || distance < best.distance)) {
      best = { kind: 'joint', index, distance };
    }
  });
  return best;
}

function nearestMember(point) {
  let best = null;
  lattice.members.forEach(([i, j], index) => {
    const distance = distanceToSegment(point, lattice.nodes[i], lattice.nodes[j]);
    if (distance <= BAR_REACH && (!best || distance < best.distance)) {
      best = { kind: 'member', index, distance };
    }
  });
  return best;
}

function distanceToSegment(point, start, end) {
  const vx = end[0] - start[0];
  const vy = end[1] - start[1];
  const length = vx * vx + vy * vy;
  const t = length
    ? Math.max(0, Math.min(1, ((point[0] - start[0]) * vx + (point[1] - start[1]) * vy) / length))
    : 0;
  return Math.hypot(start[0] + t * vx - point[0], start[1] + t * vy - point[1]);
}

function snap(point) {
  const [xmin, ymin, xmax, ymax] = SITE.bounds;
  return [
    Math.min(xmax - 0.5, Math.max(xmin + 0.5, round(point[0]))),
    Math.min(ymax - 0.5, Math.max(ymin + 0.5, round(point[1]))),
  ];
}

/** Snapshot before every edit, so a mis-click is one keystroke rather than a rebuild. */
function remember() {
  build.history.push(JSON.stringify(lattice));
  if (build.history.length > 40) build.history.shift();
  dom.undo.disabled = false;
}

function undo() {
  const previous = build.history.pop();
  if (!previous) return;
  lattice = JSON.parse(previous);
  dom.undo.disabled = !build.history.length;
  afterEdit();
}

/** Everything that has to happen after the lattice changes, in one place. */
function afterEdit() {
  build.armed = null;
  drawBuilder();
  renderDerived();
  updateReadiness();
  workspace?.draw();
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  const point = pointOf(event);
  const joint = nearestJoint(point);
  const member = joint ? null : nearestMember(point);

  if (build.tool === 'move' && joint) {
    remember();
    build.dragging = joint.index;
    dom.builder.setPointerCapture(event.pointerId);
    return;
  }
  if (build.tool === 'joint') {
    remember();
    lattice.nodes.push(snap(point));
    afterEdit();
    return;
  }
  if (build.tool === 'bar' && joint) {
    if (build.armed === null) {
      build.armed = joint.index;
      drawLattice();
      return;
    }
    if (build.armed !== joint.index && !hasMember(build.armed, joint.index)) {
      remember();
      lattice.members.push([build.armed, joint.index]);
    }
    afterEdit();
    return;
  }
  if (build.tool === 'support' && joint) {
    remember();
    const current = lattice.supports[joint.index];
    if (!current) lattice.supports[joint.index] = 'pin';
    else if (current === 'pin') lattice.supports[joint.index] = 'roller';
    else delete lattice.supports[joint.index];
    afterEdit();
    return;
  }
  if (build.tool === 'load' && joint) {
    remember();
    if (lattice.loads[joint.index]) delete lattice.loads[joint.index];
    else lattice.loads[joint.index] = loading.point;
    afterEdit();
    return;
  }
  if (build.tool === 'erase') {
    if (joint) {
      remember();
      removeJoint(joint.index);
      afterEdit();
    } else if (member) {
      remember();
      lattice.members.splice(member.index, 1);
      afterEdit();
    }
  }
}

function hasMember(a, b) {
  return lattice.members.some(([i, j]) => (i === a && j === b) || (i === b && j === a));
}

/**
 * Remove a joint, its bars, and everything attached to it — then renumber.
 *
 * Renumbering is the fiddly half and the reason this is one function: every member, support
 * and load names a joint by its *index*, so deleting joint 3 moves joint 4 to 3 and every
 * reference above it has to move with it. Getting this wrong does not throw; it silently
 * attaches a support to a different joint, which is the kind of bug you find by wondering why
 * the bridge is held up in the wrong place.
 */
function removeJoint(index) {
  lattice.nodes.splice(index, 1);
  lattice.members = lattice.members
    .filter(([i, j]) => i !== index && j !== index)
    .map(([i, j]) => [i > index ? i - 1 : i, j > index ? j - 1 : j]);
  lattice.supports = renumber(lattice.supports, index);
  lattice.loads = renumber(lattice.loads, index);
}

function renumber(table, removed) {
  const out = {};
  for (const [key, value] of Object.entries(table)) {
    const at = Number(key);
    if (at === removed) continue;
    out[at > removed ? at - 1 : at] = value;
  }
  return out;
}

function onPointerMove(event) {
  const point = pointOf(event);
  if (build.dragging !== undefined && build.dragging !== null) {
    lattice.nodes[build.dragging] = snap(point);
    drawBuilder();
    return;
  }
  build.pointer = point;
  const found = nearestJoint(point) ?? nearestMember(point);
  const changed = found?.kind !== build.hover?.kind || found?.index !== build.hover?.index;
  build.hover = found;
  if (changed || build.armed !== null) drawLattice();
}

function onPointerUp() {
  if (build.dragging === undefined || build.dragging === null) return;
  build.dragging = null;
  afterEdit();
}

function setTool(tool) {
  build.tool = tool;
  build.armed = null;
  refreshBuildTools();
  drawLattice();
}

function refreshBuildTools() {
  const editing = workspace?.mode === 'edit';
  dom.buildTools.replaceChildren(
    el(
      'div',
      { class: 'toolgroup' },
      ...BUILD_TOOLS.map((tool) => {
        const button = el(
          'button',
          {
            type: 'button',
            class: `tool${build.tool === tool.id && editing ? ' is-active' : ''}`,
            title: editing ? tool.hint : t('truss.tools.pressBuild'),
            'aria-pressed': String(build.tool === tool.id && editing),
            disabled: editing ? null : true,
          },
          el('span', { class: 'tool__icon', 'aria-hidden': 'true', text: tool.icon }),
          el('span', { class: 'tool__label', text: tool.label }),
        );
        button.addEventListener('click', () => setTool(tool.id));
        return button;
      }),
    ),
  );
  dom.buildHint.textContent = editing
    ? (BUILD_TOOLS.find((tool) => tool.id === build.tool)?.hint ?? '')
    : t('truss.tools.outsideBuild');
}

function describeLattice() {
  const attached = attachedJoints();
  const stray = lattice.nodes.length - attached.size;
  const supports = Object.values(lattice.supports);
  const parts = [
    t('truss.lattice.counts', { joints: lattice.nodes.length, bars: lattice.members.length }),
    t('truss.lattice.supports', {
      pinned: supports.filter((kind) => kind === 'pin').length,
      rollers: supports.filter((kind) => kind === 'roller').length,
    }),
  ];
  const dropped = Object.keys(lattice.loads).length;
  if (dropped) parts.push(t('truss.lattice.dropped', { count: dropped }));
  if (stray > 0) parts.push(t('truss.lattice.stray', { count: stray }));
  return parts.join(' ');
}

/** What follows from the lattice before anything is solved: exact, and needing no server. */
function renderDerived() {
  const total = lattice.members.reduce((sum, [i, j]) => {
    const [x1, y1] = lattice.nodes[i];
    const [x2, y2] = lattice.nodes[j];
    return sum + Math.hypot(x2 - x1, y2 - y1);
  }, 0);
  const area = forms.design.area ?? 0;
  const density = forms.conditions.density ?? 0;
  const longest = lattice.members.reduce((worst, [i, j]) => {
    const [x1, y1] = lattice.nodes[i];
    const [x2, y2] = lattice.nodes[j];
    return Math.max(worst, Math.hypot(x2 - x1, y2 - y1));
  }, 0);

  const imposed =
    loading.deck *
      deckMembers().reduce((sum, [i, j]) => {
        return sum + Math.abs(lattice.nodes[j][0] - lattice.nodes[i][0]);
      }, 0) +
    Object.values(lattice.loads).reduce((sum, value) => sum + value, 0);

  dom.derived.replaceChildren(
    entry(t('truss.derived.totalLength'), `${total.toFixed(1)} m`),
    entry(t('truss.derived.longest'), `${longest.toFixed(2)} m`),
    entry(t('truss.derived.steel'), `${(total * area * density).toFixed(0)} kg`),
    entry(t('truss.derived.imposed'), `${imposed.toFixed(1)} kN`),
    entry(t('truss.derived.euler'), `${eulerOf(longest, area).toFixed(1)} kN`),
  );
}

/**
 * The critical load of a bar, in kilonewtons, worked here as well as in the solver.
 *
 * Duplicated on purpose and it is worth saying why: this is the number that decides the
 * exercise, and seeing it move as the section slider moves — before pressing Run — is what
 * turns "the bar buckled" into "of course it did". The solver's value is the one reported;
 * this one is a prediction, and if the two ever disagreed the run would say so.
 */
function eulerOf(length, area) {
  const modulus = forms.conditions.youngs_modulus ?? 210e9;
  return length > 0 ? (Math.PI * modulus * area * area) / (4 * length * length) / 1000 : 0;
}

function entry(label, value) {
  return el('div', {}, el('dt', { text: label }), el('dd', { text: value }));
}

/* ---------------------------------------------------------------------------- the solve */

function solver() {
  return catalogue.all.find((entry_) => entry_.name.startsWith(SOLVER_PREFIX)) ?? null;
}

async function run() {
  if (running) return;
  const chosen = solver();
  if (!chosen) {
    setStatusOn(dom, t('truss.noSolver'), 'error');
    return;
  }
  const ready = readiness();
  if (!ready.ok) {
    setStatusOn(dom, ready.why, 'error');
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
      conditions: buildConditions(),
      onJob: (job) => {
        currentJob = job;
      },
    });
    if (!result) return;

    report = await fetchReport(result);
    dom.results.hidden = false;
    // Out of Build mode on a result, because the builder is opaque and sits over the field:
    // staying in it would answer the question and then cover the answer up. The lattice is
    // still drawn — as an annotation layer, over the colours rather than instead of them.
    if (workspace.mode === 'edit') workspace.setMode('pan');
    workspace.setResult(result);
    syncFieldOptions(dom.viewer, dom.field, FIELD_VIEW, dom.fieldHint);
    showStats(dom.stats, result);
    showArtifacts(dom.artifacts, result.artifacts);
    present();
    drawBuilder();
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
 * Protocol 1.9 still has nowhere to put a computed metric, a warning or a per-member table —
 * `stats` is `dict[str, float]` and means what the solve cost. Upstream's issue #46 is the one
 * that gives the envelope somewhere for this; until it lands, `report.json` is the honest
 * carrier and its content is exactly the payload that becomes native metrics later. ADR-015.
 */
async function fetchReport(result) {
  const artifact = (result.artifacts ?? []).find((entry_) => entry_.name === 'report.json');
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

  declareOverlays();

  if (!report) return;
  drawMemberLadder();
  drawMemberTable();
}

/**
 * Utilisation, sorted, as a ladder. The question it answers is "how many are near the edge?".
 *
 * Plotted against rank rather than against member index deliberately: the index is an artefact
 * of the order the bars were drawn in, so a plot against it is a picture of the builder's
 * history. Against rank it is a picture of the structure — a flat ladder means the material is
 * evenly worked, a spike means one bar is doing everything and the rest are ballast.
 */
function drawMemberLadder() {
  const utilisation = [...(report.members?.utilisation ?? [])].sort((a, b) => b - a);
  drawCurve(dom.forceCurve, {
    traces: [
      {
        name: t('truss.members.ladderTrace'),
        points: utilisation.map((value, index) => [index + 1, value]),
      },
    ],
    xLabel: t('truss.members.ladderX'),
    yLabel: t('truss.members.ladderY'),
    marks: [{ y: 1, label: t('truss.members.capacity') }],
  });
}

function drawMemberTable() {
  const members = report.members ?? {};
  const rows = (members.utilisation ?? [])
    .map((value, index) => ({ index, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  dom.memberTable.replaceChildren(
    el(
      'table',
      { class: 'runs' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          // The word rather than the symbol: the table's headers are uppercased by the
          // stylesheet, and an uppercased eta is a capital H.
          ...['bar', 'force', 'length', 'utilisation', 'limitedBy'].map((key) =>
            el('th', { scope: 'col', text: t(`truss.members.${key}`) }),
          ),
        ),
      ),
      el(
        'tbody',
        {},
        ...rows.map(({ index, value }) => {
          const force = members.force[index];
          const compressed = members.compressed[index];
          const critical = members.critical_load[index];
          const squash = (report.numerics?.yield_strength ?? 250e6) * (report.numerics?.area ?? 0);
          return el(
            'tr',
            { class: value >= 1 ? 'is-warned' : null },
            el('th', { scope: 'row', text: String(index) }),
            el('td', { class: 'num', text: (force / 1000).toFixed(1) }),
            el('td', { class: 'num', text: members.length[index].toFixed(2) }),
            el('td', { class: 'num', text: value.toFixed(2) }),
            el('td', {
              text:
                !compressed || critical >= squash
                  ? t('truss.members.yield')
                  : t('truss.members.buckling'),
            }),
          );
        }),
      ),
    ),
  );

  const worst = report.members?.utilisation?.indexOf(report.metrics?.utilisation_max);
  dom.membersNote.textContent = worst >= 0 ? t('truss.members.note', { index: worst }) : '';
}

/* --------------------------------------------------------------- the annotation layer */

function declareOverlays() {
  const noRun = t('workspace.noRun');
  workspace.setOverlays([
    {
      id: 'lattice',
      label: t('truss.overlays.lattice'),
      colour: 'var(--overlay-profile)',
      on: true,
    },
    {
      id: 'deformed',
      // The factor is in the label, not in a footnote. A picture of a deflection with no scale
      // on it is the easiest way there is to leave someone thinking a bridge is sagging.
      label: report
        ? t('truss.overlays.deformedScaled', { factor: Math.round(magnification()) })
        : t('truss.overlays.deformed'),
      colour: 'var(--overlay-chord)',
      on: true,
      enabled: Boolean(report?.displacement?.length),
      why: noRun,
      title: t('truss.overlays.deformedTitle'),
    },
    {
      id: 'worst',
      label: t('truss.overlays.worst'),
      colour: 'var(--overlay-peak)',
      on: true,
      enabled: Boolean(report?.members?.utilisation?.length),
      why: noRun,
      title: t('truss.overlays.worstTitle'),
    },
    { id: 'loads', label: t('truss.overlays.loads'), colour: 'var(--overlay-cp)', on: true },
  ]);
}

/**
 * How far the deflected shape is exaggerated.
 *
 * A bridge that deflects 12 mm over 24 m is drawn, to scale, as a line. So the shape is
 * magnified until the largest movement is a fortieth of the span — far enough to read the
 * shape, close enough that it still looks like the bridge it belongs to.
 */
function magnification() {
  const largest = report?.metrics?.deflection_max ?? 0;
  if (!largest) return 0;
  return Math.min(2000, (0.025 * SITE.span) / largest);
}

function drawOverlay({ svg, project, layerOn }) {
  if (layerOn('lattice')) {
    const group = svgNode('g', { class: 'overlay__lattice' });
    for (const [i, j] of lattice.members) {
      group.append(polyline([project(lattice.nodes[i]), project(lattice.nodes[j])], null));
    }
    svg.append(group);
  }

  if (layerOn('deformed') && report?.displacement?.length) {
    const factor = magnification();
    const moved = (index) => {
      const [x, y] = report.geometry.nodes[index];
      const [dx, dy] = report.displacement[index];
      return project([x + factor * dx, y + factor * dy]);
    };
    const group = svgNode('g', { class: 'overlay__deformed' });
    for (const [i, j] of report.geometry.members)
      group.append(polyline([moved(i), moved(j)], null));
    svg.append(group);
  }

  if (layerOn('worst') && report?.members?.utilisation?.length) {
    const worst = report.members.utilisation.indexOf(Math.max(...report.members.utilisation));
    const [i, j] = report.geometry.members[worst];
    const group = svgNode('g', { class: 'overlay__worst' });
    group.append(
      polyline([project(report.geometry.nodes[i]), project(report.geometry.nodes[j])], null),
    );
    svg.append(group);
  }

  if (layerOn('loads')) {
    const group = svgNode('g', { class: 'overlay__support' });
    for (const index of Object.keys(lattice.supports)) {
      const node = lattice.nodes[index];
      if (!node) continue;
      const [px, py] = project(node);
      group.append(
        polyline(
          [
            [px - 9, py + 14],
            [px, py],
            [px + 9, py + 14],
          ],
          null,
        ),
      );
    }
    svg.append(group);

    const arrows = svgNode('g', { class: 'overlay__load' });
    for (const index of Object.keys(lattice.loads)) {
      const node = lattice.nodes[index];
      if (!node) continue;
      const [px, py] = project(node);
      arrows.append(
        polyline(
          [
            [px, py - 26],
            [px, py],
          ],
          null,
        ),
      );
      arrows.append(
        polyline(
          [
            [px - 5, py - 8],
            [px, py],
            [px + 5, py - 8],
          ],
          null,
        ),
      );
    }
    svg.append(arrows);
  }
}

/** The box "Fit the bridge" frames: the lattice, with a margin. */
function latticeBox() {
  if (!lattice.nodes.length) return null;
  const xs = lattice.nodes.map(([x]) => x);
  const ys = lattice.nodes.map(([, y]) => y);
  return [Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) + 1, Math.max(...ys) + 1];
}

/* ------------------------------------------------------------------------ the run table */

const COLUMNS = [
  { path: 'geometry.label', label: t('truss.columns.lattice') },
  // The symbol columns are symbols in both languages.
  { path: 'metrics.utilisation_max', label: 'η' },
  { path: 'metrics.mass', label: t('truss.columns.mass') },
  { path: 'metrics.span_ratio', label: 'δ/L' },
  { path: 'metrics.carried_per_mass', label: 'N/kg' },
  { path: 'physical.area', label: t('truss.columns.area') },
  { path: 'physical.deck_load', label: t('truss.columns.deck') },
  { path: 'verification.joint_equilibrium_rel', label: t('truss.columns.joint') },
];

/** One row: every input, the answer, the residuals, the warnings, the provenance. */
function row() {
  return {
    exercise: { id: EXERCISE, version: '1.0.0' },
    solver: report.solver,
    model: report.model,
    geometry: {
      source: 'custom',
      label: describeShape(),
      // The lattice is stored whole, not by hash: it *is* a few hundred numbers, so the row
      // that recomputes the run and the row that describes it can be the same row. The hash
      // rule in the contract's §5 exists for an outline nobody can retype; this is not one.
      nodes: lattice.nodes,
      members: lattice.members,
      supports: lattice.supports,
      joint_loads: lattice.loads,
      span: report.geometry.span,
      member_count: report.geometry.member_count,
      joint_count: report.geometry.joint_count,
      fouled_members: report.geometry.fouled_members,
      site: SITE.bounds,
    },
    physical: {
      area: report.numerics.area,
      youngs_modulus: report.numerics.youngs_modulus,
      density: report.numerics.density,
      yield_strength: report.numerics.yield_strength,
      safety_factor: report.numerics.safety_factor,
      self_weight: report.numerics.self_weight,
      deck_load: -1000 * loading.deck,
      wind_load: 1000 * loading.wind,
    },
    conditions: report.conditions,
    numerics: { bar_width: report.numerics.bar_width },
    dimensionless: report.dimensionless,
    metrics: report.metrics,
    verification: report.verification,
    validity: report.validity,
    cost: { cells: 2 * report.geometry.member_count },
  };
}

function describeShape() {
  const depth = Math.max(...lattice.nodes.map(([, y]) => y), 0) - SITE.deck;
  return t('truss.shapeLabel', { bars: lattice.members.length, depth: depth.toFixed(1) });
}

function refreshRuns(rows = runs.load(EXERCISE), evicted = 0) {
  selected = new Set([...selected].filter((key) => rows.some((entry_) => entry_.saved_at === key)));
  runs.renderTable(dom.runsTable, rows, {
    columns: COLUMNS,
    selected,
    onSelect: (savedAt, on) => {
      if (on) selected.add(savedAt);
      else selected.delete(savedAt);
      refreshRuns(rows);
    },
    onLoad: (entry_) => loadRun(entry_),
    onDelete: (savedAt) => refreshRuns(runs.remove(EXERCISE, savedAt)),
  });
  runs.renderComparison(
    dom.compare,
    rows.filter((entry_) => selected.has(entry_.saved_at)),
    { labels: METRIC_LABELS },
  );

  const parts = [t('experiment.kept', { count: rows.length, capacity: runs.CAPACITY })];
  if (evicted) parts.push(t('experiment.evicted', { count: evicted }));
  dom.runsNote.textContent = parts.join(' ');
  for (const button of [dom.exportCsv, dom.exportJson, dom.clearRuns]) {
    button.disabled = !rows.length;
  }
  dom.compareJump.hidden = rows.length < 2;
  if (selected.size >= 2) path.mark('compare');
  if (!rows.length) dom.runsNote.textContent = t('runs.none');
  else if (rows.length === 1) dom.runsNote.textContent += ` ${t('runs.one')}`;
}

/** Put a saved row's inputs back on the page. Does not re-solve: Run is still the visitor's. */
function loadRun(entry_) {
  lattice = {
    nodes: entry_.geometry.nodes.map((node) => [...node]),
    members: entry_.geometry.members.map((member) => [...member]),
    supports: { ...entry_.geometry.supports },
    loads: { ...entry_.geometry.joint_loads },
  };
  Object.assign(loading, {
    deck: -entry_.physical.deck_load / 1000,
    wind: entry_.physical.wind_load / 1000,
    point: loading.point,
  });
  buildShapeControls(dom.loadControls, LOAD_CONTROLS, loading, onLoadChange);
  buildForms({ ...currentParams(), ...entry_.physical, ...entry_.numerics });
  build.history = [];
  dom.undo.disabled = true;
  afterEdit();
  setStatusOn(dom, t('truss.loadedRun', { label: entry_.geometry.label }));
}

function buildForms(previous = currentParams()) {
  const chosen = solver();
  if (!chosen) return;
  // Called for its refusal rather than for its return value: every offered parameter must
  // carry a contract group, and an unclassified one throws here instead of quietly landing in
  // whichever panel came last.
  groupParameters(PARAM_UI);
  const inPanel = (panel) => PARAM_UI.filter((config) => config.panel === panel);
  forms.design = buildParamForm(dom.designParams, chosen, inPanel('design'), previous);
  forms.conditions = buildParamForm(dom.conditionParams, chosen, inPanel('conditions'), previous);
  forms.advanced = buildParamForm(dom.numerical, chosen, inPanel('advanced'), previous);
}

function onLoadChange() {
  drawBuilder();
  renderDerived();
  updateReadiness();
}

function updateReadiness() {
  const ready = readiness();
  const chosen = solver();
  if (!chosen || dom.maintenance.hidden === false) return;
  dom.run.disabled = !ready.ok;
  if (!running) {
    setStatusOn(dom, ready.ok ? t('truss.ready') : ready.why);
  }
}

/* ---------------------------------------------------------------------------- start-up */

mountChrome('experiments');

dom.preset.replaceChildren(
  ...Object.entries(PRESETS).map(
    ([key, preset]) => new Option(preset.label, key, false, key === DEFAULT_PRESET),
  ),
);
buildShapeControls(dom.loadControls, LOAD_CONTROLS, loading, onLoadChange);

workspace = createWorkspace({
  root: dom.workspace,
  viewer: dom.viewer,
  editor: dom.editor,
  fitLabel: t('truss.fitBridge'),
  editLabel: t('truss.build'),
  editTitle: t('truss.buildTitle'),
  exportName: 'bridge-lattice',
  subject: latticeBox,
  onDraw: drawOverlay,
  onModeChange: () => refreshBuildTools(),
});

// The workspace reads `bounds` off whatever it was given as an editor, and uses it before the
// first result exists. Publishing the site here is what keeps the annotation layer aligned
// with the builder from the first paint rather than from the first solve.
dom.editor.bounds = SITE.bounds;
document
  .getElementById('stage')
  .style.setProperty(
    '--domain-aspect',
    String((SITE.bounds[2] - SITE.bounds[0]) / (SITE.bounds[3] - SITE.bounds[1])),
  );

drawBuilder();
declareOverlays();

dom.builder.addEventListener('pointerdown', onPointerDown);
dom.builder.addEventListener('pointermove', onPointerMove);
dom.builder.addEventListener('pointerup', onPointerUp);
dom.builder.addEventListener('pointerleave', () => {
  build.hover = null;
  drawLattice();
});

dom.run.addEventListener('click', run);
dom.cancel.addEventListener('click', () => currentJob?.cancel());
dom.undo.addEventListener('click', undo);
dom.preset.addEventListener('change', () => {
  remember();
  lattice = PRESETS[dom.preset.value].build();
  afterEdit();
});
dom.reset.addEventListener('click', () => {
  remember();
  lattice = PRESETS[DEFAULT_PRESET].build();
  dom.preset.value = DEFAULT_PRESET;
  Object.assign(loading, LOAD_DEFAULTS);
  buildShapeControls(dom.loadControls, LOAD_CONTROLS, loading, onLoadChange);
  afterEdit();
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
  runs.download('bridge-runs.csv', runs.toCsv(runs.load(EXERCISE)), 'text/csv'),
);
dom.exportJson.addEventListener('click', () =>
  runs.download('bridge-runs.json', runs.toJson(runs.load(EXERCISE)), 'application/json'),
);
dom.clearRuns.addEventListener('click', () => {
  runs.clear(EXERCISE);
  refreshRuns();
});

/* ------------------------------------------------------------- one suggestion at a time */

/**
 * What to say after an attempt that did not pass.
 *
 * Editorial rules rather than generated prose (§13.7). The compression case is separated from
 * the tension one on purpose: they call for opposite moves — shorten the bar, or thicken it —
 * and a single "add steel" hint would teach the wrong lesson about buckling.
 */
function suggestion() {
  if (!report) return null;
  const worst = report.metrics?.utilisation_max;
  const mass = report.metrics?.mass;
  const sag = report.metrics?.deflection_max;
  const buckling = report.metrics?.buckling_margin_min;
  if ((report.validity?.warnings ?? []).length) return t('truss.hint.outside');
  if (typeof worst === 'number' && worst >= 1) {
    return typeof buckling === 'number' && buckling < 1.5
      ? t('truss.hint.compression')
      : t('truss.hint.tension');
  }
  if (typeof mass === 'number' && mass >= 2400) {
    return t('truss.hint.mass', { excess: Math.round(mass - 2400) });
  }
  if (typeof sag === 'number' && 1000 * sag >= 30) return t('truss.hint.sag');
  return null;
}

/** Numbers the post-attempt cards may quote, so an explanation can be about *this* attempt. */
function attemptFacts() {
  if (!report) return {};
  const worst = report.metrics?.utilisation_max;
  return {
    utilisation: typeof worst === 'number' ? Math.round(100 * worst) : '—',
    mass: Math.round(report.metrics?.mass ?? 0),
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
    t('bench.maintenance', { alternative: t('truss.maintenanceAlternative') }),
  );

  if (!chosen) {
    setStatusOn(dom, t('truss.noSolverHere'), 'error');
  } else if (!canSolve) {
    setStatusOn(dom, t('experiment.maintenanceStatus'));
  } else {
    updateReadiness();
  }
} catch (error) {
  setStatusOn(dom, t('experiment.unreachable', { detail: describeError(error) }), 'error');
  dom.run.disabled = true;
}
