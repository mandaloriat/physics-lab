#!/usr/bin/env node
/**
 * The two languages, checked against each other and against the pages that use them.
 *
 * Four failures are possible once a lab has more than one language, and every one of them is
 * silent in a browser: a key the Italian catalogue never got, a key the pages ask for and
 * neither catalogue has, a placeholder that survives translation as literal `{value}`, and an
 * Italian `content.*.json` that has drifted from the English one it is a translation of. The
 * first shows English inside Italian prose, the second prints the key, the third prints a
 * brace, and the fourth quietly changes the exercise. None of them fails a test that only
 * loads a page.
 *
 * Run by `npm run check:i18n`, and by CI beside the formatter. It needs no browser and no
 * server: the catalogues are plain ES modules, so Node imports them directly.
 */

import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FRONTEND = join(ROOT, 'frontend');
/* Every exercise with a `content.json`. The heat sink was missing from this list from the
   release that built it until ADR-021, so its two content files were the only ones in the lab
   nothing compared — which is the failure mode a checker has: it is silent about what it was
   never told to look at. Adding a page here is part of adding a page. */
const EXERCISES = ['airfoil', 'solenoid', 'truss', 'heatsink'];

const problems = [];
const fail = (message) => problems.push(message);

/* ------------------------------------------------------------------------ the catalogues */

const catalogues = {};
for (const code of ['en', 'it']) {
  catalogues[code] = (
    await import(pathToFileURL(join(FRONTEND, 'shared/strings', `${code}.js`)))
  ).default;
}

/** Every leaf key, as a dotted path. */
function paths(table, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(table)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') out.push(...paths(value, path));
    else out.push(path);
  }
  return out;
}

function at(table, path) {
  return path.split('.').reduce((node, step) => (node == null ? undefined : node[step]), table);
}

const english = paths(catalogues.en);
const italian = paths(catalogues.it);

for (const path of english) {
  if (!italian.includes(path)) fail(`it.js is missing "${path}"`);
}
for (const path of italian) {
  if (!english.includes(path)) fail(`it.js has "${path}", which en.js does not`);
}

/** `{name}` placeholders, sorted — a translation that drops one prints a brace at a reader. */
const placeholders = (text) =>
  [...String(text).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

for (const path of english) {
  if (!italian.includes(path)) continue;
  const here = placeholders(at(catalogues.en, path)).join(',');
  const there = placeholders(at(catalogues.it, path)).join(',');
  if (here !== there) {
    fail(`"${path}" takes {${here}} in English and {${there}} in Italian`);
  }
}

/* ------------------------------------------------------- the keys the pages actually ask for */

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

/**
 * Keys used in source, with the caveat that this reads literals only.
 *
 * `t(\`airfoil.notes.${profile.label}\`)` and the like are computed and cannot be checked from
 * here; the catalogues carry those groups whole, and a missing member of one shows up as the
 * console warning `t` emits. What this catches is the common case — a typed key that never
 * existed, or one renamed on one side of the seam.
 */
const used = new Map();
const note = (key, where) => {
  if (!used.has(key)) used.set(key, where);
};

for await (const path of walk(FRONTEND)) {
  if (path.includes(`${join('shared', 'strings')}`)) continue;
  const where = relative(ROOT, path);
  const text = readFileSync(path, 'utf8');

  if (path.endsWith('.js')) {
    for (const match of text.matchAll(/\bt\(\s*'([\w.-]+)'/g)) note(match[1], where);
  }
  if (path.endsWith('.html')) {
    for (const match of text.matchAll(/data-i18n(?:-html)?="([\w.-]+)"/g)) note(match[1], where);
    for (const match of text.matchAll(/data-i18n-attr="([^"]+)"/g)) {
      for (const pair of match[1].split(';')) {
        const key = pair.split(':')[1]?.trim();
        if (key) note(key, where);
      }
    }
  }
}

for (const [key, where] of used) {
  if (!english.includes(key)) fail(`${where} asks for "${key}", which en.js does not define`);
}

/* ------------------------------------------------------------------- the lesson content */

/**
 * An Italian `content.it.json` is a translation, not a variant.
 *
 * The prose differs and must; the *structure* may not. Section ids drive the `open` list and
 * the anchors, and the targets are the exercise itself — a translated challenge with a
 * different tolerance would be a different exercise wearing the same name, which is precisely
 * the failure a second language invites.
 */
for (const exercise of EXERCISES) {
  const read = (name) =>
    JSON.parse(readFileSync(join(FRONTEND, 'experiments', exercise, name), 'utf8'));
  const source = read('content.json');
  const translated = read('content.it.json');

  const ids = (content) => content.sections.map((section) => section.id).join(',');
  if (ids(source) !== ids(translated)) {
    fail(`${exercise}/content.it.json has different sections from content.json`);
  }
  if (source.id !== translated.id) {
    fail(`${exercise}/content.it.json claims to be "${translated.id}"`);
  }
  if (JSON.stringify(source.challenge.targets) !== JSON.stringify(translated.challenge.targets)) {
    fail(`${exercise}/content.it.json states different targets — a translation may not`);
  }
  if (
    JSON.stringify(source.challenge.requires_verified ?? null) !==
    JSON.stringify(translated.challenge.requires_verified ?? null)
  ) {
    fail(`${exercise}/content.it.json states a different verification gate`);
  }
  const count = (entry) => (entry.body ?? entry.steps ?? []).length;

  for (const [index, section] of source.sections.entries()) {
    const other = translated.sections[index];
    if (Boolean(section.caution) !== Boolean(other.caution)) {
      fail(`${exercise}: section "${section.id}" is a caution in one language and not the other`);
    }
    if (count(section) !== count(other)) {
      fail(
        `${exercise}: section "${section.id}" has ${count(section)} paragraphs in English and ` +
          `${count(other)} in Italian`,
      );
    }
  }

  /* The guided path (ADR-021), under the same rule as the sections, plus one of its own.
     A chapter's `figure` names a drawing function the page supplies, and its `presets` carry
     the incidences the buttons run — both are behaviour rather than prose, so a translation
     that changed either would change what the page *does*, which is exactly the failure this
     file exists to catch. The notes beside the presets are prose and may differ freely. */
  const guide = (content) => content.guide ?? [];
  const chapters = (content) =>
    guide(content)
      .map((chapter) => chapter.id)
      .join(',');
  if (chapters(source) !== chapters(translated)) {
    fail(`${exercise}/content.it.json has different guide chapters from content.json`);
  }
  for (const [index, chapter] of guide(source).entries()) {
    const other = guide(translated)[index];
    if (count(chapter) !== count(other)) {
      fail(
        `${exercise}: guide chapter "${chapter.id}" has ${count(chapter)} paragraphs in English ` +
          `and ${count(other)} in Italian`,
      );
    }
    if ((chapter.figure ?? null) !== (other.figure ?? null)) {
      fail(`${exercise}: guide chapter "${chapter.id}" names a different figure per language`);
    }
    const alphas = (entry) => (entry.presets ?? []).map((preset) => preset.alpha).join(',');
    if (alphas(chapter) !== alphas(other)) {
      fail(`${exercise}: guide chapter "${chapter.id}" offers different presets per language`);
    }
    for (const preset of other.presets ?? []) {
      if (!preset.note) {
        fail(`${exercise}: guide chapter "${chapter.id}" has a preset with no note in Italian`);
      }
    }
  }
}

/* -------------------------------------------------------------------------------- verdict */

if (problems.length) {
  console.error(`i18n check failed:\n${problems.map((line) => `  - ${line}`).join('\n')}`);
  process.exit(1);
}
console.log(
  `i18n check passed: ${english.length} keys in two languages, ` +
    `${used.size} of them named by the pages.`,
);
