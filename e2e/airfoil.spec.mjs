/**
 * The airfoil exercise, in a browser.
 *
 * What has to be true here is the exercise contract and the bench arrangement (ADR-017), not
 * "a field appeared": that the three parameter groups really are separate, that a metric the
 * model cannot produce is absent rather than zero, that a run outside the model's stated
 * validity cannot meet the target however good its numbers, that a metric needing a study says
 * so before one is run, that a kept run can be recomputed from what was kept — and, since the
 * redesign, that the instrument works: that a tool the result cannot support is disabled with
 * a reason, that geometry is only editable in the mode meant for editing, and that no storage
 * key ever reaches the screen.
 *
 *   BASE_URL=http://127.0.0.1:8000 npx playwright test
 *
 * Runs against a deployment. Each solve is a panel method — milliseconds of arithmetic and
 * under a second of field sampling — so unlike the mock-solver pages there is no need to shrink
 * anything to keep the suite quick.
 */

import { stat } from 'node:fs/promises';

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

/** Advanced starts closed, so anything numerical has to be asked for. */
async function openAdvanced(page) {
  await page.locator('#advanced > summary').click();
  await expect(page.locator('#advanced')).toHaveAttribute('open', '');
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

test('the mission names quantities the way a person reads them', async ({ page }) => {
  await ready(page);
  // Symbols, not storage keys. The report calls these `l_prime` and `c_m_c4`; the visitor
  // should never have to learn that.
  await expect(page.locator('#challenge')).toContainText('L′ = 800 N/m');
  await expect(page.locator('#challenge')).toContainText('|C_m,c/4| < 0.08');
});

test('no internal identifier reaches the screen, before or after a run', async ({ page }) => {
  // The whole visible text of the page, at every stage a visitor sees, against the keys the
  // report actually uses. This is the test that would have caught `l_prime` in the challenge.
  const FORBIDDEN = [
    'l_prime',
    'c_m_c4',
    'x_cp_over_c',
    'cp_min_station',
    'cl_consistency_rel',
    'cd_pressure_spurious',
    'cl_convergence_rel',
    'x_ac_over_c',
    'alpha_l0_deg',
    'sweep_from_deg',
    'u_inf',
    'sound_speed',
  ];
  const visibleText = () => page.locator('main').innerText();

  await ready(page);
  expect(await visibleText()).not.toMatch(new RegExp(FORBIDDEN.join('|')));

  await setParam(page, 'alpha_deg', 4.6);
  await solve(page);
  // Open everything that folds, so nothing hides behind a closed disclosure.
  await page.locator('#results details.subpanel > summary').first().click();
  await page.locator('#results details.subpanel > summary').last().click();
  expect(await visibleText()).not.toMatch(new RegExp(FORBIDDEN.join('|')));

  // Including the comparison table, which used to print the flattened storage path.
  await page.getByRole('button', { name: 'Keep result' }).click();
  await setParam(page, 'alpha_deg', 2.0);
  await solve(page);
  await page.getByRole('button', { name: 'Keep result' }).click();
  await page.locator('#runs-table tbody input[type=checkbox]').first().check();
  await page.locator('#runs-table tbody input[type=checkbox]').nth(1).check();
  await expect(page.locator('#compare table')).toBeVisible();
  await expect(page.locator('#compare')).toContainText('Answer ·');
  expect(await page.locator('#compare').innerText()).not.toMatch(/l_prime|c_m_c4/);
});

test('Advanced is closed on arrival and opens on request', async ({ page }) => {
  await ready(page);

  // Nothing numerical is on the main path: the mission can be answered without it.
  await expect(page.locator('#advanced')).not.toHaveAttribute('open', '');
  await expect(page.locator('#numerical #param-panels')).toBeHidden();
  await expect(page.locator('#study #param-sweep_from_deg')).toBeHidden();

  await openAdvanced(page);
  await expect(page.locator('#numerical #param-panels')).toBeVisible();
  await expect(page.locator('#study #param-sweep_from_deg')).toBeVisible();

  await page.locator('#advanced > summary').click();
  await expect(page.locator('#advanced')).not.toHaveAttribute('open', '');
});

test('the page opens with no empty result panels', async ({ page }) => {
  await ready(page);

  // Before the first run there is nothing to report, so the reporting sections do not exist.
  // The page used to open with three panels reading "Nothing computed yet".
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#kpis')).toBeHidden();
  await expect(page.locator('#sweep-panel')).toBeHidden();
  expect(await page.locator('main').innerText()).not.toContain('Nothing computed yet');

  await solve(page);
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('.kpi')).not.toHaveCount(0);
});

test('physical inputs, numerical settings and the study are separate groups', async ({ page }) => {
  await ready(page);
  await openAdvanced(page);

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
  await page.locator('#derived-toggle').click();
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

  // The answer, headline first: the tiles carry the number the target is set in.
  await expect(page.locator('#kpis')).toContainText('800');
  await expect(page.locator('#challenge')).toContainText('799');
  await expect(page.locator('.challenge__target.is-met')).toHaveCount(2);
  await expect(page.locator('#challenge')).toContainText('Target met');

  // Every check ran and passed, and the validity statement is explicit rather than an empty box.
  await expect(page.locator('#verification tr')).toHaveCount(3);
  await expect(page.locator('#verification tr.is-missed')).toHaveCount(0);
  await expect(page.locator('#validity')).toContainText('Inside the stated domain of validity');

  // The cost of the solve is reported apart from the answer, behind its own disclosure.
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

  // Nothing resembling a drag on screen, and the panel says why.
  await expect(page.locator('#results')).not.toContainText('Drag');
  await expect(page.locator('#answer-heading ~ .field__hint')).toContainText('inviscid');
});

test('a target hit outside the model’s validity does not count, and says so separately', async ({
  page,
}) => {
  await ready(page);

  // Mach 0.44: the numbers still come out, and the incompressible assumption does not hold.
  await setParam(page, 'u_inf', 150);
  await setParam(page, 'alpha_deg', 0.4);
  await solve(page);

  await expect(page.locator('#validity li')).not.toHaveCount(0);
  await expect(page.locator('#validity')).toContainText('Mach');
  // The disqualification is its own message, distinct from a verification failure: a visitor
  // has to know which of their choices to change.
  await expect(page.locator('.challenge__blocked--validity')).toContainText('domain of validity');
  await expect(page.locator('.challenge__blocked--verification')).toHaveCount(0);
  await expect(page.locator('#challenge')).not.toContainText('Target met');
});

test('the aerodynamic centre is unavailable until a sweep has been run', async ({ page }) => {
  await ready(page);
  await solve(page);

  // A property of several solves must not be offered after one — in the tiles, in the overlay
  // switches, and as a panel.
  await expect(page.locator('#sweep-panel')).toBeHidden();
  await expect(page.locator('#kpis')).toContainText('needs a sweep');
  await expect(page.locator('[data-layer=ac]')).toBeDisabled();
  await expect(page.locator('[data-layer=ac]')).toHaveAttribute('title', /sweep/);

  await openAdvanced(page);
  await setParam(page, 'sweep_from_deg', -4);
  await setParam(page, 'sweep_to_deg', 8);
  await solve(page);

  await expect(page.locator('#sweep-panel')).toBeVisible();
  await expect(page.locator('#sweep-metrics')).toContainText('Aerodynamic centre');
  await expect(page.locator('#sweep-curve .curve__trace')).toHaveCount(2);
  await expect(page.locator('[data-layer=ac]')).toBeEnabled();

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
    const tile = [...document.querySelectorAll('#kpis .kpi')].find((k) =>
      k.textContent.includes('Lift coefficient'),
    );
    return parseFloat(tile.querySelector('.kpi__value').textContent);
  });
  expect(Math.abs(lift)).toBeLessThan(1e-6);

  await expect(page.locator('#validity')).toContainText('zero by construction');
  // And the reason a Kutta condition exists at all: the trailing-edge velocity is unbounded.
  await expect(page.locator('#validity')).toContainText('unbounded');
});

/* ---------------------------------------------------------------- the workspace itself */

test('Explore results and Edit shape are separate modes', async ({ page }) => {
  await ready(page);

  // On arrival the pointer pans. The geometry editor exists but is inert and invisible, so a
  // drag can never be both a pan and an accidental reshaping.
  await expect(page.locator('[data-tool=pan]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#editor')).toBeHidden();

  await page.locator('[data-tool=edit]').click();
  await expect(page.locator('[data-tool=edit]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#stage')).toHaveAttribute('data-mode', 'edit');
  // The sidebar button and the toolbar button are the same state, not two.
  await expect(page.locator('#edit-shape')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('[data-tool=pan]').click();
  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('#edit-shape')).toHaveAttribute('aria-pressed', 'false');
});

test('the control points exist only in Edit shape', async ({ page }) => {
  await ready(page);

  // The handles are DOM nodes in the widget's shadow root, so this counts what is actually
  // hit-testable rather than trusting a CSS rule.
  const handles = () =>
    page.evaluate(() => {
      const editor = document.getElementById('editor');
      if (editor.hidden) return 0;
      return editor.shadowRoot?.querySelectorAll('circle, [data-index]').length ?? 0;
    });

  expect(await handles()).toBe(0);
  await page.locator('[data-tool=edit]').click();
  expect(await handles()).toBeGreaterThan(0);
  await page.locator('[data-tool=pan]').click();
  expect(await handles()).toBe(0);
});

test('pan, zoom, probe and reset work on a computed field', async ({ page }) => {
  await ready(page);
  await solve(page);

  const zoomWidth = () =>
    page.locator('.workspace__zoom').evaluate((node) => node.getBoundingClientRect().width);
  const fitted = await zoomWidth();

  // Zoom in enlarges the box the widget renders into — a redraw at a larger size, not a
  // magnified raster — and the stage then has something to scroll.
  await page.locator('[data-tool=zoom-in]').click();
  expect(await zoomWidth()).toBeGreaterThan(fitted * 1.2);
  await expect(page.locator('#stage')).toHaveClass(/is-zoomed/);

  // Pan, by the keyboard route, which is the one that has to work for everybody.
  await page.locator('#stage').focus();
  const before = await page.locator('#stage').evaluate((node) => node.scrollLeft);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await page.locator('#stage').evaluate((node) => node.scrollLeft)).toBeGreaterThan(before);

  // Reset returns the view, by button and by keystroke alike.
  await page.locator('[data-tool=reset]').click();
  expect(await zoomWidth()).toBeCloseTo(fitted, 0);
  expect(await page.locator('#stage').evaluate((node) => node.scrollLeft)).toBe(0);

  // Fit frames the profile, which is a real zoom because the section is a fraction of the window.
  await page.locator('[data-tool=fit]').click();
  expect(await zoomWidth()).toBeGreaterThan(fitted);
  await page.locator('[data-tool=reset]').click();

  // Probe pins a value and its coordinates.
  await expect(page.locator('#readout')).toBeHidden();
  await page.locator('[data-tool=probe]').click();
  await expect(page.locator('#stage')).toHaveAttribute('data-mode', 'probe');
  await page.locator('#stage').click({ position: { x: 120, y: 90 } });
  await expect(page.locator('#readout')).toBeVisible();
  await expect(page.locator('#readout')).toContainText('at (');
  await expect(page.locator('.overlay__pin')).toHaveCount(1);
});

test('a tool the result cannot support is disabled with a readable reason', async ({ page }) => {
  await ready(page);

  // Before a run there is no field, and every tool that needs one says so rather than vanishing.
  for (const tool of ['probe', 'vectors', 'streamlines', 'export']) {
    await expect(page.locator(`[data-tool=${tool}]`)).toBeDisabled();
    expect(await page.locator(`[data-tool=${tool}]`).getAttribute('title')).toBeTruthy();
  }

  await solve(page);

  // The panel method publishes a velocity vector field, so both become available.
  await expect(page.locator('[data-tool=vectors]')).toBeEnabled();
  await expect(page.locator('[data-tool=streamlines]')).toBeEnabled();

  await page.locator('[data-tool=vectors]').click();
  await expect(page.locator('#viewer')).toHaveAttribute('vectors', 'velocity');
  await page.locator('[data-tool=streamlines]').click();
  await expect(page.locator('.overlay__streamlines path').first()).toBeAttached();

  // Density changes the picture and never resubmits: no job may be posted by moving it.
  const submissions = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/v1/jobs')) {
      submissions.push(request.url());
    }
  });
  const before = await page.locator('.overlay__streamlines path').count();
  await page.locator('#workspace-density').fill('44');
  await page.locator('#workspace-density').dispatchEvent('input');
  await expect(page.locator('#viewer')).toHaveAttribute('glyphs', '44');
  expect(await page.locator('.overlay__streamlines path').count()).not.toBe(before);
  expect(submissions).toEqual([]);
});

test('locking the colour scale is refused with the upstream reason, not silently missing', async ({
  page,
}) => {
  await ready(page);
  await solve(page);

  // The pinned `<fs-viewer>` computes its range from the data and exposes only a getter, so a
  // locked scale would put a range on the legend that the canvas does not use. The control is
  // present and disabled, and its reason names the gap — the day upstream adds a settable
  // range, `viewerCapabilities` detects it and this assertion is the one that changes.
  const lock = page.locator('[data-tool=lock-scale]');
  await expect(lock).toBeVisible();
  await expect(lock).toBeDisabled();
  await expect(lock).toHaveAttribute('title', /colour range|color range/i);

  // What does work is that the scale is drawn at all, with the range the field really has.
  await expect(page.locator('#scale .scale__bar')).toBeVisible();
  await expect(page.locator('#scale .scale__ticks li')).not.toHaveCount(0);
});

test('the centre of pressure is drawn on the field, not only tabulated', async ({ page }) => {
  await ready(page);
  await setParam(page, 'alpha_deg', 4.6);
  await solve(page);

  // It was available as a number and invisible on the picture, which is the one place a
  // *position* belongs.
  await expect(page.locator('[data-layer=cp]')).toBeEnabled();
  await expect(page.locator('#overlay .overlay__cp')).toHaveCount(1);
  await expect(page.locator('#overlay .overlay__cp text')).toContainText('x_cp/c');

  // And it can be switched off, together with the rest of the annotation layers.
  await page.locator('[data-layer=cp]').click();
  await expect(page.locator('#overlay .overlay__cp')).toHaveCount(0);

  // The quarter chord and the free stream are drawn by default; the suction peak on request.
  await expect(page.locator('#overlay .overlay__quarter')).toHaveCount(1);
  await expect(page.locator('#overlay .overlay__stream')).toHaveCount(1);
  await page.locator('[data-layer=peak]').click();
  await expect(page.locator('#overlay .overlay__peak')).toHaveCount(1);
});

test('Run, Keep result and exporting the image all work from the action bar', async ({ page }) => {
  await ready(page);

  // The action bar carries the whole loop, and Keep is offered only once there is a result.
  await expect(page.locator('#actionbar #run')).toBeEnabled();
  await expect(page.locator('#actionbar #keep')).toBeDisabled();

  await setParam(page, 'alpha_deg', 4.6);
  await solve(page);
  await expect(page.locator('#actionbar #keep')).toBeEnabled();

  await page.locator('#actionbar #keep').click();
  await expect(page.locator('#runs-table tbody tr')).toHaveCount(1);

  // The exported image is composed from the field plus the annotation layer, and the layer is
  // serialised without its stylesheet — so every property it is drawn with has to be inlined.
  // `fill: none` is the one that bites: an outline whose fill is not carried across falls back
  // to the SVG default of *black* and exports as a filled silhouette. Asserting the styles the
  // export has to preserve is a cheaper regression guard than decoding the PNG, and it names
  // the cause rather than a symptom.
  await page.locator('[data-layer=peak]').click();
  const styled = await page.evaluate(() => {
    const seen = {};
    for (const [key, selector] of [
      ['profile', '#overlay .overlay__profile'],
      ['label', '#overlay .overlay__marker text'],
    ]) {
      const node = document.querySelector(selector);
      if (!node) continue;
      const style = getComputedStyle(node);
      seen[key] = {
        fill: style.fill,
        stroke: style.stroke,
        fontFamily: style.fontFamily,
        paintOrder: style.paintOrder,
      };
    }
    return seen;
  });
  // An outline: no fill, a visible stroke.
  expect(styled.profile.fill).toBe('none');
  expect(styled.profile.stroke).not.toBe('none');
  // A label: a font of its own and the halo that keeps it readable over any field.
  expect(styled.label.fontFamily).not.toBe('');
  expect(styled.label.paintOrder).toContain('stroke');

  const download = page.waitForEvent('download');
  await page.locator('[data-tool=export]').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.png$/);
  // A composed picture, not an empty canvas: the field alone is already tens of kilobytes.
  const { size } = await stat(await file.path());
  expect(size).toBeGreaterThan(10_000);
});

/* ------------------------------------------------------------------ keeping and comparing */

test('a kept run records enough to be recomputed, and two runs can be compared', async ({
  page,
}) => {
  await ready(page);
  await setParam(page, 'alpha_deg', 4.6);
  await solve(page);
  await page.getByRole('button', { name: 'Keep result' }).click();
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
  await page.getByRole('button', { name: 'Keep result' }).click();
  await expect(page.locator('#runs-table tbody tr')).toHaveCount(2);

  await page.locator('#runs-table tbody input[type=checkbox]').first().check();
  await page.locator('#runs-table tbody input[type=checkbox]').nth(1).check();
  await expect(page.locator('#compare table')).toBeVisible();
  await expect(page.locator('#compare')).toContainText('Geometry ·');
  await expect(page.locator('#compare')).toContainText('are identical and hidden');

  // Loading a row puts its inputs back without solving again.
  await page.locator('#runs-table tbody tr').last().getByRole('button', { name: 'Load' }).click();
  await expect(page.locator('#status')).toContainText('Loaded the inputs');
  await expect(page.locator('#param-alpha_deg')).toHaveValue('4.6');
});

test('a browser that refuses to store cannot take the page down', async ({ page }) => {
  // A private window, a full quota, storage switched off: the store throws on *every* write, and
  // pressing Keep or Delete must still leave a working page. Saving loses the run and deleting
  // keeps it, and in both cases what the table shows is what the store really holds.
  await ready(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await setParam(page, 'alpha_deg', 4.6);
  await solve(page);
  await page.getByRole('button', { name: 'Keep result' }).click();
  await expect(page.locator('#runs-table tbody tr')).toHaveCount(1);

  await page.evaluate(() => {
    // Patched on `Storage.prototype`, which is where the methods actually live. Defining them as
    // own properties of the `localStorage` instance does not shadow them, and the write goes
    // through — which is how the first version of this test passed while proving nothing.
    const refuse = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    Storage.prototype.setItem = refuse;
    Storage.prototype.removeItem = refuse;
  });

  await page.getByRole('button', { name: 'Keep result' }).click();
  await expect(page.locator('#runs-table tbody tr')).toHaveCount(1); // the run is lost, the page is not
  await page
    .locator('#runs-table tbody tr')
    .first()
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.locator('#runs-table tbody tr')).toHaveCount(1); // the row survives a failed delete
  await page.getByRole('button', { name: 'Delete all' }).click();
  await expect(page.locator('#runs-table tbody tr')).toHaveCount(1);

  // Still usable afterwards: the export path is the way out of a browser that will not store.
  await expect(page.locator('#export-json')).toBeEnabled();
  expect(errors).toEqual([]);
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
  await expect(page.locator('#shape-note')).toContainText('Edited by hand');
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

/* ------------------------------------------------------------------------------- layout */

test('the workspace dominates on a desktop and stacks on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page);

  // The whole argument of the redesign, measured: the instrument takes most of the bench.
  const wide = await page.evaluate(() => {
    const workspace = document.querySelector('.workspace').getBoundingClientRect();
    const layout = document.querySelector('.bench__layout').getBoundingClientRect();
    const controls = document.querySelector('.controls').getBoundingClientRect();
    return {
      share: workspace.width / layout.width,
      sideBySide: Math.abs(workspace.top - controls.top) < 80,
    };
  });
  expect(wide.share).toBeGreaterThan(0.6);
  expect(wide.sideBySide).toBe(true);

  // On a phone the two stack, nothing overflows sideways, and the stage keeps a usable height.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const narrow = await page.evaluate(() => ({
    stacked:
      document.querySelector('.controls').getBoundingClientRect().top >
      document.querySelector('.workspace').getBoundingClientRect().top + 100,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    stageHeight: document.getElementById('stage').getBoundingClientRect().height,
  }));
  expect(narrow.stacked).toBe(true);
  expect(narrow.overflow).toBeLessThanOrEqual(1);
  expect(narrow.stageHeight).toBeGreaterThan(220);
});

test('every tool is reachable from the keyboard', async ({ page }) => {
  await ready(page);
  await solve(page);

  // Each toolbar control is a real button with an accessible name, and the stage itself is
  // focusable so panning and zooming never require a pointer.
  const toolbar = await page.evaluate(() =>
    [...document.querySelectorAll('.workspace__toolbar button')].map((button) => ({
      name: button.getAttribute('aria-label') ?? button.textContent.trim(),
      focusable: button.tabIndex >= 0 || !button.hasAttribute('tabindex'),
    })),
  );
  expect(toolbar.length).toBeGreaterThan(8);
  for (const button of toolbar) {
    expect(button.name).not.toBe('');
    expect(button.focusable).toBe(true);
  }

  await page.locator('#stage').focus();
  await expect(page.locator('#stage')).toBeFocused();
  await page.keyboard.press('+');
  await expect(page.locator('#stage')).toHaveClass(/is-zoomed/);
  await page.keyboard.press('0');
  await expect(page.locator('#stage')).not.toHaveClass(/is-zoomed/);
});
