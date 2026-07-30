/**
 * The lab's thin layer over the Fenix Spoon SDK.
 *
 * Two things live here and nothing else: a client bound to this origin, and the
 * translation from "what capabilities does this server have" to "what can this page
 * offer". Job submission, progress streaming, reconnection and result fetching are the
 * SDK's job and are not re-implemented.
 */

import { FenixSpoonClient } from '@fenix-spoon/client';

/**
 * Same-origin, always. The empty base URL makes every request relative, which is what
 * keeps the deployment free of CORS: Caddy serves the site and proxies `/api/v1` under
 * one hostname, so the browser never sees a cross-origin request. It also means no
 * build-time environment substitution and no hardcoded host to get wrong — this file is
 * identical on localhost and on the deployed hostname.
 */
export const client = new FenixSpoonClient('');

/**
 * The three ways a page can be told a solve was produced, keyed by the **declared**
 * `availability` of the capability rather than by its name.
 *
 * This used to match on the `mock.` and `dolfinx.` name prefixes, which was the only thing
 * `GET /api/v1/solvers` published. It has two failure modes that both actually bit:
 * `lab.airfoil_panel2d` is neither, so it fell through to a nameless "other" bucket — and
 * calling a panel method a "preview" would have been worse, because it is the most accurate
 * surface solution in the lab. Protocol 1.2 publishes `availability` through
 * `GET /api/v1/capabilities`, so the page reads what the adapter says about itself. This is
 * the change `docs/exercises/airfoil.md` §14.4 left open.
 *
 * An availability the lab has no entry for is not an error and not hidden: it gets the
 * capability's own title and description, which is how a solver added upstream tomorrow
 * shows up correctly without this file changing.
 */
export const MODES = {
  mock: {
    id: 'mock',
    label: 'Fast preview',
    summary:
      'A Cartesian grid solved in NumPy. Answers in an instant — ideal while you reshape the geometry.',
    caveat: 'It is an approximation: a regular grid, with no mesh fitted to the body.',
  },
  fenicsx: {
    id: 'fenicsx',
    label: 'FEniCSx computation',
    summary:
      'An unstructured Gmsh mesh solved with finite elements. Slower, and more faithful near the boundary.',
    caveat: 'Requires a worker with dolfinx installed.',
  },
  'panel-method': {
    id: 'panel-method',
    label: 'Panel method',
    summary:
      'Source and vortex sheets on the body itself, closed by the Kutta condition. The boundary is exact rather than meshed, and the far field is satisfied analytically.',
    caveat: 'Milliseconds of arithmetic — not a preview of something better.',
  },
};

/**
 * Every installed capability, with what it declares about itself.
 *
 * Two endpoints, because neither alone is enough. `GET /api/v1/solvers` carries the
 * `params_schema` the parameter form is generated from; `GET /api/v1/capabilities` carries
 * `physics` and `availability`, which is what lets a page choose by *what a solver solves*
 * instead of by what it is called. The second is protocol 1.2 and a server that predates it
 * simply answers 404 — in which case the declarations are absent, every page keeps working,
 * and `physics` filtering degrades to "accept anything", which is exactly the behaviour the
 * lab had before.
 *
 * @returns {Promise<object[]>} solver entries, each possibly carrying `physics` and
 *   `availability`
 */
async function catalogue() {
  const [solvers, declared] = await Promise.all([
    client.listSolvers(),
    fetch('/api/v1/capabilities', { headers: { Accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : []))
      .catch(() => []),
  ]);

  const byName = new Map((declared ?? []).map((entry) => [entry.name, entry]));
  return solvers.map((solver) => {
    const capability = byName.get(solver.name);
    return capability
      ? { ...solver, physics: capability.physics, availability: capability.availability }
      : solver;
  });
}

/**
 * The capabilities a page can actually use, grouped by mode.
 *
 * **`physics` is why this takes two filters and not one.** Geometry kind is a statement about
 * the payload, not about the problem: `mock.magnetostatics2d` and `mock.heat2d` both accept
 * `regions2d`, so a magnetics page filtering on geometry alone offered a heat-sink solver in
 * its own solver menu — and would have submitted a solenoid to it. Filtering on the physics
 * the capability declares is the fix, and it is the *server's* declaration rather than a list
 * of names kept here, which would go stale the first time a solver is renamed or added.
 *
 * A server too old to declare `physics` publishes none, and then the physics filter is
 * skipped rather than emptying the menu: a page that offers too much is recoverable, a page
 * that offers nothing is not.
 *
 * @param {string} geometryType protocol geometry kind the page produces, e.g. `domain2d`
 * @param {{physics?: string}} [want] the physics this page is about
 * @returns {Promise<{all: object[], byMode: Record<string, object[]>, declares: boolean}>}
 */
export async function solversFor(geometryType, want = {}) {
  const installed = await catalogue();
  const declares = installed.some((solver) => typeof solver.physics === 'string');

  const all = installed.filter((solver) => {
    if (!solver.geometry_types.includes(geometryType)) return false;
    if (!want.physics || !declares) return true;
    return solver.physics === want.physics;
  });

  const byMode = {};
  for (const mode of Object.values(MODES)) {
    byMode[mode.id] = all.filter((solver) => modeIdOf(solver) === mode.id);
  }
  return { all, byMode, declares };
}

/** The mode id a solver belongs to: its declared availability, or its name prefix. */
export function modeIdOf(solver) {
  if (solver?.availability && solver.availability !== 'unspecified') return solver.availability;
  // Pre-1.2 fallback only. Kept so the lab still groups a server that publishes no
  // declaration at all, and deliberately not consulted when one is published.
  if (solver?.name?.startsWith('mock.')) return 'mock';
  if (solver?.name?.startsWith('dolfinx.')) return 'fenicsx';
  return null;
}

/** The mode entry a solver belongs to, or `undefined` for one the lab has no wording for. */
export function modeOf(solver) {
  const id = modeIdOf(solver);
  return id ? MODES[id] : undefined;
}

/**
 * Read a parameter's constraints out of the solver's published JSON Schema.
 *
 * Solvers do not agree on parameter names — `mock.magnetostatics2d` takes `resolution` and
 * `iterations`, `dolfinx.magnetostatics2d` takes `mesh_size` — so a form that hardcodes
 * either is wrong for the other. Every bound and every default therefore comes from
 * `params_schema`, and a parameter the schema does not describe is simply not offered.
 * Nothing here invents a value the server did not publish.
 *
 * @returns {null|{name: string, type: string, default: unknown, min?: number, max?: number,
 *   description?: string}}
 */
export function paramSpec(solver, name) {
  const declared = solver?.params_schema?.properties?.[name];
  if (!declared) return null;

  // An optional parameter is emitted by pydantic as `anyOf: [{...}, {type: 'null'}]`, which
  // hides the type and the bounds one level down. Unwrap it, and remember that null is
  // allowed — a form that lost the bounds of a nullable field would render a number box with
  // no limits and send values the server refuses.
  const branches = Array.isArray(declared.anyOf) ? declared.anyOf : null;
  const nullable = Boolean(branches?.some((branch) => branch.type === 'null'));
  const property = nullable
    ? { ...(branches.find((branch) => branch.type !== 'null') ?? {}), default: declared.default }
    : declared;

  const spec = {
    nullable,
    name,
    type: property.type ?? 'number',
    default: property.default,
    description: property.description,
  };
  // JSON Schema spells inclusive and exclusive bounds differently, and pydantic emits
  // whichever the Field used (`gt=0.0` becomes exclusiveMinimum). Both are read; neither
  // is assumed.
  if (property.minimum !== undefined) spec.min = property.minimum;
  else if (property.exclusiveMinimum !== undefined) spec.min = property.exclusiveMinimum;
  if (property.maximum !== undefined) spec.max = property.maximum;
  else if (property.exclusiveMaximum !== undefined) spec.max = property.exclusiveMaximum;
  if (property.enum) spec.enum = property.enum;
  return spec;
}
