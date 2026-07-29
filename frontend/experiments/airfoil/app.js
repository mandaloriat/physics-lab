/**
 * Galleria del vento — the airfoil experiment.
 *
 * Everything simulation-related is Fenix Spoon's: `<fs-geometry-2d>` produces protocol
 * geometry, `@fenix-spoon/client` submits the job and streams progress, `<fs-viewer>`
 * renders the result. What this file adds is the *experiment*: a profile the visitor can
 * reason about in physical terms, a parameter form built from whatever the chosen solver
 * publishes, and the didactic frame around the picture.
 */

import '@fenix-spoon/geometry-2d';
import '@fenix-spoon/viewer';
import { JobFailedError } from '@fenix-spoon/client';

import { MODES, client, paramSpec, solversFor } from '/shared/api.js';
import {
  describeError,
  el,
  formatBytes,
  health,
  mountChrome,
  statEntries,
} from '/shared/components.js';

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
    ? 'Stai modificando i punti a mano: i cursori qui sopra non descrivono più questa forma. Ripristina per tornare al profilo NACA.'
    : `Profilo NACA a quattro cifre: curvatura ${shape.camber} %, spessore ${shape.thickness} %, incidenza ${shape.angle}°.`;
}

const SHAPE_CONTROLS = [
  {
    key: 'camber',
    label: 'Curvatura',
    min: 0,
    max: 9,
    step: 0.5,
    unit: '%',
    hint: 'Quanto la linea media si scosta dalla corda. A 0 il profilo è simmetrico.',
  },
  {
    key: 'thickness',
    label: 'Spessore',
    min: 6,
    max: 20,
    step: 1,
    unit: '%',
    hint: 'Spessore massimo in percentuale della corda.',
  },
  {
    key: 'angle',
    label: 'Incidenza',
    min: -10,
    max: 12,
    step: 1,
    unit: '°',
    hint: 'Rotazione del profilo attorno al quarto di corda.',
  },
];

function buildShapeControls() {
  dom.shapeControls.replaceChildren(
    ...SHAPE_CONTROLS.map((control) => {
      const readout = el('span', {
        class: 'field__value',
        text: `${shape[control.key]}${control.unit}`,
      });
      const input = el('input', {
        type: 'range',
        min: control.min,
        max: control.max,
        step: control.step,
        value: shape[control.key],
        id: `shape-${control.key}`,
      });
      input.addEventListener('input', () => {
        shape[control.key] = Number(input.value);
        readout.textContent = `${shape[control.key]}${control.unit}`;
        applyShape();
      });
      return el(
        'div',
        { class: 'field' },
        el(
          'label',
          { class: 'field__label', for: `shape-${control.key}` },
          el('span', { text: control.label }),
          readout,
        ),
        input,
        el('span', { class: 'field__hint', text: control.hint }),
      );
    }),
  );
}

/* ---------------------------------------------------------- solver parameter form */

/**
 * Which parameters the experiment offers, in display order.
 *
 * The list names parameters; it does not describe them. Type, bounds, allowed values and
 * default all come from the solver's own `params_schema`, because the two solvers behind
 * this page do not agree on their inputs — `mock.laplace2d` takes `resolution` and
 * `iterations`, `dolfinx.potential_flow2d` takes `mesh_size`. A parameter the selected
 * solver does not publish is simply not rendered, and no value is ever invented for one.
 */
const PARAM_UI = [
  {
    name: 'resolution',
    label: 'Risoluzione',
    hint: 'Punti di griglia sul lato lungo del dominio.',
  },
  {
    name: 'mesh_size',
    label: 'Dimensione mesh',
    hint: 'Lunghezza di riferimento degli elementi. Più piccola significa più elementi: il server rifiuta i valori che sforano il suo budget di celle.',
    step: 0.005,
  },
  { name: 'iterations', label: 'Iterazioni', hint: 'Passi dell’iterazione di Jacobi.' },
  { name: 'u_inf', label: 'Velocità della corrente', hint: 'Velocità indisturbata a monte.' },
  {
    name: 'output',
    label: 'Tipo di risultato',
    hint: 'La mesh triangolare mostra la discretizzazione vera e propria.',
    optionLabels: { grid2d: 'griglia regolare', mesh2d: 'mesh triangolare' },
  },
  { name: 'write_vtk', label: 'Allega file VTK', hint: 'Scaricabile e apribile in ParaView.' },
];

/** Current parameter values, keyed by name. Rebuilt whenever the solver changes. */
let params = {};

function buildParamForm(solver) {
  const next = {};
  const controls = [];

  for (const config of PARAM_UI) {
    const spec = paramSpec(solver, config.name);
    // No schema entry, or a schema entry with no default: not offered. Guessing a value
    // the server did not publish is how a form starts sending nonsense.
    if (!spec || spec.default === undefined) continue;

    // Carry the visitor's choice across a solver switch when it is still expressible.
    const carried = params[config.name];
    const value = isUsable(carried, spec) ? carried : spec.default;
    next[config.name] = value;

    controls.push(
      renderParam(config, spec, value, (updated) => {
        params[config.name] = updated;
      }),
    );
  }

  params = next;
  dom.solverParams.replaceChildren(...controls);
}

function isUsable(value, spec) {
  if (value === undefined) return false;
  if (spec.enum) return spec.enum.includes(value);
  if (typeof spec.default === 'boolean') return typeof value === 'boolean';
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (spec.min !== undefined && value < spec.min) return false;
  if (spec.max !== undefined && value > spec.max) return false;
  return true;
}

function renderParam(config, spec, value, onChange) {
  const id = `param-${config.name}`;
  // The solver's own `description` is the authoritative English wording; it goes on the
  // control as a tooltip rather than into the visible hint, which is the lab's Italian
  // explanation. Showing both inline just prints the same sentence twice.
  const title = spec.description ?? null;

  if (typeof spec.default === 'boolean') {
    const input = el('input', { type: 'checkbox', id, checked: value === true, title });
    input.addEventListener('change', () => onChange(input.checked));
    return el(
      'div',
      { class: 'field' },
      el('label', { class: 'check', for: id }, input, el('span', { text: config.label })),
      el('span', { class: 'field__hint', text: config.hint }),
    );
  }

  if (spec.enum) {
    const select = el('select', { id, title });
    select.replaceChildren(
      ...spec.enum.map(
        (option) =>
          new Option(config.optionLabels?.[option] ?? option, option, false, option === value),
      ),
    );
    select.addEventListener('change', () => onChange(select.value));
    return el(
      'div',
      { class: 'field' },
      el('label', { class: 'field__label', for: id }, el('span', { text: config.label })),
      select,
      el('span', { class: 'field__hint', text: config.hint }),
    );
  }

  const integer = spec.type === 'integer';
  const bounded = spec.min !== undefined && spec.max !== undefined;
  const step = config.step ?? (integer ? 1 : 0.1);
  const readout = el('span', { class: 'field__value', text: format(value, integer) });

  // A slider needs two bounds. `mesh_size` is declared `gt=0` with no maximum, so it gets
  // a number input instead of a fabricated upper limit — and an over-budget value comes
  // back from the server as a clear 422 rather than being silently clamped here.
  const input = el('input', {
    type: bounded ? 'range' : 'number',
    id,
    step,
    value,
    title,
    min: spec.min,
    max: spec.max,
  });
  input.addEventListener('input', () => {
    const parsed = Number(input.value);
    if (!Number.isFinite(parsed)) return;
    readout.textContent = format(parsed, integer);
    onChange(parsed);
  });

  return el(
    'div',
    { class: 'field' },
    el(
      'label',
      { class: 'field__label', for: id },
      el('span', { text: config.label }),
      bounded ? readout : el('span'),
    ),
    input,
    el('span', { class: 'field__hint', text: config.hint }),
  );
}

function format(value, integer) {
  return integer ? String(Math.round(value)) : String(Number(value.toFixed(4)));
}

/* ------------------------------------------------------------------ solver picker */

let catalogue = { all: [], byMode: {} };

function modeOf(solverName) {
  return Object.values(MODES).find((mode) => solverName.startsWith(mode.prefix));
}

function buildSolverPicker() {
  const options = [];
  for (const mode of Object.values(MODES)) {
    for (const solver of catalogue.byMode[mode.id] ?? []) {
      options.push(new Option(`${mode.label} — ${solver.title}`, solver.name));
    }
  }
  // Anything the server offers that is neither mock nor dolfinx still belongs in the list:
  // a lab-specific adapter added later must show up without this file changing.
  for (const solver of catalogue.all) {
    if (!modeOf(solver.name)) options.push(new Option(solver.title, solver.name));
  }
  dom.solver.replaceChildren(...options);

  // Default to the fast preview: it is the mode you want while shaping the profile, and
  // on a public server it is the one that will not queue behind someone else's mesh.
  const preview = catalogue.byMode[MODES.preview.id]?.[0];
  if (preview) dom.solver.value = preview.name;
  onSolverChange();
}

function selectedSolver() {
  return catalogue.all.find((solver) => solver.name === dom.solver.value) ?? null;
}

function onSolverChange() {
  const solver = selectedSolver();
  if (!solver) return;
  const mode = modeOf(solver.name);
  const missing = Object.values(MODES).filter((m) => !(catalogue.byMode[m.id] ?? []).length);
  dom.solverHint.textContent = [
    mode ? `${mode.summary} ${mode.caveat}` : solver.description,
    missing.length
      ? `Non disponibile su questo server: ${missing.map((m) => m.label).join(', ')}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  buildParamForm(solver);
}

/* --------------------------------------------------------------------- the solve */

let running = false;
let currentJob = null;

function setStatus(text, state = 'idle') {
  dom.status.textContent = text;
  dom.dot.dataset.state = state;
}

async function run() {
  if (running) return;
  const solver = selectedSolver();
  if (!solver) {
    setStatus('Nessun solutore disponibile su questo server.', 'error');
    return;
  }

  running = true;
  dom.run.disabled = true;
  dom.cancel.hidden = false;
  dom.progress.hidden = false;
  dom.progress.value = 0;
  dom.artifacts.replaceChildren();
  setStatus('Invio del calcolo…', 'running');

  try {
    currentJob = await client.submit({
      solver: solver.name,
      // The editor hands over protocol geometry directly — there is no translation layer
      // between the widget and the wire format, by design.
      geometry: dom.editor.value,
      params,
    });

    const result = await currentJob.wait((event) => {
      if (event.type === 'progress') {
        if (event.total) dom.progress.value = event.iteration / event.total;
        const detail = event.message
          ? event.message
          : `iterazione ${event.iteration}${event.total ? ` di ${event.total}` : ''}` +
            (event.residual != null ? ` — residuo ${event.residual.toExponential(2)}` : '');
        setStatus(detail, 'running');
      } else if (event.type === 'status' && event.status === 'running') {
        setStatus('Calcolo in corso…', 'running');
      }
    });

    dom.viewer.result = result;
    syncFieldOptions();
    showStats(result);
    showArtifacts(result.artifacts);
    setStatus('Calcolo completato.', 'done');
  } catch (error) {
    if (error instanceof JobFailedError && error.status === 'cancelled') {
      setStatus('Calcolo annullato.', 'idle');
    } else {
      setStatus(describeError(error), 'error');
    }
  } finally {
    running = false;
    dom.run.disabled = false;
    dom.cancel.hidden = true;
    dom.progress.hidden = true;
    currentJob = null;
  }
}

function showStats(result) {
  const entries = statEntries(result.stats);
  const topology =
    result.kind === 'mesh2d'
      ? { label: 'elementi', value: (result.data.triangles?.length ?? 0).toLocaleString('it-IT') }
      : { label: 'griglia', value: (result.data.shape ?? []).join(' × ') };

  dom.stats.replaceChildren(
    ...[...entries, topology]
      .filter((entry) => entry.value)
      .map((entry) =>
        el('div', {}, el('dt', { text: entry.label }), el('dd', { text: entry.value })),
      ),
  );
}

function showArtifacts(artifacts = []) {
  dom.artifacts.replaceChildren();
  if (!artifacts.length) return;
  dom.artifacts.append('Scarica: ');
  artifacts.forEach((artifact, index) => {
    if (index) dom.artifacts.append(' · ');
    dom.artifacts.append(
      el('a', {
        href: client.artifactUrl(artifact),
        download: artifact.name,
        text: `${artifact.name} (${formatBytes(artifact.size)})`,
      }),
    );
  });
}

const FIELD_HINTS = {
  speed: 'Modulo della velocità. Le zone chiare sono quelle in cui la corrente accelera.',
  psi: 'Funzione di corrente: le linee di livello sono le linee di corrente.',
};

function syncFieldOptions() {
  const names = dom.viewer.fields ?? [];
  const current = [...dom.field.options].map((option) => option.value).join();
  if (names.join() !== current) {
    dom.field.replaceChildren(
      ...names.map((name) => new Option(name, name, false, name === dom.viewer.field)),
    );
  }
  dom.fieldHint.textContent = FIELD_HINTS[dom.viewer.field] ?? '';
}

/* ---------------------------------------------------------------- didactic frame */

/** Renders `**bold**` and nothing else — the content file needs emphasis, not a parser. */
function richText(markdown) {
  const fragment = document.createDocumentFragment();
  for (const [index, chunk] of markdown.split('**').entries()) {
    if (!chunk) continue;
    fragment.append(index % 2 ? el('strong', { text: chunk }) : document.createTextNode(chunk));
  }
  return fragment;
}

function renderLesson(content) {
  dom.intro.textContent = content.intro;
  document.title = `${content.title} — Andolfatto Physics Lab`;

  dom.lesson.replaceChildren(
    ...content.sections.map((section) => {
      const children = [el('h2', { id: section.id, text: section.heading })];
      if (section.lead) children.push(el('p', { class: 'question', text: section.lead }));
      for (const paragraph of section.body ?? []) {
        children.push(el('p', {}, richText(paragraph)));
      }
      if (section.steps) {
        children.push(el('ol', {}, ...section.steps.map((step) => el('li', {}, richText(step)))));
      }
      return el(
        'section',
        { class: section.caution ? 'is-caution' : null, 'aria-labelledby': section.id },
        ...children,
      );
    }),
  );
}

/* ---------------------------------------------------------------------- start-up */

mountChrome('experiments');
buildShapeControls();
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
  buildShapeControls();
  applyShape();
});
dom.solver.addEventListener('change', onSolverChange);
dom.field.addEventListener('change', () => {
  dom.viewer.field = dom.field.value;
  dom.fieldHint.textContent = FIELD_HINTS[dom.field.value] ?? '';
});

try {
  const [content, info, solvers] = await Promise.all([
    fetch('/experiments/airfoil/content.json').then((response) => response.json()),
    health().catch(() => null),
    solversFor(GEOMETRY_TYPE),
  ]);

  renderLesson(content);
  catalogue = solvers;

  if (!catalogue.all.length) {
    setStatus('Questo server non espone solutori compatibili con questa geometria.', 'error');
    dom.run.disabled = true;
  } else {
    buildSolverPicker();
  }

  if (info?.jobs_enabled === false) {
    dom.maintenance.hidden = false;
    dom.maintenance.textContent =
      'Il laboratorio non sta accettando nuove simulazioni in questo momento. Puoi comunque esplorare la pagina e modificare la geometria.';
    dom.run.disabled = true;
  }
} catch (error) {
  setStatus(`Non riesco a contattare il server — ${describeError(error)}`, 'error');
  dom.run.disabled = true;
}
