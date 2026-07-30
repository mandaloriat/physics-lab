/**
 * The parts of an experiment page that are not about physics.
 *
 * Two experiments now share one page shape: a stage with a field viewer, a solver picker, a
 * parameter form, a status line, a result panel and a lesson underneath. None of that is
 * specific to airfoils or solenoids — what *is* specific is the geometry, the fields worth
 * looking at, and the text. So the shape lives here and each experiment supplies the physics.
 *
 * This is not a framework and does not walk back
 * [ADR-009](../../docs/architecture-decisions.md#adr-009--no-front-end-framework-and-no-bundler):
 * there is no component model, no reactive state and no build step. These are functions that
 * take DOM nodes and return or fill them, in the same spirit as `components.js`. See ADR-012.
 *
 * Every function here treats the solver catalogue as the source of truth. Nothing invents a
 * parameter, a bound or a default the server did not publish.
 */

import { JobFailedError } from '@fenix-spoon/client';

import { MODES, client, paramSpec } from '/shared/api.js';
import { describeError, el, formatBytes, statEntries } from '/shared/components.js';

/* ------------------------------------------------------------------ solver picker */

/** Which conceptual mode a solver name belongs to, or `undefined` for a lab adapter. */
export function modeOf(solverName) {
  return Object.values(MODES).find((mode) => solverName.startsWith(mode.prefix));
}

/**
 * Fill a `<select>` with the server's solvers, preview modes first, and select a default.
 *
 * The default is the fast preview where there is one: it is the mode you want while you are
 * still changing the geometry, and on a public server it is the one that will not queue
 * behind someone else's mesh.
 *
 * @returns {string} the solver name left selected, or `''` for an empty catalogue
 */
export function fillSolverPicker(select, catalogue) {
  const options = [];
  for (const mode of Object.values(MODES)) {
    for (const solver of catalogue.byMode[mode.id] ?? []) {
      options.push(new Option(`${mode.label} — ${solver.title}`, solver.name));
    }
  }
  // Anything the server offers that is neither mock nor dolfinx still belongs in the list: a
  // lab-specific adapter added later must show up without this file changing.
  for (const solver of catalogue.all) {
    if (!modeOf(solver.name)) options.push(new Option(solver.title, solver.name));
  }
  select.replaceChildren(...options);

  const preview = catalogue.byMode[MODES.preview.id]?.[0];
  if (preview) select.value = preview.name;
  return select.value;
}

/** One sentence about the selected solver, plus which modes this deployment lacks. */
export function describeSolver(solver, catalogue) {
  const mode = modeOf(solver.name);
  const missing = Object.values(MODES).filter((m) => !(catalogue.byMode[m.id] ?? []).length);
  return [
    mode ? `${mode.summary} ${mode.caveat}` : solver.description,
    missing.length
      ? `Not available on this server: ${missing.map((m) => m.label).join(', ')}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/* ---------------------------------------------------------- solver parameter form */

/**
 * Render the parameters a solver publishes, in the order the experiment asks for them.
 *
 * `ui` names parameters and explains them to a visitor; it does not describe them. Type,
 * bounds, allowed values and default all come from the solver's own `params_schema`, because
 * solvers behind one page do not agree on their inputs — `mock.magnetostatics2d` takes
 * `resolution` and `iterations`, `dolfinx.magnetostatics2d` takes `mesh_size`. A parameter the
 * selected solver does not publish is simply not rendered, and no value is ever invented.
 *
 * @param {HTMLElement} container where the controls go
 * @param {object} solver a catalogue entry, with its `params_schema`
 * @param {Array<{name: string, label: string, hint: string, step?: number,
 *   optionLabels?: Record<string, string>}>} ui parameters to offer, in display order
 * @param {object} previous the values in force before this call; a choice still expressible
 *   under the new solver's schema is carried across rather than reset
 * @returns {object} the live values object, mutated in place as the visitor edits
 */
export function buildParamForm(container, solver, ui, previous = {}) {
  const params = {};
  const controls = [];

  for (const config of ui) {
    const spec = paramSpec(solver, config.name);
    // No schema entry, or a schema entry with no default: not offered. Guessing a value the
    // server did not publish is how a form starts sending nonsense.
    if (!spec || spec.default === undefined) continue;

    const carried = previous[config.name];
    const value = isUsable(carried, spec) ? carried : spec.default;
    params[config.name] = value;

    controls.push(
      renderParam(config, spec, value, (updated) => {
        params[config.name] = updated;
      }),
    );
  }

  container.replaceChildren(...controls);
  return params;
}

function isUsable(value, spec) {
  if (value === undefined) return false;
  if (spec.enum) return spec.enum.includes(value);
  if (typeof spec.default === 'boolean') return typeof value === 'boolean';
  // `null` is a value, not a missing one, when the schema says the parameter is optional: it is
  // how a caller says "no incidence sweep" rather than "sweep from zero".
  if (value === null) return spec.nullable === true;
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (spec.min !== undefined && value < spec.min) return false;
  if (spec.max !== undefined && value > spec.max) return false;
  return true;
}

function renderParam(config, spec, value, onChange) {
  const id = `param-${config.name}`;
  // The solver's own `description` is upstream's wording for the parameter; it goes on the
  // control as a tooltip rather than into the visible hint, which is the lab's own explanation
  // aimed at a visitor. Showing both inline prints the same thing twice.
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
  // An optional parameter gets a number input whatever its bounds, because a slider has no way
  // to express "not set" — and "not set" is the whole meaning of a nullable parameter.
  const bounded = spec.min !== undefined && spec.max !== undefined && !spec.nullable;
  const step = config.step ?? (integer ? 1 : 0.1);
  const readout = el('span', { class: 'field__value', text: formatNumber(value, integer) });

  // A slider needs two bounds. `mesh_size` is declared `gt=0` with no maximum, so it gets a
  // number input instead of a fabricated upper limit — and an over-budget value comes back
  // from the server as a clear 422 rather than being silently clamped here.
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
    // An empty optional field means null, and null is what the server is sent. Anything else
    // would turn "leave the sweep off" into "sweep from NaN", which is a 422.
    if (input.value === '' && spec.nullable) {
      readout.textContent = formatNumber(null, integer);
      onChange(null);
      return;
    }
    const parsed = Number(input.value);
    if (!Number.isFinite(parsed)) return;
    readout.textContent = formatNumber(parsed, integer);
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

function formatNumber(value, integer) {
  if (value === null || value === undefined) return 'not set';
  return integer ? String(Math.round(value)) : String(Number(value.toFixed(4)));
}

/* ------------------------------------------------------------- geometry controls */

/**
 * Render the experiment's own geometry sliders — the ones whose meaning is physical rather
 * than numerical, so their bounds are the experiment's to choose and not the server's.
 *
 * @param {HTMLElement} container
 * @param {Array<{key: string, label: string, min: number, max: number, step: number,
 *   unit: string, hint: string, format?: (value: number) => string}>} controls
 * @param {object} state read for initial values and written on every edit
 * @param {() => void} onChange called after each edit, with `state` already updated
 */
export function buildShapeControls(container, controls, state, onChange) {
  container.replaceChildren(
    ...controls.map((control) => {
      const show = (value) => control.format?.(value) ?? `${value}${control.unit}`;
      const readout = el('span', { class: 'field__value', text: show(state[control.key]) });
      const input = el('input', {
        type: 'range',
        min: control.min,
        max: control.max,
        step: control.step,
        value: state[control.key],
        id: `shape-${control.key}`,
      });
      input.addEventListener('input', () => {
        state[control.key] = Number(input.value);
        readout.textContent = show(state[control.key]);
        onChange();
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

/* --------------------------------------------------------------------- the solve */

/**
 * Submit one job, stream its progress onto the page, and hand back the result.
 *
 * The whole lifecycle is the SDK's: this adds the button and status bookkeeping that would
 * otherwise be written twice, and translates a failure into a sentence a visitor can read —
 * including the server's own `detail`, which is how someone learns their mesh overran the
 * cell budget.
 *
 * Returns `null` when the solve failed or was cancelled; the status line already says which.
 *
 * @param {{dom: object, solver: string, geometry: object, params: object,
 *   onJob?: (job: object) => void}} request
 */
export async function runSolve({ dom, solver, geometry, params, onJob }) {
  const setStatus = (text, state) => setStatusOn(dom, text, state);

  dom.run.disabled = true;
  dom.cancel.hidden = false;
  dom.progress.hidden = false;
  dom.progress.value = 0;
  setStatus('Submitting…', 'running');

  try {
    const job = await client.submit({ solver, geometry, params });
    onJob?.(job);

    const result = await job.wait((event) => {
      if (event.type === 'progress') {
        if (event.total) dom.progress.value = event.iteration / event.total;
        const detail = event.message
          ? event.message
          : `iteration ${event.iteration}${event.total ? ` of ${event.total}` : ''}` +
            (event.residual != null ? ` — residual ${event.residual.toExponential(2)}` : '');
        setStatus(detail, 'running');
      } else if (event.type === 'status' && event.status === 'running') {
        setStatus('Solving…', 'running');
      }
    });

    return result;
  } catch (error) {
    if (error instanceof JobFailedError && error.status === 'cancelled') {
      setStatus('Cancelled.', 'idle');
    } else {
      setStatus(describeError(error), 'error');
    }
    return null;
  } finally {
    dom.run.disabled = false;
    dom.cancel.hidden = true;
    dom.progress.hidden = true;
  }
}

/** The status line and its dot. `state` is one of idle, running, done, error. */
export function setStatusOn(dom, text, state = 'idle') {
  dom.status.textContent = text;
  dom.dot.dataset.state = state;
}

/* ------------------------------------------------------------------ result panel */

/**
 * The recognised `stats` keys, plus what the result's topology was.
 *
 * Every stats key is optional and server-defined, so `statEntries` reports what it knows and
 * stays quiet about the rest. The topology is read off the result kind, because "8,192 grid
 * points" and "15,043 elements" are different claims and a page that printed one for the
 * other would be lying about which discretisation produced the picture.
 */
export function showStats(container, result) {
  const topology =
    result.kind === 'mesh2d'
      ? { label: 'elements', value: (result.data.triangles?.length ?? 0).toLocaleString('en-US') }
      : { label: 'grid', value: (result.data.shape ?? []).join(' × ') };

  container.replaceChildren(
    ...[...statEntries(result.stats), topology]
      .filter((entry) => entry.value)
      .map((entry) =>
        el('div', {}, el('dt', { text: entry.label }), el('dd', { text: entry.value })),
      ),
  );
}

export function showArtifacts(container, artifacts = []) {
  container.replaceChildren();
  if (!artifacts.length) return;
  container.append('Download: ');
  artifacts.forEach((artifact, index) => {
    if (index) container.append(' · ');
    container.append(
      el('a', {
        href: client.artifactUrl(artifact),
        download: artifact.name,
        text: `${artifact.name} (${formatBytes(artifact.size)})`,
      }),
    );
  });
}

/* --------------------------------------------------------------------- the field */

/**
 * Where a result keeps its scalars, which is not the same place for both kinds.
 *
 * `grid2d` uses `data.fields`, `mesh2d` uses `data.point_fields` and has no `fields` key at
 * all. That asymmetry is the protocol's; the viewer's own accessor branches on it the same
 * way. Anything deriving a field in the browser has to branch too, so it is done once here.
 *
 * @returns {Record<string, number[]>|undefined}
 */
export function scalarsOf(result) {
  return result.kind === 'grid2d' ? result.data.fields : result.data.point_fields;
}

/**
 * Point the viewer at a field, with the caption, colormap and contours that field needs.
 *
 * The caption matters more than it looks. The viewer labels its colorbar from the `units`
 * attribute and nothing else, so an unlabelled bar is just a number range — which is how a
 * streamfunction running from −1 to 1 gets mistaken for a pressure. Naming the field on the
 * bar is the fix.
 *
 * Captions stay to a word. The widget right-aligns them to the colorbar's right edge, on the
 * same line as the topmost tick label, which is sized for strings like "m/s" — anything longer
 * crowds that tick. The full name lives on the `<select>` option and in the hint, where there
 * is room for it.
 *
 * @param {object} views the experiment's field table, keyed by field name
 */
export function applyFieldView(viewer, views, name, hintElement) {
  const view = views[name] ?? {};
  // `units`, `symmetric` and `contours` have no property setters on the element — attributes
  // are the documented way in. `colormap` does, and its setter writes the attribute anyway.
  viewer.setAttribute('units', view.caption ?? name ?? '');
  viewer.colormap = view.colormap ?? 'viridis';
  viewer.setAttribute('contours', String(view.contours ?? 0));
  if (view.symmetric) viewer.setAttribute('symmetric', '');
  else viewer.removeAttribute('symmetric');
  if (hintElement) hintElement.textContent = view.hint ?? '';
}

/** Keep the field `<select>` in step with what the current result actually carries. */
export function syncFieldOptions(viewer, select, views, hintElement) {
  const names = viewer.fields ?? [];
  const current = [...select.options].map((option) => option.value).join();
  if (names.join() !== current) {
    select.replaceChildren(
      ...names.map(
        (name) => new Option(views[name]?.option ?? name, name, false, name === viewer.field),
      ),
    );
  }
  applyFieldView(viewer, views, viewer.field, hintElement);
}

/* ---------------------------------------------------------------- didactic frame */

/** Renders `**bold**` and nothing else — the content files need emphasis, not a parser. */
export function richText(markdown) {
  const fragment = document.createDocumentFragment();
  for (const [index, chunk] of markdown.split('**').entries()) {
    if (!chunk) continue;
    fragment.append(index % 2 ? el('strong', { text: chunk }) : document.createTextNode(chunk));
  }
  return fragment;
}

/**
 * Render an experiment's `content.json` into the page: the intro, the title, and the lesson.
 *
 * The text lives in a data file rather than in the markup so that the physics prose can be
 * reviewed, translated or corrected without touching a line of JavaScript.
 */
export function renderLesson({ content, intro, lesson }) {
  intro.textContent = content.intro;
  document.title = `${content.title} — Spoon Physics`;

  lesson.replaceChildren(
    ...content.sections.map((section) => {
      // Namespaced, because a section id and an element id live in the same document: an
      // exercise with a `metrics` section and a `#metrics` panel would otherwise put the same
      // id on both, and every `getElementById` for it becomes a coin toss.
      const heading = `lesson-${section.id}`;
      const children = [el('h2', { id: heading, text: section.heading })];
      if (section.lead) children.push(el('p', { class: 'question', text: section.lead }));
      for (const paragraph of section.body ?? []) {
        children.push(el('p', {}, richText(paragraph)));
      }
      if (section.steps) {
        children.push(el('ol', {}, ...section.steps.map((step) => el('li', {}, richText(step)))));
      }
      return el(
        'section',
        { class: section.caution ? 'is-caution' : null, 'aria-labelledby': heading },
        ...children,
      );
    }),
  );
}

/**
 * The maintenance banner, driven by `/health`.
 *
 * The page must never offer a Run button that is going to 503. Reading the switch and saying
 * so is the difference between "the lab is busy" and "this site is broken".
 *
 * Both experiment pages ship `#run` **disabled** and enable it only after this has been
 * called, which is worth explaining because the alternative looks equally safe and is not.
 * Leaving the button enabled from the start cannot cause a stray submission — `run()` reads
 * the solver catalogue, which is empty until the same synchronous block that calls this
 * function, so an early click is turned away without a request. What it does do is turn it
 * away by announcing "no solver is available on this server", which is false about a server
 * that has merely not replied yet. Starting disabled means the page never makes a claim about
 * a deployment it has not heard from, and removes the need to reason about the event loop to
 * see that it is correct.
 *
 * @returns {boolean} whether solving is available
 */
export function applyMaintenance(dom, info, explanation) {
  if (info?.jobs_enabled !== false) return true;
  dom.maintenance.hidden = false;
  dom.maintenance.textContent = explanation;
  dom.run.disabled = true;
  return false;
}
