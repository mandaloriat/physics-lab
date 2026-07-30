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

test('the homepage introduces the lab and links every available experiment', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page).toHaveTitle(/Spoon Physics/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // The educational disclaimer is a requirement, not decoration.
  await expect(page.locator('.disclaimer')).toContainText('not a substitute for');

  // Both available experiments are reachable from the homepage.
  await expect(
    page.locator('.card--available a[href="/experiments/airfoil/"]').first(),
  ).toBeVisible();
  await expect(
    page.locator('.card--available a[href="/experiments/solenoid/"]').first(),
  ).toBeVisible();
  // What is still planned must read as planned, not as a broken link.
  await expect(page.locator('.card--planned')).toHaveCount(1);
  await expect(page.locator('.card--planned a')).toHaveCount(0);

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

test('Cp is derived for mesh2d results too, where the field key differs', async ({ page }) => {
  // The two result kinds do not carry their scalars under the same key: `grid2d` uses
  // `data.fields`, `mesh2d` uses `data.point_fields` and has no `fields` key at all. That
  // asymmetry is the protocol's, and the viewer's own accessor branches on it the same way.
  // Deriving Cp has to branch too, so both kinds get their own run here.
  await page.goto('/experiments/airfoil/');
  await expect(page.locator('#param-output')).toBeVisible();

  await page.locator('#param-resolution').fill('64');
  await page.locator('#param-iterations').fill('300');
  await page.locator('#param-output').selectOption('mesh2d');

  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Done.', { timeout: 60_000 });

  const shape = await page.evaluate(() => {
    const result = document.getElementById('viewer').result;
    const cp = result.data.point_fields?.Cp;
    return {
      kind: result.kind,
      hasGridFieldsKey: 'fields' in result.data,
      derived: Array.isArray(cp),
      max: cp ? Math.max(...cp) : null,
      min: cp ? Math.min(...cp) : null,
    };
  });

  expect(shape.kind).toBe('mesh2d');
  expect(shape.hasGridFieldsKey).toBe(false); // guards the assumption above, not the code
  expect(shape.derived).toBe(true);
  expect(shape.max).toBeLessThanOrEqual(1 + 1e-9);
  expect(shape.min).toBeLessThan(0);

  await expect.poll(() => page.locator('#field option').count()).toBeGreaterThan(2);
  await page.locator('#field').selectOption('Cp');
  await expect(page.locator('#viewer')).toHaveAttribute('units', /Cp/);
});

test('the magnetics page solves a solenoid and derives the field strength', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/experiments/solenoid/');

  await expect(page.locator('#widgets-missing')).toBeHidden();
  await expect.poll(() => page.evaluate(() => Boolean(customElements.get('fs-viewer')))).toBe(true);

  // The picker was filled from GET /api/v1/solvers, filtered to regions2d solvers.
  await expect(page.locator('#solver')).toHaveValue(/^mock\./);
  // The parameter form came from that solver's schema — a different schema from the airfoil's.
  await expect(page.locator('#param-resolution')).toBeVisible();

  // Keep the demo solve small: this asserts the loop, not the physics.
  await page.locator('#param-resolution').fill('64');
  await page.locator('#param-iterations').fill('400');

  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Done.', { timeout: 60_000 });

  await expect(page.locator('#stats')).toContainText('duration');
  await expect(page.locator('#artifacts a')).toContainText('solution.vtk');

  const { fields, ironPermeability, peakFlux } = await page.evaluate(() => {
    const viewer = document.getElementById('viewer');
    const result = viewer.result;
    const scalars = result.kind === 'grid2d' ? result.data.fields : result.data.point_fields;
    return {
      fields: viewer.fields,
      ironPermeability: Math.max(...scalars.mu_r),
      peakFlux: Math.max(...scalars.B),
    };
  });

  // A, B and mu_r come from the solver; H is derived in the browser and has to arrive as an
  // ordinary field or the selector will not offer it.
  expect(fields).toContain('B');
  expect(fields).toContain('A');
  expect(fields).toContain('mu_r');
  expect(fields).toContain('H');

  // The core reached the solver: without it every cell would be air at mu_r = 1.
  expect(ironPermeability).toBeGreaterThan(100);
  expect(peakFlux).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

test('H is B over mu, and only A is drawn with field lines', async ({ page }) => {
  await page.goto('/experiments/solenoid/');
  await expect(page.locator('#param-resolution')).toBeVisible();
  await page.locator('#param-resolution').fill('64');
  await page.locator('#param-iterations').fill('400');

  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Done.', { timeout: 60_000 });

  // H = |B| / (mu0 mu_r), reported in kA/m. Checked against the two fields it is built from
  // rather than against a constant, so this stays true if the geometry defaults change.
  const worstError = await page.evaluate(() => {
    const MU0 = 4e-7 * Math.PI;
    const result = document.getElementById('viewer').result;
    const scalars = result.kind === 'grid2d' ? result.data.fields : result.data.point_fields;
    let worst = 0;
    for (let i = 0; i < scalars.H.length; i += 1) {
      const expected = scalars.B[i] / (MU0 * scalars.mu_r[i]) / 1000;
      worst = Math.max(worst, Math.abs(scalars.H[i] - expected));
    }
    return worst;
  });
  expect(worstError).toBeLessThan(1e-9);

  // Inside the iron, B is high and H is low — the whole reason a core concentrates flux. The
  // ratio B/H is mu0*mu_r by construction, so what is asserted is that the page found iron at
  // all: somewhere in the picture the permeability is far above air's.
  const { fluxRatio } = await page.evaluate(() => {
    const result = document.getElementById('viewer').result;
    const scalars = result.kind === 'grid2d' ? result.data.fields : result.data.point_fields;
    let iron = 0;
    let air = 0;
    for (let i = 0; i < scalars.mu_r.length; i += 1) {
      if (scalars.mu_r[i] > 100) iron = Math.max(iron, scalars.B[i]);
      else air = Math.max(air, scalars.H[i]);
    }
    return { fluxRatio: iron > 0 && air > 0 ? iron / air : 0 };
  });
  expect(fluxRatio).toBeGreaterThan(0);

  // Contours of A are the magnetic field lines; contours of |B| are not, so only A gets them.
  await page.locator('#field').selectOption('A');
  await expect(page.locator('#viewer')).toHaveAttribute('units', 'Wb/m');
  await expect(page.locator('#viewer')).toHaveAttribute('contours', '14');
  await expect(page.locator('#field-hint')).toContainText('field lines');

  await page.locator('#field').selectOption('B');
  await expect(page.locator('#viewer')).toHaveAttribute('units', 'T');
  await expect(page.locator('#viewer')).toHaveAttribute('contours', '0');

  // The material map is a check on the model, not a field, so it gets a neutral colormap.
  await page.locator('#field').selectOption('mu_r');
  await expect(page.locator('#viewer')).toHaveAttribute('colormap', 'greyscale');
});

test('no slider combination can build a geometry the protocol would refuse', async ({ page }) => {
  // The controls are measured outward from the core precisely so that partially overlapping
  // regions — which `regions2d` rejects — cannot be expressed. This walks each slider to both
  // ends and checks the payload the page would submit, which costs no solves at all.
  await page.goto('/experiments/solenoid/');
  await expect(page.locator('#shape-coreHalfWidth')).toBeVisible();

  const geometry = () =>
    page.evaluate(() => JSON.parse(document.getElementById('schematic').dataset.geometry));

  const sliders = ['coreHalfWidth', 'gap', 'winding', 'halfHeight', 'muExponent', 'currentDensity'];
  const extremes = [];
  for (const key of sliders) {
    const input = page.locator(`#shape-${key}`);
    for (const bound of ['min', 'max']) {
      const value = await input.getAttribute(bound);
      await input.fill(value);
      await input.dispatchEvent('input');
      extremes.push(await geometry());
    }
  }

  const spans = (region) => {
    const xs = region.shape.points.map(([x]) => x);
    return [Math.min(...xs), Math.max(...xs)];
  };

  for (const payload of extremes) {
    expect(payload.type).toBe('regions2d');
    expect(payload.regions.map((region) => region.name)).toEqual([
      'core',
      'winding_left',
      'winding_right',
    ]);

    const [xmin, ymin, xmax, ymax] = payload.bounds;
    for (const region of payload.regions) {
      // The protocol requires every point strictly inside the bounds.
      for (const [x, y] of region.shape.points) {
        expect(x).toBeGreaterThan(xmin);
        expect(x).toBeLessThan(xmax);
        expect(y).toBeGreaterThan(ymin);
        expect(y).toBeLessThan(ymax);
      }
    }

    // Disjoint, in the only axis they can meet in: the core's edge never reaches the winding.
    const [, coreRight] = spans(payload.regions[0]);
    const [rightBore] = spans(payload.regions[2]);
    expect(coreRight).toBeLessThan(rightBore);

    // One winding, cut twice: the two sides must carry opposite current.
    const left = payload.regions[1].material.current_density;
    const right = payload.regions[2].material.current_density;
    expect(Math.sign(left)).toBe(-Math.sign(right));
    expect(Math.abs(left)).toBeCloseTo(Math.abs(right), 12);

    // Copper is not magnetic and the core carries no current: neither key is invented.
    expect(payload.regions[1].material.mu_r).toBeUndefined();
    expect(payload.regions[0].material.current_density).toBeUndefined();
    expect(payload.regions[0].material.mu_r).toBeGreaterThanOrEqual(1);
  }
});

for (const experiment of ['airfoil', 'solenoid']) {
  test(`the ${experiment} page offers no Run button until it knows it can solve`, async ({
    page,
  }) => {
    // `/health` is held open so the "still loading" state is wide enough to test at all.
    // Two things must hold in that window: no job may be submitted, and the page must not
    // claim anything about the server it has not heard from yet.
    const submissions = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/v1/jobs')) {
        submissions.push(request.url());
      }
    });

    let release = () => {};
    const held = new Promise((resolve) => {
      release = resolve;
    });
    await page.route('**/health', async (route) => {
      await held;
      await route.continue();
    });

    await page.goto(`/experiments/${experiment}/`, { waitUntil: 'commit' });

    await expect(page.locator('#run')).toBeDisabled();
    await expect(page.locator('#status')).toContainText('Checking what this server can do');
    // Force the click past the disabled state: the guarantee is about what the page does,
    // not merely about what the pointer can reach.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.evaluate(() => document.getElementById('run')?.click());
      await page.waitForTimeout(50);
    }
    expect(submissions).toEqual([]);

    release();
    // Once both answers are in, the button is offered and the status says so.
    await expect(page.locator('#run')).toBeEnabled();
    await expect(page.locator('#status')).toContainText('Press Run');
    expect(submissions).toEqual([]);
  });
}

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
