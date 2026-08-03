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

import { MODES, client, modeOf, paramSpec } from '/shared/api.js';
import { describeError, el, formatBytes, statEntries } from '/shared/components.js';
import { num, t } from '/shared/i18n.js';

/* ------------------------------------------------------------------ solver picker */

/**
 * Fill a `<select>` with the capabilities this page can use, and select a default.
 *
 * The order and the labels come from what each capability *declares* — its `availability`
 * and its own title — rather than from its name, so a solver added upstream tomorrow is
 * grouped correctly without this file changing. The default is the fast preview where there
 * is one: it is the mode you want while you are still changing the geometry, and on a public
 * server it is the one that will not queue behind someone else's mesh.
 *
 * @returns {string} the solver name left selected, or `''` for an empty catalogue
 */
export function fillSolverPicker(select, catalogue) {
  const options = [];
  const placed = new Set();
  for (const mode of Object.values(MODES)) {
    for (const solver of catalogue.byMode[mode.id] ?? []) {
      options.push(new Option(`${mode.label} — ${solver.title}`, solver.name));
      placed.add(solver.name);
    }
  }
  // An availability the lab has no wording for still belongs in the list, under the
  // capability's own title. Silence would be the page hiding a solver the server offers.
  for (const solver of catalogue.all) {
    if (!placed.has(solver.name)) options.push(new Option(solver.title, solver.name));
  }
  select.replaceChildren(...options);

  const preview = catalogue.byMode[MODES.mock.id]?.[0];
  if (preview) select.value = preview.name;
  return select.value;
}

/** One sentence about the selected solver, plus which modes this deployment lacks. */
export function describeSolver(solver, catalogue) {
  const mode = modeOf(solver);
  const missing = Object.values(MODES).filter(
    (m) => m.id !== 'panel-method' && !(catalogue.byMode[m.id] ?? []).length,
  );
  return [
    mode ? `${mode.summary} ${mode.caveat}` : solver.description,
    missing.length ? t('solver.missing', { modes: missing.map((m) => m.label).join(', ') }) : '',
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

/** The visible hint, or nothing at all — an empty `<span>` still costs a line of layout. */
function hintOf(config) {
  return config.hint ? el('span', { class: 'field__hint', text: config.hint }) : null;
}

function renderParam(config, spec, value, onChange) {
  const id = `param-${config.name}`;
  // Where the exercise supplies its own `title` it wins, because it is written for a visitor;
  // otherwise the solver's `description` is used, which is upstream's wording. Either way it
  // is a tooltip rather than a paragraph under the control: a sentence beneath every slider
  // turns a control panel into an essay and pushes the Run button off the screen. The full
  // reasoning is not deleted — it lives in *Understand the model*.
  const title = config.title ?? spec.description ?? null;

  if (typeof spec.default === 'boolean') {
    const input = el('input', { type: 'checkbox', id, checked: value === true, title });
    input.addEventListener('change', () => onChange(input.checked));
    return el(
      'div',
      { class: 'field' },
      el('label', { class: 'check', for: id, title }, input, el('span', { text: config.label })),
      hintOf(config),
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
      el('label', { class: 'field__label', for: id, title }, el('span', { text: config.label })),
      select,
      hintOf(config),
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
      { class: 'field__label', for: id, title },
      el('span', { text: config.label }),
      bounded ? readout : el('span'),
    ),
    input,
    hintOf(config),
  );
}

function formatNumber(value, integer) {
  if (value === null || value === undefined) return t('experiment.notSet');
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
          { class: 'field__label', for: `shape-${control.key}`, title: control.title ?? null },
          el('span', { text: control.label }),
          readout,
        ),
        input,
        control.hint ? el('span', { class: 'field__hint', text: control.hint }) : null,
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
 * `conditions` is an inline load case (protocol 1.9): boundary name to the scalars in force
 * there. Passed straight through and **omitted when empty**, which is not tidiness — a
 * capability that declares no condition keys refuses a load case rather than ignoring one, so
 * sending `{}` from a page that has none would turn every solve into a 422.
 *
 * @param {{dom: object, solver: string, geometry: object, params: object,
 *   conditions?: object, onJob?: (job: object) => void}} request
 */
export async function runSolve({ dom, solver, geometry, params, conditions, onJob }) {
  const setStatus = (text, state) => setStatusOn(dom, text, state);

  dom.run.disabled = true;
  dom.cancel.hidden = false;
  dom.progress.hidden = false;
  dom.progress.value = 0;
  setStatus(t('experiment.submitting'), 'running');

  try {
    const job = await client.submit({
      solver,
      geometry,
      params,
      ...(conditions && Object.keys(conditions).length ? { conditions } : {}),
    });
    onJob?.(job);

    const result = await job.wait((event) => {
      if (event.type === 'progress') {
        if (event.total) dom.progress.value = event.iteration / event.total;
        // The server's own `message` wins where it sends one — it is the solver talking about
        // its own progress, and this page has no vocabulary for it in any language.
        const counted = event.total
          ? t('experiment.iterationOf', { index: event.iteration, total: event.total })
          : t('experiment.iteration', { index: event.iteration });
        const detail = event.message
          ? event.message
          : counted +
            (event.residual != null
              ? t('experiment.residual', { value: event.residual.toExponential(2) })
              : '');
        setStatus(detail, 'running');
      } else if (event.type === 'status' && event.status === 'running') {
        setStatus(t('experiment.solving'), 'running');
      }
    });

    return result;
  } catch (error) {
    if (error instanceof JobFailedError && error.status === 'cancelled') {
      setStatus(t('experiment.cancelled'), 'idle');
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
      ? { label: t('stats.elements'), value: num(result.data.triangles?.length ?? 0) }
      : { label: t('stats.grid'), value: (result.data.shape ?? []).join(' × ') };

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
  container.append(t('experiment.download'));
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
 *
 * **Collapsed by default, and not shortened.** The prose is the rigorous half of the lab and
 * none of it is dropped — but a wall of it between a visitor and the experiment is read by
 * nobody, so each section becomes a `<details>` under *Understand the model*. `open` names the
 * ones that start expanded; everything else is one keystroke away. This is a change of
 * arrangement, not of content: `renderLesson` reads the same shape it always did.
 *
 * @param {{content: object, intro: HTMLElement, lesson: HTMLElement, open?: string[]}} spec
 */
export function renderLesson({ content, intro, lesson, open = [] }) {
  if (intro) intro.textContent = content.intro;
  document.title = t('experiment.pageTitle', { title: content.title });

  lesson.replaceChildren(
    ...content.sections.map((section) => {
      // Namespaced, because a section id and an element id live in the same document: an
      // exercise with a `metrics` section and a `#metrics` panel would otherwise put the same
      // id on both, and every `getElementById` for it becomes a coin toss.
      const heading = `lesson-${section.id}`;
      const children = [];
      if (section.lead) children.push(el('p', { class: 'question', text: section.lead }));
      for (const paragraph of section.body ?? []) {
        children.push(el('p', {}, richText(paragraph)));
      }
      if (section.steps) {
        children.push(el('ol', {}, ...section.steps.map((step) => el('li', {}, richText(step)))));
      }

      const block = el(
        'details',
        {
          class: `lesson__block${section.caution ? ' is-caution' : ''}`,
          'data-section': section.id,
          open: open.includes(section.id) ? true : null,
        },
        el('summary', { id: heading }, el('span', { text: section.heading })),
        el('div', { class: 'lesson__body' }, ...children),
      );
      return block;
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
