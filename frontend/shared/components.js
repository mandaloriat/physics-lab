/**
 * Small shared pieces of the lab's chrome and formatting.
 *
 * Deliberately not a component framework. Every page here is a static HTML document that
 * loads two custom elements from Fenix Spoon; what it needs from JavaScript is a header,
 * a footer, a number formatter and a couple of DOM helpers. A framework would be more
 * code than the lab itself — see docs/architecture-decisions.md, ADR-009.
 */

export const REPO_URL = 'https://github.com/mandaloriat/andolfatto-physics-lab';
export const FENIX_SPOON_URL = 'https://github.com/mandaloriat/fenix-spoon';

/**
 * `GET /health` — what this deployment is made of, and whether it will accept solves.
 *
 * It lives here rather than beside the protocol client because it is not part of the
 * protocol: it is the lab's own endpoint, it needs no SDK, and the homepage reads it
 * without loading anything else.
 */
export async function health() {
  const response = await fetch('/health', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`/health returned HTTP ${response.status}`);
  return response.json();
}

/** `el('p', {class: 'x'}, 'text', child)` — enough DOM sugar for these pages. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

/** Site header. `current` marks the active nav item for styling and screen readers. */
function siteHeader(current = '') {
  const link = (href, label, id) =>
    el('a', { href, 'aria-current': current === id ? 'page' : null, text: label });
  return el(
    'header',
    { class: 'site-header' },
    el(
      'div',
      { class: 'wrap' },
      el(
        'a',
        { class: 'brand', href: '/' },
        el('span', { class: 'mark', text: '◦∿' }),
        el('span', { text: 'Andolfatto Physics Lab' }),
      ),
      el(
        'nav',
        { class: 'site-nav', 'aria-label': 'Lab sections' },
        link('/', 'Experiments', 'home'),
        link('/#modes', 'How it works', 'modes'),
        link(REPO_URL, 'Code', 'repo'),
      ),
    ),
  );
}

function siteFooter() {
  // Two flex children, each a self-contained sentence: the attribution FEniCSx and Fenix
  // Spoon are owed, and where the source is. Splitting the punctuation across more spans
  // would have the flex gap fall between a word and its full stop.
  const attribution = el('p', {}, document.createTextNode('Built with '));
  attribution.append(
    el('a', { href: FENIX_SPOON_URL, text: 'Fenix Spoon' }),
    ' and ',
    el('a', { href: 'https://fenicsproject.org/', text: 'FEniCSx' }),
    '. Not affiliated with the FEniCS Project.',
  );

  const source = el('p', {});
  source.append(el('a', { href: REPO_URL, text: 'Source on GitHub' }), ' · MIT');

  return el('footer', { class: 'site-footer' }, el('div', { class: 'wrap' }, attribution, source));
}

/**
 * Render the standard chrome into a page that has `<div id="header">` / `<div id="footer">`.
 */
export function mountChrome(current) {
  document.getElementById('header')?.replaceWith(siteHeader(current));
  document.getElementById('footer')?.replaceWith(siteFooter());
}

/**
 * Format the result envelope's `stats` for display.
 *
 * Every key is optional and server-defined: the mock solvers report `iterations`, the
 * FEniCSx adapters report `dofs`, and the job manager always adds `seconds`. So this
 * reports what it recognises and stays quiet about the rest. Presence is tested with
 * `Number.isFinite` rather than truthiness — a solve fast enough to round to 0.00 s
 * still has a duration, and "absent" and "zero" are different things.
 */
const STAT_LABELS = [
  ['seconds', 'duration', (v) => `${v.toFixed(2)} s`],
  ['cells', 'cells', (v) => v.toLocaleString('en-US')],
  ['dofs', 'degrees of freedom', (v) => v.toLocaleString('en-US')],
  ['iterations', 'iterations', (v) => v.toLocaleString('en-US')],
];

export function statEntries(stats = {}) {
  return STAT_LABELS.filter(([key]) => Number.isFinite(stats[key])).map(([key, label, format]) => ({
    key,
    label,
    value: format(stats[key]),
  }));
}

/** `catch` receives anything, not just an Error; a bare `.message` would print "undefined". */
export function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
