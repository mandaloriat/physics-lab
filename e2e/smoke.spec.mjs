/**
 * Front-end smoke test: does the lab actually work in a browser?
 *
 * The Python suite proves the API and the protocol; this proves the part only a browser
 * can prove — that the import map resolves, that the Fenix Spoon custom elements upgrade,
 * that the widgets are reachable at the vendored paths, and that a real solve runs from
 * the page and paints a field.
 *
 * The airfoil exercise has its own file, `airfoil.spec.mjs`: it is no longer a demonstration
 * with a Run button but a problem with a target, and what has to be true of it is the exercise
 * contract rather than "a field appeared".
 *
 *   BASE_URL=http://127.0.0.1:8000 npx playwright test
 *
 * It deliberately runs against a *deployment*, not a dev fixture: the same file checks a
 * local `docker compose up` and a production one.
 */

import { expect, test } from '@playwright/test';

/** Advanced is closed on both pages, so the numerics have to be asked for. */
async function openAdvanced(page) {
  await page.locator('#advanced > summary').click();
  await expect(page.locator('#advanced')).toHaveAttribute('open', '');
}

test('the homepage leads with the problems, and shows a real field for each', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page).toHaveTitle(/Spoon Physics/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // The educational disclaimer is a requirement, not decoration.
  await expect(page.locator('.disclaimer')).toContainText('not professional engineering tools');

  // Every challenge is reachable from the homepage as a card.
  for (const experiment of ['airfoil', 'truss', 'heatsink']) {
    await expect(
      page.locator(`.card--available a[href="/experiments/${experiment}/"]`).first(),
    ).toBeVisible();
  }
  // And the advanced lab is reachable too, from the shelf rather than the grid — a page that
  // ships without a way in has not shipped, whatever shape its way in has. ADR-022.
  await expect(page.locator('.shelf a[href="/experiments/solenoid/"]')).toBeVisible();
  // What is still planned must read as planned, not as a broken link. The count used to be
  // pinned at one, which was a fact about the release that wrote it rather than about the
  // page: the heat sink was the last planned card and building it made the assertion false.
  // What must hold at any count, including none, is that a planned card is not a link.
  await expect(page.locator('.card--planned a')).toHaveCount(0);

  // Every card leads with the question it answers, so someone who does not know the subject
  // still knows whether they want it (ADR-021).
  await expect(page.getByRole('link', { name: 'How much tilt does a wing need?' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Which bar gives way first?' })).toBeVisible();

  // And every card states its mission in a sentence a person can picture — visible, not folded.
  // The fold that used to hold `η < 1` and `4.5 mWb/m` is gone: the engineering statement of
  // each target is on the challenge page, where the vocabulary to read it is a paragraph away,
  // and a symbol on a card is a gate in front of a choice. ADR-022.
  const quantities = ['80 kg', '2.4 tonnes', '170 g'];
  for (const [index, quantity] of quantities.entries()) {
    const mission = page.locator('.card--available .card__mission').nth(index);
    await expect(mission).toBeVisible();
    await expect(mission).toContainText(quantity);
  }
  await expect(page.locator('.card-grid .card__numbers')).toHaveCount(0);

  await expect(page.getByRole('link', { name: /Try a wing/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Build the bridge/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Design the heat sink/ })).toBeVisible();

  // The magnetic circuit keeps its URL and loses its card: it is a working lab rather than a
  // challenge with a target a student can picture, and the shelf says so. ADR-022, §9.3.
  await expect(page.locator('.card-grid a[href="/experiments/solenoid/"]')).toHaveCount(0);
  await expect(page.locator('.shelf a[href="/experiments/solenoid/"]')).toBeVisible();

  // The thumbnails are real solves committed by scripts/make-thumbnails.py, so they must
  // actually load — a broken one is a card that says nothing at all.
  const shots = await page.evaluate(() =>
    [...document.querySelectorAll('.card__shot img')].map((img) => ({
      src: img.getAttribute('src'),
      loaded: img.complete && img.naturalWidth > 0,
    })),
  );
  expect(shots.length).toBe(3);
  for (const shot of shots) {
    expect(shot.src).toMatch(/^\/assets\/thumbnails\//);
    expect(shot.loaded).toBe(true);
  }

  // The explanation of how it is built is still here, still underneath the invitation, and now
  // in one block instead of a list of solver modes: which of two routes computed a field is a
  // question for the exercise page that offers the choice, not for somebody deciding which
  // challenge to open. ADR-022, §6.8.
  await expect(page.locator('#modes')).toContainText('Method, code and data');
  const order = await page.evaluate(() => {
    const cards = document.querySelector('.card-grid').getBoundingClientRect().top;
    const about = document.querySelector('.about').getBoundingClientRect().top;
    return { cards, about };
  });
  expect(order.cards).toBeLessThan(order.about);

  // The capability notice is filled in from /health, so its text proves the API answered.
  await expect(page.locator('#capability')).not.toContainText('Checking what is installed');

  expect(errors).toEqual([]);
});

test('the magnetics page runs the solver that reports metrics, and only that one', async ({
  page,
}) => {
  // Two filters, both load-bearing, and this asserts each separately.
  //
  // The *physics* filter is the older one: `mock.heat2d` also accepts `regions2d`, so a picker
  // filtering on geometry alone offered a heat-sink solver in the magnetics menu — and would
  // have submitted a solenoid to it. The filter is the capability's own declared `physics`, so
  // it stays correct when a solver is renamed or a new one is installed.
  //
  // The *exercise* filter is newer: an exercise needs metrics, and the two upstream
  // magnetostatics adapters report none. The page therefore runs `lab.magnetics2d` and says so
  // rather than offering a choice between a solver that can answer the mission and two that
  // cannot.
  await page.goto('/experiments/solenoid/');
  await expect(page.locator('#solver')).toHaveValue(/^lab\.magnetics/);

  const declared = await page.evaluate(async () => {
    const response = await fetch('/api/v1/capabilities');
    return response.ok ? response.json() : null;
  });
  expect(declared).not.toBeNull();
  const magnetics = declared.filter((entry) => entry.physics === 'magnetostatics');
  // More than one magnetostatics capability exists, which is what makes choosing between them
  // a real choice rather than the only option dressed up as one.
  expect(magnetics.length).toBeGreaterThan(1);
  expect(magnetics.some((entry) => entry.name.startsWith('lab.magnetics'))).toBe(true);
  // The heat solver is installed and accepts the same geometry kind — which is what makes the
  // physics filter meaningful rather than vacuous.
  expect(
    declared.some(
      (entry) => entry.physics === 'heat-conduction' && entry.geometry_types.includes('regions2d'),
    ),
  ).toBe(true);
});

test('capability discovery survives a server that does not publish it', async ({ page }) => {
  // Progressive enhancement, asserted: `GET /api/v1/capabilities` is protocol 1.2, and a page
  // that fell over without it would have made the pin a hard requirement of the front-end.
  // With the endpoint refused, the physics filter must degrade to "accept anything" rather
  // than emptying the menu — a page offering too much is recoverable, one offering nothing is
  // not.
  await page.route('**/api/v1/capabilities', (route) => route.fulfill({ status: 404, body: '{}' }));
  await page.goto('/experiments/solenoid/');
  // Without the endpoint the physics filter accepts anything, so the catalogue is wider than it
  // should be — and the page still finds its own solver in it, because it selects by name and
  // not by position.
  await expect(page.locator('#solver')).toHaveValue(/^lab\.magnetics/);
  await expect(page.locator('#run')).toBeEnabled();
});

test('a server without FEniCSx is fully usable and says so', async ({ page }) => {
  // The lab must never require the 3 GB image. Which modes exist is read from /health rather
  // than assumed, and the airfoil exercise needs none of them: its solver is pure NumPy.
  await page.goto('/');
  const info = await page.evaluate(async () => (await fetch('/health')).json());
  const hasFenics = (info.solvers ?? []).some((name) => name.startsWith('dolfinx.'));

  await page.locator('#modes details').first().click();
  await expect(page.locator('#capability')).toContainText(
    hasFenics ? 'both the fast computation and the finite-element one' : 'no FEniCSx is installed',
  );
  if (!hasFenics) {
    await expect(page.locator('#capability')).toContainText('challenges all still work');
  }

  // And the exercise really runs on such a server, which is the claim that matters.
  await page.goto('/experiments/airfoil/');
  await expect(page.locator('#solver')).toHaveValue(/^lab\.airfoil/);
  await expect(page.locator('#run')).toBeEnabled();
});

/**
 * Every experiment page, and the control each one offers that needs no server.
 *
 * The selector differs because the pages differ, and that is the point of listing it rather
 * than looking for one class on all three: the airfoil and the magnetics page configure a
 * shape with sliders, and the bridge configures a *lattice*, whose only slider-shaped inputs
 * are the loads it is asked to carry.
 */
const OFFLINE_CONTROL = {
  airfoil: '#shape-controls input',
  solenoid: '#shape-controls input',
  truss: '#load-controls input',
};

for (const [experiment, control] of Object.entries(OFFLINE_CONTROL)) {
  test(`the ${experiment} page shows a banner instead of a Run button in maintenance`, async ({
    page,
  }) => {
    // `PHYSICS_LAB_JOBS_ENABLED=false` keeps the site, the catalogue and every finished result
    // online while refusing new submissions (ADR-010). The page must read that and offer no
    // button that is going to 503 — simulated here rather than by restarting the server, so the
    // browser suite can assert it against any deployment.
    await page.route('**/health', async (route) => {
      const response = await route.fetch();
      const info = await response.json();
      await route.fulfill({ json: { ...info, jobs_enabled: false } });
    });

    await page.goto(`/experiments/${experiment}/`);
    await expect(page.locator('#maintenance')).toBeVisible();
    await expect(page.locator('#maintenance')).toContainText('not accepting new simulations');
    await expect(page.locator('#run')).toBeDisabled();
    await expect(page.locator('#status')).toContainText('paused for maintenance');

    // Everything that does not need the server still works: the problem, the geometry, the
    // didactics, and any runs already kept.
    await expect(page.locator('.lesson__block').first()).toBeVisible();
    await expect(page.locator(control).first()).toBeEnabled();
  });
}

test('the magnetics page solves a solenoid and derives the field strength', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/experiments/solenoid/');

  await expect(page.locator('#widgets-missing')).toBeHidden();
  await expect.poll(() => page.evaluate(() => Boolean(customElements.get('fs-viewer')))).toBe(true);

  // The parameter form came from the selected solver's schema — a different schema from the
  // airfoil's — and lives under Advanced, because none of it changes the magnet.
  await openAdvanced(page);
  await expect(page.locator('#numerical #param-cells_across')).toBeVisible();

  // Keep the demo solve small: this asserts the loop, not the physics. The refinement study is
  // four times the cells and measures the mesh rather than the plumbing, so it is off here.
  await page.locator('#param-cells_across').fill('40');
  await page.locator('#param-convergence_check').uncheck();

  await page.getByRole('button', { name: 'Compute', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Done.', { timeout: 60_000 });

  await expect(page.locator('#stats')).toContainText('duration');
  // The engineering answer travels as a declared artifact, because protocol 1.2's envelope has
  // nowhere to put a metric. It is written on every run, never optionally.
  await expect(page.locator('#artifacts a')).toContainText('report.json');

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

test('the magnetics page is an exercise: a target, and what it costs to miss it', async ({
  page,
}) => {
  await page.goto('/experiments/solenoid/');

  // The mission is stated before anything is run, and every target reads as pending rather
  // than as met or missed — there is no run to judge yet.
  await expect(page.locator('.challenge__statement')).toContainText('4.5 mWb');
  await expect(page.locator('.challenge__target')).toHaveCount(3);
  await expect(page.locator('.challenge__target.is-pending')).toHaveCount(3);

  // Targets are stated in words, with the engineering statement in the tooltip beside them —
  // meaning before symbol, ADR-022. This is still the assertion that would catch `flux_core`
  // reaching the screen, and it now also catches the two registers being collapsed into one.
  await expect(page.locator('#challenge')).toContainText('Flux: at least 4.5 mWb per metre');
  await expect(page.locator('#challenge .challenge__target').first()).toHaveAttribute(
    'title',
    /\|Φ′\| >= 0\.0045 Wb\/m/,
  );
  await expect(page.locator('#challenge')).not.toContainText('flux_core');
  await expect(page.locator('#challenge')).not.toContainText('leakage_ratio');

  // Nothing is reported before there is something to report.
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#keep')).toBeDisabled();

  // The default cross-section deliberately misses two of the three targets, so there is work
  // to do. Run it and check that the page says which two.
  await openAdvanced(page);
  await page.locator('#param-cells_across').fill('40');
  await page.locator('#param-convergence_check').uncheck();
  await page.getByRole('button', { name: 'Compute', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Done.', { timeout: 60_000 });

  await expect(page.locator('.challenge__target.is-missed')).toHaveCount(2);
  await expect(page.locator('.challenge__target.is-met')).toHaveCount(1);
  await expect(page.locator('#challenge')).not.toContainText('Target met');
  await expect(page.locator('#keep')).toBeEnabled();

  // Every check ran and reported a residual, and the validity statement is explicit rather
  // than an empty box. The refinement check was turned off above, so it reads as not run —
  // which is not the same as passing, and must not be shown as a zero.
  await expect(page.locator('#verification tr')).toHaveCount(5);
  await expect(page.locator('#verification tr.is-absent')).toHaveCount(1);
  await expect(page.locator('#verification')).toContainText('not run');
  await expect(page.locator('#validity')).toContainText('Inside the stated domain of validity');

  // The window is now sized from the magnet, so the truncation warning the old fixed window
  // fired on every run is gone.
  await expect(page.locator('#validity')).not.toContainText('window');

  // Vector tools are live, because this solver publishes B as a vector — where the mock
  // published scalars only and both tools were correctly disabled with that reason.
  await expect(page.locator('[data-tool=vectors]')).toBeEnabled();
  await expect(page.locator('[data-tool=streamlines]')).toBeEnabled();
});

test('the surfaces every reported number is measured on can be drawn', async ({ page }) => {
  // A metric whose surface the visitor cannot see is a metric they have to take on trust, so
  // each one is an annotation layer: the mid-plane the core flux crosses, the ends of the
  // bundle the leakage is measured against, and the contour Ampère's law is checked on.
  await page.goto('/experiments/solenoid/');

  // Before a run they are offered and disabled, each with its own reason.
  for (const layer of ['plane', 'bundle', 'contour']) {
    await expect(page.locator(`[data-layer=${layer}]`)).toBeDisabled();
  }

  await openAdvanced(page);
  await page.locator('#param-cells_across').fill('40');
  await page.locator('#param-convergence_check').uncheck();
  await page.getByRole('button', { name: 'Compute', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Done.', { timeout: 60_000 });

  for (const layer of ['plane', 'bundle', 'contour']) {
    await expect(page.locator(`[data-layer=${layer}]`)).toBeEnabled();
  }

  // The flux surface is on by default; the other two are opt-in.
  await expect(page.locator('#overlay .overlay__planeline')).toHaveCount(1);
  await page.locator('[data-layer=bundle]').click();
  await expect(page.locator('#overlay .overlay__bundleline')).toHaveCount(2);
  await page.locator('[data-layer=contour]').click();
  await expect(page.locator('#overlay .overlay__contourline')).toHaveCount(1);

  // And the same surfaces are marked on the mid-plane plot, so the curve and the field agree.
  await expect(page.locator('#flux-curve svg')).toBeVisible();
  await expect(page.locator('#potential-curve svg')).toBeVisible();
  await expect(page.locator('#plane-note')).toContainText('leakage');
});

test('a kept magnetics run records enough to be recomputed, and reloads its geometry', async ({
  page,
}) => {
  // The row is the only place the page converts *out* of its own units and the loader is the
  // only place it converts back, so a round trip through the store is what proves both. A
  // millimetre slider stored as metres and read back as millimetres is exactly the bug this
  // catches.
  await page.goto('/experiments/solenoid/');
  await page.evaluate(() => window.localStorage.removeItem('spoon-physics:runs:solenoid'));
  await openAdvanced(page);
  await page.locator('#param-cells_across').fill('40');
  await page.locator('#param-convergence_check').uncheck();

  // A cross-section that is not the default, so a reload that silently restored the defaults
  // would be visible.
  await page.locator('#shape-coreHalfWidth').fill('6');
  await page.locator('#shape-gap').fill('2');
  await page.getByRole('button', { name: 'Compute', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Done.', { timeout: 60_000 });

  await page.getByRole('button', { name: 'Keep attempt' }).click();
  await expect(page.locator('#runs-table tbody tr')).toHaveCount(1);

  const [row] = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem('spoon-physics:runs:solenoid')),
  );
  // Every input, including the ones nobody touched: a row missing a default is not
  // reproducible, because the default can change. SI throughout, converted at the boundary.
  expect(row.geometry.core_half_width_m).toBeCloseTo(0.006, 9);
  expect(row.geometry.gap_m).toBeCloseTo(0.002, 9);
  expect(row.geometry.window_half_m).toBeCloseTo(0.24, 9);
  expect(row.geometry.window_ratio).toBe(8);
  for (const key of ['winding_m', 'half_height_m', 'core_width_m', 'interface_fitted']) {
    expect(row.geometry[key]).not.toBeUndefined();
  }
  for (const key of ['mu_r', 'current_density', 'b_sat']) {
    expect(row.physical[key]).not.toBeUndefined();
  }
  for (const key of ['cells_across', 'far_field_growth', 'convergence_check', 'tolerance']) {
    expect(row.numerics[key]).not.toBeUndefined();
  }
  expect(row.solver.name).toMatch(/^lab\.magnetics/);
  expect(row.verification.energy_balance_rel).toBeGreaterThanOrEqual(0);
  expect(row.validity.warnings).toEqual([]);
  // The withheld list travels with the row, so a reader of the export knows what is absent.
  expect(row.model.withheld).toContain('gap_force');

  // Change the geometry, then load the row back: the sliders must return to what was saved.
  await page.locator('#shape-coreHalfWidth').fill('13');
  await expect(page.locator('#shape-note')).toContainText('26 mm across');
  await page.locator('#runs-table tbody tr').first().getByRole('button', { name: 'Load' }).click();
  await expect(page.locator('#status')).toContainText('Loaded the inputs');
  await expect(page.locator('#shape-coreHalfWidth')).toHaveValue('6');
  await expect(page.locator('#shape-gap')).toHaveValue('2');
  await expect(page.locator('#param-cells_across')).toHaveValue('40');
});

test('a leakage the run does not report is not printed as zero', async ({ page }) => {
  // `leakage_ratio` is null when no flux crosses the mid-plane in either direction — the ratio
  // has no denominator. `100 * null` is 0 in JavaScript, so the arithmetic would have printed a
  // confident "0.00 %", which reads as "none of the flux leaks" for a magnet carrying none.
  //
  // The page's own sliders cannot reach it: the current density stops at 0.5 A/mm². So the
  // report is doctored on the wire instead, which is the only way to exercise a branch the
  // solver is right about and the page was wrong about.
  await page.route('**/report.json', async (route) => {
    const response = await route.fetch();
    const report = await response.json();
    report.metrics.leakage_ratio = null;
    await route.fulfill({ json: report });
  });

  await page.goto('/experiments/solenoid/');
  await openAdvanced(page);
  await page.locator('#param-cells_across').fill('40');
  await page.locator('#param-convergence_check').uncheck();
  await page.getByRole('button', { name: 'Compute', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Done.', { timeout: 60_000 });

  await expect(page.locator('#plane-note')).not.toContainText('0.00 %');
  await expect(page.locator('#plane-note')).toContainText('no leakage is reported');
  // The marks are still drawn: they are where A_z turns over, which is a fact about the field
  // and not about the ratio.
  await expect(page.locator('#plane-note')).toContainText('outer pair');
});

test('the magnetics workspace keeps the cross-section and can be explored', async ({ page }) => {
  await page.goto('/experiments/solenoid/');
  await openAdvanced(page);
  await page.locator('#param-cells_across').fill('40');
  await page.locator('#param-convergence_check').uncheck();
  await page.getByRole('button', { name: 'Compute', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Done.', { timeout: 60_000 });

  // The cross-section diagram survives the redesign — it is what tells a visitor what will be
  // solved, and there is no geometry widget that could replace it (ADR-012).
  await expect(page.locator('#schematic')).toBeVisible();
  await expect(page.locator('#schematic #core')).toBeAttached();
  // This page has no outline to edit, so the mode does not exist rather than being disabled.
  await expect(page.locator('[data-tool=edit]')).toHaveCount(0);

  // The regions are drawn over the computed field, in the same coordinates.
  await expect(page.locator('#overlay .overlay__region')).toHaveCount(3);

  await page.locator('[data-tool=probe]').click();
  // Clicked through the locator rather than at raw mouse coordinates: the magnetics domain is
  // square, so on a short viewport the middle of the stage is below the fold and a bare
  // `mouse.click` at those coordinates lands nowhere. The locator scrolls first.
  await page.locator('#stage').click({ position: { x: 120, y: 120 } });
  await expect(page.locator('#readout')).toBeVisible();
  await expect(page.locator('#readout')).toContainText('at (');
});

test('H is B over mu, and only A is drawn with field lines', async ({ page }) => {
  await page.goto('/experiments/solenoid/');
  await openAdvanced(page);
  await page.locator('#param-cells_across').fill('40');
  await page.locator('#param-convergence_check').uncheck();

  await page.getByRole('button', { name: 'Compute', exact: true }).click();
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

for (const experiment of ['airfoil', 'solenoid', 'truss', 'heatsink']) {
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
    await expect(page.locator('#status')).toContainText(/[Pp]ress Compute/);
    expect(submissions).toEqual([]);
  });

  test(`the ${experiment} page lays out on a phone without overflowing`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/experiments/${experiment}/`);
    await expect(page.locator('#run')).toBeEnabled();

    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      // The toolbar drops its labels below 640px so it does not wrap into four rows, but the
      // buttons stay, and so do their accessible names.
      tools: document.querySelectorAll('.workspace__toolbar button').length,
      named: [...document.querySelectorAll('.workspace__toolbar button')].every((button) =>
        (button.getAttribute('aria-label') ?? button.textContent).trim(),
      ),
      actionsVisible: document.getElementById('run').getBoundingClientRect().width > 0,
    }));
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.tools).toBeGreaterThan(6);
    expect(layout.named).toBe(true);
    expect(layout.actionsVisible).toBe(true);
  });

  test(`the ${experiment} page folds its didactics without losing them`, async ({ page }) => {
    await page.goto(`/experiments/${experiment}/`);
    const blocks = page.locator('.lesson__block');
    await expect(blocks).not.toHaveCount(0);

    // Every section of `content.json` is present as a block, at most one of them open, and the
    // limits section is always there — the lab's claim is that it teaches, and a simulation
    // presented without its assumptions teaches something false.
    const sections = await page.evaluate(() =>
      [...document.querySelectorAll('.lesson__block')].map((block) => ({
        id: block.dataset.section,
        open: block.open,
      })),
    );
    expect(sections.filter((section) => section.open).length).toBeLessThanOrEqual(1);
    expect(sections.map((section) => section.id)).toContain('limits');

    const limits = page.locator('.lesson__block[data-section=limits]');
    await expect(limits).toHaveClass(/is-caution/);
    await limits.locator('summary').click();
    await expect(limits.locator('.lesson__body p').first()).toBeVisible();
  });
}
