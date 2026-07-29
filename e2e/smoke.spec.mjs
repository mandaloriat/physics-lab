/**
 * Front-end smoke test: does the lab actually work in a browser?
 *
 * The Python suite proves the API and the protocol; this proves the part only a browser
 * can prove — that the import map resolves, that the Fenix Spoon custom elements upgrade,
 * that the widgets are reachable at the vendored paths, and that a real solve runs from
 * the page and paints a field.
 *
 *   BASE_URL=http://127.0.0.1:8000 npx playwright test
 *
 * It deliberately runs against a *deployment*, not a dev fixture: the same file checks a
 * local `docker compose up` and a production one.
 */

import { expect, test } from '@playwright/test';

test('the homepage introduces the lab and links the airfoil experiment', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page).toHaveTitle(/Andolfatto Physics Lab/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // The educational disclaimer is a requirement, not decoration.
  await expect(page.locator('.disclaimer')).toContainText('not a substitute for');

  await expect(page.getByRole('link', { name: /Open the experiment/ })).toHaveAttribute(
    'href',
    '/experiments/airfoil/',
  );
  // The planned experiments must read as planned, not as broken links.
  await expect(page.locator('.card--planned')).toHaveCount(2);

  // The capability notice is filled in from /health, so its text proves the API answered.
  await expect(page.locator('#capability')).not.toContainText('Checking what is installed');

  expect(errors).toEqual([]);
});

test('the airfoil page runs a solve and renders the field', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/experiments/airfoil/');

  // The widgets loaded through the import map and upgraded.
  await expect(page.locator('#widgets-missing')).toBeHidden();
  await expect.poll(() => page.evaluate(() => Boolean(customElements.get('fs-viewer')))).toBe(true);
  await expect
    .poll(() => page.evaluate(() => Boolean(customElements.get('fs-geometry-2d'))))
    .toBe(true);

  // The editor produced protocol geometry from the generated NACA profile.
  const geometry = await page.evaluate(() => document.getElementById('editor').value);
  expect(geometry.type).toBe('domain2d');
  expect(geometry.obstacle.points.length).toBeGreaterThan(8);

  // The solver picker was filled from GET /api/v1/solvers, and the mock is selected.
  await expect.poll(() => page.locator('#solver option').count()).toBeGreaterThan(0);
  await expect(page.locator('#solver')).toHaveValue(/^mock\./);

  // The parameter form was generated from that solver's published JSON Schema.
  await expect(page.locator('#param-resolution')).toBeVisible();

  // Keep the demo solve small: this asserts the loop, not the physics.
  await page.locator('#param-resolution').fill('64');
  await page.locator('#param-iterations').fill('200');

  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Done.', { timeout: 60_000 });

  // Progress, stats and the artifact link are all part of the experience.
  await expect(page.locator('#stats dt')).not.toHaveCount(0);
  await expect(page.locator('#stats')).toContainText('duration');
  await expect(page.locator('#artifacts a')).toContainText('solution.vtk');

  // The viewer actually painted something: a canvas with a non-empty field list.
  const fields = await page.evaluate(() => document.getElementById('viewer').fields);
  expect(fields).toContain('speed');

  // The colorbar names the field it is showing. Without this the bar is a bare number
  // range, which is how a streamfunction running −1…1 gets read as a pressure.
  await expect(page.locator('#viewer')).toHaveAttribute('units', /speed/);

  expect(errors).toEqual([]);
});

test('the pressure coefficient is derived from speed and is physically bounded', async ({
  page,
}) => {
  await page.goto('/experiments/airfoil/');
  await expect(page.locator('#param-resolution')).toBeVisible();
  await page.locator('#param-resolution').fill('64');
  await page.locator('#param-iterations').fill('300');

  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Done.', { timeout: 60_000 });

  // Cp is not in the result envelope the solver returns — the page derives it. It has to
  // reach the viewer as an ordinary field, or the selector will not offer it.
  const fields = await page.evaluate(() => document.getElementById('viewer').fields);
  expect(fields).toContain('Cp');

  const { max, min, freeStream } = await page.evaluate(() => {
    const result = document.getElementById('viewer').result;
    const data = result.kind === 'grid2d' ? result.data.fields : result.data.point_fields;
    return {
      max: Math.max(...data.Cp),
      min: Math.min(...data.Cp),
      freeStream: Math.max(...data.speed),
    };
  });

  // Cp = 1 − (|v|/U∞)², so in incompressible potential flow it cannot exceed 1: that value
  // is a stagnation point, where the flow has been brought to rest. A Cp above 1 would mean
  // the derivation, or the free stream it was divided by, is wrong.
  expect(max).toBeLessThanOrEqual(1 + 1e-9);
  // And the profile must accelerate the flow somewhere, which is suction — negative Cp.
  expect(min).toBeLessThan(0);
  expect(freeStream).toBeGreaterThan(0);

  // Selecting it relabels the bar and switches to the diverging map zero-centred Cp needs.
  await page.locator('#field').selectOption('Cp');
  await expect(page.locator('#viewer')).toHaveAttribute('units', /Cp/);
  await expect(page.locator('#viewer')).toHaveAttribute('colormap', 'coolwarm');
  await expect(page.locator('#viewer')).toHaveAttribute('symmetric', '');
  await expect(page.locator('#field-hint')).toContainText('suction');

  // Going back to a scalar field drops the symmetric range again.
  await page.locator('#field').selectOption('speed');
  await expect(page.locator('#viewer')).not.toHaveAttribute('symmetric', '');
});

test('the geometry can be reshaped and restored', async ({ page }) => {
  await page.goto('/experiments/airfoil/');
  await expect(page.locator('#shape-camber')).toBeVisible();

  const camberOf = () =>
    page.evaluate(() => {
      const points = document.getElementById('editor').controlPoints;
      return Math.max(...points.map(([, y]) => y));
    });

  const initial = await camberOf();
  await page.locator('#shape-camber').fill('9');
  await page.locator('#shape-camber').dispatchEvent('input');
  const cambered = await camberOf();
  expect(cambered).toBeGreaterThan(initial);

  await page.getByRole('button', { name: 'Reset geometry' }).click();
  expect(await camberOf()).toBeCloseTo(initial, 6);
});
