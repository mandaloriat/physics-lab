/**
 * The site in two languages, and the switch that chooses between them.
 *
 * The Python suite checks that both catalogues are served and that every page declares both
 * versions; `scripts/check-i18n.mjs` checks that the two catalogues agree. What neither can see
 * is the thing a reader actually experiences — that the switch is reachable, that following it
 * changes the words on every part of the page, that the choice survives an ordinary link, and
 * that a browser which prefers Italian gets Italian without being asked. See ADR-020.
 *
 * The rest of the suite runs in `en-GB`, pinned in `playwright.config.mjs`, so it tests the code
 * rather than the runner's locale. This file is where the other language is exercised.
 */

import { expect, test } from '@playwright/test';

const EXPERIMENTS = [
  {
    name: 'airfoil',
    heading: /profilo alare/i,
    // One sentence from each of the three places a page's words come from: the markup
    // (`data-i18n`), the script (`t(...)`), and the lesson file (`content.it.json`).
    markup: { selector: '#controls-heading', text: 'Configura' },
    script: { selector: '#shape-note', text: 'curvatura' },
    lesson: 'equazione di Laplace',
  },
  {
    name: 'solenoid',
    heading: /circuito magnetico/i,
    markup: { selector: '#plane-heading', text: 'piano mediano' },
    script: { selector: '#shape-note', text: 'amperspire per lato' },
    lesson: 'potenziale vettore',
  },
  {
    name: 'truss',
    heading: /^Il ponte$/,
    markup: { selector: '#members-heading', text: 'Asta per asta' },
    script: { selector: '#lattice-note', text: 'nodi' },
    lesson: 'nodi cerniera',
  },
  {
    name: 'heatsink',
    heading: /^Il dissipatore$/,
    markup: { selector: '#sweep-heading', text: 'alette' },
    script: { selector: '#shape-note', text: 'Canale' },
    lesson: 'corde incrociate',
  },
];

test('the homepage reads in English until the switch is used', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Interactive problems');

  await page.getByRole('link', { name: 'Italiano' }).click();

  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Problemi interattivi');
  // The disclaimer is a requirement of the project, so it is a requirement in both languages.
  await expect(page.locator('.disclaimer')).toContainText('verifica ingegneristica');
  // A card's prose carries inline markup, which takes the other rendering path.
  await expect(page.locator('.card__problem').first()).toContainText('800 N per metro');

  await page.getByRole('link', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Interactive problems');
});

test('the choice follows an ordinary link, with no query string on it', async ({ page }) => {
  await page.goto('/?lang=it');
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');

  // The card's own link, which carries no `lang` — only the stored choice can carry it across.
  await page.getByRole('link', { name: /Progetta un profilo/ }).click();

  await expect(page).toHaveURL(/experiments\/airfoil\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/profilo alare/i);
});

test.describe('every bench reads in Italian', () => {
  for (const experiment of EXPERIMENTS) {
    test(`the ${experiment.name} page`, async ({ page }) => {
      const broken = [];
      page.on('pageerror', (error) => broken.push(String(error)));

      await page.goto(`/experiments/${experiment.name}/?lang=it`);

      await expect(page.getByRole('heading', { level: 1 })).toContainText(experiment.heading);
      await expect(page.locator(experiment.markup.selector)).toContainText(experiment.markup.text);
      await expect(page.locator(experiment.script.selector)).toContainText(experiment.script.text);
      await expect(page.locator('#lesson')).toContainText(experiment.lesson);

      // The shared renderers, which every page gets from `shared/` rather than writing.
      await expect(page.locator('.workspace__toolbar')).toContainText('Reimposta vista');
      await expect(page.locator('#runs-table')).toContainText('Nessuna prova salvata');
      await expect(page.locator('#challenge')).toContainText('non ancora calcolato');
      // The status line has resolved rather than printing its key, which has no spaces in it.
      await expect(page.locator('#status')).toContainText('Premi Esegui');

      expect(broken, broken.join(' | ')).toEqual([]);
    });
  }
});

test('a browser that prefers Italian is not made to ask', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'it-IT' });
  const page = await context.newPage();

  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Problemi interattivi');

  // Detected, never stored — so an explicit English choice still wins, and still sticks.
  await page.getByRole('link', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.goto('/experiments/truss/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await context.close();
});

test('no page is left hidden by the guard that stops a flash of English', async ({ browser }) => {
  // `data-lang-pending` hides the body until `translateDom` clears it. The head snippet also
  // clears it on a timer, so a page whose modules never load appears anyway — but on a page
  // that works, the attribute must be gone the moment the header is there.
  const context = await browser.newContext({ locale: 'it-IT' });
  const page = await context.newPage();

  await page.goto('/experiments/airfoil/');
  await expect(page.locator('.site-header')).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-lang-pending', /.*/);
  await expect(page.locator('body')).toBeVisible();

  await context.close();
});
