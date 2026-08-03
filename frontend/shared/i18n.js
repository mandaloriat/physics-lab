/**
 * Two languages, one lab: English and Italian.
 *
 * [ADR-011](../../docs/architecture-decisions.md#adr-011--english-throughout-site-included)
 * chose one language and named the price of adding a second — "a real internationalisation
 * project rather than a matter of swapping `content.json`, since the strings live in the pages
 * and in `app.js` as well". This module is that project's seam, and ADR-020 records the shape
 * it took.
 *
 * Three rules, and each of them is why this is 120 lines rather than a dependency:
 *
 * - **The catalogue is a module, not a fetch.** `strings/en.js` and `strings/it.js` export a
 *   nested object each, and exactly one of them is imported — at the top level, so every module
 *   that imports this one is deferred until the wording is in hand. That is what lets `app.js`
 *   keep its metric tables as module-level constants: by the time their initialisers run, `t`
 *   already answers. No build step, no framework, no reactive store — ADR-009 stands.
 * - **The language is chosen once per page load.** `?lang=` wins, then the stored choice, then
 *   the browser's own preference, then English. Switching language is a navigation, because the
 *   pages build their controls from constants read at import time and re-deriving them live
 *   would be the component model ADR-009 declined.
 * - **Nothing invents wording.** A key with no Italian falls back to the English and says so in
 *   the console; a key with no entry at all renders as the key, which is visibly wrong rather
 *   than quietly missing.
 *
 * Server-authored prose — the validity warnings in `report.json`, and the solver titles from
 * `GET /api/v1/solvers` — is **not** translated here and is not pretended to be. See ADR-020.
 */

import EN from '/shared/strings/en.js';

/** The languages the lab is written in. The keys are the values `<html lang>` may take. */
export const LANGUAGES = {
  en: { label: 'English', short: 'EN', locale: 'en-GB' },
  it: { label: 'Italiano', short: 'IT', locale: 'it-IT' },
};

export const DEFAULT_LANGUAGE = 'en';

const STORAGE_KEY = 'spoon-physics:lang';

/**
 * Which language this page load is in.
 *
 * The same rule the inline snippet in each page's `<head>` applies, and deliberately not read
 * back from what that snippet decided: the snippet exists to stop a frame of English being
 * painted at an Italian reader, and a page that lost it must still resolve the language
 * correctly rather than silently fall back to the markup's own. The two are kept in step by
 * being the same four lines — `?lang=`, the stored choice, the browser, English.
 */
function resolve() {
  let asked = null;
  try {
    asked = new URLSearchParams(window.location.search).get('lang');
    if (asked && asked in LANGUAGES) return { code: asked, chosen: true };
    const stored = window.localStorage?.getItem(STORAGE_KEY);
    if (stored && stored in LANGUAGES) return { code: stored, chosen: false };
  } catch {
    // A blocked or absent store is not a reason to fail to render a page.
  }
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language ?? ''];
  for (const tag of preferred) {
    const code = String(tag).slice(0, 2).toLowerCase();
    // Detected, never stored: the browser's own setting is the better answer every time it
    // changes, and a remembered copy of it would go stale and quietly win.
    if (code in LANGUAGES) return { code, chosen: false };
  }
  return { code: DEFAULT_LANGUAGE, chosen: false };
}

const resolved = resolve();

export const language = resolved.code;

// A choice made through the switch is the one that follows the visitor to the next page: the
// links carry `?lang=`, nothing else in the lab does, and without this every internal link
// would drop back to whatever the browser prefers.
if (resolved.chosen) {
  try {
    window.localStorage?.setItem(STORAGE_KEY, language);
  } catch {
    // A private window keeps the choice for one page. Nothing else here depends on the store.
  }
}

/** BCP-47 tag for `toLocaleString` and friends. Italian groups thousands with a full stop. */
export const locale = LANGUAGES[language].locale;

// One dynamic import, resolved before any importer of this module is evaluated. English is
// imported statically as well, because it is the fallback for a key Italian has not got yet and
// a fallback that needed fetching would arrive after the text it was meant to replace.
const TABLE =
  language === DEFAULT_LANGUAGE ? EN : (await import(`/shared/strings/${language}.js`)).default;

const missing = new Set();

function lookup(table, key) {
  let node = table;
  for (const step of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = node[step];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * The wording for `key`, with `{name}` placeholders filled from `vars`.
 *
 * `t('experiment.iteration', {index: 3, total: 40})`. A placeholder with no variable is left
 * standing rather than blanked, because `iteration {index}` on the screen names the bug and
 * `iteration ` hides it.
 */
export function t(key, vars = {}) {
  let text = lookup(TABLE, key);
  if (text === undefined) {
    text = lookup(EN, key);
    if (text !== undefined && !missing.has(key)) {
      missing.add(key);
      console.warn(`[i18n] no ${language} wording for "${key}"; showing the English`);
    }
  }
  if (text === undefined) {
    if (!missing.has(key)) {
      missing.add(key);
      console.warn(`[i18n] unknown key "${key}"`);
    }
    return key;
  }
  return text.replace(/\{(\w+)\}/g, (whole, name) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : whole,
  );
}

/** A number as this language writes it: `1,000` in English, `1.000` in Italian. */
export function num(value, options) {
  return Number(value).toLocaleString(locale, options);
}

/** Where this exercise's prose lives for the active language. */
export function contentUrl(exercise) {
  const suffix = language === DEFAULT_LANGUAGE ? '' : `.${language}`;
  return `/experiments/${exercise}/content${suffix}.json`;
}

/**
 * Apply the catalogue to markup that carries `data-i18n` hooks.
 *
 * Three of them, and the third is the one that needs justifying:
 *
 * - `data-i18n="key"` replaces the element's text.
 * - `data-i18n-attr="title:key; aria-label:other"` replaces attributes.
 * - `data-i18n-html="key"` replaces the element's markup, for a paragraph whose translation
 *   carries `<strong>` or a link inside it. The value is assigned from `strings/*.js` — a module
 *   this repository ships, reviewed like any other source file — and never from a fetch, a URL
 *   or anything a visitor can influence, which is what makes it a template rather than an
 *   injection point. Splitting those paragraphs into per-span keys was the alternative and it
 *   fragments a sentence into pieces no translator can read.
 */
export function translateDom(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of root.querySelectorAll('[data-i18n-html]')) {
    node.innerHTML = t(node.dataset.i18nHtml);
  }
  for (const node of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of node.dataset.i18nAttr.split(';')) {
      const [attribute, key] = pair.split(':').map((part) => part.trim());
      if (attribute && key) node.setAttribute(attribute, t(key));
    }
  }
  document.documentElement.lang = language;
  // Whatever the head snippet hid, now that the page says what it means.
  document.documentElement.removeAttribute('data-lang-pending');
}

/**
 * The URL that shows this page in `code`, keeping the path and every other query parameter.
 *
 * Switching language is a link rather than a listener on purpose: it is shareable, the back
 * button undoes it, and the reload it causes is what re-evaluates the constant tables the
 * experiment pages build their controls from.
 */
export function urlFor(code) {
  const url = new URL(window.location.href);
  url.searchParams.set('lang', code);
  return url.pathname + url.search + url.hash;
}
