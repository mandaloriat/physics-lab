/**
 * The lab's thin layer over the Fenix Spoon SDK.
 *
 * Two things live here and nothing else: a client bound to this origin, and the
 * translation from "what solvers does this server have" to "what modes can this page
 * offer". Job submission, progress streaming, reconnection and result fetching are the
 * SDK's job and are not re-implemented.
 */

import { FenixSpoonClient } from '@fenix-spoon/client';

/**
 * Same-origin, always. The empty base URL makes every request relative, which is what
 * keeps the deployment free of CORS: Caddy serves the site and proxies `/api/v1` under
 * one hostname, so the browser never sees a cross-origin request. It also means no
 * build-time environment substitution and no hardcoded host to get wrong — this file is
 * identical on localhost and on lab.andolfatto.eu.
 */
export const client = new FenixSpoonClient('');

/**
 * The two conceptual modes the lab presents, mapped onto whatever is actually installed.
 *
 * Neither is hardcoded as present. `mock.*` adapters ship with every Fenix Spoon image;
 * `dolfinx.*` ones register only where dolfinx imports, so a slim deployment simply has
 * no accurate mode and the page has to stay fully usable without it. Deriving both from
 * `GET /api/v1/solvers` is the only way that stays true after a deployment change.
 */
export const MODES = {
  preview: {
    id: 'preview',
    label: 'Anteprima rapida',
    prefix: 'mock.',
    summary:
      'Griglia cartesiana risolta in NumPy. Risposta in un istante, ideale mentre modifichi la geometria.',
    caveat: 'È un’approssimazione: griglia regolare, nessuna mesh adattata al profilo.',
  },
  accurate: {
    id: 'accurate',
    label: 'Calcolo FEniCSx',
    prefix: 'dolfinx.',
    summary:
      'Mesh non strutturata generata con Gmsh e risolta agli elementi finiti. Più lento, più fedele vicino al bordo.',
    caveat: 'Richiede un worker con dolfinx installato.',
  },
};

/**
 * Group the server's solver catalogue by mode, keeping only those a page can use.
 *
 * @param {string} geometryType protocol geometry kind the page produces, e.g. `domain2d`
 * @returns {Promise<{all: object[], byMode: Record<string, object[]>}>}
 */
export async function solversFor(geometryType) {
  const all = (await client.listSolvers()).filter((solver) =>
    solver.geometry_types.includes(geometryType),
  );
  const byMode = {};
  for (const mode of Object.values(MODES)) {
    byMode[mode.id] = all.filter((solver) => solver.name.startsWith(mode.prefix));
  }
  return { all, byMode };
}

/**
 * Read a parameter's constraints out of the solver's published JSON Schema.
 *
 * Solvers do not agree on parameter names — `mock.laplace2d` takes `resolution` and
 * `iterations`, `dolfinx.potential_flow2d` takes `mesh_size` — so a form that hardcodes
 * either is wrong for the other. Every bound and every default therefore comes from
 * `params_schema`, and a parameter the schema does not describe is simply not offered.
 * Nothing here invents a value the server did not publish.
 *
 * @returns {null|{name: string, type: string, default: unknown, min?: number, max?: number,
 *   description?: string}}
 */
export function paramSpec(solver, name) {
  const property = solver?.params_schema?.properties?.[name];
  if (!property) return null;
  const spec = {
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
