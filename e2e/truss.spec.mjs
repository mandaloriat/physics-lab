/**
 * The bridge exercise, in a browser.
 *
 * What only a browser can prove here is not "a field appeared" — the Python suite already
 * proves the solve. It is that the **builder** and the **load case** agree: that a support you
 * place becomes a named boundary the server accepts, that a lattice you draw is the lattice
 * that gets submitted, and that the modes stay apart, so a drag is never both a pan and a bar.
 *
 *   BASE_URL=http://127.0.0.1:8000 npx playwright test truss
 */

import { expect, test } from '@playwright/test';

/** The site the page draws in, in metres — the same rectangle `SITE.bounds` names in app.js. */
const SITE = { xmin: -4, ymin: -6, xmax: 28, ymax: 8 };

async function ready(page) {
  await page.goto('/experiments/truss/');
  await expect(page.locator('#run')).toBeEnabled();
}

/**
 * Where a domain point is on the screen, so a click can be aimed at a joint.
 *
 * Scrolled into view first, and that is not a nicety: `page.mouse` takes viewport coordinates,
 * and on a 720-pixel-tall window the stage runs off the bottom, so a click aimed at the deck
 * lands outside the window and silently does nothing.
 */
async function at(page, x, y) {
  await page.locator('#builder').scrollIntoViewIfNeeded();
  const box = await page.locator('#builder').boundingBox();
  return {
    x: box.x + ((x - SITE.xmin) / (SITE.xmax - SITE.xmin)) * box.width,
    y: box.y + ((SITE.ymax - y) / (SITE.ymax - SITE.ymin)) * box.height,
  };
}

async function build(page, tool) {
  await page.locator('[data-tool=edit]').click();
  await page.locator('#build-tools button', { hasText: tool }).click();
}

async function clickAt(page, x, y) {
  const point = await at(page, x, y);
  await page.mouse.click(point.x, point.y);
}

async function solve(page) {
  await page.locator('#run').click();
  await expect(page.locator('#status')).toContainText('Done.', { timeout: 60000 });
}

test('the exercise states a problem before it offers a solver', async ({ page }) => {
  await ready(page);
  // The mission is above everything, and it is quantitative: three targets with numbers.
  await expect(page.locator('#challenge .challenge__statement')).toContainText('24 m deck');
  await expect(page.locator('#challenge .challenge__target')).toHaveCount(3);
  // Before a run every target reads as unanswered rather than as failed.
  await expect(page.locator('#challenge .challenge__target.is-pending')).toHaveCount(3);
  // And no reporting panel exists yet: an empty answer box teaches a visitor to skip it.
  await expect(page.locator('#results')).toBeHidden();
});

test('no internal identifier reaches the screen, before or after a run', async ({ page }) => {
  await ready(page);
  const keys = ['utilisation_max', 'span_ratio', 'carried_per_mass', 'joint_equilibrium_rel'];
  const shown = async () => (await page.locator('main').innerText()).toLowerCase();

  for (const key of keys) expect(await shown()).not.toContain(key);
  await solve(page);
  for (const key of keys) expect(await shown()).not.toContain(key);
  // The quantities are all there — under the names a person reads.
  await expect(page.locator('#kpis')).toContainText('Worst member');
  await expect(page.locator('#kpis')).toContainText('Carried per kg');
});

test('the default lattice carries the load and misses the mission', async ({ page }) => {
  await ready(page);
  await solve(page);

  // One target missed, two met, and the run disqualified besides — the buckled member. A
  // default that already passed would leave nothing to do.
  await expect(page.locator('#challenge .challenge__target.is-missed')).toHaveCount(1);
  await expect(page.locator('#challenge .challenge__target.is-met')).toHaveCount(2);
  await expect(page.locator('.challenge__blocked--validity')).toBeVisible();
  await expect(page.locator('#validity')).toContainText('Euler critical load');

  // Every declared check ran, and every one passed: this method does not approximate a
  // continuum, so a residual worth reporting would be a bug rather than a coarse mesh.
  await expect(page.locator('#verification tr')).toHaveCount(5);
  await expect(page.locator('#verification tr.is-met')).toHaveCount(5);
});

test('Build and Explore are separate modes, and the builder owns the pointer in one', async ({
  page,
}) => {
  await ready(page);
  // The editor exists only in Build. Everywhere else a drag pans the field, which is the
  // conflict the separation removes.
  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('#build-tools button').first()).toBeDisabled();

  await page.locator('[data-tool=edit]').click();
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#build-tools button').first()).toBeEnabled();

  await page.locator('[data-tool=pan]').click();
  await expect(page.locator('#editor')).toBeHidden();
});

test('what is drawn is what is submitted, as a lattice and a load case', async ({ page }) => {
  await ready(page);

  const submitted = [];
  await page.route('**/api/v1/jobs', async (route) => {
    if (route.request().method() === 'POST') submitted.push(route.request().postDataJSON());
    await route.continue();
  });

  // Drop a load on the midspan joint of the default eight-panel Warren: joint 4, at x = 12.
  await build(page, 'Load');
  await clickAt(page, 12, 0);
  await expect(page.locator('#lattice-note')).toContainText('1 joint load(s) placed');

  await solve(page);
  expect(submitted).toHaveLength(1);
  const request = submitted[0];

  // The lattice travels as params, because the protocol has no line geometry — the finding
  // this exercise exists to record, asserted rather than described.
  expect(request.solver).toMatch(/^lab\.truss/);
  expect(request.geometry.type).toBe('regions2d');
  expect(request.params.nodes).toHaveLength(17);
  expect(request.params.members).toHaveLength(31);

  // The site names every place a condition attaches to, and the load case attaches to exactly
  // those names: two supports, the deck, and the joint the load was dropped on.
  const named = request.geometry.boundaries.map((entry) => entry.name);
  expect(named).toContain('deck');
  expect(named).toContain('load_4');
  expect(Object.keys(request.conditions).sort()).toEqual(named.sort());
  expect(request.conditions.deck).toEqual({ load_y: -4000 });
  expect(request.conditions.load_4).toEqual({ force_y: -10000 });
  expect(request.conditions.support_0).toEqual({ fixed_x: 1, fixed_y: 1 });
  // A roller holds one direction only, and that is the difference between a determinate
  // bridge and one that puts force into its chords on a warm day.
  expect(request.conditions.support_8).toEqual({ fixed_y: 1 });
});

test('a lattice that folds is refused by name, not reported with a caveat', async ({ page }) => {
  await ready(page);
  await page.selectOption('#preset', 'deck');
  await page.locator('#run').click();

  // The deck alone is a chain of collinear bars. There is no equilibrium to report, and the
  // refusal says where to look rather than only that something is wrong.
  await expect(page.locator('#status')).toContainText('mechanism', { timeout: 60000 });
  await expect(page.locator('#status')).toContainText('Triangulate it');
  await expect(page.locator('#results')).toBeHidden();
});

test('the page refuses to submit a bridge nothing holds up, before the server has to', async ({
  page,
}) => {
  await ready(page);
  const submissions = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/v1/jobs')) {
      submissions.push(request.url());
    }
  });

  await page.selectOption('#preset', 'empty');
  await expect(page.locator('#run')).toBeDisabled();
  await expect(page.locator('#status')).toContainText('Nothing is built yet');

  await page.evaluate(() => document.getElementById('run')?.click());
  expect(submissions).toEqual([]);
});

test('a joint can be added, joined and erased, and undo puts it back', async ({ page }) => {
  await ready(page);
  const count = async () => (await page.locator('#lattice-note').textContent()).match(/^(\d+)/)[1];

  expect(await count()).toBe('17');

  await build(page, 'Joint');
  await clickAt(page, 12, 6);
  expect(await count()).toBe('18');

  await build(page, 'Bar');
  await clickAt(page, 12, 6);
  await clickAt(page, 12, 0);
  await expect(page.locator('#lattice-note')).toContainText('32 bars');

  await build(page, 'Erase');
  await clickAt(page, 12, 6);
  await expect(page.locator('#lattice-note')).toContainText('17 joints, 31 bars');

  await page.locator('#undo').click();
  await expect(page.locator('#lattice-note')).toContainText('18 joints, 32 bars');
});

test('the deflected shape is drawn with the factor it is magnified by', async ({ page }) => {
  await ready(page);
  await solve(page);

  // A picture of a deflection with no scale on it is the easiest way there is to leave someone
  // thinking a bridge is sagging, so the factor is in the layer's own label.
  const layer = page.locator('[data-layer=deformed]');
  await expect(layer).toBeEnabled();
  await expect(layer).toContainText(/×\d+/);
  await expect(page.locator('#overlay .overlay__deformed')).toHaveCount(1);
  await expect(page.locator('#overlay .overlay__worst')).toHaveCount(1);
});

test('a kept run records the lattice it was computed on, and reloads it', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => window.localStorage.removeItem('spoon-physics:runs:truss'));

  await page.selectOption('#preset', 'warren-10');
  await solve(page);
  await page.locator('#keep').click();

  const stored = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem('spoon-physics:runs:truss')),
  );
  expect(stored).toHaveLength(1);
  const row = stored[0];
  // Every input, not the interesting ones: a row missing a default is not reproducible.
  expect(row.geometry.nodes).toHaveLength(21);
  expect(row.geometry.supports).toEqual({ 0: 'pin', 10: 'roller' });
  expect(row.physical.area).toBeGreaterThan(0);
  expect(row.physical.deck_load).toBe(-4000);
  expect(row.metrics.utilisation_max).toBeGreaterThan(0);
  expect(row.verification.joint_equilibrium_rel).toBeLessThan(1e-6);

  // And Load puts it back on the page without re-solving: Run is still the visitor's.
  await page.selectOption('#preset', 'warren-8');
  await expect(page.locator('#lattice-note')).toContainText('17 joints');
  await page.locator('#runs-table button', { hasText: 'Load' }).first().click();
  await expect(page.locator('#lattice-note')).toContainText('21 joints');
  await expect(page.locator('#status')).toContainText('Press Run to recompute it');
});
