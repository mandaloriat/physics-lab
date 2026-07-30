/**
 * The airfoil exercise, in a browser.
 *
 * What has to be true here is the exercise contract, not "a field appeared": that the three
 * parameter groups really are separate, that a metric the model cannot produce is absent rather
 * than zero, that a run outside the model's stated validity cannot meet the target however good
 * its numbers, that a metric needing a study says so before one is run, and that a kept run can
 * be recomputed from what was kept.
 *
 *   BASE_URL=http://127.0.0.1:8000 npx playwright test
 *
 * Runs against a deployment. Each solve is a panel method — milliseconds of arithmetic and
 * under a second of field sampling — so unlike the mock-solver pages there is no need to shrink
 * anything to keep the suite quick.
 */

import { expect, test } from '@playwright/test';

/** Set a generated control and fire the event the form listens for. */
async function setParam(page, name, value) {
  await page.locator(`#param-${name}`).evaluate((node, next) => {
    node.value = next;
    node.dispatchEvent(new Event('input', { bubbles: true }));
  }, String(value));
}

async function solve(page) {
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Done.', { timeout: 90_000 });
}

async function ready(page) {
  await page.goto('/experiments/airfoil/');
  await expect(page.locator('#widgets-missing')).toBeHidden();
  await expect(page.locator('#param-alpha_deg')).toBeVisible();
}

test('the exercise states a problem before it offers a solver', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await ready(page);
  await expect(page).toHaveTitle(/Airfoil design/);

  // The objective, and each target, before anything has been run.
  await expect(page.locator('.challenge__statement')).toContainText('800 N/m');
  await expect(page.locator('.challenge__target')).toHaveCount(2);
  await expect(page.locator('.challenge__target.is-pending')).toHaveCount(2);
  await expect(page.locator('#challenge')).toContainText('not run yet');

  // Only a solver that can impose a Kutta condition implements this model.
  await expect(page.locator('#solver')).toHaveValue(/^lab\.airfoil/);
  await expect(page.locator('#solver-hint')).toContainText('Kutta');

  expect(errors).toEqual([]);
});

test('physical inputs, numerical settings and the study are separate groups', async ({ page }) => {
  await ready(page);

  // The distinction is the point of the contract, so it has to be visible in the DOM and not
  // merely in the reading order: each group is its own panel, and no control is in two.
  await expect(page.locator('#physical #param-alpha_deg')).toBeVisible();
  await expect(page.locator('#physical #param-u_inf')).toBeVisible();
  await expect(page.locator('#physical #param-kutta')).toBeVisible();
  await expect(page.locator('#numerical #param-panels')).toBeVisible();
  await expect(page.locator('#numerical #param-resolution')).toBeVisible();
  await expect(page.locator('#study #param-sweep_from_deg')).toBeVisible();

  await expect(page.locator('#physical #param-panels')).toHaveCount(0);
  await expect(page.locator('#numerical #param-alpha_deg')).toHaveCount(0);

  // Density, viscosity and the speed of sound are consequences of the atmosphere, so they are
  // not offered as free parameters at all.
  await expect(page.locator('#param-rho')).toHaveCount(0);
  await expect(page.locator('#param-mu')).toHaveCount(0);
  await expect(page.locator('#param-sound_speed')).toHaveCount(0);
});

test('the ISA atmosphere resolves altitude to the standard values', async ({ page }) => {
  await ready(page);

  // The five-row table of docs/exercises/airfoil.md §5.3, checked in the browser because the
  // atmosphere is resolved there and the solver is sent the properties rather than the altitude.
  const rows = await page.evaluate(async () => {
    const { isa } = await import('/shared/atmosphere.js');
    return [0, 1000, 5000, 11000, 15000].map((h) => {
      const air = isa(h);
      return [h, air.temperature, air.pressure, air.density, air.viscosity, air.soundSpeed];
    });
  });

  const expected = [
    [0, 288.15, 101325, 1.225, 1.7893e-5, 340.29],
    [1000, 281.65, 89874.6, 1.1116, 1.7578e-5, 336.43],
    [5000, 255.65, 54019.9, 0.7361, 1.628e-5, 320.53],
    [11000, 216.65, 22632.0, 0.3639, 1.4215e-5, 295.07],
    [15000, 216.65, 12044.6, 0.1937, 1.4215e-5, 295.07],
  ];
  // Compared relatively, because the five quantities span 1e-5 to 1e5 and a shared number of
  // decimal places would be vacuous at one end and impossible at the other.
  for (const [index, row] of rows.entries()) {
    for (const [column, value] of row.entries()) {
      const reference = expected[index][column];
      if (reference === 0) continue;
      expect(Math.abs(value / reference - 1)).toBeLessThan(2e-4);
    }
  }

  // And the altitude control drives them: the derived block is what a visitor reads.
  await expect(page.locator('#derived')).toContainText('1.2250');
  await page.locator('#phys-altitude').fill('5000');
  await page.locator('#phys-altitude').dispatchEvent('change');
  await expect(page.locator('#derived')).toContainText('0.7361');
});

test('a run that meets the target says so, with its verification and its validity', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await ready(page);
  // NACA 2412 at 4.6 degrees is the intended solution of the challenge.
  await setParam(page, 'alpha_deg', 4.6);
  await solve(page);

  // The answer.
  await expect(page.locator('div#metrics')).toContainText('799');
  await expect(page.locator('.challenge__target.is-met')).toHaveCount(2);
  await expect(page.locator('#challenge')).toContainText('Target met');

  // Every check ran and passed, and the validity statement is explicit rather than an empty box.
  await expect(page.locator('#verification tr')).toHaveCount(3);
  await expect(page.locator('#verification tr.is-missed')).toHaveCount(0);
  await expect(page.locator('#validity')).toContainText('Inside the stated domain of validity');

  // The cost of the solve is reported apart from the answer.
  await expect(page.locator('#stats')).toContainText('duration');
  await expect(page.locator('#artifacts a')).toContainText('report.json');

  // The surface pressure curve is drawn, suction upward.
  await expect(page.locator('#cp-curve .curve__trace')).toHaveCount(2);
  const inverted = await page.evaluate(() => {
    const traces = [...document.querySelectorAll('#cp-curve .curve__trace')];
    // The upper surface carries the suction peak, so with an inverted axis its path must reach
    // *higher* on the screen (smaller y) than the lower surface's.
    const top = (trace) =>
      Math.min(
        ...trace
          .getAttribute('d')
          .match(/,(-?[\d.]+)/g)
          .map((m) => parseFloat(m.slice(1))),
      );
    return top(traces[0]) < top(traces[1]);
  });
  expect(inverted).toBe(true);

  expect(errors).toEqual([]);
});

test('the model cannot be talked into reporting drag or efficiency', async ({ page }) => {
  await ready(page);
  await solve(page);

  const report = await page.evaluate(async () => {
    const link = [...document.querySelectorAll('#artifacts a')].find((a) =>
      a.textContent.includes('report.json'),
    );
    return (await fetch(link.href)).json();
  });

  // Absent, and named as absent — which is a stronger claim than merely being absent.
  expect(report.model.withheld).toContain('c_d');
  expect(report.model.withheld).toContain('l_over_d');
  expect(Object.keys(report.metrics)).not.toContain('c_d');
  expect(Object.keys(report.metrics)).not.toContain('l_over_d');

  // The metrics table shows nothing resembling a drag, and the panel says why.
  await expect(page.locator('div#metrics')).not.toContainText('Drag');
  await expect(page.locator('#answer-heading ~ .field__hint')).toContainText('inviscid');
});

test('a target hit outside the model’s validity does not count', async ({ page }) => {
  await ready(page);

  // Mach 0.44: the numbers still come out, and the incompressible assumption does not hold.
  await setParam(page, 'u_inf', 150);
  await setParam(page, 'alpha_deg', 0.4);
  await solve(page);

  await expect(page.locator('#validity li')).not.toHaveCount(0);
  await expect(page.locator('#validity')).toContainText('Mach');
  // Whatever the targets say, the run is disqualified and the page says which rule did it.
  await expect(page.locator('.challenge__blocked')).toContainText('domain of validity');
  await expect(page.locator('#challenge')).not.toContainText('Target met');
});

test('the aerodynamic centre is unavailable until a sweep has been run', async ({ page }) => {
  await ready(page);
  await solve(page);

  // A property of several solves must not be offered after one.
  await expect(page.locator('#sweep-panel')).toBeHidden();

  await setParam(page, 'sweep_from_deg', -4);
  await setParam(page, 'sweep_to_deg', 8);
  await solve(page);

  await expect(page.locator('#sweep-panel')).toBeVisible();
  await expect(page.locator('#sweep-metrics')).toContainText('Aerodynamic centre');
  await expect(page.locator('#sweep-curve .curve__trace')).toHaveCount(2);

  // Thin-airfoil theory puts it at the quarter chord; thickness moves it slightly aft.
  const centre = await page.evaluate(() => {
    const text = [...document.querySelectorAll('#sweep-metrics div')].find((d) =>
      d.textContent.includes('Aerodynamic centre'),
    ).textContent;
    return parseFloat(text.match(/([\d.]+)\s*c/)[1]);
  });
  expect(centre).toBeGreaterThan(0.23);
  expect(centre).toBeLessThan(0.29);
});

test('turning the Kutta condition off returns the page to zero lift, and explains it', async ({
  page,
}) => {
  await ready(page);
  await setParam(page, 'alpha_deg', 5);
  await page.locator('#param-kutta').selectOption('none');
  await solve(page);

  const lift = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('div#metrics tr')];
    const row = rows.find((r) => r.textContent.includes('Lift coefficient'));
    return parseFloat(row.querySelector('td').textContent);
  });
  expect(Math.abs(lift)).toBeLessThan(1e-6);

  await expect(page.locator('#validity')).toContainText('zero by construction');
  // And the reason a Kutta condition exists at all: the trailing-edge velocity is unbounded.
  await expect(page.locator('#validity')).toContainText('unbounded');
});

test('a kept run records enough to be recomputed, and two runs can be compared', async ({
  page,
}) => {
  await ready(page);
  await setParam(page, 'alpha_deg', 4.6);
  await solve(page);
  await page.getByRole('button', { name: 'Keep run' }).click();
  await expect(page.locator('#runs-table tbody tr')).toHaveCount(1);

  const [row] = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem('spoon-physics:runs:airfoil')),
  );
  // Every input, including the ones nobody touched: a row missing a default is not
  // reproducible, because the default can change.
  expect(row.physical).toMatchObject({ alpha_deg: 4.6, u_inf: expect.any(Number) });
  for (const key of ['rho', 'mu', 'sound_speed', 'chord_m', 'kutta', 'atmosphere']) {
    expect(row.physical[key]).not.toBeUndefined();
  }
  for (const key of ['panels', 'trailing_edge', 'resolution', 'convergence_check']) {
    expect(row.numerics[key]).not.toBeUndefined();
  }
  expect(row.geometry.outline).toMatch(/^fnv1a:/);
  expect(row.dimensionless.reynolds).toBeGreaterThan(0);
  expect(row.verification.cl_consistency_rel).toBeGreaterThanOrEqual(0);
  expect(row.validity.warnings).toEqual([]);
  expect(row.solver.name).toMatch(/^lab\.airfoil/);

  // A second, different run, and the comparison shows what changed and hides what did not.
  await page.selectOption('#profile', 'NACA 4412');
  await setParam(page, 'alpha_deg', 2.5);
  await solve(page);
  await page.getByRole('button', { name: 'Keep run' }).click();
  await expect(page.locator('#runs-table tbody tr')).toHaveCount(2);

  await page.locator('#runs-table tbody input[type=checkbox]').first().check();
  await page.locator('#runs-table tbody input[type=checkbox]').nth(1).check();
  await expect(page.locator('#compare table')).toBeVisible();
  await expect(page.locator('#compare')).toContainText('geometry.label');
  await expect(page.locator('#compare')).toContainText('are identical and hidden');

  // Loading a row puts its inputs back without solving again.
  await page.locator('#runs-table tbody tr').last().getByRole('button', { name: 'Load' }).click();
  await expect(page.locator('#status')).toContainText('Loaded the inputs');
  await expect(page.locator('#param-alpha_deg')).toHaveValue('4.6');
});

test('a strongly cambered section reaches the lift and fails the moment constraint', async ({
  page,
}) => {
  // The exercise's actual lesson, asserted: camber buys lift at low incidence and charges for
  // it in pitching moment. If this ever passes both targets, the challenge has stopped
  // discriminating and its constraint needs revisiting.
  await ready(page);
  await page.selectOption('#profile', 'NACA 4412');
  await setParam(page, 'alpha_deg', 2.5);
  await solve(page);

  await expect(page.locator('.challenge__target').first()).toHaveClass(/is-met/);
  await expect(page.locator('.challenge__target').nth(1)).toHaveClass(/is-missed/);
  await expect(page.locator('#challenge')).not.toContainText('Target met');
});

test('the profile menu carries all three four-digit parameters', async ({ page }) => {
  // The previous version fixed the camber position at 0.4, so a NACA 2312 could not be expressed
  // at all. What has to move is the *mean line's* maximum, which is not the same as the highest
  // point of the outline — that one sits near a quarter chord whatever the camber does, which is
  // why this reads the camber line the solver extracted rather than the control points.
  const camberPeak = async () => {
    await solve(page);
    return page.evaluate(async () => {
      const link = [...document.querySelectorAll('#artifacts a')].find((a) =>
        a.textContent.includes('report.json'),
      );
      const report = await (await fetch(link.href)).json();
      const line = report.geometry.camber_line;
      return line.reduce((best, point) => (point[1] > best[1] ? point : best), line[0])[0];
    });
  };

  await ready(page);
  await page.selectOption('#profile', 'NACA 2312');
  const forward = await camberPeak();
  await page.selectOption('#profile', 'NACA 2512');
  const aft = await camberPeak();

  expect(forward).toBeLessThan(aft - 0.1);
  expect(forward).toBeCloseTo(0.3, 1);
  expect(aft).toBeCloseTo(0.5, 1);

  // And dragging a point takes ownership of the shape.
  await expect(page.locator('#shape-note')).toContainText('NACA 2512');
  await page.locator('#editor').evaluate((editor) => {
    const points = editor.controlPoints;
    points[3] = [points[3][0], points[3][1] + 0.05];
    editor.controlPoints = points;
    editor.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#shape-note')).toContainText('editing the points by hand');
  await expect(page.locator('#profile')).toHaveValue('custom');
});

test('the geometry the solver read is reported back', async ({ page }) => {
  // The spline through the control points is the geometry of record, so any difference from the
  // nominal profile must be visible rather than assumed away.
  await ready(page);
  await solve(page);
  await expect(page.locator('#geometry-readback')).toContainText('The solver read');
  await expect(page.locator('#geometry-readback')).toContainText('panels from');
});
