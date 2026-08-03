/**
 * Small shared pieces of the lab's chrome and formatting.
 *
 * Deliberately not a component framework. Every page here is a static HTML document that
 * loads two custom elements from Fenix Spoon; what it needs from JavaScript is a header,
 * a footer, a number formatter and a couple of DOM helpers. A framework would be more
 * code than the lab itself — see docs/architecture-decisions.md, ADR-009.
 */

import { LANGUAGES, language, num, t, translateDom, urlFor } from '/shared/i18n.js';

export const REPO_URL = 'https://github.com/mandaloriat/physics-lab';
export const FENIX_SPOON_URL = 'https://github.com/mandaloriat/fenix-spoon';

/**
 * What the lab claims to be, in three words each. Shown beside the name on the homepage and
 * nowhere else: on an experiment page the visitor is already inside one of the problems, and
 * a strapline repeated on every page stops being read. See ADR-016.
 *
 * A getter rather than a constant now that there are two languages: the value depends on which
 * one this page load resolved to, and a module-level string would be baked before `t` could
 * answer. ADR-016 fixes the *claim*, not the English wording of it.
 */
export function tagline() {
  return t('brand.tagline');
}

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

/**
 * The language switch, at the top of every page.
 *
 * Links rather than buttons, and that is the whole design. A link to `?lang=it` is shareable,
 * the back button undoes it, and following it reloads the page — which is exactly what the
 * switch needs to happen, because the experiment pages build their controls from tables read
 * once at import time (see `shared/i18n.js` and ADR-020). A listener that swapped the strings in
 * place would have to re-derive every one of those, which is the component model ADR-009
 * declined to grow.
 *
 * The active language is still a link and still focusable: removing it from the tab order would
 * hide from a keyboard which of the two is in force.
 */
function languageSwitch() {
  return el(
    'div',
    { class: 'lang-switch', role: 'group', 'aria-label': t('lang.label') },
    ...Object.entries(LANGUAGES).map(([code, entry]) =>
      el('a', {
        class: `lang-switch__option${code === language ? ' is-active' : ''}`,
        href: urlFor(code),
        hreflang: code,
        lang: code,
        // The full name is what a screen reader should say; `EN` and `IT` are for the eye.
        'aria-label': entry.label,
        'aria-current': code === language ? 'true' : null,
        text: entry.short,
      }),
    ),
  );
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
        el('span', { text: t('brand.name') }),
        current === 'home' ? el('span', { class: 'sub', text: tagline() }) : null,
      ),
      el(
        'nav',
        { class: 'site-nav', 'aria-label': t('nav.label') },
        link('/', t('nav.experiments'), 'home'),
        link('/#modes', t('nav.how'), 'modes'),
        link(REPO_URL, t('nav.code'), 'repo'),
      ),
      languageSwitch(),
    ),
  );
}

function siteFooter() {
  // Two flex children, each a self-contained sentence: the attribution FEniCSx and Fenix
  // Spoon are owed, and where the source is. Splitting the punctuation across more spans
  // would have the flex gap fall between a word and its full stop.
  const attribution = el('p', {}, document.createTextNode(t('footer.builtWith')));
  attribution.append(
    el('a', { href: FENIX_SPOON_URL, text: 'Fenix Spoon' }),
    t('footer.and'),
    el('a', { href: 'https://fenicsproject.org/', text: 'FEniCSx' }),
    t('footer.notAffiliated'),
  );

  const source = el('p', {});
  source.append(el('a', { href: REPO_URL, text: t('footer.source') }), t('footer.licence'));

  return el('footer', { class: 'site-footer' }, el('div', { class: 'wrap' }, attribution, source));
}

/**
 * Render the standard chrome into a page that has `<div id="header">` / `<div id="footer">`,
 * and put the page's own markup into the language this load resolved to.
 *
 * Both at once, because they are one event as far as a reader is concerned: the header is what
 * carries the switch, and a header in Italian above an untranslated page would be worse than
 * either alone. `translateDom` also clears the attribute the `<head>` snippet used to hold the
 * first paint back, so this call is what makes the page visible on an Italian load.
 */
export function mountChrome(current) {
  document.getElementById('header')?.replaceWith(siteHeader(current));
  document.getElementById('footer')?.replaceWith(siteFooter());
  translateDom();
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
  ['seconds', (v) => `${v.toFixed(2)} s`],
  ['cells', (v) => num(v)],
  ['dofs', (v) => num(v)],
  ['iterations', (v) => num(v)],
];

export function statEntries(stats = {}) {
  return STAT_LABELS.filter(([key]) => Number.isFinite(stats[key])).map(([key, format]) => ({
    key,
    label: t(`stats.${key}`),
    value: format(stats[key]),
  }));
}

/**
 * Bring a panel into view, respecting `prefers-reduced-motion`.
 *
 * The CSS media query cannot help here: an explicit `behavior: 'smooth'` in a
 * `scrollIntoView` call overrides `scroll-behavior`, so the preference has to be read in
 * JavaScript or it is quietly ignored on exactly the pages that asked for it.
 */
export function revealPanel(node) {
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  node?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
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
