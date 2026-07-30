/**
 * The run table: keep a result, compare it with another, export the lot.
 *
 * A saved run is not a screenshot of the numbers. It is a row from which the run can be
 * **recomputed** and against which another row can be **compared**, so it carries every input
 * including the ones left at their defaults, the dimensionless groups, the verification
 * residuals, the validity warnings and the provenance. See `docs/exercise-contract.md` §5.
 *
 * It lives in `localStorage`, deliberately. Everything a durable store needs is being built one
 * repository away — typed metrics (fenix-spoon#43, #46), provenance and a content-addressed
 * cache (#47), a study object (#48) — and a second implementation here would be the wrong half
 * of it. So the schema is shaped like where upstream is going, and this module stays a cache in
 * front of it. ADR-015.
 */

import { el } from '/shared/components.js';

/** Bump when a stored row's shape changes in a way that would misread an older one. */
export const SCHEMA = 1;

/** Rows kept per exercise. Oldest evicted, and the page says so rather than losing them quietly. */
export const CAPACITY = 40;

const KEY = (exercise) => `spoon-physics:runs:${exercise}`;

/** Read the stored rows, newest first. Never throws: a corrupt store is an empty one. */
export function load(exercise) {
  try {
    const raw = window.localStorage.getItem(KEY(exercise));
    const rows = raw ? JSON.parse(raw) : [];
    return Array.isArray(rows) ? rows.filter((row) => row?.schema === SCHEMA) : [];
  } catch {
    return [];
  }
}

/**
 * Save one row. Returns the stored rows, and whether anything had to be evicted.
 *
 * @returns {{rows: object[], evicted: number}}
 */
export function save(exercise, row) {
  const rows = [{ ...row, schema: SCHEMA, saved_at: new Date().toISOString() }, ...load(exercise)];
  const kept = rows.slice(0, CAPACITY);
  try {
    window.localStorage.setItem(KEY(exercise), JSON.stringify(kept));
  } catch {
    // A full or disabled store must not take the page down with it. The run is lost, the
    // caller is told by the count not changing, and the export button is the way out.
    return { rows: load(exercise), evicted: 0 };
  }
  return { rows: kept, evicted: rows.length - kept.length };
}

/**
 * Delete one row. Returns the rows that remain.
 *
 * Guarded like {@link save}, and for the same reason: a store that is disabled or full throws on
 * a write, and in a private window that would mean pressing Delete takes the page down. Where a
 * failed save loses a run, a failed delete keeps one — so the rows are re-read rather than
 * assumed, and what the table shows is what the store really holds.
 */
export function remove(exercise, savedAt) {
  const rows = load(exercise).filter((row) => row.saved_at !== savedAt);
  try {
    window.localStorage.setItem(KEY(exercise), JSON.stringify(rows));
  } catch {
    return load(exercise);
  }
  return rows;
}

export function clear(exercise) {
  try {
    window.localStorage.removeItem(KEY(exercise));
  } catch {
    // Nothing to report: the caller re-renders from `load`, which returns [] for a store it
    // cannot read either way.
  }
}

/* --------------------------------------------------------------------------- flattening */

/**
 * Flatten a row to `dotted.path -> value`, which is what both the comparison and the CSV need.
 *
 * Arrays are summarised by length rather than expanded: a run row records that the surface
 * curve had 240 points, not the points. The curve belongs to the result, and a comparison table
 * with 240 columns is not a comparison.
 */
export function flatten(row, prefix = '') {
  const out = {};
  for (const [key, value] of Object.entries(row ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) {
      if (value.every((entry) => typeof entry === 'string')) out[path] = value.join(' | ');
      else out[path] = `${value.length} values`;
    } else if (value && typeof value === 'object') {
      Object.assign(out, flatten(value, path));
    } else {
      out[path] = value;
    }
  }
  return out;
}

function show(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value !== 'number') return String(value);
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude < 1e-3 || magnitude >= 1e6) return value.toExponential(2);
  return String(Number(value.toPrecision(magnitude < 1 ? 3 : 5)));
}

/* ------------------------------------------------------------------------------ rendering */

/**
 * Render the table. `columns` is what a visitor sees at a glance; everything else is still in
 * the row and comes out in Compare and in the export.
 *
 * @param {HTMLElement} container
 * @param {object[]} rows
 * @param {{columns: Array<{path: string, label: string}>, selected: Set<string>,
 *   onSelect: (savedAt: string, on: boolean) => void, onLoad: (row: object) => void,
 *   onDelete: (savedAt: string) => void}} handlers
 */
export function renderTable(container, rows, handlers) {
  const { columns, selected, onSelect, onLoad, onDelete } = handlers;
  container.replaceChildren();

  if (!rows.length) {
    container.append(
      el('p', {
        class: 'field__hint',
        text: 'No runs kept yet. Solve something and press Keep run — a kept run records every input, so it can be recomputed and compared.',
      }),
    );
    return;
  }

  const head = el(
    'tr',
    {},
    el('th', { scope: 'col', text: '' }),
    ...columns.map((column) => el('th', { scope: 'col', text: column.label })),
    el('th', { scope: 'col', text: '' }),
  );

  const body = rows.map((row) => {
    const flat = flatten(row);
    const box = el('input', {
      type: 'checkbox',
      checked: selected.has(row.saved_at),
      'aria-label': 'Select this run for comparison',
    });
    box.addEventListener('change', () => onSelect(row.saved_at, box.checked));

    const warned = (row.validity?.warnings ?? []).length > 0;
    const loadButton = el('button', { type: 'button', class: 'link', text: 'Load' });
    loadButton.addEventListener('click', () => onLoad(row));
    const deleteButton = el('button', { type: 'button', class: 'link', text: 'Delete' });
    deleteButton.addEventListener('click', () => onDelete(row.saved_at));

    return el(
      'tr',
      { class: warned ? 'is-warned' : null },
      el('td', {}, box),
      ...columns.map((column) => el('td', { class: 'num', text: show(flat[column.path]) })),
      el('td', {}, loadButton, document.createTextNode(' '), deleteButton),
    );
  });

  container.append(el('table', { class: 'runs' }, el('thead', {}, head), el('tbody', {}, ...body)));
}

/**
 * Render a comparison of two or more rows: one line per field, differences marked.
 *
 * Fields that are identical across every selected row are hidden behind a count, because the
 * point of a comparison is what changed.
 */
export function renderComparison(container, rows) {
  container.replaceChildren();
  if (rows.length < 2) {
    container.append(
      el('p', { class: 'field__hint', text: 'Select two or more runs to compare them.' }),
    );
    return;
  }

  const flats = rows.map((row) => flatten(row));
  const paths = [...new Set(flats.flatMap((flat) => Object.keys(flat)))].filter(
    (path) => path !== 'saved_at' && path !== 'schema',
  );
  const differing = paths.filter((path) => new Set(flats.map((flat) => show(flat[path]))).size > 1);

  container.append(
    el(
      'table',
      { class: 'runs runs--compare' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { scope: 'col', text: 'Field' }),
          ...rows.map((row, index) =>
            el('th', { scope: 'col', text: row.geometry?.label ?? `Run ${index + 1}` }),
          ),
        ),
      ),
      el(
        'tbody',
        {},
        ...differing.map((path) =>
          el(
            'tr',
            {},
            el('th', { scope: 'row', text: path }),
            ...flats.map((flat) => el('td', { class: 'num', text: show(flat[path]) })),
          ),
        ),
      ),
    ),
    el('p', {
      class: 'field__hint',
      text: `${differing.length} field${differing.length === 1 ? '' : 's'} differ; ${
        paths.length - differing.length
      } are identical and hidden.`,
    }),
  );
}

/* -------------------------------------------------------------------------------- export */

export function toJson(rows) {
  return JSON.stringify({ schema: SCHEMA, exported_at: new Date().toISOString(), rows }, null, 1);
}

/**
 * CSV of every field any row carries, union of columns, RFC-4180 quoting.
 *
 * The union rather than the intersection: a sweep run has fields a single run does not, and
 * dropping them would make the export lossy in exactly the case someone exports for.
 */
export function toCsv(rows) {
  const flats = rows.map((row) => flatten(row));
  const columns = [...new Set(flats.flatMap((flat) => Object.keys(flat)))].sort();
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [
    columns.join(','),
    ...flats.map((flat) => columns.map((column) => escape(flat[column])).join(',')),
  ].join('\n');
}

/** Hand a string to the browser as a download. No server round trip, no library. */
export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = el('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next task rather than immediately: Safari has been known to cancel a
  // download whose blob URL was revoked in the same tick as the click.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
